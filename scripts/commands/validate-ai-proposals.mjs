import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  aiBaselineFields,
  aiValueConstraints,
  allowedAiFields,
  allowedAiFieldSet,
  controlledListFields,
  controlledScalarFields,
  humanOnlyFieldSet,
  listFields,
  photoFields,
} from "../lib/core/photo-schema.mjs";

const defaultProposalFile = "metadata-proposals.json";
const repeatedVisualReasonThreshold = 5;
const visualDescriptionMinLength = 20;
const visualDescriptionShortWarningLength = 24;
const visualDescriptionMaxRecommendedLength = 80;
const visualDescriptionSimilarityThreshold = 0.75;
const reasonTemplatePattern = /推測值|預設為|照片方向預設|圖片尺寸為|一般而言/;
const nonVisualLanguagePattern = /推測|可能是|應該是|預設|通常|一般而言|如圖|如題|推測值|畫面尺寸為\s*\d+\s*x\s*\d+|圖片尺寸為\s*\d+\s*x\s*\d+/i;
const tentativeVisualLanguagePattern = /似乎|看起來像|疑似|大概|約略|約為/;
const nonVisiblePurposeLanguagePattern =
  /適合|可用於|可作為|象徵|展現(?:出)?|代表(?:了)?|呈現(?:出)?.*(?:精神|氛圍|成果|價值)|宣傳|推廣/;
const sponsorshipVisualLanguagePattern = /贊助|スポンサー|sponsor|Sponsor|品牌露出|廠商|Logo\s*牆|標誌牆/;
const concreteVisualPattern =
  /桌|椅|旗|布條|背板|看板|投影|螢幕|講台|麥克風|相機|鏡頭|手機|筆電|餐點|茶點|炸雞|披薩|飲料|盤|碗|杯|袋|背包|證件|掛繩|手|臉|眼鏡|口罩|衣|帽|站|坐|拿|看|聽|交談|拍攝|排隊|合照|前景|背景|左側|右側|中央|桌上|牆面|白板|黑板|文字|標誌|logo|Logo|SITCON/;
const visualEvidenceFields = new Set([...allowedAiFields].filter((field) => field !== "curation_status"));
const visualDescriptionSearchTokenGroups = [
  ["people", /人|人物|講者|學員|會眾|工作人員|志工|參與者|主持人|學生|小朋友|孩童|青年|男子|女子|攝影者/],
  ["object", /桌|椅|旗|布條|背板|看板|投影|螢幕|講台|麥克風|相機|鏡頭|手機|筆電|餐點|茶點|炸雞|披薩|飲料|盤|碗|杯|袋|背包|證件|掛繩|海報|立牌|紙張|紙盒|線材/],
  ["action", /站|坐|拿|看|聽|交談|說明|拍攝|排隊|合照|操作|書寫|指向|展示|討論|走|舉手|低頭|圍著/],
  ["text", /文字|字樣|標誌|標示|logo|Logo|SITCON|投影片|白板|黑板|手寫|標題|看板/],
  ["spatial", /前景|背景|左側|右側|中央|旁邊|前方|後方|桌上|牆面|門口|入口|走廊|教室|會場|舞台|攤位|戶外|室內/],
];

function printUsage() {
  console.log(`Usage:
  pnpm ai:validate -- --run-dir <dir>

Options:
  --run-dir <dir>       AI run directory containing manifest.json and photos.json.
  --proposals <path>    Proposal JSON path. Default: <run-dir>/metadata-proposals.json.
  --help, -h            Show this help.

Expected metadata-proposals.json shape:
{
  "proposal_version": 1,
  "run_id": "ai-prepare-...",
  "created_at": "2026-05-08T00:00:00.000Z",
  "producer": {
    "type": "ai",
    "name": "agent or model name"
  },
  "items": [
    {
      "photo_id": "55200405673",
      "fields": {
        "scene_tags": {
          "value": ["舞台"],
          "reason": "Short reason for human review",
          "confidence": 0.8
        }
      }
    }
  ]
}`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    proposalsPath: "",
    runDir: "",
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
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.runDir) {
      throw new Error("--run-dir requires a path");
    }
    if (!options.proposalsPath) {
      options.proposalsPath = join(options.runDir, defaultProposalFile);
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

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoLikeDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateProposalRoot(proposals, errors) {
  if (!isPlainObject(proposals)) {
    errors.push("metadata proposals must be a JSON object");
    return;
  }

  if (proposals.proposal_version !== 1) {
    errors.push("proposal_version must be 1");
  }

  if (typeof proposals.run_id !== "string" || !proposals.run_id.trim()) {
    errors.push("run_id is required");
  }

  if (!isIsoLikeDate(proposals.created_at)) {
    errors.push("created_at must be an ISO-like date string");
  }

  if (!isPlainObject(proposals.producer)) {
    errors.push("producer must be an object");
  } else {
    if (typeof proposals.producer.type !== "string" || !proposals.producer.type.trim()) {
      errors.push("producer.type is required");
    }
    if (typeof proposals.producer.name !== "string" || !proposals.producer.name.trim()) {
      errors.push("producer.name is required");
    }
  }

  if (!Array.isArray(proposals.items)) {
    errors.push("items must be an array");
  }
}

function validateRunMatch(manifest, photos, proposals, errors) {
  if (proposals.run_id && proposals.run_id !== manifest.run_id) {
    errors.push(`run_id must match manifest run_id ${manifest.run_id}`);
  }

  if (!Array.isArray(photos)) {
    errors.push("photos.json must be an array");
  }
}

function formatFieldError(photoId, field, message) {
  return `${photoId}.${field}: ${message}`;
}

function validateConfidence(photoId, field, proposal, errors) {
  if (proposal.confidence === undefined) {
    return;
  }
  if (typeof proposal.confidence !== "number" || proposal.confidence < 0 || proposal.confidence > 1) {
    errors.push(formatFieldError(photoId, field, "confidence must be a number between 0 and 1"));
  }
}

function validateReason(photoId, field, proposal, errors) {
  if (typeof proposal.reason !== "string" || !proposal.reason.trim()) {
    errors.push(formatFieldError(photoId, field, "reason is required"));
  }
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return JSON.stringify([...value].sort());
  }
  return JSON.stringify(value);
}

function normalizeReason(reason) {
  return reason.replace(/\s+/g, " ").trim();
}

function normalizeTextForSimilarity(value) {
  return String(value)
    .toLowerCase()
    .replace(/[，。、「」『』（）()：:；;,.!?！？\s]/g, "")
    .trim();
}

function characterBigrams(value) {
  const normalized = normalizeTextForSimilarity(value);
  if (normalized.length < 2) {
    return new Set(normalized ? [normalized] : []);
  }
  const bigrams = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.add(normalized.slice(index, index + 2));
  }
  return bigrams;
}

function jaccardSimilarity(left, right) {
  const leftSet = characterBigrams(left);
  const rightSet = characterBigrams(right);
  if (leftSet.size === 0 && rightSet.size === 0) {
    return 1;
  }
  const intersectionSize = [...leftSet].filter((value) => rightSet.has(value)).length;
  const unionSize = new Set([...leftSet, ...rightSet]).size;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function nonSpaceLength(value) {
  return String(value).replace(/\s+/g, "").length;
}

function visualDescriptionSearchTokenGroupCount(value) {
  return visualDescriptionSearchTokenGroups
    .filter(([, pattern]) => pattern.test(value))
    .length;
}

export function visualDescriptionQualityWarningsForItem(item) {
  if (!isPlainObject(item) || typeof item.photo_id !== "string" || !isPlainObject(item.fields)) {
    return [];
  }
  const proposal = item.fields.visual_description;
  if (!isPlainObject(proposal) || typeof proposal.value !== "string" || !proposal.value.trim()) {
    return [];
  }

  const warnings = [];
  const value = proposal.value;
  const length = nonSpaceLength(value);
  if (length >= visualDescriptionMinLength && length < visualDescriptionShortWarningLength) {
    warnings.push({
      kind: "short",
      message: `description is short but valid (${length} non-space characters)`,
      photoId: item.photo_id,
    });
  }
  if (length > visualDescriptionMaxRecommendedLength) {
    warnings.push({
      kind: "long",
      message: `description is longer than ${visualDescriptionMaxRecommendedLength} non-space characters (${length})`,
      photoId: item.photo_id,
    });
  }
  if (tentativeVisualLanguagePattern.test(value)) {
    warnings.push({
      kind: "tentative",
      message: "description uses tentative visual language that should be checked against the image",
      photoId: item.photo_id,
    });
  }
  if (nonVisiblePurposeLanguagePattern.test(value)) {
    warnings.push({
      kind: "non-visible-purpose",
      message: "description may include purpose, interpretation, or promotional language instead of visible details",
      photoId: item.photo_id,
    });
  }
  if (visualDescriptionSearchTokenGroupCount(value) < 2) {
    warnings.push({
      kind: "weak-search-tokens",
      message: "description has limited searchable visual token variety",
      photoId: item.photo_id,
    });
  }
  if (
    sponsorshipVisualLanguagePattern.test(value)
    && (!Array.isArray(item.fields.sponsorship_items?.value) || item.fields.sponsorship_items.value.length === 0)
    && (!Array.isArray(item.fields.sponsorship_tags?.value) || item.fields.sponsorship_tags.value.length === 0)
  ) {
    warnings.push({
      kind: "unsupported-sponsorship",
      message: "description mentions sponsorship or brand context without sponsorship_items or sponsorship_tags",
      photoId: item.photo_id,
    });
  }
  return warnings;
}

function validateVisualDescription(photoId, value, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(formatFieldError(photoId, "visual_description", "value must be a non-empty string"));
    return;
  }
  const length = nonSpaceLength(value);
  if (length < visualDescriptionMinLength) {
    errors.push(
      formatFieldError(
        photoId,
        "visual_description",
        `value must be at least ${visualDescriptionMinLength} non-space characters`,
      ),
    );
  }
  if (nonVisualLanguagePattern.test(value)) {
    errors.push(
      formatFieldError(
        photoId,
        "visual_description",
        "value uses uncertain, template, or non-visual language",
      ),
    );
  }
  if (!concreteVisualPattern.test(value)) {
    errors.push(
      formatFieldError(
        photoId,
        "visual_description",
        "value should include concrete visible details such as objects, actions, text, positions, or spatial relationships",
      ),
    );
  }
}

function validateBatchVisualDescriptionQuality(proposals, warnings) {
  if (!Array.isArray(proposals.items)) {
    return;
  }

  const byKind = new Map();
  for (const item of proposals.items) {
    for (const warning of visualDescriptionQualityWarningsForItem(item)) {
      const photoIds = byKind.get(warning.kind) ?? [];
      photoIds.push(warning.photoId);
      byKind.set(warning.kind, photoIds);
    }
  }

  const labels = new Map([
    ["short", "short-but-valid descriptions"],
    ["long", "overly long descriptions"],
    ["tentative", "tentative visual language"],
    ["non-visible-purpose", "purpose or interpretation language"],
    ["weak-search-tokens", "limited searchable visual token variety"],
    ["unsupported-sponsorship", "sponsorship language without sponsorship fields"],
  ]);
  for (const [kind, photoIds] of byKind.entries()) {
    const sampleIds = photoIds.slice(0, 10).join(", ");
    const suffix = photoIds.length > 10 ? ", ..." : "";
    warnings.push(
      `visual_description: ${labels.get(kind) ?? kind} for ${photoIds.length} photos (${sampleIds}${suffix})`,
    );
  }
}

function validateTaxonomyValue(photoId, field, value, taxonomy, errors) {
  if (!taxonomy[field]?.includes(value)) {
    errors.push(formatFieldError(photoId, field, `unknown taxonomy value "${value}"`));
  }
}

function validateFieldValue(photoId, field, value, taxonomy, fieldSchema, errors) {
  const constraints = aiValueConstraints[field] ?? {};
  if (Array.isArray(constraints.allowed_values) && !constraints.allowed_values.includes(value)) {
    const message = field === "curation_status"
      ? "AI proposals may only set ai_labeled"
      : `AI proposals may only set ${constraints.allowed_values.join(", ")}`;
    errors.push(formatFieldError(photoId, field, message));
    return;
  }

  if (Array.isArray(constraints.disallowed_values) && constraints.disallowed_values.includes(value)) {
    const message = field === "public_use_status" && value === "approved"
      ? "AI proposals must not set approved"
      : `AI proposals must not set ${value}`;
    errors.push(formatFieldError(photoId, field, message));
    return;
  }

  if (field === "people_count") {
    if (!isNonNegativeInteger(value)) {
      errors.push(formatFieldError(photoId, field, "value must be a non-negative integer"));
    }
    return;
  }

  if (field === "has_negative_space") {
    if (typeof value !== "boolean") {
      errors.push(formatFieldError(photoId, field, "value must be boolean"));
    }
    return;
  }

  if (field === "visual_description") {
    validateVisualDescription(photoId, value, errors);
    return;
  }

  if (listFields.includes(field)) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
      errors.push(formatFieldError(photoId, field, "value must be an array of non-empty strings"));
      return;
    }
    const duplicateValues = value.filter((item, index) => value.indexOf(item) !== index);
    if (duplicateValues.length > 0) {
      errors.push(formatFieldError(photoId, field, `value has duplicates: ${[...new Set(duplicateValues)].join(", ")}`));
    }
    if (controlledListFields.includes(field)) {
      for (const item of value) {
        validateTaxonomyValue(photoId, field, item, taxonomy, errors);
      }
    }
    return;
  }

  if (controlledScalarFields.includes(field)) {
    if (typeof value !== "string" || !value.trim()) {
      errors.push(formatFieldError(photoId, field, "value must be a non-empty string"));
      return;
    }
    validateTaxonomyValue(photoId, field, value, taxonomy, errors);
    return;
  }

  if (fieldSchema.type === "string" || fieldSchema.type === "text") {
    if (typeof value !== "string" || !value.trim()) {
      errors.push(formatFieldError(photoId, field, "value must be a non-empty string"));
    }
    return;
  }

  errors.push(formatFieldError(photoId, field, `unsupported field type ${fieldSchema.type}`));
}

function validateProposalItem(item, context, errors) {
  if (!isPlainObject(item)) {
    errors.push("each item must be an object");
    return;
  }

  const photoId = item.photo_id;
  if (typeof photoId !== "string" || !photoId.trim()) {
    errors.push("item.photo_id is required");
    return;
  }

  if (!context.photoIds.has(photoId)) {
    errors.push(`${photoId}: photo_id is not in this AI run`);
  }

  if (!isPlainObject(item.fields)) {
    errors.push(`${photoId}: fields must be an object`);
    return;
  }

  for (const [field, proposal] of Object.entries(item.fields)) {
    if (!allowedAiFieldSet.has(field)) {
      const message = humanOnlyFieldSet.has(field)
        ? "field is human-only and not allowed in AI proposals"
        : "field is not allowed in AI proposals";
      errors.push(formatFieldError(photoId, field, message));
      continue;
    }
    if (!isPlainObject(proposal)) {
      errors.push(formatFieldError(photoId, field, "proposal must be an object"));
      continue;
    }
    if (!Object.hasOwn(proposal, "value")) {
      errors.push(formatFieldError(photoId, field, "value is required"));
      continue;
    }

    validateReason(photoId, field, proposal, errors);
    validateConfidence(photoId, field, proposal, errors);
    validateFieldValue(photoId, field, proposal.value, context.taxonomy, context.fieldSchemas.get(field), errors);
  }
}

function validateBatchReasonQuality(proposals, warnings) {
  if (!Array.isArray(proposals.items)) {
    return;
  }

  const repeated = new Map();
  const templatedReasons = new Map();
  const visualDescriptions = [];
  for (const item of proposals.items) {
    if (!isPlainObject(item) || typeof item.photo_id !== "string" || !isPlainObject(item.fields)) {
      continue;
    }
    for (const [field, proposal] of Object.entries(item.fields)) {
      if (!visualEvidenceFields.has(field) || !isPlainObject(proposal) || !Object.hasOwn(proposal, "value")) {
        continue;
      }
      if (typeof proposal.reason !== "string" || !proposal.reason.trim()) {
        continue;
      }

      if (field === "visual_description" && typeof proposal.value === "string") {
        visualDescriptions.push({
          photoId: item.photo_id,
          value: proposal.value,
        });
      }

      const normalizedReason = normalizeReason(proposal.reason);
      if (reasonTemplatePattern.test(normalizedReason)) {
        const templateKey = `${field}\u0000${normalizedReason}`;
        const photoIds = templatedReasons.get(templateKey) ?? [];
        photoIds.push(item.photo_id);
        templatedReasons.set(templateKey, photoIds);
      }

      const key = `${field}\u0000${stableValue(proposal.value)}\u0000${normalizeReason(proposal.reason)}`;
      const photoIds = repeated.get(key) ?? [];
      photoIds.push(item.photo_id);
      repeated.set(key, photoIds);
    }
  }

  for (const [key, photoIds] of repeated.entries()) {
    if (photoIds.length < repeatedVisualReasonThreshold) {
      continue;
    }
    const [field, value, reason] = key.split("\u0000");
    const sampleIds = photoIds.slice(0, 10).join(", ");
    const suffix = photoIds.length > 10 ? ", ..." : "";
    warnings.push(
      `${field}: identical value and reason reused for ${photoIds.length} photos (${sampleIds}${suffix}); value=${value}; reason="${reason}"`,
    );
  }

  for (const [key, photoIds] of templatedReasons.entries()) {
    const [field, reason] = key.split("\u0000");
    const sampleIds = photoIds.slice(0, 10).join(", ");
    const suffix = photoIds.length > 10 ? ", ..." : "";
    warnings.push(
      `${field}: reason uses template or non-visual language for ${photoIds.length} photos (${sampleIds}${suffix}); reason="${reason}"`,
    );
  }

  const parent = visualDescriptions.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) {
      parent[cursor] = parent[parent[cursor]];
      cursor = parent[cursor];
    }
    return cursor;
  };
  const unite = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  for (let leftIndex = 0; leftIndex < visualDescriptions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < visualDescriptions.length; rightIndex += 1) {
      const left = visualDescriptions[leftIndex];
      const right = visualDescriptions[rightIndex];
      const similarity = jaccardSimilarity(left.value, right.value);
      if (similarity < visualDescriptionSimilarityThreshold) {
        continue;
      }
      unite(leftIndex, rightIndex);
    }
  }

  const duplicateClusters = new Map();
  visualDescriptions.forEach((description, index) => {
    const root = find(index);
    const cluster = duplicateClusters.get(root) ?? [];
    cluster.push(description);
    duplicateClusters.set(root, cluster);
  });
  for (const cluster of duplicateClusters.values()) {
    if (cluster.length < 2) {
      continue;
    }
    const sampleIds = cluster.slice(0, 10).map((item) => item.photoId).join(", ");
    const suffix = cluster.length > 10 ? ", ..." : "";
    warnings.push(
      `visual_description: near-duplicate description cluster for ${cluster.length} photos (${sampleIds}${suffix})`,
    );
  }
}

function validateBaselineCoverage(proposals, warnings) {
  if (!Array.isArray(proposals.items) || aiBaselineFields.length === 0) {
    return;
  }

  const missingByField = new Map();
  for (const item of proposals.items) {
    if (!isPlainObject(item) || typeof item.photo_id !== "string" || !isPlainObject(item.fields)) {
      continue;
    }
    for (const field of aiBaselineFields) {
      if (Object.hasOwn(item.fields, field)) {
        continue;
      }
      const photoIds = missingByField.get(field) ?? [];
      photoIds.push(item.photo_id);
      missingByField.set(field, photoIds);
    }
  }

  for (const [field, photoIds] of missingByField.entries()) {
    const sampleIds = photoIds.slice(0, 10).join(", ");
    const suffix = photoIds.length > 10 ? ", ..." : "";
    warnings.push(
      `${field}: missing AI baseline field for ${photoIds.length} photos (${sampleIds}${suffix})`,
    );
  }
}

export async function validateAiProposals(options) {
  const [manifest, photos, proposals, taxonomy] = await Promise.all([
    readJson(join(options.runDir, "manifest.json")),
    readJson(join(options.runDir, "photos.json")),
    readJson(options.proposalsPath),
    readJson("data/tag-taxonomy.json"),
  ]);

  const errors = [];
  const warnings = [];
  validateProposalRoot(proposals, errors);
  validateRunMatch(manifest, photos, proposals, errors);

  const photoIds = new Set(Array.isArray(photos) ? photos.map((photo) => photo.photo_id).filter(Boolean) : []);
  const fieldSchemas = new Map(photoFields.map((field) => [field.name, field]));
  const seenProposalIds = new Set();

  if (Array.isArray(proposals.items)) {
    for (const item of proposals.items) {
      if (isPlainObject(item) && typeof item.photo_id === "string") {
        if (seenProposalIds.has(item.photo_id)) {
          errors.push(`${item.photo_id}: duplicate proposal item`);
        }
        seenProposalIds.add(item.photo_id);
      }
      validateProposalItem(item, { fieldSchemas, photoIds, taxonomy }, errors);
    }
    validateBatchReasonQuality(proposals, warnings);
    validateBatchVisualDescriptionQuality(proposals, warnings);
    validateBaselineCoverage(proposals, warnings);
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  return {
    itemCount: proposals.items.length,
    runId: proposals.run_id,
    warnings,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await validateAiProposals(options);
  console.log(`AI proposals are valid for ${result.runId} (${result.itemCount} item(s)).`);
  if (result.warnings.length > 0) {
    console.warn(`AI proposal review warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) {
      console.warn(`- ${warning}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not validate AI proposals: ${error.message}`);
    process.exitCode = 1;
  }
}
