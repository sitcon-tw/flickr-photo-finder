import { dataSources, projectConfigUrl } from "./config.js";

const controls = {
  search: document.querySelector("#searchInput"),
  sort: document.querySelector("#sortSelect"),
  use: document.querySelector("#useFilter"),
  mood: document.querySelector("#moodFilter"),
  scene: document.querySelector("#sceneFilter"),
  peopleCount: document.querySelector("#peopleCountFilter"),
  subjectType: document.querySelector("#subjectTypeFilter"),
  orientation: document.querySelector("#orientationFilter"),
  negativeSpace: document.querySelector("#negativeSpaceFilter"),
  safeCrop: document.querySelector("#safeCropFilter"),
  sponsorshipTag: document.querySelector("#sponsorshipTagFilter"),
  sponsorshipItem: document.querySelector("#sponsorshipItemFilter"),
  publicStatus: document.querySelector("#publicStatusFilter"),
  priority: document.querySelector("#priorityFilter"),
  curationStatus: document.querySelector("#curationStatusFilter"),
  collection: document.querySelector("#collectionFilter"),
  reset: document.querySelector("#resetButton"),
  loadMore: document.querySelector("#loadMoreButton"),
  copyCandidates: document.querySelector("#copyCandidatesButton"),
  clearCandidates: document.querySelector("#clearCandidatesButton"),
  copyAiAssistantPrompt: document.querySelector("#copyAiAssistantPromptButton"),
};

const elements = {
  grid: document.querySelector("#photoGrid"),
  summary: document.querySelector("#resultSummary"),
  context: document.querySelector("#resultContext"),
  activeFilters: document.querySelector("#activeFilters"),
  overviewGrid: document.querySelector("#overviewGrid"),
  overviewSummary: document.querySelector("#overviewSummary"),
  template: document.querySelector("#photoCardTemplate"),
  appTitle: document.querySelector("#appTitle"),
  sourceLink: document.querySelector("#sourceLink"),
  taskModes: document.querySelector("#taskModes"),
  sponsorshipItemOptions: document.querySelector("#sponsorshipItemOptions"),
  loadMorePanel: document.querySelector("#loadMorePanel"),
  loadMoreSummary: document.querySelector("#loadMoreSummary"),
  candidateSummary: document.querySelector("#candidateSummary"),
  candidateList: document.querySelector("#candidateList"),
  aiAssistantSheetLink: document.querySelector("#aiAssistantSheetLink"),
};

const pageSize = 96;
const searchDebounceMs = 180;
const resultTrackingDelayMs = 600;
const discoverWindowSize = 24;
const discoverHistorySize = 12;

const peopleCountFilters = [
  { label: "全部人數", value: "" },
  { label: "未標記", value: "unknown" },
  { label: "無人", value: "0" },
  { label: "1 人", value: "1" },
  { label: "2-5 人", value: "2-5" },
  { label: "6-20 人", value: "6-20" },
  { label: "21 人以上", value: "21+" },
];

const subjectTypeLabels = new Map([
  ["people", "人物"],
  ["object", "物件"],
  ["food", "餐食茶點"],
  ["text_signage", "文字標示"],
  ["screen", "螢幕"],
  ["space", "空間"],
]);

const orientationLabels = new Map([
  ["landscape", "橫式"],
  ["portrait", "直式"],
  ["square", "方形"],
]);

const publicStatusLabels = new Map([
  ["approved", "已確認"],
  ["needs_review", "待整理確認"],
  ["avoid", "不建議"],
]);

const curationStatusLabels = new Map([
  ["reviewed", "已整理"],
  ["ai_labeled", "AI 初標"],
  ["unreviewed", "未整理"],
]);

const taskModes = [
  {
    id: "all",
    label: "全部照片",
    description: "不套任務權重",
  },
  {
    id: "social",
    label: "社群貼文",
    description: "友善、交流、可裁切",
    recommendedUses: ["社群貼文", "社群介紹", "活動回顧"],
    moods: ["友善", "交流感", "青春感", "活力", "熱鬧"],
    scenes: ["會眾", "交流", "工作人員"],
    safeCrops: ["1:1", "16:9", "9:16"],
    prefersNegativeSpace: true,
  },
  {
    id: "hero",
    label: "網站 hero",
    description: "橫式、留白、代表性",
    recommendedUses: ["網站 hero", "社群介紹"],
    moods: ["專業", "青春感", "友善"],
    scenes: ["舞台", "會眾", "交流", "場地", "背板"],
    orientations: ["landscape"],
    safeCrops: ["16:9"],
    prefersNegativeSpace: true,
  },
  {
    id: "visual",
    label: "主視覺/背景",
    description: "可做設計素材",
    recommendedUses: ["網站 hero", "社群貼文", "簡報"],
    moods: ["專業", "青春感", "活力", "安靜"],
    scenes: ["場地", "背板", "舞台", "交流"],
    orientations: ["landscape", "square"],
    safeCrops: ["16:9", "1:1", "9:16"],
    prefersNegativeSpace: true,
  },
  {
    id: "sponsor-pitch",
    label: "贊助提案",
    description: "互動、觸及、品牌價值",
    recommendedUses: ["贊助提案", "簡報"],
    moods: ["熱鬧", "專業", "交流感"],
    scenes: ["攤位", "會眾", "交流", "舞台"],
    sponsorshipTags: ["品牌露出", "會眾互動", "觸及學生族群", "社群信任感", "參與者體驗"],
  },
  {
    id: "sponsor-report",
    label: "贊助成果",
    description: "品項與成果佐證",
    recommendedUses: ["贊助成果報告"],
    scenes: ["攤位", "會眾", "背板", "舞台", "螢幕"],
    sponsorshipTags: ["贊助成果佐證", "品牌露出", "會眾互動", "主舞台曝光", "議程曝光"],
  },
  {
    id: "press",
    label: "新聞稿/簡報",
    description: "正式、代表性、可追溯",
    recommendedUses: ["新聞稿", "簡報", "社群介紹", "活動回顧"],
    moods: ["專業", "專注", "儀式感", "交流感"],
    scenes: ["舞台", "講者", "會眾", "背板", "場地"],
    orientations: ["landscape"],
  },
  {
    id: "volunteer",
    label: "志工招募",
    description: "幕後、活力、參與感",
    recommendedUses: ["志工招募"],
    moods: ["幕後感", "友善", "青春感", "活力"],
    scenes: ["工作人員", "交流", "報到", "攝影"],
  },
  {
    id: "recap",
    label: "活動回顧",
    description: "規模、交流、成果",
    recommendedUses: ["活動回顧", "社群介紹"],
    moods: ["熱鬧", "成就感", "交流感", "儀式感"],
    scenes: ["會眾", "舞台", "合照", "交流", "講者"],
  },
];

let photos = [];
let photoSchema;
let listFields = [];
let currentResults = [];
let visibleCount = pageSize;
let renderTimer = 0;
let projectConfig = {};

const state = {
  taskMode: "all",
  selectedPhotoIds: new Set(),
  lastTrackedZeroState: "",
};

const analytics = {
  enabled: false,
  lastTrackedResultsState: "",
  pendingResultsSource: "",
  resultsTimer: 0,
};

function cleanParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  );
}

function normalizeMeasurementId(value) {
  const measurementId = String(value ?? "").trim();
  return /^G-[A-Z0-9]+$/.test(measurementId) ? measurementId : "";
}

function setupAnalytics(config) {
  const measurementId = normalizeMeasurementId(config.frontend?.ga4MeasurementId);
  if (!measurementId) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(script);

  window.gtag("js", new Date());
  window.gtag("config", measurementId);
  analytics.enabled = true;
}

function photosSheetUrl() {
  const spreadsheetId = String(projectConfig.googleSheets?.spreadsheetId ?? "").trim();
  if (!spreadsheetId) {
    return "";
  }
  const gid = encodeURIComponent(String(projectConfig.googleSheets?.photosSheetGid ?? 0));
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}`;
}

function setExternalLink(link, href) {
  if (!href) {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    return;
  }
  link.href = href;
  link.removeAttribute("aria-disabled");
}

function trackEvent(name, params = {}) {
  if (!analytics.enabled || typeof window.gtag !== "function") {
    return;
  }
  window.gtag("event", name, cleanParams(params));
}

function resultCountBucket(count) {
  if (count === 0) {
    return "0";
  }
  if (count <= 5) {
    return "1_5";
  }
  if (count <= 20) {
    return "6_20";
  }
  return "21_plus";
}

function sanitizeSearchTerm(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

function currentFilterSnapshot() {
  return {
    taskMode: state.taskMode,
    searchTerm: sanitizeSearchTerm(controls.search.value),
    recommendedUse: controls.use.value,
    mood: controls.mood.value,
    sortMode: controls.sort.value,
    scene: controls.scene.value,
    peopleCount: controls.peopleCount.value,
    subjectType: controls.subjectType.value,
    orientation: controls.orientation.value,
    negativeSpace: controls.negativeSpace.value,
    safeCrop: controls.safeCrop.value,
    sponsorshipTag: controls.sponsorshipTag.value,
    sponsorshipItem: sanitizeSearchTerm(controls.sponsorshipItem.value),
    publicUseStatus: controls.publicStatus.value,
    priorityLevel: controls.priority.value,
    curationStatus: controls.curationStatus.value,
    collection: controls.collection.value,
    resultCount: currentResults.length,
  };
}

function hasActiveFilters(snapshot) {
  return Boolean(
    snapshot.taskMode !== "all" ||
      snapshot.recommendedUse ||
      snapshot.mood ||
      snapshot.scene ||
      snapshot.peopleCount ||
      snapshot.subjectType ||
      snapshot.orientation ||
      snapshot.negativeSpace ||
      snapshot.safeCrop ||
      snapshot.sponsorshipTag ||
      snapshot.sponsorshipItem ||
      snapshot.publicUseStatus ||
      snapshot.priorityLevel ||
      snapshot.curationStatus ||
      snapshot.collection,
  );
}

function hasTrackedResultState(snapshot) {
  return hasActiveFilters(snapshot) || Boolean(snapshot.searchTerm) || snapshot.sortMode !== "recommended";
}

function resultsEventParams(snapshot) {
  return {
    result_count: snapshot.resultCount,
    result_count_bucket: resultCountBucket(snapshot.resultCount),
    search_surface: "main",
    task_mode: snapshot.taskMode,
    sort_mode: snapshot.sortMode,
    recommended_use: snapshot.recommendedUse,
    public_use_status: snapshot.publicUseStatus,
    priority_level: snapshot.priorityLevel,
    curation_status: snapshot.curationStatus,
    sponsorship_filter_used: Boolean(snapshot.sponsorshipItem || snapshot.sponsorshipTag),
    collection_filter_used: Boolean(snapshot.collection),
  };
}

function trackVisibleResults(source) {
  const snapshot = currentFilterSnapshot();
  const stateText = JSON.stringify({ source, ...snapshot });
  if (stateText === analytics.lastTrackedResultsState) {
    return;
  }
  analytics.lastTrackedResultsState = stateText;

  if (source === "search" && snapshot.searchTerm) {
    trackEvent("search", {
      search_term: snapshot.searchTerm,
      has_filters: hasActiveFilters(snapshot),
      ...resultsEventParams(snapshot),
    });
    return;
  }

  if (hasTrackedResultState(snapshot)) {
    trackEvent("filter_results", {
      has_search_term: Boolean(snapshot.searchTerm),
      mood_filter_used: Boolean(snapshot.mood),
      scene_filter_used: Boolean(snapshot.scene),
      people_count_filter: snapshot.peopleCount,
      subject_type: snapshot.subjectType,
      orientation_filter: snapshot.orientation,
      safe_crop_filter: snapshot.safeCrop,
      ...resultsEventParams(snapshot),
    });
  }
}

function scheduleResultsTracking(source) {
  analytics.pendingResultsSource = source;
  clearTimeout(analytics.resultsTimer);
  analytics.resultsTimer = window.setTimeout(() => {
    trackVisibleResults(analytics.pendingResultsSource);
  }, resultTrackingDelayMs);
}

function applyProjectConfig(config) {
  projectConfig = config;
  const title = config.frontend?.appTitle ?? "Flickr Photo Finder";
  document.title = title;
  elements.appTitle.textContent = title;
  elements.sourceLink.href = config.flickr?.profileUrl ?? "https://www.flickr.com/";
  elements.sourceLink.textContent = config.frontend?.sourceLinkLabel ?? "Flickr";
  setExternalLink(elements.aiAssistantSheetLink, photosSheetUrl());
  setupAnalytics(config);
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      field = "";
      row = [];
      continue;
    }

    field += char;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function parseList(value) {
  return String(value ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toObjects(rows, schema) {
  const [headers, ...dataRows] = rows;
  const fieldSet = new Set(schema.tables.photos.fields.map((field) => field.name));
  return dataRows.map((row, index) => {
    const photo = Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""]));
    photo._sheet_row_number = index + 2;
    for (const field of listFields) {
      photo[field] = parseList(photo[field] ?? "");
    }
    for (const field of fieldSet) {
      if (!(field in photo)) {
        photo[field] = "";
      }
    }
    photo.search_text = buildSearchText(photo);
    return photo;
  });
}

function applySchema(schema) {
  photoSchema = schema;
  listFields = schema.tables.photos.fields
    .filter((field) => field.multi_value)
    .map((field) => field.name);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "zh-Hant-TW"),
  );
}

function fillSelect(select, label, values) {
  select.replaceChildren();
  select.append(new Option(label, ""));
  for (const value of values) {
    select.append(new Option(value, value));
  }
}

function fillSelectWithLabels(select, label, values, labels) {
  select.replaceChildren();
  select.append(new Option(label, ""));
  for (const value of values) {
    select.append(new Option(labels.get(value) ?? value, value));
  }
}

function setupTaskModes() {
  elements.taskModes.replaceChildren();
  for (const task of taskModes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "task-mode";
    button.dataset.taskMode = task.id;
    button.innerHTML = `<strong>${task.label}</strong><span>${task.description}</span>`;
    elements.taskModes.append(button);
  }
}

function setupFilters(taxonomy) {
  fillSelect(controls.use, "全部用途", taxonomy.recommended_uses ?? []);
  fillSelect(controls.mood, "全部氛圍", taxonomy.mood_tags ?? []);
  fillSelect(controls.scene, "全部場景", taxonomy.scene_tags ?? []);
  controls.peopleCount.replaceChildren(
    ...peopleCountFilters.map(({ label, value }) => new Option(label, value)),
  );
  fillSelectWithLabels(controls.subjectType, "全部主體", taxonomy.subject_type ?? [], subjectTypeLabels);
  fillSelectWithLabels(controls.orientation, "全部方向", taxonomy.orientation ?? [], orientationLabels);
  fillSelect(controls.safeCrop, "全部裁切", taxonomy.safe_crop ?? []);
  fillSelect(controls.sponsorshipTag, "全部贊助價值", taxonomy.sponsorship_tags ?? []);
  fillSelect(controls.publicStatus, "全部使用提醒", taxonomy.public_use_status ?? []);
  fillSelect(controls.priority, "全部優先度", taxonomy.priority_level ?? []);
  fillSelect(controls.curationStatus, "全部整理狀態", taxonomy.curation_status ?? []);
  fillSelect(
    controls.collection,
    "全部素材包",
    uniqueSorted(photos.flatMap((photo) => photo.collections)),
  );
  elements.sponsorshipItemOptions.replaceChildren(
    ...(taxonomy.sponsorship_items ?? []).map((value) => {
      const option = document.createElement("option");
      option.value = value;
      return option;
    }),
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function derivedSearchTokens(photo) {
  const tokens = [];
  if (photo.has_negative_space === "true") {
    tokens.push("有留白", "可放字", "適合放字", "negative space");
  }
  if (photo.orientation === "landscape") {
    tokens.push("橫式", "橫幅", "hero", "網站 hero");
  }
  if (photo.orientation === "portrait") {
    tokens.push("直式", "手機", "限時動態");
  }
  if (photo.safe_crop?.length > 0) {
    tokens.push("可裁切", ...photo.safe_crop.map((value) => `${value} 裁切`));
  }
  if (photo.public_use_status === "approved") {
    tokens.push("已確認", "可用", "approved");
  }
  if (photo.public_use_status === "needs_review") {
    tokens.push("待整理確認", "使用提醒", "needs review");
  }
  if (photo.curation_status === "ai_labeled") {
    tokens.push("ai 初標", "ai labeled");
  }
  return tokens;
}

function buildSearchText(photo) {
  return [
    photo.photo_id,
    photo.photo_url,
    photo.album_title,
    photo.event_name,
    photo.event_year,
    photo.people_count,
    photo.subject_type,
    subjectTypeLabels.get(photo.subject_type),
    photo.photographer,
    photo.license,
    photo.orientation,
    orientationLabels.get(photo.orientation),
    photo.has_negative_space,
    photo.visual_description,
    photo.public_use_status,
    publicStatusLabels.get(photo.public_use_status),
    photo.priority_level,
    photo.curation_notes,
    photo.curation_status,
    curationStatusLabels.get(photo.curation_status),
    ...photo.scene_tags,
    ...photo.mood_tags,
    ...photo.recommended_uses,
    ...photo.sponsorship_items,
    ...photo.sponsorship_tags,
    ...photo.safe_crop,
    ...photo.collections,
    ...derivedSearchTokens(photo),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function queryAlternatives(term) {
  const aliases = new Map([
    ["可放字", ["可放字", "留白", "negative space"]],
    ["放字", ["可放字", "留白", "negative space"]],
    ["留白", ["留白", "可放字", "negative space"]],
    ["主視覺", ["主視覺", "網站 hero", "hero", "背景"]],
    ["kv", ["主視覺", "網站 hero", "hero", "背景"]],
    ["logo", ["logo", "品牌露出", "背板"]],
    ["品牌", ["品牌", "品牌露出", "贊助成果佐證"]],
    ["社群感", ["社群感", "社群介紹", "交流感", "友善"]],
    ["友善交流", ["友善", "交流感", "交流"]],
    ["舞台講者", ["舞台", "講者", "新聞稿", "簡報"]],
    ["志工", ["志工", "志工招募", "工作人員", "幕後感"]],
    ["正式", ["正式", "專業", "新聞稿", "簡報"]],
  ]);
  return aliases.get(term) ?? [term];
}

function textMatches(photo, query) {
  const normalized = normalizeText(query);
  if (!normalized) {
    return true;
  }

  const terms = normalized.split(/\s+/).filter(Boolean);
  return terms.every((term) => queryAlternatives(term).some((alternative) => photo.search_text.includes(alternative)));
}

function hasListValue(photo, field, value) {
  return !value || photo[field].includes(value);
}

function valuePartiallyMatchesList(photo, field, query) {
  const normalized = normalizeText(query);
  if (!normalized) {
    return true;
  }
  return photo[field].some((value) => normalizeText(value).includes(normalized));
}

function matchesPeopleCount(photo, value) {
  if (!value) {
    return true;
  }

  const normalized = String(photo.people_count ?? "").trim();
  if (value === "unknown") {
    return normalized === "";
  }

  if (!/^(0|[1-9]\d*)$/.test(normalized)) {
    return false;
  }

  const count = Number(normalized);
  if (value === "21+") {
    return count >= 21;
  }

  if (value.includes("-")) {
    const [min, max] = value.split("-").map(Number);
    return count >= min && count <= max;
  }

  return count === Number(value);
}

function matchesFilters(photo) {
  return (
    textMatches(photo, controls.search.value) &&
    hasListValue(photo, "recommended_uses", controls.use.value) &&
    hasListValue(photo, "mood_tags", controls.mood.value) &&
    hasListValue(photo, "scene_tags", controls.scene.value) &&
    matchesPeopleCount(photo, controls.peopleCount.value) &&
    (!controls.subjectType.value || photo.subject_type === controls.subjectType.value) &&
    (!controls.orientation.value || photo.orientation === controls.orientation.value) &&
    (!controls.negativeSpace.value || photo.has_negative_space === controls.negativeSpace.value) &&
    hasListValue(photo, "safe_crop", controls.safeCrop.value) &&
    hasListValue(photo, "sponsorship_tags", controls.sponsorshipTag.value) &&
    valuePartiallyMatchesList(photo, "sponsorship_items", controls.sponsorshipItem.value) &&
    hasListValue(photo, "collections", controls.collection.value) &&
    (!controls.publicStatus.value || photo.public_use_status === controls.publicStatus.value) &&
    (!controls.priority.value || photo.priority_level === controls.priority.value) &&
    (!controls.curationStatus.value || photo.curation_status === controls.curationStatus.value)
  );
}

function activeTask() {
  return taskModes.find((task) => task.id === state.taskMode) ?? taskModes[0];
}

function numericValue(value) {
  const normalized = String(value ?? "").trim();
  return /^(0|[1-9]\d*)$/.test(normalized) ? Number(normalized) : null;
}

function scoreOverlap(photoValues, taskValues, weight) {
  if (!taskValues?.length) {
    return 0;
  }
  const values = Array.isArray(photoValues) ? photoValues : [photoValues].filter(Boolean);
  return values.some((value) => taskValues.includes(value)) ? weight : 0;
}

function photoScore(photo) {
  const task = activeTask();
  const publicScore = { approved: 0, needs_review: -10, avoid: -160 };
  const curationScore = { reviewed: 60, ai_labeled: 25, unreviewed: 0 };
  const priorityScore = { high: 80, normal: 25, low: -10 };

  let score = 0;
  score += publicScore[photo.public_use_status] ?? 0;
  score += curationScore[photo.curation_status] ?? 0;
  score += priorityScore[photo.priority_level] ?? 0;
  score += isFilled(photo.image_preview_url) ? 10 : -50;

  score += scoreOverlap(photo.recommended_uses, task.recommendedUses, 150);
  score += scoreOverlap(photo.mood_tags, task.moods, 45);
  score += scoreOverlap(photo.scene_tags, task.scenes, 45);
  score += scoreOverlap(photo.sponsorship_tags, task.sponsorshipTags, 65);
  score += scoreOverlap(photo.orientation, task.orientations, 35);
  score += scoreOverlap(photo.safe_crop, task.safeCrops, 35);
  if (task.prefersNegativeSpace && photo.has_negative_space === "true") {
    score += 35;
  }

  return score;
}

function compareRecommended(left, right) {
  return (
    photoScore(right) - photoScore(left) ||
    (numericValue(right.event_year) ?? 0) - (numericValue(left.event_year) ?? 0) ||
    String(left.photo_id).localeCompare(String(right.photo_id), "zh-Hant-TW")
  );
}

function overlaps(leftValues, rightValues) {
  const left = Array.isArray(leftValues) ? leftValues.filter(Boolean) : [leftValues].filter(Boolean);
  const right = Array.isArray(rightValues) ? rightValues.filter(Boolean) : [rightValues].filter(Boolean);
  return left.some((value) => right.includes(value));
}

function discoveryPenalty(photo, recentPhotos, windowOffset) {
  let penalty = windowOffset * 4;
  for (const recentPhoto of recentPhotos) {
    if (photo.event_name && photo.event_name === recentPhoto.event_name) {
      penalty += 18;
    }
    if (photo.event_year && photo.event_year === recentPhoto.event_year) {
      penalty += 6;
    }
    if (overlaps(photo.album_ids, recentPhoto.album_ids)) {
      penalty += 14;
    }
    if (overlaps(photo.collections, recentPhoto.collections)) {
      penalty += 10;
    }
  }
  return penalty;
}

function sortForDiscovery(items) {
  const remaining = [...items].sort(compareRecommended);
  const selected = [];

  while (remaining.length > 0) {
    const recentPhotos = selected.slice(-discoverHistorySize);
    const windowLength = Math.min(discoverWindowSize, remaining.length);
    let bestOffset = 0;
    let bestPenalty = Number.POSITIVE_INFINITY;

    for (let offset = 0; offset < windowLength; offset += 1) {
      const penalty = discoveryPenalty(remaining[offset], recentPhotos, offset);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestOffset = offset;
      }
    }

    selected.push(remaining.splice(bestOffset, 1)[0]);
  }

  return selected;
}

function sortPhotos(items) {
  const sort = controls.sort.value;
  if (sort === "discover") {
    return sortForDiscovery(items);
  }

  return [...items].sort((left, right) => {
    if (sort === "newest" || sort === "oldest") {
      const leftYear = numericValue(left.event_year) ?? 0;
      const rightYear = numericValue(right.event_year) ?? 0;
      return sort === "newest" ? rightYear - leftYear : leftYear - rightYear;
    }

    if (sort === "people-desc" || sort === "people-asc") {
      const leftCount = numericValue(left.people_count) ?? -1;
      const rightCount = numericValue(right.people_count) ?? -1;
      return sort === "people-desc" ? rightCount - leftCount : leftCount - rightCount;
    }

    return compareRecommended(left, right);
  });
}

function filteredAndSortedPhotos() {
  return sortPhotos(photos.filter(matchesFilters));
}

function isFilled(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return String(value ?? "").trim() !== "";
}

function countFilled(fieldName) {
  return photos.filter((photo) => isFilled(photo[fieldName])).length;
}

function formatCountRatio(count, total = photos.length) {
  if (total === 0) {
    return "0 / 0";
  }
  const percent = Math.round((count / total) * 100);
  return `${count} / ${total} (${percent}%)`;
}

function countByField(fieldName, labels = new Map()) {
  const counts = new Map();
  for (const photo of photos) {
    const rawValue = photo[fieldName];
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const normalizedValues = values.map((value) => String(value ?? "").trim()).filter(Boolean);
    if (normalizedValues.length === 0) {
      counts.set("未填", (counts.get("未填") ?? 0) + 1);
      continue;
    }
    for (const value of normalizedValues) {
      counts.set(labels.get(value) ?? value, (counts.get(labels.get(value) ?? value) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-Hant-TW"));
}

function peopleCountBuckets() {
  const buckets = new Map([
    ["未標記", 0],
    ["無人", 0],
    ["1 人", 0],
    ["2-5 人", 0],
    ["6-20 人", 0],
    ["21 人以上", 0],
  ]);

  for (const photo of photos) {
    const value = String(photo.people_count ?? "").trim();
    if (!/^(0|[1-9]\d*)$/.test(value)) {
      buckets.set("未標記", buckets.get("未標記") + 1);
      continue;
    }

    const count = Number(value);
    if (count === 0) {
      buckets.set("無人", buckets.get("無人") + 1);
    } else if (count === 1) {
      buckets.set("1 人", buckets.get("1 人") + 1);
    } else if (count <= 5) {
      buckets.set("2-5 人", buckets.get("2-5 人") + 1);
    } else if (count <= 20) {
      buckets.set("6-20 人", buckets.get("6-20 人") + 1);
    } else {
      buckets.set("21 人以上", buckets.get("21 人以上") + 1);
    }
  }

  return [...buckets.entries()];
}

function reviewedCompletenessCount() {
  const requiredFields = photoSchema?.tables?.photos?.reviewed_required_fields ?? [];
  return photos.filter((photo) => requiredFields.every((fieldName) => isFilled(photo[fieldName]))).length;
}

function missingPreviewCount() {
  return photos.filter((photo) => !isFilled(photo.image_preview_url)).length;
}

function makeOverviewItem({ title, value, detail, values = [] }) {
  const item = document.createElement("article");
  item.className = "overview-item";

  const heading = document.createElement("h3");
  heading.textContent = title;
  const valueElement = document.createElement("strong");
  valueElement.textContent = value;
  const detailElement = document.createElement("p");
  detailElement.textContent = detail;

  item.append(heading, valueElement, detailElement);

  if (values.length > 0) {
    const list = document.createElement("dl");
    list.className = "overview-breakdown";
    for (const [label, count] of values) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");
      term.textContent = label;
      description.textContent = String(count);
      row.append(term, description);
      list.append(row);
    }
    item.append(list);
  }

  return item;
}

function renderOverview() {
  const reviewedComplete = reviewedCompletenessCount();
  const peopleCountFilled = countFilled("people_count");
  const subjectTypeFilled = countFilled("subject_type");
  const sponsorshipItemsFilled = countFilled("sponsorship_items");
  const sponsorshipTagsFilled = countFilled("sponsorship_tags");
  const missingPreview = missingPreviewCount();

  elements.overviewSummary.textContent = `共 ${photos.length} 張照片，${reviewedComplete} 張已具備 reviewed 必要欄位。`;
  elements.overviewGrid.replaceChildren(
    makeOverviewItem({
      title: "照片總數",
      value: `${photos.length}`,
      detail: `${missingPreview} 張缺少縮圖 URL。`,
    }),
    makeOverviewItem({
      title: "整理狀態",
      value: formatCountRatio(countFilled("curation_status")),
      detail: "metadata 是否人工確認。",
      values: countByField("curation_status", curationStatusLabels),
    }),
    makeOverviewItem({
      title: "使用提醒",
      value: formatCountRatio(countFilled("public_use_status")),
      detail: "整理者留下的使用提醒。",
      values: countByField("public_use_status", publicStatusLabels),
    }),
    makeOverviewItem({
      title: "Reviewed 欄位完整度",
      value: formatCountRatio(reviewedComplete),
      detail: "依 photo-schema.json 計算。",
    }),
    makeOverviewItem({
      title: "人數標記",
      value: formatCountRatio(peopleCountFilled),
      detail: "支援單人、群眾、無人畫面。",
      values: peopleCountBuckets(),
    }),
    makeOverviewItem({
      title: "主要視覺主體",
      value: formatCountRatio(subjectTypeFilled),
      detail: "照片海初篩用的粗分類。",
      values: countByField("subject_type", subjectTypeLabels),
    }),
    makeOverviewItem({
      title: "贊助品項",
      value: formatCountRatio(sponsorshipItemsFilled),
      detail: "用來找 CFS 贊助品項。",
    }),
    makeOverviewItem({
      title: "贊助價值",
      value: formatCountRatio(sponsorshipTagsFilled),
      detail: "品牌露出、互動、佐證等用途。",
    }),
  );
}

function appendDetail(details, label, values, options = {}) {
  const normalizedValues = (Array.isArray(values) ? values : [values]).filter(Boolean);
  if (normalizedValues.length === 0) {
    return;
  }

  const row = document.createElement("div");
  row.className = "detail-row";
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");

  for (const value of normalizedValues) {
    const tag = document.createElement("span");
    tag.className = options.status ? `tag status-${value}` : "tag";
    tag.textContent = options.labels?.get(value) ?? value;
    description.append(tag);
  }

  row.append(term, description);
  details.append(row);
}

function formatPeopleCount(photo) {
  const value = String(photo.people_count ?? "").trim();
  return value === "" ? "" : `${value} 人`;
}

function flickrTitle(photo) {
  const match = String(photo.curation_notes ?? "").match(/Flickr title:\s*([^.;]+)/i);
  return match?.[1]?.trim() ?? "";
}

function photoTitle(photo) {
  return photo.event_name || photo.album_title || flickrTitle(photo) || photo.photo_id;
}

function photoAnchorId(photoId) {
  return `photo-${photoId}`;
}

function finderLink(photo) {
  const url = new URL(window.location.href);
  url.hash = photoAnchorId(photo.photo_id);
  return url.toString();
}

function sheetRowLink(photo) {
  const spreadsheetId = String(projectConfig.googleSheets?.spreadsheetId ?? "").trim();
  if (!spreadsheetId || !photo._sheet_row_number) {
    return "";
  }
  const gid = encodeURIComponent(String(projectConfig.googleSheets?.photosSheetGid ?? 0));
  const range = encodeURIComponent(`A${photo._sheet_row_number}`);
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}&range=${range}`;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function setTemporaryButtonText(button, text) {
  const originalText = button.textContent;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = originalText;
  }, 1800);
}

async function copyUrlToClipboard(url, button) {
  if (!url) {
    return false;
  }
  const copied = await copyTextToClipboard(url);
  if (copied) {
    setTemporaryButtonText(button, "已複製");
  }
  return copied;
}

function buildSizedImageUrl(previewUrl, suffix) {
  if (!previewUrl) {
    return "";
  }

  try {
    const url = new URL(previewUrl);
    const match = url.pathname.match(/^(.*\/\d+_[^/_]+)(?:_(?:s|q|t|m|n|w|z|c|b))?(\.[A-Za-z0-9]+)$/);
    if (!match) {
      return "";
    }
    url.pathname = `${match[1]}_${suffix}${match[2]}`;
    return url.toString();
  } catch {
    return "";
  }
}

function largeImageUrl(photo) {
  return buildSizedImageUrl(photo.image_preview_url, "b");
}

function imageFileExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([A-Za-z0-9]+)$/);
    return match?.[1]?.toLowerCase() || "jpg";
  } catch {
    return "jpg";
  }
}

function safeFilenamePart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function imageDownloadFilename(photo, url) {
  const title = safeFilenamePart(photoTitle(photo));
  const id = safeFilenamePart(photo.photo_id) || "photo";
  return `${id}${title ? `-${title}` : ""}.${imageFileExtension(url)}`;
}

async function downloadImageUrl(url, filename) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error("圖片下載失敗");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function originalSizePageUrl(photo) {
  if (!photo.photo_url) {
    return "";
  }

  try {
    const url = new URL(photo.photo_url);
    url.hash = "";
    url.search = "";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/sizes/o/`;
    return url.toString();
  } catch {
    return "";
  }
}

function setActionLink(link, href) {
  if (!href) {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    return;
  }

  link.href = href;
  link.removeAttribute("aria-disabled");
}

function setActionButton(button, enabled) {
  button.disabled = !enabled;
}

function photoEventParams(photo, resultRank, resultCount) {
  return {
    result_rank: resultRank,
    result_count_bucket: resultCountBucket(resultCount),
    task_mode: state.taskMode,
    sort_mode: controls.sort.value,
    public_use_status: photo.public_use_status,
    curation_status: photo.curation_status,
  };
}

function trackImageSizeOpen(photo, imageSize, resultRank, resultCount) {
  trackEvent("open_image_size", {
    photo_id: photo.photo_id,
    image_size: imageSize,
    ...photoEventParams(photo, resultRank, resultCount),
  });
}

function trackImageSizeDownload(photo, imageSize, resultRank, resultCount) {
  trackEvent("download_image_size", {
    photo_id: photo.photo_id,
    image_size: imageSize,
    ...photoEventParams(photo, resultRank, resultCount),
  });
}

function statusBadges(photo) {
  const badges = [];
  if (photo.public_use_status === "avoid") {
    badges.push(["danger", "不建議"]);
  } else if (photo.public_use_status === "needs_review") {
    badges.push(["warning", "待整理確認"]);
  }

  if (photo.priority_level === "high") {
    badges.push(["success", "推薦"]);
  }
  if (photo.curation_status === "reviewed") {
    badges.push(["info", "已整理"]);
  } else if (photo.curation_status === "ai_labeled") {
    badges.push(["ai", "AI 初標"]);
  } else {
    badges.push(["neutral", "未整理"]);
  }

  return badges;
}

function firstOverlap(photoValues, taskValues) {
  const values = Array.isArray(photoValues) ? photoValues : [photoValues].filter(Boolean);
  return values.find((value) => taskValues?.includes(value)) ?? "";
}

function appendSignal(signals, label) {
  if (label && !signals.includes(label)) {
    signals.push(label);
  }
}

function sortingSignals(photo) {
  const signals = [];
  const task = activeTask();
  if (controls.search.value && textMatches(photo, controls.search.value)) {
    appendSignal(signals, "搜尋命中");
  }
  if (task.id !== "all") {
    if (scoreOverlap(photo.recommended_uses, task.recommendedUses, 1)) {
      appendSignal(signals, "用途命中");
    }
    if (scoreOverlap(photo.scene_tags, task.scenes, 1)) {
      appendSignal(signals, "場景命中");
    }
    if (scoreOverlap(photo.mood_tags, task.moods, 1)) {
      appendSignal(signals, "氛圍命中");
    }
    if (scoreOverlap(photo.sponsorship_tags, task.sponsorshipTags, 1)) {
      appendSignal(signals, "贊助價值命中");
    }
    const matchedOrientation = firstOverlap(photo.orientation, task.orientations);
    if (matchedOrientation) {
      appendSignal(signals, orientationLabels.get(matchedOrientation) ?? matchedOrientation);
    }
    const matchedCrop = firstOverlap(photo.safe_crop, task.safeCrops);
    if (matchedCrop) {
      appendSignal(signals, matchedCrop);
    }
    if (task.prefersNegativeSpace && photo.has_negative_space === "true") {
      appendSignal(signals, "有留白");
    }
  }
  if (photo.priority_level === "high") {
    appendSignal(signals, "高優先");
  }
  if (photo.public_use_status === "needs_review") {
    appendSignal(signals, "待確認");
  } else if (photo.public_use_status === "avoid") {
    appendSignal(signals, "不建議");
  }
  return signals.slice(0, 4);
}

function renderPhotoReference(container, photo, signals) {
  const idButton = document.createElement("button");
  idButton.type = "button";
  idButton.className = "photo-id-button";
  idButton.textContent = `photo_id: ${photo.photo_id}`;
  idButton.title = "複製 photo_id";
  idButton.addEventListener("click", async () => {
    try {
      const copied = await copyTextToClipboard(photo.photo_id);
      if (copied) {
        setTemporaryButtonText(idButton, "已複製 photo_id");
      }
    } catch {
      setTemporaryButtonText(idButton, "複製失敗");
    }
  });

  container.replaceChildren(idButton);

  if (signals.length === 0) {
    return;
  }

  const signalText = document.createElement("span");
  signalText.className = "sort-signal-text";
  signalText.textContent = signals.join(" / ");
  container.append(signalText);
}

function appendBadges(container, badges) {
  container.replaceChildren();
  for (const [type, label] of badges) {
    const badge = document.createElement("span");
    badge.className = `status-badge status-${type}`;
    badge.textContent = label;
    container.append(badge);
  }
}

function renderPhoto(photo, resultRank, resultCount) {
  const fragment = elements.template.content.cloneNode(true);
  const card = fragment.querySelector(".photo-card");
  const link = fragment.querySelector(".photo-link");
  const image = fragment.querySelector("img");
  const title = fragment.querySelector(".photo-title");
  const year = fragment.querySelector(".photo-year");
  const statuses = fragment.querySelector(".photo-statuses");
  const reference = fragment.querySelector(".photo-reference");
  const quickDetails = fragment.querySelector(".quick-details");
  const details = fragment.querySelector(".details");
  const downloadLargeButton = fragment.querySelector(".download-large-image-button");
  const originalImageLink = fragment.querySelector(".original-image-link");
  const sheetRowLinkElement = fragment.querySelector(".sheet-row-link");
  const candidateButton = fragment.querySelector(".candidate-toggle-button");
  const copyFlickrLinkButton = fragment.querySelector(".copy-flickr-link-button");
  const copyFinderLinkButton = fragment.querySelector(".copy-finder-link-button");
  const largeUrl = largeImageUrl(photo);
  const originalUrl = originalSizePageUrl(photo);
  const selected = state.selectedPhotoIds.has(photo.photo_id);

  card.id = photoAnchorId(photo.photo_id);
  link.href = photo.photo_url;
  link.addEventListener("click", () => {
    trackEvent("select_content", {
      content_type: "photo",
      content_id: photo.photo_id,
      ...photoEventParams(photo, resultRank, resultCount),
    });
    trackEvent("open_flickr_source", {
      photo_id: photo.photo_id,
      ...photoEventParams(photo, resultRank, resultCount),
    });
  });

  image.src = photo.image_preview_url;
  image.alt = [photoTitle(photo), photo.event_year]
    .filter(Boolean)
    .join(" ");
  title.textContent = photoTitle(photo);
  year.textContent = photo.event_year || "";
  appendBadges(statuses, statusBadges(photo));

  renderPhotoReference(reference, photo, sortingSignals(photo));

  appendDetail(quickDetails, "用途", photo.recommended_uses.slice(0, 3));
  appendDetail(quickDetails, "構圖", [orientationLabels.get(photo.orientation) ?? photo.orientation, ...photo.safe_crop].filter(Boolean));
  appendDetail(quickDetails, "贊助", [...photo.sponsorship_tags, ...photo.sponsorship_items].slice(0, 3));

  appendDetail(details, "用途", photo.recommended_uses);
  appendDetail(details, "氛圍", photo.mood_tags);
  appendDetail(details, "場景", photo.scene_tags);
  appendDetail(details, "人數", formatPeopleCount(photo));
  appendDetail(details, "主體", photo.subject_type, { labels: subjectTypeLabels });
  appendDetail(details, "方向", photo.orientation, { labels: orientationLabels });
  appendDetail(details, "留白", photo.has_negative_space === "true" ? "有留白" : photo.has_negative_space === "false" ? "無明顯留白" : "");
  appendDetail(details, "裁切", photo.safe_crop);
  appendDetail(details, "贊助品項", photo.sponsorship_items);
  appendDetail(details, "贊助價值", photo.sponsorship_tags);
  appendDetail(details, "素材包", photo.collections);
  appendDetail(details, "攝影", photo.photographer);
  appendDetail(details, "授權", photo.license);
  appendDetail(details, "使用提醒", photo.public_use_status, { status: true, labels: publicStatusLabels });
  appendDetail(details, "推薦優先度", photo.priority_level, { status: true });
  appendDetail(details, "整理狀態", photo.curation_status, { status: true, labels: curationStatusLabels });
  appendDetail(details, "Sheets 列", photo._sheet_row_number ? String(photo._sheet_row_number) : "");
  appendDetail(details, "照片 ID", photo.photo_id);
  appendDetail(details, "描述", photo.visual_description);
  appendDetail(details, "備註", photo.curation_notes);

  candidateButton.textContent = selected ? "移出候選" : "加入候選";
  candidateButton.classList.toggle("is-selected", selected);
  candidateButton.addEventListener("click", () => {
    toggleCandidate(photo.photo_id);
  });

  setActionButton(downloadLargeButton, Boolean(largeUrl));
  downloadLargeButton.addEventListener("click", async () => {
    if (!largeUrl) {
      return;
    }
    const originalText = downloadLargeButton.textContent;
    try {
      downloadLargeButton.disabled = true;
      downloadLargeButton.textContent = "下載中";
      await downloadImageUrl(largeUrl, imageDownloadFilename(photo, largeUrl));
      trackImageSizeDownload(photo, "large_1024", resultRank, resultCount);
      downloadLargeButton.textContent = "已下載";
    } catch {
      downloadLargeButton.textContent = "下載失敗";
    } finally {
      window.setTimeout(() => {
        downloadLargeButton.disabled = false;
        downloadLargeButton.textContent = originalText;
      }, 1900);
    }
  });
  setActionLink(originalImageLink, originalUrl);
  originalImageLink.addEventListener("click", (event) => {
    if (!originalUrl) {
      event.preventDefault();
      return;
    }
    trackImageSizeOpen(photo, "original", resultRank, resultCount);
  });
  setActionLink(sheetRowLinkElement, sheetRowLink(photo));

  copyFlickrLinkButton.disabled = !photo.photo_url;
  copyFlickrLinkButton.addEventListener("click", async () => {
    try {
      const copied = await copyUrlToClipboard(photo.photo_url, copyFlickrLinkButton);
      if (copied) {
        trackEvent("copy_flickr_link", {
          photo_id: photo.photo_id,
          ...photoEventParams(photo, resultRank, resultCount),
        });
      }
    } catch {
      setTemporaryButtonText(copyFlickrLinkButton, "複製失敗");
    }
  });

  copyFinderLinkButton.addEventListener("click", async () => {
    try {
      const copied = await copyUrlToClipboard(finderLink(photo), copyFinderLinkButton);
      if (copied) {
        trackEvent("copy_finder_link", {
          photo_id: photo.photo_id,
          ...photoEventParams(photo, resultRank, resultCount),
        });
      }
    } catch {
      setTemporaryButtonText(copyFinderLinkButton, "複製失敗");
    }
  });

  return card;
}

function selectedPhotos() {
  return [...state.selectedPhotoIds]
    .map((photoId) => photos.find((photo) => photo.photo_id === photoId))
    .filter(Boolean);
}

function candidateMarkdown(photo) {
  const publicStatus = publicStatusLabels.get(photo.public_use_status) || photo.public_use_status || "未填";
  const curationStatus = curationStatusLabels.get(photo.curation_status) || photo.curation_status || "未填";
  const rowLink = sheetRowLink(photo) || "未設定";

  return `- ${photoTitle(photo)} (${photo.photo_id})
  - Finder: ${finderLink(photo)}
  - Sheets: ${rowLink}
  - Flickr: ${photo.photo_url}
  - 縮圖: ${photo.image_preview_url || "未填"}
  - 整理: ${curationStatus}
  - 使用提醒: ${publicStatus}`;
}

function renderCandidates() {
  const candidates = selectedPhotos();
  elements.candidateSummary.textContent = `${candidates.length} 張候選`;
  controls.copyCandidates.disabled = candidates.length === 0;
  controls.clearCandidates.disabled = candidates.length === 0;
  elements.candidateList.replaceChildren();

  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "candidate-empty";
    empty.textContent = "尚無候選照片";
    elements.candidateList.append(empty);
    return;
  }

  for (const photo of candidates) {
    const item = document.createElement("article");
    item.className = "candidate-item";
    const thumbnail = document.createElement("a");
    thumbnail.className = "candidate-thumb";
    thumbnail.href = finderLink(photo);
    if (photo.image_preview_url) {
      const image = document.createElement("img");
      image.src = photo.image_preview_url;
      image.alt = photoTitle(photo);
      image.loading = "lazy";
      image.decoding = "async";
      thumbnail.append(image);
    } else {
      thumbnail.textContent = photo.photo_id;
    }
    const body = document.createElement("div");
    body.className = "candidate-body";
    const title = document.createElement("a");
    title.href = finderLink(photo);
    title.textContent = photoTitle(photo);
    const meta = document.createElement("p");
    meta.textContent = [
      photo.event_year,
      curationStatusLabels.get(photo.curation_status) ?? "整理未填",
      publicStatusLabels.get(photo.public_use_status),
      photo.recommended_uses.slice(0, 2).join("、"),
    ]
      .filter(Boolean)
      .join(" / ");
    body.append(title, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移除";
    remove.addEventListener("click", () => toggleCandidate(photo.photo_id));
    item.append(thumbnail, body, remove);
    elements.candidateList.append(item);
  }
}

function toggleCandidate(photoId) {
  if (state.selectedPhotoIds.has(photoId)) {
    state.selectedPhotoIds.delete(photoId);
    trackEvent("remove_candidate", { photo_id: photoId, task_mode: state.taskMode, sort_mode: controls.sort.value });
  } else {
    state.selectedPhotoIds.add(photoId);
    trackEvent("add_candidate", { photo_id: photoId, task_mode: state.taskMode, sort_mode: controls.sort.value });
  }
  render({ preservePage: true, source: "candidate" });
}

async function copyCandidateList() {
  const text = selectedPhotos().map(candidateMarkdown).join("\n\n");
  if (!text) {
    return;
  }
  try {
    const copied = await copyTextToClipboard(text);
    if (copied) {
      setTemporaryButtonText(controls.copyCandidates, "已複製");
      trackEvent("copy_candidate_list", {
        candidate_count: state.selectedPhotoIds.size,
        task_mode: state.taskMode,
        sort_mode: controls.sort.value,
      });
    }
  } catch {
    setTemporaryButtonText(controls.copyCandidates, "複製失敗");
  }
}

function clearCandidates() {
  state.selectedPhotoIds.clear();
  render({ preservePage: true, source: "candidate" });
}

function selectedOptionText(select) {
  return select.selectedOptions[0]?.textContent ?? select.value;
}

function aiAssistantHasFilters() {
  return activeFilterEntries().some(([key]) => key !== "task" && key !== "search");
}

function aiAssistantEventParams() {
  return {
    task_mode: state.taskMode,
    has_search_term: Boolean(sanitizeSearchTerm(controls.search.value)),
    has_filters: aiAssistantHasFilters(),
  };
}

function currentAiAssistantPrompt() {
  const sheetUrl = photosSheetUrl() || "請貼上正式 Google Sheets 連結";
  const searchTerm = sanitizeSearchTerm(controls.search.value);
  const filterText = activeFilterEntries()
    .filter(([key]) => key !== "task" && key !== "search")
    .map(([, label, value]) => `${label}: ${value}`)
    .join("；");
  const needText = searchTerm || "請在這裡描述想找的畫面、用途、比例、情緒或限制。";

  return `請讀取這份 Google Sheets 的 photos 工作表：
${sheetUrl}

協助我找 SITCON Flickr 照片。
任務情境：${activeTask().label}
我的需求：${needText}
目前已知條件：${filterText || "無，請先用自然語言探索。"}

如果你無法直接讀取 Google Sheets，請先告訴我，並請我提供 photos CSV。

請不要只找 reviewed 照片；ai_labeled 和 unreviewed 也可以列為候選，但請標示整理狀態。public_use_status 是整理提醒，不是 Flickr 是否公開；avoid 預設不要推薦。

每個候選請提供：
- photo_id
- photo_url
- 為什麼符合需求
- curation_status
- public_use_status

請不要自行推測缺少的攝影師、授權、活動身份或照片外脈絡。`;
}

async function copyAiAssistantPrompt() {
  try {
    const copied = await copyTextToClipboard(currentAiAssistantPrompt());
    if (copied) {
      setTemporaryButtonText(controls.copyAiAssistantPrompt, "已複製");
      trackEvent("copy_ai_assistant_prompt", aiAssistantEventParams());
    }
  } catch {
    setTemporaryButtonText(controls.copyAiAssistantPrompt, "複製失敗");
  }
}

function activeFilterEntries() {
  const entries = [];
  if (state.taskMode !== "all") {
    entries.push(["task", "任務", activeTask().label]);
  }
  if (controls.search.value.trim()) {
    entries.push(["search", "搜尋", sanitizeSearchTerm(controls.search.value)]);
  }
  for (const [key, label, control] of [
    ["use", "用途", controls.use],
    ["mood", "氛圍", controls.mood],
    ["scene", "場景", controls.scene],
    ["peopleCount", "人數", controls.peopleCount],
    ["subjectType", "主體", controls.subjectType],
    ["orientation", "方向", controls.orientation],
    ["negativeSpace", "留白", controls.negativeSpace],
    ["safeCrop", "裁切", controls.safeCrop],
    ["sponsorshipTag", "贊助價值", controls.sponsorshipTag],
    ["publicStatus", "使用提醒", controls.publicStatus],
    ["priority", "優先度", controls.priority],
    ["curationStatus", "整理狀態", controls.curationStatus],
    ["collection", "素材包", controls.collection],
  ]) {
    if (control.value) {
      entries.push([key, label, selectedOptionText(control)]);
    }
  }
  if (controls.sponsorshipItem.value.trim()) {
    entries.push(["sponsorshipItem", "贊助品項", controls.sponsorshipItem.value.trim()]);
  }
  return entries;
}

function clearFilter(key) {
  if (key === "task") {
    state.taskMode = "all";
  } else if (key === "search") {
    controls.search.value = "";
  } else if (controls[key]) {
    controls[key].value = "";
  }
  render({ resetPage: true, source: "filter" });
}

function renderActiveFilters() {
  const entries = activeFilterEntries();
  elements.activeFilters.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement("span");
    empty.className = "filter-chip muted-chip";
    empty.textContent = "未套用條件";
    elements.activeFilters.append(empty);
    return;
  }

  for (const [key, label, value] of entries) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip";
    chip.dataset.filterKey = key;
    chip.textContent = `${label}: ${value} ×`;
    elements.activeFilters.append(chip);
  }
}

function sortContextText() {
  const task = activeTask();
  const taskPrefix = task.id === "all" ? "全部照片" : `「${task.label}」情境`;
  if (controls.sort.value === "discover") {
    return `以${taskPrefix}探索更多排序，分散年份、活動、相簿與素材包來源`;
  }
  if (controls.sort.value === "newest") {
    return "以年份新到舊排序";
  }
  if (controls.sort.value === "oldest") {
    return "以年份舊到新排序";
  }
  if (controls.sort.value === "people-desc") {
    return "以人數多到少排序";
  }
  if (controls.sort.value === "people-asc") {
    return "以人數少到多排序";
  }
  return task.id === "all" ? "以推薦排序" : `以「${task.label}」情境推薦排序`;
}

function resultContextText(filtered) {
  if (photos.length === 0) {
    return "尚未載入照片";
  }
  if (filtered.length === 0) {
    return "目前條件沒有結果，可放寬整理狀態、任務條件或清除使用提醒。";
  }
  const filterText = activeFilterEntries()
    .filter(([key]) => key !== "task")
    .map(([, label, value]) => `${label} ${value}`)
    .join(" / ");
  return `${sortContextText()}，仍顯示符合篩選的照片。${filterText ? `已套用：${filterText}` : "未套用額外篩選。"}`;
}

function updateTaskButtons() {
  for (const button of elements.taskModes.querySelectorAll(".task-mode")) {
    button.classList.toggle("is-active", button.dataset.taskMode === state.taskMode);
  }
}

function updateLoadMore(filtered) {
  const renderedCount = Math.min(visibleCount, filtered.length);
  const remaining = filtered.length - renderedCount;
  elements.loadMorePanel.hidden = remaining <= 0 || filtered.length === 0;
  elements.loadMoreSummary.textContent = `已顯示 ${renderedCount} 張，尚有 ${remaining} 張`;
}

function renderEmpty(text) {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = text;
  elements.grid.append(empty);
}

function render({ resetPage = false, preservePage = false, source = "" } = {}) {
  const filtered = filteredAndSortedPhotos();
  currentResults = filtered;
  if (resetPage || (!preservePage && visibleCount <= 0)) {
    visibleCount = pageSize;
  }

  updateTaskButtons();
  renderActiveFilters();
  renderCandidates();
  elements.grid.replaceChildren();
  elements.summary.textContent = `${filtered.length} / ${photos.length} 張照片`;
  elements.context.textContent = resultContextText(filtered);

  if (photos.length === 0) {
    renderEmpty("fixtures/photos.csv 目前沒有照片資料");
    updateLoadMore(filtered);
    return;
  }

  if (filtered.length === 0) {
    renderEmpty("沒有符合條件的照片");
    updateLoadMore(filtered);
    maybeTrackZeroResults();
    syncUrlState();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const [index, photo] of filtered.slice(0, visibleCount).entries()) {
    fragment.append(renderPhoto(photo, index + 1, filtered.length));
  }
  elements.grid.append(fragment);
  updateLoadMore(filtered);
  syncUrlState();

  if (source) {
    scheduleResultsTracking(source);
  }
}

function maybeTrackZeroResults() {
  const snapshot = currentFilterSnapshot();
  if (!hasTrackedResultState(snapshot)) {
    return;
  }
  const zeroState = JSON.stringify(snapshot);
  if (zeroState === state.lastTrackedZeroState) {
    return;
  }
  state.lastTrackedZeroState = zeroState;
  trackEvent("zero_results", resultsEventParams(snapshot));
}

function resetFilters() {
  state.taskMode = "all";
  controls.search.value = "";
  controls.sort.value = "recommended";
  controls.use.value = "";
  controls.mood.value = "";
  controls.scene.value = "";
  controls.peopleCount.value = "";
  controls.subjectType.value = "";
  controls.orientation.value = "";
  controls.negativeSpace.value = "";
  controls.safeCrop.value = "";
  controls.sponsorshipTag.value = "";
  controls.sponsorshipItem.value = "";
  controls.publicStatus.value = "";
  controls.priority.value = "";
  controls.curationStatus.value = "";
  controls.collection.value = "";
  render({ resetPage: true, source: "filter" });
}

function urlValue(key, value) {
  return value ? [[key, value]] : [];
}

function syncUrlState() {
  const url = new URL(window.location.href);
  const params = new URLSearchParams();
  for (const [key, value] of [
    ...urlValue("task", state.taskMode !== "all" ? state.taskMode : ""),
    ...urlValue("q", controls.search.value.trim()),
    ...urlValue("sort", controls.sort.value !== "recommended" ? controls.sort.value : ""),
    ...urlValue("use", controls.use.value),
    ...urlValue("mood", controls.mood.value),
    ...urlValue("scene", controls.scene.value),
    ...urlValue("people", controls.peopleCount.value),
    ...urlValue("subject", controls.subjectType.value),
    ...urlValue("orientation", controls.orientation.value),
    ...urlValue("negative", controls.negativeSpace.value),
    ...urlValue("crop", controls.safeCrop.value),
    ...urlValue("sponsorTag", controls.sponsorshipTag.value),
    ...urlValue("sponsorItem", controls.sponsorshipItem.value.trim()),
    ...urlValue("public", controls.publicStatus.value),
    ...urlValue("priority", controls.priority.value),
    ...urlValue("curation", controls.curationStatus.value),
    ...urlValue("collection", controls.collection.value),
    ...urlValue("selected", [...state.selectedPhotoIds].join(",")),
  ]) {
    params.set(key, value);
  }
  url.search = params.toString();
  window.history.replaceState(null, "", url);
}

function setControlValue(control, value) {
  if (value && [...control.options].some((option) => option.value === value)) {
    control.value = value;
  }
}

function applyUrlState() {
  const params = new URLSearchParams(window.location.search);
  const task = params.get("task");
  if (taskModes.some((mode) => mode.id === task)) {
    state.taskMode = task;
  }
  controls.search.value = params.get("q") ?? "";
  setControlValue(controls.sort, params.get("sort") ?? "");
  setControlValue(controls.use, params.get("use") ?? "");
  setControlValue(controls.mood, params.get("mood") ?? "");
  setControlValue(controls.scene, params.get("scene") ?? "");
  setControlValue(controls.peopleCount, params.get("people") ?? "");
  setControlValue(controls.subjectType, params.get("subject") ?? "");
  setControlValue(controls.orientation, params.get("orientation") ?? "");
  setControlValue(controls.negativeSpace, params.get("negative") ?? "");
  setControlValue(controls.safeCrop, params.get("crop") ?? "");
  setControlValue(controls.sponsorshipTag, params.get("sponsorTag") ?? "");
  controls.sponsorshipItem.value = params.get("sponsorItem") ?? "";
  setControlValue(controls.publicStatus, params.get("public") ?? "");
  setControlValue(controls.priority, params.get("priority") ?? "");
  setControlValue(controls.curationStatus, params.get("curation") ?? "");
  setControlValue(controls.collection, params.get("collection") ?? "");
  for (const photoId of (params.get("selected") ?? "").split(",").filter(Boolean)) {
    state.selectedPhotoIds.add(photoId);
  }
}

function revealPhotoFromHash() {
  const match = window.location.hash.match(/^#photo-(\d+)$/);
  if (!match) {
    return;
  }

  const targetId = match[1];
  const resultIndex = currentResults.findIndex((photo) => photo.photo_id === targetId);
  if (resultIndex >= visibleCount) {
    visibleCount = Math.ceil((resultIndex + 1) / pageSize) * pageSize;
    render({ preservePage: true });
  }

  const card = document.getElementById(photoAnchorId(targetId));
  if (!card) {
    return;
  }

  card.scrollIntoView({ block: "center" });
}

async function loadData() {
  const [photosResponse, schemaResponse, taxonomyResponse, projectConfigResponse] = await Promise.all([
    fetch(dataSources.photosCsvUrl),
    fetch(dataSources.schemaJsonUrl),
    fetch(dataSources.taxonomyJsonUrl),
    fetch(projectConfigUrl),
  ]);

  if (!photosResponse.ok || !schemaResponse.ok || !taxonomyResponse.ok || !projectConfigResponse.ok) {
    throw new Error("資料載入失敗");
  }

  const [photosText, schema, taxonomy, projectConfig] = await Promise.all([
    photosResponse.text(),
    schemaResponse.json(),
    taxonomyResponse.json(),
    projectConfigResponse.json(),
  ]);
  applyProjectConfig(projectConfig);
  applySchema(schema);
  photos = toObjects(parseCsv(photosText), schema);
  setupTaskModes();
  setupFilters(taxonomy);
  applyUrlState();
  renderOverview();
  render({ resetPage: true });
  revealPhotoFromHash();
}

function scheduleSearchRender() {
  clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    render({ resetPage: true, source: "search" });
  }, searchDebounceMs);
}

elements.taskModes.addEventListener("click", (event) => {
  const button = event.target.closest("[data-task-mode]");
  if (!button) {
    return;
  }
  state.taskMode = button.dataset.taskMode;
  render({ resetPage: true, source: "filter" });
  trackEvent("select_task_mode", { task_mode: state.taskMode });
});

for (const [key, control] of Object.entries(controls)) {
  if (["reset", "loadMore", "copyCandidates", "clearCandidates", "copyAiAssistantPrompt"].includes(key)) {
    continue;
  }
  control.addEventListener("input", key === "search" ? scheduleSearchRender : () => render({ resetPage: true, source: "filter" }));
}

elements.activeFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter-key]");
  if (!button) {
    return;
  }
  clearFilter(button.dataset.filterKey);
});

controls.reset.addEventListener("click", resetFilters);
controls.loadMore.addEventListener("click", () => {
  visibleCount += pageSize;
  render({ preservePage: true, source: "load_more" });
  trackEvent("load_more_results", {
    result_count: currentResults.length,
    visible_count: Math.min(visibleCount, currentResults.length),
    result_count_bucket: resultCountBucket(currentResults.length),
    task_mode: state.taskMode,
    sort_mode: controls.sort.value,
  });
});
controls.copyCandidates.addEventListener("click", copyCandidateList);
controls.clearCandidates.addEventListener("click", clearCandidates);
controls.copyAiAssistantPrompt.addEventListener("click", copyAiAssistantPrompt);
elements.aiAssistantSheetLink.addEventListener("click", () => {
  trackEvent("open_sheets_for_ai_assistant", aiAssistantEventParams());
});
window.addEventListener("hashchange", revealPhotoFromHash);

try {
  await loadData();
} catch (error) {
  elements.summary.textContent = "資料載入失敗";
  elements.context.textContent = "請確認資料來源與公開讀取權限";
  elements.overviewSummary.textContent = "資料載入失敗";
  elements.overviewGrid.replaceChildren();
  elements.grid.replaceChildren();
  renderEmpty(error.message);
}
