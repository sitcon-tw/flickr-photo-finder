import { access, readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { aiRunsDir } from "../core/workflow-paths.mjs";

const proposalFile = "metadata-proposals.json";
const reviewSummaryFile = "metadata-review-summary.md";

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

function timestampMs(value) {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAttemptLabel(attempt) {
  if (!attempt?.model) {
    return "";
  }
  const round = attempt.round ? ` r${attempt.round}` : "";
  const label = attempt.label ? ` ${attempt.label}` : "";
  return `${attempt.model}${round}${label}`;
}

function runSortKey(run) {
  return timestampMs(run.createdAt) || run.mtimeMs || 0;
}

async function inspectAiRun(dir) {
  const [manifest, photos, attempt, dirStat] = await Promise.all([
    readJson(join(dir, "manifest.json")),
    readJson(join(dir, "photos.json")),
    readJsonIfExists(join(dir, "attempt.json")),
    stat(dir),
  ]);

  const proposals = await readJsonIfExists(join(dir, proposalFile));
  const hasReviewSummary = await pathExists(join(dir, reviewSummaryFile));
  const photoCount = Array.isArray(photos)
    ? photos.length
    : Number(manifest.selected_photo_count ?? 0);
  const attemptLabel = formatAttemptLabel(attempt);

  return {
    attempt,
    attemptLabel,
    baseRunId: attempt?.base_run_id || manifest.base_run_id || "",
    createdAt: manifest.created_at || attempt?.created_at || "",
    dir,
    hasProposals: Boolean(proposals),
    hasReviewSummary,
    imageSize: manifest.image_size || "",
    mtimeMs: dirStat.mtimeMs,
    photoCount,
    producerName: proposals?.producer?.name || "",
    runId: manifest.run_id || basename(dir),
    sourceRunId: attempt?.source_run_id || manifest.source_run_id || "",
  };
}

export async function discoverAiRuns({ rootDir = aiRunsDir } = {}) {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dir = join(rootDir, entry.name);
    try {
      runs.push(await inspectAiRun(dir));
    } catch {
      // Ignore partial or unrelated directories under tmp/ai-runs.
    }
  }

  return runs.sort((left, right) => {
    const timeDiff = runSortKey(right) - runSortKey(left);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return right.runId.localeCompare(left.runId);
  });
}

export function formatAiRunChoice(run) {
  const identity = run.attemptLabel || run.producerName || run.runId;
  const status = [
    run.hasProposals ? "proposals" : "no proposals",
    run.hasReviewSummary ? "reviewed" : "not reviewed",
  ].join(", ");
  const details = [
    `${run.photoCount} photos`,
    run.imageSize,
    run.baseRunId ? `base ${run.baseRunId}` : "",
  ].filter(Boolean).join(" | ");

  return `${identity} - ${status}${details ? ` (${details})` : ""}`;
}
