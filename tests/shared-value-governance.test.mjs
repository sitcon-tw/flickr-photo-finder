import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("shared value interface registry", () => {
  it("maps every Pages filter to a unique key, control, and URL key", async () => {
    const registry = await readJson("data/interface-registry.json");
    const filters = registry.pages.filters;

    assert.equal(new Set(filters.map((filter) => filter.key)).size, filters.length);
    assert.equal(new Set(filters.map((filter) => filter.control)).size, filters.length);
    assert.equal(new Set(filters.map((filter) => filter.urlKey)).size, filters.length);
    assert.ok(filters.every((filter) => filter.label && filter.group && filter.source?.type));
  });

  it("references only photo schema fields and taxonomy values", async () => {
    const [schema, taxonomy, registry] = await Promise.all([
      readJson("data/photo-schema.json"),
      readJson("data/tag-taxonomy.json"),
      readJson("data/interface-registry.json"),
    ]);
    const fields = new Set(schema.tables.photos.fields.map((field) => field.name));
    const taxonomyValues = (key) => (key === "has_negative_space" ? ["true", "false"] : taxonomy[key] ?? []);

    for (const filter of registry.pages.filters) {
      if (filter.field) {
        assert.ok(fields.has(filter.field), `${filter.key} uses unknown field ${filter.field}`);
      }
      if (filter.source?.key) {
        assert.ok(Array.isArray(taxonomy[filter.source.key]), `${filter.key} uses unknown taxonomy ${filter.source.key}`);
      }
    }

    const taskValueFields = [
      ["recommendedUses", "recommended_uses"],
      ["moods", "mood_tags"],
      ["scenes", "scene_tags"],
      ["sponsorshipTags", "sponsorship_tags"],
      ["orientations", "orientation"],
      ["safeCrops", "safe_crop"],
    ];
    for (const task of registry.pages.taskModes) {
      for (const [property, taxonomyKey] of taskValueFields) {
        for (const value of task[property] ?? []) {
          assert.ok(taxonomyValues(taxonomyKey).includes(value), `${task.id}.${property} uses unknown value ${value}`);
        }
      }
    }
  });

  it("keeps task primary filters inside registered non-low-level filters", async () => {
    const registry = await readJson("data/interface-registry.json");
    const filters = registry.pages.filters;
    const filterKeys = new Set(filters.map((filter) => filter.key));
    const lowLevelFilterKeys = new Set(filters.filter((filter) => filter.lowLevel).map((filter) => filter.key));
    const primaryFilterSets = [
      ["pages.defaultPrimaryFilters", registry.pages.defaultPrimaryFilters],
      ...registry.pages.taskModes
        .filter((task) => task.primaryFilters !== undefined)
        .map((task) => [`pages.taskModes.${task.id}.primaryFilters`, task.primaryFilters]),
    ];

    for (const [path, values] of primaryFilterSets) {
      assert.ok(values.length > 0, `${path} must not be empty`);
      assert.equal(new Set(values).size, values.length, `${path} contains duplicate filter keys`);
      for (const key of values) {
        assert.ok(filterKeys.has(key), `${path} uses unknown filter key ${key}`);
        assert.ok(!lowLevelFilterKeys.has(key), `${path} promotes low-level filter key ${key}`);
      }
    }
  });

  it("keeps Apps Script review field sets inside the photo schema", async () => {
    const [schema, registry] = await Promise.all([
      readJson("data/photo-schema.json"),
      readJson("data/interface-registry.json"),
    ]);
    const fields = new Set(schema.tables.photos.fields.map((field) => field.name));
    const fieldSets = [
      registry.appsScript.publicReadFields,
      registry.appsScript.reviewPanel.fields,
      registry.appsScript.reviewWebApp.listFields,
      registry.appsScript.reviewWebApp.filterFields,
    ];

    for (const fieldSet of fieldSets) {
      assert.ok(fieldSet.length > 0);
      for (const fieldName of fieldSet) {
        assert.ok(fields.has(fieldName), `unknown Apps Script field ${fieldName}`);
      }
    }
  });
});
