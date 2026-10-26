import { expect, test } from "bun:test";
import { dateString, emailAddress, httpUrl, imageUrl, personName, socialLink, stripHtml } from "../src/values";

const base = "https://publisher.example/authors/alice";

test("social links require actual platform hosts and personal profile paths", () => {
  for (const value of [
    "https://linkedin.com.attacker.example/in/alice",
    "https://elsewhere.example/?next=https://x.com/alice",
    "https://x.com/intent/tweet?text=hello",
    "https://instagram.com/p/post",
    "https://linkedin.com/in/alice/details",
    "javascript:alert(1)",
  ]) {
    expect(socialLink(value, base)).toBeUndefined();
  }
  const linkedin = socialLink("https://www.linkedin.com/in/alice/?trk=site#about", base);
  expect(linkedin).toMatchObject({
    platform: "linkedin",
    url: "https://www.linkedin.com/in/alice",
    handle: "alice",
    isPersonal: true,
  });
  expect(socialLink("https://linkedin.com/company/publisher", base)).toMatchObject({
    platform: "linkedin",
    handle: "publisher",
    isPersonal: false,
  });
  expect(socialLink("https://bsky.app/profile/tomwarren.co.uk", base)).toMatchObject({
    platform: "bluesky",
    handle: "tomwarren.co.uk",
    isPersonal: true,
  });
  expect(socialLink("https://threads.net/@alice", base)?.handle).toBe("alice");
  expect(socialLink("https://youtube.com/@alice", base)?.handle).toBe("alice");
  expect(socialLink("https://youtube.com/channel/UC123", base)).toMatchObject({ handle: "UC123", isPersonal: false });
});

test("malformed HTTP schemes are withheld while relative and protocol-relative URLs resolve", () => {
  for (const value of ["https:", "http:", "https:/", "http:/"]) expect(httpUrl(value, base)).toBeUndefined();
  expect(httpUrl("../portrait.jpg", base)).toBe("https://publisher.example/portrait.jpg");
  expect(httpUrl("//cdn.example/image.jpg", base)).toBe("https://cdn.example/image.jpg");
  expect(httpUrl("https://user:secret@example.org/", base)).toBeUndefined();
});

test("normalization rejects malformed optional values without losing valid URLs or zero timestamps", () => {
  expect(dateString("not-a-date")).toBeUndefined();
  expect(dateString(0)).toBe("1970-01-01T00:00:00.000Z");
  expect(emailAddress("mailto:alice%40example.org?subject=Hi")).toBe("alice@example.org");
  expect(emailAddress("newsroom@example.org")).toBeUndefined();
  expect(emailAddress("bad@example.c")).toBeUndefined();
  expect(imageUrl({ contentUrl: "/alice.jpg" }, base)).toBe("https://publisher.example/alice.jpg");
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  expect(imageUrl(cyclic, base)).toBeUndefined();
});

test("normalizes Unix seconds and validates calendar dates before timezone conversion", () => {
  expect(dateString(1_728_000_000)).toBe("2024-10-04T00:00:00.000Z");
  expect(dateString("1728000000")).toBe("2024-10-04T00:00:00.000Z");
  expect(dateString("20240102")).toBe("2024-01-02T00:00:00.000Z");
  expect(dateString(20240102)).toBe("2024-01-02T00:00:00.000Z");
  expect(dateString("2024-02-29T23:30:00-02:00")).toBe("2024-03-01T01:30:00.000Z");
  expect(dateString("2024-02-30T12:00:00Z")).toBeUndefined();
  expect(dateString("2023-02-29")).toBeUndefined();
  expect(dateString("2024-02-29")).toBe("2024-02-29T00:00:00.000Z");
  expect(dateString("2999-01-01")).toBeUndefined();
});

test("strips a byline label and collapses whitespace in person names", () => {
  expect(personName("  By   Alice   Reporter ")).toBe("Alice Reporter");
  expect(personName("Written by Bob Writer")).toBe("Bob Writer");
  expect(personName("Byron Writer")).toBe("Byron Writer");
  expect(personName("B")).toBeUndefined();
});

test("decodes one remaining HTML character-reference layer before stripping markup", () => {
  expect(stripHtml("Ren&amp;eacute; &lt;b&gt;Writer&lt;/b&gt;")).toBe("Ren&eacute; Writer");
  expect(stripHtml("Ren&amp;amp;eacute;")).toBe("Ren&amp;eacute;");
});
