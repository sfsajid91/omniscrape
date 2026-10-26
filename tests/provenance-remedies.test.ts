import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { parseHtml } from "../src/parse";

const sampleHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Author Stories</title>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "mainEntity": {
      "@type": "Person",
      "name": "Jane Journalist",
      "email": "jane@news.example"
    }
  }
  </script>
</head>
<body>
  <h1>Jane Journalist</h1>
  <article><h2><a href="/story-1">Story One Headline</a></h2></article>
  <article><h2><a href="/story-2">Story Two Headline</a></h2></article>
</body>
</html>`;

describe("provenance payload optimization remedies", () => {
  test("default behavior retains full property-level article provenance and author mirror", () => {
    const result = parseHtml(sampleHtml, "https://news.example/author/jane");

    expect(result.author.name).toBe("Jane Journalist");
    expect(result.articles).toHaveLength(2);

    // Default property-level provenance
    expect(result.provenance.some((p) => p.field === "articles[0].url")).toBe(true);
    expect(result.provenance.some((p) => p.field === "articles[0].title")).toBe(true);
    expect(result.provenance.some((p) => p.field === "authors[0].name")).toBe(true);
  });

  test("includeArticleProvenance: false strips catalog articles from provenance", () => {
    const result = parseHtml({
      html: sampleHtml,
      pageUrl: "https://news.example/author/jane",
      includeArticleProvenance: false,
    });

    expect(result.articles).toHaveLength(2); // Articles catalog still extracted
    expect(result.provenance.some((p) => p.field.startsWith("articles["))).toBe(false);
    expect(result.provenance.some((p) => p.field === "author.name")).toBe(true);
  });

  test("articleProvenanceMode: 'item' consolidates article properties into a single record per article", () => {
    const result = parseHtml({
      html: sampleHtml,
      pageUrl: "https://news.example/author/jane",
      articleProvenanceMode: "item",
    });

    expect(result.articles).toHaveLength(2);
    expect(result.provenance.some((p) => p.field === "articles[0]")).toBe(true);
    expect(result.provenance.some((p) => p.field === "articles[0].title")).toBe(false);
    expect(result.provenance.some((p) => p.field === "articles[0].url")).toBe(false);
  });

  test("dedupeAuthorProvenance: true suppresses redundant authors[0] mirror records for single author", () => {
    const result = parseHtml({
      html: sampleHtml,
      pageUrl: "https://news.example/author/jane",
      dedupeAuthorProvenance: true,
    });

    expect(result.author.name).toBe("Jane Journalist");
    expect(result.authors).toHaveLength(1);
    expect(result.provenance.some((p) => p.field === "author.name")).toBe(true);
    expect(result.provenance.some((p) => p.field === "authors[0].name")).toBe(false);
  });

  test("provenanceScope: 'identity' only retains author, editorial, and metadata provenance", () => {
    const result = parseHtml({
      html: sampleHtml,
      pageUrl: "https://news.example/author/jane",
      provenanceScope: "identity",
    });

    expect(result.articles).toHaveLength(2);
    expect(result.provenance.every((p) => !p.field.startsWith("articles["))).toBe(true);
    expect(result.provenance.some((p) => p.field === "author.name")).toBe(true);
  });

  test("provenanceScope: 'none' disables provenance collection entirely", () => {
    const result = parseHtml({
      html: sampleHtml,
      pageUrl: "https://news.example/author/jane",
      provenanceScope: "none",
    });

    expect(result.author.name).toBe("Jane Journalist");
    expect(result.articles).toHaveLength(2);
    expect(result.provenance).toHaveLength(0);
  });

  test("Gulf News fixture provenance payload shrinks dramatically across remedy modes", () => {
    const fixturePath = "tests/fixtures/gulfnews-author.html";
    if (!existsSync(fixturePath)) return;
    const html = readFileSync(fixturePath, "utf-8");

    // Mode 1: Default (full property-level)
    const defaultRes = parseHtml(html, "https://gulfnews.com/author/a-ahmed");
    const defaultSize = JSON.stringify(defaultRes.provenance).length;

    // Mode 2: Item-level article mode
    const itemRes = parseHtml({
      html,
      pageUrl: "https://gulfnews.com/author/a-ahmed",
      articleProvenanceMode: "item",
    });
    const itemSize = JSON.stringify(itemRes.provenance).length;
    expect(itemRes.provenance.length).toBeLessThan(defaultRes.provenance.length);
    expect(itemSize).toBeLessThan(defaultSize * 0.6); // Slashed from 54.5 KB to 28.2 KB!

    // Mode 3: Identity-only (omit catalog feed articles)
    const identityRes = parseHtml({
      html,
      pageUrl: "https://gulfnews.com/author/a-ahmed",
      provenanceScope: "identity",
      dedupeAuthorProvenance: true,
    });
    const identitySize = JSON.stringify(identityRes.provenance).length;
    expect(identityRes.provenance.length).toBeLessThanOrEqual(20);
    expect(identitySize).toBeLessThan(7000); // Down to 5.5 KB vs 54.5 KB (90% reduction!)

    // Mode 4: None
    const noneRes = parseHtml({
      html,
      pageUrl: "https://gulfnews.com/author/a-ahmed",
      provenanceScope: "none",
    });
    expect(noneRes.provenance).toHaveLength(0);
  });
});
