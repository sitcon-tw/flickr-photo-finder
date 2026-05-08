import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const imageSizeOptions = ["large-1024", "medium-800", "medium-640", "preview", "original"];

const tasks = [
  {
    description: "先理解這個專案的資料流與目前可以操作的階段。",
    handler: showWorkflowOverview,
    id: "overview",
    inputs: ["無"],
    next: ["依你要做的事回到 workflow 選單，選擇檢查、相簿匯入、AI 初標或 Sheets 工具。"],
    outputs: ["流程說明"],
    phase: "理解流程",
    title: "了解完整資料流",
  },
  {
    description: "執行資料驗證與 AI proposal fixtures 回歸測試。",
    handler: runProjectChecks,
    id: "check",
    inputs: ["repo 內 schema、taxonomy、fixtures 與 AI proposal examples"],
    next: ["檢查通過後，可開始相簿匯入、AI 初標或前端開發。"],
    outputs: ["資料與 AI proposal 合約是否仍一致的檢查結果"],
    phase: "開始前檢查",
    title: "檢查專案資料與 AI fixtures",
  },
  {
    description: "匯出正式 Sheets、選擇相簿，並產生 intake run artifact。",
    handler: runAlbumIntake,
    id: "album-intake",
    inputs: ["正式 Google Sheets", "Google Sheets API 讀取權限", "Flickr 相簿清單"],
    next: ["檢查 intake run，確認後 dry-run 或寫回 Google Sheets。"],
    outputs: ["tmp/intake-runs/<run-id>/"],
    phase: "相簿匯入",
    title: "處理一本 Flickr 相簿",
  },
  {
    description: "驗證 intake run，並可選擇 dry-run 套用到 Sheets。",
    handler: reviewIntakeRun,
    id: "review-intake",
    inputs: ["tmp/intake-runs/<run-id>/", "Google Sheets API 讀取權限；若要寫入還需要編輯權限"],
    next: ["人工確認 dry-run 後，可用低階指令加上 --write 寫入；新增照片會回到 Google Sheets 進行整理。"],
    outputs: ["intake validation 結果", "可選的 Sheets dry-run 結果"],
    phase: "相簿匯入",
    title: "檢查或 dry-run intake run",
  },
  {
    description: "從正式 Sheets 的 albums 選相簿，再依 photos 建立 AI 初標工作目錄。",
    handler: prepareAiRun,
    id: "ai-prepare",
    inputs: ["正式 Google Sheets albums / photos", "Google Sheets API 讀取權限", "Flickr 圖片 URL"],
    next: ["把 tmp/ai-runs/<run-id>/ 交給模型，依 prompts/ai-labeling.md 產生 metadata-proposals.json。"],
    outputs: ["tmp/ai-runs/<run-id>/photos.json", "tmp/ai-runs/<run-id>/images/"],
    phase: "AI 初標",
    title: "準備 AI 初標工作包",
  },
  {
    description: "驗證 AI proposals，產生 diff、update plan 與檢視摘要。",
    handler: reviewAiRun,
    id: "ai-review",
    inputs: ["tmp/ai-runs/<run-id>/metadata-proposals.json"],
    next: ["人類看 metadata-review-summary.md、metadata-update-plan.csv 與 dry-run 結果後，再決定是否寫回 Sheets；正式 reviewed 仍在 Sheets 中完成。"],
    outputs: ["metadata-review-summary.md", "metadata-diff.md", "metadata-update-plan.json", "metadata-update-plan.csv", "可選的 Sheets dry-run 結果"],
    phase: "AI 初標",
    title: "檢查 AI 初標結果",
  },
  {
    description: "初始化、檢查、匯出或遷移 Google Sheets。",
    handler: runSheetsTools,
    id: "sheets",
    inputs: ["config/project.json", "正式 Google Sheets；部分操作需要 Google Sheets API credential"],
    next: ["初始化或遷移完成後，回到相簿匯入或 AI 初標流程。"],
    outputs: ["tmp/sheets-init/ 或 tmp/sheets-export/，或 Sheets dry-run 結果"],
    phase: "Google Sheets 維護",
    title: "Google Sheets 工具",
  },
  {
    description: "啟動本機搜尋 UI。",
    handler: runDevServer,
    id: "dev",
    inputs: ["fixtures/photos.csv 或前端設定指定的資料來源"],
    next: ["若要改成正式資料來源，請看 docs/public-frontend-architecture.md。"],
    outputs: ["http://localhost:4173/"],
    phase: "檢索與展示",
    title: "開啟本機搜尋 UI",
  },
  {
    description: "顯示低階 scripts 對照與文件入口。",
    handler: showAdvancedHelp,
    id: "help",
    inputs: ["無"],
    next: ["依任務改用低階指令，或回到 pnpm workflow。"],
    outputs: ["進階文件與指令提示"],
    phase: "進階操作",
    title: "查看進階指令入口",
  },
];

function printUsage() {
  console.log(`Usage:
  pnpm workflow
  pnpm workflow --task <task-id>

Options:
  --task <task-id>  Run a task directly. Use --list to see task ids.
  --list            List available tasks.
  --help, -h        Show this help.

This is the guided interface for common project workflows. Low-level pnpm
scripts remain available for automation and debugging.`);
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

function printTaskList() {
  console.log("Available workflow tasks:");
  for (const [phase, phaseTasks] of groupTasksByPhase()) {
    console.log(`\n${phase}`);
    for (const task of phaseTasks) {
      console.log(`- ${task.id}: ${task.title}`);
    }
  }
}

function printMenu() {
  printWorkflowSummary();
  console.log("");
  console.log("SITCON Flickr Photo Finder workflow");
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
  console.log("不知道從哪裡開始時，選 1 先看完整資料流。");
  console.log("");
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

function printWorkflowSummary() {
  console.log("主流程：");
  console.log("1. Google Sheets 是正式資料庫，repo 先把正式資料匯出成 tmp/sheets-export/ 工作快取。");
  console.log("2. 從 Flickr 相簿清單選一本相簿，產生 tmp/intake-runs/ 可審核匯入產物。");
  console.log("3. 人類確認 intake run 後，才 dry-run 或寫回 Google Sheets。");
  console.log("4. 從 Sheets photos 建立 tmp/ai-runs/，把圖片與 photos.json 交給模型初標。");
  console.log("5. 模型只輸出 metadata-proposals.json，工具驗證後產生 diff / update plan。");
  console.log("6. AI 候選值經人類確認後才寫回 Sheets；正式 reviewed 在 Sheets 中由志工協作完成。");
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

async function runDevServer() {
  console.log("啟動本機搜尋 UI。停止伺服器請按 Ctrl+C。");
  runPnpm("dev");
}

async function showWorkflowOverview() {
  printWorkflowSummary();
  console.log("");
  console.log("主要工作目錄：");
  console.log("- tmp/sheets-export/: 從正式 Google Sheets 匯出的本機工作快取，不 commit。");
  console.log("- tmp/intake-runs/: 單次相簿匯入的候選照片、相簿更新、批次紀錄與摘要。");
  console.log("- tmp/ai-runs/: AI 初標工作包，包含 photos.json、images/ 與 metadata-proposals.json。");
  console.log("");
  console.log("常見起點：");
  console.log("- 第一次接手：選「檢查專案資料與 AI fixtures」。");
  console.log("- 要匯入照片：選「處理一本 Flickr 相簿」。");
  console.log("- 要做 AI 初標：先選「準備 AI 初標工作包」，模型輸出後再選「檢查 AI 初標結果」。");
  console.log("- 要維護 Sheets：選「Google Sheets 工具」。");
}

async function runProjectChecks() {
  runPnpm("validate:data");
  runPnpm("ai:validate-fixtures");
}

async function runAlbumIntake() {
  if (await askYesNo("先從正式 Google Sheets 匯出最新工作快取？", true)) {
    runPnpm("sheets:export");
  }

  const unprocessedOnly = await askYesNo("只列出尚未處理的相簿？", true);
  const query = await ask("搜尋相簿關鍵字，可留空");
  const limit = await ask("顯示幾筆候選相簿", "20");

  const selectOptions = ["--format", "id", "--limit", limit];
  if (unprocessedOnly) {
    selectOptions.push("--unprocessed");
  }
  if (query) {
    selectOptions.push("--query", query);
  }

  closeReadline();
  const albumId = runPnpm("albums:select", pnpmArgsFromOptions(selectOptions), { captureStdout: true });
  if (!albumId) {
    throw new Error("No album id was selected.");
  }

  runPnpm("intake:run", pnpmArgsFromOptions(["--album", albumId]));
}

async function reviewIntakeRun() {
  const runDir = await ask("intake run 目錄，例如 tmp/intake-runs/RUN_ID");
  if (!runDir) {
    throw new Error("run directory is required");
  }

  runPnpm("intake:validate", pnpmArgsFromOptions(["--run-dir", runDir]));
  if (await askYesNo("要 dry-run 檢查套用到 Google Sheets 嗎？", false)) {
    runPnpm("sheets:apply-intake", pnpmArgsFromOptions(["--run-dir", runDir]));
  }
}

async function prepareAiRun() {
  if (await askYesNo("先從正式 Google Sheets 匯出最新工作快取？", true)) {
    runPnpm("sheets:export");
  }

  let albumId = "";
  if (await askYesNo("要以相簿為單位準備 AI 初標工作包？", true)) {
    const query = await ask("搜尋相簿關鍵字，可留空");
    const albumLimit = await ask("顯示幾筆候選相簿", "20");
    const selectOptions = ["--format", "id", "--limit", albumLimit];
    if (query) {
      selectOptions.push("--query", query);
    }

    closeReadline();
    albumId = runPnpm("albums:select", pnpmArgsFromOptions(selectOptions), { captureStdout: true });
    if (!albumId) {
      throw new Error("No album id was selected.");
    }
  } else {
    albumId = await ask("指定 album_id 篩選照片；可留空");
  }

  const limit = await ask("這次最多準備幾張照片給 AI 初標；輸入 all 代表不設上限", "50");
  const imageSize = await askImageSize();
  const status = await ask("curation_status 篩選；若要整本相簿所有狀態請輸入 all", "unreviewed");
  const photoIds = await ask("指定 photo_id，以逗號分隔；可留空");

  const options = ["--limit", limit, "--image-size", imageSize, "--status", status];
  if (albumId) {
    options.push("--album", albumId);
  }
  if (photoIds) {
    options.push("--photo-ids", photoIds);
  }

  const stdout = runPnpm("ai:prepare", pnpmArgsFromOptions(options), {
    captureStdout: true,
    printCapturedStdout: true,
  });
  const runDir = stdout.match(/AI run prepared:\s*(.+)/)?.[1]?.trim() ?? "tmp/ai-runs/<run-id>";

  console.log("");
  console.log("下一步：");
  console.log(`1. 複製下方 prompt 給模型或 agent，請它處理 ${runDir}/。`);
  console.log(`2. 模型輸出完成後執行：pnpm workflow -- --task ai-review，並填入 ${runDir}`);

  const prompt = renderAiLabelingPrompt(runDir);
  const promptPath = join(runDir, "ai-labeling-prompt.md");
  writeTextFile(promptPath, prompt);

  console.log("");
  console.log(`同一份 prompt 已寫入：${promptPath}`);
  console.log("");
  console.log("----- COPY PROMPT START -----");
  console.log(prompt);
  console.log("----- COPY PROMPT END -----");
}

function writeTextFile(path, text) {
  try {
    writeFileSync(path, text);
  } catch (error) {
    console.error(`Could not write ${path}: ${error.message}`);
  }
}

function renderAiLabelingPrompt(runDir) {
  const basePrompt = readFileSync("prompts/ai-labeling.md", "utf8").trim();

  return `# 本次 AI 初標工作包

請使用下列本次工作路徑，並依照後方 prompt 範本執行。

- AI run 目錄：\`${runDir}\`
- manifest：\`${runDir}/manifest.json\`
- photos：\`${runDir}/photos.json\`
- images：\`${runDir}/images/\`
- 輸出檔：\`${runDir}/metadata-proposals.json\`

完成後請執行：

\`\`\`bash
pnpm ai:review -- --run-dir ${runDir}
\`\`\`

---

${basePrompt}
`;
}

async function askImageSize() {
  console.log("可選圖片尺寸：");
  imageSizeOptions.forEach((value, index) => {
    console.log(`${index + 1}. ${value}`);
  });
  const answer = await ask("選擇圖片尺寸編號或直接輸入尺寸", "1");
  const choice = Number(answer);
  if (Number.isInteger(choice) && choice >= 1 && choice <= imageSizeOptions.length) {
    return imageSizeOptions[choice - 1];
  }
  if (imageSizeOptions.includes(answer)) {
    return answer;
  }
  throw new Error(`image size must be one of: ${imageSizeOptions.join(", ")}`);
}

async function reviewAiRun() {
  const runDir = await ask("AI run 目錄，例如 tmp/ai-runs/RUN_ID");
  if (!runDir) {
    throw new Error("run directory is required");
  }

  runPnpm("ai:review", pnpmArgsFromOptions(["--run-dir", runDir]));

  if (await askYesNo("要 dry-run 檢查 AI 更新會寫入哪些 Sheets cells 嗎？", false)) {
    runPnpm("sheets:apply-ai-updates", pnpmArgsFromOptions(["--run-dir", runDir]));
  }
}

async function runSheetsTools() {
  const choices = [
    ["sheets:init", "產生初始化 CSV，不連線"],
    ["sheets:check", "檢查公開 Sheets 初始化覆蓋風險"],
    ["sheets:apply-init", "dry-run 套用初始化 CSV"],
    ["sheets:migrate-headers", "dry-run 安全 header 遷移"],
    ["sheets:export", "匯出正式 Sheets 工作快取"],
  ];

  choices.forEach(([script, description], index) => {
    console.log(`${index + 1}. ${script} - ${description}`);
  });
  const answer = await ask("選擇 Sheets 工具編號");
  const choice = Number(answer);
  if (!Number.isInteger(choice) || choice < 1 || choice > choices.length) {
    throw new Error(`Choice must be a number between 1 and ${choices.length}`);
  }

  runPnpm(choices[choice - 1][0]);
}

async function showAdvancedHelp() {
  console.log("建議入口：");
  console.log("- pnpm workflow");
  console.log("- README.md 的「你可能想做的事」");
  console.log("- docs/README.md 的「目前狀態」與「依角色閱讀」");
  console.log("");
  console.log("常用低階指令仍保留給自動化與除錯：");
  printTaskList();
  console.log("");
  console.log("若要列出 package scripts，可用：");
  console.log("pnpm run");
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
  console.error(`Workflow failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeReadline();
}
