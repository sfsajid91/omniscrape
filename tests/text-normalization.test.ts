import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";
import { decodeEntities, personName, stripHtml } from "../src/values";

describe("text normalization boundaries", () => {
  test("decodes named, decimal, hexadecimal, and non-BMP references once", () => {
    expect(decodeEntities("Ren&eacute; &#233; &#xE9; &#x1F642;")).toBe("René é é 🙂");
    expect(decodeEntities("Ren&amp;eacute;")).toBe("Ren&eacute;");
  });

  test("preserves unknown references and literal angle-bracket text", () => {
    expect(decodeEntities("&unknown; <literal>")).toBe("&unknown; <literal>");
    expect(stripHtml("&lt;/tag&gt; visible")).toBe("visible");
  });

  test("normalizes encoded structured names without changing byline limits", () => {
    expect(personName("  By Ren&eacute; Writer ")).toBe("René Writer");
    expect(personName("B")).toBeUndefined();
    expect(personName("x".repeat(121))).toBeUndefined();
  });

  test("decodes encoded description markup but never promotes it to an author bio", () => {
    const result = parseHtml({
      html: `<meta name="description" content="A &amp;eacute; summary with &lt;a href='/person'&gt;markup&lt;/a&gt;."><title>Publisher</title>`,
      pageUrl: "https://publisher.example/story",
    });
    expect(result.metadata.description).toBe("A é summary with markup .");
    expect(result.author.name).toBe("Unknown Author");
    expect(result.author.bio).toBeUndefined();
  });

  test("keeps an explicit institutional newsroom byline", () => {
    const result = parseHtml({
      html: `<div class="byline">Newsroom</div>`,
      pageUrl: "https://publisher.example/story",
    });
    expect(result.author.name).toBe("Newsroom");
  });
  test("decodes apostrophe and ampersand references without recursively decoding", () => {
    expect(decodeEntities("D&#39;Arcy &amp; Sons")).toBe("D'Arcy & Sons");
    expect(decodeEntities("D&amp;#39;Arcy")).toBe("D&#39;Arcy");
  });

  test("collapses decoded non-breaking whitespace in names", () => {
    expect(personName("Ada&nbsp;Lovelace")).toBe("Ada Lovelace");
  });

  test("preserves invalid and unknown references rather than inventing text", () => {
    expect(decodeEntities("&unknown; &#x110000;")).toContain("&unknown;");
  });

  test("decodes encoded JSON-LD names and retains their explicit profile identity", () => {
    const result = parseHtml({
      html: `<script type="application/ld+json">{"@type":"ProfilePage","mainEntity":{"@type":"Person","name":"Ren&#233; Writer","url":"https://publisher.example/authors/rene"}}</script>`,
      pageUrl: "https://publisher.example/authors/rene",
    });
    expect(result.author.name).toBe("René Writer");
  });

  test("normalizes decomposed and composed Unicode on the same explicit identity", () => {
    const result = parseHtml({
      html: `<script type="application/ld+json">{"@type":"ProfilePage","mainEntity":{"@type":"Person","name":"José Writer","url":"https://publisher.example/authors/jose"}}</script><div class="byline"><a href="/authors/jose">José Writer</a></div>`,
      pageUrl: "https://publisher.example/story",
    });
    expect(result.author.name).toBe("José Writer");
    expect(result.review).toEqual([]);
  });

  test("does not retain tag-only descriptions", () => {
    const result = parseHtml({
      html: `<meta name="description" content="&lt;p&gt;&lt;/p&gt;">`,
      pageUrl: "https://publisher.example/story",
    });
    expect(result.metadata.description).toBeUndefined();
  });

  test("keeps already decoded DOM description values stable", () => {
    const result = parseHtml({
      html: `<meta name="description" content="A &amp; B"><meta name="author" content="Newsroom">`,
      pageUrl: "https://publisher.example/story",
    });
    expect(result.metadata.description).toBe("A & B");
    expect(result.author.name).toBe("Newsroom");
  });
});
