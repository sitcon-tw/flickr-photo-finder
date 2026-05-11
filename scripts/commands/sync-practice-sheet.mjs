import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv } from "../lib/core/csv-utils.mjs";
import {
  googleSheetsPracticeSpreadsheetId,
  googleSheetsSpreadsheetId,
} from "../lib/core/project-config.mjs";
import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "../lib/sheets/google-sheets-client.mjs";
import { expectedSheetHeaders, fixedSheetNames } from "../lib/sheets/sheets-format.mjs";

const defaultSourceDir = "tmp/sheets-export";
const defaultWorkDir = "tmp/sheets-practice";
const defaultLimit = 50;
const practiceTitle = "SITCON Flickr Photo Finder 練習用試算表";

function printUsage() {
  console.log(`Usage:
  pnpm sheets:practice:sync

Options:
  --source-dir <path>     Directory containing exported formal Sheets CSVs. Default: ${defaultSourceDir}.
  --work-dir <path>       Local generated practice CSV directory. Default: ${defaultWorkDir}.
  --limit <number>        Number of real photos to include. Default: ${defaultLimit}.
  --spreadsheet-id <id>   Practice Google Sheets spreadsheet ID. Default: config/project.json googleSheets.practiceSpreadsheetId.
  --create                Create a new practice spreadsheet. Requires --write and is used only when no spreadsheet ID is available.
  --write                 Apply changes. Without this flag the command only performs a dry-run.
  --help, -h              Show this help.

This command is for maintainers. It resets the configured practice spreadsheet
from exported formal Sheets rows, then syncs the human-facing guide tab for the
practice context. It refuses to target the formal spreadsheet.`);
}

function parsePositiveInteger(value, optionName) {
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw new Error(`${optionName} requires a positive integer`);
  }
  return Number(value);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    create: false,
    help: false,
    limit: defaultLimit,
    sourceDir: defaultSourceDir,
    spreadsheetId: googleSheetsPracticeSpreadsheetId,
    workDir: defaultWorkDir,
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--source-dir") {
      options.sourceDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--work-dir") {
      options.workDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--limit") {
      options.limit = parsePositiveInteger(args[index + 1] ?? "", "--limit");
      index += 1;
    } else if (arg === "--spreadsheet-id") {
      options.spreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--create") {
      options.create = true;
    } else if (arg === "--write") {
      options.write = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.sourceDir) {
      throw new Error("--source-dir requires a path");
    }
    if (!options.workDir) {
      throw new Error("--work-dir requires a path");
    }
    if (options.create && !options.write) {
      throw new Error("--create requires --write because it creates a remote Google Sheets file");
    }
    if (!options.spreadsheetId && !options.create) {
      throw new Error("Set googleSheets.practiceSpreadsheetId in config/project.json, pass --spreadsheet-id, or use --create --write");
    }
    if (options.spreadsheetId && googleSheetsSpreadsheetId && options.spreadsheetId === googleSheetsSpreadsheetId) {
      throw new Error("Refusing to target the formal spreadsheet as the practice spreadsheet");
    }
  }

  return options;
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: process.env,
    stdio: options.stdio ?? "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${process.execPath} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function headersMatch(actual, expected) {
  return actual.length === expected.length && expected.every((header, index) => actual[index] === header);
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

async function createPracticeSpreadsheet(sheets) {
  try {
    const response = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: practiceTitle,
        },
        sheets: [
          {
            properties: {
              title: "photos",
            },
          },
        ],
      },
    });
    const spreadsheetId = response.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error("Google Sheets API did not return a spreadsheetId");
    }
    return spreadsheetId;
  } catch (error) {
    throw new Error(
      [
        `Could not create the remote practice spreadsheet: ${explainGoogleSheetsError(error)}`,
        "Create a blank Google Sheet with a Drive-capable account, share it with the service account as Editor, then set googleSheets.practiceSpreadsheetId or pass --spreadsheet-id.",
      ].join(" "),
    );
  }
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

async function readRows(sheets, spreadsheetId, sheetName) {
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
    const existingRows = existingSheet ? await readRows(sheets, spreadsheetId, inputSheet.sheetName) : [];
    plan.push({
      ...inputSheet,
      action: existingSheet ? "replace" : "create_and_write",
      existingDataRows: Math.max(0, existingRows.length - 1),
      sheetId: existingSheet?.sheetId ?? null,
    });
  }
  return plan;
}

function printPlan(plan, { spreadsheetId, write }) {
  console.log(`Spreadsheet: ${spreadsheetId}`);
  console.log(`Mode: ${write ? "write" : "dry-run"}`);
  for (const item of plan) {
    console.log(
      `- ${item.sheetName}: ${item.action}; current data rows=${item.existingDataRows}, practice data rows=${item.dataRows}`,
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

async function clearAndWriteSheets(sheets, spreadsheetId, plan) {
  for (const item of plan) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${quoteSheetName(item.sheetName)}!A:ZZ`,
    });
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

async function verifySheets(sheets, spreadsheetId, inputSheets) {
  const failures = [];
  for (const inputSheet of inputSheets) {
    const rows = await readRows(sheets, spreadsheetId, inputSheet.sheetName);
    if (rows.length !== inputSheet.rows.length || !headersMatch(rows[0] ?? [], inputSheet.rows[0])) {
      failures.push(inputSheet.sheetName);
    }
  }
  if (failures.length > 0) {
    throw new Error(`practice spreadsheet verification failed for: ${failures.join(", ")}`);
  }
}

function buildPracticeCsvs(options) {
  runNode([
    "scripts/commands/build-practice-sheet.mjs",
    "--source-dir",
    options.sourceDir,
    "--output-dir",
    options.workDir,
    "--limit",
    String(options.limit),
  ]);
}

function syncPracticeGuide({ spreadsheetId, write }) {
  const args = [
    "scripts/commands/sync-sheets-guide.mjs",
    "--target",
    "practice",
    "--spreadsheet-id",
    spreadsheetId,
  ];
  if (write) {
    args.push("--write");
  }
  runNode(args);
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  buildPracticeCsvs(options);
  const inputSheets = await readInputSheets(options.workDir);
  const sheets = await createSheetsService({
    scopes: options.create
      ? [
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive.file",
        ]
      : undefined,
  });
  const spreadsheetId = options.spreadsheetId || (await createPracticeSpreadsheet(sheets));
  if (spreadsheetId === googleSheetsSpreadsheetId) {
    throw new Error("Refusing to target the formal spreadsheet as the practice spreadsheet");
  }
  const plan = await buildPlan(sheets, spreadsheetId, inputSheets);
  printPlan(plan, { spreadsheetId, write: options.write });

  if (!options.write) {
    console.log("Dry-run only. Re-run with --write to reset the practice spreadsheet.");
    return;
  }

  await createMissingSheets(sheets, spreadsheetId, plan);
  await clearAndWriteSheets(sheets, spreadsheetId, plan);
  await verifySheets(sheets, spreadsheetId, inputSheets);
  syncPracticeGuide({ spreadsheetId, write: true });
  console.log("Practice spreadsheet updated and verified.");
  if (!googleSheetsPracticeSpreadsheetId) {
    console.log(`Add this to config/project.json googleSheets.practiceSpreadsheetId: ${spreadsheetId}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`Could not sync practice spreadsheet: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
