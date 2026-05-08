import { appendFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";
import { photoHeaders } from "./photo-schema.mjs";

export const photosPath = "data/photos.csv";

export function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function toCsvRow(photo) {
  return photoHeaders.map((header) => csvEscape(photo[header] ?? "")).join(",");
}

export function normalizeFlickrPhotoUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }

  if (!["www.flickr.com", "flickr.com"].includes(url.hostname)) {
    throw new Error(`Expected a flickr.com URL, got: ${url.hostname}`);
  }

  const match = url.pathname.match(/\/photos\/[^/]+\/(\d+)/);
  if (!match) {
    throw new Error(`Could not find a Flickr photo ID in URL: ${value}`);
  }

  url.hash = "";
  url.search = "";

  return {
    photoId: match[1],
    photoUrl: url.toString(),
  };
}

export async function fetchOEmbed(photoUrl) {
  const endpoint = new URL("https://www.flickr.com/services/oembed/");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("url", photoUrl);

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Flickr oEmbed failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export function assertRequiredOEmbedData(oembed) {
  if (!oembed.thumbnail_url) {
    throw new Error("Flickr oEmbed did not return thumbnail_url");
  }
}

export function extractPhotographerCredit(title) {
  const normalizedTitle = String(title ?? "").trim();
  if (!normalizedTitle) {
    return "";
  }

  const cameraTokenMatch = normalizedTitle.match(/^(.+?)(?:DSC|IMG)[-_]?\d+/i);
  if (cameraTokenMatch?.[1]?.trim()) {
    return cameraTokenMatch[1].trim();
  }

  for (const separator of ["-", "_"]) {
    const separatorIndex = normalizedTitle.indexOf(separator);
    if (separatorIndex > 0) {
      return normalizedTitle.slice(0, separatorIndex).trim();
    }
  }

  return "";
}

export async function getExistingPhotoIds() {
  const text = await readFile(photosPath, "utf8");
  const rows = text.trimEnd().split(/\r?\n/);
  return new Set(rows.slice(1).map((row) => row.split(",", 1)[0]));
}

export function assertUniqueInputPhotoIds(normalizedPhotos) {
  const seenInputIds = new Set();
  for (const { photoId } of normalizedPhotos) {
    if (seenInputIds.has(photoId)) {
      throw new Error(`Photo ${photoId} was provided more than once`);
    }
    seenInputIds.add(photoId);
  }
}

export function filterNewPhotos(normalizedPhotos, existingIds) {
  return normalizedPhotos.filter(({ photoId }) => !existingIds.has(photoId));
}

export async function buildCsvRows(normalizedPhotos) {
  const rows = [];
  for (const { photoId, photoUrl } of normalizedPhotos) {
    const oembed = await fetchOEmbed(photoUrl);
    assertRequiredOEmbedData(oembed);
    const flickrTitle = oembed.title ?? "";

    const photo = {
      photo_id: photoId,
      photo_url: photoUrl,
      image_preview_url: oembed.thumbnail_url ?? "",
      photographer: extractPhotographerCredit(flickrTitle),
      internal_notes: flickrTitle ? `Flickr title: ${flickrTitle}` : "",
      curation_status: "unreviewed",
    };
    rows.push(toCsvRow(photo));
  }
  return rows;
}

export async function appendCsvRows(rows) {
  if (rows.length === 0) {
    return;
  }
  await appendFile(photosPath, `${rows.join("\n")}\n`);
}

export function validateData() {
  const result = spawnSync(process.execPath, ["scripts/validate-data.mjs"], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error("data validation failed");
  }
}
