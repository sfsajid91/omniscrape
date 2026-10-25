# Omniscrape

Extract publisher metadata and author profiles from HTML, including data hidden in Next.js, Nuxt, and CMS hydration payloads.

- **Source-aware:** accepted fields include their source URL, path, scope, and confidence.
- **Identity-aware:** distinguish authors, co-authors, and editorial owners. Ambiguous identities and conflicting values stay in `review`.
- **Static:** no network requests, browser, or page-script execution.
- **Typed:** TypeScript types and Zod output schemas. Bun and Node.js ESM.

## Install

```sh
npm install @sfsajid91/omniscrape
# or
bun add @sfsajid91/omniscrape
```

> The first release is `0.1.0`. Registry installation is available once it is published.

## Usage

```typescript
import { parseHtml } from "@sfsajid91/omniscrape";

const url = "https://publisher.example/authors/alice";
const html = `<script type="application/ld+json">{
  "@type": "ProfilePage",
  "mainEntity": {
    "@type": "Person",
    "name": "Alice Reporter",
    "url": "https://publisher.example/authors/alice",
    "email": "writer@example.org"
  }
}</script>`;

const result = parseHtml(html, url);

result.author.name;  // "Alice Reporter"
result.author.email; // "writer@example.org"
result.authors;      // Resolved author or confirmed co-authors
result.articles;     // Discovered articles
result.metadata;     // Page title, description, canonical URL, and more
result.provenance;   // Evidence behind accepted fields
result.review;       // Unresolved identities and conflicting values
result.issues;       // Malformed, unsupported, or resource-limited sources
```

Fetch HTML with your own client and pass the final response URL:

```typescript
const response = await fetch("https://publisher.example/authors/alice");
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const result = parseHtml(await response.text(), response.url);
```

Fetching, redirects, timeouts, retries, and download-size limits belong to the caller.

## Why not just Metascraper?

[Metascraper](https://github.com/microlinkhq/metascraper) already extracts JSON-LD, microdata, meta tags, and DOM bylines. Omniscrape focuses on a different requirement: decoding hydration data and resolving **which person each field belongs to**, with provenance and explicit conflict handling.

Use Metascraper when its general metadata model fits. Use Omniscrape when you need hydration-aware publisher/author extraction and reviewable identity attribution. It is not a drop-in replacement or a claim of universal coverage or better performance.

## Supported sources

| Source | Support |
|---|---|
| Next.js | `__NEXT_DATA__` and recognized inline App Router Flight records/references |
| Nuxt | Nuxt 3 `__NUXT_DATA__` and restricted static Nuxt 2 `window.__NUXT__` payloads |
| Quintype / Bold | Recognized static page, story, author, and editorial payloads |
| Fenrir | `fenrir-client-data` and static `fenrirClientData` declarations |
| Generic state | Static `__INITIAL_STATE__` / `__PRELOADED_STATE__` assignments |
| JSON-LD | ProfilePage, Article authors, cross-script `@id` references, and article lists |
| DOM / meta | Scoped author/byline details, contacts, page metadata, and article headline links |

Recognized layouts only—not arbitrary application state or the full React Flight protocol. Page JavaScript and custom Nuxt revivers are never executed. A failed source does not prevent extraction from other sources.

## API

### `parseHtml(html, pageUrl, options?)`

Synchronous. Returns a [`ParserOutput`](src/types.ts). `pageUrl` must be an absolute HTTP(S) URL without credentials.

| Option | Default | Purpose |
|---|---:|---|
| `maxHtmlBytes` | 8 MiB | Reject oversized HTML by UTF-8 byte length |
| `maxScriptBytes` | 2 MiB | Skip oversized scripts and record an issue |
| `maxDecodeNodes` | 50,000 | Bound decoder/traversal work |
| `maxDecodeDepth` | 128 | Bound hydration/graph traversal depth |
| `includeRawHydration` | `false` | Include a bounded, JSON-safe diagnostic snapshot |

Numeric limits must be positive safe integers. Invalid URLs throw `TypeError`; invalid limits and oversized HTML throw `RangeError`. Individual source failures generally appear in `issues`. HTML size is checked after download, not during it.

The package exports `parseHtml`, `ParseOptions`, `ExtractionLimits`, output types, and output schemas such as `ParserOutputSchema`. Bun loads the TypeScript entrypoint; Node loads the built ESM bundle. No CommonJS entrypoint.

### Attribution

- Merge people only through explicit profile URLs or identifiers, never matching names alone. A CMS-ID/slug bridge requires the same publisher namespace; equal slugs do not override distinct profile URLs or CMS IDs.
- Keep article authors separate from editorial owners, related-story authors, session users, and bylines in footers or comments.
- Withhold ambiguous identities and conflicting attributes; retain their evidence in `review`.
- Return `author.name` as `"Unknown Author"` and `authors` as `[]` when no target is resolved.
- Treat confidence as source strength, not a calibrated probability. Do not infer missing contacts or expand initials.

Each provenance entry includes `field`, `value`, `source`, `sourceUrl`, `sourcePath`, `scope`, and `confidence`. Article discoveries are deduplicated by URL while preserving separate evidence. DOM fallback discovery is capped at 20 unique articles; structured collections have their own traversal limits.

## Development

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run bench
```

Tests use deterministic fixtures without network access or credentials. Benchmarks measure synthetic pages, not production coverage or speed relative to other libraries. Build tooling requires Bun; Node consumers use the generated ESM bundle.

For extraction bugs, [open an issue](https://github.com/sfsajid91/omniscrape/issues) with minimal sanitized HTML, its page URL, and the expected result. Never include credentials, session data, or private contact information.

## License

[MIT](LICENSE) © 2026 sfsajid91.
