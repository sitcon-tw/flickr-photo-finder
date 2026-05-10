import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "../lib/sheets/google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { photoHeaders } from "../lib/core/photo-schema.mjs";

const sheetName = "photos";
const testIdPrefix = "__apps_script_validation_test_";
const defaultRunId = "manual";
const testNote = "APP_SCRIPT_VALIDATION_SMOKE_TEST_DELETE_ME";

function printUsage() {
  console.log(`Usage:
  pnpm apps-script:smoke-test -- --append [--write]
  pnpm apps-script:smoke-test -- --check
  pnpm apps-script:smoke-test -- --delete [--write]

Options:
  --append               Append Apps Script validation smoke-test rows.
  --check                List existing smoke-test rows for the selected run.
  --delete               Delete smoke-test rows for the selected run.
  --run-id <id>          Stable identifier in generated photo_id values. Default: ${defaultRunId}.
  --all                  With --check or --delete, match all smoke-test rows regardless of run id.
  --spreadsheet-id <id>  Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --write                Apply append/delete. Without this flag those commands only perform a dry-run.
  --help, -h             Show this help.

This command writes deliberately invalid rows for manually testing the Sheet-bound
Apps Script validation menu. Rows are marked with ${testNote} and generated
photo_id values start with ${testIdPrefix}. The process environment must set
GOOGLE_APPLICATION_CREDENTIALS to a service account credential with edit access
to the target spreadsheet.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    action: "",
    all: false,
    help: false,
    runId: defaultRunId,
    spreadsheetId: googleSheetsSpreadsheetId,
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (["--append", "--check", "--delete"].includes(arg)) {
      if (options.action) {
        throw new Error("Choose only one action: --append, --check, or --delete");
      }
      options.action = arg.slice(2);
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--run-id") {
      options.runId = args[index + 1] ?? "";
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
    if (!options.action) {
      throw new Error("Choose an action: --append, --check, or --delete");
    }
    if (!options.spreadsheetId) {
      throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
    }
    if (!options.all && !/^[A-Za-z0-9_-]+$/.test(options.runId)) {
      throw new Error("--run-id may only contain letters, numbers, underscores, and hyphens");
    }
    if (options.action === "append" && options.all) {
      throw new Error("--append cannot be used with --all");
    }
  }

  return options;
}

function headersMatch(actual, expected) {
  return actual.length === expected.length && expected.every((header, index) => actual[index] === header);
}

function makePrefix({ all, runId }) {
  return all ? testIdPrefix : `${testIdPrefix}${runId}_`;
}

function makeTestId(runId, suffix) {
  return `${testIdPrefix}${runId}_${suffix}`;
}

function makeRow(runId, overrides) {
  const base = {
    photo_id: "",
    photo_url: "https://example.com/apps-script-validation-test-photo",
    album_ids: "apps-script-validation-test",
    image_preview_url: "https://example.com/apps-script-validation-test-image.jpg",
    album_title: "Apps Script validation smoke test",
    event_name: "SITCON",
    event_year: "2026",
    people_count: "1",
    subject_type: "people",
    photographer: "Validation Test Photographer",
    license: "CC BY 2.0",
    scene_tags: "合照;會眾",
    mood_tags: "熱鬧",
    recommended_uses: "社群貼文",
    sponsorship_items: "",
    sponsorship_tags: "",
    orientation: "landscape",
    has_negative_space: "false",
    safe_crop: "16:9",
    visual_description: "Apps Script validation smoke test row. Delete after testing.",
    public_use_status: "needs_review",
    priority_level: "normal",
    collections: "Apps Script validation smoke test",
    curation_notes: testNote,
    curation_status: "unreviewed",
  };
  const record = { ...base, ...overrides };
  return photoHeaders.map((field) => record[field] ?? "");
}

function buildSmokeTestRows(runId) {
  return [
    makeRow(runId, { photo_id: makeTestId(runId, "duplicate_list"), scene_tags: "合照;會眾;會眾" }),
    makeRow(runId, { photo_id: makeTestId(runId, "unknown_list_taxonomy"), scene_tags: "合照;不存在的標籤" }),
    makeRow(runId, { photo_id: makeTestId(runId, "bad_scalar_taxonomy"), orientation: "diagonal" }),
    makeRow(runId, { photo_id: makeTestId(runId, "bad_boolean"), has_negative_space: "maybe" }),
    makeRow(runId, { photo_id: makeTestId(runId, "bad_url"), photo_url: "abc" }),
    makeRow(runId, { photo_id: makeTestId(runId, "reviewed_missing_required"), curation_status: "reviewed", subject_type: "" }),
  ];
}

async function readPhotosRows(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:ZZ`,
  });
  const rows = response.data.values ?? [];
  if (rows.length === 0) {
    throw new Error(`${sheetName} is empty; expected a header row`);
  }
  const header = rows[0].slice(0, photoHeaders.length);
  if (!headersMatch(header, photoHeaders)) {
    throw new Error(`${sheetName} header does not match repo schema`);
  }
  return rows;
}

function findSmokeTestRows(rows, prefix) {
  return rows
    .map((row, index) => ({
      note: row[photoHeaders.indexOf("curation_notes")] ?? "",
      photoId: row[photoHeaders.indexOf("photo_id")] ?? "",
      rowNumber: index + 1,
    }))
    .filter((row) => row.rowNumber > 1)
    .filter((row) => String(row.photoId).startsWith(prefix));
}

async function appendRows(sheets, spreadsheetId, rows) {
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
  return response.data.updates?.updatedRange ?? "";
}

async function fetchSheetId(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const sheet = response.data.sheets?.find((item) => item.properties?.title === sheetName);
  if (!sheet?.properties || (sheet.properties.sheetId !== 0 && !sheet.properties.sheetId)) {
    throw new Error(`Could not find sheet ${sheetName}`);
  }
  return sheet.properties.sheetId;
}

async function deleteRows(sheets, spreadsheetId, rowNumbers) {
  const sheetId = await fetchSheetId(sheets, spreadsheetId);
  const requests = [...rowNumbers]
    .sort((left, right) => right - left)
    .map((rowNumber) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: "ROWS",
          startIndex: rowNumber - 1,
          endIndex: rowNumber,
        },
      },
    }));

  if (requests.length === 0) {
    return;
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

function printMatches(matches) {
  if (matches.length === 0) {
    console.log("Smoke-test rows: none");
    return;
  }
  console.log(`Smoke-test rows: ${matches.length}`);
  for (const match of matches) {
    console.log(`- row ${match.rowNumber}: ${match.photoId}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const sheets = await createSheetsService();
  const rows = await readPhotosRows(sheets, options.spreadsheetId);
  const prefix = makePrefix(options);
  const matches = findSmokeTestRows(rows, prefix);

  if (options.action === "check") {
    printMatches(matches);
    return;
  }

  if (options.action === "append") {
    if (matches.length > 0) {
      printMatches(matches);
      throw new Error(`Smoke-test rows for run "${options.runId}" already exist; delete them before appending new rows`);
    }

    const testRows = buildSmokeTestRows(options.runId);
    console.log(`Mode: ${options.write ? "write" : "dry-run"}`);
    console.log(`Action: append ${testRows.length} smoke-test rows`);
    console.log(`Run ID: ${options.runId}`);
    for (const row of testRows) {
      console.log(`- ${row[0]}`);
    }
    if (!options.write) {
      console.log("No changes written. Re-run with --write to append rows.");
      return;
    }
    const updatedRange = await appendRows(sheets, options.spreadsheetId, testRows);
    console.log(`Appended range: ${updatedRange}`);
    return;
  }

  if (options.action === "delete") {
    console.log(`Mode: ${options.write ? "write" : "dry-run"}`);
    console.log(`Action: delete smoke-test rows`);
    console.log(options.all ? "Scope: all smoke-test rows" : `Run ID: ${options.runId}`);
    printMatches(matches);
    if (!options.write) {
      console.log("No changes written. Re-run with --write to delete rows.");
      return;
    }
    await deleteRows(sheets, options.spreadsheetId, matches.map((match) => match.rowNumber));
    console.log(`Deleted rows: ${matches.map((match) => match.rowNumber).join(", ") || "none"}`);
  }
}

main().catch((error) => {
  console.error(`Apps Script smoke-test rows failed: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
});
