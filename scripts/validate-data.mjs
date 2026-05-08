import { readFile } from "node:fs/promises";
import { URL } from "node:url";

const paths = {
  photos: "data/photos.csv",
  taxonomy: "data/tag-taxonomy.json",
  sponsorshipItems: "data/sponsorship-items.json",
};

const expectedHeaders = [
  "photo_id",
  "photo_url",
  "image_preview_url",
  "album_title",
  "event_name",
  "event_year",
  "photographer",
  "license",
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "sponsorship_items",
  "sponsorship_tags",
  "orientation",
  "has_negative_space",
  "safe_crop",
  "public_use_status",
  "quality_score",
  "collections",
  "internal_notes",
  "curation_status",
];

const requiredFields = ["photo_id", "photo_url", "image_preview_url"];
const listFields = [
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "sponsorship_items",
  "sponsorship_tags",
  "safe_crop",
  "collections",
];
const controlledListFields = [
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "sponsorship_items",
  "sponsorship_tags",
  "safe_crop",
];
const controlledScalarFields = [
  "orientation",
  "public_use_status",
  "curation_status",
];

const errors = [];

function addError(message) {
  errors.push(message);
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      field = "";
      row = [];
      continue;
    }

    field += char;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function parseSemicolonList(value) {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
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

function validateHeaders(headers) {
  if (headers.length !== expectedHeaders.length) {
    addError(
      `${paths.photos}: expected ${expectedHeaders.length} headers, got ${headers.length}`,
    );
  }

  expectedHeaders.forEach((expected, index) => {
    if (headers[index] !== expected) {
      addError(
        `${paths.photos}: header ${index + 1} should be "${expected}", got "${headers[index] ?? ""}"`,
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
  const photo = Object.fromEntries(expectedHeaders.map((header, index) => [header, row[index] ?? ""]));

  if (row.length !== expectedHeaders.length) {
    addError(
      `${paths.photos}:${rowNumber} expected ${expectedHeaders.length} columns, got ${row.length}`,
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

  if (photo.quality_score) {
    const score = Number(photo.quality_score);
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      addError(`${formatRow(rowNumber, "quality_score")} must be an integer from 1 to 5`);
    }
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
}

function validateUniquePhotoFields(photoRows) {
  const seen = {
    photo_id: new Map(),
    photo_url: new Map(),
  };

  photoRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const photo = Object.fromEntries(
      expectedHeaders.map((header, fieldIndex) => [header, row[fieldIndex] ?? ""]),
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

const [photosText, taxonomyText, sponsorshipItemsText] = await Promise.all([
  readFile(paths.photos, "utf8"),
  readFile(paths.taxonomy, "utf8"),
  readFile(paths.sponsorshipItems, "utf8"),
]);

const taxonomy = JSON.parse(taxonomyText);
const sponsorshipItems = JSON.parse(sponsorshipItemsText);
const rows = parseCsv(photosText);

if (rows.length === 0) {
  addError(`${paths.photos}: missing header row`);
} else {
  const [headers, ...photoRows] = rows;
  validateHeaders(headers);
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
  console.log(`Data validation passed (${Math.max(rows.length - 1, 0)} photo rows).`);
}
