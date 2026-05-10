import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getAiLabelingPromptMetadata } from "./ai-labeling-prompt.mjs";
import { buildPlan } from "./plan-ai-updates.mjs";
import { renderDiff } from "./render-ai-diff.mjs";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultProposalFile = "metadata-proposals.json";
const defaultSummaryFile = "metadata-review-summary.md";

const distributionFields = [
  "priority_level",
  "subject_type",
  "has_negative_space",
  "safe_crop",
  "recommended_uses",
  "scene_tags",
  "mood_tags",
  "public_use_status",
];

const peopleSceneValues = new Set(["講者", "會眾", "工作人員", "合照", "交流", "攝影"]);
const peopleReasonPattern = /人|會眾|講者|合照|志工|參與者|工作人員/;
const noPeopleReasonPattern = /沒有人|無人|沒有可辨識人物|沒有可見人物|沒有可辨識的人|沒有人物|無可辨識人物|沒有.*人物/;
const concentrationThreshold = 0.9;
const genericUseThresholds = new Map([
  ["活動回顧", 0.45],
  ["社群貼文", 0.5],
]);
const broadMoodThresholds = new Map([
  ["專業", 0.4],
  ["專注", 0.4],
  ["友善", 0.35],
]);
const lowMoodCoverageMinimumItems = 20;
const lowMoodCoverageThreshold = 0.2;
const reviewFocusMaxRows = 25;
const asciiWordPattern = /[A-Za-z][A-Za-z0-9'_-]{2,}(?:\s+[A-Za-z][A-Za-z0-9'_-]{2,}){4,}/;

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

function allHumanText(item) {
  return Object.values(item.fields)
    .flatMap((proposal) => {
      const values = [proposal.reason];
      if (typeof proposal.value === "string") {
        values.push(proposal.value);
      }
      return values;
    })
    .filter((value) => typeof value === "string")
    .join(" ");
}

function proposalHumanText(proposal) {
  const values = [proposal.reason];
  if (typeof proposal.value === "string") {
    values.push(proposal.value);
  }
  return values.filter((value) => typeof value === "string").join(" ");
}

function photoIdList(items) {
  return items.map((item) => item.photo_id).join(", ");
}

function isZeroPeopleContradiction(item) {
  if (item.fields.people_count?.value !== 0) {
    return false;
  }
  const sceneValues = valuesForField(item, "scene_tags");
  const hasPeopleScene = sceneValues.some((value) => peopleSceneValues.has(value));
  const reasonText = allReasonText(item);
  return hasPeopleScene || (peopleReasonPattern.test(reasonText) && !noPeopleReasonPattern.test(reasonText));
}

function proposalReason(item, field) {
  return item.fields[field]?.reason ?? "";
}

function proposalValue(item, field) {
  return item.fields[field]?.value ?? "";
}

function pushFocusRows(rows, seen, issue, items, field, maxRows = 8) {
  for (const item of items.slice(0, maxRows)) {
    const key = `${issue}\0${item.photo_id}\0${field}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push([
      issue,
      item.photo_id,
      field,
      proposalValue(item, field),
      proposalReason(item, field),
    ]);
    if (rows.length >= reviewFocusMaxRows) {
      return;
    }
  }
}

function buildReviewFocusRows(items) {
  const rows = [];
  const seen = new Set();
  const itemCount = items.length;
  const safeCrop = mostCommonValue(items, "safe_crop");
  const mood = mostCommonValue(items, "mood_tags");

  if (itemCount > 0 && safeCrop.count / itemCount >= concentrationThreshold) {
    pushFocusRows(
      rows,
      seen,
      `抽查 safe_crop = ${safeCrop.value}`,
      items.filter((item) => valuesForField(item, "safe_crop").includes(safeCrop.value)),
      "safe_crop",
    );
  }

  for (const [genericUse, threshold] of genericUseThresholds) {
    const useItems = items.filter((item) => valuesForField(item, "recommended_uses").includes(genericUse));
    if (itemCount > 0 && useItems.length / itemCount >= threshold) {
      pushFocusRows(rows, seen, `抽查 recommended_uses = ${genericUse}`, useItems, "recommended_uses");
    }
  }

  for (const [broadMood, threshold] of broadMoodThresholds) {
    const moodItems = items.filter((item) => valuesForField(item, "mood_tags").includes(broadMood));
    if (itemCount > 0 && moodItems.length / itemCount >= threshold) {
      pushFocusRows(rows, seen, `抽查 mood_tags = ${broadMood}`, moodItems, "mood_tags");
    }
  }

  if (itemCount > 0 && mood.count / itemCount >= concentrationThreshold) {
    pushFocusRows(
      rows,
      seen,
      `抽查 mood_tags = ${mood.value}`,
      items.filter((item) => valuesForField(item, "mood_tags").includes(mood.value)),
      "mood_tags",
    );
  }

  const sponsorReportItems = items.filter((item) =>
    valuesForField(item, "recommended_uses").includes("贊助成果報告")
    && valuesForField(item, "sponsorship_items").length === 0
    && valuesForField(item, "sponsorship_tags").length === 0,
  );
  pushFocusRows(rows, seen, "缺少贊助欄位但建議贊助成果報告", sponsorReportItems, "recommended_uses");

  const sponsorProposalItems = items.filter((item) =>
    valuesForField(item, "recommended_uses").includes("贊助提案")
    && valuesForField(item, "sponsorship_items").length === 0
    && valuesForField(item, "sponsorship_tags").length === 0,
  );
  pushFocusRows(rows, seen, "缺少贊助欄位但建議贊助提案", sponsorProposalItems, "recommended_uses");

  const zeroPeopleContradictions = items.filter(isZeroPeopleContradiction);
  pushFocusRows(rows, seen, "people_count = 0 但有人物線索", zeroPeopleContradictions, "people_count");

  const longEnglishTextItems = items.filter((item) => asciiWordPattern.test(allHumanText(item)));
  for (const item of longEnglishTextItems.slice(0, 8)) {
    const field = Object.entries(item.fields).find(([, proposal]) => asciiWordPattern.test(proposalHumanText(proposal)))?.[0]
      ?? "visual_description";
    pushFocusRows(rows, seen, "較長英文內容", [item], field, 1);
    if (rows.length >= reviewFocusMaxRows) {
      break;
    }
  }

  return rows.slice(0, reviewFocusMaxRows);
}

function buildReviewNotes(items) {
  const notes = [];
  const itemCount = items.length;
  const priorityCount = items.filter((item) => item.fields.priority_level).length;
  const publicUseStatusCount = items.filter((item) => item.fields.public_use_status).length;
  const needsReviewCount = items.filter((item) => item.fields.public_use_status?.value === "needs_review").length;
  const moodCount = items.filter((item) => item.fields.mood_tags).length;
  const recommendedUseCount = items.filter((item) => item.fields.recommended_uses).length;
  const sponsorReportItems = items.filter((item) =>
    valuesForField(item, "recommended_uses").includes("贊助成果報告")
    && valuesForField(item, "sponsorship_items").length === 0
    && valuesForField(item, "sponsorship_tags").length === 0,
  );
  const sponsorProposalItems = items.filter((item) =>
    valuesForField(item, "recommended_uses").includes("贊助提案")
    && valuesForField(item, "sponsorship_items").length === 0
    && valuesForField(item, "sponsorship_tags").length === 0,
  );
  const zeroPeopleContradictions = items.filter(isZeroPeopleContradiction);
  const longEnglishTextItems = items.filter((item) => asciiWordPattern.test(allHumanText(item)));
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

  const mostCommonMoodTag = mostCommonValue(items, "mood_tags");
  if (moodCount === itemCount && itemCount > 0) {
    notes.push("每張照片都有 `mood_tags` 候選值；請確認模型是否把情緒標籤當成必填分類。普通紀錄照可以省略。");
  } else if (itemCount >= lowMoodCoverageMinimumItems && moodCount / itemCount < lowMoodCoverageThreshold) {
    notes.push(
      `只有 ${moodCount}/${itemCount} 張照片提出 \`mood_tags\`（${formatPercent(moodCount / itemCount)}）；若本批包含適合社群宣傳、招募、網站視覺或情緒找圖的照片，請抽查模型是否過度保守。`,
    );
  } else if (itemCount > 0 && moodCount / itemCount >= concentrationThreshold) {
    notes.push(
      `有 ${moodCount}/${itemCount} 張照片提出 \`mood_tags\`（${formatPercent(moodCount / itemCount)}），請抽查是否只有在情緒或宣傳語感明確時才標。`,
    );
  }
  for (const [mood, threshold] of broadMoodThresholds) {
    const moodValueCount = items.filter((item) => valuesForField(item, "mood_tags").includes(mood)).length;
    if (itemCount > 0 && moodValueCount / itemCount >= threshold) {
      notes.push(
        `\`mood_tags = ${mood}\` 出現在 ${moodValueCount}/${itemCount} 張照片（${formatPercent(moodValueCount / itemCount)}），請抽查是否被當成泛用感受。`,
      );
    }
  }
  if (itemCount > 0 && mostCommonMoodTag.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`mood_tags\` 的 \`${mostCommonMoodTag.value}\` 出現在 ${mostCommonMoodTag.count}/${itemCount} 張照片（${formatPercent(mostCommonMoodTag.count / itemCount)}），情緒標籤區辨度可能不足。`,
    );
  }

  const mostCommonUse = mostCommonValue(items, "recommended_uses");
  if (itemCount > 0 && mostCommonUse.count / itemCount >= concentrationThreshold) {
    notes.push(
      `\`recommended_uses\` 的 \`${mostCommonUse.value}\` 出現在 ${mostCommonUse.count}/${itemCount} 張照片（${formatPercent(mostCommonUse.count / itemCount)}），用途區辨度可能不足。`,
    );
  }
  if (recommendedUseCount === itemCount && itemCount > 0) {
    notes.push("每張照片都有 `recommended_uses` 候選值；請確認模型是否把用途當成必填欄位。普通可用但沒有明確用途優勢的照片可以省略。");
  }
  for (const [genericUse, threshold] of genericUseThresholds) {
    const useCount = items.filter((item) => valuesForField(item, "recommended_uses").includes(genericUse)).length;
    if (itemCount > 0 && useCount / itemCount >= threshold) {
      notes.push(
        `\`recommended_uses = ${genericUse}\` 出現在 ${useCount}/${itemCount} 張照片（${formatPercent(useCount / itemCount)}），請抽查是否被當成通用預設用途。`,
      );
    }
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
      `有 ${sponsorReportItems.length} 張照片建議 \`贊助成果報告\` 但沒有 \`sponsorship_items\` 或 \`sponsorship_tags\`：${photoIdList(sponsorReportItems)}。通常應移除該用途，除非照片或既有 metadata 有明確贊助脈絡。`,
    );
  }
  if (sponsorProposalItems.length > 0) {
    notes.push(
      `有 ${sponsorProposalItems.length} 張照片建議 \`贊助提案\` 但沒有 \`sponsorship_items\` 或 \`sponsorship_tags\`：${photoIdList(sponsorProposalItems)}。請確認是否真的能支撐贊助溝通情境。`,
    );
  }
  if (zeroPeopleContradictions.length > 0) {
    notes.push(
      `有 ${zeroPeopleContradictions.length} 張照片的 \`people_count = 0\`，但 scene tags 或 reason 仍提到人物相關線索：${photoIdList(zeroPeopleContradictions)}。請人工確認人數。`,
    );
  }
  if (longEnglishTextItems.length > 0) {
    notes.push(
      `有 ${longEnglishTextItems.length} 張照片的 reason 或 \`visual_description\` 出現較長英文段落：${photoIdList(longEnglishTextItems)}。除非是在引用照片中可見文字，否則應改用台灣慣用繁體中文。`,
    );
  }

  return notes;
}

function buildPromptVersionNotes(manifest) {
  const currentPrompt = getAiLabelingPromptMetadata();
  if (!manifest.prompt_template_sha256) {
    return ["這個 run 沒有記錄 `prompt_template_sha256`；可能是較舊的工作包，prompt 版本無法追溯。"];
  }
  if (manifest.prompt_template_sha256 !== currentPrompt.prompt_template_sha256) {
    return [
      `這個 run 使用的 prompt template hash \`${manifest.prompt_template_sha256.slice(0, 12)}\` 不同於目前 repo 版本 \`${currentPrompt.prompt_template_sha256.slice(0, 12)}\`；若要用新版 prompt 評估模型，請重新建立 run 或 attempt。`,
    ];
  }
  return [];
}

function renderSummary({ manifest, notes, plan, proposals, runDir, sample, summaryPath }) {
  const items = proposals.items;
  const fieldCountRows = fieldCounts(items).map(({ field, count }) => [field, count]);
  const distributionTableRows = distributionFields.flatMap((field) => distributionRows(items, field));
  const focusRows = buildReviewFocusRows(items);
  const promptTemplate = manifest.prompt_template_path || "unknown";
  const promptHash = manifest.prompt_template_sha256 ? manifest.prompt_template_sha256.slice(0, 12) : "unknown";
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
    `- Prompt template: \`${promptTemplate}\` @ \`${promptHash}\``,
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
    "## Review Focus",
    "",
    focusRows.length > 0
      ? table(["issue", "photo_id", "field", "proposed", "reason"], focusRows)
      : "No specific focus rows were generated from review warnings.",
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
  const notes = [...buildPromptVersionNotes(manifest), ...validation.warnings, ...buildReviewNotes(proposals.items)];
  const summary = renderSummary({
    manifest,
    notes,
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
    warningCount: notes.length,
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
  console.log(`- review warnings: ${result.warningCount}`);
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
