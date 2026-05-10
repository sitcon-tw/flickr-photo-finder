import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv, toCsvLine } from "./csv-utils.mjs";
import { albumsPath } from "./album-catalog.mjs";
import { projectConfig } from "./project-config.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders, photoSchema } from "./photo-schema.mjs";
import { sponsorshipItemHeaders, taxonomyHeaders } from "./sheets-format.mjs";

const defaultOutputDir = "tmp/sheets-init";
const taxonomyPath = "data/tag-taxonomy.json";
const sponsorshipItemsPath = "data/sponsorship-items.json";

function printUsage() {
  console.log(`Usage:
  pnpm sheets:init

Options:
  --output-dir <path>  Directory for generated Google Sheets initialization CSVs. Default: tmp/sheets-init.
  --albums <path>      Existing discovered albums CSV to seed the albums sheet. Default: fixtures/albums.csv.
  --empty-albums       Generate albums.csv with only the header row.
  --no-validate        Skip validation for generated photos/albums/import_batches CSVs.

This command does not write to Google Sheets. It produces CSV files that humans
can use to create the initial photos, albums, import_batches, taxonomy, and
sponsorship_items tabs.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    albums: albumsPath,
    emptyAlbums: false,
    help: false,
    outputDir: defaultOutputDir,
    validate: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--output-dir") {
      options.outputDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--albums") {
      options.albums = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--empty-albums") {
      options.emptyAlbums = true;
    } else if (arg === "--no-validate") {
      options.validate = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.outputDir) {
      throw new Error("--output-dir requires a path");
    }
    if (!options.emptyAlbums && !options.albums) {
      throw new Error("--albums requires a path unless --empty-albums is used");
    }
  }

  return options;
}

function emptyCsv(headers) {
  return `${headers.join(",")}\n`;
}

async function readAlbumsCsv(path) {
  const text = await readFile(path, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return emptyCsv(albumHeaders);
  }

  const [headers] = rows;
  if (headers.join(",") !== albumHeaders.join(",")) {
    throw new Error(`${path} headers do not match albums schema`);
  }

  return text.endsWith("\n") ? text : `${text}\n`;
}

function taxonomyToCsv(taxonomy) {
  const rows = [];
  const optionLabels = taxonomy.option_labels ?? {};

  for (const [key, values] of Object.entries(taxonomy)) {
    if (!Array.isArray(values)) {
      continue;
    }

    values.forEach((value, index) => {
      rows.push({
        taxonomy_key: key,
        value,
        label_zh: optionLabels[key]?.[value] ?? "",
        order: String(index + 1),
      });
    });
  }

  return `${[taxonomyHeaders.join(","), ...rows.map((row) => toCsvLine(taxonomyHeaders, row))].join("\n")}\n`;
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
      "scripts/validate-data.mjs",
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
    throw new Error("generated Sheets initialization CSV validation failed");
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  await mkdir(options.outputDir, { recursive: true });

  const paths = {
    photos: join(options.outputDir, "photos.csv"),
    albums: join(options.outputDir, "albums.csv"),
    importBatches: join(options.outputDir, "import_batches.csv"),
    taxonomy: join(options.outputDir, "taxonomy.csv"),
    sponsorshipItems: join(options.outputDir, "sponsorship_items.csv"),
    manifest: join(options.outputDir, "manifest.json"),
  };

  const [taxonomyText, sponsorshipItemsText] = await Promise.all([
    readFile(taxonomyPath, "utf8"),
    readFile(sponsorshipItemsPath, "utf8"),
  ]);
  const taxonomy = JSON.parse(taxonomyText);
  const sponsorshipItems = JSON.parse(sponsorshipItemsText);
  const albumsCsv = options.emptyAlbums ? emptyCsv(albumHeaders) : await readAlbumsCsv(options.albums);

  await Promise.all([
    writeFile(paths.photos, emptyCsv(photoHeaders)),
    writeFile(paths.albums, albumsCsv),
    writeFile(paths.importBatches, emptyCsv(importBatchHeaders)),
    writeFile(paths.taxonomy, taxonomyToCsv(taxonomy)),
    writeFile(paths.sponsorshipItems, sponsorshipItemsToCsv(sponsorshipItems)),
  ]);

  const manifest = {
    generated_at: new Date().toISOString(),
    schema_version: photoSchema.version,
    organization: projectConfig.organization,
    flickr: projectConfig.flickr,
    sheets: [
      { name: "photos", path: paths.photos, source: "data/photo-schema.json" },
      { name: "albums", path: paths.albums, source: options.emptyAlbums ? "header only" : options.albums },
      { name: "import_batches", path: paths.importBatches, source: "data/photo-schema.json" },
      { name: "taxonomy", path: paths.taxonomy, source: taxonomyPath },
      { name: "sponsorship_items", path: paths.sponsorshipItems, source: sponsorshipItemsPath },
    ],
    note: "Create Google Sheets tabs with these exact names, then import or paste each CSV into its matching tab. Do not commit formal Sheets data back into the repo.",
  };
  await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);

  if (options.validate) {
    validateGeneratedCsv(paths);
  }

  console.log(`Wrote Google Sheets initialization files to ${options.outputDir}.`);
  console.log("Create tabs: photos, albums, import_batches, taxonomy, sponsorship_items.");
}

try {
  await main();
} catch (error) {
  console.error(`Could not initialize Sheets CSVs: ${error.message}`);
  process.exitCode = 1;
}
