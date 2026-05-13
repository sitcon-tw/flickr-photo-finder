import { useEffect, useMemo, useState } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { FilterMultiSelect, type FilterOption } from "./components/FilterMultiSelect";
import { SheetDialog } from "./components/SheetDialog";
import { encodeFinderState, useFinderData, useInitialFinderState } from "./data";
import { pageSize, taskModes } from "./finderCore";
import "./styles.css";

type SheetName = "filter" | "candidate" | "preview" | null;

const sampleFilterOptions: FilterOption[] = [
  { label: "橫式", value: "landscape" },
  { label: "直式", value: "portrait" },
  { label: "方形", value: "square" },
  { label: "舞台講者", value: "stage-speaker" },
  { label: "會眾互動", value: "audience-interaction" },
  { label: "品牌露出", value: "brand-visibility" },
];

export function App() {
  const initialFinderState = useInitialFinderState();
  const finderData = useFinderData();
  const [finderState, setFinderState] = useState(initialFinderState);
  const [activeSheet, setActiveSheet] = useState<SheetName>(null);
  const [sampleFilters, setSampleFilters] = useState<string[]>([]);
  const selectedTask = useMemo(
    () => taskModes.find((task) => task.id === finderState.taskMode) ?? taskModes[0],
    [finderState.taskMode, finderData.status],
  );
  const loadedSummary = finderData.status === "ready" ? `${finderData.data.photos.length} 張照片 / ${finderData.data.albums.length} 個相簿` : "";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    url.search = encodeFinderState(finderState).toString();
    window.history.replaceState(null, "", url);
  }, [finderState]);

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
          候選 0
        </Button>
      </section>
      <section className="filter-demo" aria-label="React Aria 篩選選單">
        <FilterMultiSelect
          label="示範條件"
          options={sampleFilterOptions}
          selectedValues={sampleFilters}
          onChange={setSampleFilters}
        />
      </section>

      <section className="result-surface" aria-label="搜尋結果">
        <p>{selectedTask?.label ?? "全部照片"}排序情境</p>
        <h2>React finder shell</h2>
        <p>
          Search value: <strong>{finderState.search || "未輸入"}</strong>
        </p>
        {finderData.status === "error" ? <p className="load-error">{finderData.message}</p> : null}
        {finderData.status === "ready" ? <p>Loaded photos: {finderData.data.photos.length}</p> : null}
        <Button type="button" onPress={() => setActiveSheet("preview")}>
          開啟預覽
        </Button>
      </section>

      <div className="mobile-action-bar">
        <Button type="button" onPress={() => setActiveSheet("filter")}>
          篩選
        </Button>
        <Button type="button" onPress={() => setActiveSheet("candidate")}>
          候選 0
        </Button>
      </div>

      <SheetDialog
        isOpen={activeSheet !== null}
        title={activeSheet ? `${activeSheet} sheet` : "sheet"}
        onOpenChange={(open) => setActiveSheet(open ? activeSheet : null)}
      >
        <p>React Aria modal primitives now own this sheet shell.</p>
      </SheetDialog>
    </main>
  );
}
