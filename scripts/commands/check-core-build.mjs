import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status ?? 1;
}

const buildStatus = run("pnpm", ["finder:core:build"]);
if (buildStatus !== 0) {
  process.exit(buildStatus);
}

const generatedFiles = [
  "app/analytics-core.js",
  "app/candidate-copy.js",
  "app/data-loader.js",
  "app/data-utils.js",
  "app/search-sort.js",
  "app/url-state.js",
];
const diffStatus = run("git", ["diff", "--exit-code", "--", ...generatedFiles]);
if (diffStatus !== 0) {
  console.error(`Generated core output is stale. Run pnpm finder:core:build and commit ${generatedFiles.join(", ")}.`);
  process.exit(diffStatus);
}

const coreFiles = (await readdir("app-core")).filter((file) => file.endsWith(".ts"));
for (const file of coreFiles) {
  const path = join("app-core", file);
  const content = await readFile(path, "utf8");
  if (/\b(?:window|document)\b/.test(content)) {
    console.error(`${path} must stay independent from direct window/document access. Keep runtime DOM, React UI, and analytics dispatch in frontend shell modules.`);
    process.exit(1);
  }
}

console.log("Finder core generated output is up to date.");
