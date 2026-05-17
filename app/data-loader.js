import { parseCsv, parseList } from "./data-utils.js";
import { buildSearchText, uniqueSearchTokens } from "./search-sort.js";

// Data loading and row normalization for the Pages frontend. This module owns
// transport/parsing details; callers receive plain app data and helper closures.
export function buildOptionLabelMaps(taxonomy) {
  const labels = taxonomy.option_labels ?? {};
  return new Map(
    Object.entries(labels).map(([fieldName, fieldLabels]) => [
      fieldName,
      new Map(Object.entries(fieldLabels ?? {})),
    ]),
  );
}

export function optionLabelsFor(optionLabelMaps, fieldName) {
  return optionLabelMaps.get(fieldName) ?? new Map();
}

export function createSearchTokenBuilder(optionLabelMaps, searchAliases) {
  return function searchTokensForField(fieldName, value) {
    return uniqueSearchTokens(fieldName, value, optionLabelsFor(optionLabelMaps, fieldName), searchAliases);
  };
}

export function normalizePhotoRows(rows, schema, searchTokensForField) {
  const [headers, ...dataRows] = rows;
  const fields = schema.tables.photos.fields;
  const fieldSet = new Set(fields.map((field) => field.name));
  const listFields = fields.filter((field) => field.multi_value).map((field) => field.name);

  return dataRows.map((row, index) => {
    const photo = Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""]));
    photo._sheet_row_number = index + 2;
    for (const field of listFields) {
      photo[field] = parseList(photo[field] ?? "");
    }
    for (const field of fieldSet) {
      if (!(field in photo)) {
        photo[field] = "";
      }
    }
    photo.search_text = buildSearchText(photo, { searchTokensForField });
    return photo;
  });
}

export function normalizeAlbumRows(rows) {
  const [headers = [], ...dataRows] = rows;
  return dataRows.map((row) => Object.fromEntries(headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""])));
}

function photoListFields(schema) {
  return schema.tables.photos.fields.filter((field) => field.multi_value).map((field) => field.name);
}

function normalizePhotoRecord(record, schema, searchTokensForField) {
  const photo = { ...record };
  for (const field of schema.tables.photos.fields) {
    if (!(field.name in photo)) {
      photo[field.name] = "";
    }
  }
  for (const field of photoListFields(schema)) {
    photo[field] = Array.isArray(photo[field]) ? photo[field] : parseList(photo[field] ?? "");
  }
  photo.search_text = photo.search_text ? String(photo.search_text).toLowerCase() : buildSearchText(photo, { searchTokensForField });
  return photo;
}

export function decodeCompactRecords(payload) {
  const fields = payload?.fields ?? [];
  return (payload?.rows ?? []).map((row) =>
    Object.fromEntries(fields.map((field, index) => [field, row[index] ?? ""])),
  );
}

export function normalizeStaticPhotoRecords(records, schema, searchTokensForField) {
  return records.map((record) => normalizePhotoRecord(record, schema, searchTokensForField));
}

function resolveUrl(url) {
  return new URL(url, globalThis.document?.baseURI ?? globalThis.location?.href ?? "http://localhost/").toString();
}

async function fetchOk(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`資料載入失敗: ${url}`);
  }
  return response;
}

function createStaticPhotoDetailLoader({ fetchImpl, manifest, manifestUrl, photoSchema, photos, searchTokensForField }) {
  const photoById = new Map(photos.map((photo) => [String(photo.photo_id), photo]));
  const shardsById = new Map((manifest.shards ?? []).map((shard) => [String(shard.id), shard]));
  const shardCache = new Map();

  async function loadShard(shardId) {
    const id = String(shardId ?? "");
    if (!id) {
      return;
    }
    if (!shardCache.has(id)) {
      const shard = shardsById.get(id);
      if (!shard) {
        throw new Error(`找不到照片 detail shard: ${id}`);
      }
      const shardUrl = new URL(shard.path, manifestUrl).toString();
      shardCache.set(id, (async () => {
        const response = await fetchOk(fetchImpl, shardUrl);
        const payload = await response.json();
        const records = normalizeStaticPhotoRecords(decodeCompactRecords(payload), photoSchema, searchTokensForField);
        for (const detail of records) {
          const target = photoById.get(String(detail.photo_id));
          if (!target) {
            continue;
          }
          const searchText = target.search_text;
          const targetShardId = target.shard_id;
          Object.assign(target, detail, {
            _detail_loaded: true,
            search_text: searchText,
            shard_id: targetShardId,
          });
        }
      })());
    }
    await shardCache.get(id);
  }

  return async function loadPhotoDetails(photo) {
    if (!photo || photo._detail_loaded || !photo.shard_id) {
      return photo;
    }
    await loadShard(photo.shard_id);
    return photoById.get(String(photo.photo_id)) ?? photo;
  };
}

async function loadCommonJson({ dataSources, fetchImpl, projectConfigUrl }) {
  const [interfaceRegistryResponse, schemaResponse, taxonomyResponse, searchAliasesResponse, projectConfigResponse] = await Promise.all([
    fetchOk(fetchImpl, dataSources.interfaceRegistryJsonUrl),
    fetchOk(fetchImpl, dataSources.schemaJsonUrl),
    fetchOk(fetchImpl, dataSources.taxonomyJsonUrl),
    fetchOk(fetchImpl, dataSources.searchAliasesJsonUrl),
    fetchOk(fetchImpl, projectConfigUrl),
  ]);

  const [interfaceRegistry, photoSchema, taxonomy, searchAliases, projectConfig] = await Promise.all([
    interfaceRegistryResponse.json(),
    schemaResponse.json(),
    taxonomyResponse.json(),
    searchAliasesResponse.json(),
    projectConfigResponse.json(),
  ]);
  const optionLabelMaps = buildOptionLabelMaps(taxonomy);
  const searchTokensForField = createSearchTokenBuilder(optionLabelMaps, searchAliases);
  return {
    interfaceRegistry,
    optionLabelMaps,
    photoSchema,
    projectConfig,
    searchAliases,
    searchTokensForField,
    taxonomy,
  };
}

async function loadRuntimeCsvFinderData({ dataSources, fetchImpl, projectConfigUrl }) {
  const albumsRequest = dataSources.albumsCsvUrl ? fetchImpl(dataSources.albumsCsvUrl) : Promise.resolve(null);
  const [albumsResponse, photosResponse, common] = await Promise.all([
    albumsRequest,
    fetchOk(fetchImpl, dataSources.photosCsvUrl),
    loadCommonJson({ dataSources, fetchImpl, projectConfigUrl }),
  ]);

  if (albumsResponse && !albumsResponse.ok) {
    throw new Error("資料載入失敗");
  }

  const [albumsText, photosText] = await Promise.all([
    albumsResponse ? albumsResponse.text() : "",
    photosResponse.text(),
  ]);

  return {
    ...common,
    albums: albumsText ? normalizeAlbumRows(parseCsv(albumsText)) : [],
    dataMode: "runtime-csv",
    loadPhotoDetails: async (photo) => photo,
    photos: normalizePhotoRows(parseCsv(photosText), common.photoSchema, common.searchTokensForField),
  };
}

async function loadStaticShardedFinderData({ dataSources, fetchImpl, projectConfigUrl }) {
  const manifestUrl = resolveUrl(dataSources.finderDataManifestUrl);
  const [manifestResponse, albumsResponse, indexResponse, common] = await Promise.all([
    fetchOk(fetchImpl, manifestUrl),
    fetchOk(fetchImpl, resolveUrl(dataSources.finderDataAlbumsUrl)),
    fetchOk(fetchImpl, resolveUrl(dataSources.finderDataIndexUrl)),
    loadCommonJson({ dataSources, fetchImpl, projectConfigUrl }),
  ]);
  const [manifest, albumsPayload, indexPayload] = await Promise.all([
    manifestResponse.json(),
    albumsResponse.json(),
    indexResponse.json(),
  ]);
  const photos = normalizeStaticPhotoRecords(
    decodeCompactRecords(indexPayload),
    common.photoSchema,
    common.searchTokensForField,
  );

  return {
    ...common,
    albums: decodeCompactRecords(albumsPayload),
    dataMode: "static-sharded",
    finderDataManifest: manifest,
    loadPhotoDetails: createStaticPhotoDetailLoader({
      fetchImpl,
      manifest,
      manifestUrl,
      photoSchema: common.photoSchema,
      photos,
      searchTokensForField: common.searchTokensForField,
    }),
    photos,
  };
}

export async function loadFinderData({ dataSources, projectConfigUrl, fetchImpl = fetch }) {
  if ((dataSources.mode ?? "runtime-csv") === "static-sharded") {
    return loadStaticShardedFinderData({ dataSources, fetchImpl, projectConfigUrl });
  }
  return loadRuntimeCsvFinderData({ dataSources, fetchImpl, projectConfigUrl });
}
