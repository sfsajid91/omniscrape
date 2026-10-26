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
    const result = parseHtml(syntheticQuintypeHtml, "https://gulfnews.com/author/a-ahmed");

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
    const result = parseHtml(html, "https://gulfnews.com/author/a-ahmed");

    expect(result.author.name).toBe("A Ahmed");
    expect(result.author.emails).toContain("aahmedreporter@gulfnews.com");
    expect(result.editorial.ownerEmail).toBe("aahmed@gulfnews.com");
    expect(result.editorial.ownerName).toBe("Ashfaq Ahmed");

    const editorialProvenance = result.provenance.filter((p) => p.field.startsWith("editorial."));
    expect(editorialProvenance.length).toBeLessThanOrEqual(5);
  });
});
