import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { createPageContext, DEFAULT_LIMITS } from "../src/core/context";
import { extractJsonLd } from "../src/extractors/json-ld";

function extractScripts(values: unknown[], pageUrl = "https://example.com/current/article") {
  const source = values.map((value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`).join("");
  const { document } = parseHTML(source);
  return extractJsonLd(createPageContext(document as Document, source, pageUrl, DEFAULT_LIMITS));
}

function extract(value: unknown, pageUrl = "https://example.com/current/article") {
  return extractScripts([value], pageUrl);
}

describe("JSON-LD extraction", () => {
  test("does not choose the first unrelated Person as primary", () => {
    const result = extract([
      { "@type": "Person", name: "Unrelated" },
      { "@type": "ProfilePage", mainEntity: { "@type": "Person", name: "Target", url: "/people/target" } },
    ]);
    expect(result.authors.map((candidate) => [candidate.profile.name, candidate.primary])).toEqual([["Unrelated", false], ["Target", true]]);
    expect(result.authors[1]?.identity).toBe("https://example.com/people/target");
  });

  test("resolves @id mainEntity and cyclic references across scripts", () => {
    const source = [
      { "@type": "ProfilePage", mainEntity: { "@id": "#person" } },
      { "@id": "#person", "@type": ["https://schema.org/Person", "https://schema.org/Thing"], name: "Linked", knows: { "@id": "#person" } },
    ];
    const result = extract(source);
    expect(result.authors).toHaveLength(1);
    expect(result.authors[0]).toMatchObject({ profile: { name: "Linked" }, primary: true });
    expect(result.authors[0]?.evidence.name?.sourcePath).toContain("[1].name");
  });
  test("retains conflicting fields from same-id Person fragments with their own provenance", () => {
    const result = extractScripts([
      { "@id": "#author", "@type": "Person", name: "Same identity", email: "first@example.com" },
      { "@id": "#author", email: "second@example.com" },
    ]);
    expect(result.authors.map((candidate) => candidate.profile.email)).toEqual(["first@example.com", "second@example.com"]);
    expect(result.authors.map((candidate) => candidate.evidence.email?.sourcePath)).toEqual(["script[0].email", "script[1].email"]);
    expect(result.authors.map((candidate) => candidate.identity)).toEqual(["https://example.com/current/article#author", "https://example.com/current/article#author"]);
  });

  test("retains equal same-id values as independent provenance candidates", () => {
    const sameAs = "https://www.linkedin.com/in/shared/";
    const result = extractScripts([
      { "@id": "#author", "@type": "Person", name: "Shared", email: "same@example.com", sameAs: [sameAs] },
      { "@id": "#author", email: "same@example.com", sameAs: [sameAs] },
    ]);
    expect(result.authors).toHaveLength(2);
    expect(result.authors.map((candidate) => candidate.evidence.email?.sourcePath)).toEqual(["script[0].email", "script[1].email"]);
    expect(result.authors.map((candidate) => candidate.socialEvidence?.[0]?.sourcePath)).toEqual(["script[0].sameAs[0]", "script[1].sameAs[0]"]);
  });

  test("uses only the current article author relationship for primary attribution", () => {
    const result = extract([
      { "@type": "NewsArticle", url: "https://example.com/recommendation", author: { "@type": "Person", name: "Recommended Author" }, headline: "Recommended", datePublished: "2020-01-02" },
      { "@type": ["https://schema.org/Article", "https://schema.org/CreativeWork"], url: "/current/article", headline: "Current", author: [{ "@id": "#first" }, { "@type": "Person", name: "Inline Author" }, "Plain Author"], datePublished: "2024-03-04" },
      { "@id": "#first", "@type": "Person", name: "Referenced Author" },
    ]);
    expect(result.authors.map((author) => [author.profile.name, author.primary])).toEqual([
      ["Recommended Author", false], ["Referenced Author", true], ["Inline Author", true], ["Plain Author", true],
    ]);
    expect(result.authors[1]?.evidence.name?.scope).toBe("byline");
    expect(result.articles.find((article) => article.article.title === "Current")?.article.publishedAt).toBe("2024-03-04T00:00:00.000Z");
  });
  test("treats a lone root Article without a URL as the current page article", () => {
    const result = extract({ "@type": "Article", headline: "Root article", author: { "@type": "Person", name: "Root byline" } });
    expect(result.authors).toHaveLength(1);
    expect(result.authors[0]).toMatchObject({ profile: { name: "Root byline" }, primary: true });
    expect(result.authors[0]?.evidence.name?.sourcePath).toContain(".author.name");
  });

  test("matches current articles through the page canonical link", () => {
    const source = `<link rel="canonical" href="/canonical"><script type="application/ld+json">${JSON.stringify({ "@type": "Article", url: "/canonical", headline: "Canonical article", author: { "@type": "Person", name: "Canonical author" } })}</script>`;
    const { document } = parseHTML(source);
    const context = createPageContext(document as Document, source, "https://example.com/requested", DEFAULT_LIMITS);
    const result = extractJsonLd(context);
    expect(result.authors[0]).toMatchObject({ profile: { name: "Canonical author" }, primary: true });
  });
  test("accepts an unambiguous root Person profile without promoting graph Persons", () => {
    const root = extract({ "@type": "Person", name: "Root profile" });
    expect(root.authors[0]?.primary).toBe(true);

    const graph = extract([{ "@type": "Person", name: "Graph person one" }, { "@type": "Person", name: "Graph person two" }]);
    expect(graph.authors.map((author) => author.primary)).toEqual([false, false]);
  });

  test("does not turn navigation, products, or breadcrumbs into articles", () => {
    const result = extract([
      { "@type": "BreadcrumbList", name: "Breadcrumbs", url: "/crumbs" },
      { "@type": "Product", name: "Product", url: "/product" },
      {
        "@type": "ItemList", itemListElement: [
          { "@type": "ListItem", item: { "@type": "Product", name: "A product", url: "/product/a" } },
          { "@type": "ListItem", item: { "@type": "Product", headline: "A product-shaped headline", url: "/product/headline" } },
          { "@type": "ListItem", item: { headline: "A genuine article", url: "../story" } },
          { "@type": "ListItem", item: { "@type": "BlogPosting", name: "Typed article", url: "/typed" } },
        ]
      },
    ]);
    expect(result.articles.map(({ article }) => article.title)).toEqual(["A genuine article", "Typed article"]);
    expect(result.articles[0]?.article.url).toBe("https://example.com/story");
  });

  test("normalizes images, emails and social profiles while rejecting hostile/share URLs", () => {
    const result = extract({
      "@type": "Person", name: "Safe", url: "../author", image: { "@type": "ImageObject", contentUrl: "../portrait.jpg" },
      email: "mailto:writer@example.com", sameAs: ["https://www.linkedin.com/in/safe/?share=1", "https://twitter.com/intent/tweet?url=x", "javascript:alert(1)", "https://evil.example/linkedin.com/in/bad"],
    });
    expect(result.authors[0]?.identity).toBe("https://example.com/author");
    expect(result.authors[0]?.profile.avatarUrl).toBe("https://example.com/portrait.jpg");
    expect(result.authors[0]?.profile.email).toBe("writer@example.com");
    expect(result.authors[0]?.profile.socials).toContainEqual(expect.objectContaining({ platform: "linkedin", url: "https://www.linkedin.com/in/safe", handle: "safe", isPersonal: true }));
    expect(result.authors[0]?.socialEvidence?.[0]?.sourcePath).toContain("sameAs[0]");
  });

  test("limits malformed and oversized graph traversal without aborting valid entities", () => {
    const source = `<script type="application/ld+json">{bad</script><script type="application/ld+json">${JSON.stringify({ "@type": "Person", name: "Still extracted" })}</script>`;
    const { document } = parseHTML(source);
    const context = createPageContext(document as Document, source, "https://example.com/", { ...DEFAULT_LIMITS, maxDecodeNodes: 100 });
    const result = extractJsonLd(context);
    expect(result.authors.map((author) => author.profile.name)).toContain("Still extracted");
    expect(context.issues.some(({ message }) => message.includes("Malformed JSON-LD"))).toBe(true);
  });

  test("treats top-level arrays and @graph entities as page roots", () => {
    const array = extract([{ "@type": "Article", headline: "Array article", author: { "@type": "Person", name: "Array author" } }], "https://example.com/story");
    expect(array.authors[0]).toMatchObject({ profile: { name: "Array author" }, primary: true });

    const graph = extract({ "@context": "https://schema.org", "@graph": [{ "@type": "Article", headline: "Graph article", author: { "@type": "Person", name: "Graph author" } }] }, "https://example.com/story");
    expect(graph.authors[0]).toMatchObject({ profile: { name: "Graph author" }, primary: true });
  });

  test("matches the current page across protocol, host prefix, query, and trailing slash", () => {
    const result = extract(
      { "@type": "Article", url: "http://www.example.com/story/?utm_source=feed", headline: "Matched", author: { "@type": "Person", name: "Matched author" } },
      "https://example.com/story",
    );
    expect(result.authors[0]).toMatchObject({ profile: { name: "Matched author" }, primary: true });
    expect(result.articles.map(({ article }) => article.title)).toContain("Matched");
  });
  test("extracts ReportageNewsArticle publisher and precise page dates", () => {
    const result = extract({
      "@type": "ReportageNewsArticle",
      url: "https://example.com/news/current",
      headline: "Current report",
      datePublished: "2024-10-22T08:39:42.180Z",
      dateModified: "2024-10-23T08:39:42.507Z",
      publisher: { "@type": "NewsMediaOrganization", name: "Example News" },
      author: { "@type": "Person", name: "Ada Writer" },
    }, "https://example.com/news/current");
    expect(result.articles.map(({ article }) => article.title)).toEqual(["Current report"]);
    expect(result.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "editorial.publisher", value: "Example News" }),
      expect.objectContaining({ field: "metadata.publishedTime", value: "2024-10-22T08:39:42.180Z" }),
      expect.objectContaining({ field: "metadata.modifiedTime", value: "2024-10-23T08:39:42.507Z" }),
    ]));
  });

  test("does not accept or list a synthetic publisher Person as an author-profile article", () => {
    const result = extract({
      "@type": "NewsArticle",
      mainEntityOfPage: "https://example.com/author/ada",
      headline: "Ada's column",
      author: { "@type": "Person", name: "Example News" },
      publisher: { "@type": "Organization", name: "Example News" },
    }, "https://example.com/author/ada");
    expect(result.articles).toEqual([]);
    expect(result.authors.every(({ primary }) => !primary)).toBe(true);
    expect(result.authors.map(({ profile }) => profile.name)).toContain("Example News");
    expect(result.authors.length).toBeGreaterThan(0);
  });
});
