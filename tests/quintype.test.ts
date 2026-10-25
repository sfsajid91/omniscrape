import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const page = "https://publisher.example/story";
const flatStory = (extra: Record<string, unknown> = {}) => ({
  story: { id: "story-9", slug: "not-an-author", title: "Story title", "author-name": "Rahul Sharma", "author-id": "rs-4040", "publisher-name": "Quint Media", ...extra },
});

describe("Quintype author ownership", () => {
  test("extracts flat story author keys without borrowing story fields", () => {
    const data = { qt: { data: flatStory() } };
    const result = parseHtml(`<script id="static-page" type="application/json">${JSON.stringify(data)}</script>`, page);
    expect(result.author).toMatchObject({ name: "Rahul Sharma", id: "rs-4040" });
    expect(result.author.slug).toBeUndefined();
    expect(result.author.bio).toBeUndefined();
    expect(result.provenance.some(({ field, sourcePath }) => field === "author.name" && sourcePath.endsWith(".author-name"))).toBe(true);
    expect(result.provenance.some(({ field, sourcePath, entity }) => field === "author.id" && sourcePath.endsWith(".author-id") && entity?.includes("publisher.example"))).toBe(true);
    expect(result.editorial.publisher).toBe("Quint Media");
    expect(result.provenance.some(({ field, sourcePath }) => field === "editorial.publisher" && sourcePath.endsWith(".publisher-name"))).toBe(true);
  });

  test("accepts qtData assignment and unwraps its data root", () => {
    const result = parseHtml(`<script>window.qtData = ${JSON.stringify({ data: flatStory() })};</script>`, page);
    expect(result.author).toMatchObject({ name: "Rahul Sharma", id: "rs-4040" });
    expect(result.provenance.some(({ field, sourcePath }) => field === "author.name" && sourcePath.endsWith("@window.qtData.data.story.author-name"))).toBe(true);
    expect(result.techStack).toMatchObject({ cms: "Quintype (Bold)", hydrationFormat: "window.qtData", signals: ["found Quintype payload"] });
  });

  test("accepts qt assignment and direct story root", () => {
    const result = parseHtml(`<script>qt = ${JSON.stringify(flatStory())};</script>`, page);
    expect(result.author.name).toBe("Rahul Sharma");
    expect(result.provenance.some(({ field, sourcePath }) => field === "author.id" && sourcePath.endsWith("@qt.story.author-id"))).toBe(true);
    expect(result.techStack.hydrationFormat).toBe("qt");
  });

  test("recognizes nested Quintype author aliases and numeric zero IDs", () => {
    const result = parseHtml(`<script id="static-page">${JSON.stringify({ data: { author: { "author-name": "Avery Reporter", "author_id": 0 } } })}</script>`, page);
    expect(result.author).toMatchObject({ name: "Avery Reporter", id: 0 });
    expect(result.provenance.some(({ field, sourcePath }) => field === "author.id" && sourcePath.endsWith(".author_id"))).toBe(true);
  });

  test("does not treat publisher state aliases in unrelated fields as people", () => {
    const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { story: { id: "story-1", slug: "story", title: "A headline", "publisher-name": "Quint Media" } } } })}</script>`, page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.editorial.publisher).toBe("Quint Media");
  });

  for (const [nameAlias, nameValue] of [["author-name", "Rahul Sharma"], ["author_name", "Rina Das"], ["authorName", "Rhea Sen"]] as const) {
    for (const [idAlias, idValue] of [["author-id", "id-kebab"], ["author_id", "id-snake"], ["authorId", "id-camel"]] as const) {
      test(`maps flat ${nameAlias} with ${idAlias} provenance`, () => {
        const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { story: { [nameAlias]: nameValue, [idAlias]: idValue } } } })}</script>`, page);
        expect(result.author).toMatchObject({ name: nameValue, id: idValue });
        expect(result.provenance.some(({ field, sourcePath }) => field === "author.name" && sourcePath.endsWith(`.${nameAlias}`))).toBe(true);
        expect(result.provenance.some(({ field, sourcePath }) => field === "author.id" && sourcePath.endsWith(`.${idAlias}`))).toBe(true);
      });
    }
  }

  test("keeps a valid flat author when the optional author ID is missing or invalid", () => {
    for (const invalidId of [undefined, {}, ""]) {
      const story = { "author-name": "Valid Writer", ...(invalidId === undefined ? {} : { "author-id": invalidId }) };
      const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { story } } })}</script>`, page);
      expect(result.author.name).toBe("Valid Writer");
      expect(result.author.id).toBeUndefined();
    }
  });

  test("rejects author IDs without an evidenced name", () => {
    const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { story: { "author-id": "orphan-id", id: "story-id", slug: "story-slug", title: "Story title" } } } })}</script>`, page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.review).toEqual([]);
  });

  test("preserves raw string and positive numeric IDs", () => {
    for (const id of ["writer-7", 7]) {
      const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { author: { authorName: "Nested Writer", authorId: id } } } })}</script>`, page);
      expect(result.author).toMatchObject({ name: "Nested Writer", id });
    }
  });

  test("withholds conflicting flat aliases instead of selecting one", () => {
    const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { story: { "author-name": "First Writer", author_name: "Second Writer", "author-id": "writer-1" } } } })}</script>`, page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.review.map(({ author }) => author.name).sort()).toEqual(["First Writer", "Second Writer"]);
  });

  test("does not reconcile nested and flat authors without an agreed identity", () => {
    const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { story: { author: { name: "Nested Writer", id: "nested-1" }, "author-name": "Flat Writer", "author-id": "flat-1" } } } })}</script>`, page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.authors).toEqual([]);
  });

  test("reports conflicting publisher names through editorial conflict handling", () => {
    const result = parseHtml(`<script id="static-page">${JSON.stringify({ qt: { data: { story: { "author-name": "Publisher Writer", "publisher-name": "First Publisher", publisher: "Second Publisher" } } } })}</script>`, page);
    expect(result.editorial.publisher).toBeUndefined();
    expect(result.issues.some(({ message }) => message.includes("Conflicting values for editorial.publisher"))).toBe(true);
  });

  test("suppresses lineup and session authors while preserving the page author", () => {
    const data = { author: { name: "Page Writer", id: "page-1" }, main: [{ type: "lineup", content: [{ itemType: "story", author: { name: "Card Writer" } }] }], session: { author: { name: "Session Writer" } } };
    const result = parseHtml(`<script id="static-page">${JSON.stringify(data)}</script>`, page);
    expect(result.author.name).toBe("Page Writer");
    expect(result.review.some(({ author }) => ["Card Writer", "Session Writer"].includes(author.name))).toBe(false);
  });

  test("does not match arbitrary qt substrings as technical markers", () => {
    const result = parseHtml(`<script>someqtData = {story:{}}</script>`, page);
    expect(result.techStack.cms).not.toBe("Quintype (Bold)");
    expect(result.techStack.hydrationFormat).toBeUndefined();
  });
});
