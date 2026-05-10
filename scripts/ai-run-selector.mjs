import { checkbox, select } from "@inquirer/prompts";
import { stdin as input } from "node:process";
import { discoverAiRuns, formatAiRunChoice } from "./ai-run-discovery.mjs";

function assertInteractive() {
  if (!input.isTTY) {
    throw new Error("stdin is not interactive. Use pnpm ai:report -- --run <dir> or --runs <dir> <dir> in non-interactive environments.");
  }
}

function choicesFromRuns(runs) {
  return runs.map((run) => ({
    description: [
      `run: ${run.runId}`,
      run.sourceRunId ? `source: ${run.sourceRunId}` : "",
      `path: ${run.dir}`,
    ].filter(Boolean).join(" | "),
    name: formatAiRunChoice(run),
    value: run.dir,
  }));
}

async function loadChoices() {
  const runs = await discoverAiRuns();
  if (runs.length === 0) {
    throw new Error("No AI runs found under tmp/ai-runs. Create one with pnpm workflow -- --task ai-prepare, pnpm eval -- --task sample, or pnpm eval:attempt.");
  }
  return choicesFromRuns(runs);
}

export async function selectSingleAiRun() {
  assertInteractive();
  const choices = await loadChoices();
  return select({
    choices,
    message: "選擇要產生 report 的 AI run / attempt",
    pageSize: Math.min(Math.max(choices.length, 5), 15),
  });
}

export async function selectMultipleAiRuns() {
  assertInteractive();
  const choices = await loadChoices();
  if (choices.length < 2) {
    throw new Error("Comparison report requires at least two AI runs under tmp/ai-runs.");
  }

  return checkbox({
    choices,
    message: "選擇要比較的 AI runs / attempts",
    pageSize: Math.min(Math.max(choices.length, 5), 15),
    required: true,
    validate(values) {
      return values.length >= 2 || "comparison report requires at least two run directories";
    },
  });
}
