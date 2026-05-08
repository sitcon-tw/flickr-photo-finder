import { normalizeFlickrPhotoUrl } from "./flickr-intake.mjs";

export async function fetchAlbumHtml(albumUrl) {
  const response = await fetch(albumUrl);
  if (!response.ok) {
    throw new Error(`Flickr album fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export function extractAlbumPhotoUrls(html, ownerPath) {
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
