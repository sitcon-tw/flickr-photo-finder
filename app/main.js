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
  applyControlsRegistry,
  bindControlDismissal,
  filterDefinitions,
  queryControls,
  queryElements,
  selectedControlValues,
  setControlValues,
  setupFilters,
  setupTaskModes,
  syncEnhancedSelects,
  updateFilterLayout,
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
import { applySearchRegistry, filterAndSortPhotos } from "./search-sort.js";
import { applyUrlStateRegistry, decodeUrlState, encodeUrlState } from "./url-state.js";
import {
  applyTaskModeRegistry,
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
let filterControlEventsBound = false;

const state = {
  taskMode: "all",
  filters: Object.fromEntries(filterDefinitions.map((definition) => [definition.key, []])),
  selectedPhotoIds: new Set(),
  promotedPhotoIds: new Set(),
  lastTrackedZeroState: "",
};

let filterControls = {};

function refreshFilterControls() {
  filterControls = Object.fromEntries(filterDefinitions.map((definition) => [definition.key, controls[definition.control]]));
}

refreshFilterControls();

function cleanFilterValues(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [values])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function setFilterValues(key, values, { syncControl = true } = {}) {
  if (!Object.hasOwn(state.filters, key)) {
    return;
  }
  state.filters[key] = cleanFilterValues(values);
  if (syncControl && filterControls[key]) {
    setControlValues(filterControls[key], state.filters[key], { dispatch: false });
  }
}

function clearFilterValue(key, value) {
  const target = String(value ?? "").trim().toLowerCase();
  if (!target) {
    setFilterValues(key, []);
    return;
  }
  setFilterValues(
    key,
    state.filters[key].filter((item) => item.toLowerCase() !== target),
  );
}

function syncControlsFromState() {
  for (const definition of filterDefinitions) {
    setControlValues(controls[definition.control], state.filters[definition.key] ?? [], { dispatch: false });
  }
  syncEnhancedSelects();
}

function syncStateFromControl(key) {
  const control = filterControls[key];
  if (!control) {
    return;
  }
  setFilterValues(key, selectedControlValues(control), { syncControl: false });
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

function currentFilterSnapshot() {
  const filterCounts = Object.fromEntries(Object.entries(state.filters).map(([key, values]) => [`${key}Count`, values.length]));
  return {
    taskMode: state.taskMode,
    searchTerm: sanitizeSearchTerm(controls.search.value),
    recommendedUse: state.filters.use,
    mood: state.filters.mood,
    sortMode: controls.sort.value,
    album: state.filters.album,
    scene: state.filters.scene,
    peopleCount: state.filters.peopleCount,
    subjectType: state.filters.subjectType,
    orientation: state.filters.orientation,
    negativeSpace: state.filters.negativeSpace,
    safeCrop: state.filters.safeCrop,
    sponsorshipTag: state.filters.sponsorshipTag,
    sponsorshipItemCount: state.filters.sponsorshipItem.length,
    publicUseStatus: state.filters.publicStatus,
    priorityLevel: state.filters.priority,
    curationStatus: state.filters.curationStatus,
    collection: state.filters.collection,
    ...filterCounts,
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
  return Object.fromEntries([
    ["search", controls.search.value],
    ...filterDefinitions.map((definition) => [definition.filterParam ?? definition.key, state.filters[definition.key] ?? []]),
  ]);
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

function clearFilter(key, value = "") {
  if (key === "task") {
    state.taskMode = "all";
  } else if (key === "search") {
    controls.search.value = "";
  } else {
    clearFilterValue(key, value);
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
  updateFilterLayout({ controls, elements, taskMode: state.taskMode });
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
  for (const definition of filterDefinitions) {
    setFilterValues(definition.key, []);
  }
  syncControlsFromState();
  render({ resetPage: true, source: "filter" });
}

function syncUrlState() {
  const url = new URL(window.location.href);
  url.search = encodeUrlState({
    taskMode: state.taskMode,
    search: controls.search.value,
    sort: controls.sort.value,
    filters: state.filters,
    selectedPhotoIds: state.selectedPhotoIds,
  }).toString();
  window.history.replaceState(null, "", url);
}

function applyUrlState() {
  const urlState = decodeUrlState(new URLSearchParams(window.location.search));
  if (taskModes.some((mode) => mode.id === urlState.taskMode)) {
    state.taskMode = urlState.taskMode;
  }
  controls.search.value = urlState.search;
  if (urlState.sort && [...controls.sort.options].some((option) => option.value === urlState.sort)) {
    controls.sort.value = urlState.sort;
  }
  for (const definition of filterDefinitions) {
    setFilterValues(definition.key, urlState.filters[definition.key] ?? [], { syncControl: false });
  }
  for (const photoId of urlState.selectedPhotoIds) {
    state.selectedPhotoIds.add(photoId);
    state.promotedPhotoIds.add(photoId);
  }
  syncControlsFromState();
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
  applyControlsRegistry(loadedData.interfaceRegistry);
  applyTaskModeRegistry(loadedData.interfaceRegistry);
  applyUrlStateRegistry(loadedData.interfaceRegistry);
  applySearchRegistry(loadedData.interfaceRegistry);
  refreshFilterControls();
  bindFilterControlEvents();
  for (const definition of filterDefinitions) {
    if (!Object.hasOwn(state.filters, definition.key)) {
      state.filters[definition.key] = [];
    }
  }
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
  updateFilterLayout({ controls, elements, taskMode: state.taskMode });
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

function bindFilterControlEvents() {
  if (filterControlEventsBound) {
    return;
  }
  filterControlEventsBound = true;
  for (const [key, control] of Object.entries(controls)) {
    if (["reset", "loadMore", "copyCandidates", "clearCandidates", "candidateCopyTemplate", "copyAiAssistantPrompt"].includes(key)) {
      continue;
    }
    const filterDefinition = filterDefinitions.find((definition) => definition.control === key);
    if (filterDefinition) {
      control.addEventListener("input", () => {
        syncStateFromControl(filterDefinition.key);
        render({ resetPage: true, source: "filter" });
      });
    } else {
      control.addEventListener("input", key === "search" ? scheduleSearchRender : () => render({ resetPage: true, source: "filter" }));
    }
  }
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

elements.activeFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter-key]");
  if (!button) {
    return;
  }
  clearFilter(button.dataset.filterKey, button.dataset.filterValue ?? "");
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
