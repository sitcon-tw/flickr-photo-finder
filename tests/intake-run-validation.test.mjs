import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { toCsvLine } from "../scripts/lib/core/csv-utils.mjs";
import { albumHeaders, importBatchHeaders, photoHeaders } from "../scripts/lib/core/photo-schema.mjs";
import { validateIntakeRun } from "../scripts/commands/validate-intake-run.mjs";

function csv(headers, records) {
  return `${headers.join(",")}\n${records.map((record) => toCsvLine(headers, record)).join("\n")}\n`;
}

describe("intake reconciliation artifact validation", () => {
  it("accepts matching reconciliation, CSV, and summary counts", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "intake-validation-"));
    const createdAt = "2026-07-15T00:00:00.000Z";
    const outputs = {
      albums_updated: join(runDir, "albums-updated.csv"),
      import_batch: join(runDir, "import-batch.csv"),
      photos_to_append: join(runDir, "photos-to-append.csv"),
      reconciliation: join(runDir, "reconciliation.json"),
      summary: join(runDir, "summary.json"),
    };

    await Promise.all([
      writeFile(outputs.photos_to_append, csv(photoHeaders, [{
        album_ids: "a1",
        album_title: "Album",
        curation_status: "unreviewed",
        image_preview_url: "https://live.staticflickr.com/1/2.jpg",
        photo_id: "p2",
        photo_url: "https://www.flickr.com/photos/sitcon/2",
      }])),
      writeFile(outputs.albums_updated, csv(albumHeaders, [{
        album_id: "a1",
        album_title: "Album",
        album_url: "https://www.flickr.com/photos/sitcon/albums/a1",
        last_processed_at: createdAt,
        photo_count: "2",
      }])),
      writeFile(outputs.import_batch, csv(importBatchHeaders, [{
        album_id: "a1",
        album_url: "https://www.flickr.com/photos/sitcon/albums/a1",
        batch_id: "batch-1",
        found_photo_count: "2",
        imported_at: createdAt,
        new_photo_count: "1",
        skipped_photo_count: "1",
        source_tool: "pnpm intake:run",
      }])),
      writeFile(outputs.reconciliation, `${JSON.stringify({
        album_order: ["a1"],
        album_photos: [{ album_id: "a1", photo_ids: ["p1", "p2"] }],
        artifact_version: 1,
        counts: { deleted: 0, membership_updated: 0, new: 1, reordered: 0 },
        deleted_photo_ids: [],
        desired_photo_ids: ["p1", "p2"],
        membership_updates: [],
        new_photo_ids: ["p2"],
        scope: "album",
        source_state_sha256: "0".repeat(64),
      })}\n`),
      writeFile(outputs.summary, `${JSON.stringify({
        album_id: "a1",
        album_title: "Album",
        album_url: "https://www.flickr.com/photos/sitcon/albums/a1",
        created_at: createdAt,
        deleted_photo_count: 0,
        found_photo_count: 2,
        membership_update_count: 0,
        new_photo_count: 1,
        operator: "test",
        outputs,
        reordered_photo_count: 0,
        run_id: "run-1",
        scope: "album",
        skipped_photo_count: 1,
        source_tool: "pnpm intake:run",
      })}\n`),
    ]);

    const result = await validateIntakeRun(runDir, { validateCsv: false });
    assert.equal(result.summary.new_photo_count, 1);
  });
});
