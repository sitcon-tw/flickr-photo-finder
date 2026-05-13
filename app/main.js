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
  displayImageUrl,
  finderLink,
  largeImageUrl,
  originalSizePageUrl,
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
let activePreviewPhoto = null;

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

function setModalOpen(open) {
  elements.modalBackdrop.hidden = !open;
  document.body.classList.toggle("has-modal-open", open);
}

function closeFilterSheet() {
  elements.searchPanel.classList.remove("is-filter-open");
  if (!elements.photoPreviewDialog.hidden || elements.sidePanel.classList.contains("is-candidate-open")) {
    return;
  }
  setModalOpen(false);
}

function openFilterSheet() {
  closeCandidateSheet();
  closePreview();
  elements.searchPanel.classList.add("is-filter-open");
  setModalOpen(true);
}

function closeCandidateSheet() {
  elements.sidePanel.classList.remove("is-candidate-open");
  if (!elements.photoPreviewDialog.hidden || elements.searchPanel.classList.contains("is-filter-open")) {
    return;
  }
  setModalOpen(false);
}

function openCandidateSheet() {
  closeFilterSheet();
  closePreview();
  elements.sidePanel.classList.add("is-candidate-open");
  setModalOpen(true);
}

function closePreview() {
  elements.photoPreviewDialog.hidden = true;
  activePreviewPhoto = null;
  if (!elements.searchPanel.classList.contains("is-filter-open") && !elements.sidePanel.classList.contains("is-candidate-open")) {
    setModalOpen(false);
  }
}

function closeMobileOverlays() {
  elements.searchPanel.classList.remove("is-filter-open");
  elements.sidePanel.classList.remove("is-candidate-open");
  elements.photoPreviewDialog.hidden = true;
  activePreviewPhoto = null;
  setModalOpen(false);
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

function appendPreviewDetail(label, values, { fieldName = "" } = {}) {
  const normalized = (Array.isArray(values) ? values : [values]).filter(Boolean);
  if (normalized.length === 0) {
    return;
  }
  const row = document.createElement("div");
  row.className = "detail-row";
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  for (const value of normalized) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = fieldName ? labelFor(fieldName, value) : value;
    description.append(tag);
  }
  row.append(term, description);
  elements.previewDetails.append(row);
}

function activeTask() {
  return taskModes.find((task) => task.id === state.taskMode) ?? taskModes[0];
}

function updateTaskModeSummary() {
  elements.taskModeSummary.textContent = activeTask().label;
}

function initializeMobileTaskModePanel() {
  if (window.matchMedia("(max-width: 760px)").matches) {
    elements.taskModeDetails.removeAttribute("open");
  }
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

function openPreview(photo) {
  closeFilterSheet();
  closeCandidateSheet();
  activePreviewPhoto = photo;
  const largeUrl = largeImageUrl(photo);
  const previewUrl = largeUrl || photo.image_preview_url;
  elements.previewTitle.textContent = photoTitle(photo);
  elements.previewMeta.textContent = [photo.event_year, photo.album_title, `photo_id: ${photo.photo_id}`].filter(Boolean).join(" / ");
  elements.previewImage.src = previewUrl;
  elements.previewImage.alt = [photoTitle(photo), photo.event_year].filter(Boolean).join(" ");
  elements.previewDetails.replaceChildren();
  appendPreviewDetail("構圖", [photo.orientation], { fieldName: "orientation" });
  appendPreviewDetail("留白", photo.has_negative_space, { fieldName: "has_negative_space" });
  appendPreviewDetail("裁切", photo.safe_crop);
  appendPreviewDetail("用途", photo.recommended_uses.slice(0, 4));
  appendPreviewDetail("場景", photo.scene_tags.slice(0, 4));
  appendPreviewDetail("贊助品項", photo.sponsorship_items.slice(0, 4));
  appendPreviewDetail("贊助價值", photo.sponsorship_tags.slice(0, 4));
  appendPreviewDetail("畫面描述", photo.visual_description);
  appendPreviewDetail("整理狀態", photo.curation_status, { fieldName: "curation_status" });
  appendPreviewDetail("使用提醒", photo.public_use_status, { fieldName: "public_use_status" });
  setExternalLink(elements.previewFlickrLink, photo.photo_url);
  setExternalLink(elements.previewOriginalLink, originalSizePageUrl(photo));
  setExternalLink(elements.previewSheetLink, sheetRowLink(photo));
  updatePreviewCandidateButton();
  elements.photoPreviewDialog.hidden = false;
  setModalOpen(true);
  controls.closePreview.focus({ preventScroll: true });
}

function updatePreviewCandidateButton() {
  if (!activePreviewPhoto) {
    return;
  }
  const selected = state.selectedPhotoIds.has(activePreviewPhoto.photo_id);
  controls.previewCandidate.textContent = selected ? "已加入候選" : "加入候選";
  controls.previewCandidate.setAttribute("aria-pressed", selected ? "true" : "false");
  controls.previewCandidate.classList.toggle("is-selected", selected);
}

function candidateListLink() {
  const url = new URL(window.location.href);
  url.hash = "";
  return url.toString();
}

function activeFilterCount() {
  return activeFilterEntries().filter(([key]) => key !== "task" && key !== "search").length;
}

function updateMobileSummary() {
  const selectedCount = state.selectedPhotoIds.size;
  controls.mobileFilter.textContent = activeFilterCount() > 0 ? `篩選 ${activeFilterCount()}` : "篩選";
  controls.mobileCandidate.textContent = `候選 ${selectedCount}`;
  elements.selectedNotice.hidden = selectedCount === 0;
  elements.selectedNotice.textContent = selectedCount === 0 ? "" : `目前已有 ${selectedCount} 張候選照片，可從「候選 ${selectedCount}」查看。`;
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
    openPreview,
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
  updatePreviewCandidateButton();
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
  updateTaskModeSummary();
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
    openPreview,
    displayImageUrl,
  });
  updateMobileSummary();
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
  initializeMobileTaskModePanel();
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
    if ([
      "reset",
      "loadMore",
      "copyCandidates",
      "clearCandidates",
      "candidateCopyTemplate",
      "copyAiAssistantPrompt",
      "mobileFilter",
      "mobileCandidate",
      "closeFilterSheet",
      "closeCandidateSheet",
      "closePreview",
      "previewCandidate",
    ].includes(key)) {
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
controls.mobileFilter.addEventListener("click", openFilterSheet);
controls.mobileCandidate.addEventListener("click", openCandidateSheet);
controls.closeFilterSheet.addEventListener("click", closeFilterSheet);
controls.closeCandidateSheet.addEventListener("click", closeCandidateSheet);
controls.closePreview.addEventListener("click", closePreview);
controls.previewCandidate.addEventListener("click", () => {
  if (activePreviewPhoto) {
    toggleCandidate(activePreviewPhoto.photo_id);
  }
});
elements.modalBackdrop.addEventListener("click", closeMobileOverlays);
elements.aiAssistantSheetLink.addEventListener("click", () => {
  trackEvent("open_sheets_for_ai_assistant", currentAiAssistantEventParams());
});
window.addEventListener("hashchange", revealPhotoFromHash);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMobileOverlays();
  }
});

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
