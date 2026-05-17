import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildOptionLabelMaps, createSearchTokenBuilder, normalizeAlbumRows, normalizePhotoRows } from "../../../app/data-loader.js";
import { parseCsv } from "../core/csv-utils.mjs";

export const defaultFinderDataDir = "data/finder-data";
export const defaultShardSize = 512;
export const finderDataArtifactVersion = "2026-05-static-sharded-v1";
export const finderDataModes = new Set(["runtime-csv", "static-sharded"]);
export const finderDataSources = new Set(["public-csv", "export"]);
export const defaultDiscoverCandidateLimit = 2000;

export const staticIndexFields = [
  "photo_id",
  "_sheet_row_number",
  "photo_url",
  "album_ids",
  "album_title",
  "event_name",
  "event_year",
  "image_preview_url",
  "subject_type",
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "sponsorship_items",
  "sponsorship_tags",
  "orientation",
  "has_negative_space",
  "safe_crop",
  "people_count",
  "public_use_status",
  "priority_level",
  "curation_status",
  "collections",
  "search_text",
  "shard_id",
];

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function photoDetailFields(photoSchema) {
  const schemaFields = photoSchema.tables.photos.fields.map((field) => field.name);
  return [...schemaFields, "_sheet_row_number"];
}

export function albumFields(photoSchema) {
  return photoSchema.tables.albums.fields.map((field) => field.name);
}

export function encodeRecords(records, fields) {
  return {
    fields,
    rows: records.map((record) => fields.map((field) => record[field] ?? "")),
  };
}

export function decodeRecords(payload) {
  const fields = payload?.fields ?? [];
  return (payload?.rows ?? []).map((row) =>
    Object.fromEntries(fields.map((field, index) => [field, row[index] ?? ""])),
  );
}

function shardIdFor(index, shardSize) {
  return String(Math.floor(index / shardSize)).padStart(3, "0");
}

function shardPathFor(shardId) {
  return `shards/photos-${shardId}.json`;
}

function normalizeShardSize(value) {
  const shardSize = Number(value);
  if (!Number.isInteger(shardSize) || shardSize < 1) {
    throw new Error("--shard-size must be a positive integer");
  }
  return shardSize;
}

export function normalizeStaticSourceLabels(source = {}) {
  return {
    ...source,
    generated_by: "pnpm finder:build",
  };
}

export function buildStaticFinderPayloads({
  albumsText,
  generatedAt = new Date().toISOString(),
  photoSchema,
  photosText,
  searchAliases,
  shardSize = defaultShardSize,
  source = {},
  taxonomy,
} = {}) {
  const normalizedShardSize = normalizeShardSize(shardSize);
  const optionLabelMaps = buildOptionLabelMaps(taxonomy);
  const searchTokensForField = createSearchTokenBuilder(optionLabelMaps, searchAliases);
  const photos = normalizePhotoRows(parseCsv(photosText), photoSchema, searchTokensForField);
  const albums = albumsText ? normalizeAlbumRows(parseCsv(albumsText)) : [];
  const detailFields = photoDetailFields(photoSchema);
  const albumsFields = albumFields(photoSchema);
  const photosWithShard = photos.map((photo, index) => ({
    ...photo,
    shard_id: shardIdFor(index, normalizedShardSize),
  }));
  const shardIds = [...new Set(photosWithShard.map((photo) => photo.shard_id))];
  const shards = shardIds.map((shardId) => {
    const shardPhotos = photosWithShard.filter((photo) => photo.shard_id === shardId);
    const start = photosWithShard.indexOf(shardPhotos[0]);
    return {
      id: shardId,
      path: shardPathFor(shardId),
      start,
      count: shardPhotos.length,
      payload: {
        shard_id: shardId,
        ...encodeRecords(shardPhotos, detailFields),
      },
    };
  });

  const manifest = {
    artifactVersion: finderDataArtifactVersion,
    generatedAt,
    source: normalizeStaticSourceLabels({
      ...source,
      albumsSha256: sha256(albumsText ?? ""),
      photosSha256: sha256(photosText ?? ""),
    }),
    rowCount: photosWithShard.length,
    albumCount: albums.length,
    schemaVersion: photoSchema.version ?? "",
    shardSize: normalizedShardSize,
    indexFields: staticIndexFields,
    detailFields,
    albumFields: albumsFields,
    shards: shards.map(({ payload: _payload, ...shard }) => shard),
  };

  return {
    albums: encodeRecords(albums, albumsFields),
    index: encodeRecords(photosWithShard, staticIndexFields),
    manifest,
    photos: photosWithShard,
    shards,
  };
}

async function writeJson(path, payload) {
  await writeFile(path, `${JSON.stringify(payload)}\n`);
}

export async function writeStaticFinderDataArtifacts({ outputDir, payloads }) {
  await mkdir(join(outputDir, "shards"), { recursive: true });
  await writeJson(join(outputDir, "manifest.json"), payloads.manifest);
  await writeJson(join(outputDir, "albums.json"), payloads.albums);
  await writeJson(join(outputDir, "photos-index.json"), payloads.index);
  for (const shard of payloads.shards) {
    await writeJson(join(outputDir, shard.path), shard.payload);
  }
}

export async function readStaticFinderDataInputs({
  albumsCsvPath = "tmp/sheets-export/albums.csv",
  photosCsvPath = "tmp/sheets-export/photos.csv",
  photoSchemaPath = "data/photo-schema.json",
  searchAliasesPath = "data/search-aliases.json",
  taxonomyPath = "data/tag-taxonomy.json",
} = {}) {
  const [albumsText, photosText, photoSchema, taxonomy, searchAliases] = await Promise.all([
    readFile(albumsCsvPath, "utf8"),
    readFile(photosCsvPath, "utf8"),
    readFile(photoSchemaPath, "utf8").then(JSON.parse),
    readFile(taxonomyPath, "utf8").then(JSON.parse),
    readFile(searchAliasesPath, "utf8").then(JSON.parse),
  ]);
  return {
    albumsText,
    photoSchema,
    photosText,
    searchAliases,
    taxonomy,
  };
}
