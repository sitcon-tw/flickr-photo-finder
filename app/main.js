import { dataSources, projectConfigUrl } from "./config.js";

const controls = {
  search: document.querySelector("#searchInput"),
  use: document.querySelector("#useFilter"),
  mood: document.querySelector("#moodFilter"),
  scene: document.querySelector("#sceneFilter"),
  peopleCount: document.querySelector("#peopleCountFilter"),
  sponsorshipItem: document.querySelector("#sponsorshipItemFilter"),
  publicStatus: document.querySelector("#publicStatusFilter"),
  priority: document.querySelector("#priorityFilter"),
  curationStatus: document.querySelector("#curationStatusFilter"),
  collection: document.querySelector("#collectionFilter"),
  reset: document.querySelector("#resetButton"),
};

const peopleCountFilters = [
  { label: "全部人數", value: "" },
  { label: "未標記", value: "unknown" },
  { label: "無人", value: "0" },
  { label: "1 人", value: "1" },
  { label: "2-5 人", value: "2-5" },
  { label: "6-20 人", value: "6-20" },
  { label: "21 人以上", value: "21+" },
];

const grid = document.querySelector("#photoGrid");
const summary = document.querySelector("#resultSummary");
const overviewGrid = document.querySelector("#overviewGrid");
const overviewSummary = document.querySelector("#overviewSummary");
const template = document.querySelector("#photoCardTemplate");
const appTitle = document.querySelector("#appTitle");
const sourceLink = document.querySelector("#sourceLink");

let photos = [];
let photoSchema;
let listFields = [];
let currentResults = [];

const analytics = {
  enabled: false,
  lastTrackedResultsState: "",
  pendingResultsSource: "",
  resultsTimer: 0,
};

const resultTrackingDelayMs = 600;

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
    searchTerm: sanitizeSearchTerm(controls.search.value),
    recommendedUse: controls.use.value,
    mood: controls.mood.value,
    scene: controls.scene.value,
    peopleCount: controls.peopleCount.value,
    sponsorshipItem: controls.sponsorshipItem.value,
    publicUseStatus: controls.publicStatus.value,
    priorityLevel: controls.priority.value,
    curationStatus: controls.curationStatus.value,
    collection: controls.collection.value,
    resultCount: currentResults.length,
  };
}

function hasActiveFilters(snapshot) {
  return Boolean(
    snapshot.recommendedUse ||
      snapshot.mood ||
      snapshot.scene ||
      snapshot.peopleCount ||
      snapshot.sponsorshipItem ||
      snapshot.publicUseStatus ||
      snapshot.priorityLevel ||
      snapshot.curationStatus ||
      snapshot.collection,
  );
}

function resultsEventParams(snapshot) {
  return {
    result_count: snapshot.resultCount,
    result_count_bucket: resultCountBucket(snapshot.resultCount),
    search_surface: "main",
    recommended_use: snapshot.recommendedUse,
    public_use_status: snapshot.publicUseStatus,
    priority_level: snapshot.priorityLevel,
    curation_status: snapshot.curationStatus,
    sponsorship_filter_used: Boolean(snapshot.sponsorshipItem),
    collection_filter_used: Boolean(snapshot.collection),
  };
}

function trackVisibleResults(source) {
  const snapshot = currentFilterSnapshot();
  const state = JSON.stringify({ source, ...snapshot });
  if (state === analytics.lastTrackedResultsState) {
    return;
  }
  analytics.lastTrackedResultsState = state;

  if (source === "search" && snapshot.searchTerm) {
    trackEvent("search", {
      search_term: snapshot.searchTerm,
      has_filters: hasActiveFilters(snapshot),
      ...resultsEventParams(snapshot),
    });
    return;
  }

  if (hasActiveFilters(snapshot) || snapshot.searchTerm) {
    trackEvent("filter_results", {
      has_search_term: Boolean(snapshot.searchTerm),
      mood_filter_used: Boolean(snapshot.mood),
      scene_filter_used: Boolean(snapshot.scene),
      people_count_filter: snapshot.peopleCount,
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
  const title = config.frontend?.appTitle ?? "Flickr Photo Finder";
  document.title = title;
  appTitle.textContent = title;
  sourceLink.href = config.flickr?.profileUrl ?? "https://www.flickr.com/";
  sourceLink.textContent = config.frontend?.sourceLinkLabel ?? "Flickr";
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
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toObjects(rows, schema) {
  const [headers, ...dataRows] = rows;
  const fieldSet = new Set(schema.tables.photos.fields.map((field) => field.name));
  return dataRows.map((row) => {
    const photo = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    for (const field of listFields) {
      photo[field] = parseList(photo[field] ?? "");
    }
    for (const field of fieldSet) {
      if (!(field in photo)) {
        photo[field] = "";
      }
    }
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

function setupFilters(taxonomy) {
  fillSelect(controls.use, "全部用途", taxonomy.recommended_uses ?? []);
  fillSelect(controls.mood, "全部氛圍", taxonomy.mood_tags ?? []);
  fillSelect(controls.scene, "全部場景", taxonomy.scene_tags ?? []);
  controls.peopleCount.replaceChildren(
    ...peopleCountFilters.map(({ label, value }) => new Option(label, value)),
  );
  fillSelect(controls.sponsorshipItem, "全部品項", taxonomy.sponsorship_items ?? []);
  fillSelect(controls.publicStatus, "全部狀態", taxonomy.public_use_status ?? []);
  fillSelect(controls.priority, "全部優先度", taxonomy.priority_level ?? []);
  fillSelect(controls.curationStatus, "全部整理狀態", taxonomy.curation_status ?? []);
  fillSelect(
    controls.collection,
    "全部素材包",
    uniqueSorted(photos.flatMap((photo) => photo.collections)),
  );
}

function textMatches(photo, query) {
  if (!query) {
    return true;
  }

  const searchable = [
    photo.photo_id,
    photo.album_title,
    photo.event_name,
    photo.event_year,
    photo.people_count,
    photo.photographer,
    photo.license,
    photo.orientation,
    photo.visual_description,
    photo.public_use_status,
    photo.priority_level,
    photo.curation_notes,
    photo.curation_status,
    ...photo.scene_tags,
    ...photo.mood_tags,
    ...photo.recommended_uses,
    ...photo.sponsorship_items,
    ...photo.sponsorship_tags,
    ...photo.collections,
  ]
    .join(" ")
    .toLowerCase();

  return searchable.includes(query.toLowerCase());
}

function hasListValue(photo, field, value) {
  return !value || photo[field].includes(value);
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
    textMatches(photo, controls.search.value.trim()) &&
    hasListValue(photo, "recommended_uses", controls.use.value) &&
    hasListValue(photo, "mood_tags", controls.mood.value) &&
    hasListValue(photo, "scene_tags", controls.scene.value) &&
    matchesPeopleCount(photo, controls.peopleCount.value) &&
    hasListValue(photo, "sponsorship_items", controls.sponsorshipItem.value) &&
    hasListValue(photo, "collections", controls.collection.value) &&
    (!controls.publicStatus.value || photo.public_use_status === controls.publicStatus.value) &&
    (!controls.priority.value || photo.priority_level === controls.priority.value) &&
    (!controls.curationStatus.value || photo.curation_status === controls.curationStatus.value)
  );
}

function appendDetail(details, label, values, options = {}) {
  const normalizedValues = Array.isArray(values) ? values : [values].filter(Boolean);
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
    tag.textContent = value;
    description.append(tag);
  }

  row.append(term, description);
  details.append(row);
}

function formatPeopleCount(photo) {
  const value = String(photo.people_count ?? "").trim();
  return value === "" ? "" : `${value} 人`;
}

function photoTitle(photo) {
  return photo.event_name || photo.album_title || `Flickr ${photo.photo_id}`;
}

function canWriteClipboard() {
  return Boolean(navigator.clipboard?.writeText);
}

function setTemporaryButtonText(button, text) {
  const originalText = button.textContent;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = originalText;
  }, 1800);
}

function photoEventParams(photo, resultRank, resultCount) {
  return {
    result_rank: resultRank,
    result_count_bucket: resultCountBucket(resultCount),
    public_use_status: photo.public_use_status,
    curation_status: photo.curation_status,
  };
}

function photoAnchorId(photoId) {
  return `photo-${photoId}`;
}

function finderLink(photo) {
  const url = new URL(window.location.href);
  url.hash = photoAnchorId(photo.photo_id);
  return url.toString();
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

function trackImageSizeOpen(photo, imageSize, resultRank, resultCount) {
  trackEvent("open_image_size", {
    photo_id: photo.photo_id,
    image_size: imageSize,
    ...photoEventParams(photo, resultRank, resultCount),
  });
}

async function copyFinderLink(photo, resultRank, resultCount, button) {
  if (!canWriteClipboard()) {
    return;
  }

  await navigator.clipboard.writeText(finderLink(photo));
  setTemporaryButtonText(button, "已複製");
  trackEvent("copy_finder_link", {
    photo_id: photo.photo_id,
    ...photoEventParams(photo, resultRank, resultCount),
  });
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

function countByField(fieldName) {
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
      counts.set(value, (counts.get(value) ?? 0) + 1);
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
  const sponsorshipItemsFilled = countFilled("sponsorship_items");
  const sponsorshipTagsFilled = countFilled("sponsorship_tags");
  const missingPreview = missingPreviewCount();

  overviewSummary.textContent = `共 ${photos.length} 張照片，${reviewedComplete} 張已具備 reviewed 必要欄位。`;
  overviewGrid.replaceChildren(
    makeOverviewItem({
      title: "照片總數",
      value: `${photos.length}`,
      detail: `${missingPreview} 張缺少縮圖 URL。`,
    }),
    makeOverviewItem({
      title: "整理狀態",
      value: formatCountRatio(countFilled("curation_status")),
      detail: "用來判斷 metadata 是否人工確認。",
      values: countByField("curation_status"),
    }),
    makeOverviewItem({
      title: "公開使用狀態",
      value: formatCountRatio(countFilled("public_use_status")),
      detail: "用來判斷推薦或使用前是否需要確認。",
      values: countByField("public_use_status"),
    }),
    makeOverviewItem({
      title: "推薦優先度",
      value: formatCountRatio(countFilled("priority_level")),
      detail: "排序參考，不是照片品質分數。",
      values: countByField("priority_level"),
    }),
    makeOverviewItem({
      title: "人數標記",
      value: formatCountRatio(peopleCountFilled),
      detail: "支援單人、群眾、無人畫面等篩選。",
      values: peopleCountBuckets(),
    }),
    makeOverviewItem({
      title: "Reviewed 欄位完整度",
      value: formatCountRatio(reviewedComplete),
      detail: "依 photo-schema.json 的 reviewed_required_fields 計算。",
    }),
    makeOverviewItem({
      title: "贊助品項",
      value: formatCountRatio(sponsorshipItemsFilled),
      detail: "用來找特定 CFS 贊助品項。",
    }),
    makeOverviewItem({
      title: "贊助價值",
      value: formatCountRatio(sponsorshipTagsFilled),
      detail: "用來找品牌露出、會眾互動、佐證素材。",
    }),
  );
}

function renderPhoto(photo, resultRank, resultCount) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".photo-card");
  const link = fragment.querySelector(".photo-link");
  const image = fragment.querySelector("img");
  const title = fragment.querySelector(".photo-title");
  const year = fragment.querySelector(".photo-year");
  const details = fragment.querySelector(".details");
  const notes = fragment.querySelector(".notes");
  const flickrSourceLink = fragment.querySelector(".flickr-source-link");
  const largeImageLink = fragment.querySelector(".large-image-link");
  const originalImageLink = fragment.querySelector(".original-image-link");
  const copyFinderLinkButton = fragment.querySelector(".copy-finder-link-button");
  const largeUrl = largeImageUrl(photo);
  const originalUrl = originalSizePageUrl(photo);

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
  setActionLink(flickrSourceLink, photo.photo_url);
  flickrSourceLink.addEventListener("click", () => {
    if (!photo.photo_url) {
      return;
    }
    trackEvent("open_flickr_source", {
      photo_id: photo.photo_id,
      ...photoEventParams(photo, resultRank, resultCount),
    });
  });
  setActionLink(largeImageLink, largeUrl);
  largeImageLink.addEventListener("click", (event) => {
    if (!largeUrl) {
      event.preventDefault();
      return;
    }
    trackImageSizeOpen(photo, "large_1024", resultRank, resultCount);
  });
  setActionLink(originalImageLink, originalUrl);
  originalImageLink.addEventListener("click", (event) => {
    if (!originalUrl) {
      event.preventDefault();
      return;
    }
    trackImageSizeOpen(photo, "original", resultRank, resultCount);
  });

  image.src = photo.image_preview_url;
  image.alt = [photo.event_name, photo.event_year, photo.photographer]
    .filter(Boolean)
    .join(" ");
  title.textContent = photoTitle(photo);
  year.textContent = photo.event_year || "";

  appendDetail(details, "用途", photo.recommended_uses);
  appendDetail(details, "氛圍", photo.mood_tags);
  appendDetail(details, "場景", photo.scene_tags);
  appendDetail(details, "人數", formatPeopleCount(photo));
  appendDetail(details, "贊助品項", photo.sponsorship_items);
  appendDetail(details, "贊助價值", photo.sponsorship_tags);
  appendDetail(details, "素材包", photo.collections);
  appendDetail(details, "攝影", photo.photographer);
  appendDetail(details, "授權", photo.license);
  appendDetail(details, "公開狀態", photo.public_use_status, { status: true });
  appendDetail(details, "推薦優先度", photo.priority_level, { status: true });
  appendDetail(details, "整理狀態", photo.curation_status, { status: true });
  appendDetail(details, "裁切", photo.safe_crop);
  appendDetail(details, "Flickr ID", photo.photo_id);

  notes.textContent = [photo.visual_description, photo.curation_notes].filter(Boolean).join(" ");
  if (!notes.textContent) {
    notes.remove();
  }

  copyFinderLinkButton.disabled = !canWriteClipboard();
  copyFinderLinkButton.addEventListener("click", async () => {
    try {
      await copyFinderLink(photo, resultRank, resultCount, copyFinderLinkButton);
    } catch {
      setTemporaryButtonText(copyFinderLinkButton, "複製失敗");
    }
  });

  return card;
}

function revealPhotoFromHash() {
  const match = window.location.hash.match(/^#photo-(\d+)$/);
  if (!match) {
    return;
  }

  const card = document.getElementById(photoAnchorId(match[1]));
  if (!card) {
    return;
  }

  card.scrollIntoView({ block: "center" });
}

function render() {
  const filtered = photos.filter(matchesFilters);
  currentResults = filtered;
  grid.replaceChildren();
  summary.textContent = `${filtered.length} / ${photos.length} 張照片`;

  if (photos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "fixtures/photos.csv 目前沒有照片資料";
    grid.append(empty);
    return;
  }

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "沒有符合條件的照片";
    grid.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const [index, photo] of filtered.entries()) {
    fragment.append(renderPhoto(photo, index + 1, filtered.length));
  }
  grid.append(fragment);
}

function resetFilters() {
  controls.search.value = "";
  controls.use.value = "";
  controls.mood.value = "";
  controls.scene.value = "";
  controls.peopleCount.value = "";
  controls.sponsorshipItem.value = "";
  controls.publicStatus.value = "";
  controls.priority.value = "";
  controls.curationStatus.value = "";
  controls.collection.value = "";
  render();
  scheduleResultsTracking("filter");
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
  setupFilters(taxonomy);
  renderOverview();
  render();
  revealPhotoFromHash();
}

for (const control of Object.values(controls)) {
  if (control === controls.reset) {
    continue;
  }
  control.addEventListener("input", () => {
    render();
    scheduleResultsTracking(control === controls.search ? "search" : "filter");
  });
}

controls.reset.addEventListener("click", resetFilters);
window.addEventListener("hashchange", revealPhotoFromHash);

try {
  await loadData();
} catch (error) {
  summary.textContent = "資料載入失敗";
  overviewSummary.textContent = "資料載入失敗";
  overviewGrid.replaceChildren();
  grid.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = error.message;
  grid.append(empty);
}
