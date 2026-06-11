import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultArtifactDirName = "photo-artifacts";
const defaultManifestFile = "artifact-manifest.json";
const defaultProposalFile = "metadata-proposals.json";
const defaultVisualAuditFile = "visual-inspection-audit.json";

function printUsage() {
  console.log(`Usage:
  pnpm ai:artifacts:merge -- --run-dir <dir>

Options:
  --run-dir <dir>          AI run directory containing manifest.json and photos.json.
  --artifact-dir <dir>     Per-photo artifact directory. Default: <run-dir>/photo-artifacts.
  --proposals <path>       Output proposal path. Default: <run-dir>/metadata-proposals.json.
  --visual-audit <path>    Output visual audit path. Default: <run-dir>/visual-inspection-audit.json.
  --manifest <path>        Output artifact manifest path. Default: <run-dir>/artifact-manifest.json.
  --producer-name <name>   Producer name for merged root proposal. Default: per-photo-artifact-agent.
  --created-at <iso-date>  Proposal created_at. Default: current time.
  --allow-missing          Allow photos without per-photo artifacts.
  --help, -h               Show this help.

This command merges one JSON artifact per photo into metadata-proposals.json
and visual-inspection-audit.json. It validates the merged proposal but does not
write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    allowMissing: false,
    artifactDir: "",
    createdAt: "",
    help: false,
    manifestPath: "",
    producerName: "per-photo-artifact-agent",
    proposalsPath: "",
    runDir: "",
    visualAuditPath: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--run-dir") {
      options.runDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--artifact-dir") {
      options.artifactDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--proposals") {
      options.proposalsPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--visual-audit") {
      options.visualAuditPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--manifest") {
      options.manifestPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--producer-name") {
      options.producerName = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--created-at") {
      options.createdAt = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--allow-missing") {
      options.allowMissing = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.runDir) {
      throw new Error("--run-dir requires a path");
    }
    if (!options.producerName.trim()) {
      throw new Error("--producer-name must be a non-empty string");
    }
    if (options.createdAt && Number.isNaN(Date.parse(options.createdAt))) {
      throw new Error("--created-at must be parseable by Date.parse");
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

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeArtifactPayload(payload, path) {
  if (!isPlainObject(payload)) {
    throw new Error(`${path} must be a JSON object`);
  }
  const photoId = payload.photo_id || payload.proposal_item?.photo_id;
  if (!photoId) {
    throw new Error(`${path} is missing photo_id`);
  }
  const proposalItem = payload.proposal_item ?? payload.proposal;
  if (!isPlainObject(proposalItem) || proposalItem.photo_id !== photoId || !isPlainObject(proposalItem.fields)) {
    throw new Error(`${path} must include proposal_item with matching photo_id and fields`);
  }
  const inspection = payload.inspection ?? payload.visual_inspection ?? {};
  const visualEvidence = inspection.visual_evidence ?? payload.visual_evidence;
  if (inspection.inspection_mode !== "single-image") {
    throw new Error(`${path} must set inspection.inspection_mode to single-image`);
  }
  if (inspection.contact_sheet_used !== undefined && inspection.contact_sheet_used !== false) {
    throw new Error(`${path} declares contact_sheet_used`);
  }
  if (!visualEvidence) {
    throw new Error(`${path} is missing visual evidence`);
  }
  return {
    imagePath: inspection.image_path ?? payload.image_path ?? "",
    inspection,
    photoId,
    proposalItem,
    visualEvidence,
  };
}

async function listArtifactPaths(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listArtifactPaths(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

export async function mergePhotoArtifacts(options) {
  const runDir = resolve(options.runDir);
  const artifactDir = resolve(options.artifactDir || join(runDir, defaultArtifactDirName));
  const proposalsPath = resolve(options.proposalsPath || join(runDir, defaultProposalFile));
  const visualAuditPath = resolve(options.visualAuditPath || join(runDir, defaultVisualAuditFile));
  const manifestPath = resolve(options.manifestPath || join(runDir, defaultManifestFile));
  const [manifest, photos] = await Promise.all([
    readJson(join(runDir, "manifest.json")),
    readJson(join(runDir, "photos.json")),
  ]);
  if (!manifest.run_id) {
    throw new Error("manifest.json is missing run_id");
  }
  if (!Array.isArray(photos)) {
    throw new Error("photos.json must be an array");
  }

  const expectedIds = new Set(photos.map((photo) => photo.photo_id));
  const artifactPaths = await listArtifactPaths(artifactDir);
  const seenIds = new Set();
  const proposalItems = [];
  const auditItems = [];
  const artifactRows = [];

  for (const artifactPath of artifactPaths) {
    const text = await readFile(artifactPath, "utf8");
    const normalized = normalizeArtifactPayload(JSON.parse(text), artifactPath);
    if (!expectedIds.has(normalized.photoId)) {
      throw new Error(`${artifactPath} has photo_id ${normalized.photoId} outside this run`);
    }
    if (seenIds.has(normalized.photoId)) {
      throw new Error(`duplicate per-photo artifact for ${normalized.photoId}`);
    }
    seenIds.add(normalized.photoId);
    proposalItems.push(normalized.proposalItem);
    auditItems.push({
      photo_id: normalized.photoId,
      image_path: normalized.imagePath,
      inspection_mode: "single-image",
      visual_evidence: normalized.visualEvidence,
    });
    artifactRows.push({
      artifact_path: artifactPath,
      artifact_sha256: sha256Text(text),
      inspection_mode: "single-image",
      photo_id: normalized.photoId,
      proposal_field_count: Object.keys(normalized.proposalItem.fields).length,
    });
  }

  const missingIds = [...expectedIds].filter((photoId) => !seenIds.has(photoId)).sort();
  if (missingIds.length > 0 && !options.allowMissing) {
    throw new Error(`missing per-photo artifacts for ${missingIds.length} photo(s): ${missingIds.slice(0, 12).join(", ")}`);
  }

  const photoOrder = new Map(photos.map((photo, index) => [photo.photo_id, index]));
  proposalItems.sort((left, right) => (photoOrder.get(left.photo_id) ?? 0) - (photoOrder.get(right.photo_id) ?? 0));
  auditItems.sort((left, right) => (photoOrder.get(left.photo_id) ?? 0) - (photoOrder.get(right.photo_id) ?? 0));
  artifactRows.sort((left, right) => (photoOrder.get(left.photo_id) ?? 0) - (photoOrder.get(right.photo_id) ?? 0));

  const proposal = {
    proposal_version: 1,
    run_id: manifest.run_id,
    created_at: options.createdAt || new Date().toISOString(),
    producer: {
      type: "ai",
      name: options.producerName || "per-photo-artifact-agent",
    },
    items: proposalItems,
  };
  const visualAudit = {
    audit_version: 1,
    generated_by: "ai:artifacts:merge",
    inspection_policy: "single-image-only",
    contact_sheet_used: false,
    items: auditItems,
  };
  const proposalText = `${JSON.stringify(proposal, null, 2)}\n`;
  const visualAuditText = `${JSON.stringify(visualAudit, null, 2)}\n`;
  const artifactManifest = {
    artifact_manifest_version: 1,
    generated_by: "ai:artifacts:merge",
    created_at: new Date().toISOString(),
    run_id: manifest.run_id,
    source_artifact_dir: artifactDir,
    source_photo_count: photos.length,
    artifact_count: artifactRows.length,
    missing_photo_ids: missingIds,
    proposal_path: proposalsPath,
    proposal_sha256: sha256Text(proposalText),
    visual_audit_path: visualAuditPath,
    visual_audit_sha256: sha256Text(visualAuditText),
    artifacts: artifactRows,
  };

  await Promise.all([
    mkdir(dirname(proposalsPath), { recursive: true }),
    mkdir(dirname(visualAuditPath), { recursive: true }),
    mkdir(dirname(manifestPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(proposalsPath, proposalText),
    writeFile(visualAuditPath, visualAuditText),
    writeFile(manifestPath, `${JSON.stringify(artifactManifest, null, 2)}\n`),
  ]);
  await validateAiProposals({ proposalsPath, runDir });

  return {
    artifactCount: artifactRows.length,
    manifestPath,
    missingCount: missingIds.length,
    proposalsPath,
    runId: manifest.run_id,
    visualAuditPath,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }
  const result = await mergePhotoArtifacts(options);
  console.log(`AI per-photo artifacts merged: ${result.runId}`);
  console.log(`- artifacts: ${result.artifactCount}`);
  console.log(`- missing photos: ${result.missingCount}`);
  console.log(`- proposals: ${result.proposalsPath}`);
  console.log(`- visual audit: ${result.visualAuditPath}`);
  console.log(`- manifest: ${result.manifestPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not merge AI photo artifacts: ${error.message}`);
    process.exitCode = 1;
  }
}
