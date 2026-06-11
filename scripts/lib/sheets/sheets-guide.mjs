import {
  flickrAlbumsUrl,
  googleSheetsPracticeSpreadsheetId,
  googleSheetsSpreadsheetId,
  repositoryUrl,
  projectConfig,
} from "../core/project-config.mjs";

export const guideSheetName = "使用說明";
export const guideColumnCount = 4;

const frontendUrl = projectConfig.frontend?.metadata?.siteUrl ?? "https://sitcon.org/flickr-photo-finder/";

export function spreadsheetUrl(spreadsheetId) {
  return spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : "";
}

export function guideRow(kind, values) {
  return { kind, values: values.slice(0, guideColumnCount) };
}

export function blankGuideRow() {
  return guideRow("blank", ["", "", "", ""]);
}

export function guideRows({
  formalSpreadsheetId = googleSheetsSpreadsheetId,
  practiceSpreadsheetId = googleSheetsPracticeSpreadsheetId,
  target,
}) {
  const practiceUrl = spreadsheetUrl(practiceSpreadsheetId);
  const isPractice = target === "practice";
  return [
    guideRow("title", [isPractice ? "SITCON Flickr Photo Finder 練習用試算表" : "SITCON Flickr Photo Finder 使用說明", "", "", ""]),
    guideRow("body", [
      isPractice
        ? "這張試算表給整理者練習操作。可以試著選照片、開啟右側整理面板、修改欄位與儲存；內容會由維護者定期重置，不是正式照片索引。"
        : "這張分頁給第一次進入 Google Sheets 的整理者。先確認自己要找照片、整理正式資料，或只是先練習操作。",
      "",
      "",
      "",
    ]),
    blankGuideRow(),
    guideRow("section", ["先判斷你要做什麼", "", "", ""]),
    guideRow("tableHeader", ["你想做的事", "從哪裡開始", "操作方式", "提醒"]),
    guideRow("tableRow", ["找照片", "公開搜尋前端", frontendUrl, "只能讀取，不會改到照片索引。"]),
    guideRow("tableRow", ["整理正式資料", isPractice ? "正式照片索引" : "photos 分頁", isPractice ? spreadsheetUrl(formalSpreadsheetId) : "選一列照片，再從上方「SITCON Photo Finder」選「開始整理照片」。", isPractice ? "練習熟悉後，再回正式表整理真正資料。" : "右側整理面板會顯示照片預覽與可編輯欄位。"]),
    guideRow("tableRow", ["檢查資料", "SITCON Photo Finder 選單", "使用「檢查這張照片」、「檢查全部照片」或「檢查公開資料格式」。", "結果會寫到 validation_report。"]),
    isPractice
      ? guideRow("tableRow", ["練習編輯", "這張試算表", "選一列照片，再從上方「SITCON Photo Finder」選「開始整理照片」。", "可以試填；資料可能被重置。"])
      : guideRow("tableRow", ["練習編輯", "練習用試算表", practiceUrl || "請維護者先建立練習用試算表", practiceUrl ? "請先到練習表試填，不要在正式表測試操作。" : "練習表建立後，這裡會放固定連結。"]),
    blankGuideRow(),
    guideRow("section", ["常用分頁導覽", "", "", ""]),
    guideRow("tableHeader", ["分頁", "中文說明", "是否正式資料", "給編輯者的提醒"]),
    guideRow("tableRow", ["photos", "正式照片索引，每列是一張 Flickr 照片。", "是", "整理者主要編輯這張表。"]),
    guideRow("tableRow", ["albums", "Flickr 相簿清單與處理狀態。", "是", "通常由工具更新。"]),
    guideRow("tableRow", ["validation_report", "最近一次檢查結果。", "否", "用來看錯誤，不是照片資料。"]),
    guideRow("tableRow", ["schema_meta", "目前資料規格與同步狀態。", "否", "用來確認工具版本。"]),
    guideRow("tableRow", ["taxonomy", "受控字彙對照。", "輔助表", "看中文標籤，不要直接新增自創分類。"]),
    guideRow("tableRow", ["sponsorship_items", "贊助品項參考。", "輔助表", "用於贊助成果與佐證照片。"]),
    guideRow("tableRow", ["import_batches", "匯入批次紀錄。", "是", "通常由工具追加。"]),
    blankGuideRow(),
    guideRow("section", ["英文欄位怎麼看", "", "", ""]),
    guideRow("body", ["欄位名稱保留英文是為了讓 repo 工具、CSV、Apps Script 與公開前端共用同一份資料契約。操作時請優先看右側整理面板與欄位提示。", "", "", ""]),
    guideRow("tableHeader", ["常見欄位", "中文理解", "常見欄位", "中文理解"]),
    guideRow("tableRow", ["photo_id", "照片編號", "recommended_uses", "建議用途"]),
    guideRow("tableRow", ["scene_tags", "場景標籤", "curation_status", "整理狀態"]),
    guideRow("tableRow", ["public_use_status", "使用提醒", "curation_notes", "公開整理備註"]),
    blankGuideRow(),
    guideRow("section", ["重要邊界", "", "", ""]),
    guideRow("tableHeader", ["事項", "說明", "連結", "提醒"]),
    guideRow("tableRow", ["照片來源", "照片仍在 Flickr；發布或交付素材前，請回 Flickr 原頁確認脈絡。", flickrAlbumsUrl, "這裡只是索引，不保存原圖。"]),
    guideRow("tableRow", ["AI 標記", "AI 標記只是候選。", "", "ai_labeled 不等於 reviewed。"]),
    guideRow("tableRow", ["公開欄位", "curation_notes 等欄位會進入公開索引。", "", "不要放敏感內部資訊。"]),
    guideRow("tableRow", ["專案文件", "規則、工具與重建流程放在 GitHub。", repositoryUrl, "技術維護請從 README 與 docs/README.md 開始。"]),
  ];
}

export function valuesFromGuideRows(rows) {
  return rows.map((item) => {
    const values = [...item.values];
    while (values.length < guideColumnCount) {
      values.push("");
    }
    return values;
  });
}

export function targetLabelFromGuideRows(rows) {
  return rows[0]?.values?.[0]?.includes("練習用") ? "practice" : "formal";
}
