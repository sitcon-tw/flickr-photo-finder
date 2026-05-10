import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { parseCsv } from "../core/csv-utils.mjs";
import { albumHeaders } from "../core/photo-schema.mjs";
import { flickrAlbumsUrl, flickrOwnerPath, organizationName } from "../core/project-config.mjs";

export const albumsPath = "fixtures/albums.csv";
export { flickrAlbumsUrl, flickrOwnerPath };

export function normalizeFlickrAlbumUrl(value) {
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

  const ownerPath = match[1];
  if (ownerPath !== flickrOwnerPath) {
    throw new Error(`Expected a ${organizationName} Flickr album URL, got owner path: ${ownerPath}`);
  }

  url.hash = "";
  url.search = "";

  return {
    ownerPath,
    albumId: match[2],
    albumUrl: url.toString(),
  };
}

export async function readAlbumCatalog(path = albumsPath) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const [headers, ...rows] = parseCsv(text);
  if (!headers) {
    return [];
  }

  return rows.map((row) =>
    Object.fromEntries(albumHeaders.map((header, index) => [header, row[index] ?? ""])),
  );
}

export async function resolveAlbumInput(input, path = albumsPath) {
  if (/^\d+$/.test(input)) {
    const albums = await readAlbumCatalog(path);
    const album = albums.find((item) => item.album_id === input);
    if (!album) {
      throw new Error(
        `Album ${input} not found in ${path}. Run pnpm albums:discover -- --write first, or provide the full Flickr album URL.`,
      );
    }
    return normalizeFlickrAlbumUrl(album.album_url);
  }

  return normalizeFlickrAlbumUrl(input);
}
