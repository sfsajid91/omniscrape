import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";
import { independentCases as cases } from "./fixtures/independent-cases";

describe("independent evaluation cases", () => {
  test("linked JSON-LD NewsArticle resolves author, publisher, dates, image, and canonical", () => {
    const { html, pageUrl } = cases.linkedJsonLd;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({
      name: "Jane Doe",
      givenName: "Jane",
      familyName: "Doe",
      slug: "jane-doe",
      designation: "City Hall reporter",
      bio: "Jane Doe covers city government and public finance.",
      avatarUrl: "https://news.example/images/jane.jpg",
      email: "jane.doe@news.example",
    });
    expect(result.author.socials.map(({ platform, handle, url }) => ({ platform, handle, url }))).toEqual([
      { platform: "linkedin", handle: "janedoe", url: "https://www.linkedin.com/in/janedoe" },
      { platform: "twitter", handle: "janedoe", url: "https://twitter.com/janedoe" },
    ]);
    expect(result.metadata).toEqual({
      title: "City budget passes after long debate",
      description: "Council approved the budget late Tuesday.",
      canonicalUrl: "https://news.example/politics/city-budget/",
      ogImage: "https://news.example/images/budget.jpg",
      language: "en",
      publishedTime: "2025-03-04T10:30:00.000Z",
      modifiedTime: "2025-03-05T08:00:00.000Z",
    });
    expect(result.editorial.publisher).toBe("Example News");
    expect(result.articles).toEqual([
      {
        title: "City budget passes after long debate",
        url: "https://news.example/politics/city-budget",
        publishedAt: "2025-03-04T10:30:00.000Z",
      },
    ]);
    expect(result.review).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.provenance).toContainEqual(
      expect.objectContaining({ field: "author.name", value: "Jane Doe", source: "json-ld", scope: "byline" }),
    );
    expect(result.provenance).toContainEqual(
      expect.objectContaining({
        field: "articles[0].url",
        value: "https://news.example/politics/city-budget",
        source: "json-ld",
      }),
    );
  });

  test("ProfilePage targets its Person and preserves profile provenance", () => {
    const { html, pageUrl } = cases.profilePage;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({
      name: "Sofia Marino",
      slug: "sofia-marino",
      email: "sofia@mag.example",
      bio: "Sofia Marino writes about architecture and urban design.",
      designation: "Design critic",
    });
    expect(result.author.socials.map(({ platform, handle }) => ({ platform, handle }))).toEqual([
      { platform: "instagram", handle: "sofiamarino" },
    ]);
    expect(result.review).toEqual([]);
    expect(result.provenance).toContainEqual(
      expect.objectContaining({ field: "author.name", value: "Sofia Marino", source: "json-ld", scope: "profile" }),
    );
    expect(result.author.avatarUrl).toBeUndefined();
  });

  test("Next Pages profile preserves its short CMS article and excludes unrelated user data", () => {
    const { html, pageUrl } = cases.nextPagesProfile;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({
      name: "Morgan Lee",
      id: 501,
      slug: "morgan-lee",
      designation: "Investigative Reporter",
      bio: "Morgan Lee investigates housing and labor policy across the region.",
      avatarUrl: "https://example.com/people/morgan.jpg",
      email: "morgan@example.com",
    });
    expect(result.author.socials.map(({ platform, handle }) => ({ platform, handle }))).toEqual([
      { platform: "twitter", handle: "morganlee" },
    ]);
    expect(result.articles).toEqual([
      {
        title: "Housing audit finds gaps",
        url: "https://example.com/investigations/housing-audit",
        publishedAt: "2025-01-15T00:00:00.000Z",
      },
      { title: "Short", url: "https://example.com/x" },
      {
        title: "Labor board complaint",
        url: "https://example.com/labor-complaint",
        publishedAt: "2025-02-20T09:00:00.000Z",
      },
    ]);
    expect(result.techStack).toMatchObject({
      framework: "Next.js",
      cms: "Custom (Next.js)",
      hydrationFormat: "__NEXT_DATA__",
    });
    expect(result.review).toEqual([]);
    expect(result.provenance).toContainEqual(
      expect.objectContaining({ field: "author.name", value: "Morgan Lee", source: "hydration:next-pages" }),
    );
    expect(result.provenance.some(({ value }) => value === "reader@example.com")).toBe(false);
  });

  test("Nuxt3 profile decodes refs and returns its exact article set", () => {
    const { html, pageUrl } = cases.nuxt3Profile;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({
      name: "Priya Nair",
      id: 88,
      slug: "priya-nair",
      designation: "Climate correspondent",
      bio: "Priya Nair reports on climate adaptation and energy policy.",
      avatarUrl: "https://example.org/img/priya.png",
      email: "priya@example.org",
    });
    expect(result.author.socials.map(({ platform, handle }) => ({ platform, handle }))).toEqual([
      { platform: "linkedin", handle: "priyanair" },
    ]);
    expect(result.articles).toEqual([
      {
        title: "Coastal cities adapt to heat",
        url: "https://example.org/climate/coastal-cities",
        publishedAt: "2025-04-01T00:00:00.000Z",
      },
      {
        title: "Grid upgrades accelerate",
        url: "https://example.org/energy/grid-upgrades",
        publishedAt: "2025-04-02T12:00:00.000Z",
      },
    ]);
    expect(result.techStack).toMatchObject({
      framework: "Nuxt 3",
      cms: "Custom (Nuxt 3)",
      hydrationFormat: "__NUXT_DATA__",
    });
    expect(result.issues).toEqual([]);
    expect(
      result.provenance.some(
        ({ field, source, sourcePath }) =>
          field === "author.name" && source === "hydration:nuxt3" && sourcePath.includes("author.name"),
      ),
    ).toBe(true);
  });

  test("Quintype author collection retains editorial owner and valid stories only", () => {
    const { html, pageUrl } = cases.quintypeCollection;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({
      name: "Ada Writer",
      id: 12,
      bio: "Ada Writer reports on state politics and elections.",
      avatarUrl: "https://example.com/ada.jpg",
    });
    expect(result.articles).toEqual([
      {
        title: "Budget fight heads to court",
        url: "https://example.com/news/budget-fight",
        publishedAt: "2024-05-01T00:00:00.000Z",
      },
      { title: "Election recount expands", url: "https://example.com/news/recount" },
    ]);
    expect(result.editorial).toMatchObject({ ownerName: "Desk One", ownerId: 77 });
    expect(result.techStack).toMatchObject({ cms: "Quintype (Bold)", hydrationFormat: "static-page (qt.data)" });
    expect(
      result.provenance.some(
        ({ field, sourcePath }) => field === "editorial.ownerId" && sourcePath.endsWith("owner-id"),
      ),
    ).toBe(true);
    expect(
      result.provenance.some(
        ({ field, value, sourcePath }) => field === "author.id" && value === "12" && sourcePath.endsWith("author.id"),
      ),
    ).toBe(true);
  });

  test("Fusion assignment extracts the author, social link, and article", () => {
    const { html, pageUrl } = cases.fusionAssignment;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({
      name: "Ravi Shah",
      id: "r-9",
      designation: "Data reporter",
      bio: "Ravi Shah builds data-driven stories about transit.",
      avatarUrl: "https://example.net/ravi.jpg",
    });
    expect(result.author.socials.map(({ platform, handle }) => ({ platform, handle }))).toEqual([
      { platform: "twitter", handle: "ravi" },
    ]);
    expect(result.articles).toEqual([
      { title: "Transit ridership climbs again", url: "https://example.net/transit/ridership" },
    ]);
    expect(result.techStack).toMatchObject({ cms: "Arc XP (Fusion)", hydrationFormat: "Fusion.globalContent" });
    expect(result.provenance).toContainEqual(
      expect.objectContaining({ field: "author.name", value: "Ravi Shah", source: "hydration:fusion" }),
    );
  });

  test("DOM byline and metadata exclude navigation/footer while retaining article cards", () => {
    const { html, pageUrl } = cases.domBylineAndMetadata;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({
      name: "Dana Kim",
      slug: "dana-kim",
      email: "dana@example.net",
      designation: "Senior reporter",
    });
    expect(result.author.socials.map(({ platform, handle }) => ({ platform, handle }))).toEqual([
      { platform: "linkedin", handle: "danakim" },
    ]);
    expect(result.metadata).toMatchObject({
      title: "Council approves transit plan",
      publishedTime: "2025-06-10T07:15:00.000Z",
      canonicalUrl: "https://news.example/transit/plan",
      description: "The plan adds bus lanes and late-night service.",
    });
    expect(result.articles).toEqual([
      { title: "Fare changes begin next month", url: "https://news.example/transit/fare-changes" },
      { title: "Night bus service expands downtown", url: "https://news.example/transit/night-buses" },
    ]);
    expect(result.review).toEqual([]);
    expect(result.provenance).toContainEqual(
      expect.objectContaining({ field: "author.name", value: "Dana Kim", source: "dom-author", scope: "byline" }),
    );
  });

  test("scoped DOM profile preserves profile fields and ordered article list", () => {
    const { html, pageUrl } = cases.domProfile;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({
      name: "Carla Writer",
      slug: "carla-writer",
      bio: "Carla Writer covers policy and has reported on state government for more than a decade.",
      avatarUrl: "https://news.example/carla.jpg",
      email: "carla@example.com",
      designation: "Policy Editor",
    });
    expect(result.author.socials.map(({ platform, handle }) => ({ platform, handle }))).toEqual([
      { platform: "twitter", handle: "carlawriter" },
    ]);
    expect(result.articles).toEqual([
      {
        title: "A long enough policy story headline",
        url: "https://news.example/policy/story-one",
        publishedAt: "2025-01-01T00:00:00.000Z",
      },
      { title: "Another sufficiently descriptive headline", url: "https://news.example/policy/story-two" },
    ]);
    expect(result.review).toEqual([]);
    expect(result.provenance).toContainEqual(
      expect.objectContaining({ field: "author.name", value: "Carla Writer", source: "dom-author", scope: "profile" }),
    );
  });

  test("two current-article authors remain ambiguous with exact review identities", () => {
    const { html, pageUrl } = cases.multipleArticleAuthors;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toEqual({ name: "Unknown Author", socials: [] });
    expect(result.authors.map(({ name }) => name)).toEqual(["Alice Reporter", "Bob Editor"]);
    expect(result.review.map(({ reason, author }) => ({ reason, name: author.name }))).toEqual([
      { reason: "ambiguous_identity", name: "Alice Reporter" },
      { reason: "ambiguous_identity", name: "Bob Editor" },
    ]);
    expect(result.articles).toEqual([
      {
        title: "A joint investigation into procurement",
        url: "https://example.com/investigations/procurement",
        publishedAt: "2025-02-02T00:00:00.000Z",
      },
    ]);
    expect(
      result.review.map(
        ({ provenance }) =>
          provenance.find(
            ({ field, value }) => field === "author.name" && ["Alice Reporter", "Bob Editor"].includes(value),
          )?.value,
      ),
    ).toEqual(["Alice Reporter", "Bob Editor"]);
  });

  test("same-identity conflicting email is withheld and both variants remain reviewable", () => {
    const { html, pageUrl } = cases.conflictingEmail;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({ name: "Alice Reporter", id: 7, slug: "alice" });
    expect(result.author.email).toBeUndefined();
    expect(
      result.review
        .filter(({ reason }) => reason === "conflicting_value")
        .map(({ author }) => author.email)
        .sort(),
    ).toEqual(["one@example.org", "two@example.org"]);
    expect(result.provenance.some(({ field }) => field === "author.email")).toBe(false);
    expect(
      result.provenance.filter(
        ({ field, value }) => field.includes("email") && ["one@example.org", "two@example.org"].includes(value),
      ),
    ).toHaveLength(0);
  });

  test("malformed JSON-LD and Nuxt sources do not suppress later state, metadata, or articles", () => {
    const { html, pageUrl } = cases.malformedSources;
    const result = parseHtml({ html, pageUrl });
    expect(result.author.name).toBe("Later Writer");
    expect(result.author.id).toBe("w-1");
    expect(result.issues).toContainEqual({ sourcePath: "script[0]", message: "Malformed JSON-LD" });
    expect(
      result.issues.some(
        ({ sourcePath, message }) => sourcePath === "script[1]" && message.startsWith("Nuxt devalue decode failed"),
      ),
    ).toBe(true);
    expect(result.articles).toEqual([
      { title: "A valid story headline for extraction", url: "https://example.com/story/good" },
    ]);
    expect(result.provenance).toContainEqual(
      expect.objectContaining({ field: "author.name", value: "Later Writer", source: "hydration:window-state" }),
    );
  });

  test("resource limits reject oversized scripts and preserve independent meta evidence", () => {
    const { html, pageUrl, options } = cases.resourceLimits;
    const result = parseHtml({ html, pageUrl, ...options });
    expect(result.author).toEqual({ name: "Meta Writer", socials: [] });
    expect(result.issues).toContainEqual({ sourcePath: "script[0]", message: "Script exceeds maxScriptBytes" });
    expect(result.rawHydration).toBeUndefined();
    expect(() => parseHtml({ html: "ééé", pageUrl, maxHtmlBytes: 5 })).toThrow(RangeError);
    expect(() => parseHtml({ html: "", pageUrl, maxDecodeDepth: 0 })).toThrow(RangeError);
    expect(() => parseHtml({ html: "", pageUrl: "javascript:alert(1)" })).toThrow(TypeError);
  });

  test("URL-valued article author is not a name and linked byline remains authoritative", () => {
    const { html, pageUrl } = cases.urlArticleAuthor;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toMatchObject({ name: "Alice Reporter" });
    expect(result.author.name).not.toContain("facebook.com");
    expect(result.author.socials.map(({ platform, handle }) => ({ platform, handle }))).toEqual([
      { platform: "linkedin", handle: "alice-reporter" },
    ]);
    expect(result.metadata.description).toBe("A story summary");
    expect(result.provenance).toContainEqual(
      expect.objectContaining({ field: "author.name", value: "Alice Reporter", source: "dom-author", scope: "byline" }),
    );
    expect(
      result.provenance.some(({ field, value }) => field === "author.name" && value.includes("facebook.com")),
    ).toBe(false);
  });

  test("raw hydration is bounded, JSON-safe, opt-in, and does not alter resolved output", () => {
    const { html, pageUrl } = cases.rawHydration;
    const ordinary = parseHtml({ html, pageUrl });
    const included = parseHtml({ html, pageUrl, includeRawHydration: true });
    expect(ordinary.rawHydration).toBeUndefined();
    expect(included.author).toEqual(ordinary.author);
    expect(included.author).toMatchObject({ name: "Raw Writer", id: 1 });
    expect(included.rawHydration).toEqual([
      {
        source: "window-state",
        path: "script[0]@__INITIAL_STATE__",
        value: { author: { name: "Raw Writer", id: 1 }, meta: { note: "x".repeat(20) } },
      },
    ]);
    expect(() => JSON.stringify(included.rawHydration)).not.toThrow();
    expect(JSON.stringify(included.rawHydration)).toContain("Raw Writer");
    const bounded = parseHtml({ html, pageUrl, includeRawHydration: true, maxDecodeNodes: 2 });
    expect(JSON.stringify(bounded.rawHydration)).toContain("[Truncated]");
  });

  test("empty document uses requested URL as canonical with no inferred author or articles", () => {
    const { html, pageUrl } = cases.emptyDocument;
    const result = parseHtml({ html, pageUrl });
    expect(result.author).toEqual({ name: "Unknown Author", socials: [] });
    expect(result.authors).toEqual([]);
    expect(result.metadata).toEqual({ canonicalUrl: "https://example.com/empty" });
    expect(result.articles).toEqual([]);
    expect(result.review).toEqual([]);
    expect(result.provenance).toContainEqual(
      expect.objectContaining({ field: "metadata.canonicalUrl", value: pageUrl, sourcePath: "pageUrl" }),
    );
  });
});
