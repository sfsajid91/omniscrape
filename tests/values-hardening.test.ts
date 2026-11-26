import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/parse";
import {
  dateString,
  decodeEntities,
  emailAddress,
  isAuthorProfileUrl,
  personName,
  socialLink,
  stripHtml,
  text,
} from "../src/values";

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
    expect(dateString("2024/10/04")).toBe("2024-10-04T00:00:00.000Z");
    expect(dateString("2024.10.04")).toBe("2024-10-04T00:00:00.000Z");
    expect(dateString("10/04/2024")).toBe("2024-10-04T00:00:00.000Z");
    expect(dateString("2024/02/29")).toBe("2024-02-29T00:00:00.000Z");
    expect(dateString("1st May 2024")).toBe("2024-05-01T00:00:00.000Z");
    expect(dateString("May 2024")).toBe("2024-05-01T00:00:00.000Z");
  });

  test("accepts Date instances and rejects calendar rollovers, dot-DMY, and loose prose", () => {
    expect(dateString(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(dateString("0")).toBeUndefined();
    expect(dateString(new Date("2026-05-01T10:15:00Z"))).toBe("2026-05-01T10:15:00.000Z");
    expect(dateString(new Date(Number.NaN))).toBeUndefined();
    expect(dateString(new Date("1899-12-31T23:59:59Z"))).toBeUndefined();
    expect(dateString(new Date("2201-01-01T00:00:00Z"))).toBeUndefined();

    for (const invalid of [
      "2026/02/29",
      "04/31/2026",
      "April 31, 2026",
      "29 Feb 2026",
      "Mon, 31 Apr 2026 12:00:00 GMT",
      "04.10.2024",
      "15.10.2024",
      "She may win in 2026",
      "Jan Doe 2026",
    ]) {
      expect(dateString(invalid), invalid).toBeUndefined();
    }

    expect(dateString("2024-10-04 12:00:00 GMT+06:00")).toBe("2024-10-04T06:00:00.000Z");
    expect(dateString("2024-10-04 12:00:00 UTC+05:30")).toBe("2024-10-04T06:30:00.000Z");
    expect(dateString("Mon, 04 Oct 2024 12:00:00 GMT+06:00")).toBe("2024-10-04T06:00:00.000Z");
    expect(dateString("Mon, 04 Oct 2024 12:00:00 UTC+05:30")).toBe("2024-10-04T06:30:00.000Z");
    expect(dateString("October 4, 2024 12:00:00 GMT+06:00")).toBe("2024-10-04T06:00:00.000Z");
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

  test("recognizes author about pages without treating corporate about pages as profiles", () => {
    expect(isAuthorProfileUrl("https://substack.com/@writer/about")).toBe(true);
    expect(isAuthorProfileUrl("https://medium.com/@writer/about")).toBe(true);
    expect(isAuthorProfileUrl("https://writer.substack.com/about")).toBe(true);
    expect(isAuthorProfileUrl("https://medium.com/about")).toBe(false);
    for (const url of ["https://substack.com/@writer/about", "https://writer.substack.com/about"]) {
      const json = { "@type": "ProfilePage", mainEntity: { "@type": "Person", name: "Writer", url } };
      const result = parseHtml({
        html: `<script type="application/ld+json">${JSON.stringify(json)}</script>`,
        pageUrl: url,
      });
      expect(result.author.slug).toBe("writer");
    }
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

  test("rejects bare @ paths, YouTube subpages, and @-prefixed reserved Twitter paths", () => {
    for (const rejected of [
      "https://threads.net/@",
      "https://threads.com/@",
      "https://youtube.com/@",
      "https://youtube.com/@alice/videos",
      "https://youtube.com/@alice/about",
      "https://youtube.com/@alice/shorts",
      "https://youtube.com/channel/UC123/videos",
      "https://youtube.com/videos",
      "https://youtube.com/about",
      "https://substack.com/@",
      "https://medium.com/@",
      "https://medium.com/@/about",
      "https://mastodon.social/@",
      "https://x.com/@",
      "https://x.com/@@@",
      "https://x.com/@intent",
      "https://twitter.com/@share",
    ]) {
      expect(socialLink(rejected, base), rejected).toBeUndefined();
    }

    expect(socialLink("https://x.com/@alice", base)).toEqual({
      platform: "twitter",
      url: "https://x.com/alice",
      handle: "alice",
      isPersonal: true,
    });
    expect(isAuthorProfileUrl("https://example.com/@")).toBe(false);
    expect(isAuthorProfileUrl("https://substack.com/@")).toBe(false);
    expect(isAuthorProfileUrl("https://example.com/@alice")).toBe(true);
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

  test("preserves invalid scalar references, avoids legacy prefix corruption, and does not drop entities after many unknowns", () => {
    expect(decodeEntities("&#xD800;&#xDFFF;&#55296;&#57343;&#0;&#x110000;")).toBe(
      "&#xD800;&#xDFFF;&#55296;&#57343;&#0;&#x110000;",
    );
    expect(decodeEntities("&#xD7FF;&#xE000;&#x10FFFF;")).toBe("\uD7FF\uE000\u{10FFFF}");
    expect(decodeEntities("&notanentity; &copycat; &regfoo;")).toBe("&notanentity; &copycat; &regfoo;");
    expect(decodeEntities("&not; &notin; &semi; &acE; &QUOT; &amp;hearts;")).toBe('¬ ∉ ; \u223e\u0333 " &hearts;');

    const manyUnknowns = Array.from({ length: 300 }, (_, i) => `&unknown${i};`).join(" ");
    expect(decodeEntities(`${manyUnknowns} &hearts;`)).toBe(`${manyUnknowns} ♥`);
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

  test("handles unclosed tags, quoted attributes, Unicode offsets, angle-bracket emails, and repeated malformed inputs linearly", () => {
    expect(stripHtml('<script>var s = "<!--";</script>Visible')).toBe("Visible");
    expect(stripHtml('<script src="x.js"/>After')).toBe("After");
    expect(stripHtml('<div title="a>b">hi</div>')).toBe("hi");
    expect(stripHtml("İstanbul <script>alert(1)</script> Ankara")).toBe("İstanbul Ankara");
    expect(stripHtml("Contact <foo@bar.com> or <foo.bar+tag@sub.example.com> or <mailto:foo@bar.com>")).toBe(
      "Contact <foo@bar.com> or <foo.bar+tag@sub.example.com> or <mailto:foo@bar.com>",
    );
    expect(stripHtml("a < b and 3 < 5 > 2")).toBe("a < b and 3 < 5 > 2");
    expect(stripHtml("Visible <script>unclosed")).toBe("Visible");
    expect(stripHtml("Visible <style>unclosed")).toBe("Visible");
    expect(stripHtml("Visible <!-- unclosed")).toBe("Visible");
    expect(stripHtml("Visible &lt;script&gt;unclosed")).toBe("Visible");
    expect(stripHtml("<script src=https://cdn.example/a.js/>alert(1)</script>Visible")).toBe("Visible");
    expect(stripHtml("<script data=foo/>secret")).toBeUndefined();
    expect(stripHtml("<style href=a/>body{color:red}</style>Visible")).toBe("Visible");
    expect(stripHtml("<b>hi</b/>")).toBe("hi");
    expect(stripHtml("<b>hi</b foo>")).toBe("hi");
    expect(stripHtml('<b>hi</b title="a>b">there')).toBe("hi there");
    expect(stripHtml("&lt;/b/&gt; visible")).toBe("visible");
    expect(stripHtml("&lt;/b foo&gt; visible")).toBe("visible");

    for (const payload of [
      "<script>".repeat(20_000),
      "<style>".repeat(20_000),
      "<!--".repeat(20_000),
      "<a ".repeat(20_000),
      `${'<a x=">'.repeat(5_000)} z='>`,
    ]) {
      const started = performance.now();
      stripHtml(payload);
      expect(performance.now() - started).toBeLessThan(250);
    }
  });
});
