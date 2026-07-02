import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adjacentPhoto, horizontalSwipeStep } from "../app/preview-navigation.js";

const photos = [{ photo_id: "a" }, { photo_id: "b" }, { photo_id: "c" }];

describe("photo preview navigation", () => {
  it("finds adjacent photos without wrapping", () => {
    assert.equal(adjacentPhoto(photos, "b", 1).photo_id, "c");
    assert.equal(adjacentPhoto(photos, "b", -1).photo_id, "a");
    assert.equal(adjacentPhoto(photos, "a", -1), null);
    assert.equal(adjacentPhoto(photos, "c", 1), null);
    assert.equal(adjacentPhoto(photos, "missing", 1), null);
  });

  it("turns horizontal swipes into preview steps", () => {
    assert.equal(horizontalSwipeStep({ startX: 120, startY: 40, endX: 40, endY: 44 }), 1);
    assert.equal(horizontalSwipeStep({ startX: 40, startY: 40, endX: 120, endY: 44 }), -1);
  });

  it("ignores short or vertical swipes", () => {
    assert.equal(horizontalSwipeStep({ startX: 40, startY: 40, endX: 70, endY: 42 }), 0);
    assert.equal(horizontalSwipeStep({ startX: 40, startY: 40, endX: 95, endY: 110 }), 0);
  });
});
