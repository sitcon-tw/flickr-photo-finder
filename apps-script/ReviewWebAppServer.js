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
  PHOTO_FINDER_REVIEW_WEB_APP_LIST_FIELDS.forEach((fieldName) => {
    summary[fieldName] = record[fieldName] || "";
  });
  return summary;
}

function buildReviewWebAppFilterOptions_(photos) {
  const config = getConfig_();
  return {
    curation_status: config.taxonomy.curation_status || [],
    public_use_status: config.taxonomy.public_use_status || [],
    recommended_uses: config.taxonomy.recommended_uses || [],
    scene_tags: config.taxonomy.scene_tags || [],
    sponsorship_items: config.taxonomy.sponsorship_items || [],
    collections: collectListValues_(photos, "collections"),
  };
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
  return {
    curation_status: normalizeText_(source.curation_status),
    public_use_status: normalizeText_(source.public_use_status),
    recommended_uses: normalizeText_(source.recommended_uses),
    scene_tags: normalizeText_(source.scene_tags),
    sponsorship_items: normalizeText_(source.sponsorship_items),
    query: normalizeText_(source.query).toLowerCase(),
  };
}

function matchesReviewWebAppFilters_(photo, filters) {
  return (
    matchesQuery_(photo, filters.query) &&
    matchesScalarField_(photo, "curation_status", filters.curation_status) &&
    matchesScalarField_(photo, "public_use_status", filters.public_use_status) &&
    matchesListField_(photo, "recommended_uses", filters.recommended_uses) &&
    matchesListField_(photo, "scene_tags", filters.scene_tags) &&
    matchesListField_(photo, "sponsorship_items", filters.sponsorship_items)
  );
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

