import { parseHTML } from "linkedom";
import { z } from "zod";
import type { SocialLink } from "./types";

const EmailSchema = z.string().email();

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const collapsed = value.replaceAll("\0", "").replace(/\s+/g, " ").trim();
  return collapsed || undefined;
}

/**
 * Person names come from bylines and metadata that often carry a leading
 * "By"/"Written by" label. Keep the display name only; never invent one.
 */
export function personName(value: unknown): string | undefined {
  const cleaned = text(stripHtml(value))
    ?.replace(/^(?:written\s+by|by)(?:\s*:\s*|\s+)/i, "")
    .trim();
  return cleaned && cleaned.length >= 2 && cleaned.length <= 120 ? cleaned : undefined;
}
export function isAuthorProfileUrl(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.replace(/\/page\/\d+\/?$/i, "/");
    const parts = pathname.split("/").filter(Boolean);
    const last = parts.at(-1)?.toLowerCase();
    const parent = parts.at(-2)?.toLowerCase();
    if (parts.length === 1 && parts[0]?.startsWith("@")) return true;
    if (parent === "profile")
      return parts.length === 2 && !!last && !/^(?:edit|settings|login|signup|search)$/i.test(last);
    if (parts[0]?.toLowerCase() === "people" && parts.length === 3 && /^\d+$/.test(parts[1]!) && last) {
      return !/^(?:edit|settings|login|signup|search)$/i.test(last);
    }
    return (
      parts.length > 1 &&
      /^(?:author|authors|contributor|contributors|staff|people|writer|writers|team|reporters?|by)$/i.test(parent ?? "")
    );
  } catch {
    return false;
  }
}

export function httpUrl(value: unknown, baseUrl: string): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (/^https?:/i.test(raw) && !/^https?:\/\/[^/?#]+(?:[/?#]|$)/i.test(raw)) return undefined;
  try {
    const url = new URL(raw, baseUrl);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

const MONTH_NAME_PATTERN =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

function looksLikeDateString(raw: string): boolean {
  if (/^\d{4}-\d{1,2}(?:-\d{1,2})?(?:$|[T\s])/.test(raw)) return true;
  if (/^\d{1,4}[/.]\d{1,2}[/.]\d{2,4}(?:$|[T\s,])/.test(raw)) return true;
  if (MONTH_NAME_PATTERN.test(raw) && /\b\d{4}\b/.test(raw)) return true;
  return false;
}

export function dateString(value: unknown): string | undefined {
  let date: Date | undefined;
  if (typeof value === "number") {
    date = numericDate(value);
  } else if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return undefined;
    if (/^\d{8}$/.test(raw)) date = compactDate(raw);
    else if (/^\d{9,13}$/.test(raw)) date = numericDate(Number(raw));
    else if (looksLikeDateString(raw)) {
      const calendar = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T|\s)/.exec(raw);
      if (calendar && !compactDate(`${calendar[1]}${calendar[2]!.padStart(2, "0")}${calendar[3]!.padStart(2, "0")}`)) {
        return undefined;
      }
      date = new Date(raw);
    }
  }
  if (!date || !Number.isFinite(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  return year >= 1900 && year <= 2200 ? date.toISOString() : undefined;
}

function compactDate(raw: string): Date | undefined {
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : undefined;
}

function numericDate(value: number): Date | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (value === 0) return new Date(0);
  if (Number.isInteger(value) && value >= 19000101 && value <= 29991231) return compactDate(String(value));
  if (value < 1e8) return undefined;
  // Unix seconds (9-12 digits) vs milliseconds (13+ digits).
  const milliseconds = value >= 1e12 ? value : value * 1000;
  return new Date(milliseconds);
}

export function imageUrl(value: unknown, baseUrl: string): string | undefined {
  const pending: unknown[] = [value];
  for (let index = 0; index < pending.length && index < 32; index++) {
    const current = pending[index];
    if (Array.isArray(current)) {
      for (let i = 0; i < current.length && i < 10; i++) pending.push(current[i]);
      continue;
    }
    const result = httpUrl(
      isRecord(current) ? (current.url ?? current.contentUrl ?? current["@id"]) : current,
      baseUrl,
    );
    if (result) return result;
  }
  return undefined;
}

const NON_PERSONAL_EMAIL_LOCAL =
  /^(?:pitches|feedback|corrections|press|contact|info|support|advertising|subscriptions|privacy|help|news|newsroom|desk|editorial|editors|letters|webmaster|admin|hello|sales|marketing|careers|jobs|legal|dmca|copyright|noreply|no-reply|team|media|pr|office|general|enquiries|inquiries|subscribe|membership)@/i;
const EMAIL_CANDIDATE_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function emailAddress(value: unknown): string | undefined {
  const valueText = text(value);
  if (!valueText) return undefined;
  const raw = /^mailto:/i.test(valueText) ? (valueText.replace(/^mailto:/i, "").split("?")[0] ?? "") : valueText;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw.replace(/%40/gi, "@");
  }
  for (const match of decoded.matchAll(EMAIL_CANDIDATE_PATTERN)) {
    const email = match[0].trim().toLowerCase();
    if (!EmailSchema.safeParse(email).success) continue;
    if (NON_PERSONAL_EMAIL_LOCAL.test(email)) continue;
    return email;
  }
  return undefined;
}

interface SocialMatch {
  platform: SocialLink["platform"];
  isPersonal?: boolean;
  handle?: string;
  customSearch?: string;
  customPathname?: string;
}

interface SocialPlatformStrategy {
  matches(host: string): boolean;
  parse(url: URL, host: string, parts: string[], first: string): SocialMatch | undefined;
}

const MASTODON_HOSTS = new Set([
  "mastodon.social",
  "mastodon.online",
  "mastodon.world",
  "mstdn.social",
  "fosstodon.org",
  "hachyderm.io",
  "infosec.exchange",
  "journa.host",
  "newsie.social",
  "mas.to",
  "sfba.social",
  "fediscience.org",
  "techhub.social",
  "universeodon.com",
]);

const SOCIAL_STRATEGIES: readonly SocialPlatformStrategy[] = [
  {
    matches: (host) => host === "linkedin.com" || /^[a-z]{2}\.linkedin\.com$/.test(host),
    parse: (_url, _host, parts, first) => {
      if (first === "in" && parts[1]) {
        if (parts.length === 2) return { platform: "linkedin", isPersonal: true, handle: parts[1] };
        if (parts.length === 3 && /^[a-z]{2}$/i.test(parts[2]!)) {
          return { platform: "linkedin", isPersonal: true, handle: parts[1], customPathname: `/in/${parts[1]}` };
        }
        return undefined;
      }
      if (first === "company" && parts[1] && parts.length === 2) {
        return { platform: "linkedin", isPersonal: false, handle: parts[1] };
      }
      return undefined;
    },
  },
  {
    matches: (host) => host === "twitter.com" || host === "x.com",
    parse: (_url, _host, parts, first) => {
      if (
        parts.length !== 1 ||
        /^(?:intent|share|search|home|i|login|signup|settings|explore|messages|notifications|privacy|tos|about|help|rules|hashtag)$/i.test(
          first,
        )
      )
        return undefined;
      return { platform: "twitter", handle: parts[0] };
    },
  },
  {
    matches: (host) => host === "instagram.com",
    parse: (_url, _host, parts, first) => {
      if (parts.length !== 1 || /^(?:p|reel|reels|stories|explore|accounts|direct|about|share)$/i.test(first))
        return undefined;
      return { platform: "instagram", handle: parts[0] };
    },
  },
  {
    matches: (host) => host === "muckrack.com",
    parse: (_url, _host, parts, first) => {
      if (parts.length !== 1 || /^(?:media-outlet|search|rankings|daily)$/i.test(first)) return undefined;
      return { platform: "muckrack", handle: parts[0] };
    },
  },
  {
    matches: (host) => host === "threads.net" || host === "threads.com",
    parse: (_url, _host, parts, first) => {
      if (!first.startsWith("@") || parts.length !== 1) return undefined;
      return { platform: "threads", handle: parts[0].slice(1) };
    },
  },
  {
    matches: (host) => host === "bsky.app",
    parse: (_url, _host, parts, first) => {
      if (first !== "profile" || !parts[1] || parts.length !== 2) return undefined;
      return { platform: "bluesky", handle: parts[1] };
    },
  },
  {
    matches: (host) => host === "github.com",
    parse: (_url, _host, parts, first) => {
      if (
        parts.length !== 1 ||
        /^(?:login|signup|features|topics|explore|settings|about|pricing|security|enterprise|sponsors|orgs|marketplace|contact|readme|status|customer-stories)$/i.test(
          first,
        )
      )
        return undefined;
      return { platform: "github", handle: parts[0] };
    },
  },
  {
    matches: (host) => host === "youtube.com",
    parse: (_url, _host, parts, first) => {
      if (!first.startsWith("@") && !(["user", "c", "channel"].includes(first) && parts[1])) return undefined;
      return {
        platform: "youtube",
        isPersonal: first !== "channel",
        handle: first.startsWith("@") ? parts[0].slice(1) : parts[1],
      };
    },
  },
  {
    matches: (host) => host === "facebook.com",
    parse: (url, _host, parts, first) => {
      if (first === "profile.php") {
        const id = url.searchParams.get("id");
        if (!id || !/^\d+$/.test(id)) return undefined;
        return { platform: "facebook", handle: id, customSearch: `?id=${id}` };
      }
      if (
        parts.length !== 1 ||
        /^(?:sharer|sharer.php|share.php|dialog|plugins|login|watch|pages|groups|events|help|privacy|policies|about|terms|business|tr)$/i.test(
          first,
        )
      )
        return undefined;
      return { platform: "facebook", handle: parts[0] };
    },
  },
  {
    matches: (host) => host === "substack.com" || host.endsWith(".substack.com"),
    parse: (_url, host, parts, first) => {
      if (host.endsWith(".substack.com") && host !== "substack.com") {
        if (parts.length === 0 || (parts.length === 1 && first === "about")) {
          return {
            platform: "substack",
            handle: host.slice(0, -".substack.com".length),
            ...(parts.length === 1 ? { customPathname: "/" } : {}),
          };
        }
        return undefined;
      }
      if (parts.length === 1 && first.startsWith("@")) {
        return { platform: "substack", handle: parts[0].slice(1) };
      }
      return undefined;
    },
  },
  {
    matches: (host) => host === "medium.com" || host.endsWith(".medium.com"),
    parse: (_url, host, parts, first) => {
      if (host.endsWith(".medium.com") && host !== "medium.com") {
        if (parts.length === 0 || (parts.length === 1 && first === "about")) {
          return {
            platform: "medium",
            handle: host.slice(0, -".medium.com".length),
            ...(parts.length === 1 ? { customPathname: "/" } : {}),
          };
        }
        return undefined;
      }
      if (
        first.startsWith("@") &&
        (parts.length === 1 || (parts.length === 2 && parts[1]?.toLowerCase() === "about"))
      ) {
        return {
          platform: "medium",
          handle: parts[0].slice(1),
          ...(parts.length === 2 ? { customPathname: `/${parts[0]}` } : {}),
        };
      }
      return undefined;
    },
  },
  {
    matches: (host) => MASTODON_HOSTS.has(host) || host.includes("mastodon"),
    parse: (_url, _host, parts, first) => {
      if (parts.length !== 1 || !first.startsWith("@") || parts[0].length <= 1) return undefined;
      return { platform: "mastodon", handle: parts[0].slice(1) };
    },
  },
];

export function socialLink(value: unknown, baseUrl: string): SocialLink | undefined {
  const absolute = httpUrl(value, baseUrl);
  if (!absolute) return undefined;
  const url = new URL(absolute);
  const host = url.hostname.toLowerCase().replace(/^(?:www\.|mobile\.|m\.)/, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const first = parts[0]?.toLowerCase() ?? "";

  for (const strategy of SOCIAL_STRATEGIES) {
    if (!strategy.matches(host)) continue;
    const match = strategy.parse(url, host, parts, first);
    if (!match) return undefined;
    url.hash = "";
    url.search = match.customSearch ?? "";
    url.pathname = (match.customPathname ?? url.pathname).replace(/\/+$/, "");
    return {
      platform: match.platform,
      url: url.href,
      isPersonal: match.isPersonal ?? true,
      ...(match.handle ? { handle: match.handle } : {}),
    };
  }
  return undefined;
}

const CHARACTER_REFERENCE = /&(?:#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/i;
const NAMED_ENTITIES = new Map<string, string>([
  ["amp", "&"],
  ["AMP", "&"],
  ["lt", "<"],
  ["LT", "<"],
  ["gt", ">"],
  ["GT", ">"],
  ["quot", '"'],
  ["QUOT", '"'],
  ["apos", "'"],
  ["nbsp", "\u00a0"],
  ["ndash", "\u2013"],
  ["mdash", "\u2014"],
  ["lsquo", "\u2018"],
  ["rsquo", "\u2019"],
  ["ldquo", "\u201c"],
  ["rdquo", "\u201d"],
  ["hellip", "\u2026"],
  ["copy", "\u00a9"],
  ["COPY", "\u00a9"],
  ["reg", "\u00ae"],
  ["REG", "\u00ae"],
  ["trade", "\u2122"],
  ["TRADE", "\u2122"],
  ["bull", "\u2022"],
  ["middot", "\u00b7"],
  ["deg", "\u00b0"],
  ["plusmn", "\u00b1"],
  ["times", "\u00d7"],
  ["divide", "\u00f7"],
  ["euro", "\u20ac"],
  ["pound", "\u00a3"],
  ["yen", "\u00a5"],
  ["cent", "\u00a2"],
  ["sect", "\u00a7"],
  ["para", "\u00b6"],
  ["laquo", "\u00ab"],
  ["raquo", "\u00bb"],
  ["lsaquo", "\u2039"],
  ["rsaquo", "\u203a"],
  ["sbquo", "\u201a"],
  ["bdquo", "\u201e"],
  ["dagger", "\u2020"],
  ["Dagger", "\u2021"],
  ["permil", "\u2030"],
  ["prime", "\u2032"],
  ["Prime", "\u2033"],
  ["ensp", "\u2002"],
  ["emsp", "\u2003"],
  ["thinsp", "\u2009"],
  ["zwnj", "\u200c"],
  ["zwj", "\u200d"],
  ["shy", "\u00ad"],
  ["aacute", "\u00e1"],
  ["Aacute", "\u00c1"],
  ["agrave", "\u00e0"],
  ["Agrave", "\u00c0"],
  ["acirc", "\u00e2"],
  ["Acirc", "\u00c2"],
  ["atilde", "\u00e3"],
  ["Atilde", "\u00c3"],
  ["auml", "\u00e4"],
  ["Auml", "\u00c4"],
  ["aring", "\u00e5"],
  ["Aring", "\u00c5"],
  ["aelig", "\u00e6"],
  ["AElig", "\u00c6"],
  ["ccedil", "\u00e7"],
  ["Ccedil", "\u00c7"],
  ["eacute", "\u00e9"],
  ["Eacute", "\u00c9"],
  ["egrave", "\u00e8"],
  ["Egrave", "\u00c8"],
  ["ecirc", "\u00ea"],
  ["Ecirc", "\u00ca"],
  ["euml", "\u00eb"],
  ["Euml", "\u00cb"],
  ["iacute", "\u00ed"],
  ["Iacute", "\u00cd"],
  ["igrave", "\u00ec"],
  ["Igrave", "\u00cc"],
  ["icirc", "\u00ee"],
  ["Icirc", "\u00ce"],
  ["iuml", "\u00ef"],
  ["Iuml", "\u00cf"],
  ["ntilde", "\u00f1"],
  ["Ntilde", "\u00d1"],
  ["oacute", "\u00f3"],
  ["Oacute", "\u00d3"],
  ["ograve", "\u00f2"],
  ["Ograve", "\u00d2"],
  ["ocirc", "\u00f4"],
  ["Ocirc", "\u00d4"],
  ["otilde", "\u00f5"],
  ["Otilde", "\u00d5"],
  ["ouml", "\u00f6"],
  ["Ouml", "\u00d6"],
  ["oslash", "\u00f8"],
  ["Oslash", "\u00d8"],
  ["uacute", "\u00fa"],
  ["Uacute", "\u00da"],
  ["ugrave", "\u00f9"],
  ["Ugrave", "\u00d9"],
  ["ucirc", "\u00fb"],
  ["Ucirc", "\u00db"],
  ["uuml", "\u00fc"],
  ["Uuml", "\u00dc"],
  ["yacute", "\u00fd"],
  ["Yacute", "\u00dd"],
  ["yuml", "\u00ff"],
  ["Yuml", "\u0178"],
  ["szlig", "\u00df"],
]);

export function decodeEntities(value: string): string {
  if (!CHARACTER_REFERENCE.test(value)) return value;
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi, (match, entity) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const cp = parseInt(entity.slice(2), 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    }
    if (entity.startsWith("#")) {
      const cp = parseInt(entity.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    }
    const mapped = NAMED_ENTITIES.get(entity);
    if (mapped !== undefined) return mapped;
    const escaped = match.replace(/</g, "&lt;");
    const { document } = parseHTML(`<span>${escaped}</span>`);
    return document.querySelector("span")?.textContent ?? match;
  });
}

const SCRIPT_STYLE_BLOCK_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_TAG_OR_COMMENT_PATTERN = /<\/?[a-zA-Z][^>]*>|<!--[\s\S]*?-->/g;

export function stripHtml(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const withoutRawBlocks = value.replace(SCRIPT_STYLE_BLOCK_PATTERN, " ");
  const decoded = decodeEntities(withoutRawBlocks);
  const withoutDecodedBlocks = decoded.replace(SCRIPT_STYLE_BLOCK_PATTERN, " ");
  return text(withoutDecodedBlocks.replace(HTML_TAG_OR_COMMENT_PATTERN, " "));
}
