import type { ArticleItem, AuthorProfile } from "../types";

export type EvidenceScope = "profile" | "byline" | "article" | "publisher" | "page";

export interface ValueEvidence {
  source: string;
  sourcePath: string;
  scope: EvidenceScope;
  confidence: "high" | "medium" | "low";
}

export interface AuthorCandidate {
  profile: Partial<AuthorProfile>;
  /** Explicit profile URL or publisher-namespaced CMS ID; never a name-derived key. */
  identity?: string;
  primary: boolean;
  evidence: Partial<Record<keyof AuthorProfile, ValueEvidence>>;
  socialEvidence?: ValueEvidence[];
  /** Explicit source-level shared authorship relation; never inferred from equal rank. */
  authorshipGroups?: string[];
}

export interface ArticleCandidate {
  article: ArticleItem;
  evidence: ValueEvidence;
  fieldPaths?: Partial<Record<keyof ArticleItem, string>>;
}

export interface FieldCandidate {
  field: string;
  value: string | number;
  evidence: ValueEvidence;
}

export interface ExtractedData {
  authors: AuthorCandidate[];
  articles: ArticleCandidate[];
  fields: FieldCandidate[];
  raw?: unknown;
}

export function emptyExtraction(): ExtractedData {
  return { authors: [], articles: [], fields: [] };
}
