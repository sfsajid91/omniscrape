# Core Engine (`src/core`)

## Overview
The `src/core` package provides the foundational execution context, evidence accumulation models, and identity/attribution resolution algorithms for Omniscrape. It defines the runtime constraints, manages candidate extractions across heterogeneous sources, and resolves author identities while preserving field-level provenance and quarantining conflicts.

## Interface
- `ParserDocument`, `ParserElement`: Core DOM type aliases mapped to `Document` and `Element`.
- `createPageContext(document: ParserDocument, html: string, pageUrl: string, limits: ExtractionLimits): PageContext`: Initializes the parser execution context, pre-indexing DOM scripts, meta tags, and document links.
- `elementPath(element: ParserElement): string`: Generates a deterministic, selector-based DOM path string (e.g. `header:nth-of-type(1) > h2:nth-of-type(1)`) used for provenance tracking.
- `DEFAULT_LIMITS: ExtractionLimits`: Baseline execution thresholds (`maxHtmlBytes`: 8 MiB, `maxScriptBytes`: 2 MiB, `maxDecodeNodes`: 50,000, `maxDecodeDepth`: 128).
- `ExtractionLimits`: Interface defining resource and traversal bounds.
- `PageContext`: In-memory execution state containing document references, script registries, meta maps, and diagnostic issues.
- `ScriptData`: Metadata and text payload of discovered inline script elements.
- `EvidenceScope`: Literal union (`"profile" | "byline" | "article" | "publisher" | "page"`) denoting candidate attribution scope.
- `ValueEvidence`: Provenance metadata recording source name, path, scope, and confidence level (`"high" | "medium" | "low"`).
- `AuthorCandidate`: Author entity candidate containing profile attributes, identity keys, and field-level evidence.
- `ArticleCandidate`: Discovered article candidate with corresponding provenance evidence.
- `FieldCandidate`: Generic key-value extraction item with provenance tracking.
- `ExtractedData`: Aggregated extraction container returned by modular extractors.
- `emptyExtraction(): ExtractedData`: Factory helper returning a clean extraction container.
- `resolveParserOutput(input: ResolverInput): ParserOutput`: Core resolver consolidating candidate evidence into final author profiles, co-authors, articles, metadata, provenance chains, review queues, and diagnostic issues.
- `ResolverInput`: Input specification aggregating context, detected tech stack, and extractor outputs.

## Invariants
- Identity resolution strictly requires explicit profile URLs or publisher-namespaced IDs; matching names alone never merge separate candidate profiles.
- Equal author slugs do not override distinct profile URLs or distinct CMS identifiers.
- Conflicting values and unlinked co-author identities are preserved in `review` rather than guessing or silently overwriting attributes.
- Execution resource limits (`maxDecodeNodes`, `maxDecodeDepth`, `maxHtmlBytes`, `maxScriptBytes`) are strictly enforced to prevent unbounded resource consumption.
- Candidate evidence collection is append-only, preserving exact DOM/JSON paths and source references for full auditability.

## Side Effects
- None (pure in-memory evaluation and deterministic data transformation; zero network, file system, or process side effects).

## Verification
- Run: `bun test tests`
