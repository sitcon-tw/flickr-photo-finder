import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  controlledListFields,
  controlledScalarFields,
  listFields,
  photoFields,
} from "./photo-schema.mjs";

const defaultProposalFile = "metadata-proposals.json";
const allowedAiFields = new Set([
  "people_count",
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "sponsorship_items",
  "sponsorship_tags",
  "orientation",
  "has_negative_space",
  "safe_crop",
  "public_use_status",
  "priority_level",
  "collections",
  "curation_status",
]);

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

function validateTaxonomyValue(photoId, field, value, taxonomy, errors) {
  if (!taxonomy[field]?.includes(value)) {
    errors.push(formatFieldError(photoId, field, `unknown taxonomy value "${value}"`));
  }
}

function validateFieldValue(photoId, field, value, taxonomy, fieldSchema, errors) {
  if (field === "curation_status" && value !== "ai_labeled") {
    errors.push(formatFieldError(photoId, field, "AI proposals may only set ai_labeled"));
    return;
  }

  if (field === "public_use_status" && value === "approved") {
    errors.push(formatFieldError(photoId, field, "AI proposals must not set approved"));
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
    if (!allowedAiFields.has(field)) {
      errors.push(formatFieldError(photoId, field, "field is not allowed in AI proposals"));
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

export async function validateAiProposals(options) {
  const [manifest, photos, proposals, taxonomy] = await Promise.all([
    readJson(join(options.runDir, "manifest.json")),
    readJson(join(options.runDir, "photos.json")),
    readJson(options.proposalsPath),
    readJson("data/tag-taxonomy.json"),
  ]);

  const errors = [];
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
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  return {
    itemCount: proposals.items.length,
    runId: proposals.run_id,
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
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not validate AI proposals: ${error.message}`);
    process.exitCode = 1;
  }
}
