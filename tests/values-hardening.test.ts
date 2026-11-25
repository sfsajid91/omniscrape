import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/parse";
import { dateString, decodeEntities, emailAddress, personName, socialLink, stripHtml, text } from "../src/values";

const base = "https://publisher.example/authors/alice";

describe("PageContext script MIME and base href boundaries", () => {
  test("recognizes JSON-LD and hydration scripts with MIME parameters", () => {
    const jsonLdHtml = `
      <html><head>
        <script type="application/ld+json; charset=utf-8">
          {"@context":"https://schema.org","@type":"NewsArticle","headline":"Charset Story","author":{"@type":"Person","name":"Alice Charset","url":"/authors/alice-charset"}}
        </script>
      </head><body></body></html>
    `;
    const jsonLdResult = parseHtml({ html: jsonLdHtml, pageUrl: "https://publisher.example/story" });
    expect(jsonLdResult.author.name).toBe("Alice Charset");

    const flightHtml = `
      <html><body>
        <script type="text/javascript; charset=utf-8">
          self.__next_f.push([1, "0:{\\"author\\":{\\"name\\":\\"Bob Hydration\\",\\"slug\\":\\"bob-hydration\\"}}\\n"]);
        </script>
      </body></html>
    `;
    const flightResult = parseHtml({ html: flightHtml, pageUrl: "https://publisher.example/story" });
    expect(flightResult.author.name).toBe("Bob Hydration");
  });

  test("ignores base tags without a valid href when resolving later base hrefs", () => {
    const html = `
      <html><head>
        <base target="_blank">
        <base href="javascript:alert(1)">
        <base href="https://publisher.example/news/">
        <base href="https://ignored.example/other/">
        <link rel="canonical" href="stories/lead">
        <meta property="og:image" content="images/hero.jpg">
      </head><body>
        <main><article><h2><a href="stories/second">Second lead headline story</a></h2></article></main>
      </body></html>
    `;
    const result = parseHtml({ html, pageUrl: "https://publisher.example/raw" });
    expect(result.metadata.canonicalUrl).toBe("https://publisher.example/news/stories/lead");
    expect(result.metadata.ogImage).toBe("https://publisher.example/news/images/hero.jpg");
    expect(result.articles[0]?.url).toBe("https://publisher.example/news/stories/second");
  });
});

describe("text and personName hardening", () => {
  test("strips null bytes before collapsing whitespace", () => {
    expect(text("Alice\0Reporter")).toBe("AliceReporter");
    expect(text("Alice \0 Reporter")).toBe("Alice Reporter");
    expect(text("\0\0")).toBeUndefined();
    expect(personName("By: Alice\0Reporter")).toBe("AliceReporter");
  });

  test("strips optional colons after leading byline prefixes without harming names", () => {
    expect(personName("By: Alice Reporter")).toBe("Alice Reporter");
    expect(personName("By : Alice Reporter")).toBe("Alice Reporter");
    expect(personName("By:Alice Reporter")).toBe("Alice Reporter");
    expect(personName("Written by: Bob Writer")).toBe("Bob Writer");
    expect(personName("Byron Writer")).toBe("Byron Writer");
    expect(personName("By:")).toBeUndefined();
  });
});

describe("dateString and numericDate hardening", () => {
  test("parses 9-digit Unix seconds and rejects small non-compact numeric timestamps", () => {
    expect(dateString(999_999_999)).toBe("2001-09-09T01:46:39.000Z");
    expect(dateString("999999999")).toBe("2001-09-09T01:46:39.000Z");
    expect(dateString(1_000_000_000_000)).toBe("2001-09-09T01:46:40.000Z");
    for (const invalid of [-1, 1, 12, 42, 1000, 12_345_678, 99_999_999]) {
      expect(dateString(invalid)).toBeUndefined();
    }
    expect(dateString(20240102)).toBe("2024-01-02T00:00:00.000Z");
  });

  test("rejects loose non-date strings while accepting standard date formats", () => {
    for (const loose of ["0", "1", "12", "Article 1", "Part 2026", "Chapter 5"]) {
      expect(dateString(loose)).toBeUndefined();
    }
    expect(dateString("2024-10-04")).toBe("2024-10-04T00:00:00.000Z");
    expect(dateString("2024-10")).toBe("2024-10-01T00:00:00.000Z");
    expect(dateString("Mon, 04 Oct 2024 12:00:00 GMT")).toBe("2024-10-04T12:00:00.000Z");
    expect(dateString("December 05, 2024")).toBe("2024-12-05T00:00:00.000Z");
    expect(dateString("2024/10/04")).toBeDefined();
  });
});

describe("emailAddress hardening", () => {
  test("scans past excluded generic addresses and decodes percent-encoded @", () => {
    expect(emailAddress("Send info@example.com or alice@example.com")).toBe("alice@example.com");
    expect(emailAddress("Contact alice%40example.org for interviews")).toBe("alice@example.org");
    expect(emailAddress("100% legit: admin@example.com or alice%40example.org")).toBe("alice@example.org");
  });

  test("excludes non-personal institutional inboxes", () => {
    const excluded = [
      "editors",
      "letters",
      "webmaster",
      "admin",
      "hello",
      "sales",
      "marketing",
      "careers",
      "jobs",
      "legal",
      "dmca",
      "copyright",
      "noreply",
      "no-reply",
      "team",
      "media",
      "pr",
      "office",
      "general",
      "enquiries",
      "inquiries",
      "subscribe",
      "membership",
    ];
    for (const local of excluded) {
      expect(emailAddress(`${local}@example.org`)).toBeUndefined();
    }
  });
});

describe("socialLink hardening", () => {
  test("supports Mastodon profiles on known and mastodon-named hosts", () => {
    expect(socialLink("https://mastodon.social/@alice", base)).toEqual({
      platform: "mastodon",
      url: "https://mastodon.social/@alice",
      handle: "alice",
      isPersonal: true,
    });
    expect(socialLink("https://hachyderm.io/@reporter", base)).toMatchObject({
      platform: "mastodon",
      handle: "reporter",
      isPersonal: true,
    });
    expect(socialLink("https://news.mastodon.example/@editor", base)).toMatchObject({
      platform: "mastodon",
      handle: "editor",
      isPersonal: true,
    });
    expect(socialLink("https://mastodon.social/@alice/11223344", base)).toBeUndefined();
    expect(socialLink("https://mastodon.social/about", base)).toBeUndefined();
  });

  test("normalizes localized LinkedIn and /about paths on Substack and Medium", () => {
    expect(socialLink("https://www.linkedin.com/in/alice-reporter/en", base)).toEqual({
      platform: "linkedin",
      url: "https://www.linkedin.com/in/alice-reporter",
      handle: "alice-reporter",
      isPersonal: true,
    });
    expect(socialLink("https://www.linkedin.com/in/alice-reporter/details", base)).toBeUndefined();
    expect(socialLink("https://alice.substack.com/about", base)).toEqual({
      platform: "substack",
      url: "https://alice.substack.com/",
      handle: "alice",
      isPersonal: true,
    });
    expect(socialLink("https://medium.com/@alice/about", base)).toEqual({
      platform: "medium",
      url: "https://medium.com/@alice",
      handle: "alice",
      isPersonal: true,
    });
    expect(socialLink("https://alice.medium.com/about", base)).toEqual({
      platform: "medium",
      url: "https://alice.medium.com/",
      handle: "alice",
      isPersonal: true,
    });
    expect(socialLink("https://medium.com/@alice/some-story", base)).toBeUndefined();
  });

  test("rejects non-profile utility paths on X, GitHub, and Facebook", () => {
    for (const nonProfile of [
      "https://x.com/privacy",
      "https://twitter.com/tos",
      "https://x.com/about",
      "https://x.com/help",
      "https://x.com/rules",
      "https://x.com/hashtag",
      "https://github.com/about",
      "https://github.com/pricing",
      "https://github.com/security",
      "https://github.com/enterprise",
      "https://github.com/sponsors",
      "https://github.com/orgs",
      "https://github.com/marketplace",
      "https://github.com/contact",
      "https://github.com/readme",
      "https://github.com/status",
      "https://github.com/customer-stories",
      "https://facebook.com/pages",
      "https://facebook.com/groups",
      "https://facebook.com/events",
      "https://facebook.com/help",
      "https://facebook.com/privacy",
      "https://facebook.com/policies",
      "https://facebook.com/about",
      "https://facebook.com/terms",
      "https://facebook.com/business",
      "https://facebook.com/tr",
    ]) {
      expect(socialLink(nonProfile, base)).toBeUndefined();
    }
  });
});

describe("decodeEntities and stripHtml hardening", () => {
  test("decodes common HTML5 named entities accurately and preserves case sensitivity", () => {
    expect(decodeEntities("&ldquo;Hello&rdquo; &ndash; &mdash; &hellip; &euro;10 &copy;")).toBe("“Hello” – — … €10 ©");
    expect(decodeEntities("&dagger;&Dagger;&prime;&Prime;")).toBe("†‡′″");
    expect(decodeEntities("&Eacute;cole &AElig;on &szlig; &Ntilde; &uuml;")).toBe("École Æon ß Ñ ü");
    expect(decodeEntities("&hearts; &unknown; &constructor;")).toBe("♥ &unknown; &constructor;");
  });

  test("strips script and style blocks while preserving non-tag angle brackets", () => {
    expect(stripHtml("Growth is &lt; 5% when rates are &gt; 3%")).toBe("Growth is < 5% when rates are > 3%");
    expect(stripHtml("Alice.<script>alert(1)</script><style>.a{color:red}</style> End.")).toBe("Alice. End.");
    expect(stripHtml("Alice.&lt;script&gt;alert(1)&lt;/script&gt; End.")).toBe("Alice. End.");
    expect(stripHtml("Before <!-- hidden comment --> After")).toBe("Before After");
    expect(stripHtml("Ren&amp;eacute; &lt;b&gt;Writer&lt;/b&gt;")).toBe("Ren&eacute; Writer");
    expect(stripHtml("Ren&amp;amp;eacute;")).toBe("Ren&amp;eacute;");
    expect(stripHtml("&lt;/tag&gt; visible")).toBe("visible");
  });
});
