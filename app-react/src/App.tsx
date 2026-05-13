import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Button, Input, Label, ListBox, ListBoxItem, Popover, Select, SelectValue, TextField } from "react-aria-components";
import { AiAssistantPanel } from "./components/AiAssistantPanel";
import { CandidatePanel } from "./components/CandidatePanel";
import { FilterMultiSelect } from "./components/FilterMultiSelect";
import { OverviewPanel } from "./components/OverviewPanel";
import { PhotoCard } from "./components/PhotoCard";
import { PhotoPreview } from "./components/PhotoPreview";
import { SheetDialog } from "./components/SheetDialog";
import { encodeFinderState, useFinderData, useInitialFinderState } from "./data";
import type { FinderFilterKey, PhotoRecord } from "./domain";
import { activePrimaryFilterDefinitions, allFilterDefinitions, filterOptionsForDefinition, updateFilter } from "./filters";
import { discoverHistorySize, discoverWindowSize, filterAndSortPhotos, pageSize, taskModes } from "./finderCore";
import "./styles.css";

type SheetName = "task" | "filter" | "candidate" | "preview" | null;

export function App() {
  const initialFinderState = useInitialFinderState();
  const finderData = useFinderData();
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
    const url = new URL(window.location.href);
    url.search = encodeFinderState(finderState).toString();
    window.history.replaceState(null, "", url);
  }, [finderState]);

  useEffect(() => {
    setVisibleCount(pageSize);
  }, [deferredSearch, finderState.filters, finderState.sort, finderState.taskMode]);

  function toggleCandidate(photoId: string) {
    setFinderState((current) => {
      const selected = new Set(current.selectedPhotoIds);
      if (selected.has(photoId)) {
        selected.delete(photoId);
      } else {
        selected.add(photoId);
      }
      return { ...current, selectedPhotoIds: [...selected] };
    });
  }

  function openPreview(photo: PhotoRecord) {
    setPreviewPhoto(photo);
    setActiveSheet("preview");
  }

  return (
    <main className="finder-shell">
      <header className="finder-header">
        <div>
          <p className="eyebrow">Pages frontend migration</p>
          <h1>SITCON Flickr Photo Finder</h1>
        </div>
        <p className="core-status">
          {finderData.status === "ready"
            ? `${loadedSummary}，${taskModes.length} 種任務，page size ${pageSize}`
            : "載入照片索引中"}
        </p>
      </header>

      <section className="task-strip" aria-label="任務模式">
        {taskModes.map((task) => (
          <Button
            key={task.id}
            className={task.id === finderState.taskMode ? "task-button is-active" : "task-button"}
            type="button"
            onPress={() => setFinderState((current) => ({ ...current, taskMode: task.id }))}
          >
            <strong>{task.label}</strong>
            <span>{task.description}</span>
          </Button>
        ))}
      </section>
      <Button className="mobile-task-button" type="button" onPress={() => setActiveSheet("task")}>
        任務：{selectedTask?.label ?? "全部照片"}
      </Button>

      <section className="finder-toolbar" aria-label="搜尋與篩選">
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
      <section className="filter-grid" aria-label="主要篩選">
        {finderData.status === "ready"
          ? primaryFilters.map((definition) => {
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
                />
              );
            })
          : null}
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
      </section>

      <div className="finder-workbench">
        <section className="result-surface" aria-label="搜尋結果">
          <p>{selectedTask?.label ?? "全部照片"}排序情境</p>
          <h2>{results.length} 張符合條件</h2>
          <p>
            Search value: <strong>{finderState.search || "未輸入"}</strong>
          </p>
          {finderData.status === "error" ? <p className="load-error">{finderData.message}</p> : null}
          {finderData.status === "ready" ? <p>目前顯示 {visibleResults.length} / {results.length} 張</p> : null}
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
            <CandidatePanel
              data={finderData.data}
              selectedPhotoIds={finderState.selectedPhotoIds}
              onPreview={openPreview}
              onRemove={toggleCandidate}
            />
            <OverviewPanel data={finderData.data} />
            <AiAssistantPanel data={finderData.data} filters={finderState.filters} search={finderState.search} task={selectedTask} />
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
            {fullFilters.map((definition) => {
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
                />
              );
            })}
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
          />
        ) : null}
      </SheetDialog>
    </main>
  );
}
