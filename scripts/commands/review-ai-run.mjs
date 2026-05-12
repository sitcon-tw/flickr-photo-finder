import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getAiLabelingPromptMetadata } from "../lib/ai/ai-labeling-prompt.mjs";
import { aiBaselineFields, aiOptionalFields, aiRecallFields } from "../lib/core/photo-schema.mjs";
import { buildPlan } from "./plan-ai-updates.mjs";
import { renderDiff } from "./render-ai-diff.mjs";
import { fieldLabel, formatDisplayValue, formatStoredValue } from "../lib/core/metadata-display.mjs";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultProposalFile = "metadata-proposals.json";
const defaultSummaryFile = "metadata-review-summary.md";

const distributionFields = [
  "priority_level",
  "subject_type",
  "has_negative_space",
  "safe_crop",
  "recommended_uses",
  "scene_tags",
  "mood_tags",
  "public_use_status",
];

const peopleSceneValues = new Set(["講者", "會眾", "工作人員", "合照", "交流", "攝影"]);
const peopleReasonPattern = /人|會眾|講者|合照|志工|參與者|工作人員/;
const noPeopleReasonPattern = /沒有人|無人|沒有任何人|未見.*(?:人物|人影|真人|人臉|人體)|未看到.*(?:人物|人影|真人|人臉|人體)|沒有(?:出現)?(?:可辨識)?(?:的)?(?:人物|人影|真人|人臉|人體)|沒有.*(?:人物|人影|真人|人臉|人體)|無(?:可辨識)?(?:的)?(?:人物|人影|真人|人臉|人體)|不可辨識.*(?:人物|人影|真人)|未計入真人|非真人|(?:人形|人物|角色).*(?:插圖|圖案|標誌|海報|看板|螢幕|包裝|文宣)|(?:插圖|圖案|標誌|海報|看板|螢幕|包裝|文宣).*(?:人形|人物|角色)/;
const publicUseRiskPattern = /兒童|小朋友|孩童|清晰.*(?:臉|面部)|清楚.*(?:臉|面部)|名牌|姓名|全名|聯絡資訊|email|e-mail|電話|QR\s*code|QR碼|QRCode|識別證|證件|工作證|胸牌/i;
const concentrationThreshold = 0.9;
const smallRunMinimumItems = 20;
const smallRunMaximumItems = 60;
const smallRunConcentrationThreshold = 0.8;
const genericUseThresholds = new Map([
  ["活動回顧", 0.45],
  ["社群貼文", 0.5],
]);
const broadMoodThresholds = new Map([
  ["專業", 0.4],
  ["專注", 0.4],
  ["友善", 0.35],
]);
const lowMoodCoverageMinimumItems = 20;
const lowMoodCoverageThreshold = 0.2;
const largeRunMinimumItems = 200;
const lowSceneRunCoverageThreshold = 0.75;
const prominentSceneRunCoverageThreshold = 0.6;
const lowSceneScopeMinimumItems = 20;
const lowSceneScopeCoverageThreshold = 0.5;
const urgentSceneScopeCoverageThreshold = 0.25;
const lowSceneDensityThreshold = 1;
const highSceneDensityThreshold = 2.5;
const runTagConcentrationThreshold = 0.4;
const scopeTagConcentrationThreshold = 0.8;
const reviewFocusMaxRows = 25;
const balancedSampleMaxRows = 40;
const asciiWordPattern = /[A-Za-z][A-Za-z0-9'_-]{2,}(?:\s+[A-Za-z][A-Za-z0-9'_-]{2,}){4,}/;

function printUsage() {
  console.log(`Usage:
  pnpm ai:review -- --run-dir <dir>

Options:
  --run-dir <dir>       AI run directory containing manifest.json and photos.json.
  --proposals <path>    Proposal JSON path. Default: <run-dir>/metadata-proposals.json.
  --output-dir <dir>    Directory for review artifacts. Default: <run-dir>.
  --summary <path>      Markdown summary path. Default: <run-dir>/metadata-review-summary.md.
  --sample <number>     Number of planned updates to preview in the summary. Default: 20.
  --help, -h            Show this help.

This command validates the AI proposals, renders metadata-diff.md, renders
metadata-update-plan.json/csv, and writes one human review summary. It does
not read or write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    outputDir: "",
    proposalsPath: "",
    runDir: "",
    sample: 20,
    summaryPath: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--run-dir") {
      options.runDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--proposals") {
      options.proposalsPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--summary") {
      options.summaryPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--sample") {
      options.sample = Number(args[index + 1] ?? "");
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.runDir) {
      throw new Error("--run-dir requires a path");
    }
    if (!Number.isInteger(options.sample) || options.sample < 0) {
      throw new Error("--sample must be a non-negative integer");
    }
    if (!options.proposalsPath) {
      options.proposalsPath = join(options.runDir, defaultProposalFile);
    }
    if (!options.outputDir) {
      options.outputDir = options.runDir;
    }
    if (!options.summaryPath) {
      options.summaryPath = join(options.outputDir, defaultSummaryFile);
    }
  }

  return options;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(path) {
  if (!(await pathExists(path))) {
    return null;
  }
  return readJson(path);
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function listFilesIfExists(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function formatShardNameFromFilename(filename) {
  const match = filename.match(/^shard-(\d+)-(?:input|proposals)\.json$/);
  return match ? `shard-${match[1]}` : "";
}

function markdownCell(value) {
  return formatStoredValue(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim();
}

function table(headers, rows) {
  const lines = [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh-Hant"))
    .map(([value, count]) => ({ count, value }));
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function valuesForField(item, field) {
  const proposal = item.fields[field];
  if (!proposal) {
    return [];
  }
  return Array.isArray(proposal.value) ? proposal.value : [proposal.value];
}

function fieldCounts(items) {
  return countValues(items.flatMap((item) => Object.keys(item.fields))).map(({ value, count }) => ({
    field: value,
    count,
  }));
}

function distributionRows(items, field) {
  return countValues(items.flatMap((item) => valuesForField(item, field))).map(({ value, count }) => [
    field,
    value,
    count,
  ]);
}

function layerCoverageRows(items) {
  const layerDefinitions = [
    ["baseline", aiBaselineFields],
    ["recall", aiRecallFields],
    ["optional", aiOptionalFields],
  ];
  return layerDefinitions.flatMap(([layer, fields]) =>
    fields.map((field) => {
      const count = items.filter((item) => item.fields[field]).length;
      return [
        layer,
        fieldLabel(field, { includeRaw: true }),
        count,
        items.length > 0 ? formatPercent(count / items.length) : "0%",
      ];
    }),
  );
}

function sceneStatsForItems(items) {
  const sceneValueLists = items.map((item) => valuesForField(item, "scene_tags"));
  const withScene = sceneValueLists.filter((values) => values.length > 0).length;
  const allSceneValues = sceneValueLists.flat();
  const topScene = countValues(allSceneValues)[0] ?? { count: 0, value: "" };
  return {
    averageDensity: items.length > 0 ? allSceneValues.length / items.length : 0,
    coverage: items.length > 0 ? withScene / items.length : 0,
    itemCount: items.length,
    topScene,
    topSceneRatio: items.length > 0 ? topScene.count / items.length : 0,
    withScene,
  };
}

function sceneQaIssue(stats, { minimumItems, scope }) {
  if (stats.itemCount === 0 || stats.itemCount < minimumItems) {
    return "";
  }
  if (stats.coverage < urgentSceneScopeCoverageThreshold) {
    return `${scope} scene_tags 覆蓋率低於 ${formatPercent(urgentSceneScopeCoverageThreshold)}，建議優先檢查是否漏標或 shard 失效`;
  }
  if (stats.coverage < lowSceneScopeCoverageThreshold) {
    return `${scope} scene_tags 覆蓋率低於 ${formatPercent(lowSceneScopeCoverageThreshold)}，建議抽查`;
  }
  if (stats.averageDensity < lowSceneDensityThreshold) {
    return `${scope} scene tag density 低於 ${lowSceneDensityThreshold}`;
  }
  if (stats.averageDensity > highSceneDensityThreshold) {
    return `${scope} scene tag density 高於 ${highSceneDensityThreshold}`;
  }
  if (stats.topSceneRatio > scopeTagConcentrationThreshold && stats.coverage > 0.9) {
    return `${scope} 單一 scene tag 過度集中`;
  }
  return "";
}

function sceneQaRow(scope, name, items, issueOptions) {
  const stats = sceneStatsForItems(items);
  return [
    scope,
    name,
    stats.itemCount,
    stats.withScene,
    formatPercent(stats.coverage),
    stats.averageDensity.toFixed(2),
    stats.topScene.value ? `${stats.topScene.value} (${stats.topScene.count})` : "",
    sceneQaIssue(stats, issueOptions),
  ];
}

function buildPhotoLookup(photos) {
  return new Map(photos.map((photo) => [photo.photo_id, photo]));
}

function groupItemsBy(items, keyForItem) {
  const groups = new Map();
  for (const item of items) {
    const key = keyForItem(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function confidenceStats(items) {
  const confidences = items.flatMap((item) =>
    Object.values(item.fields)
      .map((proposal) => proposal.confidence)
      .filter((value) => typeof value === "number"),
  );
  const perfectCount = confidences.filter((value) => value === 1).length;
  const confidenceCounts = countValues(confidences);
  return {
    confidenceCounts,
    perfectCount,
    total: confidences.length,
  };
}

function confidenceByFieldRows(items) {
  const fields = fieldCounts(items).map(({ field }) => field);
  return fields.map((field) => {
    const proposals = items.map((item) => item.fields[field]).filter(Boolean);
    const confidences = proposals
      .map((proposal) => proposal.confidence)
      .filter((value) => typeof value === "number");
    const average = confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 0;
    return [
      fieldLabel(field, { includeRaw: true }),
      proposals.length,
      confidences.length,
      proposals.length > 0 ? formatPercent(confidences.length / proposals.length) : "0%",
      confidences.length > 0 ? average.toFixed(2) : "",
      confidences.filter((value) => value === 1).length,
    ];
  });
}

function mostCommonValue(items, field) {
  const counts = countValues(items.flatMap((item) => valuesForField(item, field)));
  return counts[0] ?? { count: 0, value: "" };
}

function allReasonText(item) {
  return Object.values(item.fields)
    .map((proposal) => proposal.reason)
    .filter((reason) => typeof reason === "string")
    .join(" ");
}

function allHumanText(item) {
  return Object.values(item.fields)
    .flatMap((proposal) => {
      const values = [proposal.reason];
      if (typeof proposal.value === "string") {
        values.push(proposal.value);
      }
      return values;
    })
    .filter((value) => typeof value === "string")
    .join(" ");
}

function proposalHumanText(proposal) {
  const values = [proposal.reason];
  if (typeof proposal.value === "string") {
    values.push(proposal.value);
  }
  return values.filter((value) => typeof value === "string").join(" ");
}

function photoIdList(items) {
  return items.map((item) => item.photo_id).join(", ");
}

function stableRank(seed, photoId) {
  return createHash("sha256").update(`${seed}\0${photoId}`).digest("hex");
}

function stableSample(items, count, seed) {
  return [...items]
    .sort((left, right) => stableRank(seed, left.photo_id).localeCompare(stableRank(seed, right.photo_id)))
    .slice(0, count);
}

async function readShardInputsFromDir(inputDir) {
  const filenames = (await listFilesIfExists(inputDir)).filter((filename) => /^shard-\d+-input\.json$/.test(filename)).sort();
  const rows = [];
  const photoToShard = new Map();
  for (const filename of filenames) {
    const inputPath = join(inputDir, filename);
    const payload = await readJsonIfExists(inputPath);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const shardName = formatShardNameFromFilename(filename);
    rows.push({
      count: items.length,
      inputPath,
      shard: shardName,
    });
    for (const item of items) {
      if (item?.photo_id) {
        photoToShard.set(item.photo_id, shardName);
      }
    }
  }
  return { photoToShard, rows };
}

async function buildShardMap(runDir, runId) {
  const candidates = [
    join("/tmp/ai-labeling-shards", runId, "inputs"),
    join(runDir, "proposal-shards"),
  ];
  for (const dir of candidates) {
    const result = await readShardInputsFromDir(dir);
    if (result.photoToShard.size > 0) {
      return result.photoToShard;
    }
  }
  return new Map();
}

async function inspectShardArtifacts(runDir, runId) {
  const standardDir = join("/tmp/ai-labeling-shards", runId);
  const runShardDir = join(runDir, "proposal-shards");
  const standardInputs = (await listFilesIfExists(join(standardDir, "inputs"))).filter((filename) => /^shard-\d+-input\.json$/.test(filename));
  const standardOutputs = (await listFilesIfExists(join(standardDir, "outputs"))).filter((filename) => /^shard-\d+-proposals\.json$/.test(filename));
  const runInputs = (await listFilesIfExists(runShardDir)).filter((filename) => /^shard-\d+-input\.json$/.test(filename));
  const runOutputs = (await listFilesIfExists(runShardDir)).filter((filename) => /^shard-\d+-proposals\.json$/.test(filename));

  const rows = [
    ["standard /tmp workspace", standardInputs.length, standardOutputs.length, standardDir],
    ["run proposal-shards", runInputs.length, runOutputs.length, runShardDir],
  ].filter(([, inputs, outputs]) => Number(inputs) > 0 || Number(outputs) > 0);

  const warnings = [];
  if (standardInputs.length > 0 && standardInputs.length !== standardOutputs.length) {
    warnings.push(`標準 shard workspace input/output 數不一致：${standardInputs.length} inputs, ${standardOutputs.length} outputs。`);
  }
  if (runInputs.length > 0 && runInputs.length !== runOutputs.length) {
    warnings.push(`run 內 proposal-shards input/output 數不一致：${runInputs.length} inputs, ${runOutputs.length} outputs。正式 proposal 仍以 root metadata-proposals.json 為準。`);
  }

  return { rows, warnings };
}

function isZeroPeopleContradiction(item) {
  if (item.fields.people_count?.value !== 0) {
    return false;
  }
  const sceneValues = valuesForField(item, "scene_tags");
  const hasPeopleScene = sceneValues.some((value) => peopleSceneValues.has(value));
  const reasonText = allReasonText(item);
  return hasPeopleScene || (peopleReasonPattern.test(reasonText) && !noPeopleReasonPattern.test(reasonText));
}

function proposalReason(item, field) {
  return item.fields[field]?.reason ?? "";
}

function proposalValue(item, field) {
  return item.fields[field]?.value ?? "";
}

function firstExistingField(item, fields) {
  return fields.find((field) => item.fields[field]) ?? Object.keys(item.fields)[0] ?? "";
}

function publicUseRiskItems(items) {
  return items.filter((item) => {
    if (["needs_review", "avoid"].includes(item.fields.public_use_status?.value)) {
      return false;
    }
    const hasChildScene = valuesForField(item, "scene_tags").includes("兒童");
    return hasChildScene || publicUseRiskPattern.test(allHumanText(item));
  });
}

function pushFocusRows(rows, seen, issue, items, field, maxRows = 8) {
  for (const item of items.slice(0, maxRows)) {
    const key = `${issue}\0${item.photo_id}\0${field}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push([
      issue,
      item.photo_id,
      fieldLabel(field, { includeRaw: true }),
      formatDisplayValue(field, proposalValue(item, field), { includeRaw: true }),
      proposalReason(item, field),
    ]);
    if (rows.length >= reviewFocusMaxRows) {
      return;
    }
  }
}

function pushSampleRows(rows, seen, source, items, preferredFields, maxRows = 8) {
  for (const item of items.slice(0, maxRows)) {
    const field = firstExistingField(item, preferredFields);
    if (!field) {
      continue;
    }
    const key = `${source}\0${item.photo_id}\0${field}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push([
      source,
      item.photo_id,
      fieldLabel(field, { includeRaw: true }),
      formatDisplayValue(field, proposalValue(item, field), { includeRaw: true }),
      proposalReason(item, field),
    ]);
    if (rows.length >= balancedSampleMaxRows) {
      return;
    }
  }
}

function buildSceneQaRows(items, photos, shardMap) {
  const rows = [
    sceneQaRow("run", "all", items, { minimumItems: largeRunMinimumItems, scope: "整批" }),
  ];
  const photosById = buildPhotoLookup(photos);
  const byAlbum = groupItemsBy(items, (item) => photosById.get(item.photo_id)?.album_title || "unknown");
  for (const [album, albumItems] of [...byAlbum.entries()].sort((left, right) => right[1].length - left[1].length)) {
    if (albumItems.length < lowSceneScopeMinimumItems) {
      continue;
    }
    const row = sceneQaRow("album", album, albumItems, { minimumItems: lowSceneScopeMinimumItems, scope: "相簿" });
    if (row[7]) {
      rows.push(row);
    }
  }

  if (shardMap.size > 0) {
    const byShard = groupItemsBy(items, (item) => shardMap.get(item.photo_id) || "unknown");
    for (const [shard, shardItems] of [...byShard.entries()].sort((left, right) => String(left[0]).localeCompare(String(right[0])))) {
      if (shardItems.length < lowSceneScopeMinimumItems) {
        continue;
      }
      const row = sceneQaRow("shard", shard, shardItems, { minimumItems: lowSceneScopeMinimumItems, scope: "分片" });
      if (row[7]) {
        rows.push(row);
      }
    }
  }

  return rows;
}

function buildReviewFocusRows(items) {
  const rows = [];
  const seen = new Set();
  const itemCount = items.length;
  const safeCrop = mostCommonValue(items, "safe_crop");
  const mood = mostCommonValue(items, "mood_tags");

  const missingScene = items.filter((item) => valuesForField(item, "scene_tags").length === 0);
  pushFocusRows(rows, seen, "缺少 scene_tags，影響場景召回", missingScene, "scene_tags");

  if (itemCount > 0 && safeCrop.count / itemCount >= concentrationThreshold) {
    pushFocusRows(
      rows,
      seen,
      `抽查 safe_crop = ${safeCrop.value}`,
      items.filter((item) => valuesForField(item, "safe_crop").includes(safeCrop.value)),
      "safe_crop",
    );
  }

  for (const [genericUse, threshold] of genericUseThresholds) {
    const useItems = items.filter((item) => valuesForField(item, "recommended_uses").includes(genericUse));
    if (itemCount > 0 && useItems.length / itemCount >= threshold) {
      pushFocusRows(rows, seen, `抽查 recommended_uses = ${genericUse}`, useItems, "recommended_uses");
    }
  }

  for (const [broadMood, threshold] of broadMoodThresholds) {
    const moodItems = items.filter((item) => valuesForField(item, "mood_tags").includes(broadMood));
    if (itemCount > 0 && moodItems.length / itemCount >= threshold) {
      pushFocusRows(rows, seen, `抽查 mood_tags = ${broadMood}`, moodItems, "mood_tags");
    }
  }

  if (itemCount > 0 && mood.count / itemCount >= concentrationThreshold) {
    pushFocusRows(
      rows,
      seen,
      `抽查 mood_tags = ${mood.value}`,
      items.filter((item) => valuesForField(item, "mood_tags").includes(mood.value)),
      "mood_tags",
    );
  }

  const sponsorReportItems = items.filter((item) =>
    valuesForField(item, "recommended_uses").includes("贊助成果報告")
    && valuesForField(item, "sponsorship_items").length === 0
    && valuesForField(item, "sponsorship_tags").length === 0,
  );
  pushFocusRows(rows, seen, "缺少贊助欄位但建議贊助成果報告", sponsorReportItems, "recommended_uses");

  const sponsorProposalItems = items.filter((item) =>
    valuesForField(item, "recommended_uses").includes("贊助提案")
    && valuesForField(item, "sponsorship_items").length === 0
    && valuesForField(item, "sponsorship_tags").length === 0,
  );
  pushFocusRows(rows, seen, "缺少贊助欄位但建議贊助提案", sponsorProposalItems, "recommended_uses");

  const zeroPeopleContradictions = items.filter(isZeroPeopleContradiction);
  pushFocusRows(rows, seen, "people_count = 0 但有人物線索", zeroPeopleContradictions, "people_count");

  pushFocusRows(
    rows,
    seen,
    "可能需要 public_use_status 抽查",
    publicUseRiskItems(items),
    "public_use_status",
  );

  const longEnglishTextItems = items.filter((item) => asciiWordPattern.test(allHumanText(item)));
  for (const item of longEnglishTextItems.slice(0, 8)) {
    const field = Object.entries(item.fields).find(([, proposal]) => asciiWordPattern.test(proposalHumanText(proposal)))?.[0]
      ?? "visual_description";
    pushFocusRows(rows, seen, "較長英文內容", [item], field, 1);
    if (rows.length >= reviewFocusMaxRows) {
      break;
    }
  }

  return rows.slice(0, reviewFocusMaxRows);
}

function buildBalancedSampleRows(items, { focusRows = [], shardMap = new Map() } = {}) {
  const rows = [];
  const seen = new Set();
  const byId = new Map(items.map((item) => [item.photo_id, item]));

  const focusItems = focusRows
    .map((row) => byId.get(row[1]))
    .filter(Boolean);
  pushSampleRows(rows, seen, "review focus", focusItems, ["scene_tags", "people_count", "safe_crop", "recommended_uses", "public_use_status"], 8);

  if (shardMap.size > 0) {
    const byShard = groupItemsBy(items, (item) => shardMap.get(item.photo_id) || "unknown");
    for (const [shard, shardItems] of [...byShard.entries()].sort((left, right) => String(left[0]).localeCompare(String(right[0])))) {
      const perShardCount = shardItems.length >= 20 ? 2 : 1;
      pushSampleRows(
        rows,
        seen,
        `shard sample: ${shard}`,
        stableSample(shardItems, perShardCount, `balanced-shard-${shard}`),
        ["visual_description", "subject_type", "scene_tags"],
        perShardCount,
      );
      if (rows.length >= balancedSampleMaxRows) {
        return rows;
      }
    }
  }

  const boundaryItems = items.filter((item) => ["food", "object", "screen", "text_signage"].includes(item.fields.subject_type?.value));
  pushSampleRows(
    rows,
    seen,
    "subject boundary",
    stableSample(boundaryItems, 8, "balanced-subject-boundary"),
    ["subject_type", "visual_description", "scene_tags"],
  );

  const riskItems = items.filter((item) =>
    item.fields.public_use_status
    || item.fields.safe_crop
    || valuesForField(item, "sponsorship_items").length > 0
    || valuesForField(item, "sponsorship_tags").length > 0
    || publicUseRiskItems([item]).length > 0,
  );
  pushSampleRows(
    rows,
    seen,
    "high-risk optional field",
    stableSample(riskItems, 10, "balanced-risk-fields"),
    ["public_use_status", "safe_crop", "sponsorship_items", "sponsorship_tags", "recommended_uses"],
  );

  pushSampleRows(
    rows,
    seen,
    "deterministic random",
    stableSample(items, 8, "balanced-random"),
    ["visual_description", "people_count", "subject_type"],
  );

  return rows.slice(0, balancedSampleMaxRows);
}

function buildReviewNotes(items, { sceneQaRows = [] } = {}) {
  const notes = [];
  const itemCount = items.length;
  const priorityCount = items.filter((item) => item.fields.priority_level).length;
  const publicUseStatusCount = items.filter((item) => item.fields.public_use_status).length;
  const needsReviewCount = items.filter((item) => item.fields.public_use_status?.value === "needs_review").length;
  const moodCount = items.filter((item) => item.fields.mood_tags).length;
  const recommendedUseCount = items.filter((item) => item.fields.recommended_uses).length;
  const sponsorReportItems = items.filter((item) =>
    valuesForField(item, "recommended_uses").includes("贊助成果報告")
    && valuesForField(item, "sponsorship_items").length === 0
    && valuesForField(item, "sponsorship_tags").length === 0,
  );
  const sponsorProposalItems = items.filter((item) =>
    valuesForField(item, "recommended_uses").includes("贊助提案")
    && valuesForField(item, "sponsorship_items").length === 0
    && valuesForField(item, "sponsorship_tags").length === 0,
  );
  const zeroPeopleContradictions = items.filter(isZeroPeopleContradiction);
  const longEnglishTextItems = items.filter((item) => asciiWordPattern.test(allHumanText(item)));
  const { confidenceCounts, perfectCount, total } = confidenceStats(items);
  const confidenceRows = confidenceByFieldRows(items);
  const confidenceCoveredFields = confidenceRows.filter((row) => Number(row[2]) > 0).length;
  const confidenceTotalFields = confidenceRows.length;
  const publicRiskItems = publicUseRiskItems(items);
  const sceneCount = items.filter((item) => valuesForField(item, "scene_tags").length > 0).length;

  if (priorityCount === itemCount && itemCount > 0) {
    notes.push("`priority_level` 每張都有候選值，請確認模型是否把它當成預設欄位。");
  }

  const mostCommonSafeCrop = mostCommonValue(items, "safe_crop");
  if (itemCount > 0 && mostCommonSafeCrop.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`safe_crop\` 的 \`${mostCommonSafeCrop.value}\` 出現在 ${mostCommonSafeCrop.count}/${itemCount} 張照片（${formatPercent(mostCommonSafeCrop.count / itemCount)}），請抽查是否過度套用。`,
    );
  } else if (
    itemCount >= smallRunMinimumItems
    && itemCount <= smallRunMaximumItems
    && mostCommonSafeCrop.count / itemCount >= smallRunConcentrationThreshold
  ) {
    notes.push(
      `小批次中 \`safe_crop\` 的 \`${mostCommonSafeCrop.value}\` 出現在 ${mostCommonSafeCrop.count}/${itemCount} 張照片（${formatPercent(mostCommonSafeCrop.count / itemCount)}）；這不一定是錯，但建議抽查是否把常見比例當成預設。`,
    );
  }

  const mostCommonNegativeSpace = mostCommonValue(items, "has_negative_space");
  if (itemCount > 0 && mostCommonNegativeSpace.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`has_negative_space = ${mostCommonNegativeSpace.value}\` 出現在 ${mostCommonNegativeSpace.count}/${itemCount} 張照片（${formatPercent(mostCommonNegativeSpace.count / itemCount)}），請確認模型是否逐張判斷版面留白。`,
    );
  }

  const mostCommonSceneTag = mostCommonValue(items, "scene_tags");
  if (itemCount >= largeRunMinimumItems && sceneCount / itemCount < prominentSceneRunCoverageThreshold) {
    notes.push(
      `\`scene_tags\` 只出現在 ${sceneCount}/${itemCount} 張照片（${formatPercent(sceneCount / itemCount)}），低於 ${formatPercent(prominentSceneRunCoverageThreshold)}；這很可能會降低找圖召回，建議優先檢查 prompt 或重跑低覆蓋 shard。`,
    );
  } else if (itemCount >= largeRunMinimumItems && sceneCount / itemCount < lowSceneRunCoverageThreshold) {
    notes.push(
      `\`scene_tags\` 出現在 ${sceneCount}/${itemCount} 張照片（${formatPercent(sceneCount / itemCount)}），低於 ${formatPercent(lowSceneRunCoverageThreshold)}；請抽查是否過度保守。`,
    );
  }
  if (itemCount > 0 && mostCommonSceneTag.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`scene_tags\` 的 \`${mostCommonSceneTag.value}\` 出現在 ${mostCommonSceneTag.count}/${itemCount} 張照片（${formatPercent(mostCommonSceneTag.count / itemCount)}），請確認是否過度套用同一場景標籤。`,
    );
  }
  const qaIssues = sceneQaRows.filter((row) => row[7]).slice(0, 8);
  for (const row of qaIssues) {
    notes.push(`${row[0]} \`${row[1]}\`: ${row[7]}。`);
  }

  const mostCommonMoodTag = mostCommonValue(items, "mood_tags");
  if (moodCount === itemCount && itemCount > 0) {
    notes.push("每張照片都有 `mood_tags` 候選值；請確認模型是否把情緒標籤當成必填分類。普通紀錄照可以省略。");
  } else if (itemCount >= lowMoodCoverageMinimumItems && moodCount / itemCount < lowMoodCoverageThreshold) {
    notes.push(
      `只有 ${moodCount}/${itemCount} 張照片提出 \`mood_tags\`（${formatPercent(moodCount / itemCount)}）；若本批包含適合社群宣傳、招募、網站橫幅或情緒找圖的照片，請抽查模型是否過度保守。`,
    );
  } else if (itemCount > 0 && moodCount / itemCount >= concentrationThreshold) {
    notes.push(
      `有 ${moodCount}/${itemCount} 張照片提出 \`mood_tags\`（${formatPercent(moodCount / itemCount)}），請抽查是否只有在情緒或宣傳語感明確時才標。`,
    );
  }
  for (const [mood, threshold] of broadMoodThresholds) {
    const moodValueCount = items.filter((item) => valuesForField(item, "mood_tags").includes(mood)).length;
    if (itemCount > 0 && moodValueCount / itemCount >= threshold) {
      notes.push(
        `\`mood_tags = ${mood}\` 出現在 ${moodValueCount}/${itemCount} 張照片（${formatPercent(moodValueCount / itemCount)}），請抽查是否被當成泛用感受。`,
      );
    }
  }
  if (itemCount > 0 && mostCommonMoodTag.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`mood_tags\` 的 \`${mostCommonMoodTag.value}\` 出現在 ${mostCommonMoodTag.count}/${itemCount} 張照片（${formatPercent(mostCommonMoodTag.count / itemCount)}），情緒標籤區辨度可能不足。`,
    );
  }

  const mostCommonUse = mostCommonValue(items, "recommended_uses");
  if (itemCount > 0 && mostCommonUse.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`recommended_uses\` 的 \`${mostCommonUse.value}\` 出現在 ${mostCommonUse.count}/${itemCount} 張照片（${formatPercent(mostCommonUse.count / itemCount)}），用途區辨度可能不足。`,
    );
  }
  if (recommendedUseCount === itemCount && itemCount > 0) {
    notes.push("每張照片都有 `recommended_uses` 候選值；請確認模型是否把用途當成必填欄位。普通可用但沒有明確用途優勢的照片可以省略。");
  }
  for (const [genericUse, threshold] of genericUseThresholds) {
    const useCount = items.filter((item) => valuesForField(item, "recommended_uses").includes(genericUse)).length;
    if (itemCount > 0 && useCount / itemCount >= threshold) {
      notes.push(
        `\`recommended_uses = ${genericUse}\` 出現在 ${useCount}/${itemCount} 張照片（${formatPercent(useCount / itemCount)}），請抽查是否被當成通用預設用途。`,
      );
    }
  }

  if (publicUseStatusCount === 0) {
    notes.push("沒有 `public_use_status` 候選值；若本批沒有明顯 avoid 照片，這可以接受。");
  } else if (itemCount > 0 && needsReviewCount / itemCount >= concentrationThreshold) {
    notes.push(
      `\`public_use_status = needs_review\` 出現在 ${needsReviewCount}/${itemCount} 張照片（${formatPercent(needsReviewCount / itemCount)}），可能被當成預設填空；請確認每張是否有具體公開使用疑慮。`,
    );
  }
  if (publicRiskItems.length > 0) {
    notes.push(
      `有 ${publicRiskItems.length} 張照片出現兒童、名牌、姓名、QR code、識別證或清晰臉部等公開使用風險線索，但沒有 \`public_use_status = needs_review\` 或 \`avoid\`：${photoIdList(publicRiskItems)}。請人工抽查。`,
    );
  }
  if (total === 0) {
    notes.push("所有候選值都未提供 `confidence`；格式允許省略，但不利於人工排序與抽查。");
  } else if (perfectCount / total > 0.25) {
    notes.push("有偏多 `confidence = 1`，人數、用途與情緒欄位仍應人工抽查。");
  }
  if (total > 0 && confidenceCoveredFields > 0 && confidenceCoveredFields < confidenceTotalFields) {
    notes.push(
      `\`confidence\` 只出現在 ${confidenceCoveredFields}/${confidenceTotalFields} 個有 proposal 的欄位；若模型選擇提供信心分數，應盡量穩定覆蓋同一類欄位，否則不宜直接拿來排序。`,
    );
  }
  const mostCommonConfidence = confidenceCounts[0];
  if (mostCommonConfidence && total > 0 && mostCommonConfidence.count / total >= concentrationThreshold) {
    notes.push(
      `\`confidence = ${mostCommonConfidence.value}\` 出現在 ${mostCommonConfidence.count}/${total} 個候選欄位（${formatPercent(mostCommonConfidence.count / total)}），信心分數可能沒有逐欄反映不確定性。`,
    );
  }
  if (sponsorReportItems.length > 0) {
    notes.push(
      `有 ${sponsorReportItems.length} 張照片建議 \`贊助成果報告\` 但沒有 \`sponsorship_items\` 或 \`sponsorship_tags\`：${photoIdList(sponsorReportItems)}。通常應移除該用途，除非照片或既有 metadata 有明確贊助脈絡。`,
    );
  }
  if (sponsorProposalItems.length > 0) {
    notes.push(
      `有 ${sponsorProposalItems.length} 張照片建議 \`贊助提案\` 但沒有 \`sponsorship_items\` 或 \`sponsorship_tags\`：${photoIdList(sponsorProposalItems)}。請確認是否真的能支撐贊助溝通情境。`,
    );
  }
  if (zeroPeopleContradictions.length > 0) {
    notes.push(
      `有 ${zeroPeopleContradictions.length} 張照片的 \`people_count = 0\`，但 scene tags 或 reason 仍提到人物相關線索：${photoIdList(zeroPeopleContradictions)}。請人工確認人數。`,
    );
  }
  if (longEnglishTextItems.length > 0) {
    notes.push(
      `有 ${longEnglishTextItems.length} 張照片的 reason 或 \`visual_description\` 出現較長英文段落：${photoIdList(longEnglishTextItems)}。除非是在引用照片中可見文字，否則應改用台灣慣用繁體中文。`,
    );
  }

  return notes;
}

function buildPromptVersionNotes(manifest) {
  const currentPrompt = getAiLabelingPromptMetadata();
  if (!manifest.prompt_template_sha256) {
    return ["這個 run 沒有記錄 `prompt_template_sha256`；可能是較舊的工作包，prompt 版本無法追溯。"];
  }
  if (manifest.prompt_template_sha256 !== currentPrompt.prompt_template_sha256) {
    return [
      `這個 run 使用的 prompt template hash \`${manifest.prompt_template_sha256.slice(0, 12)}\` 不同於目前 repo 版本 \`${currentPrompt.prompt_template_sha256.slice(0, 12)}\`；若要用新版 prompt 評估模型，請重新建立 run 或 attempt。`,
    ];
  }
  return [];
}

function renderSummary({ artifactRows, diffPath, layerRows, manifest, notes, outputDir, plan, proposals, runDir, sample, sceneQaRows, shardMap, shardRows, summaryPath }) {
  const items = proposals.items;
  const fieldCountRows = fieldCounts(items).map(({ field, count }) => [
    fieldLabel(field, { includeRaw: true }),
    count,
  ]);
  const confidenceRows = confidenceByFieldRows(items);
  const distributionTableRows = distributionFields.flatMap((field) =>
    distributionRows(items, field).map(([rowField, value, count]) => [
      fieldLabel(rowField, { includeRaw: true }),
      formatDisplayValue(rowField, value, { includeRaw: true }),
      count,
    ]),
  );
  const focusRows = buildReviewFocusRows(items);
  const balancedSampleRows = buildBalancedSampleRows(items, { focusRows, shardMap });
  const promptTemplate = manifest.prompt_template_path || "unknown";
  const promptHash = manifest.prompt_template_sha256 ? manifest.prompt_template_sha256.slice(0, 12) : "unknown";
  const sampleRows = plan.updates.slice(0, sample).map((update) => [
    update.photo_id,
    fieldLabel(update.field, { includeRaw: true }),
    formatDisplayValue(update.field, update.current_value, { includeRaw: true }),
    formatDisplayValue(update.field, update.proposed_value, { includeRaw: true }),
    update.confidence ?? "",
    update.reason,
  ]);

  const lines = [
    "# AI Review Summary",
    "",
    `- Run: \`${manifest.run_id}\``,
    `- Producer: ${proposals.producer.type} / ${proposals.producer.name}`,
    `- Image size: \`${manifest.image_size ?? ""}\``,
    `- Prompt template: \`${promptTemplate}\` @ \`${promptHash}\``,
    `- Proposal items: ${items.length}`,
    `- Planned updates: ${plan.update_count}`,
    "",
    "## Output Files",
    "",
    `- Review summary: \`${summaryPath}\``,
    `- Human diff: \`${diffPath}\``,
    `- Update plan JSON: \`${plan.json_output}\``,
    `- Update plan CSV: \`${plan.csv_output}\``,
    ...(outputDir === runDir ? [] : ["", `Review artifacts 已寫在 run 目錄外：\`${outputDir}\`.`]),
    "",
    "## Review Notes",
    "",
    ...(notes.length > 0 ? notes.map((note) => `- ${note}`) : ["- 未偵測到明顯的批次層級警訊；仍請抽查照片與 reason。"]),
    "",
    "## Review Focus",
    "",
    focusRows.length > 0
      ? table(["issue", "photo_id", "field", "proposed", "reason"], focusRows)
      : "No specific focus rows were generated from review warnings.",
    "",
    "## Balanced Review Sample",
    "",
    balancedSampleRows.length > 0
      ? table(["source", "photo_id", "field", "proposed", "reason"], balancedSampleRows)
      : "No balanced review sample rows were generated.",
    "",
    "## Artifact Provenance",
    "",
    artifactRows.length > 0
      ? table(["key", "value"], artifactRows)
      : "No artifact provenance details were generated.",
    "",
    shardRows.length > 0
      ? table(["source", "input shards", "proposal shards", "path"], shardRows)
      : "No shard artifacts were detected.",
    "",
    "## Layer Coverage",
    "",
    table(["layer", "field", "proposal count", "coverage"], layerRows),
    "",
    "## Scene QA",
    "",
    sceneQaRows.length > 0
      ? table(["scope", "name", "items", "with scene_tags", "coverage", "tag density", "top tag", "issue"], sceneQaRows)
      : "No scene QA rows were generated.",
    "",
    "## Field Coverage",
    "",
    table(["field", "proposal count"], fieldCountRows),
    "",
    "## Confidence By Field",
    "",
    confidenceRows.length > 0
      ? table(["field", "proposal count", "confidence count", "coverage", "average", "confidence = 1"], confidenceRows)
      : "No fields were proposed.",
    "",
    "## Value Distribution",
    "",
    distributionTableRows.length > 0
      ? table(["field", "value", "count"], distributionTableRows)
      : "No distribution fields were proposed.",
    "",
    "## Planned Update Sample",
    "",
    sampleRows.length > 0
      ? table(["photo_id", "field", "current", "proposed", "confidence", "reason"], sampleRows)
      : "No changed updates in this plan.",
    "",
    "## Next Commands",
    "",
    ...(outputDir === runDir
      ? [
          "Open a single-run HTML report:",
          "",
          "```bash",
          `pnpm ai:report -- --run ${runDir}`,
          "```",
          "",
          "Compare this run with another attempt:",
          "",
          "```bash",
          `pnpm ai:report -- --runs ${runDir} tmp/ai-runs/<other-run-or-attempt>`,
          "```",
          "",
          "Dry-run exact Google Sheets cells:",
          "",
          "```bash",
          `pnpm sheets:apply-ai-updates -- --run-dir ${runDir}`,
          "```",
          "",
          "Apply after human confirmation:",
          "",
          "```bash",
          `pnpm sheets:apply-ai-updates -- --run-dir ${runDir} --write`,
          "```",
          "",
        ]
      : [
          "這是暫存 review。proposal 被採用並寫回 run 目錄後，請重新執行：",
          "",
          "```bash",
          `pnpm ai:review -- --run-dir ${runDir}`,
          "```",
          "",
        ]),
  ];

  return lines.join("\n");
}

async function reviewAiRun(options) {
  await mkdir(options.outputDir, { recursive: true });
  const diffOutputPath = join(options.outputDir, "metadata-diff.md");
  const jsonOutputPath = join(options.outputDir, "metadata-update-plan.json");
  const csvOutputPath = join(options.outputDir, "metadata-update-plan.csv");

  const validation = await validateAiProposals({
    proposalsPath: options.proposalsPath,
    runDir: options.runDir,
  });

  const diff = await renderDiff({
    outputPath: diffOutputPath,
    proposalsPath: options.proposalsPath,
    runDir: options.runDir,
  });

  const plan = await buildPlan({
    csvOutputPath,
    help: false,
    includeUnchanged: false,
    jsonOutputPath,
    proposalsPath: options.proposalsPath,
    runDir: options.runDir,
  });

  const [manifest, photos, proposals, proposalText] = await Promise.all([
    readJson(join(options.runDir, "manifest.json")),
    readJson(join(options.runDir, "photos.json")),
    readJson(options.proposalsPath),
    readFile(options.proposalsPath, "utf8"),
  ]);
  const shardMap = await buildShardMap(options.runDir, manifest.run_id);
  const shardInspection = await inspectShardArtifacts(options.runDir, manifest.run_id);
  const sceneQaRows = buildSceneQaRows(proposals.items, photos, shardMap);
  const layerRows = layerCoverageRows(proposals.items);
  const artifactRows = [
    ["final proposals", options.proposalsPath],
    ["final proposals sha256", sha256Text(proposalText)],
    ["photos source", manifest.photos_source ?? ""],
    ["image link mode", manifest.image_link_mode ?? ""],
    ["source runs", Array.isArray(manifest.source_runs) ? String(manifest.source_runs.length) : ""],
  ].filter(([, value]) => String(value ?? "").trim());
  const notes = [
    ...buildPromptVersionNotes(manifest),
    ...shardInspection.warnings,
    ...validation.warnings,
    ...buildReviewNotes(proposals.items, { sceneQaRows }),
  ];
  const summary = renderSummary({
    artifactRows,
    diffPath: diff.outputPath,
    layerRows,
    manifest,
    notes,
    outputDir: options.outputDir,
    plan,
    proposals,
    runDir: options.runDir,
    sample: options.sample,
    sceneQaRows,
    shardMap,
    shardRows: shardInspection.rows,
    summaryPath: options.summaryPath,
  });
  await writeFile(options.summaryPath, summary);

  return {
    diffPath: diff.outputPath,
    diffRows: diff.rowCount,
    itemCount: validation.itemCount,
    planCsvPath: plan.csv_output,
    planJsonPath: plan.json_output,
    runId: validation.runId,
    summaryPath: options.summaryPath,
    updateCount: plan.update_count,
    warningCount: notes.length,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await reviewAiRun(options);
  console.log(`AI run reviewed: ${result.runId}`);
  console.log(`- proposals: ${result.itemCount}`);
  console.log(`- diff rows: ${result.diffRows}`);
  console.log(`- planned updates: ${result.updateCount}`);
  console.log(`- review warnings: ${result.warningCount}`);
  console.log(`- summary: ${result.summaryPath}`);
  console.log(`- diff: ${result.diffPath}`);
  console.log(`- update plan: ${result.planJsonPath}`);
  console.log(`- update CSV: ${result.planCsvPath}`);
  console.log("");
  console.log("Next:");
  console.log(`- Review ${result.summaryPath}`);
  console.log(`- Open ${result.planCsvPath} to inspect all values that may be written`);
  if (options.outputDir === options.runDir) {
    console.log(`- Open single-run report: pnpm ai:report -- --run ${options.runDir}`);
    console.log(`- Compare attempts: pnpm ai:report -- --runs ${options.runDir} tmp/ai-runs/<other-run-or-attempt>`);
    console.log(`- Dry-run Sheets cells: pnpm sheets:apply-ai-updates -- --run-dir ${options.runDir}`);
  } else {
    console.log(`- Temporary review artifacts are in ${options.outputDir}`);
    console.log(`- After accepting the proposal, write it to the run directory and rerun: pnpm ai:review -- --run-dir ${options.runDir}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not review AI run: ${error.message}`);
    process.exitCode = 1;
  }
}
