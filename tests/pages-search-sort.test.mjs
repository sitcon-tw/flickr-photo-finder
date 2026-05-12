import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAiAssistantPrompt } from "../app/ai-assistant.js";
import { candidateCopyText, candidateMarkdown, selectedPhotos } from "../app/candidates.js";
import { activeFilterEntries, albumFilterOptions } from "../app/controls.js";
import { buildOptionLabelMaps, createSearchTokenBuilder, normalizePhotoRows } from "../app/data-loader.js";
import { photoTitle, sheetRowLink } from "../app/photo-render.js";
import { resultContextText } from "../app/result-render.js";
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

  it("builds purpose-specific candidate copy text", () => {
    const items = [
      photo({
        photo_id: "100",
        event_name: "SITCON 2026",
        photo_url: "https://www.flickr.com/photos/sitcon/100",
        curation_status: "ai_labeled",
        public_use_status: "needs_review",
        _sheet_row_number: 28,
      }),
      photo({
        photo_id: "200",
        event_name: "SITCON 2025",
        photo_url: "https://www.flickr.com/photos/sitcon/200",
        curation_status: "reviewed",
        public_use_status: "",
        _sheet_row_number: 29,
      }),
    ];
    const helpers = {
      photoTitle: (item) => item.event_name,
      finderLink: (item) => `https://finder.test/#photo-${item.photo_id}`,
      candidateListLink: () => "https://finder.test/?selected=100%2C200",
      sheetRowLink: (item) => `https://sheet.test/A${item._sheet_row_number}`,
      labelFor: (_field, value) => value,
    };

    const imText = candidateCopyText(items, helpers, "im");
    assert.match(imText, /^候選照片:/);
    assert.match(imText, /1\. https:\/\/www\.flickr\.com\/photos\/sitcon\/100/);
    assert.match(imText, /2\. https:\/\/www\.flickr\.com\/photos\/sitcon\/200/);
    assert.match(imText, /提醒: needs_review/);
    assert.doesNotMatch(imText, /SITCON 2026/);
    assert.doesNotMatch(imText, /Sheets:/);
    assert.doesNotMatch(imText, /Finder 清單:/);

    const collaborationText = candidateCopyText(items, helpers, "collaboration");
    assert.match(collaborationText, /Finder 清單: https:\/\/finder\.test\/\?selected=100%2C200/);
    assert.match(collaborationText, /Sheets: https:\/\/sheet\.test\/A28/);
    assert.match(collaborationText, /整理: ai_labeled \/ 使用提醒: needs_review/);

    const urlText = candidateCopyText(items, helpers, "flickr_urls");
    assert.equal(
      urlText,
      "https://www.flickr.com/photos/sitcon/100\nhttps://www.flickr.com/photos/sitcon/200",
    );
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

  it("builds album filter options from ids and title fallbacks", () => {
    const options = albumFilterOptions([
      photo({ album_ids: ["a1"], album_title: "主議程", event_year: "2026", event_name: "SITCON" }),
      photo({ album_ids: [], album_title: "工作人員側拍", event_year: "2025", event_name: "SITCON" }),
    ]);

    assert.deepEqual(
      options.map((option) => option.value),
      ["title:工作人員側拍", "id:a1"],
    );
    assert.match(options[1].label, /2026/);
    assert.match(options[1].label, /主議程/);
  });

  it("shapes active filter entries for AI prompts and filter chips", () => {
    const select = (value, text) => ({ value, selectedOptions: [{ textContent: text }] });
    const entries = activeFilterEntries({
      state: { taskMode: "social" },
      activeTask: socialTask,
      controls: {
        search: { value: "  講者  " },
        album: select("id:1", "SITCON 2026"),
        use: select("", ""),
        mood: select("", ""),
        scene: select("交流", "交流"),
        peopleCount: select("", ""),
        subjectType: select("", ""),
        orientation: select("", ""),
        negativeSpace: select("", ""),
        safeCrop: select("", ""),
        sponsorshipTag: select("", ""),
        publicStatus: select("", ""),
        priority: select("", ""),
        curationStatus: select("", ""),
        collection: select("", ""),
        sponsorshipItem: { value: "攤位" },
      },
    });

    assert.deepEqual(entries, [
      ["task", "任務", "社群貼文"],
      ["search", "搜尋", "講者"],
      ["album", "活動/相簿", "SITCON 2026"],
      ["scene", "場景", "交流"],
      ["sponsorshipItem", "贊助品項", "攤位"],
    ]);
  });

  it("builds photo titles and Sheets row links for card actions", () => {
    const item = photo({
      photo_id: "123",
      event_name: "",
      album_title: "",
      curation_notes: "Flickr title: SITCON stage photo.",
      _sheet_row_number: 42,
    });
    const link = sheetRowLink(item, {
      googleSheets: {
        spreadsheetId: "sheet-1",
        photosSheetGid: 7,
      },
    });

    assert.equal(photoTitle(item), "SITCON stage photo");
    assert.equal(link, "https://docs.google.com/spreadsheets/d/sheet-1/edit?gid=7#gid=7&range=A42");
  });

  it("describes result context from sort mode and active filters", () => {
    const text = resultContextText({
      photos: [photo({ photo_id: "1" })],
      filtered: [photo({ photo_id: "1" })],
      controls: { sort: { value: "discover" } },
      activeTask: () => socialTask,
      activeFilterEntries: () => [
        ["task", "任務", "社群貼文"],
        ["scene", "場景", "交流"],
      ],
    });

    assert.match(text, /探索更多排序/);
    assert.match(text, /已套用：場景 交流/);
  });
});
