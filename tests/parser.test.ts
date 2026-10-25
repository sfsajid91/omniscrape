import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src";

const page = "https://publisher.example/authors/alice";
const next = (data: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: data } })}</script>`;
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

function profile(name: string, extra: Record<string, unknown> = {}) {
  return { "@type": "ProfilePage", mainEntity: { "@type": "Person", name, ...extra } };
}

describe("identity-safe public parser", () => {
  test("does not attach an unrelated Person's names or contacts to the hydration author", () => {
    const result = parseHtml(next({ author: { name: "Alice Reporter", id: 7 } }) + ld({ "@type": "Person", name: "Bob Editor", givenName: "Bob", familyName: "Editor", email: "bob@example.org", sameAs: ["https://linkedin.com/in/bob"] }), page);
    expect(result.author).toMatchObject({ name: "Alice Reporter", id: 7, socials: [] });
    expect(result.author.email).toBeUndefined();
    expect(result.author.givenName).toBeUndefined();
    expect(result.author.familyName).toBeUndefined();
    expect(result.review.some(({ author }) => author.name === "Bob Editor" && author.email === "bob@example.org")).toBe(true);
  });

  test("merges fields only when explicit identities agree and retains each source of duplicate socials", () => {
    const result = parseHtml(next({ author: { name: "Alice Reporter", url: page, id: 7, slug: "alice", twitter: "https://x.com/alice", role: "Reporter" } }) + ld(profile("Alice Reporter", { url: page, description: "Alice covers finance and economic policy.", email: "alice@example.org", sameAs: ["https://x.com/alice"] })), page);
    expect(result.author).toMatchObject({ name: "Alice Reporter", id: 7, slug: "alice", designation: "Reporter", email: "alice@example.org", bio: "Alice covers finance and economic policy." });
    expect(result.author.socials).toContainEqual(expect.objectContaining({ platform: "twitter", url: "https://x.com/alice", handle: "alice", isPersonal: true }));
    const evidence = result.provenance.filter(({ field, value }) => field === "author.socials" && value === "https://x.com/alice");
    expect(new Set(evidence.map(({ source }) => source))).toEqual(new Set(["hydration:next-pages", "json-ld"]));
    expect(evidence.every(({ sourceUrl, sourcePath, entity }) => sourceUrl === page && !!sourcePath && entity === page)).toBe(true);
    expect(result.provenance.some(({ field, sourcePath }) => field === "author.slug" && sourcePath.endsWith(".slug"))).toBe(true);
  });

  test("does not merge people by equal display name", () => {
    const result = parseHtml(next({ author: { name: "Alex Smith", url: "https://publisher.example/people/alex-1", email: "first@example.org" }, profile: { name: "Alex Smith", url: "https://publisher.example/people/alex-2", email: "second@example.org" } }), page);
    expect(result.author).toEqual({ name: "Unknown Author", socials: [] });
    expect(result.review.map(({ author }) => author.email).sort()).toEqual(["first@example.org", "second@example.org"]);
  });

  test("leaves multiple explicit article authors in review instead of choosing the first", () => {
    const result = parseHtml(ld({ "@type": "NewsArticle", headline: "A local investigation", author: [{ "@type": "Person", name: "Alice Reporter" }, { "@type": "Person", name: "Bob Editor" }] }), "https://publisher.example/story");
    expect(result.author).toEqual({ name: "Unknown Author", socials: [] });
    expect(result.review.map(({ author }) => author.name).sort()).toEqual(["Alice Reporter", "Bob Editor"]);
    expect(result.review.every(({ reason }) => reason === "ambiguous_identity")).toBe(true);
  });

  test("withholds conflicting values even when an explicit identity matches", () => {
    const result = parseHtml(next({ author: { name: "Alice Reporter", url: page, email: "one@example.org" } }) + ld(profile("Alice Reporter", { url: page, email: "two@example.org" })), page);
    expect(result.author.name).toBe("Alice Reporter");
    expect(result.author.email).toBeUndefined();
    expect(result.provenance.some(({ field }) => field === "author.email")).toBe(false);
    expect(result.review.filter(({ reason }) => reason === "conflicting_value").map(({ author }) => author.email).sort()).toEqual(["one@example.org", "two@example.org"]);
  });

  test("does not transform article metadata or footer contacts into a person", () => {
    const result = parseHtml(`<html><head><meta name="description" content="An investigation into economic policy"><meta property="og:image" content="/chart.jpg"></head><body><h1>Markets tumble after rate decision</h1><footer><a href="mailto:bob@example.org">Site administrator</a><a href="https://x.com/newsroomteam">Newsroom</a></footer></body></html>`, page);
    expect(result.author).toEqual({ name: "Unknown Author", socials: [] });
    expect(result.metadata.description).toBe("An investigation into economic policy");
    expect(result.metadata.ogImage).toBe("https://publisher.example/chart.jpg");
  });

  test("uses explicit meta author without borrowing page metadata as their bio/avatar", () => {
    const result = parseHtml(`<html><head><meta name="author" content="Alice Reporter"><meta name="description" content="The story summary"><meta property="og:image" content="/chart.jpg"></head><body><h1>A news headline</h1></body></html>`, page);
    expect(result.author).toEqual({ name: "Alice Reporter", socials: [] });
    expect(result.provenance.find(({ field }) => field === "author.name")).toMatchObject({ sourcePath: "meta[0]@content", scope: "byline" });
  });

  test("combines complementary article sources and retains duplicate-source URL evidence", () => {
    const html = next({ author: { name: "Alice Reporter" }, articles: [{ title: "First investigation", url: "/first" }] }) + ld({ "@type": "ItemList", itemListElement: [{ item: { "@type": "NewsArticle", headline: "First investigation", url: "/first" } }, { item: { "@type": "NewsArticle", headline: "Second investigation", url: "/second" } }] }) + `<article><h2><a href="/third">Third investigation report</a></h2></article>`;
    const result = parseHtml(html, page);
    expect(result.articles.map(({ url }) => url)).toEqual(["https://publisher.example/first", "https://publisher.example/second", "https://publisher.example/third"]);
    const evidence = result.provenance.filter(({ field, value }) => field === "articles[0].url" && value === "https://publisher.example/first");
    expect(new Set(evidence.map(({ source }) => source))).toEqual(new Set(["hydration:next-pages", "json-ld"]));
    expect(evidence.every(({ sourcePath }) => sourcePath.endsWith(".url"))).toBe(true);
  });

  test("continues after an empty hydration source and exposes invalid source issues", () => {
    const result = parseHtml(`<script id="__NEXT_DATA__">{}</script><script id="__NUXT_DATA__">{bad</script><script>window.__INITIAL_STATE__={author:{name:"Alice Reporter"}};</script>`, page);
    expect(result.author.name).toBe("Alice Reporter");
    expect(result.issues.some(({ sourcePath }) => sourcePath === "script[1]")).toBe(true);
  });

  test("keeps owner and assignee evidence separate from byline identity", () => {
    const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { author: { name: "A Reporter", id: 1 }, authorCollection: { items: [{ story: { headline: "Story", slug: "/story", "owner-name": "Editorial Owner", "owner-id": 2, "assignee-name": "Desk Assignee", "assignee-id": 3 } }] } } } })}</script>`, page);
    expect(result.author.name).toBe("A Reporter");
    expect(result.editorial).toMatchObject({ ownerName: "Editorial Owner", ownerId: 2, assigneeName: "Desk Assignee", assigneeId: 3 });
    expect(result.provenance.find(({ field }) => field === "editorial.ownerId")?.sourcePath).toContain("owner-id");
  });

  test("does not lend contacts across people nested in a byline container", () => {
    const result = parseHtml(`<div class="byline" itemprop="author"><section itemscope itemtype="https://schema.org/Person"><span itemprop="name">Alice Reporter</span><a href="mailto:alice@example.org">Email Alice</a></section><section itemscope itemtype="https://schema.org/Person"><span itemprop="name">Bob Editor</span><a href="mailto:bob@example.org">Email Bob</a></section></div>`, "https://publisher.example/story");
    expect(result.author).toEqual({ name: "Unknown Author", socials: [] });
    expect(result.review.some(({ author }) => author.name === "Alice Reporter" && author.email === "bob@example.org")).toBe(false);
    expect(result.review.some(({ author }) => author.name === "Bob Editor" && author.email === "alice@example.org")).toBe(false);
    expect(result.review.map(({ author }) => author.name).sort()).toEqual(["Alice Reporter", "Bob Editor"]);
  });

  test("withholds conflicting values across fragments of the same JSON-LD identity", () => {
    const result = parseHtml(ld({ "@type": "ProfilePage", mainEntity: { "@id": "#person" } }) + ld({ "@id": "#person", "@type": "Person", name: "Alice Reporter", email: "one@example.org" }) + ld({ "@id": "#person", email: "two@example.org" }), page);
    expect(result.author.name).toBe("Alice Reporter");
    expect(result.author.email).toBeUndefined();
    expect(new Set(result.review.filter(({ reason }) => reason === "conflicting_value").map(({ author }) => author.email))).toEqual(new Set(["one@example.org", "two@example.org"]));
  });

  test("preserves a full CMS author collection beyond the DOM fallback cap", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({ story: { headline: `Investigation ${index}`, slug: `/stories/${index}` } }));
    const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { author: { name: "Alice Reporter" }, authorCollection: { items } } } })}</script>`, page);
    expect(result.articles.map(({ url }) => url)).toEqual(items.map(({ story }) => `https://publisher.example${story.slug}`));
  });

  test("correlates a CMS slug with a profile URL instead of leaving the author ambiguous", () => {
    const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { author: { id: 2345930, slug: "a-ahmed", name: "A Ahmed" } } } })}</script>` +
      ld({ "@type": "ProfilePage", mainEntity: { "@type": "Person", name: "A Ahmed", url: "https://publisher.example/author/a-ahmed" } }), "https://publisher.example/author/a-ahmed");
    expect(result.author).toMatchObject({ name: "A Ahmed", id: 2345930, slug: "a-ahmed" });
    expect(result.review).toEqual([]);
  });

  test("does not report a same-name unanchored byline as a different person", () => {
    const result = parseHtml(`<meta name="author" content="Alice Reporter"><div class="byline"><a rel="author" href="/author/alice">Alice Reporter</a></div>`, "https://publisher.example/story");
    expect(result.author.name).toBe("Alice Reporter");
    expect(result.review).toEqual([]);
  });
  test("groups repeated identical review profiles while preserving every provenance path", () => {
    const result = parseHtml(next({
      comments: [
        { author: { name: "Avery Writer", url: "https://publisher.example/author/avery" } },
        { author: { name: "Avery Writer", url: "https://publisher.example/author/avery" } },
      ]
    }), "https://publisher.example/story");
    const matching = result.review.filter(({ author }) => author.name === "Avery Writer");
    expect(matching).toHaveLength(1);
    expect(matching[0]?.provenance.filter(({ field }) => field === "author.name")).toHaveLength(2);
    expect(new Set(matching[0]?.provenance.filter(({ field }) => field === "author.name").map(({ sourcePath }) => sourcePath)).size).toBe(2);
  });

  test("does not turn a profile URL in article:author into a display name", () => {
    const result = parseHtml(`<meta property="article:author" content="https://facebook.com/alice">`, "https://publisher.example/story");
    expect(result.author).toEqual({ name: "Unknown Author", socials: [] });
    expect(result.provenance.some(({ field }) => field === "author.name")).toBe(false);
  });
  test("keeps a scoped profile target while suppressing hundreds of repeated card bylines", () => {
    const cards = Array.from({ length: 300 }, (_, index) =>
      `<article><span class="article--post__author-name"><a href="/author/vitaly">Vitaly Friedman</a> <em>wrote</em></span><h2><a href="/story/${index}">A sufficiently descriptive story headline number ${index}</a></h2></article>`).join("");
    const result = parseHtml(`<main><header class="author-page__header"><img class="bio-image-image" src="/vitaly.jpg"><h1><span class="author__title-desc">Author</span> Vitaly Friedman</h1><div class="header-description"><p>Vitaly Friedman writes about design systems and interface patterns for publishers.</p></div><a href="https://x.com/vitalyf">Twitter</a></header>${cards}</main>`, "https://publisher.example/author/vitaly");
    expect(result.author.name).toBe("Vitaly Friedman");
    expect(result.author.bio).toContain("design systems");
    expect(result.author.avatarUrl).toBe("https://publisher.example/vitaly.jpg");
    expect(result.author.socials).toContainEqual(expect.objectContaining({ platform: "twitter", handle: "vitalyf" }));
    expect(result.review).toEqual([]);
    expect(result.articles).toHaveLength(20);
  });

  test("prefers precise publication metadata over visible date-only evidence", () => {
    const html = `<html><head><meta property="article:published_time" content="2024-12-05T00:00:00.507Z"></head><body><main><article><div><h1>React 19</h1></div><p>December 05, 2024 by <a href="/team">The React Team</a></p></article></main></body></html>`;
    const result = parseHtml(html, "https://publisher.example/blog/react-19");
    expect(result.metadata.publishedTime).toBe("2024-12-05T00:00:00.507Z");
    expect(result.provenance.filter(({ field }) => field === "metadata.publishedTime").map(({ value, confidence }) => ({ value, confidence }))).toEqual([
      { value: "2024-12-05T00:00:00.507Z", confidence: "high" },
    ]);
  });
});

describe("parser resource boundaries", () => {
  test("limits HTML by UTF-8 bytes and rejects invalid resource limits", () => {
    expect(() => parseHtml("ééé", page, { maxHtmlBytes: 5 })).toThrow("maxHtmlBytes");
    expect(() => parseHtml("", page, { maxDecodeDepth: 0 })).toThrow("maxDecodeDepth");
    expect(() => parseHtml("", "javascript:alert(1)")).toThrow("HTTP(S)");
  });

  test("skips an oversized script but preserves later valid evidence", () => {
    const result = parseHtml(next({ author: { name: "Ignored", bio: "x".repeat(500) } }) + `<meta name="author" content="Alice Reporter">`, page, { maxScriptBytes: 100 });
    expect(result.author.name).toBe("Alice Reporter");
    expect(result.issues).toContainEqual({ sourcePath: "script[0]", message: "Script exceeds maxScriptBytes" });
    expect(result.rawHydration).toBeUndefined();
  });
});
