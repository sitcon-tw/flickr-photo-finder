import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status ?? 1;
}

const buildStatus = run("pnpm", ["finder:core:build"]);
if (buildStatus !== 0) {
  process.exit(buildStatus);
}

const generatedFiles = ["app/candidate-copy.js", "app/data-loader.js", "app/data-utils.js", "app/search-sort.js", "app/url-state.js"];
const diffStatus = run("git", ["diff", "--exit-code", "--", ...generatedFiles]);
if (diffStatus !== 0) {
  console.error(`Generated core output is stale. Run pnpm finder:core:build and commit ${generatedFiles.join(", ")}.`);
  process.exit(diffStatus);
}

console.log("Finder core generated output is up to date.");
