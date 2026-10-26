# Developer & Release Scripts (`scripts`)

## Overview
The `scripts` directory contains internal automation, CI validation, test fixtures, test harnesses, and performance measurement tools for Omniscrape. These scripts ensure package integrity prior to release, benchmark stage latencies across self-generated synthetic payloads, execute behavioral regression fixture suites, and automate GitHub and npm release publishing.

## Interface
- `benchmark.ts`: Executable CLI benchmarking script measuring pipeline stage latencies (`DOM`, `Index`, `Detect`, `Hydration`, `JSON-LD`, `DOM extraction`, `Resolve`) across self-contained synthetic HTML fixtures scaling from 25 to 10,000 card sections.
- `cases.ts`: Exported repository of behavioral and regression test case fixtures (`TestCase[]`), containing HTML snapshots, configuration options, expected outcomes, human evaluation metadata, and assertion functions (`verify(result: ParserOutput)`).
- `test-cases.ts`: Executable test runner and CLI harness (`runCases(cases, compare)`) executing the fixture suite defined in `cases.ts`, with optional comparative benchmarking against Metascraper via `--compare`.
- `package-smoke.ts`: CI validation script that bundles the library via `npm pack`, creates an isolated temporary consumer project, installs the tarball, and verifies bundle execution across Node.js and Bun runtimes.
- `release.ts`: CI release orchestrator (`bun run scripts/release.ts <package-directory> [--dry-run]`) that unpacks and verifies `package.json` semver metadata from a tested `.tgz` tarball, checks git commit SHAs and tag immutability, creates GitHub releases via `gh release create`, and publishes to npm with provenance.

## Invariants
- Scripts are designed exclusively for internal development and CI workflows; they are excluded from production package distributions.
- `benchmark.ts` asserts that extracted fixture results strictly match expectations (`output.author.name === "Alice Reporter"` and `output.articles.length === 2`) before recording timings.
- `package-smoke.ts` executes all packaging checks inside an isolated OS temporary directory, requiring exactly one `.tgz` archive and verifying required package manifest files (`dist/index.js`, `dist/index.d.ts`, `src/index.ts`, `README.md`, `LICENSE`, `package.json`).
- `release.ts` strictly enforces `GITHUB_REPOSITORY === "sfsajid91/omniscrape"`, `GITHUB_REF === "refs/heads/main"` (for non-dry-runs), validated SemVer versioning, and commit SHA consistency (`GITHUB_SHA === git rev-parse HEAD`), rejecting modifications to existing tags or differing npm integrity hashes.

## Side Effects
- `benchmark.ts`: Generates synthetic HTML strings in memory and outputs performance metric tables to standard output.
- `package-smoke.ts`: Spawns child processes (`npm pack`, `npm install`, `node`, `bun`), creates and deletes temporary directory trees under `os.tmpdir()`, and makes network requests during dependency installation.
- `release.ts`: Executes git shell commands (`git rev-parse`, `git tag`), issues network HTTP requests to `api.github.com` and `registry.npmjs.org`, and when not in dry-run mode, executes `gh release create` and `npm publish --access public --provenance`.
- `test-cases.ts`: Logs test execution results to stdout/stderr, dynamically imports Metascraper modules when `--compare` is set, and sets `process.exitCode`.

## Verification
- Run: `bun run check:package`
- Run: `bun run bench`
- Run: `bun run scripts/test-cases.ts` (with optional comparison: `bun run scripts/test-cases.ts --compare`)
