import { parseHTML } from "linkedom";
import { createPageContext, DEFAULT_LIMITS } from "../src/core/context";
import { resolveParserOutput } from "../src/core/resolver";
import { extractDomAndMeta } from "../src/extractors/dom-meta";
import { extractHydrationData } from "../src/extractors/hydration";
import { extractJsonLd } from "../src/extractors/json-ld";
import { detectTechStack } from "../src/tech-detector";

const stages = ["DOM", "Index", "Detect", "Hydration", "JSON-LD", "DOM extraction", "Resolve"] as const;
const url = "https://example.test/author/alice";

function measure(html: string): number[] {
  let previous = performance.now();
  const times: number[] = [];
  const mark = () => {
    const now = performance.now();
    times.push(now - previous);
    previous = now;
  };
  const { document } = parseHTML(html);
  mark();
  const context = createPageContext(document, html, url, DEFAULT_LIMITS);
  mark();
  const techStack = detectTechStack(context);
  mark();
  const hydration = extractHydrationData(context);
  mark();
  const jsonLd = extractJsonLd(context);
  mark();
  const domMeta = extractDomAndMeta(context);
  mark();
  const output = resolveParserOutput({ context, techStack, hydration, jsonLd, domMeta });
  mark();
  if (output.author.name !== "Alice Reporter" || output.articles.length !== 2)
    throw new Error("Benchmark fixture extraction changed");
  return times;
}

if (import.meta.main) {
  const rows: Array<Record<string, string | number>> = [];
  const item =
    '<section class="card"><h2><a href="/stories/example">A real story title for benchmarking</a></h2><p>Some article preview content for the page.</p><a href="/tag/local">Local news</a></section>';
  for (const count of [25, 250, 2500, 10000]) {
    const state = {
      props: {
        pageProps: {
          author: { name: "Alice Reporter", bio: "Alice covers markets and economics." },
          articles: [{ title: "A real story title", url: "https://example.test/story" }],
          padding: "x".repeat(count * 80),
        },
      },
    };
    const html =
      "<html><head><title>Alice Reporter</title></head><body><h1>Alice Reporter</h1>" +
      item.repeat(count) +
      '<script id="__NEXT_DATA__" type="application/json">' +
      JSON.stringify(state) +
      "</script></body></html>";
    for (let i = 0; i < 4; i++) measure(html);
    const samples: number[][] = [];
    const repetitions = count < 1000 ? 20 : 5;
    for (let round = 0; round < 5; round++) {
      const sums = stages.map(() => 0);
      for (let i = 0; i < repetitions; i++)
        measure(html).forEach((value, index) => {
          sums[index]! += value;
        });
      samples.push(sums.map((value) => value / repetitions));
    }
    const medians = stages.map((_, index) => samples.map((sample) => sample[index]!).sort((a, b) => a - b)[2]!);
    const row: Record<string, string | number> = { bytes: Buffer.byteLength(html), sections: count };
    stages.forEach((name, index) => {
      row[`${name} ms`] = +medians[index]!.toFixed(3);
    });
    row["Stage sum ms"] = +medians.reduce((sum, value) => sum + value, 0).toFixed(3);
    rows.push(row);
  }
  console.log(
    "Synthetic HTML; four warmups, median of five batches. No network. Stage sums are not production latency guarantees.",
  );
  console.table(rows);
}
