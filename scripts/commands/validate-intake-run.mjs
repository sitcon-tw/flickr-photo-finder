import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";
import { parseCsv } from "../lib/core/csv-utils.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders } from "../lib/core/photo-schema.mjs";

const expectedOutputs = {
  photos_to_append: "photos-to-append.csv",
  albums_updated: "albums-updated.csv",
  import_batch: "import-batch.csv",
  reconciliation: "reconciliation.json",
  summary: "summary.json",
};

function printUsage() {
  console.log(`Usage:
  pnpm intake:validate -- --run-dir <path>

Options:
  --run-dir <path>  Intake run artifact directory containing CSV outputs and summary.json.`);
}

export function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv.slice(2).filter((arg) => arg !== "--"),
    options: {
      "run-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const options = {
    help: values.help ?? false,
    runDir: values["run-dir"] ?? "",
  };

  if (!options.help && !options.runDir) {
    throw new Error("--run-dir requires a path");
  }

  return options;
}

function validateData({ photosPath, albumsPath, importBatchesPath }) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/commands/validate-data.mjs",
      "--photos",
      photosPath,
      "--albums",
      albumsPath,
      "--import-batches",
      importBatchesPath,
    ],
    { stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error("intake run CSV validation failed");
  }
}

function validateHeaders(path, headers, expectedHeaders) {
  if (headers.join(",") !== expectedHeaders.join(",")) {
    throw new Error(`${path} headers do not match expected schema`);
  }
}

async function readCsvRows(path, expectedHeaders) {
  const rows = parseCsv(await readFile(path, "utf8"));
  if (rows.length === 0) {
    throw new Error(`${path} is missing a header row`);
  }
  validateHeaders(path, rows[0], expectedHeaders);
  return rows.slice(1);
}

async function readSummary(path) {
  const summary = JSON.parse(await readFile(path, "utf8"));
  for (const field of ["run_id", "created_at", "scope", "source_tool", "outputs"]) {
    if (!summary[field]) {
      throw new Error(`${path} is missing ${field}`);
    }
  }
  if (summary.scope === "album" && (!summary.album_id || !summary.album_url)) {
    throw new Error(`${path} album scope requires album_id and album_url`);
  }

  for (const [key, expectedFile] of Object.entries(expectedOutputs)) {
    const value = summary.outputs?.[key];
    if (!value) {
      throw new Error(`${path} outputs.${key} is required`);
    }
    if (basename(value) !== expectedFile) {
      throw new Error(`${path} outputs.${key} should end with ${expectedFile}`);
    }
  }

  return summary;
}

async function readReconciliation(path) {
  const reconciliation = JSON.parse(await readFile(path, "utf8"));
  if (reconciliation.artifact_version !== 1) {
    throw new Error(`${path} has unsupported artifact_version`);
  }
  if (!["album", "catalog"].includes(reconciliation.scope)) {
    throw new Error(`${path} has invalid scope`);
  }
  for (const field of ["album_order", "album_photos", "desired_photo_ids", "membership_updates", "deleted_photo_ids", "new_photo_ids"]) {
    if (!Array.isArray(reconciliation[field])) {
      throw new Error(`${path} ${field} should be an array`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(reconciliation.source_state_sha256 ?? "")) {
    throw new Error(`${path} source_state_sha256 is invalid`);
  }
  for (const field of ["desired_photo_ids", "deleted_photo_ids", "new_photo_ids"]) {
    if (new Set(reconciliation[field]).size !== reconciliation[field].length) {
      throw new Error(`${path} ${field} contains duplicate photo IDs`);
    }
  }
  return reconciliation;
}

function toRecord(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function assertNumberEquals(label, actual, expected) {
  if (Number(actual) !== Number(expected)) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

export async function validateIntakeRun(runDir, { validateCsv = true } = {}) {
  const paths = {
    photos: join(runDir, expectedOutputs.photos_to_append),
    albums: join(runDir, expectedOutputs.albums_updated),
    importBatches: join(runDir, expectedOutputs.import_batch),
    reconciliation: join(runDir, expectedOutputs.reconciliation),
    summary: join(runDir, expectedOutputs.summary),
  };

  if (validateCsv) {
    validateData({
      photosPath: paths.photos,
      albumsPath: paths.albums,
      importBatchesPath: paths.importBatches,
    });
  }

  const [photoRows, albumRows, importBatchRows, reconciliation, summary] = await Promise.all([
    readCsvRows(paths.photos, photoHeaders),
    readCsvRows(paths.albums, albumHeaders),
    readCsvRows(paths.importBatches, importBatchHeaders),
    readReconciliation(paths.reconciliation),
    readSummary(paths.summary),
  ]);

  if (summary.scope !== reconciliation.scope) {
    throw new Error(`summary scope does not match reconciliation scope`);
  }
  const expectedBatchCount = reconciliation.scope === "album" ? 1 : reconciliation.album_photos.length;
  if (importBatchRows.length !== expectedBatchCount) {
    throw new Error(`${paths.importBatches} should contain ${expectedBatchCount} import batch row(s)`);
  }

  const batches = importBatchRows.map((row) => toRecord(importBatchHeaders, row));
  const albums = albumRows.map((row) => toRecord(albumHeaders, row));
  for (const inventory of reconciliation.album_photos) {
    const batch = batches.find((item) => item.album_id === inventory.album_id);
    const updatedAlbum = albums.find((item) => item.album_id === inventory.album_id);
    if (!batch || !updatedAlbum) {
      throw new Error(`Missing album or import batch for ${inventory.album_id}`);
    }
    if (batch.imported_at !== summary.created_at || updatedAlbum.last_processed_at !== summary.created_at) {
      throw new Error(`Reconciliation timestamp mismatch for ${inventory.album_id}`);
    }
    assertNumberEquals(`${inventory.album_id} found_photo_count`, batch.found_photo_count, inventory.photo_ids.length);
    assertNumberEquals(`${inventory.album_id} photo_count`, updatedAlbum.photo_count, inventory.photo_ids.length);
  }

  const appendedPhotoIds = photoRows.map((row) => toRecord(photoHeaders, row).photo_id);
  if (appendedPhotoIds.join(",") !== reconciliation.new_photo_ids.join(",")) {
    throw new Error(`photos-to-append photo IDs do not match reconciliation.new_photo_ids`);
  }
  assertNumberEquals("summary.new_photo_count", summary.new_photo_count, photoRows.length);
  assertNumberEquals("summary.membership_update_count", summary.membership_update_count, reconciliation.counts.membership_updated);
  assertNumberEquals("summary.deleted_photo_count", summary.deleted_photo_count, reconciliation.counts.deleted);
  assertNumberEquals("summary.reordered_photo_count", summary.reordered_photo_count, reconciliation.counts.reordered);

  for (const batch of batches) {
    if (Number(batch.found_photo_count) !== Number(batch.new_photo_count) + Number(batch.skipped_photo_count)) {
      throw new Error(`${batch.album_id} found_photo_count should equal new_photo_count + skipped_photo_count`);
    }
  }

  console.log(
    `Intake run ${summary.run_id} is valid (${summary.new_photo_count} new, ${summary.membership_update_count} membership update(s), ${summary.deleted_photo_count} deleted, ${summary.reordered_photo_count} reordered).`,
  );
  return { reconciliation, summary };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      printUsage();
    } else {
      await validateIntakeRun(options.runDir);
    }
  } catch (error) {
    console.error(`Could not validate intake run: ${error.message}`);
    process.exitCode = 1;
  }
}
