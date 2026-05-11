import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "../lib/sheets/google-sheets-client.mjs";
import {
  flickrAlbumsUrl,
  googleSheetsPracticeSpreadsheetId,
  googleSheetsSpreadsheetId,
  repositoryUrl,
  projectConfig,
} from "../lib/core/project-config.mjs";

const guideSheetName = "使用說明";
const frontendUrl = projectConfig.frontend?.metadata?.siteUrl ?? "https://sitcon.org/flickr-photo-finder/";
const defaultColumnCount = 4;

function spreadsheetUrl(spreadsheetId) {
  return spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : "";
}

function printUsage() {
  console.log(`Usage:
  pnpm sheets:sync-guide

Options:
  --spreadsheet-id <id>  Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --target <name>        Guide target: formal or practice. Default: formal.
  --write                Apply changes. Without this flag the command only performs a dry-run.
  --help, -h             Show this help.

Authentication:
  This command uses the official Google Sheets API SDK. The process environment
  must set GOOGLE_APPLICATION_CREDENTIALS to a service account credential that
  has edit access to the target spreadsheet.

Purpose:
  The "${guideSheetName}" tab is a human onboarding tab. It is not a data source
  and should not be added to the fixed photos/albums/import_batches/taxonomy/
  sponsorship_items table contract.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    spreadsheetIdProvided: false,
    spreadsheetId: googleSheetsSpreadsheetId,
    target: "formal",
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--spreadsheet-id") {
      options.spreadsheetId = args[index + 1] ?? "";
      options.spreadsheetIdProvided = true;
      index += 1;
    } else if (arg === "--target") {
      options.target = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--write") {
      options.write = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.spreadsheetIdProvided && options.target === "practice") {
    options.spreadsheetId = googleSheetsPracticeSpreadsheetId;
  }

  if (!options.help && !options.spreadsheetId) {
    throw new Error(
      options.target === "practice"
        ? "Set googleSheets.practiceSpreadsheetId in config/project.json or pass --spreadsheet-id"
        : "Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id",
    );
  }
  if (!options.help && !["formal", "practice"].includes(options.target)) {
    throw new Error("--target must be formal or practice");
  }

  delete options.spreadsheetIdProvided;
  return options;
}

function row(kind, values) {
  return { kind, values: values.slice(0, defaultColumnCount) };
}

function blank() {
  return row("blank", ["", "", "", ""]);
}

function guideRows({ target }) {
  const practiceUrl = spreadsheetUrl(googleSheetsPracticeSpreadsheetId);
  const isPractice = target === "practice";
  return [
    row("title", [isPractice ? "SITCON Flickr Photo Finder 練習用試算表" : "SITCON Flickr Photo Finder 使用說明", "", "", ""]),
    row("body", [
      isPractice
        ? "這張試算表給整理者練習操作。可以試著選照片、開啟右側整理面板、修改欄位與儲存；內容會由維護者定期重置，不是正式照片索引。"
        : "這張分頁給第一次進入 Google Sheets 的整理者。先確認自己要找照片、整理正式資料，或只是先練習操作。",
      "",
      "",
      "",
    ]),
    blank(),
    row("section", ["先判斷你要做什麼", "", "", ""]),
    row("tableHeader", ["你想做的事", "從哪裡開始", "操作方式", "提醒"]),
    row("tableRow", ["找照片", "公開搜尋前端", frontendUrl, "只能讀取，不會改到照片索引。"]),
    row("tableRow", ["整理正式資料", isPractice ? "正式照片索引" : "photos 分頁", isPractice ? spreadsheetUrl(googleSheetsSpreadsheetId) : "選一列照片，再從上方「SITCON Photo Finder」選「開始整理照片」。", isPractice ? "練習熟悉後，再回正式表整理真正資料。" : "右側整理面板會顯示照片預覽與可編輯欄位。"]),
    row("tableRow", ["檢查資料", "SITCON Photo Finder 選單", "使用「檢查這張照片」、「檢查全部照片」或「檢查公開資料格式」。", "結果會寫到 validation_report。"]),
    isPractice
      ? row("tableRow", ["練習編輯", "這張試算表", "選一列照片，再從上方「SITCON Photo Finder」選「開始整理照片」。", "可以試填；資料可能被重置。"])
      : row("tableRow", ["練習編輯", "練習用試算表", practiceUrl || "請維護者先建立練習用試算表", practiceUrl ? "請先到練習表試填，不要在正式表測試操作。" : "練習表建立後，這裡會放固定連結。"]),
    blank(),
    row("section", ["常用分頁導覽", "", "", ""]),
    row("tableHeader", ["分頁", "中文說明", "是否正式資料", "給編輯者的提醒"]),
    row("tableRow", ["photos", "正式照片索引，每列是一張 Flickr 照片。", "是", "整理者主要編輯這張表。"]),
    row("tableRow", ["albums", "Flickr 相簿清單與處理狀態。", "是", "通常由工具更新。"]),
    row("tableRow", ["validation_report", "最近一次檢查結果。", "否", "用來看錯誤，不是照片資料。"]),
    row("tableRow", ["schema_meta", "目前資料規格與同步狀態。", "否", "用來確認工具版本。"]),
    row("tableRow", ["taxonomy", "受控字彙對照。", "輔助表", "看中文標籤，不要直接新增自創分類。"]),
    row("tableRow", ["sponsorship_items", "贊助品項參考。", "輔助表", "用於贊助成果與佐證照片。"]),
    row("tableRow", ["import_batches", "匯入批次紀錄。", "是", "通常由工具追加。"]),
    blank(),
    row("section", ["英文欄位怎麼看", "", "", ""]),
    row("body", ["欄位名稱保留英文是為了讓 repo 工具、CSV、Apps Script 與公開前端共用同一份資料契約。操作時請優先看右側整理面板與欄位提示。", "", "", ""]),
    row("tableHeader", ["常見欄位", "中文理解", "常見欄位", "中文理解"]),
    row("tableRow", ["photo_id", "照片編號", "recommended_uses", "建議用途"]),
    row("tableRow", ["scene_tags", "場景標籤", "curation_status", "整理狀態"]),
    row("tableRow", ["public_use_status", "使用提醒", "curation_notes", "公開整理備註"]),
    blank(),
    row("section", ["重要邊界", "", "", ""]),
    row("tableHeader", ["事項", "說明", "連結", "提醒"]),
    row("tableRow", ["照片來源", "照片仍在 Flickr；發布或交付素材前，請回 Flickr 原頁確認脈絡。", flickrAlbumsUrl, "這裡只是索引，不保存原圖。"]),
    row("tableRow", ["AI 初標", "AI 標註只是候選。", "", "ai_labeled 不等於 reviewed。"]),
    row("tableRow", ["公開欄位", "curation_notes 等欄位會進入公開索引。", "", "不要放敏感內部資訊。"]),
    row("tableRow", ["專案文件", "規則、工具與重建流程放在 GitHub。", repositoryUrl, "技術維護請從 README 與 docs/README.md 開始。"]),
  ];
}

function valuesFromRows(rows) {
  return rows.map((item) => {
    const values = [...item.values];
    while (values.length < defaultColumnCount) {
      values.push("");
    }
    return values;
  });
}

async function fetchSpreadsheet(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,index))",
  });
  return new Map(
    (response.data.sheets ?? []).map((sheet) => [
      sheet.properties.title,
      {
        index: sheet.properties.index,
        sheetId: sheet.properties.sheetId,
        title: sheet.properties.title,
      },
    ]),
  );
}

async function readGuideRows(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(guideSheetName)}!A:D`,
  });
  return response.data.values ?? [];
}

function printPlan({ currentRows, existingSheet, rows, write }) {
  console.log(`Mode: ${write ? "write" : "dry-run"}`);
  console.log(`Guide sheet: ${guideSheetName}`);
  console.log(`Target: ${targetLabel(rows)}`);
  console.log(`Action: ${existingSheet ? "update existing sheet" : "create sheet"}`);
  if (existingSheet) {
    console.log(`Current index: ${existingSheet.index}`);
    console.log(`Current non-empty rows in A:D: ${currentRows.length}`);
  }
  console.log(`Rows to write: ${rows.length}`);
  console.log("This guide tab is for humans; it is not a formal data table.");
}

function targetLabel(rows) {
  return rows[0]?.values?.[0]?.includes("練習用") ? "practice" : "formal";
}

async function createGuideSheet(sheets, spreadsheetId, rowCount) {
  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              gridProperties: {
                columnCount: defaultColumnCount,
                frozenRowCount: 0,
                rowCount,
              },
              index: 0,
              title: guideSheetName,
            },
          },
        },
      ],
    },
  });
  const sheetId = response.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId !== 0 && !sheetId) {
    throw new Error(`Could not create ${guideSheetName}`);
  }
  return sheetId;
}

function rowIndexes(rows, kind) {
  return rows
    .map((item, index) => (item.kind === kind ? index : -1))
    .filter((index) => index >= 0);
}

function repeatRowRequest(sheetId, rowIndex, cell) {
  return {
    repeatCell: {
      cell,
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
      range: {
        endColumnIndex: defaultColumnCount,
        endRowIndex: rowIndex + 1,
        sheetId,
        startColumnIndex: 0,
        startRowIndex: rowIndex,
      },
    },
  };
}

function buildFormatRequests(sheetId, rows) {
  const rowCount = rows.length + 8;
  const requests = [
    {
      updateSheetProperties: {
        fields: "index,gridProperties.rowCount,gridProperties.columnCount,gridProperties.frozenRowCount",
        properties: {
          gridProperties: {
            columnCount: defaultColumnCount,
            frozenRowCount: 0,
            rowCount,
          },
          index: 0,
          sheetId,
        },
      },
    },
    {
      updateDimensionProperties: {
        fields: "pixelSize",
        properties: { pixelSize: 170 },
        range: {
          dimension: "COLUMNS",
          endIndex: 1,
          sheetId,
          startIndex: 0,
        },
      },
    },
    {
      updateDimensionProperties: {
        fields: "pixelSize",
        properties: { pixelSize: 260 },
        range: {
          dimension: "COLUMNS",
          endIndex: 4,
          sheetId,
          startIndex: 1,
        },
      },
    },
    {
      repeatCell: {
        cell: {
          userEnteredFormat: {
            verticalAlignment: "TOP",
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(verticalAlignment,wrapStrategy)",
        range: {
          endColumnIndex: defaultColumnCount,
          endRowIndex: rows.length,
          sheetId,
          startColumnIndex: 0,
          startRowIndex: 0,
        },
      },
    },
  ];

  for (const index of [
    ...rowIndexes(rows, "title"),
    ...rowIndexes(rows, "body"),
    ...rowIndexes(rows, "section"),
  ]) {
    requests.push({
      mergeCells: {
        mergeType: "MERGE_ALL",
        range: {
          endColumnIndex: defaultColumnCount,
          endRowIndex: index + 1,
          sheetId,
          startColumnIndex: 0,
          startRowIndex: index,
        },
      },
    });
  }

  for (const index of rowIndexes(rows, "title")) {
    requests.push(
      repeatRowRequest(sheetId, index, {
        userEnteredFormat: {
          backgroundColor: { blue: 0.93, green: 0.96, red: 0.94 },
          textFormat: {
            bold: true,
            fontSize: 16,
            foregroundColor: { blue: 0.12, green: 0.12, red: 0.12 },
          },
          verticalAlignment: "MIDDLE",
          wrapStrategy: "OVERFLOW_CELL",
        },
      }),
    );
  }

  for (const index of rowIndexes(rows, "body")) {
    requests.push(
      repeatRowRequest(sheetId, index, {
        userEnteredFormat: {
          textFormat: {
            foregroundColor: { blue: 0.28, green: 0.28, red: 0.28 },
          },
          verticalAlignment: "TOP",
          wrapStrategy: "WRAP",
        },
      }),
    );
  }

  for (const index of rowIndexes(rows, "section")) {
    requests.push(
      repeatRowRequest(sheetId, index, {
        userEnteredFormat: {
          backgroundColor: { blue: 0.89, green: 0.93, red: 0.9 },
          textFormat: { bold: true },
          verticalAlignment: "MIDDLE",
          wrapStrategy: "OVERFLOW_CELL",
        },
      }),
    );
  }

  for (const index of rowIndexes(rows, "tableHeader")) {
    requests.push(
      repeatRowRequest(sheetId, index, {
        userEnteredFormat: {
          backgroundColor: { blue: 0.96, green: 0.96, red: 0.95 },
          textFormat: { bold: true },
          verticalAlignment: "MIDDLE",
          wrapStrategy: "WRAP",
        },
      }),
    );
  }

  return requests;
}

async function unmergeGuideSheet(sheets, spreadsheetId, sheetId, rowCount) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          unmergeCells: {
            range: {
              endColumnIndex: defaultColumnCount,
              endRowIndex: rowCount,
              sheetId,
              startColumnIndex: 0,
              startRowIndex: 0,
            },
          },
        },
      ],
    },
  });
}

async function clearGuideSheet(sheets, spreadsheetId) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${quoteSheetName(guideSheetName)}!A:Z`,
  });
}

async function writeGuideValues(sheets, spreadsheetId, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(guideSheetName)}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

async function formatGuideSheet(sheets, spreadsheetId, sheetId, rows) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: buildFormatRequests(sheetId, rows) },
  });
}

function normalizeRows(rows, expectedWidth) {
  return rows.map((row) => {
    const normalized = row.slice(0, expectedWidth);
    while (normalized.length < expectedWidth) {
      normalized.push("");
    }
    return normalized;
  });
}

async function verifyGuideSheet(sheets, spreadsheetId, expectedValues) {
  const rows = normalizeRows(await readGuideRows(sheets, spreadsheetId), defaultColumnCount);
  const actual = rows.slice(0, expectedValues.length);
  const failures = [];
  expectedValues.forEach((expectedRow, rowIndex) => {
    const actualRow = actual[rowIndex] ?? [];
    expectedRow.forEach((expectedValue, columnIndex) => {
      if ((actualRow[columnIndex] ?? "") !== expectedValue) {
        failures.push(`R${rowIndex + 1}C${columnIndex + 1}`);
      }
    });
  });
  if (failures.length > 0) {
    throw new Error(`guide write verification failed at ${failures.slice(0, 8).join(", ")}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const rows = guideRows({ target: options.target });
  const values = valuesFromRows(rows);
  const sheets = await createSheetsService();
  const spreadsheet = await fetchSpreadsheet(sheets, options.spreadsheetId);
  const existingSheet = spreadsheet.get(guideSheetName);
  const currentRows = existingSheet ? await readGuideRows(sheets, options.spreadsheetId) : [];

  console.log(`Spreadsheet: ${options.spreadsheetId}`);
  printPlan({ currentRows, existingSheet, rows, write: options.write });

  if (!options.write) {
    console.log("Dry-run only. Re-run with --write to apply these changes.");
    return;
  }

  const sheetId = existingSheet?.sheetId ?? (await createGuideSheet(sheets, options.spreadsheetId, rows.length + 8));
  await unmergeGuideSheet(sheets, options.spreadsheetId, sheetId, rows.length + 8);
  await clearGuideSheet(sheets, options.spreadsheetId);
  await writeGuideValues(sheets, options.spreadsheetId, values);
  await formatGuideSheet(sheets, options.spreadsheetId, sheetId, rows);
  await verifyGuideSheet(sheets, options.spreadsheetId, values);
  console.log(`${guideSheetName} updated and verified.`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not sync Sheets guide: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
