import { sanitizeSearchTerm } from "./analytics.js";
import { normalizeText } from "./search-sort.js";

// DOM control helpers for the Pages frontend. This module owns control widgets
// and filter-entry shaping; main.js owns when these controls trigger render.
const enhancedSelects = new Map();
const autocompleteInputs = new Map();

export let filterDefinitions = [
  { key: "album", label: "活動/相簿", group: "core", control: "album" },
  { key: "use", label: "用途", group: "general", control: "use" },
  { key: "subjectType", label: "主體", group: "general", control: "subjectType" },
  { key: "mood", label: "氛圍", group: "general", control: "mood" },
  { key: "scene", label: "場景", group: "general", control: "scene" },
  { key: "peopleCount", label: "人數", group: "details", control: "peopleCount" },
  { key: "orientation", label: "方向", group: "visual", control: "orientation" },
  { key: "negativeSpace", label: "留白", group: "visual", control: "negativeSpace" },
  { key: "safeCrop", label: "裁切", group: "visual", control: "safeCrop" },
  { key: "sponsorshipTag", label: "贊助價值", group: "sponsor", control: "sponsorshipTag" },
  { key: "sponsorshipItem", label: "贊助品項", group: "sponsor", control: "sponsorshipItem" },
  { key: "publicStatus", label: "使用提醒", group: "status", control: "publicStatus" },
  { key: "priority", label: "優先度", group: "status", control: "priority" },
  { key: "curationStatus", label: "整理狀態", group: "status", control: "curationStatus" },
  { key: "collection", label: "素材包", group: "details", control: "collection" },
];

export const filterDefinitionsByKey = new Map(filterDefinitions.map((definition) => [definition.key, definition]));

export function queryControls() {
  return {
    search: document.querySelector("#searchInput"),
    sort: document.querySelector("#sortSelect"),
    album: document.querySelector("#albumFilter"),
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
    candidateCopyMenuButton: document.querySelector("#candidateCopyMenuButton"),
    candidateCopyMenu: document.querySelector("#candidateCopyMenu"),
    candidateCopyMenuItems: [...document.querySelectorAll("[data-candidate-copy-template]")],
    clearCandidates: document.querySelector("#clearCandidatesButton"),
    copyAiAssistantPrompt: document.querySelector("#copyAiAssistantPromptButton"),
    mobileFilter: document.querySelector("#mobileFilterButton"),
    mobileCandidate: document.querySelector("#mobileCandidateButton"),
    closeFilterSheet: document.querySelector("#closeFilterSheetButton"),
    closeCandidateSheet: document.querySelector("#closeCandidateSheetButton"),
    closePreview: document.querySelector("#closePreviewButton"),
    previewCandidate: document.querySelector("#previewCandidateButton"),
    previewLarge: document.querySelector("#previewLargeButton"),
    previewCopyFlickr: document.querySelector("#previewCopyFlickrButton"),
    previewCopyFinder: document.querySelector("#previewCopyFinderButton"),
  };
}

export function queryElements() {
  return {
    grid: document.querySelector("#photoGrid"),
    summary: document.querySelector("#resultSummary"),
    context: document.querySelector("#resultContext"),
    activeFilters: document.querySelector("#activeFilters"),
    overviewGrid: document.querySelector("#overviewGrid"),
    overviewSummary: document.querySelector("#overviewSummary"),
    template: document.querySelector("#photoCardTemplate"),
    appTitle: document.querySelector("#appTitle"),
    sourceLink: document.querySelector("#sourceLink"),
    repositoryLink: document.querySelector("#repositoryLink"),
    taskModeDetails: document.querySelector("#taskModeDetails"),
    taskModeSummary: document.querySelector("#taskModeSummary"),
    taskModes: document.querySelector("#taskModes"),
    searchPanel: document.querySelector(".search-panel"),
    sidePanel: document.querySelector(".side-panel"),
    taskFilterGrid: document.querySelector("#taskFilterGrid"),
    advancedFilters: document.querySelector("#advancedFilters"),
    advancedFilterGrid: document.querySelector("#advancedFilterGrid"),
    sponsorshipItemOptions: document.querySelector("#sponsorshipItemOptions"),
    loadMorePanel: document.querySelector("#loadMorePanel"),
    loadMoreSummary: document.querySelector("#loadMoreSummary"),
    candidateSummary: document.querySelector("#candidateSummary"),
    candidateList: document.querySelector("#candidateList"),
    selectedNotice: document.querySelector("#selectedNotice"),
    aiAssistantSheetLink: document.querySelector("#aiAssistantSheetLink"),
    modalBackdrop: document.querySelector("#modalBackdrop"),
    photoPreviewDialog: document.querySelector("#photoPreviewDialog"),
    previewImageLink: document.querySelector("#previewImageLink"),
    previewTitle: document.querySelector("#previewTitle"),
    previewMeta: document.querySelector("#previewMeta"),
    previewStatuses: document.querySelector("#previewStatuses"),
    previewReference: document.querySelector("#previewReference"),
    previewImage: document.querySelector("#previewImage"),
    previewDetails: document.querySelector("#previewDetails"),
    previewLargeButton: document.querySelector("#previewLargeButton"),
    previewOriginalLink: document.querySelector("#previewOriginalLink"),
    previewSheetLink: document.querySelector("#previewSheetLink"),
  };
}

function fillSelect(select, label, values) {
  select.replaceChildren();
  select.append(new Option(label, ""));
  for (const value of values) {
    select.append(new Option(value, value));
  }
}

function fillSelectOptions(select, label, options) {
  select.replaceChildren();
  select.append(new Option(label, ""));
  for (const option of options) {
    const element = new Option(option.label, option.value);
    element.title = option.label;
    select.append(element);
  }
}

function fillSelectWithLabels(select, label, values, labels) {
  select.replaceChildren();
  select.append(new Option(label, ""));
  for (const value of values) {
    select.append(new Option(labels.get(value) ?? value, value));
  }
}

function enhancedSelectOptionText(option) {
  return option?.textContent ?? option?.label ?? option?.value ?? "";
}

export function selectedControlValues(control) {
  if (!control) {
    return [];
  }
  if (control.dataset?.tokenInput === "true") {
    return (control.dataset.values ?? "").split("\n").filter(Boolean);
  }
  if (control.multiple) {
    return [...control.selectedOptions].map((option) => option.value).filter(Boolean);
  }
  return control.value ? [control.value] : [];
}

export function setControlValues(control, values, { dispatch = true } = {}) {
  const selectedValues = new Set((Array.isArray(values) ? values : [values]).map((value) => String(value ?? "").trim()).filter(Boolean));
  if (control.dataset?.tokenInput === "true") {
    control.dataset.values = [...selectedValues].join("\n");
    control.value = "";
    syncAutocompleteInput(control);
    if (dispatch) {
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return;
  }
  for (const option of control.options) {
    option.selected = selectedValues.has(option.value);
  }
  syncEnhancedSelectValueForSelect(control);
  if (dispatch) {
    control.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export function clearControlValues(control) {
  setControlValues(control, []);
}

export function optionTextForValue(control, value) {
  if (control.dataset?.tokenInput === "true") {
    return value;
  }
  const option = [...control.options].find((item) => item.value === value);
  return enhancedSelectOptionText(option) || value;
}

function syncEnhancedSelectValue(control) {
  const values = selectedControlValues(control.select);
  control.triggerText.textContent = values.length === 0 ? control.placeholder : `已選 ${values.length} 個`;
  control.trigger.classList.toggle("is-empty", values.length === 0);
}

function shouldFocusEnhancedSelectSearch() {
  return window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(max-width: 760px)").matches;
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function syncEnhancedSelectValueForSelect(select) {
  const control = enhancedSelects.get(select);
  if (control) {
    syncEnhancedSelectValue(control);
    renderEnhancedSelectOptions(control);
  }
}

function closeEnhancedSelect(control) {
  control.panel.hidden = true;
  control.trigger.setAttribute("aria-expanded", "false");
}

function renderEnhancedSelectOptions(control) {
  const query = normalizeText(control.search.value);
  const options = [...control.select.options].filter((option) => {
    if (!query) {
      return true;
    }
    return normalizeText(enhancedSelectOptionText(option)).includes(query) || normalizeText(option.value).includes(query);
  });
  const fragment = document.createDocumentFragment();

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "enhanced-select-option";
    button.dataset.value = option.value;
    button.setAttribute("role", "option");
    const selected = option.value ? selectedControlValues(control.select).includes(option.value) : selectedControlValues(control.select).length === 0;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.classList.toggle("is-selected", selected);
    button.classList.toggle("is-empty", option.value === "");
    button.textContent = enhancedSelectOptionText(option);
    button.title = enhancedSelectOptionText(option);
    fragment.append(button);
  }

  if (options.length === 0) {
    const empty = document.createElement("p");
    empty.className = "enhanced-select-empty";
    empty.textContent = "沒有符合的選項";
    fragment.append(empty);
  }

  control.options.replaceChildren(fragment);
}

function openEnhancedSelect(control) {
  for (const otherControl of enhancedSelects.values()) {
    if (otherControl !== control) {
      closeEnhancedSelect(otherControl);
    }
  }
  control.search.value = "";
  renderEnhancedSelectOptions(control);
  control.panel.hidden = false;
  control.trigger.setAttribute("aria-expanded", "true");
  if (isMobileViewport()) {
    window.requestAnimationFrame(() => {
      control.panel.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }
  if (shouldFocusEnhancedSelectSearch()) {
    window.requestAnimationFrame(() => control.search.focus({ preventScroll: true }));
  }
}

function toggleEnhancedSelectValue(control, value) {
  const optionScrollTop = control.options.scrollTop;
  if (!value) {
    for (const option of control.select.options) {
      option.selected = false;
    }
  } else if (control.select.multiple) {
    const option = [...control.select.options].find((item) => item.value === value);
    if (option) {
      option.selected = !option.selected;
    }
  } else {
    control.select.value = value;
    closeEnhancedSelect(control);
  }
  syncEnhancedSelectValue(control);
  renderEnhancedSelectOptions(control);
  control.options.scrollTop = optionScrollTop;
  control.select.dispatchEvent(new Event("input", { bubbles: true }));
}

function setupEnhancedSelect(select, searchPlaceholder) {
  let control = enhancedSelects.get(select);
  if (!control) {
    select.multiple = true;
    select.classList.add("enhanced-select-native");
    select.tabIndex = -1;

    const root = document.createElement("div");
    root.className = "enhanced-select";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "enhanced-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const triggerText = document.createElement("span");
    trigger.append(triggerText);

    const panel = document.createElement("div");
    panel.className = "enhanced-select-panel";
    panel.hidden = true;
    const search = document.createElement("input");
    search.type = "search";
    search.className = "enhanced-select-search";
    search.autocomplete = "off";
    const options = document.createElement("div");
    options.className = "enhanced-select-options";
    options.setAttribute("role", "listbox");
    panel.append(search, options);
    root.append(trigger, panel);
    select.insertAdjacentElement("afterend", root);

    control = { root, select, trigger, triggerText, panel, search, options, placeholder: "" };
    enhancedSelects.set(select, control);

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      if (panel.hidden) {
        openEnhancedSelect(control);
      } else {
        closeEnhancedSelect(control);
      }
    });
    search.addEventListener("input", () => renderEnhancedSelectOptions(control));
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeEnhancedSelect(control);
        trigger.focus();
      }
    });
    options.addEventListener("click", (event) => {
      const optionButton = event.target.closest("[data-value]");
      if (!optionButton) {
        return;
      }
      toggleEnhancedSelectValue(control, optionButton.dataset.value ?? "");
    });
    select.addEventListener("input", () => syncEnhancedSelectValue(control));
    select.addEventListener("change", () => syncEnhancedSelectValue(control));
  }

  control.placeholder = select.options[0]?.textContent ?? "";
  control.search.placeholder = searchPlaceholder;
  syncEnhancedSelectValue(control);
  renderEnhancedSelectOptions(control);
}

export function syncEnhancedSelects() {
  for (const control of enhancedSelects.values()) {
    syncEnhancedSelectValue(control);
  }
}

function closeAutocompleteInput(control) {
  control.panel.hidden = true;
}

function autocompleteValues(input) {
  return selectedControlValues(input);
}

function syncAutocompleteInput(input) {
  const control = autocompleteInputs.get(input);
  if (!control) {
    return;
  }
  const values = autocompleteValues(input);
  const fragment = document.createDocumentFragment();
  for (const value of values) {
    const token = document.createElement("button");
    token.type = "button";
    token.className = "autocomplete-token";
    token.dataset.value = value;
    token.textContent = `${value} ×`;
    token.title = `移除 ${value}`;
    fragment.append(token);
  }
  control.tokens.replaceChildren(fragment);
  control.root.classList.toggle("has-tokens", values.length > 0);
}

function setAutocompleteValues(input, values) {
  const nextValues = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    nextValues.push(normalized);
  }
  input.dataset.values = nextValues.join("\n");
  syncAutocompleteInput(input);
}

function addAutocompleteInputValue(control, value) {
  const nextValue = String(value ?? "").trim();
  if (!nextValue) {
    return;
  }
  setAutocompleteValues(control.input, [...autocompleteValues(control.input), nextValue]);
  control.input.value = "";
  control.input.dispatchEvent(new Event("input", { bubbles: true }));
  renderAutocompleteOptions(control);
}

function removeAutocompleteInputValue(control, value) {
  const target = String(value ?? "").trim().toLowerCase();
  setAutocompleteValues(
    control.input,
    autocompleteValues(control.input).filter((item) => item.toLowerCase() !== target),
  );
  control.input.dispatchEvent(new Event("input", { bubbles: true }));
  renderAutocompleteOptions(control);
}

function renderAutocompleteOptions(control) {
  const query = normalizeText(control.input.value);
  const selected = new Set(autocompleteValues(control.input).map((value) => value.toLowerCase()));
  const values = control.values.filter((value) => !selected.has(String(value).toLowerCase())).filter((value) => !query || normalizeText(value).includes(query));
  const fragment = document.createDocumentFragment();

  for (const value of values) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "autocomplete-option";
    button.dataset.value = value;
    button.setAttribute("role", "option");
    button.textContent = value;
    fragment.append(button);
  }

  if (values.length === 0) {
    const empty = document.createElement("p");
    empty.className = "autocomplete-empty";
    empty.textContent = query ? "沒有符合的品項，會以輸入文字搜尋" : "沒有可選品項";
    fragment.append(empty);
  }

  control.options.replaceChildren(fragment);
}

function openAutocompleteInput(control) {
  renderAutocompleteOptions(control);
  control.panel.hidden = false;
}

function setupAutocompleteInput(input, values) {
  let control = autocompleteInputs.get(input);
  if (!control) {
    input.dataset.tokenInput = "true";
    input.dataset.values = input.dataset.values ?? "";
    input.removeAttribute("list");

    const root = document.createElement("div");
    root.className = "autocomplete-input";
    const tokens = document.createElement("div");
    tokens.className = "autocomplete-tokens";
    const panel = document.createElement("div");
    panel.className = "autocomplete-panel";
    panel.hidden = true;
    const options = document.createElement("div");
    options.className = "autocomplete-options";
    options.setAttribute("role", "listbox");
    panel.append(options);

    input.insertAdjacentElement("beforebegin", root);
    root.append(tokens, input, panel);

    control = { root, input, tokens, panel, options, values: [] };
    autocompleteInputs.set(input, control);

    input.addEventListener("focus", () => openAutocompleteInput(control));
    input.addEventListener("input", () => openAutocompleteInput(control));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAutocompleteInput(control);
      } else if (event.key === "Enter") {
        event.preventDefault();
        addAutocompleteInputValue(control, input.value);
      }
    });
    tokens.addEventListener("click", (event) => {
      const tokenButton = event.target.closest("[data-value]");
      if (!tokenButton) {
        return;
      }
      removeAutocompleteInputValue(control, tokenButton.dataset.value ?? "");
    });
    options.addEventListener("click", (event) => {
      const optionButton = event.target.closest("[data-value]");
      if (!optionButton) {
        return;
      }
      addAutocompleteInputValue(control, optionButton.dataset.value ?? "");
      closeAutocompleteInput(control);
    });
  }

  control.values = values;
  syncAutocompleteInput(input);
  renderAutocompleteOptions(control);
}

export function bindControlDismissal(root = document) {
  root.addEventListener("pointerdown", (event) => {
    for (const control of enhancedSelects.values()) {
      if (!control.root.contains(event.target)) {
        closeEnhancedSelect(control);
      }
    }
    for (const control of autocompleteInputs.values()) {
      if (!control.root.contains(event.target)) {
        closeAutocompleteInput(control);
      }
    }
  });
}

let taskPrimaryFilters = {
  social: ["use", "scene", "orientation", "safeCrop", "negativeSpace", "mood"],
  hero: ["orientation", "negativeSpace", "safeCrop", "scene", "mood"],
  visual: ["orientation", "negativeSpace", "safeCrop", "scene", "mood"],
  "sponsor-pitch": ["sponsorshipTag", "sponsorshipItem", "scene", "orientation", "negativeSpace"],
  "sponsor-report": ["sponsorshipItem", "sponsorshipTag", "scene"],
  press: ["scene", "orientation", "use", "mood"],
  volunteer: ["use", "scene", "mood", "orientation"],
  recap: ["use", "scene", "mood", "orientation"],
};

let defaultPrimaryFilters = ["use", "subjectType", "mood", "scene", "orientation", "safeCrop", "negativeSpace"];
let lowLevelFilters = new Set(["publicStatus", "priority", "curationStatus"]);

export function applyControlsRegistry(interfaceRegistry) {
  const pages = interfaceRegistry?.pages ?? {};
  if (Array.isArray(pages.filters) && pages.filters.length > 0) {
    filterDefinitions = pages.filters.map((filter) => ({
      ...filter,
      field: filter.field ?? "",
      filterParam: filter.filterParam ?? filter.key,
      source: filter.source ?? {},
    }));
  }
  taskPrimaryFilters = Object.fromEntries(
    (pages.taskModes ?? [])
      .filter((task) => task.id && Array.isArray(task.primaryFilters))
      .map((task) => [task.id, task.primaryFilters]),
  );
  defaultPrimaryFilters = pages.defaultPrimaryFilters ?? defaultPrimaryFilters;
  lowLevelFilters = new Set(filterDefinitions.filter((filter) => filter.lowLevel).map((filter) => filter.key));
}

function filterLabelFor(controls, definition) {
  return controls[definition.control]?.closest("label") ?? null;
}

export function updateFilterLayout({ controls, elements, taskMode }) {
  const primaryKeys = new Set(taskPrimaryFilters[taskMode] ?? defaultPrimaryFilters);
  let primaryOrder = 0;
  let advancedOrder = 0;

  for (const definition of filterDefinitions) {
    if (definition.key === "album") {
      continue;
    }
    const label = filterLabelFor(controls, definition);
    if (!label) {
      continue;
    }
    label.dataset.filterKey = definition.key;
    label.dataset.filterGroup = definition.group;

    const primary = primaryKeys.has(definition.key) && !lowLevelFilters.has(definition.key);
    label.style.order = String(primary ? primaryOrder++ : advancedOrder++);
    const targetGrid = primary ? elements.taskFilterGrid : elements.advancedFilterGrid;
    if (label.parentElement !== targetGrid) {
      targetGrid.append(label);
    }
  }

  elements.advancedFilters.hidden = elements.advancedFilterGrid.children.length === 0;
}

function compactLabelParts(parts) {
  const seen = new Set();
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function albumOptionFromRecord(record, value) {
  const labelParts = compactLabelParts([record.event_year, record.event_name, record.album_title]);
  const label = labelParts.join(" · ") || value;
  const specificity = labelParts.length + (record.event_year ? 1 : 0) + (record.event_name ? 1 : 0) + (record.album_title ? 1 : 0);
  return { value, label, specificity };
}

export function albumFilterOptions(photos, albums = []) {
  const options = new Map();
  for (const photo of photos) {
    for (const albumId of photo.album_ids) {
      const id = String(albumId ?? "").trim();
      if (!id) {
        continue;
      }
      const key = `id:${id}`;
      const next = albumOptionFromRecord(photo, key);
      const current = options.get(key);
      if (!current || next.specificity > current.specificity || next.label.length > current.label.length) {
        options.set(key, next);
      }
    }

    if (photo.album_ids.length === 0 && photo.album_title) {
      const key = `title:${photo.album_title}`;
      options.set(key, albumOptionFromRecord(photo, key));
    }
  }

  const orderedOptions = [];
  const usedKeys = new Set();
  for (const album of albums) {
    const albumId = String(album.album_id ?? "").trim();
    const key = albumId ? `id:${albumId}` : "";
    if (!key || !options.has(key)) {
      continue;
    }
    const option = albumOptionFromRecord(album, key);
    orderedOptions.push({ value: key, label: option.label });
    usedKeys.add(key);
  }

  for (const [key, option] of options) {
    if (!usedKeys.has(key)) {
      orderedOptions.push({ value: option.value, label: option.label });
    }
  }

  return orderedOptions;
}

export function setupTaskModes(container, taskModes) {
  container.replaceChildren();
  for (const task of taskModes) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "task-mode";
    button.dataset.taskMode = task.id;
    button.innerHTML = `<strong>${task.label}</strong><span>${task.description}</span>`;
    container.append(button);
  }
}

function setVisibleLabel(control, text) {
  const label = control?.closest("label")?.querySelector("span");
  if (label && text) {
    label.textContent = text;
  }
}

function valuesForFilter(definition, { taxonomy, photos, albums, peopleCountFilters, uniqueSorted }) {
  const source = definition.source ?? {};
  if (source.type === "album") {
    return albumFilterOptions(photos, albums);
  }
  if (source.type === "people_count_buckets") {
    return peopleCountFilters;
  }
  if (source.type === "boolean") {
    return ["true", "false"];
  }
  if (source.type === "photo_values") {
    return uniqueSorted(photos.flatMap((photo) => photo[definition.field] ?? []));
  }
  if (source.key) {
    return taxonomy[source.key] ?? [];
  }
  return [];
}

export function setupFilters({ controls, elements, taxonomy, photos, albums, peopleCountFilters, optionLabels, uniqueSorted }) {
  for (const definition of filterDefinitions) {
    const control = controls[definition.control];
    if (!control) {
      continue;
    }
    setVisibleLabel(control, definition.label);
    const values = valuesForFilter(definition, { taxonomy, photos, albums, peopleCountFilters, uniqueSorted });
    const emptyLabel = definition.emptyLabel ?? `全部${definition.label}`;
    if (definition.source?.type === "album") {
      fillSelectOptions(control, emptyLabel, values);
    } else if (definition.source?.type === "people_count_buckets") {
      control.replaceChildren(...values.map(({ label, value }) => new Option(label, value)));
    } else if (definition.source?.type === "taxonomy_autocomplete") {
      setupAutocompleteInput(control, values);
    } else if (definition.source?.labels) {
      fillSelectWithLabels(control, emptyLabel, values, optionLabels(definition.field));
    } else {
      fillSelect(control, emptyLabel, values);
    }
    if (definition.searchPlaceholder && control.tagName === "SELECT") {
      setupEnhancedSelect(control, definition.searchPlaceholder);
    } else if (definition.searchPlaceholder && "placeholder" in control) {
      control.placeholder = definition.searchPlaceholder;
    }
  }
  elements.sponsorshipItemOptions.replaceChildren(
    ...(taxonomy.sponsorship_items ?? []).map((value) => {
      const option = document.createElement("option");
      option.value = value;
      return option;
    }),
  );
}

export function selectedOptionText(select) {
  return select.selectedOptions[0]?.textContent ?? select.value;
}

export function activeFilterEntries({ state, controls, activeTask }) {
  const entries = [];
  if (state.taskMode !== "all") {
    entries.push(["task", "任務", activeTask.label]);
  }
  if (controls.search.value.trim()) {
    entries.push(["search", "搜尋", sanitizeSearchTerm(controls.search.value)]);
  }
  for (const definition of filterDefinitions) {
    const control = controls[definition.control];
    for (const value of state.filters?.[definition.key] ?? []) {
      entries.push([definition.key, definition.label, optionTextForValue(control, value), value]);
    }
  }
  return entries;
}
