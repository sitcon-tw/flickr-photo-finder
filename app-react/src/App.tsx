import { useEffect, useMemo, useReducer, useState } from "react";
import { candidateCopyText, selectedPhotos } from "../../app-core/candidate-copy";
import { loadFinderData } from "../../app-core/data-loader";
import { applySearchRegistry, filterAndSortPhotos } from "../../app-core/search-sort";
import { applyUrlStateRegistry, decodeUrlState } from "../../app-core/url-state";

type PhotoValue = string | string[] | number | boolean | null | undefined;
type PhotoRecord = Record<string, PhotoValue> & {
  photo_id: string;
  photo_url: string;
  image_preview_url: string;
  album_ids: string[];
  album_title: string;
  event_name: string;
  event_year: string;
  recommended_uses: string[];
  scene_tags: string[];
  mood_tags: string[];
  safe_crop: string[];
  orientation: string;
  has_negative_space: string;
  public_use_status: string;
  priority_level: string;
  curation_status: string;
  visual_description: string;
  search_text: string;
  _sheet_row_number?: number;
  sponsorship_items: string[];
  sponsorship_tags: string[];
};

type FinderData = Awaited<ReturnType<typeof loadFinderData>>;
type TaskMode = {
  id: string;
  label: string;
  description?: string;
  recommendedUses?: string[];
  moods?: string[];
  scenes?: string[];
  sponsorshipTags?: string[];
  orientations?: string[];
  safeCrops?: string[];
  prefersNegativeSpace?: boolean;
};
type FinderSettings = {
  discoverHistorySize?: number;
  discoverWindowSize?: number;
};
type FilterDefinition = {
  key: string;
  urlKey?: string;
  filterParam?: string;
  field?: string;
  label: string;
  source?: {
    type?: string;
    key?: string;
    labels?: boolean;
  };
  emptyLabel?: string;
};
type FilterOption = {
  value: string;
  label: string;
};
type FinderFilters = Record<string, string[]>;
type FinderViewState = {
  searchTerm: string;
  sortMode: SortModeValue;
  taskModeId: string;
  filters: FinderFilters;
  selectedPhotoIds: string[];
  activePreviewPhotoId: string;
};
type FinderViewAction =
  | { type: "hydrate"; state: Partial<FinderViewState>; validTaskModes: string[] }
  | { type: "setSearchTerm"; value: string }
  | { type: "setSortMode"; value: string }
  | { type: "setTaskMode"; value: string; validTaskModes: string[]; nextFilterKeys: string[] }
  | { type: "setFilterValues"; key: string; values: string[] }
  | { type: "clearFilterValue"; key: string; value: string }
  | { type: "toggleCandidate"; photoId: string }
  | { type: "clearCandidates" }
  | { type: "openPreview"; photoId: string }
  | { type: "closePreview" }
  | { type: "reset"; filterKeys: string[] };

const previewDataSources = {
  albumsCsvUrl: "./fixtures/albums.csv",
  photosCsvUrl: "./fixtures/photos.csv",
  interfaceRegistryJsonUrl: "./data/interface-registry.json",
  schemaJsonUrl: "./data/photo-schema.json",
  taxonomyJsonUrl: "./data/tag-taxonomy.json",
  searchAliasesJsonUrl: "./data/search-aliases.json",
};

const sortModes = [
  { value: "recommended", label: "推薦排序" },
  { value: "discover", label: "探索更多" },
  { value: "newest", label: "年份新到舊" },
  { value: "oldest", label: "年份舊到新" },
  { value: "people-desc", label: "人數多到少" },
  { value: "people-asc", label: "人數少到多" },
] as const;
type SortModeValue = (typeof sortModes)[number]["value"];

const fallbackTaskModes: TaskMode[] = [{ id: "all", label: "全部照片", description: "不套任務權重" }];
const previewResultLimit = 12;
const initialViewState: FinderViewState = {
  searchTerm: "",
  sortMode: "recommended",
  taskModeId: "all",
  filters: {},
  selectedPhotoIds: [],
  activePreviewPhotoId: "",
};

function photoTitle(photo: PhotoRecord) {
  return photo.event_name || photo.album_title || photo.photo_id;
}

function candidatePhotoTitle(photo: { photo_id: string; event_name?: unknown; album_title?: unknown }) {
  return String(photo.event_name || photo.album_title || photo.photo_id);
}

function statusText(photo: PhotoRecord) {
  return [photo.public_use_status, photo.priority_level, photo.curation_status].filter(Boolean).join(" / ");
}

function buildSizedImageUrl(previewUrl: string, suffix: string) {
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

function displayImageUrl(photo: PhotoRecord) {
  return buildSizedImageUrl(photo.image_preview_url, "z") || photo.image_preview_url;
}

function largeImageUrl(photo: PhotoRecord) {
  return buildSizedImageUrl(photo.image_preview_url, "b");
}

function originalSizePageUrl(photo: PhotoRecord) {
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

function finderLink(photo: { photo_id: string }) {
  const url = new URL(window.location.href);
  url.hash = `photo-${photo.photo_id}`;
  return url.toString();
}

function sheetRowLink(photo: PhotoRecord, data: FinderData | null) {
  const spreadsheetId = String(data?.projectConfig?.googleSheets?.spreadsheetId ?? "").trim();
  if (!spreadsheetId || !photo._sheet_row_number) {
    return "";
  }
  const gid = encodeURIComponent(String(data?.projectConfig?.googleSheets?.photosSheetGid ?? 0));
  const range = encodeURIComponent(`A${photo._sheet_row_number}`);
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}&range=${range}`;
}

function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true);
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return Promise.resolve(copied);
}

function compactLabelParts(parts: unknown[]) {
  const seen = new Set<string>();
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

function albumOptionFromRecord(record: Record<string, PhotoValue>, value: string) {
  const labelParts = compactLabelParts([record.event_year, record.event_name, record.album_title]);
  return { value, label: labelParts.join(" · ") || value };
}

function albumFilterOptions(photos: PhotoRecord[], albums: Record<string, PhotoValue>[] = []) {
  const options = new Map<string, FilterOption>();
  for (const photo of photos) {
    for (const albumId of photo.album_ids ?? []) {
      const id = String(albumId ?? "").trim();
      if (!id) {
        continue;
      }
      const key = `id:${id}`;
      const next = albumOptionFromRecord(photo, key);
      const current = options.get(key);
      if (!current || next.label.length > current.label.length) {
        options.set(key, next);
      }
    }
    if (!photo.album_ids?.length && photo.album_title) {
      const key = `title:${photo.album_title}`;
      options.set(key, albumOptionFromRecord(photo, key));
    }
  }

  const orderedOptions: FilterOption[] = [];
  const usedKeys = new Set<string>();
  for (const album of albums) {
    const albumId = String(album.album_id ?? "").trim();
    const key = albumId ? `id:${albumId}` : "";
    if (!key || !options.has(key)) {
      continue;
    }
    orderedOptions.push(albumOptionFromRecord(album, key));
    usedKeys.add(key);
  }
  for (const [key, option] of options) {
    if (!usedKeys.has(key)) {
      orderedOptions.push(option);
    }
  }
  return orderedOptions;
}

function PhotoCard({
  photo,
  selected,
  onToggleCandidate,
  onOpenPreview,
}: {
  photo: PhotoRecord;
  selected: boolean;
  onToggleCandidate: (photoId: string) => void;
  onOpenPreview: (photoId: string) => void;
}) {
  return (
    <article className="photo-card" data-photo-id={photo.photo_id}>
      <button type="button" className="photo-card__preview" onClick={() => onOpenPreview(photo.photo_id)}>
        {photo.image_preview_url ? (
          <img src={photo.image_preview_url} alt={photoTitle(photo)} loading="lazy" decoding="async" />
        ) : (
          <span className="photo-card__empty">No preview</span>
        )}
        <span className="photo-card__preview-hint">預覽</span>
      </button>
      <div className="photo-card__body">
        <div className="photo-card__meta">{[photo.event_year, photo.album_title].filter(Boolean).join(" / ")}</div>
        <h2>{photoTitle(photo)}</h2>
        <p>{photo.visual_description || "尚無畫面描述"}</p>
        <dl>
          <div>
            <dt>用途</dt>
            <dd>{photo.recommended_uses.slice(0, 2).join("、") || "未填"}</dd>
          </div>
          <div>
            <dt>場景</dt>
            <dd>{photo.scene_tags.slice(0, 2).join("、") || "未填"}</dd>
          </div>
        </dl>
        <div className="photo-card__footer">
          <span>{statusText(photo)}</span>
          <div className="photo-card__actions">
            <button
              type="button"
              className={selected ? "candidate-toggle is-selected" : "candidate-toggle"}
              aria-pressed={selected}
              onClick={() => onToggleCandidate(photo.photo_id)}
            >
              {selected ? "已候選" : "候選"}
            </button>
            <a href={photo.photo_url}>Flickr</a>
          </div>
        </div>
      </div>
    </article>
  );
}

function CandidatePanel({
  candidates,
  copyTemplate,
  copyStatus,
  onCopyTemplateChange,
  onCopy,
  onClear,
}: {
  candidates: PhotoRecord[];
  copyTemplate: string;
  copyStatus: string;
  onCopyTemplateChange: (template: string) => void;
  onCopy: () => void;
  onClear: () => void;
}) {
  return (
    <section className="candidate-panel" aria-label="候選照片">
      <div className="candidate-panel__heading">
        <h2>候選 {candidates.length}</h2>
        <div className="candidate-panel__actions">
          <label>
            <span>複製格式</span>
            <select value={copyTemplate} onChange={(event) => onCopyTemplateChange(event.target.value)} disabled={candidates.length === 0}>
              <option value="im">IM 討論版</option>
              <option value="sponsor">贊助佐證版</option>
              <option value="collaboration">協作檢查版</option>
              <option value="flickr_urls">純 Flickr URL</option>
            </select>
          </label>
          <button type="button" onClick={onCopy} disabled={candidates.length === 0}>
            {copyStatus || "複製"}
          </button>
          <button type="button" onClick={onClear} disabled={candidates.length === 0}>
            清空
          </button>
        </div>
      </div>
      {candidates.length === 0 ? (
        <p className="candidate-empty">尚無候選照片</p>
      ) : (
        <ol className="candidate-list">
          {candidates.map((photo) => (
            <li key={photo.photo_id}>
              <span>{photoTitle(photo)}</span>
              <a href={photo.photo_url}>Flickr</a>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function detailValues(data: FinderData | null, fieldName: string, values: PhotoValue) {
  const items = Array.isArray(values) ? values : [values].filter(Boolean);
  return items
    .map((value) =>
      optionLabelFor(
        data,
        { key: fieldName, field: fieldName, label: fieldName, source: { labels: true } },
        String(value ?? ""),
      ),
    )
    .filter(Boolean)
    .join("、");
}

function asStringArray(values: PhotoValue) {
  return Array.isArray(values) ? values.map((value) => String(value ?? "")).filter(Boolean) : [];
}

function PhotoPreviewDialog({
  photo,
  data,
  selected,
  onClose,
  onToggleCandidate,
}: {
  photo: PhotoRecord;
  data: FinderData | null;
  selected: boolean;
  onClose: () => void;
  onToggleCandidate: (photoId: string) => void;
}) {
  const previewUrl = largeImageUrl(photo) || displayImageUrl(photo);
  const largeUrl = largeImageUrl(photo);
  const details = [
    ["構圖", detailValues(data, "orientation", photo.orientation)],
    ["留白", detailValues(data, "has_negative_space", photo.has_negative_space)],
    ["裁切", detailValues(data, "safe_crop", asStringArray(photo.safe_crop))],
    ["用途", detailValues(data, "recommended_uses", asStringArray(photo.recommended_uses).slice(0, 4))],
    ["場景", detailValues(data, "scene_tags", asStringArray(photo.scene_tags).slice(0, 4))],
    ["贊助品項", detailValues(data, "sponsorship_items", asStringArray(photo.sponsorship_items).slice(0, 4))],
    ["贊助價值", detailValues(data, "sponsorship_tags", asStringArray(photo.sponsorship_tags).slice(0, 4))],
    ["畫面描述", photo.visual_description],
    ["整理狀態", detailValues(data, "curation_status", photo.curation_status)],
    ["使用提醒", detailValues(data, "public_use_status", photo.public_use_status)],
  ].filter(([, value]) => Boolean(value));
  const originalUrl = originalSizePageUrl(photo);
  const rowLink = sheetRowLink(photo, data);

  return (
    <div className="photo-preview-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="photo-preview-dialog" role="dialog" aria-modal="true" aria-label="照片預覽">
        <header className="preview-header">
          <div>
            <h2>{photoTitle(photo)}</h2>
            <p>{[photo.event_year, photo.album_title].filter(Boolean).join(" / ")}</p>
          </div>
          <button type="button" className="preview-close" onClick={onClose} aria-label="關閉照片預覽">
            關閉
          </button>
        </header>
        <a className="preview-image-link" href={photo.photo_url} target="_blank" rel="noreferrer">
          {previewUrl ? (
            <img src={previewUrl} alt={[photoTitle(photo), photo.event_year].filter(Boolean).join(" ")} />
          ) : (
            <span className="preview-image-empty">No preview image</span>
          )}
          <span className="preview-image-hint">Flickr</span>
        </a>
        <dl className="preview-details">
          {details.map(([label, value]) => (
            <div key={label} className="preview-detail-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="preview-actions">
          <button
            type="button"
            className={selected ? "candidate-toggle is-selected" : "candidate-toggle"}
            aria-pressed={selected}
            onClick={() => onToggleCandidate(photo.photo_id)}
          >
            {selected ? "已加入候選" : "加入候選"}
          </button>
          <a href={largeUrl || undefined} aria-disabled={!largeUrl}>
            大圖
          </a>
          <a href={originalUrl || undefined} aria-disabled={!originalUrl}>
            原圖
          </a>
          <a href={rowLink || undefined} aria-disabled={!rowLink}>
            Sheets
          </a>
        </div>
      </section>
    </div>
  );
}

function registryTaskModes(data: FinderData | null) {
  const modes = data?.interfaceRegistry?.pages?.taskModes;
  return Array.isArray(modes) && modes.length > 0 ? (modes as TaskMode[]) : fallbackTaskModes;
}

function registrySettings(data: FinderData | null) {
  return (data?.interfaceRegistry?.pages?.settings ?? {}) as FinderSettings;
}

function registryFilterDefinitions(data: FinderData | null) {
  const filters = data?.interfaceRegistry?.pages?.filters;
  return Array.isArray(filters) ? (filters as FilterDefinition[]) : [];
}

function primaryFilterDefinitions(data: FinderData | null, taskModeId: string) {
  const definitions = registryFilterDefinitions(data);
  if (definitions.length === 0) {
    return [];
  }
  const pages = data?.interfaceRegistry?.pages;
  const taskModes = Array.isArray(pages?.taskModes) ? (pages.taskModes as Array<TaskMode & { primaryFilters?: string[] }>) : [];
  const taskPrimaryFilters = taskModes.find((mode) => mode.id === taskModeId)?.primaryFilters;
  const defaultPrimaryFilters = Array.isArray(pages?.defaultPrimaryFilters)
    ? (pages.defaultPrimaryFilters as string[])
    : ["use", "scene", "orientation", "safeCrop", "negativeSpace", "mood"];
  const primaryKeys = new Set(taskPrimaryFilters ?? defaultPrimaryFilters);
  return definitions.filter((definition) => definition.key !== "album" && primaryKeys.has(definition.key)).slice(0, 6);
}

function allReactOwnedPrimaryFilterDefinitions(data: FinderData | null) {
  const definitions = registryFilterDefinitions(data);
  if (definitions.length === 0) {
    return [];
  }
  const pages = data?.interfaceRegistry?.pages;
  const taskModes = Array.isArray(pages?.taskModes) ? (pages.taskModes as Array<TaskMode & { primaryFilters?: string[] }>) : [];
  const defaultPrimaryFilters = Array.isArray(pages?.defaultPrimaryFilters)
    ? (pages.defaultPrimaryFilters as string[])
    : ["use", "scene", "orientation", "safeCrop", "negativeSpace", "mood"];
  const ownedKeys = new Set([
    ...defaultPrimaryFilters,
    ...taskModes.flatMap((mode) => (Array.isArray(mode.primaryFilters) ? mode.primaryFilters : [])),
  ]);
  return definitions.filter((definition) => definition.key !== "album" && ownedKeys.has(definition.key));
}

function isSortModeValue(value: string): value is SortModeValue {
  return sortModes.some((mode) => mode.value === value);
}

function cleanValues(values: string[]) {
  const seen = new Set<string>();
  return values
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

function normalizeTaskModeId(value: string, validTaskModes: string[]) {
  return validTaskModes.includes(value) ? value : "all";
}

function normalizeViewState(state: Partial<FinderViewState>, validTaskModes: string[]) {
  return {
    searchTerm: String(state.searchTerm ?? "").trim(),
    sortMode: state.sortMode && isSortModeValue(state.sortMode) ? state.sortMode : "recommended",
    taskModeId: normalizeTaskModeId(String(state.taskModeId ?? "all"), validTaskModes),
    filters: Object.fromEntries(
      Object.entries(state.filters ?? {}).map(([key, values]) => [key, cleanValues(values)]),
    ),
    selectedPhotoIds: cleanValues(state.selectedPhotoIds ?? []),
    activePreviewPhotoId: String(state.activePreviewPhotoId ?? "").trim(),
  };
}

function finderViewReducer(state: FinderViewState, action: FinderViewAction): FinderViewState {
  if (action.type === "hydrate") {
    return normalizeViewState({ ...state, ...action.state }, action.validTaskModes);
  }
  if (action.type === "setSearchTerm") {
    return { ...state, searchTerm: action.value };
  }
  if (action.type === "setSortMode") {
    return { ...state, sortMode: isSortModeValue(action.value) ? action.value : "recommended" };
  }
  if (action.type === "setTaskMode") {
    const nextFilterKeySet = new Set(action.nextFilterKeys);
    return {
      ...state,
      taskModeId: normalizeTaskModeId(action.value, action.validTaskModes),
      filters: Object.fromEntries(
        Object.entries(state.filters).filter(([key]) => nextFilterKeySet.has(key)),
      ),
    };
  }
  if (action.type === "setFilterValues") {
    return { ...state, filters: { ...state.filters, [action.key]: cleanValues(action.values) } };
  }
  if (action.type === "clearFilterValue") {
    const target = action.value.trim().toLowerCase();
    return {
      ...state,
      filters: {
        ...state.filters,
        [action.key]: cleanValues(state.filters[action.key] ?? []).filter((value) => value.toLowerCase() !== target),
      },
    };
  }
  if (action.type === "toggleCandidate") {
    const photoId = action.photoId.trim();
    if (!photoId) {
      return state;
    }
    if (state.selectedPhotoIds.includes(photoId)) {
      return { ...state, selectedPhotoIds: state.selectedPhotoIds.filter((item) => item !== photoId) };
    }
    return { ...state, selectedPhotoIds: [...state.selectedPhotoIds, photoId] };
  }
  if (action.type === "clearCandidates") {
    return { ...state, selectedPhotoIds: [] };
  }
  if (action.type === "openPreview") {
    return { ...state, activePreviewPhotoId: action.photoId.trim() };
  }
  if (action.type === "closePreview") {
    return { ...state, activePreviewPhotoId: "" };
  }
  if (action.type === "reset") {
    return {
      ...initialViewState,
      filters: Object.fromEntries(action.filterKeys.map((key) => [key, []])),
      selectedPhotoIds: state.selectedPhotoIds,
    };
  }
  return state;
}

function buildPartialFinderUrl(
  state: Pick<FinderViewState, "searchTerm" | "sortMode" | "taskModeId" | "filters" | "selectedPhotoIds">,
  ownedFilterDefinitions: FilterDefinition[],
) {
  const params = new URLSearchParams(window.location.search);
  if (state.taskModeId && state.taskModeId !== "all") {
    params.set("task", state.taskModeId);
  } else {
    params.delete("task");
  }
  const searchTerm = state.searchTerm.trim();
  if (searchTerm) {
    params.set("q", searchTerm);
  } else {
    params.delete("q");
  }
  if (state.sortMode && state.sortMode !== "recommended") {
    params.set("sort", state.sortMode);
  } else {
    params.delete("sort");
  }
  for (const definition of ownedFilterDefinitions) {
    const key = definition.key;
    const urlKey = definition.urlKey ?? definition.key;
    params.delete(urlKey);
    for (const value of cleanValues(state.filters[key] ?? [])) {
      params.append(urlKey, value);
    }
  }
  if (state.selectedPhotoIds.length > 0) {
    params.set("selected", state.selectedPhotoIds.join(","));
  } else {
    params.delete("selected");
  }

  const nextSearch = params.toString();
  return `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
}

function filtersForSearch(definitions: FilterDefinition[], filters: FinderFilters) {
  return Object.fromEntries(
    definitions.map((definition) => [definition.filterParam ?? definition.key, filters[definition.key] ?? []]),
  );
}

function optionLabelFor(data: FinderData | null, definition: FilterDefinition, value: string) {
  if (!definition.source?.labels || !definition.field || !data) {
    return value;
  }
  return data.optionLabelMaps.get(definition.field)?.get(value) ?? value;
}

function uniqueSorted(values: unknown[]) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "zh-Hant-TW"),
  );
}

function filterOptions(data: FinderData | null, definition: FilterDefinition, photos: PhotoRecord[]) {
  if (!data) {
    return [];
  }
  const source = definition.source ?? {};
  if (source.type === "album") {
    return albumFilterOptions(photos, data.albums as Record<string, PhotoValue>[]);
  }
  if (source.type === "boolean") {
    return ["true", "false"].map((value) => ({ value, label: optionLabelFor(data, definition, value) }));
  }
  if (source.type === "photo_values" && definition.field) {
    return uniqueSorted(photos.flatMap((photo) => photo[definition.field ?? ""] ?? [])).map((value) => ({
      value,
      label: optionLabelFor(data, definition, value),
    }));
  }
  if (source.key) {
    const values = ((data.taxonomy as Record<string, string[]>)[source.key] ?? []) as string[];
    return values.map((value) => ({ value, label: optionLabelFor(data, definition, value) }));
  }
  return [];
}

function FilterSelect({
  definition,
  options,
  values,
  onChange,
}: {
  definition: FilterDefinition;
  options: FilterOption[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <label className="filter-control">
      <span>{definition.label}</span>
      <select
        multiple
        value={values}
        aria-label={definition.label}
        onChange={(event) => {
          onChange([...event.currentTarget.selectedOptions].map((option) => option.value).filter(Boolean));
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function resultContextText({
  allCount,
  resultCount,
  sortMode,
  taskMode,
}: {
  allCount: number;
  resultCount: number;
  sortMode: SortModeValue;
  taskMode: TaskMode;
}) {
  if (allCount === 0) {
    return "尚未載入照片";
  }
  if (resultCount === 0) {
    return "目前條件沒有結果，可先移除搜尋字或改用其他任務情境。";
  }
  if (sortMode === "discover") {
    return `以「${taskMode.label}」探索更多排序，分散年份、活動、相簿與素材包來源。`;
  }
  const sortLabel = sortModes.find((mode) => mode.value === sortMode)?.label ?? "推薦排序";
  if (sortMode === "recommended" && taskMode.id !== "all") {
    return `以「${taskMode.label}」情境推薦排序，仍顯示符合搜尋的照片。`;
  }
  return `以${sortLabel}顯示符合搜尋的照片。`;
}

export function App() {
  const [data, setData] = useState<FinderData | null>(null);
  const [error, setError] = useState<string>("");
  const [viewState, dispatch] = useReducer(finderViewReducer, initialViewState);
  const [urlStateReady, setUrlStateReady] = useState(false);
  const [copyTemplate, setCopyTemplate] = useState("im");
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadFinderData({
      dataSources: previewDataSources,
      projectConfigUrl: "./config/project.json",
    })
      .then((loadedData) => {
        if (!cancelled) {
          applySearchRegistry(loadedData.interfaceRegistry);
          applyUrlStateRegistry(loadedData.interfaceRegistry);
          setData(loadedData);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "資料載入失敗");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const photos = useMemo(() => (data?.photos ?? []) as PhotoRecord[], [data]);
  const taskModes = useMemo(() => registryTaskModes(data), [data]);
  const validTaskModes = useMemo(() => taskModes.map((mode) => mode.id), [taskModes]);
  const normalizedViewState = useMemo(
    () => normalizeViewState(viewState, validTaskModes),
    [validTaskModes, viewState],
  );
  const { searchTerm, sortMode, taskModeId } = normalizedViewState;
  const selectedPhotoIdSet = useMemo(() => new Set(normalizedViewState.selectedPhotoIds), [normalizedViewState.selectedPhotoIds]);
  const activeFilterDefinitions = useMemo(() => primaryFilterDefinitions(data, taskModeId), [data, taskModeId]);
  const ownedFilterDefinitions = useMemo(() => allReactOwnedPrimaryFilterDefinitions(data), [data]);
  const activeFilterKeys = useMemo(
    () => activeFilterDefinitions.map((definition) => definition.key),
    [activeFilterDefinitions],
  );
  const activeTask = useMemo(
    () => taskModes.find((mode) => mode.id === taskModeId) ?? taskModes[0] ?? fallbackTaskModes[0],
    [taskModeId, taskModes],
  );
  const settings = registrySettings(data);

  useEffect(() => {
    if (!data || urlStateReady) {
      return;
    }
    const urlState = decodeUrlState(new URLSearchParams(window.location.search));
    const nextTaskModeId = normalizeTaskModeId(urlState.taskMode || "all", validTaskModes);
    const nextFilterKeys = primaryFilterDefinitions(data, nextTaskModeId).map((definition) => definition.key);
    dispatch({
      type: "hydrate",
      state: {
        searchTerm: urlState.search,
        sortMode: isSortModeValue(urlState.sort) ? urlState.sort : "recommended",
        taskModeId: nextTaskModeId,
        filters: Object.fromEntries(nextFilterKeys.map((key) => [key, urlState.filters[key] ?? []])),
        selectedPhotoIds: urlState.selectedPhotoIds,
      },
      validTaskModes,
    });
    setUrlStateReady(true);
  }, [data, urlStateReady, validTaskModes]);

  useEffect(() => {
    if (!data || !urlStateReady) {
      return;
    }
    const nextUrl = buildPartialFinderUrl(
      {
        searchTerm,
        sortMode,
        taskModeId,
        filters: Object.fromEntries(activeFilterKeys.map((key) => [key, normalizedViewState.filters[key] ?? []])),
        selectedPhotoIds: normalizedViewState.selectedPhotoIds,
      },
      ownedFilterDefinitions,
    );
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [
    activeFilterKeys,
    data,
    normalizedViewState.filters,
    normalizedViewState.selectedPhotoIds,
    ownedFilterDefinitions,
    searchTerm,
    sortMode,
    taskModeId,
    urlStateReady,
  ]);

  useEffect(() => {
    if (!data) {
      return;
    }
    const handlePopState = () => {
      const urlState = decodeUrlState(new URLSearchParams(window.location.search));
      const nextTaskModeId = normalizeTaskModeId(urlState.taskMode || "all", validTaskModes);
      const nextFilterKeys = primaryFilterDefinitions(data, nextTaskModeId).map((definition) => definition.key);
      dispatch({
        type: "hydrate",
        state: {
          searchTerm: urlState.search,
          sortMode: isSortModeValue(urlState.sort) ? urlState.sort : "recommended",
          taskModeId: nextTaskModeId,
          filters: Object.fromEntries(nextFilterKeys.map((key) => [key, urlState.filters[key] ?? []])),
          selectedPhotoIds: urlState.selectedPhotoIds,
        },
        validTaskModes,
      });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [data, validTaskModes]);

  const filteredPhotos = useMemo(
    () =>
      filterAndSortPhotos(photos, {
        filters: { search: searchTerm, ...filtersForSearch(activeFilterDefinitions, normalizedViewState.filters) },
        sortMode,
        task: activeTask.id === "all" ? {} : activeTask,
        discoverHistorySize: settings.discoverHistorySize,
        discoverWindowSize: settings.discoverWindowSize,
        selectedPhotoIds: normalizedViewState.selectedPhotoIds,
      }) as unknown as PhotoRecord[],
    [
      activeFilterDefinitions,
      activeTask,
      normalizedViewState.filters,
      normalizedViewState.selectedPhotoIds,
      photos,
      searchTerm,
      settings.discoverHistorySize,
      settings.discoverWindowSize,
      sortMode,
    ],
  );
  const previewPhotos = filteredPhotos.slice(0, previewResultLimit);
  const candidatePhotos = useMemo(
    () => selectedPhotos(normalizedViewState.selectedPhotoIds, photos) as PhotoRecord[],
    [normalizedViewState.selectedPhotoIds, photos],
  );
  const activePreviewPhoto = useMemo(
    () => photos.find((photo) => photo.photo_id === normalizedViewState.activePreviewPhotoId) ?? null,
    [normalizedViewState.activePreviewPhotoId, photos],
  );
  const visibleSummary =
    filteredPhotos.length > previewPhotos.length
      ? `顯示前 ${previewPhotos.length} 張，尚有 ${filteredPhotos.length - previewPhotos.length} 張`
      : `顯示 ${previewPhotos.length} 張`;
  const contextText = resultContextText({
    allCount: photos.length,
    resultCount: filteredPhotos.length,
    sortMode,
    taskMode: activeTask,
  });
  const hasActiveFilters = activeFilterKeys.some((key) => (normalizedViewState.filters[key] ?? []).length > 0);
  useEffect(() => {
    if (!activePreviewPhoto) {
      return undefined;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dispatch({ type: "closePreview" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activePreviewPhoto]);

  async function copyCandidates() {
    const candidateListUrl = new URL(window.location.href);
    candidateListUrl.hash = "";
    const text = candidateCopyText(
      candidatePhotos,
      {
        photoTitle: candidatePhotoTitle,
        finderLink,
        candidateListLink: () => candidateListUrl.toString(),
        sheetRowLink: (photo) => sheetRowLink(photo as PhotoRecord, data),
        labelFor: (fieldName, value) => optionLabelFor(data, { key: fieldName, field: fieldName, label: fieldName, source: { labels: true } }, String(value ?? "")),
      },
      copyTemplate,
    );
    try {
      const copied = await copyTextToClipboard(text);
      setCopyStatus(copied ? "已複製" : "複製失敗");
    } catch {
      setCopyStatus("複製失敗");
    }
    window.setTimeout(() => setCopyStatus(""), 1600);
  }

  return (
    <main className="finder-shell">
      <header className="finder-header">
        <p className="finder-kicker">React preview artifact</p>
        <h1>SITCON Flickr Photo Finder</h1>
        <p>
          React shell is reading the same public contracts and fixture CSV through the migrated TypeScript core. The
          formal Pages artifact remains the vanilla finder until cutover.
        </p>
      </header>

      <section className="finder-controls" aria-label="搜尋與排序">
        <label className="finder-search">
          <span>搜尋</span>
          <input
            type="search"
            value={searchTerm}
            placeholder="可放字、品牌露出、友善交流、舞台講者"
            autoComplete="off"
            onChange={(event) => dispatch({ type: "setSearchTerm", value: event.target.value })}
          />
        </label>

        <label className="finder-sort">
          <span>排序</span>
          <select
            value={sortMode}
            onChange={(event) => {
              dispatch({ type: "setSortMode", value: event.target.value });
            }}
          >
            {sortModes.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>

        <button
          className="finder-reset"
          type="button"
          disabled={!searchTerm && sortMode === "recommended" && activeTask.id === "all" && !hasActiveFilters}
          onClick={() => dispatch({ type: "reset", filterKeys: activeFilterKeys })}
        >
          清除
        </button>
      </section>

      <section className="task-mode-panel" aria-label="任務模式">
        <div className="task-mode-heading">
          <h2>任務模式</h2>
          <p>只調整推薦排序，不會排除照片。</p>
        </div>
        <div className="task-modes">
          {taskModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={mode.id === activeTask.id ? "task-mode is-active" : "task-mode"}
              onClick={() =>
                dispatch({
                  type: "setTaskMode",
                  value: mode.id,
                  validTaskModes,
                  nextFilterKeys: primaryFilterDefinitions(data, mode.id).map((definition) => definition.key),
                })
              }
            >
              <strong>{mode.label}</strong>
              {mode.description ? <span>{mode.description}</span> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="filter-panel" aria-label="主要篩選">
        <div className="filter-panel__heading">
          <h2>主要篩選</h2>
        </div>
        <div className="filter-grid">
          {activeFilterDefinitions.map((definition) => (
            <FilterSelect
              key={definition.key}
              definition={definition}
              options={filterOptions(data, definition, photos)}
              values={normalizedViewState.filters[definition.key] ?? []}
              onChange={(values) => dispatch({ type: "setFilterValues", key: definition.key, values })}
            />
          ))}
        </div>
      </section>

      <CandidatePanel
        candidates={candidatePhotos}
        copyTemplate={copyTemplate}
        copyStatus={copyStatus}
        onCopyTemplateChange={setCopyTemplate}
        onCopy={copyCandidates}
        onClear={() => dispatch({ type: "clearCandidates" })}
      />

      <section className="finder-status" aria-live="polite">
        {error ? (
          <strong>資料載入失敗：{error}</strong>
        ) : data ? (
          <>
            <strong>{filteredPhotos.length} / {photos.length} 張照片</strong>
            <span>{data.albums.length} 個相簿</span>
            <span>{data.photoSchema.tables.photos.fields.length} 個照片欄位</span>
            <span>{visibleSummary}</span>
          </>
        ) : (
          <strong>載入資料中</strong>
        )}
      </section>

      <p className="result-context">{contextText}</p>

      <section className="photo-grid" aria-label="照片預覽">
        {previewPhotos.length > 0 ? (
          previewPhotos.map((photo) => (
            <PhotoCard
              key={photo.photo_id}
              photo={photo}
              selected={selectedPhotoIdSet.has(photo.photo_id)}
              onToggleCandidate={(photoId) => dispatch({ type: "toggleCandidate", photoId })}
              onOpenPreview={(photoId) => dispatch({ type: "openPreview", photoId })}
            />
          ))
        ) : (
          <div className="empty-result">沒有符合目前搜尋的照片</div>
        )}
      </section>

      {activePreviewPhoto ? (
        <PhotoPreviewDialog
          photo={activePreviewPhoto}
          data={data}
          selected={selectedPhotoIdSet.has(activePreviewPhoto.photo_id)}
          onClose={() => dispatch({ type: "closePreview" })}
          onToggleCandidate={(photoId) => dispatch({ type: "toggleCandidate", photoId })}
        />
      ) : null}
    </main>
  );
}
