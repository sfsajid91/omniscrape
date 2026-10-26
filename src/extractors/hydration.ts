import { parse } from "acorn";
import type { PageContext } from "../core/context";
import { type AuthorCandidate, type ExtractedData, emptyExtraction, type ValueEvidence } from "../core/evidence";
import type { ArticleItem, AuthorProfile } from "../types";
import {
  dateString,
  emailAddress,
  httpUrl,
  imageUrl,
  isAuthorProfileUrl,
  isRecord,
  personName,
  socialLink,
  stripHtml,
  text,
} from "../values";
import { parseFlightRecords, recoverFlightNewlineScript, type ScriptParseResult } from "./hydration/flight";
import { decodeNuxt3 } from "./hydration/nuxt";
import { correlateQuintypeCollectionEntities, publisherNamespace, quintypeRoot } from "./hydration/quintype";
import { type AstNode, assignmentName, evaluateStatic } from "./hydration/static-eval";

export type HydrationResult = ExtractedData;

const MAX_ITEMS = 100;
const MAX_ARTICLE_TITLE = 300;
const MAX_BIO = 2000;
const MAX_ROLE = 200;
// Only names that reliably denote an article list become articles. Generic
// `items`/`content` keys belong to menus and layout state on many sites.
const COLLECTION_KEYS = new Set(["articles", "stories", "posts", "recentArticles", "stream"]);
const ASSIGNMENT_MARKER =
  /__NUXT__|Fusion\.globalContent|INITIAL_STATE|PRELOADED_STATE|(?:window\s*\.\s*)?(?:qtLoadedData|qtData|qt)\s*=/;

type Source = { value: unknown; path: string; name: string; origins?: WeakMap<object, string> };

export function extractHydrationData(context: PageContext): HydrationResult {
  const result = emptyExtraction();
  const scriptParseResults = new Map<string, ScriptParseResult>();
  const recoveredFlightPrograms = new Map<string, AstNode>();
  const sources: Source[] = [];
  const add = (value: unknown, path: string, name: string, origins?: WeakMap<object, string>) => {
    if (value != null) sources.push({ value, path, name, origins });
  };
  const addQuintype = (value: unknown, path: string, sourceName: string) => {
    const root = quintypeRoot(value, path);
    add(root.value, root.path, sourceName);
    correlateQuintypeCollectionEntities(root.value, root.path, sourceName, context, result);
  };
  const parseScript = (script: { text: string; path: string; type?: string }): ScriptParseResult => {
    const previous = scriptParseResults.get(script.path);
    if (previous) return previous;
    let parsed: ScriptParseResult;
    try {
      parsed = {
        program: parse(script.text, {
          ecmaVersion: "latest",
          sourceType: script.type === "module" ? "module" : "script",
        }) as unknown as AstNode,
      };
    } catch (error) {
      parsed = { error };
    }
    scriptParseResults.set(script.path, parsed);
    return parsed;
  };

  for (const script of context.scripts) {
    try {
      if (script.id === "static-page") {
        addQuintype(JSON.parse(script.text) as unknown, script.path, "quintype");
      } else if (script.id === "__NEXT_DATA__") {
        const data = JSON.parse(script.text) as unknown;
        add(getPath(data, ["props", "pageProps"]) ?? data, `${script.path}#props.pageProps`, "next-pages");
      } else if (script.id === "__NUXT_DATA__") {
        const decoded = decodeNuxt3(script.text, context, script.path);
        if (decoded !== undefined) add(decoded, script.path, "nuxt3");
      } else if (script.id === "fenrir-client-data") {
        try {
          add(JSON.parse(script.text) as unknown, script.path, "fenrir");
        } catch {
          const parsed = parseScript(script);
          if ("error" in parsed) {
            context.issues.push({ sourcePath: script.path, message: "Malformed hydration script" });
            continue;
          }
          const declaration = (parsed.program.body as AstNode[]).find((statement) => {
            if (statement.type !== "VariableDeclaration") return false;
            return (statement.declarations as AstNode[]).some((item) => {
              const identifier = item.id as AstNode;
              return identifier.type === "Identifier" && identifier.name === "fenrirClientData";
            });
          });
          const declarator =
            declaration &&
            (declaration.declarations as AstNode[]).find((item) => {
              const identifier = item.id as AstNode;
              return identifier.type === "Identifier" && identifier.name === "fenrirClientData";
            });
          const initializer = declarator?.init as AstNode | undefined;
          if (!initializer) {
            context.issues.push({ sourcePath: script.path, message: "Malformed hydration script" });
            continue;
          }
          try {
            add(evaluateStatic(initializer, new Map()), `${script.path}@fenrirClientData`, "fenrir");
          } catch {
            context.issues.push({ sourcePath: script.path, message: "Unsupported static hydration initializer" });
          }
        }
      }
    } catch {
      context.issues.push({ sourcePath: script.path, message: "Malformed hydration JSON" });
    }
  }

  for (const script of context.scripts) {
    if (
      script.id === "static-page" ||
      script.id === "__NEXT_DATA__" ||
      script.id === "__NUXT_DATA__" ||
      script.id === "fenrir-client-data"
    )
      continue;
    if (script.type && !["text/javascript", "application/javascript", "module"].includes(script.type)) continue;
    const hasFlightMarker = script.text.includes("__next_f");
    const hasAssignmentMarker = ASSIGNMENT_MARKER.test(script.text);
    if (!hasFlightMarker && !hasAssignmentMarker) continue;
    const parsed = parseScript(script);
    if ("error" in parsed) {
      if (hasFlightMarker) {
        context.issues.push({ sourcePath: script.path, message: "Malformed Flight script" });
        const repaired = recoverFlightNewlineScript(script.text, parsed.error);
        if (repaired !== undefined) {
          try {
            recoveredFlightPrograms.set(
              script.path,
              parse(repaired, {
                ecmaVersion: "latest",
                sourceType: script.type === "module" ? "module" : "script",
              }) as unknown as AstNode,
            );
          } catch {
            /* full-script validation rejects any second syntax error */
          }
        }
      } else if (hasAssignmentMarker)
        context.issues.push({ sourcePath: script.path, message: "Malformed hydration script" });
      continue;
    }
    if (!hasAssignmentMarker) continue;
    for (const statement of parsed.program.body as AstNode[]) {
      const expression = statement.type === "ExpressionStatement" ? (statement.expression as AstNode) : undefined;
      if (!expression || expression.type !== "AssignmentExpression" || expression.operator !== "=") continue;
      const key = assignmentName(expression.left as AstNode);
      const sourceName =
        key === "__NUXT__"
          ? "nuxt2"
          : key === "Fusion.globalContent"
            ? "fusion"
            : key === "__INITIAL_STATE__" || key === "__PRELOADED_STATE__"
              ? "window-state"
              : ["qtLoadedData", "qtData", "qt", "window.qtLoadedData", "window.qtData", "window.qt"].includes(
                    key ?? "",
                  )
                ? "quintype-loaded"
                : undefined;
      if (!sourceName) continue;
      try {
        const value = evaluateStatic(expression.right as AstNode, new Map());
        if (sourceName === "quintype-loaded") addQuintype(value, `${script.path}@${key}`, sourceName);
        else add(value, `${script.path}@${key}`, sourceName);
      } catch {
        context.issues.push({ sourcePath: script.path, message: "Unsupported static hydration initializer" });
      }
    }
  }
  const flightScripts = context.scripts.filter(
    (script) =>
      script.text.includes("__next_f") &&
      (!script.type || ["text/javascript", "application/javascript", "module"].includes(script.type)),
  );
  for (const record of parseFlightRecords(flightScripts, context, scriptParseResults, recoveredFlightPrograms))
    add(record.value, record.path, "next-app", record.origins);

  for (const source of sources) collect(source.value, source.path, source.name, context, result, source.origins);
  if (context.includeRawHydration) {
    result.raw = safeRaw(
      sources.map((s) => ({ source: s.name, path: s.path, value: s.value })),
      context,
    );
  }
  const articlePaths = new Set<string>();
  result.articles = result.articles.filter(({ evidence }) => {
    if (articlePaths.has(evidence.sourcePath)) return false;
    articlePaths.add(evidence.sourcePath);
    return true;
  });
  return result;
}

function collect(
  root: unknown,
  rootPath: string,
  source: string,
  context: PageContext,
  out: ExtractedData,
  origins?: WeakMap<object, string>,
): void {
  type Walk = {
    value: unknown;
    path: string;
    parentKey?: string;
    depth: number;
    blocked: boolean;
    inStory: boolean;
    inCollection: boolean;
    nonPrimary: boolean;
  };
  const stack: Walk[] = [
    { value: root, path: rootPath, depth: 0, blocked: false, inStory: false, inCollection: false, nonPrimary: false },
  ];
  const seen = new WeakMap<object, Set<number>>();
  const seenEditorial = new Set<string>();
  const isQuintype = source.toLowerCase().includes("quintype");
  const blockedKeys = new Set(["user", "currentUser", "loggedInUser", "session", "viewer"]);
  const collectionKeys = new Set([
    "authorCollection",
    "blog",
    "linked-story",
    "linked-stories",
    "linkedStory",
    "linkedStories",
    "mostPopularArticles",
    "most-popular-articles",
  ]);
  const nonAuthorKeys = new Set(["owner", "assignee", "editor", "editorialOwner"]);
  const nonPrimaryKeys = new Set([
    "related",
    "recommendations",
    "mostPopularArticles",
    "most-popular-articles",
    "comments",
    "comment",
    "responses",
    "latestAuthors",
    "relatedAuthors",
    "mostRead",
    "popular",
    "trending",
    "menuGroups",
    "menu",
    "navigation",
    "nav",
  ]);
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    const { value, parentKey, depth, blocked, inStory, inCollection, nonPrimary } = current;
    const path = value && typeof value === "object" ? (origins?.get(value) ?? current.path) : current.path;
    if (++nodes > context.limits.maxDecodeNodes) {
      context.issues.push({ sourcePath: path, message: "Hydration traversal limit exceeded" });
      break;
    }
    if (depth > context.limits.maxDecodeDepth) {
      context.issues.push({ sourcePath: path, message: "Hydration depth limit exceeded" });
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const contextKey = (inStory ? 1 : 0) | (inCollection ? 2 : 0) | (blocked ? 4 : 0) | (nonPrimary ? 8 : 0);
    let contexts = seen.get(value);
    if (!contexts) {
      contexts = new Set();
      seen.set(value, contexts);
    }
    if (contexts.has(contextKey)) continue;
    contexts.add(contextKey);
    if (Array.isArray(value)) {
      const length = Math.min(value.length, Math.max(0, context.limits.maxDecodeNodes - nodes));
      if (length < value.length)
        context.issues.push({ sourcePath: path, message: "Hydration array traversal limit exceeded" });
      for (let i = length - 1; i >= 0; i--)
        stack.push({
          value: value[i],
          path: `${path}[${i}]`,
          parentKey,
          depth: depth + 1,
          blocked,
          inStory,
          inCollection,
          nonPrimary,
        });
      continue;
    }
    const obj = value as Record<string, unknown>;
    const typedPerson = hasPersonType(obj) || isAuthorProfileResource(obj);
    const explicitNonPerson = hasNonPersonType(obj);
    const authorKeys = ["author", "authors", "authorData", "profile", "contributor", "contributors", "person"];
    const explicitAuthorPath = authorKeys.includes(parentKey ?? "") || (parentKey === "mainEntity" && typedPerson);
    const personSpecific = hasPersonSpecificShape(obj) || (isAuthorProfileResource(obj) && !!text(obj.fullName));
    const pageProfileRoute = isAuthorProfileUrl(context.pageUrl);
    const profileResourceTarget =
      isAuthorProfileResource(obj) && pageProfileRoute && !hasExplicitDifferentUrl(obj, context);
    const currentRelation = inStory && authorKeys.includes(parentKey ?? "") && !blocked && !inCollection && !nonPrimary;
    const profileResourceDifferent =
      isAuthorProfileResource(obj) && pageProfileRoute && hasExplicitDifferentUrl(obj, context);
    const primary =
      !blocked &&
      !inCollection &&
      !nonPrimary &&
      !explicitNonPerson &&
      !profileResourceDifferent &&
      (currentRelation || (explicitAuthorPath && (!inStory || profileResourceTarget)));
    const candidateAllowed =
      !blocked &&
      !inCollection &&
      !explicitNonPerson &&
      (explicitAuthorPath || personSpecific || profileResourceTarget);
    const flatQuintype = isQuintype && parentKey === "story" && !inCollection && !nonPrimary && !blocked;
    if (flatQuintype) {
      const nameAliases = ["author-name", "author_name", "authorName"].filter((key) => personName(obj[key]));
      const idAliases = ["author-id", "author_id", "authorId"].filter(
        (key) =>
          (typeof obj[key] === "string" && !!text(obj[key])) ||
          (typeof obj[key] === "number" && Number.isFinite(obj[key])),
      );
      for (const nameKey of nameAliases) {
        for (const idKey of idAliases.length ? idAliases : [undefined]) {
          const projection: Record<string, unknown> = { name: obj[nameKey] };
          const sourcePaths: Partial<Record<"name" | "id", string>> = { name: `${path}.${nameKey}` };
          if (idKey) {
            projection.id = obj[idKey];
            sourcePaths.id = `${path}.${idKey}`;
          }
          const candidate = authorCandidate(projection, path, source, context, true, "byline", sourcePaths);
          if (candidate)
            pushAuthorCandidate(
              { ...candidate, authorshipGroups: [hydrationAuthorshipGroup(source, path)] },
              projection,
              path,
              source,
              context,
              out,
            );
        }
      }
    }
    const scope: "profile" | "byline" = !nonPrimary && (profileResourceTarget || !inStory) ? "profile" : "byline";
    if (
      candidateAllowed &&
      parentKey === "author" &&
      isRecord(obj.profile) &&
      !hasNonPersonType(obj.profile) &&
      text(obj.profile.name ?? obj.profile.display_name ?? obj.profile.displayName)
    ) {
      const outerId =
        typeof obj.authorId === "string" || (typeof obj.authorId === "number" && Number.isFinite(obj.authorId))
          ? obj.authorId
          : undefined;
      const combined = { ...obj.profile, id: outerId ?? obj.profile.id ?? obj.profile.legacy_id };
      const candidate = authorCandidate(combined, `${path}.profile`, source, context, primary, scope);
      if (candidate)
        pushAuthorCandidate(
          currentRelation
            ? { ...candidate, authorshipGroups: [hydrationAuthorshipGroup(source, path, parentKey)] }
            : candidate,
          combined,
          `${path}.profile`,
          source,
          context,
          out,
        );
    } else if (
      !(isQuintype && parentKey === "story") &&
      candidateAllowed &&
      text(
        obj.name ??
          obj.display_name ??
          obj.displayName ??
          obj.fullName ??
          obj["author-name"] ??
          obj.author_name ??
          obj.authorName,
      ) &&
      !blockedKeys.has(parentKey ?? "") &&
      !nonAuthorKeys.has(parentKey ?? "")
    ) {
      let candidateObj = obj;
      if (
        profileResourceTarget &&
        ![obj.url, obj.profileUrl].map((value) => httpUrl(value, context.baseUrl)).some(Boolean)
      )
        candidateObj = { ...obj, url: context.pageUrl };
      const candidate = authorCandidate(
        candidateObj,
        path,
        source,
        context,
        primary || (profileResourceTarget && !nonPrimary),
        scope,
      );
      if (candidate)
        pushAuthorCandidate(
          currentRelation
            ? { ...candidate, authorshipGroups: [hydrationAuthorshipGroup(source, path, parentKey)] }
            : candidate,
          candidateObj,
          path,
          source,
          context,
          out,
        );
    }
    collectEditorial(obj, path, source, out, seenEditorial);
    const isQuintypeCollection = isQuintype && obj.type === "collection";
    if (isQuintypeCollection) addArticles(obj, path, source, context, out);
    for (const [key, child] of Object.entries(obj)) {
      const childPath = `${path}.${key}`;
      if (
        collectionKeys.has(key) ||
        COLLECTION_KEYS.has(key) ||
        (key === "collection" && isQuintype) ||
        (key === "content" && (parentKey === "author" || parentKey === "authorData" || parentKey === "profile"))
      ) {
        addArticles(child, childPath, source, context, out);
      }
      if (
        child &&
        typeof child === "object" &&
        !(key === "profile" && parentKey === "author" && obj.authorId !== undefined)
      ) {
        const cardCollection = ["cards", "feed", "teasers"].includes(key) && isStoryCardArray(child, context.baseUrl);
        const childCollection =
          inCollection ||
          isQuintypeCollection ||
          collectionKeys.has(key) ||
          COLLECTION_KEYS.has(key) ||
          (key === "collection" && isQuintype) ||
          cardCollection ||
          (key === "content" && isListingContainer(obj));
        const childStory = inStory || ["story", "article", "current"].includes(key);
        stack.push({
          value: child,
          path: childPath,
          parentKey: key,
          depth: depth + 1,
          blocked: blocked || blockedKeys.has(key),
          inStory: childStory,
          inCollection: childCollection,
          nonPrimary: nonPrimary || nonPrimaryKeys.has(key),
        });
      }
    }
  }
}

function isListingContainer(value: Record<string, unknown>): boolean {
  return value.type === "lineup" && Array.isArray(value.content);
}

function isStoryCardArray(value: unknown, baseUrl: string): boolean {
  if (!Array.isArray(value)) return false;
  return value.some(
    (item) =>
      isRecord(item) &&
      (item.itemType === "story" ||
        (!!text(item.title ?? item.headline) && ["url", "slug", "path"].some((key) => httpUrl(item[key], baseUrl)))),
  );
}

function isAuthorProfileResource(value: Record<string, unknown>): boolean {
  return (
    value.__typename === "AuthorProfileResourceType" ||
    value.__isResolvedResourceInterface === "AuthorProfileResourceType"
  );
}

function hasExplicitDifferentUrl(value: Record<string, unknown>, context: PageContext): boolean {
  const explicit = [value.url, value.profileUrl].map((item) => httpUrl(item, context.baseUrl)).find(Boolean);
  if (!explicit) return false;
  try {
    return new URL(explicit).href !== new URL(context.pageUrl).href;
  } catch {
    return true;
  }
}

function hydrationAuthorshipGroup(source: string, path: string, parentKey?: string): string {
  const groupPath = parentKey === "author" || parentKey === "authors" ? path.replace(/\[\d+\]$/, "") : path;
  return `hydration:${source}:${groupPath}`;
}

function pushAuthorCandidate(
  candidate: AuthorCandidate,
  obj: Record<string, unknown>,
  path: string,
  source: string,
  context: PageContext,
  out: ExtractedData,
): void {
  const directEmail = emailAddress(obj.email);
  const socialEmail = isRecord(obj.socialLinks) ? emailAddress(obj.socialLinks.email) : undefined;
  const bio = profileBio(obj);
  const bioEmail = bio && emailAddress(bio);
  const emails = [
    ...(directEmail ? [{ value: directEmail, path: `${path}.email` }] : []),
    ...(socialEmail ? [{ value: socialEmail, path: `${path}.socialLinks.email` }] : []),
    ...(bioEmail && candidate.profile.name && candidate.evidence.bio?.scope === "profile"
      ? [{ value: bioEmail, path: bioPath(obj, path) }]
      : []),
  ];
  const unique = [...new Map(emails.map((item) => [item.value, item])).values()];
  if (unique.length > 1) {
    if (candidate.identity) {
      for (const email of unique)
        out.authors.push({
          ...candidate,
          profile: { ...candidate.profile, email: email.value },
          evidence: {
            ...candidate.evidence,
            email: { source: `hydration:${source}`, sourcePath: email.path, scope: "profile", confidence: "medium" },
          },
        });
    } else {
      for (const email of unique)
        context.issues.push({ sourcePath: email.path, message: "Conflicting values for author.email; left missing" });
      out.authors.push({
        ...candidate,
        profile: { ...candidate.profile, email: undefined },
        evidence: { ...candidate.evidence, email: undefined },
      });
    }
    return;
  }
  const email = unique[0];
  if (email && candidate.profile.email !== email.value) {
    out.authors.push({
      ...candidate,
      profile: { ...candidate.profile, email: email.value },
      evidence: {
        ...candidate.evidence,
        email: { source: `hydration:${source}`, sourcePath: email.path, scope: "profile", confidence: "medium" },
      },
    });
  } else out.authors.push(candidate);
}

function profileBio(obj: Record<string, unknown>): string | undefined {
  for (const key of ["bio", "description", "shortBio", "longBio"]) {
    if (obj[key] === undefined) continue;
    const value = obj[key];
    if (Array.isArray(value)) {
      const pieces = value
        .slice(0, MAX_ITEMS)
        .map((item) => (isRecord(item) ? (item.plaintext ?? item.html) : item))
        .map((item) => stripHtml(item))
        .filter((item): item is string => !!item);
      if (pieces.length) return pieces.join(" ");
    } else if (isRecord(value)) {
      const plain = stripHtml(value.plaintext ?? value.html);
      if (plain) return plain;
    } else {
      const plain = stripHtml(value);
      if (plain) return plain;
    }
  }
  return undefined;
}
function bioPath(obj: Record<string, unknown>, path: string): string {
  return `${path}.${["bio", "description", "shortBio", "longBio"].find((key) => obj[key] !== undefined) ?? "bio"}`;
}

function hasPersonType(value: Record<string, unknown>): boolean {
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  return types.some((type) => typeof type === "string" && type.toLowerCase().split(/[/#]/).pop() === "person");
}

function hasNonPersonType(value: Record<string, unknown>): boolean {
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  const normalized = types
    .filter((type): type is string => typeof type === "string" && !!type.trim())
    .map((type) => type.toLowerCase().split(/[/#]/).pop() ?? "");
  // A hybrid type such as ["Person", "Employee"] still describes a person.
  return normalized.length > 0 && !normalized.includes("person");
}

function hasPersonSpecificShape(value: Record<string, unknown>): boolean {
  const hasNameParts = !!(text(value.givenName) || text(value.familyName));
  const hasAuthorId = ["authorId", "author_id", "naturalId", "legacy_id", "muckrackId"].some(
    (key) =>
      (typeof value[key] === "string" && !!text(value[key])) ||
      (typeof value[key] === "number" && Number.isFinite(value[key])),
  );
  const hasSocial =
    (Array.isArray(value.socials) && value.socials.length > 0) ||
    !!(value.linkedin || value.linkedIn || value.twitter || value.instagram || value.socialUrl);
  const hasRoleAndBio =
    !!(text(value.designation) || text(value.job_title) || text(value.jobTitle)) &&
    !!(text(value.bio) || text(value.description));
  const hasProfileUrl = !!(text(value.profileUrl) || text(value.profile_url));
  const hasEmailWithPersonSignal = !!text(value.email) && (hasNameParts || hasSocial || hasProfileUrl);
  return hasNameParts || hasAuthorId || hasSocial || hasRoleAndBio || hasProfileUrl || hasEmailWithPersonSignal;
}

function authorCandidate(
  obj: Record<string, unknown>,
  path: string,
  source: string,
  context: PageContext,
  primary: boolean,
  scope: "profile" | "byline",
  sourcePaths?: Partial<Record<"name" | "id", string>>,
): AuthorCandidate | undefined {
  const profile: Partial<AuthorProfile> = {};
  const evidence: AuthorCandidate["evidence"] = {};
  const confidence = primary ? "high" : "medium";
  const put = <K extends keyof AuthorProfile>(key: K, val: AuthorProfile[K] | undefined, property: string) => {
    if (val === undefined || val === "") return;
    (profile as Record<string, unknown>)[key] = val;
    evidence[key] = {
      source: `hydration:${source}`,
      sourcePath: sourcePaths?.[key as "name" | "id"] ?? `${path}.${property}`,
      scope,
      confidence,
    };
  };
  const nameKey = ["name", "display_name", "displayName", "fullName", "author-name", "author_name", "authorName"].find(
    (key) => personName(obj[key]),
  );
  put("name", nameKey ? personName(obj[nameKey]) : undefined, nameKey ?? "name");
  const idKey = ["id", "_id", "authorId", "naturalId", "legacy_id", "author-id", "author_id"].find(
    (key) =>
      (typeof obj[key] === "string" && !!text(obj[key])) || (typeof obj[key] === "number" && Number.isFinite(obj[key])),
  );
  const id = idKey ? obj[idKey] : undefined;
  if (typeof id === "string" || (typeof id === "number" && Number.isFinite(id))) put("id", id, idKey ?? "id");
  put("slug", text(obj.slug), "slug");
  const designationKey = ["designation", "role", "job_title", "jobTitle", "title"].find((key) => text(obj[key]));
  const designation = designationKey ? text(obj[designationKey]) : text(getPath(obj, ["metadata", "designation"]));
  put(
    "designation",
    designation && designation.length <= MAX_ROLE ? designation : undefined,
    designationKey ?? "metadata.designation",
  );
  const bio = profileBio(obj);
  put("bio", bio && bio.length <= MAX_BIO ? bio : undefined, bioPath(obj, path).slice(path.length + 1));
  const imageKeys = ["avatarUrl", "avatar", "image", "imageUrl", "photo", "avatar-url"];
  const imageKey =
    imageKeys.find((key) => imageUrl(obj[key], context.baseUrl)) ??
    (imageUrl(getPath(obj, ["profileImage", "thumbnails", "square", "url"]), context.baseUrl)
      ? "profileImage.thumbnails.square.url"
      : undefined);
  const imageValue = imageKey?.includes(".") ? getPath(obj, imageKey.split(".")) : imageKey ? obj[imageKey] : undefined;
  put("avatarUrl", imageUrl(imageValue, context.baseUrl), imageKey ?? "avatarUrl");
  const directEmail = emailAddress(obj.email);
  put(
    "email",
    directEmail ?? (isRecord(obj.socialLinks) ? emailAddress(obj.socialLinks.email) : undefined),
    directEmail ? "email" : "socialLinks.email",
  );
  const socials: NonNullable<AuthorProfile["socials"]> = [];
  const socialEvidence: NonNullable<AuthorCandidate["socialEvidence"]> = [];
  const candidates: Array<{ value: unknown; path: string }> = [];
  if (Array.isArray(obj.socials))
    obj.socials.forEach((value, index) => candidates.push({ value, path: `${path}.socials[${index}]` }));
  if (Array.isArray(obj.sameAs))
    obj.sameAs.forEach((value, index) => candidates.push({ value, path: `${path}.sameAs[${index}]` }));
  else if (obj.sameAs !== undefined) candidates.push({ value: obj.sameAs, path: `${path}.sameAs` });
  for (const key of [
    "linkedIn",
    "linkedin",
    "twitter",
    "x",
    "instagram",
    "facebook",
    "youtube",
    "github",
    "threads",
    "bluesky",
    "muckrack",
  ]) {
    if (obj[key] !== undefined) candidates.push({ value: obj[key], path: `${path}.${key}` });
  }
  if (isRecord(obj.socialLinks))
    for (const [key, value] of Object.entries(obj.socialLinks)) {
      if (key !== "email") candidates.push({ value, path: `${path}.socialLinks.${key}` });
    }
  const seenSocials = new Set<string>();
  for (const candidate of candidates) {
    const url = socialLink(
      isRecord(candidate.value) ? (candidate.value.url ?? candidate.value.href) : candidate.value,
      context.baseUrl,
    );
    if (url && !seenSocials.has(url.url)) {
      seenSocials.add(url.url);
      socials.push(url);
      socialEvidence.push({ source: `hydration:${source}`, sourcePath: candidate.path, scope, confidence: "medium" });
    }
  }
  if (socials.length) put("socials", socials, "socials");
  if (!profile.name) return undefined;
  const explicitUrl = [obj.profileUrl, obj.url].map((value) => httpUrl(value, context.baseUrl)).find(Boolean);
  if (!profile.slug && explicitUrl) {
    const slug = new URL(explicitUrl).pathname.split("/").filter(Boolean).at(-1);
    if (slug) put("slug", slug, "profileUrl");
  }
  const identity =
    explicitUrl ?? (id !== undefined ? `${source}@${publisherNamespace(context)}:${String(id)}` : undefined);
  return { profile, identity, primary, evidence, socialEvidence };
}

function addArticles(value: unknown, path: string, source: string, context: PageContext, out: ExtractedData): void {
  const listKey = isRecord(value)
    ? ["items", "content", "nodes", "edges", "stories", "articles"].find((key) => Array.isArray(value[key]))
    : undefined;
  const listPath = listKey ? `${path}.${listKey}` : path;
  const entries: unknown[] = Array.isArray(value)
    ? value
    : listKey && isRecord(value)
      ? (value[listKey] as unknown[])
      : [];
  const hearstContent = source === "next-pages" && listPath.endsWith(".author.content");
  const slugBase =
    source.startsWith("quintype") || hearstContent ? new URL("/", context.pageUrl).href : context.baseUrl;
  for (let i = 0; i < Math.min(entries.length, MAX_ITEMS); i++) {
    const entry = entries[i];
    if (!isRecord(entry)) continue;
    const edgeNode = listKey === "edges" && isRecord(entry.node) ? entry.node : undefined;
    const container = edgeNode ?? entry;
    const item = isRecord(container.story) ? container.story : container;
    const itemPath = edgeNode
      ? `${listPath}[${i}].node${isRecord(container.story) ? ".story" : ""}`
      : isRecord(container.story)
        ? `${listPath}[${i}].story`
        : `${listPath}[${i}]`;
    const title = text(item.title ?? item.headline);
    const urlKey = ["url", "link", "canonicalUrl", "canonical_url", "permalink"].find((key) =>
      httpUrl(item[key], context.baseUrl),
    );
    const routeKey =
      urlKey ?? (httpUrl(item.slug, slugBase) ? "slug" : httpUrl(item.path, context.baseUrl) ? "path" : undefined);
    let url = routeKey ? httpUrl(item[routeKey], routeKey === "slug" ? slugBase : context.baseUrl) : undefined;
    const section = isRecord(item.section) ? text(item.section.slug) : undefined;
    const slug = text(item.slug);
    if (hearstContent && routeKey === "slug" && section && slug && !/[/:]/.test(slug)) {
      url = httpUrl(`${section.replace(/^\/+|\/+$/g, "")}/${slug}/`, slugBase);
    }
    if (!title || title.length > MAX_ARTICLE_TITLE || !url) continue;
    const dateKey = ["publishedAt", "published_at", "date", "publishDate", "publish_from", "first-published-at"].find(
      (key) => dateString(item[key]),
    );
    const date = dateKey ? dateString(item[dateKey]) : undefined;
    const article: ArticleItem = { title: stripHtml(title) ?? title, url, ...(date ? { publishedAt: date } : {}) };
    const evidence: ValueEvidence = {
      source: `hydration:${source}`,
      sourcePath: itemPath,
      scope: "article",
      confidence: "medium",
    };
    const titleKey = text(item.title) ? "title" : "headline";
    out.articles.push({
      article,
      evidence,
      fieldPaths: {
        title: `${itemPath}.${titleKey}`,
        url: `${itemPath}.${routeKey}`,
        ...(date && dateKey ? { publishedAt: `${itemPath}.${dateKey}` } : {}),
      },
    });
  }
}
function collectEditorial(
  obj: Record<string, unknown>,
  path: string,
  source: string,
  out: ExtractedData,
  seenEditorial: Set<string>,
): void {
  for (const [key, field] of [
    ["owner-name", "editorial.ownerName"],
    ["ownerName", "editorial.ownerName"],
    ["owner-id", "editorial.ownerId"],
    ["ownerId", "editorial.ownerId"],
    ["assignee-name", "editorial.assigneeName"],
    ["assigneeName", "editorial.assigneeName"],
    ["assignee-id", "editorial.assigneeId"],
    ["assigneeId", "editorial.assigneeId"],
    ["publisher", "editorial.publisher"],
    ["publisher-name", "editorial.publisher"],
  ] as const) {
    const value = /(?:-id|Id)$/.test(key)
      ? typeof obj[key] === "number" && Number.isFinite(obj[key])
        ? obj[key]
        : text(obj[key])
      : text(obj[key]);
    if (value !== undefined && value !== "") {
      const tupleKey = `${field}:${value}`;
      if (seenEditorial.has(tupleKey)) continue;
      seenEditorial.add(tupleKey);
      addField(out, field, value, source, `${path}.${key}`, "publisher");
    }
  }
}
function addField(
  out: ExtractedData,
  field: string,
  value: string | number,
  source: string,
  sourcePath: string,
  scope: ValueEvidence["scope"],
): void {
  out.fields.push({
    field,
    value,
    evidence: { source: `hydration:${source}`, sourcePath, scope, confidence: "medium" },
  });
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function safeRaw(value: unknown, context: PageContext): unknown {
  const seen = new WeakSet<object>();
  let count = 0;
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, item) => {
        if (typeof item === "bigint") return `${item.toString()}n`;
        if (item && typeof item === "object") {
          if (seen.has(item)) return "[Circular]";
          seen.add(item);
          if (++count > context.limits.maxDecodeNodes) return "[Truncated]";
        }
        return item;
      }),
    );
  } catch {
    return undefined;
  }
}
