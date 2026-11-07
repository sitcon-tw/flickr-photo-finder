import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildFinderDataUrls, buildPagesArtifact, versionedAssetUrl, versionPagesAssets } from "../scripts/commands/build-pages.mjs";
import { collectRelativeJavaScriptImportGraph, relativeJavaScriptImports, rewriteRelativeJavaScriptImports } from "../scripts/lib/pages/js-import-graph.mjs";

test("asset versions preserve relative paths, other parameters and fragments", () => {
  assert.equal(versionedAssetUrl("../module.js?mode=small&v=before#part", "after"), "../module.js?mode=small&v=after#part");
  assert.equal(versionedAssetUrl("./styles.css", "build-a"), "./styles.css?v=build-a");
});

test("module versions cover imports, re-exports and literal dynamic imports", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "finder-imports-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const source = `import { value } from './dep.js';
import './dep.js';
export { value } from './dep.js?mode=small#part';
const dynamic = import('./dep.js');
const external = import('https://example.com/module.js');
const text = './dep.js';`;
  const rewritten = rewriteRelativeJavaScriptImports(source, (url) => versionedAssetUrl(url, "build-a"));
  assert.deepEqual(relativeJavaScriptImports(rewritten), ["./dep.js?v=build-a", "./dep.js?mode=small&v=build-a#part"]);
  assert.ok(rewritten.includes("import('./dep.js?v=build-a')"));
  assert.ok(rewritten.includes("import('https://example.com/module.js')"));
  assert.ok(rewritten.includes("const text = './dep.js'"));
  await writeFile(join(rootDir, "main.js"), rewritten);
  await writeFile(join(rootDir, "dep.js"), "export const value = 1;");
  assert.deepEqual(await collectRelativeJavaScriptImportGraph({ rootDir, entryFile: "main.js" }), ["dep.js", "main.js"]);
  await writeFile(join(rootDir, "main.js"), "import '../outside.js?v=build-a';");
  await assert.rejects(collectRelativeJavaScriptImportGraph({ rootDir, entryFile: "main.js" }), /outside/);
});

test("Pages builds version local assets consistently and detect content-only changes", async (t) => {
  const outputDir = await mkdtemp(join(tmpdir(), "finder-version-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const options = { outputDir, dataMode: "runtime-csv", photosCsvUrl: "https://example.com/photos.csv?source=public" };
  const first = await buildPagesArtifact(options);
  const second = await buildPagesArtifact(options);
  assert.equal(first.version, second.version);

  const html = await readFile(join(outputDir, "index.html"), "utf8");
  for (const [, url] of html.matchAll(/\b(?:src|href)="(\.\/[^"]+)"/g)) {
    assert.equal(new URL(url, "https://finder.invalid/").searchParams.get("v"), first.version);
  }
  const modules = await collectRelativeJavaScriptImportGraph({ rootDir: outputDir, entryFile: "main.js" });
  for (const file of modules) {
    for (const url of relativeJavaScriptImports(await readFile(join(outputDir, file), "utf8"))) {
      assert.equal(new URL(url, "https://finder.invalid/").searchParams.get("v"), first.version);
    }
  }
  const config = await readFile(join(outputDir, "config.js"), "utf8");
  assert.ok(config.includes(options.photosCsvUrl));
  for (const url of buildFinderDataUrls(options.dataMode)) assert.ok(config.includes(versionedAssetUrl(url, first.version)));
  const worker = await readFile(join(outputDir, "service-worker.js"), "utf8");
  const precache = JSON.parse(worker.match(/PRECACHE_URLS__ = (\[[^\n]+\]);/)[1]);
  assert.ok(precache.includes("./") && precache.includes("./index.html"));
  for (const url of precache.filter((url) => url !== "./" && url !== "./index.html")) {
    assert.equal(new URL(url, "https://finder.invalid/").searchParams.get("v"), first.version);
  }

  // Re-create the build inputs, then change CSS without changing the file list or data.
  for (const file of ["index.html", ...modules]) {
    const path = join(outputDir, file);
    await writeFile(path, (await readFile(path, "utf8")).replaceAll(`?v=${first.version}`, ""));
  }
  await writeFile(join(outputDir, "styles.css"), `${await readFile(join(outputDir, "styles.css"), "utf8")}\nbody { color: red; }`);
  const changed = await versionPagesAssets(outputDir, { dataMode: options.dataMode, jsFiles: modules.filter((file) => file !== "config.js") });
  assert.notEqual(changed, first.version);
});
