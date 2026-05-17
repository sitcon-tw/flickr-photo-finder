import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeCompactRecords, loadFinderData, normalizeStaticPhotoRecords } from "../app/data-loader.js";

function okJson(value) {
  return {
    ok: true,
    json: async () => value,
  };
}

function okText(value) {
  return {
    ok: true,
    text: async () => value,
  };
}

const photoSchema = {
  tables: {
    photos: {
      fields: [
        { name: "photo_id" },
        { name: "photo_url" },
        { name: "album_ids", multi_value: true },
        { name: "album_title" },
        { name: "event_name" },
        { name: "event_year" },
        { name: "image_preview_url" },
        { name: "safe_crop", multi_value: true },
        { name: "has_negative_space" },
        { name: "sponsorship_items", multi_value: true },
        { name: "visual_description" },
        { name: "curation_notes" },
      ],
    },
  },
};

describe("Pages data-loader static artifacts", () => {
  it("decodes compact rows into records", () => {
    assert.deepEqual(
      decodeCompactRecords({
        fields: ["photo_id", "safe_crop"],
        rows: [["p1", ["16:9", "1:1"]]],
      }),
      [{ photo_id: "p1", safe_crop: ["16:9", "1:1"] }],
    );
  });

  it("normalizes static index records and preserves prebuilt search text", () => {
    const records = [
      {
        photo_id: "p1",
        album_ids: "a1;a2",
        safe_crop: "16:9;1:1",
        has_negative_space: "true",
        search_text: "prebuilt search",
      },
    ];
    const normalized = normalizeStaticPhotoRecords(records, photoSchema, () => []);

    assert.deepEqual(normalized[0].album_ids, ["a1", "a2"]);
    assert.deepEqual(normalized[0].safe_crop, ["16:9", "1:1"]);
    assert.equal(normalized[0].visual_description, "");
    assert.equal(normalized[0].search_text, "prebuilt search");
  });

  it("loads static-sharded index data and hydrates detail shards lazily", async () => {
    const dataSources = {
      mode: "static-sharded",
      finderDataManifestUrl: "./data/finder-data/manifest.json",
      finderDataAlbumsUrl: "./data/finder-data/albums.json",
      finderDataIndexUrl: "./data/finder-data/photos-index.json",
      interfaceRegistryJsonUrl: "./data/interface-registry.json",
      schemaJsonUrl: "./data/photo-schema.json",
      searchAliasesJsonUrl: "./data/search-aliases.json",
      taxonomyJsonUrl: "./data/tag-taxonomy.json",
    };
    const routes = new Map([
      ["http://localhost/data/finder-data/manifest.json", okJson({
        shards: [{ id: "000", path: "shards/photos-000.json", count: 1 }],
      })],
      ["http://localhost/data/finder-data/albums.json", okJson({
        fields: ["album_id", "album_title"],
        rows: [["a1", "SITCON"]],
      })],
      ["http://localhost/data/finder-data/photos-index.json", okJson({
        fields: ["photo_id", "photo_url", "album_ids", "safe_crop", "search_text", "shard_id"],
        rows: [["p1", "https://www.flickr.com/photos/sitcon/1", ["a1"], ["16:9"], "prebuilt stage", "000"]],
      })],
      ["http://localhost/data/finder-data/shards/photos-000.json", okJson({
        fields: ["photo_id", "visual_description", "curation_notes", "sponsorship_items", "_sheet_row_number"],
        rows: [["p1", "講者在舞台前展示投影片。", "Flickr title: Stage", ["Badge 識別證贊助"], 42]],
      })],
      ["./data/interface-registry.json", okJson({ pages: {} })],
      ["./data/photo-schema.json", okJson(photoSchema)],
      ["./data/search-aliases.json", okJson({})],
      ["./data/tag-taxonomy.json", okJson({ option_labels: {} })],
      ["./config/project.json", okJson({ frontend: { appTitle: "Finder" } })],
    ]);
    const fetchImpl = async (url) => {
      const response = routes.get(url);
      if (!response) {
        return { ok: false };
      }
      return response;
    };

    const loaded = await loadFinderData({ dataSources, projectConfigUrl: "./config/project.json", fetchImpl });
    assert.equal(loaded.dataMode, "static-sharded");
    assert.deepEqual(loaded.albums, [{ album_id: "a1", album_title: "SITCON" }]);
    assert.equal(loaded.photos[0].visual_description, "");
    assert.equal(loaded.photos[0].search_text, "prebuilt stage");

    const detailed = await loaded.loadPhotoDetails(loaded.photos[0]);
    assert.equal(detailed.visual_description, "講者在舞台前展示投影片。");
    assert.deepEqual(detailed.sponsorship_items, ["Badge 識別證贊助"]);
    assert.equal(detailed._sheet_row_number, 42);
    assert.equal(detailed.search_text, "prebuilt stage");
  });

  it("keeps runtime CSV mode compatible", async () => {
    const dataSources = {
      mode: "runtime-csv",
      albumsCsvUrl: "./albums.csv",
      photosCsvUrl: "./photos.csv",
      interfaceRegistryJsonUrl: "./data/interface-registry.json",
      schemaJsonUrl: "./data/photo-schema.json",
      searchAliasesJsonUrl: "./data/search-aliases.json",
      taxonomyJsonUrl: "./data/tag-taxonomy.json",
    };
    const routes = new Map([
      ["./albums.csv", okText("album_id,album_title\na1,SITCON\n")],
      ["./photos.csv", okText("photo_id,album_ids,safe_crop\np1,a1,16:9\n")],
      ["./data/interface-registry.json", okJson({ pages: {} })],
      ["./data/photo-schema.json", okJson(photoSchema)],
      ["./data/search-aliases.json", okJson({})],
      ["./data/tag-taxonomy.json", okJson({ option_labels: {} })],
      ["./config/project.json", okJson({})],
    ]);
    const fetchImpl = async (url) => routes.get(url) ?? { ok: false };

    const loaded = await loadFinderData({ dataSources, projectConfigUrl: "./config/project.json", fetchImpl });

    assert.equal(loaded.dataMode, "runtime-csv");
    assert.deepEqual(loaded.albums, [{ album_id: "a1", album_title: "SITCON" }]);
    assert.deepEqual(loaded.photos[0].safe_crop, ["16:9"]);
    assert.equal(await loaded.loadPhotoDetails(loaded.photos[0]), loaded.photos[0]);
  });
});
