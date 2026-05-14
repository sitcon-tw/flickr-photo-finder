import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  peopleCountSpikeRows,
  peopleCountStats,
  reasonReuseRows,
} from "../scripts/commands/review-ai-run.mjs";
import {
  buildPeopleCountPairSummary,
  peopleCountDistribution,
  runQualityStatus,
} from "../scripts/commands/build-ai-report.mjs";

function item(photoId, fields) {
  return { fields, photo_id: photoId };
}

function peopleItem(photoId, count, reason = "畫面中可見多人坐在桌邊。") {
  return item(photoId, {
    people_count: {
      reason,
      value: count,
    },
  });
}

describe("AI bulk quality guards", () => {
  it("summarizes people_count distribution and detects run-level middle-value spikes", () => {
    const items = [
      ...Array.from({ length: 40 }, (_, index) => peopleItem(`p5-${index}`, 5)),
      ...Array.from({ length: 160 }, (_, index) => peopleItem(`p1-${index}`, index % 20)),
    ];
    const rows = peopleCountSpikeRows(items, [], new Map());
    const stats = peopleCountStats(items);

    assert.equal(stats.count, 200);
    assert.equal(stats.topValues[0].value, 5);
    assert.ok(rows.some((row) => row[0] === "run" && row[3] === 5 && row[4] === 48));
  });

  it("detects album-level people_count concentration", () => {
    const items = [
      ...Array.from({ length: 18 }, (_, index) => peopleItem(`a-${index}`, 5)),
      ...Array.from({ length: 4 }, (_, index) => peopleItem(`b-${index}`, index + 1)),
    ];
    const photos = items.map((entry) => ({
      album_title: "集中相簿",
      photo_id: entry.photo_id,
    }));
    const rows = peopleCountSpikeRows(items, photos, new Map());

    assert.ok(rows.some((row) => row[0] === "album" && row[1] === "集中相簿" && row[3] === 5));
  });

  it("reports reason reuse by field", () => {
    const items = Array.from({ length: 8 }, (_, index) => peopleItem(`same-${index}`, 5, "畫面中可見約五人合照。"));
    const rows = reasonReuseRows(items);
    const peopleRow = rows.find((row) => String(row[0]).includes("people_count"));

    assert.ok(peopleRow);
    assert.equal(peopleRow[1], 8);
    assert.equal(peopleRow[2], 1);
    assert.equal(peopleRow[3], 8);
  });

  it("flags people_count spike distribution for reports", () => {
    const items = [
      ...Array.from({ length: 40 }, (_, index) => peopleItem(`p5-${index}`, 5)),
      ...Array.from({ length: 160 }, (_, index) => peopleItem(`p1-${index}`, index % 20)),
    ];
    const distribution = peopleCountDistribution(items);

    assert.ok(distribution.spike_values.some((entry) => entry.value === 5));
  });

  it("summarizes paired people_count deltas across runs", () => {
    const photos = [
      {
        attempts: [
          { fields: { people_count: { value: 5 } } },
          { fields: { people_count: { value: 25 } } },
        ],
        photo_id: "delta",
      },
      {
        attempts: [
          { fields: { people_count: { value: 3 } } },
          { fields: { people_count: { value: 3 } } },
        ],
        photo_id: "same",
      },
    ];

    const summary = buildPeopleCountPairSummary(photos, ["first", "second"]);

    assert.equal(summary.paired_count, 2);
    assert.equal(summary.exact_match_count, 1);
    assert.equal(summary.large_delta_count, 1);
    assert.equal(summary.extreme_delta_count, 1);
    assert.equal(summary.top_deltas[0].photo_id, "delta");
  });

  it("classifies run quality status for comparison reports", () => {
    assert.equal(runQualityStatus({ isReviewSummaryStale: false, validation: { status: "invalid", warning_count: 0 } }), "invalid");
    assert.equal(runQualityStatus({ isReviewSummaryStale: true, validation: { status: "valid", warning_count: 0 } }), "stale-review");
    assert.equal(runQualityStatus({ isReviewSummaryStale: false, validation: { status: "valid", warning_count: 3 } }), "valid-with-warnings");
    assert.equal(runQualityStatus({ isReviewSummaryStale: false, validation: { status: "valid", warning_count: 0 } }), "valid");
  });
});
