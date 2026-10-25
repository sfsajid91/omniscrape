import { describe, test } from "bun:test";
import { parseHtml } from "../src/index";
import { testCases } from "../scripts/cases";

describe("scripted report cases", () => {
  for (const tc of testCases) {
    test(`${tc.id}: ${tc.name}`, () => {
      const result = parseHtml(tc.html, tc.pageUrl, tc.options);
      tc.verify(result);
    });
  }
});
