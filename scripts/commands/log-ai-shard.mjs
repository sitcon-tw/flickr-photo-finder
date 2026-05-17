import { access, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  computeTokenDelta,
  defaultCodexHome,
  getCodexTokenSnapshot,
} from "../lib/ai/codex-session-usage.mjs";

const defaultTempRoot = "/tmp/ai-labeling-shards";
const executionLogFile = "shard-execution-log.json";

function printUsage() {
  console.log(`Usage:
  pnpm ai:shard:log -- --run-dir <dir> --shard <id> [options]

Options:
  --run-dir <dir>              AI run directory containing manifest.json.
  --shard-dir <dir>            Shard workspace. Default: /tmp/ai-labeling-shards/<run-id>.
  --shard <id>                 Shard index or name, for example 0, 03, or shard-03.
  --status <status>            pending, running, completed, failed, or repaired.
  --agent-name <name>          Agent or worker name.
  --model-name <name>          Model name.
  --reasoning-effort <value>   low, medium, high, xhigh, or unknown.
  --codex-session <id>         Codex session id for token metering.
  --codex-home <dir>           Codex home. Default: CODEX_HOME or ~/.codex.
  --mark-started               Set started_at to now and status to running unless --status is supplied.
  --mark-completed             Set completed_at to now and status to completed unless --status is supplied.
  --started-at <iso-date>      Explicit started_at timestamp.
  --completed-at <iso-date>    Explicit completed_at timestamp.
  --duration-ms <number>       Explicit duration in milliseconds.
  --validate-status <status>   unknown, not-run, passed, or failed.
  --retry-count <number>       Set retry count.
  --repair-count <number>      Set repair count.
  --add-retry                  Increment retry count by 1.
  --add-repair                 Increment repair count by 1.
  --notes <text>               Replace notes.
  --help, -h                   Show this help.

This command updates the shard execution log only. It does not validate shard
outputs, merge proposals, edit photos.json, or write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    addRepair: false,
    addRetry: false,
    agentName: "",
    codexHome: "",
    codexSession: "",
    completedAt: "",
    durationMs: null,
    help: false,
    markCompleted: false,
    markStarted: false,
    modelName: "",
    notes: null,
    reasoningEffort: "",
    repairCount: null,
    retryCount: null,
    runDir: "",
    shard: "",
    shardDir: "",
    startedAt: "",
    status: "",
    validateStatus: "",
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
    } else if (arg === "--run-dir") {
      options.runDir = nextValue(index, arg);
      index += 1;
    } else if (arg === "--shard-dir") {
      options.shardDir = nextValue(index, arg);
      index += 1;
    } else if (arg === "--shard") {
      options.shard = nextValue(index, arg);
      index += 1;
    } else if (arg === "--status") {
      options.status = nextValue(index, arg);
      index += 1;
    } else if (arg === "--agent-name") {
      options.agentName = nextValue(index, arg);
      index += 1;
    } else if (arg === "--model-name") {
      options.modelName = nextValue(index, arg);
      index += 1;
    } else if (arg === "--reasoning-effort") {
      options.reasoningEffort = nextValue(index, arg);
      index += 1;
    } else if (arg === "--codex-session") {
      options.codexSession = nextValue(index, arg);
      index += 1;
    } else if (arg === "--codex-home") {
      options.codexHome = nextValue(index, arg);
      index += 1;
    } else if (arg === "--mark-started") {
      options.markStarted = true;
    } else if (arg === "--mark-completed") {
      options.markCompleted = true;
    } else if (arg === "--started-at") {
      options.startedAt = nextValue(index, arg);
      index += 1;
    } else if (arg === "--completed-at") {
      options.completedAt = nextValue(index, arg);
      index += 1;
    } else if (arg === "--duration-ms") {
      options.durationMs = Number(nextValue(index, arg));
      index += 1;
    } else if (arg === "--validate-status") {
      options.validateStatus = nextValue(index, arg);
      index += 1;
    } else if (arg === "--retry-count") {
      options.retryCount = Number(nextValue(index, arg));
      index += 1;
    } else if (arg === "--repair-count") {
      options.repairCount = Number(nextValue(index, arg));
      index += 1;
    } else if (arg === "--add-retry") {
      options.addRetry = true;
    } else if (arg === "--add-repair") {
      options.addRepair = true;
    } else if (arg === "--notes") {
      options.notes = nextValue(index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.runDir) {
      throw new Error("--run-dir requires a path");
    }
    if (!options.shard) {
      throw new Error("--shard requires a value");
    }
    if (options.status && !["pending", "running", "completed", "failed", "repaired"].includes(options.status)) {
      throw new Error("--status must be one of: pending, running, completed, failed, repaired");
    }
    if (options.validateStatus && !["unknown", "not-run", "passed", "failed"].includes(options.validateStatus)) {
      throw new Error("--validate-status must be one of: unknown, not-run, passed, failed");
    }
    if (options.reasoningEffort && !["low", "medium", "high", "xhigh", "unknown"].includes(options.reasoningEffort)) {
      throw new Error("--reasoning-effort must be one of: low, medium, high, xhigh, unknown");
    }
    for (const [name, value] of [["--duration-ms", options.durationMs], ["--retry-count", options.retryCount], ["--repair-count", options.repairCount]]) {
      if (value !== null && (!Number.isInteger(value) || value < 0)) {
        throw new Error(`${name} must be a non-negative integer`);
      }
    }
    for (const [name, value] of [["--started-at", options.startedAt], ["--completed-at", options.completedAt]]) {
      if (value && Number.isNaN(Date.parse(value))) {
        throw new Error(`${name} must be parseable by Date.parse`);
      }
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

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function normalizeShardId(value) {
  const match = String(value).match(/(\d+)/);
  if (!match) {
    throw new Error("--shard must include a numeric shard index");
  }
  return Number(match[1]);
}

function durationMs(startedAt, completedAt) {
  if (!startedAt || !completedAt) {
    return null;
  }
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function serializeSnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }
  return {
    line_number: snapshot.line_number,
    path: snapshot.path,
    session_files: snapshot.session_files,
    session_id: snapshot.session_id,
    timestamp: snapshot.timestamp,
    usage: snapshot.usage,
  };
}

async function codexSnapshot(options, at) {
  if (!options.codexSession) {
    return null;
  }
  return getCodexTokenSnapshot(options.codexSession, {
    at,
    codexHome: resolve(options.codexHome || defaultCodexHome()),
  });
}

export async function updateShardLog(options) {
  const runDir = resolve(options.runDir);
  const manifest = await readJson(join(runDir, "manifest.json"));
  const runId = manifest.run_id || basename(runDir);
  const shardDir = resolve(options.shardDir || join(defaultTempRoot, runId));
  const logPath = join(shardDir, executionLogFile);
  if (!(await pathExists(logPath))) {
    throw new Error(`${logPath} does not exist. Run pnpm ai:shard:prepare first.`);
  }

  const log = await readJson(logPath);
  const shardIndex = normalizeShardId(options.shard);
  const entry = (log.shards ?? []).find((shard) => Number(shard.shard) === shardIndex);
  if (!entry) {
    throw new Error(`shard ${shardIndex} was not found in ${logPath}`);
  }

  const now = new Date().toISOString();
  if (options.agentName) entry.agent_name = options.agentName;
  if (options.modelName) entry.model_name = options.modelName;
  if (options.reasoningEffort) entry.reasoning_effort = options.reasoningEffort;
  if (options.codexSession) entry.codex_session = options.codexSession;
  if (options.codexHome) entry.codex_home = resolve(options.codexHome);
  if (options.markStarted) {
    entry.started_at = now;
    if (!options.status) entry.status = "running";
  }
  if (options.markCompleted) {
    entry.completed_at = now;
    if (!options.status) entry.status = "completed";
  }
  if (options.startedAt) entry.started_at = options.startedAt;
  if (options.completedAt) entry.completed_at = options.completedAt;
  if (options.status) entry.status = options.status;
  if (options.validateStatus) entry.validate_status = options.validateStatus;
  if (options.retryCount !== null) entry.retry_count = options.retryCount;
  if (options.repairCount !== null) entry.repair_count = options.repairCount;
  if (options.addRetry) entry.retry_count = Number(entry.retry_count || 0) + 1;
  if (options.addRepair) entry.repair_count = Number(entry.repair_count || 0) + 1;
  if (options.notes !== null) entry.notes = options.notes;
  if (options.durationMs !== null) {
    entry.duration_ms = options.durationMs;
  } else {
    entry.duration_ms = durationMs(entry.started_at, entry.completed_at);
  }

  if (options.codexSession && (options.markStarted || options.startedAt)) {
    entry.codex_start_snapshot = serializeSnapshot(await codexSnapshot(options, options.startedAt));
  }
  if (options.codexSession && (options.markCompleted || options.completedAt)) {
    entry.codex_end_snapshot = serializeSnapshot(await codexSnapshot(options, options.completedAt));
  }
  entry.codex_usage_delta = computeTokenDelta(entry.codex_start_snapshot, entry.codex_end_snapshot);

  log.updated_at = now;
  await writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`);

  return { entry, logPath, runId, shardIndex };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await updateShardLog(options);
  console.log(`AI shard execution log updated: ${result.logPath}`);
  console.log(`- run: ${result.runId}`);
  console.log(`- shard: ${String(result.shardIndex).padStart(2, "0")}`);
  console.log(`- status: ${result.entry.status}`);
  console.log(`- validate: ${result.entry.validate_status}`);
  console.log(`- reasoning_effort: ${result.entry.reasoning_effort ?? ""}`);
  console.log(`- duration_ms: ${result.entry.duration_ms ?? ""}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not update AI shard execution log: ${error.message}`);
    process.exitCode = 1;
  }
}
