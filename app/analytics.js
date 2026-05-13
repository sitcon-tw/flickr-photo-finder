import {
  cleanParams,
  hasActiveFilters,
  hasTrackedResultState,
  normalizeMeasurementId,
  resultCountBucket,
  resultsEventParams,
  sanitizeSearchTerm,
} from "./analytics-core.js";

export {
  cleanParams,
  hasActiveFilters,
  hasTrackedResultState,
  normalizeMeasurementId,
  resultCountBucket,
  resultsEventParams,
  sanitizeSearchTerm,
} from "./analytics-core.js";

// GA4 setup and event dispatch for the Pages frontend. Pure event shaping lives
// in analytics-core so React migration can reuse it without window/DOM access.
const analytics = {
  enabled: false,
  lastTrackedResultsState: "",
  pendingResultsSource: "",
  resultsTimer: 0,
};

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
      mood_filter_used: snapshot.moodCount > 0,
      scene_filter_used: snapshot.sceneCount > 0,
      people_count_filter_used: snapshot.peopleCountCount > 0,
      subject_type_filter_used: snapshot.subjectTypeCount > 0,
      orientation_filter_used: snapshot.orientationCount > 0,
      safe_crop_filter_used: snapshot.safeCropCount > 0,
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
