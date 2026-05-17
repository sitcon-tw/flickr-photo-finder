import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const scanRoots = [
  "README.md",
  "docs",
  "app",
  "apps-script",
  "scripts",
  "data",
  "prompts",
  ".github",
];
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".txt",
  ".yml",
  ".yaml",
]);
const ignoredPaths = new Set([
  "scripts/commands/check-language-governance.mjs",
]);

const relativeWordingRules = [
  {
    id: "relative-state-zh",
    pattern: /最新|新版|新版本|舊版|舊版本|較新版|較新版本|較舊版|較舊版本|新格式|舊格式|目前版本|現行版本/,
    guidance: "Use concrete wording such as a dated version, prompt hash, schema version, header shape, target name, or current repo source.",
  },
  {
    id: "relative-state-en",
    pattern: /\b(latest|new version|old version|current version|newer version|older version)\b/i,
    allow: [/ubuntu-latest/],
    guidance: "Use a dated version, exact tool/runtime version, commit, tag, schema version, or named target instead.",
  },
];

function extensionOf(path) {
  const match = path.match(/\.[^.]+$/);
  return match ? match[0] : "";
}

async function listFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function candidateFiles() {
  const files = [];
  for (const scanRoot of scanRoots) {
    const fullPath = join(root, scanRoot);
    if (scanRoot.includes(".")) {
      files.push(fullPath);
    } else {
      files.push(...await listFiles(fullPath));
    }
  }
  return files
    .map((file) => ({ fullPath: file, repoPath: relative(root, file) }))
    .filter(({ repoPath }) => !ignoredPaths.has(repoPath))
    .filter(({ fullPath }) => textExtensions.has(extensionOf(fullPath)));
}

async function main() {
  const findings = [];
  for (const { fullPath, repoPath } of await candidateFiles()) {
    const text = await readFile(fullPath, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of relativeWordingRules) {
        if (rule.pattern.test(line) && !(rule.allow ?? []).some((allowedPattern) => allowedPattern.test(line))) {
          findings.push({
            repoPath,
            lineNumber: index + 1,
            rule: rule.id,
            guidance: rule.guidance,
            line: line.trim(),
          });
        }
      }
    });
  }

  if (findings.length === 0) {
    console.log("Language governance check passed.");
    return;
  }

  console.error("Language governance check failed: avoid ambiguous relative version or state wording.");
  for (const finding of findings) {
    console.error(`${finding.repoPath}:${finding.lineNumber}: ${finding.rule}: ${finding.line}`);
    console.error(`  ${finding.guidance}`);
  }
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`Could not run language governance check: ${error.message}`);
  process.exitCode = 1;
}
