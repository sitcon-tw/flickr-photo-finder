import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import {
  readAlbumCatalog,
  resolveAlbumInput,
} from "../lib/flickr/album-catalog.mjs";
import { parseCsv } from "../lib/core/csv-utils.mjs";
import { importBatchHeaders } from "../lib/core/photo-schema.mjs";
import { sheetsExportAlbumsPath, sheetsExportPhotosPath } from "../lib/core/workflow-paths.mjs";

const defaultRunsDir = "tmp/intake-runs";

function printUsage() {
  console.log(`Usage:
  pnpm intake:run -- (--album <album-id> | --all-albums) [options]

Options:
  --album <value>         Album ID from the albums CSV. Flickr album URLs are accepted for debugging.
  --all-albums            Build a complete ordered membership baseline for every catalog album.
  --albums <path>         Google Sheets albums CSV export or local fixture. Default: tmp/sheets-export/albums.csv.
  --photos-export <path>  Current Google Sheets photos CSV export for duplicate detection. Default: tmp/sheets-export/photos.csv.
  --input <html-file>     Read saved Flickr album HTML instead of fetching the album page.
  --runs-dir <path>       Directory for intake run artifacts. Default: tmp/intake-runs.
  --run-id <value>        Explicit run ID. Default: intake-<album-id>-<timestamp>.
  --imported-at <value>   Import timestamp to write. Default: current time as ISO string.
  --operator <value>      Operator or agent name to record in import_batches.
  --no-validate           Skip validation for generated CSV outputs.

Each run writes:
  photos-to-append.csv
  albums-updated.csv
  import-batch.csv
  reconciliation.json
  summary.json`);
}

function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv.slice(2),
    options: {
      album: { type: "string" },
      "all-albums": { type: "boolean" },
      albums: { type: "string" },
      "photos-export": { type: "string" },
      input: { type: "string" },
      "runs-dir": { type: "string" },
      "run-id": { type: "string" },
      "imported-at": { type: "string" },
      operator: { type: "string" },
      "no-validate": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const options = {
    album: values.album ?? "",
    allAlbums: values["all-albums"] ?? false,
    albums: values.albums ?? sheetsExportAlbumsPath,
    help: values.help ?? false,
    importedAt: values["imported-at"] ?? "",
    input: values.input ?? "",
    operator: values.operator ?? "",
    photosExport: values["photos-export"] ?? sheetsExportPhotosPath,
    runId: values["run-id"] ?? "",
    runsDir: values["runs-dir"] ?? defaultRunsDir,
    validate: !(values["no-validate"] ?? false),
  };

  if (!options.help) {
    if (Boolean(options.album) === options.allAlbums) {
      throw new Error("Pass exactly one of --album or --all-albums");
    }
    if (!options.albums) {
      throw new Error("--albums requires a path");
    }
    if (!options.photosExport) {
      throw new Error("--photos-export requires a path");
    }
    if (!options.runsDir) {
      throw new Error("--runs-dir requires a path");
    }
    if (options.importedAt && Number.isNaN(Date.parse(options.importedAt))) {
      throw new Error("--imported-at must be a valid date or datetime");
    }
  }

  return options;
}

function makeRunId(albumId, createdAt) {
  const compactTimestamp = createdAt.replace(/\D/g, "").slice(0, 14);
  return `intake-${albumId}-${compactTimestamp}`;
}

function getCell(record, header) {
  const index = importBatchHeaders.indexOf(header);
  return index >= 0 ? record[index] ?? "" : "";
}

async function readImportBatches(path) {
  const csv = await readFile(path, "utf8");
  const [headers, ...rows] = parseCsv(csv);
  if (!headers) {
    throw new Error(`${path} is empty`);
  }
  if (headers.join(",") !== importBatchHeaders.join(",")) {
    throw new Error(`${path} headers do not match import_batches schema`);
  }
  return rows;
}

function runPhotoImport(args) {
  console.error("Progress: running photo import helper.");
  const result = spawnSync(process.execPath, ["scripts/commands/import-album-photos.mjs", ...args], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error("photo import run failed");
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const createdAt = options.importedAt || new Date().toISOString();
  console.error(`Progress: resolving ${options.allAlbums ? "complete album catalog" : `album ${options.album}`}.`);
  const resolved = options.allAlbums
    ? { albumId: "catalog", albumUrl: "" }
    : await resolveAlbumInput(options.album, options.albums);
  const { albumId, albumUrl } = resolved;
  console.error(`Progress: reading album catalog from ${options.albums}.`);
  const albums = await readAlbumCatalog(options.albums);
  const album = albums.find((item) => item.album_id === albumId) ?? {};
  const runId = options.runId || makeRunId(albumId, createdAt);
  const runDir = join(options.runsDir, runId);
  const photosOutput = join(runDir, "photos-to-append.csv");
  const albumsOutput = join(runDir, "albums-updated.csv");
  const batchOutput = join(runDir, "import-batch.csv");
  const reconciliationOutput = join(runDir, "reconciliation.json");
  const summaryOutput = join(runDir, "summary.json");

  console.error(`Progress: creating intake run directory ${runDir}.`);
  await mkdir(options.runsDir, { recursive: true });
  await mkdir(runDir);

  const photoImportArgs = [
    ...(options.allAlbums ? ["--all-albums"] : ["--album", albumId]),
    "--albums",
    options.albums,
    "--photos-export",
    options.photosExport,
    "--output",
    photosOutput,
    "--albums-output",
    albumsOutput,
    "--batch-output",
    batchOutput,
    "--reconciliation-output",
    reconciliationOutput,
    "--imported-at",
    createdAt,
    "--source-tool",
    "pnpm intake:run",
  ];

  if (options.input) {
    photoImportArgs.push("--input", options.input);
  }
  if (options.operator) {
    photoImportArgs.push("--operator", options.operator);
  }
  if (!options.validate) {
    photoImportArgs.push("--no-validate");
  }

  runPhotoImport(photoImportArgs);

  console.error(`Progress: reading generated reconciliation artifacts.`);
  const [batches, reconciliation] = await Promise.all([
    readImportBatches(batchOutput),
    readFile(reconciliationOutput, "utf8").then(JSON.parse),
  ]);
  const batch = batches[0] ?? [];
  const foundPhotoCount = options.allAlbums
    ? reconciliation.desired_photo_ids.length
    : Number(getCell(batch, "found_photo_count"));
  const summary = {
    run_id: runId,
    created_at: createdAt,
    scope: reconciliation.scope,
    album_id: options.allAlbums ? "" : albumId,
    album_url: albumUrl,
    album_title: album.album_title ?? "",
    operator: options.operator,
    source_tool: "pnpm intake:run",
    found_photo_count: foundPhotoCount,
    new_photo_count: reconciliation.counts.new,
    skipped_photo_count: foundPhotoCount - reconciliation.counts.new,
    membership_update_count: reconciliation.counts.membership_updated,
    deleted_photo_count: reconciliation.counts.deleted,
    reordered_photo_count: reconciliation.counts.reordered,
    outputs: {
      photos_to_append: photosOutput,
      albums_updated: albumsOutput,
      import_batch: batchOutput,
      reconciliation: reconciliationOutput,
      summary: summaryOutput,
    },
  };

  console.error(`Progress: writing intake run summary to ${summaryOutput}.`);
  await writeFile(summaryOutput, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Wrote intake run summary to ${summaryOutput}.`);
  console.log(`Intake run directory: ${runDir}`);
  console.log(`Intake run ${runId} is ready for review before applying to Google Sheets.`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not run album intake: ${error.message}`);
  process.exitCode = 1;
}
