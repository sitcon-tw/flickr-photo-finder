import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { createSourceIndex, resolveSourceScope, sourceValue, missingSourceValue as missing, sourceFilterOptions,
  availableSourceValues, sourceScopeSnapshot, sourceContextText, sourceOptionLabel } from "../app/source-filters.js";
import { filterAndSortPhotos, matchesPhotoFilters } from "../app/search-sort.js";
import { buildAiAssistantPrompt } from "../app/ai-assistant.js";
import { hasActiveFilters, hasTrackedResultState, resultsEventParams } from "../app/analytics.js";
import { applyUrlStateRegistry, encodeUrlState, decodeUrlState } from "../app/url-state.js";
import { normalizePhotoRows, normalizeStaticPhotoRecords, decodeCompactRecords } from "../app/data-loader.js";
import { buildStaticFinderPayloads } from "../scripts/lib/pages/static-finder-data.mjs";
import { csvEscape, parseCsv } from "../scripts/lib/core/csv-utils.mjs";

const albums = [
  { album_id: "a", album_title: "同名相簿", event_name: "Camp", event_year: "2025" },
  { album_id: "b", album_title: "年會", event_name: "年會", event_year: "2026" },
  { album_id: "c", album_title: "活動未填", event_name: "", event_year: "2026" },
  { album_id: "d", album_title: "同名相簿", event_name: "Camp", event_year: "" },
  { album_id: "unused", album_title: "尚未索引", event_name: "其他", event_year: "2027" },
];
const photo = (photo_id, album_ids, extra = {}) => ({ photo_id, album_ids, album_title: "照片相簿名稱", event_year: "1999", search_text: "舞台", ...extra });
const photos = [photo("p", ["b", "a"]), photo("q", ["a"]), photo("r", ["c"]), photo("s", ["d"]),
  photo("orphan", ["gone"]), photo("none", []), photo("b", ["b"], { orientation: "portrait", search_text: "交流" })];
const index = createSourceIndex(photos, albums);
const selected = (filters, options = {}) => filterAndSortPhotos(photos, { sourceIndex: index, filters, ...options }).map((p) => p.photo_id);
const event = (name) => ({ sourceEvent: [sourceValue(name)] });
const year = (name) => ({ sourceYear: [sourceValue(name)] });

describe("ADR 0012 source contract", () => {
  it("tracks event/year-only queries through the existing filter event contract", () => {
    for (const key of ["sourceEvent", "sourceYear"]) {
      const snapshot = { taskMode: "all", sortMode: "recommended", [key]: ["value:test"], [`${key}Count`]: 1 };
      assert.equal(hasActiveFilters(snapshot), true);
      assert.equal(hasTrackedResultState(snapshot), true);
      assert.equal(resultsEventParams(snapshot).filter_count, 1);
    }
  });
  it("joins all three conditions on the same source, ORs each field and deduplicates photos", () => {
    assert.deepEqual(selected({ ...event("年會"), ...year("2025") }), []);
    assert.deepEqual(selected({ ...event("Camp"), ...year("2025") }).sort(), ["p", "q"]);
    assert.deepEqual(selected({ album: ["id:a"], ...year("2026") }), []);
    assert.deepEqual(selected({ sourceEvent: [sourceValue("Camp"), sourceValue("年會")], ...year("2026") }).sort(), ["b", "p"]);
    const result = filterAndSortPhotos([photos[0], photos[0]], { albums, filters: year("2025") });
    assert.equal(result.length, 1);
  });

  it("matches unknown on any qualifying source without borrowing another source's values", () => {
    assert.deepEqual(selected({ sourceEvent: [missing], ...year("2026") }), ["r"]);
    assert.deepEqual(selected({ ...event("Camp"), sourceYear: [missing] }), ["s"]);
    assert.deepEqual(selected({ album: [missing] }), ["none"]);
    assert.deepEqual(selected({ album: ["id:gone"] }), ["orphan"]);
    assert.deepEqual(selected({ album: ["gone"], ...year("1999") }), []);
    assert.deepEqual(selected({ sourceEvent: [missing], sourceYear: [missing] }).sort(), ["none", "orphan"]);
    assert.equal(index.sources.get("gone").kind, "orphan");
    assert.equal(index.sources.get("").kind, "none");
  });

  it("keeps real names distinct from unknown tokens", () => {
    const rows = [photo("named", ["x"])];
    const catalog = [{ album_id: "x", event_name: missing }];
    assert.equal(filterAndSortPhotos(rows, { albums: catalog, filters: event(missing) }).length, 1);
    assert.equal(filterAndSortPhotos(rows, { albums: catalog, filters: { sourceEvent: [missing] } }).length, 0);
  });

  it("requires explicit album IDs and keeps unsupported values from broadening results", () => {
    for (const album of ["title:照片相簿名稱", "照片相簿名稱", "a"]) {
      assert.deepEqual(selected({ album: [album] }), []);
      assert.deepEqual(selected({ album: [album], ...year("2025") }), []);
      assert.deepEqual(selected({ album: [album], ...event("Camp") }), []);
    }
    assert.deepEqual(selected({ album: ["title:照片相簿名稱", "id:a"], ...year("2025") }).sort(), ["p", "q"]);
    assert.deepEqual(selected({ album: ["id:a"], ...year("2025") }).sort(), ["p", "q"]);
    assert.deepEqual(selected({ album: ["id:deleted"] }), []);
  });

  it("uses catalog order among matching sources, leaves unknown last both ways and preserves promotion", () => {
    assert.equal(resolveSourceScope(index).representative(photos[0]).album_id, "a");
    assert.equal(resolveSourceScope(index, year("2026")).representative(photos[0]).album_id, "b");
    assert.deepEqual(selected({}, { sortMode: "newest" }), ["r", "b", "p", "q", "s", "orphan", "none"]);
    assert.deepEqual(selected({}, { sortMode: "oldest" }), ["p", "q", "r", "b", "s", "orphan", "none"]);
    assert.equal(selected({}, { sortMode: "newest", selectedPhotoIds: ["none"] })[0], "none");
    const blankFirst = createSourceIndex([photo("multi", ["a", "d"])], [albums[3], albums[0]]);
    assert.equal(resolveSourceScope(blankFirst).representative({ photo_id: "multi" }).event_year, "");
    assert.match(sourceContextText(index.sources.get("gone")), /目錄/);
    assert.ok(photos.every((p) => p.event_year === "1999"));
  });

  it("keeps source results stable when preview details are merged", () => {
    const item = photo("preview", ["a"]);
    const snapshot = createSourceIndex([item], albums);
    const sourceScope = resolveSourceScope(snapshot, year("2025"));
    Object.assign(item, { album_title: "detail title", album_ids: ["b"], event_year: "2026" });
    assert.equal(sourceScope.matches(item), true);
    assert.equal(sourceScope.representative(item).album_id, "a");
  });

  it("derives options only from indexed sources and disambiguates identical album titles", () => {
    const options = sourceFilterOptions(index, "album");
    assert.equal(options.some((o) => o.value === "id:unused"), false);
    assert.equal(options.find((o) => o.value === "id:a").label, "同名相簿［a］");
    assert.equal(options.find((o) => o.value === "id:d").label, "同名相簿［d］");
    assert.equal(options.find((o) => o.value === "id:b").label, "年會");
    assert.ok(options.every((o) => o.value.startsWith("id:") || o.value === missing));
    assert.equal(sourceFilterOptions(index, "sourceYear").some((o) => o.value === sourceValue("1999")), false);
  });

  it("marks unsupported album values without aliasing them to catalog options", () => {
    const options = sourceFilterOptions(index, "album");
    for (const value of ["照片相簿名稱", "title:照片相簿名稱", "a"]) {
      assert.equal(sourceOptionLabel("album", value, options), `${value}（目前索引無此選項）`);
    }
    assert.equal(sourceOptionLabel("album", "id:a", options), "同名相簿［a］");
    assert.equal(sourceOptionLabel("album", "id:deleted", options), "deleted（目前索引無此選項）");
  });

  it("pins the configured event names exactly, preserving other names and unknown last", async () => {
    const registry = JSON.parse(await readFile("data/interface-registry.json", "utf8"));
    const { preferredValues, missingLabel } = registry.pages.filters.find((filter) => filter.key === "sourceEvent");
    assert.deepEqual(preferredValues, ["年會", "Camp"]);
    const catalog = ["Camp 同學會", "Camp", "", "@ COSCUP BoF", "年會"].map((event_name, i) => ({ album_id: String(i), event_name }));
    const sourceIndex = createSourceIndex([photo("events", catalog.map((row) => row.album_id))], catalog);
    const labels = (sourceIndex) => sourceFilterOptions(sourceIndex, "sourceEvent", missingLabel, preferredValues).map((option) => option.label);
    assert.deepEqual(labels(sourceIndex), ["年會", "Camp", "@ COSCUP BoF", "Camp 同學會", missingLabel]);
    assert.deepEqual(labels(createSourceIndex([photo("camp", ["a"])], albums)), ["Camp"]);
  });

  it("computes disjunctive facets with other photo filters, keeping the same-source constraint", () => {
    const filters = { ...event("Camp"), ...year("2025"), search: "舞台" };
    const eligible = photos.filter((p) => matchesPhotoFilters(p, filters));
    const available = availableSourceValues(index, eligible, filters);
    assert.deepEqual([...available.sourceEvent], [sourceValue("Camp")]);
    assert.deepEqual([...available.sourceYear].sort(), [missing, sourceValue("2025")].sort());
    assert.deepEqual([...available.album], ["id:a"]);
    const empty = availableSourceValues(index, [], filters);
    assert.ok(Object.values(empty).every((set) => set.size === 0));
    for (const album of ["title:照片相簿名稱", "a"]) {
      const invalid = availableSourceValues(index, photos, { album: [album] });
      assert.equal(invalid.sourceYear.size, 0);
      assert.equal(invalid.sourceEvent.size, 0);
      assert.ok(invalid.album.has("id:a"));
    }
  });

  it("round-trips all selected source values, including stale and unknown values", async () => {
    const registry = JSON.parse(await readFile("data/interface-registry.json", "utf8"));
    applyUrlStateRegistry(registry);
    const filters = { sourceEvent: [sourceValue("Camp"), sourceValue("camp")], sourceYear: [missing, sourceValue("2025")], album: ["id:deleted", "title:照片相簿名稱"] };
    const parsed = decodeUrlState(encodeUrlState({ filters, selectedPhotoIds: new Set(["p"]) }));
    for (const [key, value] of Object.entries(filters)) assert.deepEqual(parsed.filters[key], value);
    assert.deepEqual(parsed.selectedPhotoIds, ["p"]);
  });

  it("hands the exact OR branches to AI and distinguishes empty from unrestricted", () => {
    const options = { taskLabel: "全部照片", filterEntries: [], searchValue: "", sheetUrl: "https://example.com/sheet" };
    const scope = sourceScopeSnapshot(resolveSourceScope(index, { ...event("Camp"), ...year("2025") }));
    assert.deepEqual(scope, { restricted: true, albumIds: ["a"], includeNoAlbumId: false });
    assert.match(buildAiAssistantPrompt({ ...options, sourceScope: scope }), /"albumIds":\["a"\]/);
    const empty = sourceScopeSnapshot(resolveSourceScope(index, { album: ["id:deleted"], ...year("2025") }));
    assert.match(buildAiAssistantPrompt({ ...options, sourceScope: empty }), /此來源範圍為空/);
    assert.doesNotMatch(buildAiAssistantPrompt({ ...options, sourceScope: sourceScopeSnapshot(resolveSourceScope(index)) }), /此來源範圍為空/);
    const unknown = sourceScopeSnapshot(resolveSourceScope(index, { sourceYear: [missing] }));
    assert.equal(unknown.includeNoAlbumId, true);
    assert.ok(unknown.albumIds.includes("gone"));
  });

  it("produces identical source results for runtime and compact static data", async () => {
    const schema = JSON.parse(await readFile("data/photo-schema.json", "utf8"));
    const taxonomy = JSON.parse(await readFile("data/tag-taxonomy.json", "utf8"));
    const tableCsv = (table, rows) => {
      const fields = schema.tables[table].fields.map((f) => f.name);
      return [fields.join(","), ...rows.map((r) => fields.map((f) => csvEscape(Array.isArray(r[f]) ? r[f].join(";") : r[f] ?? "")).join(","))].join("\n");
    };
    const payloads = buildStaticFinderPayloads({ albumsText: tableCsv("albums", albums), photosText: tableCsv("photos", photos), photoSchema: schema, taxonomy, searchAliases: {} });
    const runtime = normalizePhotoRows(parseCsv(tableCsv("photos", photos)), schema, (_f, v) => [v]);
    const compact = normalizeStaticPhotoRecords(decodeCompactRecords(payloads.index), schema, (_f, v) => [v]);
    for (const filters of [{}, year("2025"), event("Camp"), { sourceYear: [missing] }, { album: ["title:照片相簿名稱"], ...year("2025") }]) {
      const run = (rows) => filterAndSortPhotos(rows, { albums, filters, sortMode: "newest" }).map((p) => p.photo_id);
      assert.deepEqual(run(runtime), run(compact));
    }
  });
});
