import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const page = "https://publisher.example/story";

describe("script source parsing", () => {
  test("extracts only a static top-level Fenrir data declaration", () => {
    const result = parseHtml(
      `<script id="fenrir-client-data">const fenrirClientData = { author: { name: "Static Fenrir Writer", id: "fen-7" } }; window.Fenrir = Object.assign({}, window.Fenrir);</script>`,
      page,
    );
    expect(result.author).toMatchObject({ name: "Static Fenrir Writer", id: "fen-7" });
    expect(result.issues.some(({ message }) => message.includes("Malformed hydration JSON"))).toBe(false);
    expect(
      result.provenance.some(
        ({ field, sourcePath }) => field === "author.name" && sourcePath === "script[0]@fenrirClientData.author.name",
      ),
    ).toBe(true);
  });

  test("rejects dynamic Fenrir state but keeps a later valid source", () => {
    const result = parseHtml(
      `<script id="fenrir-client-data">const fenrirClientData = window.payload;</script><meta name="author" content="Later Writer">`,
      page,
    );
    expect(result.author.name).toBe("Later Writer");
    expect(result.issues.some(({ message }) => message.includes("Unsupported static hydration initializer"))).toBe(
      true,
    );
  });
  test("accepts ordinary Fenrir JSON and preserves the JSON source path", () => {
    const result = parseHtml(
      `<script id="fenrir-client-data" type="application/json">${JSON.stringify({ author: { name: "JSON Fenrir Writer" } })}</script>`,
      page,
    );
    expect(result.author.name).toBe("JSON Fenrir Writer");
    expect(
      result.provenance.some(
        ({ field, sourcePath }) => field === "author.name" && sourcePath === "script[0].author.name",
      ),
    ).toBe(true);
  });

  for (const declaration of ["let", "var"] as const) {
    test(`accepts a top-level Fenrir ${declaration} declaration`, () => {
      const result = parseHtml(
        `<script id="fenrir-client-data">${declaration} fenrirClientData = { author: { name: "Declared Writer" } };</script>`,
        page,
      );
      expect(result.author.name).toBe("Declared Writer");
      expect(result.provenance.some(({ sourcePath }) => sourcePath.startsWith("script[0]@fenrirClientData"))).toBe(
        true,
      );
    });
  }

  test("does not accept Fenrir-looking declarations inside comments or strings", () => {
    const result = parseHtml(
      `<script id="fenrir-client-data">// const fenrirClientData = { author: { name: "Comment Writer" } };\nconst text = 'const fenrirClientData = { author: { name: "String Writer" } }';</script>`,
      page,
    );
    expect(result.author.name).toBe("Unknown Author");
    expect(result.issues.some(({ message }) => message === "Unsupported static hydration initializer")).toBe(false);
  });

  test("reports malformed Fenrir JavaScript and continues to later sources", () => {
    const result = parseHtml(
      `<script id="fenrir-client-data">const fenrirClientData = {</script><meta name="author" content="Later Meta Writer">`,
      page,
    );
    expect(result.author.name).toBe("Later Meta Writer");
    expect(
      result.issues.some(
        ({ sourcePath, message }) => sourcePath === "script[0]" && message === "Malformed hydration script",
      ),
    ).toBe(true);
  });

  for (const [assignment, hydrationFormat] of [
    ["qtLoadedData", "qtLoadedData"],
    ["window.qtLoadedData", "window.qtLoadedData"],
    ["qtData", "qtData"],
  ] as const) {
    test(`extracts static ${assignment} assignment without executing it`, () => {
      const payload = { story: { "author-name": "Assignment Writer", "author-id": "writer-a" } };
      const result = parseHtml(`<script>${assignment} = ${JSON.stringify(payload)};</script>`, page);
      expect(result.author).toMatchObject({ name: "Assignment Writer", id: "writer-a" });
      expect(result.techStack).toMatchObject({ cms: "Quintype (Bold)", hydrationFormat });
    });
  }

  test("ignores assignment-like script comments and non-executable script types", () => {
    const result = parseHtml(
      `<script>// window.qtData = {story:{'author-name':'Comment Writer'}}</script><script type="application/json">window.qtData = {"story":{"author-name":"JSON Writer"}}</script>`,
      page,
    );
    expect(result.author.name).toBe("Unknown Author");
    expect(result.techStack.cms).not.toBe("Quintype (Bold)");
  });
});
