import { describe, test } from "bun:test";
import { testCases } from "../scripts/cases";
import { parseHtml } from "../src/index";

describe("scripted report cases", () => {
  for (const tc of testCases) {
    test(`${tc.id}: ${tc.name}`, () => {
      const result = parseHtml(tc.html, tc.pageUrl, tc.options);
      tc.verify(result);
    });
  }
});
