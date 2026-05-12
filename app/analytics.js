// GA4 setup and event shaping for the Pages frontend. This module owns
// analytics state; callers provide snapshots instead of exposing DOM controls.
const analytics = {
  enabled: false,
  lastTrackedResultsState: "",
  pendingResultsSource: "",
  resultsTimer: 0,
};

function cleanParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  );
}

function normalizeMeasurementId(value) {
  const measurementId = String(value ?? "").trim();
  return /^G-[A-Z0-9]+$/.test(measurementId) ? measurementId : "";
}

export function setupAnalytics(config) {
  const measurementId = normalizeMeasurementId(config.frontend?.ga4MeasurementId);
  if (!measurementId) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(script);

  window.gtag("js", new Date());
  window.gtag("config", measurementId);
  analytics.enabled = true;
}

export function trackEvent(name, params = {}) {
  if (!analytics.enabled || typeof window.gtag !== "function") {
    return;
  }
  window.gtag("event", name, cleanParams(params));
}

export function resultCountBucket(count) {
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

export function sanitizeSearchTerm(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 100);
}

export function hasActiveFilters(snapshot) {
  return Boolean(
    snapshot.taskMode !== "all" ||
      snapshot.recommendedUse ||
      snapshot.mood ||
      snapshot.album ||
      snapshot.scene ||
      snapshot.peopleCount ||
      snapshot.subjectType ||
      snapshot.orientation ||
      snapshot.negativeSpace ||
      snapshot.safeCrop ||
      snapshot.sponsorshipTag ||
      snapshot.sponsorshipItem ||
      snapshot.publicUseStatus ||
      snapshot.priorityLevel ||
      snapshot.curationStatus ||
      snapshot.collection,
  );
}

export function hasTrackedResultState(snapshot) {
  return hasActiveFilters(snapshot) || Boolean(snapshot.searchTerm) || snapshot.sortMode !== "recommended";
}

export function resultsEventParams(snapshot) {
  return {
    result_count: snapshot.resultCount,
    result_count_bucket: resultCountBucket(snapshot.resultCount),
    search_surface: "main",
    task_mode: snapshot.taskMode,
    sort_mode: snapshot.sortMode,
    recommended_use: snapshot.recommendedUse,
    public_use_status: snapshot.publicUseStatus,
    priority_level: snapshot.priorityLevel,
    curation_status: snapshot.curationStatus,
    album_filter_used: Boolean(snapshot.album),
    sponsorship_filter_used: Boolean(snapshot.sponsorshipItem || snapshot.sponsorshipTag),
    collection_filter_used: Boolean(snapshot.collection),
  };
}

export function trackVisibleResults(source, snapshot) {
  const stateText = JSON.stringify({ source, ...snapshot });
  if (stateText === analytics.lastTrackedResultsState) {
    return;
  }
  analytics.lastTrackedResultsState = stateText;

  if (source === "search" && snapshot.searchTerm) {
    trackEvent("search", {
      search_term: snapshot.searchTerm,
      has_filters: hasActiveFilters(snapshot),
      ...resultsEventParams(snapshot),
    });
    return;
  }

  if (hasTrackedResultState(snapshot)) {
    trackEvent("filter_results", {
      has_search_term: Boolean(snapshot.searchTerm),
      mood_filter_used: Boolean(snapshot.mood),
      scene_filter_used: Boolean(snapshot.scene),
      people_count_filter: snapshot.peopleCount,
      subject_type: snapshot.subjectType,
      orientation_filter: snapshot.orientation,
      safe_crop_filter: snapshot.safeCrop,
      ...resultsEventParams(snapshot),
    });
  }
}

export function scheduleResultsTracking(source, { getSnapshot, delayMs }) {
  analytics.pendingResultsSource = source;
  clearTimeout(analytics.resultsTimer);
  analytics.resultsTimer = window.setTimeout(() => {
    trackVisibleResults(analytics.pendingResultsSource, getSnapshot());
  }, delayMs);
}
