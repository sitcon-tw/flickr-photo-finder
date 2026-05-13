function getReviewWebAppState(filters) {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  const allRows = readAllPhotoRows_(sheet);
  const summaries = allRows.map((entry) => buildReviewWebAppPhotoSummary_(entry.row, entry.rowNumber));
  const normalizedFilters = normalizeReviewWebAppFilters_(filters);
  const filteredPhotos = summaries.filter((photo) => matchesReviewWebAppFilters_(photo, normalizedFilters));
  return {
    fields: getReviewPanelFields_(),
    filteredCount: filteredPhotos.length,
    filters: buildReviewWebAppFilterOptions_(summaries),
    photos: filteredPhotos,
    schemaVersion: getConfig_().schemaVersion,
    totalCount: summaries.length,
  };
}

function getReviewWebAppPhoto(photoId) {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  const rowNumber = findPhotoRowNumberById_(sheet, photoId);
  return buildReviewPanelState_(sheet, rowNumber);
}

function saveReviewWebAppPhoto(photoId, values) {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  if (!values || typeof values !== "object") {
    throw new Error("沒有收到可儲存的欄位資料。");
  }
  const rowNumber = findPhotoRowNumberById_(sheet, photoId);
  return saveReviewPhotoAtRow_(sheet, rowNumber, values);
}

function buildReviewWebAppPhotoSummary_(row, rowNumber) {
  const record = rowToRecord_(row);
  const summary = { rowNumber };
  getReviewWebAppListFields_().forEach((fieldName) => {
    summary[fieldName] = record[fieldName] || "";
  });
  return summary;
}

function buildReviewWebAppFilterOptions_(photos) {
  const config = getConfig_();
  const options = {};
  getReviewWebAppFilterFields_().forEach((fieldName) => {
    options[fieldName] = config.taxonomy[fieldName] || collectListValues_(photos, fieldName);
  });
  return options;
}

function collectListValues_(records, fieldName) {
  const values = {};
  records.forEach((record) => {
    splitList_(record[fieldName] || "").forEach((item) => {
      values[item] = true;
    });
  });
  return Object.keys(values).sort();
}

function normalizeReviewWebAppFilters_(filters) {
  const source = filters && typeof filters === "object" ? filters : {};
  const normalized = { query: normalizeText_(source.query).toLowerCase() };
  getReviewWebAppFilterFields_().forEach((fieldName) => {
    normalized[fieldName] = normalizeText_(source[fieldName]);
  });
  return normalized;
}

function matchesReviewWebAppFilters_(photo, filters) {
  return (
    matchesQuery_(photo, filters.query) &&
    getReviewWebAppFilterFields_().every((fieldName) => matchesReviewWebAppField_(photo, fieldName, filters[fieldName]))
  );
}

function matchesReviewWebAppField_(photo, fieldName, expectedValue) {
  const field = getConfig_().fields.find((item) => item.name === fieldName);
  return field?.multiValue
    ? matchesListField_(photo, fieldName, expectedValue)
    : matchesScalarField_(photo, fieldName, expectedValue);
}

function matchesQuery_(photo, query) {
  if (!query) {
    return true;
  }
  const text = [
    photo.photo_id,
    photo.album_title,
    photo.event_name,
    photo.event_year,
    photo.scene_tags,
    photo.recommended_uses,
    photo.sponsorship_items,
    photo.visual_description,
    photo.curation_notes,
  ].join(" ").toLowerCase();
  return text.includes(query);
}

function matchesScalarField_(record, fieldName, expectedValue) {
  return !expectedValue || record[fieldName] === expectedValue;
}

function matchesListField_(record, fieldName, expectedValue) {
  return !expectedValue || splitList_(record[fieldName] || "").includes(expectedValue);
}
