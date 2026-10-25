import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { createPageContext, DEFAULT_LIMITS } from "../src/core/context";
import { extractDomAndMeta } from "../src/extractors/dom-meta";

function extract(html: string, pageUrl = "https://news.example/story/current") {
  const { document } = parseHTML(html);
  return extractDomAndMeta(createPageContext(document, html, pageUrl, DEFAULT_LIMITS));
}

describe("DOM and metadata extraction", () => {
  test("uses explicit author evidence, not the article headline or social share links", () => {
    const result = extract(`<html><head><title>City council approves privacy policy</title><meta property="og:title" content="City council approves privacy policy"><meta name="author" content="Alice Reporter"></head><body><h1>City council approves privacy policy</h1><div class="share"><a href="https://twitter.com/intent/share?url=x">Share</a></div><footer><div class="byline"><a href="/author/bob">Bob Footer</a></div></footer><div class="byline"><a rel="author" href="/author/alice">Alice Reporter</a><a href="https://not-twitter.com/alice">Social</a></div><article><h2><a href="/privacy-story">A detailed privacy story with a valid headline</a></h2></article></body></html>`);
    expect(result.authors.some((author) => author.profile.name === "Alice Reporter")).toBe(true);
    expect(result.authors.some((author) => author.profile.name === "City council approves privacy policy")).toBe(false);
    expect(result.authors.some((author) => author.profile.name === "Bob Footer")).toBe(false);
    expect(result.authors.flatMap((author) => author.profile.socials ?? [])).toHaveLength(0);
    expect(result.articles.map(({ article }) => article.title)).toContain("A detailed privacy story with a valid headline");
  });

  test("keeps people and scoped profile evidence separate; normalizes relative URLs", () => {
    const result = extract(`<html><head><base href="https://cdn.example/content/"><meta property="og:image" content="../media/page.jpg"><link rel="canonical" href="../story"></head><body><section class="author-card"><div class="author-name">Alice Smith</div><p class="author-bio">Alice reports on the city and has covered local government for many years.</p><img class="author-avatar" src="../alice.jpg"><a href="https://www.linkedin.com/in/alicesmith">Profile</a><a href="mailto:alice@example.org">Email</a></section><section class="author-card"><div class="author-name">Bob Jones</div><p class="author-bio">Bob writes about local business and has reported on markets for many years.</p><img class="author-avatar" src="javascript:alert(1)"></section><h1>Article headline only</h1><aside><a href="https://twitter.com/newsdesk">Newsroom</a></aside></body></html>`, "https://news.example/original");
    expect(result.metadata.canonicalUrl).toBe("https://cdn.example/story");
    expect(result.metadata.ogImage).toBe("https://cdn.example/media/page.jpg");
    expect(result.authors.map((author) => author.profile.name)).toEqual(["Alice Smith", "Bob Jones"]);
    expect(result.authors[0]?.profile.bio).toContain("Alice reports");
    expect(result.authors[0]?.profile.avatarUrl).toBe("https://cdn.example/alice.jpg");
    expect(result.authors[1]?.profile.avatarUrl).toBeUndefined();
    expect(result.authors[0]?.profile.email).toBe("alice@example.org");
    expect(result.authors.every((author) => !author.profile.name?.includes("Article headline"))).toBe(true);
    expect(result.authors.flatMap((author) => author.profile.socials ?? []).map(({ url }) => url)).toEqual(["https://www.linkedin.com/in/alicesmith"]);
  });

  test("recognizes profile headings only with profile URL and author scope; rejects unsafe URLs", () => {
    const result = extract(`<html><head><meta property="og:url" content="javascript:alert(1)"><meta property="og:image" content="data:image/png;base64,AAAA"></head><body><section class="author-header"><h1>Carla Writer</h1><p class="author-bio">Carla has written about public policy and local elections for many years.</p><a href="javascript:alert(1)">unsafe</a></section></body></html>`, "https://news.example/authors/carla");
    expect(result.authors[0]?.profile.name).toBe("Carla Writer");
    expect(result.metadata.canonicalUrl).toBe("https://news.example/authors/carla");
    expect(result.metadata.ogImage).toBeUndefined();
    expect(result.authors[0]?.profile.socials).toEqual([]);
  });

  test("excludes share, footer, and navigation links; caps article results in DOM order", () => {
    const cards = Array.from({ length: 25 }, (_, index) => `<article><h2><a href="/story/${index}">A sufficiently descriptive article headline number ${index}</a></h2></article>`).join("");
    const result = extract(`<body><nav><h2><a href="/nav">A navigation headline which is definitely long</a></h2></nav><div class="social-share"><h2><a href="/share">A sharing headline which is definitely long</a></h2></div>${cards}<footer><h2><a href="/footer">A footer headline which is definitely long</a></h2></footer></body>`);
    expect(result.articles).toHaveLength(20);
    expect(result.articles[0]?.article.url).toBe("https://news.example/story/0");
    expect(result.articles.at(-1)?.article.url).toBe("https://news.example/story/19");
    expect(result.articles.some(({ article }) => /nav|share|footer/.test(article.url))).toBe(false);
  });

  test("honors explicit role and name selectors without inferring generic H1", () => {
    const result = extract(`<body><h1>Our privacy and terms coverage</h1><div data-testid="author"><span>Jordan Reporter</span></div><div role="navigation"><a href="mailto:desk@example.org">Desk</a></div></body>`);
    expect(result.authors.map((author) => author.profile.name)).toContain("Jordan Reporter");
    expect(result.authors.map((author) => author.profile.name)).not.toContain("Our privacy and terms coverage");
    expect(result.authors.some((author) => author.profile.email === "desk@example.org")).toBe(false);
  });

  test("reads plain byline text and strips its By label", () => {
    const result = extract(`<body><div class="byline">By Alice Reporter</div></body>`, "https://news.example/story");
    expect(result.authors.map((author) => author.profile.name)).toEqual(["Alice Reporter"]);
    expect(result.authors[0]?.primary).toBe(true);
    expect(result.authors[0]?.evidence.name?.scope).toBe("byline");
  });

  test("keeps every meta author and rejects profile URLs in article:author", () => {
    const names = extract(`<head><meta name="author" content="Alice Reporter, Bob Writer"></head>`, "https://news.example/story");
    expect(names.authors.map((author) => author.profile.name)).toEqual(["Alice Reporter", "Bob Writer"]);

    const url = extract(`<head><meta property="article:author" content="https://facebook.com/alice"></head>`, "https://news.example/story");
    expect(url.authors).toHaveLength(0);
  });

  test("emits linked co-authors without lending one person's contacts to another", () => {
    const result = extract(`<body><div class="byline">By <a href="/author/alice">Alice Reporter</a> and <a href="/author/bob">Bob Writer</a></div></body>`, "https://news.example/story");
    expect(result.authors.map((author) => author.profile.name)).toEqual(["Alice Reporter", "Bob Writer"]);
    expect(result.authors.map((author) => author.identity)).toEqual(["https://news.example/author/alice", "https://news.example/author/bob"]);
    expect(result.authors.every((author) => (author.profile.socials ?? []).length === 0 && !author.profile.email)).toBe(true);
  });
  test("uses only publication-labeled dates within the current story container", () => {
    const react = extract(`<main><article><div><h1>React 19</h1></div><div><p>December 05, 2024 by <a href="/community/team">The React Team</a></p></div></article><aside><time datetime="2020-01-01">January 1</time></aside></main>`, "https://react.dev/blog/2024/12/05/react-19");
    expect(react.metadata.publishedTime).toBe("2024-12-05T00:00:00.000Z");
    expect(react.fields.find(({ field }) => field === "metadata.publishedTime")?.evidence.confidence).toBe("low");
    const unrelated = extract(`<main><article><h1>Story</h1><p>Posted 31st December 2023</p></article></main>`, "https://news.example/story");
    expect(unrelated.metadata.publishedTime).toBeUndefined();
  });
  test("splits explicitly delimited author metadata and compact linked bylines", () => {
    const meta = extract(`<head><meta name="author" content="Nikita Yadav | Rachita Prasad" data-separator="|"></head>`, "https://news.example/story");
    expect(meta.authors.map(({ profile }) => profile.name)).toEqual(["Nikita Yadav", "Rachita Prasad"]);
    const byline = extract(`<p>By <a href="/nuxters/danielroe">Daniel Roe</a></p>`, "https://nuxt.com/blog/v3-12");
    expect(byline.authors.map(({ profile }) => profile.name)).toEqual(["Daniel Roe"]);
    expect(byline.authors[0]?.identity).toBe("https://nuxt.com/nuxters/danielroe");
  });
});
