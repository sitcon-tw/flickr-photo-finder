import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultOutputRoot = "tmp/ai-reports";
const proposalFile = "metadata-proposals.json";
const reviewSummaryFile = "metadata-review-summary.md";
const updatePlanFile = "metadata-update-plan.json";

const preferredFieldOrder = [
  "people_count",
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
  --output <dir>       Output report directory. Default: tmp/ai-reports/<timestamp>.
  --title <text>       Report title. Default: AI 初標比較報表.
  --help, -h           Show this help.

The command writes a read-only static HTML report. It does not call an LLM,
fetch images, modify proposals, or write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    outputDir: "",
    runDirs: [],
    title: "AI 初標比較報表",
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
    };
  } catch (error) {
    const errors = splitErrorLines(error);
    return {
      error_count: errors.length,
      errors: errors.slice(0, 80),
      item_count: 0,
      status: "invalid",
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
  const hasReviewSummary = await pathExists(join(runDir, reviewSummaryFile));
  const validation = proposals
    ? await validateRun(runDir, proposalsPath)
    : { error_count: 0, errors: [], item_count: 0, status: "missing" };

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
    itemsByPhotoId,
    label: formatRunLabel({ attempt, manifest, proposals, runDir }),
    manifest,
    photoIds: new Set(Array.isArray(photos) ? photos.map((photo) => photo.photo_id).filter(Boolean) : []),
    photos: Array.isArray(photos) ? photos : [],
    planUpdates,
    proposals,
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
  const baseRunIds = new Set(runs.map((run) => run.baseRunId).filter(Boolean));
  if (baseRunIds.size > 1) {
    warnings.push(`Runs do not share one base_run_id: ${[...baseRunIds].join(", ")}`);
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
    if (run.validation.status === "missing") {
      warnings.push(`${run.label} has no metadata-proposals.json.`);
    }
    if (run.proposals && !run.hasReviewSummary) {
      warnings.push(`${run.label} has proposals but no metadata-review-summary.md yet.`);
    }
  }

  return warnings;
}

function buildReportData(runs, options) {
  const fieldSet = new Set(runs.flatMap((run) => [...run.fields]));
  const orderedFields = fieldOrder(fieldSet);
  const photoIds = uniquePhotoOrder(runs);
  const photoLookup = buildPhotoLookup(runs);

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
      has_review_summary: run.hasReviewSummary,
      label: run.label,
      model: run.attempt?.model || "",
      plan_updates: run.planUpdates,
      round: run.attempt?.round || "",
      run_dir: run.runDir,
      run_id: run.manifest.run_id || "",
      status: run.validation.status,
    })),
    fields: orderedFields,
    generated_at: new Date().toISOString(),
    photos,
    title: options.title,
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
    .summary, .controls, .attempts, .warnings {
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
    .attempts { margin: 0 0 14px; }
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
      </select>
      <label class="toggle"><input id="only-diff-fields" type="checkbox"> 只顯示差異欄位</label>
    </section>
    <section id="attempts" class="attempts"></section>
    <section id="warnings" class="warnings"></section>
    <section id="photos"></section>
  </main>
  <script id="report-data" type="application/json">${escapeScriptJson(reportData)}</script>
  <script>
    const data = JSON.parse(document.getElementById("report-data").textContent);
    const preferredFields = ${JSON.stringify(preferredFieldOrder)};
    const state = {
      field: "all",
      onlyDiffFields: false,
      search: "",
      status: "all",
    };

    const title = document.getElementById("title");
    const summary = document.getElementById("summary");
    const attempts = document.getElementById("attempts");
    const warnings = document.getElementById("warnings");
    const photosRoot = document.getElementById("photos");
    const searchInput = document.getElementById("search");
    const fieldFilter = document.getElementById("field-filter");
    const statusFilter = document.getElementById("status-filter");
    const onlyDiffFields = document.getElementById("only-diff-fields");

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function valueText(value) {
      if (Array.isArray(value)) return value.join("; ");
      if (typeof value === "boolean") return value ? "true" : "false";
      if (value === undefined || value === null || value === "") return "";
      return String(value);
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
        for (const proposal of Object.values(attempt.fields || {})) {
          parts.push(valueText(proposal.value), proposal.reason || "", String(proposal.confidence ?? ""));
        }
      }
      return parts.join(" ").toLowerCase();
    }

    function renderSummary() {
      title.textContent = data.title;
      summary.replaceChildren();
      summary.append(
        el("span", "pill", "Generated " + data.generated_at),
        el("span", "pill", data.photos.length + " photos"),
        el("span", "pill", data.attempts.length + " attempts"),
        el("span", data.warnings.length ? "pill warn" : "pill good", data.warnings.length + " warnings"),
      );
    }

    function renderAttemptPills() {
      attempts.replaceChildren();
      for (const attempt of data.attempts) {
        const statusClass = attempt.status === "valid" ? "good" : attempt.status === "missing" ? "warn" : "bad";
        const parts = [
          attempt.label || attempt.run_id,
          attempt.status,
          attempt.plan_updates === null ? "" : attempt.plan_updates + " updates",
        ].filter(Boolean);
        attempts.append(el("span", "pill " + statusClass, parts.join(" / ")));
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
      const options = [["all", "所有欄位"], ...data.fields.map((field) => [field, field])];
      fieldFilter.replaceChildren();
      for (const [value, label] of options) {
        const option = el("option", "", label);
        option.value = value;
        fieldFilter.append(option);
      }
    }

    function renderPhotoCard(photo) {
      const card = el("article", "photo-card");
      const media = el("div", "media");
      if (photo.image_src) {
        const image = el("img", "thumb");
        image.src = photo.image_src;
        image.alt = photo.photo_id;
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

      const comparison = el("div", "comparison");
      const table = el("table");
      const thead = el("thead");
      const headerRow = el("tr");
      headerRow.append(el("th", "field-name", "field"));
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
        row.append(el("td", "field-name", field));
        for (const attempt of photo.attempts) {
          const cell = el("td");
          const proposal = attempt.fields[field];
          if (!attempt.has_photo) {
            cell.append(el("div", "missing", "photo missing"));
          } else if (!proposal) {
            cell.append(el("div", "missing", "no proposal"));
          } else {
            cell.append(el("div", "value", valueText(proposal.value)));
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
        const cell = el("td", "missing", "No fields match the current filters.");
        cell.colSpan = data.attempts.length + 1;
        row.append(cell);
        tbody.append(row);
      }
      table.append(tbody);
      comparison.append(table);

      card.append(media, comparison);
      return card;
    }

    function filteredPhotos() {
      const query = state.search.trim().toLowerCase();
      return data.photos.filter((photo) => {
        if (query && !searchableText(photo).includes(query)) return false;
        if (state.status === "diff" && !photoHasDiff(photo)) return false;
        if (state.status === "missing" && !photoHasMissingProposal(photo)) return false;
        if (state.field !== "all" && !fieldsForPhoto(photo).includes(state.field)) return false;
        return true;
      });
    }

    function renderPhotos() {
      photosRoot.replaceChildren();
      const photos = filteredPhotos();
      if (photos.length === 0) {
        photosRoot.append(el("div", "empty-state", "No photos match the current filters."));
        return;
      }
      for (const photo of photos) {
        photosRoot.append(renderPhotoCard(photo));
      }
    }

    searchInput.addEventListener("input", () => {
      state.search = searchInput.value;
      renderPhotos();
    });
    fieldFilter.addEventListener("change", () => {
      state.field = fieldFilter.value;
      renderPhotos();
    });
    statusFilter.addEventListener("change", () => {
      state.status = statusFilter.value;
      renderPhotos();
    });
    onlyDiffFields.addEventListener("change", () => {
      state.onlyDiffFields = onlyDiffFields.checked;
      renderPhotos();
    });

    renderSummary();
    renderAttemptPills();
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
