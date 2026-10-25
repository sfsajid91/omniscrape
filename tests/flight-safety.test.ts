import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const page = "https://publisher.example/story";

describe("Flight extraction safety", () => {
  test("uses cooked static template chunks", () => {
    const flight = `0:{"author":"$1"}\n1:{"name":"Template Writer"}`;
    const result = parseHtml(`<script>self.__next_f.push([1, \`${flight}\`])</script>`, page);
    expect(result.author.name).toBe("Template Writer");
  });

  test("recovers a raw newline only inside a direct Flight push string and keeps its issue", () => {
    const html = `<script>self.__next_f.push([1,"0:{\\\"author\\\":\\\"$1\\\"}\n1:{\\\"name\\\":\\\"Recovered Writer\\\"}"])</script>`;
    const result = parseHtml(html, page);
    expect(result.author.name).toBe("Recovered Writer");
    expect(result.issues.filter(({ message }) => message.includes("Malformed Flight script"))).toHaveLength(1);
  });

  test("does not recover fake pushes in comments, strings, templates, or non-JavaScript scripts", () => {
    const result = parseHtml(`<script>// self.__next_f.push([1,"0:{\\"name\\":\\"Comment Writer\\"}"])
const text = 'self.__next_f.push([1,"1:{\\"name\\":\\"String Writer\\"}"])';
const template = \`self.__next_f.push([1,"2:{\\"name\\":\\"Template Fake\\"}"])\`;</script><script type="application/json">self.__next_f.push([1,"3:{\\"name\\":\\"JSON Fake\\"}"])</script>`, page);
    expect(result.author.name).toBe("Unknown Author");
  });

  test("keeps later independent bylines after an unclosed Flight literal", () => {
    const result = parseHtml(`<script>self.__next_f.push([1,"0:{\"name\":\"Never parsed\"}</script><meta name="author" content="Independent Writer">`, page);
    expect(result.author.name).toBe("Independent Writer");
    expect(result.issues.some(({ message }) => message.includes("Malformed Flight script"))).toBe(true);
  });

  for (const receiver of ["self", "window", "globalThis"] as const) {
    test(`accepts direct ${receiver} Flight receivers`, () => {
      const rows = `0:{"author":"$1"}\n1:{"name":"${receiver} Flight Writer"}`;
      const result = parseHtml(`<script>${receiver}.__next_f.push([1,${JSON.stringify(rows)}])</script>`, page);
      expect(result.author.name).toBe(`${receiver} Flight Writer`);
    });
  }

  test("preserves lexical push order across split scripts and resolves cross-script references", () => {
    const first = `0:{"author":"$2"}\n`;
    const second = `2:{"name":"Cross Script Writer"}`;
    const result = parseHtml(`<script>self.__next_f.push([1,${JSON.stringify(first)}])</script><script>window.__next_f.push([1,${JSON.stringify(second)}])</script>`, page);
    expect(result.author.name).toBe("Cross Script Writer");
  });

  test("decodes escaped quotes, backslashes, and Unicode through Flight JSON", () => {
    const name = 'Writer "A" \\\\ José';
    const rows = `0:{"author":"$1"}\n1:${JSON.stringify({ name })}`;
    const result = parseHtml(`<script>self.__next_f.push([1,${JSON.stringify(rows)}])</script>`, page);
    expect(result.author.name).toBe(name);
  });

  test("uses cooked escapes in static template chunks", () => {
    const result = parseHtml('<script>self.__next_f.push([1,`0:{"author":"$1"}\\n1:{"name":"Cooked Escape Writer"}`])</script>', page);
    expect(result.author.name).toBe("Cooked Escape Writer");
  });

  test("rejects interpolated Flight templates", () => {
    const html = "<script>const suffix = 'Rejected'; self.__next_f.push([1,`0:{\\\"author\\\":\\\"$1\\\"}\\\\n1:{\\\"name\\\":\\\"${suffix}\\\"}`])</script>";
    const result = parseHtml(html, page);
    expect(result.author.name).toBe("Unknown Author");
  });

  test("recovers raw CRLF only in a direct Flight payload", () => {
    const html = `<script>window.__next_f.push([1,"0:{\\\"author\\\":\\\"$1\\\"}\r\n1:{\\\"name\\\":\\\"CRLF Writer\\\"}"])</script>`;
    const result = parseHtml(html, page);
    expect(result.author.name).toBe("CRLF Writer");
    expect(result.issues.filter(({ message }) => message === "Malformed Flight script")).toHaveLength(1);
  });

  test("rejects computed receivers and computed push methods", () => {
    const result = parseHtml(`<script>self["__next_f"]["push"]([1,${JSON.stringify('0:{"name":"Computed Writer"}')}])</script>`, page);
    expect(result.author.name).toBe("Unknown Author");
  });

  test("does not parse Flight markers from non-JavaScript script types", () => {
    const result = parseHtml(`<script type="application/json">self.__next_f.push([1,${JSON.stringify('0:{"name":"JSON Script Writer"}')}])</script>`, page);
    expect(result.author.name).toBe("Unknown Author");
  });
});
