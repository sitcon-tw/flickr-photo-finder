import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const scanRoots = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "docs",
  "app",
  "apps-script",
  "scripts",
  "data",
  "prompts",
  "fixtures/ai-proposals/README.md",
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
  // Fixed CFS snapshot text may preserve upstream wording; do not treat it as repo-authored docs.
  "data/sponsorship-items.json",
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

const taiwanTraditionalRules = [
  ["接口", "Use 介面."],
  ["界面", "Use 介面."],
  ["字段", "Use 欄位."],
  ["用户", "Use 使用者."],
  ["用戶", "Use 使用者."],
  ["质量", "Use 品質 when describing quality."],
  ["質量", "Use 品質 when describing quality."],
  ["默认", "Use 預設."],
  ["默認", "Use 預設."],
  ["软件", "Use 軟體."],
  ["軟件", "Use 軟體."],
  ["链接", "Use 連結."],
  ["鏈接", "Use 連結."],
  ["运行", "Use 執行 or 跑 depending on context."],
  ["運行", "Use 執行 or 跑 depending on context."],
  ["视频", "Use 影片."],
  ["視頻", "Use 影片."],
  ["屏幕", "Use 螢幕."],
  ["信息", "Use 資訊."],
  ["文件夹", "Use 資料夾."],
  ["文件夾", "Use 資料夾."],
  ["缺省", "Use 預設."],
  ["设置", "Use 設定."],
  ["导入", "Use 匯入 for data import, or 導入 only when describing adoption of a capability."],
  ["导出", "Use 匯出."],
  ["導出", "Use 匯出."],
].map(([term, guidance]) => exactRule(`taiwan-wording-${term}`, term, guidance));

const languageRules = [
  ...relativeWordingRules,
  ...taiwanTraditionalRules,
  {
    id: "taiwan-wording-只讀",
    pattern: /只讀(?!取)/u,
    guidance: "Use 唯讀 for read-only, or 只讀取 when the sentence means only reads.",
  },
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactRule(id, term, guidance) {
  return {
    id,
    pattern: new RegExp(escapeRegExp(term), "u"),
    guidance,
  };
}

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
      for (const rule of languageRules) {
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

  console.error("Language governance check failed: revise ambiguous wording or non-Taiwan Traditional Chinese terms.");
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
