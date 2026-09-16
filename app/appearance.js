// Run before the stylesheet so a saved preference also applies to the first paint.
(() => {
  const storageKey = "sitcon-photo-finder-appearance";
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
  const labels = { dark: "深色", light: "淺色" };
  let preference = null;
  let button;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") {
      preference = saved;
    }
  } catch {
    // Storage restrictions must not prevent following the system preference.
  }

  function applyAppearance() {
    const theme = preference ?? (systemTheme.matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    if (button) {
      const next = theme === "dark" ? "light" : "dark";
      button.dataset.appearance = theme;
      button.title = `外觀：${labels[theme]}；切換為${labels[next]}`;
      button.setAttribute("aria-label", button.title);
    }
  }

  applyAppearance();
  systemTheme.addEventListener("change", applyAppearance);
  document.addEventListener("DOMContentLoaded", () => {
    button = document.querySelector("#appearanceButton");
    applyAppearance();
    button.addEventListener("click", () => {
      preference = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(storageKey, preference);
      } catch {
        // The chosen appearance still works for this page when storage is blocked.
      }
      applyAppearance();
    });
  });
})();
