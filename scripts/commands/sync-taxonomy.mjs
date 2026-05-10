import { readFile } from "node:fs/promises";
import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "../lib/sheets/google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { taxonomyHeaders } from "../lib/sheets/sheets-format.mjs";
import { headersMatch, normalizeSheetRow, readSheetRows } from "../lib/sheets/sheets-records.mjs";
import { taxonomySheetValues } from "../lib/sheets/taxonomy-sheet.mjs";

const taxonomyPath = "data/tag-taxonomy.json";
const taxonomySheetName = "taxonomy";
const legacyTaxonomyHeaders = ["taxonomy_key", "value", "order"];

function printUsage() {
  console.log(`Usage:
  pnpm sheets:sync-taxonomy

Options:
  --spreadsheet-id <id>  Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --write                Rewrite the taxonomy tab. Without this flag the command only performs a dry-run.
  --help, -h             Show this help.

This command rewrites the taxonomy helper tab from data/tag-taxonomy.json. It
does not read values from the tab as source data. The process environment must
set GOOGLE_APPLICATION_CREDENTIALS to a service account credential with edit
access to the target spreadsheet.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    spreadsheetId: googleSheetsSpreadsheetId,
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--spreadsheet-id") {
      options.spreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--write") {
      options.write = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help && !options.spreadsheetId) {
    throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
  }

  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
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

function countBlankLabels(rows) {
  const [headers, ...dataRows] = rows;
  if (!headers) {
    return 0;
  }
  const labelIndex = headers.indexOf("label_zh");
  if (labelIndex < 0) {
    return dataRows.length;
  }
  return dataRows.filter((row) => !String(row[labelIndex] ?? "").trim()).length;
}

function classifyExistingRows(rows, sheetExists) {
  if (!sheetExists) {
    return {
      status: "missing",
      writable: true,
      reason: "",
    };
  }
  if (rows.length === 0) {
    return {
      status: "empty",
      writable: true,
      reason: "",
    };
  }

  const headers = rows[0].filter((value) => String(value ?? "").trim() !== "");
  if (headersMatch(headers, taxonomyHeaders)) {
    return {
      status: "current_header",
      writable: true,
      reason: "",
    };
  }
  if (headersMatch(headers, legacyTaxonomyHeaders)) {
    return {
      status: "legacy_header",
      writable: true,
      reason: "",
    };
  }

  return {
    status: "blocked",
    writable: false,
    reason: `unexpected header: ${headers.join(",") || "(empty)"}`,
  };
}

async function createMissingSheet(sheets, spreadsheetId, existingSheets) {
  if (existingSheets.has(taxonomySheetName)) {
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: taxonomySheetName,
            },
          },
        },
      ],
    },
  });
}

async function writeTaxonomySheet(sheets, spreadsheetId, values) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${quoteSheetName(taxonomySheetName)}!A:ZZ`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetName(taxonomySheetName)}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values,
    },
  });
}

async function verifyTaxonomySheet(sheets, spreadsheetId, expectedValues) {
  const rows = await readSheetRows(sheets, spreadsheetId, taxonomySheetName);
  const headers = normalizeSheetRow(rows[0] ?? [], taxonomyHeaders.length);
  const blankLabelCount = countBlankLabels(rows);
  if (!headersMatch(headers, taxonomyHeaders)) {
    throw new Error(`${taxonomySheetName} write verification failed: header does not match repo schema`);
  }
  if (rows.length !== expectedValues.length) {
    throw new Error(`${taxonomySheetName} write verification failed: expected ${expectedValues.length - 1} rows but found ${rows.length - 1}`);
  }
  if (blankLabelCount > 0) {
    throw new Error(`${taxonomySheetName} write verification failed: ${blankLabelCount} label_zh value(s) are blank`);
  }
}

function printPlan({ classification, currentBlankLabels, currentDataRows, expectedDataRows, write }) {
  console.log(`Mode: ${write ? "write" : "dry-run"}`);
  console.log(`- ${taxonomySheetName}: ${classification.writable ? "rewrite" : "blocked"}; current=${classification.status}; current data rows=${currentDataRows}; current blank label_zh=${currentBlankLabels}; repo rows=${expectedDataRows}`);
  if (classification.reason) {
    console.log(`  ${classification.reason}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const taxonomy = await readJson(taxonomyPath);
  const expectedValues = taxonomySheetValues(taxonomy);
  const sheets = await createSheetsService();
  const existingSheets = await fetchSpreadsheet(sheets, options.spreadsheetId);
  const sheetExists = existingSheets.has(taxonomySheetName);
  const existingRows = sheetExists ? await readSheetRows(sheets, options.spreadsheetId, taxonomySheetName) : [];
  const classification = classifyExistingRows(existingRows, sheetExists);

  console.log(`Spreadsheet: ${options.spreadsheetId}`);
  printPlan({
    classification,
    currentBlankLabels: countBlankLabels(existingRows),
    currentDataRows: Math.max(existingRows.length - 1, 0),
    expectedDataRows: expectedValues.length - 1,
    write: options.write,
  });

  if (!classification.writable) {
    throw new Error(`refusing to rewrite ${taxonomySheetName} because its header is not recognized`);
  }

  if (!options.write) {
    console.log("Dry-run only. Re-run with --write to rewrite the taxonomy tab.");
    return;
  }

  await createMissingSheet(sheets, options.spreadsheetId, existingSheets);
  await writeTaxonomySheet(sheets, options.spreadsheetId, expectedValues);
  await verifyTaxonomySheet(sheets, options.spreadsheetId, expectedValues);
  console.log(`Wrote ${expectedValues.length - 1} taxonomy row(s) to ${taxonomySheetName}.`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not sync taxonomy sheet: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
