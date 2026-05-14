import { pathToFileURL } from "node:url";
import {
  formatCodexUsage,
  updateCodexRunMetrics,
} from "../lib/ai/codex-run-metrics.mjs";

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

function printResult(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`Codex AI run metrics: ${result.metrics.run_id}`);
  console.log(`- metrics: ${result.path}`);
  console.log(`- phases: ${result.summary.phase_count}`);
  console.log(`- completed phases: ${result.summary.completed_phases}`);
  console.log(`- token completed phases: ${result.summary.token_completed_phases}`);
  console.log(`- total delta: ${formatCodexUsage(result.summary.total_usage_delta)}`);
  console.log(`- parent delta: ${formatCodexUsage(result.summary.by_role.parent)}`);
  console.log(`- worker delta: ${formatCodexUsage(result.summary.by_role.worker)}`);
  if (result.entry) {
    console.log(`- updated phase: ${result.entry.role}/${result.entry.phase}`);
    console.log(`- phase status: ${result.entry.status}`);
    console.log(`- phase delta: ${formatCodexUsage(result.entry.usage_delta)}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }
  const result = await updateCodexRunMetrics(options);
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
