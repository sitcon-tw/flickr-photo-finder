import {
  hasActiveFilters,
  hasTrackedResultState,
  resultCountBucket,
  resultsEventParams,
  sanitizeSearchTerm,
  scheduleResultsTracking as scheduleAnalyticsResultsTracking,
  setupAnalytics,
  trackEvent,
} from "./analytics.js";
import { aiAssistantEventParams, buildAiAssistantPrompt } from "./ai-assistant.js";
import { candidateMarkdown, renderCandidates, selectedPhotos } from "./candidates.js";
import { dataSources, projectConfigUrl } from "./config.js";
import {
  activeFilterEntries as buildActiveFilterEntries,
  bindControlDismissal,
  queryControls,
  queryElements,
  setupFilters,
  setupTaskModes,
  syncEnhancedSelects,
} from "./controls.js";
import { loadFinderData, optionLabelsFor } from "./data-loader.js";
import {
  filterAndSortPhotos,
  isFilled,
  numericValue,
  scoreOverlap,
  textMatches,
} from "./search-sort.js";
import { decodeUrlState, encodeUrlState } from "./url-state.js";
import {
  discoverHistorySize,
  discoverWindowSize,
  pageSize,
  peopleCountFilters,
  resultTrackingDelayMs,
  searchDebounceMs,
  taskModes,
} from "./task-modes.js";

const controls = queryControls();
const elements = queryElements();
bindControlDismissal();

let photos = [];
let photoSchema;
let currentResults = [];
let visibleCount = pageSize;
let renderTimer = 0;
let projectConfig = {};
let optionLabelMaps = new Map();
let searchTokensForField = () => [];

const state = {
  taskMode: "all",
  selectedPhotoIds: new Set(),
  lastTrackedZeroState: "",
};

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

function currentFilterSnapshot() {
  return {
    taskMode: state.taskMode,
    searchTerm: sanitizeSearchTerm(controls.search.value),
    recommendedUse: controls.use.value,
    mood: controls.mood.value,
    sortMode: controls.sort.value,
    album: controls.album.value,
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

function scheduleResultsTracking(source) {
  scheduleAnalyticsResultsTracking(source, {
    getSnapshot: currentFilterSnapshot,
    delayMs: resultTrackingDelayMs,
  });
}

function applyProjectConfig(config) {
  projectConfig = config;
  const title = config.frontend?.appTitle ?? "Flickr Photo Finder";
  document.title = title;
  elements.appTitle.textContent = title;
  elements.sourceLink.href = config.flickr?.profileUrl ?? "https://www.flickr.com/";
  elements.sourceLink.textContent = config.frontend?.sourceLinkLabel ?? "Flickr";
  const repositoryUrl = String(config.repository?.url ?? "").trim();
  elements.repositoryLink.hidden = !repositoryUrl;
  if (repositoryUrl) {
    elements.repositoryLink.href = repositoryUrl;
    elements.repositoryLink.textContent = config.frontend?.repositoryLinkLabel ?? "GitHub 專案";
    elements.repositoryLink.title = config.frontend?.repositoryLinkTitle ?? "了解專案細節或回報問題";
  }
  setExternalLink(elements.aiAssistantSheetLink, photosSheetUrl());
  setupAnalytics(config);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "zh-Hant-TW"),
  );
}

function optionLabels(fieldName) {
  return optionLabelsFor(optionLabelMaps, fieldName);
}

function labelFor(fieldName, value) {
  return optionLabels(fieldName).get(value) ?? value;
}

function activeTask() {
  return taskModes.find((task) => task.id === state.taskMode) ?? taskModes[0];
}

function currentPhotoFilters() {
  return {
    search: controls.search.value,
    album: controls.album.value,
    recommendedUse: controls.use.value,
    mood: controls.mood.value,
    scene: controls.scene.value,
    peopleCount: controls.peopleCount.value,
    subjectType: controls.subjectType.value,
    orientation: controls.orientation.value,
    negativeSpace: controls.negativeSpace.value,
    safeCrop: controls.safeCrop.value,
    sponsorshipTag: controls.sponsorshipTag.value,
    sponsorshipItem: controls.sponsorshipItem.value,
    publicStatus: controls.publicStatus.value,
    priority: controls.priority.value,
    curationStatus: controls.curationStatus.value,
    collection: controls.collection.value,
  };
}

function filteredAndSortedPhotos() {
  return filterAndSortPhotos(photos, {
    filters: currentPhotoFilters(),
    sortMode: controls.sort.value,
    task: activeTask(),
    discoverHistorySize,
    discoverWindowSize,
  });
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
      values: countByField("curation_status", optionLabels("curation_status")),
    }),
    makeOverviewItem({
      title: "使用提醒",
      value: formatCountRatio(countFilled("public_use_status")),
      detail: "整理者留下的使用提醒。",
      values: countByField("public_use_status", optionLabels("public_use_status")),
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
      values: countByField("subject_type", optionLabels("subject_type")),
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
    tag.textContent = options.fieldName ? labelFor(options.fieldName, value) : options.labels?.get(value) ?? value;
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

function trackOpenFlickr(photo, resultRank, resultCount) {
  trackEvent("select_content", {
    content_type: "photo",
    content_id: photo.photo_id,
    ...photoEventParams(photo, resultRank, resultCount),
  });
  trackEvent("open_flickr_source", {
    photo_id: photo.photo_id,
    ...photoEventParams(photo, resultRank, resultCount),
  });
}

function statusBadges(photo) {
  const badges = [];
  if (photo.public_use_status === "avoid") {
    badges.push(["danger", labelFor("public_use_status", "avoid")]);
  } else if (photo.public_use_status === "needs_review") {
    badges.push(["warning", labelFor("public_use_status", "needs_review")]);
  }

  if (photo.priority_level === "high") {
    badges.push(["success", labelFor("priority_level", "high")]);
  }
  if (photo.curation_status === "reviewed") {
    badges.push(["info", labelFor("curation_status", "reviewed")]);
  } else if (photo.curation_status === "ai_labeled") {
    badges.push(["ai", labelFor("curation_status", "ai_labeled")]);
  } else {
    badges.push(["neutral", labelFor("curation_status", "unreviewed")]);
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
      appendSignal(signals, labelFor("orientation", matchedOrientation));
    }
    const matchedCrop = firstOverlap(photo.safe_crop, task.safeCrops);
    if (matchedCrop) {
      appendSignal(signals, matchedCrop);
    }
    if (task.prefersNegativeSpace && photo.has_negative_space === "true") {
      appendSignal(signals, labelFor("has_negative_space", "true"));
    }
  }
  if (photo.priority_level === "high") {
    appendSignal(signals, labelFor("priority_level", "high"));
  }
  if (photo.public_use_status === "needs_review") {
    appendSignal(signals, labelFor("public_use_status", "needs_review"));
  } else if (photo.public_use_status === "avoid") {
    appendSignal(signals, labelFor("public_use_status", "avoid"));
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
  const openFlickrLabel = `開啟 Flickr 原頁：${photoTitle(photo)}`;
  setActionLink(link, photo.photo_url);
  link.setAttribute("aria-label", openFlickrLabel);
  link.title = openFlickrLabel;
  link.addEventListener("click", (event) => {
    if (!photo.photo_url) {
      event.preventDefault();
      return;
    }
    trackOpenFlickr(photo, resultRank, resultCount);
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
  appendDetail(quickDetails, "構圖", [labelFor("orientation", photo.orientation), ...photo.safe_crop].filter(Boolean));
  appendDetail(quickDetails, "贊助", [...photo.sponsorship_tags, ...photo.sponsorship_items].slice(0, 3));

  appendDetail(details, "用途", photo.recommended_uses);
  appendDetail(details, "氛圍", photo.mood_tags);
  appendDetail(details, "場景", photo.scene_tags);
  appendDetail(details, "人數", formatPeopleCount(photo));
  appendDetail(details, "主體", photo.subject_type, { fieldName: "subject_type" });
  appendDetail(details, "方向", photo.orientation, { fieldName: "orientation" });
  appendDetail(details, "留白", photo.has_negative_space, { fieldName: "has_negative_space" });
  appendDetail(details, "裁切", photo.safe_crop);
  appendDetail(details, "贊助品項", photo.sponsorship_items);
  appendDetail(details, "贊助價值", photo.sponsorship_tags);
  appendDetail(details, "素材包", photo.collections);
  appendDetail(details, "攝影", photo.photographer);
  appendDetail(details, "授權", photo.license);
  appendDetail(details, "使用提醒", photo.public_use_status, { status: true, fieldName: "public_use_status" });
  appendDetail(details, "推薦優先度", photo.priority_level, { status: true, fieldName: "priority_level" });
  appendDetail(details, "整理狀態", photo.curation_status, { status: true, fieldName: "curation_status" });
  appendDetail(details, "Sheets 列", photo._sheet_row_number ? String(photo._sheet_row_number) : "");
  appendDetail(details, "照片 ID", photo.photo_id);
  appendDetail(details, "描述", photo.visual_description);
  appendDetail(details, "備註", photo.curation_notes);

  candidateButton.textContent = "候選";
  candidateButton.title = selected ? "從候選清單移出這張照片" : "加入候選清單";
  candidateButton.setAttribute("aria-label", selected ? "從候選清單移出這張照片" : "加入候選清單");
  candidateButton.setAttribute("aria-pressed", selected ? "true" : "false");
  candidateButton.classList.toggle("is-selected", selected);
  candidateButton.addEventListener("click", () => {
    toggleCandidate(photo.photo_id);
  });

  downloadLargeButton.title = "直接下載 Flickr large-1024 圖片";
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
  originalImageLink.title = "開啟 Flickr 原始尺寸頁";
  originalImageLink.addEventListener("click", (event) => {
    if (!originalUrl) {
      event.preventDefault();
      return;
    }
    trackImageSizeOpen(photo, "original", resultRank, resultCount);
  });
  setActionLink(sheetRowLinkElement, sheetRowLink(photo));
  sheetRowLinkElement.title = "開啟 Google Sheets 中的這一列";

  copyFlickrLinkButton.disabled = !photo.photo_url;
  copyFlickrLinkButton.title = "複製 Flickr 原始照片頁連結";
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

  copyFinderLinkButton.title = "複製 Finder 中這張照片的 deep link";
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
  const text = selectedPhotos(state.selectedPhotoIds, photos)
    .map((photo) => candidateMarkdown(photo, { photoTitle, finderLink, sheetRowLink, labelFor }))
    .join("\n\n");
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

function currentAiAssistantPrompt() {
  return buildAiAssistantPrompt({
    sheetUrl: photosSheetUrl(),
    taskLabel: activeTask().label,
    searchValue: controls.search.value,
    filterEntries: activeFilterEntries(),
  });
}

function currentAiAssistantEventParams() {
  return aiAssistantEventParams({
    taskMode: state.taskMode,
    searchValue: controls.search.value,
    filterEntries: activeFilterEntries(),
  });
}

async function copyAiAssistantPrompt() {
  try {
    const copied = await copyTextToClipboard(currentAiAssistantPrompt());
    if (copied) {
      setTemporaryButtonText(controls.copyAiAssistantPrompt, "已複製");
      trackEvent("copy_ai_assistant_prompt", currentAiAssistantEventParams());
    }
  } catch {
    setTemporaryButtonText(controls.copyAiAssistantPrompt, "複製失敗");
  }
}

function activeFilterEntries() {
  return buildActiveFilterEntries({ state, controls, activeTask: activeTask() });
}

function clearFilter(key) {
  if (key === "task") {
    state.taskMode = "all";
  } else if (key === "search") {
    controls.search.value = "";
  } else if (controls[key]) {
    controls[key].value = "";
  }
  syncEnhancedSelects();
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
  renderCandidates({
    selectedPhotoIds: state.selectedPhotoIds,
    photos,
    elements,
    controls,
    photoTitle,
    finderLink,
    labelFor,
    toggleCandidate,
  });
  elements.grid.replaceChildren();
  elements.summary.textContent = `${filtered.length} / ${photos.length} 張照片`;
  elements.context.textContent = resultContextText(filtered);

  if (photos.length === 0) {
    renderEmpty("目前資料來源沒有照片資料");
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
  controls.album.value = "";
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
  syncEnhancedSelects();
  render({ resetPage: true, source: "filter" });
}

function syncUrlState() {
  const url = new URL(window.location.href);
  url.search = encodeUrlState({
    taskMode: state.taskMode,
    search: controls.search.value,
    sort: controls.sort.value,
    album: controls.album.value,
    use: controls.use.value,
    mood: controls.mood.value,
    scene: controls.scene.value,
    peopleCount: controls.peopleCount.value,
    subjectType: controls.subjectType.value,
    orientation: controls.orientation.value,
    negativeSpace: controls.negativeSpace.value,
    safeCrop: controls.safeCrop.value,
    sponsorshipTag: controls.sponsorshipTag.value,
    sponsorshipItem: controls.sponsorshipItem.value,
    publicStatus: controls.publicStatus.value,
    priority: controls.priority.value,
    curationStatus: controls.curationStatus.value,
    collection: controls.collection.value,
    selectedPhotoIds: state.selectedPhotoIds,
  }).toString();
  window.history.replaceState(null, "", url);
}

function setControlValue(control, value) {
  if (value && [...control.options].some((option) => option.value === value)) {
    control.value = value;
  }
}

function applyUrlState() {
  const urlState = decodeUrlState(new URLSearchParams(window.location.search));
  if (taskModes.some((mode) => mode.id === urlState.taskMode)) {
    state.taskMode = urlState.taskMode;
  }
  controls.search.value = urlState.search;
  setControlValue(controls.sort, urlState.sort);
  setControlValue(controls.album, urlState.album);
  setControlValue(controls.use, urlState.use);
  setControlValue(controls.mood, urlState.mood);
  setControlValue(controls.scene, urlState.scene);
  setControlValue(controls.peopleCount, urlState.peopleCount);
  setControlValue(controls.subjectType, urlState.subjectType);
  setControlValue(controls.orientation, urlState.orientation);
  setControlValue(controls.negativeSpace, urlState.negativeSpace);
  setControlValue(controls.safeCrop, urlState.safeCrop);
  setControlValue(controls.sponsorshipTag, urlState.sponsorshipTag);
  controls.sponsorshipItem.value = urlState.sponsorshipItem;
  setControlValue(controls.publicStatus, urlState.publicStatus);
  setControlValue(controls.priority, urlState.priority);
  setControlValue(controls.curationStatus, urlState.curationStatus);
  setControlValue(controls.collection, urlState.collection);
  for (const photoId of urlState.selectedPhotoIds) {
    state.selectedPhotoIds.add(photoId);
  }
  syncEnhancedSelects();
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
  const loadedData = await loadFinderData({ dataSources, projectConfigUrl });
  applyProjectConfig(loadedData.projectConfig);
  photoSchema = loadedData.photoSchema;
  optionLabelMaps = loadedData.optionLabelMaps;
  searchTokensForField = loadedData.searchTokensForField;
  photos = loadedData.photos;
  setupTaskModes(elements.taskModes, taskModes);
  setupFilters({
    controls,
    elements,
    taxonomy: loadedData.taxonomy,
    photos,
    peopleCountFilters,
    optionLabels,
    uniqueSorted,
  });
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
  trackEvent("open_sheets_for_ai_assistant", currentAiAssistantEventParams());
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
