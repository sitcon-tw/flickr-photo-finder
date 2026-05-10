import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseCsv } from "../lib/core/csv-utils.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders } from "../lib/core/photo-schema.mjs";

const expectedOutputs = {
  photos_to_append: "photos-to-append.csv",
  albums_updated: "albums-updated.csv",
  import_batch: "import-batch.csv",
  summary: "summary.json",
};

function printUsage() {
  console.log(`Usage:
  pnpm intake:validate -- --run-dir <path>

Options:
  --run-dir <path>  Intake run artifact directory containing CSV outputs and summary.json.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    runDir: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--run-dir") {
      options.runDir = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

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
  for (const field of ["run_id", "created_at", "album_id", "album_url", "source_tool", "outputs"]) {
    if (!summary[field]) {
      throw new Error(`${path} is missing ${field}`);
    }
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

function toRecord(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function assertNumberEquals(label, actual, expected) {
  if (Number(actual) !== Number(expected)) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const paths = {
    photos: join(options.runDir, expectedOutputs.photos_to_append),
    albums: join(options.runDir, expectedOutputs.albums_updated),
    importBatches: join(options.runDir, expectedOutputs.import_batch),
    summary: join(options.runDir, expectedOutputs.summary),
  };

  validateData({
    photosPath: paths.photos,
    albumsPath: paths.albums,
    importBatchesPath: paths.importBatches,
  });

  const [photoRows, albumRows, importBatchRows, summary] = await Promise.all([
    readCsvRows(paths.photos, photoHeaders),
    readCsvRows(paths.albums, albumHeaders),
    readCsvRows(paths.importBatches, importBatchHeaders),
    readSummary(paths.summary),
  ]);

  if (importBatchRows.length !== 1) {
    throw new Error(`${paths.importBatches} should contain exactly one import batch row`);
  }

  const batch = toRecord(importBatchHeaders, importBatchRows[0]);
  const updatedAlbum = albumRows
    .map((row) => toRecord(albumHeaders, row))
    .find((album) => album.album_id === summary.album_id);

  if (!updatedAlbum) {
    throw new Error(`${paths.albums} does not contain album_id ${summary.album_id}`);
  }

  if (batch.album_id !== summary.album_id) {
    throw new Error(`summary album_id ${summary.album_id} does not match import batch ${batch.album_id}`);
  }
  if (batch.album_url !== summary.album_url) {
    throw new Error(`summary album_url does not match import batch album_url`);
  }
  if (batch.imported_at !== summary.created_at) {
    throw new Error(`summary created_at does not match import batch imported_at`);
  }
  if (updatedAlbum.last_processed_at !== summary.created_at) {
    throw new Error(`albums-updated last_processed_at does not match summary created_at`);
  }

  assertNumberEquals("summary.new_photo_count", summary.new_photo_count, photoRows.length);
  assertNumberEquals("batch.new_photo_count", batch.new_photo_count, photoRows.length);
  assertNumberEquals("summary.found_photo_count", summary.found_photo_count, batch.found_photo_count);
  assertNumberEquals("summary.skipped_photo_count", summary.skipped_photo_count, batch.skipped_photo_count);

  const foundCount = Number(batch.found_photo_count);
  const newCount = Number(batch.new_photo_count);
  const skippedCount = Number(batch.skipped_photo_count);
  if (foundCount !== newCount + skippedCount) {
    throw new Error(`found_photo_count should equal new_photo_count + skipped_photo_count`);
  }

  console.log(
    `Intake run ${summary.run_id} is valid (${newCount} new, ${skippedCount} skipped, ${foundCount} found).`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`Could not validate intake run: ${error.message}`);
  process.exitCode = 1;
}
