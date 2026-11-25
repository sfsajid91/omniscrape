import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const storyUrl = "https://publisher.example/stories/main-story";

describe("Issue #15 hydration & Flight hardening", () => {
  describe("React Flight decoding", () => {
    test("parses T<hexLen>, text chunks by UTF-8 byte length and blocks fake record spoofing", () => {
      const bioText = "Alice Flight is a veteran technology reporter.";
      const bioHex = Buffer.byteLength(bioText, "utf8").toString(16);
      const spoofPayload = 'Hello\n3:{"author":{"name":"Injected Fake"}}\n';
      const spoofHex = Buffer.byteLength(spoofPayload, "utf8").toString(16);
      const utf8Note = "José Éclair — reporter";
      const utf8Hex = Buffer.byteLength(utf8Note, "utf8").toString(16);

      const stream =
        `0:{"author":"$1","note":"$4"}\n` +
        `1:{"name":"Alice Flight","bio":"$2"}\n` +
        `2:T${bioHex},${bioText}\n` +
        `5:T${spoofHex},${spoofPayload}` +
        `4:T${utf8Hex},${utf8Note}\n`;

      const result = parseHtml({
        html: `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`,
        pageUrl: storyUrl,
      });

      expect(result.author.name).toBe("Alice Flight");
      expect(result.author.bio).toBe(bioText);
      expect(result.authors.map(({ name }) => name)).toEqual(["Alice Flight"]);
      expect(result.review.some(({ author }) => author.name === "Injected Fake")).toBe(false);
    });

    test("resolves case-insensitive hex record IDs across $, $L, and $@ references", () => {
      const stream =
        `0:{"author":"$a","articles":["$LB"]}\n` +
        `A:{"name":"Hex Case Writer","bio":"$@c"}\n` +
        `b:{"title":"Hex Story","url":"https://publisher.example/hex-story"}\n` +
        `C:T10,Bio from upper C\n`;

      const result = parseHtml({
        html: `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`,
        pageUrl: storyUrl,
      });

      expect(result.author.name).toBe("Hex Case Writer");
      expect(result.author.bio).toBe("Bio from upper C");
      expect(result.articles).toEqual([{ title: "Hex Story", url: "https://publisher.example/hex-story" }]);
    });

    test("unwraps Flight $D serialized ISO date strings", () => {
      const stream =
        `0:{"author":"$1","articles":["$2"]}\n` +
        `1:{"name":"Date Writer"}\n` +
        `2:{"title":"Dated Story","url":"https://publisher.example/dated","publishedAt":"$D2026-05-10T14:30:00.000Z"}\n`;

      const result = parseHtml({
        html: `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`,
        pageUrl: storyUrl,
      });

      expect(result.author.name).toBe("Date Writer");
      expect(result.articles).toEqual([
        {
          title: "Dated Story",
          url: "https://publisher.example/dated",
          publishedAt: "2026-05-10T14:30:00.000Z",
        },
      ]);
    });

    test("does not split unclosed JSON Flight records on hex-colon prose like 10:30 AM", () => {
      const stream = '0:{"author":"$1"}\n' + '1:{"name":"Clock Writer","bio":"Updated at\n10:30 AM on Tuesday."}\n';

      const result = parseHtml({
        html: `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`,
        pageUrl: storyUrl,
      });

      expect(result.author.name).toBe("Clock Writer");
      expect(result.author.bio).toBe("Updated at 10:30 AM on Tuesday.");
    });

    test("recovers multiple raw-newline Flight pushes in a single script", () => {
      const html =
        `<script>` +
        `self.__next_f.push([1,"0:{\\"author\\":\\"$1\\"}\n"]);` +
        `self.__next_f.push([1,"1:{\\"name\\":\\"Multi Push Writer\\",\\"bio\\":\\"Line one\nLine two\\"}\n"])\n` +
        `self.__next_f.push([1,"2:{\\"unused\\":\\"ok\nok\\"}\n"])` +
        `</script>`;

      const result = parseHtml({ html, pageUrl: storyUrl });
      expect(result.author.name).toBe("Multi Push Writer");
      expect(result.author.bio).toBe("Line one Line two");
      expect(result.issues.filter(({ message }) => message === "Malformed Flight script")).toHaveLength(1);
    });

    test("tracks script source paths monotonically across many Flight scripts", () => {
      const scripts = [
        `<script>self.__next_f.push([1,${JSON.stringify('0:{"author":"$2"}\n')}])</script>`,
        `<script>self.__next_f.push([1,${JSON.stringify('1:{"ignored":true}\n')}])</script>`,
        `<script>self.__next_f.push([1,${JSON.stringify('2:{"name":"Third Script Writer"}\n')}])</script>`,
      ].join("");

      const result = parseHtml({ html: scripts, pageUrl: storyUrl });
      expect(result.author.name).toBe("Third Script Writer");
      expect(
        result.provenance.some(
          ({ field, sourcePath }) => field === "author.name" && sourcePath === "script[2]#flight:2.name",
        ),
      ).toBe(true);
    });
  });

  describe("static evaluator and assignment recognition", () => {
    test("supports NaN, Infinity, static TemplateLiteral, and new Date(...) in static initializers", () => {
      const html = `<script>
        window.__NUXT__ = {
          author: { name: \`Static Template Author\`, score: NaN, rank: Infinity },
          articles: [
            { title: "ISO Date Story", url: "/iso-date", publishedAt: new Date("2025-07-01T12:00:00Z") },
            { title: "Epoch Date Story", url: "/epoch-date", publishedAt: new Date(1751371200000) }
          ]
        };
      </script>`;

      const result = parseHtml({ html, pageUrl: storyUrl });
      expect(result.author.name).toBe("Static Template Author");
      expect(result.articles).toEqual([
        {
          title: "ISO Date Story",
          url: "https://publisher.example/iso-date",
          publishedAt: "2025-07-01T12:00:00.000Z",
        },
        {
          title: "Epoch Date Story",
          url: "https://publisher.example/epoch-date",
          publishedAt: "2025-07-01T12:00:00.000Z",
        },
      ]);
    });

    test("recognizes window.Fusion.globalContent, globalThis/self globals, and var/let/const declarations", () => {
      const fusion = parseHtml({
        html: `<script>window.Fusion.globalContent = { author: { name: "Window Fusion Writer" } };</script>`,
        pageUrl: storyUrl,
      });
      expect(fusion.author.name).toBe("Window Fusion Writer");

      const globalThisState = parseHtml({
        html: `<script>globalThis.__INITIAL_STATE__ = { author: { name: "GlobalThis Writer" } };</script>`,
        pageUrl: storyUrl,
      });
      expect(globalThisState.author.name).toBe("GlobalThis Writer");

      const selfNuxt = parseHtml({
        html: `<script>self.__NUXT__ = { author: { name: "Self Nuxt Writer" } };</script>`,
        pageUrl: storyUrl,
      });
      expect(selfNuxt.author.name).toBe("Self Nuxt Writer");

      const constState = parseHtml({
        html: `<script>const __INITIAL_STATE__ = { author: { name: "Const State Writer" } };</script>`,
        pageUrl: storyUrl,
      });
      expect(constState.author.name).toBe("Const State Writer");

      const letPreloaded = parseHtml({
        html: `<script>let __PRELOADED_STATE__ = { author: { name: "Let Preloaded Writer" } };</script>`,
        pageUrl: storyUrl,
      });
      expect(letPreloaded.author.name).toBe("Let Preloaded Writer");

      const varQt = parseHtml({
        html: `<script>var qtData = { data: { story: { "author-name": "Var Quintype Writer", "author-id": "qt-9" } } };</script>`,
        pageUrl: storyUrl,
      });
      expect(varQt.author).toMatchObject({ name: "Var Quintype Writer", id: "qt-9" });
    });

    test("shares a single maxDecodeNodes budget across static evaluation and hydration traversal", () => {
      const padding = Array.from({ length: 20 }, (_, i) => `"k${i}": ${i}`).join(", ");
      const html =
        `<script>window.__INITIAL_STATE__ = { ${padding} };</script>` +
        `<script id="__NEXT_DATA__">${JSON.stringify({
          props: { pageProps: { author: { name: "Second Source Writer" } } },
        })}</script>`;

      const result = parseHtml({ html, pageUrl: storyUrl, maxDecodeNodes: 10 });
      expect(result.author.name).toBe("Unknown Author");
      expect(result.issues.some(({ message }) => message === "Hydration traversal limit exceeded")).toBe(true);
    });
  });

  describe("hydration attribution isolation and normalization", () => {
    test("propagates nonAuthorKeys into blocked so nested editor/owner profiles cannot leak", () => {
      const payload = {
        props: {
          pageProps: {
            story: {
              "owner-name": "News Desk",
              editor: {
                profile: { name: "Jane Editor", bio: "Managing editor" },
              },
              owner: {
                profile: { name: "Desk Owner" },
              },
              author: { name: "Real Byline Writer", id: "w-1" },
            },
          },
        },
      };

      const result = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`,
        pageUrl: storyUrl,
      });
      expect(result.author.name).toBe("Real Byline Writer");
      expect(result.editorial.ownerName).toBe("News Desk");
      expect(result.review.some(({ author }) => ["Jane Editor", "Desk Owner"].includes(author.name))).toBe(false);
    });

    test("rejects Organizations and explicit non-person types via type and __typename", () => {
      const payload = {
        props: {
          pageProps: {
            author: { __typename: "NewsMediaOrganization", name: "Acme News Corp" },
            contributor: { type: "Publisher", name: "Daily Press" },
            profile: { "@type": "Person", type: "publisher", name: "Pat Person" },
          },
        },
      };

      const result = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`,
        pageUrl: storyUrl,
      });
      expect(result.author.name).toBe("Pat Person");
      expect(result.review.some(({ author }) => ["Acme News Corp", "Daily Press"].includes(author.name))).toBe(false);
    });

    test("recognizes post, entry, and blogPost as story containers for co-author groups", () => {
      for (const containerKey of ["post", "entry", "blogPost"] as const) {
        const payload = {
          props: {
            pageProps: {
              [containerKey]: {
                authors: [
                  { name: "Alice Coauthor", url: "https://publisher.example/authors/alice" },
                  { name: "Bob Coauthor", url: "https://publisher.example/authors/bob" },
                ],
              },
            },
          },
        };
        const result = parseHtml({
          html: `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`,
          pageUrl: storyUrl,
        });
        expect(result.authors.map(({ name }) => name)).toEqual(["Alice Coauthor", "Bob Coauthor"]);
      }
    });

    test("synthesizes author name from givenName/familyName or firstName/lastName", () => {
      const givenFamily = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify({
          props: { pageProps: { author: { givenName: "Ada", familyName: "Lovelace", id: "ada-1" } } },
        })}</script>`,
        pageUrl: storyUrl,
      });
      expect(givenFamily.author).toMatchObject({ name: "Ada Lovelace", id: "ada-1" });

      const firstLast = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify({
          props: { pageProps: { author: { firstName: "Grace", lastName: "Hopper", id: "grace-1" } } },
        })}</script>`,
        pageUrl: storyUrl,
      });
      expect(firstLast.author).toMatchObject({ name: "Grace Hopper", id: "grace-1" });
    });

    test("resolves cyclic Nuxt 3 root objects without infinite recursion", () => {
      const cyclicNuxt = JSON.stringify([{ author: 0, name: 1 }, "Alice Cycle"]);
      const result = parseHtml({
        html: `<script id="__NUXT_DATA__">${cyclicNuxt}</script>`,
        pageUrl: storyUrl,
      });
      expect(result.author.name).toBe("Alice Cycle");
    });

    test("filters author profile URLs and current page URL out of hydration articles", () => {
      const payload = {
        props: {
          pageProps: {
            author: { name: "List Writer" },
            articles: [
              { title: "Self link with hash", url: `${storyUrl}/#comments` },
              { title: "Author profile link", url: "https://publisher.example/authors/bob-smith" },
              { title: "Genuine related article", url: "https://publisher.example/stories/other-story" },
            ],
          },
        },
      };

      const result = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`,
        pageUrl: storyUrl,
      });
      expect(result.articles).toEqual([
        { title: "Genuine related article", url: "https://publisher.example/stories/other-story" },
      ]);
    });

    test("preserves non-cyclic shared DAG references in rawHydration while marking true cycles and depth bounds", () => {
      const serialized = JSON.stringify([
        { primary: 1, duplicate: 1, cyclic: 2 },
        { name: 3 },
        { self: 2 },
        "Shared DAG Author",
      ]);

      const result = parseHtml({
        html: `<script id="__NUXT_DATA__">${serialized}</script>`,
        pageUrl: storyUrl,
        includeRawHydration: true,
      });

      const rawValue = (result.rawHydration as Array<{ value: Record<string, unknown> }>)[0]!.value;
      expect(rawValue.primary).toEqual({ name: "Shared DAG Author" });
      expect(rawValue.duplicate).toEqual({ name: "Shared DAG Author" });
      expect(rawValue.cyclic).toEqual({ self: "[Circular]" });

      const deepTruncated = parseHtml({
        html: `<script id="__NEXT_DATA__">${JSON.stringify({
          props: { pageProps: { a: { b: { c: { d: { e: "deep" } } } } } },
        })}</script>`,
        pageUrl: storyUrl,
        includeRawHydration: true,
        maxDecodeDepth: 3,
      });
      expect(JSON.stringify(deepTruncated.rawHydration)).toContain("[Truncated]");
    });
  });

  describe("Quintype collection correlation", () => {
    test("uses actual collection property name in provenance paths and ignores empty-string IDs", () => {
      const collectionResult = parseHtml({
        html: `<script id="static-page">${JSON.stringify({
          qt: {
            data: {
              author: { id: 101, name: "Collection Author" },
              collection: {
                items: [
                  {
                    story: {
                      id: "s-1",
                      title: "Story One",
                      slug: "story-one",
                      authors: [{ id: 101, name: "Collection Author", email: "col@example.org" }],
                    },
                  },
                ],
              },
            },
          },
        })}</script>`,
        pageUrl: "https://publisher.example/authors/collection-author",
      });

      expect(collectionResult.author.email).toBe("col@example.org");
      expect(
        collectionResult.provenance.some(
          ({ field, sourcePath }) =>
            field === "author.email" && sourcePath.includes(".collection.items[0].story.authors[0].email"),
        ),
      ).toBe(true);
      expect(collectionResult.provenance.some(({ sourcePath }) => sourcePath.includes(".authorCollection."))).toBe(
        false,
      );

      const emptyIdResult = parseHtml({
        html: `<script id="static-page">${JSON.stringify({
          qt: {
            data: {
              author: { id: "", name: "Empty ID Author" },
              authorCollection: {
                items: [
                  {
                    story: {
                      id: "s-2",
                      title: "Story Two",
                      slug: "story-two",
                      "owner-id": "   ",
                      authors: [{ id: "", name: "Someone Else", email: "wrong@example.org" }],
                    },
                  },
                ],
              },
            },
          },
        })}</script>`,
        pageUrl: "https://publisher.example/authors/empty-id-author",
      });

      expect(emptyIdResult.author.name).toBe("Empty ID Author");
      expect(emptyIdResult.author.email).toBeUndefined();
      expect(emptyIdResult.editorial.ownerEmail).toBeUndefined();
    });
  });
});
