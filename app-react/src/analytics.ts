type ProjectConfig = {
  frontend?: {
    ga4MeasurementId?: string;
  };
};

type EventParams = Record<string, string | number | boolean | undefined>;

let measurementId = "";
let loaded = false;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function cleanParams(params: EventParams = {}): EventParams {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 80) : value]),
  );
}

export function setupReactAnalytics(projectConfig: ProjectConfig) {
  measurementId = String(projectConfig.frontend?.ga4MeasurementId ?? "").trim();
  if (!measurementId || loaded || typeof document === "undefined") {
    return;
  }

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(script);
  loaded = true;
}

export function trackReactEvent(name: string, params: EventParams = {}) {
  if (!measurementId || !window.gtag) {
    return;
  }
  window.gtag("event", name, cleanParams(params));
}
