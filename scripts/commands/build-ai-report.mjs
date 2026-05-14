import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { getAiLabelingPromptMetadata } from "../lib/ai/ai-labeling-prompt.mjs";
import { aiFieldLayerName, allowedAiFields } from "../lib/core/photo-schema.mjs";
import { defaultMetadataDisplayContext, fieldLabel } from "../lib/core/metadata-display.mjs";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultOutputRoot = "tmp/ai-reports";
const proposalFile = "metadata-proposals.json";
const reviewSummaryFile = "metadata-review-summary.md";
const updatePlanFile = "metadata-update-plan.json";

const preferredFieldOrder = allowedAiFields;
const watchFields = new Set(["scene_tags", "visual_description", "sponsorship_items", "sponsorship_tags", "public_use_status", "safe_crop"]);
const disagreementWatchFields = new Set(["safe_crop", "recommended_uses", "public_use_status"]);
const majorityOutlierFields = new Set(["people_count", "subject_type", "orientation"]);
const largePeopleCountGap = 10;
const extremePeopleCountGap = 20;
const peopleCountSpikeValues = new Set([3, 4, 5, 6, 7, 8, 9, 10]);
const peopleCountSpikeThreshold = 0.15;
const lowDescriptionOverlapThreshold = 0.08;
const descriptionPairOverlapThreshold = 0.12;

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

async function listFilesIfExists(path) {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

function formatShardNameFromFilename(filename) {
  return filename.match(/shard-(\d+)/)?.[0] ?? filename.replace(/\.(json|md)$/, "");
}

async function readShardInputsFromDir(dir) {
  const result = new Map();
  const candidateDirs = [dir, join(dir, "inputs")];
  for (const candidateDir of candidateDirs) {
    const filenames = await listFilesIfExists(candidateDir);
    for (const filename of filenames.filter((name) => /shard-\d+.*input\.json$/.test(name)).sort()) {
      const payload = await readJsonIfExists(join(candidateDir, filename));
      const shardName = typeof payload?.shard === "number"
        ? `shard-${String(payload.shard).padStart(2, "0")}`
        : formatShardNameFromFilename(filename);
      for (const item of payload?.items ?? []) {
        if (item?.photo_id) {
          result.set(item.photo_id, shardName);
        }
      }
    }
  }
  return result;
}

async function readShardMapForRun(runDir, manifest) {
  const shardMap = new Map();
  const candidates = [
    join(runDir, "proposal-shards"),
    join("/tmp/ai-labeling-shards", manifest.run_id || basename(runDir)),
  ];
  for (const dir of candidates) {
    const map = await readShardInputsFromDir(dir);
    for (const [photoId, shard] of map.entries()) {
      if (!shardMap.has(photoId)) {
        shardMap.set(photoId, shard);
      }
    }
  }
  return shardMap;
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

function displayValueKey(value) {
  if (value === undefined) {
    return "(missing)";
  }
  return stableValue(value);
}

function countStableValues(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]), "zh-Hant"))
    .map(([value, count]) => ({ count, value }));
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

export function peopleCountDistribution(items) {
  const values = items
    .map((item) => item.fields?.people_count?.value)
    .filter((value) => Number.isInteger(value) && value >= 0);
  const topValues = countStableValues(values).slice(0, 8).map((entry) => ({
    count: entry.count,
    ratio: values.length > 0 ? entry.count / values.length : 0,
    value: entry.value,
  }));
  return {
    count: values.length,
    spike_values: topValues.filter((entry) =>
      values.length >= 200
      && peopleCountSpikeValues.has(Number(entry.value))
      && entry.ratio >= peopleCountSpikeThreshold,
    ),
    top_values: topValues,
  };
}

export function runQualityStatus(run) {
  if (run.validation.status === "invalid") {
    return "invalid";
  }
  if (run.validation.status === "missing") {
    return "missing";
  }
  if (run.isReviewSummaryStale) {
    return "stale-review";
  }
  if (run.validation.warning_count > 0) {
    return "valid-with-warnings";
  }
  return "valid";
}

function fieldValue(attempt, field) {
  const proposal = attempt.fields[field];
  return proposal && Object.prototype.hasOwnProperty.call(proposal, "value") ? proposal.value : undefined;
}

function fieldValueKeys(attempts, field, { includeMissing = true } = {}) {
  return attempts
    .map((attempt, index) => ({
      index,
      key: displayValueKey(fieldValue(attempt, field)),
      value: fieldValue(attempt, field),
    }))
    .filter((entry) => includeMissing || entry.value !== undefined);
}

function tokenizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .match(/[a-z0-9]+|[\u3400-\u9fff]/g) ?? [];
}

function jaccardSimilarity(left, right) {
  const leftSet = new Set(tokenizeText(left));
  const rightSet = new Set(tokenizeText(right));
  if (leftSet.size === 0 && rightSet.size === 0) {
    return 1;
  }
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? intersection / union : 0;
}

function averagePairwiseTextSimilarity(values) {
  const texts = values.filter((value) => typeof value === "string" && value.trim().length >= 20);
  if (texts.length < 2) {
    return 1;
  }
  let total = 0;
  let pairs = 0;
  for (let left = 0; left < texts.length; left += 1) {
    for (let right = left + 1; right < texts.length; right += 1) {
      total += jaccardSimilarity(texts[left], texts[right]);
      pairs += 1;
    }
  }
  return pairs > 0 ? total / pairs : 1;
}

function descriptionOutlierIndex(values) {
  const texts = values.map((value) => (typeof value === "string" ? value.trim() : ""));
  if (texts.length !== 3 || texts.some((text) => text.length < 20)) {
    return -1;
  }
  const pairs = [
    [0, 1, jaccardSimilarity(texts[0], texts[1])],
    [0, 2, jaccardSimilarity(texts[0], texts[2])],
    [1, 2, jaccardSimilarity(texts[1], texts[2])],
  ];
  const strongest = [...pairs].sort((left, right) => right[2] - left[2])[0];
  if (!strongest || strongest[2] < descriptionPairOverlapThreshold) {
    return -1;
  }
  const outlier = [0, 1, 2].find((index) => index !== strongest[0] && index !== strongest[1]);
  const outlierSimilarities = pairs.filter((pair) => pair[0] === outlier || pair[1] === outlier).map((pair) => pair[2]);
  return outlierSimilarities.every((value) => value < lowDescriptionOverlapThreshold) ? outlier : -1;
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
  const shardByPhotoId = await readShardMapForRun(runDir, manifest);
  for (const item of proposals?.items ?? []) {
    if (!item?.photo_id || !item.fields) {
      continue;
    }
    itemsByPhotoId.set(item.photo_id, item);
    Object.keys(item.fields).forEach((field) => fields.add(field));
  }

  const planUpdates = Array.isArray(updatePlan?.updates) ? updatePlan.updates.length : null;
  const peopleCountDistributionForRun = peopleCountDistribution(proposals?.items ?? []);

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
    peopleCountDistribution: peopleCountDistributionForRun,
    proposals,
    reviewFocus,
    runDir,
    shardByPhotoId,
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
      warnings.push(`${run.label} has ${run.validation.error_count} validation error(s); mark it as contract failed and do not use it for quality comparison.`);
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
      warnings.push(`${run.label} 的 metadata-review-summary.md 比 metadata-proposals.json 舊；這個 run 的 Review Focus 視為 stale，品質比較前請先重新執行 pnpm ai:review。`);
    }
    for (const spike of run.peopleCountDistribution?.spike_values ?? []) {
      warnings.push(`${run.label} 的 people_count = ${spike.value} 出現在 ${spike.count}/${run.peopleCountDistribution.count} 張（${formatPercent(spike.ratio)}），可能是批次化 fallback，請看 Review Focus 或重跑抽查。`);
    }
  }

  return warnings;
}

function diagnosticKey(issue) {
  return `${issue.type}\0${issue.field ?? ""}\0${issue.label}`;
}

function pushDiagnostic(issues, issue) {
  const key = diagnosticKey(issue);
  if (issues.some((existing) => diagnosticKey(existing) === key)) {
    return;
  }
  issues.push(issue);
}

function buildPhotoDiagnostics(attempts, runLabels) {
  const issues = [];
  const peopleEntries = fieldValueKeys(attempts, "people_count", { includeMissing: false })
    .filter((entry) => Number.isFinite(entry.value));
  if (peopleEntries.length >= 2) {
    const counts = peopleEntries.map((entry) => Number(entry.value));
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const gap = max - min;
    if (gap >= largePeopleCountGap) {
      pushDiagnostic(issues, {
        field: "people_count",
        label: `people_count 差距 ${gap}`,
        severity: gap >= extremePeopleCountGap ? "high" : "medium",
        type: "people_count_gap",
      });
      if (gap >= extremePeopleCountGap) {
        pushDiagnostic(issues, {
          field: "people_count",
          label: `人數極端分歧 ${gap}`,
          severity: "high",
          type: "image_alignment_suspect",
        });
      }
    }
  }

  const subjectEntries = fieldValueKeys(attempts, "subject_type", { includeMissing: false });
  const subjectValueCount = new Set(subjectEntries.map((entry) => entry.key)).size;
  if (subjectValueCount > 1) {
    pushDiagnostic(issues, {
      field: "subject_type",
      label: subjectValueCount >= Math.min(3, subjectEntries.length) ? "subject_type 全模型分歧" : "subject_type 不一致",
      severity: subjectValueCount >= Math.min(3, subjectEntries.length) ? "high" : "medium",
      type: "subject_type_disagreement",
    });
    if (subjectValueCount >= Math.min(3, subjectEntries.length)) {
      pushDiagnostic(issues, {
        field: "subject_type",
        label: "subject_type 全模型不同",
        severity: "high",
        type: "image_alignment_suspect",
      });
    }
  }

  const publicUseEntries = fieldValueKeys(attempts, "public_use_status");
  const publicUseFlagged = publicUseEntries.filter((entry) => ["needs_review", "avoid"].includes(entry.value));
  if (publicUseFlagged.length === 1 && attempts.length >= 2) {
    pushDiagnostic(issues, {
      field: "public_use_status",
      label: `${runLabels[publicUseFlagged[0].index]} 單獨標 public_use_status`,
      severity: "high",
      type: "public_use_single_flag",
    });
  }

  for (const field of disagreementWatchFields) {
    const entries = fieldValueKeys(attempts, field, { includeMissing: field === "public_use_status" });
    const nonMissing = entries.filter((entry) => entry.value !== undefined);
    const distinct = new Set(entries.map((entry) => entry.key));
    const nonMissingDistinct = new Set(nonMissing.map((entry) => entry.key));
    if (
      (field === "public_use_status" && distinct.size >= Math.min(3, attempts.length))
      || (field !== "public_use_status" && nonMissing.length >= 3 && nonMissingDistinct.size >= 3)
    ) {
      pushDiagnostic(issues, {
        field,
        label: `${field} 高分歧`,
        severity: field === "public_use_status" ? "high" : "medium",
        type: "field_high_disagreement",
      });
    }
  }

  for (const field of majorityOutlierFields) {
    const entries = fieldValueKeys(attempts, field, { includeMissing: false });
    const counts = countStableValues(entries.map((entry) => entry.key));
    const majority = counts[0];
    const outliers = counts.slice(1);
    if (majority?.count >= 2 && outliers.length > 0 && outliers.reduce((sum, entry) => sum + entry.count, 0) === 1) {
      const outlierKey = outliers[0].value;
      const outlierEntry = entries.find((entry) => entry.key === outlierKey);
      if (field === "people_count" && Math.abs(Number(outlierEntry?.value) - Number(JSON.parse(majority.value))) < 3) {
        continue;
      }
      pushDiagnostic(issues, {
        field,
        label: `${runLabels[outlierEntry?.index ?? 0]} outlier`,
        severity: field === "people_count" || field === "subject_type" ? "high" : "medium",
        type: "majority_outlier",
      });
    }
  }

  const descriptions = attempts.map((attempt) => fieldValue(attempt, "visual_description"));
  const descriptionOverlap = averagePairwiseTextSimilarity(descriptions);
  const descriptionOutlier = descriptionOutlierIndex(descriptions);
  const hasHighStructuralDisagreement = issues.some((issue) =>
    ["people_count_gap", "subject_type_disagreement", "field_high_disagreement"].includes(issue.type)
    && issue.severity === "high",
  );
  if (descriptionOutlier >= 0) {
    pushDiagnostic(issues, {
      field: "visual_description",
      label: `${runLabels[descriptionOutlier]} 描述 outlier`,
      severity: "high",
      type: "image_alignment_suspect",
    });
  } else if (descriptionOverlap < lowDescriptionOverlapThreshold && hasHighStructuralDisagreement) {
    pushDiagnostic(issues, {
      field: "visual_description",
      label: `描述重疊低 (${Math.round(descriptionOverlap * 100)}%)`,
      severity: "high",
      type: "image_alignment_suspect",
    });
  }

  return issues;
}

function buildDiagnosticSummary(photos) {
  const issueCounts = countStableValues(photos.flatMap((photo) => photo.diagnostics.map((issue) => issue.type)));
  const topPhotos = photos
    .filter((photo) => photo.diagnostics.length > 0)
    .map((photo) => ({
      album_title: photo.album_title,
      issue_count: photo.diagnostics.length,
      issues: photo.diagnostics.map((issue) => issue.label),
      photo_id: photo.photo_id,
      score: photo.diagnostics.reduce((sum, issue) => sum + (issue.severity === "high" ? 2 : 1), 0),
    }))
    .sort((left, right) => right.score - left.score || right.issue_count - left.issue_count || left.photo_id.localeCompare(right.photo_id))
    .slice(0, 20);
  return {
    alignment_suspect_count: photos.filter((photo) => photo.diagnostics.some((issue) => issue.type === "image_alignment_suspect")).length,
    high_disagreement_count: photos.filter((photo) => photo.diagnostics.some((issue) => ["high", "medium"].includes(issue.severity))).length,
    issue_counts: issueCounts,
    top_photos: topPhotos,
  };
}

export function buildPeopleCountPairSummary(photos, runLabels) {
  const deltas = [];
  for (const photo of photos) {
    const values = photo.attempts
      .map((attempt, index) => ({ index, value: attempt.fields.people_count?.value }))
      .filter((entry) => Number.isFinite(entry.value));
    if (values.length < 2) {
      continue;
    }
    const counts = values.map((entry) => Number(entry.value));
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    deltas.push({
      max,
      min,
      photo_id: photo.photo_id,
      range: max - min,
      values: values.map((entry) => `${runLabels[entry.index]}=${entry.value}`).join(", "),
    });
  }
  return {
    exact_match_count: deltas.filter((entry) => entry.range === 0).length,
    extreme_delta_count: deltas.filter((entry) => entry.range >= extremePeopleCountGap).length,
    large_delta_count: deltas.filter((entry) => entry.range >= largePeopleCountGap).length,
    paired_count: deltas.length,
    top_deltas: deltas.sort((left, right) => right.range - left.range || left.photo_id.localeCompare(right.photo_id)).slice(0, 10),
  };
}

function buildReportData(runs, options) {
  const fieldSet = new Set(runs.flatMap((run) => [...run.fields]));
  const orderedFields = fieldOrder(fieldSet);
  const photoIds = uniquePhotoOrder(runs);
  const photoLookup = buildPhotoLookup(runs);
  const mode = options.mode === "auto" ? (runs.length === 1 ? "single" : "compare") : options.mode;
  const runLabels = runs.map((run) => run.label);

  const photos = photoIds.map((photoId) => {
    const source = photoLookup.get(photoId);
    const photo = source?.photo ?? { photo_id: photoId };
    const attempts = runs.map((run) => {
      const item = run.itemsByPhotoId.get(photoId);
      return {
        fields: item?.fields ?? {},
        focus: run.reviewFocus.filter((row) => row.photo_id === photoId),
        has_photo: run.photoIds.has(photoId),
        has_proposal: Boolean(item),
        run_id: run.manifest.run_id || run.label,
        shard: run.shardByPhotoId.get(photoId) || "",
      };
    });
    const diagnostics = mode === "compare" ? buildPhotoDiagnostics(attempts, runLabels) : [];
    return {
      album_title: photo.album_title || "",
      curation_notes: photo.curation_notes || "",
      diagnostics,
      image_src: source ? imageSourceFor(photo, source.runDir, options.outputDir) : "",
      photo_id: photoId,
      photo_url: photo.photo_url || "",
      preview_url: photo.image_preview_url || "",
      attempts,
    };
  });
  const diagnosticSummary = mode === "compare"
    ? buildDiagnosticSummary(photos)
    : { alignment_suspect_count: 0, high_disagreement_count: 0, issue_counts: [], top_photos: [] };
  const peopleCountPairSummary = mode === "compare"
    ? buildPeopleCountPairSummary(photos, runLabels)
    : { exact_match_count: 0, extreme_delta_count: 0, large_delta_count: 0, paired_count: 0, top_deltas: [] };

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
      people_count_distribution: run.peopleCountDistribution,
      proposal_count: run.proposals?.items?.length ?? 0,
      prompt_template_path: run.manifest.prompt_template_path || "",
      prompt_template_sha256: run.manifest.prompt_template_sha256 || "",
      round: run.attempt?.round || "",
      run_dir: run.runDir,
      run_id: run.manifest.run_id || "",
      quality_status: runQualityStatus(run),
      status: run.validation.status,
      warning_count: run.validation.warning_count,
    })),
    field_labels: Object.fromEntries(orderedFields.map((field) => [field, fieldLabel(field, { includeRaw: true })])),
    field_layers: Object.fromEntries(orderedFields.map((field) => [field, aiFieldLayerName(field)])),
    fields: orderedFields,
    generated_at: new Date().toISOString(),
    diagnostic_summary: diagnosticSummary,
    mode,
    option_labels: defaultMetadataDisplayContext.taxonomy.option_labels ?? {},
    photos,
    people_count_pair_summary: peopleCountPairSummary,
    title: options.title || (mode === "single" ? "AI 初標單次檢視報表" : "AI 初標比較報表"),
    watch_fields: [...watchFields],
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
    .summary, .controls, .attempts, .warnings, .coverage, .diagnostic-pills {
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
      grid-template-columns: minmax(240px, 1.5fr) repeat(3, minmax(130px, 1fr));
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
    .diagnostic-row {
      border: 1px solid #fdba74;
      border-radius: 6px;
      background: var(--warn-soft);
      color: var(--warn);
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
      <select id="album-filter"></select>
      <select id="shard-filter"></select>
      <select id="layer-filter"></select>
      <select id="field-filter"></select>
      <select id="focus-filter"></select>
      <select id="status-filter">
        <option value="all">所有照片</option>
        <option value="diff">有差異</option>
        <option value="missing">有缺 proposal</option>
        <option value="focus">需優先抽查</option>
        <option value="disagreement">高分歧</option>
        <option value="alignment">疑似錯圖</option>
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
    const watchFields = new Set(data.watch_fields || []);
    const state = {
      album: "all",
      field: "all",
      focusIssue: "all",
      layer: "all",
      onlyDiffFields: false,
      search: "",
      shard: "all",
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
    const albumFilter = document.getElementById("album-filter");
    const shardFilter = document.getElementById("shard-filter");
    const layerFilter = document.getElementById("layer-filter");
    const fieldFilter = document.getElementById("field-filter");
    const focusFilter = document.getElementById("focus-filter");
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

    function fieldLayerLabel(field) {
      const layer = data.field_layers?.[field] || "";
      if (layer === "baseline") return "baseline";
      if (layer === "recall") return "recall";
      if (layer === "optional") return "optional";
      return "";
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
      const ordered = [...preferredFields.filter((field) => fields.has(field)), ...[...fields].filter((field) => !preferredFields.includes(field)).sort()];
      return state.layer === "all" ? ordered : ordered.filter((field) => fieldLayerLabel(field) === state.layer);
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
      for (const diagnostic of photo.diagnostics || []) {
        parts.push(diagnostic.label || "", diagnostic.type || "", diagnostic.field || "");
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
      if (!isSingleMode) {
        const peopleSummary = data.people_count_pair_summary || {};
        summary.append(
          el("span", data.diagnostic_summary?.high_disagreement_count ? "pill warn" : "pill good", "高分歧 " + (data.diagnostic_summary?.high_disagreement_count || 0) + " 張"),
          el("span", data.diagnostic_summary?.alignment_suspect_count ? "pill bad" : "pill good", "疑似錯圖 " + (data.diagnostic_summary?.alignment_suspect_count || 0) + " 張"),
          el("span", peopleSummary.large_delta_count ? "pill warn" : "pill good", "人數差距>=10 " + (peopleSummary.large_delta_count || 0) + " 張"),
          el("span", "pill", "人數配對 " + (peopleSummary.exact_match_count || 0) + "/" + (peopleSummary.paired_count || 0) + " 相同"),
        );
      }
    }

    function renderAttemptPills() {
      attempts.replaceChildren();
      for (const attempt of data.attempts) {
        const statusClass = attempt.quality_status === "valid"
          ? "good"
          : attempt.quality_status === "missing" || attempt.quality_status === "valid-with-warnings" || attempt.quality_status === "stale-review"
            ? "warn"
            : "bad";
        const statusLabel = attempt.quality_status === "valid"
          ? "valid"
          : attempt.quality_status === "valid-with-warnings"
            ? "valid with warnings"
            : attempt.quality_status === "stale-review"
              ? "stale review"
              : attempt.quality_status === "missing"
                ? "missing proposal"
                : "contract failed";
        const promptHash = attempt.prompt_template_sha256 ? "prompt " + attempt.prompt_template_sha256.slice(0, 12) : "prompt unknown";
        const peopleSpike = (attempt.people_count_distribution?.spike_values || []).map((entry) => "people_count=" + entry.value + " " + Math.round(entry.ratio * 100) + "%").join(", ");
        const parts = [
          attempt.label || attempt.run_id,
          statusLabel,
          promptHash,
          attempt.is_review_summary_stale ? "review summary 過期" : "",
          peopleSpike,
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
      if (!isSingleMode && (data.diagnostic_summary?.top_photos || []).length > 0) {
        const top = data.diagnostic_summary.top_photos.slice(0, 8);
        warnings.append(el("div", "warning", "多模型分歧最高：" + top.map((photo) => photo.photo_id + "（" + photo.issues.slice(0, 2).join("、") + "）").join("；")));
      }
      if (!isSingleMode && (data.people_count_pair_summary?.top_deltas || []).length > 0) {
        const topDeltas = data.people_count_pair_summary.top_deltas.slice(0, 6).filter((entry) => entry.range >= 10);
        if (topDeltas.length > 0) {
          warnings.append(el("div", "warning", "people_count 最大差距：" + topDeltas.map((entry) => entry.photo_id + "（差距 " + entry.range + "；" + entry.values + "）").join("；")));
        }
      }
      for (const attempt of data.attempts) {
        if (attempt.errors.length > 0) {
          warnings.append(el("div", "warning", attempt.label + ": " + attempt.errors[0]));
        }
      }
    }

    function renderFilters() {
      const albums = [...new Set(data.photos.map((photo) => photo.album_title).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-Hant"));
      albumFilter.replaceChildren();
      for (const [value, label] of [["all", "所有相簿"], ...albums.map((album) => [album, album])]) {
        const option = el("option", "", label);
        option.value = value;
        option.selected = value === state.album;
        albumFilter.append(option);
      }

      const shards = [...new Set(data.photos.flatMap((photo) => photo.attempts.map((attempt) => attempt.shard).filter(Boolean)))].sort();
      shardFilter.replaceChildren();
      for (const [value, label] of [["all", "所有 shard"], ...shards.map((shard) => [shard, shard])]) {
        const option = el("option", "", label);
        option.value = value;
        option.selected = value === state.shard;
        shardFilter.append(option);
      }

      const layerOptions = [["all", "所有 layer"], ["baseline", "baseline"], ["recall", "recall"], ["optional", "optional"]];
      layerFilter.replaceChildren();
      for (const [value, label] of layerOptions) {
        const option = el("option", "", label);
        option.value = value;
        option.selected = value === state.layer;
        layerFilter.append(option);
      }

      const fieldsForLayer = state.layer === "all" ? data.fields : data.fields.filter((field) => fieldLayerLabel(field) === state.layer);
      if (state.field !== "all" && !fieldsForLayer.includes(state.field)) {
        state.field = "all";
      }
      const options = [["all", "所有欄位"], ...fieldsForLayer.map((field) => [field, fieldLabel(field)])];
      fieldFilter.replaceChildren();
      for (const [value, label] of options) {
        const option = el("option", "", label);
        option.value = value;
        option.selected = value === state.field;
        fieldFilter.append(option);
      }

      const focusIssues = [...new Set(data.photos.flatMap((photo) => photo.attempts.flatMap((attempt) => (attempt.focus || []).map((focus) => focus.issue))))].sort((left, right) => left.localeCompare(right, "zh-Hant"));
      focusFilter.replaceChildren();
      for (const [value, label] of [["all", "所有警訊"], ...focusIssues.map((issue) => [issue, issue])]) {
        const option = el("option", "", label);
        option.value = value;
        option.selected = value === state.focusIssue;
        focusFilter.append(option);
      }

      const statusOptions = isSingleMode
        ? [["all", "所有照片"], ["with-proposal", "有 proposal"], ["missing", "缺 proposal"], ["focus", "需優先抽查"]]
        : [["all", "所有照片"], ["diff", "有差異"], ["missing", "有缺 proposal"], ["focus", "需優先抽查"], ["disagreement", "高分歧"], ["alignment", "疑似錯圖"]];
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
      const shards = [...new Set(photo.attempts.map((attempt) => attempt.shard).filter(Boolean))];
      if (shards.length > 0) media.append(el("div", "meta", "shard: " + shards.join(", ")));
      if (photo.curation_notes) media.append(el("div", "meta", photo.curation_notes));
      if ((photo.diagnostics || []).length > 0) {
        const diagnosticLine = el("div", "diagnostic-pills");
        for (const diagnostic of photo.diagnostics.slice(0, 4)) {
          diagnosticLine.append(el("span", diagnostic.severity === "high" ? "pill bad" : "pill warn", diagnostic.label));
        }
        media.append(diagnosticLine);
      }
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
          const layerLabel = fieldLayerLabel(field);
          if (layerLabel) {
            fieldLine.append(el("span", "pill", layerLabel));
          }
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
      if ((photo.diagnostics || []).length > 0) {
        const diagnosticBox = el("div", "diagnostic-row");
        diagnosticBox.textContent = "多模型分歧：" + photo.diagnostics
          .slice(0, 5)
          .map((issue) => issue.label + (issue.field ? " / " + fieldLabel(issue.field) : ""))
          .join("；");
        comparison.append(diagnosticBox);
      }
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
        const fieldCell = el("td", "field-name");
        fieldCell.append(el("div", "", fieldLabel(field)));
        const layerLabel = fieldLayerLabel(field);
        if (layerLabel) fieldCell.append(el("div", "meta", layerLabel));
        row.append(fieldCell);
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

    function photoHasFocusIssue(photo, issue) {
      return photo.attempts.some((attempt) => (attempt.focus || []).some((focus) => focus.issue === issue));
    }

    function photoHasDiagnostic(photo) {
      return (photo.diagnostics || []).length > 0;
    }

    function photoHasAlignmentSuspect(photo) {
      return (photo.diagnostics || []).some((issue) => issue.type === "image_alignment_suspect");
    }

    function photoHasShard(photo, shard) {
      return photo.attempts.some((attempt) => attempt.shard === shard);
    }

    function filteredPhotos() {
      const query = state.search.trim().toLowerCase();
      return data.photos.filter((photo) => {
        if (query && !searchableText(photo).includes(query)) return false;
        if (state.album !== "all" && photo.album_title !== state.album) return false;
        if (state.shard !== "all" && !photoHasShard(photo, state.shard)) return false;
        if (state.focusIssue !== "all" && !photoHasFocusIssue(photo, state.focusIssue)) return false;
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
        if (state.status === "disagreement" && !photoHasDiagnostic(photo)) return false;
        if (state.status === "alignment" && !photoHasAlignmentSuspect(photo)) return false;
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
    albumFilter.addEventListener("change", () => {
      state.album = albumFilter.value;
      resetAndRenderPhotos();
    });
    shardFilter.addEventListener("change", () => {
      state.shard = shardFilter.value;
      resetAndRenderPhotos();
    });
    layerFilter.addEventListener("change", () => {
      state.layer = layerFilter.value;
      renderFilters();
      resetAndRenderPhotos();
    });
    fieldFilter.addEventListener("change", () => {
      state.field = fieldFilter.value;
      resetAndRenderPhotos();
    });
    focusFilter.addEventListener("change", () => {
      state.focusIssue = focusFilter.value;
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not build AI report: ${error.message}`);
    process.exitCode = 1;
  }
}
