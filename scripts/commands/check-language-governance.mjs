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

const bannedTerms = [
  "新" + "版",
  "新" + "版本",
  "舊" + "版",
  "最新" + "版",
  "較舊" + "版",
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
      for (const term of bannedTerms) {
        if (line.includes(term)) {
          findings.push({ repoPath, lineNumber: index + 1, term, line: line.trim() });
        }
      }
    });
  }

  if (findings.length === 0) {
    console.log("Language governance check passed.");
    return;
  }

  console.error("Language governance check failed: avoid ambiguous relative version wording.");
  console.error("Use concrete wording such as a dated version, prompt hash, schema version, current repo source, or legacy header shape.");
  for (const finding of findings) {
    console.error(`${finding.repoPath}:${finding.lineNumber}: ${finding.term}: ${finding.line}`);
  }
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`Could not run language governance check: ${error.message}`);
  process.exitCode = 1;
}
