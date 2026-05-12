import { parseCsv, parseList } from "./data-utils.js";
import { buildSearchText, uniqueSearchTokens } from "./search-sort.js";

// Data loading and row normalization for the Pages frontend. This module owns
// transport/parsing details; callers receive plain app data and helper closures.
export function buildOptionLabelMaps(taxonomy) {
  const labels = taxonomy.option_labels ?? {};
  return new Map(
    Object.entries(labels).map(([fieldName, fieldLabels]) => [
      fieldName,
      new Map(Object.entries(fieldLabels ?? {})),
    ]),
  );
}

export function optionLabelsFor(optionLabelMaps, fieldName) {
  return optionLabelMaps.get(fieldName) ?? new Map();
}

export function createSearchTokenBuilder(optionLabelMaps, searchAliases) {
  return function searchTokensForField(fieldName, value) {
    return uniqueSearchTokens(fieldName, value, optionLabelsFor(optionLabelMaps, fieldName), searchAliases);
  };
}

export function normalizePhotoRows(rows, schema, searchTokensForField) {
  const [headers, ...dataRows] = rows;
  const fields = schema.tables.photos.fields;
  const fieldSet = new Set(fields.map((field) => field.name));
  const listFields = fields.filter((field) => field.multi_value).map((field) => field.name);

  return dataRows.map((row, index) => {
    const photo = Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""]));
    photo._sheet_row_number = index + 2;
    for (const field of listFields) {
      photo[field] = parseList(photo[field] ?? "");
    }
    for (const field of fieldSet) {
      if (!(field in photo)) {
        photo[field] = "";
      }
    }
    photo.search_text = buildSearchText(photo, { searchTokensForField });
    return photo;
  });
}

export async function loadFinderData({ dataSources, projectConfigUrl }) {
  const [photosResponse, schemaResponse, taxonomyResponse, searchAliasesResponse, projectConfigResponse] = await Promise.all([
    fetch(dataSources.photosCsvUrl),
    fetch(dataSources.schemaJsonUrl),
    fetch(dataSources.taxonomyJsonUrl),
    fetch(dataSources.searchAliasesJsonUrl),
    fetch(projectConfigUrl),
  ]);

  if (!photosResponse.ok || !schemaResponse.ok || !taxonomyResponse.ok || !searchAliasesResponse.ok || !projectConfigResponse.ok) {
    throw new Error("資料載入失敗");
  }

  const [photosText, photoSchema, taxonomy, searchAliases, projectConfig] = await Promise.all([
    photosResponse.text(),
    schemaResponse.json(),
    taxonomyResponse.json(),
    searchAliasesResponse.json(),
    projectConfigResponse.json(),
  ]);
  const optionLabelMaps = buildOptionLabelMaps(taxonomy);
  const searchTokensForField = createSearchTokenBuilder(optionLabelMaps, searchAliases);

  return {
    projectConfig,
    photoSchema,
    taxonomy,
    optionLabelMaps,
    searchTokensForField,
    photos: normalizePhotoRows(parseCsv(photosText), photoSchema, searchTokensForField),
  };
}
