const PHOTO_FINDER_MENU_NAME = "SITCON Photo Finder";
const PHOTO_FINDER_MAX_ERRORS = 50;
const PHOTO_FINDER_SCHEMA_META_HEADERS = [
  "schema_version",
  "taxonomy_version",
  "sponsorship_items_version",
  "last_synced_at",
  "synced_by",
  "notes",
];
const PHOTO_FINDER_SCHEMA_SYNCED_BY = "Apps Script menu";
const PHOTO_FINDER_PUBLIC_READ_FIELDS = [
  "curation_status",
  "public_use_status",
  "priority_level",
  "collections",
];
const PHOTO_FINDER_VALIDATION_REPORT_SHEET_NAME = "validation_report";
const PHOTO_FINDER_VALIDATION_REPORT_HEADERS = [
  "checked_at",
  "target",
  "status",
  "row",
  "field",
  "message",
];
const PHOTO_FINDER_REVIEW_WEB_APP_LIST_FIELDS = [
  "photo_id",
  "photo_url",
  "image_preview_url",
  "album_title",
  "event_name",
  "event_year",
  "scene_tags",
  "recommended_uses",
  "sponsorship_items",
  "public_use_status",
  "priority_level",
  "curation_status",
  "visual_description",
  "curation_notes",
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(PHOTO_FINDER_MENU_NAME)
    .addItem("Refresh schema and taxonomy", "refreshSchemaAndTaxonomy")
    .addItem("Open review panel", "openPhotoReviewPanel")
    .addSeparator()
    .addItem("Validate current row", "validateCurrentRow")
    .addItem("Validate photos sheet", "validatePhotosSheet")
    .addItem("Validate public read format", "validatePublicReadFormat")
    .addSeparator()
    .addItem("Show schema status", "showSchemaStatus")
    .addToUi();
}

function openPhotoReviewPanel() {
  checkAppsScriptAccess_();
  const template = HtmlService.createTemplateFromFile("ReviewPanel");
  template.bootstrapState = JSON.stringify(getReviewPanelState()).replace(/</g, "\\u003c");
  const html = template.evaluate()
    .setTitle("SITCON Photo Review");
  SpreadsheetApp.getUi().showSidebar(html);
}

function doGet() {
  checkAppsScriptAccess_();
  const template = HtmlService.createTemplateFromFile("ReviewWebApp");
  template.bootstrapState = JSON.stringify(getReviewWebAppState()).replace(/</g, "\\u003c");
  return template.evaluate()
    .setTitle("SITCON Photo Finder Review")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function checkAppsScriptAccess_() {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  sheet.getRange(1, 1).getValue();
  return sheet;
}

function refreshSchemaAndTaxonomy() {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  applyColumnHelpers_(sheet);
  updateSchemaMeta_();
  SpreadsheetApp.getUi().alert(
    [
      "已更新 photos 欄位提示、下拉選單與 schema_meta。",
      `Schema version: ${getConfig_().schemaVersion}`,
      `Taxonomy version: ${getConfig_().taxonomyVersion}`,
    ].join("\n"),
  );
}

function validateCurrentRow() {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  const activeRange = sheet.getActiveRange();
  if (!activeRange || activeRange.getRow() <= 1) {
    throw new Error("請先選取 photos 的資料列，不要選 header。");
  }

  const rowNumber = activeRange.getRow();
  const row = readPhotoRow_(sheet, rowNumber);
  const errors = validateRow_(row, rowNumber);
  showValidationResult_(errors, `第 ${rowNumber} 列`);
}

function validatePhotosSheet() {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  const errors = validateAllRows_(sheet);
  showValidationResult_(errors, "photos");
}

function validatePublicReadFormat() {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  const errors = validatePublicReadFields_().concat(validateAllRows_(sheet));
  showValidationResult_(errors, "公開讀取格式");
}

function showSchemaStatus() {
  const config = getConfig_();
  const spreadsheet = SpreadsheetApp.getActive();
  const metaSheet = spreadsheet.getSheetByName(config.schemaMetaSheetName);
  const meta = metaSheet ? readSchemaMeta_(metaSheet) : null;
  const missingMetaFields = meta ? missingSchemaMetaFields_(meta) : [];
  const metaLines = meta
    ? missingMetaFields.length > 0
      ? [
          `${config.schemaMetaSheetName} 工作表存在，但缺少同步資訊：${missingMetaFields.join(", ")}`,
          "請執行 Refresh schema and taxonomy 重新寫入 schema_meta。",
        ]
      : [
        `schema_meta schema_version: ${meta.schema_version || "(空白)"}`,
        `schema_meta taxonomy_version: ${meta.taxonomy_version || "(空白)"}`,
        `schema_meta sponsorship_items_version: ${meta.sponsorship_items_version || "(空白)"}`,
        `schema_meta last_synced_at: ${meta.last_synced_at || "(空白)"}`,
        `schema_meta synced_by: ${meta.synced_by || "(空白)"}`,
      ]
    : [`尚未找到 ${config.schemaMetaSheetName} 工作表；請執行 Refresh schema and taxonomy 建立同步狀態。`];

  SpreadsheetApp.getUi().alert(
    [
      "Repo generated config:",
      `schema_version: ${config.schemaVersion}`,
      `taxonomy_version: ${config.taxonomyVersion}`,
      `sponsorship_items_version: ${config.sponsorshipItemsVersion}`,
      `generated_at: ${config.generatedAt}`,
      `photos 欄位數: ${config.headers.length}`,
      "",
      ...metaLines,
    ].join("\n"),
  );
}

function getReviewPanelState() {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  const rowNumber = getActivePhotoRowNumber_(sheet);
  return buildReviewPanelState_(sheet, rowNumber);
}

function getReviewPhotoByRow(rowNumber) {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  const normalizedRowNumber = Number(rowNumber);
  if (!Number.isInteger(normalizedRowNumber) || normalizedRowNumber <= 1) {
    throw new Error("請輸入 photos 的資料列列號。");
  }
  if (normalizedRowNumber > sheet.getLastRow()) {
    throw new Error(`第 ${normalizedRowNumber} 列超出 photos 目前資料範圍。`);
  }
  return buildReviewPanelState_(sheet, normalizedRowNumber);
}

function saveReviewPhoto(rowNumber, values) {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  const normalizedRowNumber = Number(rowNumber);
  if (!Number.isInteger(normalizedRowNumber) || normalizedRowNumber <= 1) {
    throw new Error("請先載入 photos 的資料列。");
  }
  if (!values || typeof values !== "object") {
    throw new Error("沒有收到可儲存的欄位資料。");
  }

  return saveReviewPhotoAtRow_(sheet, normalizedRowNumber, values);
}

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

function saveReviewPhotoAtRow_(sheet, rowNumber, values) {
  const config = getConfig_();
  const currentRow = readPhotoRow_(sheet, rowNumber);
  const nextRow = config.headers.map((header, index) => {
    if (Object.prototype.hasOwnProperty.call(values, header)) {
      return normalizeText_(values[header]);
    }
    return currentRow[index];
  });

  const errors = validateRow_(nextRow, rowNumber);
  writeValidationReport_(`第 ${rowNumber} 列`, errors);
  if (errors.length > 0) {
    return buildReviewPanelStateFromRow_(nextRow, rowNumber, errors);
  }

  writePhotoRow_(sheet, rowNumber, nextRow);
  return buildReviewPanelState_(sheet, rowNumber, errors);
}

function getConfig_() {
  if (typeof SITCON_PHOTO_FINDER_CONFIG === "undefined") {
    throw new Error("找不到 SITCON_PHOTO_FINDER_CONFIG，請先執行 pnpm apps-script:build-config 並重新 clasp push。");
  }
  return SITCON_PHOTO_FINDER_CONFIG;
}

function getActivePhotoRowNumber_(sheet) {
  const activeRange = sheet.getActiveRange();
  if (!activeRange || activeRange.getRow() <= 1) {
    throw new Error("請先在 photos 選取一列資料，不要選 header。");
  }
  return activeRange.getRow();
}

function buildReviewPanelState_(sheet, rowNumber, providedErrors) {
  const row = readPhotoRow_(sheet, rowNumber);
  return buildReviewPanelStateFromRow_(row, rowNumber, providedErrors);
}

function buildReviewPanelStateFromRow_(row, rowNumber, providedErrors) {
  const record = rowToRecord_(row);
  const errors = providedErrors || validateRow_(row, rowNumber);
  return {
    errors,
    fields: getReviewPanelFields_(),
    record,
    rowNumber,
  };
}

function rowToRecord_(row) {
  const record = {};
  getConfig_().headers.forEach((header, index) => {
    record[header] = normalizeText_(row[index]);
  });
  return record;
}

function getReviewPanelFields_() {
  const config = getConfig_();
  return config.fields.map((field) => ({
    descriptionZh: field.descriptionZh || "",
    labelZh: field.labelZh || field.name,
    multiValue: Boolean(field.multiValue),
    name: field.name,
    options: field.taxonomyKey ? config.taxonomy[field.taxonomyKey] || [] : field.type === "boolean" ? ["true", "false"] : [],
    readOnly: ["photo_id", "photo_url", "image_preview_url"].includes(field.name),
    required: Boolean(field.required),
    taxonomyKey: field.taxonomyKey || "",
    type: field.type || "string",
  }));
}

function readPhotoRow_(sheet, rowNumber) {
  return sheet.getRange(rowNumber, 1, 1, getConfig_().headers.length).getDisplayValues()[0];
}

function readAllPhotoRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }
  return sheet.getRange(2, 1, lastRow - 1, getConfig_().headers.length)
    .getDisplayValues()
    .map((row, index) => ({
      row,
      rowNumber: index + 2,
    }));
}

function writePhotoRow_(sheet, rowNumber, row) {
  const range = sheet.getRange(rowNumber, 1, 1, row.length);
  range.setNumberFormat("@");
  range.setValues([row]);
}

function findPhotoRowNumberById_(sheet, photoId) {
  const normalizedPhotoId = normalizeText_(photoId);
  if (isBlank_(normalizedPhotoId)) {
    throw new Error("請指定 photo_id。");
  }

  const photoIdColumnIndex = getConfig_().headers.indexOf("photo_id") + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    throw new Error("photos 目前沒有資料列。");
  }

  const values = sheet.getRange(2, photoIdColumnIndex, lastRow - 1, 1).getDisplayValues();
  for (let index = 0; index < values.length; index += 1) {
    if (normalizeText_(values[index][0]) === normalizedPhotoId) {
      return index + 2;
    }
  }
  throw new Error(`找不到 photo_id: ${normalizedPhotoId}`);
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

function getPhotosSheet_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(getConfig_().photosSheetName);
  if (!sheet) {
    throw new Error(`找不到 ${getConfig_().photosSheetName} 工作表。`);
  }
  return sheet;
}

function assertPhotosHeader_(sheet) {
  const expectedHeaders = getConfig_().headers;
  const width = Math.max(sheet.getLastColumn(), expectedHeaders.length);
  const actualHeaders = sheet.getRange(1, 1, 1, width).getValues()[0].map(normalizeText_);
  const visibleActualHeaders = actualHeaders.filter((value) => value !== "");

  if (visibleActualHeaders.length !== expectedHeaders.length) {
    throw new Error(`photos header 欄位數不一致：目前 ${visibleActualHeaders.length} 欄，預期 ${expectedHeaders.length} 欄。`);
  }

  expectedHeaders.forEach((expected, index) => {
    if (actualHeaders[index] !== expected) {
      throw new Error(`photos header 第 ${index + 1} 欄不一致：目前 "${actualHeaders[index] || "(空白)"}"，預期 "${expected}"。`);
    }
  });
}

function applyColumnHelpers_(sheet) {
  const fields = getConfig_().fields;
  const rowCount = Math.max(sheet.getMaxRows() - 1, 1);
  const bodyTableRange = sheet.getRange(2, 1, rowCount, fields.length);

  bodyTableRange.setNumberFormat("@");

  fields.forEach((field, index) => {
    const column = index + 1;
    const headerCell = sheet.getRange(1, column);
    const bodyRange = sheet.getRange(2, column, rowCount, 1);
    const taxonomyValues = field.taxonomyKey ? getConfig_().taxonomy[field.taxonomyKey] || [] : [];

    headerCell.setNote(buildFieldNote_(field, taxonomyValues));
    bodyRange.clearDataValidations();

    if (field.taxonomyKey && !field.multiValue && taxonomyValues.length > 0) {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(taxonomyValues, true)
        .setAllowInvalid(false)
        .build();
      bodyRange.setDataValidation(rule);
    } else if (field.type === "boolean" && !field.multiValue) {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["true", "false"], true)
        .setAllowInvalid(false)
        .build();
      bodyRange.setDataValidation(rule);
    }
  });
}

function updateSchemaMeta_() {
  const config = getConfig_();
  const spreadsheet = SpreadsheetApp.getActive();
  let sheet = spreadsheet.getSheetByName(config.schemaMetaSheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(config.schemaMetaSheetName);
  }

  const values = [
    config.schemaVersion,
    config.taxonomyVersion,
    config.sponsorshipItemsVersion,
    new Date().toISOString(),
    PHOTO_FINDER_SCHEMA_SYNCED_BY,
    config.sponsorshipItemsSnapshotNote,
  ];

  sheet.getRange(1, 1, 1, PHOTO_FINDER_SCHEMA_META_HEADERS.length).setValues([PHOTO_FINDER_SCHEMA_META_HEADERS]);
  sheet.getRange(2, 1, 1, values.length).setValues([values]);
  sheet.setFrozenRows(1);
  SpreadsheetApp.flush();

  const meta = readSchemaMeta_(sheet);
  const missingFields = missingSchemaMetaFields_(meta);
  if (missingFields.length > 0) {
    throw new Error(`${config.schemaMetaSheetName} 寫入後仍缺少同步資訊：${missingFields.join(", ")}`);
  }
}

function readSchemaMeta_(sheet) {
  const width = PHOTO_FINDER_SCHEMA_META_HEADERS.length;
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(normalizeText_);
  const values = sheet.getRange(2, 1, 1, width).getValues()[0].map(normalizeText_);
  const meta = {};
  PHOTO_FINDER_SCHEMA_META_HEADERS.forEach((header, index) => {
    const actualHeader = headers[index];
    if (actualHeader === header) {
      meta[header] = values[index];
    }
  });
  return meta;
}

function missingSchemaMetaFields_(meta) {
  return PHOTO_FINDER_SCHEMA_META_HEADERS
    .filter((header) => header !== "notes")
    .filter((header) => isBlank_(meta[header]));
}

function validatePublicReadFields_() {
  const headers = getConfig_().headers;
  return PHOTO_FINDER_PUBLIC_READ_FIELDS
    .filter((fieldName) => !headers.includes(fieldName))
    .map((fieldName) => ({
      rowNumber: "",
      fieldName,
      message: "公開讀取格式缺少必要狀態欄位",
    }));
}

function buildFieldNote_(field, taxonomyValues) {
  const lines = [
    field.labelZh,
    field.descriptionZh,
    field.required ? "必填欄位。" : "可留空。",
  ];
  if (field.multiValue) {
    lines.push("多值請用分號 ; 分隔。");
  }
  if (taxonomyValues.length > 0) {
    lines.push(`受控字彙：${taxonomyValues.join("、")}`);
  }
  return lines.filter(Boolean).join("\n");
}

function validateAllRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, getConfig_().headers.length).getDisplayValues();
  const errors = [];
  rows.forEach((row, index) => {
    errors.push(...validateRow_(row, index + 2));
  });
  return errors;
}

function validateRow_(row, rowNumber) {
  const config = getConfig_();
  const values = {};
  config.headers.forEach((header, index) => {
    values[header] = normalizeText_(row[index]);
  });

  const errors = [];
  config.fields.forEach((field) => {
    const value = values[field.name];
    if (field.required && isBlank_(value)) {
      errors.push(formatError_(rowNumber, field.name, "必填欄位不可空白"));
    }
    if (!isBlank_(value)) {
      errors.push(...validateFieldValue_(field, value, rowNumber));
    }
  });

  if (values.curation_status === "reviewed") {
    errors.push(...validateRequiredFieldGroup_(values, config.reviewedRequiredFields, rowNumber, "reviewed"));
  }
  if (values.public_use_status === "approved") {
    errors.push(...validateRequiredFieldGroup_(values, config.approvedRequiredFields, rowNumber, "approved"));
  }

  return errors;
}

function validateFieldValue_(field, value, rowNumber) {
  const errors = [];

  if (field.type === "url" && !/^https?:\/\/\S+$/i.test(value)) {
    errors.push(formatError_(rowNumber, field.name, "必須是 http 或 https URL"));
  }
  if (field.type === "year" && !/^\d{4}$/.test(value)) {
    errors.push(formatError_(rowNumber, field.name, "必須是四位數年份"));
  }
  if (field.type === "integer" && !/^(0|[1-9]\d*)$/.test(value)) {
    errors.push(formatError_(rowNumber, field.name, "必須是非負整數"));
  }
  if (field.type === "boolean" && !["true", "false"].includes(value)) {
    errors.push(formatError_(rowNumber, field.name, "必須是 true 或 false"));
  }
  if (field.multiValue) {
    const duplicateValues = findDuplicateValues_(splitList_(value));
    if (duplicateValues.length > 0) {
      errors.push(formatError_(rowNumber, field.name, `不可重複填寫：${duplicateValues.join("、")}`));
    }
  }
  if (field.taxonomyKey) {
    errors.push(...validateTaxonomyValue_(field, value, rowNumber));
  }

  return errors;
}

function validateTaxonomyValue_(field, value, rowNumber) {
  const allowedValues = getConfig_().taxonomy[field.taxonomyKey] || [];
  const values = field.multiValue ? splitList_(value) : [value];
  const errors = [];
  values.forEach((item) => {
    if (!allowedValues.includes(item)) {
      errors.push(formatError_(rowNumber, field.name, `未知受控字彙：${item}`));
    }
  });
  return errors;
}

function validateRequiredFieldGroup_(values, fieldNames, rowNumber, statusName) {
  return fieldNames
    .filter((fieldName) => isBlank_(values[fieldName]))
    .map((fieldName) => formatError_(rowNumber, fieldName, `${statusName} 需要填寫此欄位`));
}

function splitList_(value) {
  return String(value)
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function findDuplicateValues_(values) {
  const seen = {};
  const duplicates = [];
  values.forEach((value) => {
    if (seen[value] && !duplicates.includes(value)) {
      duplicates.push(value);
    }
    seen[value] = true;
  });
  return duplicates;
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeText_(value) {
  return String(value == null ? "" : value).trim();
}

function isBlank_(value) {
  return normalizeText_(value) === "";
}

function formatError_(rowNumber, fieldName, message) {
  return { rowNumber, fieldName, message };
}

function showValidationResult_(errors, target) {
  const ui = SpreadsheetApp.getUi();
  writeValidationReport_(target, errors);
  if (errors.length === 0) {
    ui.alert(`${target} 檢查通過。\n\n已更新 ${PHOTO_FINDER_VALIDATION_REPORT_SHEET_NAME}。`);
    return;
  }

  const shownErrors = errors.slice(0, PHOTO_FINDER_MAX_ERRORS);
  const suffix = errors.length > shownErrors.length ? `\n...另有 ${errors.length - shownErrors.length} 個錯誤。` : "";
  ui.alert(
    [
      `${target} 檢查發現 ${errors.length} 個問題：`,
      "",
      shownErrors.map(formatValidationError_).join("\n"),
      suffix,
      "",
      `完整結果已寫入 ${PHOTO_FINDER_VALIDATION_REPORT_SHEET_NAME}。`,
    ].join("\n"),
  );
}

function writeValidationReport_(target, errors) {
  const spreadsheet = SpreadsheetApp.getActive();
  let sheet = spreadsheet.getSheetByName(PHOTO_FINDER_VALIDATION_REPORT_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PHOTO_FINDER_VALIDATION_REPORT_SHEET_NAME);
  }

  const checkedAt = new Date().toISOString();
  const rows = errors.length > 0
    ? errors.map((error) => [
        checkedAt,
        target,
        "failed",
        error.rowNumber || "",
        error.fieldName || "",
        error.message || formatValidationError_(error),
      ])
    : [[checkedAt, target, "passed", "", "", "檢查通過"]];

  sheet.clearContents();
  sheet.getRange(1, 1, 1, PHOTO_FINDER_VALIDATION_REPORT_HEADERS.length).setValues([PHOTO_FINDER_VALIDATION_REPORT_HEADERS]);
  sheet.getRange(2, 1, rows.length, PHOTO_FINDER_VALIDATION_REPORT_HEADERS.length).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, PHOTO_FINDER_VALIDATION_REPORT_HEADERS.length);
}

function formatValidationError_(error) {
  if (error.rowNumber) {
    return `第 ${error.rowNumber} 列 ${error.fieldName}: ${error.message}`;
  }
  if (error.fieldName) {
    return `${error.fieldName}: ${error.message}`;
  }
  return normalizeText_(error.message || error);
}
