import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const page = "https://publisher.example/story";

describe("listing attribution boundaries", () => {
  test("does not promote CBC lineup story authors into page review", () => {
    const lineup = {
      main: [
        {
          type: "lineup",
          content: [
            { itemType: "story", author: { name: "Card Writer One" } },
            { itemType: "story", author: { name: "Card Writer Two" } },
          ],
        },
      ],
    };
    const cards = `<article class="river-item"><h2><a href="/first-story">A sufficiently long first story headline</a></h2></article><article class="river-item"><h2><a href="/second-story">A sufficiently long second story headline</a></h2></article>`;
    const result = parseHtml({
      html: `<script id="static-page">${JSON.stringify(lineup)}</script>${cards}`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Unknown Author");
    expect(result.review).toEqual([]);
    expect(result.articles.map(({ url }) => url)).toEqual([
      "https://publisher.example/first-story",
      "https://publisher.example/second-story",
    ]);
  });

  test("skips linked and unmarked bylines in separate story cards", () => {
    const html = `<article class="river-item"><h2><a href="/recommended">A sufficiently long recommended story headline</a></h2><div class="byline"><a href="/authors/recommender">By Card Recommender</a> and <a href="/authors/other">Other Card Writer</a></div><p>By <a href="/authors/linked-card-writer">Linked Card Writer</a></p></article><article><h1><a href="/story">Current story heading</a></h1><div class="byline">By Page Writer</div></article>`;
    const result = parseHtml({ html, pageUrl: page });
    expect(result.author.name).toBe("Page Writer");
    expect(result.review).toEqual([]);
  });

  test("treats cards, feed, and teasers as collections only with story evidence", () => {
    for (const key of ["cards", "feed", "teasers"]) {
      const data = {
        [key]: [{ itemType: "story", title: "A headline", url: "/story", author: { name: "Listing Writer" } }],
      };
      const result = parseHtml({ html: `<script id="static-page">${JSON.stringify(data)}</script>`, pageUrl: page });
      expect(result.author.name, key).toBe("Unknown Author");
      expect(result.review, key).toEqual([]);
    }
  });
  test("listing-card email and social links cannot leak into the target author", () => {
    const lineup = {
      type: "lineup",
      content: [
        {
          itemType: "story",
          author: { name: "Card Contact Writer", email: "card@example.org", twitter: "https://x.com/cardwriter" },
        },
      ],
    };
    const result = parseHtml({ html: `<script id="static-page">${JSON.stringify(lineup)}</script>`, pageUrl: page });
    expect(result.author.name).toBe("Unknown Author");
    expect(result.author.email).toBeUndefined();
    expect(result.author.socials).toEqual([]);
    expect(result.review).toEqual([]);
  });

  test("keeps an explicit page author while sibling listing cards are excluded", () => {
    const data = {
      author: { name: "Page Writer", id: "page-7" },
      main: [{ type: "lineup", content: [{ itemType: "story", author: { name: "Card Writer" } }] }],
    };
    const result = parseHtml({ html: `<script id="static-page">${JSON.stringify(data)}</script>`, pageUrl: page });
    expect(result.author).toMatchObject({ name: "Page Writer", id: "page-7" });
    expect(result.review).toEqual([]);
  });

  test("propagates listing context through nested lineup containers", () => {
    const data = {
      type: "lineup",
      content: [{ type: "lineup", content: [{ itemType: "story", author: { name: "Nested Card Writer" } }] }],
    };
    const result = parseHtml({ html: `<script id="static-page">${JSON.stringify(data)}</script>`, pageUrl: page });
    expect(result.author.name).toBe("Unknown Author");
    expect(result.authors).toEqual([]);
    expect(result.review).toEqual([]);
  });

  test("retains unrelated reviewer evidence without promoting it to the author", () => {
    const ld = {
      "@type": "NewsArticle",
      url: page,
      author: { "@type": "Person", name: "Page Writer" },
      reviewer: { "@type": "Person", name: "Independent Reviewer", email: "reviewer@example.org" },
    };
    const result = parseHtml({
      html: `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Page Writer");
    expect(
      result.review.some(
        ({ author, reason }) =>
          author.name === "Independent Reviewer" &&
          reason === "different_identity" &&
          author.email === "reviewer@example.org",
      ),
    ).toBe(true);
  });

  test("keeps ordinary navigation links out of the DOM article set", () => {
    const result = parseHtml({
      html: `<nav><h2><a href="/about">A sufficiently long navigation section link</a></h2></nav>`,
      pageUrl: page,
    });
    expect(result.articles).toEqual([]);
  });

  test("does not treat arbitrary generic content as a collection", () => {
    const result = parseHtml({
      html: `<script id="static-page">${JSON.stringify({ content: [{ author: { name: "Explicit Writer", id: "writer-1" } }] })}</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Explicit Writer");
  });
});
