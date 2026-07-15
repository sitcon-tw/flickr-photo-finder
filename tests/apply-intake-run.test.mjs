import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPlan, buildSheetRequests } from "../scripts/commands/apply-intake-run.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders } from "../scripts/lib/core/photo-schema.mjs";
import { photoStateSha256 } from "../scripts/lib/flickr/photo-reconciliation.mjs";

function row(headers, values) {
  return headers.map((header) => values[header] ?? "");
}

function record(headers, values) {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

function fakeSheets({ albums = [], batches = [], photos = [] } = {}) {
  const rows = {
    albums: [albumHeaders, ...albums],
    import_batches: [importBatchHeaders, ...batches],
    photos: [photoHeaders, ...photos],
  };
  return {
    spreadsheets: {
      values: {
        async get({ range }) {
          const sheetName = Object.keys(rows).find((name) => range.includes(name));
          return { data: { values: rows[sheetName] } };
        },
      },
    },
  };
}

const albumRecord = {
  album_id: "album-1",
  album_title: "New album",
  album_url: "https://www.flickr.com/photos/sitcon/albums/album-1",
  last_processed_at: "2026-07-15T00:00:00.000Z",
  photo_count: "1",
};

function artifacts({ albums = [albumRecord], photos = [] } = {}) {
  const photoRecords = photos.map((values) => record(photoHeaders, values));
  return {
    albumRecords: [albumRecord],
    albumRows: albums.map((album) => row(albumHeaders, album)),
    importBatchRecords: [{ batch_id: "batch-1" }],
    importBatchRows: [row(importBatchHeaders, { batch_id: "batch-1" })],
    photoRows: [],
    reconciliation: {
      album_photos: [{ album_id: "album-1", photo_ids: photoRecords.map((photo) => photo.photo_id) }],
      deleted_photo_ids: [],
      desired_photo_ids: photoRecords.map((photo) => photo.photo_id),
      membership_updates: [],
      new_photo_ids: [],
      source_state_sha256: photoStateSha256(photoRecords),
    },
    summary: {
      album_id: "album-1",
      reordered_photo_count: 0,
      run_id: "run-1",
      scope: "album",
    },
  };
}

describe("intake Sheets reconciliation plan", () => {
  it("adds a missing album and positions it in catalog order", async () => {
    const existingAlbum = { album_id: "album-2", album_title: "Older album" };
    const input = artifacts({ albums: [albumRecord, existingAlbum] });
    const plan = await buildPlan(
      fakeSheets({ albums: [row(albumHeaders, existingAlbum)] }),
      "spreadsheet-1",
      input,
    );

    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.albumRowsToAppend, [row(albumHeaders, albumRecord)]);
    assert.deepEqual(plan.desiredAlbumIds, ["album-1", "album-2"]);
  });

  it("updates existing album counts and preserves current photos", async () => {
    const photo = row(photoHeaders, { album_ids: "album-1", photo_id: "photo-1" });
    const input = artifacts({ photos: [photo] });
    const plan = await buildPlan(
      fakeSheets({ albums: [row(albumHeaders, { ...albumRecord, last_processed_at: "", photo_count: "0" })], photos: [photo] }),
      "spreadsheet-1",
      input,
    );

    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.albumUpdates, [{
      albumId: "album-1",
      lastProcessedAt: albumRecord.last_processed_at,
      photoCount: "1",
      rowNumber: 2,
    }]);
    assert.deepEqual(plan.desiredPhotoIds, ["photo-1"]);
  });

  it("blocks a stale photo membership snapshot", async () => {
    const sourcePhoto = row(photoHeaders, { album_ids: "album-1", photo_id: "photo-1" });
    const livePhoto = row(photoHeaders, { album_ids: "album-2", photo_id: "photo-1" });
    const plan = await buildPlan(
      fakeSheets({ albums: [row(albumHeaders, albumRecord)], photos: [livePhoto] }),
      "spreadsheet-1",
      artifacts({ photos: [sourcePhoto] }),
    );

    assert.ok(plan.blockers.some((blocker) => blocker.includes("state changed")));
  });

  it("uses a temporary native sort key and removes orphan rows", async () => {
    const photos = [
      row(photoHeaders, { album_ids: "album-1", photo_id: "photo-2" }),
      row(photoHeaders, { album_ids: "album-1", photo_id: "photo-1" }),
    ];
    const input = artifacts({ photos });
    input.reconciliation.desired_photo_ids = ["photo-1"];
    input.reconciliation.deleted_photo_ids = ["photo-2"];
    input.summary.reordered_photo_count = 1;
    const plan = await buildPlan(
      fakeSheets({ albums: [row(albumHeaders, albumRecord)], photos }),
      "spreadsheet-1",
      input,
    );
    const requests = buildSheetRequests(plan, { albums: 2, import_batches: 3, photos: 1 });

    assert.ok(requests.some((request) => request.sortRange));
    assert.ok(requests.some((request) => request.deleteDimension?.range?.dimension === "ROWS"));
    assert.equal(requests.filter((request) => request.deleteDimension?.range?.dimension === "COLUMNS").length, 1);
  });
});
