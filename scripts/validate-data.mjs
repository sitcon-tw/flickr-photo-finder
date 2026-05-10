import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { parseCsv, parseSemicolonList } from "./csv-utils.mjs";
import "./project-config.mjs";
import {
  albumHeaders,
  controlledListFields,
  controlledScalarFields,
  importBatchHeaders,
  listFields,
  photoFields,
  photoHeaders,
  requiredFields,
  reviewedRequiredFields,
} from "./photo-schema.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm validate:data

Options:
  --photos <path>             Photos CSV path. Default: fixtures/photos.csv.
  --albums <path>             Albums CSV path. Default: fixtures/albums.csv.
  --import-batches <path>     Import batches CSV path. Default: fixtures/import-batches.csv.
  --taxonomy <path>           Tag taxonomy JSON path. Default: data/tag-taxonomy.json.
  --sponsorship-items <path>  Sponsorship items JSON path. Default: data/sponsorship-items.json.
  --help, -h                  Show this help.

This command validates local sample/export data against the repo schema,
taxonomy, and sponsorship items snapshot.`);
}

function parseArgs(argv) {
  const paths = {
    albums: "fixtures/albums.csv",
    importBatches: "fixtures/import-batches.csv",
    photos: "fixtures/photos.csv",
    taxonomy: "data/tag-taxonomy.json",
    sponsorshipItems: "data/sponsorship-items.json",
  };

  const args = argv.slice(2).filter((arg) => arg !== "--");
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg === "--albums") {
      paths.albums = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--import-batches") {
      paths.importBatches = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--photos") {
      paths.photos = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--taxonomy") {
      paths.taxonomy = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--sponsorship-items") {
      paths.sponsorshipItems = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  const optionNames = {
    albums: "--albums",
    importBatches: "--import-batches",
    photos: "--photos",
    sponsorshipItems: "--sponsorship-items",
    taxonomy: "--taxonomy",
  };

  for (const [name, path] of Object.entries(paths)) {
    if (!path) {
      throw new Error(`${optionNames[name]} requires a path`);
    }
  }

  return paths;
}

const paths = parseArgs(process.argv);

const errors = [];

function addError(message) {
  errors.push(message);
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isNonNegativeInteger(value) {
  return /^(0|[1-9]\d*)$/.test(value);
}

function formatRow(rowNumber, field) {
  return `${paths.photos}:${rowNumber} ${field}`;
}

function validateHeaders(path, headers, expectedHeaders) {
  if (headers.length !== expectedHeaders.length) {
    addError(
      `${path}: expected ${expectedHeaders.length} headers, got ${headers.length}`,
    );
  }

  expectedHeaders.forEach((expected, index) => {
    if (headers[index] !== expected) {
      addError(
        `${path}: header ${index + 1} should be "${expected}", got "${headers[index] ?? ""}"`,
      );
    }
  });
}

function validateTaxonomy(taxonomy, sponsorshipItems) {
  const requiredTaxonomyKeys = [
    ...controlledListFields,
    ...controlledScalarFields,
    "sponsorship_item_categories",
  ];

  for (const key of requiredTaxonomyKeys) {
    if (!Array.isArray(taxonomy[key])) {
      addError(`${paths.taxonomy}: "${key}" must be an array`);
      continue;
    }

    const duplicateValues = taxonomy[key].filter(
      (value, index, values) => values.indexOf(value) !== index,
    );
    if (duplicateValues.length > 0) {
      addError(
        `${paths.taxonomy}: "${key}" has duplicate values: ${[...new Set(duplicateValues)].join(", ")}`,
      );
    }
  }

  if (!Array.isArray(sponsorshipItems.items)) {
    addError(`${paths.sponsorshipItems}: "items" must be an array`);
    return;
  }

  const itemNames = sponsorshipItems.items.map((item) => item.name_zh);
  const taxonomyNames = taxonomy.sponsorship_items ?? [];

  const missingFromTaxonomy = itemNames.filter(
    (name) => !taxonomyNames.includes(name),
  );
  const missingFromSnapshot = taxonomyNames.filter(
    (name) => !itemNames.includes(name),
  );

  if (missingFromTaxonomy.length > 0) {
    addError(
      `${paths.taxonomy}: sponsorship_items missing snapshot items: ${missingFromTaxonomy.join(", ")}`,
    );
  }

  if (missingFromSnapshot.length > 0) {
    addError(
      `${paths.taxonomy}: sponsorship_items not found in snapshot: ${missingFromSnapshot.join(", ")}`,
    );
  }

  validateOptionLabels(taxonomy);
}

function validateOptionLabels(taxonomy) {
  const optionLabels = taxonomy.option_labels;
  if (!optionLabels || typeof optionLabels !== "object" || Array.isArray(optionLabels)) {
    addError(`${paths.taxonomy}: "option_labels" must be an object`);
    return;
  }

  const selectableFields = new Map();
  for (const field of photoFields) {
    if (field.taxonomy_key) {
      selectableFields.set(field.name, {
        required: controlledScalarFields.includes(field.name),
        values: taxonomy[field.taxonomy_key] ?? [],
      });
    } else if (field.type === "boolean") {
      selectableFields.set(field.name, {
        required: true,
        values: ["true", "false"],
      });
    }
  }

  for (const fieldName of Object.keys(optionLabels)) {
    if (!selectableFields.has(fieldName)) {
      addError(`${paths.taxonomy}: option_labels.${fieldName} does not match a selectable photo field`);
      continue;
    }
    const labels = optionLabels[fieldName];
    if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
      addError(`${paths.taxonomy}: option_labels.${fieldName} must be an object`);
      continue;
    }

    const allowedValues = new Set(selectableFields.get(fieldName).values);
    const seenLabels = new Map();
    for (const [value, label] of Object.entries(labels)) {
      if (!allowedValues.has(value)) {
        addError(`${paths.taxonomy}: option_labels.${fieldName}.${value} does not match a valid option`);
      }
      const normalizedLabel = String(label || "").trim();
      if (!normalizedLabel) {
        addError(`${paths.taxonomy}: option_labels.${fieldName}.${value} must not be blank`);
        continue;
      }
      if (seenLabels.has(normalizedLabel)) {
        addError(
          `${paths.taxonomy}: option_labels.${fieldName} has duplicate label "${normalizedLabel}" for "${seenLabels.get(normalizedLabel)}" and "${value}"`,
        );
      }
      seenLabels.set(normalizedLabel, value);
    }
  }

  for (const [fieldName, definition] of selectableFields.entries()) {
    if (!definition.required) {
      continue;
    }
    const labels = optionLabels[fieldName] ?? {};
    const missing = definition.values.filter((value) => !String(labels[value] || "").trim());
    if (missing.length > 0) {
      addError(`${paths.taxonomy}: option_labels.${fieldName} missing labels for ${missing.join(", ")}`);
    }
  }
}

function validatePhotoRow(row, rowNumber, taxonomy) {
  const photo = Object.fromEntries(photoHeaders.map((header, index) => [header, row[index] ?? ""]));

  if (row.length !== photoHeaders.length) {
    addError(
      `${paths.photos}:${rowNumber} expected ${photoHeaders.length} columns, got ${row.length}`,
    );
  }

  for (const field of requiredFields) {
    if (!photo[field].trim()) {
      addError(`${formatRow(rowNumber, field)} is required`);
    }
  }

  for (const field of ["photo_url", "image_preview_url"]) {
    if (photo[field] && !isValidUrl(photo[field])) {
      addError(`${formatRow(rowNumber, field)} must be an http(s) URL`);
    }
  }

  if (photo.event_year && !/^\d{4}$/.test(photo.event_year)) {
    addError(`${formatRow(rowNumber, "event_year")} must be a four-digit year`);
  }

  if (photo.people_count && !isNonNegativeInteger(photo.people_count)) {
    addError(`${formatRow(rowNumber, "people_count")} must be a non-negative integer`);
  }

  if (photo.has_negative_space && !["true", "false"].includes(photo.has_negative_space)) {
    addError(`${formatRow(rowNumber, "has_negative_space")} must be true or false`);
  }

  for (const field of controlledScalarFields) {
    if (photo[field] && !taxonomy[field]?.includes(photo[field])) {
      addError(
        `${formatRow(rowNumber, field)} has unknown value "${photo[field]}"`,
      );
    }
  }

  for (const field of listFields) {
    const values = parseSemicolonList(photo[field]);
    if (values.length !== new Set(values).size) {
      addError(`${formatRow(rowNumber, field)} has duplicate values`);
    }
  }

  for (const field of controlledListFields) {
    for (const value of parseSemicolonList(photo[field])) {
      if (!taxonomy[field]?.includes(value)) {
        addError(`${formatRow(rowNumber, field)} has unknown value "${value}"`);
      }
    }
  }

  validateReviewedPhotoRow(photo, rowNumber);
}

function validateReviewedPhotoRow(photo, rowNumber) {
  if (photo.curation_status !== "reviewed") {
    return;
  }

  for (const field of reviewedRequiredFields) {
    if (!photo[field].trim()) {
      addError(`${formatRow(rowNumber, field)} is required for reviewed photos`);
    }
  }
}

function validateUniquePhotoFields(photoRows) {
  const seen = {
    photo_id: new Map(),
    photo_url: new Map(),
  };

  photoRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const photo = Object.fromEntries(
      photoHeaders.map((header, fieldIndex) => [header, row[fieldIndex] ?? ""]),
    );

    for (const field of Object.keys(seen)) {
      const value = photo[field].trim();
      if (!value) {
        continue;
      }

      if (seen[field].has(value)) {
        addError(
          `${formatRow(rowNumber, field)} duplicates row ${seen[field].get(value)}`,
        );
      } else {
        seen[field].set(value, rowNumber);
      }
    }
  });
}

function formatAlbumRow(rowNumber, field) {
  return `${paths.albums}:${rowNumber} ${field}`;
}

function validateAlbumRow(row, rowNumber) {
  const album = Object.fromEntries(albumHeaders.map((header, index) => [header, row[index] ?? ""]));

  if (row.length !== albumHeaders.length) {
    addError(
      `${paths.albums}:${rowNumber} expected ${albumHeaders.length} columns, got ${row.length}`,
    );
  }

  for (const field of ["album_id", "album_url", "album_title"]) {
    if (!album[field].trim()) {
      addError(`${formatAlbumRow(rowNumber, field)} is required`);
    }
  }

  if (album.album_id && !/^\d+$/.test(album.album_id)) {
    addError(`${formatAlbumRow(rowNumber, "album_id")} must be a Flickr album ID`);
  }

  if (album.album_url && !isValidUrl(album.album_url)) {
    addError(`${formatAlbumRow(rowNumber, "album_url")} must be an http(s) URL`);
  }

  if (album.album_url && album.album_id && !album.album_url.includes(`/albums/${album.album_id}`)) {
    addError(`${formatAlbumRow(rowNumber, "album_url")} must contain album_id ${album.album_id}`);
  }

  if (album.event_year && !/^\d{4}$/.test(album.event_year)) {
    addError(`${formatAlbumRow(rowNumber, "event_year")} must be a four-digit year`);
  }

  if (album.photo_count && !isNonNegativeInteger(album.photo_count)) {
    addError(`${formatAlbumRow(rowNumber, "photo_count")} must be a non-negative integer`);
  }

  if (album.last_processed_at && Number.isNaN(Date.parse(album.last_processed_at))) {
    addError(`${formatAlbumRow(rowNumber, "last_processed_at")} must be a valid date or datetime`);
  }
}

function validateUniqueAlbumFields(albumRows) {
  const seen = {
    album_id: new Map(),
    album_url: new Map(),
  };

  albumRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const album = Object.fromEntries(
      albumHeaders.map((header, fieldIndex) => [header, row[fieldIndex] ?? ""]),
    );

    for (const field of Object.keys(seen)) {
      const value = album[field].trim();
      if (!value) {
        continue;
      }

      if (seen[field].has(value)) {
        addError(
          `${formatAlbumRow(rowNumber, field)} duplicates row ${seen[field].get(value)}`,
        );
      } else {
        seen[field].set(value, rowNumber);
      }
    }
  });
}

function formatImportBatchRow(rowNumber, field) {
  return `${paths.importBatches}:${rowNumber} ${field}`;
}

function validateImportBatchRow(row, rowNumber) {
  const batch = Object.fromEntries(
    importBatchHeaders.map((header, index) => [header, row[index] ?? ""]),
  );

  if (row.length !== importBatchHeaders.length) {
    addError(
      `${paths.importBatches}:${rowNumber} expected ${importBatchHeaders.length} columns, got ${row.length}`,
    );
  }

  for (const field of [
    "batch_id",
    "album_id",
    "album_url",
    "imported_at",
    "source_tool",
    "found_photo_count",
    "new_photo_count",
    "skipped_photo_count",
  ]) {
    if (!batch[field].trim()) {
      addError(`${formatImportBatchRow(rowNumber, field)} is required`);
    }
  }

  if (batch.album_id && !/^\d+$/.test(batch.album_id)) {
    addError(`${formatImportBatchRow(rowNumber, "album_id")} must be a Flickr album ID`);
  }

  if (batch.album_url && !isValidUrl(batch.album_url)) {
    addError(`${formatImportBatchRow(rowNumber, "album_url")} must be an http(s) URL`);
  }

  if (batch.album_url && batch.album_id && !batch.album_url.includes(`/albums/${batch.album_id}`)) {
    addError(`${formatImportBatchRow(rowNumber, "album_url")} must contain album_id ${batch.album_id}`);
  }

  if (batch.imported_at && Number.isNaN(Date.parse(batch.imported_at))) {
    addError(`${formatImportBatchRow(rowNumber, "imported_at")} must be a valid date or datetime`);
  }

  for (const field of ["found_photo_count", "new_photo_count", "skipped_photo_count"]) {
    if (batch[field] && !isNonNegativeInteger(batch[field])) {
      addError(`${formatImportBatchRow(rowNumber, field)} must be a non-negative integer`);
    }
  }
}

function validateUniqueImportBatchFields(importBatchRows) {
  const seen = new Map();

  importBatchRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const batch = Object.fromEntries(
      importBatchHeaders.map((header, fieldIndex) => [header, row[fieldIndex] ?? ""]),
    );
    const value = batch.batch_id.trim();

    if (!value) {
      return;
    }

    if (seen.has(value)) {
      addError(`${formatImportBatchRow(rowNumber, "batch_id")} duplicates row ${seen.get(value)}`);
    } else {
      seen.set(value, rowNumber);
    }
  });
}

const [albumsText, importBatchesText, photosText, taxonomyText, sponsorshipItemsText] = await Promise.all([
  readFile(paths.albums, "utf8"),
  readFile(paths.importBatches, "utf8"),
  readFile(paths.photos, "utf8"),
  readFile(paths.taxonomy, "utf8"),
  readFile(paths.sponsorshipItems, "utf8"),
]);

const taxonomy = JSON.parse(taxonomyText);
const sponsorshipItems = JSON.parse(sponsorshipItemsText);
const albumRows = parseCsv(albumsText);
const importBatchRows = parseCsv(importBatchesText);
const rows = parseCsv(photosText);

if (albumRows.length === 0) {
  addError(`${paths.albums}: missing header row`);
} else {
  const [headers, ...rowsToValidate] = albumRows;
  validateHeaders(paths.albums, headers, albumHeaders);
  validateUniqueAlbumFields(rowsToValidate);

  rowsToValidate.forEach((row, index) => {
    validateAlbumRow(row, index + 2);
  });
}

if (importBatchRows.length === 0) {
  addError(`${paths.importBatches}: missing header row`);
} else {
  const [headers, ...rowsToValidate] = importBatchRows;
  validateHeaders(paths.importBatches, headers, importBatchHeaders);
  validateUniqueImportBatchFields(rowsToValidate);

  rowsToValidate.forEach((row, index) => {
    validateImportBatchRow(row, index + 2);
  });
}

if (rows.length === 0) {
  addError(`${paths.photos}: missing header row`);
} else {
  const [headers, ...photoRows] = rows;
  validateHeaders(paths.photos, headers, photoHeaders);
  validateTaxonomy(taxonomy, sponsorshipItems);
  validateUniquePhotoFields(photoRows);

  photoRows.forEach((row, index) => {
    validatePhotoRow(row, index + 2, taxonomy);
  });
}

if (errors.length > 0) {
  console.error(`Data validation failed with ${errors.length} error(s):`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Data validation passed (${Math.max(rows.length - 1, 0)} photo rows, ${Math.max(albumRows.length - 1, 0)} album rows, ${Math.max(importBatchRows.length - 1, 0)} import batch rows).`,
  );
}
