import { URL } from "node:url";
import {
  appendCsvRows,
  assertUniqueInputPhotoIds,
  buildCsvRows,
  filterNewPhotos,
  getExistingPhotoIds,
  normalizeFlickrPhotoUrl,
  photosPath,
  validateData,
} from "./flickr-intake.mjs";

function printUsage() {
  console.log(`Usage:
  npm run album:add -- <flickr-album-url>
  npm run album:add -- <flickr-album-url> --append

Options:
  --append  Append missing album photo rows to data/photos.csv and validate data.

Without --append, the command reports album coverage and prints missing photo
URLs. With --append, it imports the missing photos using Flickr oEmbed.`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const append = args.includes("--append");
  const help = args.includes("--help") || args.includes("-h");
  const albumUrl = args.find((arg) => !arg.startsWith("--"));

  return { append, help, albumUrl };
}

function normalizeFlickrAlbumUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }

  if (!["www.flickr.com", "flickr.com"].includes(url.hostname)) {
    throw new Error(`Expected a flickr.com URL, got: ${url.hostname}`);
  }

  const match = url.pathname.match(/\/photos\/([^/]+)\/albums\/(\d+)/);
  if (!match) {
    throw new Error(`Could not find a Flickr album ID in URL: ${value}`);
  }

  url.hash = "";
  url.search = "";

  return {
    ownerPath: match[1],
    albumId: match[2],
    albumUrl: url.toString(),
  };
}

async function fetchAlbumHtml(albumUrl) {
  const response = await fetch(albumUrl);
  if (!response.ok) {
    throw new Error(`Flickr album fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function extractAlbumPhotoUrls(html, ownerPath) {
  const pattern = new RegExp(`photos/${ownerPath}/([0-9]+)`, "g");
  const photoIds = [];
  const seen = new Set();
  let match;

  while ((match = pattern.exec(html)) !== null) {
    const photoId = match[1];
    if (!seen.has(photoId)) {
      seen.add(photoId);
      photoIds.push(photoId);
    }
  }

  return photoIds.map((photoId) =>
    normalizeFlickrPhotoUrl(`https://www.flickr.com/photos/${ownerPath}/${photoId}`),
  );
}

async function main() {
  const { append, help, albumUrl: inputUrl } = parseArgs(process.argv);

  if (help || !inputUrl) {
    printUsage();
    process.exitCode = help ? 0 : 1;
    return;
  }

  const { ownerPath, albumId, albumUrl } = normalizeFlickrAlbumUrl(inputUrl);
  const html = await fetchAlbumHtml(albumUrl);
  const albumPhotos = extractAlbumPhotoUrls(html, ownerPath);
  assertUniqueInputPhotoIds(albumPhotos);

  if (albumPhotos.length === 0) {
    throw new Error(`No photo URLs found in album ${albumId}`);
  }

  const existingIds = await getExistingPhotoIds();
  const missingPhotos = filterNewPhotos(albumPhotos, existingIds);
  const importedCount = albumPhotos.length - missingPhotos.length;

  console.log(`Album ${albumId}: ${albumPhotos.length} photo(s), ${importedCount} already indexed, ${missingPhotos.length} missing.`);

  if (!append) {
    for (const { photoUrl } of missingPhotos) {
      console.log(photoUrl);
    }
    return;
  }

  if (missingPhotos.length === 0) {
    console.log(`No missing photos to add to ${photosPath}.`);
    return;
  }

  const rows = await buildCsvRows(missingPhotos);
  await appendCsvRows(rows);
  console.log(`Added ${rows.length} Flickr album photo row(s) to ${photosPath}`);
  validateData();
}

try {
  await main();
} catch (error) {
  console.error(`Could not add album: ${error.message}`);
  process.exitCode = 1;
}
