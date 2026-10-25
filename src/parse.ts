import { parseHTML } from "linkedom";
import { createPageContext, DEFAULT_LIMITS, type ExtractionLimits } from "./core/context";
import { extractDomAndMeta } from "./extractors/dom-meta";
import { extractHydrationData } from "./extractors/hydration";
import { extractJsonLd } from "./extractors/json-ld";
import { resolveParserOutput } from "./core/resolver";
import { detectTechStack } from "./tech-detector";
import type { ParserOutput } from "./types";
import { httpUrl } from "./values";

export interface ParseOptions extends Partial<ExtractionLimits> {
  includeRawHydration?: boolean;
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

export function parseHtml(html: string, pageUrl: string, options?: ParseOptions): ParserOutput {
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
  return resolveParserOutput({ context, techStack, hydration, jsonLd, domMeta, includeRawHydration: options?.includeRawHydration ?? false });
}
