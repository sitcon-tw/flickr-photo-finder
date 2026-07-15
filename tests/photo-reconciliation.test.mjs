import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPhotoReconciliation } from "../scripts/lib/flickr/photo-reconciliation.mjs";

const albumOrder = ["a1", "a2"];

describe("photo reconciliation", () => {
  it("builds a full baseline in album and Flickr order", () => {
    const result = buildPhotoReconciliation({
      albumOrder,
      inventories: [
        { albumId: "a1", photoIds: ["p2", "shared"] },
        { albumId: "a2", photoIds: ["shared", "p3"] },
      ],
      photos: [
        { photo_id: "p3", album_ids: "a2" },
        { photo_id: "shared", album_ids: "a2" },
        { photo_id: "gone", album_ids: "a1" },
      ],
      scope: "catalog",
    });

    assert.deepEqual(result.desired_photo_ids, ["p2", "shared", "p3"]);
    assert.deepEqual(result.new_photo_ids, ["p2"]);
    assert.deepEqual(result.deleted_photo_ids, ["gone"]);
    assert.deepEqual(
      result.membership_updates.find((update) => update.photo_id === "shared")?.after_album_ids,
      ["a1", "a2"],
    );
  });

  it("keeps another managed membership when a photo leaves the selected album", () => {
    const result = buildPhotoReconciliation({
      albumOrder,
      inventories: [{ albumId: "a1", photoIds: ["p1"] }],
      photos: [
        { photo_id: "p1", album_ids: "a1" },
        { photo_id: "moved", album_ids: "a1" },
        { photo_id: "p2", album_ids: "a2" },
      ],
      contextsByPhotoId: new Map([["moved", ["a2"]]]),
    });

    assert.deepEqual(result.deleted_photo_ids, []);
    assert.deepEqual(result.desired_photo_ids, ["p1", "moved", "p2"]);
    assert.deepEqual(result.membership_updates, [{
      after_album_ids: ["a2"],
      before_album_ids: ["a1"],
      photo_id: "moved",
    }]);
  });

  it("deletes an orphan and preserves the canonical album order for shared photos", () => {
    const result = buildPhotoReconciliation({
      albumOrder,
      inventories: [{ albumId: "a2", photoIds: ["shared", "p2"] }],
      photos: [
        { photo_id: "shared", album_ids: "a1;a2" },
        { photo_id: "orphan", album_ids: "a2" },
        { photo_id: "p1", album_ids: "a1" },
      ],
    });

    assert.deepEqual(result.deleted_photo_ids, ["orphan"]);
    assert.deepEqual(result.desired_photo_ids, ["shared", "p1", "p2"]);
  });
});
