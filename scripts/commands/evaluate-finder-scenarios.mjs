import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { parseCsv, parseSemicolonList } from "../lib/core/csv-utils.mjs";
import { searchTokensForValue } from "../lib/core/metadata-display.mjs";
import { listFields } from "../lib/core/photo-schema.mjs";

const defaultPhotosPath = "tmp/sheets-export/photos.csv";
const defaultAlbumsPath = "tmp/sheets-export/albums.csv";
const defaultScenariosPath = "data/finder-real-world-eval-scenarios.json";
const defaultOutputRoot = "tmp/finder-evals";
const defaultTop = 8;
const textFields = [
  "album_title",
  "event_name",
  "event_year",
  "visual_description",
  "curation_notes",
];
const searchableFields = [
  "subject_type",
  "recommended_uses",
  "scene_tags",
  "sponsorship_items",
  "sponsorship_tags",
  "collections",
  "mood_tags",
  "has_negative_space",
  "orientation",
  "people_count",
  "safe_crop",
  "public_use_status",
  "priority_level",
  "curation_status",
  ...textFields,
];
const fieldWeights = new Map([
  ["recommended_uses", 5],
  ["scene_tags", 5],
  ["sponsorship_items", 5],
  ["sponsorship_tags", 4],
  ["safe_crop", 3],
  ["has_negative_space", 3],
  ["visual_description", 3],
  ["mood_tags", 3],
  ["album_title", 2],
  ["subject_type", 2],
  ["orientation", 2],
  ["people_count", 1.5],
]);
const listFieldSet = new Set(listFields);
const criterionOps = new Set([
  "equals_any",
  "includes_all",
  "includes_any",
  "number_at_least",
  "number_at_most",
  "number_between",
  "text_contains_any",
]);

function printUsage() {
  console.log(`Usage:
  pnpm eval:finder-scenarios
  pnpm eval:finder-scenarios -- --baseline-photos tmp/sheets-export/photos_20260611.csv

Options:
  --photos <path>             Current photos CSV. Default: ${defaultPhotosPath}.
  --baseline-photos <path>    Optional baseline photos CSV for comparison.
  --albums <path>             Albums CSV used for last_processed_at scope. Default: ${defaultAlbumsPath}.
  --scenarios <path>          Scenario JSON path. Default: ${defaultScenariosPath}.
  --processed-after <date>    Include albums processed after this date. Date-only values use Asia/Taipei midnight.
  --top <number>              Candidate count per scenario and dataset. Default: ${defaultTop}.
  --output <dir>              Output directory. Default: ${defaultOutputRoot}/<timestamp>.
  --help, -h                  Show this help.

This metadata-only benchmark ranks candidates from request text and query_terms,
then checks the ranked rows against acceptance/rejection criteria. Criteria do
not affect ranking. It does not use the Pages ranking, inspect images, call an
LLM, or write Google Sheets.`);
}

function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      albums: { type: "string" },
      "baseline-photos": { type: "string" },
      scenarios: { type: "string" },
      photos: { type: "string" },
      "processed-after": { type: "string" },
      output: { type: "string" },
      top: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const top = values.top === undefined ? defaultTop : Number(values.top);
  const options = {
    albumsPath: values.albums ?? defaultAlbumsPath,
    baselinePhotosPath: values["baseline-photos"] ?? "",
    help: values.help ?? false,
    outputDir: values.output ?? "",
    photosPath: values.photos ?? defaultPhotosPath,
    processedAfter: values["processed-after"] ?? "",
    scenariosPath: values.scenarios ?? defaultScenariosPath,
    top,
  };

  if (!options.help) {
    if (!Number.isInteger(options.top) || options.top < 1) {
      throw new Error("--top must be a positive integer");
    }
  }

  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function fileProvenance(path) {
  const content = await readFile(path);
  return {
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function readCsvRecords(path) {
  const rows = parseCsv(await readFile(path, "utf8"));
  if (rows.length === 0) {
    return [];
  }
  const [headers, ...values] = rows;
  return values.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function processedAfterTimestamp(value) {
  const text = String(value ?? "").trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+08:00` : text;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid --processed-after date: ${value}`);
  }
  return timestamp;
}

function validateScenariosFile(value) {
  if (!value || !Array.isArray(value.scenarios) || value.scenarios.length === 0) {
    throw new Error("--scenarios must contain a non-empty scenarios array");
  }
  if (!Number.isInteger(value.version) || value.version < 1) {
    throw new Error("--scenarios version must be a positive integer");
  }
  if (value.evaluation_kind !== "metadata-retrieval") {
    throw new Error("--scenarios evaluation_kind must be metadata-retrieval");
  }

  const ids = new Set();
  for (const scenario of value.scenarios) {
    if (!scenario || typeof scenario.id !== "string" || !scenario.id.trim()) {
      throw new Error("Each scenario must have a non-empty id");
    }
    if (ids.has(scenario.id)) {
      throw new Error(`Duplicate scenario id: ${scenario.id}`);
    }
    ids.add(scenario.id);
    if (typeof scenario.request !== "string" || !scenario.request.trim()) {
      throw new Error(`${scenario.id}: request must be a non-empty string`);
    }
    if (scenario.query_terms !== undefined && !Array.isArray(scenario.query_terms)) {
      throw new Error(`${scenario.id}: query_terms must be an array`);
    }
    if (!Array.isArray(scenario.acceptance_criteria) || scenario.acceptance_criteria.length === 0) {
      throw new Error(`${scenario.id}: acceptance_criteria must be a non-empty array`);
    }
    if (scenario.reject_criteria !== undefined && !Array.isArray(scenario.reject_criteria)) {
      throw new Error(`${scenario.id}: reject_criteria must be an array`);
    }

    for (const criterion of [...scenario.acceptance_criteria, ...(scenario.reject_criteria ?? [])]) {
      if (!criterion || !searchableFields.includes(criterion.field)) {
        throw new Error(`${scenario.id}: unknown criterion field: ${criterion?.field ?? ""}`);
      }
      if (!criterionOps.has(criterion.op)) {
        throw new Error(`${scenario.id}: unknown criterion op: ${criterion.op ?? ""}`);
      }
      if (criterion.value === undefined) {
        throw new Error(`${scenario.id}: criterion value is required`);
      }
    }
  }
}

function recordValues(record, field) {
  const rawValue = String(record[field] ?? "").trim();
  if (!rawValue) {
    return [];
  }
  if (listFieldSet.has(field)) {
    return parseSemicolonList(rawValue);
  }
  return [rawValue];
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[，。、「」『』（）()：:；;,.!?！？/\\|[\]{}<>#*_`~"'“”‘’\r\n\t-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function tokenize(value) {
  const normalized = normalizeText(value);
  const compact = normalized.replace(/\s+/g, "");
  const tokens = new Set();

  for (const token of normalized.split(" ")) {
    if (token) {
      tokens.add(token);
    }
  }
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      tokens.add(compact.slice(index, index + size));
    }
  }

  return tokens;
}

function fieldSearchText(record, field) {
  if (field === "people_count") {
    const count = Number(record.people_count);
    if (!Number.isInteger(count) || count < 0) {
      return "";
    }
    if (count === 0) {
      return `${count} 無人 空景`;
    }
    if (count === 1) {
      return `${count} 單人 一人`;
    }
    if (count <= 3) {
      return `${count} 少人 小組 互動`;
    }
    if (count <= 10) {
      return `${count} 多人 合照 交流`;
    }
    return `${count} 群眾 大合照 人潮`;
  }
  if (textFields.includes(field)) {
    return String(record[field] ?? "").trim();
  }
  return recordValues(record, field)
    .flatMap((value) => searchTokensForValue(field, value))
    .filter(Boolean)
    .join(" ");
}

function textContainsAny(text, terms) {
  const normalized = normalizeText(text);
  const compact = compactText(text);
  return terms.some((term) => {
    const normalizedTerm = normalizeText(term);
    return normalized.includes(normalizedTerm) || compact.includes(compactText(term));
  });
}

function matchesCriterion(record, criterion) {
  const values = recordValues(record, criterion.field);
  const expected = Array.isArray(criterion.value) ? criterion.value.map(String) : [String(criterion.value)];
  const numberValue = Number(record[criterion.field]);

  if (criterion.op === "includes_any" || criterion.op === "equals_any") {
    return values.some((value) => expected.includes(value));
  }
  if (criterion.op === "includes_all") {
    return expected.every((value) => values.includes(value));
  }
  if (criterion.op === "number_at_least") {
    return Number.isFinite(numberValue) && numberValue >= Number(criterion.value);
  }
  if (criterion.op === "number_at_most") {
    return Number.isFinite(numberValue) && numberValue <= Number(criterion.value);
  }
  if (criterion.op === "number_between") {
    const [min, max] = Array.isArray(criterion.value) ? criterion.value : [];
    return Number.isFinite(numberValue) && numberValue >= Number(min) && numberValue <= Number(max);
  }
  if (criterion.op === "text_contains_any") {
    return textContainsAny(record[criterion.field], expected);
  }

  throw new Error(`Unknown criterion op: ${criterion.op}`);
}

function queryScore(record, scenario) {
  const query = [scenario.request, ...(scenario.query_terms ?? [])].join(" ");
  const queryTokens = tokenize(query);
  const queryCompact = compactText(query);
  let score = 0;

  for (const field of searchableFields) {
    const text = fieldSearchText(record, field);
    if (!text) {
      continue;
    }
    const tokens = tokenize(text);
    let fieldScore = 0;
    for (const token of queryTokens) {
      if (tokens.has(token)) {
        fieldScore += token.length >= 3 ? 1.5 : 1;
      }
    }
    if (queryCompact && compactText(text).includes(queryCompact)) {
      fieldScore += 2;
    }
    score += fieldScore * (fieldWeights.get(field) ?? 1);
  }

  return score;
}

function statusBonus(record) {
  let score = 0;
  if (record.curation_status === "reviewed") {
    score += 4;
  } else if (record.curation_status === "ai_labeled") {
    score += 1;
  }
  if (record.priority_level === "high") {
    score += 3;
  } else if (record.priority_level === "normal") {
    score += 1;
  }
  if (record.public_use_status === "avoid") {
    score -= 100;
  }
  return score;
}

function judgeCandidate(record, scenario) {
  const required = [];
  const optional = [];
  const missingRequired = [];
  const rejections = [];

  for (const criterion of scenario.acceptance_criteria ?? []) {
    const matched = matchesCriterion(record, criterion);
    const entry = {
      field: criterion.field,
      op: criterion.op,
      reason: criterion.reason ?? "",
      value: criterion.value,
    };
    if (criterion.required) {
      if (matched) {
        required.push(entry);
      } else {
        missingRequired.push(entry);
      }
    } else if (matched) {
      optional.push(entry);
    }
  }

  for (const criterion of scenario.reject_criteria ?? []) {
    if (matchesCriterion(record, criterion)) {
      rejections.push({
        field: criterion.field,
        op: criterion.op,
        reason: criterion.reason ?? "",
        value: criterion.value,
      });
    }
  }

  return {
    metadata_accepted: missingRequired.length === 0 && rejections.length === 0,
    matched_optional: optional,
    matched_required: required,
    missing_required: missingRequired,
    rejections,
  };
}

function evidenceFields(record) {
  return {
    album_title: record.album_title ?? "",
    curation_status: record.curation_status ?? "",
    has_negative_space: record.has_negative_space ?? "",
    mood_tags: record.mood_tags ?? "",
    orientation: record.orientation ?? "",
    people_count: record.people_count ?? "",
    priority_level: record.priority_level ?? "",
    public_use_status: record.public_use_status ?? "",
    recommended_uses: record.recommended_uses ?? "",
    safe_crop: record.safe_crop ?? "",
    scene_tags: record.scene_tags ?? "",
    sponsorship_items: record.sponsorship_items ?? "",
    sponsorship_tags: record.sponsorship_tags ?? "",
    subject_type: record.subject_type ?? "",
    visual_description: record.visual_description ?? "",
  };
}

function evaluateScenario(records, scenario, top) {
  const scored = records
    .map((record) => {
      const judge = judgeCandidate(record, scenario);
      const score = queryScore(record, scenario) + statusBonus(record);
      return {
        metadata_accepted: judge.metadata_accepted,
        evidence: evidenceFields(record),
        judge,
        photo_id: String(record.photo_id ?? ""),
        photo_url: record.photo_url || record.image_preview_url || "",
        score,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) =>
      right.score - left.score
      || String(left.photo_id).localeCompare(String(right.photo_id), "zh-Hant"),
    );

  const candidates = scored.slice(0, top);
  const firstAcceptedIndex = candidates.findIndex((candidate) => candidate.metadata_accepted);
  return {
    metadata_accepted_in_top: candidates.filter((candidate) => candidate.metadata_accepted).length,
    candidates,
    first_metadata_accepted_rank: firstAcceptedIndex >= 0 ? firstAcceptedIndex + 1 : null,
    status: firstAcceptedIndex >= 0 ? "metadata-accepted" : "not-metadata-accepted",
  };
}

function scopeRecordsByAlbums(records, albumIds) {
  return records.filter((record) =>
    parseSemicolonList(record.album_ids).some((albumId) => albumIds.has(albumId)),
  );
}

function selectedAlbumIds(albums, processedAfter) {
  return new Set(
    albums
      .filter((album) => {
        const timestamp = Date.parse(album.last_processed_at || "");
        return Number.isFinite(timestamp) && timestamp > processedAfter;
      })
      .map((album) => album.album_id)
      .filter(Boolean),
  );
}

function rankDelta(current, baseline) {
  if (!baseline) {
    return null;
  }
  if (current.first_metadata_accepted_rank === null && baseline.first_metadata_accepted_rank === null) {
    return "no-metadata-accepted-photo";
  }
  if (current.first_metadata_accepted_rank !== null && baseline.first_metadata_accepted_rank === null) {
    return "newly-metadata-accepted";
  }
  if (current.first_metadata_accepted_rank === null && baseline.first_metadata_accepted_rank !== null) {
    return "lost-metadata-accepted";
  }
  return baseline.first_metadata_accepted_rank - current.first_metadata_accepted_rank;
}

function buildSummary({ albumCount, baselineRecords, currentRecords, processedAfterLabel, results, scenarioCount }) {
  const currentAccepted = results.filter((result) => result.current.status === "metadata-accepted").length;
  const baselineAccepted = baselineRecords
    ? results.filter((result) => result.baseline?.status === "metadata-accepted").length
    : null;
  return {
    album_count: albumCount,
    baseline_photo_count: baselineRecords?.length ?? null,
    current_photo_count: currentRecords.length,
    current_scenarios_metadata_accepted: currentAccepted,
    generated_at: new Date().toISOString(),
    processed_after: processedAfterLabel,
    scenario_count: scenarioCount,
    baseline_scenarios_metadata_accepted: baselineAccepted,
  };
}

function formatCandidate(candidate) {
  if (!candidate) {
    return "無候選";
  }
  const accepted = candidate.metadata_accepted ? "metadata 通過" : "metadata 未通過";
  return `${candidate.photo_id} (${accepted}, score ${candidate.score.toFixed(1)})`;
}

function renderMarkdown({ provenance, results, summary }) {
  const lines = [
    "# SITCON 真實找圖情境評估",
    "",
    `產生時間：${summary.generated_at}`,
    `範圍：albums.last_processed_at > ${summary.processed_after}`,
    `相簿數：${summary.album_count}`,
    `目前 photos：${summary.current_photo_count}`,
  ];
  if (summary.baseline_photo_count !== null) {
    lines.push(`基準 photos：${summary.baseline_photo_count}`);
  }
  lines.push(
    "",
    "此報告只檢查 metadata；未看原圖，也不代表公開 Finder 的實際排序。",
    "",
    "## 輸入 provenance",
    "",
    "| 輸入 | 路徑 | SHA-256 |",
    "| --- | --- | --- |",
    ...Object.entries(provenance)
      .filter(([, source]) => source)
      .map(([name, source]) => `| ${name} | ${source.path} | ${source.sha256} |`),
    "",
    "## 總覽",
    "",
    "| 情境 | 需求提出者 | 目前結果 | 基準結果 | 差異 |",
    "| --- | --- | --- | --- | --- |",
  );

  for (const result of results) {
    const current = result.current;
    const baseline = result.baseline;
    lines.push([
      result.id,
      result.requester_role,
      current.first_metadata_accepted_rank === null ? "metadata 未通過" : `第 ${current.first_metadata_accepted_rank} 名 metadata 通過`,
      !baseline ? "未比較" : baseline.first_metadata_accepted_rank === null ? "metadata 未通過" : `第 ${baseline.first_metadata_accepted_rank} 名 metadata 通過`,
      String(result.delta ?? ""),
    ].map((value) => value.replaceAll("|", "\\|")).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  lines.push("", "## 各情境候選", "");
  for (const result of results) {
    lines.push(`### ${result.id}`, "");
    lines.push(result.request, "");
    lines.push(`目前第一候選：${formatCandidate(result.current.candidates[0])}`);
    if (result.baseline) {
      lines.push(`基準第一候選：${formatCandidate(result.baseline.candidates[0])}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const scenariosFile = await readJson(options.scenariosPath);
  validateScenariosFile(scenariosFile);
  const processedAfterLabel = options.processedAfter || scenariosFile.processed_after;
  const processedAfter = processedAfterTimestamp(processedAfterLabel);
  const albums = await readCsvRecords(options.albumsPath);
  const albumIds = selectedAlbumIds(albums, processedAfter);
  const currentRecords = scopeRecordsByAlbums(await readCsvRecords(options.photosPath), albumIds);
  const baselineRecords = options.baselinePhotosPath
    ? scopeRecordsByAlbums(await readCsvRecords(options.baselinePhotosPath), albumIds)
    : null;
  const [albumsSource, photosSource, scenariosSource, baselineSource] = await Promise.all([
    fileProvenance(options.albumsPath),
    fileProvenance(options.photosPath),
    fileProvenance(options.scenariosPath),
    options.baselinePhotosPath ? fileProvenance(options.baselinePhotosPath) : null,
  ]);
  const provenance = {
    albums: albumsSource,
    photos: photosSource,
    scenarios: scenariosSource,
    baseline_photos: baselineSource,
  };

  const results = scenariosFile.scenarios.map((scenario) => {
    const current = evaluateScenario(currentRecords, scenario, options.top);
    const baseline = baselineRecords ? evaluateScenario(baselineRecords, scenario, options.top) : null;
    return {
      baseline,
      current,
      delta: rankDelta(current, baseline),
      id: scenario.id,
      judge_role: scenario.judge_agent?.role ?? "",
      real_world_reason: scenario.real_world_reason ?? "",
      request: scenario.request,
      requester_role: scenario.requester_agent?.role ?? "",
    };
  });
  const summary = buildSummary({
    albumCount: albumIds.size,
    baselineRecords,
    currentRecords,
    processedAfterLabel,
    results,
    scenarioCount: scenariosFile.scenarios.length,
  });
  const outputDir = options.outputDir
    || join(defaultOutputRoot, `finder-scenarios-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`);

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "results.json"), `${JSON.stringify({
    evaluation_kind: "metadata-retrieval",
    provenance,
    scenarios: scenariosFile,
    summary,
    results,
  }, null, 2)}\n`);
  await writeFile(join(outputDir, "summary.md"), renderMarkdown({ provenance, results, summary }));

  console.log(`Finder metadata benchmark: ${summary.current_scenarios_metadata_accepted}/${summary.scenario_count} current scenarios passed`);
  if (summary.baseline_scenarios_metadata_accepted !== null) {
    console.log(`Baseline: ${summary.baseline_scenarios_metadata_accepted}/${summary.scenario_count} scenarios passed`);
  }
  console.log(`Scope: ${summary.album_count} albums, ${summary.current_photo_count} current photos`);
  console.log(`Output: ${outputDir}`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not evaluate finder scenarios: ${error.message}`);
  process.exitCode = 1;
}
