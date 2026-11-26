import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";
import { ParserOutputSchema } from "../src/types";

const ld = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

describe("Issue #15 JSON-LD hardening", () => {
  test("strips UTF-8 BOM and HTML/CDATA comment wrappers before JSON.parse", () => {
    const pageUrl = "https://example.com/stories/wrapped";
    const payloads = [
      `\uFEFF${JSON.stringify({ "@type": "NewsArticle", url: pageUrl, author: { "@type": "Person", name: "Bom Writer" } })}`,
      `<!-- ${JSON.stringify({ "@type": "NewsArticle", url: pageUrl, author: { "@type": "Person", name: "Html Comment Writer" } })} -->`,
      `<![CDATA[ ${JSON.stringify({ "@type": "NewsArticle", url: pageUrl, author: { "@type": "Person", name: "Cdata Writer" } })} ]]>`,
      `/* <![CDATA[ */ ${JSON.stringify({ "@type": "NewsArticle", url: pageUrl, author: { "@type": "Person", name: "Commented Cdata Writer" } })} /* ]]> */`,
    ];
    const expected = ["Bom Writer", "Html Comment Writer", "Cdata Writer", "Commented Cdata Writer"];
    for (const [index, raw] of payloads.entries()) {
      const result = parseHtml({
        html: `<script type="application/ld+json">${raw}</script>`,
        pageUrl,
      });
      expect(result.author.name).toBe(expected[index]!);
      expect(result.issues).toEqual([]);
      expect(ParserOutputSchema.safeParse(result).success).toBe(true);
    }
  });

  test.each([
    "OpinionNewsArticle",
    "LiveBlogPosting",
    "ReviewNewsArticle",
    "BackgroundNewsArticle",
    "AskPublicNewsArticle",
    "SocialMediaPosting",
    "SatiricalArticle",
    "MedicalScholarlyArticle",
  ])("recognizes %s as a current article type", (articleType) => {
    const pageUrl = `https://example.com/articles/${articleType.toLowerCase()}`;
    const result = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@type": articleType,
        url: pageUrl,
        headline: `Headline for ${articleType}`,
        datePublished: "2026-05-01T10:15:00Z",
        publisher: { "@type": "Organization", name: "Example Daily" },
        author: { "@type": "Person", name: "Alice Reporter", url: "/author/alice" },
      }),
      pageUrl,
    });
    expect(result.author.name).toBe("Alice Reporter");
    expect(result.editorial.publisher).toBe("Example Daily");
    expect(result.metadata.publishedTime).toBe("2026-05-01T10:15:00.000Z");
    expect(result.articles).toHaveLength(1);
  });

  test("links non-HTTP URI @ids and blank nodes without leaking them as HTTP identities", () => {
    const pageUrl = "https://example.com/stories/linked-ids";
    const cases = [
      { id: "urn:uuid:11111111-2222-3333-4444-555555555555", name: "Urn Author" },
      { id: "tag:example.com,2026:author-1", name: "Tag Author" },
      { id: "did:web:example.com:alice", name: "Did Author" },
      { id: "_:b0", name: "Blank Node Author" },
    ];
    for (const { id, name } of cases) {
      const result = parseHtml({
        html: ld({
          "@context": "https://schema.org",
          "@graph": [
            { "@id": id, "@type": "Person", name, email: "writer@example.org" },
            { "@type": "NewsArticle", url: pageUrl, headline: "Linked Story", author: { "@id": id } },
          ],
        }),
        pageUrl,
      });
      expect(result.author).toMatchObject({ name, email: "writer@example.org" });
      const nameProv = result.provenance.find(({ field }) => field === "author.name");
      expect(nameProv?.entity).toBeUndefined();
    }

    const blankStringRef = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          { "@id": "_:person1", "@type": "Person", name: "Blank String Ref", url: "/author/blank-ref" },
          { "@type": "NewsArticle", url: pageUrl, headline: "Blank String Story", author: "_:person1" },
        ],
      }),
      pageUrl,
    });
    expect(blankStringRef.author.name).toBe("Blank String Ref");
    expect(blankStringRef.provenance.find(({ field }) => field === "author.name")?.entity).toBe(
      "https://example.com/author/blank-ref",
    );
  });

  test("prefers explicit url over fragment @id in Yoast-style Person and merges with DOM byline", () => {
    const pageUrl = "https://example.com/stories/yoast";
    const html = `${ld({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Person",
          "@id": "https://example.com/#/schema/person/4f8a9c2e",
          name: "Alice Reporter",
          url: "https://example.com/author/alice-reporter/",
          description: "Alice covers municipal policy.",
        },
        {
          "@type": "NewsArticle",
          url: pageUrl,
          headline: "Yoast Article",
          author: { "@id": "https://example.com/#/schema/person/4f8a9c2e" },
        },
      ],
    })}<div class="byline"><a href="https://example.com/author/alice-reporter">Alice Reporter</a><span class="designation">Staff Writer</span><a href="mailto:alice@example.com">Email</a></div>`;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({
      name: "Alice Reporter",
      slug: "alice-reporter",
      bio: "Alice covers municipal policy.",
      designation: "Staff Writer",
      email: "alice@example.com",
    });
    expect(result.review).toEqual([]);
    expect(result.provenance.find(({ field, source }) => field === "author.name" && source === "json-ld")?.entity).toBe(
      "https://example.com/author/alice-reporter/",
    );
  });

  test("dereferences indirect mainEntityOfPage @id WebPage nodes and handles empty entity.url", () => {
    const pageUrl = "https://example.com/reports/indirect-webpage";
    const result = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "WebPage",
            "@id": "https://example.com/#webpage-42",
            url: pageUrl,
          },
          {
            "@type": "NewsArticle",
            url: "",
            mainEntityOfPage: { "@id": "https://example.com/#webpage-42" },
            headline: "Indirect WebPage Report",
            datePublished: "2026-06-01T12:00:00Z",
            author: { "@type": "Person", name: "Dana Reporter", url: "/author/dana" },
          },
          {
            "@type": "NewsArticle",
            mainEntityOfPage: { "@id": "https://example.com/#webpage-other" },
            headline: "Other Story",
            author: { "@type": "Person", name: "Other Writer", url: "/author/other" },
          },
          {
            "@type": "WebPage",
            "@id": "https://example.com/#webpage-other",
            url: "https://example.com/reports/different-story",
          },
        ],
      }),
      pageUrl,
    });
    expect(result.author.name).toBe("Dana Reporter");
    expect(result.metadata.publishedTime).toBe("2026-06-01T12:00:00.000Z");
    expect(result.articles).toEqual([
      {
        title: "Indirect WebPage Report",
        url: pageUrl,
        publishedAt: "2026-06-01T12:00:00.000Z",
      },
    ]);
  });

  test("accepts an explicit current article on a false-positive profile route when no ProfilePage exists", () => {
    const storyUrl = "https://sports.example/team/lakers-win-game-7";
    const storyResult = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        url: storyUrl,
        headline: "Lakers win Game 7",
        datePublished: "2026-06-18T04:15:00Z",
        author: { "@type": "Person", name: "Jordan Beat", url: "https://sports.example/writers/jordan-beat" },
      }),
      pageUrl: storyUrl,
    });
    expect(storyResult.author.name).toBe("Jordan Beat");
    expect(storyResult.metadata.publishedTime).toBe("2026-06-18T04:15:00.000Z");
    expect(storyResult.articles.map(({ url }) => url)).toEqual([storyUrl]);

    const profileUrl = "https://sports.example/team/jordan-beat";
    const profileResult = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "ProfilePage",
            mainEntity: { "@type": "Person", name: "Jordan Beat", url: profileUrl },
          },
          {
            "@type": "NewsArticle",
            url: profileUrl,
            headline: "Wrongly attached article",
            author: { "@type": "Person", name: "Other Person", url: "https://sports.example/writers/other" },
          },
        ],
      }),
      pageUrl: profileUrl,
    });
    expect(profileResult.author.name).toBe("Jordan Beat");

    const bibliographyResult = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        url: "https://sports.example/games/other-game",
        headline: "Other Game Recap",
        author: { "@type": "Person", name: "Bibliography Author" },
      }),
      pageUrl: profileUrl,
    });
    expect(bibliographyResult.author.name).toBe("Unknown Author");
  });

  test("preserves non-tracking query params while ignoring tracking params in comparablePage", () => {
    const base = "https://example.com/article";
    const mismatched = parseHtml({
      html: ld([
        {
          "@type": "NewsArticle",
          url: `${base}?id=200`,
          headline: "Article 200",
          author: { "@type": "Person", name: "Wrong Author" },
        },
        {
          "@type": "NewsArticle",
          url: `${base}?b=2&a=1&id=100&utm_source=twitter&fbclid=abc`,
          headline: "Article 100",
          author: { "@type": "Person", name: "Right Author" },
        },
      ]),
      pageUrl: `${base}?id=100&a=1&b=2&gclid=xyz`,
    });
    expect(mismatched.author.name).toBe("Right Author");

    const onlyMismatch = parseHtml({
      html: ld({
        "@type": "NewsArticle",
        url: `${base}?id=200`,
        headline: "Article 200",
        author: { "@type": "Person", name: "Wrong Author" },
      }),
      pageUrl: `${base}?id=100`,
    });
    expect(onlyMismatch.author.name).toBe("Unknown Author");
  });

  test("synthesizes Person name from givenName and familyName with givenName provenance", () => {
    const pageUrl = "https://example.com/stories/split-name";
    const result = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        url: pageUrl,
        headline: "Split Name Story",
        author: {
          "@type": "Person",
          givenName: "Ada",
          familyName: "Lovelace",
          url: "/author/ada-lovelace",
        },
      }),
      pageUrl,
    });
    expect(result.author).toMatchObject({
      name: "Ada Lovelace",
      givenName: "Ada",
      familyName: "Lovelace",
    });
    expect(result.provenance.find(({ field }) => field === "author.name")?.sourcePath).toBe(
      "script[0].author.givenName",
    );
  });
});

describe("Issue #15 Resolver hardening", () => {
  test("canonicalizes URL identities across scheme, www, trailing slash, hash, and tracking params without merging distinct URLs", () => {
    const pageUrl = "https://example.com/stories/canonical-identity";
    const merged = parseHtml({
      html: `${ld({
        "@type": "NewsArticle",
        url: pageUrl,
        author: {
          "@type": "Person",
          name: "Alice Reporter",
          url: "http://WWW.Example.com/author/alice/?utm_source=newsletter&fbclid=123#bio",
          email: "alice@example.org",
        },
      })}<div class="byline"><a href="https://example.com/author/alice">Alice Reporter</a><span class="designation">Senior Reporter</span></div>`,
      pageUrl,
    });
    expect(merged.author).toMatchObject({
      name: "Alice Reporter",
      email: "alice@example.org",
      designation: "Senior Reporter",
    });
    expect(merged.review).toEqual([]);

    const distinctQuery = parseHtml({
      html: `<script id="__NEXT_DATA__">${JSON.stringify({
        props: {
          pageProps: {
            author: { name: "Alex Smith", url: "https://example.com/author?id=1", email: "one@example.org" },
            profile: { name: "Alex Smith", url: "https://example.com/author?id=2", email: "two@example.org" },
          },
        },
      })}</script>`,
      pageUrl,
    });
    expect(distinctQuery.author.name).toBe("Unknown Author");
    expect(distinctQuery.review.map(({ author }) => author.email).sort()).toEqual([
      "one@example.org",
      "two@example.org",
    ]);
  });

  test("folds diacritics when comparing names on the same profile URL", () => {
    const pageUrl = "https://example.com/stories/diacritics";
    const html = `${ld({
      "@type": "NewsArticle",
      url: pageUrl,
      author: {
        "@type": "Person",
        name: "José García",
        url: "https://example.com/author/jose-garcia",
        email: "jose@example.org",
      },
    })}<div class="byline"><a href="https://example.com/author/jose-garcia">Jose Garcia</a><span class="designation">Correspondent</span></div>`;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({
      name: "José García",
      email: "jose@example.org",
      designation: "Correspondent",
    });
    expect(result.review).toEqual([]);
  });

  test("allows URL-bearing co-author groups to agree with name-only meta groups and retains richer identities", () => {
    const pageUrl = "https://example.com/stories/coauthors-with-meta";
    const html = `
      <meta name="author" content="Alice Reporter, Bob Analyst">
      <script id="__NEXT_DATA__">${JSON.stringify({
        props: {
          pageProps: {
            story: {
              authors: [{ name: "Alice Reporter" }, { name: "Bob Analyst" }],
            },
          },
        },
      })}</script>
      ${ld({
        "@type": "NewsArticle",
        url: pageUrl,
        author: [
          {
            "@type": "Person",
            name: "Alice Reporter",
            url: "https://example.com/authors/alice",
            email: "alice@example.org",
            description: "Alice covers climate.",
          },
          {
            "@type": "Person",
            name: "Bob Analyst",
            url: "https://example.com/authors/bob",
            email: "bob@example.org",
            description: "Bob covers energy.",
          },
        ],
      })}
    `;
    const result = parseHtml({ html, pageUrl });
    expect(result.author.name).toBe("Unknown Author");
    expect(result.authors).toHaveLength(2);
    expect(result.authors[0]).toMatchObject({
      name: "Alice Reporter",
      slug: "alice",
      email: "alice@example.org",
      bio: "Alice covers climate.",
    });
    expect(result.authors[1]).toMatchObject({
      name: "Bob Analyst",
      slug: "bob",
      email: "bob@example.org",
      bio: "Bob covers energy.",
    });

    const disagreeingMeta = parseHtml({
      html: `
        <meta name="author" content="Alice Reporter, Charlie Editor">
        ${ld({
          "@type": "NewsArticle",
          url: pageUrl,
          author: [
            { "@type": "Person", name: "Alice Reporter", url: "https://example.com/authors/alice" },
            { "@type": "Person", name: "Bob Analyst", url: "https://example.com/authors/bob" },
          ],
        })}
      `,
      pageUrl,
    });
    expect(disagreeingMeta.authors).toEqual([]);
  });

  test("preserves conflicting_value review entries for co-author attribute conflicts", () => {
    const pageUrl = "https://example.com/stories/coauthor-conflict";
    const result = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@id": "#alice",
            "@type": "Person",
            name: "Alice Reporter",
            url: "/authors/alice",
            email: "alice-one@example.org",
          },
          {
            "@id": "#alice",
            email: "alice-two@example.org",
          },
          {
            "@type": "NewsArticle",
            url: pageUrl,
            author: [
              { "@id": "#alice" },
              { "@type": "Person", name: "Bob Writer", url: "/authors/bob", email: "bob@example.org" },
            ],
          },
        ],
      }),
      pageUrl,
    });
    expect(result.authors).toHaveLength(2);
    expect(result.authors[0]?.email).toBeUndefined();
    expect(result.authors[1]?.email).toBe("bob@example.org");
    const conflictEmails = result.review
      .filter(({ reason }) => reason === "conflicting_value")
      .map(({ author }) => author.email)
      .sort();
    expect(conflictEmails).toEqual(["alice-one@example.org", "alice-two@example.org"]);
  });

  test("deduplicates articles by normalized URL stripping trailing slash and hash", () => {
    const pageUrl = "https://example.com/author/alice";
    const html = `
      ${ld({
        "@type": "ItemList",
        itemListElement: [
          { item: { "@type": "NewsArticle", headline: "Story A Headline", url: "https://example.com/stories/a" } },
          {
            item: {
              "@type": "NewsArticle",
              headline: "Story A Headline",
              url: "https://example.com/stories/a/#comments",
              datePublished: "2026-07-01T08:00:00Z",
            },
          },
        ],
      })}
      <article><h2><a href="https://example.com/stories/a/">Story A Headline</a></h2></article>
    `;
    const result = parseHtml({ html, pageUrl });
    expect(result.articles).toEqual([
      {
        title: "Story A Headline",
        url: "https://example.com/stories/a",
        publishedAt: "2026-07-01T08:00:00.000Z",
      },
    ]);
    const urlSources = new Set(
      result.provenance.filter(({ field }) => field === "articles[0].url").map(({ source }) => source),
    );
    expect(urlSources).toEqual(new Set(["json-ld", "dom-article"]));
  });

  test("treats midnight-crossing drift within 60s and same-day date-only vs precise timestamps as concordant", () => {
    const pageUrl = "https://example.com/stories/dates";
    const midnightDrift = parseHtml({
      html: `
        ${ld({ "@type": "NewsArticle", url: pageUrl, datePublished: "2026-10-26T00:00:10Z" })}
        <meta property="article:published_time" content="2026-10-25T23:59:30Z">
      `,
      pageUrl,
    });
    expect(midnightDrift.metadata.publishedTime).toBe("2026-10-26T00:00:10.000Z");
    expect(midnightDrift.issues).toEqual([]);

    const preciseWinsOverDateOnly = parseHtml({
      html: `
        ${ld({ "@type": "NewsArticle", url: pageUrl, datePublished: "2026-10-25" })}
        <meta property="article:published_time" content="2026-10-25T14:30:00Z">
      `,
      pageUrl,
    });
    expect(preciseWinsOverDateOnly.metadata.publishedTime).toBe("2026-10-25T14:30:00.000Z");
    expect(preciseWinsOverDateOnly.issues).toEqual([]);

    const realConflict = parseHtml({
      html: `
        ${ld({ "@type": "NewsArticle", url: pageUrl, datePublished: "2026-10-25T10:00:00Z" })}
        <meta property="article:published_time" content="2026-10-25T14:30:00Z">
      `,
      pageUrl,
    });
    expect(realConflict.metadata.publishedTime).toBeUndefined();
    expect(realConflict.issues.some(({ sourcePath }) => sourcePath === "metadata.publishedTime")).toBe(true);
  });

  test("preserves distinct JSON-LD fragment @ids while stripping anchors from explicit profile URLs", () => {
    const pageUrl = "https://example.com/stories/fragments";
    const coauthors = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          { "@id": "https://example.com/#alice", "@type": "Person", name: "Alice One" },
          { "@id": "https://example.com/#bob", "@type": "Person", name: "Bob Two" },
          {
            "@type": "NewsArticle",
            url: pageUrl,
            author: [{ "@id": "https://example.com/#alice" }, { "@id": "https://example.com/#bob" }],
          },
        ],
      }),
      pageUrl,
    });
    expect(coauthors.authors.map(({ name }) => name)).toEqual(["Alice One", "Bob Two"]);

    const sameNameFragments = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          { "@id": "#alex-1", "@type": "Person", name: "Alex Smith", email: "alex1@example.org" },
          { "@id": "#alex-2", "@type": "Person", name: "Alex Smith", email: "alex2@example.org" },
          { "@type": "NewsArticle", url: pageUrl, author: [{ "@id": "#alex-1" }, { "@id": "#alex-2" }] },
        ],
      }),
      pageUrl,
    });
    expect(sameNameFragments.authors.map(({ email }) => email)).toEqual(["alex1@example.org", "alex2@example.org"]);

    const selfUrlFragment = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          { "@id": "#alice", "@type": "Person", name: "Alice Frag", url: "#alice", email: "a1@example.org" },
          { "@id": "#alice", email: "a2@example.org" },
          { "@id": "#bob", "@type": "Person", name: "Bob Frag", url: "#bob" },
          { "@type": "NewsArticle", url: pageUrl, author: [{ "@id": "#alice" }, { "@id": "#bob" }] },
        ],
      }),
      pageUrl,
    });
    expect(selfUrlFragment.authors.map(({ name }) => name)).toEqual(["Alice Frag", "Bob Frag"]);
    expect(selfUrlFragment.authors[0]?.emails?.sort()).toEqual(["a1@example.org", "a2@example.org"]);

    const trailingEmptyHash = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        url: pageUrl,
        author: { "@id": "https://example.com/#", "@type": "Person", name: "Hash Empty" },
      }),
      pageUrl,
    });
    expect(trailingEmptyHash.author.name).toBe("Hash Empty");

    const explicitAnchorMerge = parseHtml({
      html: `${ld({
        "@type": "NewsArticle",
        url: pageUrl,
        author: { "@type": "Person", name: "Alice Anchor", url: "https://example.com/author/alice#bio" },
      })}<div class="byline"><a href="https://example.com/author/alice">Alice Anchor</a><span class="designation">Editor</span></div>`,
      pageUrl,
    });
    expect(explicitAnchorMerge.author).toMatchObject({ name: "Alice Anchor", designation: "Editor" });
    expect(explicitAnchorMerge.review).toEqual([]);

    const aliasedSameFragment = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@id": "https://example.com/team#alice",
            "@type": "Person",
            name: "Alice Alias",
            url: "http://www.example.com/team/?utm_source=feed#alice",
          },
          {
            "@id": "https://example.com/team#bob",
            "@type": "Person",
            name: "Bob Alias",
            url: "http://www.example.com/team/?fbclid=99#bob",
          },
          {
            "@type": "NewsArticle",
            url: pageUrl,
            author: [{ "@id": "https://example.com/team#alice" }, { "@id": "https://example.com/team#bob" }],
          },
        ],
      }),
      pageUrl,
    });
    expect(aliasedSameFragment.author.name).toBe("Unknown Author");
    expect(aliasedSameFragment.authors.map(({ name }) => name)).toEqual(["Alice Alias", "Bob Alias"]);
    expect(aliasedSameFragment.review.map(({ author }) => author.name).sort()).toEqual(["Alice Alias", "Bob Alias"]);

    const fragmentVsUnrelatedExplicit = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@id": "https://example.com/team#alice",
            "@type": "Person",
            name: "Alice Team",
            url: "http://www.example.com/team/?utm_source=feed#alice",
            email: "alice@example.org",
          },
          {
            "@type": "Person",
            name: "Team Index",
            url: "https://example.com/team",
            email: "team@example.org",
          },
          {
            "@type": "NewsArticle",
            url: pageUrl,
            author: { "@id": "https://example.com/team#alice" },
          },
        ],
      }),
      pageUrl,
    });
    expect(fragmentVsUnrelatedExplicit.author).toMatchObject({ name: "Alice Team", email: "alice@example.org" });
    expect(fragmentVsUnrelatedExplicit.review.map(({ author }) => author.name)).toEqual(["Team Index"]);
  });

  test("isolates inline and @graph liveBlogUpdate nodes without demoting BreadcrumbList, citation, or mentions targets", () => {
    const pageUrl = "https://example.com/live/election-night";
    const inlineAndGraph = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "BreadcrumbList",
            itemListElement: [{ "@type": "ListItem", position: 1, item: { "@id": "#main-liveblog" } }],
          },
          {
            "@id": "#main-liveblog",
            "@type": "LiveBlogPosting",
            headline: "Main Liveblog",
            datePublished: "2026-11-03T18:00:00Z",
            author: { "@type": "Person", name: "Lead Anchor", url: "/author/lead" },
            citation: { "@type": "NewsArticle", url: "https://example.com/ref-article", headline: "Ref Article" },
            liveBlogUpdate: [
              {
                "@type": "BlogPosting",
                url: `${pageUrl}#update-inline`,
                datePublished: "2026-11-03T19:00:00Z",
                author: { "@type": "Person", name: "Inline Updater", url: "/author/inline-updater" },
              },
              { "@id": "#update-graph" },
            ],
          },
          {
            "@id": "#update-graph",
            "@type": "BlogPosting",
            url: `${pageUrl}#update-graph`,
            datePublished: "2026-11-03T20:00:00Z",
            author: { "@type": "Person", name: "Graph Updater", url: "/author/graph-updater" },
          },
        ],
      }),
      pageUrl,
    });
    expect(inlineAndGraph.author.name).toBe("Lead Anchor");
    expect(inlineAndGraph.metadata.publishedTime).toBe("2026-11-03T18:00:00.000Z");
    expect(inlineAndGraph.review.map(({ author }) => author.name).sort()).toEqual(["Graph Updater", "Inline Updater"]);

    const mainWithCitation = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "NewsArticle",
            url: pageUrl,
            headline: "Cited Story",
            author: { "@type": "Person", name: "Main Writer" },
          },
          {
            "@type": "NewsArticle",
            url: "https://example.com/other",
            citation: { "@id": "#cited" },
            mentions: { "@type": "Person", name: "Mentioned Person" },
          },
        ],
      }),
      pageUrl,
    });
    expect(mainWithCitation.author.name).toBe("Main Writer");

    const updateOnlyGraphPerson = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "LiveBlogPosting",
            url: pageUrl,
            headline: "Liveblog Without Main Author",
            liveBlogUpdate: [{ "@id": "#update-1" }],
          },
          {
            "@id": "#update-1",
            "@type": "BlogPosting",
            url: `${pageUrl}#update-1`,
            author: { "@id": "#updater-1" },
          },
          {
            "@id": "#updater-1",
            "@type": "Person",
            name: "Update Only Reporter",
          },
        ],
      }),
      pageUrl,
    });
    expect(updateOnlyGraphPerson.author.name).toBe("Unknown Author");
    expect(updateOnlyGraphPerson.authors).toEqual([]);
    expect(updateOnlyGraphPerson.review.map(({ author }) => author.name)).toEqual(["Update Only Reporter"]);

    const updateOnlyInlinePageUrlPerson = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@type": "LiveBlogPosting",
        url: pageUrl,
        headline: "Inline Liveblog Without Main Author",
        liveBlogUpdate: [
          {
            "@type": "BlogPosting",
            url: `${pageUrl}#update-inline`,
            author: { "@type": "Person", name: "Inline Update Only", url: `${pageUrl}#updater` },
          },
        ],
      }),
      pageUrl,
    });
    expect(updateOnlyInlinePageUrlPerson.author.name).toBe("Unknown Author");
    expect(updateOnlyInlinePageUrlPerson.authors).toEqual([]);
  });

  test("resolves doi: @ids and By: string authors without dropping them or accepting unsafe @id schemes", () => {
    const pageUrl = "https://example.com/stories/doi-byline";
    const doiResult = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@graph": [
          { "@id": "doi:10.1000/author-1", "@type": "Person", name: "Doi Researcher", email: "doi@example.org" },
          { "@type": "NewsArticle", url: pageUrl, author: { "@id": "doi:10.1000/author-1" } },
        ],
      }),
      pageUrl,
    });
    expect(doiResult.author).toMatchObject({ name: "Doi Researcher", email: "doi@example.org" });
    expect(doiResult.provenance.find(({ field }) => field === "author.name")?.entity).toBeUndefined();

    const byString = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        url: pageUrl,
        author: ["By: Alice Reporter", "By:Bob Writer"],
      }),
      pageUrl,
    });
    expect(byString.authors.map(({ name }) => name)).toEqual(["Alice Reporter", "Bob Writer"]);

    const unsafeId = parseHtml({
      html: ld({
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        url: pageUrl,
        author: { "@id": "javascript:alert(1)", "@type": "Person", name: "Safe Name" },
      }),
      pageUrl,
    });
    expect(unsafeId.author.name).toBe("Safe Name");
    expect(unsafeId.provenance.find(({ field }) => field === "author.name")?.entity).toBeUndefined();
  });

  test("treats percent-encoded slug case differences as concordant without hiding distinct slugs", () => {
    const pageUrl = "https://example.com/stories/slug-case";
    const concordant = parseHtml({
      html: `${ld({
        "@type": "NewsArticle",
        url: pageUrl,
        author: { "@type": "Person", name: "René Writer", url: "https://example.com/author/ren%C3%A9" },
      })}<div class="byline"><a href="https://example.com/author/ren%c3%a9">René Writer</a></div>`,
      pageUrl,
    });
    expect(concordant.author.slug).toBeDefined();
    expect(concordant.review).toEqual([]);

    const rawVsEncoded = parseHtml({
      html: `<script id="__NEXT_DATA__">${JSON.stringify({
        props: {
          pageProps: {
            author: { name: "René Writer", url: "https://example.com/author/rene", slug: "rené" },
          },
        },
      })}</script><div class="byline"><a href="https://example.com/author/rene" data-author="René Writer">René Writer</a></div>${ld(
        {
          "@type": "NewsArticle",
          url: pageUrl,
          author: {
            "@type": "Person",
            name: "René Writer",
            url: "https://example.com/author/rene",
            "@id": "https://example.com/author/ren%C3%A9",
          },
        },
      )}`,
      pageUrl,
    });
    expect(rawVsEncoded.author.name).toBe("René Writer");

    const distinctSlugs = parseHtml({
      html: `<script id="__NEXT_DATA__">${JSON.stringify({
        props: {
          pageProps: {
            story: {
              author: { name: "René Writer", url: "https://example.com/author/rene", slug: "rene-one" },
            },
          },
        },
      })}</script><script type="application/ld+json">${JSON.stringify({
        "@type": "NewsArticle",
        url: pageUrl,
        author: {
          "@type": "Person",
          name: "René Writer",
          url: "https://example.com/author/rene",
        },
      })}</script>`,
      pageUrl,
    });
    expect(distinctSlugs.author.name).toBe("René Writer");
    expect(distinctSlugs.author.slug).toBeUndefined();
    expect(distinctSlugs.review.some(({ reason }) => reason === "conflicting_value")).toBe(true);
  });

  test("keeps Bengali, Japanese dakuten, and Cyrillic names distinct while folding Latin diacritics", () => {
    const pageUrl = "https://example.com/stories/scripts";
    for (const [left, right] of [
      ["রিনা খান", "রানা খান"],
      ["たかはし", "たがはし"],
      ["Алексей", "Алексеи"],
    ] as const) {
      const result = parseHtml({
        html: `${ld({
          "@type": "NewsArticle",
          url: pageUrl,
          author: { "@type": "Person", name: left },
        })}<div class="byline">${right}</div>`,
        pageUrl,
      });
      expect(result.author.name, `${left} vs ${right}`).toBe("Unknown Author");
      expect(result.review.map(({ author }) => author.name).sort()).toEqual([left, right].sort());
    }

    const vietnamese = parseHtml({
      html: `${ld({
        "@type": "NewsArticle",
        url: pageUrl,
        author: { "@type": "Person", name: "Tiếng Việt", url: "https://example.com/author/tv" },
      })}<div class="byline"><a href="https://example.com/author/tv">Tieng Viet</a></div>`,
      pageUrl,
    });
    expect(vietnamese.author.name).toBe("Tiếng Việt");
    expect(vietnamese.review).toEqual([]);
  });

  test("preserves URL path case, ports, meaningful query keys, and repeated-value order across articles and identities", () => {
    const pageUrl = "https://example.com/author/alice";
    const articles = parseHtml({
      html: ld({
        "@type": "ItemList",
        itemListElement: [
          { item: { "@type": "NewsArticle", headline: "Case One Headline", url: "https://example.com/Stories/One" } },
          { item: { "@type": "NewsArticle", headline: "Case Two Headline", url: "https://example.com/stories/one" } },
          {
            item: {
              "@type": "NewsArticle",
              headline: "Port 8443 Headline",
              url: "https://example.com:8443/stories/port",
            },
          },
          {
            item: {
              "@type": "NewsArticle",
              headline: "Port Default Headline",
              url: "https://example.com/stories/port",
            },
          },
          {
            item: {
              "@type": "NewsArticle",
              headline: "Source RSS Headline",
              url: "https://example.com/stories/q?source=rss",
            },
          },
          {
            item: {
              "@type": "NewsArticle",
              headline: "Source Web Headline",
              url: "https://example.com/stories/q?source=web",
            },
          },
          {
            item: {
              "@type": "NewsArticle",
              headline: "Repeated Order A",
              url: "https://example.com/stories/rep?tag=b&tag=a",
            },
          },
          {
            item: {
              "@type": "NewsArticle",
              headline: "Repeated Order B",
              url: "https://example.com/stories/rep?tag=a&tag=b",
            },
          },
          {
            item: {
              "@type": "NewsArticle",
              headline: "Case Query Upper",
              url: "https://example.com/stories/caseq?v=AbCdEf",
            },
          },
          {
            item: {
              "@type": "NewsArticle",
              headline: "Case Query Lower",
              url: "https://example.com/stories/caseq?v=abcdef",
            },
          },
        ],
      }),
      pageUrl,
    });
    expect(articles.articles).toHaveLength(10);

    const coauthors = parseHtml({
      html: `<div class="byline">By Newsroom and Named Writer</div>`,
      pageUrl: "https://example.com/stories/coauthor-newsroom",
    });
    expect(coauthors.authors.map(({ name }) => name)).toEqual(["Newsroom", "Named Writer"]);
  });
});
