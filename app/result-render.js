export function renderActiveFilters({ elements, activeFilterEntries }) {
  const entries = activeFilterEntries();
  elements.activeFilters.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement("span");
    empty.className = "filter-chip muted-chip";
    empty.textContent = "未套用條件";
    elements.activeFilters.append(empty);
    return;
  }

  for (const [key, label, value, rawValue = value] of entries) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip";
    chip.dataset.filterKey = key;
    chip.dataset.filterValue = rawValue;
    chip.textContent = `${label}: ${value} ×`;
    elements.activeFilters.append(chip);
  }
}

export function resultContextText({ photos, filtered, controls, activeTask, activeFilterEntries }) {
  if (photos.length === 0) {
    return "尚未載入照片";
  }
  if (filtered.length === 0) {
    return "沒找到不一定代表沒有照片；有些標籤尚未確認，可放寬條件或回相簿看看。";
  }

  const task = activeTask();
  const taskPrefix = task.id === "all" ? "全部照片" : `優先檢視「${task.label}」`;
  let sortText = task.id === "all" ? "以推薦排序" : `優先檢視適合「${task.label}」的照片`;
  if (controls.sort.value === "discover") {
    sortText = `以${taskPrefix}亂序探索排序，分散年份、活動、相簿與素材包來源`;
  } else if (controls.sort.value === "newest") {
    sortText = "以年份新到舊排序";
  } else if (controls.sort.value === "oldest") {
    sortText = "以年份舊到新排序";
  } else if (controls.sort.value === "people-desc") {
    sortText = "以人數多到少排序";
  } else if (controls.sort.value === "people-asc") {
    sortText = "以人數少到多排序";
  }

  const filterText = activeFilterEntries()
    .filter(([key]) => key !== "task")
    .map(([, label, value]) => `${label} ${value}`)
    .join(" / ");
  return `${sortText}，這些是目前命中的照片；有些標籤尚未人工確認。${filterText ? `已套用：${filterText}` : "未套用額外篩選。"}`;
}

export const autoLoadMoreDistancePx = 640;

export function shouldAutoLoadMore({
  panel,
  visibleCount,
  filtered,
  viewportHeight,
  distancePx = autoLoadMoreDistancePx,
} = {}) {
  if (!panel || !Array.isArray(filtered)) {
    return false;
  }
  const renderedCount = Math.min(Number(visibleCount) || 0, filtered.length);
  const remaining = filtered.length - renderedCount;
  if (panel.hidden || remaining <= 0 || filtered.length === 0) {
    return false;
  }
  let height = viewportHeight;
  if (!Number.isFinite(height)) {
    height = typeof window === "undefined" ? 0 : window.innerHeight;
  }
  return panel.getBoundingClientRect().top <= height + distancePx;
}

export function updateTaskButtons({ elements, taskMode }) {
  for (const button of elements.taskModes.querySelectorAll(".task-mode")) {
    button.classList.toggle("is-active", button.dataset.taskMode === taskMode);
  }
}

export function updateLoadMore({ elements, visibleCount, filtered }) {
  const renderedCount = Math.min(visibleCount, filtered.length);
  const remaining = filtered.length - renderedCount;
  elements.loadMorePanel.hidden = remaining <= 0 || filtered.length === 0;
  elements.loadMoreSummary.textContent = `已顯示 ${renderedCount} 張，尚有 ${remaining} 張`;
}

export function renderEmpty(grid, text) {
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = text;
  grid.append(empty);
}
