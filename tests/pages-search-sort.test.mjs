import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSearchText,
  filterAndSortPhotos,
  photoScore,
  sortForDiscovery,
  sortPhotos,
  uniqueSearchTokens,
} from "../app/search-sort.js";

const socialTask = {
  id: "social",
  label: "社群貼文",
  recommendedUses: ["社群貼文"],
  moods: ["友善"],
  scenes: ["交流"],
  safeCrops: ["1:1"],
  prefersNegativeSpace: true,
};

function photo(overrides = {}) {
  return {
    photo_id: "p0",
    photo_url: "",
    album_ids: [],
    album_title: "",
    event_name: "",
    event_year: "2026",
    people_count: "",
    subject_type: "",
    photographer: "",
    license: "",
    visual_description: "",
    curation_notes: "",
    scene_tags: [],
    mood_tags: [],
    recommended_uses: [],
    sponsorship_items: [],
    sponsorship_tags: [],
    collections: [],
    safe_crop: [],
    has_negative_space: "",
    orientation: "",
    public_use_status: "approved",
    priority_level: "normal",
    curation_status: "reviewed",
    image_preview_url: "https://example.test/image.jpg",
    search_text: "",
    ...overrides,
  };
}

function withSearchText(item) {
  return {
    ...item,
    search_text: buildSearchText(item, {
      searchTokensForField: (fieldName, value) =>
        uniqueSearchTokens(fieldName, value, new Map([["true", "有留白"]]), {
          has_negative_space: { true: ["negative space"] },
        }),
    }),
  };
}

describe("Pages search/sort pure logic", () => {
  it("downgrades avoid photos without excluding them", () => {
    const approved = withSearchText(photo({ photo_id: "approved", public_use_status: "approved" }));
    const avoid = withSearchText(photo({ photo_id: "avoid", public_use_status: "avoid" }));

    const results = filterAndSortPhotos([avoid, approved], { task: socialTask });

    assert.deepEqual(
      results.map((item) => item.photo_id),
      ["approved", "avoid"],
    );
    assert.ok(photoScore(approved, socialTask) > photoScore(avoid, socialTask));
  });

  it("keeps ai_labeled photos discoverable", () => {
    const aiLabeled = withSearchText(photo({ photo_id: "ai", curation_status: "ai_labeled" }));
    const unreviewed = withSearchText(photo({ photo_id: "raw", curation_status: "unreviewed" }));

    const results = filterAndSortPhotos([unreviewed, aiLabeled], {
      sortMode: "discover",
      task: socialTask,
    });

    assert.ok(results.some((item) => item.photo_id === "ai"));
  });

  it("uses task mode matches in recommended sorting", () => {
    const taskMatch = withSearchText(
      photo({
        photo_id: "task-match",
        recommended_uses: ["社群貼文"],
        mood_tags: ["友善"],
        scene_tags: ["交流"],
        safe_crop: ["1:1"],
        has_negative_space: "true",
      }),
    );
    const generic = withSearchText(photo({ photo_id: "generic" }));

    const results = sortPhotos([generic, taskMatch], { task: socialTask });

    assert.equal(results[0].photo_id, "task-match");
  });

  it("spreads discovery results across event and collection sources", () => {
    const sameSourceA = withSearchText(photo({ photo_id: "a", event_name: "SITCON", collections: ["stage"] }));
    const sameSourceB = withSearchText(photo({ photo_id: "b", event_name: "SITCON", collections: ["stage"] }));
    const differentSource = withSearchText(photo({ photo_id: "c", event_name: "COSCUP", collections: ["booth"] }));

    const results = sortForDiscovery([sameSourceA, sameSourceB, differentSource], {
      task: socialTask,
      discoverHistorySize: 2,
      discoverWindowSize: 3,
    });

    assert.deepEqual(
      results.map((item) => item.photo_id),
      ["a", "c", "b"],
    );
  });

  it("builds search text with field labels and aliases", () => {
    const item = withSearchText(photo({ photo_id: "space", has_negative_space: "true" }));

    const results = filterAndSortPhotos([item], {
      filters: { search: "放字" },
      task: socialTask,
    });

    assert.deepEqual(
      results.map((result) => result.photo_id),
      ["space"],
    );
  });
});
