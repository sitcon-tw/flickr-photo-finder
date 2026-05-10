function getConfig_() {
  if (typeof SITCON_PHOTO_FINDER_CONFIG === "undefined") {
    throw new Error("找不到 SITCON_PHOTO_FINDER_CONFIG，請先執行 pnpm apps-script:build-config 並重新 clasp push。");
  }
  return SITCON_PHOTO_FINDER_CONFIG;
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

function buildFieldNote_(field, taxonomyValues) {
  const lines = [
    field.labelZh,
    field.descriptionZh,
    field.required ? "必填欄位。" : "可留空。",
  ];
  if (field.multiValue) {
    lines.push("多值請用分號 ; 分隔。");
  }
  const optionValues = taxonomyValues.length > 0 ? taxonomyValues : field.type === "boolean" ? ["true", "false"] : [];
  if (optionValues.length > 0) {
    lines.push(`受控字彙：${optionValues.map((value) => formatOptionForNote_(field.name, value)).join("、")}`);
  }
  return lines.filter(Boolean).join("\n");
}

