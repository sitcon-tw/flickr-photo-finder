import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { getAiLabelingPromptMetadata } from "../lib/ai/ai-labeling-prompt.mjs";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultOutputRoot = "tmp/prompt-reviews";
const proposalFile = "metadata-proposals.json";
const reviewSummaryFile = "metadata-review-summary.md";
const expertRoles = [
  {
    id: "prompt-architecture",
    title: "Prompt 架構",
    focus: "找圖成功標準、欄位分層、optional gate、confidence 策略。",
  },
  {
    id: "schema-governance",
    title: "Schema / 資料治理",
    focus: "判斷既有欄位是否足以承接 prompt 改善，以及何時才需要 schema 或 taxonomy 變更。",
  },
  {
    id: "evaluation-workflow",
    title: "評估與 workflow",
    focus: "串接 eval:sample、ai:review、ai:report、eval:search，讓調整可被驗證。",
  },
  {
    id: "human-review-cost",
    title: "人工審核成本",
    focus: "判斷哪些欄位能降低整理與找圖成本，哪些欄位會增加抽查負擔。",
  },
];
const hashedFiles = [
  "prompts/ai-labeling.md",
  "data/photo-schema.json",
  "data/tag-taxonomy.json",
  "data/sponsorship-items.json",
  "data/search-aliases.json",
];

function printUsage() {
  console.log(`Usage:
  pnpm eval:prompt-review -- --mode prepare --runs <run-dir> [run-dir...] --output tmp/prompt-reviews/<review-id>
  pnpm eval:prompt-review -- --mode compile --review-dir tmp/prompt-reviews/<review-id>

Options:
  --mode <mode>        prepare or compile. Default: prepare.
  --runs <dirs...>     Run or attempt directories to include. Values are read until the next option.
  --run <dir>          Add one run directory. Can be repeated.
  --output <dir>       Output review directory for prepare mode. Default: tmp/prompt-reviews/<timestamp>.
  --review-dir <dir>   Existing review directory for compile mode.
  --queries <path>     Optional eval:search query file captured during prepare.
  --scoring <mode>     eval:search scoring mode when --queries is set. Default: idf.
  --top <number>       eval:search result count when --queries is set. Default: 5.
  --help, -h           Show this help.

This command builds a prompt review decision package. It does not call an LLM,
assign reviewers, modify prompts or schemas, update AI runs, or write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    mode: "prepare",
    outputDir: "",
    queriesPath: "",
    reviewDir: "",
    runDirs: [],
    scoring: "idf",
    top: 5,
  };

  function nextValue(index, optionName) {
    const value = args[index + 1] ?? "";
    if (!value || value.startsWith("--")) {
      throw new Error(`${optionName} requires a value`);
    }
    return value;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--mode") {
      options.mode = nextValue(index, arg);
      index += 1;
    } else if (arg === "--runs") {
      index += 1;
      while (index < args.length && !args[index].startsWith("--")) {
        options.runDirs.push(args[index]);
        index += 1;
      }
      index -= 1;
    } else if (arg === "--run") {
      options.runDirs.push(nextValue(index, arg));
      index += 1;
    } else if (arg === "--output") {
      options.outputDir = nextValue(index, arg);
      index += 1;
    } else if (arg === "--review-dir") {
      options.reviewDir = nextValue(index, arg);
      index += 1;
    } else if (arg === "--queries") {
      options.queriesPath = nextValue(index, arg);
      index += 1;
    } else if (arg === "--scoring") {
      options.scoring = nextValue(index, arg);
      index += 1;
    } else if (arg === "--top") {
      options.top = Number(nextValue(index, arg));
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!["prepare", "compile"].includes(options.mode)) {
      throw new Error("--mode must be one of: prepare, compile");
    }
    if (options.mode === "prepare" && options.runDirs.length === 0) {
      throw new Error("prepare mode requires --runs or --run");
    }
    if (options.mode === "compile" && !options.reviewDir) {
      throw new Error("compile mode requires --review-dir");
    }
    if (!Number.isInteger(options.top) || options.top < 1) {
      throw new Error("--top must be a positive integer");
    }
    if (options.mode === "prepare" && !options.outputDir) {
      options.outputDir = join(defaultOutputRoot, `prompt-review-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
    }
  }

  return options;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileMtimeMs(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  if (!(await pathExists(path))) {
    return null;
  }
  return readJson(path);
}

async function hashFile(path) {
  const text = await readFile(path, "utf8");
  return createHash("sha256").update(text).digest("hex");
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.trim();
}

function defaultRunBaseId(manifest, attempt) {
  return attempt?.base_run_id || manifest.base_run_id || manifest.run_id || "";
}

function shortHash(value) {
  return value ? String(value).slice(0, 12) : "";
}

async function inspectRun(runDir, currentPromptHash) {
  const manifestPath = join(runDir, "manifest.json");
  const proposalPath = join(runDir, proposalFile);
  const reviewSummaryPath = join(runDir, reviewSummaryFile);
  const attemptPath = join(runDir, "attempt.json");
  const photosPath = join(runDir, "photos.json");
  const manifest = await readJson(manifestPath);
  const attempt = await readJsonIfExists(attemptPath);
  const proposals = await readJsonIfExists(proposalPath);
  const photos = await readJsonIfExists(photosPath);
  const warnings = [];
  const reviewSummaryExists = await pathExists(reviewSummaryPath);
  const proposalMtime = await fileMtimeMs(proposalPath);
  const reviewSummaryMtime = await fileMtimeMs(reviewSummaryPath);
  const reviewSummaryStale = reviewSummaryExists && proposalMtime > reviewSummaryMtime;
  let validation = {
    error: "",
    item_count: Array.isArray(proposals?.items) ? proposals.items.length : 0,
    status: proposals ? "not-run" : "missing",
    warning_count: 0,
    warnings: [],
  };

  if (!proposals) {
    warnings.push("metadata-proposals.json is missing; expert review can still inspect setup, but proposal quality evidence is unavailable.");
  } else {
    try {
      const result = await validateAiProposals({ proposalsPath: proposalPath, runDir });
      validation = {
        error: "",
        item_count: result.itemCount,
        status: "valid",
        warning_count: result.warnings.length,
        warnings: result.warnings,
      };
    } catch (error) {
      validation = {
        error: error.message,
        item_count: Array.isArray(proposals.items) ? proposals.items.length : 0,
        status: "invalid",
        warning_count: 0,
        warnings: [],
      };
      warnings.push("metadata-proposals.json does not pass ai:validate; treat this run as contract-failed evidence.");
    }
  }

  if (!reviewSummaryExists) {
    warnings.push("metadata-review-summary.md is missing; run pnpm ai:review before relying on Review Focus evidence.");
  } else if (reviewSummaryStale) {
    warnings.push("metadata-review-summary.md is older than metadata-proposals.json; rerun pnpm ai:review before quality comparison.");
  }

  if (!manifest.prompt_template_sha256) {
    warnings.push("manifest.json does not record prompt_template_sha256; prompt version is unknown.");
  } else if (manifest.prompt_template_sha256 !== currentPromptHash) {
    warnings.push(`manifest prompt hash ${shortHash(manifest.prompt_template_sha256)} differs from current repo prompt ${shortHash(currentPromptHash)}.`);
  }

  return {
    attempt: attempt
      ? {
        base_run_id: attempt.base_run_id || "",
        label: attempt.label || "",
        model: attempt.model || "",
        round: attempt.round ?? "",
        source_run_id: attempt.source_run_id || "",
      }
      : null,
    base_run_id: defaultRunBaseId(manifest, attempt),
    dir: runDir,
    manifest: {
      created_at: manifest.created_at || "",
      image_size: manifest.image_size || "",
      prompt_template_path: manifest.prompt_template_path || "",
      prompt_template_sha256: manifest.prompt_template_sha256 || "",
      requested_focus: manifest.requested_focus || "",
      run_id: manifest.run_id || basename(runDir),
      selected_photo_count: manifest.selected_photo_count ?? (Array.isArray(photos) ? photos.length : null),
    },
    paths: {
      manifest: manifestPath,
      proposals: proposalPath,
      review_summary: reviewSummaryPath,
    },
    producer: {
      name: proposals?.producer?.name || "",
      type: proposals?.producer?.type || "",
    },
    review_summary: {
      exists: reviewSummaryExists,
      stale: reviewSummaryStale,
    },
    validation,
    warnings,
  };
}

async function buildRepoEvidence(argv) {
  const promptMetadata = getAiLabelingPromptMetadata();
  const fileHashes = {};
  for (const path of hashedFiles) {
    fileHashes[path] = await hashFile(path);
  }

  return {
    command_argv: argv.slice(2),
    created_at: new Date().toISOString(),
    file_hashes: fileHashes,
    git: {
      branch: runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
      commit: runGit(["rev-parse", "HEAD"]),
      status_short: runGit(["status", "--short"]),
    },
    prompt_template_path: promptMetadata.prompt_template_path,
    prompt_template_sha256: promptMetadata.prompt_template_sha256,
  };
}

function crossRunWarnings(runs) {
  const warnings = [];
  const promptHashes = new Set(runs.map((run) => run.manifest.prompt_template_sha256).filter(Boolean));
  const baseRunIds = new Set(runs.map((run) => run.base_run_id).filter(Boolean));

  if (promptHashes.size > 1) {
    warnings.push(`Runs do not share one prompt_template_sha256: ${[...promptHashes].map(shortHash).join(", ")}.`);
  }
  if (runs.some((run) => !run.manifest.prompt_template_sha256)) {
    warnings.push("At least one run does not record prompt_template_sha256; fair prompt comparison is unknown.");
  }
  if (baseRunIds.size > 1) {
    warnings.push(`Runs do not share one base run id: ${[...baseRunIds].join(", ")}.`);
  }

  return warnings;
}

function renderExpertPrompt(role, manifestPath) {
  return `# ${role.title}角色審查

請只做唯讀分析，不要修改 repo、AI run 或 Google Sheets。

## 審查重點

${role.focus}

## 證據包

- 請先閱讀：\`${manifestPath}\`
- 依 manifest 中的 run、prompt hash、review warnings、search/report hints 判斷。
- 若有額外 repo 文件需要佐證，請明確引用檔案路徑與段落。

## 輸出格式

請在 \`expert-reviews/${role.id}.md\` 或同名 JSON 中回覆，至少包含：

- Review provenance（審查來源）：\`reviewer_type\`（independent-agent / same-agent）、\`reviewer_id\`、\`session_id\`、是否獨立閱讀 evidence、是否與其他 review 共用同一個 agent context
- 確認事實
- 推測或判斷
- 風險
- 可行建議
- 不建議做的事
- 需要 owner 決策的問題

若同一個 agent 依多個角色撰寫 review，或無法確認不同 review 的獨立性，請標示為 same-agent synthesis；這不應被描述為獨立審查共識。

JSON review 建議使用：

\`\`\`json
{
  "review_provenance": {
    "reviewer_type": "independent-agent | same-agent",
    "reviewer_id": "",
    "session_id": "",
    "independent_evidence_read": true,
    "shared_context_with": "",
    "notes": ""
  }
}
\`\`\`

請把建議標成 prompt / validator / search / docs / schema / no-change，方便 compile 階段彙整。
`;
}

function reportCommand(runDirs) {
  const command = runDirs.length > 1
    ? ["pnpm", "ai:report", "--", "--runs", ...runDirs]
    : ["pnpm", "ai:report", "--", "--run", runDirs[0]];
  return command.join(" ");
}

function runSearch({ outputPath, queriesPath, runDir, scoring, top }) {
  const args = [
    "eval:search",
    "--",
    "--run-dir",
    runDir,
    "--queries",
    queriesPath,
    "--scoring",
    scoring,
    "--top",
    String(top),
  ];
  const result = spawnSync("pnpm", args, { encoding: "utf8" });
  const text = [
    `$ pnpm ${args.join(" ")}`,
    "",
    result.stdout || "",
    result.stderr ? `\nSTDERR:\n${result.stderr}` : "",
  ].join("\n").trim();
  return writeFile(outputPath, `${text}\n`).then(() => ({
    command: `pnpm ${args.join(" ")}`,
    output_path: outputPath,
    status: result.status ?? 1,
  }));
}

async function prepareReviewPackage(options) {
  const outputDir = options.outputDir;
  const expertPromptDir = join(outputDir, "expert-prompts");
  const expertReviewDir = join(outputDir, "expert-reviews");
  const searchResultsDir = join(outputDir, "search-results");
  await Promise.all([
    mkdir(expertPromptDir, { recursive: true }),
    mkdir(expertReviewDir, { recursive: true }),
    mkdir(searchResultsDir, { recursive: true }),
  ]);

  const repo = await buildRepoEvidence(process.argv);
  const runs = [];
  for (const runDir of options.runDirs) {
    runs.push(await inspectRun(runDir, repo.prompt_template_sha256));
  }
  const warnings = [
    ...crossRunWarnings(runs),
    ...runs.flatMap((run) => run.warnings.map((warning) => `${run.manifest.run_id}: ${warning}`)),
  ];
  const inputManifest = {
    version: 1,
    mode: "prepare",
    output_dir: outputDir,
    repo,
    runs,
    search: {
      queries_path: options.queriesPath || "",
      scoring: options.scoring,
      top: options.top,
    },
    warnings,
  };

  const manifestPath = join(outputDir, "input-manifest.json");

  const searchResults = [];
  if (options.queriesPath) {
    for (const run of runs) {
      const outputPath = join(searchResultsDir, `${run.manifest.run_id}.txt`);
      const result = await runSearch({
        outputPath,
        queriesPath: options.queriesPath,
        runDir: run.dir,
        scoring: options.scoring,
        top: options.top,
      });
      searchResults.push(result);
      if (result.status !== 0) {
        warnings.push(`${run.manifest.run_id}: eval:search failed; inspect ${outputPath}.`);
      }
    }
  }

  await writeFile(manifestPath, `${JSON.stringify(inputManifest, null, 2)}\n`);

  for (const role of expertRoles) {
    await writeFile(join(expertPromptDir, `${role.id}.md`), renderExpertPrompt(role, manifestPath));
  }

  const reportLinks = {
    generated_reports: [],
    search_results: searchResults,
    suggested_report_command: reportCommand(options.runDirs),
  };
  await writeFile(join(outputDir, "report-links.json"), `${JSON.stringify(reportLinks, null, 2)}\n`);

  console.log(`Prompt review package prepared: ${outputDir}`);
  console.log(`- manifest: ${manifestPath}`);
  console.log(`- expert prompts: ${expertPromptDir}`);
  console.log(`- expert reviews: ${expertReviewDir}`);
  console.log(`- suggested report: ${reportLinks.suggested_report_command}`);
  if (warnings.length > 0) {
    console.log(`- warnings: ${warnings.length}`);
  }
  return { inputManifest, reportLinks };
}

async function listExpertReviewFiles(reviewDir) {
  const dir = join(reviewDir, "expert-reviews");
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && /\.(md|json)$/.test(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort();
}

function roleFromMarkdown(path, text) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(path).replace(/\.(md|json)$/, "");
}

function normalizeReviewProvenance(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return {
    independent_evidence_read: value.independent_evidence_read ?? value.independentEvidenceRead ?? "",
    notes: typeof value.notes === "string" ? value.notes : "",
    reviewer_id: typeof value.reviewer_id === "string"
      ? value.reviewer_id
      : typeof value.reviewerId === "string"
        ? value.reviewerId
        : "",
    reviewer_type: typeof value.reviewer_type === "string"
      ? value.reviewer_type
      : typeof value.reviewerType === "string"
        ? value.reviewerType
        : "",
    session_id: typeof value.session_id === "string"
      ? value.session_id
      : typeof value.sessionId === "string"
        ? value.sessionId
        : "",
    shared_context_with: typeof value.shared_context_with === "string"
      ? value.shared_context_with
      : typeof value.sharedContextWith === "string"
        ? value.sharedContextWith
        : "",
  };
}

function reviewProvenanceSummary(provenance) {
  const type = provenance?.reviewer_type || "not-declared";
  const reviewer = provenance?.reviewer_id || "";
  const session = provenance?.session_id || "";
  const independent = provenance?.independent_evidence_read === true
    ? "yes"
    : provenance?.independent_evidence_read === false
      ? "no"
      : "not-declared";
  const shared = provenance?.shared_context_with || "";
  const parts = [`type=${type}`, `independent_evidence_read=${independent}`];
  if (reviewer) {
    parts.push(`reviewer=${reviewer}`);
  }
  if (session) {
    parts.push(`session=${session}`);
  }
  if (shared) {
    parts.push(`shared_context_with=${shared}`);
  }
  return parts.join("; ");
}

async function readExpertReview(path) {
  const text = await readFile(path, "utf8");
  if (path.endsWith(".json")) {
    const parsed = JSON.parse(text);
    return {
      actionable_recommendations: Array.isArray(parsed.actionable_recommendations) ? parsed.actionable_recommendations : [],
      content: text,
      format: "json",
      path,
      review_provenance: normalizeReviewProvenance(parsed.review_provenance ?? parsed.provenance),
      role: parsed.role || basename(path, ".json"),
      summary: parsed.summary || "",
    };
  }
  return {
    actionable_recommendations: [],
    content: text,
    format: "markdown",
    path,
    review_provenance: {},
    role: roleFromMarkdown(path, text),
    summary: "",
  };
}

function renderDecisionPackage({ expertReviews, inputManifest, reportLinks, reviewDir }) {
  const lines = [
    "# AI 標記 Prompt Review 決策包",
    "",
    "## Package",
    "",
    `- Review dir: \`${reviewDir}\``,
    `- Created at: \`${new Date().toISOString()}\``,
    `- Prompt hash: \`${shortHash(inputManifest.repo?.prompt_template_sha256)}\``,
    `- Suggested report: \`${reportLinks.suggested_report_command || ""}\``,
    "",
    "## Runs",
    "",
    "| run | producer | items | validation | warnings | prompt | notes |",
    "| --- | --- | ---: | --- | ---: | --- | --- |",
  ];

  for (const run of inputManifest.runs ?? []) {
    lines.push([
      `\`${run.manifest.run_id}\``,
      run.producer?.name || "",
      run.validation?.item_count ?? 0,
      run.validation?.status || "",
      run.validation?.warning_count ?? 0,
      shortHash(run.manifest.prompt_template_sha256),
      run.warnings?.length ? `${run.warnings.length} warning(s)` : "",
    ].join(" | "));
  }

  lines.push("", "## Package Warnings", "");
  if (inputManifest.warnings?.length) {
    for (const warning of inputManifest.warnings) {
      lines.push(`- ${warning}`);
    }
  } else {
    lines.push("- No package-level warnings.");
  }

  lines.push("", "## Expert Reviews", "");
  if (expertReviews.length === 0) {
    lines.push("- No expert review files found under `expert-reviews/` yet.");
  } else {
    lines.push(
      "| role | provenance |",
      "| --- | --- |",
    );
    for (const review of expertReviews) {
      lines.push(`| ${review.role} | ${reviewProvenanceSummary(review.review_provenance)} |`);
    }
    lines.push("");
    for (const review of expertReviews) {
      lines.push(`### ${review.role}`, "");
      lines.push(`- Source: \`${relative(reviewDir, review.path)}\``);
      lines.push(`- Provenance: ${reviewProvenanceSummary(review.review_provenance)}`);
      if (review.summary) {
        lines.push(`- Summary: ${review.summary}`);
      }
      if (review.actionable_recommendations.length > 0) {
        lines.push("- Actionable recommendations:");
        for (const recommendation of review.actionable_recommendations) {
          const area = recommendation.area || recommendation.type || "unspecified";
          const title = recommendation.title || recommendation.summary || JSON.stringify(recommendation);
          lines.push(`  - [${area}] ${title}`);
        }
      } else {
        lines.push("- Actionable recommendations: see source review.");
      }
      if (review.format === "markdown") {
        lines.push("", "<details>", `<summary>${review.role} full review</summary>`, "");
        lines.push(review.content.trim());
        lines.push("", "</details>", "");
      }
    }
  }

  lines.push(
    "",
    "## Owner Decisions",
    "",
    "| decision | status | notes |",
    "| --- | --- | --- |",
    "| Adopt prompt changes | pending | |",
    "| Adopt validator/search/docs changes | pending | |",
    "| Open schema/taxonomy change slice | pending | |",
    "",
    "## Suggested Implementation Slices",
    "",
    "1. Update prompt wording and optional gates only after owner accepts this package.",
    "2. Update docs and review warnings only when recommendations cite concrete evidence.",
    "3. Treat schema/taxonomy changes as a separate package with migration planning.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

async function compileDecisionPackage(options) {
  const reviewDir = options.reviewDir;
  const [inputManifest, reportLinks] = await Promise.all([
    readJson(join(reviewDir, "input-manifest.json")),
    readJsonIfExists(join(reviewDir, "report-links.json")),
  ]);
  const expertReviews = [];
  for (const path of await listExpertReviewFiles(reviewDir)) {
    expertReviews.push(await readExpertReview(path));
  }
  const payload = {
    created_at: new Date().toISOString(),
    expert_reviews: expertReviews.map((review) => ({
      actionable_recommendations: review.actionable_recommendations,
      format: review.format,
      path: review.path,
      review_provenance: review.review_provenance,
      role: review.role,
      summary: review.summary,
    })),
    input_manifest_path: join(reviewDir, "input-manifest.json"),
    review_dir: reviewDir,
    run_count: inputManifest.runs?.length ?? 0,
    warnings: inputManifest.warnings ?? [],
  };
  const markdown = renderDecisionPackage({
    expertReviews,
    inputManifest,
    reportLinks: reportLinks ?? {},
    reviewDir,
  });

  await Promise.all([
    writeFile(join(reviewDir, "decision-package.md"), markdown),
    writeFile(join(reviewDir, "decision-package.json"), `${JSON.stringify(payload, null, 2)}\n`),
  ]);

  console.log(`Prompt review decision package compiled: ${reviewDir}`);
  console.log(`- expert reviews: ${expertReviews.length}`);
  console.log(`- markdown: ${join(reviewDir, "decision-package.md")}`);
  console.log(`- json: ${join(reviewDir, "decision-package.json")}`);
  return { markdown, payload };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  if (options.mode === "prepare") {
    await prepareReviewPackage(options);
    return;
  }
  await compileDecisionPackage(options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not build prompt review package: ${error.message}`);
    process.exitCode = 1;
  }
}

export {
  compileDecisionPackage,
  expertRoles,
  parseArgs,
  prepareReviewPackage,
};
