import { useMemo, useState } from "react";
import { Button, Input, Label, TextField } from "react-aria-components";
import { FilterMultiSelect, type FilterOption } from "./components/FilterMultiSelect";
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
  const [activeTaskMode, setActiveTaskMode] = useState(taskModes[0]?.id ?? "all");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeSheet, setActiveSheet] = useState<SheetName>(null);
  const [sampleFilters, setSampleFilters] = useState<string[]>([]);
  const selectedTask = useMemo(
    () => taskModes.find((task) => task.id === activeTaskMode) ?? taskModes[0],
    [activeTaskMode],
  );

  return (
    <main className="finder-shell">
      <header className="finder-header">
        <div>
          <p className="eyebrow">Pages frontend migration</p>
          <h1>SITCON Flickr Photo Finder</h1>
        </div>
        <p className="core-status">
          Shared finder core: {taskModes.length} task modes, page size {pageSize}.
        </p>
      </header>

      <section className="task-strip" aria-label="任務模式">
        {taskModes.map((task) => (
          <Button
            key={task.id}
            className={task.id === activeTaskMode ? "task-button is-active" : "task-button"}
            type="button"
            onPress={() => setActiveTaskMode(task.id)}
          >
            <strong>{task.label}</strong>
            <span>{task.description}</span>
          </Button>
        ))}
      </section>

      <section className="finder-toolbar" aria-label="搜尋與篩選">
        <TextField className="search-field" value={searchTerm} onChange={setSearchTerm}>
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
          Search value: <strong>{searchTerm || "未輸入"}</strong>
        </p>
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

      {activeSheet ? (
        <section className="sheet-preview" role="dialog" aria-modal="true" aria-label="遷移中面板">
          <div className="sheet-header">
            <strong>{activeSheet}</strong>
            <Button type="button" onPress={() => setActiveSheet(null)}>
              關閉
            </Button>
          </div>
          <p>React Aria modal primitives will replace this temporary shell in the next slices.</p>
        </section>
      ) : null}
    </main>
  );
}
