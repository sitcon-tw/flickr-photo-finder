import { readFile, appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { URL } from "node:url";
import { photoHeaders } from "./photo-schema.mjs";

const photosPath = "data/photos.csv";

function printUsage() {
  console.log(`Usage:
  npm run photo:add -- <flickr-photo-url> [more-flickr-photo-urls...]
  npm run photo:add -- <flickr-photo-url> [more-flickr-photo-urls...] --append

Options:
  --append  Append generated rows to data/photos.csv and validate data.

The script uses Flickr oEmbed to fill photo_id, photo_url, image_preview_url,
photographer, and a basic internal note. Other curation fields stay blank for
human review.`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const append = args.includes("--append");
  const help = args.includes("--help") || args.includes("-h");
  const photoUrls = args.filter((arg) => !arg.startsWith("--"));

  return { append, help, photoUrls };
}

function normalizeFlickrUrl(value) {
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

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function toCsvRow(photo) {
  return photoHeaders.map((header) => csvEscape(photo[header] ?? "")).join(",");
}

function assertRequiredOEmbedData(oembed) {
  if (!oembed.thumbnail_url) {
    throw new Error("Flickr oEmbed did not return thumbnail_url");
  }
}

async function fetchOEmbed(photoUrl) {
  const endpoint = new URL("https://www.flickr.com/services/oembed/");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("url", photoUrl);

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Flickr oEmbed failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function getExistingPhotoIds() {
  const text = await readFile(photosPath, "utf8");
  const rows = text.trimEnd().split(/\r?\n/);
  return new Set(rows.slice(1).map((row) => row.split(",", 1)[0]));
}

function assertPhotoIsNew(photoId, existingIds) {
  if (existingIds.has(photoId)) {
    throw new Error(`Photo ${photoId} already exists in ${photosPath}`);
  }
}

function validateDataAfterAppend() {
  const result = spawnSync(process.execPath, ["scripts/validate-data.mjs"], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error("data validation failed after append");
  }
}

async function main() {
  const { append, help, photoUrls } = parseArgs(process.argv);

  if (help || photoUrls.length === 0) {
    printUsage();
    process.exitCode = help ? 0 : 1;
    return;
  }

  const normalizedPhotos = photoUrls.map(normalizeFlickrUrl);
  const seenInputIds = new Set();
  for (const { photoId } of normalizedPhotos) {
    if (seenInputIds.has(photoId)) {
      throw new Error(`Photo ${photoId} was provided more than once`);
    }
    seenInputIds.add(photoId);
  }

  const existingIds = await getExistingPhotoIds();
  for (const { photoId } of normalizedPhotos) {
    assertPhotoIsNew(photoId, existingIds);
  }

  const rows = [];
  for (const { photoId, photoUrl } of normalizedPhotos) {
    const oembed = await fetchOEmbed(photoUrl);
    assertRequiredOEmbedData(oembed);

    const photo = {
      photo_id: photoId,
      photo_url: photoUrl,
      image_preview_url: oembed.thumbnail_url ?? "",
      photographer: oembed.author_name ?? "",
      internal_notes: oembed.title ? `Flickr title: ${oembed.title}` : "",
      curation_status: "unreviewed",
    };
    rows.push(toCsvRow(photo));
  }

  if (append) {
    await appendFile(photosPath, `${rows.join("\n")}\n`);
    console.log(`Added ${rows.length} Flickr photo row(s) to ${photosPath}`);
    validateDataAfterAppend();
  } else {
    console.log(rows.join("\n"));
  }
}

try {
  await main();
} catch (error) {
  console.error(`Could not add photo: ${error.message}`);
  process.exitCode = 1;
}
