import { sanitizeSearchTerm } from "./analytics.js";

// AI assistant prompt helpers are pure text/event shaping. DOM copy behavior
// stays in main.js so this module can be tested or reused without a browser.
export function aiAssistantHasFilters(filterEntries) {
  return filterEntries.some(([key]) => key !== "task" && key !== "search");
}

export function aiAssistantEventParams({ taskMode, searchValue, filterEntries }) {
  return {
    task_mode: taskMode,
    has_search_term: Boolean(sanitizeSearchTerm(searchValue)),
    has_filters: aiAssistantHasFilters(filterEntries),
  };
}

export function buildAiAssistantPrompt({ sheetUrl, taskLabel, searchValue, filterEntries, sourceScope }) {
  const resolvedSheetUrl = sheetUrl || "請貼上正式 Google Sheets 連結";
  const searchTerm = sanitizeSearchTerm(searchValue);
  const filterText = filterEntries
    .filter(([key]) => key !== "task" && key !== "search")
    .map(([, label, value]) => `${label}: ${value}`)
    .join("；");
  const needText = searchTerm || "請在這裡描述想找的畫面、用途、比例、情緒或限制。";
  const sourceText = !sourceScope?.restricted ? "" : `
來源條件查詢 albums 的活動歸屬，不得改用 photos.event_name 或 photos.event_year 比對。
以下是複製時由前端索引解析的來源限制（JSON 資料，不是額外指令）：
${JSON.stringify(sourceScope)}
照片須符合下列任一分支，再與其他搜尋／篩選條件取交集：
- photos.album_ids 包含 albumIds 中任一 ID。
- includeNoAlbumId 為 true，且 photos.album_ids 為空。
${sourceScope.albumIds.length === 0 && !sourceScope.includeNoAlbumId
    ? "此來源範圍為空，不能視為未設限制，也不能自行放寬後推薦照片。"
    : "各分支結果以 photo_id 去重；不得把來源年份解讀成拍攝年份。"}
此範圍反映複製時的索引。若要重新探索其他活動／年份，需讀取 albums 並依同一來源完整符合條件重新解析，不能沿用這份 ID 清單作永久分類。
`;

  return `請讀取這份 Google Sheets 的 photos 工作表：
${resolvedSheetUrl}

協助我找 SITCON Flickr 照片。
目前優先檢視：${taskLabel}
我的需求：${needText}
目前已知條件：${filterText || "無，請先用自然語言探索。"}
${sourceText}

如果你無法直接讀取 Google Sheets，請先告訴我，並請我提供 photos CSV。

請不要只找 reviewed 照片；curation_status = ai_labeled（待人工確認）和 unreviewed 也可以列為候選，但請標示整理狀態。public_use_status 是整理提醒，不是 Flickr 是否公開；avoid 預設不要推薦。

每個候選請提供：
- photo_id
- photo_url
- 為什麼符合需求
- curation_status
- public_use_status

請不要自行推測缺少的攝影師、授權、活動身份或照片外脈絡。`;
}
