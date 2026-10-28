import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const profileUrl = "https://www.businessinsider.com/author/ac-fowler";
const domEmail = "afowler@insider.com";
const bioEmail = "afowler@businessinsider.com";

const person = (properties: Record<string, unknown>) =>
  `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: { "@type": "Person", name: "A.C. Fowler", url: profileUrl, ...properties },
  })}</script>`;

const authorSection = (content: string) =>
  `<section class="homepage-container landing-page author-page"><h1>A.C. Fowler</h1>${content}</section>`;

describe("issue #7 author profile email extraction", () => {
  test("extracts a mailto contact from a Business Insider author page", () => {
    const result = parseHtml({
      pageUrl: profileUrl,
      html: authorSection(`<div class="author-contact"><a href="mailto:${domEmail}">Email</a></div>`),
    });

    expect(result.author.email).toBe(domEmail);
    expect(result.author.emails).toContain(domEmail);
    expect(result.provenance.some((item) => item.field === "author.email" && item.source === "dom-author")).toBe(true);
  });

  test("extracts a contact email embedded in the primary JSON-LD Person description", () => {
    const result = parseHtml({
      pageUrl: profileUrl,
      html: person({ description: "If you have story ideas, you can reach A. C. at afowler@businessinsider.com." }),
    });

    expect(result.author.email).toBe(bioEmail);
    expect(result.author.emails).toContain(bioEmail);
    expect(
      result.provenance.some(
        (item) =>
          item.field === "author.email" && item.source === "json-ld" && item.sourcePath.endsWith(".description"),
      ),
    ).toBe(true);
  });

  test("extracts a description email after a question mark", () => {
    const result = parseHtml({
      pageUrl: profileUrl,
      html: person({ description: `Have a story tip? Email ${bioEmail}.` }),
    });

    expect(result.author.email).toBe(bioEmail);
    expect(
      result.provenance.some(
        (item) =>
          item.field === "author.email" && item.source === "json-ld" && item.sourcePath.endsWith(".description"),
      ),
    ).toBe(true);
  });

  test("ignores mailto query parameters when extracting profile contacts", () => {
    const result = parseHtml({
      pageUrl: profileUrl,
      html: authorSection(`<a href="mailto:${domEmail}?cc=other@example.com">Email</a>`),
    });

    expect(result.author.email).toBe(domEmail);
    expect(result.author.emails).not.toContain("other@example.com");
  });

  test("does not attribute a listing author's social link to the profile", () => {
    const result = parseHtml({
      pageUrl: profileUrl,
      html: authorSection(
        `<a href="https://x.com/acfowler">Profile</a><article><h2><a href="/another-story">Another story</a></h2><a href="https://x.com/otherwriter">Twitter</a></article>`,
      ),
    });

    expect(result.author.socials?.map((social) => social.url)).toContain("https://x.com/acfowler");
    expect(result.author.socials?.map((social) => social.url)).not.toContain("https://x.com/otherwriter");
  });

  test("retains distinct profile addresses and quarantines the singular conflict", () => {
    const result = parseHtml({
      pageUrl: profileUrl,
      html: `${authorSection(`<a href="mailto:${domEmail}">Email</a>`)}${person({ description: `Reach A. C. at ${bioEmail}.` })}`,
    });

    expect(result.author.emails).toContain(domEmail);
    expect(result.author.emails).toContain(bioEmail);
    expect(result.author.email).toBeUndefined();
    expect(result.review.some((item) => item.reason === "conflicting_value")).toBe(true);
  });

  test("prefers an explicit Person email over a different description address", () => {
    const result = parseHtml({
      pageUrl: profileUrl,
      html: person({ email: "explicit@businessinsider.com", description: `Reach A. C. at ${bioEmail}.` }),
    });

    expect(result.author.email).toBe("explicit@businessinsider.com");
    expect(result.author.emails).toContain("explicit@businessinsider.com");
    expect(result.author.emails).not.toContain(bioEmail);
  });

  test("rejects a generic newsroom contact in a Person description", () => {
    const result = parseHtml({
      pageUrl: profileUrl,
      html: person({ description: "Contact newsroom@businessinsider.com for more information." }),
    });

    expect(result.author.email).toBeUndefined();
    expect(result.author.emails ?? []).not.toContain("newsroom@businessinsider.com");
  });

  test("does not attribute a related article mailto to the profile", () => {
    const result = parseHtml({
      pageUrl: profileUrl,
      html: authorSection(
        `<article><h2><a href="/some-story">Related story</a></h2><a href="mailto:story@businessinsider.com">Email</a></article>`,
      ),
    });

    expect(result.author.email).toBeUndefined();
    expect(result.author.emails ?? []).not.toContain("story@businessinsider.com");
  });

  test("does not use a Person attached only to a non-current article", () => {
    const result = parseHtml({
      pageUrl: profileUrl,
      html: `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        url: "https://www.businessinsider.com/another-story",
        author: { "@type": "Person", name: "A.C. Fowler", url: profileUrl, description: `Reach A. C. at ${bioEmail}.` },
      })}</script>`,
    });

    expect(result.author.email).toBeUndefined();
    expect(result.author.emails ?? []).not.toContain(bioEmail);
  });
});
