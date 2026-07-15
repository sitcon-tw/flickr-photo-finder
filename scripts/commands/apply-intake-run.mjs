import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsv } from "../lib/core/csv-utils.mjs";
import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "../lib/sheets/google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders } from "../lib/core/photo-schema.mjs";
import { photoStateSha256 } from "../lib/flickr/photo-reconciliation.mjs";
import { validateIntakeRun } from "./validate-intake-run.mjs";

const outputFiles = {
  photos: "photos-to-append.csv",
  albums: "albums-updated.csv",
  importBatch: "import-batch.csv",
  reconciliation: "reconciliation.json",
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

This command applies reviewed photo membership, ordering, additions and
deletions, updates albums, and appends import_batches rows. It refuses to
write if the target changed since the run or headers do not match the repo
schema. The process environment must set
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
  await validateIntakeRun(runDir);

  const paths = {
    photos: join(runDir, outputFiles.photos),
    albums: join(runDir, outputFiles.albums),
    importBatch: join(runDir, outputFiles.importBatch),
    reconciliation: join(runDir, outputFiles.reconciliation),
    summary: join(runDir, outputFiles.summary),
  };

  const [photoRows, albumRows, importBatchRows, reconciliationText, summaryText] = await Promise.all([
    readCsvData(paths.photos, photoHeaders),
    readCsvData(paths.albums, albumHeaders),
    readCsvData(paths.importBatch, importBatchHeaders),
    readFile(paths.reconciliation, "utf8"),
    readFile(paths.summary, "utf8"),
  ]);

  const summary = JSON.parse(summaryText);
  const reconciliation = JSON.parse(reconciliationText);
  const scannedAlbumIds = new Set(reconciliation.album_photos.map((inventory) => inventory.album_id));
  const albumRecords = albumRows
    .map((row) => toRecord(albumHeaders, row))
    .filter((album) => scannedAlbumIds.has(album.album_id));

  return {
    albumRecords,
    albumRows,
    importBatchRows,
    importBatchRecords: importBatchRows.map((row) => toRecord(importBatchHeaders, row)),
    paths,
    photoRows,
    reconciliation,
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

export async function buildPlan(sheets, spreadsheetId, artifacts) {
  const [photosRows, albumsRows, importBatchRows] = await Promise.all([
    readSheetRows(sheets, spreadsheetId, "photos", photoHeaders),
    readSheetRows(sheets, spreadsheetId, "albums", albumHeaders),
    readSheetRows(sheets, spreadsheetId, "import_batches", importBatchHeaders),
  ]);

  const photoRecords = photosRows.slice(1).map((row) => toRecord(photoHeaders, row));
  const currentPhotoIds = photoRecords.map((photo) => photo.photo_id);
  const existingPhotoIds = new Set(currentPhotoIds);
  const newPhotoIds = artifacts.photoRows.map((row) => toRecord(photoHeaders, row).photo_id);
  const deletedPhotoIds = new Set(artifacts.reconciliation.deleted_photo_ids);
  const desiredPhotoIds = artifacts.reconciliation.desired_photo_ids;
  const existingBatchIds = collectColumnValues(importBatchRows, importBatchHeaders, "batch_id");
  const duplicateBatchIds = artifacts.importBatchRecords
    .map((batch) => batch.batch_id)
    .filter((batchId) => existingBatchIds.has(batchId));
  const currentAlbumIds = albumsRows.slice(1).map((row) => toRecord(albumHeaders, row).album_id);
  const artifactAlbumIds = artifacts.albumRows.map((row) => toRecord(albumHeaders, row).album_id);
  const currentAlbumIdSet = new Set(currentAlbumIds);
  const newAlbumRecords = artifacts.albumRecords.filter((album) => !currentAlbumIdSet.has(album.album_id));
  const desiredAlbumIdSet = new Set([...currentAlbumIds, ...newAlbumRecords.map((album) => album.album_id)]);
  const desiredAlbumIds = artifactAlbumIds.filter((albumId) => desiredAlbumIdSet.has(albumId));

  const blockers = [];
  if (photoStateSha256(photoRecords) !== artifacts.reconciliation.source_state_sha256) {
    blockers.push("photos photo_id / album_ids state changed since this intake run; regenerate it");
  }
  const duplicatePhotoIds = newPhotoIds.filter((photoId) => existingPhotoIds.has(photoId));
  if (duplicatePhotoIds.length > 0) {
    blockers.push(`duplicate photo_id: ${duplicatePhotoIds.join(", ")}`);
  }
  if (duplicateBatchIds.length > 0) {
    blockers.push(`duplicate batch_id: ${duplicateBatchIds.join(", ")}`);
  }
  const expectedPhotoIds = [
    ...currentPhotoIds.filter((photoId) => !deletedPhotoIds.has(photoId)),
    ...newPhotoIds,
  ];
  const desiredPhotoIdSet = new Set(desiredPhotoIds);
  if (
    desiredPhotoIdSet.size !== desiredPhotoIds.length
    || desiredPhotoIds.length !== expectedPhotoIds.length
    || expectedPhotoIds.some((photoId) => !desiredPhotoIdSet.has(photoId))
  ) {
    blockers.push("reconciliation desired photo IDs do not match current rows plus additions and deletions");
  }
  if (desiredAlbumIds.length !== desiredAlbumIdSet.size) {
    blockers.push("albums catalog changed since this intake run; regenerate it");
  }

  const albumUpdates = artifacts.albumRecords
    .filter((album) => currentAlbumIdSet.has(album.album_id))
    .map((album) => ({
      albumId: album.album_id,
      lastProcessedAt: album.last_processed_at,
      photoCount: album.photo_count,
      rowNumber: findRowById(albumsRows, albumHeaders, "album_id", album.album_id),
    }));
  const albumIdColumn = photoHeaders.indexOf("album_ids");
  const photoAlbumIdUpdates = artifacts.reconciliation.membership_updates
    .filter((update) => !deletedPhotoIds.has(update.photo_id))
    .map((update) => ({
      albumIds: update.after_album_ids.join(";"),
      photoId: update.photo_id,
      rowNumber: findRowById(photosRows, photoHeaders, "photo_id", update.photo_id),
    }));
  if (albumIdColumn < 0 || photoAlbumIdUpdates.some((update) => update.rowNumber < 2)) {
    blockers.push("reconciliation membership update references a missing photo row");
  }
  const albumIdsByPhotoId = new Map(photoAlbumIdUpdates.map((update) => [update.photoId, update.albumIds]));
  const expectedPhotoRecords = [
    ...photoRecords
      .filter((photo) => !deletedPhotoIds.has(photo.photo_id))
      .map((photo) => albumIdsByPhotoId.has(photo.photo_id)
        ? { ...photo, album_ids: albumIdsByPhotoId.get(photo.photo_id) }
        : photo),
    ...artifacts.photoRows.map((row) => toRecord(photoHeaders, row)),
  ];

  return {
    albumIdColumn,
    albumRowsToAppend: newAlbumRecords.map((album) => albumHeaders.map((header) => album[header] ?? "")),
    albumIdsBeforeSort: currentAlbumIds.concat(newAlbumRecords.map((album) => album.album_id)),
    albumUpdates,
    blockers,
    deletedPhotoIds: [...deletedPhotoIds],
    desiredAlbumIds,
    desiredPhotoIds,
    expectedPhotoRecords,
    importBatchRowsToAppend: artifacts.importBatchRows,
    newPhotoRowsToAppend: artifacts.photoRows,
    photoIdsBeforeSort: currentPhotoIds.concat(newPhotoIds),
    photoAlbumIdUpdates,
    summary: artifacts.summary,
  };
}

function printPlan(plan, { write }) {
  console.log(`Mode: ${write ? "write" : "dry-run"}`);
  console.log(`Run: ${plan.summary.run_id}`);
  console.log(`Scope: ${plan.summary.scope}`);
  console.log(`- add albums: ${plan.albumRowsToAppend.length}`);
  console.log(`- update albums: ${plan.albumUpdates.length}`);
  console.log(`- append photos: ${plan.newPhotoRowsToAppend.length}`);
  console.log(`- update photo memberships: ${plan.photoAlbumIdUpdates.length}`);
  console.log(`- delete photos: ${plan.deletedPhotoIds.length}`);
  console.log(`- reorder photos: ${plan.summary.reordered_photo_count}`);
  console.log(`- append import_batches: ${plan.importBatchRowsToAppend.length}`);
  if (plan.blockers.length > 0) {
    console.log(`Blocked: ${plan.blockers.join("; ")}`);
  }
}

function cell(value) {
  return { userEnteredValue: { stringValue: String(value ?? "") } };
}

function appendCells(sheetId, rows) {
  if (rows.length === 0) {
    return [];
  }
  return [{
    appendCells: {
      fields: "userEnteredValue",
      rows: rows.map((row) => ({ values: row.map(cell) })),
      sheetId,
    },
  }];
}

function updateCell(sheetId, rowIndex, columnIndex, value) {
  return {
    updateCells: {
      fields: "userEnteredValue",
      range: {
        endColumnIndex: columnIndex + 1,
        endRowIndex: rowIndex + 1,
        sheetId,
        startColumnIndex: columnIndex,
        startRowIndex: rowIndex,
      },
      rows: [{ values: [cell(value)] }],
    },
  };
}

function sortRowsRequests({ columnCount, currentIds, desiredIds, sheetId }) {
  if (currentIds.join(",") === desiredIds.join(",")) {
    return [];
  }
  const desiredIndex = new Map(desiredIds.map((id, index) => [id, index]));
  let deletedOffset = desiredIds.length;
  const keys = currentIds.map((id) => desiredIndex.get(id) ?? deletedOffset++);
  const requests = [
    {
      insertDimension: {
        inheritFromBefore: true,
        range: {
          dimension: "COLUMNS",
          endIndex: columnCount + 1,
          sheetId,
          startIndex: columnCount,
        },
      },
    },
    {
      updateCells: {
        fields: "userEnteredValue",
        range: {
          endColumnIndex: columnCount + 1,
          endRowIndex: currentIds.length + 1,
          sheetId,
          startColumnIndex: columnCount,
          startRowIndex: 1,
        },
        rows: keys.map((key) => ({ values: [{ userEnteredValue: { numberValue: key } }] })),
      },
    },
    {
      sortRange: {
        range: {
          endColumnIndex: columnCount + 1,
          endRowIndex: currentIds.length + 1,
          sheetId,
          startColumnIndex: 0,
          startRowIndex: 1,
        },
        sortSpecs: [{ dimensionIndex: columnCount, sortOrder: "ASCENDING" }],
      },
    },
  ];
  if (currentIds.length > desiredIds.length) {
    requests.push({
      deleteDimension: {
        range: {
          dimension: "ROWS",
          endIndex: currentIds.length + 1,
          sheetId,
          startIndex: desiredIds.length + 1,
        },
      },
    });
  }
  requests.push({
    deleteDimension: {
      range: {
        dimension: "COLUMNS",
        endIndex: columnCount + 1,
        sheetId,
        startIndex: columnCount,
      },
    },
  });
  return requests;
}

async function sheetIds(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  return Object.fromEntries((response.data.sheets ?? []).map((sheet) => [
    sheet.properties?.title,
    sheet.properties?.sheetId,
  ]));
}

export function buildSheetRequests(plan, ids) {
  for (const sheetName of ["photos", "albums", "import_batches"]) {
    if (ids[sheetName] === undefined) {
      throw new Error(`${sheetName} sheet was not found`);
    }
  }
  const requests = [];
  requests.push(...appendCells(ids.photos, plan.newPhotoRowsToAppend));
  for (const update of plan.photoAlbumIdUpdates) {
    requests.push(updateCell(ids.photos, update.rowNumber - 1, plan.albumIdColumn, update.albumIds));
  }
  requests.push(...sortRowsRequests({
    columnCount: photoHeaders.length,
    currentIds: plan.photoIdsBeforeSort,
    desiredIds: plan.desiredPhotoIds,
    sheetId: ids.photos,
  }));

  requests.push(...appendCells(ids.albums, plan.albumRowsToAppend));
  const photoCountColumn = albumHeaders.indexOf("photo_count");
  const lastProcessedColumn = albumHeaders.indexOf("last_processed_at");
  for (const update of plan.albumUpdates) {
    requests.push(updateCell(ids.albums, update.rowNumber - 1, photoCountColumn, update.photoCount));
    requests.push(updateCell(ids.albums, update.rowNumber - 1, lastProcessedColumn, update.lastProcessedAt));
  }
  requests.push(...sortRowsRequests({
    columnCount: albumHeaders.length,
    currentIds: plan.albumIdsBeforeSort,
    desiredIds: plan.desiredAlbumIds,
    sheetId: ids.albums,
  }));
  requests.push(...appendCells(ids.import_batches, plan.importBatchRowsToAppend));
  return requests;
}

async function applyPlan(sheets, spreadsheetId, plan) {
  const ids = await sheetIds(sheets, spreadsheetId);
  const requests = buildSheetRequests(plan, ids);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

export function assertPhotoRowsMatchExpected(actualPhotoRecords, expectedPhotoRecords) {
  const actualById = new Map(actualPhotoRecords.map((photo) => [photo.photo_id, photo]));
  for (const expected of expectedPhotoRecords) {
    const actual = actualById.get(expected.photo_id);
    if (!actual) {
      throw new Error(`write verification failed; photo ${expected.photo_id} is missing`);
    }
    const changedField = photoHeaders.find((header) => actual[header] !== expected[header]);
    if (changedField) {
      throw new Error(`write verification failed; ${changedField} changed for photo ${expected.photo_id}`);
    }
  }
}

async function verifyApplied(sheets, spreadsheetId, artifacts, plan) {
  const [photosRows, albumsRows, importBatchRows] = await Promise.all([
    readSheetRows(sheets, spreadsheetId, "photos", photoHeaders),
    readSheetRows(sheets, spreadsheetId, "albums", albumHeaders),
    readSheetRows(sheets, spreadsheetId, "import_batches", importBatchHeaders),
  ]);

  const photoRecords = photosRows.slice(1).map((row) => toRecord(photoHeaders, row));
  const photoIds = photoRecords.map((photo) => photo.photo_id);
  if (photoIds.join(",") !== plan.desiredPhotoIds.join(",")) {
    throw new Error(`write verification failed; photos are not in reconciled order`);
  }
  assertPhotoRowsMatchExpected(photoRecords, plan.expectedPhotoRecords);
  const photoById = new Map(photoRecords.map((photo) => [photo.photo_id, photo]));
  for (const photoId of plan.deletedPhotoIds) {
    if (photoById.has(photoId)) {
      throw new Error(`write verification failed; photo ${photoId} was not deleted`);
    }
  }

  const batchIds = collectColumnValues(importBatchRows, importBatchHeaders, "batch_id");
  const missingBatchIds = artifacts.importBatchRecords
    .map((batch) => batch.batch_id)
    .filter((batchId) => !batchIds.has(batchId));
  if (missingBatchIds.length > 0) {
    throw new Error(`write verification failed; missing batch_id ${missingBatchIds.join(", ")}`);
  }

  const actualAlbumIds = albumsRows.slice(1).map((row) => toRecord(albumHeaders, row).album_id);
  if (actualAlbumIds.join(",") !== plan.desiredAlbumIds.join(",")) {
    throw new Error("write verification failed; albums are not in Flickr catalog order");
  }
  const photoCountColumn = albumHeaders.indexOf("photo_count");
  const lastProcessedColumn = albumHeaders.indexOf("last_processed_at");
  for (const album of artifacts.albumRecords) {
    const rowNumber = findRowById(albumsRows, albumHeaders, "album_id", album.album_id);
    const row = albumsRows[rowNumber - 1] ?? [];
    if ((row[photoCountColumn] ?? "") !== album.photo_count || (row[lastProcessedColumn] ?? "") !== album.last_processed_at) {
      throw new Error(`write verification failed; album ${album.album_id} was not updated`);
    }
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

  await applyPlan(sheets, options.spreadsheetId, plan);
  await verifyApplied(sheets, options.spreadsheetId, artifacts, plan);
  console.log("Intake run applied and verified.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not apply intake run: ${explainGoogleSheetsError(error)}`);
    process.exitCode = 1;
  }
}
