import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const page = "https://publisher.example/story";

describe("Flight extraction safety", () => {
  test("uses cooked static template chunks", () => {
    const flight = `0:{"author":"$1"}\n1:{"name":"Template Writer"}`;
    const result = parseHtml({ html: `<script>self.__next_f.push([1, \`${flight}\`])</script>`, pageUrl: page });
    expect(result.author.name).toBe("Template Writer");
  });

  test("recovers a raw newline only inside a direct Flight push string and keeps its issue", () => {
    const html = `<script>self.__next_f.push([1,"0:{\\"author\\":\\"$1\\"}\n1:{\\"name\\":\\"Recovered Writer\\"}"])</script>`;
    const result = parseHtml({ html, pageUrl: page });
    expect(result.author.name).toBe("Recovered Writer");
    expect(result.issues.filter(({ message }) => message.includes("Malformed Flight script"))).toHaveLength(1);
  });

  test("does not recover fake pushes in comments, strings, templates, or non-JavaScript scripts", () => {
    const result = parseHtml({
      html: `<script>// self.__next_f.push([1,"0:{\\"name\\":\\"Comment Writer\\"}"])
const text = 'self.__next_f.push([1,"1:{\\"name\\":\\"String Writer\\"}"])';
const template = \`self.__next_f.push([1,"2:{\\"name\\":\\"Template Fake\\"}"])\`;</script><script type="application/json">self.__next_f.push([1,"3:{\\"name\\":\\"JSON Fake\\"}"])</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Unknown Author");
  });

  test("keeps later independent bylines after an unclosed Flight literal", () => {
    const result = parseHtml({
      html: `<script>self.__next_f.push([1,"0:{"name":"Never parsed"}</script><meta name="author" content="Independent Writer">`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Independent Writer");
    expect(result.issues.some(({ message }) => message.includes("Malformed Flight script"))).toBe(true);
  });

  for (const receiver of ["self", "window", "globalThis"] as const) {
    test(`accepts direct ${receiver} Flight receivers`, () => {
      const rows = `0:{"author":"$1"}\n1:{"name":"${receiver} Flight Writer"}`;
      const result = parseHtml({
        html: `<script>${receiver}.__next_f.push([1,${JSON.stringify(rows)}])</script>`,
        pageUrl: page,
      });
      expect(result.author.name).toBe(`${receiver} Flight Writer`);
    });
  }

  test("preserves lexical push order across split scripts and resolves cross-script references", () => {
    const first = `0:{"author":"$2"}\n`;
    const second = `2:{"name":"Cross Script Writer"}`;
    const result = parseHtml({
      html: `<script>self.__next_f.push([1,${JSON.stringify(first)}])</script><script>window.__next_f.push([1,${JSON.stringify(second)}])</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Cross Script Writer");
  });

  test("decodes escaped quotes, backslashes, and Unicode through Flight JSON", () => {
    const name = 'Writer "A" \\\\ José';
    const rows = `0:{"author":"$1"}\n1:${JSON.stringify({ name })}`;
    const result = parseHtml({
      html: `<script>self.__next_f.push([1,${JSON.stringify(rows)}])</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe(name);
  });

  test("uses cooked escapes in static template chunks", () => {
    const result = parseHtml({
      html: '<script>self.__next_f.push([1,`0:{"author":"$1"}\\n1:{"name":"Cooked Escape Writer"}`])</script>',
      pageUrl: page,
    });
    expect(result.author.name).toBe("Cooked Escape Writer");
  });

  test("rejects interpolated Flight templates", () => {
    const html =
      '<script>const suffix = \'Rejected\'; self.__next_f.push([1,`0:{\\"author\\":\\"$1\\"}\\\\n1:{\\"name\\":\\"${suffix}\\"}`])</script>';
    const result = parseHtml({ html, pageUrl: page });
    expect(result.author.name).toBe("Unknown Author");
  });

  test("recovers raw CRLF only in a direct Flight payload", () => {
    const html = `<script>window.__next_f.push([1,"0:{\\"author\\":\\"$1\\"}\r\n1:{\\"name\\":\\"CRLF Writer\\"}"])</script>`;
    const result = parseHtml({ html, pageUrl: page });
    expect(result.author.name).toBe("CRLF Writer");
    expect(result.issues.filter(({ message }) => message === "Malformed Flight script")).toHaveLength(1);
  });

  test("recovers raw newlines in bootstrap and comma-chained Flight pushes", () => {
    const bootstrap = `<script>(self.__next_f=self.__next_f||[]).push([1,"0:{\\"author\\":\\"$1\\"}\n1:{\\"name\\":\\"Bootstrap Writer\\"}\n"])</script>`;
    const chained = `<script>self.__next_f.push([1,"0:{\\"author\\":\\"$1\\"}\n"]),self.__next_f.push([1,"1:{\\"name\\":\\"Chained Writer\\"}\n"])</script>`;
    expect(parseHtml({ html: bootstrap, pageUrl: page }).author.name).toBe("Bootstrap Writer");
    expect(parseHtml({ html: chained, pageUrl: page }).author.name).toBe("Chained Writer");
  });

  test("rejects computed receivers and computed push methods", () => {
    const result = parseHtml({
      html: `<script>self["__next_f"]["push"]([1,${JSON.stringify('0:{"name":"Computed Writer"}')}])</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Unknown Author");
  });

  test("does not parse Flight markers from non-JavaScript script types", () => {
    const result = parseHtml({
      html: `<script type="application/json">self.__next_f.push([1,${JSON.stringify('0:{"name":"JSON Script Writer"}')}])</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Unknown Author");
  });

  test("handles T headers inside multiline JSON strings, pretty-printed JSON, contiguous rows, incomplete lengths, and duplicate hex IDs", () => {
    const bio = "Line one\na:T10,not a chunk\nLine three";
    const t2 = "Bio from T2";
    const t2Hex = Buffer.byteLength(t2, "utf8").toString(16);
    const stream =
      `0:{\n  "author": "$1a",\n  "note": "$2"\n}\n` +
      `1a:{"name":"Old Writer"}\n` +
      `1A:{"name":"Winning Writer","bio":${JSON.stringify(bio).replace(/\\n/g, "\n")}}\n` +
      `2:T${t2Hex},${t2}` +
      `3:T100,truncated`;

    const result = parseHtml({
      html: `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Winning Writer");
    expect(result.author.bio).toBe("Line one a:T10,not a chunk Line three");
    expect(result.authors).toHaveLength(1);
    expect(result.review).toEqual([]);
  });

  test("recovers large multi-newline Flight payloads linearly", () => {
    const payload = `0:{"author":"$1"}\n1:{"name":"Linear Flight","bio":"${"line\n".repeat(5_000)}"}`;
    const html = `<script>self.__next_f.push([1,"${payload.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"])</script>`;
    const started = performance.now();
    const result = parseHtml({ html, pageUrl: page });
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.author.name).toBe("Linear Flight");
  });

  test("recovers independent valid author rows after a truncated unclosed string row and reports the malformed record", () => {
    const stringTruncated =
      `a:"truncated unclosed string\n` + `1:{"name":"Recovered After String"}\n` + `0:{"author":"$1"}\n`;
    const stringRes = parseHtml({
      html: `<script>self.__next_f.push([1,${JSON.stringify(stringTruncated)}])</script>`,
      pageUrl: page,
    });
    expect(stringRes.author.name).toBe("Recovered After String");
    expect(stringRes.issues.some(({ message }) => message.includes("Malformed Flight"))).toBe(true);

    const objectTruncated =
      `a:{"bio":"truncated unclosed string\n` + `1:{"name":"Recovered After Object"}\n` + `0:{"author":"$1"}\n`;
    const objectRes = parseHtml({
      html: `<script>self.__next_f.push([1,${JSON.stringify(objectTruncated)}])</script>`,
      pageUrl: page,
    });
    expect(objectRes.author.name).toBe("Recovered After Object");
    expect(objectRes.issues.some(({ message }) => message.includes("Malformed Flight"))).toBe(true);

    // Bounded recovery when many truncated lines precede a valid author row.
    const noisyPrefix = Array.from({ length: 10 }, (_, i) => `${(i + 10).toString(16)}:"unclosed ${i}`).join("\n");
    const boundedStream = `${noisyPrefix}\n1:{"name":"Bounded Recovery Author"}\n0:{"author":"$1"}\n`;
    const boundedRes = parseHtml({
      html: `<script>self.__next_f.push([1,${JSON.stringify(boundedStream)}])</script>`,
      pageUrl: page,
    });
    expect(boundedRes.author.name).toBe("Bounded Recovery Author");
    expect(boundedRes.issues.some(({ message }) => message.includes("Malformed Flight"))).toBe(true);
  });

  test("rejects dangling truncated Flight T-chunks instead of silently accepting partial text", () => {
    const stream = `0:{"author":"$1"}\n` + `1:{"name":"Alice Writer","bio":"$2"}\n` + `2:T100,truncated`;
    const result = parseHtml({
      html: `<script>self.__next_f.push([1,${JSON.stringify(stream)}])</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Alice Writer");
    expect(result.author.bio).toBeUndefined();
    expect(result.issues.some(({ message }) => message.includes("Truncated Flight"))).toBe(true);
  });
});
