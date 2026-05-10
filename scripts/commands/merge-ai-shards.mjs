import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultProposalFile = "metadata-proposals.json";
const defaultTempRoot = "/tmp/ai-labeling-shards";

function printUsage() {
  console.log(`Usage:
  pnpm ai:shard:merge -- --run-dir <dir>

Options:
  --run-dir <dir>          AI run directory containing manifest.json and photos.json.
  --shard-dir <dir>        Shard workspace. Default: /tmp/ai-labeling-shards/<run-id>.
  --output <path>          Merged proposal path. Default: <shard-dir>/metadata-proposals.json.
  --producer-name <name>   Producer name for merged root object. Default: sharded-ai-agents.
  --created-at <iso-date>  Proposal created_at. Default: current time.
  --allow-missing          Allow photos without shard proposals.
  --write-run              Also write <run-dir>/metadata-proposals.json.
  --help, -h               Show this help.

This command merges shard proposal arrays into a formal metadata-proposals.json
root object. By default it writes only to the shard workspace.`);
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

function itemsFromShardPayload(payload, path) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (isPlainObject(payload) && Array.isArray(payload.items)) {
    return payload.items;
  }
  throw new Error(`${path} must be a JSON array or an object with items[]`);
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

async function mergeAiShards(options) {
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
  const paths = await shardOutputPaths(shardDir);
  if (paths.length === 0) {
    throw new Error(`No shard proposal files found in ${join(shardDir, "outputs")}`);
  }

  const itemsWithSource = await readShardItems(paths);
  validateMergedItems({ allowMissing: options.allowMissing, itemsWithSource, photos });

  const items = itemsWithSource.map(({ item }) => item);
  const proposals = {
    proposal_version: 1,
    run_id: manifest.run_id,
    created_at: options.createdAt || new Date().toISOString(),
    producer: {
      type: "ai",
      name: options.producerName,
    },
    items,
  };
  const serialized = `${JSON.stringify(proposals, null, 2)}\n`;

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized);

  let runOutputPath = "";
  if (options.writeRun) {
    runOutputPath = join(runDir, defaultProposalFile);
    await writeFile(runOutputPath, serialized);
  }

  return {
    itemCount: items.length,
    outputPath,
    runId: manifest.run_id,
    runOutputPath,
    shardCount: paths.length,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await mergeAiShards(options);
  console.log(`AI shard proposals merged: ${result.outputPath}`);
  console.log(`- run: ${result.runId}`);
  console.log(`- shard files: ${result.shardCount}`);
  console.log(`- proposal items: ${result.itemCount}`);
  if (result.runOutputPath) {
    console.log(`- run proposal: ${result.runOutputPath}`);
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
