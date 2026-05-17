import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const markdownEntrypoints = ["README.md", "AGENTS.md", "docs"];
const packageManagerBuiltins = new Set([
  "add",
  "dlx",
  "exec",
  "install",
  "remove",
  "update",
]);
const pnpmOptionArgs = new Set(["--dir", "-C", "--filter", "-F"]);

function printUsage() {
  console.log(`Usage: pnpm docs:check

Checks documentation governance rules that should stay automated:
  - local Markdown links resolve
  - docs/README.md mentions every top-level docs/*.md file
  - docs/adr/README.md mentions every ADR file
  - documented pnpm script references point to package.json scripts

This does not verify external URLs or prose quality.
`);
}

function toRepoPath(filePath) {
  return filePath.split(path.sep).join("/");
}

async function collectMarkdownFiles(entry) {
  const entryStat = await stat(entry);
  if (entryStat.isFile()) {
    return entry.endsWith(".md") ? [entry] : [];
  }

  const entries = await readdir(entry, { withFileTypes: true });
  const files = [];
  for (const dirent of entries) {
    const fullPath = path.join(entry, dirent.name);
    if (dirent.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
    } else if (dirent.isFile() && dirent.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripTitleFromLinkTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (trimmed.startsWith("<")) {
    const end = trimmed.indexOf(">");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  return trimmed.split(/\s+/)[0];
}

function normalizedLocalTarget(rawTarget) {
  const target = stripTitleFromLinkTarget(rawTarget);
  if (!target || target.startsWith("#")) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//")) {
    return null;
  }

  const withoutAnchor = target.split("#")[0].split("?")[0];
  if (!withoutAnchor) {
    return null;
  }

  try {
    return decodeURI(withoutAnchor);
  } catch {
    return withoutAnchor;
  }
}

function markdownLinks(text) {
  const links = [];
  const linkPattern = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    links.push({ rawTarget: match[1], offset: match.index ?? 0 });
  }
  return links;
}

function lineNumberAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

async function checkLocalLinks(markdownFiles) {
  const findings = [];
  for (const file of markdownFiles) {
    const text = await readFile(file, "utf8");
    for (const link of markdownLinks(text)) {
      const target = normalizedLocalTarget(link.rawTarget);
      if (!target) {
        continue;
      }

      const resolved = path.normalize(path.join(path.dirname(file), target));
      if (!existsSync(resolved)) {
        findings.push({
          type: "broken-local-link",
          file,
          line: lineNumberAt(text, link.offset),
          message: `${link.rawTarget} -> ${toRepoPath(resolved)}`,
        });
      }
    }
  }
  return findings;
}

async function checkDocsIndex() {
  const findings = [];
  const docsIndex = await readFile("docs/README.md", "utf8");
  const docsEntries = await readdir("docs", { withFileTypes: true });
  const topLevelDocs = docsEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort();

  for (const fileName of topLevelDocs) {
    if (!docsIndex.includes(fileName)) {
      findings.push({
        type: "missing-docs-index-entry",
        file: "docs/README.md",
        line: 1,
        message: `docs/${fileName} is not mentioned in docs/README.md`,
      });
    }
  }

  const adrIndex = await readFile("docs/adr/README.md", "utf8");
  const adrEntries = await readdir("docs/adr", { withFileTypes: true });
  const adrDocs = adrEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort();

  for (const fileName of adrDocs) {
    if (!adrIndex.includes(fileName)) {
      findings.push({
        type: "missing-adr-index-entry",
        file: "docs/adr/README.md",
        line: 1,
        message: `docs/adr/${fileName} is not mentioned in docs/adr/README.md`,
      });
    }
  }

  return findings;
}

function fencedCodeBlocks(text) {
  const blocks = [];
  const fencePattern = /```[^\n`]*\n([\s\S]*?)```/g;
  for (const match of text.matchAll(fencePattern)) {
    blocks.push({ text: match[1], offset: match.index ?? 0 });
  }
  return blocks;
}

function inlineCodeSpans(text) {
  const spans = [];
  const spanPattern = /`([^`\n]+)`/g;
  for (const match of text.matchAll(spanPattern)) {
    if (match[1].includes("pnpm ")) {
      spans.push({ text: match[1], offset: match.index ?? 0 });
    }
  }
  return spans;
}

function firstScriptTokenAfterPnpm(commandText) {
  const match = commandText.match(/\bpnpm\s+(.+)/);
  if (!match) {
    return null;
  }

  const tokens = match[1].trim().split(/\s+/);
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "--") {
      return null;
    }
    if (token === "run") {
      return tokens[index + 1] ?? null;
    }
    if (pnpmOptionArgs.has(token)) {
      index += 2;
      continue;
    }
    if (token.startsWith("-")) {
      index += 1;
      continue;
    }
    return token;
  }
  return null;
}

function pnpmInvocations(text) {
  const invocations = [];
  const commandPattern = /\bpnpm\s+[^`;&|\n)]+/g;
  for (const match of text.matchAll(commandPattern)) {
    const script = firstScriptTokenAfterPnpm(match[0]);
    if (script) {
      invocations.push({ script, offset: match.index ?? 0, command: match[0].trim() });
    }
  }
  return invocations;
}

async function checkDocumentedPnpmScripts(markdownFiles) {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
  const findings = [];

  for (const file of markdownFiles) {
    const text = await readFile(file, "utf8");
    const snippets = [...fencedCodeBlocks(text), ...inlineCodeSpans(text)];
    for (const snippet of snippets) {
      for (const invocation of pnpmInvocations(snippet.text)) {
        const script = invocation.script;
        if (scripts.has(script) || packageManagerBuiltins.has(script)) {
          continue;
        }
        findings.push({
          type: "unknown-pnpm-script",
          file,
          line: lineNumberAt(text, snippet.offset + invocation.offset),
          message: `${invocation.command} references missing package.json script "${script}"`,
        });
      }
    }
  }

  return findings;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  const markdownFiles = (await Promise.all(markdownEntrypoints.map((entry) => collectMarkdownFiles(entry))))
    .flat()
    .map(toRepoPath)
    .sort();

  const findings = [
    ...(await checkLocalLinks(markdownFiles)),
    ...(await checkDocsIndex()),
    ...(await checkDocumentedPnpmScripts(markdownFiles)),
  ];

  if (findings.length === 0) {
    console.log(`Documentation governance check passed (${markdownFiles.length} Markdown files).`);
    return;
  }

  console.error("Documentation governance check failed.");
  for (const finding of findings) {
    console.error(`${toRepoPath(finding.file)}:${finding.line}: ${finding.type}: ${finding.message}`);
  }
  process.exitCode = 1;
}

await main();
