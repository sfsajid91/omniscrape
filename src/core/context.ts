import { httpUrl } from "../values";

export type ParserDocument = Document;
export type ParserElement = Element;

export interface ExtractionLimits {
  maxHtmlBytes: number;
  maxScriptBytes: number;
  maxDecodeNodes: number;
  maxDecodeDepth: number;
}

export const DEFAULT_LIMITS: ExtractionLimits = {
  maxHtmlBytes: 8 * 1024 * 1024,
  maxScriptBytes: 2 * 1024 * 1024,
  maxDecodeNodes: 50_000,
  maxDecodeDepth: 128,
};

export interface ScriptData {
  id: string;
  type: string;
  text: string;
  path: string;
}

export interface PageContext {
  document: ParserDocument;
  pageUrl: string;
  baseUrl: string;
  html: string;
  limits: ExtractionLimits;
  includeRawHydration: boolean;
  scripts: ScriptData[];
  scriptsById: Map<string, ScriptData>;
  meta: Map<string, { value: string; path: string }>;
  authorMeta: Array<{ value: string; path: string; separator?: string }>;
  links: Array<{ rel: string; href: string; path: string }>;
  issues: Array<{ sourcePath: string; message: string }>;
}

export function createPageContext(document: ParserDocument, html: string, pageUrl: string, limits: ExtractionLimits): PageContext {
  const context: PageContext = {
    document, html, pageUrl, baseUrl: pageUrl, limits, includeRawHydration: false,
    scripts: [], scriptsById: new Map(), meta: new Map(), authorMeta: [], links: [], issues: [],
  };
  let scriptIndex = 0;
  let metaIndex = 0;
  let linkIndex = 0;
  let hasBase = false;
  for (const element of document.querySelectorAll("script, meta, link, base")) {
    const tag = element.localName;
    if (tag === "script") {
      const path = `script[${scriptIndex++}]`;
      const value = element.textContent ?? "";
      if (Buffer.byteLength(value) > limits.maxScriptBytes) {
        context.issues.push({ sourcePath: path, message: "Script exceeds maxScriptBytes" });
        continue;
      }
      const script: ScriptData = { id: element.id, type: (element.getAttribute("type") ?? "").toLowerCase().trim(), text: value, path };
      context.scripts.push(script);
      if (script.id && !context.scriptsById.has(script.id)) context.scriptsById.set(script.id, script);
    } else if (tag === "meta") {
      const path = `meta[${metaIndex++}]@content`;
      const key = (element.getAttribute("name") || element.getAttribute("property"))?.trim().toLowerCase();
      const value = element.getAttribute("content")?.trim();
      if (key && value) {
        if (!context.meta.has(key)) context.meta.set(key, { value, path });
        if (["author", "article:author", "parsely-author", "cxenseparse:author"].includes(key)) {
          const separator = element.getAttribute("data-separator") ?? undefined;
          context.authorMeta.push({ value, path, ...(separator ? { separator } : {}) });
        }
      }
    } else if (tag === "link") {
      context.links.push({ rel: (element.getAttribute("rel") ?? "").toLowerCase(), href: element.getAttribute("href") ?? "", path: `link[${linkIndex++}]@href` });
    } else if (!hasBase) {
      hasBase = true;
      context.baseUrl = httpUrl(element.getAttribute("href"), pageUrl) ?? pageUrl;
    }
  }
  return context;
}


export function elementPath(element: ParserElement): string {
  const parts: string[] = [];
  let current: ParserElement | null = element;
  while (current) {
    let index = 1;
    for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.localName === current.localName) index++;
    }
    parts.push(`${current.localName}:nth-of-type(${index})`);
    current = current.parentElement;
  }
  return parts.reverse().join(" > ");
}
