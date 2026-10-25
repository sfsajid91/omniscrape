import type { PageContext, ParserElement } from "../core/context";
import { elementPath } from "../core/context";
import { emptyExtraction, type ArticleCandidate, type AuthorCandidate, type ExtractedData, type FieldCandidate, type ValueEvidence } from "../core/evidence";
import { dateString, emailAddress, httpUrl, imageUrl, isAuthorProfileUrl, personName, socialLink, stripHtml, text } from "../values";
import type { PageMetadata } from "../types";

export interface DomMetaResult extends ExtractedData {
 metadata: PageMetadata;
}

const MAX_ARTICLES = 20;
const MAX_ARTICLE_TITLE = 300;
const MAX_BIO = 2000;
const MAX_ROLE = 200;
const AUTHOR_SCOPE = [
 "[role='author']", "[itemtype*='Person' i]", "[itemprop='author']", "[rel~='author']",
 ".byline", ".entry-author", ".c-entry-author", ".author-header", ".author-profile", ".author-card",
 ".article-author", ".author-detail", "header[class*='author-page']", "header.contentheader--archived-bio", "[class*='author-name']",
 "[data-testid*='author' i]", "[data-author]",
];
const NAME_SELECTORS = [
 "[itemprop='name']", "[itemprop='author'] [itemprop='name']", ".author-name", ".contributor-name", "[rel~='author']",
 "a[href*='/author/']", "a[href*='/authors/']", "a[href*='/contributors/']",
 "[class*='author-name']", "[data-author]",
];

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
   if (value && entry) { put(key, value, entry.path); return; }
  }
 };
 meta("title", ["og:title", "twitter:title"]);
 if (!metadata.title) {
  const title = context.document.querySelector("title");
  if (title) put("title", text(title.textContent), elementPath(title));
 }
 meta("description", ["og:description", "twitter:description", "description"], stripHtml);
 const canonical = context.links.find((link) => link.rel.split(/\s+/).includes("canonical") && httpUrl(link.href, context.baseUrl));
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
   fields.push({ field: "metadata.publishedTime", value: date.value, evidence: ev("dom-meta", date.path, "page", "low") });
  }
 }
 meta("modifiedTime", ["article:modified_time", "og:article:modified_time"], dateString);
 return { metadata, fields };
}

function visiblePublicationDate(context: PageContext): { value: string; path: string } | undefined {
 if (isAuthorProfileUrl(context.pageUrl)) return undefined;
 const main = Array.from(context.document.querySelectorAll("main")).find((item) => item.querySelector("h1"));
 const mainArticle = main && Array.from(main.querySelectorAll("article")).find((item) => item.querySelector("h1") &&
  Array.from(item.querySelectorAll("p")).some((paragraph) => /^([A-Za-z]+)\s+\d{1,2},\s*\d{4}\s+by\s+/i.test(text(paragraph.textContent) ?? "")));
 const container = mainArticle ?? main ?? context.document.querySelector(".entry.entryPage");
 if (!container) return undefined;
 const explicit = container.querySelector("time[itemprop='datePublished'][datetime], time[pubdate][datetime]");
 const explicitDate = dateString(explicit?.getAttribute("datetime"));
 if (explicitDate && explicit) return { value: explicitDate, path: `${elementPath(explicit)}@datetime` };
 for (const footer of container.querySelectorAll(".entryFooter")) {
  if (footer.closest(".entry.entryPage") !== container) continue;
  const value = parseVisibleDate(footer.textContent ?? "", /^Posted\s+(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)\s+([A-Za-z]+)\s+(\d{4})\b/i);
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
 const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
 const footer = pattern.source.startsWith("^Posted");
 const day = Number(footer ? match[1] : match[2]);
 const month = months.indexOf((footer ? match[2] : match[1]).toLowerCase()) + 1;
 const year = Number(match[3]);
 if (month < 1) return undefined;
 return dateString(`${year}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`);
}
function currentArticleUrls(context: PageContext): Set<string> {
 const canonical = context.links.find((link) => link.rel.split(/\s+/).includes("canonical"));
 return new Set([context.pageUrl, ...(canonical ? [httpUrl(canonical.href, context.baseUrl) ?? ""] : [])]
  .filter(Boolean).map((value) => normalizeArticleUrl(value)));
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
 return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function verifiedGuardianProfiles(context: PageContext): GuardianProfile[] {
 if (!isAuthorProfileUrl(context.pageUrl)) return [];
 const pathSlug = new URL(context.pageUrl).pathname.split("/").filter(Boolean).at(-1) ?? "";
 let expectedSlug = pathSlug;
 try { expectedSlug = decodeURIComponent(pathSlug); } catch { return []; }
 const expected = normalizedProfileWords(expectedSlug).replace(/\s/g, "");
 if (!expected) return [];
 const verified: GuardianProfile[] = [];
 const seen = new Set<ParserElement>();
 for (const heading of context.document.querySelectorAll("h1, h2")) {
  if (heading.closest("article, nav, footer, aside")) continue;
  const scope = heading.closest("section, header") as ParserElement | null;
  if (!scope || seen.has(scope)) continue;
  const name = text(heading.textContent);
  if (!name || normalizedProfileWords(name).replace(/\s/g, "") !== expected) continue;
  const image = Array.from(scope.querySelectorAll("img[alt]")).find((candidate) =>
   normalizedProfileWords((candidate.getAttribute("alt") ?? "").replace(/\b(?:headshot|portrait)\b/gi, " ").replace(/^\s*of\s+/i, "")) === normalizedProfileWords(name));
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
 if (!firstSpeakable || normalizedProfileWords(text(firstSpeakable.textContent) ?? "") !== normalizedProfileWords(name)) return undefined;
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
 const scopes = doc.querySelectorAll(AUTHOR_SCOPE.join(", "));
 const currentUrls = currentArticleUrls(context);

 // Explicit author metadata is evidence for a byline, never an article title/description surrogate.
 for (const metaAuthor of context.authorMeta) {
  const parts = metaAuthor.separator
   ? metaAuthor.value.split(metaAuthor.separator)
   : metaAuthor.value.split(/\s*(?:,|\|| and )\s*/i);
  for (const part of parts) {
   const raw = text(part);
   if (!raw) continue;
   if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(raw) && httpUrl(raw, context.baseUrl)) continue;
   const name = personName(raw);
   if (!name) continue;
   candidates.push({ profile: { name, socials: [] }, primary: true, evidence: { name: ev("dom-meta", metaAuthor.path, "byline", "high") }, authorshipGroups: [`meta:${metaAuthor.path}`] });
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
  const wrapper = heading?.closest(".article-author, .author-detail, header[class*='author-page'], .author-header, .author-profile, .author-card, [itemtype*='Person' i]");
  if (wrapper && !isExcludedAttributionScope(wrapper) && !isListingAttributionScope(wrapper, currentUrls, context.baseUrl)) {
   candidates.push(...authorsFromScope(wrapper, context, currentUrls));
  }
 }
 return mergeSameScopeDuplicates(candidates);
}


function authorsFromScope(scope: ParserElement, context: PageContext, currentUrls: ReadonlySet<string>, guardian?: GuardianProfile): AuthorCandidate[] {
 if (isListingAttributionScope(scope, currentUrls, context.baseUrl)) return [];
 const profilePath = isAuthorProfileUrl(context.pageUrl);
 const bylineContainer = scope.closest("[role='author'], [itemprop='author'], .byline, .entry-author, .c-entry-author") ??
  (scope.matches("[rel~='author'], [data-author], [data-testid*='author' i]") ? scope : null);
 const authorshipGroup = !profilePath && !scope.closest(".related, .related-articles, .recommendations, .comments, .comment, [itemprop='comment']") && bylineContainer
  ? `dom:${elementPath(bylineContainer)}` : undefined;
 const names = Array.from(scope.querySelectorAll(NAME_SELECTORS.join(", ")));
 const separateNames = names.filter((element) => !names.some((other) => other !== element && other.contains(element)));
 if (separateNames.length > 1) return linkedAnchorCandidates(separateNames, context, currentUrls, authorshipGroup);
 const archivedBioScope = scope.matches("header.contentheader--archived-bio") && profilePath;
 if (scope.matches("header.contentheader--archived-bio") && !profilePath) return [];
 const explicitProfileScope = scope.matches(".article-author, .author-detail, header[class*='author-page'], .author-card, .author-header, .author-profile, [itemtype*='Person' i]");
 const profileHeading = scope.querySelector("h1") ?? (profilePath ? scope.querySelector("h2") : null);
 const pageProfileScope = profilePath && (!!guardian || (explicitProfileScope && !!profileHeading) ||
  (archivedBioScope && !!scope.querySelector("h2.branding__title")));
 const allowScopedHeading = scope.matches(".author-header, .author-profile, .author-detail, header[class*='author-page']") || pageProfileScope;
 const nameElement = guardian?.heading ?? (archivedBioScope ? scope.querySelector("h2.branding__title") :
  allowScopedHeading ? profileHeading : first(scope, NAME_SELECTORS) ?? (scope.matches("[itemprop='author']") ? scope.querySelector("[itemprop='name']") : null));
 const plainByline = scope.matches(".byline, .entry-author, .c-entry-author, [rel~='author'], [role='author'], [data-testid*='author' i], [data-author]");
 const label = nameElement?.querySelector(".author__title-desc");
 const nameSource = nameElement?.getAttribute("content") ?? (label && text(label.textContent) === "Author"
  ? (nameElement?.textContent ?? "").replace(label.textContent ?? "", " ")
  : nameElement?.textContent) ?? (plainByline ? scope.textContent : scope.hasAttribute("data-author") ? scope.getAttribute("data-author") : undefined);
 const name = personName(nameSource);
 if (!name) return [];
 const explicitByline = !!scope.closest("[role='author'], [itemprop='author'], .byline, .entry-author, .c-entry-author") || scope.matches("[rel~='author'], [data-author], [data-testid*='author' i]");
 const inStoryCard = !!scope.closest(".related, .related-articles, .recommendations, [role='article']");
 const primary = !inStoryCard && (pageProfileScope || explicitByline);
 if (profilePath && !pageProfileScope && scope.closest("article, [role='article']")) return [];
 const profile: AuthorCandidate["profile"] = { name, socials: [] };
 const evidence: AuthorCandidate["evidence"] = { name: ev("dom-author", nameElement ? elementPath(nameElement) : elementPath(scope), pageProfileScope ? "profile" : primary ? "byline" : "profile", "high") };
 const nprBio = archivedBioScope ? nprSpeakableBio(scope, name) : undefined;
 const bioEl = guardian?.biography ?? nprBio ?? first(scope, ["[itemprop='description']", ".author-bio", ".header-description", ".bio", ".author-description", ".contributor-bio"]);
 const bioText = bioEl?.querySelector("p")?.textContent ?? bioEl?.textContent;
 const bio = stripHtml(bioText);
 if (bio && bio.length > 20 && bio.length <= MAX_BIO) { profile.bio = bio; evidence.bio = ev("dom-author", elementPath(bioEl!), "profile", "high"); }
 const img = guardian?.image ?? first(scope, ["[itemprop='image']", "img.author-avatar", "img.author-image", "img.bio-image-image", "img.author-details-avatar", "img.avatar"]);
 const avatar = imageUrl(img?.getAttribute("content") ?? img?.getAttribute("src") ?? img?.getAttribute("data-src"), context.baseUrl);
 if (avatar) { profile.avatarUrl = avatar; evidence.avatarUrl = ev("dom-author", elementPath(img!), "profile", "high"); }
 const roleEl = first(scope, ["[itemprop='jobTitle']", ".author-title", ".author-role", ".designation"]);
 const role = text(roleEl?.textContent);
 if (role && role.length <= MAX_ROLE) { profile.designation = role; evidence.designation = ev("dom-author", elementPath(roleEl!), "profile", "medium"); }
 for (const anchor of scope.querySelectorAll("a[href^='mailto:']")) {
  if (isExcludedAttributionScope(anchor)) continue;
  const email = emailAddress(anchor.getAttribute("href"));
  if (!email) continue;
  profile.email = email;
  evidence.email = ev("dom-author", elementPath(anchor), pageProfileScope ? "profile" : primary ? "byline" : "profile", "medium");
  break;
 }
 const socialEvidence: ValueEvidence[] = [];
 const seen = new Set<string>();
 for (const anchor of scope.querySelectorAll("a[href]")) {
  if (isExcludedAttributionScope(anchor)) continue;
  const social = socialLink(anchor.getAttribute("href"), context.baseUrl);
  if (!social || seen.has(social.url)) continue;
  seen.add(social.url);
  profile.socials!.push(social);
  socialEvidence.push(ev("dom-author", elementPath(anchor), pageProfileScope ? "profile" : primary ? "byline" : "profile", "high"));
 }
 const linkedProfile = scopedProfileUrl(scope, context);
 const identity = linkedProfile?.url ?? (pageProfileScope ? context.pageUrl : undefined);
 if (identity) {
  profile.slug = new URL(identity).pathname.split("/").filter(Boolean).at(-1);
  evidence.slug = ev("dom-author", linkedProfile?.sourcePath ?? "pageUrl", pageProfileScope ? "profile" : "byline", "high");
 }
 return [{ profile, ...(identity ? { identity } : {}), primary, evidence, ...(socialEvidence.length ? { socialEvidence } : {}), ...(authorshipGroup ? { authorshipGroups: [authorshipGroup] } : {}) }];
}

/**
 * A byline can list several people ("By Alice and Bob"). Emit one name-only
 * candidate per linked person so the resolver can report the ambiguity instead
 * of returning nothing or lending one person's contacts to another.
 */
function linkedAnchorCandidates(elements: ParserElement[], context: PageContext, currentUrls: ReadonlySet<string>, authorshipGroup?: string): AuthorCandidate[] {
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
   if (slug) { profile.slug = slug; evidence.slug = ev("dom-author", `${elementPath(anchor)}@href`, "byline", "high"); }
  }
  candidates.push({ profile, ...(identity ? { identity } : {}), primary: true, evidence, ...(authorshipGroup ? { authorshipGroups: [authorshipGroup] } : {}) });
 }
 return candidates;
}
function unmarkedLinkedBylines(doc: Document, context: PageContext, currentUrls: ReadonlySet<string>): AuthorCandidate[] {
 const candidates: AuthorCandidate[] = [];
 for (const paragraph of doc.querySelectorAll("p")) {
  if (!/^(?:by|written by)\b/i.test(text(paragraph.textContent) ?? "")) continue;
  for (const anchor of paragraph.querySelectorAll("a[href]")) {
   if (isExcludedAttributionScope(anchor) ||
    anchor.closest(".related, .related-articles, .recommendations, .comments, .comment, [itemprop='comment']")) continue;
   if (anchor.closest(".byline, .entry-author, .c-entry-author, [rel~='author'], [role='author'], [itemprop='author']") ||
    isListingAttributionScope(anchor, currentUrls, context.baseUrl)) continue;
   const name = personName(anchor.textContent);
   if (!name) continue;
   const href = httpUrl(anchor.getAttribute("href"), context.baseUrl);
   const social = socialLink(href, context.baseUrl);
   const identity = social?.url ?? href;
   const profile: AuthorCandidate["profile"] = { name, socials: social ? [social] : [] };
   const evidence: AuthorCandidate["evidence"] = { name: ev("dom-author", elementPath(anchor), "byline", "high") };
   if (href && !social) {
    const slug = new URL(href).pathname.split("/").filter(Boolean).at(-1);
    if (slug) { profile.slug = slug; evidence.slug = ev("dom-author", `${elementPath(anchor)}@href`, "byline", "high"); }
   }
   candidates.push({ profile, ...(identity ? { identity } : {}), primary: true, evidence, ...(social ? { socialEvidence: [ev("dom-author", `${elementPath(anchor)}@href`, "byline", "high")] } : {}), authorshipGroups: [`dom:${elementPath(paragraph)}`] });
  }
 }
 return candidates;
}

function scopedProfileUrl(scope: ParserElement, context: PageContext): { url: string; sourcePath: string } | undefined {
 const link = scope.matches("a[rel~='author'][href], a[itemprop='url'][href]")
  ? scope
  : scope.querySelector("a[rel~='author'][href], a[itemprop='url'][href], a.author-name[href], a[href*='/author/'], a[href*='/authors/']");
 const href = link?.getAttribute("href") ?? scope.getAttribute("itemid");
 const absolute = httpUrl(href, context.baseUrl);
 if (!absolute) return undefined;
 try {
  return isAuthorProfileUrl(absolute) || scope.hasAttribute("itemid") || !!link?.matches("[rel~='author'], [itemprop='url']")
   ? { url: absolute, sourcePath: link ? `${elementPath(link)}@href` : `${elementPath(scope)}@itemid` }
   : undefined;
 } catch { return undefined; }
}
function first(root: ParserElement, selectors: string[]): ParserElement | null { for (const selector of selectors) { const found = root.matches(selector) ? root : root.querySelector(selector); if (found) return found; } return null; }
function ev(source: string, sourcePath: string, scope: ValueEvidence["scope"], confidence: ValueEvidence["confidence"]): ValueEvidence { return { source, sourcePath, scope, confidence }; }
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
 if (/^(?:page not found|404(?:\s|$))/i.test(text(context.document.querySelector("title")?.textContent ?? context.document.querySelector("h1")?.textContent) ?? "")) return [];
 const seenLinks = new Set<string>();
 const articles: ArticleCandidate[] = [];
 const currentUrls = currentArticleUrls(context);
 const walker = context.document.createTreeWalker(context.document, 1);
 let node = walker.nextNode();
 while (node && articles.length < MAX_ARTICLES) {
  const anchor = node as ParserElement;
  const href = anchor.localName === "a" ? anchor.getAttribute("href") : null;
  const url = href ? httpUrl(href, context.baseUrl) : undefined;
  const key = url ? normalizeArticleUrl(url) : "";
  if (href && url && key && !seenLinks.has(key) && !currentUrls.has(key) && !isAuthorProfileUrl(url) && isArticleAnchor(anchor) && !isNonArticleContext(anchor)) {
   const headline = anchor.querySelector("h2, h3, h4, [data-testid*='headline' i]") ?? anchor.closest("h2, h3, h4, [data-testid*='headline' i]");
   const titleElement = headline ?? anchor;
   const title = text(titleElement.textContent) ?? text(anchor.getAttribute("aria-label")) ?? text(anchor.getAttribute("title"));
   if (title && title.length >= 15 && title.length <= MAX_ARTICLE_TITLE) {
    seenLinks.add(key);
    const card = anchor.closest("article, [role='article']");
    const dateElement = card?.querySelector("time[datetime]");
    const date = dateString(dateElement?.getAttribute("datetime"));
    const article = { title, url, ...(date ? { publishedAt: date } : {}) };
    const sourcePath = elementPath(titleElement);
    articles.push({
     article, evidence: ev("dom-article", sourcePath, "article", "medium"),
     fieldPaths: { title: sourcePath, url: `${elementPath(anchor)}@href`, ...(date && dateElement ? { publishedAt: `${elementPath(dateElement)}@datetime` } : {}) }
    });
   }
  }
  node = walker.nextNode();
 }
 return articles;
}

function normalizeArticleUrl(value: string): string {
 try {
  const url = new URL(value);
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
 } catch { return value; }
}

function isProfileArticleWrapper(element: ParserElement): boolean {
 return element.matches(".author-wrapper, .author-header, .author-profile, .author-card, .author-detail, header[class*='author-page']");
}

function isArticleAnchor(anchor: ParserElement): boolean {
 if (anchor.matches("[data-testid*='headline' i]") || anchor.querySelector("h2, h3, h4, [data-testid*='headline' i]")) return true;
 if (/(?:^|\s)(?:c-entry-box--compact__title|tout-title-link)(?:\s|$)/.test(anchor.getAttribute("class") ?? "")) return true;
 for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
  if (/^h[234]$/.test(parent.localName) || parent.matches("[data-testid*='headline' i]")) return true;
  if (/(?:^|\s)(?:feed-item|river-item)(?:\s|$)/.test(parent.getAttribute("class") ?? "") && !isProfileArticleWrapper(parent)) return true;
  if (parent.localName === "body" || parent.localName === "html") break;
 }
 return false;
}

function isNonArticleContext(anchor: ParserElement): boolean {
 const excluded = anchor.closest("nav, footer, aside, [role='navigation'], [role='complementary'], .share, .sharing, .social-share, .newsletter, .legal, .pagination, .also-read, .story-element-text-also-read, .author-description, .author-bio, .contributor-bio, .bio, .header-description, [itemprop='description']");
 if (excluded) return true;
 const rel = (anchor.getAttribute("rel") ?? "").toLowerCase();
 if (rel.includes("nofollow") && !anchor.closest("article, [role='article']")) return true;
 try {
  const path = new URL(anchor.getAttribute("href")!, "https://local.invalid").pathname.toLowerCase();
  if (/\/(?:privacy(?:-policy)?|terms(?:-of-service)?|cookies?|cookie-policy)\/?$/.test(path)) return true;
 } catch { }
 return false;
}

function isExcludedAttributionScope(scope: ParserElement): boolean {
 return !!scope.closest("footer, nav, aside, [role='navigation'], [role='complementary'], .share, .sharing, .social-share, .newsletter, .legal");
}
