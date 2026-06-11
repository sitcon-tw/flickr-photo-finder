import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { selectMultipleAiRuns, selectSingleAiRun } from "../lib/ai/ai-run-selector.mjs";

const tasks = [
  {
    description: "理解模型品質評估和一般 AI 標記流程的差異。",
    handler: showEvalOverview,
    id: "overview",
    inputs: ["無"],
    next: ["依評估目的選擇 sample、attempt、review、report 或 search。"],
    outputs: ["評估流程說明"],
    phase: "理解流程",
    title: "了解評估流程",
  },
  {
    description: "依跨活動抽樣計畫建立本機 AI 測試工作包。",
    handler: buildCrossActivitySample,
    id: "sample",
    inputs: ["data/ai-cross-activity-sample-plan.json", "SITCON Flickr 相簿", "可選的既有 photos CSV metadata"],
    next: ["把 run 目錄中的 ai-labeling-prompt.md 與工作包交給模型；direct run 輸出 metadata-proposals.json 與 visual-inspection-audit.json。大型 run 先用 ai:shard:prepare / ai:shard:merge 把中間檔放在 /tmp。若要多模型比較，接著建立 attempt，並確認 prompt_template_sha256 一致。"],
    outputs: ["tmp/ai-samples/<run-id>/", "tmp/ai-runs/<run-id>/"],
    phase: "建立評估輸入",
    title: "建立跨活動測試樣本",
  },
  {
    description: "從同一份 AI run 建立模型或輪次 attempt，避免手動複製工作包。",
    handler: createAttempt,
    id: "attempt",
    inputs: ["tmp/ai-runs/<run-id>/"],
    next: ["把 attempt 目錄中的 ai-labeling-prompt.md 與工作包交給對應模型；direct attempt 輸出 metadata-proposals.json 與 visual-inspection-audit.json，大型 attempt 可先用 /tmp sharded 流程，之後由操作者執行 review。比較前確認各 attempt 的 prompt_template_sha256 一致。"],
    outputs: ["tmp/ai-runs/<attempt-id>/"],
    phase: "建立評估輸入",
    title: "建立模型 attempt",
  },
  {
    description: "驗證某個模型輸出的 proposals，產生 diff、update plan 與 review summary。",
    handler: reviewRun,
    id: "review",
    inputs: ["tmp/ai-runs/<run-id-or-attempt>/metadata-proposals.json"],
    next: ["看 summary / diff；需要視覺比較時產生 report，需要搜尋增益評估時跑 search。"],
    outputs: ["metadata-review-summary.md", "metadata-diff.md", "metadata-update-plan.*"],
    phase: "檢查輸出",
    title: "檢查模型輸出",
  },
  {
    description: "產生單次或多模型並排比較的 HTML 報表。",
    handler: buildReport,
    id: "report",
    inputs: ["tmp/ai-runs/<run-id-or-attempt>/"],
    next: ["閱讀報表後，必要時修 prompt、重跑 attempt 或執行 search 評估。"],
    outputs: ["tmp/ai-reports/<report-id>/"],
    phase: "檢查輸出",
    title: "產生評估報表",
  },
  {
    description: "比較 taxonomy-only 與 taxonomy + visual_description 的搜尋排序。",
    handler: runSearchEvaluation,
    id: "search",
    inputs: ["AI run / attempt，或 photos CSV"],
    next: ["若 description 有搜尋增益，把觀察寫回評估紀錄或調整 prompt。"],
    outputs: ["搜尋比較結果"],
    phase: "搜尋增益評估",
    title: "執行 visual_description 搜尋評估",
  },
  {
    description: "準備 AI prompt 多專家審查證據包，讓專家意見與 owner 決策可追溯。",
    handler: buildPromptReviewPackage,
    id: "prompt-review",
    inputs: ["AI run / attempt", "可選的搜尋查詢檔"],
    next: ["把 expert-prompts/ 交給專家或代理；收到 expert-reviews/ 後執行 pnpm eval:prompt-review -- --mode compile。"],
    outputs: ["tmp/prompt-reviews/<review-id>/"],
    phase: "決策包",
    title: "建立 prompt review 決策包",
  },
  {
    description: "檢查 AI proposal valid / invalid fixtures 是否仍符合 validator 邊界。",
    handler: validateFixtures,
    id: "fixtures",
    inputs: ["fixtures/ai-proposals/"],
    next: ["若失敗，先釐清是 validator 邊界改變還是 fixture 需要更新。"],
    outputs: ["fixture regression 結果"],
    phase: "回歸檢查",
    title: "檢查 AI fixtures",
  },
];

function printUsage() {
  console.log(`Usage:
  pnpm eval
  pnpm eval --task <task-id>

Options:
  --task <task-id>  Run an evaluation task directly. Use --list to see task ids.
  --list            List available evaluation tasks.
  --help, -h        Show this help.

This is the guided interface for model quality, prompt, taxonomy, and search
evaluation work. General photo intake and AI labeling workflows stay in
pnpm workflow.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    list: false,
    task: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--task") {
      options.task = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function taskById(id) {
  return tasks.find((task) => task.id === id);
}

function groupTasksByPhase() {
  const groups = new Map();
  for (const task of tasks) {
    if (!groups.has(task.phase)) {
      groups.set(task.phase, []);
    }
    groups.get(task.phase).push(task);
  }
  return groups;
}

function printTaskList() {
  console.log("Available evaluation tasks:");
  for (const [phase, phaseTasks] of groupTasksByPhase()) {
    console.log(`\n${phase}`);
    for (const task of phaseTasks) {
      console.log(`- ${task.id}: ${task.title}`);
    }
  }
}

function printMenu() {
  printEvalSummary();
  console.log("");
  console.log("SITCON Flickr Photo Finder evaluation workflow");
  console.log("");
  let index = 1;
  for (const [phase, phaseTasks] of groupTasksByPhase()) {
    console.log(`[${phase}]`);
    for (const task of phaseTasks) {
      console.log(`${index}. ${task.title}`);
      console.log(`   ${task.description}`);
      index += 1;
    }
    console.log("");
  }
  console.log("不知道從哪裡開始時，選 1 先看評估流程。");
  console.log("");
}

function printEvalSummary() {
  console.log("評估流程：");
  console.log("1. 一般照片整理與回寫走 pnpm workflow；模型品質、prompt、taxonomy 與搜尋增益評估走 pnpm eval。");
  console.log("2. eval:sample 建立跨活動測試樣本，避免只用單一相簿校準欄位。");
  console.log("3. eval:attempt 讓不同模型或輪次共用同一批輸入，並記錄 prompt_template_sha256，方便確認是否能公平比較。");
  console.log("4. 模型輸出仍用 ai:review 驗證，並可用 ai:report 產生單次或多模型報表；大型 run 可先用 /tmp sharded 流程，兩者都會提示 prompt 版本差異。");
  console.log("5. eval:search 用來檢查 visual_description 是否真的改善工作情境找圖。");
}

function printTaskContext(task) {
  console.log("");
  console.log(`階段：${task.phase}`);
  console.log(`任務：${task.title}`);
  console.log(task.description);
  printList("需要的輸入", task.inputs);
  printList("會產生或檢查", task.outputs);
  printList("完成後下一步", task.next);
}

function printList(title, values) {
  console.log(`${title}：`);
  for (const value of values) {
    console.log(`- ${value}`);
  }
}

let rl;

function currentReadline() {
  if (!rl) {
    rl = readline.createInterface({ input, output });
  }
  return rl;
}

function closeReadline() {
  if (rl) {
    rl.close();
    rl = undefined;
  }
}

async function ask(question, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  const answer = await currentReadline().question(`${question}${suffix}: `);
  const trimmed = answer.trim();
  return trimmed || defaultValue;
}

async function askYesNo(question, defaultValue = false) {
  const label = defaultValue ? "Y/n" : "y/N";
  const answer = (await currentReadline().question(`${question} [${label}]: `)).trim().toLowerCase();
  if (!answer) {
    return defaultValue;
  }
  return ["y", "yes"].includes(answer);
}

async function chooseTask() {
  if (!input.isTTY) {
    throw new Error("stdin is not interactive. Use --task <task-id> in non-interactive environments.");
  }

  printMenu();
  const answer = await ask("選擇任務編號");
  const choice = Number(answer);
  if (!Number.isInteger(choice) || choice < 1 || choice > tasks.length) {
    throw new Error(`Choice must be a number between 1 and ${tasks.length}`);
  }
  return tasks[choice - 1];
}

function runPnpm(script, args = [], options = {}) {
  const pnpmArgs = options.captureStdout ? ["--silent", script, ...args] : [script, ...args];
  const command = ["pnpm", ...pnpmArgs];
  console.log("");
  console.log(`$ ${command.join(" ")}`);
  const result = spawnSync("pnpm", pnpmArgs, {
    encoding: "utf8",
    stdio: options.captureStdout ? ["inherit", "pipe", "inherit"] : "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} failed`);
  }

  const stdout = result.stdout?.trim() ?? "";
  if (options.captureStdout && options.printCapturedStdout && stdout) {
    console.log(stdout);
  }
  return stdout;
}

function pnpmArgsFromOptions(options) {
  return options.length > 0 ? ["--", ...options] : [];
}

async function showEvalOverview() {
  printEvalSummary();
  console.log("");
  console.log("主要工作目錄：");
  console.log("- tmp/ai-samples/: eval:sample 產生的抽樣 CSV 與摘要，不 commit。");
  console.log("- tmp/ai-runs/: AI run 與 attempt 工作包，包含 photos.json、images/、metadata-proposals.json 與 visual-inspection-audit.json。");
  console.log("- tmp/ai-reports/: ai:report 產生的唯讀 HTML 報表，不 commit。");
  console.log("");
  console.log("常見起點：");
  console.log("- 要建立跨活動樣本：選「建立跨活動測試樣本」。");
  console.log("- 要把同一批照片交給不同模型：選「建立模型 attempt」。");
  console.log("- 模型跑完後：選「檢查模型輸出」。");
  console.log("- 要比較模型輸出：選「產生評估報表」。");
  console.log("- 要驗證 visual_description 搜尋價值：選「執行 visual_description 搜尋評估」。");
}

async function buildCrossActivitySample() {
  const runId = await ask("run id；留空自動產生");
  const imageSize = await ask("圖片尺寸", "large-1024");
  const plan = await ask("抽樣計畫路徑", "data/ai-cross-activity-sample-plan.json");
  const photos = await ask("既有 photos CSV；只用來重用 metadata", "fixtures/photos.csv");
  const noDownload = await askYesNo("不要下載圖片，只產生 metadata 工作包？", false);

  const options = ["--image-size", imageSize, "--plan", plan, "--photos", photos];
  if (runId) {
    options.push("--run-id", runId);
  }
  if (noDownload) {
    options.push("--no-download");
  }

  runPnpm("eval:sample", pnpmArgsFromOptions(options));
}

async function createAttempt() {
  if (!input.isTTY) {
    throw new Error("stdin is not interactive. Use pnpm eval:attempt -- --from <run-dir> --model <name> --round <number> in non-interactive environments.");
  }

  closeReadline();
  const from = await selectSingleAiRun({
    message: "選擇要建立 attempt 的來源 AI run / attempt",
    nonInteractiveHint: "Use pnpm eval:attempt -- --from <run-dir> --model <name> --round <number> in non-interactive environments.",
  });
  if (!from) {
    throw new Error("source run directory is required");
  }

  const model = await ask("模型或 provider 標籤，例如 claude、gpt、gemini");
  if (!model) {
    throw new Error("model label is required");
  }

  const round = await ask("第幾輪 attempt", "1");
  const label = await ask("可選短標籤，例如 cross-activity；可留空");
  const copyImages = await askYesNo("圖片用 copy，不用 symlink/hardlink？", false);

  const options = ["--from", from, "--model", model, "--round", round];
  if (label) {
    options.push("--label", label);
  }
  if (copyImages) {
    options.push("--copy-images");
  }

  runPnpm("eval:attempt", pnpmArgsFromOptions(options));
}

async function reviewRun() {
  const runDir = await ask("AI run / attempt 目錄，例如 tmp/ai-runs/RUN_ID");
  if (!runDir) {
    throw new Error("run directory is required");
  }

  runPnpm("ai:review", pnpmArgsFromOptions(["--run-dir", runDir]));

  if (await askYesNo("要接著產生單次 HTML report 嗎？", true)) {
    runPnpm("ai:report", pnpmArgsFromOptions(["--run", runDir]));
  }
}

async function buildReport() {
  if (!input.isTTY) {
    throw new Error("stdin is not interactive. Use pnpm ai:report -- --run <dir> or --runs <dir> <dir> in non-interactive environments.");
  }

  const compare = await askYesNo("要比較多個 run / attempt？", true);
  if (compare) {
    closeReadline();
    const runDirs = await selectMultipleAiRuns();
    if (runDirs.length < 2) {
      throw new Error("comparison report requires at least two run directories");
    }
    runPnpm("ai:report", pnpmArgsFromOptions(["--runs", ...runDirs]));
    return;
  }

  closeReadline();
  const runDir = await selectSingleAiRun();
  if (!runDir) {
    throw new Error("run directory is required");
  }
  runPnpm("ai:report", pnpmArgsFromOptions(["--run", runDir]));
}

async function runSearchEvaluation() {
  const runDir = await ask("AI run / attempt 目錄；若要只用 CSV 可留空");
  const photos = runDir ? "" : await ask("photos CSV 路徑；留空時使用 tmp/sheets-export/photos.csv 或 fixtures/photos.csv");
  const query = await ask("搜尋查詢；留空時使用內建工作情境查詢");
  const top = await ask("每種模式顯示幾筆結果", "5");

  const options = [];
  if (runDir) {
    options.push("--run-dir", runDir);
  }
  if (photos) {
    options.push("--photos", photos);
  }
  if (query) {
    options.push("--query", query);
  }
  if (top) {
    options.push("--top", top);
  }

  runPnpm("eval:search", pnpmArgsFromOptions(options));
}

async function buildPromptReviewPackage() {
  if (!input.isTTY) {
    throw new Error("stdin is not interactive. Use pnpm eval:prompt-review -- --mode prepare --runs <run-dir> [run-dir...] in non-interactive environments.");
  }

  const compare = await askYesNo("要選多個 run / attempt 作為審查證據？", true);
  closeReadline();
  const runDirs = compare
    ? await selectMultipleAiRuns()
    : [await selectSingleAiRun({
      message: "選擇要審查的 AI run / attempt",
      nonInteractiveHint: "Use pnpm eval:prompt-review -- --mode prepare --runs <run-dir> in non-interactive environments.",
    })];
  if (runDirs.some((runDir) => !runDir)) {
    throw new Error("run directory is required");
  }

  const outputDir = await ask("輸出目錄；留空自動產生");
  const queriesPath = await ask("可選搜尋查詢檔；留空不執行 eval:search");
  const options = ["--mode", "prepare", "--runs", ...runDirs];
  if (outputDir) {
    options.push("--output", outputDir);
  }
  if (queriesPath) {
    options.push("--queries", queriesPath);
  }

  runPnpm("eval:prompt-review", pnpmArgsFromOptions(options));
}

async function validateFixtures() {
  runPnpm("eval:validate-fixtures");
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }
  if (options.list) {
    printTaskList();
    return;
  }

  const task = options.task ? taskById(options.task) : await chooseTask();
  if (!task) {
    throw new Error(`Unknown task: ${options.task}`);
  }

  printTaskContext(task);
  await task.handler();
}

try {
  await main();
} catch (error) {
  console.error(`Evaluation workflow failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeReadline();
}
