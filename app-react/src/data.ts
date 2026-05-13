import { useEffect, useMemo, useState } from "react";
import {
  applySearchRegistry,
  applyTaskModeRegistry,
  applyUrlStateRegistry,
  dataSources,
  decodeUrlState,
  encodeUrlState,
  loadFinderData,
  projectConfigUrl,
} from "./finderCore";
import {
  createInitialFinderState,
  normalizeFilters,
  normalizeFilterValues,
  type FinderData,
  type FinderLoadState,
  type FinderState,
  type SortMode,
} from "./domain";

const sortModes = new Set<SortMode>(["recommended", "discover", "newest", "oldest", "people-desc", "people-asc"]);

function normalizeSortMode(value: unknown): SortMode {
  const sortMode = String(value ?? "");
  return sortModes.has(sortMode as SortMode) ? (sortMode as SortMode) : "recommended";
}

function normalizeTaskMode(value: unknown): string {
  return String(value ?? "").trim() || "all";
}

function normalizeSearch(value: unknown): string {
  return String(value ?? "").trim();
}

export function stateFromUrl(params: URLSearchParams): FinderState {
  const decoded = decodeUrlState(params) as {
    taskMode?: unknown;
    search?: unknown;
    sort?: unknown;
    filters?: Record<string, unknown>;
    selectedPhotoIds?: unknown;
  };
  return {
    ...createInitialFinderState(),
    taskMode: normalizeTaskMode(decoded.taskMode),
    search: normalizeSearch(decoded.search),
    sort: normalizeSortMode(decoded.sort),
    filters: normalizeFilters(decoded.filters),
    selectedPhotoIds: normalizeFilterValues(decoded.selectedPhotoIds),
  };
}

export function encodeFinderState(state: FinderState): URLSearchParams {
  return encodeUrlState(state);
}

export function useInitialFinderState(): FinderState {
  return useMemo(() => {
    if (typeof window === "undefined") {
      return createInitialFinderState();
    }
    return stateFromUrl(new URLSearchParams(window.location.search));
  }, []);
}

export function useFinderData(): FinderLoadState {
  const [loadState, setLoadState] = useState<FinderLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const loaded = (await loadFinderData({ dataSources, projectConfigUrl })) as FinderData;
        applyTaskModeRegistry(loaded.interfaceRegistry);
        applyUrlStateRegistry(loaded.interfaceRegistry);
        applySearchRegistry(loaded.interfaceRegistry);
        if (!cancelled) {
          setLoadState({ status: "ready", data: loaded });
        }
      } catch (error) {
        if (!cancelled) {
          setLoadState({
            status: "error",
            message: error instanceof Error ? error.message : "資料載入失敗",
          });
        }
      }
    }

    void loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  return loadState;
}
