import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPlan } from "./plan-ai-updates.mjs";
import { renderDiff } from "./render-ai-diff.mjs";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultProposalFile = "metadata-proposals.json";
const defaultSummaryFile = "metadata-review-summary.md";

const distributionFields = [
  "priority_level",
  "has_negative_space",
  "safe_crop",
  "recommended_uses",
  "scene_tags",
  "public_use_status",
];

const peopleSceneValues = new Set(["講者", "會眾", "工作人員", "合照", "交流", "攝影"]);
const peopleReasonPattern = /人|會眾|講者|合照|志工|參與者|工作人員/;
const concentrationThreshold = 0.9;

function printUsage() {
  console.log(`Usage:
  pnpm ai:review -- --run-dir <dir>

Options:
  --run-dir <dir>       AI run directory containing manifest.json and photos.json.
  --proposals <path>    Proposal JSON path. Default: <run-dir>/metadata-proposals.json.
  --summary <path>      Markdown summary path. Default: <run-dir>/metadata-review-summary.md.
  --sample <number>     Number of planned updates to preview in the summary. Default: 20.
  --help, -h            Show this help.

This command validates the AI proposals, renders metadata-diff.md, renders
metadata-update-plan.json/csv, and writes one human review summary. It does
not read or write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    proposalsPath: "",
    runDir: "",
    sample: 20,
    summaryPath: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--run-dir") {
      options.runDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--proposals") {
      options.proposalsPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--summary") {
      options.summaryPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--sample") {
      options.sample = Number(args[index + 1] ?? "");
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.runDir) {
      throw new Error("--run-dir requires a path");
    }
    if (!Number.isInteger(options.sample) || options.sample < 0) {
      throw new Error("--sample must be a non-negative integer");
    }
    if (!options.proposalsPath) {
      options.proposalsPath = join(options.runDir, defaultProposalFile);
    }
    if (!options.summaryPath) {
      options.summaryPath = join(options.runDir, defaultSummaryFile);
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

function formatValue(value) {
  if (Array.isArray(value)) {
    return value.join(";");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return String(value);
}

function markdownCell(value) {
  return formatValue(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim();
}

function table(headers, rows) {
  const lines = [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function countValues(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh-Hant"))
    .map(([value, count]) => ({ count, value }));
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function valuesForField(item, field) {
  const proposal = item.fields[field];
  if (!proposal) {
    return [];
  }
  return Array.isArray(proposal.value) ? proposal.value : [proposal.value];
}

function fieldCounts(items) {
  return countValues(items.flatMap((item) => Object.keys(item.fields))).map(({ value, count }) => ({
    field: value,
    count,
  }));
}

function distributionRows(items, field) {
  return countValues(items.flatMap((item) => valuesForField(item, field))).map(({ value, count }) => [
    field,
    value,
    count,
  ]);
}

function confidenceStats(items) {
  const confidences = items.flatMap((item) =>
    Object.values(item.fields)
      .map((proposal) => proposal.confidence)
      .filter((value) => typeof value === "number"),
  );
  const perfectCount = confidences.filter((value) => value === 1).length;
  const confidenceCounts = countValues(confidences);
  return {
    confidenceCounts,
    perfectCount,
    total: confidences.length,
  };
}

function mostCommonValue(items, field) {
  const counts = countValues(items.flatMap((item) => valuesForField(item, field)));
  return counts[0] ?? { count: 0, value: "" };
}

function allReasonText(item) {
  return Object.values(item.fields)
    .map((proposal) => proposal.reason)
    .filter((reason) => typeof reason === "string")
    .join(" ");
}

function photoIdList(items) {
  return items.map((item) => item.photo_id).join(", ");
}

function buildReviewNotes(items) {
  const notes = [];
  const itemCount = items.length;
  const priorityCount = items.filter((item) => item.fields.priority_level).length;
  const publicUseStatusCount = items.filter((item) => item.fields.public_use_status).length;
  const needsReviewCount = items.filter((item) => item.fields.public_use_status?.value === "needs_review").length;
  const sponsorReportItems = items.filter((item) =>
    valuesForField(item, "recommended_uses").includes("贊助成果報告")
    && valuesForField(item, "sponsorship_items").length === 0
    && valuesForField(item, "sponsorship_tags").length === 0,
  );
  const zeroPeopleContradictions = items.filter((item) => {
    if (item.fields.people_count?.value !== 0) {
      return false;
    }
    const sceneValues = valuesForField(item, "scene_tags");
    const hasPeopleScene = sceneValues.some((value) => peopleSceneValues.has(value));
    return hasPeopleScene || peopleReasonPattern.test(allReasonText(item));
  });
  const { confidenceCounts, perfectCount, total } = confidenceStats(items);

  if (priorityCount === itemCount && itemCount > 0) {
    notes.push("`priority_level` 每張都有候選值，請確認模型是否把它當成預設欄位。");
  }

  const mostCommonSafeCrop = mostCommonValue(items, "safe_crop");
  if (itemCount > 0 && mostCommonSafeCrop.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`safe_crop\` 的 \`${mostCommonSafeCrop.value}\` 出現在 ${mostCommonSafeCrop.count}/${itemCount} 張照片（${formatPercent(mostCommonSafeCrop.count / itemCount)}），請抽查是否過度套用。`,
    );
  }

  const mostCommonNegativeSpace = mostCommonValue(items, "has_negative_space");
  if (itemCount > 0 && mostCommonNegativeSpace.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`has_negative_space = ${mostCommonNegativeSpace.value}\` 出現在 ${mostCommonNegativeSpace.count}/${itemCount} 張照片（${formatPercent(mostCommonNegativeSpace.count / itemCount)}），請確認模型是否逐張判斷版面留白。`,
    );
  }

  const mostCommonSceneTag = mostCommonValue(items, "scene_tags");
  if (itemCount > 0 && mostCommonSceneTag.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`scene_tags\` 的 \`${mostCommonSceneTag.value}\` 出現在 ${mostCommonSceneTag.count}/${itemCount} 張照片（${formatPercent(mostCommonSceneTag.count / itemCount)}），請確認是否過度套用同一場景標籤。`,
    );
  }

  const mostCommonUse = mostCommonValue(items, "recommended_uses");
  if (itemCount > 0 && mostCommonUse.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`recommended_uses\` 的 \`${mostCommonUse.value}\` 出現在 ${mostCommonUse.count}/${itemCount} 張照片（${formatPercent(mostCommonUse.count / itemCount)}），用途區辨度可能不足。`,
    );
  }

  if (publicUseStatusCount === 0) {
    notes.push("沒有 `public_use_status` 候選值；若本批沒有明顯 avoid 照片，這可以接受。");
  } else if (itemCount > 0 && needsReviewCount / itemCount >= concentrationThreshold) {
    notes.push(
      `\`public_use_status = needs_review\` 出現在 ${needsReviewCount}/${itemCount} 張照片（${formatPercent(needsReviewCount / itemCount)}），可能被當成預設填空；請確認每張是否有具體公開使用疑慮。`,
    );
  }
  if (total === 0) {
    notes.push("所有候選值都未提供 `confidence`；格式允許省略，但不利於人工排序與抽查。");
  } else if (perfectCount / total > 0.25) {
    notes.push("有偏多 `confidence = 1`，人數、用途與情緒欄位仍應人工抽查。");
  }
  const mostCommonConfidence = confidenceCounts[0];
  if (mostCommonConfidence && total > 0 && mostCommonConfidence.count / total >= concentrationThreshold) {
    notes.push(
      `\`confidence = ${mostCommonConfidence.value}\` 出現在 ${mostCommonConfidence.count}/${total} 個候選欄位（${formatPercent(mostCommonConfidence.count / total)}），信心分數可能沒有逐欄反映不確定性。`,
    );
  }
  if (sponsorReportItems.length > 0) {
    notes.push(
      `有 ${sponsorReportItems.length} 張照片建議 \`贊助成果報告\` 但沒有 \`sponsorship_items\` 或 \`sponsorship_tags\`：${photoIdList(sponsorReportItems)}。請人工確認贊助脈絡。`,
    );
  }
  if (zeroPeopleContradictions.length > 0) {
    notes.push(
      `有 ${zeroPeopleContradictions.length} 張照片的 \`people_count = 0\`，但 scene tags 或 reason 仍提到人物相關線索：${photoIdList(zeroPeopleContradictions)}。請人工確認人數。`,
    );
  }

  return notes;
}

function renderSummary({ manifest, plan, proposals, runDir, sample, summaryPath }) {
  const items = proposals.items;
  const notes = buildReviewNotes(items);
  const fieldCountRows = fieldCounts(items).map(({ field, count }) => [field, count]);
  const distributionTableRows = distributionFields.flatMap((field) => distributionRows(items, field));
  const sampleRows = plan.updates.slice(0, sample).map((update) => [
    update.photo_id,
    update.field,
    update.current_value,
    update.proposed_value,
    update.confidence ?? "",
    update.reason,
  ]);

  const lines = [
    "# AI Review Summary",
    "",
    `- Run: \`${manifest.run_id}\``,
    `- Producer: ${proposals.producer.type} / ${proposals.producer.name}`,
    `- Image size: \`${manifest.image_size ?? ""}\``,
    `- Proposal items: ${items.length}`,
    `- Planned updates: ${plan.update_count}`,
    "",
    "## Output Files",
    "",
    `- Review summary: \`${summaryPath}\``,
    `- Human diff: \`${join(runDir, "metadata-diff.md")}\``,
    `- Update plan JSON: \`${plan.json_output}\``,
    `- Update plan CSV: \`${plan.csv_output}\``,
    "",
    "## Review Notes",
    "",
    ...(notes.length > 0 ? notes.map((note) => `- ${note}`) : ["- 未偵測到明顯的批次層級警訊；仍請抽查照片與 reason。"]),
    "",
    "## Field Coverage",
    "",
    table(["field", "proposal count"], fieldCountRows),
    "",
    "## Value Distribution",
    "",
    distributionTableRows.length > 0
      ? table(["field", "value", "count"], distributionTableRows)
      : "No distribution fields were proposed.",
    "",
    "## Planned Update Sample",
    "",
    sampleRows.length > 0
      ? table(["photo_id", "field", "current", "proposed", "confidence", "reason"], sampleRows)
      : "No changed updates in this plan.",
    "",
    "## Next Commands",
    "",
    "Open a single-run HTML report:",
    "",
    "```bash",
    `pnpm ai:report -- --run ${runDir}`,
    "```",
    "",
    "Compare this run with another attempt:",
    "",
    "```bash",
    `pnpm ai:report -- --runs ${runDir} tmp/ai-runs/<other-run-or-attempt>`,
    "```",
    "",
    "Dry-run exact Google Sheets cells:",
    "",
    "```bash",
    `pnpm sheets:apply-ai-updates -- --run-dir ${runDir}`,
    "```",
    "",
    "Apply after human confirmation:",
    "",
    "```bash",
    `pnpm sheets:apply-ai-updates -- --run-dir ${runDir} --write`,
    "```",
    "",
  ];

  return lines.join("\n");
}

async function reviewAiRun(options) {
  const diffOutputPath = join(options.runDir, "metadata-diff.md");
  const jsonOutputPath = join(options.runDir, "metadata-update-plan.json");
  const csvOutputPath = join(options.runDir, "metadata-update-plan.csv");

  const validation = await validateAiProposals({
    proposalsPath: options.proposalsPath,
    runDir: options.runDir,
  });

  const diff = await renderDiff({
    outputPath: diffOutputPath,
    proposalsPath: options.proposalsPath,
    runDir: options.runDir,
  });

  const plan = await buildPlan({
    csvOutputPath,
    help: false,
    includeUnchanged: false,
    jsonOutputPath,
    proposalsPath: options.proposalsPath,
    runDir: options.runDir,
  });

  const [manifest, proposals] = await Promise.all([
    readJson(join(options.runDir, "manifest.json")),
    readJson(options.proposalsPath),
  ]);
  const summary = renderSummary({
    manifest,
    plan,
    proposals,
    runDir: options.runDir,
    sample: options.sample,
    summaryPath: options.summaryPath,
  });
  await writeFile(options.summaryPath, summary);

  return {
    diffPath: diff.outputPath,
    diffRows: diff.rowCount,
    itemCount: validation.itemCount,
    planCsvPath: plan.csv_output,
    planJsonPath: plan.json_output,
    runId: validation.runId,
    summaryPath: options.summaryPath,
    updateCount: plan.update_count,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await reviewAiRun(options);
  console.log(`AI run reviewed: ${result.runId}`);
  console.log(`- proposals: ${result.itemCount}`);
  console.log(`- diff rows: ${result.diffRows}`);
  console.log(`- planned updates: ${result.updateCount}`);
  console.log(`- summary: ${result.summaryPath}`);
  console.log(`- diff: ${result.diffPath}`);
  console.log(`- update plan: ${result.planJsonPath}`);
  console.log(`- update CSV: ${result.planCsvPath}`);
  console.log("");
  console.log("Next:");
  console.log(`- Review ${result.summaryPath}`);
  console.log(`- Open single-run report: pnpm ai:report -- --run ${options.runDir}`);
  console.log(`- Compare attempts: pnpm ai:report -- --runs ${options.runDir} tmp/ai-runs/<other-run-or-attempt>`);
  console.log(`- Open ${result.planCsvPath} to inspect all values that may be written`);
  console.log(`- Dry-run Sheets cells: pnpm sheets:apply-ai-updates -- --run-dir ${options.runDir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not review AI run: ${error.message}`);
    process.exitCode = 1;
  }
}
