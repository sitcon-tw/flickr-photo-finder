import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCsvRows } from "../scripts/lib/flickr/flickr-intake.mjs";
import { createProgressThrottle, progressIntervalMs } from "../scripts/lib/core/progress.mjs";

describe("CLI progress throttle", () => {
  it("reports changed completion counts at the interval or when forced", () => {
    let currentTime = 100;
    const shouldReport = createProgressThrottle({ now: () => currentTime });

    assert.equal(shouldReport(1), false);
    currentTime += progressIntervalMs - 1;
    assert.equal(shouldReport(2), false);
    currentTime += 1;
    assert.equal(shouldReport(2), true);
    currentTime += progressIntervalMs;
    assert.equal(shouldReport(2), false);
    assert.equal(shouldReport(3, { force: true }), true);
    assert.equal(shouldReport(3, { force: true }), false);
  });

  it("reports Flickr metadata progress only after a row is complete", async (context) => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => ({
      ok: true,
      async json() {
        fetchCount += 1;
        return fetchCount === 1
          ? { thumbnail_url: "https://live.staticflickr.com/1/1_test.jpg", title: "Test photo" }
          : {};
      },
    });
    context.after(() => {
      globalThis.fetch = originalFetch;
    });

    const progress = [];
    await assert.rejects(
      buildCsvRows([
        { photoId: "1", photoUrl: "https://www.flickr.com/photos/sitcon/1/" },
        { photoId: "2", photoUrl: "https://www.flickr.com/photos/sitcon/2/" },
      ], {}, {
        onProgress: (entry) => progress.push(entry),
      }),
      /thumbnail_url/,
    );

    assert.deepEqual(progress, [{ current: 1, photoId: "1", total: 2 }]);
  });
});
