import type { FilterOption } from "./components/FilterMultiSelect";
import type { FinderData, FinderFilterKey, FinderFilters, PhotoRecord, TaskMode } from "./domain";
import { albumFilterOptions, filterDefinitions, peopleCountFilters } from "./finderCore";

type FilterSource = {
  type?: string;
  key?: string;
  labels?: boolean;
};

export type FilterDefinition = {
  key: string;
  label: string;
  field?: string;
  filterParam?: FinderFilterKey;
  group?: string;
  lowLevel?: boolean;
  source?: FilterSource;
};

function asStrings(values: unknown): string[] {
  return (Array.isArray(values) ? values : [values])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function uniqueSorted(values: unknown[]): string[] {
  return [...new Set(values.flatMap((value) => asStrings(value)))].sort((left, right) => left.localeCompare(right, "zh-Hant-TW"));
}

export function labelFor(data: FinderData, fieldName: string, value: unknown): string {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "";
  }
  return data.optionLabelMaps.get(fieldName)?.get(rawValue) ?? rawValue;
}

function taxonomyValues(data: FinderData, key: string): string[] {
  return asStrings(data.taxonomy[key]);
}

function optionsFromValues(data: FinderData, definition: FilterDefinition, values: unknown[]): FilterOption[] {
  const fieldName = definition.field ?? definition.source?.key ?? definition.key;
  return asStrings(values).map((value) => ({
    value,
    label: definition.source?.labels ? labelFor(data, fieldName, value) : value,
  }));
}

export function filterOptionsForDefinition(data: FinderData, definition: FilterDefinition): FilterOption[] {
  const source = definition.source ?? {};
  if (source.type === "album") {
    return albumFilterOptions(data.photos, data.albums);
  }
  if (source.type === "people_count_buckets") {
    return peopleCountFilters.map(({ label, value }: { label: string; value: string }) => ({ label, value })).filter((option) => option.value);
  }
  if (source.type === "boolean") {
    return ["true", "false"].map((value) => ({
      value,
      label: source.labels ? labelFor(data, definition.field ?? definition.key, value) : value,
    }));
  }
  if (source.type === "photo_values" && definition.field) {
    return optionsFromValues(
      data,
      definition,
      uniqueSorted(data.photos.flatMap((photo) => asStrings(photo[definition.field as keyof PhotoRecord]))),
    );
  }
  if (source.key) {
    return optionsFromValues(data, definition, taxonomyValues(data, source.key));
  }
  return [];
}

export function activePrimaryFilterDefinitions(task: TaskMode | undefined): FilterDefinition[] {
  const definitions = filterDefinitions as FilterDefinition[];
  const primaryKeys = new Set(task?.primaryFilters ?? []);
  const fallbackPrimaryKeys = new Set(["use", "scene", "orientation", "safeCrop", "negativeSpace", "mood"]);
  const activeKeys = primaryKeys.size > 0 ? primaryKeys : fallbackPrimaryKeys;
  return definitions.filter((definition) => activeKeys.has(definition.key) && !definition.lowLevel);
}

export function updateFilter(filters: FinderFilters, definition: FilterDefinition, values: string[]): FinderFilters {
  const filterParam = definition.filterParam ?? (definition.key as FinderFilterKey);
  return {
    ...filters,
    [filterParam]: values,
  };
}
