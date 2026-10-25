import type { PageContext } from "./context";
import type { DomMetaResult } from "../extractors/dom-meta";
import type { AuthorCandidate, ExtractedData, ValueEvidence } from "./evidence";
import type { HydrationResult } from "../extractors/hydration";
import type { JsonLdResult } from "../extractors/json-ld";
import {
  type ArticleItem, type AuthorProfile, type EditorialInfo, type PageMetadata,
  type ParserOutput, ParserOutputSchema, type ProvenanceItem, type ReviewAuthor, type TechStack,
} from "../types";

export interface ResolverInput {
  context: PageContext;
  techStack: TechStack;
  hydration: HydrationResult;
  jsonLd: JsonLdResult;
  domMeta: DomMetaResult;
  includeRawHydration?: boolean;
}

const AUTHOR_FIELDS = ["name", "givenName", "familyName", "id", "slug", "designation", "bio", "avatarUrl", "email"] as const;

function provenanceItem(context: PageContext, field: string, value: string | number, evidence: ValueEvidence, entity?: string): ProvenanceItem {
  return { field, value: String(value), ...evidence, sourceUrl: context.pageUrl, ...(entity ? { entity } : {}) };
}

function candidateProvenance(context: PageContext, candidate: AuthorCandidate, fieldPrefix = "author"): ProvenanceItem[] {
  const items: ProvenanceItem[] = [];
  for (const field of AUTHOR_FIELDS) {
    const value = candidate.profile[field];
    const evidence = candidate.evidence[field];
    if (value !== undefined && evidence) items.push(provenanceItem(context, `${fieldPrefix}.${field}`, value, evidence, candidate.identity));
  }
  for (const [index, social] of (candidate.profile.socials ?? []).entries()) {
    const evidence = candidate.socialEvidence?.[index] ?? candidate.evidence.socials;
    if (evidence) items.push(provenanceItem(context, `${fieldPrefix}.socials`, social.url, evidence, candidate.identity));
  }
  return items;
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && normalizeName(a) === normalizeName(b);
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizedIdentity(value: string | undefined): string | undefined {
  return value?.replace(/\/+$/, "").toLowerCase() || undefined;
}

function slugOf(candidate: AuthorCandidate): string | undefined {
  const slug = candidate.profile.slug;
  return typeof slug === "string" && slug.trim() ? slug.trim().toLowerCase() : undefined;
}

function sameIdentity(a: AuthorCandidate, b: AuthorCandidate): boolean {
  if (a === b) return true;
  const left = normalizedIdentity(a.identity);
  const right = normalizedIdentity(b.identity);
  if (left && right && left === right) return true;
  // Bridge a CMS ID to a profile URL only within its publisher namespace.
  // Slugs must never override distinct URLs or distinct CMS IDs.
  const leftSlug = slugOf(a);
  const rightSlug = slugOf(b);
  if (!left || !right || !leftSlug || leftSlug !== rightSlug) return false;
  const leftIsUrl = /^https?:\/\//i.test(left);
  const rightIsUrl = /^https?:\/\//i.test(right);
  if (leftIsUrl === rightIsUrl) return false;
  const cms = leftIsUrl ? b : a;
  const source = cms.evidence.id?.source;
  if (cms.profile.id === undefined || !source?.startsWith("hydration:")) return false;
  try {
    const profileUrl = new URL(leftIsUrl ? left : right);
    return cms.identity === `${source.slice("hydration:".length)}@${profileUrl.host.toLowerCase()}:${String(cms.profile.id)}`;
  } catch {
    return false;
  }
}

function rank(candidate: AuthorCandidate): number {
  const evidence = candidate.evidence.name;
  if (!candidate.primary) return 10;
  if (evidence?.scope === "profile") return 0;
  if (evidence?.scope === "byline") return 1;
  return 2;
}

interface ReviewCandidate {
  candidate: AuthorCandidate;
  reason: ReviewAuthor["reason"];
}

function reviewIdentityMatches(left: AuthorCandidate, right: AuthorCandidate): boolean {
  if (left.identity || right.identity) return sameIdentity(left, right);
  return sameName(left.profile.name, right.profile.name);
}

function reviewValuesCompatible(left: AuthorCandidate, right: AuthorCandidate): boolean {
  return AUTHOR_FIELDS.every((field) => {
    if (left.profile[field] === undefined || right.profile[field] === undefined) return true;
    if (!left.evidence[field] || !right.evidence[field]) return true;
    if (field === "name") return sameName(String(left.profile[field]), String(right.profile[field]));
    return left.profile[field] === right.profile[field];
  });
}

function consolidateReview(context: PageContext, candidates: ReviewCandidate[]): ReviewAuthor[] {
  const groups: Array<{ reason: ReviewAuthor["reason"]; candidates: AuthorCandidate[]; profile: AuthorProfile; provenance: ProvenanceItem[] }> = [];
  for (const { candidate, reason } of candidates) {
    const group = groups.find((item) => item.reason === reason
      && item.candidates.every((previous) => reviewIdentityMatches(previous, candidate)
        && sameName(previous.profile.name, candidate.profile.name)
        && reviewValuesCompatible(previous, candidate)));
    const evidence = candidateProvenance(context, candidate);
    if (group) {
      group.candidates.push(candidate);
      for (const field of AUTHOR_FIELDS) {
        if (group.profile[field] === undefined && candidate.profile[field] !== undefined && candidate.evidence[field]) {
          if (field === "id") group.profile.id = candidate.profile.id;
          else group.profile[field] = String(candidate.profile[field]);
        }
      }
      const socialKeys = new Set((group.profile.socials ?? []).map((social) => `${social.platform}\\0${social.url}\\0${social.handle ?? ""}\\0${social.isPersonal}`));
      for (const social of candidate.profile.socials ?? []) {
        const key = `${social.platform}\\0${social.url}\\0${social.handle ?? ""}\\0${social.isPersonal}`;
        if (!socialKeys.has(key)) { socialKeys.add(key); group.profile.socials!.push(social); }
      }
      group.provenance = dedupeProvenance([...group.provenance, ...evidence]);
    } else {
      groups.push({
        reason,
        candidates: [candidate],
        profile: { ...candidate.profile, name: candidate.profile.name ?? "Unknown Author", socials: [...(candidate.profile.socials ?? [])] },
        provenance: evidence,
      });
    }
  }
  return groups.map(({ reason, profile, provenance }) => ({ reason, author: profile, provenance }));
}

function resolveAuthor(context: PageContext, candidates: AuthorCandidate[], provenance: ProvenanceItem[], review: ReviewAuthor[], fieldPrefix = "author"): AuthorProfile {
  const named = candidates.filter((candidate) => !!candidate.profile.name && !!candidate.evidence.name);
  const primary = named.filter((candidate) => candidate.primary).sort((a, b) => rank(a) - rank(b) || Number(!!b.identity) - Number(!!a.identity));
  const anchor = primary[0];
  const strongest = anchor ? primary.filter((candidate) => rank(candidate) === rank(anchor)) : [];
  const ambiguous = !!anchor && strongest.some((candidate) =>
    !sameName(anchor.profile.name, candidate.profile.name) ||
    (!sameIdentity(anchor, candidate) && !!anchor.identity && !!candidate.identity)
  );
  const reviewCandidates: ReviewCandidate[] = [];
  const addReview = (candidate: AuthorCandidate, reason: ReviewAuthor["reason"]) => {
    reviewCandidates.push({ candidate, reason });
  };
  const flushReview = () => review.push(...consolidateReview(context, reviewCandidates));
  if (!anchor || ambiguous) {
    for (const candidate of named) addReview(candidate, ambiguous ? "ambiguous_identity" : "different_identity");
    flushReview();
    return { name: "Unknown Author", socials: [] };
  }

  const matching: AuthorCandidate[] = [];
  for (const candidate of candidates) {
    if (sameIdentity(anchor, candidate) && (!candidate.profile.name || sameName(anchor.profile.name, candidate.profile.name))) {
      matching.push(candidate);
    } else if (!candidate.identity && sameName(anchor.profile.name, candidate.profile.name)) {
      const hasNonNameAttributes = AUTHOR_FIELDS.some((field) => field !== "name" && candidate.profile[field] !== undefined)
        || (candidate.profile.socials?.length ?? 0) > 0;
      if (!hasNonNameAttributes && candidate.evidence.name) {
        provenance.push(provenanceItem(context, `${fieldPrefix}.name`, candidate.profile.name!, candidate.evidence.name));
      }
    } else {
      addReview(candidate, "different_identity");
    }
  }
  const author: AuthorProfile = { name: anchor.profile.name!, socials: [] };
  const values = new Map<string, string | number>();
  const conflicting = new Set<string>();
  for (const candidate of matching) {
    for (const field of AUTHOR_FIELDS) {
      const value = candidate.profile[field];
      if (value === undefined || !candidate.evidence[field]) continue;
      const previous = values.get(field);
      if (previous !== undefined && previous !== value && !(field === "name" && sameName(String(previous), String(value)))) conflicting.add(field);
      else if (previous === undefined) values.set(field, value);
    }
  }
  for (const field of AUTHOR_FIELDS) {
    const value = values.get(field);
    if (value === undefined || conflicting.has(field)) continue;
    if (field === "id") author.id = value;
    else author[field] = String(value);
  }
  if (conflicting.has("name")) author.name = "Unknown Author";
  const seenSocials = new Set<string>();
  for (const candidate of matching) {
    if (conflicting.size && AUTHOR_FIELDS.some((field) => conflicting.has(field) && candidate.profile[field] !== undefined)) {
      addReview({ ...candidate, profile: { ...candidate.profile, name: candidate.profile.name ?? anchor.profile.name } }, "conflicting_value");
    }
    for (const item of candidateProvenance(context, candidate, fieldPrefix)) {
      const field = item.field.slice(fieldPrefix.length + 1);
      if (field !== "socials" && !conflicting.has(field)) provenance.push(item);
    }
    for (const [index, social] of (candidate.profile.socials ?? []).entries()) {
      if (!social.isPersonal) continue;
      const evidence = candidate.socialEvidence?.[index] ?? candidate.evidence.socials;
      if (!evidence) continue;
      const key = `${social.platform}:${social.url.replace(/\/$/, "")}`;
      if (!seenSocials.has(key)) { seenSocials.add(key); author.socials.push(social); }
      provenance.push(provenanceItem(context, `${fieldPrefix}.socials`, social.url, evidence, candidate.identity));
    }
  }
  flushReview();
  return author;
}

function membershipIdentity(candidate: AuthorCandidate): string | undefined {
  return normalizedIdentity(candidate.identity);
}

function uniqueAuthorshipMembers(candidates: AuthorCandidate[]): AuthorCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const identity = membershipIdentity(candidate);
    if (!identity) return true;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function membershipsAgree(left: AuthorCandidate[], right: AuthorCandidate[]): boolean {
  const identitySet = (members: AuthorCandidate[]) => members.map(membershipIdentity).filter((value): value is string => !!value).sort();
  const nameCounts = (members: AuthorCandidate[]) => {
    const counts = new Map<string, number>();
    for (const member of members) {
      if (member.identity) continue;
      const name = normalizeName(member.profile.name ?? "");
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  };
  return JSON.stringify(identitySet(left)) === JSON.stringify(identitySet(right))
    && JSON.stringify(nameCounts(left)) === JSON.stringify(nameCounts(right));
}

function containsStrongest(members: AuthorCandidate[], strongest: AuthorCandidate[]): boolean {
  const remaining = [...members];
  for (const candidate of strongest) {
    const index = remaining.findIndex((member) => {
      if (candidate.identity || member.identity) return !!candidate.identity && !!member.identity && normalizedIdentity(candidate.identity) === normalizedIdentity(member.identity);
      return sameName(candidate.profile.name, member.profile.name);
    });
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return true;
}

function resolveAuthors(context: PageContext, candidates: AuthorCandidate[], author: AuthorProfile, provenance: ProvenanceItem[]): AuthorProfile[] {
  if (author.name !== "Unknown Author") {
    const authorProvenance: ProvenanceItem[] = [];
    resolveAuthor(context, candidates, authorProvenance, [], "authors[0]");
    provenance.push(...authorProvenance);
    return [author];
  }
  const primary = candidates.filter((candidate) => candidate.primary && !!candidate.profile.name && !!candidate.evidence.name)
    .sort((a, b) => rank(a) - rank(b) || Number(!!b.identity) - Number(!!a.identity));
  const anchor = primary[0];
  if (!anchor) return [];
  const strongest = primary.filter((candidate) => rank(candidate) === rank(anchor));
  if (strongest.length < 2 || strongest.some((candidate) => !candidate.authorshipGroups?.length)) return [];
  const groupKeys: string[] = [];
  for (const candidate of strongest) {
    for (const group of candidate.authorshipGroups ?? []) if (!groupKeys.includes(group)) groupKeys.push(group);
  }
  const groups = groupKeys.map((key) => uniqueAuthorshipMembers(candidates.filter((candidate) =>
    candidate.primary && candidate.profile.name && candidate.evidence.name && candidate.authorshipGroups?.includes(key))));
  if (groups.some((members) => members.length < 2 || !containsStrongest(members, uniqueAuthorshipMembers(strongest)))) return [];
  const first = groups[0];
  if (!first || groups.some((members) => !membershipsAgree(first, members))) return [];
  const authors: AuthorProfile[] = [];
  for (const [index, member] of first.entries()) {
    const matching = member.identity
      ? candidates.filter((candidate) => !!candidate.identity && sameIdentity(member, candidate)
        && (!candidate.profile.name || sameName(member.profile.name, candidate.profile.name)))
      : [member];
    const authorProvenance: ProvenanceItem[] = [];
    const resolved = resolveAuthor(context, matching, authorProvenance, [], `authors[${index}]`);
    if (resolved.name === "Unknown Author") return [];
    authors.push(resolved);
    provenance.push(...authorProvenance);
  }
  return authors;
}

function resolveArticles(context: PageContext, sources: ExtractedData[], provenance: ProvenanceItem[]): ArticleItem[] {
  const articles: ArticleItem[] = [];
  const byUrl = new Map<string, number>();
  for (const source of sources) {
    for (const candidate of source.articles) {
      const { article, evidence, fieldPaths } = candidate;
      let index = byUrl.get(article.url);
      if (index === undefined) {
        index = articles.length;
        byUrl.set(article.url, index);
        articles.push({ ...article });
      }
      const accepted = articles[index]!;
      if (!accepted.publishedAt && article.publishedAt) accepted.publishedAt = article.publishedAt;
      for (const field of ["title", "url", "publishedAt"] as const) {
        const value = article[field];
        if (value === undefined || value !== accepted[field]) continue;
        provenance.push(provenanceItem(context, `articles[${index}].${field}`, value, {
          ...evidence, sourcePath: fieldPaths?.[field] ?? `${evidence.sourcePath}.${field}`,
        }));
      }
    }
  }
  return articles;
}

function resolveFields(context: PageContext, sources: ExtractedData[], provenance: ProvenanceItem[]): { editorial: EditorialInfo; metadata: PageMetadata } {
  const editorial: EditorialInfo = {};
  const metadata: PageMetadata = {};
  const allFields = sources.flatMap((source) => source.fields);
  const precisePublicationTime = allFields.some((item) => item.field === "metadata.publishedTime" && item.evidence.confidence !== "low");
  const fields = precisePublicationTime
    ? allFields.filter((item) => item.field !== "metadata.publishedTime" || item.evidence.confidence !== "low")
    : allFields;
  const conflicts = new Set<string>();
  const values = new Map<string, string | number>();
  for (const { field, value } of fields) {
    if (values.has(field) && values.get(field) !== value) conflicts.add(field);
    else values.set(field, value);
  }
  for (const field of conflicts) context.issues.push({ sourcePath: field, message: `Conflicting values for ${field}; left missing` });
  for (const { field, value, evidence } of fields) {
    if (conflicts.has(field)) continue;
    switch (field) {
      case "editorial.ownerName": editorial.ownerName = String(value); break;
      case "editorial.ownerId": editorial.ownerId = value; break;
      case "editorial.assigneeName": editorial.assigneeName = String(value); break;
      case "editorial.assigneeId": editorial.assigneeId = value; break;
      case "editorial.publisher": editorial.publisher = String(value); break;
      case "metadata.title": metadata.title = String(value); break;
      case "metadata.description": metadata.description = String(value); break;
      case "metadata.canonicalUrl": metadata.canonicalUrl = String(value); break;
      case "metadata.ogImage": metadata.ogImage = String(value); break;
      case "metadata.language": metadata.language = String(value); break;
      case "metadata.publishedTime": metadata.publishedTime = String(value); break;
      case "metadata.modifiedTime": metadata.modifiedTime = String(value); break;
      default: continue;
    }
    provenance.push(provenanceItem(context, field, value, evidence));
  }
  return { editorial, metadata };
}

function dedupeProvenance(items: ProvenanceItem[]): ProvenanceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.field, item.value, item.source, item.sourceUrl, item.sourcePath, item.scope, item.confidence, item.entity ?? ""].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveParserOutput(input: ResolverInput): ParserOutput {
  const { context } = input;
  const sources = [input.hydration, input.jsonLd, input.domMeta];
  const collected: ProvenanceItem[] = [];
  const review: ReviewAuthor[] = [];
  const authorCandidates = sources.flatMap((source) => source.authors);
  const author = resolveAuthor(context, authorCandidates, collected, review);
  const authors = resolveAuthors(context, authorCandidates, author, collected);
  const articles = resolveArticles(context, sources, collected);
  const { editorial, metadata } = resolveFields(context, sources, collected);
  const provenance = dedupeProvenance(collected);
  return ParserOutputSchema.parse({
    url: context.pageUrl, parsedAt: new Date().toISOString(), techStack: input.techStack,
    author, authors, editorial, articles, metadata, provenance, review, issues: context.issues,
    ...(input.includeRawHydration ? { rawHydration: input.hydration.raw } : {}),
  });
}
