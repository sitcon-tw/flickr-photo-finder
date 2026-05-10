function getValidationMessages_() {
  return Object.assign({}, getConfig_().validationMessages || {});
}

function validationMessage_(key) {
  return getValidationMessages_()[key] || key;
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
      errors.push(formatError_(rowNumber, field.name, validationMessage_("required")));
    }
    if (!isBlank_(value)) {
      errors.push(...validateFieldValue_(field, value, rowNumber));
    }
  });

  if (values.curation_status === "reviewed") {
    errors.push(...validateRequiredFieldGroup_(values, config.reviewedRequiredFields, rowNumber));
  }

  return errors;
}

function validateFieldValue_(field, value, rowNumber) {
  const errors = [];

  if (field.type === "url" && !/^https?:\/\/\S+$/i.test(value)) {
    errors.push(formatError_(rowNumber, field.name, validationMessage_("invalidUrl")));
  }
  if (field.type === "year" && !/^\d{4}$/.test(value)) {
    errors.push(formatError_(rowNumber, field.name, validationMessage_("invalidYear")));
  }
  if (field.type === "integer" && !/^(0|[1-9]\d*)$/.test(value)) {
    errors.push(formatError_(rowNumber, field.name, validationMessage_("invalidInteger")));
  }
  if (field.type === "boolean" && !["true", "false"].includes(value)) {
    errors.push(formatError_(rowNumber, field.name, validationMessage_("invalidBoolean")));
  }
  if (field.multiValue) {
    const duplicateValues = findDuplicateValues_(splitList_(value));
    if (duplicateValues.length > 0) {
      errors.push(formatError_(rowNumber, field.name, `${validationMessage_("duplicateListPrefix")}${duplicateValues.join("、")}`));
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
      errors.push(formatError_(rowNumber, field.name, `${validationMessage_("unknownTaxonomyPrefix")}${item}`));
    }
  });
  return errors;
}

function validateRequiredFieldGroup_(values, fieldNames, rowNumber) {
  return fieldNames
    .filter((fieldName) => isBlank_(values[fieldName]))
    .map((fieldName) => formatError_(rowNumber, fieldName, validationMessage_("completionRequired")));
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

