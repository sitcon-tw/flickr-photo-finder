import {
  googleSheetsPracticeSpreadsheetId,
  googleSheetsSpreadsheetId,
} from "../lib/core/project-config.mjs";
import {
  createSheetsService,
  explainGoogleSheetsError,
  quoteSheetName,
  sheetsReadonlyScopes,
} from "../lib/sheets/google-sheets-client.mjs";
import {
  guideColumnCount,
  guideRows,
  guideSheetName,
  spreadsheetUrl,
  valuesFromGuideRows,
} from "../lib/sheets/sheets-guide.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm sheets:onboarding:check

Options:
  --spreadsheet-id <id>           Formal Google Sheets spreadsheet ID. Alias for --formal-spreadsheet-id.
  --formal-spreadsheet-id <id>    Formal Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --practice-spreadsheet-id <id>  Practice Google Sheets spreadsheet ID. Default: config/project.json googleSheets.practiceSpreadsheetId.
  --help, -h                      Show this help.

Authentication:
  This read-only check uses the official Google Sheets API SDK. The process
  environment must set GOOGLE_APPLICATION_CREDENTIALS to a service account
  credential with read access to both spreadsheets.

Purpose:
  Verifies that the formal "${guideSheetName}" tab links to the fixed practice
  spreadsheet, the practice "${guideSheetName}" tab links back to the formal
  spreadsheet, and the two configured spreadsheet IDs are not mixed.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    formalSpreadsheetId: googleSheetsSpreadsheetId,
    help: false,
    practiceSpreadsheetId: googleSheetsPracticeSpreadsheetId,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--spreadsheet-id" || arg === "--formal-spreadsheet-id") {
      options.formalSpreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--practice-spreadsheet-id") {
      options.practiceSpreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help && !options.formalSpreadsheetId) {
    throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --formal-spreadsheet-id");
  }
  if (!options.help && !options.practiceSpreadsheetId) {
    throw new Error(
      "Set googleSheets.practiceSpreadsheetId in config/project.json or pass --practice-spreadsheet-id",
    );
  }

  return options;
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

function flattenRows(rows) {
  return rows.flat().filter((value) => value !== "");
}

async function sheetExists(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title))",
  });
  return (response.data.sheets ?? []).some((sheet) => sheet.properties?.title === sheetName);
}

async function readGuideRows(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(guideSheetName)}!A:D`,
  });
  return normalizeRows(response.data.values ?? [], guideColumnCount);
}

function compareExpectedRows(actualRows, expectedRows) {
  const failures = [];
  expectedRows.forEach((expectedRow, rowIndex) => {
    const actualRow = actualRows[rowIndex] ?? [];
    expectedRow.forEach((expectedValue, columnIndex) => {
      if ((actualRow[columnIndex] ?? "") !== expectedValue) {
        failures.push(`R${rowIndex + 1}C${columnIndex + 1}`);
      }
    });
  });
  return failures;
}

function targetTitleMatches(rows, target) {
  const title = rows[0]?.[0] ?? "";
  return target === "practice" ? title.includes("練習用試算表") : title.includes("使用說明") && !title.includes("練習用");
}

async function checkTarget({ expectedLinkedSpreadsheetId, label, sheets, spreadsheetId, target }) {
  const results = [];
  const exists = await sheetExists(sheets, spreadsheetId, guideSheetName);
  if (!exists) {
    return [
      {
        ok: false,
        fix: `Run ${syncGuideCommand(target)} after confirming the target spreadsheet.`,
        label,
        message: `${guideSheetName} tab is missing`,
      },
    ];
  }

  const rows = await readGuideRows(sheets, spreadsheetId);
  const expectedValues = valuesFromGuideRows(
    guideRows({
      formalSpreadsheetId: target === "practice" ? expectedLinkedSpreadsheetId : spreadsheetId,
      practiceSpreadsheetId: target === "formal" ? expectedLinkedSpreadsheetId : spreadsheetId,
      target,
    }),
  );
  const expectedLink = spreadsheetUrl(expectedLinkedSpreadsheetId);
  const values = flattenRows(rows);
  const mismatches = compareExpectedRows(rows, expectedValues);

  results.push({
    ok: targetTitleMatches(rows, target),
    fix: `Run ${syncGuideCommand(target)} to rewrite the correct ${label} guide.`,
    label,
    message: `${guideSheetName} title matches ${target} target`,
  });
  results.push({
    ok: expectedLink ? values.includes(expectedLink) : false,
    fix:
      target === "practice"
        ? "Run pnpm sheets:sync-guide -- --target practice --write so the practice guide links back to the formal spreadsheet."
        : "Run pnpm sheets:sync-guide -- --write so the formal guide links to the fixed practice spreadsheet.",
    label,
    message: `${guideSheetName} contains expected linked spreadsheet URL`,
  });
  results.push({
    ok: mismatches.length === 0,
    fix: `Run ${syncGuideCommand(target)}, then rerun pnpm sheets:onboarding:check.`,
    label,
    message:
      mismatches.length === 0
        ? `${guideSheetName} values match repo-generated onboarding content`
        : `${guideSheetName} values differ from repo-generated content at ${mismatches.slice(0, 8).join(", ")}`,
  });

  return results;
}

function syncGuideCommand(target) {
  return target === "practice"
    ? "pnpm sheets:sync-guide -- --target practice --write"
    : "pnpm sheets:sync-guide -- --write";
}

function printResult(result) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.label}: ${result.message}`);
  if (!result.ok) {
    console.log(`  Fix: ${result.fix}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const results = [
    {
      ok: options.formalSpreadsheetId !== options.practiceSpreadsheetId,
      fix: "Set googleSheets.practiceSpreadsheetId to the fixed practice spreadsheet ID, not googleSheets.spreadsheetId.",
      label: "config",
      message: "practice spreadsheet ID is different from formal spreadsheet ID",
    },
  ];

  console.log(`Formal spreadsheet: ${options.formalSpreadsheetId}`);
  console.log(`Practice spreadsheet: ${options.practiceSpreadsheetId}`);

  if (options.formalSpreadsheetId === options.practiceSpreadsheetId) {
    results.forEach(printResult);
    console.log("Onboarding check failed. See docs/sheets-sync-workflow.md for the repair workflow.");
    process.exitCode = 1;
    return;
  }

  const sheets = await createSheetsService({ scopes: sheetsReadonlyScopes });
  results.push(
    ...(await checkTarget({
      expectedLinkedSpreadsheetId: options.practiceSpreadsheetId,
      label: "formal",
      sheets,
      spreadsheetId: options.formalSpreadsheetId,
      target: "formal",
    })),
    ...(await checkTarget({
      expectedLinkedSpreadsheetId: options.formalSpreadsheetId,
      label: "practice",
      sheets,
      spreadsheetId: options.practiceSpreadsheetId,
      target: "practice",
    })),
  );

  results.forEach(printResult);

  if (results.some((result) => !result.ok)) {
    console.log("Onboarding check failed. See docs/sheets-sync-workflow.md for the repair workflow.");
    process.exitCode = 1;
    return;
  }

  console.log("Sheets onboarding chain looks complete.");
}

try {
  await main();
} catch (error) {
  console.error(`Could not check Sheets onboarding: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
