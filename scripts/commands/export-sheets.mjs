import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { csvEscape } from "../lib/core/csv-utils.mjs";
import { createSheetsService, explainGoogleSheetsError } from "../lib/sheets/google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { expectedSheetHeaders, fixedSheetNames } from "../lib/sheets/sheets-format.mjs";
import { headersMatch, normalizeSheetRow, readSheetRows } from "../lib/sheets/sheets-records.mjs";

const defaultOutputDir = "tmp/sheets-export";

function printUsage() {
  console.log(`Usage:
  pnpm sheets:export

Options:
  --output-dir <path>     Directory for exported CSV files. Default: tmp/sheets-export.
  --spreadsheet-id <id>   Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --sheets <names>        Comma-separated sheet names to export. Default: all fixed Sheets tabs.
  --help, -h              Show this help.

This command uses the official Google Sheets API SDK. The process environment
must set GOOGLE_APPLICATION_CREDENTIALS to a service account credential with
read access to the target spreadsheet. It only reads Google Sheets and writes
local CSV files.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    outputDir: defaultOutputDir,
    sheetNames: fixedSheetNames,
    spreadsheetId: googleSheetsSpreadsheetId,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--output-dir") {
      options.outputDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--spreadsheet-id") {
      options.spreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--sheets") {
      options.sheetNames = (args[index + 1] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.outputDir) {
      throw new Error("--output-dir requires a path");
    }
    if (!options.spreadsheetId) {
      throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
    }
    if (options.sheetNames.length === 0) {
      throw new Error("--sheets requires at least one sheet name");
    }
    for (const sheetName of options.sheetNames) {
      if (!fixedSheetNames.includes(sheetName)) {
        throw new Error(`Unknown fixed sheet name: ${sheetName}`);
      }
    }
  }

  return options;
}

function rowsToCsv(rows, expectedHeaders) {
  const normalizedRows = rows.map((row) => normalizeSheetRow(row, expectedHeaders.length));
  return `${normalizedRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

async function exportSheet({ outputDir, sheetName, sheets, spreadsheetId }) {
  const expectedHeaders = expectedSheetHeaders[sheetName];
  const rows = await readSheetRows(sheets, spreadsheetId, sheetName);
  if (rows.length === 0) {
    throw new Error(`${sheetName} is empty; expected a header row`);
  }

  const headers = normalizeSheetRow(rows[0], expectedHeaders.length);
  if (!headersMatch(headers, expectedHeaders)) {
    throw new Error(`${sheetName} header does not match repo schema`);
  }

  const path = join(outputDir, `${sheetName}.csv`);
  await writeFile(path, rowsToCsv(rows, expectedHeaders));
  return {
    dataRows: rows.length - 1,
    path,
    sheetName,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  await mkdir(options.outputDir, { recursive: true });
  const sheets = await createSheetsService();

  console.log(`Spreadsheet: ${options.spreadsheetId}`);
  console.log(`Output dir: ${options.outputDir}`);

  for (const sheetName of options.sheetNames) {
    const result = await exportSheet({
      outputDir: options.outputDir,
      sheetName,
      sheets,
      spreadsheetId: options.spreadsheetId,
    });
    console.log(`- ${result.sheetName}: wrote ${result.dataRows} data row(s) to ${result.path}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`Could not export Google Sheets data: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
