import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { candidateCopyText, selectedPhotos } from "../app/candidates.js";
import { activeFilterEntries, applyControlsRegistry, filterDefinitions } from "../app/controls.js";
import { buildSearchText, filterAndSortPhotos, uniqueSearchTokens } from "../app/search-sort.js";
import { applyUrlStateRegistry, decodeUrlState, encodeUrlState } from "../app/url-state.js";

const interfaceRegistry = JSON.parse(await readFile(new URL("../data/interface-registry.json", import.meta.url), "utf8"));
applyControlsRegistry(interfaceRegistry);
applyUrlStateRegistry(interfaceRegistry);

const emptyDecodedFilters = {
  album: [],
  use: [],
  mood: [],
  scene: [],
  peopleCount: [],
  subjectType: [],
  orientation: [],
  negativeSpace: [],
  safeCrop: [],
  sponsorshipTag: [],
  sponsorshipItem: [],
  publicStatus: [],
  priority: [],
  curationStatus: [],
  collection: [],
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

function selectControl(optionsByValue) {
  return {
    dataset: {},
    options: Object.entries(optionsByValue).map(([value, textContent]) => ({ value, textContent })),
  };
}

const blankSelect = selectControl({});

const controls = {
  search: { value: "" },
  album: blankSelect,
  use: blankSelect,
  mood: blankSelect,
  scene: selectControl({ "攤位": "攤位", "會眾": "會眾" }),
  peopleCount: blankSelect,
  subjectType: blankSelect,
  orientation: selectControl({ landscape: "橫式" }),
  negativeSpace: blankSelect,
  safeCrop: blankSelect,
  sponsorshipTag: blankSelect,
  sponsorshipItem: { dataset: { tokenInput: "true" } },
  publicStatus: blankSelect,
  priority: blankSelect,
  curationStatus: blankSelect,
  collection: blankSelect,
};

function photoFiltersFromFinderState(state, search = "") {
  return Object.fromEntries([
    ["search", search],
    ...filterDefinitions.map((definition) => [definition.filterParam ?? definition.key, state.filters[definition.key] ?? []]),
  ]);
}

describe("Pages finder contracts", () => {
  it("round-trips task, search, sort, repeated filters, and selected candidate order", () => {
    const params = encodeUrlState({
      taskMode: "hero",
      search: "  講者 留白  ",
      sort: "discover",
      filters: {
        scene: ["攤位", "會眾"],
        orientation: ["landscape"],
        sponsorshipItem: ["Badge", "識別證"],
      },
      selectedPhotoIds: ["beta", "alpha"],
    });

    assert.equal(params.get("task"), "hero");
    assert.equal(params.get("q"), "講者 留白");
    assert.equal(params.get("sort"), "discover");
    assert.deepEqual(params.getAll("scene"), ["攤位", "會眾"]);
    assert.deepEqual(params.getAll("sponsorItem"), ["Badge", "識別證"]);
    assert.equal(params.get("selected"), "beta,alpha");

    assert.deepEqual(decodeUrlState(params), {
      taskMode: "hero",
      search: "講者 留白",
      sort: "discover",
      filters: {
        ...emptyDecodedFilters,
        scene: ["攤位", "會眾"],
        orientation: ["landscape"],
        sponsorshipItem: ["Badge", "識別證"],
      },
      selectedPhotoIds: ["beta", "alpha"],
    });
  });

  it("ignores unknown query keys and deduplicates repeated filter values case-insensitively", () => {
    const params = new URLSearchParams("scene=%E6%94%A4%E4%BD%8D&scene=%E6%94%A4%E4%BD%8D&scene=Booth&scene=booth&future=1&selected=3,2,1");
    const decoded = decodeUrlState(params);

    assert.deepEqual(decoded.filters.scene, ["攤位", "Booth"]);
    assert.equal(decoded.filters.future, undefined);
    assert.deepEqual(decoded.selectedPhotoIds, ["3", "2", "1"]);
  });

  it("uses registry URL keys for public deep-link parameters", () => {
    const params = encodeUrlState({
      taskMode: "sponsor-report",
      filters: {
        peopleCount: ["6-20"],
        negativeSpace: ["true"],
        sponsorshipItem: ["Badge"],
      },
      selectedPhotoIds: ["100"],
    });

    assert.equal(params.get("people"), "6-20");
    assert.equal(params.get("negative"), "true");
    assert.equal(params.get("sponsorItem"), "Badge");
    assert.equal(params.get("peopleCount"), null);
    assert.equal(params.get("negativeSpace"), null);
    assert.equal(params.get("sponsorshipItem"), null);

    assert.deepEqual(decodeUrlState(params), {
      taskMode: "sponsor-report",
      search: "",
      sort: "",
      filters: {
        ...emptyDecodedFilters,
        peopleCount: ["6-20"],
        negativeSpace: ["true"],
        sponsorshipItem: ["Badge"],
      },
      selectedPhotoIds: ["100"],
    });
  });

  it("maps decoded finder state through registry filterParam before search filtering", () => {
    const decoded = decodeUrlState(new URLSearchParams("use=%E7%A4%BE%E7%BE%A4%E8%B2%BC%E6%96%87&people=6-20&sponsorItem=Badge"));
    const socialBadge = withSearchText(
      photo({
        photo_id: "social-badge",
        people_count: "8",
        recommended_uses: ["社群貼文"],
        sponsorship_items: ["Badge 識別證贊助"],
      }),
    );
    const pressBadge = withSearchText(
      photo({
        photo_id: "press-badge",
        people_count: "8",
        recommended_uses: ["新聞稿"],
        sponsorship_items: ["Badge 識別證贊助"],
      }),
    );

    const results = filterAndSortPhotos([pressBadge, socialBadge], {
      filters: photoFiltersFromFinderState(decoded),
    });

    assert.deepEqual(
      results.map((item) => item.photo_id),
      ["social-badge"],
    );
  });

  it("keeps filter semantics as OR within a field and AND across fields", () => {
    const boothLandscape = withSearchText(photo({ photo_id: "booth-landscape", scene_tags: ["攤位"], orientation: "landscape" }));
    const audiencePortrait = withSearchText(photo({ photo_id: "audience-portrait", scene_tags: ["會眾"], orientation: "portrait" }));
    const stageLandscape = withSearchText(photo({ photo_id: "stage-landscape", scene_tags: ["舞台"], orientation: "landscape" }));

    const results = filterAndSortPhotos([audiencePortrait, stageLandscape, boothLandscape], {
      filters: {
        scene: ["攤位", "會眾"],
        orientation: ["landscape"],
      },
    });

    assert.deepEqual(
      results.map((item) => item.photo_id),
      ["booth-landscape"],
    );
  });

  it("creates one active chip entry per selected filter value", () => {
    const entries = activeFilterEntries({
      state: {
        taskMode: "all",
        filters: {
          scene: ["攤位", "會眾"],
          orientation: ["landscape"],
          sponsorshipItem: ["Badge"],
        },
      },
      controls,
      activeTask: { label: "全部照片" },
    });

    assert.deepEqual(entries, [
      ["scene", "場景", "攤位", "攤位"],
      ["scene", "場景", "會眾", "會眾"],
      ["orientation", "方向", "橫式", "landscape"],
      ["sponsorshipItem", "贊助品項", "Badge", "Badge"],
    ]);
  });

  it("preserves candidate selection order and purpose-specific copy templates", () => {
    const photos = [
      photo({
        photo_id: "100",
        event_name: "SITCON 2026",
        photo_url: "https://www.flickr.com/photos/sitcon/100",
        visual_description: "攤位前可見識別證與品牌露出。",
        sponsorship_items: ["Badge 識別證贊助"],
        sponsorship_tags: ["品牌露出"],
        _sheet_row_number: 28,
      }),
      photo({
        photo_id: "200",
        event_name: "SITCON 2025",
        photo_url: "https://www.flickr.com/photos/sitcon/200",
        _sheet_row_number: 29,
      }),
    ];
    const selected = selectedPhotos(["200", "100"], photos);
    const helpers = {
      photoTitle: (item) => item.event_name,
      finderLink: (item) => `https://finder.test/?selected=200,100#photo-${item.photo_id}`,
      candidateListLink: () => "https://finder.test/?selected=200,100",
      sheetRowLink: (item) => `https://sheet.test/A${item._sheet_row_number}`,
      labelFor: (_field, value) => value,
    };

    assert.deepEqual(
      selected.map((item) => item.photo_id),
      ["200", "100"],
    );

    const imText = candidateCopyText(selected, helpers, "im");
    assert.match(imText, /^候選照片:\n\n1\. https:\/\/www\.flickr\.com\/photos\/sitcon\/200/);
    assert.match(imText, /2\. https:\/\/www\.flickr\.com\/photos\/sitcon\/100/);
    assert.doesNotMatch(imText, /Finder 清單:/);

    const collaborationText = candidateCopyText(selected, helpers, "collaboration");
    assert.match(collaborationText, /Finder 清單: https:\/\/finder\.test\/\?selected=200,100/);
    assert.match(collaborationText, /Sheets: https:\/\/sheet\.test\/A29/);

    const sponsorText = candidateCopyText(selected, helpers, "sponsor");
    assert.match(sponsorText, /贊助佐證候選照片:/);
    assert.match(sponsorText, /贊助品項: Badge 識別證贊助/);
    assert.match(sponsorText, /畫面描述: 攤位前可見識別證與品牌露出。/);

    const flickrUrls = candidateCopyText(selected, helpers, "flickr_urls");
    assert.equal(
      flickrUrls,
      "https://www.flickr.com/photos/sitcon/200\nhttps://www.flickr.com/photos/sitcon/100",
    );
  });

  it("uses shared selected URL order for both candidate list and promoted results", () => {
    const decoded = decodeUrlState(new URLSearchParams("selected=200,100"));
    const photos = [
      withSearchText(photo({ photo_id: "100", event_name: "SITCON 2026", priority_level: "low" })),
      withSearchText(photo({ photo_id: "200", event_name: "SITCON 2025", priority_level: "low" })),
      withSearchText(photo({ photo_id: "300", event_name: "SITCON 2024", priority_level: "high" })),
    ];
    const selectedPhotoIds = new Set(decoded.selectedPhotoIds);
    const promotedPhotoIds = new Set(decoded.selectedPhotoIds);

    assert.deepEqual(
      selectedPhotos(selectedPhotoIds, photos).map((item) => item.photo_id),
      ["200", "100"],
    );

    assert.deepEqual(
      filterAndSortPhotos(photos, { selectedPhotoIds: promotedPhotoIds }).map((item) => item.photo_id),
      ["200", "100", "300"],
    );
  });
});
