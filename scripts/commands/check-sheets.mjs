import { parseCsv } from "../lib/core/csv-utils.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { expectedSheetHeaders, fixedSheetNames } from "../lib/sheets/sheets-format.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm sheets:check

Options:
  --spreadsheet-id <id>  Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.

This command only reads public Google Sheets CSV exports. It does not write data.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    spreadsheetId: googleSheetsSpreadsheetId,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--spreadsheet-id") {
      options.spreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help && !options.spreadsheetId) {
    throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
  }

  return options;
}

function buildCsvExportUrl(spreadsheetId, sheetName) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", sheetName);
  return url;
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

async function fetchSheet(spreadsheetId, sheetName) {
  const response = await fetch(buildCsvExportUrl(spreadsheetId, sheetName));
  const text = await response.text();

  if (!response.ok) {
    return {
      dataRows: 0,
      headerMatches: false,
      status: "unavailable",
      detail: `${response.status} ${response.statusText}`,
    };
  }

  if (/^\s*</.test(text)) {
    return {
      dataRows: 0,
      headerMatches: false,
      status: "unavailable",
      detail: "response is not CSV",
    };
  }

  return classifyRows(parseCsv(text), expectedSheetHeaders[sheetName]);
}

function statusLabel(status) {
  const labels = {
    empty: "empty",
    has_data: "has data",
    header_mismatch: "header mismatch",
    header_only: "header only",
    unavailable: "unavailable",
  };
  return labels[status] ?? status;
}

function hasOverwriteRisk(result) {
  return result.status === "has_data" || result.status === "header_mismatch" || result.status === "unavailable";
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  console.log(`Checking Google Sheets spreadsheet ${options.spreadsheetId}`);
  const results = [];
  for (const sheetName of fixedSheetNames) {
    const result = await fetchSheet(options.spreadsheetId, sheetName);
    results.push({ sheetName, ...result });
    const detail = result.detail ? ` (${result.detail})` : "";
    console.log(`- ${sheetName}: ${statusLabel(result.status)}, ${result.dataRows} data row(s)${detail}`);
  }

  const riskySheets = results.filter(hasOverwriteRisk);
  if (riskySheets.length > 0) {
    console.log(
      `Initialization overwrite risk detected in: ${riskySheets.map((result) => result.sheetName).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("No initialization overwrite risk detected for fixed Sheets tabs.");
}

try {
  await main();
} catch (error) {
  console.error(`Could not check Google Sheets: ${error.message}`);
  process.exitCode = 1;
}
