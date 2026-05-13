export type SortMode = "recommended" | "discover" | "newest" | "oldest" | "people-desc" | "people-asc";

export type FinderFilterKey =
  | "album"
  | "recommendedUse"
  | "mood"
  | "scene"
  | "peopleCount"
  | "subjectType"
  | "orientation"
  | "negativeSpace"
  | "safeCrop"
  | "sponsorshipTag"
  | "sponsorshipItem"
  | "publicStatus"
  | "priority"
  | "curationStatus"
  | "collection";

export type FinderFilters = Record<FinderFilterKey, string[]>;

export type PhotoRecord = {
  photo_id: string;
  photo_url: string;
  album_ids: string[];
  image_preview_url: string;
  album_title: string;
  event_name: string;
  event_year: string;
  people_count: string;
  subject_type: string;
  photographer: string;
  license: string;
  scene_tags: string[];
  mood_tags: string[];
  recommended_uses: string[];
  sponsorship_items: string[];
  sponsorship_tags: string[];
  orientation: string;
  has_negative_space: string;
  safe_crop: string[];
  visual_description: string;
  public_use_status: string;
  priority_level: string;
  collections: string[];
  curation_notes: string;
  curation_status: string;
  search_text: string;
  _sheet_row_number?: number;
  [key: string]: unknown;
};

export type AlbumRecord = {
  album_id?: string;
  album_title?: string;
  event_name?: string;
  event_year?: string;
  [key: string]: unknown;
};

export type TaskMode = {
  id: string;
  label: string;
  description: string;
  recommendedUses?: string[];
  moods?: string[];
  scenes?: string[];
  sponsorshipTags?: string[];
  orientations?: string[];
  safeCrops?: string[];
  prefersNegativeSpace?: boolean;
  primaryFilters?: string[];
};

export type FinderData = {
  albums: AlbumRecord[];
  photos: PhotoRecord[];
  projectConfig: Record<string, unknown>;
  interfaceRegistry: Record<string, unknown>;
  photoSchema: Record<string, unknown>;
  taxonomy: {
    option_labels?: Record<string, Record<string, string>>;
    [key: string]: unknown;
  };
  optionLabelMaps: Map<string, Map<string, string>>;
};

export type FinderState = {
  taskMode: string;
  search: string;
  sort: SortMode;
  filters: FinderFilters;
  selectedPhotoIds: string[];
};

export type FinderLoadState =
  | { status: "loading" }
  | { status: "ready"; data: FinderData }
  | { status: "error"; message: string };

export const filterKeys: FinderFilterKey[] = [
  "album",
  "recommendedUse",
  "mood",
  "scene",
  "peopleCount",
  "subjectType",
  "orientation",
  "negativeSpace",
  "safeCrop",
  "sponsorshipTag",
  "sponsorshipItem",
  "publicStatus",
  "priority",
  "curationStatus",
  "collection",
];

export function createEmptyFilters(): FinderFilters {
  return filterKeys.reduce((filters, key) => {
    filters[key] = [];
    return filters;
  }, {} as FinderFilters);
}

export function createInitialFinderState(): FinderState {
  return {
    taskMode: "all",
    search: "",
    sort: "recommended",
    filters: createEmptyFilters(),
    selectedPhotoIds: [],
  };
}

export function normalizeFilterValues(values: unknown): string[] {
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

export function normalizeFilters(input: Partial<Record<FinderFilterKey, unknown>> = {}): FinderFilters {
  return filterKeys.reduce((filters, key) => {
    filters[key] = normalizeFilterValues(input[key]);
    return filters;
  }, {} as FinderFilters);
}
