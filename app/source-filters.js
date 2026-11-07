// Album-source queries are separate from the photo's own metadata (ADR 0012).
export const sourceFilterKeys = ["sourceEvent", "sourceYear", "album"];
export const missingSourceValue = "missing:";
export const sourceValue = (value) => String(value ?? "").trim() ? `value:${String(value).trim()}` : missingSourceValue;
const values = (value) => (Array.isArray(value) ? value : [value]).filter(Boolean);
const emptySource = { kind: "none", album_id: "", event_name: "", event_year: "" };

export function createSourceIndex(photos, albums = []) {
  const catalog = new Map(albums.map((album, order) => [String(album.album_id), { ...album, kind: "catalog", order }]));
  const sources = new Map();
  const byPhoto = new Map();
  for (const photo of photos) {
    const ids = [...new Set(values(photo.album_ids).map((id) => String(id).trim()).filter(Boolean))];
    const rows = ids.map((id) => {
      if (!sources.has(id)) sources.set(id, catalog.get(id) ?? { ...emptySource, kind: "orphan", album_id: id });
      return sources.get(id);
    }).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
    if (rows.length === 0) {
      sources.set("", emptySource);
      rows.push(emptySource);
    }
    if (!byPhoto.has(photo.photo_id)) {
      byPhoto.set(photo.photo_id, rows);
    }
  }
  return { catalog, sources, byPhoto };
}

export function hasSourceFilters(filters = {}) {
  return sourceFilterKeys.some((key) => values(filters[key]).length > 0);
}

function matchesValue(selected, value) {
  return selected.length === 0 || selected.includes(sourceValue(value));
}

export function resolveSourceScope(index, filters = {}) {
  const events = values(filters.sourceEvent);
  const years = values(filters.sourceYear);
  const albums = values(filters.album);
  const matchesMetadata = (row) => matchesValue(events, row.event_name) && matchesValue(years, row.event_year);
  const albumIds = new Set();
  let noAlbum = false;
  for (const row of index.sources.values()) {
    if (!matchesMetadata(row)) continue;
    if (!albums.length || albums.some((value) => row.album_id
      ? value === `id:${row.album_id}`
      : value === missingSourceValue)) {
      if (row.album_id) albumIds.add(row.album_id);
      else noAlbum = true;
    }
  }
  const rowsFor = (photo) => index.byPhoto.get(photo.photo_id) ?? [emptySource];
  const matchingSources = (photo) => rowsFor(photo).filter((row) => row.album_id ? albumIds.has(row.album_id) : noAlbum);
  return {
    restricted: hasSourceFilters(filters), albumIds, noAlbum, matchingSources,
    matches: (photo) => rowsFor(photo).some((row) => row.album_id ? albumIds.has(row.album_id) : noAlbum),
    representative: (photo) => {
      const rows = matchingSources(photo);
      return rows.find((row) => row.kind === "catalog") ?? rows[0] ?? null;
    },
  };
}

export function sourceFilterOptions(index, key, missingLabel = "未設定", preferredValues = []) {
  if (key !== "album") {
    const field = key === "sourceEvent" ? "event_name" : "event_year";
    const raw = [...new Set([...index.sources.values()].map((row) => String(row[field] ?? "").trim()))];
    const preferredOrder = new Map(preferredValues.map((value, order) => [value, order]));
    raw.sort((a, b) => {
      if (!a || !b) return Number(!a) - Number(!b);
      if (key === "sourceYear") return b.localeCompare(a, undefined, { numeric: true });
      return (preferredOrder.get(a) ?? preferredValues.length) - (preferredOrder.get(b) ?? preferredValues.length)
        || a.localeCompare(b, "zh-Hant-TW");
    });
    return raw.map((value) => ({ value: sourceValue(value), label: value || missingLabel }));
  }
  const rows = [...index.sources.values()].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  const titleCounts = new Map();
  for (const row of rows) {
    if (row.album_title) titleCounts.set(row.album_title, (titleCounts.get(row.album_title) ?? 0) + 1);
  }
  return rows.map((row) => {
    if (!row.album_id) return { value: missingSourceValue, label: missingLabel };
    if (row.kind === "orphan") return { value: `id:${row.album_id}`, label: `相簿 ${row.album_id}（目錄缺漏）` };
    const label = row.album_title || `相簿 ${row.album_id}`;
    return { value: `id:${row.album_id}`, label: titleCounts.get(row.album_title) > 1 ? `${label}［${row.album_id}］` : label };
  });
}

export function sourceOptionLabel(key, value, options) {
  const known = options.find((option) => option.value === value);
  if (known) return known.label;
  if (key === "album") {
    return `${value.replace(/^id:/, "")}（目前索引無此選項）`;
  }
  return value === missingSourceValue ? "未設定" : `${value.replace(/^value:/, "")}（目前索引無此選項）`;
}

// Three passes over eligible photos, rather than one full scan per dropdown option.
export function availableSourceValues(index, photos, filters = {}) {
  const available = Object.fromEntries(sourceFilterKeys.map((key) => [key, new Set()]));
  for (const key of sourceFilterKeys) {
    const scope = resolveSourceScope(index, { ...filters, [key]: [] });
    for (const photo of photos) {
      for (const row of scope.matchingSources(photo)) {
        if (key === "album") available[key].add(row.album_id ? `id:${row.album_id}` : missingSourceValue);
        else available[key].add(sourceValue(row[key === "sourceEvent" ? "event_name" : "event_year"]));
      }
    }
  }
  return available;
}

export function sourceScopeSnapshot(scope) {
  return { restricted: scope.restricted, albumIds: [...scope.albumIds], includeNoAlbumId: scope.noAlbum };
}

export function sourceContextText(source) {
  if (!source) return "目前來源條件沒有命中此照片";
  if (source.kind === "none") return "未記錄相簿；來源活動與年份未知";
  if (source.kind === "orphan") return `相簿 ${source.album_id} 不在目錄中；來源活動與年份未知`;
  return `${source.event_year || "年份未填"} · ${source.event_name || "活動未填"} · ${source.album_title || "相簿名稱未填"}［${source.album_id}］`;
}
