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

export function buildAiAssistantPrompt({ sheetUrl, taskLabel, searchValue, filterEntries }) {
  const resolvedSheetUrl = sheetUrl || "請貼上正式 Google Sheets 連結";
  const searchTerm = sanitizeSearchTerm(searchValue);
  const filterText = filterEntries
    .filter(([key]) => key !== "task" && key !== "search")
    .map(([, label, value]) => `${label}: ${value}`)
    .join("；");
  const needText = searchTerm || "請在這裡描述想找的畫面、用途、比例、情緒或限制。";

  return `請讀取這份 Google Sheets 的 photos 工作表：
${resolvedSheetUrl}

協助我找 SITCON Flickr 照片。
目前優先檢視：${taskLabel}
我的需求：${needText}
目前已知條件：${filterText || "無，請先用自然語言探索。"}

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
