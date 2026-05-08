import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "./google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "./project-config.mjs";
import { expectedSheetHeaders, fixedSheetNames } from "./sheets-format.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm sheets:migrate-headers

Options:
  --spreadsheet-id <id>  Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --sheets <names>       Comma-separated sheet names to migrate. Default: all fixed MVP tabs.
  --write                Apply header migrations. Without this flag the command only performs a dry-run.
  --help, -h             Show this help.

This command only handles additive header migrations. It can insert missing
columns into existing Sheets when the current header order is otherwise
compatible with the repo schema. It never deletes, renames, reorders, or
overwrites data columns.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    sheetNames: fixedSheetNames,
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
    } else if (arg === "--sheets") {
      options.sheetNames = (args[index + 1] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      index += 1;
    } else if (arg === "--write") {
      options.write = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
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

function headersMatch(actual, expected) {
  return actual.length === expected.length && expected.every((header, index) => actual[index] === header);
}

function getColumnLetter(columnIndex) {
  let value = columnIndex + 1;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

function findAdditiveHeaderMigration(currentHeaders, expectedHeaders) {
  const missing = [];
  let currentIndex = 0;

  for (let expectedIndex = 0; expectedIndex < expectedHeaders.length; expectedIndex += 1) {
    const expectedHeader = expectedHeaders[expectedIndex];
    if (currentHeaders[currentIndex] === expectedHeader) {
      currentIndex += 1;
      continue;
    }

    missing.push({
      columnIndex: expectedIndex,
      header: expectedHeader,
    });
  }

  if (currentIndex !== currentHeaders.length) {
    return {
      compatible: false,
      missing: [],
      reason: `unexpected or reordered header near "${currentHeaders[currentIndex] ?? ""}"`,
    };
  }

  return {
    compatible: true,
    missing,
    reason: "",
  };
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

async function readHeaderRow(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!1:1`,
  });

  return response.data.values?.[0] ?? [];
}

async function buildPlan(sheets, spreadsheetId, sheetNames) {
  const existingSheets = await fetchSpreadsheet(sheets, spreadsheetId);
  const plan = [];

  for (const sheetName of sheetNames) {
    const expectedHeaders = expectedSheetHeaders[sheetName];
    const existingSheet = existingSheets.get(sheetName);
    if (!existingSheet) {
      plan.push({
        action: "blocked",
        detail: "sheet is missing",
        expectedHeaders,
        missing: [],
        sheetId: null,
        sheetName,
      });
      continue;
    }

    const currentHeaders = await readHeaderRow(sheets, spreadsheetId, sheetName);
    if (currentHeaders.length === 0) {
      plan.push({
        action: "blocked",
        currentHeaders,
        detail: "header row is empty",
        expectedHeaders,
        missing: [],
        sheetId: existingSheet.sheetId,
        sheetName,
      });
      continue;
    }

    if (headersMatch(currentHeaders, expectedHeaders)) {
      plan.push({
        action: "noop",
        currentHeaders,
        detail: "header already matches",
        expectedHeaders,
        missing: [],
        sheetId: existingSheet.sheetId,
        sheetName,
      });
      continue;
    }

    const migration = findAdditiveHeaderMigration(currentHeaders, expectedHeaders);
    if (!migration.compatible) {
      plan.push({
        action: "blocked",
        currentHeaders,
        detail: migration.reason,
        expectedHeaders,
        missing: [],
        sheetId: existingSheet.sheetId,
        sheetName,
      });
      continue;
    }

    plan.push({
      action: migration.missing.length > 0 ? "insert_missing_headers" : "noop",
      currentHeaders,
      detail: migration.missing.length > 0 ? "" : "header already matches",
      expectedHeaders,
      missing: migration.missing,
      sheetId: existingSheet.sheetId,
      sheetName,
    });
  }

  return plan;
}

function printPlan(plan, { write }) {
  console.log(`Mode: ${write ? "write" : "dry-run"}`);
  for (const item of plan) {
    if (item.action === "insert_missing_headers") {
      const columns = item.missing
        .map((missing) => `${getColumnLetter(missing.columnIndex)}:${missing.header}`)
        .join(", ");
      console.log(`- ${item.sheetName}: insert ${item.missing.length} missing header(s): ${columns}`);
    } else {
      const detail = item.detail ? ` (${item.detail})` : "";
      console.log(`- ${item.sheetName}: ${item.action}${detail}`);
    }
  }
}

async function applyPlan(sheets, spreadsheetId, plan) {
  const insertRequests = [];
  const headerUpdates = [];

  for (const item of plan) {
    if (item.action !== "insert_missing_headers") {
      continue;
    }

    for (const missing of item.missing) {
      insertRequests.push({
        insertDimension: {
          range: {
            dimension: "COLUMNS",
            endIndex: missing.columnIndex + 1,
            sheetId: item.sheetId,
            startIndex: missing.columnIndex,
          },
        },
      });

      headerUpdates.push({
        range: `${quoteSheetName(item.sheetName)}!${getColumnLetter(missing.columnIndex)}1`,
        values: [[missing.header]],
      });
    }
  }

  if (insertRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: insertRequests,
      },
    });
  }

  if (headerUpdates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        data: headerUpdates,
        valueInputOption: "RAW",
      },
    });
  }
}

async function verifyPlan(sheets, spreadsheetId, plan) {
  const failures = [];

  for (const item of plan) {
    if (item.action !== "insert_missing_headers" && item.action !== "noop") {
      continue;
    }

    const headers = await readHeaderRow(sheets, spreadsheetId, item.sheetName);
    if (!headersMatch(headers, item.expectedHeaders)) {
      failures.push(item.sheetName);
    }
  }

  if (failures.length > 0) {
    throw new Error(`header migration verification failed for: ${failures.join(", ")}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const sheets = await createSheetsService();
  const plan = await buildPlan(sheets, options.spreadsheetId, options.sheetNames);
  const blocked = plan.filter((item) => item.action === "blocked");
  const changes = plan.filter((item) => item.action === "insert_missing_headers");

  console.log(`Spreadsheet: ${options.spreadsheetId}`);
  printPlan(plan, options);

  if (blocked.length > 0) {
    throw new Error(`refusing to migrate because incompatible headers were found in: ${blocked.map((item) => item.sheetName).join(", ")}`);
  }

  if (changes.length === 0) {
    console.log("No header migration needed.");
    return;
  }

  if (!options.write) {
    console.log("Dry-run only. Re-run with --write to apply these header migrations.");
    return;
  }

  await applyPlan(sheets, options.spreadsheetId, plan);
  await verifyPlan(sheets, options.spreadsheetId, plan);
  console.log("Sheet headers migrated and verified.");
}

try {
  await main();
} catch (error) {
  console.error(`Could not migrate Sheets headers: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
