import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const defaultTempRoot = "/tmp/ai-labeling-shards";
const defaultMaxPhotosPerShard = 135;

function printUsage() {
  console.log(`Usage:
  pnpm ai:shard:prepare -- --run-dir <dir>

Options:
  --run-dir <dir>                AI run directory containing manifest.json and photos.json.
  --output-dir <dir>             Shard workspace. Default: /tmp/ai-labeling-shards/<run-id>.
  --shards <number>              Exact shard count. Default: ceil(photo count / 135).
  --max-photos-per-shard <number>
                                  Max photos per shard when --shards is not provided. Default: 135.
  --help, -h                     Show this help.

This command writes shard inputs and worker prompts to a temporary workspace.
It does not write metadata-proposals.json or modify the AI run directory.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    maxPhotosPerShard: defaultMaxPhotosPerShard,
    outputDir: "",
    runDir: "",
    shards: 0,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--run-dir") {
      options.runDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--shards") {
      options.shards = Number(args[index + 1] ?? "");
      index += 1;
    } else if (arg === "--max-photos-per-shard") {
      options.maxPhotosPerShard = Number(args[index + 1] ?? "");
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.runDir) {
      throw new Error("--run-dir requires a path");
    }
    if (options.shards !== 0 && (!Number.isInteger(options.shards) || options.shards < 1)) {
      throw new Error("--shards must be a positive integer");
    }
    if (!Number.isInteger(options.maxPhotosPerShard) || options.maxPhotosPerShard < 1) {
      throw new Error("--max-photos-per-shard must be a positive integer");
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

function formatShardId(index) {
  return String(index).padStart(2, "0");
}

function withAbsoluteImagePath(photo, runDir) {
  if (!photo.local_image_path) {
    return {
      ...photo,
      absolute_image_path: "",
    };
  }
  return {
    ...photo,
    absolute_image_path: resolve(runDir, photo.local_image_path),
  };
}

function renderWorkerPrompt({ inputPath, outputPath, runDir, shardCount, shardIndex }) {
  const shardName = `shard-${formatShardId(shardIndex)}`;
  return `# AI 初標分片任務：${shardName}

你正在處理大型 AI 初標 run 的其中一個分片。請先讀取 run 目錄中的 \`ai-labeling-prompt.md\`，並遵守同一份照片判讀規則與輸出欄位限制。

- AI run 目錄：\`${runDir}\`
- 本分片輸入：\`${inputPath}\`
- 本分片輸出：\`${outputPath}\`
- 分片序號：${shardIndex + 1} / ${shardCount}

重要限制：

- 不可以使用既有的 \`metadata-proposals.json\`、其他 run 的 proposal 或其他分片輸出作為本次標記依據。
- 只處理本分片輸入中的 \`items\`，不要替其他照片產生 proposal。
- 仍必須逐張打開圖片。若 \`absolute_image_path\` 有值，優先使用它；否則依 run prompt 使用 \`local_image_path\` 或 \`image_download_url\`。
- 分片輸出請寫成 JSON array，每個元素是正式 \`metadata-proposals.json\` 內的單一 \`items[]\` 物件，例如 \`[{ "photo_id": "...", "fields": { ... } }]\`。
- 不要在本分片輸出中包 root object；root object 會由 merge 工具統一產生。
`;
}

async function prepareAiShards(options) {
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
  if (options.shards && photos.length > 0 && options.shards > photos.length) {
    throw new Error("--shards must not be greater than the photo count");
  }

  const outputDir = resolve(options.outputDir || join(defaultTempRoot, manifest.run_id));
  const inputDir = join(outputDir, "inputs");
  const promptDir = join(outputDir, "worker-prompts");
  const proposalsDir = join(outputDir, "outputs");
  const mergedProposalPath = join(outputDir, "metadata-proposals.json");
  const shardManifestPath = join(outputDir, "shard-manifest.json");
  const shardExecutionLogPath = join(outputDir, "shard-execution-log.json");
  const shardCount = options.shards || Math.max(1, Math.ceil(photos.length / options.maxPhotosPerShard));

  await Promise.all([
    rm(inputDir, { force: true, recursive: true }),
    rm(promptDir, { force: true, recursive: true }),
    rm(proposalsDir, { force: true, recursive: true }),
    rm(mergedProposalPath, { force: true }),
    rm(shardManifestPath, { force: true }),
    rm(shardExecutionLogPath, { force: true }),
  ]);

  await Promise.all([
    mkdir(inputDir, { recursive: true }),
    mkdir(promptDir, { recursive: true }),
    mkdir(proposalsDir, { recursive: true }),
  ]);

  const shards = [];
  for (let index = 0; index < shardCount; index += 1) {
    const start = Math.floor((index * photos.length) / shardCount);
    const end = Math.floor(((index + 1) * photos.length) / shardCount);
    const shardId = formatShardId(index);
    const inputPath = join(inputDir, `shard-${shardId}-input.json`);
    const outputPath = join(proposalsDir, `shard-${shardId}-proposals.json`);
    const workerPromptPath = join(promptDir, `shard-${shardId}.md`);
    const items = photos.slice(start, end).map((photo) => withAbsoluteImagePath(photo, runDir));

    const shardInput = {
      count: items.length,
      items,
      output_path: outputPath,
      run_dir: runDir,
      run_id: manifest.run_id,
      shard: index,
      shard_count: shardCount,
    };

    await Promise.all([
      writeFile(inputPath, `${JSON.stringify(shardInput, null, 2)}\n`),
      writeFile(workerPromptPath, renderWorkerPrompt({ inputPath, outputPath, runDir, shardCount, shardIndex: index })),
    ]);

    shards.push({
      count: items.length,
      input_path: inputPath,
      output_path: outputPath,
      shard: index,
      worker_prompt_path: workerPromptPath,
    });
  }

  const shardManifest = {
    created_at: new Date().toISOString(),
    max_photos_per_shard: options.maxPhotosPerShard,
    output_dir: outputDir,
    run_dir: runDir,
    run_id: manifest.run_id,
    shard_count: shardCount,
    shards,
    source_photo_count: photos.length,
  };
  await writeFile(shardManifestPath, `${JSON.stringify(shardManifest, null, 2)}\n`);
  const shardExecutionLog = {
    version: 1,
    created_at: new Date().toISOString(),
    run_dir: runDir,
    run_id: manifest.run_id,
    shard_dir: outputDir,
    shards: shards.map((shard) => ({
      agent_name: "",
      completed_at: "",
      codex_end_snapshot: null,
      codex_home: "",
      codex_session: "",
      codex_start_snapshot: null,
      codex_usage_delta: null,
      duration_ms: null,
      input_path: shard.input_path,
      model_name: "",
      notes: "",
      output_item_count: null,
      output_path: shard.output_path,
      output_sha256: "",
      photo_count: shard.count,
      repair_count: 0,
      retry_count: 0,
      shard: shard.shard,
      started_at: "",
      status: "pending",
      validate_status: "unknown",
      worker_prompt_path: shard.worker_prompt_path,
    })),
    source_photo_count: photos.length,
    updated_at: new Date().toISOString(),
  };
  await writeFile(shardExecutionLogPath, `${JSON.stringify(shardExecutionLog, null, 2)}\n`);

  return {
    inputDir,
    outputDir,
    proposalsDir,
    runId: manifest.run_id,
    shardCount,
    shardExecutionLogPath,
    shardManifestPath,
    sourcePhotoCount: photos.length,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await prepareAiShards(options);
  console.log(`AI shard workspace prepared: ${result.outputDir}`);
  console.log(`- run: ${result.runId}`);
  console.log(`- photos: ${result.sourcePhotoCount}`);
  console.log(`- shards: ${result.shardCount}`);
  console.log(`- inputs: ${result.inputDir}`);
  console.log(`- expected outputs: ${result.proposalsDir}`);
  console.log(`- shard manifest: ${result.shardManifestPath}`);
  console.log(`- execution log: ${result.shardExecutionLogPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not prepare AI shards: ${error.message}`);
    process.exitCode = 1;
  }
}
