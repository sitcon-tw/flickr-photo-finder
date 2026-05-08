import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import {
  readAlbumCatalog,
  resolveAlbumInput,
} from "./album-catalog.mjs";
import { extractAlbumPhotoUrls, fetchAlbumHtml } from "./flickr-album-photos.mjs";
import {
  assertUniqueInputPhotoIds,
  buildCsvRows,
  filterNewPhotos,
  getExistingPhotoIds,
} from "./flickr-intake.mjs";
import { toCsvLine } from "./csv-utils.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders } from "./photo-schema.mjs";
import { sheetsExportAlbumsPath, sheetsExportPhotosPath } from "./workflow-paths.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm photos:import -- --album <album-id-or-flickr-album-url> --output <photos-csv>

Options:
  --album <value>         Album ID from the albums CSV, or a full SITCON Flickr album URL.
  --albums <path>         Google Sheets albums CSV export or local fixture. Default: tmp/sheets-export/albums.csv.
  --photos-export <path>  Current Google Sheets photos CSV export for duplicate detection. Default: tmp/sheets-export/photos.csv.
  --input <html-file>     Read saved Flickr album HTML instead of fetching the album page.
  --output <path>         Write candidate photo rows to this CSV. If omitted, print to stdout.
  --albums-output <path>  Write an albums CSV with last_processed_at updated for this album.
  --batch-output <path>   Write an import_batches CSV row for this run.
  --imported-at <value>   Import timestamp to write. Default: current time as ISO string.
  --operator <value>      Operator or agent name to record in import_batches.
  --source-tool <value>   Tool name to record in import_batches. Default: pnpm photos:import.
  --no-validate           Skip validation for the output path.

The output is a Sheets-ready photos CSV containing only missing photo rows.
It preserves album context from the selected albums CSV when available.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    album: "",
    albums: sheetsExportAlbumsPath,
    albumsOutput: "",
    batchOutput: "",
    help: false,
    input: "",
    importedAt: "",
    operator: "",
    output: "",
    photosExport: sheetsExportPhotosPath,
    sourceTool: "pnpm photos:import",
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
    } else if (arg === "--output") {
      options.output = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--albums-output") {
      options.albumsOutput = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--batch-output") {
      options.batchOutput = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--imported-at") {
      options.importedAt = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--operator") {
      options.operator = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--source-tool") {
      options.sourceTool = args[index + 1] ?? "";
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
    if (options.importedAt && Number.isNaN(Date.parse(options.importedAt))) {
      throw new Error("--imported-at must be a valid date or datetime");
    }
    if (!options.sourceTool) {
      throw new Error("--source-tool requires a value");
    }
  }

  return options;
}

async function resolveAlbumWithContext(input, albumCatalogPath) {
  const resolved = await resolveAlbumInput(input, albumCatalogPath);
  const albums = await readAlbumCatalog(albumCatalogPath);
  const album = albums.find((item) => item.album_id === resolved.albumId) ?? {};

  return {
    ...resolved,
    album,
    albums,
  };
}

function toPhotoCsv(rows) {
  return `${[photoHeaders.join(","), ...rows].join("\n")}\n`;
}

function toRecordCsv(headers, records) {
  return `${[headers.join(","), ...records.map((record) => toCsvLine(headers, record))].join("\n")}\n`;
}

function makeBatchId(albumId, importedAt) {
  const compactTimestamp = importedAt.replace(/\D/g, "").slice(0, 14);
  return `photos-import-${albumId}-${compactTimestamp}`;
}

function validatePath(option, path) {
  const result = spawnSync(process.execPath, ["scripts/validate-data.mjs", option, path], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${option} CSV validation failed`);
  }
}

function buildUpdatedAlbums({ albums, albumId, importedAt }) {
  const index = albums.findIndex((item) => item.album_id === albumId);
  if (index < 0) {
    throw new Error(`Cannot update albums output because album ${albumId} was not found in the albums CSV`);
  }

  return albums.map((album, albumIndex) => {
    if (albumIndex !== index) {
      return album;
    }

    return {
      ...album,
      last_processed_at: importedAt,
    };
  });
}

function buildImportBatchRecord({
  albumId,
  albumUrl,
  existingCount,
  foundCount,
  importedAt,
  missingCount,
  operator,
  sourceTool,
}) {
  return {
    batch_id: makeBatchId(albumId, importedAt),
    album_id: albumId,
    album_url: albumUrl,
    imported_at: importedAt,
    operator,
    source_tool: sourceTool,
    found_photo_count: String(foundCount),
    new_photo_count: String(missingCount),
    skipped_photo_count: String(existingCount),
    notes: "Generated Sheets-ready candidate photo rows; review before appending to photos.",
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const importedAt = options.importedAt || new Date().toISOString();
  const { ownerPath, albumId, albumUrl, album, albums } = await resolveAlbumWithContext(
    options.album,
    options.albums,
  );

  const html = options.input ? await readFile(options.input, "utf8") : await fetchAlbumHtml(albumUrl);
  const albumPhotos = extractAlbumPhotoUrls(html, ownerPath);
  assertUniqueInputPhotoIds(albumPhotos);

  if (albumPhotos.length === 0) {
    throw new Error(`No photo URLs found in album ${albumId}`);
  }

  const existingIds = await getExistingPhotoIds(options.photosExport);
  const missingPhotos = filterNewPhotos(albumPhotos, existingIds);
  const existingCount = albumPhotos.length - missingPhotos.length;

  const rows = await buildCsvRows(missingPhotos, {
    album_title: album.album_title ?? "",
    album_ids: albumId,
    event_name: album.event_name ?? "",
    event_year: album.event_year ?? "",
  });
  const csv = toPhotoCsv(rows);

  if (options.output) {
    await writeFile(options.output, csv);
    if (options.validate) {
      validatePath("--photos", options.output);
    }
    console.log(`Wrote ${rows.length} Sheets-ready photo row(s) to ${options.output}.`);
  } else {
    process.stdout.write(csv);
  }

  if (options.albumsOutput) {
    const updatedAlbums = buildUpdatedAlbums({ albums, albumId, importedAt });
    await writeFile(options.albumsOutput, toRecordCsv(albumHeaders, updatedAlbums));
    if (options.validate) {
      validatePath("--albums", options.albumsOutput);
    }
    console.log(`Wrote ${updatedAlbums.length} album row(s) with updated last_processed_at to ${options.albumsOutput}.`);
  }

  if (options.batchOutput) {
    const batch = buildImportBatchRecord({
      albumId,
      albumUrl,
      existingCount,
      foundCount: albumPhotos.length,
      importedAt,
      missingCount: missingPhotos.length,
      operator: options.operator,
      sourceTool: options.sourceTool,
    });
    await writeFile(options.batchOutput, toRecordCsv(importBatchHeaders, [batch]));
    if (options.validate) {
      validatePath("--import-batches", options.batchOutput);
    }
    console.log(`Wrote import batch row to ${options.batchOutput}.`);
  }

  console.error(
    `Album ${albumId}: ${albumPhotos.length} photo(s), ${existingCount} already indexed, ${missingPhotos.length} missing.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`Could not import album photos: ${error.message}`);
  process.exitCode = 1;
}
