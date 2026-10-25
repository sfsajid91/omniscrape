import type { PageContext } from "../core/context";
import type { ArticleCandidate, AuthorCandidate, ExtractedData, ValueEvidence } from "../core/evidence";
import { emptyExtraction } from "../core/evidence";
import { dateString, emailAddress, httpUrl, imageUrl, isAuthorProfileUrl, isRecord, personName, socialLink, stripHtml, text } from "../values";
import type { AuthorProfile } from "../types";

export type JsonLdResult = ExtractedData;

type Entity = Record<string, unknown>;
type IndexedEntity = { value: Entity; path: string; fieldPaths?: Record<string, string> };
const MAX_ENTITIES = 20_000;
const MAX_ARRAY_ITEMS = 500;
const MAX_ARTICLE_TITLE = 300;
const MAX_BIO = 2000;
const MAX_ROLE = 200;

type WalkEntry = { value: unknown; path: string; depth: number };

export function extractJsonLd(context: PageContext): JsonLdResult {
 const result = emptyExtraction();
 const entities: IndexedEntity[] = [];
 const references = new Map<string, IndexedEntity[]>();
 const rootPaths = new Set<string>();
 let nodeCount = 0;

 for (const script of context.scripts) {
  if (script.type !== "application/ld+json") continue;
  let parsed: unknown;
  try {
   parsed = JSON.parse(script.text) as unknown;
  } catch {
   context.issues.push({ sourcePath: script.path, message: "Malformed JSON-LD" });
   continue;
  }
  rootPaths.add(script.path);
  // A top-level array (or the usual @graph wrapper) holds the page's root
  // entities; without this they are never treated as current-page evidence.
  if (Array.isArray(parsed)) {
   parsed.slice(0, MAX_ARRAY_ITEMS).forEach((_, index) => rootPaths.add(`${script.path}[${index}]`));
  } else if (isRecord(parsed) && Array.isArray(parsed["@graph"])) {
   parsed["@graph"].slice(0, MAX_ARRAY_ITEMS).forEach((_, index) => rootPaths.add(`${script.path}.@graph[${index}]`));
  }
  const stack: WalkEntry[] = [{ value: parsed, path: script.path, depth: 0 }];
  while (stack.length) {
   const current = stack.pop()!;
   if (++nodeCount > context.limits.maxDecodeNodes || entities.length >= MAX_ENTITIES) {
    context.issues.push({ sourcePath: current.path, message: "JSON-LD traversal limit reached" });
    stack.length = 0;
    break;
   }
   if (current.depth > context.limits.maxDecodeDepth) {
    context.issues.push({ sourcePath: current.path, message: "JSON-LD depth limit reached" });
    continue;
   }
   if (Array.isArray(current.value)) {
    const length = Math.min(current.value.length, MAX_ARRAY_ITEMS);
    if (length < current.value.length) context.issues.push({ sourcePath: current.path, message: "JSON-LD array limit reached" });
    for (let i = length - 1; i >= 0; i--) stack.push({ value: current.value[i], path: `${current.path}[${i}]`, depth: current.depth + 1 });
    continue;
   }
   if (!isRecord(current.value)) continue;
   const obj = current.value;
   const entry: IndexedEntity = { value: obj, path: current.path };
   if (typeof obj["@id"] === "string") {
    const id = resolveId(obj["@id"], context);
    if (id) {
     const group = references.get(id) ?? [];
     group.push(entry);
     references.set(id, group);
    }
   }
   if (isEntity(obj)) entities.push(entry);
   const keys = Object.keys(obj);
   for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i]!;
    if (key === "@context") continue;
    stack.push({ value: obj[key], path: `${current.path}.${key}`, depth: current.depth + 1 });
   }
  }
 }

 const isSubstantive = (entity: Entity): boolean =>
  Object.keys(entity).some((key) => key !== "@id" && key !== "@type" && key !== "@context");
 const resolveReferences = (id: string, local?: IndexedEntity): IndexedEntity[] => {
  const output: IndexedEntity[] = [];
  const queue = [id];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  let visits = 0;
  while (queue.length && visits++ < 1000) {
   const currentId = queue.shift()!;
   if (seenIds.has(currentId)) continue;
   seenIds.add(currentId);
   const entries = [...(references.get(currentId) ?? [])];
   if (local && currentId === id && !entries.some((entry) => entry.path === local.path)) entries.push(local);
   for (const entry of entries) {
    const nextId = text(entry.value["@id"]);
    const normalizedNextId = nextId ? resolveId(nextId, context) : undefined;
    if (normalizedNextId && normalizedNextId !== currentId) queue.push(normalizedNextId);
    if (isSubstantive(entry.value) && !seenPaths.has(entry.path)) {
     seenPaths.add(entry.path);
     output.push(entry);
    }
   }
  }
  if (queue.length) context.issues.push({ sourcePath: local?.path ?? "JSON-LD", message: "Reference traversal limit reached" });
  return output;
 };
 const getLinked = (value: unknown, relationshipPath: string): IndexedEntity[] => {
  const output: IndexedEntity[] = [];
  const queue: Array<{ value: unknown; path: string }> = [{ value, path: relationshipPath }];
  let visits = 0;
  while (queue.length && visits++ < 1000) {
   const current = queue.shift()!;
   if (Array.isArray(current.value)) {
    current.value.slice(0, MAX_ARRAY_ITEMS).forEach((item, index) => queue.push({ value: item, path: `${current.path}[${index}]` }));
   } else {
    const object = isRecord(current.value) ? current.value : undefined;
    const isReferenceString = typeof current.value === "string" && /^(?:#|\/|\.\/|\.\.\/|[a-z][a-z0-9+.-]*:)/i.test(current.value);
    const rawId = object ? text(object["@id"]) : isReferenceString ? current.value as string : undefined;
    const id = rawId ? resolveId(rawId, context) : undefined;
    if (id) {
     output.push(...resolveReferences(id, object ? { value: object, path: current.path } : undefined));
    } else if (object && (isEntity(object) || isSubstantive(object))) {
     output.push({ value: object, path: current.path });
    } else if (typeof current.value === "string" && !/^(?:#|\/|\.\/|\.\.\/|[a-z][a-z0-9+.-]*:)/i.test(current.value)) {
     const name = text(current.value);
     if (name) output.push({ value: { name }, path: current.path, fieldPaths: { name: current.path } });
    }
   }
  }
  if (queue.length) context.issues.push({ sourcePath: relationshipPath, message: "Relationship traversal limit reached" });
  return output;
 };

 const isRelatedPerson = (entity: Entity): boolean => {
  const types = schemaTypes(entity["@type"]);
  return types.has("Person") || types.has("Author") || (!types.size && isSubstantive(entity));
 };

 const primaryPersonKeys = new Set<string>();
 const primaryPersonScopes = new Map<string, ValueEvidence["scope"]>();
 const primaryPersonGroups = new Map<string, string[]>();
 const rootArticleEntries = entities.filter((item) => isArticleType(schemaTypes(item.value["@type"])) && rootPaths.has(item.path));
 const personEntries = entities.filter((item) => {
  const types = schemaTypes(item.value["@type"]);
  return types.has("Person") || types.has("Author");
 });
 const personIdentityKeys = new Set(personEntries.map((item) => entityKey(item.value, item.path, context)));
 for (const entry of entities) {
  const entity = entry.value;
  const types = schemaTypes(entity["@type"]);
  if (types.has("ProfilePage")) {
   for (const linked of getLinked(entity.mainEntity, `${entry.path}.mainEntity`)) {
    if (isRelatedPerson(linked.value)) {
     const key = entityKey(linked.value, linked.path, context);
     primaryPersonKeys.add(key);
     primaryPersonScopes.set(key, "profile");
    }
   }
  }
  if (isArticleType(types) && isCurrentArticle(entity, context, rootArticleEntries.length === 1 && rootPaths.has(entry.path))) {
   const articleId = text(entity["@id"]);
   const groupIdentity = articleId ? resolveId(articleId, context) ?? articleId : httpUrl(entity.url, context.baseUrl) ?? entry.path;
   const group = `json-ld:${groupIdentity}`;
   for (const linked of getLinked(entity.author, `${entry.path}.author`)) {
    if (!isRelatedPerson(linked.value)) continue;
    const key = entityKey(linked.value, linked.path, context);
    primaryPersonKeys.add(key);
    primaryPersonScopes.set(key, "byline");
    const groups = primaryPersonGroups.get(key) ?? [];
    if (!groups.includes(group)) groups.push(group);
    primaryPersonGroups.set(key, groups);
   }
  }
  if (isArticleType(types) && isAuthorProfileUrl(context.pageUrl)) {
   const authors = getLinked(entity.author, `${entry.path}.author`);
   const publishers = getLinked(entity.publisher, `${entry.path}.publisher`);
   for (const author of authors) {
    const authorName = text(author.value.name);
    if (!authorName || !schemaTypes(author.value["@type"]).has("Person")) continue;
    const matchesPublisher = publishers.some((publisher) =>
     (schemaTypes(publisher.value["@type"]).has("Organization") || schemaTypes(publisher.value["@type"]).has("NewsMediaOrganization")) &&
     text(publisher.value.name)?.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase() === authorName.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase());
    if (matchesPublisher) {
     const sourcePath = author.fieldPaths?.name ?? `${author.path}.name`;
     context.issues.push({ sourcePath, message: "JSON-LD person matches publisher on an author profile; not accepted as the page author" });
    }
   }
  }
 }

 const emitted = new Set<string>();
 for (const entry of entities) {
  const entity = entry.value;
  const types = schemaTypes(entity["@type"]);
  if (types.has("Person") || types.has("Author")) {
   const rawId = text(entity["@id"]);
   const id = rawId ? resolveId(rawId, context) : undefined;
   const fragments = id ? resolveReferences(id) : [entry];
   for (const fragment of fragments) {
    if (!isRelatedPerson(fragment.value) || emitted.has(fragment.path)) continue;
    const key = entityKey(fragment.value, fragment.path, context);
    const rootProfile = personIdentityKeys.size === 1 && rootPaths.has(fragment.path) && (!fragment.value.url || personMatchesPage(fragment.value, context));
    const pageBound = primaryPersonKeys.size === 0 && !isAuthorProfileUrl(context.pageUrl) && personMatchesPage(fragment.value, context);
    const primary = primaryPersonKeys.has(key) || rootProfile || pageBound;
    const scope = primaryPersonScopes.get(key) ?? (pageBound ? "profile" : "page");
    const candidate = personCandidate(fragment.value, fragment.path, context, primary, scope, fragment.fieldPaths);
    if (!candidate) continue;
    const groups = primaryPersonGroups.get(key);
    if (groups?.length) candidate.authorshipGroups = [...groups];
    emitted.add(fragment.path);
    result.authors.push(candidate);
   }
   continue;
  }
  if (types.has("ProfilePage")) {
   for (const linked of getLinked(entity.mainEntity, `${entry.path}.mainEntity`)) {
    if (!isRelatedPerson(linked.value) || emitted.has(linked.path)) continue;
    const candidate = personCandidate(linked.value, linked.path, context, true, "profile", linked.fieldPaths);
    if (!candidate) continue;
    emitted.add(linked.path);
    result.authors.push(candidate);
   }
  }
  if (isArticleType(types)) {
   const current = isCurrentArticle(entity, context, rootArticleEntries.length === 1 && rootPaths.has(entry.path));
   if (current) {
    for (const linked of getLinked(entity.author, `${entry.path}.author`)) {
     if (!isRelatedPerson(linked.value) || emitted.has(linked.path)) continue;
     const candidate = personCandidate(linked.value, linked.path, context, true, "byline", linked.fieldPaths);
     if (!candidate) continue;
     const groups = primaryPersonGroups.get(entityKey(linked.value, linked.path, context));
     if (groups?.length) candidate.authorshipGroups = [...groups];
     emitted.add(linked.path);
     result.authors.push(candidate);
    }
   }
   const article = articleCandidate(entity, entry.path, context);
   if (article && (current || isAuthorProfileUrl(context.pageUrl))) result.articles.push(article);
   if (current) {
    for (const [key, field] of [["publishedTime", "datePublished"], ["modifiedTime", "dateModified"]] as const) {
     const date = dateString(entity[field]);
     if (date) result.fields.push({ field: `metadata.${key}`, value: date, evidence: { source: "json-ld", sourcePath: `${entry.path}.${field}`, scope: "page", confidence: "high" } });
    }
    addRelatedPublisher(entity.publisher, `${entry.path}.publisher`, result, getLinked);
   }
  }
  if (types.has("ItemList")) addItemListArticles(entity.itemListElement, `${entry.path}.itemListElement`, context, result);
 }
 const articlePaths = new Set<string>();
 result.articles = result.articles.filter(({ evidence }) => {
  if (articlePaths.has(evidence.sourcePath)) return false;
  articlePaths.add(evidence.sourcePath);
  return true;
 });
 return result;
}

function isEntity(value: Entity): boolean {
 return value["@type"] !== undefined || (typeof value["@id"] === "string" && ("name" in value || "headline" in value || "mainEntity" in value));
}

function schemaTypes(value: unknown): Set<string> {
 const values = Array.isArray(value) ? value : [value];
 const types = new Set<string>();
 for (const item of values) {
  const raw = text(item);
  if (!raw) continue;
  const normalized = raw.replace(/^https?:\/\/(?:www\.)?schema\.org\//i, "").replace(/^schema:/i, "");
  if (/^[A-Za-z][\w-]*$/.test(normalized)) types.add(normalized);
 }
 return types;
}

function isArticleType(types: Set<string>): boolean {
 return ["Article", "NewsArticle", "BlogPosting", "Report", "ScholarlyArticle", "TechArticle", "AnalysisNewsArticle", "AdvertiserContentArticle", "ReportageNewsArticle"].some((type) => types.has(type));
}

function isCurrentArticle(entity: Entity, context: PageContext, isRootArticle: boolean): boolean {
 if (isAuthorProfileUrl(context.pageUrl)) return false;
 const raw = entity.url ?? entity.mainEntityOfPage;
 const candidate = typeof raw === "string" ? httpUrl(raw, context.baseUrl) : isRecord(raw) ? httpUrl(raw["@id"] ?? raw.url, context.baseUrl) : undefined;
 if (candidate && isAuthorProfileUrl(candidate)) return false;
 if (candidate && pageMatches(candidate, context)) return true;
 if (raw !== undefined && raw !== null) return false;
 return isRootArticle;
}

function pageMatches(candidate: string, context: PageContext): boolean {
 const target = comparablePage(candidate);
 if (!target) return false;
 const urls = [context.pageUrl, ...context.links.filter((link) => link.rel.split(/\s+/).includes("canonical")).map((link) => link.href)];
 return urls.some((value) => {
  const normalized = httpUrl(value, context.baseUrl);
  const other = normalized ? comparablePage(normalized) : undefined;
  return !!other && other.host === target.host && other.path === target.path;
 });
}

/** Compare the identifying parts of a page URL: host + path. Tracking query
 * strings, fragments, a trailing slash, `www.`, and http/https differences do
 * not make the same story a different page. */
function comparablePage(value: string): { host: string; path: string } | undefined {
 try {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  return {
   host: url.hostname.toLowerCase().replace(/^www\./, ""),
   path: (url.pathname.replace(/\/+$/, "") || "/").toLowerCase(),
  };
 } catch {
  return undefined;
 }
}

function personMatchesPage(entity: Entity, context: PageContext): boolean {
 const profileUrl = httpUrl(entity.url, context.baseUrl);
 return profileUrl ? pageMatches(profileUrl, context) : false;
}
function resolveId(id: string, context: PageContext): string | undefined { return httpUrl(id, context.baseUrl); }
function entityKey(entity: Entity, path: string, context: PageContext): string {
 const id = text(entity["@id"]);
 return id ? resolveId(id, context) ?? id : path;
}

function personCandidate(entity: Entity, path: string, context: PageContext, primary: boolean, scope: ValueEvidence["scope"], sourcePaths?: Record<string, string>): AuthorCandidate | undefined {
 const profile: Partial<AuthorProfile> = {};
 const evidence: AuthorCandidate["evidence"] = {};
 const sourcePath = (field: string, fallback: string): string => sourcePaths?.[field] ?? fallback;
 const put = <K extends keyof AuthorProfile>(field: K, value: AuthorProfile[K] | undefined, fieldPath: string) => {
  if (value === undefined || value === "") return;
  (profile[field] as AuthorProfile[K]) = value;
  evidence[field] = { source: "json-ld", sourcePath: fieldPath, scope, confidence: scope === "page" ? "medium" : "high" };
 };
 const name = personName(entity.name);
 if (name) put("name", name, sourcePath("name", `${path}.name`));
 put("givenName", stripHtml(entity.givenName), sourcePath("givenName", `${path}.givenName`));
 put("familyName", stripHtml(entity.familyName), sourcePath("familyName", `${path}.familyName`));
 const bio = stripHtml(entity.description);
 put("bio", bio && bio.length <= MAX_BIO ? bio : undefined, sourcePath("description", `${path}.description`));
 const role = stripHtml(entity.jobTitle);
 put("designation", role && role.length <= MAX_ROLE ? role : undefined, sourcePath("jobTitle", `${path}.jobTitle`));
 put("avatarUrl", imageUrl(entity.image, context.baseUrl), sourcePath("image", `${path}.image`));
 put("email", emailAddress(entity.email), sourcePath("email", `${path}.email`));
 const socialValues = Array.isArray(entity.sameAs) ? entity.sameAs.slice(0, 100) : [entity.sameAs];
 const socials: NonNullable<AuthorProfile["socials"]> = [];
 const socialEvidence: ValueEvidence[] = [];
 socialValues.forEach((value, index) => {
  const social = socialLink(value, context.baseUrl);
  if (!social) return;
  socials.push(social);
  const basePath = sourcePath("sameAs", `${path}.sameAs`);
  socialEvidence.push({ source: "json-ld", sourcePath: Array.isArray(entity.sameAs) ? `${basePath}[${index}]` : basePath, scope, confidence: "high" });
 });
 if (socials.length) put("socials", socials, sourcePath("sameAs", `${path}.sameAs`));
 if (Object.keys(profile).length === 0) return undefined;
 const explicitUrl = httpUrl(entity.url, context.baseUrl);
 if (explicitUrl) {
  const slug = new URL(explicitUrl).pathname.split("/").filter(Boolean).at(-1);
  if (slug) put("slug", slug, sourcePath("url", `${path}.url`));
 }
 return { profile, identity: httpUrl(entity["@id"], context.baseUrl) ?? explicitUrl, primary, evidence, ...(socialEvidence.length ? { socialEvidence } : {}) };
}

function articleCandidate(entity: Entity, path: string, context: PageContext): ArticleCandidate | undefined {
 const headline = stripHtml(entity.headline);
 const title = headline ?? stripHtml(entity.name);
 const titleField = headline ? "headline" : "name";
 const rawUrl = entity.url ?? entity.mainEntityOfPage;
 const url = typeof rawUrl === "string" ? httpUrl(rawUrl, context.baseUrl) : isRecord(rawUrl) ? httpUrl(rawUrl["@id"] ?? rawUrl.url, context.baseUrl) : undefined;
 if (!title || title.length > MAX_ARTICLE_TITLE || !url || isAuthorProfileUrl(url)) return undefined;
 const publishedAt = dateString(entity.datePublished);
 const article = { title, url, ...(publishedAt ? { publishedAt } : {}) };
 const urlField = entity.url ? "url" : isRecord(entity.mainEntityOfPage) ? `mainEntityOfPage.${entity.mainEntityOfPage["@id"] ? "@id" : "url"}` : "mainEntityOfPage";
 return {
  article,
  evidence: { source: "json-ld", sourcePath: path, scope: "article", confidence: "high" },
  fieldPaths: { title: `${path}.${titleField}`, url: `${path}.${urlField}`, ...(publishedAt ? { publishedAt: `${path}.datePublished` } : {}) },
 };
}

function addRelatedPublisher(value: unknown, path: string, result: ExtractedData, getLinked: (value: unknown, path: string) => IndexedEntity[]): void {
 for (const linked of getLinked(value, path)) {
  const types = schemaTypes(linked.value["@type"]);
  if (!types.has("Organization") && !types.has("NewsMediaOrganization")) continue;
  const name = stripHtml(linked.value.name);
  const sourcePath = linked.fieldPaths?.name ?? `${linked.path}.name`;
  if (name) result.fields.push({ field: "editorial.publisher", value: name, evidence: { source: "json-ld", sourcePath, scope: "publisher", confidence: "high" } });
 }
}

function addItemListArticles(value: unknown, path: string, context: PageContext, result: ExtractedData): void {
 if (!Array.isArray(value)) return;
 value.slice(0, 100).forEach((entry, index) => {
  if (!isRecord(entry)) return;
  const item = isRecord(entry.item) ? entry.item : entry;
  if (!isRecord(item)) return;
  const itemTypes = schemaTypes(item["@type"]);
  const typed = isArticleType(itemTypes);
  const untyped = itemTypes.size === 0;
  const headline = stripHtml(item.headline);
  const title = typed ? headline ?? stripHtml(item.name) : untyped ? headline : undefined;
  const rawUrl = item.url ?? item["@id"];
  const url = typeof rawUrl === "string" ? httpUrl(rawUrl, context.baseUrl) : undefined;
  if (!title || title.length > MAX_ARTICLE_TITLE || !url || isAuthorProfileUrl(url)) return;
  const basePath = isRecord(entry.item) ? `${path}[${index}].item` : `${path}[${index}]`;
  const publishedAt = dateString(item.datePublished);
  const article = { title, url, ...(publishedAt ? { publishedAt } : {}) };
  result.articles.push({
   article,
   evidence: { source: "json-ld", sourcePath: basePath, scope: "article", confidence: typed ? "high" : "medium" },
   fieldPaths: {
    title: `${basePath}.${headline ? "headline" : "name"}`,
    url: `${basePath}.${item.url ? "url" : "@id"}`,
    ...(publishedAt ? { publishedAt: `${basePath}.datePublished` } : {}),
   },
  });
 });
}
