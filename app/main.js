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
  downloadImageUrl,
  finderLink,
  imageDownloadFilename,
  largeImageUrl,
  originalSizePageUrl,
  photoAnchorId,
  photoTitle,
  renderPhotoDetails,
  renderPhotoCard,
  renderPhotoReference,
  renderPhotoStatuses,
  setTemporaryButtonText,
  sheetRowLink as buildSheetRowLink,
} from "./photo-render.js";
import { registerPwa } from "./pwa.js";
import {
  renderActiveFilters,
  renderEmpty,
  resultContextText,
  shouldAutoLoadMore,
  updateLoadMore,
  updateTaskButtons,
} from "./result-render.js";
import { applySearchRegistry, filterAndSortPhotos } from "./search-sort.js";
import { applyUrlStateRegistry, decodeUrlState, encodeUrlState, finderStateUrl } from "./url-state.js";
import {
  applyTaskModeRegistry,
  discoverCandidateLimit,
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
let autoLoadMoreFrame = 0;
let projectConfig = {};
let optionLabelMaps = new Map();
let searchTokensForField = () => [];
let filterControlEventsBound = false;
let activePreviewPhoto = null;
let loadPhotoDetails = async (photo) => photo;
let previewLoadToken = 0;
let sheetDragState = null;
let pwaRegistered = false;

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

function updatePwaStatus({ text, hidden }) {
  elements.pwaStatus.textContent = text;
  elements.pwaStatus.hidden = hidden;
}

function maybeRegisterPwa(generatedAt = "") {
  if (pwaRegistered) {
    return;
  }
  pwaRegistered = true;
  registerPwa({
    generatedAt,
    onStatusChange: updatePwaStatus,
  });
}

function setModalOpen(open) {
  elements.modalBackdrop.hidden = !open;
  document.body.classList.toggle("has-modal-open", open);
}

function closeFilterSheet() {
  resetSheetDragState();
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
  resetSheetDragState();
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
  previewLoadToken += 1;
  resetSheetDragState();
  elements.photoPreviewDialog.hidden = true;
  activePreviewPhoto = null;
  if (!elements.searchPanel.classList.contains("is-filter-open") && !elements.sidePanel.classList.contains("is-candidate-open")) {
    setModalOpen(false);
  }
}

function closeMobileOverlays() {
  previewLoadToken += 1;
  resetSheetDragState();
  elements.searchPanel.classList.remove("is-filter-open");
  elements.sidePanel.classList.remove("is-candidate-open");
  elements.photoPreviewDialog.hidden = true;
  activePreviewPhoto = null;
  setModalOpen(false);
}

function isMobileSheet() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function scrollCandidateListToBottom() {
  if (isMobileSheet()) {
    return;
  }
  window.requestAnimationFrame(() => {
    elements.candidateList.scrollTop = elements.candidateList.scrollHeight;
  });
}

function resetSheetDragState() {
  if (sheetDragState?.sheet) {
    sheetDragState.sheet.style.transform = "";
  }
  sheetDragState = null;
}

function touchFromList(touches, identifier) {
  return Array.from(touches).find((touch) => touch.identifier === identifier) ?? null;
}

function shouldIgnoreSheetDragStart(event) {
  return Boolean(event.target.closest(".enhanced-select-panel, .candidate-list"));
}

function onSheetTouchStart(event, { sheet, isOpen, close }) {
  if (!isOpen() || !isMobileSheet() || event.touches.length !== 1 || shouldIgnoreSheetDragStart(event)) {
    return;
  }
  const touch = event.touches[0];
  sheetDragState = {
    sheet,
    close,
    touchId: touch.identifier,
    startY: touch.clientY,
    startScrollTop: sheet.scrollTop,
  };
}

function onSheetTouchMove(event) {
  if (!sheetDragState) {
    return;
  }
  const touch = touchFromList(event.touches, sheetDragState.touchId);
  if (!touch) {
    return;
  }
  const deltaY = touch.clientY - sheetDragState.startY;
  if (sheetDragState.startScrollTop > 0 || deltaY <= 0) {
    return;
  }
  event.preventDefault();
  const dragOffset = Math.min(deltaY, 160);
  sheetDragState.sheet.style.transform = `translateY(${Math.round(dragOffset)}px)`;
}

function onSheetTouchEnd(event) {
  if (!sheetDragState) {
    return;
  }
  const touch = touchFromList(event.changedTouches, sheetDragState.touchId);
  if (!touch) {
    resetSheetDragState();
    return;
  }
  const deltaY = touch.clientY - sheetDragState.startY;
  const shouldClose = sheetDragState.startScrollTop <= 0 && deltaY >= 96;
  const close = sheetDragState.close;
  resetSheetDragState();
  if (shouldClose) {
    close();
  }
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
    discoverCandidateLimit,
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

async function photoWithDetails(photo) {
  try {
    return await loadPhotoDetails(photo);
  } catch {
    return photo;
  }
}

async function openPreview(photo) {
  closeFilterSheet();
  closeCandidateSheet();
  const token = previewLoadToken + 1;
  previewLoadToken = token;
  const detailedPhoto = await photoWithDetails(photo);
  if (token !== previewLoadToken) {
    return;
  }
  activePreviewPhoto = detailedPhoto;
  const largeUrl = largeImageUrl(detailedPhoto);
  const originalUrl = originalSizePageUrl(detailedPhoto);
  const previewUrl = largeUrl || detailedPhoto.image_preview_url;
  elements.previewTitle.textContent = photoTitle(detailedPhoto);
  elements.previewMeta.textContent = [detailedPhoto.event_year, detailedPhoto.album_title, `photo_id: ${detailedPhoto.photo_id}`].filter(Boolean).join(" / ");
  elements.previewImage.src = previewUrl;
  elements.previewImage.alt = [photoTitle(detailedPhoto), detailedPhoto.event_year].filter(Boolean).join(" ");
  renderPhotoStatuses(elements.previewStatuses, detailedPhoto, labelFor);
  renderPhotoReference(elements.previewReference, detailedPhoto);
  renderPhotoDetails(elements.previewDetails, detailedPhoto, { labelFor });
  controls.previewLarge.disabled = !largeUrl;
  controls.previewLarge.dataset.largeImageUrl = largeUrl;
  controls.previewCopyFlickr.disabled = !detailedPhoto.photo_url;
  setExternalLink(elements.previewImageLink, detailedPhoto.photo_url);
  elements.previewImageLink.title = detailedPhoto.photo_url ? "開啟 Flickr 照片頁" : "";
  setExternalLink(elements.previewOriginalLink, originalUrl);
  setExternalLink(elements.previewSheetLink, sheetRowLink(detailedPhoto));
  controls.previewCopyFlickr.title = "複製 Flickr 原始照片頁連結";
  controls.previewCopyFinder.title = "複製 Finder 中這張照片的 deep link";
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

function currentUrlState() {
  return {
    taskMode: state.taskMode,
    search: controls.search.value,
    sort: controls.sort.value,
    filters: state.filters,
    selectedPhotoIds: state.selectedPhotoIds,
  };
}

function candidateListLink() {
  return finderStateUrl(window.location.href, currentUrlState());
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

function loadMoreResults(source = "load_more") {
  if (visibleCount >= currentResults.length) {
    return false;
  }
  visibleCount = Math.min(visibleCount + pageSize, currentResults.length);
  render({ preservePage: true, source });
  trackEvent("load_more_results", {
    result_count: currentResults.length,
    visible_count: Math.min(visibleCount, currentResults.length),
    result_count_bucket: resultCountBucket(currentResults.length),
    task_mode: state.taskMode,
    sort_mode: controls.sort.value,
  });
  return true;
}

function isLoadMoreNearViewport() {
  return shouldAutoLoadMore({
    panel: elements.loadMorePanel,
    visibleCount,
    filtered: currentResults,
  });
}

function queueAutoLoadMore() {
  if (autoLoadMoreFrame || !isLoadMoreNearViewport()) {
    return;
  }
  autoLoadMoreFrame = window.requestAnimationFrame(() => {
    autoLoadMoreFrame = 0;
    if (isLoadMoreNearViewport()) {
      loadMoreResults("auto_load_more");
    }
  });
}

function toggleCandidate(photoId) {
  const isAdding = !state.selectedPhotoIds.has(photoId);
  if (!isAdding) {
    state.selectedPhotoIds.delete(photoId);
    state.promotedPhotoIds.delete(photoId);
    trackEvent("remove_candidate", { photo_id: photoId, task_mode: state.taskMode, sort_mode: controls.sort.value });
  } else {
    state.selectedPhotoIds.add(photoId);
    trackEvent("add_candidate", { photo_id: photoId, task_mode: state.taskMode, sort_mode: controls.sort.value });
  }
  updatePreviewCandidateButton();
  render({ preservePage: true, preserveScroll: true, source: "candidate" });
  if (isAdding) {
    scrollCandidateListToBottom();
  }
}

async function copyCandidateLink() {
  try {
    const copied = await copyTextToClipboard(candidateListLink());
    if (copied) {
      setTemporaryButtonText(controls.copyCandidates, "已複製");
      trackEvent("copy_candidate_list", {
        candidate_count: state.selectedPhotoIds.size,
        template_id: "finder_url",
        task_mode: state.taskMode,
        sort_mode: controls.sort.value,
      });
    }
  } catch {
    setTemporaryButtonText(controls.copyCandidates, "複製失敗");
  }
}

function setCandidateCopyMenuOpen(open) {
  controls.candidateCopyMenu.hidden = !open;
  controls.candidateCopyMenuButton.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeCandidateCopyMenu() {
  setCandidateCopyMenuOpen(false);
}

function toggleCandidateCopyMenu() {
  if (controls.candidateCopyMenuButton.disabled) {
    return;
  }
  setCandidateCopyMenuOpen(controls.candidateCopyMenu.hidden);
}

async function copyCandidateTemplate(templateId) {
  const candidates = await Promise.all(selectedPhotos(state.selectedPhotoIds, photos).map(photoWithDetails));
  const text = candidateCopyText(
    candidates,
    { photoTitle, finderLink, candidateListLink, sheetRowLink, labelFor },
    templateId,
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
        template_id: templateId,
        task_mode: state.taskMode,
        sort_mode: controls.sort.value,
      });
    }
  } catch {
    setTemporaryButtonText(controls.copyCandidates, "複製失敗");
  }
}

async function downloadPreviewLargeImage() {
  if (!activePreviewPhoto) {
    return;
  }
  const largeUrl = controls.previewLarge.dataset.largeImageUrl || largeImageUrl(activePreviewPhoto);
  if (!largeUrl) {
    return;
  }
  const originalText = controls.previewLarge.textContent;
  try {
    controls.previewLarge.disabled = true;
    controls.previewLarge.textContent = "下載中";
    await downloadImageUrl(largeUrl, imageDownloadFilename(activePreviewPhoto, largeUrl));
    controls.previewLarge.textContent = "已下載";
    trackEvent("download_preview_large_image", { photo_id: activePreviewPhoto.photo_id });
  } catch {
    controls.previewLarge.textContent = "下載失敗";
  } finally {
    window.setTimeout(() => {
      controls.previewLarge.disabled = false;
      controls.previewLarge.textContent = originalText;
    }, 1900);
  }
}

async function copyPreviewFlickrLink() {
  if (!activePreviewPhoto?.photo_url) {
    return;
  }
  try {
    const copied = await copyTextToClipboard(activePreviewPhoto.photo_url);
    if (copied) {
      setTemporaryButtonText(controls.previewCopyFlickr, "已複製");
      trackEvent("copy_flickr_link", { photo_id: activePreviewPhoto.photo_id });
    }
  } catch {
    setTemporaryButtonText(controls.previewCopyFlickr, "複製失敗");
  }
}

async function copyPreviewFinderLink() {
  if (!activePreviewPhoto) {
    return;
  }
  try {
    const copied = await copyTextToClipboard(finderLink(activePreviewPhoto));
    if (copied) {
      setTemporaryButtonText(controls.previewCopyFinder, "已複製");
      trackEvent("copy_finder_link", { photo_id: activePreviewPhoto.photo_id });
    }
  } catch {
    setTemporaryButtonText(controls.previewCopyFinder, "複製失敗");
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

function updateResetButtonState() {
  const hasResettableState = activeFilterEntries().length > 0 || controls.sort.value !== "recommended";
  controls.reset.classList.toggle("is-active", hasResettableState);
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
  updateResetButtonState();
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
  elements.grid.setAttribute("aria-busy", "false");
  elements.summary.textContent = `${filtered.length} / ${photos.length} 張照片`;
  elements.context.textContent = resultContextText({ photos, filtered, controls, activeTask, activeFilterEntries });

  if (photos.length === 0) {
    renderEmpty(elements.grid, "目前資料來源沒有照片資料");
    updateLoadMore({ elements, visibleCount, filtered });
    restoreScroll();
    return;
  }

  if (filtered.length === 0) {
    renderEmpty(elements.grid, "沒有命中目前索引的照片");
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
  queueAutoLoadMore();
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
  url.search = encodeUrlState(currentUrlState()).toString();
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

async function revealPhotoFromHash() {
  const match = window.location.hash.match(/^#photo-(\d+)$/);
  if (!match) {
    return;
  }

  const targetId = match[1];
  const resultIndex = currentResults.findIndex((photo) => photo.photo_id === targetId);
  const targetPhoto = resultIndex >= 0 ? currentResults[resultIndex] : photos.find((photo) => photo.photo_id === targetId);
  if (!targetPhoto) {
    return;
  }

  if (resultIndex >= visibleCount) {
    visibleCount = Math.ceil((resultIndex + 1) / pageSize) * pageSize;
    render({ preservePage: true });
  }

  const card = document.getElementById(photoAnchorId(targetId));
  if (card) {
    card.scrollIntoView({ block: "center" });
  }

  await openPreview(targetPhoto);
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
  loadPhotoDetails = loadedData.loadPhotoDetails ?? loadPhotoDetails;
  maybeRegisterPwa(loadedData.finderDataManifest?.generatedAt ?? "");
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
      "candidateCopyMenuButton",
      "candidateCopyMenu",
      "candidateCopyMenuItems",
      "copyAiAssistantPrompt",
      "mobileFilter",
      "mobileCandidate",
      "closeFilterSheet",
      "closeCandidateSheet",
      "closePreview",
      "previewCandidate",
      "previewLarge",
      "previewCopyFlickr",
      "previewCopyFinder",
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
  loadMoreResults("load_more");
});
controls.copyCandidates.addEventListener("click", copyCandidateLink);
controls.candidateCopyMenuButton.addEventListener("click", toggleCandidateCopyMenu);
controls.candidateCopyMenu.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-candidate-copy-template]");
  if (!button) {
    return;
  }
  closeCandidateCopyMenu();
  copyCandidateTemplate(button.dataset.candidateCopyTemplate);
});
controls.clearCandidates.addEventListener("click", clearCandidates);
controls.copyAiAssistantPrompt.addEventListener("click", copyAiAssistantPrompt);
controls.mobileFilter.addEventListener("click", openFilterSheet);
controls.mobileCandidate.addEventListener("click", openCandidateSheet);
controls.closeFilterSheet.addEventListener("click", closeFilterSheet);
controls.closeCandidateSheet.addEventListener("click", closeCandidateSheet);
controls.closePreview.addEventListener("click", closePreview);
elements.searchPanel.addEventListener(
  "touchstart",
  (event) => onSheetTouchStart(event, {
    sheet: elements.searchPanel,
    isOpen: () => elements.searchPanel.classList.contains("is-filter-open"),
    close: closeFilterSheet,
  }),
  { passive: true },
);
elements.sidePanel.addEventListener(
  "touchstart",
  (event) => onSheetTouchStart(event, {
    sheet: elements.sidePanel,
    isOpen: () => elements.sidePanel.classList.contains("is-candidate-open"),
    close: closeCandidateSheet,
  }),
  { passive: true },
);
elements.photoPreviewDialog.addEventListener(
  "touchstart",
  (event) => onSheetTouchStart(event, {
    sheet: elements.photoPreviewDialog,
    isOpen: () => !elements.photoPreviewDialog.hidden,
    close: closePreview,
  }),
  { passive: true },
);
for (const sheet of [elements.searchPanel, elements.sidePanel, elements.photoPreviewDialog]) {
  sheet.addEventListener("touchmove", onSheetTouchMove, { passive: false });
  sheet.addEventListener("touchend", onSheetTouchEnd);
  sheet.addEventListener("touchcancel", onSheetTouchEnd);
}
controls.previewLarge.addEventListener("click", downloadPreviewLargeImage);
controls.previewCopyFlickr.addEventListener("click", copyPreviewFlickrLink);
controls.previewCopyFinder.addEventListener("click", copyPreviewFinderLink);
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (controls.candidateCopyMenu.hidden || target?.closest(".candidate-copy-menu")) {
    return;
  }
  closeCandidateCopyMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCandidateCopyMenu();
  }
});
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
window.addEventListener("scroll", queueAutoLoadMore, { passive: true });
window.addEventListener("resize", queueAutoLoadMore);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMobileOverlays();
  }
});

try {
  await loadData();
} catch (error) {
  elements.grid.setAttribute("aria-busy", "false");
  elements.summary.textContent = "資料載入失敗";
  elements.context.textContent = "請確認資料來源與公開讀取權限";
  elements.overviewSummary.textContent = "資料載入失敗";
  elements.overviewGrid.replaceChildren();
  elements.grid.replaceChildren();
  renderEmpty(elements.grid, error.message);
}
