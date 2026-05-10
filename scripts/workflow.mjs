import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { writeAiLabelingPrompt } from "./ai-labeling-prompt.mjs";

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
    description: "匯出正式 Sheets 工作快取、選擇相簿，產生 intake run artifact，並可直接接續檢查與 dry-run。",
    handler: runAlbumIntake,
    id: "album-intake",
    inputs: ["正式 Google Sheets", "匯出正式資料時需要 GOOGLE_APPLICATION_CREDENTIALS 與讀取權限", "Flickr 相簿清單"],
    next: ["通常可直接接著檢查 intake run 並 dry-run；若要人工細看，也可保留 run artifact 稍後再套用。"],
    outputs: ["tmp/intake-runs/<run-id>/", "可選的 intake validation 與 Sheets dry-run 結果"],
    phase: "相簿匯入",
    title: "處理一本 Flickr 相簿",
  },
  {
    description: "驗證 intake run，dry-run 檢查套用內容，並可選擇寫入 Sheets。",
    handler: reviewIntakeRun,
    id: "review-intake",
    inputs: ["tmp/intake-runs/<run-id>/", "dry-run 或寫入 Sheets 時需要 GOOGLE_APPLICATION_CREDENTIALS；寫入還需要編輯權限"],
    next: ["寫入成功後，新增照片會回到 Google Sheets 進行整理；若未寫入，可保留 run artifact 稍後再套用。"],
    outputs: ["intake validation 結果", "Sheets dry-run 結果", "可選的 Sheets 寫入與驗證結果"],
    phase: "相簿匯入",
    title: "檢查或套用 intake run",
  },
  {
    description: "從正式 Sheets 的 albums 選相簿，再依 photos 建立 AI 初標工作目錄。",
    handler: prepareAiRun,
    id: "ai-prepare",
    inputs: ["正式 Google Sheets albums / photos", "匯出正式資料時需要 GOOGLE_APPLICATION_CREDENTIALS 與讀取權限", "Flickr 圖片 URL"],
    next: ["把 run 目錄中的 ai-labeling-prompt.md 與工作包交給模型；模型只輸出 metadata-proposals.json。若要做多模型或多輪品質比較，直接使用 eval:attempt。"],
    outputs: ["tmp/ai-runs/<run-id>/photos.json", "tmp/ai-runs/<run-id>/images/"],
    phase: "AI 初標",
    title: "準備 AI 初標工作包",
  },
  {
    description: "驗證 AI proposals，產生 diff、update plan 與檢視摘要。",
    handler: reviewAiRun,
    id: "ai-review",
    inputs: ["tmp/ai-runs/<run-id>/metadata-proposals.json"],
    next: ["人類看 metadata-review-summary.md、metadata-update-plan.csv、AI report 與 dry-run 結果後，再決定是否寫回 Sheets；正式 reviewed 仍在 Sheets 中完成。"],
    outputs: ["metadata-review-summary.md", "metadata-diff.md", "metadata-update-plan.json", "metadata-update-plan.csv", "可選的 Sheets dry-run 結果"],
    phase: "AI 初標",
    title: "檢查 AI 初標結果",
  },
  {
    description: "產生單次檢視或多 run/attempt 比較用的唯讀 HTML 報表。",
    handler: buildAiReport,
    id: "ai-report",
    inputs: ["tmp/ai-runs/<run-id-or-attempt>/"],
    next: ["閱讀報表後，必要時直接執行 eval:search 或 Sheets dry-run。"],
    outputs: ["tmp/ai-reports/<report-id>/"],
    phase: "AI 初標",
    title: "產生 AI report",
  },
  {
    description: "初始化、檢查、匯出或遷移 Google Sheets。",
    handler: runSheetsTools,
    id: "sheets",
    inputs: ["config/project.json", "正式 Google Sheets；部分操作需要 GOOGLE_APPLICATION_CREDENTIALS"],
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
    description: "產生並檢查 GitHub Pages artifact，部署版會讀公開 Google Sheets photos CSV。",
    handler: buildPagesArtifact,
    id: "pages-build",
    inputs: ["config/project.json", "app/", "data/photo-schema.json", "data/tag-taxonomy.json"],
    next: ["檢查 tmp/pages/，或由 GitHub Actions workflow 上傳並部署 artifact。"],
    outputs: ["tmp/pages/", "Pages artifact check 結果"],
    phase: "檢索與展示",
    title: "建立並檢查 GitHub Pages artifact",
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
  console.log("1. Google Sheets 是正式資料庫；多數寫入前流程會先把正式資料匯出成 tmp/sheets-export/ 工作快取。");
  console.log("2. 從 Flickr 相簿清單選一本相簿，產生 tmp/intake-runs/ 可審核匯入產物。");
  console.log("3. workflow 會記住剛產生的 intake run，通常可直接接續驗證與 Sheets dry-run。");
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

function parseIntakeRunDir(stdout) {
  const directMatch = stdout.match(/Intake run directory:\s*(.+)/);
  if (directMatch?.[1]) {
    return directMatch[1].trim();
  }

  const summaryMatch = stdout.match(/Wrote intake run summary to\s+(.+?summary\.json)\./);
  if (summaryMatch?.[1]) {
    return dirname(summaryMatch[1].trim());
  }

  return "";
}

async function runDevServer() {
  console.log("啟動本機搜尋 UI。停止伺服器請按 Ctrl+C。");
  runPnpm("dev");
}

async function buildPagesArtifact() {
  runPnpm("pages:build");
  runPnpm("pages:check");
  console.log("");
  console.log("下一步：");
  console.log("- 本機檢查 tmp/pages/ 內容。");
  console.log("- push 到 master 或手動觸發 pages workflow，讓 GitHub Actions 部署正式 Pages。");
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
  console.log("- 要做 AI 初標：先選「準備 AI 初標工作包」。");
  console.log("- 要驗收 AI 結果：選「檢查 AI 初標結果」，再用 report 或 Sheets dry-run 輔助判斷。");
  console.log("- 要比較模型品質：直接使用 eval:sample、eval:attempt 或 eval:search；這些不是一般 workflow 主線。");
  console.log("- 要部署公開檢索：選「建立 GitHub Pages artifact」。");
  console.log("- 要維護 Sheets：選「Google Sheets 工具」。");
}

async function runProjectChecks() {
  runPnpm("validate:data");
  runPnpm("eval:validate-fixtures");
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

  const stdout = runPnpm("intake:run", pnpmArgsFromOptions(["--album", albumId]), {
    captureStdout: true,
    printCapturedStdout: true,
  });
  const runDir = parseIntakeRunDir(stdout);

  if (!runDir) {
    console.log("");
    console.log("下一步：");
    console.log("無法從輸出判斷 intake run 目錄，請看上方 `Intake run directory:` 或 `summary.json` 路徑後手動執行：");
    console.log("pnpm workflow -- --task review-intake");
    return;
  }

  console.log("");
  console.log(`已建立 intake run：${runDir}`);
  if (await askYesNo("直接檢查這次 intake run 並 dry-run 套用到 Google Sheets？", true)) {
    await reviewIntakeRun(runDir, { albumId });
  } else {
    console.log("");
    console.log("已保留 intake run，尚未檢查或 dry-run。");
    console.log(`稍後可執行：pnpm workflow -- --task review-intake，並填入 ${runDir}`);
  }
}

async function readIntakeRunAlbumId(runDir) {
  try {
    const summary = JSON.parse(await readFile(join(runDir, "summary.json"), "utf8"));
    return String(summary.album_id ?? "").trim();
  } catch {
    return "";
  }
}

async function reviewIntakeRun(initialRunDir = "", context = {}) {
  const runDir = initialRunDir || (await ask("intake run 目錄，例如 tmp/intake-runs/RUN_ID"));
  if (!runDir) {
    throw new Error("run directory is required");
  }
  const albumId = context.albumId || await readIntakeRunAlbumId(runDir);

  if (initialRunDir) {
    console.log("");
    console.log(`檢查 intake run：${runDir}`);
  }

  runPnpm("intake:validate", pnpmArgsFromOptions(["--run-dir", runDir]));

  if (!(await askYesNo("要 dry-run 檢查套用到 Google Sheets 嗎？", true))) {
    console.log("");
    console.log("已完成 intake validation，尚未檢查或寫入 Google Sheets。");
    console.log(`稍後可執行：pnpm sheets:apply-intake -- --run-dir ${runDir}`);
    await askContinueToAiPrepare({ albumId, wroteSheets: false });
    return;
  }

  runPnpm("sheets:apply-intake", pnpmArgsFromOptions(["--run-dir", runDir]));

  let wroteSheets = false;
  if (await askYesNo("dry-run 結果確認無誤，要寫入 Google Sheets 嗎？", false)) {
    runPnpm("sheets:apply-intake", pnpmArgsFromOptions(["--run-dir", runDir, "--write"]));
    wroteSheets = true;
  } else {
    console.log("");
    console.log("未寫入 Google Sheets。");
    console.log(`確認後可執行：pnpm sheets:apply-intake -- --run-dir ${runDir} --write`);
  }

  await askContinueToAiPrepare({ albumId, wroteSheets });
}

async function askContinueToAiPrepare({ albumId, wroteSheets }) {
  console.log("");
  if (!wroteSheets) {
    console.log("提醒：尚未寫入 Sheets 時，AI 初標工作包不會包含這次 intake run 的新增照片。");
  }
  if (await askYesNo("要接著準備 AI 初標工作包嗎？", wroteSheets)) {
    await prepareAiRun({ albumId });
    return;
  }

  console.log("");
  console.log("已停止在 intake 流程。");
  console.log("稍後可執行：pnpm workflow -- --task ai-prepare");
}

async function prepareAiRun(context = {}) {
  if (await askYesNo("先從正式 Google Sheets 匯出最新工作快取？", true)) {
    runPnpm("sheets:export");
  }

  let albumId = context.albumId ?? "";
  if (albumId) {
    console.log("");
    console.log(`沿用剛才的相簿：${albumId}`);
  } else if (await askYesNo("要以相簿為單位準備 AI 初標工作包？", true)) {
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
  console.log(`1. 複製下方 prompt 給模型或 agent，請它只在 ${runDir}/ 輸出 metadata-proposals.json。`);
  console.log(`2. 模型輸出完成後，由操作者執行：pnpm workflow -- --task ai-review，並填入 ${runDir}`);

  const { prompt, promptPath } = writeAiLabelingPrompt(runDir);

  console.log("");
  console.log(`同一份 prompt 已寫入：${promptPath}`);
  console.log("");
  console.log("----- COPY PROMPT START -----");
  console.log(prompt);
  console.log("----- COPY PROMPT END -----");
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

  if (await askYesNo("要產生 AI HTML report 嗎？", true)) {
    runPnpm("ai:report", pnpmArgsFromOptions(["--run", runDir]));
  }
}

async function buildAiReport() {
  const compare = await askYesNo("要比較多個 run / attempt？", false);
  if (compare) {
    const runDirs = (await ask("輸入要比較的 run / attempt 目錄，以空白分隔"))
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (runDirs.length < 2) {
      throw new Error("comparison report requires at least two run directories");
    }
    runPnpm("ai:report", pnpmArgsFromOptions(["--runs", ...runDirs]));
    return;
  }

  const runDir = await ask("AI run / attempt 目錄，例如 tmp/ai-runs/RUN_ID");
  if (!runDir) {
    throw new Error("run directory is required");
  }
  runPnpm("ai:report", pnpmArgsFromOptions(["--run", runDir]));
}

async function runSheetsTools() {
  const choices = [
    ["sheets:init", "產生初始化 CSV，不連線"],
    ["sheets:check", "檢查公開 Sheets 初始化覆蓋風險"],
    ["sheets:apply-init", "dry-run 套用初始化 CSV"],
    ["sheets:migrate-headers", "dry-run 安全 header 遷移"],
    ["sheets:export", "匯出正式 Sheets 工作快取"],
    ["apps-script:build-config", "從 schema 與 taxonomy 產生 Apps Script 設定"],
    ["apps-script:status", "檢查 Apps Script 本機綁定與遠端差異"],
    ["apps-script:push", "重建設定、驗證資料並推送 Apps Script"],
    ["apps-script:deployments", "列出 Apps Script deployments"],
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
