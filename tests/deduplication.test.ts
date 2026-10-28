import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { parseHtml } from "../src/parse";

const syntheticQuintypeHtml = `<!DOCTYPE html><html><head><script id="static-page" type="application/json">
{"qt":{"data":{"author":{"id":2345930,"name":"A Ahmed"},"authorCollection":{"items":[
  {"story":{"owner-id":2165189,"owner-name":"Ashfaq Ahmed","cards":[{"story-elements":[{"metadata":{"linked-story":{"authors":[
    {"id":2345930,"name":"A Ahmed","email":"aahmedreporter@gulfnews.com"},
    {"id":2165189,"name":"Ashfaq Ahmed","email":"aahmed@gulfnews.com"}
  ]}}}]}]}},
  {"story":{"owner-id":2165189,"owner-name":"Ashfaq Ahmed","cards":[]}},
  {"story":{"owner-id":2165189,"owner-name":"Ashfaq Ahmed","cards":[]}}
]}}}}
</script></head><body></body></html>`;

describe("deduplication and entity correlation", () => {
  test("synthetic Quintype payload eliminates duplicate editorial provenance and correlates entities", () => {
    const result = parseHtml({ html: syntheticQuintypeHtml, pageUrl: "https://gulfnews.com/author/a-ahmed" });

    // Assert contacts extracted via Quintype entity correlation
    expect(result.author.name).toBe("A Ahmed");
    expect(result.author.emails).toContain("aahmedreporter@gulfnews.com");
    expect(result.editorial.ownerEmail).toBe("aahmed@gulfnews.com");
    expect(result.editorial.ownerName).toBe("Ashfaq Ahmed");

    // Assert editorial provenance records are deduplicated
    const editorialProvenance = result.provenance.filter((p) => p.field.startsWith("editorial."));
    expect(editorialProvenance.length).toBeLessThanOrEqual(5); // At most 1 record per distinct field
  });

  test("static Gulf News fixture eliminates 160 duplicate editorial provenance items", () => {
    const fixturePath = "tests/fixtures/gulfnews-author.html";
    if (!existsSync(fixturePath)) return;
    const html = readFileSync(fixturePath, "utf-8");
    const result = parseHtml({ html, pageUrl: "https://gulfnews.com/author/a-ahmed" });

    expect(result.author.name).toBe("A Ahmed");
    expect(result.author.emails).toContain("aahmedreporter@gulfnews.com");
    expect(result.editorial.ownerEmail).toBe("aahmed@gulfnews.com");
    expect(result.editorial.ownerName).toBe("Ashfaq Ahmed");

    const editorialProvenance = result.provenance.filter((p) => p.field.startsWith("editorial."));
    expect(editorialProvenance.length).toBeLessThanOrEqual(5);
  });

  test("Quintype correlation respects maxDecodeNodes budget", () => {
    const result = parseHtml({
      html: syntheticQuintypeHtml,
      pageUrl: "https://gulfnews.com/author/a-ahmed",
      maxDecodeNodes: 1,
    });
    // With budget 1 node, correlation terminates early and doesn't reach nested card authors
    expect(result.author.emails).toBeUndefined();
  });

  test("Quintype correlation preserves root author profileUrl and slug identity", () => {
    const html = `<!DOCTYPE html><html><head><script id="static-page" type="application/json">
    {"qt":{"data":{"author":{"id":2345930,"name":"A Ahmed","url":"https://gulfnews.com/authors/a-ahmed","slug":"a-ahmed"},"authorCollection":{"items":[
      {"story":{"cards":[{"story-elements":[{"metadata":{"linked-story":{"authors":[
        {"id":2345930,"name":"A Ahmed","email":"aahmedreporter@gulfnews.com"}
      ]}}}]}]}}
    ]}}}}
    </script></head><body></body></html>`;
    const result = parseHtml({ html, pageUrl: "https://gulfnews.com/authors/a-ahmed" });
    expect(result.author.name).toBe("A Ahmed");
    expect(result.author.slug).toBe("a-ahmed");
    expect(result.author.emails).toContain("aahmedreporter@gulfnews.com");
  });

  test("unlinked non-primary candidate does not merge non-name attributes into resolved author", () => {
    // If a primary author has explicit identity, and a secondary candidate has the same name but is not primary
    const html = `
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","author":{"@type":"Person","@id":"https://example.com/author/john","name":"John Doe"}}</script>
      <div class="related-story"><span class="byline">By John Doe</span><a href="mailto:fake-john@example.com">email</a></div>
    `;
    const result = parseHtml({ html, pageUrl: "https://example.com/story" });
    expect(result.author.name).toBe("John Doe");
    // fake-john email from unlinked related story candidate must not merge into author
    expect(result.author.email).toBeUndefined();
  });
});
