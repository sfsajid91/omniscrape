import { parseHtml } from "../src/index";
import { type TestCase, testCases } from "./cases";

type MetaScraper = (input: { html: string; url: string }) => Promise<unknown>;
type Callable = (...args: unknown[]) => unknown;

function defaultExport(value: unknown): unknown {
  return value && typeof value === "object" && "default" in value ? value.default : value;
}

function callable(value: unknown, description: string): Callable {
  if (typeof value !== "function") throw new TypeError(`${description} is not callable`);
  return value as Callable;
}

async function loadMetaScraper(): Promise<MetaScraper> {
  const packageNames = [
    "metascraper",
    "metascraper-author",
    "metascraper-date",
    "metascraper-description",
    "metascraper-image",
    "metascraper-publisher",
    "metascraper-title",
    "metascraper-url",
  ];
  const modules = await Promise.all(packageNames.map(async (packageName): Promise<unknown> => import(packageName)));
  const createMetascraper = callable(defaultExport(modules[0]), "metascraper export");
  const pluginFactories = modules
    .slice(1)
    .map((module, index) => callable(defaultExport(module), `${packageNames[index + 1]} export`));
  const scraper = createMetascraper(pluginFactories.map((factory) => factory()));
  return callable(scraper, "metascraper instance") as MetaScraper;
}

export async function runCases(cases: readonly TestCase[] = testCases, compare = false): Promise<number> {
  let passed = 0;
  let comparator: MetaScraper | undefined;
  if (compare) {
    try {
      comparator = await loadMetaScraper();
    } catch (error) {
      console.error(`Comparator unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
  for (const tc of cases) {
    try {
      const result = parseHtml(tc.html, tc.pageUrl, tc.options);
      tc.verify(result);
      if (comparator) {
        try {
          const comparison = await comparator({ html: tc.html, url: tc.pageUrl });
          console.log(`COMPARE ${tc.id}: ${JSON.stringify(comparison)}`);
        } catch (error) {
          console.error(`COMPARATOR ERROR ${tc.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      passed += 1;
      console.log(`PASS ${tc.id}: ${tc.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL ${tc.id}: ${tc.name}\n${message}`);
    }
  }
  console.log(`SUMMARY: ${passed}/${cases.length} contracts passed`);
  return passed === cases.length ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = await runCases(testCases, process.argv.includes("--compare"));
}
