import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mergePhotoArtifacts } from "./merge-ai-photo-artifacts.mjs";

const defaultProposalFile = "metadata-proposals.json";
const defaultTempRoot = "/tmp/ai-labeling-shards";
const executionLogFile = "shard-execution-log.json";

function printUsage() {
  console.log(`Usage:
  pnpm ai:shard:merge -- --run-dir <dir>

Options:
  --run-dir <dir>          AI run directory containing manifest.json and photos.json.
  --shard-dir <dir>        Shard workspace. Default: /tmp/ai-labeling-shards/<run-id>.
  --output <path>          Merged proposal path. Default: <shard-dir>/metadata-proposals.json.
  --producer-name <name>   Producer name for merged root object. Default: sharded-ai-agents.
  --created-at <iso-date>  Proposal created_at. Default: current time.
  --allow-missing          Allow photos without per-photo artifacts.
  --write-run              Also write merged proposal, visual audit, and artifact manifest to <run-dir>.
  --help, -h               Show this help.

This command merges shard per-photo artifacts into formal metadata-proposals.json,
visual-inspection-audit.json, and artifact-manifest.json files. By default it
writes only to the shard workspace.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    allowMissing: false,
    createdAt: "",
    help: false,
    outputPath: "",
    producerName: "sharded-ai-agents",
    runDir: "",
    shardDir: "",
    writeRun: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--run-dir") {
      options.runDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--shard-dir") {
      options.shardDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--output") {
      options.outputPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--producer-name") {
      options.producerName = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--created-at") {
      options.createdAt = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--allow-missing") {
      options.allowMissing = true;
    } else if (arg === "--write-run") {
      options.writeRun = true;
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

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function maybeReadJson(path) {
  try {
    return await readJson(path);
  } catch {
    return null;
  }
}

async function shardOutputPaths(shardDir) {
  const shardManifest = await maybeReadJson(join(shardDir, "shard-manifest.json"));
  if (shardManifest && Array.isArray(shardManifest.shards)) {
    return shardManifest.shards.map((shard) => shard.output_path).filter(Boolean);
  }

  const outputDir = join(shardDir, "outputs");
  const filenames = await readdir(outputDir);
  return filenames
    .filter((filename) => /^shard-\d+-proposals\.json$/.test(filename))
    .sort()
    .map((filename) => join(outputDir, filename));
}

async function countJsonFilesIfExists(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countJsonFilesIfExists(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      count += 1;
    }
  }
  return count;
}

function itemsFromShardPayload(payload, path) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isPlainObject(payload) && Array.isArray(payload.items)) {
    return payload.items;
  }
  throw new Error(`${path} must be a JSON array or an object with items[]`);
}

function itemsFromVisualAuditPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isPlainObject(payload) && Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

async function readShardItems(paths) {
  const items = [];
  for (const path of paths) {
    const payload = await readJson(path);
    const shardItems = itemsFromShardPayload(payload, path);
    for (const item of shardItems) {
      items.push({ item, sourcePath: path });
    }
  }
  return items;
}

async function updateExecutionLog({ outputPath, paths, shardDir }) {
  const logPath = join(shardDir, executionLogFile);
  const log = await maybeReadJson(logPath);
  if (!log || !Array.isArray(log.shards)) {
    return { logPath: "", updated: false };
  }

  const now = new Date().toISOString();
  for (const path of paths) {
    const text = await readFile(path, "utf8");
    const payload = JSON.parse(text);
    const items = itemsFromShardPayload(payload, path);
    const entry = log.shards.find((shard) => shard.output_path === path);
    if (!entry) {
      continue;
    }
    entry.output_item_count = items.length;
    entry.output_sha256 = sha256Text(text);
    if (entry.visual_audit_path) {
      try {
        const auditText = await readFile(entry.visual_audit_path, "utf8");
        const auditPayload = JSON.parse(auditText);
        entry.visual_audit_item_count = itemsFromVisualAuditPayload(auditPayload).length;
        entry.visual_audit_sha256 = sha256Text(auditText);
      } catch {
        entry.visual_audit_item_count = null;
        entry.visual_audit_sha256 = "";
      }
    }
    if (!entry.status || entry.status === "pending" || entry.status === "running") {
      entry.status = "completed";
    }
  }
  const mergedText = await readFile(outputPath, "utf8");
  log.merged_at = now;
  log.merged_output_path = outputPath;
  log.merged_output_sha256 = sha256Text(mergedText);
  log.updated_at = now;
  await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`);
  return { logPath, updated: true };
}

async function updateExecutionLogFromArtifacts({ artifactDir, manifestPath, outputPath, shardDir, visualAuditPath }) {
  const logPath = join(shardDir, executionLogFile);
  const log = await maybeReadJson(logPath);
  if (!log || !Array.isArray(log.shards)) {
    return { logPath: "", updated: false };
  }

  const outputText = await readFile(outputPath, "utf8");
  const visualAuditText = await readFile(visualAuditPath, "utf8");
  const manifestText = await readFile(manifestPath, "utf8");
  const now = new Date().toISOString();
  for (const entry of log.shards) {
    if (!entry.photo_artifact_dir) {
      continue;
    }
    const artifactCount = await countJsonFilesIfExists(entry.photo_artifact_dir);
    entry.photo_artifact_count = artifactCount;
    if (artifactCount === Number(entry.photo_count || 0) && (!entry.status || entry.status === "pending" || entry.status === "running")) {
      entry.status = "completed";
    }
  }
  log.artifact_manifest_path = manifestPath;
  log.artifact_manifest_sha256 = sha256Text(manifestText);
  log.merged_at = now;
  log.merged_output_path = outputPath;
  log.merged_output_sha256 = sha256Text(outputText);
  log.merged_visual_audit_path = visualAuditPath;
  log.merged_visual_audit_sha256 = sha256Text(visualAuditText);
  log.updated_at = now;
  await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`);
  return { logPath, updated: true };
}

function validateMergedItems({ allowMissing, itemsWithSource, photos }) {
  const errors = [];
  const photoIds = new Set(photos.map((photo) => photo.photo_id).filter(Boolean));
  const seen = new Map();

  for (const { item, sourcePath } of itemsWithSource) {
    if (!isPlainObject(item)) {
      errors.push(`${sourcePath}: each shard proposal item must be an object`);
      continue;
    }
    if (typeof item.photo_id !== "string" || !item.photo_id.trim()) {
      errors.push(`${sourcePath}: each shard proposal item requires photo_id`);
      continue;
    }
    if (!photoIds.has(item.photo_id)) {
      errors.push(`${item.photo_id}: photo_id is not in this AI run (${sourcePath})`);
    }
    if (seen.has(item.photo_id)) {
      errors.push(`${item.photo_id}: duplicate shard proposal item in ${seen.get(item.photo_id)} and ${sourcePath}`);
    }
    seen.set(item.photo_id, sourcePath);
  }

  if (!allowMissing) {
    const missing = [...photoIds].filter((photoId) => !seen.has(photoId));
    if (missing.length > 0) {
      const sample = missing.slice(0, 20).join(", ");
      const suffix = missing.length > 20 ? ", ..." : "";
      errors.push(`missing proposals for ${missing.length} photo(s): ${sample}${suffix}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

export async function mergeAiShards(options) {
  const runDir = resolve(options.runDir);
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

  const shardDir = resolve(options.shardDir || join(defaultTempRoot, manifest.run_id));
  const outputPath = resolve(options.outputPath || join(shardDir, defaultProposalFile));
  const artifactDir = join(shardDir, "photo-artifacts");
  const visualAuditPath = join(shardDir, "visual-inspection-audit.json");
  const artifactManifestPath = join(shardDir, "artifact-manifest.json");
  const shardManifest = await maybeReadJson(join(shardDir, "shard-manifest.json"));
  const artifactCount = await countJsonFilesIfExists(artifactDir);
  if (artifactCount === 0) {
    throw new Error(`No per-photo artifacts found in ${artifactDir}. Re-run shard workers with checkpointed photo artifacts; legacy shard outputs are not adoptable.`);
  }

  await mergePhotoArtifacts({
    allowMissing: options.allowMissing,
    artifactDir,
    createdAt: options.createdAt,
    manifestPath: artifactManifestPath,
    producerName: options.producerName,
    proposalsPath: outputPath,
    runDir,
    visualAuditPath,
  });
  const mergedProposal = JSON.parse(await readFile(outputPath, "utf8"));
  const executionLog = await updateExecutionLogFromArtifacts({
    artifactDir,
    manifestPath: artifactManifestPath,
    outputPath,
    shardDir,
    visualAuditPath,
  });

  let runOutputPath = "";
  let runVisualAuditPath = "";
  let runArtifactManifestPath = "";
  if (options.writeRun) {
    runOutputPath = join(runDir, defaultProposalFile);
    runVisualAuditPath = join(runDir, "visual-inspection-audit.json");
    runArtifactManifestPath = join(runDir, "artifact-manifest.json");
    const [proposalText, visualAuditText, artifactManifest] = await Promise.all([
      readFile(outputPath, "utf8"),
      readFile(visualAuditPath, "utf8"),
      readJson(artifactManifestPath),
    ]);
    const rootManifest = {
      ...artifactManifest,
      proposal_path: runOutputPath,
      visual_audit_path: runVisualAuditPath,
    };
    await Promise.all([
      writeFile(runOutputPath, proposalText),
      writeFile(runVisualAuditPath, visualAuditText),
      writeFile(runArtifactManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`),
    ]);
  }

  return {
    artifactCount,
    itemCount: Array.isArray(mergedProposal.items) ? mergedProposal.items.length : 0,
    outputPath,
    runId: manifest.run_id,
    runArtifactManifestPath,
    runOutputPath,
    runVisualAuditPath,
    shardCount: Array.isArray(shardManifest?.shards) ? shardManifest.shards.length : 0,
    shardExecutionLogPath: executionLog.logPath,
    shardExecutionLogUpdated: executionLog.updated,
    visualAuditPath,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await mergeAiShards(options);
  console.log(`AI shard photo artifacts merged: ${result.outputPath}`);
  console.log(`- run: ${result.runId}`);
  console.log(`- shards: ${result.shardCount}`);
  console.log(`- photo artifacts: ${result.artifactCount}`);
  console.log(`- proposal items: ${result.itemCount}`);
  console.log(`- visual audit: ${result.visualAuditPath}`);
  if (result.runOutputPath) {
    console.log(`- run proposal: ${result.runOutputPath}`);
    console.log(`- run visual audit: ${result.runVisualAuditPath}`);
    console.log(`- run artifact manifest: ${result.runArtifactManifestPath}`);
  }
  if (result.shardExecutionLogUpdated) {
    console.log(`- execution log updated: ${result.shardExecutionLogPath}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not merge AI shards: ${error.message}`);
    process.exitCode = 1;
  }
}
