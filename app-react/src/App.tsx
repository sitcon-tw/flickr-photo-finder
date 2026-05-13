import { useEffect, useMemo, useReducer, useState } from "react";
import { loadFinderData } from "../../app-core/data-loader";
import { applySearchRegistry, filterAndSortPhotos } from "../../app-core/search-sort";
import { applyUrlStateRegistry, decodeUrlState } from "../../app-core/url-state";

type PhotoValue = string | string[] | number | boolean | null | undefined;
type PhotoRecord = Record<string, PhotoValue> & {
  photo_id: string;
  photo_url: string;
  image_preview_url: string;
  album_title: string;
  event_name: string;
  event_year: string;
  recommended_uses: string[];
  scene_tags: string[];
  public_use_status: string;
  priority_level: string;
  curation_status: string;
  visual_description: string;
  search_text: string;
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
type FinderViewState = {
  searchTerm: string;
  sortMode: SortModeValue;
  taskModeId: string;
};
type FinderViewAction =
  | { type: "hydrate"; state: Partial<FinderViewState>; validTaskModes: string[] }
  | { type: "setSearchTerm"; value: string }
  | { type: "setSortMode"; value: string }
  | { type: "setTaskMode"; value: string; validTaskModes: string[] }
  | { type: "reset" };

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
};

function photoTitle(photo: PhotoRecord) {
  return photo.event_name || photo.album_title || photo.photo_id;
}

function statusText(photo: PhotoRecord) {
  return [photo.public_use_status, photo.priority_level, photo.curation_status].filter(Boolean).join(" / ");
}

function PhotoCard({ photo }: { photo: PhotoRecord }) {
  return (
    <article className="photo-card">
      {photo.image_preview_url ? (
        <img src={photo.image_preview_url} alt={photoTitle(photo)} loading="lazy" decoding="async" />
      ) : (
        <div className="photo-card__empty">No preview</div>
      )}
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
          <a href={photo.photo_url}>Flickr</a>
        </div>
      </div>
    </article>
  );
}

function registryTaskModes(data: FinderData | null) {
  const modes = data?.interfaceRegistry?.pages?.taskModes;
  return Array.isArray(modes) && modes.length > 0 ? (modes as TaskMode[]) : fallbackTaskModes;
}

function registrySettings(data: FinderData | null) {
  return (data?.interfaceRegistry?.pages?.settings ?? {}) as FinderSettings;
}

function isSortModeValue(value: string): value is SortModeValue {
  return sortModes.some((mode) => mode.value === value);
}

function normalizeTaskModeId(value: string, validTaskModes: string[]) {
  return validTaskModes.includes(value) ? value : "all";
}

function normalizeViewState(state: Partial<FinderViewState>, validTaskModes: string[]) {
  return {
    searchTerm: String(state.searchTerm ?? "").trim(),
    sortMode: state.sortMode && isSortModeValue(state.sortMode) ? state.sortMode : "recommended",
    taskModeId: normalizeTaskModeId(String(state.taskModeId ?? "all"), validTaskModes),
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
    return { ...state, taskModeId: normalizeTaskModeId(action.value, action.validTaskModes) };
  }
  if (action.type === "reset") {
    return initialViewState;
  }
  return state;
}

function buildPartialFinderUrl(state: FinderViewState) {
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

  const nextSearch = params.toString();
  return `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
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
    dispatch({
      type: "hydrate",
      state: {
        searchTerm: urlState.search,
        sortMode: isSortModeValue(urlState.sort) ? urlState.sort : "recommended",
        taskModeId: urlState.taskMode || "all",
      },
      validTaskModes,
    });
    setUrlStateReady(true);
  }, [data, urlStateReady, validTaskModes]);

  useEffect(() => {
    if (!data || !urlStateReady) {
      return;
    }
    const nextUrl = buildPartialFinderUrl({ searchTerm, sortMode, taskModeId });
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [data, searchTerm, sortMode, taskModeId, urlStateReady]);

  useEffect(() => {
    if (!data) {
      return;
    }
    const handlePopState = () => {
      const urlState = decodeUrlState(new URLSearchParams(window.location.search));
      dispatch({
        type: "hydrate",
        state: {
          searchTerm: urlState.search,
          sortMode: isSortModeValue(urlState.sort) ? urlState.sort : "recommended",
          taskModeId: urlState.taskMode || "all",
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
        filters: { search: searchTerm },
        sortMode,
        task: activeTask.id === "all" ? {} : activeTask,
        discoverHistorySize: settings.discoverHistorySize,
        discoverWindowSize: settings.discoverWindowSize,
      }) as unknown as PhotoRecord[],
    [activeTask, photos, searchTerm, settings.discoverHistorySize, settings.discoverWindowSize, sortMode],
  );
  const previewPhotos = filteredPhotos.slice(0, previewResultLimit);
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
          disabled={!searchTerm && sortMode === "recommended" && activeTask.id === "all"}
          onClick={() => dispatch({ type: "reset" })}
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
              onClick={() => dispatch({ type: "setTaskMode", value: mode.id, validTaskModes })}
            >
              <strong>{mode.label}</strong>
              {mode.description ? <span>{mode.description}</span> : null}
            </button>
          ))}
        </div>
      </section>

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
          previewPhotos.map((photo) => <PhotoCard key={photo.photo_id} photo={photo} />)
        ) : (
          <div className="empty-result">沒有符合目前搜尋的照片</div>
        )}
      </section>
    </main>
  );
}
