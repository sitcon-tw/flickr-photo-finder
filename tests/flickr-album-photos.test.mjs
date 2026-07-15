import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchAlbumPhotoUrls, fetchPhotoAlbumIds } from "../scripts/lib/flickr/flickr-album-photos.mjs";

const albumHtml = `
  <script>root.YUI_config.flickr.api.site_key = "site-key";</script>
  <script>{"nsid":"123@N45"}</script>
`;

function response(data) {
  return {
    ok: true,
    async json() {
      return data;
    },
  };
}

describe("Flickr ordered album inventory", () => {
  it("preserves paginated API order and trusts the current API total", async () => {
    const pages = [
      { photoset: { page: 1, pages: 2, total: 3, photo: [{ id: "3" }, { id: "2" }] }, stat: "ok" },
      { photoset: { page: 2, pages: 2, total: 3, photo: [{ id: "1" }] }, stat: "ok" },
    ];
    const result = await fetchAlbumPhotoUrls({
      albumId: "album-1",
      albumUrl: "https://www.flickr.com/photos/sitcon/albums/album-1",
      expectedPhotoCount: 99,
      fetchImpl: async (url) => String(url).includes("services/rest")
        ? response(pages.shift())
        : { ok: true, async text() { return albumHtml; } },
      ownerPath: "sitcon",
    });

    assert.equal(result.authoritative, true);
    assert.equal(result.total, 3);
    assert.deepEqual(result.photoUrls.map((photo) => photo.photoId), ["3", "2", "1"]);
  });

  it("rejects incomplete API pagination", async () => {
    await assert.rejects(
      fetchAlbumPhotoUrls({
        albumId: "album-1",
        albumUrl: "https://www.flickr.com/photos/sitcon/albums/album-1",
        fetchImpl: async (url) => String(url).includes("services/rest")
          ? response({ photoset: { pages: 1, total: 2, photo: [{ id: "1" }] }, stat: "ok" })
          : { ok: true, async text() { return albumHtml; } },
        ownerPath: "sitcon",
      }),
      /reported 2 photo\(s\), but returned 1/,
    );
  });

  it("returns visible album contexts and distinguishes a missing photo", async () => {
    const found = await fetchPhotoAlbumIds({
      apiKey: "site-key",
      fetchImpl: async () => response({ set: [{ id: "a2" }, { id: "a1" }], stat: "ok" }),
      photoId: "1",
    });
    const missing = await fetchPhotoAlbumIds({
      apiKey: "site-key",
      fetchImpl: async () => response({ code: 1, message: "Photo not found", stat: "fail" }),
      photoId: "2",
    });

    assert.deepEqual(found, { albumIds: ["a2", "a1"], found: true });
    assert.deepEqual(missing, { albumIds: [], found: false });
  });
});
