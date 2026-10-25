# Repository Guidelines

## Project Overview

Omniscrape (`@sfsajid91/omniscrape`) is a TypeScript library for extracting HTML metadata, author identities, articles, and field-level provenance from DOM/meta tags, JSON-LD, and framework hydration payloads. `parseHtml(html, pageUrl, options?)` is synchronous and zero-I/O: callers fetch HTML and supply the final response URL. Do not add fetching, browser execution, or persistence to the parser.

Read `README.md` before working, then the README files for the affected areas: `src/README.md`, `src/core/README.md`, `src/extractors/README.md`, and `scripts/README.md`. Check documentation claims against current code and tests; `AUDIT_REPORT.md` contains investigations, not an authoritative implementation contract.

## Architecture & Data Flow

`src/parse.ts` validates the URL and resource limits, parses HTML with LinkeDOM, creates an indexed `PageContext`, detects technologies, runs hydration → JSON-LD → DOM/meta extraction, and passes all results to `resolveParserOutput`.

- Extractors return `ExtractedData` candidates with `ValueEvidence`; collection is append-only. Preserve source URL, DOM/JSON path, scope, and confidence rather than directly overwriting final author fields.
- `src/core/resolver.ts` owns identity merging, co-author selection, article consolidation, provenance, and conflict quarantine in `review`.
- Merge identities only through explicit profile URLs or publisher-namespaced IDs, never matching names alone. Equal slugs cannot override distinct URLs or IDs. Keep article authors separate from editorial owners, session users, and related/listing authors.
- Hydration decoding uses static AST interpretation (Acorn) and Nuxt deserialization (`devalue`), not page-script execution. Preserve node/depth and HTML/script byte limits when extending decoders.

## Key Directories

- `src/core/`: per-parse context/indexes, evidence contracts, and resolution policy.
- `src/extractors/`: source-specific decoding and extraction; keep source recognition here rather than in the resolver.
- `tests/fixtures/`: reusable publisher-shaped and independent HTML cases.
- `scripts/`: fixture runner, synthetic benchmarks, package-consumer smoke checks, and release automation; not production parser code.

## Development Commands

| Command | Purpose |
| --- | --- |
| `bun install --frozen-lockfile` | Install locked dependencies |
| `bun run typecheck` | Strict TypeScript checking across source, tests, and scripts |
| `bun run test` | Run `bun test tests` |
| `bun test tests/parser.test.ts` | Run a focused suite |
| `bun run build` | Bundle Node-targeted ESM and emit declarations into `dist/` |
| `bun run check:package` | Pack and exercise installed Node and Bun consumers; run after building |
| `bun run bench` | Verify synthetic outputs and measure pipeline stage timings |
| `bun run scripts/test-cases.ts` | Run the shared behavioral case harness |

No lint or formatter command is configured. There is no application server/start command; run the case harness to exercise the library. Package smoke checks spawn subprocesses and install dependencies over the network, unlike the parser and ordinary in-memory tests.

## Code Conventions & Common Patterns

- Follow existing TypeScript style: two-space indentation, double quotes, semicolons, named exports, and explicit type imports. Use kebab-case module names, camelCase functions, PascalCase types, and `Schema` suffixes for Zod schemas.
- Keep public types and runtime schemas aligned in `src/types.ts`; reuse normalizers in `src/values.ts` for names, URLs, dates, emails, and social links.
- Pass `PageContext` and typed input objects explicitly. State belongs to each parse invocation; there is no DI container or global application store. Treat the DOM as read-only and accumulate candidates before resolution.
- Keep `src/` synchronous. Async/process/network operations belong to caller code or development scripts, not extractors.
- Invalid page URLs throw `TypeError`; invalid limits or oversized HTML throw `RangeError`. Malformed individual sources produce diagnostic `issues` and allow other sources to continue. Attribution ambiguity belongs in `review`, not exceptions or guessed values.

## Important Files

- `src/index.ts`: public exports; update deliberately when changing the package API.
- `src/parse.ts`: orchestration and input validation.
- `src/core/context.ts`, `src/core/evidence.ts`, `src/core/resolver.ts`: limits/state, candidate contracts, and resolution rules.
- `src/types.ts`, `src/values.ts`, `src/tech-detector.ts`: output schemas, shared normalization, and framework detection.
- `package.json`, `tsconfig.json`, `tsconfig.build.json`: exports, scripts, strict checking, and declaration build configuration.
- `.github/workflows/release.yml`: CI gates and publication. `scripts/release.ts` can create GitHub releases and publish npm packages; do not run it casually.

## Runtime/Tooling Preferences

Use Bun for development, package management, tests, scripts, and bundling; commit dependency changes with `bun.lock`. CI pins Bun `1.4.4` and checks Node `22` and `24` consumers. Node/npm are also needed for packaging smoke checks.

The package is ESM-only. Bun's conditional export resolves to `src/index.ts`; Node/import consumers use `dist/index.js`, with types at `dist/index.d.ts`. Keep both paths working. `tsc` handles type checking and declaration emission, not the JavaScript bundle. Zod's declared dependency range supports both v3 and v4; avoid inadvertently narrowing compatibility.

## Testing & QA

Use `bun:test` (`describe`, `test`, `expect`) in `tests/*.test.ts`. Prefer deterministic inline HTML or shared fixtures and assertions on consumer-visible parser output, provenance, review entries, and diagnostics. `tests/report-cases.test.ts` reuses `scripts/cases.ts` and its `verify(result)` contracts.

For extractor or resolver changes, cover the relevant source plus identity/role isolation, conflicting evidence, malformed input, and resource boundaries. Useful suites include `tests/multi-author.test.ts`, `tests/listing-attribution.test.ts`, `tests/flight-safety.test.ts`, and `tests/resource-isolation.test.ts`. Validate output schemas where appropriate. No numeric coverage threshold is configured.

Run focused tests while iterating, then typecheck and the full suite. CI additionally builds and tests the packed package on Node 22/24 and Bun; run `bun run build` followed by `bun run check:package` for public API, export, dependency, or packaging changes. Use `bun run bench` for traversal/indexing changes that could affect scaling.
