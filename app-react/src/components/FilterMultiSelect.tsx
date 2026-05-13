import { useMemo, useState } from "react";
import { Button, Dialog, Input, Label, Popover, TextField } from "react-aria-components";

export type FilterOption = {
  label: string;
  value: string;
};

type FilterMultiSelectProps = {
  label: string;
  options: FilterOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  inline?: boolean;
};

export function FilterMultiSelect({
  label,
  options,
  selectedValues,
  onChange,
  inline = false,
}: FilterMultiSelectProps) {
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(selectedValues), [selectedValues]);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => {
      return (
        option.label.toLowerCase().includes(normalizedQuery) ||
        option.value.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [options, query]);
  const summary = selectedValues.length === 0 ? `全部${label}` : `已選 ${selectedValues.length} 個`;

  function toggleValue(value: string) {
    const next = new Set(selected);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange([...next]);
  }

  const optionsList = (
    <>
      <TextField className="filter-search" value={query} onChange={setQuery}>
        <Label>搜尋{label}</Label>
        <Input placeholder="輸入關鍵字" />
      </TextField>
      <div className="filter-options">
        {filteredOptions.length === 0 ? <p className="filter-empty">沒有符合的選項</p> : null}
        {filteredOptions.map((option) => {
          const isSelected = selected.has(option.value);
          return (
            <Button
              key={option.value}
              className={isSelected ? "filter-option is-selected" : "filter-option"}
              type="button"
              onPress={() => toggleValue(option.value)}
            >
              <span>{option.label}</span>
              <span aria-hidden="true">{isSelected ? "已選" : ""}</span>
            </Button>
          );
        })}
      </div>
    </>
  );

  if (inline) {
    return (
      <section className="filter-multi-select filter-multi-select-inline" aria-label={`${label}選單`}>
        <div className="inline-filter-heading">
          <span className="filter-label">{label}</span>
          <span>{summary}</span>
        </div>
        {optionsList}
      </section>
    );
  }

  return (
    <div className="filter-multi-select">
      <span className="filter-label">{label}</span>
      <Button className="filter-trigger" type="button">
        {summary}
      </Button>
      <Popover className="filter-popover" containerPadding={12} offset={6} placement="bottom start" shouldFlip>
        <Dialog className="filter-dialog" aria-label={`${label}選單`}>
          {optionsList}
        </Dialog>
      </Popover>
    </div>
  );
}
