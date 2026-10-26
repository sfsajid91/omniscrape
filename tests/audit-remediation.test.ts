import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/parse";
import { decodeEntities, isAuthorProfileUrl, socialLink } from "../src/values";

describe("audit remediation suites", () => {
  test("Finding 1: Merges DOM byline designation and email when anchor has JSON-LD ID", () => {
    const html = `
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","author":{"@type":"Person","@id":"https://example.com/author/john","name":"John Doe"}}</script>
      <div class="byline"><span class="author-name">John Doe</span><span class="designation">Senior Editor</span><a href="mailto:john@example.com">email</a></div>
    `;
    const result = parseHtml({ html, pageUrl: "https://example.com/story" });
    expect(result.author.name).toBe("John Doe");
    expect(result.author.designation).toBe("Senior Editor");
    expect(result.author.email).toBe("john@example.com");
  });

  test("Finding 2: Strips child email links without polluting byline name", () => {
    const html = `<div class="byline">By Alice Smith <a href="mailto:alice@example.com">Email Alice</a></div>`;
    const result = parseHtml({ html, pageUrl: "https://example.com/story" });
    expect(result.author.name).toBe("Alice Smith");
  });

  test("Finding 3: Splits compound byline with conjunction", () => {
    const html = `<div class="byline">By John Doe and Jane Smith</div>`;
    const result = parseHtml({ html, pageUrl: "https://example.com/story" });
    expect(result.authors.map((a) => a.name)).toEqual(["John Doe", "Jane Smith"]);
  });

  test("Finding 4: Rejects prose paragraph starting with By without byline classes", () => {
    const html = `<main><p>By partnering with <a href="https://vendor.example/">Vendor Company</a>, we improved sales.</p></main>`;
    const result = parseHtml({ html, pageUrl: "https://example.com/story" });
    expect(result.author.name).toBe("Unknown Author");
  });

  test("Finding 5: Unrelated Person does not override explicit Article.author", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","url":"https://pub.example/story","author":{"@type":"Person","name":"Actual Writer","url":"/author/actual"}},{"@type":"Person","name":"Wrong Person","url":"https://pub.example/story","email":"wrong@example.org"}]}</script>`;
    const result = parseHtml({ html, pageUrl: "https://pub.example/story" });
    expect(result.author.name).toBe("Actual Writer");
  });

  test("Finding 6: Collects multiple byline emails into emails array", () => {
    const html = `<div class="author-profile"><h1>Alice Reporter</h1><a href="mailto:alice@work.org">Work</a><a href="mailto:alice@personal.org">Personal</a></div>`;
    const result = parseHtml({ html, pageUrl: "https://example.com/author/alice" });
    expect(result.author.emails).toEqual(["alice@work.org", "alice@personal.org"]);
    expect(result.author.email).toBe("alice@work.org");
  });

  test("Finding 7: Recognizes modern and paginated author profile routes", () => {
    expect(isAuthorProfileUrl("https://example.com/by/jane")).toBe(true);
    expect(isAuthorProfileUrl("https://example.com/@jane")).toBe(true);
    expect(isAuthorProfileUrl("https://example.com/author/jane/page/2")).toBe(true);
  });

  test("Finding 8 & 9: Extracts short headline and h1 article anchor", () => {
    const html = `<article><h1><a href="/news/short">Oil Dips</a></h1></article>`;
    const result = parseHtml({ html, pageUrl: "https://example.com/news" });
    expect(result.articles[0]).toMatchObject({ title: "Oil Dips", url: "https://example.com/news/short" });
  });

  test("Finding 10: Tech detector avoids prose false positives", () => {
    const html = `<p>I love astro-physics and she had a svelte-like figure</p>`;
    const result = parseHtml({ html, pageUrl: "https://example.com/story" });
    expect(result.techStack.framework).toBe("Unknown");
  });

  test("Finding 11: Normalizes international LinkedIn and preserves Facebook profile query ID", () => {
    const link1 = socialLink("https://uk.linkedin.com/in/alice", "https://example.com");
    expect(link1).toMatchObject({ platform: "linkedin", handle: "alice" });
    const link2 = socialLink("https://facebook.com/profile.php?id=12345", "https://example.com");
    expect(link2?.url).toContain("?id=12345");
  });

  test("Finding 12: Next.js Flight stream parses multiline template literal rows", () => {
    const html = `<script>self.__next_f.push([1, "0:{\\"author\\":{\\"name\\":\\"John Multiline\\",\\"bio\\":\\"Line 1\\nLine 2\\"}}\\n"])</script>`;
    const result = parseHtml({ html, pageUrl: "https://example.com/story" });
    expect(result.author.name).toBe("John Multiline");
  });

  test("Finding 13: Concordant timestamp drift within 60s selects higher precision without erasing", () => {
    const html = `
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","datePublished":"2026-10-25T12:00:15.000Z"}</script>
      <meta property="article:published_time" content="2026-10-25T12:00:00Z">
    `;
    const result = parseHtml({ html, pageUrl: "https://example.com/story" });
    expect(result.metadata.publishedTime).toBe("2026-10-25T12:00:15.000Z");
    expect(result.issues).toHaveLength(0);
  });

  test("Finding 14: Extracts email from surrounded bio text", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"author":{"name":"Tipster","bio":"Send tips to tips@news.com for investigation"}}}}</script>`;
    const result = parseHtml({ html, pageUrl: "https://example.com/author/tipster" });
    expect(result.author.email).toBe("tips@news.com");
  });

  test("Finding 15: Entity decoding handles numeric range boundaries safely", () => {
    expect(decodeEntities("&#99999999;")).toBe("&#99999999;");
    expect(decodeEntities("&amp;&mdash;&#8212;")).toBe("&——");
  });
});
