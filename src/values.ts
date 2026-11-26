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
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "ref_src",
  "ref_url",
  "smid",
  "igshid",
  "twclid",
  "cmpid",
  "ocid",
  "ncid",
  "guccounter",
  "guce_referrer",
  "guce_referrer_sig",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

export function canonicalSearch(searchParams: URLSearchParams): string {
  const kept: Array<[string, string]> = [];
  for (const [key, value] of searchParams.entries()) {
    if (!isTrackingParam(key)) kept.push([key, value]);
  }
  if (!kept.length) return "";
  kept.sort(([aKey], [bKey]) => (aKey < bKey ? -1 : aKey > bKey ? 1 : 0));
  const canonical = new URLSearchParams();
  for (const [key, value] of kept) canonical.append(key, value);
  return `?${canonical.toString()}`;
}

export function comparableHttpUrl(value: string, options?: { preserveFragment?: boolean }): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const port =
      url.port &&
      !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))
        ? `:${url.port}`
        : "";
    const path = (url.pathname.replace(/\/+$/, "") || "/").replace(/%[0-9a-f]{2}/gi, (triplet) =>
      triplet.toUpperCase(),
    );
    const search = url.search ? canonicalSearch(url.searchParams) : "";
    const fragment = options?.preserveFragment && url.hash.length > 1 ? url.hash : "";
    return `https://${host}${port}${path}${search}${fragment}`;
  } catch {
    return undefined;
  }
}

export function foldLatinDiacritics(value: string): string {
  return value
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFKC");
}

function authorAboutSlug(url: URL): string | undefined {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.at(-1)?.toLowerCase() !== "about") return undefined;
  for (const domain of ["substack.com", "medium.com"]) {
    if (host === domain && parts.length === 2 && parts[0]?.startsWith("@") && parts[0].length > 1) {
      return parts[0].slice(1);
    }
    if (host.endsWith(`.${domain}`) && parts.length === 1) return host.slice(0, -domain.length - 1);
  }
  return undefined;
}

export function authorSlugFromUrl(value: string): string | undefined {
  const url = new URL(value);
  return authorAboutSlug(url) ?? url.pathname.split("/").filter(Boolean).at(-1);
}

export function isAuthorProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (authorAboutSlug(url)) return true;
    const pathname = url.pathname.replace(/\/page\/\d+\/?$/i, "/");
    const parts = pathname.split("/").filter(Boolean);
    const last = parts.at(-1)?.toLowerCase();
    const parent = parts.at(-2)?.toLowerCase();
    if (parts.length === 1 && parts[0]?.startsWith("@") && parts[0].length > 1) return true;
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

const MONTH_NUMBERS = new Map<string, number>([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

const TIME_SUFFIX_RE =
  /^(?:[T\s]+|,\s*)(?:\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*(?:am|pm))?(?:\s*(?:Z|(?:GMT|UTC|[A-Z]{2,5})(?:[+-]\d{1,2}(?::?\d{2})?)?|[+-]\d{2}:?\d{2}))?(?:\s*\([^()\r\n]{1,40}\))?)$/i;

function isValidCalendarYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function parseMatchedDate(
  raw: string,
  year: number,
  month: number,
  day: number,
  timeSuffix?: string,
): Date | undefined {
  if (!isValidCalendarYmd(year, month, day)) return undefined;
  if (!timeSuffix) return new Date(Date.UTC(year, month - 1, day));
  if (!TIME_SUFFIX_RE.test(timeSuffix)) return undefined;
  return new Date(raw);
}

function parseFormattedDateString(raw: string): Date | undefined {
  const ym = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (ym) {
    return parseMatchedDate(raw, Number(ym[1]), Number(ym[2]), 1);
  }

  const ymd = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})($|[T\s].*)$/.exec(raw);
  if (ymd) {
    return parseMatchedDate(raw, Number(ymd[1]), Number(ymd[3]), Number(ymd[4]), ymd[5] || undefined);
  }

  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})($|[T\s,].*)$/.exec(raw);
  if (mdy) {
    return parseMatchedDate(raw, Number(mdy[3]), Number(mdy[1]), Number(mdy[2]), mdy[4] || undefined);
  }

  const monthFirst = /^(?:[a-z]{3,9},?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})($|[T\s,].*)$/i.exec(
    raw,
  );
  if (monthFirst) {
    const month = MONTH_NUMBERS.get(monthFirst[1]!.toLowerCase());
    if (!month) return undefined;
    return parseMatchedDate(raw, Number(monthFirst[3]), month, Number(monthFirst[2]), monthFirst[4] || undefined);
  }

  const dayFirst = /^(?:[a-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})($|[T\s,].*)$/i.exec(
    raw,
  );
  if (dayFirst) {
    const month = MONTH_NUMBERS.get(dayFirst[2]!.toLowerCase());
    if (!month) return undefined;
    return parseMatchedDate(raw, Number(dayFirst[3]), month, Number(dayFirst[1]), dayFirst[4] || undefined);
  }

  const monthYear = /^([a-z]{3,9})\.?,?\s+(\d{4})$/i.exec(raw);
  if (monthYear) {
    const month = MONTH_NUMBERS.get(monthYear[1]!.toLowerCase());
    if (!month) return undefined;
    return parseMatchedDate(raw, Number(monthYear[2]), month, 1);
  }

  return undefined;
}

export function dateString(value: unknown): string | undefined {
  let date: Date | undefined;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number") {
    date = numericDate(value);
  } else if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return undefined;
    if (/^\d{8}$/.test(raw)) date = compactDate(raw);
    else if (/^\d{9,13}$/.test(raw)) date = numericDate(Number(raw));
    else date = parseFormattedDateString(raw);
  }
  if (!date || !Number.isFinite(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  return year >= 1900 && year <= 2200 ? date.toISOString() : undefined;
}

function compactDate(raw: string): Date | undefined {
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  return isValidCalendarYmd(year, month, day) ? new Date(Date.UTC(year, month - 1, day)) : undefined;
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
    parse: (_url, _host, parts) => {
      if (parts.length !== 1) return undefined;
      const handle = parts[0]!.replace(/^@+/, "");
      if (
        !handle ||
        /^(?:intent|share|search|home|i|login|signup|settings|explore|messages|notifications|privacy|tos|about|help|rules|hashtag)$/i.test(
          handle,
        )
      )
        return undefined;
      return {
        platform: "twitter",
        handle,
        ...(handle !== parts[0] ? { customPathname: `/${handle}` } : {}),
      };
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
      if (!first.startsWith("@") || parts.length !== 1 || parts[0]!.length <= 1) return undefined;
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
      if (parts.length === 1 && first.startsWith("@") && parts[0]!.length > 1) {
        return { platform: "youtube", isPersonal: true, handle: parts[0]!.slice(1) };
      }
      if (parts.length === 2 && ["user", "c", "channel"].includes(first) && parts[1]) {
        return { platform: "youtube", isPersonal: first !== "channel", handle: parts[1] };
      }
      return undefined;
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
      if (parts.length === 1 && first.startsWith("@") && parts[0]!.length > 1) {
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
        parts[0]!.length > 1 &&
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
const CHARACTER_REFERENCE_GLOBAL = /&(?:#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi;
const ENTITY_BATCH_SIZE = 1024;
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

function isValidScalarCodePoint(cp: number): boolean {
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff);
}

export function decodeEntities(value: string): string {
  if (!CHARACTER_REFERENCE.test(value)) return value;
  const fallbackNames: string[] = [];
  const seenFallbacks = new Set<string>();
  CHARACTER_REFERENCE_GLOBAL.lastIndex = 0;
  for (let match = CHARACTER_REFERENCE_GLOBAL.exec(value); match; match = CHARACTER_REFERENCE_GLOBAL.exec(value)) {
    const entity = match[0].slice(1, -1);
    if (entity.startsWith("#")) continue;
    if (NAMED_ENTITIES.has(entity) || entity.length > 32 || seenFallbacks.has(entity)) continue;
    seenFallbacks.add(entity);
    fallbackNames.push(entity);
  }
  const decodedFallbacks = new Map<string, string>();
  for (let offset = 0; offset < fallbackNames.length; offset += ENTITY_BATCH_SIZE) {
    const batch = fallbackNames.slice(offset, offset + ENTITY_BATCH_SIZE);
    const attrs = batch.map((name, index) => `d${index}="&${name};"`).join(" ");
    const { document } = parseHTML(`<span ${attrs}></span>`);
    const span = document.querySelector("span");
    if (!span) continue;
    batch.forEach((name, index) => {
      const resolved = span.getAttribute(`d${index}`);
      if (resolved !== null && resolved !== `&${name};`) {
        decodedFallbacks.set(name, resolved);
      }
    });
  }
  return value.replace(CHARACTER_REFERENCE_GLOBAL, (match, _offset) => {
    const entity = match.slice(1, -1);
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const cp = parseInt(entity.slice(2), 16);
      return isValidScalarCodePoint(cp) ? String.fromCodePoint(cp) : match;
    }
    if (entity.startsWith("#")) {
      const cp = parseInt(entity.slice(1), 10);
      return isValidScalarCodePoint(cp) ? String.fromCodePoint(cp) : match;
    }
    const mapped = NAMED_ENTITIES.get(entity) ?? decodedFallbacks.get(entity);
    return mapped !== undefined ? mapped : match;
  });
}

function isAsciiAlpha(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAsciiTagNameChar(code: number): boolean {
  return isAsciiAlpha(code) || (code >= 48 && code <= 57) || code === 58 || code === 45;
}

function isAsciiWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
}

function matchesAsciiLower(input: string, pos: number, lowerTarget: string): boolean {
  if (pos + lowerTarget.length > input.length) return false;
  for (let i = 0; i < lowerTarget.length; i++) {
    const code = input.charCodeAt(pos + i);
    const lowered = code >= 65 && code <= 90 ? code + 32 : code;
    if (lowered !== lowerTarget.charCodeAt(i)) return false;
  }
  return true;
}

function findAsciiRawCloseTagEnd(input: string, start: number, tagLower: string): number {
  const len = input.length;
  let pos = start;
  while (pos < len) {
    const closeIdx = input.indexOf("</", pos);
    if (closeIdx === -1) return len;
    const afterName = closeIdx + 2 + tagLower.length;
    if (afterName < len && matchesAsciiLower(input, closeIdx + 2, tagLower)) {
      const delim = input.charCodeAt(afterName);
      if (isAsciiWhitespace(delim) || delim === 47 || delim === 62) {
        const gt = input.indexOf(">", afterName);
        return gt === -1 ? len : gt + 1;
      }
    }
    pos = closeIdx + 2;
  }
  return len;
}

function scanAndStripHtml(input: string, stripRegularTags: boolean): string {
  const len = input.length;
  const parts: string[] = [];
  let lastFlushed = 0;
  let lastGt: number | undefined;
  let noMoreGt = false;
  let quoteFailures = 0;
  let failedMask: Uint8Array | undefined;
  let i = 0;

  const findTagEnd = (nameEnd: number): { tagEnd: number; selfClosing: boolean } => {
    const firstGt = input.indexOf(">", nameEnd);
    if (firstGt === -1) {
      noMoreGt = true;
      return { tagEnd: -1, selfClosing: false };
    }
    if (lastGt === undefined) {
      lastGt = input.lastIndexOf(">");
    }
    let pos = nameEnd;
    let quote = 0;
    let afterEq = false;
    let inUnquotedValue = false;
    const visitedPos: number[] = [];
    const visitedState: number[] = [];
    while (pos <= lastGt) {
      const stateBit = quote === 34 ? 2 : quote === 39 ? 4 : inUnquotedValue ? 8 : 1;
      if (failedMask && (failedMask[pos]! & stateBit) !== 0) {
        return { tagEnd: firstGt, selfClosing: false };
      }
      if (quoteFailures >= 1) {
        visitedPos.push(pos);
        visitedState.push(stateBit);
      }
      const code = input.charCodeAt(pos);
      if (quote === 0) {
        if (code === 62) {
          const selfClosing = !inUnquotedValue && pos > nameEnd && input.charCodeAt(pos - 1) === 47;
          return { tagEnd: pos, selfClosing };
        }
        if (isAsciiWhitespace(code)) {
          inUnquotedValue = false;
        } else if (inUnquotedValue) {
          // Stay inside unquoted attribute value until whitespace or '>'.
        } else if (code === 61) {
          afterEq = true;
        } else if (code === 34 || code === 39) {
          quote = code;
          afterEq = false;
        } else if (afterEq) {
          inUnquotedValue = true;
          afterEq = false;
        }
      } else if (code === quote) {
        quote = 0;
      }
      pos++;
    }
    quoteFailures++;
    if (quoteFailures >= 2) {
      failedMask ??= new Uint8Array(len);
      for (let k = 0; k < visitedPos.length; k++) {
        failedMask[visitedPos[k]!]! |= visitedState[k]!;
      }
    }
    return { tagEnd: firstGt, selfClosing: false };
  };

  while (i < len) {
    const lt = input.indexOf("<", i);
    if (lt === -1) break;
    if (lt + 3 < len && input[lt + 1] === "!" && input[lt + 2] === "-" && input[lt + 3] === "-") {
      const endComment = input.indexOf("-->", lt + 4);
      parts.push(input.slice(lastFlushed, lt), " ");
      i = endComment === -1 ? len : endComment + 3;
      lastFlushed = i;
      continue;
    }
    const isClosing = lt + 1 < len && input.charCodeAt(lt + 1) === 47;
    const nameStart = isClosing ? lt + 2 : lt + 1;
    if (nameStart >= len || !isAsciiAlpha(input.charCodeAt(nameStart))) {
      i = lt + 1;
      continue;
    }
    let nameEnd = nameStart + 1;
    while (nameEnd < len && isAsciiTagNameChar(input.charCodeAt(nameEnd))) nameEnd++;
    if (nameEnd >= len) {
      i = nameEnd;
      continue;
    }
    const nameLen = nameEnd - nameStart;
    const isScript = !isClosing && nameLen === 6 && matchesAsciiLower(input, nameStart, "script");
    const isStyle = !isClosing && nameLen === 5 && matchesAsciiLower(input, nameStart, "style");

    const delim = input.charCodeAt(nameEnd);
    if (!isAsciiWhitespace(delim) && delim !== 47 && delim !== 62) {
      i = nameEnd;
      continue;
    }
    if (noMoreGt) {
      if (isScript || isStyle) {
        parts.push(input.slice(lastFlushed, lt), " ");
        i = len;
        lastFlushed = len;
      } else {
        i = nameEnd;
      }
      continue;
    }
    const { tagEnd, selfClosing } = findTagEnd(nameEnd);
    if (tagEnd === -1) {
      if (isScript || isStyle) {
        parts.push(input.slice(lastFlushed, lt), " ");
        i = len;
        lastFlushed = len;
      } else {
        i = nameEnd;
      }
      continue;
    }
    if (isScript || isStyle) {
      const blockEnd = selfClosing
        ? tagEnd + 1
        : findAsciiRawCloseTagEnd(input, tagEnd + 1, isScript ? "script" : "style");
      parts.push(input.slice(lastFlushed, lt), " ");
      i = blockEnd;
      lastFlushed = blockEnd;
      continue;
    }
    if (stripRegularTags) {
      parts.push(input.slice(lastFlushed, lt), " ");
      i = tagEnd + 1;
      lastFlushed = i;
    } else {
      i = tagEnd + 1;
    }
  }
  if (lastFlushed === 0) return input;
  if (lastFlushed < len) parts.push(input.slice(lastFlushed));
  return parts.join("");
}

export function stripHtml(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.includes("<") && !value.includes("&")) return text(value);
  const withoutRawBlocks = scanAndStripHtml(value, false);
  const decoded = decodeEntities(withoutRawBlocks);
  return text(scanAndStripHtml(decoded, true));
}
