import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const page = "https://publisher.example/story";
const authorMeta = `<meta name="author" content="Boundary Writer">`;

describe("parser resource and boundary isolation", () => {
  test("accepts HTML exactly at the UTF-8 byte limit and rejects one byte below", () => {
    const bytes = Buffer.byteLength(authorMeta);
    expect(parseHtml(authorMeta, page, { maxHtmlBytes: bytes }).author.name).toBe("Boundary Writer");
    expect(() => parseHtml(authorMeta, page, { maxHtmlBytes: bytes - 1 })).toThrow(RangeError);
  });

  test("accepts one byte above the exact HTML bound", () => {
    const bytes = Buffer.byteLength(authorMeta);
    expect(parseHtml(authorMeta, page, { maxHtmlBytes: bytes + 1 }).author.name).toBe("Boundary Writer");
  });

  test("enforces script byte limits while retaining later independent DOM evidence", () => {
    const scriptBody = `window.__INITIAL_STATE__ = {author:{name:"Script Writer"}};`;
    const html = `<script>${scriptBody}</script>${authorMeta}`;
    const atLimit = parseHtml(`<script>${scriptBody}</script>`, page, { maxScriptBytes: Buffer.byteLength(scriptBody) });
    expect(atLimit.author.name).toBe("Script Writer");
    const overLimit = parseHtml(html, page, { maxScriptBytes: Buffer.byteLength(scriptBody) - 1 });
    expect(overLimit.author.name).toBe("Boundary Writer");
    expect(overLimit.issues.some(({ message }) => message.includes("maxScriptBytes"))).toBe(true);
  });

  test("rejects invalid extraction limits before parsing", () => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => parseHtml(authorMeta, page, { maxDecodeNodes: value })).toThrow(RangeError);
    }
  });

  test("rejects malformed, non-HTTP, and credentialed page URLs", () => {
    for (const url of ["not a URL", "ftp://publisher.example/story", "https://user:secret@publisher.example/story"]) {
      expect(() => parseHtml(authorMeta, url)).toThrow(TypeError);
    }
  });

  test("preserves the public result while raw hydration remains opt-in", () => {
    const html = `<script id="__NEXT_DATA__">{"props":{"pageProps":{"author":{"name":"Raw Writer","id":7}}}}</script>`;
    const ordinary = parseHtml(html, page);
    const included = parseHtml(html, page, { includeRawHydration: true });
    expect(ordinary.rawHydration).toBeUndefined();
    expect(included.rawHydration).toEqual([{ source: "next-pages", path: "script[0]#props.pageProps", value: { author: { name: "Raw Writer", id: 7 } } }]);
    expect(included.author).toEqual(ordinary.author);
  });

  test("bounds raw snapshots and ignores cyclic Flight references without fabricating people", () => {
    const flight = '0:{"author":"$99","cycle":"$1"}\\n1:{"name":"Cycle Writer","email":"fake@example.org","next":"$1"}\\n';
    const html = `<script>self.__next_f.push([1,${JSON.stringify(flight)}])</script><script id="__NEXT_DATA__">{"props":{"pageProps":{"author":{"name":"Raw Source Writer","id":7}}}}</script><meta name="author" content="Independent Writer">`;
    const result = parseHtml(html, page, { includeRawHydration: true, maxDecodeNodes: 1 });
    expect(result.author.name).toBe("Independent Writer");
    expect(result.author.email).toBeUndefined();
    expect(JSON.stringify(result.rawHydration)).toContain("[Truncated]");
    expect(result.review.some(({ author }) => author.name === "Cycle Writer")).toBe(false);
  });

  test("keeps a valid DOM source after malformed JSON-LD and malformed hydration", () => {
    const result = parseHtml(`<script type="application/ld+json">{bad</script><script id="__NUXT_DATA__">{bad</script>${authorMeta}`, page);
    expect(result.author.name).toBe("Boundary Writer");
    expect(result.issues.some(({ message }) => message === "Malformed JSON-LD")).toBe(true);
    expect(result.issues.some(({ message }) => message.startsWith("Nuxt devalue decode failed"))).toBe(true);
  });

  test("does not retain oversized state in opt-in raw snapshots", () => {
    const data = { props: { pageProps: { author: { name: "Ignored Oversized Writer" }, padding: "x".repeat(300) } } };
    const html = `<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>${authorMeta}`;
    const result = parseHtml(html, page, { maxScriptBytes: 100, includeRawHydration: true });
    expect(result.author.name).toBe("Boundary Writer");
    expect(JSON.stringify(result.rawHydration)).not.toContain("Ignored Oversized Writer");
    expect(result.issues.some(({ message }) => message.includes("maxScriptBytes"))).toBe(true);
  });

  test("preserves independently valid evidence after a shallow decode limit", () => {
    const html = `<script id="static-page">{"author":{"name":"Shallow Limit Writer"},"deep":{"a":{"b":{"c":"discard"}}}}</script><meta name="description" content="Independent metadata">`;
    const result = parseHtml(html, page, { maxDecodeDepth: 2 });
    expect(result.author.name).toBe("Shallow Limit Writer");
    expect(result.metadata.description).toBe("Independent metadata");
    expect(result.issues.some(({ message }) => message === "Hydration depth limit exceeded")).toBe(true);
  });
});