import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const page = "https://publisher.example/story";
const ld = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

function profile(name: string, url: string, fields: Record<string, unknown> = {}) {
  return ld({ "@type": "ProfilePage", mainEntity: { "@type": "Person", name, url, ...fields } });
}

describe("review evidence consolidation", () => {
  test("merges complementary snapshots for each explicitly linked co-author", () => {
    const result = parseHtml(ld({
      "@type": "NewsArticle", url: page, author: [
        { "@type": "Person", name: "David Kim", url: "/authors/david-kim", email: "david@example.org" },
        { "@type": "Person", name: "Maria Garcia", url: "/authors/maria-garcia", email: "maria@example.org" },
      ]
    }) + `<div class="byline"><a href="/authors/david-kim">David Kim</a> and <a href="/authors/maria-garcia">Maria Garcia</a></div>`, page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.review.map(({ author }) => [author.name, author.email])).toEqual([
      ["David Kim", "david@example.org"], ["Maria Garcia", "maria@example.org"],
    ]);
    for (const item of result.review) {
      expect(new Set(item.provenance.map(({ source }) => source))).toEqual(new Set(["json-ld", "dom-author"]));
    }
  });

  test("keeps same-name people with different explicit identities separate", () => {
    const result = parseHtml(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          author: { name: "Alex Smith", url: "https://publisher.example/people/alex-one", email: "one@example.org" },
          profile: { name: "Alex Smith", url: "https://publisher.example/people/alex-two", email: "two@example.org" },
        }
      }
    })}</script>`, page);
    expect(result.review.map(({ author }) => author.email).sort()).toEqual(["one@example.org", "two@example.org"]);
  });

  test("retains both conflicting email snapshots for one explicit identity", () => {
    const identity = "https://publisher.example/authors/alice";
    const result = parseHtml(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          author: { name: "Alice Reporter", url: identity, email: "one@example.org" },
        }
      }
    })}</script>${profile("Alice Reporter", identity, { email: "two@example.org" })}`, page);
    expect(result.author.email).toBeUndefined();
    expect(result.review.filter(({ reason }) => reason === "conflicting_value").map(({ author }) => author.email).sort()).toEqual(["one@example.org", "two@example.org"]);
  });

  test("merges complementary role and biography evidence for an explicitly linked review identity", () => {
    const identity = "https://publisher.example/authors/david-kim";
    const current = ld({
      "@type": "NewsArticle", url: page, author: [
        { "@type": "Person", name: "David Kim", url: identity, email: "david@example.org" },
        { "@type": "Person", name: "Maria Garcia", url: "/authors/maria-garcia", email: "maria@example.org" },
      ]
    });
    const hydration = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { story: { author: { name: "David Kim", url: identity, role: "Senior Reporter", bio: "David Kim covers public policy and local government." } } } } })}</script>`;
    const result = parseHtml(hydration + current, page);
    const david = result.review.find(({ author }) => author.name === "David Kim");
    expect(david?.author).toMatchObject({ email: "david@example.org", designation: "Senior Reporter", bio: "David Kim covers public policy and local government." });
    expect(new Set(david?.provenance.map(({ source }) => source))).toEqual(new Set(["hydration:next-pages", "json-ld"]));
  });

  test("deduplicates repeated identical conflicting variants but keeps all source paths", () => {
    const identity = "https://publisher.example/authors/alice";
    const result = parseHtml(profile("Alice Reporter", identity, { email: "one@example.org" })
      + profile("Alice Reporter", identity, { email: "one@example.org" })
      + profile("Alice Reporter", identity, { email: "two@example.org" }), page);
    const conflicts = result.review.filter(({ reason }) => reason === "conflicting_value");
    expect(conflicts.map(({ author }) => author.email).sort()).toEqual(["one@example.org", "two@example.org"]);
    expect(new Set(conflicts.find(({ author }) => author.email === "one@example.org")?.provenance.filter(({ field }) => field === "author.email").map(({ sourcePath }) => sourcePath)).size).toBe(2);
  });

  test("preserves conflicting roles rather than selecting one by source order", () => {
    const identity = "https://publisher.example/authors/alice";
    const result = parseHtml(profile("Alice Reporter", identity, { jobTitle: "City Reporter" })
      + profile("Alice Reporter", identity, { jobTitle: "Investigations Editor" }), page);
    expect(result.author.designation).toBeUndefined();
    expect(result.review.filter(({ reason }) => reason === "conflicting_value").map(({ author }) => author.designation).sort()).toEqual(["City Reporter", "Investigations Editor"]);
  });

  test("does not merge a name-only snapshot into an identified review person", () => {
    const result = parseHtml(`<script id="__NEXT_DATA__">${JSON.stringify({
      props: {
        pageProps: {
          author: { name: "Alex Smith", url: "https://publisher.example/authors/alex", email: "alex@example.org" },
          contributor: { name: "Alex Smith" },
        }
      }
    })}</script>`, page);
    expect(result.author.name).toBe("Alex Smith");
    expect(result.author.email).toBe("alex@example.org");
  });
  test("keeps different names separate even when JSON-LD identities match", () => {
    const identity = "https://publisher.example/authors/alice";
    const result = parseHtml(profile("Alice Reporter", identity) + profile("Alicia Reporter", identity), page);
    expect(result.author.name).toBe("Unknown Author");
    expect(result.review.map(({ author }) => author.name).sort()).toEqual(["Alice Reporter", "Alicia Reporter"]);
  });

  test("unions personal socials and retains each source for duplicate links", () => {
    const identity = "https://publisher.example/authors/alice";
    const hydration = `<script id="__NEXT_DATA__">${JSON.stringify({
      props: {
        pageProps: {
          author: { name: "Alice Reporter", url: identity, twitter: "https://x.com/alice" },
        }
      }
    })}</script>`;
    const result = parseHtml(hydration + profile("Alice Reporter", identity, { sameAs: ["https://x.com/alice", "https://linkedin.com/in/alice"] }), page);
    expect(result.author.socials.map(({ url }) => url)).toEqual(["https://x.com/alice", "https://linkedin.com/in/alice"]);
    const twitter = result.provenance.filter(({ field, value }) => field === "author.socials" && value === "https://x.com/alice");
    expect(new Set(twitter.map(({ source }) => source))).toEqual(new Set(["hydration:next-pages", "json-ld"]));
  });

  test("withholds three-way conflicting emails regardless of source order", () => {
    const identity = "https://publisher.example/authors/alice";
    const results = [
      ["one@example.org", "two@example.org", "three@example.org"],
      ["three@example.org", "two@example.org", "one@example.org"],
    ].map((emails) => parseHtml(emails.map((email) => profile("Alice Reporter", identity, { email })).join(""), page));
    for (const result of results) {
      expect(result.author.email).toBeUndefined();
      expect(new Set(result.review.filter(({ reason }) => reason === "conflicting_value").map(({ author }) => author.email)))
        .toEqual(new Set(["one@example.org", "two@example.org", "three@example.org"]));
    }
  });

  test("preserves explicit reviewer provenance without treating the reviewer as a co-author", () => {
    const article = ld({ "@type": "NewsArticle", url: page, author: { "@type": "Person", name: "Alice Reporter", url: "/authors/alice" }, reviewer: { "@type": "Person", name: "Independent Reviewer", email: "reviewer@example.org" } });
    const result = parseHtml(article, page);
    expect(result.author.name).toBe("Alice Reporter");
    expect(result.authors.map(({ name }) => name)).toEqual(["Alice Reporter"]);
    expect(result.review.some(({ author, reason, provenance }) => author.name === "Independent Reviewer"
      && reason === "different_identity" && provenance.some(({ sourcePath }) => sourcePath.endsWith(".reviewer.email")))).toBe(true);
  });
});
