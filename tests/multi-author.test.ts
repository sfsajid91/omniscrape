import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";
import { ParserOutputSchema } from "../src/types";

const page = "https://publisher.example/story";
const article = (authors: unknown[]) => `<script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", url: page, author: authors })}</script>`;

describe("confirmed authors array", () => {
  test("returns an empty array when no target is evidenced", () => {
    const result = parseHtml(`<title>Story</title>`, page);
    expect(result.authors).toEqual([]);
  });

  test("mirrors a resolved single author and records indexed provenance", () => {
    const result = parseHtml(article([{ "@type": "Person", name: "Alice Reporter", url: "/authors/alice", email: "alice@example.org" }]), page);
    expect(result.authors).toHaveLength(1);
    expect(result.authors[0]).toMatchObject({ name: "Alice Reporter", email: "alice@example.org" });
    expect(result.provenance.some(({ field, value }) => field === "authors[0].name" && value === "Alice Reporter")).toBe(true);
    expect(result.provenance.some(({ field, value }) => field === "authors[0].email" && value === "alice@example.org")).toBe(true);
  });

  test("exposes only explicit current-article co-authors in source order", () => {
    const result = parseHtml(article([
      { "@type": "Person", name: "Alice Reporter" },
      { "@type": "Person", name: "Bob Writer" },
    ]), page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.authors.map(({ name }) => name)).toEqual(["Alice Reporter", "Bob Writer"]);
    expect(result.review.map(({ author }) => author.name).sort()).toEqual(["Alice Reporter", "Bob Writer"]);
  });

  test("collapses duplicate explicit identities but keeps same-name distinct identities", () => {
    const result = parseHtml(article([
      { "@type": "Person", name: "Alex Smith", url: "/authors/alex-one", email: "one@example.org" },
      { "@type": "Person", name: "Alex Smith", url: "/authors/alex-two", email: "two@example.org" },
      { "@type": "Person", name: "Alex Smith", url: "/authors/alex-one", email: "one@example.org" },
    ]), page);
    expect(result.authors.map(({ name, email }) => [name, email])).toEqual([
      ["Alex Smith", "one@example.org"], ["Alex Smith", "two@example.org"],
    ]);
  });

  test("requires agreeing explicit membership across article and DOM groups", () => {
    const html = article([
      { "@type": "Person", name: "Alice Reporter", url: "/authors/alice" },
      { "@type": "Person", name: "Bob Writer", url: "/authors/bob" },
    ]) + `<div class="byline"><a href="/authors/alice">Alice Reporter</a> and <a href="/authors/charlie">Charlie Editor</a></div>`;
    const result = parseHtml(html, page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.authors).toEqual([]);
  });

  test("forms an explicit hydration authors-array group with separate contacts", () => {
    const payload = {
      props: {
        pageProps: {
          story: {
            authors: [
              { name: "Dana Reporter", url: "https://publisher.example/authors/dana", email: "dana@example.org" },
              { name: "Eli Writer", url: "https://publisher.example/authors/eli", email: "eli@example.org" },
            ]
          }
        }
      }
    };
    const result = parseHtml(`<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`, page);
    expect(result.authors.map(({ name, email }) => [name, email])).toEqual([
      ["Dana Reporter", "dana@example.org"], ["Eli Writer", "eli@example.org"],
    ]);
    expect(result.provenance.some(({ field, sourcePath }) => field === "authors[1].email" && sourcePath.endsWith(".authors[1].email"))).toBe(true);
  });

  test("keeps historical output input parseable with a default empty authors array", () => {
    const oldOutput = { url: page, parsedAt: "2026-10-25T00:00:00Z", techStack: {}, author: { name: "Unknown Author" }, editorial: {}, metadata: {} };
    expect(ParserOutputSchema.parse(oldOutput).authors).toEqual([]);
  });
  test("propagates a current-article group to Person fragments emitted earlier", () => {
    const graph = {
      "@context": "https://schema.org", "@graph": [
        { "@id": "#alice", "@type": "Person", name: "Alice Reporter", url: "/authors/alice" },
        { "@id": "#bob", "@type": "Person", name: "Bob Writer", url: "/authors/bob" },
        { "@type": "NewsArticle", url: page, author: [{ "@id": "#alice" }, { "@id": "#bob" }] },
      ]
    };
    const result = parseHtml(`<script type="application/ld+json">${JSON.stringify(graph)}</script>`, page);
    expect(result.authors.map(({ name }) => name)).toEqual(["Alice Reporter", "Bob Writer"]);
    expect(result.provenance.some(({ field, sourcePath }) => field === "authors[0].name" && sourcePath.endsWith("@graph[0].name"))).toBe(true);
  });

  test("forms a shared group from one explicit DOM byline container", () => {
    const result = parseHtml(`<div class="byline"><a href="/authors/alice">Alice Reporter</a> and <a href="/authors/bob">Bob Writer</a></div>`, page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.authors.map(({ name }) => name)).toEqual(["Alice Reporter", "Bob Writer"]);
  });

  test("forms a shared group from a single meta-author element", () => {
    const result = parseHtml(`<meta name="author" content="Alice Reporter and Bob Writer">`, page);
    expect(result.authors.map(({ name }) => name)).toEqual(["Alice Reporter", "Bob Writer"]);
    expect(result.provenance.filter(({ field }) => field === "authors[0].name" || field === "authors[1].name")).toHaveLength(2);
  });

  test("withholds a conflicting co-author email without borrowing it across members", () => {
    const graph = {
      "@context": "https://schema.org", "@graph": [
        { "@id": "#alice", "@type": "Person", name: "Alice Reporter", url: "/authors/alice", email: "one@example.org" },
        { "@id": "#alice", email: "two@example.org" },
        { "@type": "NewsArticle", url: page, author: [{ "@id": "#alice" }, { "@type": "Person", name: "Bob Writer", url: "/authors/bob", email: "bob@example.org" }] },
      ]
    };
    const result = parseHtml(`<script type="application/ld+json">${JSON.stringify(graph)}</script>`, page);
    expect(result.authors.map(({ name, email }) => [name, email])).toEqual([["Alice Reporter", undefined], ["Bob Writer", "bob@example.org"]]);
    expect(result.provenance.some(({ field, value }) => field === "authors[0].email" && value === "one@example.org")).toBe(false);
    expect(result.provenance.some(({ field, value }) => field === "authors[1].email" && value === "bob@example.org")).toBe(true);
  });

  test("same-name explicit identities remain separate members of a confirmed group", () => {
    const result = parseHtml(article([
      { "@type": "Person", name: "Alex Smith", url: "/authors/alex-one", email: "one@example.org" },
      { "@type": "Person", name: "Alex Smith", url: "/authors/alex-two", email: "two@example.org" },
    ]), page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.authors.map(({ email }) => email)).toEqual(["one@example.org", "two@example.org"]);
  });

  test("ignores ungrouped non-primary people when determining co-author membership", () => {
    const html = article([
      { "@type": "Person", name: "Alice Reporter", url: "/authors/alice" },
      { "@type": "Person", name: "Bob Writer", url: "/authors/bob" },
    ]) + `<script type="application/ld+json">${JSON.stringify({ "@type": "Person", name: "Related Person", email: "related@example.org" })}</script>`;
    const result = parseHtml(html, page);
    expect(result.authors.map(({ name }) => name)).toEqual(["Alice Reporter", "Bob Writer"]);
    expect(result.review.some(({ author }) => author.name === "Related Person")).toBe(true);
  });

  test("does not infer a shared group from independent equal-ranked targets", () => {
    const result = parseHtml(`<script id="__NEXT_DATA__">${JSON.stringify({
      props: {
        pageProps: {
          author: { name: "Alice Reporter", url: "https://publisher.example/authors/alice" },
          profile: { name: "Bob Writer", url: "https://publisher.example/authors/bob" },
        }
      }
    })}</script>`, page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.authors).toEqual([]);
  });

  test("keeps source order from the first agreeing authorship group", () => {
    const html = article([
      { "@type": "Person", name: "Alice Reporter", url: "/authors/alice" },
      { "@type": "Person", name: "Bob Writer", url: "/authors/bob" },
    ]) + `<div class="byline"><a href="/authors/bob">Bob Writer</a> and <a href="/authors/alice">Alice Reporter</a></div>`;
    const result = parseHtml(html, page);
    expect(result.authors.map(({ name }) => name)).toEqual(["Alice Reporter", "Bob Writer"]);
  });
  test("does not infer co-authorship from comment authors", () => {
    const result = parseHtml(`<script type="application/ld+json">${JSON.stringify({
      "@type": "NewsArticle", url: page, headline: "A story with reader responses",
      comment: [{ "@type": "Comment", author: [{ "@type": "Person", name: "Commenter One" }, { "@type": "Person", name: "Commenter Two" }] }],
    })}</script>`, page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.authors).toEqual([]);
  });

});
