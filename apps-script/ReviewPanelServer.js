function getReviewPanelState() {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  const rowNumber = getActivePhotoRowNumber_(sheet);
  return buildReviewPanelState_(sheet, rowNumber);
}

function getReviewPanelBootstrapState() {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  const rowNumber = getActivePhotoRowNumber_(sheet);
  return {
    current: buildReviewPanelState_(sheet, rowNumber),
    buffer: buildReviewPhotoBuffer_(sheet, rowNumber, getReviewPanelBufferBefore_(), getReviewPanelBufferAfter_()),
  };
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

function getReviewPhotoBufferByRow(rowNumber, beforeCount, afterCount) {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  return buildReviewPhotoBuffer_(sheet, rowNumber, beforeCount, afterCount);
}

function buildReviewPhotoBuffer_(sheet, rowNumber, beforeCount, afterCount) {
  const normalizedRowNumber = Number(rowNumber);
  if (!Number.isInteger(normalizedRowNumber) || normalizedRowNumber <= 1) {
    throw new Error("請輸入 photos 的資料列列號。");
  }

  const lastRow = sheet.getLastRow();
  if (normalizedRowNumber > lastRow) {
    throw new Error(`第 ${normalizedRowNumber} 列超出 photos 目前資料範圍。`);
  }

  const safeBeforeCount = Math.max(0, Math.min(Number(beforeCount) || 0, 10));
  const safeAfterCount = Math.max(0, Math.min(Number(afterCount) || 0, 10));
  const startRow = Math.max(2, normalizedRowNumber - safeBeforeCount);
  const endRow = Math.min(lastRow, normalizedRowNumber + safeAfterCount);
  const rows = sheet.getRange(startRow, 1, endRow - startRow + 1, getConfig_().headers.length).getDisplayValues();

  return {
    centerRowNumber: normalizedRowNumber,
    photos: rows.map((row, index) => buildReviewPanelStateFromRow_(row, startRow + index)),
  };
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

function saveReviewPhotoAtRow_(sheet, rowNumber, values) {
  const config = getConfig_();
  const currentRow = readPhotoRow_(sheet, rowNumber);
  const nextRow = config.headers.map((header, index) => {
    if (Object.prototype.hasOwnProperty.call(values, header)) {
      return normalizeText_(values[header]);
    }
    return currentRow[index];
  });

  const issues = validateRow_(nextRow, rowNumber);
  const errors = blockingValidationIssues_(issues);
  writeValidationReport_(`第 ${rowNumber} 列`, issues);
  if (errors.length > 0) {
    return buildReviewPanelStateFromRow_(nextRow, rowNumber, issues);
  }

  writePhotoRow_(sheet, rowNumber, nextRow);
  return buildReviewPanelState_(sheet, rowNumber, issues);
}

function getActivePhotoRowNumber_(sheet) {
  const activeRange = sheet.getActiveRange();
  if (!activeRange || activeRange.getRow() <= 1) {
    if (sheet.getLastRow() >= 2) {
      return 2;
    }
    throw new Error("photos 目前沒有可校對的資料列。");
  }
  return activeRange.getRow();
}

function buildReviewPanelState_(sheet, rowNumber, providedErrors) {
  const row = readPhotoRow_(sheet, rowNumber);
  return buildReviewPanelStateFromRow_(row, rowNumber, providedErrors);
}

function buildReviewPanelStateFromRow_(row, rowNumber, providedErrors) {
  const config = getConfig_();
  const record = rowToRecord_(row);
  const issues = providedErrors || validateRow_(row, rowNumber);
  return {
    errors: blockingValidationIssues_(issues),
    warnings: issues.filter(isWarningIssue_),
    bufferAfter: getReviewPanelBufferAfter_(),
    bufferBefore: getReviewPanelBufferBefore_(),
    fields: getReviewPanelFields_(),
    record,
    reviewedRequiredFields: config.reviewedRequiredFields || [],
    rowNumber,
    validationMessages: getValidationMessages_(),
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
  const fieldNames = getReviewPanelFieldNames_();
  const fields = fieldNames.length > 0
    ? fieldNames.map((fieldName) => config.fields.find((field) => field.name === fieldName)).filter(Boolean)
    : config.fields;
  return fields.map((field) => ({
    descriptionZh: field.descriptionZh || "",
    labelZh: field.labelZh || field.name,
    multiValue: Boolean(field.multiValue),
    name: field.name,
    optionLabels: getOptionLabelsForField_(field.name),
    options: field.taxonomyKey ? config.taxonomy[field.taxonomyKey] || [] : field.type === "boolean" ? ["true", "false"] : [],
    readOnly: ["photo_id", "photo_url", "image_preview_url"].includes(field.name),
    required: Boolean(field.required),
    taxonomyKey: field.taxonomyKey || "",
    type: field.type || "string",
  }));
}

function getOptionLabelsForField_(fieldName) {
  const labels = getConfig_().taxonomy.option_labels || {};
  return labels[fieldName] || {};
}

function labelForOption_(fieldName, value) {
  return getOptionLabelsForField_(fieldName)[value] || value;
}

function formatOptionForNote_(fieldName, value) {
  const label = labelForOption_(fieldName, value);
  return label === value ? value : `${value} = ${label}`;
}
