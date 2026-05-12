import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "../lib/sheets/google-sheets-client.mjs";
import { googleSheetsPracticeSpreadsheetId, googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import {
  guideColumnCount,
  guideRows,
  guideSheetName,
  targetLabelFromGuideRows,
  valuesFromGuideRows,
} from "../lib/sheets/sheets-guide.mjs";

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
  console.log(`Target: ${targetLabelFromGuideRows(rows)}`);
  console.log(`Action: ${existingSheet ? "update existing sheet" : "create sheet"}`);
  if (existingSheet) {
    console.log(`Current index: ${existingSheet.index}`);
    console.log(`Current non-empty rows in A:D: ${currentRows.length}`);
  }
  console.log(`Rows to write: ${rows.length}`);
  console.log("This guide tab is for humans; it is not a formal data table.");
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
                columnCount: guideColumnCount,
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
        endColumnIndex: guideColumnCount,
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
            columnCount: guideColumnCount,
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
          endColumnIndex: guideColumnCount,
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
          endColumnIndex: guideColumnCount,
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
              endColumnIndex: guideColumnCount,
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
  const rows = normalizeRows(await readGuideRows(sheets, spreadsheetId), guideColumnCount);
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
  const values = valuesFromGuideRows(rows);
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
