import type { PageContext, ParserElement } from "../core/context";
import { elementPath } from "../core/context";
import {
  type ArticleCandidate,
  type AuthorCandidate,
  type ExtractedData,
  emptyExtraction,
  type FieldCandidate,
  type ValueEvidence,
} from "../core/evidence";
import type { PageMetadata } from "../types";
import {
  dateString,
  emailAddress,
  httpUrl,
  imageUrl,
  isAuthorProfileUrl,
  personName,
  socialLink,
  stripHtml,
  text,
} from "../values";

export interface DomMetaResult extends ExtractedData {
  metadata: PageMetadata;
}

const MAX_ARTICLES = 20;
const MIN_ARTICLE_TITLE = 8;
const MAX_ARTICLE_TITLE = 300;
const MAX_BIO = 2000;
const MAX_ROLE = 200;

const HEADLINE_CLASS_RE = /(?:^|\s)(?:card-title|story-title|post-title|article-title|headline|entry-title)(?:\s|$)/;
const ANCHOR_TITLE_CLASS_RE = /(?:^|\s)(?:c-entry-box--compact__title|tout-title-link)(?:\s|$)/;
const FEED_ITEM_CLASS_RE = /(?:^|\s)(?:feed-item|river-item)(?:\s|$)/;
const PROFILE_WRAPPER_CLASS_RE =
  /(?:^|\s)(?:author-wrapper|author-header|author-profile|author-card|author-detail)(?:\s|$)/;
const NON_ARTICLE_CLASS_RE =
  /(?:^|\s)(?:share|sharing|social-share|newsletter|legal|pagination|also-read|story-element-text-also-read|author-description|author-bio|contributor-bio|bio|header-description)(?:\s|$)/;
const LEGAL_PATH_RE = /\/(?:privacy(?:-policy)?|terms(?:-of-service)?|cookies?|cookie-policy)\/?$/i;

const GENERATIONAL_SUFFIX = /^(?:Jr\.?|Sr\.?|II|III|IV)$/i;
const CREDENTIALS = new Set([
  "phd",
  "md",
  "do",
  "jd",
  "mba",
  "rn",
  "esq",
  "mph",
  "edd",
  "dds",
  "cpa",
  "cfa",
  "frsc",
  "obe",
  "mbe",
  "cbe",
]);
const WIRE_AGENCIES = new Set([
  "reuters",
  "associated press",
  "the associated press",
  "ap",
  "afp",
  "bloomberg",
  "bloomberg news",
  "upi",
  "press association",
  "pa media",
  "staff",
  "editorial board",
]);
const EDITORIAL_JOB_TITLES = new Set([
  "editor",
  "senior editor",
  "assistant editor",
  "senior assistant editor",
  "managing editor",
  "associate editor",
  "executive editor",
  "editor-in-chief",
  "reporter",
  "senior reporter",
  "chief reporter",
  "investigative reporter",
  "bureau chief",
  "correspondent",
  "senior correspondent",
  "staff writer",
  "columnist",
  "contributor",
  "senior contributor",
  "freelance writer",
]);
const EDITORIAL_ROLES = new Set([
  "correspondent",
  "editor",
  "editor-in-chief",
  "editor-at-large",
  "co-editor",
  "sub-editor",
  "reporter",
  "writer",
  "columnist",
  "analyst",
  "producer",
  "fellow",
  "director",
  "journalist",
  "photojournalist",
  "critic",
  "anchor",
  "host",
  "photographer",
  "illustrator",
  "contributor",
]);
const ROLE_MODIFIER_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "at",
  "for",
  "in",
  "on",
  "to",
  "and",
  "&",
  "senior",
  "junior",
  "chief",
  "assistant",
  "associate",
  "managing",
  "executive",
  "deputy",
  "lead",
  "principal",
  "head",
  "contributing",
  "staff",
  "freelance",
  "guest",
  "visiting",
  "former",
  "special",
  "general",
  "assignment",
  "national",
  "international",
  "foreign",
  "global",
  "local",
  "regional",
  "metro",
  "city",
  "state",
  "investigative",
  "enterprise",
  "breaking",
  "weekend",
  "night",
  "morning",
  "daily",
  "editorial",
  "news",
  "newsroom",
  "opinion",
  "op-ed",
  "features",
  "feature",
  "copy",
  "desk",
  "bureau",
  "washington",
  "white",
  "house",
  "capitol",
  "hill",
  "congressional",
  "pentagon",
  "diplomatic",
  "political",
  "politics",
  "policy",
  "public",
  "business",
  "finance",
  "financial",
  "economic",
  "economics",
  "economy",
  "markets",
  "market",
  "banking",
  "wall",
  "street",
  "tech",
  "technology",
  "science",
  "health",
  "medical",
  "climate",
  "environment",
  "environmental",
  "energy",
  "sports",
  "sport",
  "culture",
  "arts",
  "art",
  "entertainment",
  "lifestyle",
  "food",
  "travel",
  "fashion",
  "style",
  "design",
  "architecture",
  "education",
  "legal",
  "law",
  "justice",
  "crime",
  "defense",
  "military",
  "security",
  "cybersecurity",
  "intelligence",
  "world",
  "europe",
  "european",
  "asia",
  "middle",
  "east",
  "africa",
  "americas",
  "uk",
  "us",
  "u.s.",
  "consumer",
  "personal",
  "real",
  "estate",
  "auto",
  "automotive",
  "aviation",
  "transportation",
  "transit",
  "labor",
  "housing",
  "immigration",
  "retail",
  "media",
  "television",
  "tv",
  "film",
  "music",
  "book",
  "books",
  "theater",
  "theatre",
  "restaurant",
  "wine",
  "weather",
  "space",
  "ai",
  "crypto",
  "data",
  "visual",
  "visuals",
  "multimedia",
  "interactive",
  "digital",
  "online",
  "print",
  "broadcast",
  "video",
  "audio",
  "photo",
  "photography",
  "radio",
  "podcast",
  "newsletter",
  "research",
  "creative",
  "line",
  "social",
  "web",
  "site",
  "large",
]);

function isCredential(value: string): boolean {
  return CREDENTIALS.has(value.trim().replace(/\./g, "").toLowerCase());
}

function isWireAgency(value: string): boolean {
  return WIRE_AGENCIES.has(value.trim().toLowerCase());
}

function isJobTitle(value: string, allowGenericStaff = false): boolean {
  const lower = value.trim().toLowerCase();
  if (!lower) return false;
  if (lower === "staff reporter") return allowGenericStaff;
  if (EDITORIAL_JOB_TITLES.has(lower)) return true;
  if (/^(?:special\s+to|for)\s+/i.test(lower)) return true;
  if (/\bbureau\s+chief\b/i.test(lower) || /\beditor[\s-]+(?:in[\s-]+chief|at[\s-]+large)\b/i.test(lower)) {
    return true;
  }
  if (
    /\b(?:correspondent|editor|reporter|writer|columnist|analyst|producer|fellow|director|journalist|critic|anchor|host|photographer|illustrator)\s+(?:at|for|of|in|on)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  const words = lower.split(/\s+/);
  const last = words.at(-1) ?? "";
  if (!EDITORIAL_ROLES.has(last)) return false;
  if (words.length === 1) return true;
  return words.slice(0, -1).every((word) => ROLE_MODIFIER_WORDS.has(word));
}

function splitBylineNames(raw: string, separator?: string): string[] {
  const stripped =
    text(raw)
      ?.replace(/^(?:written\s+by|by)\s*:?\s+/i, "")
      .trim() ?? "";
  if (!stripped) return [];
  const merged: string[] = [];
  if (separator) {
    for (const part of stripped.split(separator)) {
      const cleaned = text(part);
      if (cleaned) merged.push(cleaned);
    }
  } else {
    const tokens = stripped.split(/(\s*(?:,\s*(?:and|&)\s+|,|\||\s+(?:and|&)\s+)\s*)/i);
    for (let i = 0; i < tokens.length; i += 2) {
      const segment = text(tokens[i]);
      const prevDelimiter = i > 0 ? (tokens[i - 1] ?? "") : "";
      if (!segment) continue;
      if (prevDelimiter.trim() === "," && merged.length > 0 && GENERATIONAL_SUFFIX.test(segment)) {
        merged[merged.length - 1] = `${merged[merged.length - 1]}, ${segment}`;
      } else {
        merged.push(segment);
      }
    }
  }
  const isMultiPart = merged.length > 1;
  return merged.filter((part, index) => {
    if (isCredential(part) || isWireAgency(part)) return false;
    if (isJobTitle(part, isMultiPart && index > 0)) return false;
    return true;
  });
}

function isUnwantedBylineElement(element: ParserElement): boolean {
  const tag = element.localName;
  if (tag === "button" || tag === "svg" || tag === "time") return true;
  if (tag === "a" && (element.getAttribute("href") ?? "").trim().toLowerCase().startsWith("mailto:")) return true;
  if (element.hasAttribute("data-email")) return true;
  if (element.getAttribute("itemprop") === "jobTitle") return true;
  const className = element.getAttribute("class") ?? "";
  if (/(?:^|\s)(?:email|author__title-desc|role|author-role|author-title|designation)(?:\s|$)/.test(className)) {
    return true;
  }
  return false;
}

function collectCleanText(node: Node, parts: string[]): void {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    if (node.nodeValue) parts.push(node.nodeValue);
    return;
  }
  if (node.nodeType === 1 /* ELEMENT_NODE */) {
    if (isUnwantedBylineElement(node as ParserElement)) return;
    if (parts.length > 0) parts.push(" ");
    const contentStart = parts.length;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      collectCleanText(child, parts);
    }
    if (parts.length > contentStart) parts.push(" ");
  }
}

function cleanBylineText(element: ParserElement): string {
  const parts: string[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) {
    collectCleanText(child, parts);
  }
  return parts.join("").replace(/\s+([,;:])/g, "$1");
}

function hasOrganizationItemType(element: ParserElement): boolean {
  return /organization/i.test(element.getAttribute("itemtype") ?? "");
}

function isInsideOrganizationScope(element: ParserElement, stopAt: ParserElement): boolean {
  let current: ParserElement | null = element;
  while (current) {
    if (hasOrganizationItemType(current)) return true;
    if (current === stopAt) break;
    current = current.parentElement;
  }
  return false;
}

function documentTitleElement(doc: Document): ParserElement | null {
  const headTitle = doc.querySelector("head > title");
  if (headTitle) return headTitle;
  for (const title of doc.querySelectorAll("title")) {
    if (!title.closest("svg")) return title;
  }
  return null;
}

const AUTHOR_SCOPE = [
  "[role='author']",
  "[itemtype*='Person' i]",
  "[itemprop='author']",
  "[rel~='author']",
  ".byline",
  ".entry-author",
  ".c-entry-author",
  ".author-header",
  ".author-profile",
  ".author-card",
  ".article-author",
  ".author-detail",
  "header[class*='author-page']",
  "header.contentheader--archived-bio",
  "[class*='author-name']",
  "[data-testid*='author' i]",
  "[data-author]",
];
const AUTHOR_SCOPE_SELECTOR = AUTHOR_SCOPE.join(", ");

const EXPLICIT_NAME_SELECTORS = [
  "[itemprop='name']",
  "[itemprop='author'] [itemprop='name']",
  ".author-name",
  ".contributor-name",
  "[rel~='author']",
  "[class*='author-name']",
  "[data-author]",
];
const PROFILE_LINK_NAME_SELECTORS = [
  "a[href*='/author/']",
  "a[href*='/authors/']",
  "a[href*='/contributor/']",
  "a[href*='/contributors/']",
  "a[href*='/writers/']",
  "a[href*='/writer/']",
  "a[href*='/staff/']",
  "a[href*='/people/']",
  "a[href*='/profile/']",
  "a[href*='/reporters/']",
  "a[href*='/reporter/']",
  "a[href*='/by/']",
];
const NAME_SELECTORS = [...EXPLICIT_NAME_SELECTORS, ...PROFILE_LINK_NAME_SELECTORS];
const EXPLICIT_NAME_SELECTOR = EXPLICIT_NAME_SELECTORS.join(", ");
const NAME_SELECTORS_JOINED = NAME_SELECTORS.join(", ");

export function extractDomAndMeta(context: PageContext): DomMetaResult {
  const { metadata, fields } = extractPageMetadata(context);
  const result = emptyExtraction();
  result.fields.push(...fields);
  result.authors.push(...extractAuthors(context));
  result.articles.push(...extractArticles(context));
  return { ...result, metadata };
}

function extractPageMetadata(context: PageContext): { metadata: PageMetadata; fields: FieldCandidate[] } {
  const metadata: PageMetadata = {};
  const fields: FieldCandidate[] = [];
  const put = (key: keyof PageMetadata, value: string | undefined, sourcePath: string) => {
    if (!value) return;
    metadata[key] = value;
    fields.push({ field: `metadata.${key}`, value, evidence: ev("dom-meta", sourcePath, "page", "high") });
  };
  const meta = (key: keyof PageMetadata, names: string[], normalize: (value: unknown) => string | undefined = text) => {
    for (const name of names) {
      const entry = context.meta.get(name);
      const value = normalize(entry?.value);
      if (value && entry) {
        put(key, value, entry.path);
        return;
      }
    }
  };
  meta("title", ["og:title", "twitter:title"]);
  if (!metadata.title) {
    const title = documentTitleElement(context.document);
    if (title) put("title", text(title.textContent), elementPath(title));
  }
  meta("description", ["og:description", "twitter:description", "description"], stripHtml);
  const canonical = context.links.find(
    (link) => link.rel.split(/\s+/).includes("canonical") && httpUrl(link.href, context.baseUrl),
  );
  if (canonical) put("canonicalUrl", httpUrl(canonical.href, context.baseUrl), canonical.path);
  else meta("canonicalUrl", ["og:url"], (value) => httpUrl(value, context.baseUrl));
  if (!metadata.canonicalUrl) put("canonicalUrl", context.pageUrl, "pageUrl");
  meta("ogImage", ["og:image", "twitter:image", "twitter:image:src"], (value) => imageUrl(value, context.baseUrl));
  const language = text(context.document.documentElement?.getAttribute("lang"));
  if (language) put("language", language, `${elementPath(context.document.documentElement)}@lang`);
  else meta("language", ["og:locale"]);
  meta("publishedTime", ["article:published_time", "og:article:published_time", "pubdate"], dateString);
  if (!metadata.publishedTime) {
    const date = visiblePublicationDate(context);
    if (date) {
      metadata.publishedTime = date.value;
      fields.push({
        field: "metadata.publishedTime",
        value: date.value,
        evidence: ev("dom-meta", date.path, "page", "low"),
      });
    }
  }
  meta("modifiedTime", ["article:modified_time", "og:article:modified_time"], dateString);
  return { metadata, fields };
}

function visiblePublicationDate(context: PageContext): { value: string; path: string } | undefined {
  if (isAuthorProfileUrl(context.pageUrl)) return undefined;
  const main = Array.from(context.document.querySelectorAll("main")).find((item) => item.querySelector("h1"));
  const mainArticle =
    main &&
    Array.from(main.querySelectorAll("article")).find(
      (item) =>
        item.querySelector("h1") &&
        Array.from(item.querySelectorAll("p")).some((paragraph) =>
          /^([A-Za-z]+)\s+\d{1,2},\s*\d{4}\s+by\s+/i.test(text(paragraph.textContent) ?? ""),
        ),
    );
  const container = mainArticle ?? main ?? context.document.querySelector(".entry.entryPage");
  if (!container) return undefined;
  const explicit = container.querySelector("time[itemprop='datePublished'][datetime], time[pubdate][datetime]");
  const explicitDate = dateString(explicit?.getAttribute("datetime"));
  if (explicitDate && explicit) return { value: explicitDate, path: `${elementPath(explicit)}@datetime` };
  for (const footer of container.querySelectorAll(".entryFooter")) {
    if (footer.closest(".entry.entryPage") !== container) continue;
    const value = parseVisibleDate(
      footer.textContent ?? "",
      /^Posted\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)\s+(\d{4})\b/i,
    );
    if (value) return { value, path: elementPath(footer) };
  }
  const heading = container.querySelector("h1");
  if (!heading) return undefined;
  const walker = context.document.createTreeWalker(container, 1);
  let node = walker.nextNode() as ParserElement | null;
  let afterHeading = false;
  while (node) {
    if (node === heading) afterHeading = true;
    else if (afterHeading && /^h[1-6]$/.test(node.localName)) break;
    else if (afterHeading && node.localName === "p") {
      const value = parseVisibleDate(node.textContent ?? "", /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+by\s+.+/i);
      if (value && node.querySelector("a")) return { value, path: elementPath(node) };
    }
    node = walker.nextNode() as ParserElement | null;
  }
  return undefined;
}

function parseVisibleDate(raw: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text(raw) ?? "");
  if (!match) return undefined;
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const footer = pattern.source.startsWith("^Posted");
  const day = Number(footer ? match[1] : match[2]);
  const month = months.indexOf((footer ? match[2] : match[1]).toLowerCase()) + 1;
  const year = Number(match[3]);
  if (month < 1) return undefined;
  return dateString(`${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`);
}
function currentArticleUrls(context: PageContext): Set<string> {
  const canonical = context.links.find((link) => link.rel.split(/\s+/).includes("canonical"));
  return new Set(
    [context.pageUrl, ...(canonical ? [httpUrl(canonical.href, context.baseUrl) ?? ""] : [])]
      .filter(Boolean)
      .map((value) => normalizeArticleUrl(value)),
  );
}

function isListingAttributionScope(scope: ParserElement, currentUrls: ReadonlySet<string>, baseUrl: string): boolean {
  const article = scope.closest("article, [role='article']");
  if (!article) return false;
  const headingLink = article.querySelector("h1 a[href], h2 a[href], h3 a[href], h4 a[href]");
  const headingUrl = httpUrl(headingLink?.getAttribute("href"), baseUrl);
  return !!headingUrl && !currentUrls.has(normalizeArticleUrl(headingUrl));
}

interface GuardianProfile {
  scope: ParserElement;
  heading: ParserElement;
  biography: ParserElement;
  image: ParserElement;
}

function normalizedProfileWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function verifiedGuardianProfiles(context: PageContext): GuardianProfile[] {
  if (!isAuthorProfileUrl(context.pageUrl)) return [];
  const pathSlug = new URL(context.pageUrl).pathname.split("/").filter(Boolean).at(-1) ?? "";
  let expectedSlug = pathSlug;
  try {
    expectedSlug = decodeURIComponent(pathSlug);
  } catch {
    return [];
  }
  const expected = normalizedProfileWords(expectedSlug).replace(/\s/g, "");
  if (!expected) return [];
  const verified: GuardianProfile[] = [];
  const seen = new Set<ParserElement>();
  for (const heading of context.document.querySelectorAll("h1, h2")) {
    const name = text(heading.textContent);
    if (!name || normalizedProfileWords(name).replace(/\s/g, "") !== expected) continue;
    let scope: ParserElement | null = null;
    let excluded = false;
    for (let parent = heading.parentElement; parent; parent = parent.parentElement) {
      const tag = parent.localName;
      if (tag === "article" || tag === "nav" || tag === "footer" || tag === "aside") {
        excluded = true;
        break;
      }
      if (!scope && (tag === "section" || tag === "header")) scope = parent;
    }
    if (excluded || !scope || seen.has(scope)) continue;
    const image = Array.from(scope.querySelectorAll("img[alt]")).find(
      (candidate) =>
        normalizedProfileWords(
          (candidate.getAttribute("alt") ?? "").replace(/\b(?:headshot|portrait)\b/gi, " ").replace(/^\s*of\s+/i, ""),
        ) === normalizedProfileWords(name),
    );
    if (!image) continue;
    const biography = Array.from(scope.querySelectorAll("p")).find((paragraph) => {
      const words = normalizedProfileWords(text(paragraph.textContent) ?? "");
      const headingWords = normalizedProfileWords(name);
      return words.startsWith(`${headingWords} `);
    });
    if (!biography) continue;
    seen.add(scope);
    verified.push({ scope, heading, biography, image });
  }
  return verified;
}

function nprSpeakableBio(scope: ParserElement, name: string): ParserElement | undefined {
  if (!scope.matches("header.contentheader--archived-bio")) return undefined;
  const firstSpeakable = scope.ownerDocument.querySelector("[data-is-speakable]");
  if (
    !firstSpeakable ||
    normalizedProfileWords(text(firstSpeakable.textContent) ?? "") !== normalizedProfileWords(name)
  )
    return undefined;
  const next = firstSpeakable.nextElementSibling as ParserElement | null;
  if (!next?.matches("[data-is-speakable]")) return undefined;
  const bio = text(next.textContent);
  const words = normalizedProfileWords(bio ?? "");
  const headingWords = normalizedProfileWords(name);
  if (!bio || bio.length <= 20 || bio.length > MAX_BIO || !words.startsWith(`${headingWords} `)) return undefined;
  return next;
}

function extractAuthors(context: PageContext): AuthorCandidate[] {
  const doc = context.document;
  const candidates: AuthorCandidate[] = [];
  const scopes = doc.querySelectorAll(AUTHOR_SCOPE_SELECTOR);
  const currentUrls = currentArticleUrls(context);

  // Explicit author metadata is evidence for a byline, never an article title/description surrogate.
  const metaElements = context.authorMeta.length > 0 ? doc.querySelectorAll("meta") : undefined;
  for (const metaAuthor of context.authorMeta) {
    const indexMatch = /^meta\[(\d+)\]@content$/.exec(metaAuthor.path);
    const metaEl = indexMatch ? metaElements?.[Number(indexMatch[1])] : undefined;
    const metaKey = (metaEl?.getAttribute("name") || metaEl?.getAttribute("property"))?.trim().toLowerCase();
    const authorshipGroup = `meta:${metaKey || metaAuthor.path}`;
    const parts = splitBylineNames(metaAuthor.value, metaAuthor.separator);
    for (const raw of parts) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(raw) && httpUrl(raw, context.baseUrl)) continue;
      const name = personName(raw);
      if (!name) continue;
      candidates.push({
        profile: { name, socials: [] },
        primary: true,
        evidence: { name: ev("dom-meta", metaAuthor.path, "byline", "high") },
        authorshipGroups: [authorshipGroup],
      });
    }
  }
  for (const scope of scopes) {
    if (!isExcludedAttributionScope(scope) && !isListingAttributionScope(scope, currentUrls, context.baseUrl)) {
      candidates.push(...authorsFromScope(scope, context, currentUrls));
    }
  }
  candidates.push(...unmarkedLinkedBylines(doc, context, currentUrls));
  if (isAuthorProfileUrl(context.pageUrl)) {
    for (const header of doc.querySelectorAll("header.contentheader--archived-bio")) {
      if (!isExcludedAttributionScope(header) && !isListingAttributionScope(header, currentUrls, context.baseUrl)) {
        candidates.push(...authorsFromScope(header, context, currentUrls));
      }
    }
    for (const profile of verifiedGuardianProfiles(context)) {
      if (!isListingAttributionScope(profile.scope, currentUrls, context.baseUrl)) {
        candidates.push(...authorsFromScope(profile.scope, context, currentUrls, profile));
      }
    }
    const heading = doc.querySelector("h1, h2");
    const wrapper = heading?.closest(
      ".article-author, .author-detail, header[class*='author-page'], section[class*='author-page'], .author-header, .author-profile, .author-card, [itemtype*='Person' i]",
    );
    if (
      wrapper &&
      !isExcludedAttributionScope(wrapper) &&
      !isListingAttributionScope(wrapper, currentUrls, context.baseUrl)
    ) {
      candidates.push(...authorsFromScope(wrapper, context, currentUrls));
    }
  }
  return mergeSameScopeDuplicates(candidates);
}

function isValidProfileNameCandidate(element: ParserElement, context: PageContext): boolean {
  if (element.matches(EXPLICIT_NAME_SELECTOR)) return true;
  if (element.localName !== "a" || !element.hasAttribute("href")) return false;
  const absolute = httpUrl(element.getAttribute("href"), context.baseUrl);
  return !!absolute && isAuthorProfileUrl(absolute) && !socialLink(absolute, context.baseUrl);
}

function authorsFromScope(
  scope: ParserElement,
  context: PageContext,
  currentUrls: ReadonlySet<string>,
  guardian?: GuardianProfile,
): AuthorCandidate[] {
  if (isListingAttributionScope(scope, currentUrls, context.baseUrl)) return [];
  if (hasOrganizationItemType(scope)) return [];
  const profilePath = isAuthorProfileUrl(context.pageUrl);
  const bylineContainer =
    scope.closest("[role='author'], [itemprop='author'], .byline, .entry-author, .c-entry-author") ??
    (scope.matches("[rel~='author'], [data-author], [data-testid*='author' i]") ? scope : null);
  const authorshipGroup =
    !profilePath &&
    !scope.closest(
      ".related, .related-articles, .related-posts, .related-stories, .more-stories, .trending, .most-popular, .recommendations, .comments, .comment, [itemprop='comment']",
    ) &&
    bylineContainer
      ? `dom:${elementPath(bylineContainer)}`
      : undefined;
  const rawNames = Array.from(scope.querySelectorAll(NAME_SELECTORS_JOINED)).filter((element) =>
    isValidProfileNameCandidate(element, context),
  );
  const names = rawNames.filter((element) => !isInsideOrganizationScope(element, scope));
  if (rawNames.length > 0 && names.length === 0) return [];
  const separateNames = names.filter((element) => !names.some((other) => other !== element && other.contains(element)));
  if (separateNames.length > 1) return linkedAnchorCandidates(separateNames, context, currentUrls, authorshipGroup);
  const archivedBioScope = scope.matches("header.contentheader--archived-bio") && profilePath;
  if (scope.matches("header.contentheader--archived-bio") && !profilePath) return [];
  const explicitProfileScope = scope.matches(
    ".article-author, .author-detail, header[class*='author-page'], section[class*='author-page'], .author-card, .author-header, .author-profile, [itemtype*='Person' i]",
  );
  const profileHeading = scope.querySelector("h1") ?? (profilePath ? scope.querySelector("h2") : null);
  const pageProfileScope =
    profilePath &&
    (!!guardian ||
      (explicitProfileScope && !!profileHeading) ||
      (archivedBioScope && !!scope.querySelector("h2.branding__title")));
  const allowScopedHeading =
    scope.matches(".author-header, .author-profile, .author-detail, header[class*='author-page']") || pageProfileScope;
  const scopedNameMatch =
    firstMatching(
      scope,
      NAME_SELECTORS,
      (el) => isValidProfileNameCandidate(el, context) && !isInsideOrganizationScope(el, scope),
    ) ??
    (scope.matches("[itemprop='author']")
      ? (Array.from(scope.querySelectorAll("[itemprop='name']")).find((el) => !isInsideOrganizationScope(el, scope)) ??
        null)
      : null);
  const nameElement =
    guardian?.heading ??
    (archivedBioScope
      ? scope.querySelector("h2.branding__title")
      : allowScopedHeading
        ? profileHeading
        : scopedNameMatch);
  if (nameElement && isInsideOrganizationScope(nameElement, scope)) return [];
  const plainByline = scope.matches(
    ".byline, .entry-author, .c-entry-author, [rel~='author'], [role='author'], [data-testid*='author' i], [data-author]",
  );
  const label = nameElement?.querySelector(".author__title-desc");
  const nameSource =
    nameElement?.getAttribute("content") ??
    (label && text(label.textContent) === "Author"
      ? (nameElement?.textContent ?? "").replace(label.textContent ?? "", " ")
      : nameElement
        ? cleanBylineText(nameElement)
        : undefined) ??
    (plainByline
      ? cleanBylineText(scope)
      : scope.hasAttribute("data-author")
        ? scope.getAttribute("data-author")
        : undefined);
  const explicitByline =
    !!scope.closest("[role='author'], [itemprop='author'], .byline, .entry-author, .c-entry-author") ||
    scope.matches("[rel~='author'], [data-author], [data-testid*='author' i]");
  const inStoryCard = !!scope.closest(
    ".related, .related-articles, .related-posts, .related-stories, .more-stories, .trending, .most-popular, .recommendations, [role='article']",
  );
  const primary = !inStoryCard && (pageProfileScope || explicitByline);
  if (profilePath && !pageProfileScope && scope.closest("article, [role='article']")) return [];
  let name: string | undefined;
  if (!pageProfileScope && nameSource) {
    const parts = splitBylineNames(nameSource);
    const validNames = parts.map(personName).filter((n): n is string => !!n);
    if (validNames.length === 0) return [];
    if (validNames.length > 1) {
      const candidates: AuthorCandidate[] = [];
      for (const validName of validNames) {
        const p: AuthorCandidate["profile"] = { name: validName, socials: [] };
        const evName = ev(
          "dom-author",
          nameElement ? elementPath(nameElement) : elementPath(scope),
          primary ? "byline" : "profile",
          "high",
        );
        candidates.push({
          profile: p,
          primary,
          evidence: { name: evName },
          ...(authorshipGroup ? { authorshipGroups: [authorshipGroup] } : {}),
        });
      }
      return candidates;
    }
    name = validNames[0];
  } else {
    name = personName(nameSource?.replace(/^(?:written\s+by|by)\s*:?\s+/i, ""));
  }
  if (!name) return [];
  const profile: AuthorCandidate["profile"] = { name, socials: [] };
  const evidence: AuthorCandidate["evidence"] = {
    name: ev(
      "dom-author",
      nameElement ? elementPath(nameElement) : elementPath(scope),
      pageProfileScope ? "profile" : primary ? "byline" : "profile",
      "high",
    ),
  };
  const nprBio = archivedBioScope ? nprSpeakableBio(scope, name) : undefined;
  const bioEl =
    guardian?.biography ??
    nprBio ??
    first(scope, [
      "[itemprop='description']",
      ".author-bio",
      ".header-description",
      ".bio",
      ".author-description",
      ".contributor-bio",
    ]);
  const bioText = bioEl?.querySelector("p")?.textContent ?? bioEl?.textContent;
  const bio = stripHtml(bioText);
  if (bio && bio.length > 20 && bio.length <= MAX_BIO) {
    profile.bio = bio;
    evidence.bio = ev("dom-author", elementPath(bioEl!), "profile", "high");
  }
  const img =
    guardian?.image ??
    first(scope, [
      "[itemprop='image']",
      "img.author-avatar",
      "img.author-image",
      "img.bio-image-image",
      "img.author-details-avatar",
      "img.avatar",
    ]);
  const avatar = imageUrl(
    img?.getAttribute("content") ?? img?.getAttribute("src") ?? img?.getAttribute("data-src"),
    context.baseUrl,
  );
  if (avatar) {
    profile.avatarUrl = avatar;
    evidence.avatarUrl = ev("dom-author", elementPath(img!), "profile", "high");
  }
  const roleEl = first(scope, ["[itemprop='jobTitle']", ".author-title", ".author-role", ".designation"]);
  const role = text(roleEl?.textContent);
  if (role && role.length <= MAX_ROLE) {
    profile.designation = role;
    evidence.designation = ev("dom-author", elementPath(roleEl!), "profile", "medium");
  }
  const authorEmails: string[] = [];
  const socialEvidence: ValueEvidence[] = [];
  const seen = new Set<string>();
  for (const anchor of scope.querySelectorAll("a[href]")) {
    if (isExcludedAttributionScope(anchor) || isListingAttributionScope(anchor, currentUrls, context.baseUrl)) {
      continue;
    }
    const rawHref = (anchor.getAttribute("href") ?? "").trim();
    if (rawHref.toLowerCase().startsWith("mailto:")) {
      const email = emailAddress(rawHref);
      if (!email) continue;
      if (!authorEmails.includes(email)) authorEmails.push(email);
      if (!profile.email) {
        profile.email = email;
        evidence.email = ev(
          "dom-author",
          elementPath(anchor),
          pageProfileScope ? "profile" : primary ? "byline" : "profile",
          "medium",
        );
      }
      continue;
    }
    const social = socialLink(rawHref, context.baseUrl);
    if (!social || seen.has(social.url)) continue;
    seen.add(social.url);
    profile.socials!.push(social);
    socialEvidence.push(
      ev("dom-author", elementPath(anchor), pageProfileScope ? "profile" : primary ? "byline" : "profile", "high"),
    );
  }
  if (authorEmails.length) {
    profile.emails = authorEmails;
  }
  const linkedProfile = scopedProfileUrl(scope, context, currentUrls);
  const identity = linkedProfile?.url ?? (pageProfileScope ? context.pageUrl : undefined);
  if (identity) {
    profile.slug = new URL(identity).pathname.split("/").filter(Boolean).at(-1);
    evidence.slug = ev(
      "dom-author",
      linkedProfile?.sourcePath ?? "pageUrl",
      pageProfileScope ? "profile" : "byline",
      "high",
    );
  }
  return [
    {
      profile,
      ...(identity ? { identity } : {}),
      primary,
      evidence,
      ...(socialEvidence.length ? { socialEvidence } : {}),
      ...(authorshipGroup ? { authorshipGroups: [authorshipGroup] } : {}),
    },
  ];
}

/**
 * A byline can list several people ("By Alice and Bob"). Emit one name-only
 * candidate per linked person so the resolver can report the ambiguity instead
 * of returning nothing or lending one person's contacts to another.
 */
function linkedAnchorCandidates(
  elements: ParserElement[],
  context: PageContext,
  currentUrls: ReadonlySet<string>,
  authorshipGroup?: string,
): AuthorCandidate[] {
  const candidates: AuthorCandidate[] = [];
  for (const element of elements) {
    const anchor = element.localName === "a" && element.hasAttribute("href") ? element : element.closest("a[href]");
    if (!anchor || isListingAttributionScope(element, currentUrls, context.baseUrl)) continue;
    const name = personName(element.getAttribute("content") ?? element.textContent);
    if (!name) continue;
    const identity = httpUrl(anchor.getAttribute("href"), context.baseUrl);
    const profile: AuthorCandidate["profile"] = { name, socials: [] };
    const evidence: AuthorCandidate["evidence"] = { name: ev("dom-author", elementPath(element), "byline", "high") };
    if (identity) {
      const slug = new URL(identity).pathname.split("/").filter(Boolean).at(-1);
      if (slug) {
        profile.slug = slug;
        evidence.slug = ev("dom-author", `${elementPath(anchor)}@href`, "byline", "high");
      }
    }
    candidates.push({
      profile,
      ...(identity ? { identity } : {}),
      primary: true,
      evidence,
      ...(authorshipGroup ? { authorshipGroups: [authorshipGroup] } : {}),
    });
  }
  return candidates;
}
function unmarkedLinkedBylines(
  doc: Document,
  context: PageContext,
  currentUrls: ReadonlySet<string>,
): AuthorCandidate[] {
  const candidates: AuthorCandidate[] = [];
  for (const paragraph of doc.querySelectorAll("p")) {
    const paragraphText = text(paragraph.textContent) ?? "";
    if (paragraphText.length > 120) continue;
    const hasAuthorClass = /\b(?:byline|author|contributor)\b/i.test(paragraph.className || "");
    const startsWithByline = /^(?:[Bb][Yy]|[Ww][Rr][Ii][Tt][Tt][Ee][Nn]\s+[Bb][Yy])\s*:?\s+[\p{Lu}\p{Lt}\p{Lo}]/u.test(
      paragraphText,
    );
    if (!hasAuthorClass && !startsWithByline) continue;
    for (const anchor of paragraph.querySelectorAll("a[href]")) {
      if (
        isExcludedAttributionScope(anchor) ||
        anchor.closest(".related, .related-articles, .recommendations, .comments, .comment, [itemprop='comment']")
      )
        continue;
      if (
        anchor.closest(
          ".byline, .entry-author, .c-entry-author, [rel~='author'], [role='author'], [itemprop='author']",
        ) ||
        isListingAttributionScope(anchor, currentUrls, context.baseUrl)
      )
        continue;
      const name = personName(anchor.textContent);
      if (!name) continue;
      const href = httpUrl(anchor.getAttribute("href"), context.baseUrl);
      const social = socialLink(href, context.baseUrl);
      const identity = social?.url ?? href;
      const profile: AuthorCandidate["profile"] = { name, socials: social ? [social] : [] };
      const evidence: AuthorCandidate["evidence"] = { name: ev("dom-author", elementPath(anchor), "byline", "high") };
      if (href && !social) {
        const slug = new URL(href).pathname.split("/").filter(Boolean).at(-1);
        if (slug) {
          profile.slug = slug;
          evidence.slug = ev("dom-author", `${elementPath(anchor)}@href`, "byline", "high");
        }
      }
      candidates.push({
        profile,
        ...(identity ? { identity } : {}),
        primary: true,
        evidence,
        ...(social ? { socialEvidence: [ev("dom-author", `${elementPath(anchor)}@href`, "byline", "high")] } : {}),
        authorshipGroups: [`dom:${elementPath(paragraph)}`],
      });
    }
  }
  return candidates;
}

function scopedProfileUrl(
  scope: ParserElement,
  context: PageContext,
  currentUrls: ReadonlySet<string>,
): { url: string; sourcePath: string } | undefined {
  let link: ParserElement | null = null;
  if (scope.matches("a[rel~='author'][href], a[itemprop='url'][href]")) {
    link = scope;
  } else {
    const explicitLink = scope.querySelector("a[rel~='author'][href], a[itemprop='url'][href], a.author-name[href]");
    if (
      explicitLink &&
      !isExcludedAttributionScope(explicitLink) &&
      !isListingAttributionScope(explicitLink, currentUrls, context.baseUrl) &&
      !isInsideOrganizationScope(explicitLink, scope)
    ) {
      link = explicitLink;
    } else {
      const candidates =
        scope.localName === "a" && scope.hasAttribute("href") ? [scope] : Array.from(scope.querySelectorAll("a[href]"));
      for (const anchor of candidates) {
        if (
          isExcludedAttributionScope(anchor) ||
          isListingAttributionScope(anchor, currentUrls, context.baseUrl) ||
          isInsideOrganizationScope(anchor, scope)
        ) {
          continue;
        }
        const absolute = httpUrl(anchor.getAttribute("href"), context.baseUrl);
        if (absolute && isAuthorProfileUrl(absolute) && !socialLink(absolute, context.baseUrl)) {
          return { url: absolute, sourcePath: `${elementPath(anchor)}@href` };
        }
      }
    }
  }
  const href = link?.getAttribute("href") ?? scope.getAttribute("itemid");
  const absolute = httpUrl(href, context.baseUrl);
  if (!absolute) return undefined;
  try {
    return (isAuthorProfileUrl(absolute) && !socialLink(absolute, context.baseUrl)) ||
      scope.hasAttribute("itemid") ||
      link?.matches("[rel~='author'], [itemprop='url']")
      ? { url: absolute, sourcePath: link ? `${elementPath(link)}@href` : `${elementPath(scope)}@itemid` }
      : undefined;
  } catch {
    return undefined;
  }
}
function first(root: ParserElement, selectors: string[]): ParserElement | null {
  for (const selector of selectors) {
    const found = root.matches(selector) ? root : root.querySelector(selector);
    if (found) return found;
  }
  return null;
}
function firstMatching(
  root: ParserElement,
  selectors: string[],
  predicate: (element: ParserElement) => boolean,
): ParserElement | null {
  for (const selector of selectors) {
    if (root.matches(selector) && predicate(root)) return root;
    for (const candidate of root.querySelectorAll(selector)) {
      if (predicate(candidate)) return candidate;
    }
  }
  return null;
}
function ev(
  source: string,
  sourcePath: string,
  scope: ValueEvidence["scope"],
  confidence: ValueEvidence["confidence"],
): ValueEvidence {
  return { source, sourcePath, scope, confidence };
}
function mergeSameScopeDuplicates(candidates: AuthorCandidate[]): AuthorCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    // Two meta authors can share one indexed source path, so the display name
    // must participate in the key; otherwise the second author is dropped.
    const key = `${candidate.identity ?? candidate.profile.name ?? ""}\0${candidate.evidence.name?.sourcePath ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractArticles(context: PageContext): ArticleCandidate[] {
  const pageTitle = documentTitleElement(context.document);
  if (
    /^(?:page not found|404(?:\s|$))/i.test(
      text(pageTitle?.textContent ?? context.document.querySelector("h1")?.textContent) ?? "",
    )
  )
    return [];
  const seenLinks = new Set<string>();
  const skippedHrefs = new Set<string>();
  const articles: ArticleCandidate[] = [];
  const currentUrls = currentArticleUrls(context);
  const walker = context.document.createTreeWalker(context.document, 1);
  let node = walker.nextNode();
  while (node && articles.length < MAX_ARTICLES) {
    const anchor = node as ParserElement;
    if (anchor.localName === "a") {
      const href = anchor.getAttribute("href");
      if (href && !skippedHrefs.has(href)) {
        const inspected = inspectArticleAnchor(anchor);
        if (inspected) {
          const url = httpUrl(href, context.baseUrl);
          if (!url) {
            skippedHrefs.add(href);
          } else {
            const parsed = parseArticleUrl(url);
            if (
              !parsed ||
              parsed.isBareHomepage ||
              parsed.isLegal ||
              seenLinks.has(parsed.key) ||
              currentUrls.has(parsed.key) ||
              isAuthorProfileUrl(url)
            ) {
              skippedHrefs.add(href);
            } else {
              const titleElement = inspected.headline ?? anchor;
              const title =
                text(titleElement.textContent) ??
                text(anchor.getAttribute("aria-label")) ??
                text(anchor.getAttribute("title"));
              if (title && title.length >= MIN_ARTICLE_TITLE && title.length <= MAX_ARTICLE_TITLE) {
                seenLinks.add(parsed.key);
                skippedHrefs.add(href);
                const dateElement = inspected.card?.querySelector("time[datetime]");
                const date = dateString(dateElement?.getAttribute("datetime"));
                const article = { title, url, ...(date ? { publishedAt: date } : {}) };
                const sourcePath = elementPath(titleElement);
                articles.push({
                  article,
                  evidence: ev("dom-article", sourcePath, "article", "medium"),
                  fieldPaths: {
                    title: sourcePath,
                    url: `${elementPath(anchor)}@href`,
                    ...(date && dateElement ? { publishedAt: `${elementPath(dateElement)}@datetime` } : {}),
                  },
                });
              }
            }
          }
        }
      }
    }
    node = walker.nextNode();
  }
  return articles;
}

function parseArticleUrl(value: string): { key: string; isBareHomepage: boolean; isLegal: boolean } | undefined {
  try {
    const url = new URL(value);
    url.hash = "";
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    url.pathname = normalizedPath;
    return {
      key: url.href,
      isBareHomepage: normalizedPath === "/" && !url.search,
      isLegal: LEGAL_PATH_RE.test(normalizedPath),
    };
  } catch {
    return undefined;
  }
}

function normalizeArticleUrl(value: string): string {
  return parseArticleUrl(value)?.key ?? value;
}

function isHeadingTag(tag: string): boolean {
  return (
    tag.length === 2 &&
    tag.charCodeAt(0) === 104 /* 'h' */ &&
    tag.charCodeAt(1) >= 49 /* '1' */ &&
    tag.charCodeAt(1) <= 54 /* '6' */
  );
}

function isHeadlineElement(element: ParserElement): boolean {
  if (isHeadingTag(element.localName)) return true;
  const testId = element.getAttribute("data-testid");
  if (testId?.toLowerCase().includes("headline")) return true;
  const cls = element.getAttribute("class");
  return !!cls && HEADLINE_CLASS_RE.test(cls);
}

function isProfileArticleWrapper(element: ParserElement): boolean {
  const cls = element.getAttribute("class");
  if (!cls) return false;
  if (PROFILE_WRAPPER_CLASS_RE.test(cls)) return true;
  return element.localName === "header" && cls.includes("author-page");
}

function isNonArticleElement(element: ParserElement): boolean {
  const tag = element.localName;
  if (tag === "nav" || tag === "footer" || tag === "aside") return true;
  const role = element.getAttribute("role");
  if (role === "navigation" || role === "complementary") return true;
  if (element.getAttribute("itemprop") === "description") return true;
  const cls = element.getAttribute("class");
  return !!cls && NON_ARTICLE_CLASS_RE.test(cls);
}

function findDescendantHeadline(root: ParserElement): ParserElement | null {
  let current = root.firstElementChild;
  if (!current) return null;
  const stack: ParserElement[] = [];
  while (current) {
    if (isHeadlineElement(current)) return current;
    if (current.nextElementSibling) stack.push(current.nextElementSibling);
    current = current.firstElementChild ?? stack.pop() ?? null;
  }
  return null;
}

interface InspectedArticleAnchor {
  headline: ParserElement | null;
  card: ParserElement | null;
}

function inspectArticleAnchor(anchor: ParserElement): InspectedArticleAnchor | null {
  if (isNonArticleElement(anchor)) return null;
  const anchorClass = anchor.getAttribute("class");
  const selfHeadline = isHeadlineElement(anchor);
  const descendantHeadline = anchor.firstElementChild ? findDescendantHeadline(anchor) : null;
  let isArticle = selfHeadline || !!descendantHeadline || (!!anchorClass && ANCHOR_TITLE_CLASS_RE.test(anchorClass));
  let headlineAncestor: ParserElement | null = null;
  let card: ParserElement | null = null;
  let sawHeader = false;
  let headerInsideArticleContainer = false;

  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    const tag = parent.localName;
    if (tag === "html") break;
    if (isNonArticleElement(parent)) return null;
    const role = parent.getAttribute("role");
    const cls = parent.getAttribute("class");
    const isCard = tag === "article" || role === "article";
    const isFeed = !!cls && FEED_ITEM_CLASS_RE.test(cls) && !isProfileArticleWrapper(parent);
    if (isCard && !card) card = parent;
    if (tag === "header") sawHeader = true;
    if (sawHeader && (isCard || isFeed)) headerInsideArticleContainer = true;
    if (tag !== "body") {
      if (!headlineAncestor && isHeadlineElement(parent)) {
        headlineAncestor = parent;
        isArticle = true;
      }
      if (!isArticle && isFeed) isArticle = true;
    }
  }

  if (!isArticle) return null;
  if (sawHeader && !headerInsideArticleContainer) return null;
  const rel = anchor.getAttribute("rel");
  if (rel?.toLowerCase().includes("nofollow") && !card) return null;

  return {
    headline: descendantHeadline ?? (selfHeadline ? anchor : headlineAncestor),
    card,
  };
}

const EXCLUDED_ATTRIBUTION_SELECTOR =
  "footer, nav, aside, [role='navigation'], [role='complementary'], .share, .sharing, .social-share, .newsletter, .legal, .comments, .comment, [itemprop='comment'], #comments, .related-posts, .related-stories, .more-stories, .trending, .most-popular, dialog, [aria-hidden='true']";

function isExcludedAttributionScope(scope: ParserElement): boolean {
  return !!scope.closest(EXCLUDED_ATTRIBUTION_SELECTOR);
}
