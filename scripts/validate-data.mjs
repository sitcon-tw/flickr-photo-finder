import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { parseCsv, parseSemicolonList } from "./csv-utils.mjs";
import {
  albumHeaders,
  approvedRequiredFields,
  controlledListFields,
  controlledScalarFields,
  listFields,
  photoHeaders,
  requiredFields,
  reviewedRequiredFields,
} from "./photo-schema.mjs";

const paths = {
  albums: "data/albums.csv",
  photos: "data/photos.csv",
  taxonomy: "data/tag-taxonomy.json",
  sponsorshipItems: "data/sponsorship-items.json",
};

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

  if (photo.public_use_status === "approved") {
    for (const field of approvedRequiredFields) {
      if (!photo[field].trim()) {
        addError(`${formatRow(rowNumber, field)} is required when public_use_status is approved`);
      }
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

  if (album.photo_count && !/^(0|[1-9]\d*)$/.test(album.photo_count)) {
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

const [albumsText, photosText, taxonomyText, sponsorshipItemsText] = await Promise.all([
  readFile(paths.albums, "utf8"),
  readFile(paths.photos, "utf8"),
  readFile(paths.taxonomy, "utf8"),
  readFile(paths.sponsorshipItems, "utf8"),
]);

const taxonomy = JSON.parse(taxonomyText);
const sponsorshipItems = JSON.parse(sponsorshipItemsText);
const albumRows = parseCsv(albumsText);
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
    `Data validation passed (${Math.max(rows.length - 1, 0)} photo rows, ${Math.max(albumRows.length - 1, 0)} album rows).`,
  );
}
