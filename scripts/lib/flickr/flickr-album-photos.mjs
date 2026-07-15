import { normalizeFlickrPhotoUrl } from "./flickr-intake.mjs";

const flickrApiEndpoint = "https://api.flickr.com/services/rest/";
const apiPerPage = 500;

class ExpectedPhotoCountError extends Error {}

export async function fetchAlbumHtml(albumUrl, fetchImpl = fetch) {
  const response = await fetchImpl(albumUrl);
  if (!response.ok) {
    throw new Error(`Flickr album fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function extractSiteKey(html) {
  return html.match(/root\.YUI_config\.flickr\.api\.site_key = "([^"]+)"/)?.[1] ?? "";
}

function extractUserNsid(html) {
  return html.match(/"nsid":"([0-9]+@N[0-9]+)"/)?.[1] ?? "";
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

function toPhotoUrls(photoIds, ownerPath) {
  return photoIds.map((photoId) =>
    normalizeFlickrPhotoUrl(`https://www.flickr.com/photos/${ownerPath}/${photoId}`),
  );
}

async function fetchApiAlbumPhotoUrls({ albumId, fetchImpl, html, ownerPath }) {
  const siteKey = extractSiteKey(html);
  const userId = extractUserNsid(html);

  if (!siteKey) {
    return null;
  }

  const photoIds = [];
  let page = 1;
  let pages = 1;
  let total = 0;

  do {
    const endpoint = new URL(flickrApiEndpoint);
    endpoint.searchParams.set("method", "flickr.photosets.getPhotos");
    endpoint.searchParams.set("api_key", siteKey);
    endpoint.searchParams.set("photoset_id", albumId);
    if (userId) {
      endpoint.searchParams.set("user_id", userId);
    }
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("nojsoncallback", "1");
    endpoint.searchParams.set("per_page", String(apiPerPage));
    endpoint.searchParams.set("page", String(page));

    const response = await fetchImpl(endpoint);
    if (!response.ok) {
      throw new Error(`Flickr API album photos fetch failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.stat !== "ok") {
      throw new Error(`Flickr API album photos error: ${data.message ?? data.stat}`);
    }

    const photoset = data.photoset ?? {};
    pages = Number(photoset.pages ?? 1);
    total = Number(photoset.total ?? total);

    for (const photo of photoset.photo ?? []) {
      if (photo.id) {
        photoIds.push(photo.id);
      }
    }

    page += 1;
  } while (page <= pages);

  if (photoIds.length !== total) {
    throw new ExpectedPhotoCountError(
      `Album ${albumId} API reported ${total} photo(s), but returned ${photoIds.length}. Refusing to create an incomplete intake artifact.`,
    );
  }

  return {
    apiKey: siteKey,
    authoritative: true,
    photoUrls: toPhotoUrls(photoIds, ownerPath),
    source: "flickr-api",
    total,
  };
}

function assertExpectedCount({ albumId, expectedPhotoCount, photoUrls, source }) {
  if (!Number.isInteger(expectedPhotoCount) || expectedPhotoCount < 1) {
    return;
  }

  if (photoUrls.length !== expectedPhotoCount) {
    throw new ExpectedPhotoCountError(
      `Album ${albumId} expected ${expectedPhotoCount} photo(s), but ${source} returned ${photoUrls.length}. Refusing to create an incomplete intake artifact.`,
    );
  }
}

export async function fetchAlbumPhotoUrls({
  albumId,
  albumUrl,
  expectedPhotoCount = 0,
  fetchImpl = fetch,
  html = "",
  ownerPath,
} = {}) {
  if (!albumId) {
    throw new Error("fetchAlbumPhotoUrls requires albumId");
  }
  if (!albumUrl && !html) {
    throw new Error("fetchAlbumPhotoUrls requires albumUrl or html");
  }
  if (!ownerPath) {
    throw new Error("fetchAlbumPhotoUrls requires ownerPath");
  }

  const sourceHtml = html || await fetchAlbumHtml(albumUrl, fetchImpl);

  try {
    const apiResult = await fetchApiAlbumPhotoUrls({ albumId, fetchImpl, html: sourceHtml, ownerPath });
    if (apiResult && apiResult.photoUrls.length > 0) {
      return apiResult;
    }
  } catch (error) {
    if (error instanceof ExpectedPhotoCountError) {
      throw error;
    }
    console.error(`Flickr API album photo fetch failed, falling back to HTML parsing: ${error.message}`);
  }

  const htmlPhotoUrls = extractAlbumPhotoUrls(sourceHtml, ownerPath);
  assertExpectedCount({
    albumId,
    expectedPhotoCount,
    photoUrls: htmlPhotoUrls,
    source: "album HTML",
  });

  return {
    apiKey: extractSiteKey(sourceHtml),
    authoritative: false,
    photoUrls: htmlPhotoUrls,
    source: "album-html",
    total: htmlPhotoUrls.length,
  };
}

export async function fetchPhotoAlbumIds({ apiKey, fetchImpl = fetch, photoId } = {}) {
  if (!apiKey) {
    throw new Error("fetchPhotoAlbumIds requires apiKey");
  }
  if (!photoId) {
    throw new Error("fetchPhotoAlbumIds requires photoId");
  }

  const endpoint = new URL(flickrApiEndpoint);
  endpoint.searchParams.set("method", "flickr.photos.getAllContexts");
  endpoint.searchParams.set("api_key", apiKey);
  endpoint.searchParams.set("photo_id", photoId);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("nojsoncallback", "1");

  const response = await fetchImpl(endpoint);
  if (!response.ok) {
    throw new Error(`Flickr API photo contexts fetch failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (data.stat !== "ok") {
    if (Number(data.code) === 1) {
      return [];
    }
    throw new Error(`Flickr API photo contexts error: ${data.message ?? data.stat}`);
  }

  return (data.set ?? []).map((album) => String(album.id ?? "")).filter(Boolean);
}
