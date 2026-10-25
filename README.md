# Omniscrape Blueprint

## System Overview
Omniscrape is an HTML metadata and author attribution parser designed to extract publisher metadata and author profiles from HTML documents, including data embedded in Next.js (`__NEXT_DATA__` and React Flight server components), Nuxt (2 and 3), Quintype/Bold, Fenrir, and generic framework hydration payloads.

- **Source-aware:** Accepted fields track their provenance (source URL, DOM/JSON path, scope, and confidence).
- **Identity-aware:** Distinguishes authors, co-authors, and editorial owners. Ambiguous identities and conflicting candidate attributes are quarantined in `review`.
- **Static:** Operates purely via static analysis without network requests, browser sandboxes, or page script execution.
- **Typed:** Provides TypeScript type definitions and Zod validation schemas with ESM support for Bun and Node.js.

### Installation

```sh
npm install @sfsajid91/omniscrape
# or
bun add @sfsajid91/omniscrape
```

> The initial release is `0.1.0`. Registry installation is available once published.

### Usage

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

Callers fetch HTML with their own client and supply the final response URL:

```typescript
const response = await fetch("https://publisher.example/authors/alice");
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const result = parseHtml(await response.text(), response.url);
```

Network requests, redirects, timeouts, retries, and transfer limits belong entirely to the caller.

### Comparison with Metascraper

[Metascraper](https://github.com/microlinkhq/metascraper) focuses on general metadata extraction across JSON-LD, microdata, meta tags, and DOM bylines. Omniscrape targets decoding framework hydration payloads, linking disparate sources, and determining person-level attribution with explicit conflict handling and provenance trails.

### Supported Sources

| Source | Support |
|---|---|
| Next.js | `__NEXT_DATA__` and recognized inline App Router Flight records/references |
| Nuxt | Nuxt 3 `__NUXT_DATA__` and restricted static Nuxt 2 `window.__NUXT__` payloads |
| Quintype / Bold | Recognized static page, story, author, and editorial payloads |
| Fenrir | `fenrir-client-data` and static `fenrirClientData` declarations |
| Generic state | Static `__INITIAL_STATE__` / `__PRELOADED_STATE__` assignments |
| JSON-LD | ProfilePage, Article authors, cross-script `@id` references, and article lists |
| DOM / meta | Scoped author/byline details, contacts, page metadata, and article headline links |

### API Specification

#### `parseHtml(html, pageUrl, options?)`

Synchronous parser returning [`ParserOutput`](./src/types.ts). `pageUrl` must be an absolute HTTP(S) URL without user credentials.

| Option | Default | Purpose |
|---|---:|---|
| `maxHtmlBytes` | 8 MiB | Reject oversized HTML by UTF-8 byte length |
| `maxScriptBytes` | 2 MiB | Skip oversized scripts and record a diagnostic issue |
| `maxDecodeNodes` | 50,000 | Bound decoder and graph traversal operations |
| `maxDecodeDepth` | 128 | Bound recursion depth in hydration/JSON graphs |
| `includeRawHydration` | `false` | Include a bounded, JSON-safe diagnostic snapshot |

Numeric limit options must be positive safe integers. Invalid URLs throw `TypeError`; invalid limits and oversized HTML throw `RangeError`.

## Subdirectories & System Boundaries
- [Source Engine (`src`)](./src/README.md): Primary library source code defining `parseHtml`, Zod schemas, TypeScript types, value normalizers, and the core resolution pipeline.
  - [Core Engine (`src/core`)](./src/core/README.md): In-memory execution context, evidence candidate collection, and identity conflict resolution engine.
  - [Extractors (`src/extractors`)](./src/extractors/README.md): Specialized extraction modules for DOM/meta tags, JSON-LD graphs, and framework hydration states.
- [Developer & Release Scripts (`scripts`)](./scripts/README.md): CI verification utilities, packaging smoke tests (`package-smoke.ts`), synthetic benchmarks (`benchmark.ts`), and release tag tooling.

## Global Invariants
- **Identity Integrity**: Author profiles merge solely on explicit profile URLs or publisher-namespaced IDs, never on matching names alone. Equal slugs cannot override distinct profile URLs or CMS IDs.
- **Role Isolation**: Article authors are strictly isolated from editorial owners, related story authors, session users, and generic site bylines.
- **Conflict Quarantine**: Ambiguous identities, unlinked co-authors, and conflicting field values are held in `review` with their respective evidence rather than guessed.
- **Fail-Safe Extraction**: Failures or syntax errors in individual script tags or hydration payloads record diagnostic `issues` and never abort parsing of remaining sources.
- **Resource Bounds**: Execution adheres to strict resource thresholds (`maxHtmlBytes`, `maxScriptBytes`, `maxDecodeNodes`, `maxDecodeDepth`) to protect against resource exhaustion and denial of service. Limit options must be positive safe integers; invalid limits and oversized HTML throw `RangeError`.
- **Deterministic & Zero-I/O**: Pure synchronous evaluation without network requests, disk persistence, or browser script execution.

## Global Side Effects
- None. Omniscrape performs pure in-memory compute on provided string buffers and returns immutable structured objects.

## System Verification
- Run: `bun test tests`

### Development Workflows

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run check:package
bun run bench
```

## License
[MIT](LICENSE) © 2026 sfsajid91.
