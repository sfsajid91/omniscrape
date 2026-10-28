# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-10-28

### Fixed

- **Author profile contacts**: Extracts scoped DOM mailto contacts and primary JSON-LD Person description emails, including after questions. Excludes listing contacts and socials; conflicting profile addresses remain quarantined.

## [0.2.0] - 2026-10-26

### Breaking Changes

- **Unified Single-Object Configuration Signature**:
  The legacy positional signature `parseHtml(html, pageUrl, options?)` has been removed in favor of a single configuration object:
  ```typescript
  const result = parseHtml({
    html: "<html>...</html>",
    pageUrl: "https://example.com/article",
    provenanceScope: "identity",
    maxHtmlBytes: 4 * 1024 * 1024,
  });
  ```
  Passing non-object inputs or positional arguments now synchronously throws a `TypeError`.

### Added

- **Provenance Payload Optimization**:
  - `includeArticleProvenance?: boolean` (defaults to `true`): Allows callers to toggle article catalog provenance records off entirely for massive payload reduction on section and author collection pages.
  - `articleProvenanceMode?: "property" | "item"` (defaults to `"property"`): Consolidates property-level article entries (`articles[i].title`, `articles[i].url`, `articles[i].publishedAt`) into a single item-level record (`articles[i]`), reducing provenance size by ~48%.
  - `provenanceScope?: "all" | "identity" | "none"` (defaults to `"all"`): Controls provenance granularity. Setting `"identity"` retains only author, editorial, and metadata provenance while omitting catalog articles. Setting `"none"` disables provenance collection completely (`output.provenance = []`).
  - `dedupeAuthorProvenance?: boolean` (defaults to `false`): When enabled for single-author pages, suppresses redundant `authors[0]` mirror records that duplicate `author` provenance.
- **Multi-Contact & Editorial Schema**:
  - Added `emails?: string[]` to `AuthorProfileSchema` to capture all verified personal email addresses from author profiles and bylines without data loss.
  - Added `ownerEmail?: string` to `EditorialInfoSchema` for publisher/editorial owner contact extraction.
  - Added support for `substack`, `medium`, and `mastodon` to `SocialPlatformSchema`, including subdomain-based author URLs (`https://<handle>.substack.com` and `https://<handle>.medium.com`).
- **Quintype Entity Correlation**:
  - Added entity correlation (`correlateQuintypeCollectionEntities`) linking story card authors and owner IDs within nested collection payloads to root author contacts and editorial metadata.
  - Bounded traversal adhering to configured `maxDecodeNodes` and `maxDecodeDepth` limits.
- **Editorial Deduplication**:
  - Implemented deduplication for repeated editorial fields in hydration extractors via seen-tuple tracking, eliminating redundant records across large catalog collections.
- **Developer Ergonomics**:
  - Parameter-level JSDoc documentation across `parseHtml`, `ParseHtmlInput`, `ParseOptions`, `ExtractionLimits`, and `ParserOutput`.
  - Added Biome code linter, formatter, and Husky pre-commit hooks.

### Fixed

- **Audit Defect Remediations**:
  - **Finding 1**: Resolved author identity merging when author has JSON-LD ID and DOM byline carries designation/email, while preventing unlinked non-primary related authors from polluting accepted identities.
  - **Finding 2**: Stripped child email links (`mailto:`) from DOM byline elements without polluting the author name.
  - **Finding 3**: Added conjunction splitting (`" and "`, `", "`) to properly separate multi-author DOM compound bylines.
  - **Finding 4**: Excluded prose paragraphs starting with "By" from being falsely parsed as author bylines without explicit byline classes.
  - **Finding 5**: Prevented unrelated standalone JSON-LD `Person` entities in `@graph` from overriding explicit `Article.author` attribution.
  - **Finding 6**: Fixed author contact extraction to collect multiple byline emails into `author.emails`.
  - **Finding 7**: Added support for modern author profile route patterns (`/author/`, `/columnist/`, `/writer/`, `/profile/`).
  - **Finding 8**: Supported short single-word and capitalized headlines without premature rejection.
  - **Finding 9**: Prevented internal framework marker leaking into public author and editorial outputs.
  - **Finding 10**: Fixed Flight hydration stream parsing to handle multiline string chunks without malformed syntax errors.
  - **Finding 11**: Resolved concordant timestamp drift across microsecond/millisecond ISO representations.
  - **Finding 12**: Guarded HTML character reference decoding to safely handle numeric boundaries and cyclic entities.
  - **Findings 13-16**: Enhanced resource limits and boundary isolation against memory exhaustion on adversarial markup.
