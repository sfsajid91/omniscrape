import { parseHTML } from "linkedom";
import { createPageContext, DEFAULT_LIMITS, type ExtractionLimits } from "./core/context";
import { extractDomAndMeta } from "./extractors/dom-meta";
import { extractHydrationData } from "./extractors/hydration";
import { extractJsonLd } from "./extractors/json-ld";
import { resolveParserOutput } from "./core/resolver";
import { detectTechStack } from "./tech-detector";
import type { ParserOutput } from "./types";
import { httpUrl } from "./values";

/**
 * Resource limits and extraction toggles for Omniscrape.
 */
export interface ParseOptions extends Partial<ExtractionLimits> {
  /**
   * When true, includes bounded raw hydration payload snapshots in the output under `rawHydration`.
   * Defaults to false.
   */
  includeRawHydration?: boolean;

  /**
   * Whether to include field-level provenance records for articles in the catalog (`articles[i].*`).
   * When false, provenance only tracks author, editorial, and page metadata, slashing payload size on listing pages.
   * Defaults to true.
   */
  includeArticleProvenance?: boolean;

  /**
   * Granularity mode for article provenance records when `includeArticleProvenance` is true:
   * - "property": Emits individual records for title, url, and publishedAt per article (default).
   * - "item": Emits a single consolidated `articles[i]` record per article, reducing records by ~65%.
   * Defaults to "property".
   */
  articleProvenanceMode?: "property" | "item";

  /**
   * Provenance collection scope:
   * - "all": Collects provenance across all entities (author, editorial, metadata, articles) (default).
   * - "identity": Only collects provenance for author, editorial, and page metadata (omits catalog articles).
   * - "none": Disables provenance collection entirely (`output.provenance = []`).
   * Defaults to "all".
   */
  provenanceScope?: "all" | "identity" | "none";

  /**
   * When true, suppresses redundant `authors[0].*` provenance records when there is a single author matching `author`.
   * Defaults to false.
   */
  dedupeAuthorProvenance?: boolean;
}

/**
 * Options and parameters for invoking {@link parseHtml} with a single configuration object.
 */
export interface ParseHtmlInput extends ParseOptions {
  /**
   * The raw HTML markup string to parse.
   */
  html: string;

  /**
   * The final, resolved canonical URL of the page (must be an HTTP or HTTPS URL without credentials).
   */
  pageUrl: string;
}

function extractionLimits(options?: ParseOptions): ExtractionLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof ExtractionLimits>) {
    const value = options?.[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${key} must be a positive safe integer`);
    limits[key] = value;
  }
  return limits;
}

/**
 * Parses an HTML document and extracts structured metadata, author identities,
 * co-author attributions, article catalogs, and field-level provenance using a configuration object.
 *
 * @param input - An object containing `html`, `pageUrl`, and optional parsing limits/toggles.
 * @returns Fully validated {@link ParserOutput} including author, metadata, articles, and review queues.
 * @throws {TypeError} If `html` or `pageUrl` is not a string, or if `pageUrl` contains credentials or is not HTTP(S).
 * @throws {RangeError} If HTML size or extraction limits exceed safe thresholds.
 *
 * @example
 * ```ts
 * const result = parseHtml({
 *   html: "<html>...</html>",
 *   pageUrl: "https://example.com/article",
 *   maxHtmlBytes: 2 * 1024 * 1024,
 * });
 * console.log(result.author.name, result.metadata.title);
 * ```
 */
export function parseHtml(input: ParseHtmlInput): ParserOutput;

/**
 * Parses an HTML document and extracts structured metadata, author identities,
 * co-author attributions, article catalogs, and field-level provenance using positional arguments.
 *
 * @param html - Raw HTML markup string to parse.
 * @param pageUrl - Final canonical HTTP(S) URL of the document.
 * @param options - Optional resource limits (e.g. `maxHtmlBytes`, `maxDecodeDepth`) and debug flags.
 * @returns Fully validated {@link ParserOutput} including author, metadata, articles, and review queues.
 * @throws {TypeError} If `html` or `pageUrl` is not a string, or if `pageUrl` contains credentials or is not HTTP(S).
 * @throws {RangeError} If HTML size or extraction limits exceed safe thresholds.
 *
 * @example
 * ```ts
 * const result = parseHtml("<html>...</html>", "https://example.com/article");
 * console.log(result.author.name);
 * ```
 */
export function parseHtml(html: string, pageUrl: string, options?: ParseOptions): ParserOutput;

export function parseHtml(
  htmlOrInput: string | ParseHtmlInput,
  maybePageUrl?: string,
  maybeOptions?: ParseOptions,
): ParserOutput {
  let html: string;
  let pageUrl: string;
  let options: ParseOptions | undefined;

  if (typeof htmlOrInput === "object" && htmlOrInput !== null) {
    html = htmlOrInput.html;
    pageUrl = htmlOrInput.pageUrl;
    options = htmlOrInput;
  } else if (typeof htmlOrInput === "string") {
    html = htmlOrInput;
    pageUrl = maybePageUrl as string;
    options = maybeOptions;
  } else {
    throw new TypeError("html must be a string or a ParseHtmlInput object");
  }

  if (typeof html !== "string") {
    throw new TypeError("html must be a string");
  }
  if (typeof pageUrl !== "string") {
    throw new TypeError("pageUrl must be a string");
  }

  const url = httpUrl(pageUrl, pageUrl);
  if (!url) throw new TypeError("pageUrl must be an HTTP(S) URL without credentials");
  const limits = extractionLimits(options);
  if (Buffer.byteLength(html) > limits.maxHtmlBytes) throw new RangeError("HTML exceeds maxHtmlBytes");
  const wrappedHtml = /<html[\s>]/i.test(html) ? html : `<html><head></head><body>${html}</body></html>`;
  const { document } = parseHTML(wrappedHtml);
  const context = createPageContext(document, html, url, limits);
  const techStack = detectTechStack(context);
  context.includeRawHydration = options?.includeRawHydration ?? false;
  const hydration = extractHydrationData(context);
  const jsonLd = extractJsonLd(context);
  const domMeta = extractDomAndMeta(context);
  return resolveParserOutput({
    context,
    techStack,
    hydration,
    jsonLd,
    domMeta,
    includeRawHydration: options?.includeRawHydration ?? false,
    includeArticleProvenance: options?.includeArticleProvenance,
    articleProvenanceMode: options?.articleProvenanceMode,
    provenanceScope: options?.provenanceScope,
    dedupeAuthorProvenance: options?.dedupeAuthorProvenance,
  });
}
