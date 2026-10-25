import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "../src/values";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(join(tmpdir(), "omniscrape-package-"));
const destination = process.argv[2] ? resolve(process.argv[2]) : temporary;

async function run(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();
  if (await child.exited !== 0) throw new Error(`Command failed: ${command.join(" ")}`);
  return output;
}

try {
  await mkdir(destination, { recursive: true });
  const packed: unknown = JSON.parse(await run(["npm", "pack", "--json", "--pack-destination", destination], root));
  assert.ok(Array.isArray(packed) && packed.length === 1 && isRecord(packed[0]));
  const info = packed[0];
  assert.equal(info.name, "@sfsajid91/omniscrape");
  assert.ok(typeof info.filename === "string" && info.filename.endsWith(".tgz"));
  assert.ok(Array.isArray(info.files));
  const paths = info.files.map((file: unknown) => {
    assert.ok(isRecord(file) && typeof file.path === "string");
    return file.path;
  });
  for (const required of ["dist/index.js", "dist/index.d.ts", "src/index.ts", "README.md", "LICENSE", "package.json"]) {
    assert.ok(paths.includes(required), `Missing package file: ${required}`);
  }
  assert.ok(paths.every((path) => /^(?:dist\/|src\/|README\.md$|LICENSE$|package\.json$)/.test(path)), "Unexpected package contents");
  const archive = join(destination, info.filename);
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await Bun.write(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  await run(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", archive], consumer);
  await Bun.write(join(consumer, "smoke.mjs"), `
import assert from "node:assert/strict";
import { parseHtml, ParserOutputSchema } from "@sfsajid91/omniscrape";
const url = "https://publisher.example/authors/alice";
const html = '<script type="application/ld+json">' + JSON.stringify({
  "@type": "ProfilePage",
  mainEntity: { "@type": "Person", name: "Alice Reporter", url, email: "writer@example.org" }
}) + '</script>';
const result = parseHtml(html, url);
assert.equal(result.author.name, "Alice Reporter");
assert.equal(result.author.email, "writer@example.org");
assert.deepEqual(result.authors.map(({ name }) => name), ["Alice Reporter"]);
assert.deepEqual(result.review, []);
assert.deepEqual(result.issues, []);
assert.ok(result.provenance.some((item) => item.field === "author.email" && item.value === "writer@example.org" && item.sourceUrl === url && item.scope === "profile"));
assert.equal(ParserOutputSchema.parse(JSON.parse(JSON.stringify(result))).author.name, "Alice Reporter");
assert.throws(() => parseHtml(html, "file:///profile"), TypeError);
assert.throws(() => parseHtml(html, url, { maxHtmlBytes: 1 }), RangeError);
const entrypoint = import.meta.resolve("@sfsajid91/omniscrape");
assert.ok(entrypoint.endsWith(process.versions.bun ? "/src/index.ts" : "/dist/index.js"), entrypoint);
console.log(JSON.stringify({ runtime: process.versions.bun ? "Bun " + process.versions.bun : "Node " + process.versions.node, entrypoint, author: result.author.name, email: result.author.email }));
`);
  console.log((await run(["node", "smoke.mjs"], consumer)).trim());
  console.log((await run(["bun", "run", "smoke.mjs"], consumer)).trim());
  console.log(`Verified ${info.filename}: ${paths.length} files`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
