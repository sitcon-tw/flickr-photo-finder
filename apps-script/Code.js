const PHOTO_FINDER_MENU_NAME = "SITCON Photo Finder";
const PHOTO_FINDER_MAX_ERRORS = 50;

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(PHOTO_FINDER_MENU_NAME)
    .addItem("Refresh schema and taxonomy", "refreshSchemaAndTaxonomy")
    .addSeparator()
    .addItem("Validate current row", "validateCurrentRow")
    .addItem("Validate photos sheet", "validatePhotosSheet")
    .addItem("Validate public read format", "validatePublicReadFormat")
    .addSeparator()
    .addItem("Show schema status", "showSchemaStatus")
    .addToUi();
}

function refreshSchemaAndTaxonomy() {
  const sheet = getPhotosSheet_();
  assertPhotosHeader_(sheet);
  applyColumnHelpers_(sheet);
  SpreadsheetApp.getUi().alert(
    `已更新 photos 欄位提示與下拉選單。\nSchema version: ${getConfig_().schemaVersion}`,
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
  const row = sheet.getRange(rowNumber, 1, 1, getConfig_().headers.length).getValues()[0];
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
  const errors = validateAllRows_(sheet);
  showValidationResult_(errors, "公開讀取格式");
}

function showSchemaStatus() {
  const config = getConfig_();
  const spreadsheet = SpreadsheetApp.getActive();
  const metaSheet = spreadsheet.getSheetByName(config.schemaMetaSheetName);
  const metaMessage = metaSheet
    ? `找到 ${config.schemaMetaSheetName} 工作表，可在後續版本寫入同步狀態。`
    : `尚未找到 ${config.schemaMetaSheetName} 工作表；目前顯示 repo 產生的設定狀態。`;

  SpreadsheetApp.getUi().alert(
    [
      `Schema version: ${config.schemaVersion}`,
      `Generated at: ${config.generatedAt}`,
      `photos 欄位數: ${config.headers.length}`,
      metaMessage,
    ].join("\n"),
  );
}

function getConfig_() {
  if (typeof SITCON_PHOTO_FINDER_CONFIG === "undefined") {
    throw new Error("找不到 SITCON_PHOTO_FINDER_CONFIG，請先執行 pnpm apps-script:build-config 並重新 clasp push。");
  }
  return SITCON_PHOTO_FINDER_CONFIG;
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

  const rows = sheet.getRange(2, 1, lastRow - 1, getConfig_().headers.length).getValues();
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

function normalizeText_(value) {
  return String(value == null ? "" : value).trim();
}

function isBlank_(value) {
  return normalizeText_(value) === "";
}

function formatError_(rowNumber, fieldName, message) {
  return `第 ${rowNumber} 列 ${fieldName}: ${message}`;
}

function showValidationResult_(errors, target) {
  const ui = SpreadsheetApp.getUi();
  if (errors.length === 0) {
    ui.alert(`${target} 檢查通過。`);
    return;
  }

  const shownErrors = errors.slice(0, PHOTO_FINDER_MAX_ERRORS);
  const suffix = errors.length > shownErrors.length ? `\n...另有 ${errors.length - shownErrors.length} 個錯誤。` : "";
  ui.alert(`${target} 檢查發現 ${errors.length} 個問題：\n\n${shownErrors.join("\n")}${suffix}`);
}
