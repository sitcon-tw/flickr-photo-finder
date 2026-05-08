import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { toCsvLine } from "./csv-utils.mjs";
import {
  albumsPath,
  sitconAlbumsUrl,
  sitconOwnerPath,
  readAlbumCatalog,
} from "./album-catalog.mjs";
import { albumHeaders } from "./photo-schema.mjs";

function printUsage() {
  console.log(`Usage:
  npm run albums:discover
  npm run albums:discover -- --write

Options:
  --write                 Merge discovered albums into data/albums.csv.
  --output <path>         CSV path to write when using --write. Default: data/albums.csv.
  --source-url <url>      Flickr albums page to fetch. Default: ${sitconAlbumsUrl}
  --input <html-file>     Read saved Flickr albums HTML as the discovery seed instead of fetching.

Without --write, the command prints a CSV preview and does not modify files.`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    help: false,
    input: "",
    output: albumsPath,
    sourceUrl: sitconAlbumsUrl,
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--write") {
      options.write = true;
    } else if (arg === "--input") {
      options.input = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--output") {
      options.output = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--source-url") {
      options.sourceUrl = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.output) {
    throw new Error("--output requires a path");
  }

  if (!options.sourceUrl) {
    throw new Error("--source-url requires a URL");
  }

  return options;
}

async function readSourceHtml({ input, sourceUrl }) {
  if (input) {
    return readFile(input, "utf8");
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Flickr albums fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

function extractSiteKey(html) {
  return html.match(/root\.YUI_config\.flickr\.api\.site_key = "([^"]+)"/)?.[1] ?? "";
}

function extractUserNsid(html) {
  return html.match(/"nsid":"([0-9]+@N[0-9]+)"/)?.[1] ?? "";
}

function getHtmlAttr(tag, attrName) {
  const pattern = new RegExp(`${attrName}=(["'])(.*?)\\1`, "i");
  return tag.match(pattern)?.[2] ?? "";
}

function upsertAlbum(albums, order, album) {
  if (!albums.has(album.album_id)) {
    order.push(album.album_id);
    albums.set(album.album_id, album);
    return;
  }

  const existing = albums.get(album.album_id);
  albums.set(album.album_id, {
    ...existing,
    ...Object.fromEntries(
      Object.entries(album).filter(([, value]) => String(value ?? "") !== ""),
    ),
  });
}

function extractModelAlbums(html, ownerPath) {
  const albums = [];
  const modelPattern =
    /"_flickrModelRegistry":"set-models","title":"((?:\\.|[^"\\])*)".*?"photoCount":(\d+).*?"id":"(\d+)"/gs;
  let match;

  while ((match = modelPattern.exec(html)) !== null) {
    const [, rawTitle, photoCount, albumId] = match;
    albums.push({
      album_id: albumId,
      album_url: `https://www.flickr.com/photos/${ownerPath}/albums/${albumId}`,
      album_title: decodeJsonString(rawTitle),
      photo_count: photoCount,
    });
  }

  return albums;
}

function extractAnchorAlbums(html, ownerPath) {
  const albums = [];
  const anchorPattern = /<a\b[^>]*>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) !== null) {
    const tag = match[0];
    const href = decodeHtmlEntities(getHtmlAttr(tag, "href"));
    const title = decodeHtmlEntities(getHtmlAttr(tag, "title")).trim();
    const escapedHref = href.replaceAll("\\/", "/");
    const albumMatch = escapedHref.match(
      new RegExp(`(?:https?:\\/\\/(?:www\\.)?flickr\\.com)?\\/photos\\/${ownerPath}\\/albums\\/(\\d+)\\/?`),
    );

    if (!albumMatch) {
      continue;
    }

    const albumId = albumMatch[1];
    albums.push({
      album_id: albumId,
      album_url: `https://www.flickr.com/photos/${ownerPath}/albums/${albumId}`,
      album_title: title,
    });
  }

  return albums;
}

function discoverAlbums(html, ownerPath = sitconOwnerPath) {
  const albums = new Map();
  const order = [];

  for (const album of extractModelAlbums(html, ownerPath)) {
    upsertAlbum(albums, order, album);
  }

  for (const album of extractAnchorAlbums(html, ownerPath)) {
    upsertAlbum(albums, order, album);
  }

  return order.map((albumId) => albums.get(albumId));
}

async function fetchApiAlbums({ html, ownerPath }) {
  const siteKey = extractSiteKey(html);
  const userId = extractUserNsid(html);

  if (!siteKey || !userId) {
    return [];
  }

  const albums = [];
  let page = 1;
  let pages = 1;

  do {
    const endpoint = new URL("https://api.flickr.com/services/rest/");
    endpoint.searchParams.set("method", "flickr.photosets.getList");
    endpoint.searchParams.set("api_key", siteKey);
    endpoint.searchParams.set("user_id", userId);
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("nojsoncallback", "1");
    endpoint.searchParams.set("per_page", "500");
    endpoint.searchParams.set("page", String(page));

    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error(`Flickr API fetch failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.stat !== "ok") {
      throw new Error(`Flickr API error: ${data.message ?? data.stat}`);
    }

    const photosets = data.photosets;
    pages = Number(photosets.pages ?? 1);

    for (const photoset of photosets.photoset ?? []) {
      albums.push({
        album_id: photoset.id,
        album_url: `https://www.flickr.com/photos/${ownerPath}/albums/${photoset.id}`,
        album_title: photoset.title?._content ?? "",
        photo_count: String(photoset.count_photos ?? photoset.photos ?? ""),
      });
    }

    page += 1;
  } while (page <= pages);

  return albums;
}

async function discoverAlbumsFromSource(html, ownerPath = sitconOwnerPath) {
  try {
    const apiAlbums = await fetchApiAlbums({ html, ownerPath });
    if (apiAlbums.length > 0) {
      return apiAlbums;
    }
  } catch (error) {
    console.error(`Flickr API discovery failed, falling back to HTML parsing: ${error.message}`);
  }

  return discoverAlbums(html, ownerPath);
}

function mergeWithExisting(discoveredAlbums, existingAlbums) {
  const existingById = new Map(existingAlbums.map((album) => [album.album_id, album]));
  const discoveredIds = new Set(discoveredAlbums.map((album) => album.album_id));

  const merged = discoveredAlbums.map((album) => {
    const existing = existingById.get(album.album_id) ?? {};
    return {
      album_id: album.album_id,
      album_url: album.album_url,
      album_title: album.album_title,
      event_name: existing.event_name ?? "",
      event_year: existing.event_year ?? "",
      photo_count: album.photo_count || existing.photo_count || "",
      last_processed_at: existing.last_processed_at ?? "",
      notes: existing.notes ?? "",
    };
  });

  for (const album of existingAlbums) {
    if (!discoveredIds.has(album.album_id)) {
      merged.push(album);
    }
  }

  return merged;
}

function toCsv(albums) {
  return [
    albumHeaders.join(","),
    ...albums.map((album) => toCsvLine(albumHeaders, album)),
  ].join("\n");
}

function validateData() {
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

function printPreview(albums) {
  console.log(toCsv(albums));
  console.error(`Discovered ${albums.length} SITCON Flickr album(s).`);
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const html = await readSourceHtml(options);
  const discoveredAlbums = await discoverAlbumsFromSource(html);

  if (discoveredAlbums.length === 0) {
    throw new Error("No SITCON Flickr albums were found in the source HTML");
  }

  if (!options.write) {
    printPreview(discoveredAlbums);
    return;
  }

  const existingAlbums = await readAlbumCatalog(options.output);
  const mergedAlbums = mergeWithExisting(discoveredAlbums, existingAlbums);
  await writeFile(options.output, `${toCsv(mergedAlbums)}\n`);
  console.log(`Wrote ${mergedAlbums.length} album row(s) to ${options.output}.`);
  if (options.output === albumsPath) {
    validateData();
  } else {
    console.log(`Skipped repo validation because --output is not ${albumsPath}.`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`Could not discover albums: ${error.message}`);
  process.exitCode = 1;
}
