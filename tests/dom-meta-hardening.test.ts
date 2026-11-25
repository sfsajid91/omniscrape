import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const storyUrl = "https://news.example/2026/05/climate-bill";

describe("DOM/meta attribution isolation and hardening", () => {
  test.each([
    ["comments class", '<section class="comments">', "</section>"],
    ["comment class", '<div class="comment">', "</div>"],
    ["comment itemprop", '<div itemprop="comment">', "</div>"],
    ["comments id", '<section id="comments">', "</section>"],
    ["related-posts", '<section class="related-posts">', "</section>"],
    ["related-stories", '<section class="related-stories">', "</section>"],
    ["more-stories", '<section class="more-stories">', "</section>"],
    ["trending", '<section class="trending">', "</section>"],
    ["most-popular", '<section class="most-popular">', "</section>"],
    ["dialog", "<dialog>", "</dialog>"],
    ["aria-hidden", '<div aria-hidden="true">', "</div>"],
  ])("excludes bylines and contacts inside %s", (_label, open, close) => {
    const excludedBlock = `${open}<div class="byline"><a href="/author/other">Other Writer</a><a href="mailto:other@example.org">Email</a></div>${close}`;

    const isolated = parseHtml({ html: excludedBlock, pageUrl: storyUrl });
    expect(isolated.author.name).toBe("Unknown Author");
    expect(isolated.authors).toEqual([]);
    expect(isolated.review).toEqual([]);

    const withPrimary = parseHtml({
      html: `<div class="byline"><a href="/author/alice">Alice Reporter</a></div>${excludedBlock}`,
      pageUrl: storyUrl,
    });
    expect(withPrimary.author.name).toBe("Alice Reporter");
    expect(withPrimary.author.email).toBeUndefined();
    expect(withPrimary.review).toEqual([]);
  });

  test("rejects Microdata author scopes with Organization or NewsMediaOrganization itemtype", () => {
    const orgDirect = parseHtml({
      html: `<div itemprop="author" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">Daily Chronicle</span></div>`,
      pageUrl: storyUrl,
    });
    expect(orgDirect.author.name).toBe("Unknown Author");
    expect(orgDirect.review).toEqual([]);

    const newsOrg = parseHtml({
      html: `<div itemprop="author" itemscope itemtype="https://schema.org/NewsMediaOrganization"><span itemprop="name">Global News Desk</span></div>`,
      pageUrl: storyUrl,
    });
    expect(newsOrg.author.name).toBe("Unknown Author");

    const nestedOrg = parseHtml({
      html: `<div class="byline" itemprop="author"><div itemscope itemtype="https://schema.org/Organization"><span itemprop="name">Wire Service Corp</span></div></div>`,
      pageUrl: storyUrl,
    });
    expect(nestedOrg.author.name).toBe("Unknown Author");
  });

  test("preserves Person microdata author when a nested worksFor Organization is present", () => {
    const result = parseHtml({
      html: `<div itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Alice Reporter</span><span itemprop="worksFor" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">Daily Chronicle</span></span></div>`,
      pageUrl: storyUrl,
    });
    expect(result.author.name).toBe("Alice Reporter");
    expect(result.authors.map(({ name }) => name)).toEqual(["Alice Reporter"]);
  });

  test("groups repeated author meta tags sharing the same key as co-authors", () => {
    const repeatedOg = parseHtml({
      html: `<head><meta property="article:author" content="Alice Reporter"><meta property="article:author" content="Bob Writer"></head>`,
      pageUrl: storyUrl,
    });
    expect(repeatedOg.author.name).toBe("Unknown Author");
    expect(repeatedOg.authors.map(({ name }) => name)).toEqual(["Alice Reporter", "Bob Writer"]);

    const repeatedParsely = parseHtml({
      html: `<head><meta name="parsely-author" content="Carla Analyst"><meta name="parsely-author" content="David Editor"></head>`,
      pageUrl: storyUrl,
    });
    expect(repeatedParsely.authors.map(({ name }) => name)).toEqual(["Carla Analyst", "David Editor"]);

    const differentKeys = parseHtml({
      html: `<head><meta name="author" content="Alice Reporter"><meta name="parsely-author" content="Bob Writer"></head>`,
      pageUrl: storyUrl,
    });
    expect(differentKeys.authors).toEqual([]);
    expect(differentKeys.review.map(({ author }) => author.name).sort()).toEqual(["Alice Reporter", "Bob Writer"]);
  });

  test("prefers document title over inline SVG title elements", () => {
    const withHeadTitle = parseHtml({
      html: `<html><head><title>Real Headline</title></head><body><svg><title>Logo Icon</title></svg></body></html>`,
      pageUrl: storyUrl,
    });
    expect(withHeadTitle.metadata.title).toBe("Real Headline");

    const svgBeforeBodyTitle = parseHtml({
      html: `<svg><title>Menu Icon</title></svg><title>Fragment Title</title>`,
      pageUrl: storyUrl,
    });
    expect(svgBeforeBodyTitle.metadata.title).toBe("Fragment Title");

    const svgTitleOnly = parseHtml({
      html: `<html><head></head><body><svg><title>Search Icon</title></svg><h1>Story</h1></body></html>`,
      pageUrl: storyUrl,
    });
    expect(svgTitleOnly.metadata.title).toBeUndefined();
  });

  test("separates adjacent byline spans and excludes role elements from author name", () => {
    const adjacent = parseHtml({
      html: `<div class="byline"><span>By</span><span>Alice Reporter</span></div>`,
      pageUrl: storyUrl,
    });
    expect(adjacent.author.name).toBe("Alice Reporter");

    const withRole = parseHtml({
      html: `<div class="byline">By <span>Alice Reporter</span><span class="author-role">Senior Editor</span></div>`,
      pageUrl: storyUrl,
    });
    expect(withRole.author.name).toBe("Alice Reporter");
    expect(withRole.author.designation).toBe("Senior Editor");

    const withJobTitle = parseHtml({
      html: `<div class="byline"><span>By</span><span>Alice Reporter</span><span itemprop="jobTitle">Climate Correspondent</span><span class="role">Staff</span></div>`,
      pageUrl: storyUrl,
    });
    expect(withJobTitle.author.name).toBe("Alice Reporter");
    expect(withJobTitle.author.designation).toBe("Climate Correspondent");
  });

  test("strips optional colon after By/Written by and preserves generational suffixes", () => {
    const colonBy = parseHtml({
      html: `<div class="byline">By: Alice Reporter</div>`,
      pageUrl: storyUrl,
    });
    expect(colonBy.author.name).toBe("Alice Reporter");

    const colonWrittenBy = parseHtml({
      html: `<div class="byline">Written by: Alice Reporter</div>`,
      pageUrl: storyUrl,
    });
    expect(colonWrittenBy.author.name).toBe("Alice Reporter");

    const jrSingle = parseHtml({
      html: `<div class="byline">By John Smith, Jr.</div>`,
      pageUrl: storyUrl,
    });
    expect(jrSingle.author.name).toBe("John Smith, Jr.");
    expect(jrSingle.authors).toHaveLength(1);

    const jrCoAuthor = parseHtml({
      html: `<div class="byline">By John Smith, Jr., and Jane Doe</div>`,
      pageUrl: storyUrl,
    });
    expect(jrCoAuthor.authors.map(({ name }) => name)).toEqual(["John Smith, Jr.", "Jane Doe"]);

    const romanSuffix = parseHtml({
      html: `<meta name="author" content="Robert Davis, III, PhD">`,
      pageUrl: storyUrl,
    });
    expect(romanSuffix.author.name).toBe("Robert Davis, III");
  });

  test("filters credentials, wire agencies, and job-title phrases while preserving multi-author lists", () => {
    const credentials = parseHtml({
      html: `<div class="byline">By Jane Doe, Ph.D., M.D., MPH</div>`,
      pageUrl: storyUrl,
    });
    expect(credentials.author.name).toBe("Jane Doe");

    const wireSuffix = parseHtml({
      html: `<div class="byline">By Alice Smith, Reuters</div>`,
      pageUrl: storyUrl,
    });
    expect(wireSuffix.author.name).toBe("Alice Smith");

    for (const agency of [
      "Reuters",
      "Associated Press",
      "The Associated Press",
      "AP",
      "AFP",
      "Bloomberg News",
      "Staff",
      "Editorial Board",
    ]) {
      const agencyOnly = parseHtml({
        html: `<div class="byline">By ${agency}</div>`,
        pageUrl: storyUrl,
      });
      expect(agencyOnly.author.name, agency).toBe("Unknown Author");
    }

    const jobTitleCases = [
      "By Jane Doe, Senior Political Correspondent",
      "By Jane Doe, Washington Bureau Chief",
      "By Jane Doe, Executive Producer",
      "By Jane Doe, Special to The Washington Post",
      "By Jane Doe, for Example News",
      "By Jane Doe, Director of Photography",
      "By Jane Doe, Staff Reporter",
    ];
    for (const byline of jobTitleCases) {
      const result = parseHtml({ html: `<div class="byline">${byline}</div>`, pageUrl: storyUrl });
      expect(result.author.name, byline).toBe("Jane Doe");
    }

    const twoAuthors = parseHtml({
      html: `<div class="byline">By Alice Reporter, Bob Analyst</div>`,
      pageUrl: storyUrl,
    });
    expect(twoAuthors.authors.map(({ name }) => name)).toEqual(["Alice Reporter", "Bob Analyst"]);

    const threeAuthors = parseHtml({
      html: `<div class="byline">By Alice Smith, Bob Jones, and Carol Lee</div>`,
      pageUrl: storyUrl,
    });
    expect(threeAuthors.authors.map(({ name }) => name)).toEqual(["Alice Smith", "Bob Jones", "Carol Lee"]);
  });

  test("recognizes accented and non-Latin unmarked linked bylines without matching lowercase prose", () => {
    const accented = parseHtml({
      html: `<p>By <a href="/author/oscar-garcia">Óscar García</a></p>`,
      pageUrl: storyUrl,
    });
    expect(accented.author.name).toBe("Óscar García");

    const cjk = parseHtml({
      html: `<p>By <a href="/author/tanaka">田中太郎</a></p>`,
      pageUrl: storyUrl,
    });
    expect(cjk.author.name).toBe("田中太郎");

    const bengali = parseHtml({
      html: `<p>Written by <a href="/author/farhan">ফারহান আহমেদ</a></p>`,
      pageUrl: storyUrl,
    });
    expect(bengali.author.name).toBe("ফারহান আহমেদ");

    const prose = parseHtml({
      html: `<p>By partnering with <a href="https://vendor.example/">Vendor Company</a>, we expanded coverage.</p>`,
      pageUrl: storyUrl,
    });
    expect(prose.author.name).toBe("Unknown Author");
  });

  test("extracts uppercase mailto links and recognizes extended author profile routes", () => {
    const mailto = parseHtml({
      html: `<div class="byline"><a href="/writers/alice-smith">Alice Smith</a><a href="MAILTO:Alice@Example.org">Email</a></div>`,
      pageUrl: storyUrl,
    });
    expect(mailto.author.name).toBe("Alice Smith");
    expect(mailto.author.slug).toBe("alice-smith");
    expect(mailto.author.email).toBe("alice@example.org");

    for (const route of [
      "/writer/jane",
      "/writers/jane",
      "/staff/jane",
      "/people/jane",
      "/profile/jane",
      "/reporter/jane",
      "/reporters/jane",
      "/by/jane",
    ]) {
      const result = parseHtml({
        html: `<div class="byline">By <a href="${route}">Jane Reporter</a></div>`,
        pageUrl: storyUrl,
      });
      expect(result.author.name, route).toBe("Jane Reporter");
      expect(result.author.slug, route).toBe("jane");
    }

    const coAuthors = parseHtml({
      html: `<div class="byline">By <a href="/staff/alice">Alice Smith</a> and <a href="/reporters/bob">Bob Jones</a></div>`,
      pageUrl: storyUrl,
    });
    expect(coAuthors.authors.map(({ name, slug }) => [name, slug])).toEqual([
      ["Alice Smith", "alice"],
      ["Bob Jones", "bob"],
    ]);

    const blueskyInCard = parseHtml({
      html: `<div class="byline"><span class="author-name">Alice Smith</span><a href="https://bsky.app/profile/alice.bsky.social">Bluesky</a></div>`,
      pageUrl: storyUrl,
    });
    expect(blueskyInCard.author.name).toBe("Alice Smith");
    expect(blueskyInCard.author.socials).toContainEqual(
      expect.objectContaining({ platform: "bluesky", handle: "alice.bsky.social" }),
    );
  });

  test("excludes site header logos, bare homepage links, and short nav links from DOM articles", () => {
    const result = parseHtml({
      html: `<html><body>
        <header><h1><a href="/">The Daily Chronicle Newsroom</a></h1><h2><a href="/subscribe">Subscribe to The Daily Chronicle</a></h2></header>
        <main>
          <article><h2><a href="/">Back to The Daily Chronicle Homepage</a></h2></article>
          <article><h2><a href="/#top">Homepage Anchor Link Title</a></h2></article>
          <article><h2><a href="/sections/news">Top New</a></h2></article>
          <article><h1><a href="/news/short">Oil Dips</a></h1></article>
          <article><header><h2><a href="/stories/header-story">Real story inside an article header</a></h2></header></article>
          <article><h2><a href="/?p=42">Query-based story URL remains valid</a></h2></article>
        </main>
      </body></html>`,
      pageUrl: "https://news.example/world",
    });

    expect(result.articles).toEqual([
      { title: "Oil Dips", url: "https://news.example/news/short" },
      { title: "Real story inside an article header", url: "https://news.example/stories/header-story" },
      { title: "Query-based story URL remains valid", url: "https://news.example/?p=42" },
    ]);
  });
});
