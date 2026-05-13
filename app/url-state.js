// URL query serialization for the Pages finder. Keep this independent from DOM
// controls so deep-link behavior stays reviewable and testable.
let filterUrlKeys = {
  album: "album",
  use: "use",
  mood: "mood",
  scene: "scene",
  peopleCount: "people",
  subjectType: "subject",
  orientation: "orientation",
  negativeSpace: "negative",
  safeCrop: "crop",
  sponsorshipTag: "sponsorTag",
  sponsorshipItem: "sponsorItem",
  publicStatus: "public",
  priority: "priority",
  curationStatus: "curation",
  collection: "collection",
};

export function applyUrlStateRegistry(interfaceRegistry) {
  const filters = interfaceRegistry?.pages?.filters ?? [];
  if (filters.length > 0) {
    filterUrlKeys = Object.fromEntries(filters.map((filter) => [filter.key, filter.urlKey]));
  }
}

function cleanValues(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [values])
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

function appendValues(params, key, values) {
  for (const value of cleanValues(values)) {
    params.append(key, value);
  }
}

export function encodeUrlState(state) {
  const params = new URLSearchParams();

  if (state.taskMode && state.taskMode !== "all") {
    params.set("task", state.taskMode);
  }
  const search = String(state.search ?? "").trim();
  if (search) {
    params.set("q", search);
  }
  if (state.sort && state.sort !== "recommended") {
    params.set("sort", state.sort);
  }

  for (const [filterKey, urlKey] of Object.entries(filterUrlKeys)) {
    appendValues(params, urlKey, state.filters?.[filterKey] ?? []);
  }

  const selected = [...(state.selectedPhotoIds ?? [])].map((value) => String(value ?? "").trim()).filter(Boolean);
  if (selected.length > 0) {
    params.set("selected", selected.join(","));
  }
  return params;
}

export function decodeUrlState(params) {
  const filters = {};
  for (const [filterKey, urlKey] of Object.entries(filterUrlKeys)) {
    filters[filterKey] = cleanValues(params.getAll(urlKey));
  }

  return {
    taskMode: params.get("task") ?? "",
    search: params.get("q") ?? "",
    sort: params.get("sort") ?? "",
    filters,
    selectedPhotoIds: (params.get("selected") ?? "").split(",").filter(Boolean),
  };
}
