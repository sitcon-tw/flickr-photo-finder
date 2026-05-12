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
import { candidateCopyText, renderCandidates, selectedPhotos } from "./candidates.js";
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
import { renderOverview as renderOverviewPanel } from "./overview-render.js";
import {
  copyTextToClipboard,
  finderLink,
  photoAnchorId,
  photoTitle,
  renderPhotoCard,
  setTemporaryButtonText,
  sheetRowLink as buildSheetRowLink,
} from "./photo-render.js";
import {
  renderActiveFilters,
  renderEmpty,
  resultContextText,
  updateLoadMore,
  updateTaskButtons,
} from "./result-render.js";
import { filterAndSortPhotos } from "./search-sort.js";
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
let albums = [];
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
  promotedPhotoIds: new Set(),
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
    selectedPhotoIds: state.promotedPhotoIds,
  });
}

function renderOverview() {
  renderOverviewPanel({ photos, photoSchema, elements, optionLabels });
}

function sheetRowLink(photo) {
  return buildSheetRowLink(photo, projectConfig);
}

function candidateListLink() {
  const url = new URL(window.location.href);
  url.hash = "";
  return url.toString();
}

function renderPhoto(photo, resultRank, resultCount) {
  return renderPhotoCard(photo, resultRank, resultCount, {
    template: elements.template,
    selectedPhotoIds: state.selectedPhotoIds,
    projectConfig,
    labelFor,
    task: activeTask(),
    searchValue: controls.search.value,
    taskMode: state.taskMode,
    sortMode: controls.sort.value,
    toggleCandidate,
    trackEvent,
  });
}

function toggleCandidate(photoId) {
  if (state.selectedPhotoIds.has(photoId)) {
    state.selectedPhotoIds.delete(photoId);
    state.promotedPhotoIds.delete(photoId);
    trackEvent("remove_candidate", { photo_id: photoId, task_mode: state.taskMode, sort_mode: controls.sort.value });
  } else {
    state.selectedPhotoIds.add(photoId);
    trackEvent("add_candidate", { photo_id: photoId, task_mode: state.taskMode, sort_mode: controls.sort.value });
  }
  render({ preservePage: true, preserveScroll: true, source: "candidate" });
}

async function copyCandidateList() {
  const candidates = selectedPhotos(state.selectedPhotoIds, photos);
  const text = candidateCopyText(
    candidates,
    { photoTitle, finderLink, candidateListLink, sheetRowLink, labelFor },
    controls.candidateCopyTemplate.value,
  );
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
  state.promotedPhotoIds.clear();
  render({ preservePage: true, preserveScroll: true, source: "candidate" });
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

function render({ resetPage = false, preservePage = false, preserveScroll = false, source = "" } = {}) {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const restoreScroll = () => {
    if (preserveScroll) {
      window.requestAnimationFrame(() => window.scrollTo(scrollX, scrollY));
    }
  };
  const filtered = filteredAndSortedPhotos();
  currentResults = filtered;
  if (resetPage || (!preservePage && visibleCount <= 0)) {
    visibleCount = pageSize;
  }

  updateTaskButtons({ elements, taskMode: state.taskMode });
  renderActiveFilters({ elements, activeFilterEntries });
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
  elements.context.textContent = resultContextText({ photos, filtered, controls, activeTask, activeFilterEntries });

  if (photos.length === 0) {
    renderEmpty(elements.grid, "目前資料來源沒有照片資料");
    updateLoadMore({ elements, visibleCount, filtered });
    restoreScroll();
    return;
  }

  if (filtered.length === 0) {
    renderEmpty(elements.grid, "沒有符合條件的照片");
    updateLoadMore({ elements, visibleCount, filtered });
    maybeTrackZeroResults();
    syncUrlState();
    restoreScroll();
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const [index, photo] of filtered.slice(0, visibleCount).entries()) {
    fragment.append(renderPhoto(photo, index + 1, filtered.length));
  }
  elements.grid.append(fragment);
  updateLoadMore({ elements, visibleCount, filtered });
  syncUrlState();

  if (source) {
    scheduleResultsTracking(source);
  }

  restoreScroll();
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
    state.promotedPhotoIds.add(photoId);
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
  albums = loadedData.albums;
  photos = loadedData.photos;
  setupTaskModes(elements.taskModes, taskModes);
  setupFilters({
    controls,
    elements,
    taxonomy: loadedData.taxonomy,
    photos,
    albums,
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
  if (["reset", "loadMore", "copyCandidates", "clearCandidates", "candidateCopyTemplate", "copyAiAssistantPrompt"].includes(key)) {
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
