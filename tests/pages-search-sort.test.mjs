import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAiAssistantPrompt } from "../app/ai-assistant.js";
import { candidateMarkdown, selectedPhotos } from "../app/candidates.js";
import { buildOptionLabelMaps, createSearchTokenBuilder, normalizePhotoRows } from "../app/data-loader.js";
import {
  buildSearchText,
  filterAndSortPhotos,
  photoScore,
  sortForDiscovery,
  sortPhotos,
  uniqueSearchTokens,
} from "../app/search-sort.js";
import { decodeUrlState, encodeUrlState } from "../app/url-state.js";

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

  it("builds AI assistant prompts from explicit finder state", () => {
    const prompt = buildAiAssistantPrompt({
      sheetUrl: "https://docs.google.com/spreadsheets/d/example/edit",
      taskLabel: "網站橫幅",
      searchValue: "有留白的講者",
      filterEntries: [
        ["task", "任務", "網站橫幅"],
        ["orientation", "方向", "橫式"],
      ],
    });

    assert.match(prompt, /網站橫幅/);
    assert.match(prompt, /有留白的講者/);
    assert.match(prompt, /方向: 橫式/);
    assert.match(prompt, /不要自行推測/);
  });

  it("round-trips URL state without default noise", () => {
    const params = encodeUrlState({
      taskMode: "hero",
      search: " 講者 ",
      sort: "recommended",
      album: "id:123",
      selectedPhotoIds: new Set(["100", "200"]),
    });

    assert.equal(params.get("sort"), null);
    assert.equal(params.get("q"), "講者");
    assert.equal(params.get("selected"), "100,200");
    assert.deepEqual(decodeUrlState(params), {
      taskMode: "hero",
      search: "講者",
      sort: "",
      album: "id:123",
      use: "",
      mood: "",
      scene: "",
      peopleCount: "",
      subjectType: "",
      orientation: "",
      negativeSpace: "",
      safeCrop: "",
      sponsorshipTag: "",
      sponsorshipItem: "",
      publicStatus: "",
      priority: "",
      curationStatus: "",
      collection: "",
      selectedPhotoIds: ["100", "200"],
    });
  });

  it("builds candidate markdown from selected photos", () => {
    const items = [
      photo({ photo_id: "100", event_name: "SITCON 2026", public_use_status: "needs_review" }),
      photo({ photo_id: "200", event_name: "SITCON 2025" }),
    ];
    const selected = selectedPhotos(new Set(["200"]), items);
    const markdown = candidateMarkdown(selected[0], {
      photoTitle: (item) => item.event_name,
      finderLink: (item) => `https://finder.test/#photo-${item.photo_id}`,
      sheetRowLink: () => "https://sheet.test/",
      labelFor: (_field, value) => value,
    });

    assert.equal(selected.length, 1);
    assert.match(markdown, /SITCON 2025/);
    assert.match(markdown, /Finder: https:\/\/finder\.test\/#photo-200/);
  });

  it("normalizes CSV photo rows with schema list fields and search text", () => {
    const schema = {
      tables: {
        photos: {
          fields: [
            { name: "photo_id" },
            { name: "safe_crop", multi_value: true },
            { name: "missing_field" },
            { name: "has_negative_space" },
          ],
        },
      },
    };
    const optionLabelMaps = buildOptionLabelMaps({
      option_labels: {
        has_negative_space: { true: "有留白" },
      },
    });
    const searchTokensForField = createSearchTokenBuilder(optionLabelMaps, {
      has_negative_space: { true: ["negative space"] },
    });

    const rows = [
      ["photo_id", "safe_crop", "has_negative_space"],
      ["row-1", "16:9;1:1", "true"],
    ];
    const normalized = normalizePhotoRows(rows, schema, searchTokensForField);

    assert.deepEqual(normalized[0].safe_crop, ["16:9", "1:1"]);
    assert.equal(normalized[0].missing_field, "");
    assert.equal(normalized[0]._sheet_row_number, 2);
    assert.match(normalized[0].search_text, /negative space/);
  });
});
