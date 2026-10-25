import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { isRecord } from "../src/values";

const dryRun = process.argv.includes("--dry-run");
const directory = process.argv[2];
assert.ok(directory && directory !== "--dry-run", "Usage: bun run scripts/release.ts <package-directory> [--dry-run]");
assert.equal(process.env.GITHUB_REPOSITORY, "sfsajid91/omniscrape", "Only the upstream repository may release");
if (!dryRun) {
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "Only main may release");
  assert.ok(["push", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME ?? ""), "Unsupported release event");
}

async function run(command: string[]): Promise<string> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
  return output.trim();
}

async function readJson(url: string, github = false): Promise<unknown | undefined> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (github && process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  const response = await fetch(url, { headers });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

const files = (await readdir(directory)).filter((file) => file.endsWith(".tgz"));
assert.equal(files.length, 1, "Expected exactly one tested package tarball");
const archive = resolve(directory, files[0]!);
const manifest: unknown = JSON.parse(await run(["tar", "-xOf", archive, "package/package.json"]));
assert.ok(isRecord(manifest));
assert.equal(manifest.name, "@sfsajid91/omniscrape");
const version = manifest.version;
assert.ok(typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version), "Expected a stable or prerelease semver version");
const prerelease = version.includes("-");
if (prerelease) {
  assert.ok(version.slice(version.indexOf("-") + 1).split(".").every((part) => !/^\d+$/.test(part) || part === "0" || !part.startsWith("0")), "Invalid numeric prerelease identifier");
}
const tag = `v${version}`;
const sha = await run(["git", "rev-parse", "HEAD"]);
assert.equal(process.env.GITHUB_SHA, sha, "The checked-out commit must match the validated workflow commit");
const existingTag = await run(["git", "tag", "--list", tag]);
if (existingTag) {
  const taggedSha = await run(["git", "rev-parse", `${tag}^{commit}`]);
  if (taggedSha !== sha) {
    console.log(`${tag} already belongs to ${taggedSha}; no version change to release.`);
    process.exit(0);
  }
}

const release = await readJson(`https://api.github.com/repos/sfsajid91/omniscrape/releases/tags/${encodeURIComponent(tag)}`, true);
if (release !== undefined) {
  assert.ok(isRecord(release) && release.draft === false && release.prerelease === prerelease, "Existing release must be published and match the version's prerelease status");
  assert.ok(existingTag, "An existing release must have a fetched tag");
}
const published = await readJson(`https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${encodeURIComponent(version)}`);
if (published !== undefined) {
  const integrity = `sha512-${createHash("sha512").update(Buffer.from(await Bun.file(archive).arrayBuffer())).digest("base64")}`;
  assert.ok(isRecord(published) && isRecord(published.dist) && published.dist.integrity === integrity, "The registry version exists with different contents; bump the version instead of overwriting it");
}

if (dryRun) {
  console.log(JSON.stringify({ dryRun, sha, tag, createRelease: release === undefined, publish: published === undefined, distTag: prerelease ? "next" : "latest" }));
} else {
  if (release === undefined) {
    await run(["gh", "release", "create", tag, archive, "--target", sha, "--title", tag, "--generate-notes", ...(prerelease ? ["--prerelease", "--latest=false"] : ["--latest"])]);
  }
  if (published === undefined) {
    await run(["npm", "publish", archive, "--access", "public", "--provenance", "--tag", prerelease ? "next" : "latest", "--registry=https://registry.npmjs.org/"]);
  }
  console.log(`${tag}: GitHub release exists and npm publication is complete.`);
}
