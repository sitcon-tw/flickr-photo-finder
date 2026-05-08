import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readAlbumCatalog,
  resolveAlbumInput,
} from "./album-catalog.mjs";
import { parseCsv } from "./csv-utils.mjs";
import { importBatchHeaders } from "./photo-schema.mjs";
import { sheetsExportAlbumsPath, sheetsExportPhotosPath } from "./workflow-paths.mjs";

const defaultRunsDir = "tmp/intake-runs";

function printUsage() {
  console.log(`Usage:
  pnpm intake:run -- --album <album-id> [options]

Options:
  --album <value>         Album ID from the albums CSV. Flickr album URLs are accepted for debugging.
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
  summary.json`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    album: "",
    albums: sheetsExportAlbumsPath,
    help: false,
    importedAt: "",
    input: "",
    operator: "",
    photosExport: sheetsExportPhotosPath,
    runId: "",
    runsDir: defaultRunsDir,
    validate: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--album") {
      options.album = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--albums") {
      options.albums = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--photos-export") {
      options.photosExport = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--input") {
      options.input = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--runs-dir") {
      options.runsDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--run-id") {
      options.runId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--imported-at") {
      options.importedAt = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--operator") {
      options.operator = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--no-validate") {
      options.validate = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.album) {
      throw new Error("--album requires an album ID or Flickr album URL");
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

async function readImportBatch(path) {
  const csv = await readFile(path, "utf8");
  const [headers, ...rows] = parseCsv(csv);
  if (!headers) {
    throw new Error(`${path} is empty`);
  }
  if (headers.join(",") !== importBatchHeaders.join(",")) {
    throw new Error(`${path} headers do not match import_batches schema`);
  }
  if (rows.length !== 1) {
    throw new Error(`${path} should contain exactly one import batch row`);
  }
  return rows[0];
}

function runPhotoImport(args) {
  const result = spawnSync(process.execPath, ["scripts/import-album-photos.mjs", ...args], {
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
  const { albumId, albumUrl } = await resolveAlbumInput(options.album, options.albums);
  const albums = await readAlbumCatalog(options.albums);
  const album = albums.find((item) => item.album_id === albumId) ?? {};
  const runId = options.runId || makeRunId(albumId, createdAt);
  const runDir = join(options.runsDir, runId);
  const photosOutput = join(runDir, "photos-to-append.csv");
  const albumsOutput = join(runDir, "albums-updated.csv");
  const batchOutput = join(runDir, "import-batch.csv");
  const summaryOutput = join(runDir, "summary.json");

  await mkdir(options.runsDir, { recursive: true });
  await mkdir(runDir);

  const photoImportArgs = [
    "--album",
    albumId,
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

  const batch = await readImportBatch(batchOutput);
  const summary = {
    run_id: runId,
    created_at: createdAt,
    album_id: albumId,
    album_url: albumUrl,
    album_title: album.album_title ?? "",
    operator: options.operator,
    source_tool: "pnpm intake:run",
    found_photo_count: Number(getCell(batch, "found_photo_count")),
    new_photo_count: Number(getCell(batch, "new_photo_count")),
    skipped_photo_count: Number(getCell(batch, "skipped_photo_count")),
    outputs: {
      photos_to_append: photosOutput,
      albums_updated: albumsOutput,
      import_batch: batchOutput,
      summary: summaryOutput,
    },
  };

  await writeFile(summaryOutput, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Wrote intake run summary to ${summaryOutput}.`);
  console.log(`Intake run ${runId} is ready for review before applying to Google Sheets.`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not run album intake: ${error.message}`);
  process.exitCode = 1;
}
