import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPlan } from "../scripts/commands/apply-intake-run.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders } from "../scripts/lib/core/photo-schema.mjs";

function row(headers, values) {
  return headers.map((header) => values[header] ?? "");
}

function fakeSheets({ albums = [] } = {}) {
  const rows = {
    albums: [albumHeaders, ...albums],
    import_batches: [importBatchHeaders],
    photos: [photoHeaders],
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
  last_processed_at: "2026-07-13T00:00:00.000Z",
  photo_count: "1",
};

const artifacts = {
  albumRecord,
  importBatchRecord: { batch_id: "batch-1" },
  importBatchRow: row(importBatchHeaders, { batch_id: "batch-1" }),
  photoRows: [row(photoHeaders, { photo_id: "photo-1" })],
  summary: { album_id: "album-1", album_title: "New album", run_id: "run-1" },
};

describe("intake Sheets plan", () => {
  it("appends the intake album when it is missing from Sheets", async () => {
    const plan = await buildPlan(fakeSheets(), "spreadsheet-1", artifacts);

    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.newAlbumRowsToAppend, [row(albumHeaders, albumRecord)]);
    assert.equal(plan.albumLastProcessedRange, "");
  });

  it("keeps existing albums and only plans last_processed_at update", async () => {
    const plan = await buildPlan(
      fakeSheets({ albums: [row(albumHeaders, { ...albumRecord, last_processed_at: "" })] }),
      "spreadsheet-1",
      artifacts,
    );

    assert.deepEqual(plan.newAlbumRowsToAppend, []);
    assert.equal(plan.albumLastProcessedRange, "'albums'!G2");
  });
});
