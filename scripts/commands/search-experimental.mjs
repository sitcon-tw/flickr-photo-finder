import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv, parseSemicolonList } from "../lib/core/csv-utils.mjs";
import { searchTokensForValue } from "../lib/core/metadata-display.mjs";
import { listFields, photoHeaders } from "../lib/core/photo-schema.mjs";

const defaultQueries = [
  "贊助提案中可以呈現會眾互動的照片",
  "新聞稿首圖需要橫式且有清楚人物或舞台",
  "志工招募可以呈現工作人員互動",
  "有留白可放字的網站橫幅照片",
  "茶點或餐點配置可以做活動回顧",
  "講者宣傳可用的演講照片",
  "適合社群貼文的青春感合照",
];

const structuredFields = [
  { name: "subject_type", weight: 4 },
  { name: "recommended_uses", weight: 4 },
  { name: "scene_tags", weight: 4 },
  { name: "sponsorship_items", weight: 4 },
  { name: "sponsorship_tags", weight: 4 },
  { name: "collections", weight: 3 },
  { name: "mood_tags", weight: 2 },
  { name: "has_negative_space", weight: 2 },
  { name: "orientation", weight: 2 },
  { name: "people_count", weight: 1.5 },
  { name: "safe_crop", weight: 1 },
  { name: "album_title", weight: 0.75 },
  { name: "event_name", weight: 0.75 },
  { name: "event_year", weight: 0.5 },
  { name: "public_use_status", weight: 0.5 },
  { name: "priority_level", weight: 0.5 },
  { name: "curation_status", weight: 0.25 },
];

const descriptionField = { name: "visual_description", weight: 3 };
const defaultTop = 5;
const defaultScoring = "current";
const idfDescriptionRawScoreCap = 14;
const defaultProposalFile = "metadata-proposals.json";
const defaultRunPhotosFile = "photos.json";
const searchAliasesPath = "data/search-aliases.json";
const sheetsExportPhotosPath = "tmp/sheets-export/photos.csv";
const fixturePhotosPath = "fixtures/photos.csv";
const validPhotoFields = new Set(photoHeaders);
const listFieldSet = new Set(listFields);
const scoringModes = new Set([defaultScoring, "idf"]);
const lowInformationDescriptionTokens = new Set([
  "畫面",
  "可見",
  "呈現",
  "有人",
  "有人物",
  "人物",
  "人們",
  "參與",
  "參與者",
  "與者",
  "互動",
  "交流",
  "交談",
  "討論",
  "情境",
  "狀態",
  "氛圍",
]);
let searchAliases = {};

function printUsage() {
  console.log(`Usage:
  pnpm eval:search
  pnpm eval:search -- --query "有留白的橫式講者照片" --photos fixtures/photos.csv
  pnpm eval:search -- --run-dir tmp/ai-runs/<run-id> --top 10

Options:
  --photos <path>       Photos CSV path. Defaults to tmp/sheets-export/photos.csv if present, otherwise fixtures/photos.csv.
  --run-dir <dir>       AI run directory. Uses <run-dir>/photos.json and overlays <run-dir>/metadata-proposals.json by default.
  --proposals <path>    Proposal JSON path to overlay before scoring.
  --no-proposals        Do not overlay proposals when --run-dir is provided.
  --query <text>        Query to evaluate. Can be repeated. Defaults to built-in work-scenario queries.
  --queries <path>      Text file with one query per line. Blank lines and lines starting with # are ignored.
  --scoring <mode>      Scoring mode. Options: ${[...scoringModes].join(", ")}. Default: ${defaultScoring}.
  --top <number>        Number of results per mode. Default: ${defaultTop}.
  --help, -h            Show this help.

The command compares a structured taxonomy baseline with the same baseline plus
visual_description. It does not call an LLM, fetch images, or write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    noProposals: false,
    photosPath: "",
    proposalsPath: "",
    queries: [],
    queriesPath: "",
    runDir: "",
    scoring: defaultScoring,
    top: defaultTop,
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
    } else if (arg === "--photos") {
      options.photosPath = nextValue(index, arg);
      index += 1;
    } else if (arg === "--run-dir") {
      options.runDir = nextValue(index, arg);
      index += 1;
    } else if (arg === "--proposals") {
      options.proposalsPath = nextValue(index, arg);
      index += 1;
    } else if (arg === "--no-proposals") {
      options.noProposals = true;
    } else if (arg === "--query") {
      options.queries.push(nextValue(index, arg));
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
    if (options.photosPath && options.runDir) {
      throw new Error("Use either --photos or --run-dir as the base photo source, not both");
    }
    if (!Number.isInteger(options.top) || options.top < 1) {
      throw new Error("--top must be a positive integer");
    }
    if (options.queries.some((query) => !query.trim())) {
      throw new Error("--query requires non-empty text");
    }
    if (!scoringModes.has(options.scoring)) {
      throw new Error(`--scoring must be one of: ${[...scoringModes].join(", ")}`);
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

async function resolveDefaultPhotosPath() {
  if (await pathExists(sheetsExportPhotosPath)) {
    return sheetsExportPhotosPath;
  }
  return fixturePhotosPath;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
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

async function readQueryFile(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function serializeProposalValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean).join(";");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function overlayProposals(records, proposals) {
  const recordsByPhotoId = new Map(records.map((record) => [String(record.photo_id), record]));
  let appliedFields = 0;
  let matchedItems = 0;
  let unmatchedItems = 0;

  for (const item of proposals.items ?? []) {
    const record = recordsByPhotoId.get(String(item.photo_id));
    if (!record) {
      unmatchedItems += 1;
      continue;
    }

    matchedItems += 1;
    for (const [field, proposal] of Object.entries(item.fields ?? {})) {
      if (!validPhotoFields.has(field) || !proposal || !("value" in proposal)) {
        continue;
      }
      record[field] = serializeProposalValue(proposal.value);
      appliedFields += 1;
    }
  }

  return { appliedFields, matchedItems, unmatchedItems };
}

function normalizeForTokens(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[，。、「」『』（）()：:；;,.!?！？/\\|[\]{}<>#*_`~"'“”‘’\r\n\t-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value) {
  return normalizeForTokens(value).replace(/\s+/g, "");
}

function tokenize(value) {
  const normalized = normalizeForTokens(value);
  const compact = normalized.replace(/\s+/g, "");
  const tokens = new Set();

  for (const token of normalized.split(" ")) {
    if (token.length > 0) {
      tokens.add(token);
    }
  }

  for (let size = 2; size <= 4; size += 1) {
    if (compact.length < size) {
      continue;
    }
    for (let index = 0; index <= compact.length - size; index += 1) {
      tokens.add(compact.slice(index, index + size));
    }
  }

  return tokens;
}

function displayValue(record, field) {
  const rawValue = record[field] ?? "";
  const values = listFieldSet.has(field) ? parseSemicolonList(rawValue) : [String(rawValue).trim()];
  return values
    .filter(Boolean)
    .flatMap((value) => [
      ...searchTokensForValue(field, value),
      ...(searchAliases[field]?.[value] ?? []),
    ])
    .filter(Boolean)
    .join(" ");
}

function peopleCountText(record) {
  const count = Number(record.people_count);
  if (!Number.isInteger(count) || count < 0) {
    return "";
  }

  const labels = [];
  if (count === 0) {
    labels.push("無人 靜物 空景");
  } else if (count === 1) {
    labels.push("單人 一人 個人 特寫");
  } else if (count <= 3) {
    labels.push("少人 小組 互動");
  } else if (count <= 10) {
    labels.push("多人 合照 交流");
  } else {
    labels.push("群眾 大合照 人潮");
  }
  return `${count} 人 人數 ${labels.join(" ")}`;
}

function fieldText(record, field) {
  if (field === "people_count") {
    return peopleCountText(record);
  }
  return displayValue(record, field);
}

function corpusText(record) {
  return [
    ...structuredFields.map((field) => fieldText(record, field.name)),
    String(record.visual_description ?? "").trim(),
  ].filter(Boolean).join(" ");
}

function buildScoringContext(records, scoring) {
  if (scoring !== "idf") {
    return { idfByToken: new Map(), recordCount: records.length, scoring };
  }

  const documentFrequency = new Map();
  for (const record of records) {
    for (const token of tokenize(corpusText(record))) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const idfByToken = new Map();
  for (const [token, frequency] of documentFrequency.entries()) {
    idfByToken.set(token, Math.log((records.length + 1) / (frequency + 1)) + 1);
  }

  return { idfByToken, recordCount: records.length, scoring };
}

function tokenWeight(token, fieldName, scoringContext) {
  const base = token.length >= 3 ? 1.5 : 1;
  if (scoringContext.scoring !== "idf") {
    return base;
  }

  let idf = scoringContext.idfByToken.get(token) ?? 1;
  if (fieldName === descriptionField.name && lowInformationDescriptionTokens.has(token)) {
    idf = Math.min(idf, 0.25);
  }
  return base * idf;
}

function scoreText(queryTokens, queryCompact, text, fieldName, scoringContext) {
  const fieldTokens = tokenize(text);
  let score = 0;
  for (const token of queryTokens) {
    if (fieldTokens.has(token)) {
      score += tokenWeight(token, fieldName, scoringContext);
    }
  }

  const textCompact = compactText(text);
  if (queryCompact && textCompact.includes(queryCompact)) {
    score += scoringContext.scoring === "idf" ? 1.5 : 3;
  }

  if (scoringContext.scoring === "idf" && fieldName === descriptionField.name) {
    return Math.min(score, idfDescriptionRawScoreCap);
  }

  return score;
}

function scoreRecord(record, query, includeDescription, scoringContext) {
  const queryTokens = tokenize(query);
  const queryCompact = compactText(query);
  const contributions = [];

  for (const field of structuredFields) {
    const text = fieldText(record, field.name);
    if (!text) {
      continue;
    }

    const rawScore = scoreText(queryTokens, queryCompact, text, field.name, scoringContext);
    if (rawScore > 0) {
      contributions.push({
        field: field.name,
        score: rawScore * field.weight,
        text: displayValue(record, field.name) || text,
      });
    }
  }

  if (includeDescription) {
    const text = String(record.visual_description ?? "").trim();
    const rawScore = scoreText(queryTokens, queryCompact, text, descriptionField.name, scoringContext);
    if (rawScore > 0) {
      contributions.push({
        field: descriptionField.name,
        score: rawScore * descriptionField.weight,
        text,
      });
    }
  }

  const totalScore = contributions.reduce((sum, contribution) => sum + contribution.score, 0);
  return {
    contributions: contributions.sort((left, right) => right.score - left.score),
    score: totalScore,
  };
}

function resultUrl(record) {
  return record.photo_url || record.image_preview_url || "";
}

function formatScore(score) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function formatMatchedFields(result) {
  return result.contributions
    .slice(0, 3)
    .map((contribution) => `${contribution.field}:${formatScore(contribution.score)}`)
    .join(", ");
}

function topResults(records, query, includeDescription, top, scoringContext) {
  return records
    .map((record) => ({
      ...scoreRecord(record, query, includeDescription, scoringContext),
      record,
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) =>
      right.score - left.score
      || String(left.record.photo_id).localeCompare(String(right.record.photo_id), "zh-Hant"),
    )
    .slice(0, top);
}

function printResults(title, results) {
  console.log(`\n${title}`);
  if (results.length === 0) {
    console.log("  無命中。");
    return;
  }

  results.forEach((result, index) => {
    const record = result.record;
    const url = resultUrl(record);
    const fields = formatMatchedFields(result);
    const usedDescription = result.contributions.some(
      (contribution) => contribution.field === descriptionField.name,
    );
    console.log(
      `  ${index + 1}. ${record.photo_id} score=${formatScore(result.score)} ${fields ? `matches=[${fields}]` : ""}`,
    );
    if (url) {
      console.log(`     ${url}`);
    }
    if (usedDescription && record.visual_description) {
      console.log(`     visual_description: ${record.visual_description}`);
    }
  });
}

function printLift(baselineResults, combinedResults) {
  const baselineIds = new Set(baselineResults.map((result) => String(result.record.photo_id)));
  const lifted = combinedResults.filter((result) => !baselineIds.has(String(result.record.photo_id)));

  if (lifted.length === 0) {
    console.log("\nDescription lift: 無新照片進入 combined top results。");
    return;
  }

  console.log("\nDescription lift:");
  for (const result of lifted) {
    const descriptionScore = result.contributions
      .filter((contribution) => contribution.field === descriptionField.name)
      .reduce((sum, contribution) => sum + contribution.score, 0);
    console.log(
      `  - ${result.record.photo_id} entered combined results via visual_description score=${formatScore(descriptionScore)}`,
    );
  }
}

async function loadRecords(options) {
  if (options.runDir) {
    const photosPath = join(options.runDir, defaultRunPhotosFile);
    const records = await readJson(photosPath);
    if (!Array.isArray(records)) {
      throw new Error(`${photosPath} must contain a JSON array`);
    }
    return { records, sourceLabel: photosPath };
  }

  const photosPath = options.photosPath || await resolveDefaultPhotosPath();
  return {
    records: await readCsvRecords(photosPath),
    sourceLabel: photosPath,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  searchAliases = await readJson(searchAliasesPath);
  const { records, sourceLabel } = await loadRecords(options);
  const queries = [
    ...options.queries,
    ...(options.queriesPath ? await readQueryFile(options.queriesPath) : []),
  ];
  const effectiveQueries = queries.length > 0 ? queries : defaultQueries;

  let overlaySummary = null;
  const proposalsPath = options.proposalsPath
    || (options.runDir && !options.noProposals ? join(options.runDir, defaultProposalFile) : "");
  if (proposalsPath) {
    overlaySummary = overlayProposals(records, await readJson(proposalsPath));
  }

  const visualDescriptionCount = records.filter((record) =>
    String(record.visual_description ?? "").trim(),
  ).length;
  const scoringContext = buildScoringContext(records, options.scoring);

  console.log(`Photo source: ${sourceLabel}`);
  if (proposalsPath) {
    console.log(
      `Proposal overlay: ${proposalsPath} (${overlaySummary.appliedFields} fields, ${overlaySummary.matchedItems} matched items, ${overlaySummary.unmatchedItems} unmatched items)`,
    );
  }
  console.log(`Photos: ${records.length}`);
  console.log(`visual_description filled: ${visualDescriptionCount}/${records.length}`);
  console.log(`Scoring: ${options.scoring}`);
  console.log(`Queries: ${effectiveQueries.length}`);

  if (visualDescriptionCount === 0) {
    console.log("Note: no visual_description values are present, so combined results should match the structured baseline.");
  }

  for (const query of effectiveQueries) {
    console.log(`\n## ${query}`);
    const baselineResults = topResults(records, query, false, options.top, scoringContext);
    const combinedResults = topResults(records, query, true, options.top, scoringContext);

    printResults("Structured taxonomy baseline", baselineResults);
    printResults("Structured taxonomy + visual_description", combinedResults);
    printLift(baselineResults, combinedResults);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
