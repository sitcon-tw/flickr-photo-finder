type AnalyticsParamValue = string | number | boolean | null | undefined;
type AnalyticsParams = Record<string, AnalyticsParamValue>;
type ResultsSnapshot = Record<string, AnalyticsParamValue | AnalyticsParamValue[]> & {
  taskMode: string;
  sortMode: string;
  searchTerm?: string;
  resultCount: number;
  useCount?: number;
  publicStatusCount?: number;
  priorityCount?: number;
  curationStatusCount?: number;
  albumCount?: number;
  sponsorshipItemCount?: number;
  sponsorshipTagCount?: number;
  collectionCount?: number;
  moodCount?: number;
  sceneCount?: number;
  peopleCountCount?: number;
  subjectTypeCount?: number;
  orientationCount?: number;
  safeCropCount?: number;
};

/*! Generated app/analytics-core.js from app-core/analytics-core.ts; edit the TypeScript source. */
export function cleanParams(params: AnalyticsParams) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  );
}

export function normalizeMeasurementId(value: unknown) {
  const measurementId = String(value ?? "").trim();
  return /^G-[A-Z0-9]+$/.test(measurementId) ? measurementId : "";
}

export function resultCountBucket(count: number) {
  if (count === 0) {
    return "0";
  }
  if (count <= 5) {
    return "1_5";
  }
  if (count <= 20) {
    return "6_20";
  }
  return "21_plus";
}

export function sanitizeSearchTerm(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

function hasValue(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

export function hasActiveFilters(snapshot: ResultsSnapshot) {
  return Boolean(
    snapshot.taskMode !== "all" ||
      hasValue(snapshot.recommendedUse) ||
      hasValue(snapshot.mood) ||
      hasValue(snapshot.album) ||
      hasValue(snapshot.scene) ||
      hasValue(snapshot.peopleCount) ||
      hasValue(snapshot.subjectType) ||
      hasValue(snapshot.orientation) ||
      hasValue(snapshot.negativeSpace) ||
      hasValue(snapshot.safeCrop) ||
      hasValue(snapshot.sponsorshipTag) ||
      Number(snapshot.sponsorshipItemCount) > 0 ||
      hasValue(snapshot.publicUseStatus) ||
      hasValue(snapshot.priorityLevel) ||
      hasValue(snapshot.curationStatus) ||
      hasValue(snapshot.collection),
  );
}

export function hasTrackedResultState(snapshot: ResultsSnapshot) {
  return hasActiveFilters(snapshot) || Boolean(snapshot.searchTerm) || snapshot.sortMode !== "recommended";
}

export function resultsEventParams(snapshot: ResultsSnapshot) {
  return {
    result_count: snapshot.resultCount,
    result_count_bucket: resultCountBucket(snapshot.resultCount),
    search_surface: "main",
    task_mode: snapshot.taskMode,
    sort_mode: snapshot.sortMode,
    filter_count: Object.entries(snapshot)
      .filter(([key]) => key.endsWith("Count"))
      .reduce((total, [, value]) => total + Number(value || 0), 0),
    recommended_use_count: snapshot.useCount,
    public_use_status_count: snapshot.publicStatusCount,
    priority_level_count: snapshot.priorityCount,
    curation_status_count: snapshot.curationStatusCount,
    album_filter_used: Number(snapshot.albumCount) > 0,
    sponsorship_filter_used: Number(snapshot.sponsorshipItemCount) > 0 || Number(snapshot.sponsorshipTagCount) > 0,
    collection_filter_used: Number(snapshot.collectionCount) > 0,
  };
}
