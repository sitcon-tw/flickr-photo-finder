import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export function defaultCodexHome(env = process.env) {
  return env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(homedir(), ".codex");
}

export function shownTokenTotal(usage) {
  return Number(usage.input_tokens || 0) - Number(usage.cached_input_tokens || 0) + Number(usage.output_tokens || 0);
}

export function normalizeTokenUsage(usage = {}) {
  const inputTokens = Number(usage.input_tokens || 0);
  const cachedInputTokens = Number(usage.cached_input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  return {
    cached_input_tokens: cachedInputTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: Number(usage.reasoning_output_tokens || 0),
    shown_total_tokens: inputTokens - cachedInputTokens + outputTokens,
    total_tokens: Number(usage.total_tokens || 0),
    uncached_input_tokens: inputTokens - cachedInputTokens,
  };
}

export function subtractTokenUsage(endUsage, startUsage) {
  const end = normalizeTokenUsage(endUsage);
  const start = normalizeTokenUsage(startUsage);
  return {
    cached_input_tokens: end.cached_input_tokens - start.cached_input_tokens,
    input_tokens: end.input_tokens - start.input_tokens,
    output_tokens: end.output_tokens - start.output_tokens,
    reasoning_output_tokens: end.reasoning_output_tokens - start.reasoning_output_tokens,
    shown_total_tokens: end.shown_total_tokens - start.shown_total_tokens,
    total_tokens: end.total_tokens - start.total_tokens,
    uncached_input_tokens: end.uncached_input_tokens - start.uncached_input_tokens,
  };
}

export function addTokenUsage(usages) {
  const sum = {
    cached_input_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    shown_total_tokens: 0,
    total_tokens: 0,
    uncached_input_tokens: 0,
  };
  for (const usage of usages.filter(Boolean).map(normalizeTokenUsage)) {
    for (const key of Object.keys(sum)) {
      sum[key] += Number(usage[key] || 0);
    }
  }
  return sum;
}

async function listJsonlFiles(root) {
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path);
      }
    }
  }
  await walk(root);
  return files;
}

export async function findCodexSessionFiles(sessionId, options = {}) {
  if (!sessionId || !String(sessionId).trim()) {
    throw new Error("session id is required");
  }
  const codexHome = resolve(options.codexHome || defaultCodexHome());
  const sessionsRoot = join(codexHome, "sessions");
  const files = await listJsonlFiles(sessionsRoot);
  return files
    .filter((path) => basename(path).includes(sessionId))
    .sort();
}

function snapshotFromLine({ line, lineNumber, path }) {
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    return null;
  }
  if (row?.type !== "event_msg" || row?.payload?.type !== "token_count") {
    return null;
  }
  const usage = row.payload?.info?.total_token_usage;
  if (!usage) {
    return null;
  }
  return {
    line_number: lineNumber,
    path,
    timestamp: row.timestamp || "",
    usage: normalizeTokenUsage(usage),
  };
}

export async function readCodexTokenSnapshots(sessionPath) {
  const text = await readFile(sessionPath, "utf8");
  const snapshots = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }
    const snapshot = snapshotFromLine({ line, lineNumber: index + 1, path: sessionPath });
    if (snapshot) {
      snapshots.push(snapshot);
    }
  }
  return snapshots;
}

function snapshotTime(snapshot) {
  const value = Date.parse(snapshot.timestamp);
  return Number.isFinite(value) ? value : null;
}

export function selectTokenSnapshot(snapshots, options = {}) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return null;
  }
  if (!options.at) {
    return snapshots[snapshots.length - 1];
  }
  const target = Date.parse(options.at);
  if (!Number.isFinite(target)) {
    throw new Error("--started-at/--completed-at must be parseable by Date.parse");
  }
  const before = snapshots
    .filter((snapshot) => {
      const time = snapshotTime(snapshot);
      return time !== null && time <= target;
    })
    .at(-1);
  if (before) {
    return before;
  }
  return snapshots.find((snapshot) => {
    const time = snapshotTime(snapshot);
    return time !== null && time >= target;
  }) ?? snapshots[0];
}

export async function loadCodexSessionSnapshots(sessionId, options = {}) {
  const files = await findCodexSessionFiles(sessionId, options);
  if (files.length === 0) {
    throw new Error(`Could not find Codex session JSONL for ${sessionId}`);
  }
  if (files.length > 1 && !options.allowMultiple) {
    throw new Error(`Found multiple Codex session JSONL files for ${sessionId}: ${files.join(", ")}`);
  }
  const snapshots = [];
  for (const path of files) {
    snapshots.push(...await readCodexTokenSnapshots(path));
  }
  snapshots.sort((left, right) => {
    const leftTime = snapshotTime(left) ?? 0;
    const rightTime = snapshotTime(right) ?? 0;
    return leftTime - rightTime || left.path.localeCompare(right.path) || left.line_number - right.line_number;
  });
  if (snapshots.length === 0) {
    throw new Error(`No token_count events found for Codex session ${sessionId}`);
  }
  return { files, snapshots };
}

export async function getCodexTokenSnapshot(sessionId, options = {}) {
  const loaded = await loadCodexSessionSnapshots(sessionId, options);
  const snapshot = selectTokenSnapshot(loaded.snapshots, { at: options.at });
  if (!snapshot) {
    throw new Error(`No token_count snapshot found for Codex session ${sessionId}`);
  }
  return {
    ...snapshot,
    session_id: sessionId,
    session_files: loaded.files,
  };
}

export function computeTokenDelta(startSnapshot, endSnapshot) {
  if (!startSnapshot || !endSnapshot) {
    return null;
  }
  return subtractTokenUsage(endSnapshot.usage, startSnapshot.usage);
}
