export function formatGeneratedAt(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "";
  }
  const match = rawValue.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  if (!match) {
    return rawValue;
  }
  return `${match[1]} ${match[2]} UTC`;
}

export function pwaStatusText({ generatedAt = "", online = true, usedCache = false } = {}) {
  const generatedText = formatGeneratedAt(generatedAt);
  const suffix = generatedText ? `，資料時間 ${generatedText}` : "";
  if (!online) {
    return `離線模式：使用已快取資料${suffix}`;
  }
  if (usedCache) {
    return `使用快取資料${suffix}，重新連線後會嘗試更新`;
  }
  return "";
}

export function registerPwa({ generatedAt = "", onStatusChange = () => {} } = {}) {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return;
  }
  if (!("serviceWorker" in navigator)) {
    onStatusChange({ text: "", hidden: true });
    return;
  }

  const state = {
    generatedAt,
    online: navigator.onLine,
    usedCache: false,
  };

  function emitStatus() {
    const text = pwaStatusText(state);
    onStatusChange({ text, hidden: !text });
  }

  window.addEventListener("online", () => {
    state.online = true;
    state.usedCache = false;
    emitStatus();
  });
  window.addEventListener("offline", () => {
    state.online = false;
    emitStatus();
  });

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "sitcon-photo-finder-cache-fallback") {
      return;
    }
    state.usedCache = true;
    emitStatus();
  });

  navigator.serviceWorker.register("./service-worker.js").catch(() => {
    onStatusChange({ text: "", hidden: true });
  });

  emitStatus();
}
