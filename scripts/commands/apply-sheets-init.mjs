import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv } from "../lib/core/csv-utils.mjs";
import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "../lib/sheets/google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { expectedSheetHeaders, fixedSheetNames } from "../lib/sheets/sheets-format.mjs";

const defaultInputDir = "tmp/sheets-init";

function printUsage() {
  console.log(`Usage:
  pnpm sheets:apply-init

Options:
  --input-dir <path>      Directory containing sheets:init CSVs. Default: tmp/sheets-init.
  --spreadsheet-id <id>   Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --write                 Apply changes. Without this flag the command only performs a dry-run.
  --help, -h              Show this help.

Authentication:
  This command uses the official Google Sheets API SDK. The process environment
  must set GOOGLE_APPLICATION_CREDENTIALS to a service account credential that
  has edit access to the target spreadsheet.

Safety:
  The command refuses to write if any target tab already contains data or has a
  header that does not match data/photo-schema.json and sheets-format.mjs.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    inputDir: defaultInputDir,
    spreadsheetId: googleSheetsSpreadsheetId,
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--input-dir") {
      options.inputDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--spreadsheet-id") {
      options.spreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--write") {
      options.write = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.inputDir) {
      throw new Error("--input-dir requires a path");
    }
    if (!options.spreadsheetId) {
      throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
    }
  }

  return options;
}

function headersMatch(actual, expected) {
  return actual.length === expected.length && expected.every((header, index) => actual[index] === header);
}

function classifyRows(rows, expectedHeaders) {
  if (rows.length === 0) {
    return {
      dataRows: 0,
      headerMatches: false,
      status: "empty",
    };
  }

  const [headers, ...dataRows] = rows;
  const headerMatches = headersMatch(headers, expectedHeaders);
  if (!headerMatches) {
    return {
      dataRows: dataRows.length,
      headerMatches,
      status: "header_mismatch",
    };
  }

  return {
    dataRows: dataRows.length,
    headerMatches,
    status: dataRows.length === 0 ? "header_only" : "has_data",
  };
}

function statusLabel(status) {
  const labels = {
    empty: "empty",
    has_data: "has data",
    header_mismatch: "header mismatch",
    header_only: "header only",
    missing: "missing",
  };
  return labels[status] ?? status;
}

function hasOverwriteRisk(status) {
  return status === "has_data" || status === "header_mismatch";
}

async function readInputSheets(inputDir) {
  const sheets = [];
  for (const sheetName of fixedSheetNames) {
    const path = join(inputDir, `${sheetName}.csv`);
    const rows = parseCsv(await readFile(path, "utf8"));
    const expectedHeaders = expectedSheetHeaders[sheetName];

    if (rows.length === 0) {
      throw new Error(`${path} is empty`);
    }

    if (!headersMatch(rows[0], expectedHeaders)) {
      throw new Error(`${path} headers do not match expected ${sheetName} headers`);
    }

    sheets.push({
      dataRows: rows.length - 1,
      path,
      rows,
      sheetName,
    });
  }
  return sheets;
}

async function fetchSpreadsheet(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });

  return new Map(
    (response.data.sheets ?? []).map((sheet) => [
      sheet.properties.title,
      {
        sheetId: sheet.properties.sheetId,
        title: sheet.properties.title,
      },
    ]),
  );
}

async function readExistingRows(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:ZZ`,
  });
  return response.data.values ?? [];
}

async function buildPlan(sheets, spreadsheetId, inputSheets) {
  const existingSheets = await fetchSpreadsheet(sheets, spreadsheetId);
  const plan = [];

  for (const inputSheet of inputSheets) {
    const existingSheet = existingSheets.get(inputSheet.sheetName);
    if (!existingSheet) {
      plan.push({
        ...inputSheet,
        action: "create_and_write",
        existingDataRows: 0,
        existingStatus: "missing",
        sheetId: null,
      });
      continue;
    }

    const existingRows = await readExistingRows(sheets, spreadsheetId, inputSheet.sheetName);
    const existing = classifyRows(existingRows, expectedSheetHeaders[inputSheet.sheetName]);
    plan.push({
      ...inputSheet,
      action: hasOverwriteRisk(existing.status) ? "blocked" : "write",
      existingDataRows: existing.dataRows,
      existingStatus: existing.status,
      sheetId: existingSheet.sheetId,
    });
  }

  return plan;
}

function printPlan(plan, { write }) {
  console.log(`Mode: ${write ? "write" : "dry-run"}`);
  for (const item of plan) {
    const blocked = item.action === "blocked" ? " BLOCKED" : "";
    console.log(
      `- ${item.sheetName}: ${item.action}${blocked}; current=${statusLabel(item.existingStatus)}, current data rows=${item.existingDataRows}, input data rows=${item.dataRows}`,
    );
  }
}

async function createMissingSheets(sheets, spreadsheetId, plan) {
  const requests = plan
    .filter((item) => item.action === "create_and_write")
    .map((item) => ({
      addSheet: {
        properties: {
          title: item.sheetName,
        },
      },
    }));

  if (requests.length === 0) {
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function writeSheetValues(sheets, spreadsheetId, plan) {
  for (const item of plan) {
    if (item.action !== "create_and_write" && item.action !== "write") {
      continue;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheetName(item.sheetName)}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: item.rows,
      },
    });
  }
}

async function verifyWrittenSheets(sheets, spreadsheetId, inputSheets) {
  const failures = [];
  for (const inputSheet of inputSheets) {
    const rows = await readExistingRows(sheets, spreadsheetId, inputSheet.sheetName);
    if (rows.length !== inputSheet.rows.length || !headersMatch(rows[0] ?? [], inputSheet.rows[0])) {
      failures.push(inputSheet.sheetName);
    }
  }

  if (failures.length > 0) {
    throw new Error(`write verification failed for: ${failures.join(", ")}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const inputSheets = await readInputSheets(options.inputDir);
  const sheets = await createSheetsService();
  const plan = await buildPlan(sheets, options.spreadsheetId, inputSheets);
  const blocked = plan.filter((item) => item.action === "blocked");

  console.log(`Spreadsheet: ${options.spreadsheetId}`);
  console.log(`Input dir: ${options.inputDir}`);
  printPlan(plan, options);

  if (blocked.length > 0) {
    throw new Error(`refusing to write because overwrite risk was detected in: ${blocked.map((item) => item.sheetName).join(", ")}`);
  }

  if (!options.write) {
    console.log("Dry-run only. Re-run with --write to apply these changes.");
    return;
  }

  await createMissingSheets(sheets, options.spreadsheetId, plan);
  await writeSheetValues(sheets, options.spreadsheetId, plan);
  await verifyWrittenSheets(sheets, options.spreadsheetId, inputSheets);
  console.log("Sheets initialization data applied and verified.");
}

try {
  await main();
} catch (error) {
  console.error(`Could not apply Sheets initialization data: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
