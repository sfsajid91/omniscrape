import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";
import { isAuthorProfileUrl } from "../src/values";

const page = "https://publisher.example/profile/nicola-davis";

describe("profile route and biography extraction", () => {
  test("recognizes only supported profile and numeric people routes", () => {
    expect(isAuthorProfileUrl("https://publisher.example/profile/nicola-davis/?from=site#bio")).toBe(true);
    expect(isAuthorProfileUrl("https://publisher.example/people/2100394/tony-cox")).toBe(true);
    expect(isAuthorProfileUrl("https://publisher.example/people/2100394/tony-cox/posts")).toBe(false);
    expect(isAuthorProfileUrl("https://publisher.example/profile/edit")).toBe(false);
    expect(isAuthorProfileUrl("https://publisher.example/profile")).toBe(false);
  });

  test("accepts a scoped h2 profile heading but not an unscoped headline", () => {
    const result = parseHtml(
      `<section class="author-profile"><h2>Nicola Davis</h2><p class="author-bio">Nicola Davis reports on science and the natural world.</p></section>`,
      page,
    );
    expect(result.author.name).toBe("Nicola Davis");
  });

  test("requires matching Guardian slug, headshot, and biography corroborators", () => {
    const result = parseHtml(
      `<section class="hashed-profile"><h2>Nicola Davis</h2><picture><img alt="Headshot of Nicola Davis" src="/nicola.jpg"></picture><p>Nicola Davis is an environment correspondent covering wildlife and climate.</p></section>`,
      page,
    );
    expect(result.author).toMatchObject({
      name: "Nicola Davis",
      avatarUrl: "https://publisher.example/nicola.jpg",
      bio: "Nicola Davis is an environment correspondent covering wildlife and climate.",
    });
    expect(
      result.provenance.some(({ field, sourcePath }) => field === "author.bio" && sourcePath.includes("p:nth-of-type")),
    ).toBe(true);
  });

  test("does not trust a Guardian heading when one structural corroborator disagrees", () => {
    const result = parseHtml(
      `<section><h2>Nicola Davis</h2><img alt="Headshot of Another Writer" src="/other.jpg"><p>Nicola Davis writes about wildlife and climate policy.</p></section>`,
      page,
    );
    expect(result.author.name).toBe("Unknown Author");
  });

  test("extracts NPR archived bio only from a matching speakable pair", () => {
    const url = "https://publisher.example/people/2100394/tony-cox";
    const result = parseHtml(
      `<header class="contentheader--archived-bio"><h2 class="branding__title">Tony Cox</h2></header><div class="speakable"><b data-is-speakable="true">Tony Cox</b><b data-is-speakable="true">Tony Cox has covered public radio and national affairs for decades.</b></div>`,
      url,
    );
    expect(result.author).toMatchObject({
      name: "Tony Cox",
      bio: "Tony Cox has covered public radio and national affairs for decades.",
    });
    expect(
      result.provenance.some(
        ({ field, sourcePath }) => field === "author.bio" && sourcePath.includes("b:nth-of-type(2)"),
      ),
    ).toBe(true);
  });

  test("ignores a mismatched NPR speakable pair and does not promote bio links to articles", () => {
    const url = "https://publisher.example/people/2100394/tony-cox";
    const result = parseHtml(
      `<header class="contentheader--archived-bio"><h2 class="branding__title">Tony Cox</h2></header><div class="speakable"><b data-is-speakable="true">Another Person</b><b data-is-speakable="true">Tony Cox has covered public radio and national affairs for decades.</b></div><section class="author-wrapper river-item"><div class="author-description"><a href="/award">A long award link inside this biography</a></div></section><section class="river-item"><h2><a href="/real">A sufficiently long genuine story headline</a></h2></section>`,
      url,
    );
    expect(result.author.bio).toBeUndefined();
    expect(result.articles.map(({ url: articleUrl }) => articleUrl)).toEqual(["https://publisher.example/real"]);
  });
  test("preserves existing author routes and accepts profile URL trailing variants", () => {
    for (const route of [
      "/author/alice",
      "/authors/alice",
      "/contributor/alice",
      "/contributors/alice",
      "/staff/alice",
      "/people/alice",
      "/profile/alice/?page=2#bio",
    ]) {
      expect(isAuthorProfileUrl(`https://publisher.example${route}`), route).toBe(true);
    }
  });

  test("rejects account operation routes", () => {
    for (const route of [
      "/profile/edit",
      "/profile/settings",
      "/profile/login",
      "/profile/signup",
      "/profile/search",
      "/people/2100394/edit",
    ]) {
      expect(isAuthorProfileUrl(`https://publisher.example${route}`), route).toBe(false);
    }
  });

  test("prefers the scoped h1 over a secondary profile heading", () => {
    const result = parseHtml(
      `<section class="author-profile"><h1>Nicola Davis</h1><h2>Previous contributors</h2></section>`,
      page,
    );
    expect(result.author.name).toBe("Nicola Davis");
  });

  test("requires the Guardian profile heading to match the final URL slug", () => {
    const result = parseHtml(
      `<section><h2>Another Writer</h2><img alt="Portrait of Another Writer"><p>Another Writer covers environmental policy and conservation.</p></section>`,
      page,
    );
    expect(result.author.name).toBe("Unknown Author");
  });

  test("requires the Guardian biography paragraph to begin with the heading name", () => {
    const result = parseHtml(
      `<section><h2>Nicola Davis</h2><img alt="Portrait of Nicola Davis"><p>Environment correspondent Nicola Davis covers climate and wildlife.</p></section>`,
      page,
    );
    expect(result.author.name).toBe("Unknown Author");
  });

  test("does not promote a generic h2 even inside an author-profile class on a story URL", () => {
    const result = parseHtml(
      `<section class="author-profile"><h2>Nicola Davis</h2><p class="author-bio">Nicola Davis covers science and wildlife reporting.</p></section>`,
      "https://publisher.example/story",
    );
    expect(result.author.name).toBe("Unknown Author");
  });

  test("requires the next NPR speakable sibling to be a matching-length biography", () => {
    const url = "https://publisher.example/people/2100394/tony-cox";
    const result = parseHtml(
      `<header class="contentheader--archived-bio"><h2 class="branding__title">Tony Cox</h2></header><div><b data-is-speakable="true">Tony Cox</b><i>intervening text</i><b data-is-speakable="true">Tony Cox has covered radio.</b></div>`,
      url,
    );
    expect(result.author.name).toBe("Tony Cox");
    expect(result.author.bio).toBeUndefined();
  });

  test("keeps hydration profile resources aligned with the shared profile route helper", () => {
    const url = "https://publisher.example/people/2100394/tony-cox";
    const payload = {
      props: {
        pageProps: { resource: { __typename: "AuthorProfileResourceType", fullName: "Tony Cox", authorId: 2100394 } },
      },
    };
    const result = parseHtml(`<script id="__NEXT_DATA__">${JSON.stringify(payload)}</script>`, url);
    expect(result.author.name).toBe("Tony Cox");
  });
});
