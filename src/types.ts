import { z } from "zod";

export const HttpUrlSchema = z.string().url().refine(
  (value) => /^https?:\/\//i.test(value),
  "Expected an HTTP(S) URL",
);

export const SocialPlatformSchema = z.enum([
  "linkedin",
  "twitter",
  "instagram",
  "muckrack",
  "facebook",
  "youtube",
  "github",
  "threads",
  "bluesky",
  "substack",
  "medium",
  "mastodon",
  "other",
]);
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>;

export const SocialLinkSchema = z.object({
  platform: SocialPlatformSchema,
  url: HttpUrlSchema,
  handle: z.string().optional(),
  isPersonal: z.boolean().default(true),
});
export type SocialLink = z.infer<typeof SocialLinkSchema>;

export const ArticleItemSchema = z.object({
  title: z.string().min(1),
  url: HttpUrlSchema,
  publishedAt: z.string().datetime({ offset: true }).optional(),
});
export type ArticleItem = z.infer<typeof ArticleItemSchema>;

export const AuthorProfileSchema = z.object({
  name: z.string().min(1),
  givenName: z.string().optional(),
  familyName: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  slug: z.string().optional(),
  designation: z.string().optional(),
  bio: z.string().optional(),
  avatarUrl: HttpUrlSchema.optional(),
  email: z.string().email().optional(),
  emails: z.array(z.string().email()).optional(),
  socials: z.array(SocialLinkSchema).default([]),
});
export type AuthorProfile = z.infer<typeof AuthorProfileSchema>;

export const EditorialInfoSchema = z.object({
  ownerName: z.string().optional(),
  ownerId: z.union([z.string(), z.number()]).optional(),
  ownerEmail: z.string().email().optional(),
  assigneeName: z.string().optional(),
  assigneeId: z.union([z.string(), z.number()]).optional(),
  publisher: z.string().optional(),
});
export type EditorialInfo = z.infer<typeof EditorialInfoSchema>;

export const TechStackSchema = z.object({
  framework: z.string().default("Unknown"),
  cms: z.string().default("Unknown"),
  hydrationFormat: z.string().optional(),
  signals: z.array(z.string()).default([]),
});
export type TechStack = z.infer<typeof TechStackSchema>;

export const PageMetadataSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  canonicalUrl: HttpUrlSchema.optional(),
  ogImage: HttpUrlSchema.optional(),
  language: z.string().optional(),
  publishedTime: z.string().optional(),
  modifiedTime: z.string().optional(),
});
export type PageMetadata = z.infer<typeof PageMetadataSchema>;

export const ProvenanceItemSchema = z.object({
  field: z.string(),
  value: z.string(),
  source: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  sourceUrl: z.string().url(),
  sourcePath: z.string().min(1),
  scope: z.enum(["profile", "byline", "article", "publisher", "page"]),
  entity: z.string().optional(),
});
export type ProvenanceItem = z.infer<typeof ProvenanceItemSchema>;

export const ReviewAuthorSchema = z.object({
  reason: z.enum(["ambiguous_identity", "different_identity", "conflicting_value"]),
  author: AuthorProfileSchema,
  provenance: z.array(ProvenanceItemSchema),
});
export type ReviewAuthor = z.infer<typeof ReviewAuthorSchema>;

export const ParserIssueSchema = z.object({
  sourcePath: z.string(),
  message: z.string(),
});
export type ParserIssue = z.infer<typeof ParserIssueSchema>;

export const ParserOutputSchema = z.object({
  url: HttpUrlSchema,
  parsedAt: z.string(),
  techStack: TechStackSchema,
  author: AuthorProfileSchema,
  authors: z.array(AuthorProfileSchema).default([]),
  editorial: EditorialInfoSchema,
  articles: z.array(ArticleItemSchema).default([]),
  metadata: PageMetadataSchema,
  provenance: z.array(ProvenanceItemSchema).default([]),
  review: z.array(ReviewAuthorSchema).default([]),
  issues: z.array(ParserIssueSchema).default([]),
  rawHydration: z.unknown().optional(),
});
export type ParserOutput = z.infer<typeof ParserOutputSchema>;
