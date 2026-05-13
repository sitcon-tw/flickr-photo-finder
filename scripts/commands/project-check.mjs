import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const syntaxRoots = [
  { dir: "scripts/commands", extension: ".mjs" },
  { dir: "scripts/lib", extension: ".mjs" },
  { dir: "scripts/workflows", extension: ".mjs" },
  { dir: "app", extension: ".js" },
  { dir: "apps-script", extension: ".js" },
];

const checks = [
  {
    name: "Language governance",
    command: "pnpm",
    args: ["language:check"],
    next: "Replace vague relative version wording with concrete dates, hashes, schema versions, or current repo source references, then rerun pnpm language:check.",
  },
  {
    name: "Shared value governance",
    command: "pnpm",
    args: ["shared-values:check"],
    next: "Fix data/interface-registry.json or regenerate apps-script/GeneratedConfig.js, then rerun pnpm shared-values:check.",
  },
  {
    name: "Finder core TypeScript check",
    command: "pnpm",
    args: ["finder:core:check"],
    next: "Run pnpm finder:core:build, commit generated app/data-loader.js, app/data-utils.js, app/search-sort.js, or app/url-state.js if they changed, then rerun pnpm finder:core:check.",
  },
  {
    name: "JavaScript syntax",
    run: checkSyntax,
    next: "Fix the syntax error in the reported file, then rerun pnpm project:check.",
  },
  {
    name: "Apps Script generated config sync",
    command: "pnpm",
    args: ["apps-script:build-config", "--", "--check"],
    next: "Run pnpm apps-script:build-config and commit apps-script/GeneratedConfig.js if it changed.",
  },
  {
    name: "Data validation",
    command: "pnpm",
    args: ["data:validate"],
    next: "Fix the reported data/schema issue, then rerun pnpm data:validate.",
  },
  {
    name: "AI fixture validation",
    command: "pnpm",
    args: ["eval:validate-fixtures"],
    next: "Fix fixtures/ai-proposals or the validator, then rerun pnpm eval:validate-fixtures.",
  },
  {
    name: "Finder unit tests",
    command: "pnpm",
    args: ["finder:test"],
    next: "Fix the failing frontend logic test, then rerun pnpm finder:test.",
  },
  {
    name: "React preview typecheck",
    command: "pnpm",
    args: ["finder:react:typecheck"],
    next: "Fix the React preview TypeScript error, then rerun pnpm finder:react:typecheck.",
  },
  {
    name: "React preview build",
    command: "pnpm",
    args: ["finder:react:build"],
    next: "Fix the React preview build error, then rerun pnpm finder:react:build.",
  },
  {
    name: "React preview artifact check",
    command: "pnpm",
    args: ["finder:react:check"],
    next: "Run pnpm finder:react:build if the preview artifact is missing, or fix the React preview artifact check error and rerun pnpm finder:react:check.",
  },
  {
    name: "Finder Pages build",
    command: "pnpm",
    args: ["finder:build"],
    next: "Fix the Pages build error, then rerun pnpm finder:build.",
  },
  {
    name: "Finder Pages artifact check",
    command: "pnpm",
    args: ["finder:check"],
    next: "Run pnpm finder:build if the artifact is missing, or fix the artifact check error and rerun pnpm finder:check.",
  },
];

async function collectFiles(dir, extension) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, extension)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  return result.status ?? 1;
}

async function checkSyntax() {
  const files = (
    await Promise.all(syntaxRoots.map(({ dir, extension }) => collectFiles(dir, extension)))
  )
    .flat()
    .sort();

  for (const file of files) {
    const status = runCommand(process.execPath, ["--check", file]);
    if (status !== 0) {
      console.error(`Syntax check failed: node --check ${file}`);
      return status;
    }
  }

  console.log(`Checked JavaScript syntax for ${files.length} files.`);
  return 0;
}

for (const check of checks) {
  console.log(`\n==> ${check.name}`);
  const status = check.run ? await check.run() : runCommand(check.command, check.args);

  if (status !== 0) {
    console.error(`\nProject check failed during: ${check.name}`);
    console.error(`Next: ${check.next}`);
    process.exit(status);
  }
}

console.log("\nProject check passed.");
