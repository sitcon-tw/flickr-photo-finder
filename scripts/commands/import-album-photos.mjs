import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import {
  readAlbumCatalog,
  resolveAlbumInput,
} from "../lib/flickr/album-catalog.mjs";
import { fetchAlbumPhotoUrls, fetchPhotoAlbumIds } from "../lib/flickr/flickr-album-photos.mjs";
import {
  assertUniqueInputPhotoIds,
  buildCsvRows,
} from "../lib/flickr/flickr-intake.mjs";
import { parseCsv, toCsvLine } from "../lib/core/csv-utils.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders } from "../lib/core/photo-schema.mjs";
import { createProgressThrottle } from "../lib/core/progress.mjs";
import { sheetsExportAlbumsPath, sheetsExportPhotosPath } from "../lib/core/workflow-paths.mjs";
import { albumMemberships, buildPhotoReconciliation, splitAlbumIds } from "../lib/flickr/photo-reconciliation.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm photos:import -- (--album <album-id-or-flickr-album-url> | --all-albums) --output <photos-csv>

Options:
  --album <value>         Album ID from the albums CSV, or a full SITCON Flickr album URL.
  --all-albums            Reconcile every album in catalog order for a complete membership baseline.
  --albums <path>         Google Sheets albums CSV export or local fixture. Default: tmp/sheets-export/albums.csv.
  --photos-export <path>  Current Google Sheets photos CSV export for duplicate detection. Default: tmp/sheets-export/photos.csv.
  --input <html-file>     Read saved Flickr album HTML instead of fetching the album page.
  --output <path>         Write candidate photo rows to this CSV. If omitted, print to stdout.
  --albums-output <path>  Write an albums CSV with last_processed_at updated for this album.
  --batch-output <path>   Write an import_batches CSV row for this run.
  --reconciliation-output <path>  Write the reviewable reconciliation JSON artifact.
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
    allAlbums: false,
    albums: sheetsExportAlbumsPath,
    albumsOutput: "",
    batchOutput: "",
    help: false,
    input: "",
    importedAt: "",
    operator: "",
    output: "",
    photosExport: sheetsExportPhotosPath,
    reconciliationOutput: "",
    sourceTool: "pnpm photos:import",
    validate: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--all-albums") {
      options.allAlbums = true;
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
    } else if (arg === "--reconciliation-output") {
      options.reconciliationOutput = args[index + 1] ?? "";
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
    if (Boolean(options.album) === options.allAlbums) {
      throw new Error("Pass exactly one of --album or --all-albums");
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
    if (options.allAlbums && options.input) {
      throw new Error("--input cannot be used with --all-albums");
    }
  }

  return options;
}

async function readPhotoRecords(path) {
  const [headers, ...rows] = parseCsv(await readFile(path, "utf8"));
  if (!headers || headers.join(",") !== photoHeaders.join(",")) {
    throw new Error(`${path} headers do not match photos schema`);
  }
  return rows.map((row) => Object.fromEntries(photoHeaders.map((header, index) => [header, row[index] ?? ""])));
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
  console.error(`Progress: validating ${path}.`);
  const result = spawnSync(process.execPath, ["scripts/commands/validate-data.mjs", option, path], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${option} CSV validation failed`);
  }
}

function parsePhotoCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

function buildUpdatedAlbums({ albums, importedAt, inventories }) {
  const inventoryByAlbumId = new Map(inventories.map((inventory) => [inventory.albumId, inventory]));
  return albums.map((album) => {
    const inventory = inventoryByAlbumId.get(album.album_id);
    return inventory
      ? {
          ...album,
          photo_count: String(inventory.total),
          last_processed_at: importedAt,
        }
      : album;
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
  notes = "Generated Sheets-ready candidate photo rows; review before appending to photos.",
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
    notes,
  };
}

async function fetchInventories(options, albums) {
  const selectedAlbumId = options.allAlbums
    ? ""
    : (await resolveAlbumInput(options.album, options.albums)).albumId;
  const targetAlbums = options.allAlbums
    ? albums
    : [albums.find((album) => album.album_id === selectedAlbumId) ?? {}];
  const inventories = [];

  for (const [index, album] of targetAlbums.entries()) {
    const input = options.allAlbums ? album.album_id : options.album;
    const { ownerPath, albumId, albumUrl } = await resolveAlbumInput(input, options.albums);
    const albumRecord = albums.find((item) => item.album_id === albumId) ?? album;
    console.error(`Progress: fetching photo list for album ${albumId} (${index + 1}/${targetAlbums.length}).`);
    const result = await fetchAlbumPhotoUrls({
      albumId,
      albumUrl,
      expectedPhotoCount: parsePhotoCount(albumRecord.photo_count),
      html: options.input ? await readFile(options.input, "utf8") : "",
      ownerPath,
    });
    assertUniqueInputPhotoIds(result.photoUrls);
    if (result.photoUrls.length === 0) {
      throw new Error(`No photo URLs found in album ${albumId}`);
    }
    if (options.reconciliationOutput && !result.authoritative) {
      throw new Error(`Album ${albumId} did not return a complete Flickr API inventory; refusing reconciliation`);
    }
    inventories.push({
      album: albumRecord,
      albumId,
      albumUrl,
      apiKey: result.apiKey,
      authoritative: result.authoritative,
      photoIds: result.photoUrls.map((photo) => photo.photoId),
      photoUrls: result.photoUrls,
      source: result.source,
      total: result.total,
    });
  }
  return inventories;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const importedAt = options.importedAt || new Date().toISOString();
  console.error(`Progress: reading album catalog from ${options.albums}.`);
  const albums = await readAlbumCatalog(options.albums);
  const inventories = await fetchInventories(options, albums);
  console.error(`Progress: reading existing photos from ${options.photosExport}.`);
  const sourcePhotos = await readPhotoRecords(options.photosExport);
  const sourcePhotoIds = new Set(sourcePhotos.map((photo) => photo.photo_id));
  const albumOrder = albums.map((album) => album.album_id);
  const contextsByPhotoId = new Map();

  if (!options.allAlbums && inventories[0].authoritative !== false) {
    const inventory = inventories[0];
    const freshIds = new Set(inventory.photoIds);
    const managedAlbums = new Set(albumOrder);
    const possibleOrphans = sourcePhotos.filter((photo) => {
      const albumIds = splitAlbumIds(photo.album_ids);
      return albumIds.length === 1 && albumIds[0] === inventory.albumId && !freshIds.has(photo.photo_id);
    });
    for (const [index, photo] of possibleOrphans.entries()) {
      console.error(`Progress: checking Flickr contexts ${index + 1}/${possibleOrphans.length} (${photo.photo_id}).`);
      const contextAlbumIds = await fetchPhotoAlbumIds({ apiKey: inventory.apiKey, photoId: photo.photo_id });
      contextsByPhotoId.set(
        photo.photo_id,
        contextAlbumIds.filter((albumId) => albumId !== inventory.albumId && managedAlbums.has(albumId)),
      );
    }
  }

  const reconciliation = buildPhotoReconciliation({
    albumOrder,
    contextsByPhotoId,
    inventories,
    photos: sourcePhotos,
    scope: options.allAlbums ? "catalog" : "album",
  });
  const memberships = albumMemberships(inventories);
  const photoById = new Map();
  for (const inventory of inventories) {
    for (const photo of inventory.photoUrls) {
      if (!photoById.has(photo.photoId)) {
        photoById.set(photo.photoId, { inventory, photo });
      }
    }
  }

  console.error(`Progress: fetching Flickr metadata for ${reconciliation.new_photo_ids.length} new photo(s).`);
  let completedMetadataCount = 0;
  let lastMetadataPhotoId = "";
  const shouldPrintMetadataProgress = createProgressThrottle();

  function printMetadataProgress({ force = false } = {}) {
    if (!shouldPrintMetadataProgress(completedMetadataCount, { force })) {
      return;
    }
    console.error(`Progress: photo metadata ${completedMetadataCount}/${reconciliation.new_photo_ids.length} complete (${lastMetadataPhotoId}).`);
  }

  const rows = [];
  for (const photoId of reconciliation.new_photo_ids) {
    const { inventory, photo } = photoById.get(photoId) ?? {};
    if (!inventory || !photo) {
      throw new Error(`Missing Flickr source details for new photo ${photoId}`);
    }
    const newRows = await buildCsvRows([photo], {
      album_title: inventory.album.album_title ?? "",
      album_ids: (memberships.get(photoId) ?? [inventory.albumId]).join(";"),
      event_name: inventory.album.event_name ?? "",
      event_year: inventory.album.event_year ?? "",
    }, {
      onProgress: ({ photoId: completedPhotoId }) => {
        completedMetadataCount += 1;
        lastMetadataPhotoId = completedPhotoId;
        printMetadataProgress();
      },
    });
    rows.push(...newRows);
  }
  printMetadataProgress({ force: true });
  const csv = toPhotoCsv(rows);

  if (options.output) {
    console.error(`Progress: writing photo candidate CSV to ${options.output}.`);
    await writeFile(options.output, csv);
    if (options.validate) {
      validatePath("--photos", options.output);
    }
    console.log(`Wrote ${rows.length} Sheets-ready photo row(s) to ${options.output}.`);
  } else {
    process.stdout.write(csv);
  }

  if (options.albumsOutput) {
    console.error(`Progress: writing updated album CSV to ${options.albumsOutput}.`);
    const updatedAlbums = buildUpdatedAlbums({
      albums,
      importedAt,
      inventories,
    });
    await writeFile(options.albumsOutput, toRecordCsv(albumHeaders, updatedAlbums));
    if (options.validate) {
      validatePath("--albums", options.albumsOutput);
    }
    console.log(`Wrote ${updatedAlbums.length} album row(s) with updated last_processed_at to ${options.albumsOutput}.`);
  }

  if (options.batchOutput) {
    console.error(`Progress: writing import batch CSV to ${options.batchOutput}.`);
    const batches = inventories.map((inventory) => {
      const missingCount = inventory.photoIds.filter((photoId) =>
        !sourcePhotoIds.has(photoId) && memberships.get(photoId)?.[0] === inventory.albumId,
      ).length;
      return buildImportBatchRecord({
        albumId: inventory.albumId,
        albumUrl: inventory.albumUrl,
        existingCount: inventory.photoIds.length - missingCount,
        foundCount: inventory.photoIds.length,
        importedAt,
        missingCount,
        notes: `Reconciliation: ${reconciliation.counts.membership_updated} membership update(s), ${reconciliation.counts.deleted} deletion(s), ${reconciliation.counts.reordered} reordered photo(s).`,
        operator: options.operator,
        sourceTool: options.sourceTool,
      });
    });
    await writeFile(options.batchOutput, toRecordCsv(importBatchHeaders, batches));
    if (options.validate) {
      validatePath("--import-batches", options.batchOutput);
    }
    console.log(`Wrote ${batches.length} import batch row(s) to ${options.batchOutput}.`);
  }

  if (options.reconciliationOutput) {
    await writeFile(options.reconciliationOutput, `${JSON.stringify(reconciliation, null, 2)}\n`);
    console.log(`Wrote reconciliation plan to ${options.reconciliationOutput}.`);
  }

  console.error(`Reconciliation: ${rows.length} new, ${reconciliation.counts.membership_updated} membership update(s), ${reconciliation.counts.deleted} deletion(s), ${reconciliation.counts.reordered} reordered photo(s).`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not import album photos: ${error.message}`);
  process.exitCode = 1;
}
