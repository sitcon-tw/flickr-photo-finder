import { sanitizeSearchTerm } from "./analytics.js";
import { normalizeText } from "./search-sort.js";

// DOM control helpers for the Pages frontend. This module owns control widgets
// and filter-entry shaping; main.js owns when these controls trigger render.
const enhancedSelects = new Map();
const autocompleteInputs = new Map();

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
    candidateCopyTemplate: document.querySelector("#candidateCopyTemplateSelect"),
    clearCandidates: document.querySelector("#clearCandidatesButton"),
    copyAiAssistantPrompt: document.querySelector("#copyAiAssistantPromptButton"),
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
    taskModes: document.querySelector("#taskModes"),
    sponsorshipItemOptions: document.querySelector("#sponsorshipItemOptions"),
    loadMorePanel: document.querySelector("#loadMorePanel"),
    loadMoreSummary: document.querySelector("#loadMoreSummary"),
    candidateSummary: document.querySelector("#candidateSummary"),
    candidateList: document.querySelector("#candidateList"),
    aiAssistantSheetLink: document.querySelector("#aiAssistantSheetLink"),
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

function syncEnhancedSelectValue(control) {
  const selected = control.select.selectedOptions[0];
  const text = enhancedSelectOptionText(selected) || control.placeholder;
  control.triggerText.textContent = text;
  control.trigger.classList.toggle("is-empty", !control.select.value);
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
    button.setAttribute("aria-selected", option.value === control.select.value ? "true" : "false");
    button.classList.toggle("is-selected", option.value === control.select.value);
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
  window.requestAnimationFrame(() => control.search.focus({ preventScroll: true }));
}

function setEnhancedSelectValue(control, value) {
  control.select.value = value;
  syncEnhancedSelectValue(control);
  closeEnhancedSelect(control);
  control.select.dispatchEvent(new Event("input", { bubbles: true }));
}

function setupEnhancedSelect(select, searchPlaceholder) {
  let control = enhancedSelects.get(select);
  if (!control) {
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
      setEnhancedSelectValue(control, optionButton.dataset.value ?? "");
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

function renderAutocompleteOptions(control) {
  const query = normalizeText(control.input.value);
  const values = control.values.filter((value) => !query || normalizeText(value).includes(query));
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

function setAutocompleteInputValue(control, value) {
  control.input.value = value;
  control.input.dispatchEvent(new Event("input", { bubbles: true }));
  closeAutocompleteInput(control);
}

function setupAutocompleteInput(input, values) {
  let control = autocompleteInputs.get(input);
  if (!control) {
    input.removeAttribute("list");

    const root = document.createElement("div");
    root.className = "autocomplete-input";
    const panel = document.createElement("div");
    panel.className = "autocomplete-panel";
    panel.hidden = true;
    const options = document.createElement("div");
    options.className = "autocomplete-options";
    options.setAttribute("role", "listbox");
    panel.append(options);

    input.insertAdjacentElement("beforebegin", root);
    root.append(input, panel);

    control = { root, input, panel, options, values: [] };
    autocompleteInputs.set(input, control);

    input.addEventListener("focus", () => openAutocompleteInput(control));
    input.addEventListener("input", () => openAutocompleteInput(control));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAutocompleteInput(control);
      }
    });
    options.addEventListener("click", (event) => {
      const optionButton = event.target.closest("[data-value]");
      if (!optionButton) {
        return;
      }
      setAutocompleteInputValue(control, optionButton.dataset.value ?? "");
    });
  }

  control.values = values;
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

function inferYear(...values) {
  for (const value of values) {
    const match = String(value ?? "").match(/(20\d{2})/);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function albumOptionFromPhoto(photo, value) {
  const albumTitle = String(photo.album_title ?? "").trim();
  const eventName = String(photo.event_name ?? "").trim();
  const explicitYear = String(photo.event_year ?? "").trim();
  const year = explicitYear || inferYear(eventName, albumTitle);
  const titleAlreadyHasYear = year && (albumTitle.includes(year) || eventName.includes(year));
  const labelParts = compactLabelParts([titleAlreadyHasYear ? "" : year, eventName, albumTitle]);
  const label = labelParts.join(" · ") || value;
  const specificity = labelParts.length + (year ? 1 : 0) + (eventName ? 1 : 0) + (albumTitle ? 1 : 0);
  return { value, label, year, specificity };
}

export function albumFilterOptions(photos) {
  const options = new Map();
  for (const photo of photos) {
    for (const albumId of photo.album_ids) {
      const id = String(albumId ?? "").trim();
      if (!id) {
        continue;
      }
      const key = `id:${id}`;
      const next = albumOptionFromPhoto(photo, key);
      const current = options.get(key);
      if (!current || next.specificity > current.specificity || next.label.length > current.label.length) {
        options.set(key, next);
      }
    }

    if (photo.album_ids.length === 0 && photo.album_title) {
      const key = `title:${photo.album_title}`;
      options.set(key, albumOptionFromPhoto(photo, key));
    }
  }

  return [...options.values()]
    .sort((left, right) => {
      const leftYear = Number(left.year) || 0;
      const rightYear = Number(right.year) || 0;
      return (
        rightYear - leftYear ||
        left.label.localeCompare(right.label, "zh-Hant-TW") ||
        left.value.localeCompare(right.value, "zh-Hant-TW")
      );
    })
    .map(({ value, label }) => ({ value, label }));
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

export function setupFilters({ controls, elements, taxonomy, photos, peopleCountFilters, optionLabels, uniqueSorted }) {
  fillSelectOptions(controls.album, "全部活動/相簿", albumFilterOptions(photos));
  fillSelect(controls.use, "全部用途", taxonomy.recommended_uses ?? []);
  fillSelect(controls.mood, "全部氛圍", taxonomy.mood_tags ?? []);
  fillSelect(controls.scene, "全部場景", taxonomy.scene_tags ?? []);
  controls.peopleCount.replaceChildren(...peopleCountFilters.map(({ label, value }) => new Option(label, value)));
  fillSelectWithLabels(controls.subjectType, "全部主體", taxonomy.subject_type ?? [], optionLabels("subject_type"));
  fillSelectWithLabels(controls.orientation, "全部方向", taxonomy.orientation ?? [], optionLabels("orientation"));
  fillSelectWithLabels(controls.negativeSpace, "全部留白狀態", ["true", "false"], optionLabels("has_negative_space"));
  fillSelect(controls.safeCrop, "全部裁切", taxonomy.safe_crop ?? []);
  fillSelect(controls.sponsorshipTag, "全部贊助價值", taxonomy.sponsorship_tags ?? []);
  fillSelectWithLabels(controls.publicStatus, "全部使用提醒", taxonomy.public_use_status ?? [], optionLabels("public_use_status"));
  fillSelectWithLabels(controls.priority, "全部優先度", taxonomy.priority_level ?? [], optionLabels("priority_level"));
  fillSelectWithLabels(controls.curationStatus, "全部整理狀態", taxonomy.curation_status ?? [], optionLabels("curation_status"));
  fillSelect(controls.collection, "全部素材包", uniqueSorted(photos.flatMap((photo) => photo.collections)));
  elements.sponsorshipItemOptions.replaceChildren(
    ...(taxonomy.sponsorship_items ?? []).map((value) => {
      const option = document.createElement("option");
      option.value = value;
      return option;
    }),
  );
  setupEnhancedSelect(controls.album, "搜尋活動或相簿");
  setupEnhancedSelect(controls.scene, "搜尋場景");
  setupEnhancedSelect(controls.collection, "搜尋素材包");
  setupAutocompleteInput(controls.sponsorshipItem, taxonomy.sponsorship_items ?? []);
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
  for (const [key, label, control] of [
    ["album", "活動/相簿", controls.album],
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
