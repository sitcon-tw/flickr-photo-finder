import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
});
