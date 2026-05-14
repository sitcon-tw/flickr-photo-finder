import { access, readFile, readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { addTokenUsage } from "../lib/ai/codex-session-usage.mjs";
import {
  codexMetricsFile,
  formatCodexUsage,
  summarizeCodexMetrics,
} from "../lib/ai/codex-run-metrics.mjs";

const defaultProposalFile = "metadata-proposals.json";
const defaultReviewSummaryFile = "metadata-review-summary.md";
const defaultTempRoot = "/tmp/ai-labeling-shards";
const executionLogFile = "shard-execution-log.json";

function printUsage() {
  console.log(`Usage:
  pnpm ai:bulk:status -- --run-dir <dir>

Options:
  --run-dir <dir>    AI run directory containing manifest.json and photos.json.
  --shard-dir <dir>  Shard workspace. Default: /tmp/ai-labeling-shards/<run-id>.
  --json             Print machine-readable JSON.
  --help, -h         Show this help.

This command inspects a large AI labeling run and its shard workspace. It does
not create, merge, review, or write any files.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    json: false,
    runDir: "",
    shardDir: "",
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
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help && !options.runDir) {
    throw new Error("--run-dir requires a path");
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
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
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

function shardIdFromPath(path) {
  return basename(path).match(/shard-(\d+)/)?.[1] ?? "";
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value || "unknown", (counts.get(value || "unknown") ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}

function summarizeExecutionLog(log) {
  const shards = Array.isArray(log?.shards) ? log.shards : [];
  const codexUsageDeltas = shards.map((shard) => shard.codex_usage_delta).filter(Boolean);
  return {
    codex_completed_shards: codexUsageDeltas.length,
    codex_usage_delta: addTokenUsage(codexUsageDeltas),
    completed_shards: shards.filter((shard) => shard.status === "completed").length,
    logged_shards: shards.length,
    merged_output_path: log?.merged_output_path ?? "",
    merged_output_sha256: log?.merged_output_sha256 ?? "",
    repair_count: shards.reduce((sum, shard) => sum + Number(shard.repair_count || 0), 0),
    retry_count: shards.reduce((sum, shard) => sum + Number(shard.retry_count || 0), 0),
    status_counts: countValues(shards.map((shard) => shard.status)),
    validate_status_counts: countValues(shards.map((shard) => shard.validate_status)),
  };
}

async function inspectBulkStatus(options) {
  const runDir = resolve(options.runDir);
  const [manifest, photos] = await Promise.all([
    readJson(join(runDir, "manifest.json")),
    readJson(join(runDir, "photos.json")),
  ]);
  const runId = manifest.run_id || basename(runDir);
  const shardDir = resolve(options.shardDir || join(defaultTempRoot, runId));
  const shardManifest = await readJsonIfExists(join(shardDir, "shard-manifest.json"));
  const shardExecutionLogPath = join(shardDir, executionLogFile);
  const shardExecutionLog = await readJsonIfExists(shardExecutionLogPath);
  const codexMetricsPath = join(runDir, codexMetricsFile);
  const codexMetrics = await readJsonIfExists(codexMetricsPath);
  const shardEntries = Array.isArray(shardManifest?.shards) ? shardManifest.shards : [];

  const inputFiles = shardEntries.length > 0
    ? shardEntries.map((shard) => shard.input_path).filter(Boolean)
    : (await listFilesIfExists(join(shardDir, "inputs"))).filter((name) => /shard-\d+.*input\.json$/.test(name)).map((name) => join(shardDir, "inputs", name));
  const expectedOutputFiles = shardEntries.length > 0
    ? shardEntries.map((shard) => shard.output_path).filter(Boolean)
    : inputFiles.map((path) => join(shardDir, "outputs", `shard-${shardIdFromPath(path)}-proposals.json`));
  const existingOutputFiles = [];
  for (const path of expectedOutputFiles) {
    if (await pathExists(path)) {
      existingOutputFiles.push(path);
    }
  }

  const missingOutputFiles = expectedOutputFiles.filter((path) => !existingOutputFiles.includes(path));
  const shardMergedProposalPath = join(shardDir, defaultProposalFile);
  const rootProposalPath = join(runDir, defaultProposalFile);
  const reviewSummaryPath = join(runDir, defaultReviewSummaryFile);
  const rootProposal = await readJsonIfExists(rootProposalPath);
  const shardMergedProposal = await readJsonIfExists(shardMergedProposalPath);
  const rootProposalMtime = await fileMtimeMs(rootProposalPath);
  const reviewSummaryMtime = await fileMtimeMs(reviewSummaryPath);

  return {
    expected_outputs: expectedOutputFiles.length,
    existing_outputs: existingOutputFiles.length,
    image_link_mode: manifest.image_link_mode ?? "",
    input_shards: inputFiles.length,
    missing_outputs: missingOutputFiles,
    photo_count: Array.isArray(photos) ? photos.length : 0,
    review_summary_exists: await pathExists(reviewSummaryPath),
    review_summary_path: reviewSummaryPath,
    review_summary_stale: Boolean(rootProposal && reviewSummaryMtime > 0 && reviewSummaryMtime < rootProposalMtime),
    root_proposal_exists: Boolean(rootProposal),
    root_proposal_items: Array.isArray(rootProposal?.items) ? rootProposal.items.length : 0,
    root_proposal_path: rootProposalPath,
    run_dir: runDir,
    run_id: runId,
    shard_dir: shardDir,
    codex_metrics_exists: Boolean(codexMetrics),
    codex_metrics_path: codexMetricsPath,
    codex_metrics_summary: summarizeCodexMetrics(codexMetrics),
    shard_execution_log_exists: Boolean(shardExecutionLog),
    shard_execution_log_path: shardExecutionLogPath,
    shard_execution_log_summary: summarizeExecutionLog(shardExecutionLog),
    shard_manifest_exists: Boolean(shardManifest),
    shard_merged_proposal_exists: Boolean(shardMergedProposal),
    shard_merged_proposal_items: Array.isArray(shardMergedProposal?.items) ? shardMergedProposal.items.length : 0,
    shard_merged_proposal_path: shardMergedProposalPath,
  };
}

function printStatus(status) {
  console.log(`AI bulk status: ${status.run_id}`);
  console.log(`- run dir: ${status.run_dir}`);
  console.log(`- photos: ${status.photo_count}`);
  console.log(`- image link mode: ${status.image_link_mode || "(unknown)"}`);
  console.log(`- shard workspace: ${status.shard_dir}`);
  console.log(`- shard manifest: ${status.shard_manifest_exists ? "yes" : "no"}`);
  console.log(`- shard execution log: ${status.shard_execution_log_exists ? "yes" : "no"}`);
  if (status.shard_execution_log_exists) {
    console.log(`- shard execution status: ${JSON.stringify(status.shard_execution_log_summary.status_counts)}`);
    console.log(`- shard retries/repairs: ${status.shard_execution_log_summary.retry_count}/${status.shard_execution_log_summary.repair_count}`);
    if (status.shard_execution_log_summary.codex_completed_shards > 0) {
      console.log(`- shard Codex token delta: ${formatCodexUsage(status.shard_execution_log_summary.codex_usage_delta)} (${status.shard_execution_log_summary.codex_completed_shards} shard(s))`);
    }
  }
  console.log(`- Codex run metrics: ${status.codex_metrics_exists ? `${status.codex_metrics_summary.completed_phases} completed phase(s), ${status.codex_metrics_summary.token_completed_phases} token phase(s), ${formatCodexUsage(status.codex_metrics_summary.total_usage_delta)}` : "missing"}`);
  console.log(`- shard inputs: ${status.input_shards}`);
  console.log(`- shard outputs: ${status.existing_outputs}/${status.expected_outputs}`);
  console.log(`- merged shard proposal: ${status.shard_merged_proposal_exists ? `${status.shard_merged_proposal_items} item(s)` : "missing"}`);
  console.log(`- root proposal: ${status.root_proposal_exists ? `${status.root_proposal_items} item(s)` : "missing"}`);
  console.log(`- review summary: ${status.review_summary_exists ? (status.review_summary_stale ? "stale" : "present") : "missing"}`);
  if (status.missing_outputs.length > 0) {
    console.log("- missing shard outputs:");
    for (const path of status.missing_outputs.slice(0, 20)) {
      console.log(`  - ${path}`);
    }
    if (status.missing_outputs.length > 20) {
      console.log(`  - ... ${status.missing_outputs.length - 20} more`);
    }
  }
  console.log("");
  console.log("Next:");
  if (status.root_proposal_exists && (!status.review_summary_exists || status.review_summary_stale)) {
    console.log(`- Rebuild review artifacts: pnpm ai:review -- --run-dir ${status.run_dir}`);
  } else if (status.root_proposal_exists) {
    console.log("- Review artifacts are current. Continue with HTML report or Sheets dry-run.");
    if (!status.codex_metrics_exists) {
      console.log(`- Optional metering: pnpm ai:codex:meter -- --run-dir ${status.run_dir} --session <codex-session> --mark-start/--mark-end`);
    }
  } else if (status.input_shards === 0) {
    console.log(`- Prepare shard workspace: pnpm ai:shard:prepare -- --run-dir ${status.run_dir}`);
  } else if (status.existing_outputs < status.expected_outputs) {
    console.log("- Finish the missing shard outputs before merging.");
  } else if (!status.shard_merged_proposal_exists) {
    console.log(`- Merge shards: pnpm ai:shard:merge -- --run-dir ${status.run_dir}`);
  } else if (!status.root_proposal_exists) {
    console.log(`- Temporarily review merged proposal: pnpm ai:review -- --run-dir ${status.run_dir} --proposals ${status.shard_merged_proposal_path} --output-dir /tmp/ai-review-runs/${status.run_id}`);
    console.log(`- Write accepted proposal: pnpm ai:shard:merge -- --run-dir ${status.run_dir} --write-run`);
  } else {
    console.log("- Inspect the run manually; no obvious next step was detected.");
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }
  const status = await inspectBulkStatus(options);
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  printStatus(status);
}

try {
  await main();
} catch (error) {
  console.error(`Could not inspect AI bulk status: ${error.message}`);
  process.exitCode = 1;
}
