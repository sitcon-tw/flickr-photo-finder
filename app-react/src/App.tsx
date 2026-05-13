import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Label, ListBox, ListBoxItem, Popover, Select, SelectValue, TextField } from "react-aria-components";
import { AiAssistantPanel } from "./components/AiAssistantPanel";
import { CandidatePanel } from "./components/CandidatePanel";
import { FilterMultiSelect } from "./components/FilterMultiSelect";
import { OverviewPanel } from "./components/OverviewPanel";
import { PhotoCard } from "./components/PhotoCard";
import { PhotoPreview } from "./components/PhotoPreview";
import { SheetDialog } from "./components/SheetDialog";
import { encodeFinderState, stateFromUrl, useFinderData, useInitialFinderState } from "./data";
import { createEmptyFilters, type FinderFilterKey, type PhotoRecord } from "./domain";
import {
  activePrimaryFilterDefinitions,
  allFilterDefinitions,
  filterOptionsForDefinition,
  labelFor,
  updateFilter,
  type FilterDefinition,
} from "./filters";
import { discoverHistorySize, discoverWindowSize, filterAndSortPhotos, pageSize, taskModes } from "./finderCore";
import { currentAnalyticsSurface, trackReactEvent } from "./analytics";
import "./styles.css";

type SheetName = "task" | "filter" | "candidate" | "preview" | null;
type ActiveFilterEntry = {
  key: string;
  label: string;
  value: string;
  text: string;
  definition: FilterDefinition;
};

export function App() {
  const initialFinderState = useInitialFinderState();
  const finderData = useFinderData();
  const hydratedUrlAfterRegistry = useRef(false);
  const [finderState, setFinderState] = useState(initialFinderState);
  const [activeSheet, setActiveSheet] = useState<SheetName>(null);
  const [previewPhoto, setPreviewPhoto] = useState<PhotoRecord | null>(null);
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const deferredSearch = useDeferredValue(finderState.search);
  const selectedTask = useMemo(
    () => taskModes.find((task) => task.id === finderState.taskMode) ?? taskModes[0],
    [finderState.taskMode, finderData.status],
  );
  const loadedSummary = finderData.status === "ready" ? `${finderData.data.photos.length} 張照片 / ${finderData.data.albums.length} 個相簿` : "";
  const primaryFilters = useMemo(() => activePrimaryFilterDefinitions(selectedTask), [selectedTask, finderData.status]);
  const fullFilters = useMemo(() => allFilterDefinitions(), [finderData.status]);
  const activeFilterEntries = useMemo<ActiveFilterEntry[]>(() => {
    if (finderData.status !== "ready") return [];
    return fullFilters.flatMap((definition) => {
      const filterParam = (definition.filterParam ?? definition.key) as FinderFilterKey;
      return (finderState.filters[filterParam] ?? []).map((value) => ({
        key: definition.key,
        label: definition.label,
        value,
        text: labelFor(finderData.data, definition.field ?? definition.key, value),
        definition,
      }));
    });
  }, [finderData, finderState.filters, fullFilters]);
  const results = useMemo(() => {
    if (finderData.status !== "ready") {
      return [] as PhotoRecord[];
    }
    const filterAndSort = filterAndSortPhotos as (
      photos: PhotoRecord[],
      options: {
        filters: Record<string, unknown>;
        sortMode: string;
        task: unknown;
        discoverHistorySize: number;
        discoverWindowSize: number;
        selectedPhotoIds: string[];
      },
    ) => PhotoRecord[];
    return filterAndSort(finderData.data.photos, {
      filters: { ...finderState.filters, search: deferredSearch },
      sortMode: finderState.sort,
      task: selectedTask,
      discoverHistorySize,
      discoverWindowSize,
      selectedPhotoIds: finderState.selectedPhotoIds,
    }) as PhotoRecord[];
  }, [deferredSearch, finderData, finderState.filters, finderState.selectedPhotoIds, finderState.sort, selectedTask]);
  const visibleResults = results.slice(0, visibleCount);
  const hasMoreResults = visibleCount < results.length;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!hydratedUrlAfterRegistry.current) {
      return;
    }
    const url = new URL(window.location.href);
    url.search = encodeFinderState(finderState).toString();
    window.history.replaceState(null, "", url);
  }, [finderState]);

  useEffect(() => {
    if (finderData.status !== "ready" || hydratedUrlAfterRegistry.current || typeof window === "undefined") {
      return;
    }
    hydratedUrlAfterRegistry.current = true;
    setFinderState(stateFromUrl(new URLSearchParams(window.location.search)));
  }, [finderData.status]);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [deferredSearch, finderState.filters, finderState.sort, finderState.taskMode]);

  function toggleCandidate(photoId: string) {
    setFinderState((current) => {
      const selected = new Set(current.selectedPhotoIds);
      if (selected.has(photoId)) {
        selected.delete(photoId);
        trackReactEvent("finder_candidate_remove", { candidate_count: selected.size, surface: currentAnalyticsSurface() });
      } else {
        selected.add(photoId);
        trackReactEvent("finder_candidate_add", { candidate_count: selected.size, surface: currentAnalyticsSurface() });
      }
      return { ...current, selectedPhotoIds: [...selected] };
    });
  }

  function openPreview(photo: PhotoRecord) {
    setPreviewPhoto(photo);
    if (window.matchMedia("(max-width: 760px)").matches) {
      setActiveSheet("preview");
    }
    trackReactEvent("finder_photo_preview", {
      task_mode: finderState.taskMode,
      sort_mode: finderState.sort,
      curation_status: photo.curation_status,
      public_use_status: photo.public_use_status,
      surface: currentAnalyticsSurface(),
    });
  }

  function clearFilters() {
    setFinderState((current) => ({
      ...current,
      filters: createEmptyFilters(),
      search: "",
      sort: "recommended",
    }));
  }

  function removeActiveFilter(entry: ActiveFilterEntry) {
    setFinderState((current) => ({
      ...current,
      filters: updateFilter(
        current.filters,
        entry.definition,
        (current.filters[(entry.definition.filterParam ?? entry.definition.key) as FinderFilterKey] ?? []).filter(
          (value) => value !== entry.value,
        ),
      ),
    }));
  }

  function renderFilterControls(definitions: FilterDefinition[], options: { inline?: boolean } = {}) {
    if (finderData.status !== "ready") {
      return null;
    }
    return definitions.map((definition) => {
      const filterParam = (definition.filterParam ?? definition.key) as FinderFilterKey;
      return (
        <FilterMultiSelect
          key={definition.key}
          label={definition.label}
          options={filterOptionsForDefinition(finderData.data, definition)}
          selectedValues={finderState.filters[filterParam] ?? []}
          onChange={(values) =>
            setFinderState((current) => ({
              ...current,
              filters: updateFilter(current.filters, definition, values),
            }))
          }
          inline={options.inline}
        />
      );
    });
  }

  const advancedFilters = fullFilters.filter((definition) => !primaryFilters.some((primary) => primary.key === definition.key));

  return (
    <main className="finder-shell">
      <header className="finder-header">
        <div>
          <p className="eyebrow">SITCON photo finder</p>
          <h1>SITCON Flickr Photo Finder</h1>
          <p>從工作任務出發，在公開 Flickr 照片索引中建立可討論的候選清單。</p>
        </div>
        <p className="core-status">
          {finderData.status === "ready"
            ? `${loadedSummary}，${taskModes.length} 種任務`
            : "載入照片索引中"}
        </p>
      </header>

      <section className="task-strip" aria-label="任務模式">
        {taskModes.map((task) => (
          <Button
            key={task.id}
            className={task.id === finderState.taskMode ? "task-button is-active" : "task-button"}
            type="button"
            onPress={() => {
              setFinderState((current) => ({ ...current, taskMode: task.id }));
              trackReactEvent("finder_task_select", { task_mode: task.id, surface: currentAnalyticsSurface() });
            }}
          >
            <strong>{task.label}</strong>
            <span>{task.description}</span>
          </Button>
        ))}
      </section>
      <Button className="mobile-task-button" type="button" onPress={() => setActiveSheet("task")}>
        找圖任務：{selectedTask?.label ?? "全部照片"}
      </Button>

      <section className="finder-toolbar mobile-toolbar" aria-label="手機搜尋與快捷操作">
        <TextField
          className="search-field"
          value={finderState.search}
          onChange={(search) => setFinderState((current) => ({ ...current, search }))}
        >
          <Label>搜尋</Label>
          <Input placeholder="可放字、品牌露出、友善交流、舞台講者" />
        </TextField>
        <Button type="button" onPress={() => setActiveSheet("filter")}>
          篩選
        </Button>
        <Button type="button" onPress={() => setActiveSheet("candidate")}>
          候選 {finderState.selectedPhotoIds.length}
        </Button>
      </section>

      <section className="desktop-control-panel" aria-label="桌面搜尋與篩選工作區">
        <div className="control-row">
          <TextField
            className="search-field"
            value={finderState.search}
            onChange={(search) => setFinderState((current) => ({ ...current, search }))}
          >
            <Label>搜尋照片內容</Label>
            <Input placeholder="可放字、品牌露出、友善交流、舞台講者" />
          </TextField>
          <Select
            className="sort-select"
            selectedKey={finderState.sort}
            onSelectionChange={(key) => setFinderState((current) => ({ ...current, sort: String(key) as typeof current.sort }))}
          >
            <Label>排序</Label>
            <Button>
              <SelectValue />
            </Button>
            <Popover className="filter-popover">
              <ListBox>
                <ListBoxItem id="recommended">推薦排序</ListBoxItem>
                <ListBoxItem id="discover">探索更多</ListBoxItem>
                <ListBoxItem id="newest">年份新到舊</ListBoxItem>
                <ListBoxItem id="oldest">年份舊到新</ListBoxItem>
                <ListBoxItem id="people-desc">人數多到少</ListBoxItem>
                <ListBoxItem id="people-asc">人數少到多</ListBoxItem>
              </ListBox>
            </Popover>
          </Select>
          <Button className="secondary-button" type="button" onPress={clearFilters}>
            清除條件
          </Button>
        </div>
        <div className="desktop-filter-section">
          <div className="section-heading compact">
            <h2>任務重點條件</h2>
            <p>依目前任務提升最常用篩選，不會替你隱藏其他照片。</p>
          </div>
          <div className="filter-grid desktop-primary-filters" aria-label="任務重點篩選">
            {renderFilterControls(primaryFilters)}
          </div>
        </div>
        <details className="desktop-advanced-filters">
          <summary>進階條件</summary>
          <div className="filter-grid desktop-advanced-grid" aria-label="進階篩選">
            {renderFilterControls(advancedFilters)}
          </div>
        </details>
      </section>

      <div className="finder-workbench">
        <section className="result-surface" aria-label="搜尋結果">
          <div className="result-heading">
            <div>
              <p>目前任務：{selectedTask?.label ?? "全部照片"}</p>
              <h2>{results.length} 張符合條件</h2>
              <p>
                搜尋：<strong>{finderState.search || "未輸入"}</strong>
              </p>
            </div>
            {finderState.selectedPhotoIds.length > 0 ? (
              <Button className="desktop-candidate-shortcut" type="button" onPress={() => setActiveSheet("candidate")}>
                候選 {finderState.selectedPhotoIds.length}
              </Button>
            ) : null}
          </div>
          {finderData.status === "error" ? <p className="load-error">{finderData.message}</p> : null}
          {finderData.status === "ready" ? <p>目前顯示 {visibleResults.length} / {results.length} 張</p> : null}
          {activeFilterEntries.length > 0 ? (
            <div className="active-filters" aria-label="已套用篩選">
              {activeFilterEntries.map((entry) => (
                <Button
                  key={`${entry.key}:${entry.value}`}
                  type="button"
                  onPress={() => removeActiveFilter(entry)}
                >
                  {entry.label}: {entry.text} x
                </Button>
              ))}
            </div>
          ) : null}
          <div className="photo-grid">
            {finderData.status === "ready"
              ? visibleResults.map((photo) => (
                  <PhotoCard
                    key={photo.photo_id}
                    data={finderData.data}
                    photo={photo}
                    task={selectedTask}
                    selected={finderState.selectedPhotoIds.includes(photo.photo_id)}
                    onPreview={openPreview}
                    onToggleCandidate={toggleCandidate}
                  />
                ))
              : null}
          </div>
          {hasMoreResults ? (
            <Button className="load-more-button" type="button" onPress={() => setVisibleCount((current) => current + pageSize)}>
              載入更多
            </Button>
          ) : null}
        </section>
        {finderData.status === "ready" ? (
          <aside className="desktop-side-panel">
            <section className="desktop-detail-panel" aria-label="照片詳情">
              <div className="panel-heading">
                <div>
                  <h2>照片 Inspector</h2>
                  <p>{previewPhoto ? "檢查構圖、來源與使用提醒" : "點選照片查看完整資訊"}</p>
                </div>
              </div>
              {previewPhoto ? (
                <PhotoPreview
                  data={finderData.data}
                  photo={previewPhoto}
                  selected={finderState.selectedPhotoIds.includes(previewPhoto.photo_id)}
                  onToggleCandidate={toggleCandidate}
                />
              ) : (
                <p className="empty-panel">尚未選取照片。桌面版會在這裡保留 detail，不打斷目前結果瀏覽。</p>
              )}
            </section>
            <CandidatePanel
              data={finderData.data}
              selectedPhotoIds={finderState.selectedPhotoIds}
              onPreview={openPreview}
              onRemove={toggleCandidate}
              surface="desktop"
            />
            <OverviewPanel data={finderData.data} />
            <AiAssistantPanel data={finderData.data} filters={finderState.filters} search={finderState.search} task={selectedTask} surface="desktop" />
          </aside>
        ) : null}
      </div>

      <div className="mobile-action-bar">
        <Button type="button" onPress={() => setActiveSheet("filter")}>
          篩選
        </Button>
        <Button type="button" onPress={() => setActiveSheet("candidate")}>
          候選 {finderState.selectedPhotoIds.length}
        </Button>
      </div>

      <SheetDialog
        isOpen={activeSheet !== null}
        title={
          activeSheet === "task"
            ? "任務模式"
            : activeSheet === "filter"
              ? "篩選"
              : activeSheet === "candidate"
                ? `候選 ${finderState.selectedPhotoIds.length}`
                : "照片詳情"
        }
        onOpenChange={(open) => setActiveSheet(open ? activeSheet : null)}
      >
        {activeSheet === "task" ? (
          <div className="sheet-task-list">
            {taskModes.map((task) => (
              <Button
                key={task.id}
                className={task.id === finderState.taskMode ? "task-button is-active" : "task-button"}
                type="button"
                onPress={() => {
                  setFinderState((current) => ({ ...current, taskMode: task.id }));
                  trackReactEvent("finder_task_select", { task_mode: task.id, surface: "mobile" });
                  setActiveSheet(null);
                }}
              >
                <strong>{task.label}</strong>
                <span>{task.description}</span>
              </Button>
            ))}
          </div>
        ) : null}
        {activeSheet === "filter" && finderData.status === "ready" ? (
          <div className="sheet-filter-grid">
            {renderFilterControls(fullFilters, { inline: true })}
          </div>
        ) : null}
        {activeSheet === "preview" && previewPhoto && finderData.status === "ready" ? (
          <PhotoPreview
            data={finderData.data}
            photo={previewPhoto}
            selected={finderState.selectedPhotoIds.includes(previewPhoto.photo_id)}
            onToggleCandidate={toggleCandidate}
          />
        ) : null}
        {activeSheet === "candidate" && finderData.status === "ready" ? (
          <CandidatePanel
            data={finderData.data}
            selectedPhotoIds={finderState.selectedPhotoIds}
            onPreview={openPreview}
            onRemove={toggleCandidate}
            surface="mobile"
          />
        ) : null}
      </SheetDialog>
    </main>
  );
}
