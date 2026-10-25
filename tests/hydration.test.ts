import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { stringify } from "devalue";
import { createPageContext, DEFAULT_LIMITS } from "../src/core/context";
import { extractHydrationData } from "../src/extractors/hydration";

function extract(html: string, includeRawHydration = false) {
  const { document } = parseHTML(html);
  const context = createPageContext(document, html, "https://publisher.example/authors/one", DEFAULT_LIMITS);
  context.includeRawHydration = includeRawHydration;
  return extractHydrationData(context);
}
const script = (id: string, body: string) => `<script id="${id}">${body}</script>`;

describe("hydration extraction", () => {
  test("reads Quintype static-page and qtLoadedData without hardcoded publisher hosts", () => {
    const html = script("static-page", JSON.stringify({ qt: { data: { author: { id: 12, name: "Ada Writer", "avatar-url": { url: "/ada.jpg" } }, authorCollection: { items: [{ story: { headline: "A story", slug: "news/story", "first-published-at": "not a date", "owner-name": "Editor", "owner-id": 77 } }, { story: { headline: "Missing route" } }] } } } })) +
      `<script>qtLoadedData = {author:{name:"Second Writer",id:13}};</script>`;
    const result = extract(html);
    expect(result.authors.map((a) => a.profile.name)).toEqual(expect.arrayContaining(["Second Writer", "Ada Writer"]));
    expect(result.authors.find((a) => a.profile.name === "Ada Writer")?.profile.avatarUrl).toBe("https://publisher.example/ada.jpg");
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].article.url).toBe("https://publisher.example/news/story");
    expect(result.articles[0].fieldPaths?.url).toContain("authorCollection.items[0].story.slug");
    expect(result.raw).toBeUndefined();
    expect(result.fields.some((f) => f.field === "editorial.ownerName" && f.value === "Editor")).toBe(true);
    expect(result.fields.some((f) => f.field === "editorial.ownerId" && f.value === 77)).toBe(true);
  });
  test("does not extract assignment-looking plain text outside scripts", () => {
    const html = `<p>window.__NUXT__ = {author:{name:"Text Impostor"}}</p><script>// window.__NUXT__={author:{name:"Comment Impostor"}}</script>`;
    const result = extract(html);
    expect(result.authors).toHaveLength(0);
  });
  test("preserves Hearst-style outer author ID and nested profile fields", () => {
    const payload = { props: { pageProps: { author: { authorId: "outer-7", profile: { display_name: "Hearst Writer", legacy_id: "legacy-7", job_title: "Editor", photo: { url: "/photo.jpg" } }, content: [{ title: "Culture investigation", section: { slug: "culture" }, slug: "story" }, { title: "Missing slug" }] } } } };
    const result = extract(script("__NEXT_DATA__", JSON.stringify(payload)));
    expect(result.authors[0]).toMatchObject({ profile: { name: "Hearst Writer", id: "outer-7", designation: "Editor", avatarUrl: "https://publisher.example/photo.jpg" } });
    expect(result.articles.map(({ article }) => article.url)).toEqual(["https://publisher.example/culture/story/"]);
  });

  test("reads Next Pages props, normalizes fields, and keeps editorial owner separate", () => {
    const payload = { props: { pageProps: { author: { id: 3, name: "Writer", role: "Reporter", image: { contentUrl: "/portrait.png" }, email: "writer@example.com", twitter: "https://x.com/writer" }, contributor: { id: 6, name: "Page Contributor" }, articles: [{ title: "Story", slug: "/story", date: "2024-01-02" }], story: { "owner-name": "CMS Editor" }, currentUser: { id: "me", name: "Logged-in user", email: "me@example.com" } } } };
    const result = extract(script("__NEXT_DATA__", JSON.stringify(payload)));
    const writer = result.authors.find((candidate) => candidate.profile.name === "Writer");
    expect(writer?.profile).toMatchObject({ name: "Writer", designation: "Reporter", avatarUrl: "https://publisher.example/portrait.png", email: "writer@example.com" });
    expect(writer?.identity).toContain("publisher.example");
    expect(result.authors.some((a) => a.profile.name === "Logged-in user")).toBe(false);
    expect(writer?.socialEvidence?.[0].sourcePath).toContain(".author.twitter");
    expect(result.authors.find((a) => a.profile.name === "Page Contributor")?.primary).toBe(true);
    expect(result.fields.some((f) => f.field === "editorial.ownerName" && f.value === "CMS Editor")).toBe(true);
    expect(result.articles[0].article.publishedAt).toBe("2024-01-02T00:00:00.000Z");
  });

  test("decodes actual Next App Router push Flight JSON rows and references", () => {
    const flight = `0:{"author":"$1","articles":["$2"]}\n1:{"id":"a-1","name":"Flight Writer"}\n2:{"title":"Flight story","url":"https://publisher.example/flight"}`;
    const result = extract(`<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`);
    expect(result.authors.some((a) => a.profile.name === "Flight Writer")).toBe(true);
    expect(result.articles.some((a) => a.article.title === "Flight story")).toBe(true);
  });

  test("decodes Nuxt3 devalue refs, tags and cycles beneath payload.data", () => {
    const serialized = JSON.stringify([
      { payload: 1 }, { data: 2 }, { author: 3, profile: 3, error: 4, emptyRef: 5, emptyShallowRef: 6, marker: 7 },
      ["Reactive", 8], ["NuxtError", 9], ["EmptyRef", "_"], ["EmptyShallowRef", "0n"], { label: 10, self: 7 },
      ["Ref", 11], { message: 12 }, "cycle", ["ShallowReactive", 13], "safe",
      { id: 14, name: 15, image: 16 }, "writer-4", "Nuxt Writer", { url: 17 }, "/writer.jpg",
    ]);
    const result = extract(script("__NUXT_DATA__", serialized), true);
    expect(result.authors.some((a) => a.profile.name === "Nuxt Writer")).toBe(true);
    expect(result.raw).toBeDefined();
    expect(JSON.stringify(result.raw)).toContain("[Circular]");
  });

  test("does not mistake devalue typed-array lengths or sparse indices for references", () => {
    const sparse: unknown[] = new Array(1000);
    sparse[999] = "tail";
    const serialized = stringify({
      author: { id: 42, name: "Typed Payload Writer" },
      bytes: new Uint8Array(512),
      sparse,
      absent: undefined,
      published: new Date("2024-01-01"),
      labels: new Set(["news"]),
    });
    const result = extract(script("__NUXT_DATA__", serialized));
    expect(result.authors.find(({ profile }) => profile.name === "Typed Payload Writer")?.profile.id).toBe(42);
  });

  test("rejects a sparse allocation bomb before revival and still extracts a later source", () => {
    const graph = [{ author: 1, sparse: 2 }, { name: 3 }, [-7, 1_000_000_000, 999_999_999, 4], "Ignored Writer", "tail"];
    const html = script("__NUXT_DATA__", JSON.stringify(graph)) + '<script>window.__INITIAL_STATE__={author:{name:"Later Writer"}}</script>';
    const { document } = parseHTML(html);
    const context = createPageContext(document, html, "https://publisher.example/", DEFAULT_LIMITS);
    const result = extractHydrationData(context);
    expect(result.authors.map(({ profile }) => profile.name)).toEqual(["Later Writer"]);
    expect(context.issues.some(({ sourcePath }) => sourcePath === "script[0]")).toBe(true);
  });
  test("resolves Flight references across actual push script chunks", () => {
    const html = `<script>self.__next_f.push([1,${JSON.stringify('0:{"author":"$1"}\n')}])</script>` +
      `<script>self.__next_f.push([1,${JSON.stringify('1:{"id":"cross-1","name":"Chunk Writer"}\n')}])</script>`;
    const result = extract(html);
    expect(result.authors.some((a) => a.profile.name === "Chunk Writer")).toBe(true);
    expect(result.authors.find((a) => a.profile.name === "Chunk Writer")?.evidence.name?.sourcePath).toContain("#flight:1.name");
  });
  test("keeps multiple push calls in lexical order while joining split Flight rows", () => {
    const first = '0:{"author":"$1"}\n';
    const second = '1:{"name":"Ordered Writer"}';
    const html = `<script>self.__next_f.push([1,${JSON.stringify(first)}]);self.__next_f.push([1,${JSON.stringify(second)}])</script>`;
    const result = extract(html);
    expect(result.authors.some((a) => a.profile.name === "Ordered Writer")).toBe(true);
  });

  test("namespaces otherwise identical CMS IDs by publisher origin", () => {
    const html = script("__NEXT_DATA__", JSON.stringify({ props: { pageProps: { author: { id: 42, name: "Same ID" } } } }));
    const identities = ["https://one.example/profile", "https://two.example/profile"].map((url) => {
      const { document } = parseHTML(html);
      return extractHydrationData(createPageContext(document, html, url, DEFAULT_LIMITS)).authors[0].identity;
    });
    expect(identities[0]).not.toBe(identities[1]);
  });

  test("bounds deep Nuxt graph decoding and continues collecting later payloads", () => {
    let nested: unknown = { author: { name: "Deep Writer" } };
    for (let i = 0; i < 20; i++) nested = { child: nested };
    const serialized = stringify(nested);
    const html = script("__NUXT_DATA__", serialized) + `<script>window.__INITIAL_STATE__={author:{name:"Later Writer"}}</script>`;
    const { document } = parseHTML(html);
    const context = createPageContext(document, html, "https://publisher.example/", { ...DEFAULT_LIMITS, maxDecodeDepth: 5 });
    const result = extractHydrationData(context);
    expect(result.authors.some((a) => a.profile.name === "Later Writer")).toBe(true);
    expect(context.issues.some((issue) => issue.message.includes("Nuxt devalue decode failed"))).toBe(true);
  });

  test("reads Nuxt2 object state and whitelisted serialized IIFE without executing JavaScript", () => {
    const html = `<script>window.__NUXT__ = (function(a){return {data:[{author:a}],fetch:{}}}({id:21,name:"IIFE Writer"}));</script>` +
      `<script>window.__PRELOADED_STATE__ = {profile:{name:"Plain Nuxt", slug:"plain"}};</script>`;
    const result = extract(html);
    expect(result.authors.some((a) => a.profile.name === "IIFE Writer")).toBe(true);
    expect(result.authors.some((a) => a.profile.name === "Plain Nuxt")).toBe(true);
  });

  test("reads Fusion, Fenrir and generic initial state payloads independently", () => {
    const html = `<script>Fusion.globalContent = {author:{name:"Fusion Writer"}};</script>` +
      script("fenrir-client-data", JSON.stringify({ author: { id: "fenrir-1", name: "Fenrir Writer" } })) +
      `<script>window.__INITIAL_STATE__ = {author:{name:"Window Writer"}};</script>`;
    const result = extract(html);
    expect(result.authors.map((a) => a.profile.name)).toEqual(expect.arrayContaining(["Fusion Writer", "Fenrir Writer", "Window Writer"]));
  });

  test("does not execute untrusted assignment expressions", () => {
    const html = `<script>window.__NUXT__ = (function(){globalThis.__hydration_pwned=true; return {author:{name:"Injected"}}})()</script>`;
    delete (globalThis as Record<string, unknown>).__hydration_pwned;
    const result = extract(html);
    expect((globalThis as Record<string, unknown>).__hydration_pwned).toBeUndefined();
    expect(result.authors).toHaveLength(0);
  });
  test("collects multiple candidates with exact paths and tolerates malformed optional fields", () => {
    const html = script("__NEXT_DATA__", JSON.stringify({ props: { pageProps: { author: { name: "Byline" }, contributors: [{ name: "Other Person", profileUrl: "/people/other" }], categories: [{ name: "Technology", slug: "technology", description: "Subject area" }, { "@type": "Organization", name: "Publisher", slug: "publisher", description: "Company" }], related: [{ author: { name: "Related Writer", email: "related@example.com" } }], articles: [{ title: "No URL" }, { title: "Valid", url: "javascript:bad()", slug: "/valid", publishedAt: "invalid", date: "2024-02-03" }] } } })) +
      `<script>window.__INITIAL_STATE__ = {profile:{id:9,name:"Target"}, articles:[{title:"Also valid",url:"/also"}]};</script>`;
    const result = extract(html);
    expect(result.authors.map((a) => a.profile.name)).toEqual(expect.arrayContaining(["Byline", "Other Person", "Target"]));
    expect(result.articles.map((a) => a.article.title)).toEqual(expect.arrayContaining(["Valid", "Also valid"]));
    const valid = result.articles.find((candidate) => candidate.article.title === "Valid")?.article;
    expect(valid?.url).toBe("https://publisher.example/valid");
    expect(valid?.publishedAt).toBe("2024-02-03T00:00:00.000Z");
    expect(result.authors.find((a) => a.profile.name === "Other Person")?.evidence.name?.sourcePath).toContain("contributors[0]");
    expect(result.authors.find((a) => a.profile.name === "Related Writer")?.primary).toBe(false);
    expect(result.authors.some((a) => a.profile.name === "Technology" || a.profile.name === "Publisher")).toBe(false);
  });

  test("accepts hybrid person types and keeps comments/latest authors out of the primary slot", () => {
    const html = script("__NEXT_DATA__", JSON.stringify({
      props: {
        pageProps: {
          author: { "@type": ["Person", "Employee"], name: "Hybrid Author", id: 3 },
          comments: [{ author: { name: "Commenter One", id: 99 } }],
          latestAuthors: [{ name: "Latest Person", id: 5 }],
        }
      }
    }));
    const result = extract(html);
    expect(result.authors.find((a) => a.profile.name === "Hybrid Author")?.primary).toBe(true);
    expect(result.authors.find((a) => a.profile.name === "Commenter One")?.primary).toBe(false);
    expect(result.authors.some((a) => a.profile.name === "Latest Person")).toBe(false);
  });

  test("does not turn generic menu items into articles", () => {
    const html = script("static-page", JSON.stringify({
      qt: {
        data: {
          author: { name: "Real Author", id: 1 },
          menuGroups: { menuGroups: [{ "gn-list": { items: [{ title: "COMPANIES", slug: "companies" }, { title: "GAMING", slug: "gaming" }] } }] },
          articles: [{ title: "A real investigation", slug: "/real-investigation" }],
        }
      }
    }));
    const result = extract(html);
    expect(result.articles.map(({ article }) => article.title)).toEqual(["A real investigation"]);
  });

  test("reads sameAs and common social fields from hydration authors", () => {
    const html = script("__NEXT_DATA__", JSON.stringify({
      props: {
        pageProps: {
          author: {
            id: 4, name: "Social Author", sameAs: ["https://github.com/social"],
            facebook: "https://facebook.com/socialpage", youtube: "https://youtube.com/@social",
            github: "https://github.com/social-two", threads: "https://threads.net/@social",
            bluesky: "https://bsky.app/profile/social.bsky.social", muckrack: "https://muckrack.com/social",
          }
        }
      }
    }));
    const result = extract(html);
    const platforms = new Set((result.authors[0]?.profile.socials ?? []).map(({ platform }) => platform));
    expect(platforms).toEqual(new Set(["github", "facebook", "youtube", "threads", "bluesky", "muckrack"]));
  });

  test("detects the Flight bootstrap assignment before the first push", () => {
    const flight = `0:{"author":"$1"}\n1:{"id":"a-1","name":"Bootstrap Writer"}`;
    const result = extract(`<script>(self.__next_f=self.__next_f||[]).push([1,${JSON.stringify(flight)}])</script>`);
    expect(result.authors.some((a) => a.profile.name === "Bootstrap Writer")).toBe(true);
  });

  test("continues shallower siblings after a branch hits the depth limit", () => {
    const payload = { author: { name: "Shallow Author", id: 1 }, deep: { a: { b: { c: { d: { author: { name: "Deep Author" } } } } } } };
    const html = script("__NEXT_DATA__", JSON.stringify({ props: { pageProps: payload } }));
    const { document } = parseHTML(html);
    const context = createPageContext(document, html, "https://publisher.example/", { ...DEFAULT_LIMITS, maxDecodeDepth: 4 });
    const result = extractHydrationData(context);
    expect(result.authors.some((a) => a.profile.name === "Shallow Author")).toBe(true);
    expect(context.issues.some(({ message }) => message.includes("Hydration depth limit"))).toBe(true);
  });
  test("keeps article authors eligible while excluding linked-story and blog people", () => {
    const payload = {
      props: {
        pageProps: {
          data: {
            article: { authors: [{ name: "Current Writer", profileUrl: "/people/current" }] },
            blog: { authors: [{ name: "Blog Writer", id: "blog" }], items: [{ title: "Blog story", url: "/blog-story" }] },
            "linked-stories": { authors: [{ name: "Linked Writer", id: "linked" }] },
            posts: { nodes: [{ title: "Node story", permalink: "/node-story", date: "2024-03-04" }] },
            stories: { edges: [{ node: { title: "Edge story", permalink: "/edge-story", publishedAt: "2024-05-06" } }] },
          }
        }
      }
    };
    const result = extract(script("__NEXT_DATA__", JSON.stringify(payload)));
    expect(result.authors.map(({ profile }) => profile.name)).toContain("Current Writer");
    expect(result.authors.some(({ profile }) => ["Blog Writer", "Linked Writer"].includes(profile.name ?? ""))).toBe(false);
    expect(result.authors.find(({ profile }) => profile.name === "Current Writer")?.evidence.name?.scope).toBe("byline");
    expect(result.articles.map(({ article }) => article.title)).toEqual(expect.arrayContaining(["Blog story", "Node story", "Edge story"]));
    expect(result.articles.find(({ article }) => article.title === "Node story")?.fieldPaths?.url).toContain("posts.nodes[0].permalink");
    expect(result.articles.find(({ article }) => article.title === "Edge story")?.fieldPaths?.publishedAt).toContain("stories.edges[0].node.publishedAt");
  });

  test("binds only typed author resources to profile routes and preserves nested evidence paths", () => {
    const payload = {
      props: {
        pageProps: {
          hydration: {
            responses: [{
              data: {
                node: {
                  __typename: "AuthorProfileResourceType", fullName: "Resource Writer", title: "Senior Correspondent",
                  shortBio: [{ plaintext: "Resource bio" }],
                  profileImage: { thumbnails: { square: { url: "/portrait.jpg" } } },
                  socialLinks: { email: "writer@example.com", bluesky: "https://bsky.app/profile/writer.example", instagram: "https://instagram.com/writer" },
                }
              }
            }]
          }, unrelated: { __typename: "OtherResourceType", fullName: "Resource Writer", socialLinks: { twitter: "https://x.com/unrelated" } }
        }
      }
    };
    const result = extract(script("__NEXT_DATA__", JSON.stringify(payload)));
    const writer = result.authors.find(({ profile }) => profile.name === "Resource Writer");
    expect(writer?.profile).toMatchObject({
      name: "Resource Writer", designation: "Senior Correspondent", bio: "Resource bio",
      avatarUrl: "https://publisher.example/portrait.jpg", email: "writer@example.com",
    });
    expect(writer?.identity).toBe("https://publisher.example/authors/one");
    expect(writer?.evidence.bio?.sourcePath).toContain(".shortBio");
    expect(writer?.evidence.avatarUrl?.sourcePath).toContain(".profileImage.thumbnails.square.url");
    expect(writer?.evidence.email?.sourcePath).toContain(".socialLinks.email");
    expect(writer?.socialEvidence?.map(({ sourcePath }) => sourcePath)).toEqual(
      expect.arrayContaining([expect.stringContaining(".socialLinks.bluesky")]),
    );
    expect(result.authors.filter(({ profile }) => profile.name === "Resource Writer")).toHaveLength(1);
  });
  test("revisits shared Flight authors under page-eligible ancestry after a collection visit", () => {
    const flight = `0:{"article":"$1","blog":"$2"}\n1:{"authors":["$3"]}\n2:{"authors":["$3"]}\n3:{"name":"Shared Writer","id":"shared"}`;
    const result = extract(`<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script>`);
    const shared = result.authors.find(({ profile }) => profile.name === "Shared Writer");
    expect(shared?.primary).toBe(true);
    expect(shared?.evidence.name?.scope).toBe("byline");
  });

  test("uses a profile's exact email bio but withholds conflicting unbound contact values", () => {
    const html = script("__NEXT_DATA__", JSON.stringify({
      props: {
        pageProps: {
          author: { name: "Bio Email Writer", profileUrl: "/people/bio", bio: "bio@example.com" },
          contributor: { name: "Conflicting Writer", email: "first@example.com", socialLinks: { email: "second@example.com" } },
        }
      }
    }));
    const result = extract(html);
    const bioWriter = result.authors.find(({ profile }) => profile.name === "Bio Email Writer");
    expect(bioWriter?.profile.email).toBe("bio@example.com");
    expect(bioWriter?.evidence.email?.sourcePath).toContain(".bio");
    const conflicting = result.authors.find(({ profile }) => profile.name === "Conflicting Writer");
    expect(conflicting?.profile.email).toBeUndefined();
    expect(result.authors.some(({ profile }) => profile.name === "Conflicting Writer" && profile.email)).toBe(false);
    expect(result.authors.find(({ profile }) => profile.name === "Conflicting Writer")?.identity).toBeUndefined();
    expect(result.authors).toHaveLength(2);
    // Contact values are not included in the diagnostic.
    const { document } = parseHTML(html);
    const context = createPageContext(document, html, "https://publisher.example/authors/one", DEFAULT_LIMITS);
    extractHydrationData(context);
    expect(context.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: expect.stringContaining(".email"), message: "Conflicting values for author.email; left missing" }),
      expect.objectContaining({ sourcePath: expect.stringContaining(".socialLinks.email"), message: "Conflicting values for author.email; left missing" }),
    ]));
  });

  test("accepts a resolved-interface author resource marker", () => {
    const payload = { author: { __isResolvedResourceInterface: "AuthorProfileResourceType", fullName: "Resolved Writer", url: "/authors/resolved" } };
    const result = extract(script("__NEXT_DATA__", JSON.stringify({ props: { pageProps: payload } })));
    expect(result.authors.find(({ profile }) => profile.name === "Resolved Writer")).toMatchObject({
      primary: false, identity: "https://publisher.example/authors/resolved",
    });
  });
});
