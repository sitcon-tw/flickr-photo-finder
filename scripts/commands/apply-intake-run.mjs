import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv } from "../lib/core/csv-utils.mjs";
import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "../lib/sheets/google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders } from "../lib/core/photo-schema.mjs";

const outputFiles = {
  photos: "photos-to-append.csv",
  albums: "albums-updated.csv",
  importBatch: "import-batch.csv",
  summary: "summary.json",
};

function printUsage() {
  console.log(`Usage:
  pnpm sheets:apply-intake -- --run-dir <path>

Options:
  --run-dir <path>       Intake run artifact directory.
  --spreadsheet-id <id>  Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --write                Apply changes. Without this flag the command only performs a dry-run.
  --help, -h             Show this help.

This command appends new photos, updates albums.last_processed_at for the
selected album, and appends one import_batches row. It refuses to write if
target headers do not match the repo schema or duplicate photo_id / batch_id
values are detected. The process environment must set
GOOGLE_APPLICATION_CREDENTIALS to a service account credential with access to
the target spreadsheet.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    runDir: "",
    spreadsheetId: googleSheetsSpreadsheetId,
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--run-dir") {
      options.runDir = args[index + 1] ?? "";
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
    if (!options.runDir) {
      throw new Error("--run-dir requires a path");
    }
    if (!options.spreadsheetId) {
      throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
    }
  }

  return options;
}

function validateRunDir(runDir) {
  const result = spawnSync(process.execPath, ["scripts/commands/validate-intake-run.mjs", "--run-dir", runDir], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("intake run validation failed");
  }
}

function headersMatch(actual, expected) {
  return actual.length === expected.length && expected.every((header, index) => actual[index] === header);
}

async function readCsvData(path, expectedHeaders) {
  const rows = parseCsv(await readFile(path, "utf8"));
  if (rows.length === 0) {
    throw new Error(`${path} is empty`);
  }
  if (!headersMatch(rows[0], expectedHeaders)) {
    throw new Error(`${path} headers do not match expected schema`);
  }
  return rows.slice(1);
}

function toRecord(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

async function readRunArtifacts(runDir) {
  validateRunDir(runDir);

  const paths = {
    photos: join(runDir, outputFiles.photos),
    albums: join(runDir, outputFiles.albums),
    importBatch: join(runDir, outputFiles.importBatch),
    summary: join(runDir, outputFiles.summary),
  };

  const [photoRows, albumRows, importBatchRows, summaryText] = await Promise.all([
    readCsvData(paths.photos, photoHeaders),
    readCsvData(paths.albums, albumHeaders),
    readCsvData(paths.importBatch, importBatchHeaders),
    readFile(paths.summary, "utf8"),
  ]);

  const summary = JSON.parse(summaryText);
  if (importBatchRows.length !== 1) {
    throw new Error(`${paths.importBatch} should contain exactly one data row`);
  }

  const updatedAlbumRow = albumRows.find((row) => toRecord(albumHeaders, row).album_id === summary.album_id);
  if (!updatedAlbumRow) {
    throw new Error(`${paths.albums} does not contain album_id ${summary.album_id}`);
  }

  return {
    albumRecord: toRecord(albumHeaders, updatedAlbumRow),
    importBatchRow: importBatchRows[0],
    importBatchRecord: toRecord(importBatchHeaders, importBatchRows[0]),
    paths,
    photoRows,
    summary,
  };
}

async function readSheetRows(sheets, spreadsheetId, sheetName, expectedHeaders) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:ZZ`,
  });
  const rows = response.data.values ?? [];
  if (rows.length === 0) {
    throw new Error(`${sheetName} is empty; expected a header row`);
  }
  if (!headersMatch(rows[0], expectedHeaders)) {
    throw new Error(`${sheetName} header does not match repo schema`);
  }
  return rows;
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

function findRowById(rows, headers, idHeader, idValue) {
  const index = headers.indexOf(idHeader);
  if (index < 0) {
    throw new Error(`Missing ${idHeader} header`);
  }

  const rowIndex = rows.slice(1).findIndex((row) => (row[index] ?? "") === idValue);
  return rowIndex < 0 ? -1 : rowIndex + 2;
}

function collectColumnValues(rows, headers, headerName) {
  const index = headers.indexOf(headerName);
  if (index < 0) {
    throw new Error(`Missing ${headerName} header`);
  }
  return new Set(rows.slice(1).map((row) => row[index] ?? "").filter(Boolean));
}

async function buildPlan(sheets, spreadsheetId, artifacts) {
  const [photosRows, albumsRows, importBatchRows] = await Promise.all([
    readSheetRows(sheets, spreadsheetId, "photos", photoHeaders),
    readSheetRows(sheets, spreadsheetId, "albums", albumHeaders),
    readSheetRows(sheets, spreadsheetId, "import_batches", importBatchHeaders),
  ]);

  const existingPhotoIds = collectColumnValues(photosRows, photoHeaders, "photo_id");
  const duplicatePhotoIds = artifacts.photoRows
    .map((row) => toRecord(photoHeaders, row).photo_id)
    .filter((photoId) => existingPhotoIds.has(photoId));

  const existingBatchIds = collectColumnValues(importBatchRows, importBatchHeaders, "batch_id");
  const duplicateBatchId = existingBatchIds.has(artifacts.importBatchRecord.batch_id);

  const albumRowNumber = findRowById(albumsRows, albumHeaders, "album_id", artifacts.summary.album_id);
  const lastProcessedColumn = albumHeaders.indexOf("last_processed_at");
  if (lastProcessedColumn < 0) {
    throw new Error("albums schema is missing last_processed_at");
  }

  const blockers = [];
  if (duplicatePhotoIds.length > 0) {
    blockers.push(`duplicate photo_id: ${[...new Set(duplicatePhotoIds)].join(", ")}`);
  }
  if (duplicateBatchId) {
    blockers.push(`duplicate batch_id: ${artifacts.importBatchRecord.batch_id}`);
  }
  if (albumRowNumber < 0) {
    blockers.push(`album_id ${artifacts.summary.album_id} not found in albums`);
  }

  return {
    albumLastProcessedAt: artifacts.albumRecord.last_processed_at,
    albumLastProcessedRange:
      albumRowNumber > 0
        ? `${quoteSheetName("albums")}!${getColumnLetter(lastProcessedColumn)}${albumRowNumber}`
        : "",
    albumRowNumber,
    blockers,
    importBatchRowsToAppend: [artifacts.importBatchRow],
    newPhotoRowsToAppend: artifacts.photoRows,
    summary: artifacts.summary,
  };
}

function printPlan(plan, { write }) {
  console.log(`Mode: ${write ? "write" : "dry-run"}`);
  console.log(`Run: ${plan.summary.run_id}`);
  console.log(`Album: ${plan.summary.album_id} (${plan.summary.album_title ?? ""})`);
  console.log(`- append photos: ${plan.newPhotoRowsToAppend.length}`);
  console.log(`- update albums.last_processed_at: ${plan.albumLastProcessedAt || "(empty)"} at ${plan.albumLastProcessedRange || "not found"}`);
  console.log(`- append import_batches: ${plan.importBatchRowsToAppend.length}`);
  if (plan.blockers.length > 0) {
    console.log(`Blocked: ${plan.blockers.join("; ")}`);
  }
}

async function appendRows(sheets, spreadsheetId, sheetName, rows) {
  if (rows.length === 0) {
    return;
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows,
    },
  });
}

async function updateAlbumLastProcessedAt(sheets, spreadsheetId, plan) {
  if (!plan.albumLastProcessedRange) {
    return;
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: plan.albumLastProcessedRange,
    valueInputOption: "RAW",
    requestBody: {
      values: [[plan.albumLastProcessedAt]],
    },
  });
}

async function verifyApplied(sheets, spreadsheetId, artifacts) {
  const [photosRows, albumsRows, importBatchRows] = await Promise.all([
    readSheetRows(sheets, spreadsheetId, "photos", photoHeaders),
    readSheetRows(sheets, spreadsheetId, "albums", albumHeaders),
    readSheetRows(sheets, spreadsheetId, "import_batches", importBatchHeaders),
  ]);

  const photoIds = collectColumnValues(photosRows, photoHeaders, "photo_id");
  const missingPhotoIds = artifacts.photoRows
    .map((row) => toRecord(photoHeaders, row).photo_id)
    .filter((photoId) => !photoIds.has(photoId));
  if (missingPhotoIds.length > 0) {
    throw new Error(`write verification failed; missing photo_id: ${missingPhotoIds.join(", ")}`);
  }

  const batchIds = collectColumnValues(importBatchRows, importBatchHeaders, "batch_id");
  if (!batchIds.has(artifacts.importBatchRecord.batch_id)) {
    throw new Error(`write verification failed; missing batch_id ${artifacts.importBatchRecord.batch_id}`);
  }

  const albumRowNumber = findRowById(albumsRows, albumHeaders, "album_id", artifacts.summary.album_id);
  const lastProcessedColumn = albumHeaders.indexOf("last_processed_at");
  const albumRow = albumsRows[albumRowNumber - 1] ?? [];
  if ((albumRow[lastProcessedColumn] ?? "") !== artifacts.albumRecord.last_processed_at) {
    throw new Error(`write verification failed; albums.last_processed_at was not updated`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const artifacts = await readRunArtifacts(options.runDir);
  const sheets = await createSheetsService();
  const plan = await buildPlan(sheets, options.spreadsheetId, artifacts);

  console.log(`Spreadsheet: ${options.spreadsheetId}`);
  console.log(`Run dir: ${options.runDir}`);
  printPlan(plan, options);

  if (plan.blockers.length > 0) {
    throw new Error(`refusing to write: ${plan.blockers.join("; ")}`);
  }

  if (!options.write) {
    console.log("Dry-run only. Re-run with --write to apply these changes.");
    return;
  }

  await appendRows(sheets, options.spreadsheetId, "photos", plan.newPhotoRowsToAppend);
  await updateAlbumLastProcessedAt(sheets, options.spreadsheetId, plan);
  await appendRows(sheets, options.spreadsheetId, "import_batches", plan.importBatchRowsToAppend);
  await verifyApplied(sheets, options.spreadsheetId, artifacts);
  console.log("Intake run applied and verified.");
}

try {
  await main();
} catch (error) {
  console.error(`Could not apply intake run: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
