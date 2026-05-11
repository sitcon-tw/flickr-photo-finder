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

function getCell(row, fieldName) {
  const index = photoHeaders.indexOf(fieldName);
  return index >= 0 ? String(row[index] ?? "") : "";
}

function setCell(row, fieldName, value) {
  const index = photoHeaders.indexOf(fieldName);
  if (index < 0) {
    throw new Error(`photo schema is missing expected field: ${fieldName}`);
  }
  row[index] = value;
}

function hasAnyListValue(row, fieldName) {
  return parseSemicolonList(getCell(row, fieldName)).length > 0;
}

const practiceCaseRequirements = [
  {
    key: "layout",
    matches: (row) =>
      getCell(row, "orientation") === "landscape" ||
      getCell(row, "has_negative_space") === "true" ||
      hasAnyListValue(row, "safe_crop"),
  },
  {
    key: "sponsor",
    matches: (row) => hasAnyListValue(row, "sponsorship_items") || hasAnyListValue(row, "sponsorship_tags"),
  },
  {
    key: "ai-review",
    matches: (row) => ["ai_labeled", "unreviewed"].includes(getCell(row, "curation_status")),
  },
  {
    key: "people-scene",
    matches: (row) =>
      getCell(row, "people_count") !== "" ||
      getCell(row, "subject_type") !== "" ||
      hasAnyListValue(row, "scene_tags"),
  },
  {
    key: "use-mood",
    matches: (row) => hasAnyListValue(row, "mood_tags") || hasAnyListValue(row, "recommended_uses"),
  },
];

function rowIdentity(row) {
  return getCell(row, "photo_id") || row.join("\u0000");
}

function ensurePracticeCoverage(selectedRows, sourceRows) {
  const selected = [...selectedRows];
  const selectedIds = new Set(selected.map(rowIdentity));
  let replacementOffset = 0;

  for (const requirement of practiceCaseRequirements) {
    if (selected.some(requirement.matches)) {
      continue;
    }

    const candidate = sourceRows.find((row) => requirement.matches(row) && !selectedIds.has(rowIdentity(row)));
    if (!candidate) {
      continue;
    }

    const replacementIndex = Math.max(selected.length - 1 - replacementOffset, 0);
    selectedIds.delete(rowIdentity(selected[replacementIndex]));
    selected[replacementIndex] = candidate;
    selectedIds.add(rowIdentity(candidate));
    replacementOffset += 1;
  }

  return selected;
}

function practiceNoteCandidates(row) {
  const candidates = [];
  const orientation = getCell(row, "orientation");
  const hasNegativeSpace = getCell(row, "has_negative_space");
  const peopleCount = getCell(row, "people_count");
  const subjectType = getCell(row, "subject_type");
  const curationStatus = getCell(row, "curation_status");

  if (orientation === "landscape" || hasNegativeSpace === "true" || hasAnyListValue(row, "safe_crop")) {
    candidates.push("判斷網站橫幅、留白與裁切比例。請先看主體、臉部、文字與重要物件是否會被裁掉，再填 safe_crop。");
  }

  if (hasAnyListValue(row, "sponsorship_items") || hasAnyListValue(row, "sponsorship_tags")) {
    candidates.push("贊助欄位要分清楚：sponsorship_items 是贊助品項，sponsorship_tags 是照片能證明的贊助價值。");
  }

  if (curationStatus === "ai_labeled" || curationStatus === "unreviewed") {
    candidates.push("AI 初標只是候選。請用人審重新判斷，沒有明確用途時 recommended_uses 可以留空。");
  }

  if (peopleCount !== "" || subjectType || hasAnyListValue(row, "scene_tags")) {
    candidates.push("先估可辨識人數，再用 subject_type 描述第一眼主體，用 scene_tags 補活動情境。");
  }

  if (hasAnyListValue(row, "mood_tags") || hasAnyListValue(row, "recommended_uses")) {
    candidates.push("用途與氛圍分開判斷：mood_tags 是照片帶來的感受，recommended_uses 則要對應明確工作情境。");
  }

  candidates.push("先寫中立 visual_description，再判斷用途。只描述畫面可見內容，不確定的欄位可以留空。");
  return candidates;
}

function practiceNoteForRow(row, rowIndex) {
  if (hasAnyListValue(row, "sponsorship_items") || hasAnyListValue(row, "sponsorship_tags")) {
    return "練習提示：贊助欄位要分清楚：sponsorship_items 是贊助品項，sponsorship_tags 是照片能證明的贊助價值。";
  }

  const candidates = practiceNoteCandidates(row);
  return `練習提示：${candidates[rowIndex % candidates.length]}`;
}

function withPracticeCurationNotes(photoRows) {
  return photoRows.map((row, index) => {
    const nextRow = [...row];
    setCell(nextRow, "curation_notes", practiceNoteForRow(nextRow, index));
    return nextRow;
  });
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

  const photoRows = withPracticeCurationNotes(
    ensurePracticeCoverage(pickDistributedRows(sourcePhotoRows, options.limit), sourcePhotoRows),
  );
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
    note: "Practice spreadsheet data. It is generated from exported formal Sheets rows for editor training and should not be treated as a second formal photo index. photos.curation_notes is overwritten with practice-only training prompts.",
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
