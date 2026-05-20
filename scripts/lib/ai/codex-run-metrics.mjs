import { access, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  addTokenUsage,
  computeTokenDelta,
  defaultCodexHome,
  getCodexTokenSnapshot,
} from "./codex-session-usage.mjs";

export const codexMetricsFile = "codex-execution-metrics.json";

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

export function serializeCodexSnapshot(snapshot) {
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

export function summarizeCodexMetrics(metrics) {
  const phases = Array.isArray(metrics?.phases) ? metrics.phases : [];
  const tokenCompleted = phases.filter((phase) => phase.usage_delta);
  const statusCounts = {};
  for (const phase of phases) {
    const status = phase.status || "unknown";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  const byRole = {};
  for (const role of ["parent", "worker", "other"]) {
    byRole[role] = addTokenUsage(tokenCompleted.filter((phase) => phase.role === role).map((phase) => phase.usage_delta));
  }
  return {
    by_role: byRole,
    completed_phases: phases.filter((phase) => phase.completed_at).length,
    phase_count: phases.length,
    status_counts: statusCounts,
    token_completed_phases: tokenCompleted.length,
    total_usage_delta: addTokenUsage(tokenCompleted.map((phase) => phase.usage_delta)),
  };
}

export function codexMetricsHealth(metrics) {
  if (!metrics) {
    return {
      completed_phases_without_delta: 0,
      message: "codex-execution-metrics.json is missing; token cost is not attributable.",
      status: "missing",
      token_completed_phases: 0,
    };
  }
  const phases = Array.isArray(metrics.phases) ? metrics.phases : [];
  const completedPhases = phases.filter((phase) => phase.completed_at);
  const tokenCompletedPhases = completedPhases.filter((phase) => phase.usage_delta);
  const completedWithoutDelta = completedPhases.filter((phase) => !phase.usage_delta);
  if (completedPhases.length === 0) {
    return {
      completed_phases_without_delta: 0,
      message: "No completed Codex metric phases were recorded.",
      status: "no-completed-phases",
      token_completed_phases: 0,
    };
  }
  if (tokenCompletedPhases.length === 0) {
    return {
      completed_phases_without_delta: completedWithoutDelta.length,
      message: "Completed Codex metric phases have no start/end token delta; token cost is not attributable.",
      status: "not-attributable",
      token_completed_phases: 0,
    };
  }
  if (completedWithoutDelta.length > 0) {
    return {
      completed_phases_without_delta: completedWithoutDelta.length,
      message: `${completedWithoutDelta.length}/${completedPhases.length} completed Codex metric phase(s) have no token delta.`,
      status: "partial",
      token_completed_phases: tokenCompletedPhases.length,
    };
  }
  return {
    completed_phases_without_delta: 0,
    message: `${tokenCompletedPhases.length}/${completedPhases.length} completed Codex metric phase(s) have attributable token deltas.`,
    status: "attributable",
    token_completed_phases: tokenCompletedPhases.length,
  };
}

export async function loadCodexMetrics(runDir, manifest) {
  const path = join(runDir, codexMetricsFile);
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
    session_id: options.sessionId || "",
  };
  const key = phaseKey(candidate);
  let entry = metrics.phases.find((phase) => phaseKey(phase) === key);
  if (!entry) {
    entry = {
      codex_home: options.codexHome || "",
      completed_at: "",
      duration_ms: null,
      end_snapshot: null,
      label: options.label || options.phase,
      notes: "",
      phase: options.phase,
      role: options.role,
      session_id: options.sessionId || "",
      start_snapshot: null,
      started_at: "",
      status: "unknown",
      usage_delta: null,
    };
    metrics.phases.push(entry);
  }
  if (options.label) entry.label = options.label;
  if (options.codexHome) entry.codex_home = options.codexHome;
  if (options.notes !== undefined) entry.notes = options.notes;
  return entry;
}

function durationMs(startedAt, completedAt) {
  if (!startedAt || !completedAt) {
    return null;
  }
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

async function snapshotFor(options, at) {
  if (!options.sessionId) {
    return null;
  }
  return getCodexTokenSnapshot(options.sessionId, {
    at,
    codexHome: options.codexHome,
  });
}

export async function updateCodexRunMetrics(options) {
  const runDir = resolve(options.runDir);
  const manifest = await readJson(join(runDir, "manifest.json"));
  const codexHome = options.codexHome ? resolve(options.codexHome) : resolve(defaultCodexHome());
  const { metrics, path } = await loadCodexMetrics(runDir, manifest);
  metrics.run_dir = runDir;
  metrics.run_id = manifest.run_id || basename(runDir);

  if (options.summary) {
    return { metrics, path, summary: summarizeCodexMetrics(metrics), wrote: false };
  }

  const normalizedOptions = {
    ...options,
    codexHome,
    phase: options.phase || "parent",
    role: options.role || "parent",
  };
  const entry = findOrCreatePhase(metrics, normalizedOptions);
  const now = new Date().toISOString();

  if (options.markStart || options.startedAt || options.startedNow) {
    const snapshot = await snapshotFor(normalizedOptions, options.startedAt);
    entry.started_at = options.startedAt || snapshot?.timestamp || now;
    entry.start_snapshot = serializeCodexSnapshot(snapshot);
  }

  if (options.markEnd || options.completedAt || options.completedNow) {
    const snapshot = await snapshotFor(normalizedOptions, options.completedAt);
    entry.completed_at = options.completedAt || snapshot?.timestamp || now;
    entry.end_snapshot = serializeCodexSnapshot(snapshot);
  }

  if (options.status) {
    entry.status = options.status;
  } else if (entry.completed_at) {
    entry.status = "completed";
  } else if (entry.started_at) {
    entry.status = "running";
  }

  entry.approximate = Boolean(options.startedAt || options.completedAt);
  entry.duration_ms = durationMs(entry.started_at, entry.completed_at);
  entry.usage_delta = computeTokenDelta(entry.start_snapshot, entry.end_snapshot);
  metrics.updated_at = now;
  metrics.summary = summarizeCodexMetrics(metrics);
  await writeFile(path, `${JSON.stringify(metrics, null, 2)}\n`);
  return { entry, metrics, path, summary: metrics.summary, wrote: true };
}

export function formatCodexUsage(usage) {
  if (!usage) {
    return "not available";
  }
  return `shown=${usage.shown_total_tokens}, cached=${usage.cached_input_tokens}, output=${usage.output_tokens}, reasoning=${usage.reasoning_output_tokens}`;
}
