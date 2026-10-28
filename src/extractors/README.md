# Extractors (`src/extractors`)

## Overview
The `src/extractors` package contains source-specific parsing modules that extract author candidates, article links, and page metadata from HTML documents. It targets three primary data channels: standard DOM/meta tags, structured JSON-LD entity graphs, and server-rendered framework hydration payloads (Next.js, Nuxt, Quintype, Fenrir, and generic state dumps).

## Interface
- `extractDomAndMeta(context: PageContext): DomMetaResult`: Extracts metadata tags (OpenGraph, Twitter, standard meta), structured microdata, DOM bylines, author social links, and article link candidates.
- `extractHydrationData(context: PageContext): HydrationResult`: Decodes static framework hydration payloads including `__NEXT_DATA__`, React Server Component (Flight) inline references, Nuxt 2/3 state, Quintype/Bold payloads, Fenrir client data, and `__INITIAL_STATE__`.
- `extractJsonLd(context: PageContext): JsonLdResult`: Locates, parses, and resolves `application/ld+json` scripts, resolving cross-script `@id` node references and `@graph` collections for `Person`, `ProfilePage`, and `Article` schemas.
- `DomMetaResult`: Interface extending `ExtractedData` with `{ metadata: PageMetadata }` returned by `extractDomAndMeta`.
- `HydrationResult`: Type alias for `ExtractedData` returned by `extractHydrationData`.
- `JsonLdResult`: Type alias for `ExtractedData` returned by `extractJsonLd`.

## Invariants
- Page JavaScript and hydration revivers are never evaluated or executed in the runtime; all payloads are extracted using static AST analysis and safe JSON-like interpretation.
- Resource limits are strictly enforced per extractor channel:
  - All decoders respect global `context.limits.maxDecodeDepth` and `context.limits.maxDecodeNodes`.
  - JSON-LD graph traversal enforces `MAX_ENTITIES = 20_000`, `MAX_ARRAY_ITEMS = 500`, and step thresholds (1,000) to prevent circular graph amplification.
  - Hydration traversal bounds array collections (`MAX_ITEMS = 100`) and evaluates static assignment trees within safe evaluator depth bounds.
- Extraction failures within individual script tags or hydration payloads do not abort parsing; malformed payloads and threshold violations are recorded into `context.issues`.
- User sessions, editors, assignees, and account owners are filtered out from author candidates.
- Primary author attribution requires explicit contextual linkage (e.g., `ProfilePage` `mainEntity`, current article bylines, or unambiguous root person profiles) and excludes navigation links, comments, and related stories.
- Extracted articles from the DOM are capped at 20 unique links with titles constrained between 15 and 300 characters.
- Extracted URLs (canonical, profile, article, avatars, social) must normalize to valid HTTP(S) URLs without user credentials.
- All DOM and AST traversals treat input documents as immutable.

## Side Effects
- Diagnostic logging: Pushes error and warning objects into `context.issues` when encountering malformed JSON/scripts, traversal limit breaches, or conflicting field values. (Zero network or filesystem I/O).

## Verification
- Run: `bun test tests`
