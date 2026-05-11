import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv, parseSemicolonList, toCsvLine } from "../lib/core/csv-utils.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders, photoSchema } from "../lib/core/photo-schema.mjs";
import { projectConfig } from "../lib/core/project-config.mjs";
import { sponsorshipItemHeaders } from "../lib/sheets/sheets-format.mjs";
import { taxonomyToCsv } from "../lib/sheets/taxonomy-sheet.mjs";

const defaultSourceDir = "tmp/sheets-export";
const defaultOutputDir = "tmp/sheets-practice";
const defaultLimit = 50;
const taxonomyPath = "data/tag-taxonomy.json";
const sponsorshipItemsPath = "data/sponsorship-items.json";

function printUsage() {
  console.log(`Usage:
  pnpm sheets:practice:build

Options:
  --source-dir <path>  Directory containing exported formal Sheets CSVs. Default: ${defaultSourceDir}.
  --output-dir <path>  Directory for generated practice spreadsheet CSVs. Default: ${defaultOutputDir}.
  --limit <number>     Number of real photos to include. Default: ${defaultLimit}.
  --no-validate        Skip validation for generated photos/albums/import_batches CSVs.
  --help, -h           Show this help.

This command does not write to Google Sheets. It creates a small practice
spreadsheet data package from real exported Sheets rows. Maintainers can use it
to reset the fixed practice spreadsheet without changing the formal photo index.`);
}

function parsePositiveInteger(value, optionName) {
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw new Error(`${optionName} requires a positive integer`);
  }
  return Number(value);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    limit: defaultLimit,
    outputDir: defaultOutputDir,
    sourceDir: defaultSourceDir,
    validate: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--source-dir") {
      options.sourceDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--limit") {
      options.limit = parsePositiveInteger(args[index + 1] ?? "", "--limit");
      index += 1;
    } else if (arg === "--no-validate") {
      options.validate = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.sourceDir) {
      throw new Error("--source-dir requires a path");
    }
    if (!options.outputDir) {
      throw new Error("--output-dir requires a path");
    }
  }

  return options;
}

function headersMatch(actual, expected) {
  return actual.length === expected.length && expected.every((header, index) => actual[index] === header);
}

function rowsToCsv(headers, rows) {
  return `${[
    headers.join(","),
    ...rows.map((row) => toCsvLine(headers, Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])))),
  ].join("\n")}\n`;
}

async function readTableCsv(path, expectedHeaders) {
  const text = await readFile(path, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error(`${path} is empty`);
  }
  if (!headersMatch(rows[0], expectedHeaders)) {
    throw new Error(`${path} headers do not match expected schema. Re-export formal Sheets with pnpm sheets:export before building practice data.`);
  }
  return rows.slice(1);
}

function pickDistributedRows(rows, limit) {
  if (rows.length <= limit) {
    return rows;
  }

  const selected = [];
  const used = new Set();
  for (let index = 0; index < limit; index += 1) {
    let sourceIndex = Math.floor((index * rows.length) / limit);
    while (used.has(sourceIndex) && sourceIndex < rows.length - 1) {
      sourceIndex += 1;
    }
    used.add(sourceIndex);
    selected.push(rows[sourceIndex]);
  }
  return selected;
}

function albumIdsFromPhotos(photoRows) {
  const albumIdsIndex = photoHeaders.indexOf("album_ids");
  const ids = new Set();
  for (const row of photoRows) {
    for (const albumId of parseSemicolonList(row[albumIdsIndex] ?? "")) {
      ids.add(albumId);
    }
  }
  return ids;
}

function matchingAlbumRows(albumRows, albumIds) {
  const albumIdIndex = albumHeaders.indexOf("album_id");
  return albumRows.filter((row) => albumIds.has(row[albumIdIndex] ?? ""));
}

function emptyCsv(headers) {
  return `${headers.join(",")}\n`;
}

function sponsorshipItemsToCsv(snapshot) {
  const rows = [];
  for (const item of snapshot.items ?? []) {
    const subItems = item.sub_items?.length ? item.sub_items : [{}];
    for (const subItem of subItems) {
      rows.push({
        item_id: item.id,
        name_zh: item.name_zh,
        name_en: item.name_en,
        category: item.type,
        order: String(item.order ?? ""),
        quantity: item.quantity,
        unit: item.unit,
        deadline: item.deadline,
        talent_recruitment_zh: item.talent_recruitment_zh,
        brand_exposure_zh: item.brand_exposure_zh,
        product_promotion_zh: item.product_promotion_zh,
        sub_item_name_zh: subItem.name_zh,
        sub_item_name_en: subItem.name_en,
        sub_item_price: subItem.price,
        sub_item_remaining: subItem.remaining,
      });
    }
  }

  return `${[
    sponsorshipItemHeaders.join(","),
    ...rows.map((row) => toCsvLine(sponsorshipItemHeaders, row)),
  ].join("\n")}\n`;
}

function validateGeneratedCsv(paths) {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/commands/validate-data.mjs",
      "--photos",
      paths.photos,
      "--albums",
      paths.albums,
      "--import-batches",
      paths.importBatches,
    ],
    { stdio: "inherit" },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error("generated practice spreadsheet CSV validation failed");
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const paths = {
    albums: join(options.outputDir, "albums.csv"),
    importBatches: join(options.outputDir, "import_batches.csv"),
    manifest: join(options.outputDir, "manifest.json"),
    photos: join(options.outputDir, "photos.csv"),
    sponsorshipItems: join(options.outputDir, "sponsorship_items.csv"),
    taxonomy: join(options.outputDir, "taxonomy.csv"),
  };

  const sourcePaths = {
    albums: join(options.sourceDir, "albums.csv"),
    photos: join(options.sourceDir, "photos.csv"),
  };

  const [sourcePhotoRows, sourceAlbumRows, taxonomyText, sponsorshipItemsText] = await Promise.all([
    readTableCsv(sourcePaths.photos, photoHeaders),
    readTableCsv(sourcePaths.albums, albumHeaders),
    readFile(taxonomyPath, "utf8"),
    readFile(sponsorshipItemsPath, "utf8"),
  ]);

  const photoRows = pickDistributedRows(sourcePhotoRows, options.limit);
  const albumRows = matchingAlbumRows(sourceAlbumRows, albumIdsFromPhotos(photoRows));
  const taxonomy = JSON.parse(taxonomyText);
  const sponsorshipItems = JSON.parse(sponsorshipItemsText);

  await mkdir(options.outputDir, { recursive: true });
  await Promise.all([
    writeFile(paths.photos, rowsToCsv(photoHeaders, photoRows)),
    writeFile(paths.albums, rowsToCsv(albumHeaders, albumRows)),
    writeFile(paths.importBatches, emptyCsv(importBatchHeaders)),
    writeFile(paths.taxonomy, taxonomyToCsv(taxonomy)),
    writeFile(paths.sponsorshipItems, sponsorshipItemsToCsv(sponsorshipItems)),
  ]);

  const manifest = {
    generated_at: new Date().toISOString(),
    schema_version: photoSchema.version,
    organization: projectConfig.organization,
    source: {
      source_dir: options.sourceDir,
      photos_csv: sourcePaths.photos,
      albums_csv: sourcePaths.albums,
    },
    sample: {
      requested_photo_limit: options.limit,
      source_photo_rows: sourcePhotoRows.length,
      output_photo_rows: photoRows.length,
      output_album_rows: albumRows.length,
    },
    sheets: [
      { name: "photos", path: paths.photos, source: sourcePaths.photos },
      { name: "albums", path: paths.albums, source: sourcePaths.albums },
      { name: "import_batches", path: paths.importBatches, source: "header only" },
      { name: "taxonomy", path: paths.taxonomy, source: taxonomyPath },
      { name: "sponsorship_items", path: paths.sponsorshipItems, source: "data/sponsorship-items.json" },
    ],
    note: "Practice spreadsheet data. It is generated from exported formal Sheets rows for editor training and should not be treated as a second formal photo index.",
  };
  await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);

  if (options.validate) {
    validateGeneratedCsv(paths);
  }

  console.log(`Wrote practice spreadsheet files to ${options.outputDir}.`);
  console.log(`Photos: ${photoRows.length} of ${sourcePhotoRows.length} exported rows.`);
  console.log(`Albums: ${albumRows.length} matching album rows.`);
  console.log("Next: run pnpm sheets:practice:sync to reset the fixed practice spreadsheet.");
}

try {
  await main();
} catch (error) {
  console.error(`Could not build practice spreadsheet CSVs: ${error.message}`);
  process.exitCode = 1;
}
