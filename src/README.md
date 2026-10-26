# Omniscrape Source Engine (`src`)

## Overview
`src` serves as the primary implementation directory and library entrypoint for Omniscrape. It defines the public API exported by `@sfsajid91/omniscrape`, the end-to-end extraction pipeline, Zod schemas, TypeScript types, value normalization helpers, and technology fingerprinting logic, while delegating specialized parsing tasks to child packages `core` and `extractors`.

## Interface

### Public Package Exports (`src/index.ts`)
- `parseHtml(input: ParseHtmlInput): ParserOutput`: Main synchronous library entrypoint parsing HTML documents and returning structured author profiles, articles, metadata, provenance, and diagnostic issues.
- `ParseHtmlInput`: Single configuration object interface containing required `html`, `pageUrl`, and optional `ParseOptions`.
- `ParseOptions`: Configuration parameters extending `ExtractionLimits` with toggles like `provenanceScope`, `articleProvenanceMode`, `dedupeAuthorProvenance`, and `includeRawHydration`.
- `ExtractionLimits`: Resource and traversal constraint interface (`maxHtmlBytes`, `maxScriptBytes`, `maxDecodeNodes`, `maxDecodeDepth`).
- Schemas & Types (`src/types.ts`):
  - `ParserOutput`, `ParserOutputSchema`: Primary structured output contract and corresponding Zod validation schema.
  - `AuthorProfile`, `AuthorProfileSchema`: Entity contract for resolved primary authors.
  - `ArticleItem`, `ArticleItemSchema`: Record schema for discovered articles and publications.
  - `PageMetadata`, `PageMetadataSchema`: Document-level metadata contract (title, description, canonical link, social tags).
  - `EditorialInfo`, `EditorialInfoSchema`: Metadata container for publisher and editorial attribution.
  - `TechStack`, `TechStackSchema`: Schema capturing detected framework flags.
  - `ProvenanceItem`, `ProvenanceItemSchema`: Audit record tracking value origin, path, scope, and confidence.
  - `ReviewAuthor`, `ReviewAuthorSchema`: Quarantine container for ambiguous candidates and conflicting author identities.
  - `ParserIssue`, `ParserIssueSchema`: Diagnostic error record for malformed payloads or traversal limits.
  - `SocialLink`, `SocialLinkSchema`, `SocialPlatform`, `SocialPlatformSchema`: Social media links and platform identifiers.
  - `HttpUrlSchema`: Zod schema validating absolute HTTP/HTTPS URLs.

### Internal Engine Submodules (Unexported from Package Root)
- `detectTechStack(context: PageContext): TechStack` (`src/tech-detector.ts`): Internal heuristic engine identifying active web frameworks, CMS platforms, and hydration architectures present in the document.
- Value Utilities (`src/values.ts`): Internal sanitizers and type guards including `isRecord`, `text`, `personName`, `isAuthorProfileUrl`, `httpUrl`, `dateString`, `imageUrl`, `emailAddress`, `socialLink`, `decodeEntities`, and `stripHtml`.

### Subdirectories
- [Core Engine (`src/core`)](./core/README.md): Runtime page context, evidence accumulation, and identity conflict resolution.
- [Extractors (`src/extractors`)](./extractors/README.md): DOM, JSON-LD, and framework hydration data extraction modules.

## Invariants
- `pageUrl` must be an absolute HTTP or HTTPS URL without credentials; malformed or credentialed URLs throw `TypeError`.
- Option limit values (`maxHtmlBytes`, `maxScriptBytes`, `maxDecodeNodes`, `maxDecodeDepth`) must be positive safe integers; invalid values throw `RangeError`.
- Input HTML UTF-8 byte length must not exceed `maxHtmlBytes` (default 8 MiB); oversized inputs throw `RangeError`.
- Traversal operations are completely synchronous and deterministic for any given HTML input and URL.
- No network requests, subprocess spawning, or browser runtime evaluations are performed.
- Conflicting identities are quarantined in `review` rather than guessing or picking arbitrary winning values.

## Side Effects
- None (strictly in-memory DOM parsing, AST traversal, and data structure generation).

## Verification
- Run: `bun test tests`
