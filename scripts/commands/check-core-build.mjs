import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status ?? 1;
}

const buildStatus = run("pnpm", ["finder:core:build"]);
if (buildStatus !== 0) {
  process.exit(buildStatus);
}

const diffStatus = run("git", ["diff", "--exit-code", "--", "app/url-state.js"]);
if (diffStatus !== 0) {
  console.error("Generated core output is stale. Run pnpm finder:core:build and commit app/url-state.js.");
  process.exit(diffStatus);
}

console.log("Finder core generated output is up to date.");
