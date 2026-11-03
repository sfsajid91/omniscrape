import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";

const page = "https://publisher.example/story";
const flatStory = (extra: Record<string, unknown> = {}) => ({
  story: {
    id: "story-9",
    slug: "not-an-author",
    title: "Story title",
    "author-name": "Rahul Sharma",
    "author-id": "rs-4040",
    "publisher-name": "Quint Media",
    ...extra,
  },
});

describe("Quintype author ownership", () => {
  test("extracts flat story author keys without borrowing story fields", () => {
    const data = { qt: { data: flatStory() } };
    const result = parseHtml({
      html: `<script id="static-page" type="application/json">${JSON.stringify(data)}</script>`,
      pageUrl: page,
    });
    expect(result.author).toMatchObject({ name: "Rahul Sharma", id: "rs-4040" });
    expect(result.author.slug).toBeUndefined();
    expect(result.author.bio).toBeUndefined();
    expect(
      result.provenance.some(({ field, sourcePath }) => field === "author.name" && sourcePath.endsWith(".author-name")),
    ).toBe(true);
    expect(
      result.provenance.some(
        ({ field, sourcePath, entity }) =>
          field === "author.id" && sourcePath.endsWith(".author-id") && entity?.includes("publisher.example"),
      ),
    ).toBe(true);
    expect(result.editorial.publisher).toBe("Quint Media");
    expect(
      result.provenance.some(
        ({ field, sourcePath }) => field === "editorial.publisher" && sourcePath.endsWith(".publisher-name"),
      ),
    ).toBe(true);
  });

  test("accepts qtData assignment and unwraps its data root", () => {
    const result = parseHtml({
      html: `<script>window.qtData = ${JSON.stringify({ data: flatStory() })};</script>`,
      pageUrl: page,
    });
    expect(result.author).toMatchObject({ name: "Rahul Sharma", id: "rs-4040" });
    expect(
      result.provenance.some(
        ({ field, sourcePath }) =>
          field === "author.name" && sourcePath.endsWith("@window.qtData.data.story.author-name"),
      ),
    ).toBe(true);
    expect(result.techStack).toMatchObject({
      cms: "Quintype (Bold)",
      hydrationFormat: "window.qtData",
      signals: ["found Quintype payload"],
    });
  });

  test("accepts qt assignment and direct story root", () => {
    const result = parseHtml({ html: `<script>qt = ${JSON.stringify(flatStory())};</script>`, pageUrl: page });
    expect(result.author.name).toBe("Rahul Sharma");
    expect(
      result.provenance.some(
        ({ field, sourcePath }) => field === "author.id" && sourcePath.endsWith("@qt.story.author-id"),
      ),
    ).toBe(true);
    expect(result.techStack.hydrationFormat).toBe("qt");
  });

  test("recognizes nested Quintype author aliases and numeric zero IDs", () => {
    const result = parseHtml({
      html: `<script id="static-page">${JSON.stringify({ data: { author: { "author-name": "Avery Reporter", author_id: 0 } } })}</script>`,
      pageUrl: page,
    });
    expect(result.author).toMatchObject({ name: "Avery Reporter", id: 0 });
    expect(
      result.provenance.some(({ field, sourcePath }) => field === "author.id" && sourcePath.endsWith(".author_id")),
    ).toBe(true);
  });

  test("does not treat publisher state aliases in unrelated fields as people", () => {
    const result = parseHtml({
      html: `<script id="static-page">${JSON.stringify({ qt: { data: { story: { id: "story-1", slug: "story", title: "A headline", "publisher-name": "Quint Media" } } } })}</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Unknown Author");
    expect(result.editorial.publisher).toBe("Quint Media");
  });

  for (const [nameAlias, nameValue] of [
    ["author-name", "Rahul Sharma"],
    ["author_name", "Rina Das"],
    ["authorName", "Rhea Sen"],
  ] as const) {
    for (const [idAlias, idValue] of [
      ["author-id", "id-kebab"],
      ["author_id", "id-snake"],
      ["authorId", "id-camel"],
    ] as const) {
      test(`maps flat ${nameAlias} with ${idAlias} provenance`, () => {
        const result = parseHtml({
          html: `<script id="static-page">${JSON.stringify({ qt: { data: { story: { [nameAlias]: nameValue, [idAlias]: idValue } } } })}</script>`,
          pageUrl: page,
        });
        expect(result.author).toMatchObject({ name: nameValue, id: idValue });
        expect(
          result.provenance.some(
            ({ field, sourcePath }) => field === "author.name" && sourcePath.endsWith(`.${nameAlias}`),
          ),
        ).toBe(true);
        expect(
          result.provenance.some(
            ({ field, sourcePath }) => field === "author.id" && sourcePath.endsWith(`.${idAlias}`),
          ),
        ).toBe(true);
      });
    }
  }

  test("keeps a valid flat author when the optional author ID is missing or invalid", () => {
    for (const invalidId of [undefined, {}, ""]) {
      const story = { "author-name": "Valid Writer", ...(invalidId === undefined ? {} : { "author-id": invalidId }) };
      const result = parseHtml({
        html: `<script id="static-page">${JSON.stringify({ qt: { data: { story } } })}</script>`,
        pageUrl: page,
      });
      expect(result.author.name).toBe("Valid Writer");
      expect(result.author.id).toBeUndefined();
    }
  });

  test("rejects author IDs without an evidenced name", () => {
    const result = parseHtml({
      html: `<script id="static-page">${JSON.stringify({ qt: { data: { story: { "author-id": "orphan-id", id: "story-id", slug: "story-slug", title: "Story title" } } } })}</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Unknown Author");
    expect(result.review).toEqual([]);
  });

  test("preserves raw string and positive numeric IDs", () => {
    for (const id of ["writer-7", 7]) {
      const result = parseHtml({
        html: `<script id="static-page">${JSON.stringify({ qt: { data: { author: { authorName: "Nested Writer", authorId: id } } } })}</script>`,
        pageUrl: page,
      });
      expect(result.author).toMatchObject({ name: "Nested Writer", id });
    }
  });

  test("withholds conflicting flat aliases instead of selecting one", () => {
    const result = parseHtml({
      html: `<script id="static-page">${JSON.stringify({ qt: { data: { story: { "author-name": "First Writer", author_name: "Second Writer", "author-id": "writer-1" } } } })}</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Unknown Author");
    expect(result.review.map(({ author }) => author.name).sort()).toEqual(["First Writer", "Second Writer"]);
  });

  test("does not reconcile nested and flat authors without an agreed identity", () => {
    const result = parseHtml({
      html: `<script id="static-page">${JSON.stringify({ qt: { data: { story: { author: { name: "Nested Writer", id: "nested-1" }, "author-name": "Flat Writer", "author-id": "flat-1" } } } })}</script>`,
      pageUrl: page,
    });
    expect(result.author.name).toBe("Unknown Author");
    expect(result.authors).toEqual([]);
  });

  test("reports conflicting publisher names through editorial conflict handling", () => {
    const result = parseHtml({
      html: `<script id="static-page">${JSON.stringify({ qt: { data: { story: { "author-name": "Publisher Writer", "publisher-name": "First Publisher", publisher: "Second Publisher" } } } })}</script>`,
      pageUrl: page,
    });
    expect(result.editorial.publisher).toBeUndefined();
    expect(result.issues.some(({ message }) => message.includes("Conflicting values for editorial.publisher"))).toBe(
      true,
    );
  });

  test("suppresses lineup and session authors while preserving the page author", () => {
    const data = {
      author: { name: "Page Writer", id: "page-1" },
      main: [{ type: "lineup", content: [{ itemType: "story", author: { name: "Card Writer" } }] }],
      session: { author: { name: "Session Writer" } },
    };
    const result = parseHtml({ html: `<script id="static-page">${JSON.stringify(data)}</script>`, pageUrl: page });
    expect(result.author.name).toBe("Page Writer");
    expect(result.review.some(({ author }) => ["Card Writer", "Session Writer"].includes(author.name))).toBe(false);
  });

  test("does not match arbitrary qt substrings as technical markers", () => {
    const result = parseHtml({ html: `<script>someqtData = {story:{}}</script>`, pageUrl: page });
    expect(result.techStack.cms).not.toBe("Quintype (Bold)");
    expect(result.techStack.hydrationFormat).toBeUndefined();
  });
});

describe("Quintype collection role isolation", () => {
  const profileUrl = "https://gulfnews.com/author/a-ahmed";
  const owner = { id: 2165189, name: "Ashfaq Ahmed", email: "aahmed@gulfnews.com" };
  const journalists = [
    { id: 2584238, name: "Hamna Iqbal, Reporter", email: "hiqbal@gulfnews.com" },
    { id: 2171005, name: "Stephen N R", email: "snr@gulfnews.com" },
    { id: 2177450, name: "Krita Coelho", email: "kcoelho@gulfnews.com" },
    { id: 2287057, name: "Huda Ata", email: "hata@gulfnews.com" },
    { id: 2167028, name: "Balaram Menon", email: "bmenon@gulfnews.com" },
    { id: 2171160, name: "Anupam Varma, Online Editor", email: "avarma@gulfnews.com" },
    { id: 2208704, name: "Surabhi Vasundharadevi", email: "svasundharadevi@gulfnews.com" },
    { id: 2118000, name: "migrator", email: "migrator@gulfnews.com" },
  ];

  const collectionPayload = {
    qt: {
      data: {
        author: {
          id: 2345930,
          name: "A Ahmed",
          slug: "a-ahmed",
          email: "aahmedreporter@gulfnews.com",
        },
        authorCollection: {
          items: journalists.map((journalist, index) => ({
            story: {
              id: `story-${index}`,
              title: `Story ${index}`,
              slug: `story-${index}`,
              "author-name": journalist.name,
              "author-id": journalist.id,
              "owner-id": owner.id,
              "owner-name": owner.name,
              authors: [{ id: journalist.id, name: journalist.name, email: journalist.email }],
              cards: [
                {
                  "story-elements": [
                    {
                      metadata: {
                        "linked-story": {
                          authors: [
                            {
                              id: 2345930,
                              name: "A Ahmed",
                              email: "aahmedreporter@gulfnews.com",
                            },
                            owner,
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          })),
        },
      },
    },
  };

  test("separates editorial owner from multiple journalists across collection stories", () => {
    const result = parseHtml({
      html: `<script id="static-page" type="application/json">${JSON.stringify(collectionPayload)}</script>`,
      pageUrl: profileUrl,
    });

    expect(result.author).toMatchObject({
      name: "A Ahmed",
      id: 2345930,
      email: "aahmedreporter@gulfnews.com",
    });
    expect(result.editorial).toMatchObject({
      ownerName: owner.name,
      ownerId: owner.id,
      ownerEmail: owner.email,
    });

    const ownerEmailProvenance = result.provenance.filter(
      ({ field, scope }) => field === "editorial.ownerEmail" && scope === "publisher",
    );
    expect(ownerEmailProvenance).toHaveLength(1);

    expect(result.authors.map(({ name }) => name)).toEqual(["A Ahmed"]);
    expect(result.review.some(({ author }) => author.name === owner.name)).toBe(false);
    for (const journalist of journalists) {
      expect(result.author.emails).not.toContain(journalist.email);
      expect(result.authors.some(({ name }) => name === journalist.name)).toBe(false);
    }
  });

  test("keeps a story byline author separate from its editorial owner", () => {
    const bylineAuthor = journalists[0]!;
    const result = parseHtml({
      html: `<script id="static-page" type="application/json">${JSON.stringify({
        qt: {
          data: {
            story: {
              id: "story-byline",
              title: "Story byline",
              slug: "story-byline",
              "author-name": bylineAuthor.name,
              "author-id": bylineAuthor.id,
              "owner-id": owner.id,
              "owner-name": owner.name,
            },
            relatedStories: [
              {
                story: {
                  id: "related-story",
                  title: "Related story",
                  slug: "related-story",
                  "author-name": journalists[1]!.name,
                  "author-id": journalists[1]!.id,
                  "owner-id": 2169471,
                  "owner-name": "Devadasan K P",
                },
              },
            ],
            config: {
              "publisher-name": "gulfnews",
              "seo-metadata": [{ "owner-id": 85391 }, { "owner-id": 85232 }],
            },
          },
        },
      })}</script>`,
      pageUrl: "https://gulfnews.com/story-byline",
    });

    expect(result.author).toMatchObject({ name: bylineAuthor.name, id: bylineAuthor.id });
    expect(result.editorial).toMatchObject({ ownerName: owner.name, ownerId: owner.id });
    expect(result.editorial).not.toHaveProperty("publisher");
    expect(result.authors.map(({ name }) => name)).toEqual([bylineAuthor.name]);
    expect(result.review).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  test("resolves a story byline when CMS ID and JSON-LD profile URL agree through slug", () => {
    const bylineAuthor = journalists[0]!;
    const result = parseHtml({
      html:
        `<script id="static-page" type="application/json">${JSON.stringify({
          qt: {
            data: {
              story: {
                id: "story-identity",
                title: "Story identity",
                slug: "story-identity",
                "author-name": bylineAuthor.name,
                "author-id": bylineAuthor.id,
                authors: [{ id: bylineAuthor.id, name: bylineAuthor.name, slug: "hamna-iqbal" }],
                "owner-id": owner.id,
                "owner-name": owner.name,
              },
            },
          },
        })}</script>` +
        `<script type="application/ld+json">${JSON.stringify({
          "@type": "NewsArticle",
          headline: "Story identity",
          url: "https://gulfnews.com/story-identity",
          author: [
            {
              "@type": "Person",
              name: bylineAuthor.name,
              url: "https://gulfnews.com/author/hamna-iqbal",
            },
          ],
        })}</script>`,
      pageUrl: "https://gulfnews.com/story-identity",
    });

    expect(result.author).toMatchObject({ name: bylineAuthor.name, id: bylineAuthor.id, slug: "hamna-iqbal" });
    expect(result.review).toEqual([]);
    expect(result.editorial).toMatchObject({ ownerName: owner.name, ownerId: owner.id });
  });
});
