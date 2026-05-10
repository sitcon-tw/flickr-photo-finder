import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readAlbumCatalog } from "./album-catalog.mjs";
import { parseCsv, toCsvLine } from "./csv-utils.mjs";
import { fetchAlbumPhotoUrls } from "./flickr-album-photos.mjs";
import { buildCsvRows } from "./flickr-intake.mjs";
import { photoHeaders } from "./photo-schema.mjs";
import { flickrOwnerPath } from "./project-config.mjs";
import { aiRunsDir, sheetsExportAlbumsPath } from "./workflow-paths.mjs";

const defaultPlanPath = "data/ai-cross-activity-sample-plan.json";
const defaultFixtureAlbumsPath = "fixtures/albums.csv";
const defaultPhotosPath = "fixtures/photos.csv";
const defaultWorkDir = "tmp/ai-samples";
const defaultImageSize = "large-1024";

function printUsage() {
  console.log(`Usage:
  pnpm eval:sample

Options:
  --plan <path>          Cross-activity sample plan. Default: data/ai-cross-activity-sample-plan.json.
  --albums <path>        Formal Sheets albums export. Default: tmp/sheets-export/albums.csv.
  --photos <path>        Existing photos CSV used only to reuse already-known metadata. Default: fixtures/photos.csv.
  --work-dir <path>      Directory for generated sample CSV and summary. Default: tmp/ai-samples.
  --output-dir <path>    Directory for AI run folders. Default: tmp/ai-runs.
  --run-id <id>          AI run folder name. Default: ai-cross-activity-sample-<timestamp>.
  --image-size <size>    Image size passed to ai:prepare. Default: large-1024.
  --no-download          Create the AI run without downloading image files.
  --help, -h             Show this help.

The command fetches Flickr album photo lists, selects a small deterministic
sample across multiple activity types, writes a local photos CSV, then invokes
ai:prepare with status=all and limit=all. It does not write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    albumsPath: sheetsExportAlbumsPath,
    download: true,
    help: false,
    imageSize: defaultImageSize,
    outputDir: aiRunsDir,
    photosPath: defaultPhotosPath,
    planPath: defaultPlanPath,
    runId: "",
    workDir: defaultWorkDir,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--plan") {
      options.planPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--albums") {
      options.albumsPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--photos") {
      options.photosPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--work-dir") {
      options.workDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--run-id") {
      options.runId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--image-size") {
      options.imageSize = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--no-download") {
      options.download = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    for (const [name, value] of Object.entries({
      "--albums": options.albumsPath,
      "--image-size": options.imageSize,
      "--output-dir": options.outputDir,
      "--photos": options.photosPath,
      "--plan": options.planPath,
      "--work-dir": options.workDir,
    })) {
      if (!value) {
        throw new Error(`${name} requires a path or value`);
      }
    }
  }

  return options;
}

function defaultRunId() {
  return `ai-cross-activity-sample-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readCsvRecords(path, headers) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const [csvHeaders, ...rows] = parseCsv(text);
  if (!csvHeaders) {
    return [];
  }
  if (headers.some((header, index) => csvHeaders[index] !== header)) {
    throw new Error(`${path} headers do not match expected schema`);
  }

  return rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function mergeAlbums(primaryAlbums, fixtureAlbums) {
  const albumsById = new Map();
  for (const album of [...fixtureAlbums, ...primaryAlbums]) {
    if (album.album_id) {
      albumsById.set(album.album_id, album);
    }
  }
  return albumsById;
}

function selectEvenly(items, count) {
  if (items.length <= count) {
    return items;
  }
  if (count === 1) {
    return [items[Math.floor((items.length - 1) / 2)]];
  }

  const selected = [];
  const usedIndexes = new Set();
  for (let index = 0; index < count; index += 1) {
    const itemIndex = Math.round((index * (items.length - 1)) / (count - 1));
    if (!usedIndexes.has(itemIndex)) {
      selected.push(items[itemIndex]);
      usedIndexes.add(itemIndex);
    }
  }
  return selected;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function toPhotoCsv(records) {
  return `${[photoHeaders.join(","), ...records.map((record) => toCsvLine(photoHeaders, record))].join("\n")}\n`;
}

function rowToRecord(row) {
  const [headers, record] = parseCsv(`${photoHeaders.join(",")}\n${row}\n`);
  return Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""]));
}

async function buildPhotoRecord(normalizedPhoto, album, existingPhotosById) {
  const existing = existingPhotosById.get(normalizedPhoto.photoId);
  if (existing) {
    return existing;
  }

  const [row] = await buildCsvRows([normalizedPhoto], {
    album_title: album.album_title ?? "",
    album_ids: album.album_id ?? "",
    event_name: album.event_name ?? "",
    event_year: album.event_year ?? "",
  });
  return rowToRecord(row);
}

function runAiPrepare({ download, imageSize, outputDir, photosCsvPath, runId }) {
  const args = [
    "ai:prepare",
    "--",
    "--photos",
    photosCsvPath,
    "--status",
    "all",
    "--limit",
    "all",
    "--image-size",
    imageSize,
    "--output-dir",
    outputDir,
    "--run-id",
    runId,
  ];
  if (!download) {
    args.push("--no-download");
  }

  const result = spawnSync("pnpm", args, {
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("ai:prepare failed");
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const plan = await readJson(options.planPath);
  const primaryAlbums = await readAlbumCatalog(options.albumsPath);
  const fixtureAlbums = await readAlbumCatalog(defaultFixtureAlbumsPath);
  const albumsById = mergeAlbums(primaryAlbums, fixtureAlbums);
  const existingPhotos = await readCsvRecords(options.photosPath, photoHeaders);
  const existingPhotosById = new Map(existingPhotos.map((photo) => [photo.photo_id, photo]));
  const runId = options.runId || defaultRunId();
  const sampleDir = join(options.workDir, runId);
  const photosCsvPath = join(sampleDir, "photos.csv");
  const summaryPath = join(sampleDir, "summary.json");

  await mkdir(sampleDir, { recursive: true });

  const photoRecords = [];
  const selectedIds = new Set();
  const summary = {
    created_at: new Date().toISOString(),
    image_size: options.imageSize,
    plan_path: options.planPath,
    run_id: runId,
    sample_csv: photosCsvPath,
    selection_strategy: plan.selection_strategy ?? "",
    ai_run_dir: join(options.outputDir, runId),
    albums: [],
  };

  for (const planAlbum of plan.albums ?? []) {
    const album = albumsById.get(planAlbum.album_id);
    if (!album) {
      throw new Error(`Album ${planAlbum.album_id} was not found in ${options.albumsPath} or ${defaultFixtureAlbumsPath}`);
    }

    const sampleCount = parsePositiveInteger(planAlbum.sample_count, plan.default_sample_count ?? 4);
    console.error(`Progress: fetching album ${album.album_id} (${album.album_title}).`);
    const albumPhotoResult = await fetchAlbumPhotoUrls({
      albumId: album.album_id,
      albumUrl: album.album_url,
      expectedPhotoCount: Number(album.photo_count) || 0,
      ownerPath: flickrOwnerPath,
    });
    const selectedPhotos = selectEvenly(albumPhotoResult.photoUrls, sampleCount);
    const albumSelectedIds = [];

    for (const normalizedPhoto of selectedPhotos) {
      if (selectedIds.has(normalizedPhoto.photoId)) {
        continue;
      }
      selectedIds.add(normalizedPhoto.photoId);
      albumSelectedIds.push(normalizedPhoto.photoId);
      console.error(`Progress: preparing sample photo ${normalizedPhoto.photoId}.`);
      const record = await buildPhotoRecord(normalizedPhoto, album, existingPhotosById);
      photoRecords.push(record);
    }

    summary.albums.push({
      album_id: album.album_id,
      album_title: album.album_title,
      album_url: album.album_url,
      category: planAlbum.category ?? "",
      focus_zh: planAlbum.focus_zh ?? [],
      found_photo_count: albumPhotoResult.photoUrls.length,
      previously_evaluated: Boolean(planAlbum.previously_evaluated),
      rationale_zh: planAlbum.rationale_zh ?? "",
      requested_sample_count: sampleCount,
      selected_photo_ids: albumSelectedIds,
      source: albumPhotoResult.source,
    });
  }

  if (photoRecords.length === 0) {
    throw new Error("No sample photos were selected");
  }

  console.error(`Progress: writing ${photoRecords.length} sample photo row(s) to ${photosCsvPath}.`);
  await writeFile(photosCsvPath, toPhotoCsv(photoRecords));
  summary.selected_photo_count = photoRecords.length;
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  console.error("Progress: invoking ai:prepare for the cross-activity sample.");
  runAiPrepare({
    download: options.download,
    imageSize: options.imageSize,
    outputDir: options.outputDir,
    photosCsvPath,
    runId,
  });

  console.log(`Cross-activity sample ready: ${join(options.outputDir, runId)}`);
  console.log(`- sample summary: ${summaryPath}`);
  console.log(`- sample photos CSV: ${photosCsvPath}`);
  console.log("- next: give each model ai-labeling-prompt.md and the run directory. Models should write metadata-proposals.json only; for large runs, use ai:shard:prepare / ai:shard:merge under /tmp before comparing results with ai:review and ai:report.");
}

try {
  await main();
} catch (error) {
  console.error(`Could not build cross-activity AI sample: ${error.message}`);
  process.exitCode = 1;
}
