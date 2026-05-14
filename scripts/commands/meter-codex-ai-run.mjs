import { access, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  addTokenUsage,
  computeTokenDelta,
  defaultCodexHome,
  getCodexTokenSnapshot,
} from "../lib/ai/codex-session-usage.mjs";

const metricsFile = "codex-execution-metrics.json";

function printUsage() {
  console.log(`Usage:
  pnpm ai:codex:meter -- --run-dir <dir> --session <id> [options]

Options:
  --run-dir <dir>          AI run directory containing manifest.json.
  --session <id>           Codex session id, for example 019e...
  --phase <id>             Phase id to update. Default: parent.
  --role <role>            parent, worker, or other. Default: parent.
  --label <text>           Human-readable phase label.
  --mark-start             Record start token snapshot.
  --mark-end               Record end token snapshot and compute delta.
  --started-at <iso-date>  Use nearest token snapshot at or before this time for start.
  --completed-at <iso>     Use nearest token snapshot at or before this time for end.
  --codex-home <dir>       Codex home. Default: CODEX_HOME or ~/.codex.
  --summary                Print existing metrics summary without writing.
  --json                   Print machine-readable JSON.
  --help, -h               Show this help.

This command records Codex token snapshots for an AI run. It does not inspect
photos, validate proposals, write shards, or update Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    codexHome: "",
    completedAt: "",
    help: false,
    json: false,
    label: "",
    markEnd: false,
    markStart: false,
    phase: "parent",
    role: "parent",
    runDir: "",
    sessionId: "",
    startedAt: "",
    summary: false,
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
    } else if (arg === "--session") {
      options.sessionId = nextValue(index, arg);
      index += 1;
    } else if (arg === "--phase") {
      options.phase = nextValue(index, arg);
      index += 1;
    } else if (arg === "--role") {
      options.role = nextValue(index, arg);
      index += 1;
    } else if (arg === "--label") {
      options.label = nextValue(index, arg);
      index += 1;
    } else if (arg === "--mark-start") {
      options.markStart = true;
    } else if (arg === "--mark-end") {
      options.markEnd = true;
    } else if (arg === "--started-at") {
      options.startedAt = nextValue(index, arg);
      index += 1;
    } else if (arg === "--completed-at") {
      options.completedAt = nextValue(index, arg);
      index += 1;
    } else if (arg === "--codex-home") {
      options.codexHome = nextValue(index, arg);
      index += 1;
    } else if (arg === "--summary") {
      options.summary = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.runDir) {
      throw new Error("--run-dir requires a path");
    }
    if (!["parent", "worker", "other"].includes(options.role)) {
      throw new Error("--role must be one of: parent, worker, other");
    }
    if (!options.summary && !options.sessionId) {
      throw new Error("--session is required unless --summary is used");
    }
    if (!options.summary && !options.markStart && !options.markEnd && !options.startedAt && !options.completedAt) {
      throw new Error("Use --mark-start, --mark-end, --started-at, --completed-at, or --summary");
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

async function readJsonIfExists(path) {
  if (!(await pathExists(path))) {
    return null;
  }
  return readJson(path);
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

function phaseKey(entry) {
  return `${entry.role || "parent"}:${entry.phase || "parent"}:${entry.session_id || ""}`;
}

function summarizeMetrics(metrics) {
  const phases = Array.isArray(metrics?.phases) ? metrics.phases : [];
  const completed = phases.filter((phase) => phase.usage_delta);
  const byRole = {};
  for (const role of ["parent", "worker", "other"]) {
    byRole[role] = addTokenUsage(completed.filter((phase) => phase.role === role).map((phase) => phase.usage_delta));
  }
  return {
    by_role: byRole,
    completed_phases: completed.length,
    phase_count: phases.length,
    total_usage_delta: addTokenUsage(completed.map((phase) => phase.usage_delta)),
  };
}

async function loadMetrics(runDir, manifest) {
  const path = join(runDir, metricsFile);
  const existing = await readJsonIfExists(path);
  if (existing) {
    return { metrics: existing, path };
  }
  return {
    metrics: {
      version: 1,
      created_at: new Date().toISOString(),
      phases: [],
      run_dir: runDir,
      run_id: manifest.run_id || basename(runDir),
      updated_at: new Date().toISOString(),
    },
    path,
  };
}

function findOrCreatePhase(metrics, options) {
  const candidate = {
    phase: options.phase,
    role: options.role,
    session_id: options.sessionId,
  };
  const key = phaseKey(candidate);
  let entry = metrics.phases.find((phase) => phaseKey(phase) === key);
  if (!entry) {
    entry = {
      codex_home: options.codexHome,
      completed_at: "",
      end_snapshot: null,
      label: options.label || options.phase,
      phase: options.phase,
      role: options.role,
      session_id: options.sessionId,
      start_snapshot: null,
      started_at: "",
      usage_delta: null,
    };
    metrics.phases.push(entry);
  }
  if (options.label) entry.label = options.label;
  if (options.codexHome) entry.codex_home = options.codexHome;
  return entry;
}

async function snapshotFor(options, at) {
  return getCodexTokenSnapshot(options.sessionId, {
    at,
    codexHome: options.codexHome,
  });
}

async function updateMetrics(options) {
  const runDir = resolve(options.runDir);
  const manifest = await readJson(join(runDir, "manifest.json"));
  const codexHome = resolve(options.codexHome || defaultCodexHome());
  const { metrics, path } = await loadMetrics(runDir, manifest);
  metrics.run_dir = runDir;
  metrics.run_id = manifest.run_id || basename(runDir);

  if (options.summary) {
    return { metrics, path, summary: summarizeMetrics(metrics), wrote: false };
  }

  const normalizedOptions = { ...options, codexHome };
  const entry = findOrCreatePhase(metrics, normalizedOptions);
  const now = new Date().toISOString();

  if (options.markStart || options.startedAt) {
    const snapshot = await snapshotFor(normalizedOptions, options.startedAt);
    entry.started_at = options.startedAt || snapshot.timestamp || now;
    entry.start_snapshot = serializeSnapshot(snapshot);
  }

  if (options.markEnd || options.completedAt) {
    const snapshot = await snapshotFor(normalizedOptions, options.completedAt);
    entry.completed_at = options.completedAt || snapshot.timestamp || now;
    entry.end_snapshot = serializeSnapshot(snapshot);
  }

  entry.approximate = Boolean(options.startedAt || options.completedAt);
  entry.usage_delta = computeTokenDelta(entry.start_snapshot, entry.end_snapshot);
  metrics.updated_at = now;
  metrics.summary = summarizeMetrics(metrics);
  await writeFile(path, `${JSON.stringify(metrics, null, 2)}\n`);
  return { entry, metrics, path, summary: metrics.summary, wrote: true };
}

function formatUsage(usage) {
  if (!usage) {
    return "not available";
  }
  return `shown=${usage.shown_total_tokens}, cached=${usage.cached_input_tokens}, output=${usage.output_tokens}, reasoning=${usage.reasoning_output_tokens}`;
}

function printResult(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Codex AI run metrics: ${result.metrics.run_id}`);
  console.log(`- metrics: ${result.path}`);
  console.log(`- phases: ${result.summary.phase_count}`);
  console.log(`- completed phases: ${result.summary.completed_phases}`);
  console.log(`- total delta: ${formatUsage(result.summary.total_usage_delta)}`);
  console.log(`- parent delta: ${formatUsage(result.summary.by_role.parent)}`);
  console.log(`- worker delta: ${formatUsage(result.summary.by_role.worker)}`);
  if (result.entry) {
    console.log(`- updated phase: ${result.entry.role}/${result.entry.phase}`);
    console.log(`- phase delta: ${formatUsage(result.entry.usage_delta)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }
  const result = await updateMetrics(options);
  printResult(result, options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not meter Codex AI run: ${error.message}`);
    process.exitCode = 1;
  }
}
