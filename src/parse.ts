import { parseHTML } from "linkedom";
import { createPageContext, DEFAULT_LIMITS, type ExtractionLimits } from "./core/context";
import { resolveParserOutput } from "./core/resolver";
import { extractDomAndMeta } from "./extractors/dom-meta";
import { extractHydrationData } from "./extractors/hydration";
import { extractJsonLd } from "./extractors/json-ld";
import { detectTechStack } from "./tech-detector";
import type { ParserOutput } from "./types";
import { httpUrl } from "./values";

/**
 * Resource limits, provenance scopes, and extraction toggles for Omniscrape.
 */
export interface ParseOptions extends Partial<ExtractionLimits> {
  /**
   * Maximum allowed size in bytes of the incoming HTML markup string.
   * Throws `RangeError` if the HTML byte length exceeds this limit before parsing begins.
   *
   * @default 8388608 (8 MB)
   */
  maxHtmlBytes?: number;

  /**
   * Maximum allowed size in bytes for any individual `<script>` tag analyzed during
   * JSON-LD or hydration payload extraction. Scripts exceeding this threshold are
   * safely skipped without halting the parser, and recorded in `issues`.
   *
   * @default 2097152 (2 MB)
   */
  maxScriptBytes?: number;

  /**
   * Safety threshold for total AST and JSON nodes traversed during static hydration decoding
   * (e.g. Next.js Flight push chunks, Nuxt devalue graphs, Quintype/Fenrir assignments).
   * Prevents CPU exhaustion and denial-of-service from adversarial or deeply nested payloads.
   *
   * @default 50000
   */
  maxDecodeNodes?: number;

  /**
   * Maximum recursion and nesting depth allowed during static hydration and JSON AST traversal.
   * Protects against stack overflows and cyclic structures.
   *
   * @default 128
   */
  maxDecodeDepth?: number;

  /**
   * When true, includes bounded raw hydration payload snapshots in the output under `rawHydration`
   * for debugging, auditing, or inspection of framework hydration states.
   *
   * @default false
   */
  includeRawHydration?: boolean;

  /**
   * Whether to include field-level provenance records for articles in the catalog (`articles[i].*`).
   * When false, provenance only tracks author, editorial, and page metadata, slashing payload size on listing pages.
   *
   * @default true
   */
  includeArticleProvenance?: boolean;

  /**
   * Granularity mode for article provenance records when `includeArticleProvenance` is true:
   * - `"property"`: Emits individual records for `title`, `url`, and `publishedAt` per article (default).
   * - `"item"`: Emits a single consolidated `articles[i]` record per article, reducing records by ~65%.
   *
   * @default "property"
   */
  articleProvenanceMode?: "property" | "item";

  /**
   * Provenance collection scope:
   * - `"all"`: Collects provenance across all entities (author, editorial, metadata, articles) (default).
   * - `"identity"`: Only collects provenance for author, editorial, and page metadata (omits catalog articles).
   * - `"none"`: Disables provenance collection entirely (`output.provenance = []`).
   *
   * @default "all"
   */
  provenanceScope?: "all" | "identity" | "none";

  /**
   * When true, suppresses redundant `authors[0].*` provenance records when there is a single author matching `author`.
   *
   * @default false
   */
  dedupeAuthorProvenance?: boolean;
}

/**
 * Options and parameters for invoking {@link parseHtml} with a single configuration object.
 */
export interface ParseHtmlInput extends ParseOptions {
  /**
   * The raw HTML markup string to parse.
   * Can be a full document (`<html>...</html>`) or an HTML fragment.
   */
  html: string;

  /**
   * The final, resolved canonical URL of the page (e.g. after HTTP redirects).
   * Must be a valid HTTP or HTTPS URL without userinfo/credentials.
   *
   * Used for:
   * - Resolving relative URLs for avatars, canonical links, and articles.
   * - Namespacing raw CMS author IDs to the publisher origin.
   * - Fallback canonical URL when no `<link rel="canonical">` or OpenGraph URL is present.
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
 * @param input - The parsing configuration object.
 * @param input.html - Raw HTML markup string to parse (document or fragment).
 * @param input.pageUrl - Final canonical HTTP(S) URL of the document (without credentials).
 * @param input.maxHtmlBytes - Maximum allowed size in bytes of the incoming HTML string. Throws `RangeError` if exceeded. Default: `8388608` (8 MB).
 * @param input.maxScriptBytes - Maximum allowed size in bytes for any single `<script>` tag. Larger scripts are skipped and reported in `issues`. Default: `2097152` (2 MB).
 * @param input.maxDecodeNodes - Safety threshold for total AST/JSON nodes traversed during static hydration decoding. Default: `50000`.
 * @param input.maxDecodeDepth - Maximum recursion and nesting depth allowed during static hydration and JSON AST traversal. Default: `128`.
 * @param input.includeRawHydration - When true, attaches bounded raw hydration snapshots in `output.rawHydration`. Default: `false`.
 * @param input.includeArticleProvenance - Whether to collect provenance for catalog articles (`articles[i].*`). Setting to false slashes output size on listing pages. Default: `true`.
 * @param input.articleProvenanceMode - Granularity mode for article provenance records: `"property"` (individual fields) or `"item"` (consolidated per article). Default: `"property"`.
 * @param input.provenanceScope - Scope filter for provenance: `"all"` (all fields), `"identity"` (author/editorial/meta only), or `"none"` (disabled). Default: `"all"`.
 * @param input.dedupeAuthorProvenance - When true, suppresses redundant `authors[0].*` provenance records when there is a single author. Default: `false`.
 * @returns Fully validated {@link ParserOutput} including author, metadata, articles, and review queues.
 * @throws {TypeError} If `html` or `pageUrl` is not a string, or if `pageUrl` contains credentials or is not HTTP(S).
 * @throws {RangeError} If HTML size or extraction limits exceed safe thresholds.
 *
 * @example
 * ```ts
 * import { parseHtml } from "@sfsajid91/omniscrape";
 *
 * const result = parseHtml({
 *   html: "<html>...</html>",
 *   pageUrl: "https://example.com/article",
 *   provenanceScope: "identity",
 * });
 * console.log(result.author.name, result.metadata.title);
 * ```
 */
export function parseHtml(input: ParseHtmlInput): ParserOutput;

/**
 * Parses an HTML document and extracts structured metadata, author identities,
 * co-author attributions, article catalogs, and field-level provenance using positional arguments.
 *
 * @param html - Raw HTML markup string to parse (document or fragment).
 * @param pageUrl - Final canonical HTTP(S) URL of the document (without credentials). Used for resolving relative URLs, publisher origin namespacing, and canonical fallback.
 * @param options - Optional resource limits, provenance switches, and debug flags.
 * @param options.maxHtmlBytes - Maximum allowed size in bytes of the incoming HTML string. Throws `RangeError` if exceeded. Default: `8388608` (8 MB).
 * @param options.maxScriptBytes - Maximum allowed size in bytes for any single `<script>` tag. Larger scripts are skipped and reported in `issues`. Default: `2097152` (2 MB).
 * @param options.maxDecodeNodes - Safety threshold for total AST/JSON nodes traversed during static hydration decoding. Default: `50000`.
 * @param options.maxDecodeDepth - Maximum recursion and nesting depth allowed during static hydration and JSON AST traversal. Default: `128`.
 * @param options.includeRawHydration - When true, attaches bounded raw hydration snapshots in `output.rawHydration`. Default: `false`.
 * @param options.includeArticleProvenance - Whether to collect provenance for catalog articles (`articles[i].*`). Setting to false slashes output size on listing pages. Default: `true`.
 * @param options.articleProvenanceMode - Granularity mode for article provenance records: `"property"` (individual fields) or `"item"` (consolidated per article). Default: `"property"`.
 * @param options.provenanceScope - Scope filter for provenance: `"all"` (all fields), `"identity"` (author/editorial/meta only), or `"none"` (disabled). Default: `"all"`.
 * @param options.dedupeAuthorProvenance - When true, suppresses redundant `authors[0].*` provenance records when there is a single author. Default: `false`.
 * @returns Fully validated {@link ParserOutput} including author, metadata, articles, and review queues.
 * @throws {TypeError} If `html` or `pageUrl` is not a string, or if `pageUrl` contains credentials or is not HTTP(S).
 * @throws {RangeError} If HTML size or extraction limits exceed safe thresholds.
 *
 * @example
 * ```ts
 * import { parseHtml } from "@sfsajid91/omniscrape";
 *
 * const result = parseHtml("<html>...</html>", "https://example.com/article", {
 *   provenanceScope: "identity",
 * });
 * console.log(result.author.name, result.metadata.title);
 * ```
 */
export function parseHtml(html: string, pageUrl: string, options?: ParseOptions): ParserOutput;

/**
 * Internal implementation for {@link parseHtml} supporting both positional and single-object argument forms.
 *
 * @param htmlOrInput - Full HTML markup string or a unified {@link ParseHtmlInput} configuration object.
 * @param maybePageUrl - Final canonical HTTP(S) URL when invoked with positional arguments.
 * @param maybeOptions - Optional resource limits and feature flags when invoked with positional arguments.
 * @returns Fully validated {@link ParserOutput}.
 * @internal
 */
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
