function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(PHOTO_FINDER_MENU_NAME)
    .addItem("開始整理照片", "openPhotoReviewPanel")
    .addItem("檢查這張照片", "validateCurrentRow")
    .addSeparator()
    .addItem("更新欄位選項", "refreshSchemaAndTaxonomy")
    .addItem("檢查全部照片", "validatePhotosSheet")
    .addItem("檢查公開資料格式", "validatePublicReadFormat")
    .addItem("查看資料表版本", "showSchemaStatus")
    .addToUi();
}

function openPhotoReviewPanel() {
  checkAppsScriptAccess_();
  const template = HtmlService.createTemplateFromFile("ReviewPanel");
  template.bootstrapState = JSON.stringify(getReviewPanelBootstrapState()).replace(/</g, "\\u003c");
  const html = template.evaluate()
    .setTitle("SITCON Photo Review");
  SpreadsheetApp.getUi().showSidebar(html);
}

function doGet() {
  const template = HtmlService.createTemplateFromFile("ReviewWebApp");
  template.bootstrapState = JSON.stringify(null);
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
          "請執行更新欄位選項重新寫入 schema_meta。",
        ]
      : [
          `schema_meta schema_version: ${meta.schema_version || "(空白)"}`,
          `schema_meta taxonomy_version: ${meta.taxonomy_version || "(空白)"}`,
          `schema_meta sponsorship_items_version: ${meta.sponsorship_items_version || "(空白)"}`,
          `schema_meta last_synced_at: ${meta.last_synced_at || "(空白)"}`,
          `schema_meta synced_by: ${meta.synced_by || "(空白)"}`,
        ]
    : [`尚未找到 ${config.schemaMetaSheetName} 工作表；請執行更新欄位選項建立同步狀態。`];

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
