import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv, parseSemicolonList } from "../lib/core/csv-utils.mjs";
import { fieldLabel, formatDisplayValue } from "../lib/core/metadata-display.mjs";
import {
  albumHeaders,
  photoFields,
  photoHeaders,
  requiredFields,
  reviewedRequiredFields,
} from "../lib/core/photo-schema.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import {
  sheetsExportAlbumsPath,
  sheetsExportPhotosPath,
} from "../lib/core/workflow-paths.mjs";
import { createSheetsService, explainGoogleSheetsError, sheetsReadonlyScopes } from "../lib/sheets/google-sheets-client.mjs";
import { readSheetRecords } from "../lib/sheets/sheets-records.mjs";

const defaultInputDir = "tmp/sheets-export";
const allowedSources = new Set(["export", "sheets"]);
const reportFieldNames = [
  "event_name",
  "event_year",
  "photographer",
  "license",
  "subject_type",
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "orientation",
  "has_negative_space",
  "safe_crop",
  "visual_description",
  "public_use_status",
  "priority_level",
  "curation_status",
];
const curationStatuses = ["reviewed", "ai_labeled", "unreviewed", ""];
const publicUseStatuses = ["approved", "needs_review", "avoid", ""];

function printUsage() {
  console.log(`Usage:
  pnpm sheets:report

Options:
  --source <source>       Data source: export or sheets. Default: export.
  --input-dir <path>      Directory containing photos.csv and albums.csv. Default: tmp/sheets-export.
  --photos <path>         Photos CSV path. Default: tmp/sheets-export/photos.csv.
  --albums <path>         Albums CSV path. Default: tmp/sheets-export/albums.csv.
  --spreadsheet-id <id>   Google Sheets spreadsheet ID for --source sheets. Default: config/project.json googleSheets.spreadsheetId.
  --limit <count>         Max sample IDs per finding. Default: 8.
  --help, -h              Show this help.

This command is read-only. With --source export, run pnpm sheets:export first
to refresh tmp/sheets-export from the formal Google Sheets database. With
--source sheets, GOOGLE_APPLICATION_CREDENTIALS must point to a service account
credential with read access to the target spreadsheet.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    albumsPath: sheetsExportAlbumsPath,
    help: false,
    inputDir: defaultInputDir,
    limit: 8,
    photosPath: sheetsExportPhotosPath,
    source: "export",
    spreadsheetId: googleSheetsSpreadsheetId,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--source") {
      options.source = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--input-dir") {
      options.inputDir = args[index + 1] ?? "";
      options.photosPath = options.inputDir ? join(options.inputDir, "photos.csv") : "";
      options.albumsPath = options.inputDir ? join(options.inputDir, "albums.csv") : "";
      index += 1;
    } else if (arg === "--photos") {
      options.photosPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--albums") {
      options.albumsPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--spreadsheet-id") {
      options.spreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--limit") {
      options.limit = Number(args[index + 1] ?? "");
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!allowedSources.has(options.source)) {
      throw new Error(`--source must be one of: ${[...allowedSources].join(", ")}`);
    }
    if (options.source === "export") {
      if (!options.photosPath) {
        throw new Error("--photos requires a path");
      }
      if (!options.albumsPath) {
        throw new Error("--albums requires a path");
      }
    }
    if (options.source === "sheets" && !options.spreadsheetId) {
      throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
    }
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error("--limit must be a positive integer");
    }
  }

  return options;
}

function rowsToRecords(path, text, expectedHeaders) {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) {
    throw new Error(`${path}: missing header row`);
  }
  for (const [index, expected] of expectedHeaders.entries()) {
    if (headers[index] !== expected) {
      throw new Error(`${path}: header ${index + 1} should be "${expected}", got "${headers[index] ?? ""}"`);
    }
  }
  if (headers.length !== expectedHeaders.length) {
    throw new Error(`${path}: expected ${expectedHeaders.length} headers, got ${headers.length}`);
  }
  return rows.map((row) => Object.fromEntries(expectedHeaders.map((header, index) => [header, row[index] ?? ""])));
}

async function readExportRecords(options) {
  const [photosText, albumsText] = await Promise.all([
    readFile(options.photosPath, "utf8"),
    readFile(options.albumsPath, "utf8"),
  ]);
  return {
    albums: rowsToRecords(options.albumsPath, albumsText, albumHeaders),
    photos: rowsToRecords(options.photosPath, photosText, photoHeaders),
    sourceLabel: `${options.photosPath}, ${options.albumsPath}`,
  };
}

async function readSheetsRecords(options) {
  const sheets = await createSheetsService({ scopes: sheetsReadonlyScopes });
  const [photos, albums] = await Promise.all([
    readSheetRecords({ sheets, sheetName: "photos", spreadsheetId: options.spreadsheetId }),
    readSheetRecords({ sheets, sheetName: "albums", spreadsheetId: options.spreadsheetId }),
  ]);
  return {
    albums,
    photos,
    sourceLabel: `Google Sheets ${options.spreadsheetId}`,
  };
}

function normalizeValue(value) {
  return String(value ?? "").trim();
}

function countBy(records, fieldName, expectedValues = []) {
  const counts = new Map(expectedValues.map((value) => [value, 0]));
  for (const record of records) {
    const value = normalizeValue(record[fieldName]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    const leftKnown = expectedValues.indexOf(left[0]);
    const rightKnown = expectedValues.indexOf(right[0]);
    if (leftKnown !== -1 || rightKnown !== -1) {
      return (leftKnown === -1 ? Number.MAX_SAFE_INTEGER : leftKnown) - (rightKnown === -1 ? Number.MAX_SAFE_INTEGER : rightKnown);
    }
    return String(left[0]).localeCompare(String(right[0]));
  });
}

function pct(count, total) {
  if (total === 0) {
    return "0.0%";
  }
  return `${((count / total) * 100).toFixed(1)}%`;
}

function formatStatusValue(fieldName, value) {
  if (!value) {
    return "(空白)";
  }
  return formatDisplayValue(fieldName, value, { includeRaw: true, blank: "(空白)" });
}

function samplePhotoIds(records, limit) {
  return records
    .slice(0, limit)
    .map((record) => record.photo_id || "(no photo_id)")
    .join(", ");
}

function sampleAlbumIds(records, limit) {
  return records
    .slice(0, limit)
    .map((record) => record.album_id || "(no album_id)")
    .join(", ");
}

function addFinding(findings, severity, title, detail = "") {
  findings.push({ detail, severity, title });
}

function analyzePhotos(photos, findings, limit) {
  for (const fieldName of requiredFields) {
    const missing = photos.filter((photo) => !normalizeValue(photo[fieldName]));
    if (missing.length > 0) {
      addFinding(
        findings,
        "ERROR",
        `${fieldLabel(fieldName, { includeRaw: true })} 有 ${missing.length} 張空白`,
        `範例 photo_id: ${samplePhotoIds(missing, limit)}`,
      );
    }
  }

  const duplicateFields = ["photo_id", "photo_url"];
  for (const fieldName of duplicateFields) {
    const seen = new Map();
    const duplicates = [];
    for (const photo of photos) {
      const value = normalizeValue(photo[fieldName]);
      if (!value) {
        continue;
      }
      if (seen.has(value)) {
        duplicates.push(photo);
      } else {
        seen.set(value, photo);
      }
    }
    if (duplicates.length > 0) {
      addFinding(
        findings,
        "ERROR",
        `${fieldLabel(fieldName, { includeRaw: true })} 有 ${duplicates.length} 張重複`,
        `範例 photo_id: ${samplePhotoIds(duplicates, limit)}`,
      );
    }
  }

  const reviewed = photos.filter((photo) => photo.curation_status === "reviewed");
  const incompleteReviewed = reviewed.filter((photo) => reviewedRequiredFields.some((fieldName) => !normalizeValue(photo[fieldName])));
  if (incompleteReviewed.length > 0) {
    addFinding(
      findings,
      "WARNING",
      `reviewed 照片有 ${incompleteReviewed.length} 張缺少 reviewed 完整度欄位`,
      `必填欄位: ${reviewedRequiredFields.map((fieldName) => fieldLabel(fieldName, { includeRaw: true })).join(", ")}；範例 photo_id: ${samplePhotoIds(incompleteReviewed, limit)}`,
    );
  }

  const aiLabeled = photos.filter((photo) => photo.curation_status === "ai_labeled");
  if (aiLabeled.length > 0) {
    addFinding(
      findings,
      "WARNING",
      `AI 待人工 review 照片 ${aiLabeled.length} 張 (${pct(aiLabeled.length, photos.length)})`,
      `範例 photo_id: ${samplePhotoIds(aiLabeled, limit)}`,
    );
  }

  const approvedMissingAttribution = photos.filter(
    (photo) => photo.public_use_status === "approved" && (!normalizeValue(photo.photographer) || !normalizeValue(photo.license)),
  );
  if (approvedMissingAttribution.length > 0) {
    addFinding(
      findings,
      "WARNING",
      `approved 照片有 ${approvedMissingAttribution.length} 張缺攝影師或授權資訊`,
      `公開使用前建議補齊 photographer / license；範例 photo_id: ${samplePhotoIds(approvedMissingAttribution, limit)}`,
    );
  }

  const missingFieldCounts = reportFieldNames
    .map((fieldName) => ({
      count: photos.filter((photo) => !normalizeValue(photo[fieldName])).length,
      fieldName,
    }))
    .filter((entry) => entry.count > 0)
    .sort((left, right) => right.count - left.count);

  if (missingFieldCounts.length > 0) {
    addFinding(
      findings,
      "INFO",
      "欄位空白概況",
      missingFieldCounts
        .slice(0, 10)
        .map((entry) => `${fieldLabel(entry.fieldName, { includeRaw: true })}: ${entry.count} (${pct(entry.count, photos.length)})`)
        .join("；"),
    );
  }
}

function analyzeAlbums(albums, photos, findings, limit) {
  const processed = albums.filter((album) => normalizeValue(album.last_processed_at));
  const unprocessed = albums.filter((album) => !normalizeValue(album.last_processed_at));
  addFinding(
    findings,
    "INFO",
    `相簿處理狀態：已處理 ${processed.length} 本，未處理 ${unprocessed.length} 本`,
    unprocessed.length > 0 ? `未處理範例 album_id: ${sampleAlbumIds(unprocessed, limit)}` : "",
  );

  const albumsMissingContext = albums.filter((album) => !normalizeValue(album.event_name) || !normalizeValue(album.event_year));
  if (albumsMissingContext.length > 0) {
    addFinding(
      findings,
      "WARNING",
      `相簿有 ${albumsMissingContext.length} 本缺活動名稱或年份`,
      `範例 album_id: ${sampleAlbumIds(albumsMissingContext, limit)}`,
    );
  }

  const albumIdSet = new Set(albums.map((album) => normalizeValue(album.album_id)).filter(Boolean));
  const unknownAlbumRefs = photos.filter((photo) => parseSemicolonList(photo.album_ids).some((albumId) => !albumIdSet.has(albumId)));
  if (unknownAlbumRefs.length > 0) {
    addFinding(
      findings,
      "WARNING",
      `photos.album_ids 有 ${unknownAlbumRefs.length} 張引用 albums 表不存在的相簿 ID`,
      `範例 photo_id: ${samplePhotoIds(unknownAlbumRefs, limit)}`,
    );
  }

  const photosWithoutAlbum = photos.filter((photo) => parseSemicolonList(photo.album_ids).length === 0);
  if (photosWithoutAlbum.length > 0) {
    addFinding(
      findings,
      "WARNING",
      `照片有 ${photosWithoutAlbum.length} 張沒有來源相簿 ID`,
      `範例 photo_id: ${samplePhotoIds(photosWithoutAlbum, limit)}`,
    );
  }
}

async function analyzeSponsorship(photos, findings, limit) {
  const sponsorshipText = await readFile("data/sponsorship-items.json", "utf8");
  const sponsorshipItems = JSON.parse(sponsorshipText).items ?? [];
  const sponsorshipItemNames = sponsorshipItems.map((item) => item.name_zh).filter(Boolean);
  const coveredItems = new Map();
  let photosWithItems = 0;
  let photosWithTags = 0;
  const tagsWithoutItems = [];

  for (const photo of photos) {
    const items = parseSemicolonList(photo.sponsorship_items);
    const tags = parseSemicolonList(photo.sponsorship_tags);
    if (items.length > 0) {
      photosWithItems += 1;
    }
    if (tags.length > 0) {
      photosWithTags += 1;
    }
    if (tags.length > 0 && items.length === 0) {
      tagsWithoutItems.push(photo);
    }
    for (const item of items) {
      coveredItems.set(item, (coveredItems.get(item) ?? 0) + 1);
    }
  }

  addFinding(
    findings,
    "INFO",
    `贊助覆蓋率：${photosWithItems} 張有贊助品項，${photosWithTags} 張有贊助價值標籤`,
    `已覆蓋 CFS 品項 ${sponsorshipItemNames.filter((name) => coveredItems.has(name)).length}/${sponsorshipItemNames.length}；照片占比 ${pct(photosWithItems, photos.length)}`,
  );

  if (tagsWithoutItems.length > 0) {
    addFinding(
      findings,
      "WARNING",
      `有 ${tagsWithoutItems.length} 張照片有 sponsorship_tags 但沒有 sponsorship_items`,
      `若是贊助佐證用途，建議確認是否應對應 CFS 品項；範例 photo_id: ${samplePhotoIds(tagsWithoutItems, limit)}`,
    );
  }

  const unknownItems = [...coveredItems.keys()].filter((name) => !sponsorshipItemNames.includes(name));
  if (unknownItems.length > 0) {
    addFinding(
      findings,
      "ERROR",
      `sponsorship_items 有 ${unknownItems.length} 個值不在 CFS snapshot`,
      unknownItems.slice(0, limit).join(", "),
    );
  }
}

function printDistribution(title, rows, fieldName, total) {
  console.log(`\n${title}`);
  for (const [value, count] of rows) {
    console.log(`- ${formatStatusValue(fieldName, value)}: ${count} (${pct(count, total)})`);
  }
}

function printFindings(findings) {
  const severityOrder = ["ERROR", "WARNING", "INFO"];
  const sorted = [...findings].sort((left, right) => severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity));
  console.log("\n資料品質訊號");
  for (const finding of sorted) {
    console.log(`[${finding.severity}] ${finding.title}`);
    if (finding.detail) {
      console.log(`  ${finding.detail}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const { albums, photos, sourceLabel } = options.source === "sheets"
    ? await readSheetsRecords(options)
    : await readExportRecords(options);

  const findings = [];
  analyzePhotos(photos, findings, options.limit);
  analyzeAlbums(albums, photos, findings, options.limit);
  await analyzeSponsorship(photos, findings, options.limit);

  console.log("正式 Sheets 資料品質報表");
  console.log(`Source: ${sourceLabel}`);
  console.log(`Generated at: ${new Date().toISOString()}`);
  console.log(`Photos: ${photos.length}`);
  console.log(`Albums: ${albums.length}`);

  printDistribution(
    "整理狀態分布",
    countBy(photos, "curation_status", curationStatuses),
    "curation_status",
    photos.length,
  );
  printDistribution(
    "公開使用狀態分布",
    countBy(photos, "public_use_status", publicUseStatuses),
    "public_use_status",
    photos.length,
  );

  const fieldNames = new Set(photoFields.map((field) => field.name));
  const unexpectedFields = reportFieldNames.filter((fieldName) => !fieldNames.has(fieldName));
  if (unexpectedFields.length > 0) {
    addFinding(findings, "ERROR", `內建報表欄位不存在於 schema: ${unexpectedFields.join(", ")}`);
  }

  printFindings(findings);
}

try {
  await main();
} catch (error) {
  console.error(`Could not build Sheets quality report: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
