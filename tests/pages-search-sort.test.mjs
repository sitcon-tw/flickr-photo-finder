import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAiAssistantPrompt } from "../app/ai-assistant.js";
import { candidateCopyText, candidateMarkdown, selectedPhotos } from "../app/candidates.js";
import { activeFilterEntries, albumFilterOptions, filterDefinitions, updateFilterLayout } from "../app/controls.js";
import { buildOptionLabelMaps, createSearchTokenBuilder, normalizePhotoRows } from "../app/data-loader.js";
import { photoTitle, sheetRowLink } from "../app/photo-render.js";
import { resultContextText } from "../app/result-render.js";
import {
  buildSearchText,
  filterAndSortPhotos,
  photoScore,
  prioritizeSelectedPhotos,
  sortForDiscovery,
  sortPhotos,
  uniqueSearchTokens,
} from "../app/search-sort.js";
import { decodeUrlState, encodeUrlState, finderStateUrl } from "../app/url-state.js";

const socialTask = {
  id: "social",
  label: "社群貼文",
  recommendedUses: ["社群貼文"],
  moods: ["友善"],
  scenes: ["交流"],
  safeCrops: ["1:1"],
  prefersNegativeSpace: true,
};

class FakeFilterLabel {
  constructor(key) {
    this.dataset = {};
    this.key = key;
    this.parentElement = null;
    this.style = {};
  }
}

class FakeFilterControl {
  constructor(label) {
    this.label = label;
  }

  closest(selector) {
    return selector === "label" ? this.label : null;
  }
}

class FakeFilterGrid {
  constructor(id) {
    this.appendedKeys = [];
    this.children = [];
    this.id = id;
  }

  append(label) {
    this.appendedKeys.push(label.dataset.filterKey ?? label.key);
    if (label.parentElement && label.parentElement !== this) {
      label.parentElement.children = label.parentElement.children.filter((child) => child !== label);
    }
    if (!this.children.includes(label)) {
      this.children.push(label);
    }
    label.parentElement = this;
  }

  clearLog() {
    this.appendedKeys = [];
  }
}

function fakeFilterLayout() {
  const labels = new Map();
  const controls = {};
  for (const definition of filterDefinitions) {
    const label = new FakeFilterLabel(definition.key);
    labels.set(definition.key, label);
    controls[definition.control] = new FakeFilterControl(label);
  }

  const elements = {
    advancedFilterGrid: new FakeFilterGrid("advancedFilterGrid"),
    advancedFilters: { hidden: false },
    taskFilterGrid: new FakeFilterGrid("taskFilterGrid"),
  };

  return { controls, elements, labels };
}

function clearAppendLog(elements) {
  elements.taskFilterGrid.clearLog();
  elements.advancedFilterGrid.clearLog();
}

function appendLog(elements) {
  return [...elements.taskFilterGrid.appendedKeys, ...elements.advancedFilterGrid.appendedKeys];
}

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

  it("promotes selected photos in selected URL order after sorting", () => {
    const firstSelected = withSearchText(photo({ photo_id: "selected-1", priority_level: "low" }));
    const secondSelected = withSearchText(photo({ photo_id: "selected-2", priority_level: "low" }));
    const strongerMatch = withSearchText(photo({ photo_id: "stronger", priority_level: "high" }));
    const results = filterAndSortPhotos([strongerMatch, secondSelected, firstSelected], {
      task: socialTask,
      selectedPhotoIds: ["selected-1", "selected-2"],
    });

    assert.deepEqual(
      results.map((item) => item.photo_id),
      ["selected-1", "selected-2", "stronger"],
    );
  });

  it("keeps selected prioritization stable for non-selected photos", () => {
    const items = [photo({ photo_id: "a" }), photo({ photo_id: "b" }), photo({ photo_id: "c" })];
    const results = prioritizeSelectedPhotos(items, ["c"]);

    assert.deepEqual(
      results.map((item) => item.photo_id),
      ["c", "a", "b"],
    );
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

  it("matches any selected value within a filter and all selected filter groups", () => {
    const boothLandscape = withSearchText(
      photo({
        photo_id: "booth-landscape",
        scene_tags: ["攤位"],
        orientation: "landscape",
      }),
    );
    const audiencePortrait = withSearchText(
      photo({
        photo_id: "audience-portrait",
        scene_tags: ["會眾"],
        orientation: "portrait",
      }),
    );
    const stageLandscape = withSearchText(
      photo({
        photo_id: "stage-landscape",
        scene_tags: ["舞台"],
        orientation: "landscape",
      }),
    );

    const results = filterAndSortPhotos([stageLandscape, audiencePortrait, boothLandscape], {
      filters: {
        scene: ["攤位", "會眾"],
        orientation: ["landscape"],
      },
    });

    assert.deepEqual(
      results.map((result) => result.photo_id),
      ["booth-landscape"],
    );
  });

  it("matches multi-value people buckets and sponsor item tokens", () => {
    const booth = withSearchText(
      photo({
        photo_id: "booth",
        people_count: "8",
        sponsorship_items: ["Badge 識別證贊助"],
      }),
    );
    const noPeople = withSearchText(
      photo({
        photo_id: "no-people",
        people_count: "0",
        sponsorship_items: ["茶點贊助"],
      }),
    );

    const results = filterAndSortPhotos([noPeople, booth], {
      filters: {
        peopleCount: ["6-20", "21+"],
        sponsorshipItem: ["badge", "攤位"],
      },
    });

    assert.deepEqual(
      results.map((result) => result.photo_id),
      ["booth"],
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
      filters: {
        album: ["id:123", "id:456"],
        scene: ["舞台", "講者"],
        orientation: ["landscape"],
        sponsorshipItem: ["badge", "logo"],
      },
      selectedPhotoIds: new Set(["100", "200"]),
    });

    assert.equal(params.get("sort"), null);
    assert.equal(params.get("q"), "講者");
    assert.deepEqual(params.getAll("album"), ["id:123", "id:456"]);
    assert.deepEqual(params.getAll("scene"), ["舞台", "講者"]);
    assert.equal(params.get("selected"), "100,200");
    assert.deepEqual(decodeUrlState(params), {
      taskMode: "hero",
      search: "講者",
      sort: "",
      filters: {
        album: ["id:123", "id:456"],
        use: [],
        mood: [],
        scene: ["舞台", "講者"],
        peopleCount: [],
        subjectType: [],
        orientation: ["landscape"],
        negativeSpace: [],
        safeCrop: [],
        sponsorshipTag: [],
        sponsorshipItem: ["badge", "logo"],
        publicStatus: [],
        priority: [],
        curationStatus: [],
        collection: [],
      },
      selectedPhotoIds: ["100", "200"],
    });
  });

  it("builds a canonical finder state URL for candidate sharing", () => {
    const url = finderStateUrl("https://sitcon.org/flickr-photo-finder/?task=old#photo-100", {
      taskMode: "social",
      search: " 可放字 ",
      sort: "explore",
      filters: {
        album: ["id:72177720333438501"],
        subjectType: ["person"],
      },
      selectedPhotoIds: new Set(["55244854377", "55246179508"]),
    });

    assert.equal(
      url,
      "https://sitcon.org/flickr-photo-finder/?task=social&q=%E5%8F%AF%E6%94%BE%E5%AD%97&sort=explore&album=id%3A72177720333438501&subject=person&selected=55244854377%2C55246179508",
    );
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
        visual_description: "攤位前有志工與會眾互動，背景可見識別證。",
        sponsorship_items: ["Badge 識別證贊助"],
        sponsorship_tags: ["品牌露出"],
        curation_status: "ai_labeled",
        public_use_status: "needs_review",
        _sheet_row_number: 28,
      }),
      photo({
        photo_id: "200",
        event_name: "SITCON 2025",
        photo_url: "https://www.flickr.com/photos/sitcon/200",
        visual_description: "講者在舞台前展示投影片。",
        sponsorship_tags: ["成果佐證"],
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
    assert.doesNotMatch(imText, /needs_review/);
    assert.doesNotMatch(imText, /SITCON 2026/);
    assert.doesNotMatch(imText, /Sheets:/);
    assert.doesNotMatch(imText, /Finder 清單:/);

    const sponsorText = candidateCopyText(items, helpers, "sponsor");
    assert.match(sponsorText, /贊助佐證候選照片:/);
    assert.match(sponsorText, /贊助品項: Badge 識別證贊助/);
    assert.match(sponsorText, /贊助價值: 品牌露出/);
    assert.match(sponsorText, /畫面描述: 攤位前有志工與會眾互動/);
    assert.match(sponsorText, /Finder: https:\/\/finder\.test\/#photo-100/);

    const collaborationText = candidateCopyText(items, helpers, "collaboration");
    assert.match(collaborationText, /Finder 清單: https:\/\/finder\.test\/\?selected=100%2C200/);
    assert.match(collaborationText, /Finder: https:\/\/finder\.test\/#photo-100/);
    assert.match(collaborationText, /Sheets: https:\/\/sheet\.test\/A28/);
    assert.match(collaborationText, /整理: ai_labeled/);
    assert.match(collaborationText, /使用提醒: needs_review/);
    assert.match(collaborationText, /整理: reviewed/);
    assert.match(collaborationText, /使用提醒: 未填/);

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
      ["id:a1", "title:工作人員側拍"],
    );
    assert.match(options[0].label, /2026/);
    assert.match(options[0].label, /主議程/);
  });

  it("orders album filter options by the album catalog order", () => {
    const options = albumFilterOptions([
      photo({ album_ids: ["2025-day4"], album_title: "SITCON Camp 2025 Day 4", event_year: "" }),
      photo({ album_ids: ["2026-bof"], album_title: "SITCON 2026 負一籌＋BoF", event_year: "" }),
      photo({
        album_ids: ["long"],
        album_title: "這是一個非常非常長的活動相簿名稱，包含很多描述但仍然應該保留完整可搜尋文字",
        event_year: "",
      }),
    ], [
      { album_id: "long", album_title: "這是一個非常非常長的活動相簿名稱，包含很多描述但仍然應該保留完整可搜尋文字" },
      { album_id: "2025-day4", album_title: "SITCON Camp 2025 Day 4" },
      { album_id: "2026-bof", album_title: "SITCON 2026 負一籌＋BoF" },
    ]);

    assert.deepEqual(
      options.map((option) => option.value),
      ["id:long", "id:2025-day4", "id:2026-bof"],
    );
    assert.match(options[0].label, /非常非常長/);
    assert.equal(options[2].label, "SITCON 2026 負一籌＋BoF");
  });

  it("does not re-append stable filter controls during repeated layout renders", () => {
    const { controls, elements, labels } = fakeFilterLayout();

    updateFilterLayout({ controls, elements, taskMode: "all" });
    assert.ok(appendLog(elements).length > 0);

    clearAppendLog(elements);
    updateFilterLayout({ controls, elements, taskMode: "all" });
    assert.deepEqual(appendLog(elements), []);

    const parentBeforeTaskChange = new Map(
      [...labels.entries()].map(([key, label]) => [key, label.parentElement?.id ?? "none"]),
    );

    clearAppendLog(elements);
    updateFilterLayout({ controls, elements, taskMode: "sponsor-pitch" });

    const movedKeys = new Set(appendLog(elements));
    assert.ok(movedKeys.size > 0);
    for (const [key, label] of labels) {
      if (key === "album") {
        assert.equal(label.parentElement, null);
        continue;
      }
      const parentAfterTaskChange = label.parentElement?.id ?? "none";
      if (movedKeys.has(key)) {
        assert.notEqual(parentAfterTaskChange, parentBeforeTaskChange.get(key));
      } else {
        assert.equal(parentAfterTaskChange, parentBeforeTaskChange.get(key));
      }
    }
  });

  it("shapes active filter entries for AI prompts and filter chips", () => {
    const select = (value, text) => ({ value, options: [{ value, textContent: text }], selectedOptions: [{ textContent: text }] });
    const entries = activeFilterEntries({
      state: {
        taskMode: "social",
        filters: {
          album: ["id:1"],
          scene: ["交流"],
          sponsorshipItem: ["攤位"],
        },
      },
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
        sponsorshipItem: { value: "", dataset: { tokenInput: "true", values: "攤位" } },
      },
    });

    assert.deepEqual(entries, [
      ["task", "任務", "社群貼文"],
      ["search", "搜尋", "講者"],
      ["album", "活動/相簿", "SITCON 2026", "id:1"],
      ["scene", "場景", "交流", "交流"],
      ["sponsorshipItem", "贊助品項", "攤位", "攤位"],
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
