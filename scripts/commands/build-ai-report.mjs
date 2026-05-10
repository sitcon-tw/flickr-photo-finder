import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { getAiLabelingPromptMetadata } from "../lib/ai/ai-labeling-prompt.mjs";
import { defaultMetadataDisplayContext, fieldLabel } from "../lib/core/metadata-display.mjs";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultOutputRoot = "tmp/ai-reports";
const proposalFile = "metadata-proposals.json";
const reviewSummaryFile = "metadata-review-summary.md";
const updatePlanFile = "metadata-update-plan.json";

const preferredFieldOrder = [
  "people_count",
  "subject_type",
  "orientation",
  "has_negative_space",
  "safe_crop",
  "visual_description",
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "sponsorship_items",
  "sponsorship_tags",
  "public_use_status",
  "priority_level",
  "collections",
  "curation_status",
];

function printUsage() {
  console.log(`Usage:
  pnpm ai:report -- --runs <run-dir> <run-dir> [...]

Options:
  --runs <dirs...>     Run or attempt directories to compare. Values are read until the next option.
  --run <dir>          Add one run directory. Can be repeated.
  --mode <mode>        Report mode: auto, single, or compare. Default: auto.
  --output <dir>       Output report directory. Default: tmp/ai-reports/<timestamp>.
  --title <text>       Report title. Default depends on report mode.
  --help, -h           Show this help.

The command writes a read-only static HTML report. It does not call an LLM,
fetch images, modify proposals, or write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    mode: "auto",
    outputDir: "",
    runDirs: [],
    title: "",
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
    } else if (arg === "--mode") {
      options.mode = nextValue(index, arg);
      index += 1;
    } else if (arg === "--title") {
      options.title = nextValue(index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (options.runDirs.length === 0) {
      throw new Error("--runs or --run requires at least one run directory");
    }
    if (!["auto", "single", "compare"].includes(options.mode)) {
      throw new Error("--mode must be one of: auto, single, compare");
    }
    if (options.mode === "single" && options.runDirs.length !== 1) {
      throw new Error("--mode single requires exactly one run directory");
    }
    if (!options.outputDir) {
      options.outputDir = join(defaultOutputRoot, `ai-report-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);
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

function formatRunLabel({ attempt, manifest, proposals, runDir }) {
  if (attempt?.model) {
    const round = attempt.round ? ` r${attempt.round}` : "";
    const label = attempt.label ? ` ${attempt.label}` : "";
    return `${attempt.model}${round}${label}`;
  }
  if (proposals?.producer?.name) {
    return proposals.producer.name;
  }
  return manifest.run_id || basename(runDir);
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return JSON.stringify([...value].sort());
  }
  return JSON.stringify(value);
}

function parseMarkdownTableLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return [];
  }
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.replaceAll("\\|", "|").trim());
}

async function readReviewFocus(summaryPath) {
  let text = "";
  try {
    text = await readFile(summaryPath, "utf8");
  } catch {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Review Focus");
  if (start === -1) {
    return [];
  }

  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    const cells = parseMarkdownTableLine(line);
    if (cells.length !== 5 || cells[0] === "issue" || cells.every((cell) => /^-+$/.test(cell))) {
      continue;
    }
    const [issue, photoId, field, proposed, reason] = cells;
    if (!issue || !photoId) {
      continue;
    }
    const rawFieldMatch = field.match(/\(([^()]+)\)$/);
    const normalizedField = rawFieldMatch && defaultMetadataDisplayContext.fieldByName.has(rawFieldMatch[1])
      ? rawFieldMatch[1]
      : field;
    rows.push({
      field: normalizedField,
      issue,
      photo_id: photoId,
      proposed,
      reason,
    });
  }
  return rows;
}

function splitErrorLines(error) {
  return String(error?.message ?? error)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function validateRun(runDir, proposalsPath) {
  try {
    const result = await validateAiProposals({ proposalsPath, runDir });
    return {
      error_count: 0,
      errors: [],
      item_count: result.itemCount,
      status: "valid",
      warning_count: result.warnings.length,
      warnings: result.warnings.slice(0, 80),
    };
  } catch (error) {
    const errors = splitErrorLines(error);
    return {
      error_count: errors.length,
      errors: errors.slice(0, 80),
      item_count: 0,
      status: "invalid",
      warning_count: 0,
      warnings: [],
    };
  }
}

async function loadRun(runDir) {
  const manifest = await readJson(join(runDir, "manifest.json"));
  const photos = await readJson(join(runDir, "photos.json"));
  const attempt = await readJsonIfExists(join(runDir, "attempt.json"));
  const proposalsPath = join(runDir, proposalFile);
  const proposals = await readJsonIfExists(proposalsPath);
  const updatePlan = await readJsonIfExists(join(runDir, updatePlanFile));
  const summaryPath = join(runDir, reviewSummaryFile);
  const hasReviewSummary = await pathExists(summaryPath);
  const summaryMtime = await fileMtimeMs(summaryPath);
  const proposalsMtime = await fileMtimeMs(proposalsPath);
  const isReviewSummaryStale = Boolean(proposals && hasReviewSummary && summaryMtime < proposalsMtime);
  const reviewFocus = await readReviewFocus(summaryPath);
  const validation = proposals
    ? await validateRun(runDir, proposalsPath)
    : { error_count: 0, errors: [], item_count: 0, status: "missing", warning_count: 0, warnings: [] };

  const itemsByPhotoId = new Map();
  const fields = new Set();
  for (const item of proposals?.items ?? []) {
    if (!item?.photo_id || !item.fields) {
      continue;
    }
    itemsByPhotoId.set(item.photo_id, item);
    Object.keys(item.fields).forEach((field) => fields.add(field));
  }

  const planUpdates = Array.isArray(updatePlan?.updates) ? updatePlan.updates.length : null;

  return {
    attempt,
    baseRunId: attempt?.base_run_id || manifest.base_run_id || manifest.run_id || "",
    fields,
    hasReviewSummary,
    isReviewSummaryStale,
    itemsByPhotoId,
    label: formatRunLabel({ attempt, manifest, proposals, runDir }),
    manifest,
    photoIds: new Set(Array.isArray(photos) ? photos.map((photo) => photo.photo_id).filter(Boolean) : []),
    photos: Array.isArray(photos) ? photos : [],
    planUpdates,
    proposals,
    reviewFocus,
    runDir,
    validation,
  };
}

function uniquePhotoOrder(runs) {
  const seen = new Set();
  const ids = [];
  for (const run of runs) {
    for (const photo of run.photos) {
      if (!photo.photo_id || seen.has(photo.photo_id)) {
        continue;
      }
      seen.add(photo.photo_id);
      ids.push(photo.photo_id);
    }
  }
  return ids;
}

function buildPhotoLookup(runs) {
  const lookup = new Map();
  for (const run of runs) {
    for (const photo of run.photos) {
      if (photo.photo_id && !lookup.has(photo.photo_id)) {
        lookup.set(photo.photo_id, { photo, runDir: run.runDir });
      }
    }
  }
  return lookup;
}

function toHtmlPath(path) {
  return path.split(sep).join("/");
}

function imageSourceFor(photo, sourceRunDir, outputDir) {
  if (photo.local_image_path) {
    return toHtmlPath(relative(outputDir, join(sourceRunDir, photo.local_image_path)));
  }
  return photo.image_preview_url || photo.image_download_url || "";
}

function fieldOrder(fields) {
  const preferred = preferredFieldOrder.filter((field) => fields.has(field));
  const remaining = [...fields]
    .filter((field) => !preferredFieldOrder.includes(field))
    .sort((left, right) => left.localeCompare(right, "zh-Hant"));
  return [...preferred, ...remaining];
}

function buildWarnings(runs) {
  const warnings = [];
  const currentPrompt = getAiLabelingPromptMetadata();
  const baseRunIds = new Set(runs.map((run) => run.baseRunId).filter(Boolean));
  if (baseRunIds.size > 1) {
    warnings.push(`Runs do not share one base_run_id: ${[...baseRunIds].join(", ")}`);
  }

  const promptHashes = new Set(runs.map((run) => run.manifest.prompt_template_sha256).filter(Boolean));
  const missingPromptHashRuns = runs.filter((run) => !run.manifest.prompt_template_sha256);
  if (promptHashes.size > 1) {
    warnings.push(`Runs do not share one prompt_template_sha256: ${[...promptHashes].map((hash) => hash.slice(0, 12)).join(", ")}`);
  }
  if (missingPromptHashRuns.length > 0) {
    warnings.push(
      `Some runs do not record prompt_template_sha256: ${missingPromptHashRuns.map((run) => run.label).join(", ")}. Treat prompt-version comparison as unknown.`,
    );
  }
  const stalePromptRuns = runs.filter(
    (run) => run.manifest.prompt_template_sha256 && run.manifest.prompt_template_sha256 !== currentPrompt.prompt_template_sha256,
  );
  if (stalePromptRuns.length > 0) {
    warnings.push(
      `Some runs use a prompt_template_sha256 different from the current repo prompt ${currentPrompt.prompt_template_sha256.slice(0, 12)}: ${stalePromptRuns.map((run) => `${run.label}=${run.manifest.prompt_template_sha256.slice(0, 12)}`).join(", ")}.`,
    );
  }

  const firstRun = runs[0];
  for (const run of runs.slice(1)) {
    const missingFromRun = [...firstRun.photoIds].filter((photoId) => !run.photoIds.has(photoId));
    const extraInRun = [...run.photoIds].filter((photoId) => !firstRun.photoIds.has(photoId));
    if (missingFromRun.length > 0 || extraInRun.length > 0) {
      warnings.push(
        `${run.label} photo_id set differs from ${firstRun.label}: missing ${missingFromRun.length}, extra ${extraInRun.length}`,
      );
    }
  }

  for (const run of runs) {
    if (run.validation.status === "invalid") {
      warnings.push(`${run.label} has ${run.validation.error_count} validation error(s).`);
    }
    if (run.validation.warning_count > 0) {
      warnings.push(`${run.label} has ${run.validation.warning_count} review warning(s).`);
    }
    if (run.validation.status === "missing") {
      warnings.push(`${run.label} has no metadata-proposals.json.`);
    }
    if (run.proposals && !run.hasReviewSummary) {
      warnings.push(`${run.label} has proposals but no metadata-review-summary.md yet.`);
    }
    if (run.isReviewSummaryStale) {
      warnings.push(`${run.label} 的 metadata-review-summary.md 比 metadata-proposals.json 舊；使用 Review Focus 前請先重新執行 pnpm ai:review。`);
    }
  }

  return warnings;
}

function buildReportData(runs, options) {
  const fieldSet = new Set(runs.flatMap((run) => [...run.fields]));
  const orderedFields = fieldOrder(fieldSet);
  const photoIds = uniquePhotoOrder(runs);
  const photoLookup = buildPhotoLookup(runs);
  const mode = options.mode === "auto" ? (runs.length === 1 ? "single" : "compare") : options.mode;

  const photos = photoIds.map((photoId) => {
    const source = photoLookup.get(photoId);
    const photo = source?.photo ?? { photo_id: photoId };
    return {
      album_title: photo.album_title || "",
      curation_notes: photo.curation_notes || "",
      image_src: source ? imageSourceFor(photo, source.runDir, options.outputDir) : "",
      photo_id: photoId,
      photo_url: photo.photo_url || "",
      preview_url: photo.image_preview_url || "",
      attempts: runs.map((run) => {
        const item = run.itemsByPhotoId.get(photoId);
        return {
          fields: item?.fields ?? {},
          focus: run.reviewFocus.filter((row) => row.photo_id === photoId),
          has_photo: run.photoIds.has(photoId),
          has_proposal: Boolean(item),
          run_id: run.manifest.run_id || run.label,
        };
      }),
    };
  });

  return {
    attempts: runs.map((run) => ({
      attempt_id: run.attempt?.attempt_id || "",
      base_run_id: run.baseRunId,
      error_count: run.validation.error_count,
      errors: run.validation.errors,
      review_warnings: run.validation.warnings,
      review_focus: run.reviewFocus,
      has_review_summary: run.hasReviewSummary,
      is_review_summary_stale: run.isReviewSummaryStale,
      label: run.label,
      model: run.attempt?.model || "",
      plan_updates: run.planUpdates,
      proposal_count: run.proposals?.items?.length ?? 0,
      prompt_template_path: run.manifest.prompt_template_path || "",
      prompt_template_sha256: run.manifest.prompt_template_sha256 || "",
      round: run.attempt?.round || "",
      run_dir: run.runDir,
      run_id: run.manifest.run_id || "",
      status: run.validation.status,
      warning_count: run.validation.warning_count,
    })),
    field_labels: Object.fromEntries(orderedFields.map((field) => [field, fieldLabel(field, { includeRaw: true })])),
    fields: orderedFields,
    generated_at: new Date().toISOString(),
    mode,
    option_labels: defaultMetadataDisplayContext.taxonomy.option_labels ?? {},
    photos,
    title: options.title || (mode === "single" ? "AI 初標單次檢視報表" : "AI 初標比較報表"),
    warnings: buildWarnings(runs),
  };
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderHtml(reportData) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${reportData.title}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --line: #d9dee7;
      --muted: #667085;
      --text: #182230;
      --accent: #0f766e;
      --accent-soft: #d9f4ef;
      --warn: #9a3412;
      --warn-soft: #ffedd5;
      --bad: #b42318;
      --bad-soft: #fee4e2;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    header {
      padding: 20px 24px 16px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      position: sticky;
      top: 0;
      z-index: 5;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 24px;
      letter-spacing: 0;
    }
    .summary, .controls, .attempts, .warnings, .coverage {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      padding: 5px 10px;
      font-size: 13px;
      color: var(--muted);
    }
    .pill.good { border-color: #99d7ca; color: #0f766e; background: var(--accent-soft); }
    .pill.bad { border-color: #fda29b; color: var(--bad); background: var(--bad-soft); }
    .pill.warn { border-color: #fdba74; color: var(--warn); background: var(--warn-soft); }
    main { padding: 16px 24px 40px; }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(220px, 1fr) 220px 160px auto;
      gap: 10px;
      margin-bottom: 14px;
      align-items: center;
    }
    input, select, label.toggle {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 8px 10px;
      font: inherit;
    }
    label.toggle {
      display: flex;
      gap: 8px;
      align-items: center;
      color: var(--muted);
    }
    .attempts, .coverage { margin: 0 0 14px; }
    .warnings { margin: 0 0 14px; align-items: stretch; }
    .warning {
      max-width: 100%;
      border: 1px solid #fdba74;
      border-radius: 6px;
      background: var(--warn-soft);
      color: var(--warn);
      padding: 8px 10px;
      font-size: 13px;
    }
    .focus-row {
      border: 1px solid #99d7ca;
      border-radius: 6px;
      background: var(--accent-soft);
      color: var(--accent);
      padding: 8px 10px;
      font-size: 13px;
      margin-bottom: 8px;
      overflow-wrap: anywhere;
    }
    .results-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: flex-start;
      margin: 0 0 14px;
    }
    .load-more-bar {
      display: flex;
      justify-content: center;
      margin: 18px 0 0;
    }
    .result-count {
      color: var(--muted);
      font-size: 13px;
    }
    .load-more {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      padding: 7px 12px;
      font: inherit;
      cursor: pointer;
    }
    .load-more:hover {
      border-color: #99d7ca;
      color: var(--accent);
    }
    .photo-card {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 14px;
      padding: 14px;
      margin-bottom: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .thumb {
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: #eef1f5;
      display: block;
    }
    .photo-id {
      margin-top: 8px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .comparison {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
    }
    table {
      width: 100%;
      min-width: 760px;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      vertical-align: top;
      border-bottom: 1px solid var(--line);
      border-right: 1px solid var(--line);
      padding: 8px;
      text-align: left;
    }
    th:last-child, td:last-child { border-right: 0; }
    tr:last-child td { border-bottom: 0; }
    th {
      background: #f9fafb;
      color: #344054;
      font-weight: 700;
      position: sticky;
      top: 0;
    }
    tr.diff-row td { background: #fffdf5; }
    .field-name {
      width: 150px;
      font-weight: 700;
      color: #344054;
    }
    .missing { color: #98a2b3; }
    .value { font-weight: 650; margin-bottom: 4px; overflow-wrap: anywhere; }
    .confidence { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
    .reason { color: #475467; overflow-wrap: anywhere; }
    .single-card {
      grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    }
    .single-proposals {
      min-width: 0;
    }
    .single-head {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    .proposal-list {
      border: 1px solid var(--line);
      border-radius: 6px;
      overflow: hidden;
      background: #fff;
    }
    .proposal-block {
      padding: 10px 12px;
      border-top: 1px solid var(--line);
    }
    .proposal-block:first-child { border-top: 0; }
    .proposal-block.watch {
      border-left: 4px solid var(--accent);
      padding-left: 8px;
      background: #fbfffd;
    }
    .proposal-field {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: baseline;
      margin-bottom: 4px;
      color: #344054;
      font-weight: 700;
    }
    .proposal-value {
      font-size: 15px;
      font-weight: 650;
      overflow-wrap: anywhere;
      margin-bottom: 4px;
    }
    .proposal-meta {
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 4px;
    }
    .proposal-reason {
      color: #475467;
      overflow-wrap: anywhere;
    }
    .empty-state {
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 24px;
      text-align: center;
      color: var(--muted);
      background: var(--panel);
    }
    @media (max-width: 900px) {
      header { position: static; }
      main, header { padding-left: 14px; padding-right: 14px; }
      .toolbar { grid-template-columns: 1fr; }
      .photo-card { grid-template-columns: 1fr; }
      .thumb { max-height: 320px; }
    }
  </style>
</head>
<body>
  <header>
    <h1 id="title"></h1>
    <div id="summary" class="summary"></div>
  </header>
  <main>
    <section class="toolbar">
      <input id="search" type="search" placeholder="搜尋 photo_id、相簿、備註或欄位內容">
      <select id="field-filter"></select>
      <select id="status-filter">
        <option value="all">所有照片</option>
        <option value="diff">有差異</option>
        <option value="missing">有缺 proposal</option>
        <option value="focus">需優先抽查</option>
      </select>
      <label id="diff-toggle" class="toggle"><input id="only-diff-fields" type="checkbox"> 只顯示差異欄位</label>
    </section>
    <section id="attempts" class="attempts"></section>
    <section id="coverage" class="coverage"></section>
    <section id="warnings" class="warnings"></section>
    <section class="results-bar">
      <div id="result-count" class="result-count"></div>
    </section>
    <section id="photos"></section>
    <section class="load-more-bar">
      <button id="load-more" class="load-more" type="button">載入更多</button>
    </section>
  </main>
  <script id="report-data" type="application/json">${escapeScriptJson(reportData)}</script>
  <script>
    const data = JSON.parse(document.getElementById("report-data").textContent);
    const preferredFields = ${JSON.stringify(preferredFieldOrder)};
    const isSingleMode = data.mode === "single";
    const pageSize = 50;
    const watchFields = new Set(["visual_description", "sponsorship_items", "sponsorship_tags", "public_use_status", "safe_crop"]);
    const state = {
      field: "all",
      onlyDiffFields: false,
      search: "",
      status: "all",
      visibleLimit: pageSize,
    };

    const title = document.getElementById("title");
    const summary = document.getElementById("summary");
    const attempts = document.getElementById("attempts");
    const coverage = document.getElementById("coverage");
    const warnings = document.getElementById("warnings");
    const resultCount = document.getElementById("result-count");
    const loadMore = document.getElementById("load-more");
    const photosRoot = document.getElementById("photos");
    const searchInput = document.getElementById("search");
    const fieldFilter = document.getElementById("field-filter");
    const statusFilter = document.getElementById("status-filter");
    const diffToggle = document.getElementById("diff-toggle");
    const onlyDiffFields = document.getElementById("only-diff-fields");

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function rawValue(value) {
      if (typeof value === "boolean") return value ? "true" : "false";
      if (value === undefined || value === null) return "";
      return String(value).trim();
    }

    function fieldLabel(field) {
      return data.field_labels?.[field] || field;
    }

    function valueLabel(field, raw) {
      return data.option_labels?.[field]?.[raw] || raw;
    }

    function valueText(field, value) {
      const values = Array.isArray(value) ? value.map(rawValue).filter(Boolean) : [rawValue(value)].filter(Boolean);
      return values.map((raw) => {
        const label = valueLabel(field, raw);
        return label === raw ? raw : label + " (" + raw + ")";
      }).join("; ");
    }

    function stableValue(value) {
      if (Array.isArray(value)) return JSON.stringify([...value].sort());
      return JSON.stringify(value);
    }

    function proposalValue(attempt, field) {
      const proposal = attempt.fields[field];
      return proposal && Object.prototype.hasOwnProperty.call(proposal, "value")
        ? stableValue(proposal.value)
        : "";
    }

    function fieldsForPhoto(photo) {
      const fields = new Set();
      for (const attempt of photo.attempts) {
        Object.keys(attempt.fields || {}).forEach((field) => fields.add(field));
      }
      return [...preferredFields.filter((field) => fields.has(field)), ...[...fields].filter((field) => !preferredFields.includes(field)).sort()];
    }

    function fieldHasDiff(photo, field) {
      const values = photo.attempts.map((attempt) => proposalValue(attempt, field));
      return new Set(values).size > 1;
    }

    function photoHasDiff(photo) {
      return fieldsForPhoto(photo).some((field) => fieldHasDiff(photo, field));
    }

    function photoHasMissingProposal(photo) {
      return photo.attempts.some((attempt) => !attempt.has_proposal || !attempt.has_photo);
    }

    function searchableText(photo) {
      const parts = [
        photo.photo_id,
        photo.album_title,
        photo.curation_notes,
        photo.photo_url,
      ];
      for (const attempt of photo.attempts) {
        for (const [field, proposal] of Object.entries(attempt.fields || {})) {
          parts.push(fieldLabel(field), valueText(field, proposal.value), proposal.reason || "", String(proposal.confidence ?? ""));
        }
      }
      return parts.join(" ").toLowerCase();
    }

    function currentAttempt(photo) {
      return photo.attempts[0] ?? { fields: {}, has_photo: false, has_proposal: false };
    }

    function renderSummary() {
      title.textContent = data.title;
      summary.replaceChildren();
      const focusCount = data.attempts.reduce((count, attempt) => count + (attempt.review_focus || []).length, 0);
      summary.append(
        el("span", "pill", "產生時間 " + data.generated_at),
        el("span", "pill", isSingleMode ? "單次檢視" : "比較模式"),
        el("span", "pill", data.photos.length + " 張照片"),
        el("span", "pill", data.attempts.length + " 個 run"),
        el("span", data.warnings.length ? "pill warn" : "pill good", data.warnings.length + " 個警訊"),
        el("span", focusCount ? "pill warn" : "pill good", "需抽查 " + focusCount + " 項"),
      );
    }

    function renderAttemptPills() {
      attempts.replaceChildren();
      for (const attempt of data.attempts) {
        const statusClass = attempt.status === "valid" && !attempt.is_review_summary_stale
          ? "good"
          : attempt.status === "missing"
            ? "warn"
            : attempt.is_review_summary_stale
              ? "warn"
              : "bad";
        const statusLabel = attempt.status === "valid" ? "valid" : attempt.status === "missing" ? "missing proposal" : "invalid";
        const promptHash = attempt.prompt_template_sha256 ? "prompt " + attempt.prompt_template_sha256.slice(0, 12) : "prompt unknown";
        const parts = [
          attempt.label || attempt.run_id,
          statusLabel,
          promptHash,
          attempt.is_review_summary_stale ? "review summary 過期" : "",
          attempt.proposal_count === undefined ? "" : attempt.proposal_count + " proposals",
          attempt.plan_updates === null ? "" : attempt.plan_updates + " updates",
        ].filter(Boolean);
        attempts.append(el("span", "pill " + statusClass, parts.join(" / ")));
      }
    }

    function renderCoverage() {
      coverage.replaceChildren();
      if (!isSingleMode) {
        coverage.hidden = true;
        return;
      }
      coverage.hidden = false;
      const total = data.photos.length;
      const attempt = data.attempts[0] ?? {};
      coverage.append(el("span", "pill", "欄位覆蓋率"));
      coverage.append(el("span", "pill", (attempt.proposal_count ?? 0) + "/" + total + " proposals"));
      for (const field of data.fields) {
        const count = data.photos.filter((photo) => Boolean(currentAttempt(photo).fields[field])).length;
        const className = count === total ? "pill good" : count === 0 ? "pill warn" : "pill";
        coverage.append(el("span", className, fieldLabel(field) + " " + count + "/" + total));
      }
    }

    function renderWarnings() {
      warnings.replaceChildren();
      for (const warning of data.warnings) {
        warnings.append(el("div", "warning", warning));
      }
      for (const attempt of data.attempts) {
        if (attempt.errors.length > 0) {
          warnings.append(el("div", "warning", attempt.label + ": " + attempt.errors[0]));
        }
      }
    }

    function renderFilters() {
      const options = [["all", "所有欄位"], ...data.fields.map((field) => [field, fieldLabel(field)])];
      fieldFilter.replaceChildren();
      for (const [value, label] of options) {
        const option = el("option", "", label);
        option.value = value;
        fieldFilter.append(option);
      }

      const statusOptions = isSingleMode
        ? [["all", "所有照片"], ["with-proposal", "有 proposal"], ["missing", "缺 proposal"], ["focus", "需優先抽查"]]
        : [["all", "所有照片"], ["diff", "有差異"], ["missing", "有缺 proposal"], ["focus", "需優先抽查"]];
      if (!statusOptions.some(([value]) => value === state.status)) {
        state.status = "all";
      }
      statusFilter.replaceChildren();
      for (const [value, label] of statusOptions) {
        const option = el("option", "", label);
        option.value = value;
        option.selected = value === state.status;
        statusFilter.append(option);
      }

      diffToggle.hidden = isSingleMode;
      if (isSingleMode) {
        state.onlyDiffFields = false;
        onlyDiffFields.checked = false;
      }
    }

    function renderMedia(photo) {
      const media = el("div", "media");
      if (photo.image_src) {
        const image = el("img", "thumb");
        image.src = photo.image_src;
        image.alt = photo.photo_id;
        image.loading = "lazy";
        image.decoding = "async";
        media.append(image);
      } else {
        media.append(el("div", "thumb"));
      }
      media.append(el("div", "photo-id", photo.photo_id));
      if (photo.photo_url) {
        const link = el("a", "meta", photo.photo_url);
        link.href = photo.photo_url;
        link.target = "_blank";
        link.rel = "noreferrer";
        media.append(link);
      }
      if (photo.album_title) media.append(el("div", "meta", photo.album_title));
      if (photo.curation_notes) media.append(el("div", "meta", photo.curation_notes));
      return media;
    }

    function renderSinglePhotoCard(photo) {
      const card = el("article", "photo-card single-card");
      const attempt = currentAttempt(photo);
      const fieldNames = state.field === "all" ? fieldsForPhoto(photo) : [state.field];
      const visibleFields = fieldNames.filter((field) => attempt.fields[field]);

      const panel = el("div", "single-proposals");
      const head = el("div", "single-head");
      const fieldCount = Object.keys(attempt.fields || {}).length;
      head.append(el("span", attempt.has_proposal ? "pill good" : "pill warn", attempt.has_proposal ? "有 proposal" : "缺 proposal"));
      head.append(el("span", "pill", fieldCount + " 個欄位"));
      for (const focus of attempt.focus || []) {
        head.append(el("span", "pill warn", focus.issue + (focus.field ? " / " + fieldLabel(focus.field) : "")));
      }
      if (!attempt.has_photo) {
        head.append(el("span", "pill warn", "此 run 缺照片"));
      }
      panel.append(head);

      const list = el("div", "proposal-list");
      if (!attempt.has_photo) {
        list.append(el("div", "proposal-block missing", "此 run 缺照片"));
      } else if (!attempt.has_proposal) {
        list.append(el("div", "proposal-block missing", "metadata-proposals.json 沒有這張照片"));
      } else if (visibleFields.length === 0) {
        list.append(el("div", "proposal-block missing", "沒有符合目前篩選的欄位。"));
      } else {
        for (const field of visibleFields) {
          const proposal = attempt.fields[field];
          const block = el("section", "proposal-block" + (watchFields.has(field) ? " watch" : ""));
          const fieldLine = el("div", "proposal-field");
          fieldLine.append(el("span", "", fieldLabel(field)));
          for (const focus of (attempt.focus || []).filter((item) => item.field === field)) {
            fieldLine.append(el("span", "pill warn", focus.issue));
          }
          if (watchFields.has(field)) {
            fieldLine.append(el("span", "pill", "重點檢查"));
          }
          block.append(fieldLine);
          block.append(el("div", "proposal-value", valueText(field, proposal.value) || "(空值)"));
          if (proposal.confidence !== undefined) {
            block.append(el("div", "proposal-meta", "confidence " + proposal.confidence));
          }
          if (proposal.reason) {
            block.append(el("div", "proposal-reason", proposal.reason));
          }
          list.append(block);
        }
      }
      panel.append(list);
      card.append(renderMedia(photo), panel);
      return card;
    }

    function renderComparePhotoCard(photo) {
      const card = el("article", "photo-card");
      const focusItems = photo.attempts.flatMap((attempt, index) =>
        (attempt.focus || []).map((focus) => ({
          attempt: data.attempts[index]?.label || attempt.run_id,
          ...focus,
        })),
      );

      const comparison = el("div", "comparison");
      if (focusItems.length > 0) {
        const focusBox = el("div", "focus-row");
        focusBox.textContent = focusItems
          .slice(0, 4)
          .map((focus) => focus.attempt + ": " + focus.issue + (focus.field ? " / " + fieldLabel(focus.field) : ""))
          .join("；");
        comparison.append(focusBox);
      }
      const table = el("table");
      const thead = el("thead");
      const headerRow = el("tr");
      headerRow.append(el("th", "field-name", "欄位"));
      for (const attempt of data.attempts) {
        headerRow.append(el("th", "", attempt.label || attempt.run_id));
      }
      thead.append(headerRow);
      table.append(thead);

      const tbody = el("tbody");
      const fields = state.field === "all" ? fieldsForPhoto(photo) : [state.field];
      let visibleRows = 0;
      for (const field of fields) {
        const hasDiff = fieldHasDiff(photo, field);
        if (state.onlyDiffFields && !hasDiff) continue;
        const row = el("tr", hasDiff ? "diff-row" : "");
        row.append(el("td", "field-name", fieldLabel(field)));
        for (const attempt of photo.attempts) {
          const cell = el("td");
          const proposal = attempt.fields[field];
          const focusForField = (attempt.focus || []).filter((focus) => focus.field === field);
          if (!attempt.has_photo) {
            cell.append(el("div", "missing", "此 run 缺照片"));
          } else if (!proposal) {
            cell.append(el("div", "missing", "缺 proposal"));
          } else {
            for (const focus of focusForField) {
              cell.append(el("div", "focus-row", focus.issue));
            }
            cell.append(el("div", "value", valueText(field, proposal.value)));
            if (proposal.confidence !== undefined) {
              cell.append(el("div", "confidence", "confidence " + proposal.confidence));
            }
            if (proposal.reason) {
              cell.append(el("div", "reason", proposal.reason));
            }
          }
          row.append(cell);
        }
        tbody.append(row);
        visibleRows += 1;
      }
      if (visibleRows === 0) {
        const row = el("tr");
        const cell = el("td", "missing", "沒有符合目前篩選的欄位。");
        cell.colSpan = data.attempts.length + 1;
        row.append(cell);
        tbody.append(row);
      }
      table.append(tbody);
      comparison.append(table);

      card.append(renderMedia(photo), comparison);
      return card;
    }

    function renderPhotoCard(photo) {
      return isSingleMode ? renderSinglePhotoCard(photo) : renderComparePhotoCard(photo);
    }

    function photoHasFocus(photo) {
      return photo.attempts.some((attempt) => (attempt.focus || []).length > 0);
    }

    function filteredPhotos() {
      const query = state.search.trim().toLowerCase();
      return data.photos.filter((photo) => {
        if (query && !searchableText(photo).includes(query)) return false;
        if (isSingleMode) {
          const attempt = currentAttempt(photo);
          if (state.status === "with-proposal" && !attempt.has_proposal) return false;
          if (state.status === "missing" && !photoHasMissingProposal(photo)) return false;
          if (state.status === "focus" && !photoHasFocus(photo)) return false;
          if (state.field !== "all" && !attempt.fields[state.field]) return false;
          return true;
        }
        if (state.status === "diff" && !photoHasDiff(photo)) return false;
        if (state.status === "missing" && !photoHasMissingProposal(photo)) return false;
        if (state.status === "focus" && !photoHasFocus(photo)) return false;
        if (state.field !== "all" && !fieldsForPhoto(photo).includes(state.field)) return false;
        return true;
      });
    }

    function renderPhotos() {
      photosRoot.replaceChildren();
      const photos = filteredPhotos();
      if (photos.length === 0) {
        resultCount.textContent = "0 張符合篩選";
        loadMore.hidden = true;
        photosRoot.append(el("div", "empty-state", "沒有符合目前篩選條件的照片。"));
        return;
      }
      const visiblePhotos = photos.slice(0, state.visibleLimit);
      resultCount.textContent = "顯示 " + visiblePhotos.length + " / " + photos.length + " 張符合篩選";
      loadMore.hidden = visiblePhotos.length >= photos.length;
      for (const photo of visiblePhotos) {
        photosRoot.append(renderPhotoCard(photo));
      }
    }

    function resetAndRenderPhotos() {
      state.visibleLimit = pageSize;
      renderPhotos();
    }

    searchInput.addEventListener("input", () => {
      state.search = searchInput.value;
      resetAndRenderPhotos();
    });
    fieldFilter.addEventListener("change", () => {
      state.field = fieldFilter.value;
      resetAndRenderPhotos();
    });
    statusFilter.addEventListener("change", () => {
      state.status = statusFilter.value;
      resetAndRenderPhotos();
    });
    onlyDiffFields.addEventListener("change", () => {
      state.onlyDiffFields = onlyDiffFields.checked;
      resetAndRenderPhotos();
    });
    loadMore.addEventListener("click", () => {
      state.visibleLimit += pageSize;
      renderPhotos();
    });

    renderSummary();
    renderAttemptPills();
    renderCoverage();
    renderWarnings();
    renderFilters();
    renderPhotos();
  </script>
</body>
</html>
`;
}

async function buildReport(options) {
  await mkdir(options.outputDir, { recursive: true });
  const runs = await Promise.all(options.runDirs.map((runDir) => loadRun(runDir)));
  const reportData = buildReportData(runs, options);
  const html = renderHtml(reportData);
  const outputPath = join(options.outputDir, "index.html");
  await writeFile(outputPath, html);
  return {
    mode: reportData.mode,
    outputPath,
    photoCount: reportData.photos.length,
    runCount: reportData.attempts.length,
    warningCount: reportData.warnings.length,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await buildReport(options);
  console.log(`AI report written: ${result.outputPath}`);
  console.log(`- mode: ${result.mode}`);
  console.log(`- runs: ${result.runCount}`);
  console.log(`- photos: ${result.photoCount}`);
  console.log(`- warnings: ${result.warningCount}`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not build AI report: ${error.message}`);
  process.exitCode = 1;
}
