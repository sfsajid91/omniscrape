import { describe, expect, test } from "bun:test";
import { parseHtml } from "../src/index";
import type { ParserOutput } from "../src/types";
import { publisherCases } from "./fixtures/publisher-cases";

const cases = new Map(publisherCases.map((publisherCase) => [publisherCase.id, publisherCase]));

function parse(id: string) {
  const publisherCase = cases.get(id);
  if (!publisherCase) throw new Error(`Missing publisher fixture: ${id}`);
  return parseHtml(publisherCase.html, publisherCase.pageUrl);
}
function provenance(result: ParserOutput, prefix: string) {
  return result.provenance
    .filter(({ field }) => field.startsWith(prefix))
    .map(({ field, sourcePath }) => `${field} @ ${sourcePath}`)
    .sort();
}
const articleValues = (result: ParserOutput) => result.articles.map(({ title, url }) => ({ title, url }));
const articleProvenance = (result: ParserOutput) =>
  result.provenance
    .filter(({ field }) => field.startsWith("articles["))
    .map(({ field, sourcePath }) => `${field} @ ${sourcePath}`);
const unknownAuthor = { name: "Unknown Author", socials: [] };

describe("integrated publisher-shaped regressions", () => {
  test("BI accepts wrapped inert Fenrir config, preserves the ProfilePage author, and excludes bio links from articles", () => {
    const result = parse("BI wrapped Fenrir profile");

    expect(result.author).toEqual({ name: "Alex Rivera", slug: "alex-rivera", socials: [] });
    expect(result.authors).toEqual([{ name: "Alex Rivera", slug: "alex-rivera", socials: [] }]);
    expect(result.review).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.articles).toEqual([
      {
        title: "Markets rise as investors assess the latest corporate earnings",
        url: "https://www.businessinsider.example/markets/first",
      },
      {
        title: "Technology companies announce new products for global customers",
        url: "https://www.businessinsider.example/technology/second",
      },
    ]);
    expect(result.metadata).toEqual({
      title: "Alex Rivera - Business Insider",
      description: "Alex Rivera reports on business and technology.",
      canonicalUrl: "https://www.businessinsider.example/author/alex-rivera",
    });
    expect(provenance(result, "metadata.")).toEqual([
      "metadata.canonicalUrl @ link[0]@href",
      "metadata.description @ meta[0]@content",
      "metadata.title @ html:nth-of-type(1) > head:nth-of-type(1) > title:nth-of-type(1)",
    ]);
    expect(provenance(result, "author.")).toEqual([
      "author.name @ script[0].mainEntity.name",
      "author.slug @ script[0].mainEntity.url",
    ]);
    expect(articleProvenance(result)).toEqual([
      "articles[0].title @ html:nth-of-type(1) > body:nth-of-type(1) > section:nth-of-type(2) > h2:nth-of-type(1)",
      "articles[0].url @ html:nth-of-type(1) > body:nth-of-type(1) > section:nth-of-type(2) > h2:nth-of-type(1) > a:nth-of-type(1)@href",
      "articles[1].title @ html:nth-of-type(1) > body:nth-of-type(1) > section:nth-of-type(3) > h2:nth-of-type(1)",
      "articles[1].url @ html:nth-of-type(1) > body:nth-of-type(1) > section:nth-of-type(3) > h2:nth-of-type(1) > a:nth-of-type(1)@href",
    ]);
    expect(result.provenance.some(({ sourcePath }) => sourcePath.includes("awards/"))).toBe(false);
  });

  test("CBC lineup card authors do not leak into attribution while all twenty DOM cards remain articles", () => {
    const result = parse("CBC lineup with story cards");

    expect(result.author).toEqual(unknownAuthor);
    expect(result.authors).toEqual([]);
    expect(result.review).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(articleValues(result)).toEqual(
      Array.from({ length: 20 }, (_, index) => ({
        title: `CBC story headline number ${index + 1} covers a significant event around the world`,
        url: `https://www.cbc.example/news/story-${index + 1}`,
      })),
    );
    expect(result.metadata).toEqual({
      title: "World News | CBC",
      description: "The latest world news and analysis from CBC.",
      canonicalUrl: "https://www.cbc.example/news/world",
    });
    expect(provenance(result, "metadata.")).toEqual([
      "metadata.canonicalUrl @ link[0]@href",
      "metadata.description @ meta[0]@content",
      "metadata.title @ html:nth-of-type(1) > head:nth-of-type(1) > title:nth-of-type(1)",
    ]);
    expect(articleProvenance(result)).toEqual(
      Array.from({ length: 20 }, (_, index) => {
        const card = `html:nth-of-type(1) > body:nth-of-type(1) > article:nth-of-type(${index + 1})`;
        return [
          `articles[${index}].title @ ${card} > h2:nth-of-type(1)`,
          `articles[${index}].url @ ${card} > h2:nth-of-type(1) > a:nth-of-type(1)@href`,
        ];
      }).flat(),
    );
    expect(result.provenance.some(({ field }) => field.startsWith("author."))).toBe(false);
  });

  test("Guardian profile uses corroborated DOM bio and portrait rather than encoded metadata as biography", () => {
    const result = parse("Guardian Nicola Davis profile");
    const bio = "Nicola Davis is a science correspondent covering wildlife, climate and the natural world.";

    expect(result.author).toEqual({
      name: "Nicola Davis",
      slug: "nicola-davis",
      bio,
      avatarUrl: "https://www.theguardian.example/images/nicola-davis.jpg",
      socials: [],
    });
    expect(result.authors).toEqual([result.author]);
    expect(result.review).toEqual([]);
    expect(result.articles).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.metadata).toEqual({
      title: "Nicola Davis | The Guardian",
      description: "Nicola Davis writes about science and the natural world.",
      canonicalUrl: "https://www.theguardian.example/profile/nicola-davis",
    });
    expect(provenance(result, "metadata.")).toEqual([
      "metadata.canonicalUrl @ link[0]@href",
      "metadata.description @ meta[0]@content",
      "metadata.title @ html:nth-of-type(1) > head:nth-of-type(1) > title:nth-of-type(1)",
    ]);
    expect(provenance(result, "author.")).toEqual([
      "author.avatarUrl @ html:nth-of-type(1) > body:nth-of-type(1) > section:nth-of-type(1) > picture:nth-of-type(1) > img:nth-of-type(1)",
      "author.bio @ html:nth-of-type(1) > body:nth-of-type(1) > section:nth-of-type(1) > p:nth-of-type(1)",
      "author.name @ html:nth-of-type(1) > body:nth-of-type(1) > section:nth-of-type(1) > h2:nth-of-type(1)",
      "author.slug @ pageUrl",
    ]);
  });

  test("NPR archived profile binds the heading and speakable biography to separate sources", () => {
    const result = parse("NPR archived Tony Cox profile");
    const bio = "Tony Cox has covered public radio, national affairs and culture for more than three decades.";

    expect(result.author).toEqual({ name: "Tony Cox", slug: "tony-cox", bio, socials: [] });
    expect(result.authors).toEqual([result.author]);
    expect(result.review).toEqual([]);
    expect(result.articles).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.metadata).toEqual({
      title: "Tony Cox : NPR",
      description: "Tony Cox is an award-winning journalist.",
      canonicalUrl: "https://www.npr.example/people/2100394/tony-cox",
    });
    expect(provenance(result, "metadata.")).toEqual([
      "metadata.canonicalUrl @ link[0]@href",
      "metadata.description @ meta[0]@content",
      "metadata.title @ html:nth-of-type(1) > head:nth-of-type(1) > title:nth-of-type(1)",
    ]);
    expect(provenance(result, "author.")).toEqual([
      "author.bio @ html:nth-of-type(1) > body:nth-of-type(1) > div:nth-of-type(1) > b:nth-of-type(2)",
      "author.name @ html:nth-of-type(1) > body:nth-of-type(1) > header:nth-of-type(1) > h2:nth-of-type(1)",
      "author.slug @ pageUrl",
    ]);
  });

  test("Guardian world listing retains metadata and all seventeen headlines without inventing an author", () => {
    const result = parse("Guardian world listing");

    expect(result.author).toEqual(unknownAuthor);
    expect(result.authors).toEqual([]);
    expect(result.review).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(articleValues(result)).toEqual(
      Array.from({ length: 17 }, (_, index) => ({
        title: `World headline number ${index + 1} reports on a significant local development`,
        url: `https://www.theguardian.example/world/story-${index + 1}`,
      })),
    );
    expect(result.metadata).toEqual({
      title: "World news | The Guardian",
      description: "Latest international news, analysis and features.",
      canonicalUrl: "https://www.theguardian.example/world",
    });
    expect(provenance(result, "metadata.")).toEqual([
      "metadata.canonicalUrl @ link[0]@href",
      "metadata.description @ meta[0]@content",
      "metadata.title @ html:nth-of-type(1) > head:nth-of-type(1) > title:nth-of-type(1)",
    ]);
    expect(articleProvenance(result)).toEqual(
      Array.from({ length: 17 }, (_, index) => {
        const card = `html:nth-of-type(1) > body:nth-of-type(1) > main:nth-of-type(1) > article:nth-of-type(${index + 1})`;
        return [
          `articles[${index}].title @ ${card} > h2:nth-of-type(1)`,
          `articles[${index}].url @ ${card} > h2:nth-of-type(1) > a:nth-of-type(1)@href`,
        ];
      }).flat(),
    );
    expect(result.provenance.some(({ field }) => field.startsWith("author."))).toBe(false);
  });
});
