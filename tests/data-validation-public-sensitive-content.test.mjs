import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parseCsv } from "../scripts/lib/core/csv-utils.mjs";
import { photoHeaders } from "../scripts/lib/core/photo-schema.mjs";
import {
  publicSensitiveContentWarnings,
  validatePublicSensitiveContentRules,
} from "../scripts/lib/core/public-content-warnings.mjs";

describe("data validation public field sensitive content warnings", () => {
  it("detects sensitive-looking content in public text field fixtures", async () => {
    const [rulesText, photosText] = await Promise.all([
      readFile("data/public-sensitive-content-rules.json", "utf8"),
      readFile("fixtures/data-validation/public-sensitive-content/photos.csv", "utf8"),
    ]);
    const rules = JSON.parse(rulesText);
    const [, fixtureRow] = parseCsv(photosText);
    const photo = Object.fromEntries(photoHeaders.map((header, index) => [header, fixtureRow[index] ?? ""]));
    const warnings = publicSensitiveContentWarnings(photo, rules);

    assert.deepEqual(validatePublicSensitiveContentRules(rules), []);
    assert.deepEqual(
      warnings.map((warning) => warning.ruleId),
      ["email", "phone", "private_google_link", "internal_terms", "token_value"],
    );
    assert.ok(warnings.every((warning) => warning.fieldName === "curation_notes"));
    assert.ok(warnings.every((warning) => warning.message.includes("curation_notes 是公開欄位")));
  });

  it("does not treat dates or Flickr numeric identifiers as phone numbers", async () => {
    const rules = JSON.parse(await readFile("data/public-sensitive-content-rules.json", "utf8"));
    const warnings = publicSensitiveContentWarnings(
      {
        curation_notes: "活動日期 2026-05-12，Flickr album id 72177720331280218，photo id 55200405673。",
      },
      rules,
    );

    assert.deepEqual(warnings, []);
  });
});
