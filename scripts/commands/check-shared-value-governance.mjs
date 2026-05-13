import { readFile } from "node:fs/promises";

const paths = {
  schema: "data/photo-schema.json",
  taxonomy: "data/tag-taxonomy.json",
  registry: "data/interface-registry.json",
  ga4Dimensions: "config/ga4-custom-dimensions.json",
  generatedConfig: "apps-script/GeneratedConfig.js",
};

const booleanValues = ["true", "false"];
const filterAnalyticsParams = new Set([
  "album_filter_used",
  "collection_filter_used",
  "curation_status_count",
  "mood_filter_used",
  "orientation_filter_used",
  "people_count_filter_used",
  "priority_level_count",
  "public_use_status_count",
  "recommended_use_count",
  "safe_crop_filter_used",
  "scene_filter_used",
  "sponsorship_filter_used",
  "subject_type_filter_used",
]);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function addDuplicateErrors(errors, label, values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  for (const value of duplicates) {
    errors.push(`${label} contains duplicate value "${value}"`);
  }
}

function assertKnownField(errors, fields, path, fieldName) {
  if (!fields.has(fieldName)) {
    errors.push(`${path} references unknown photo field "${fieldName}"`);
  }
}

function assertKnownTaxonomyValue(errors, taxonomy, path, fieldName, value) {
  const values = fieldName === "has_negative_space" ? booleanValues : taxonomy[fieldName] ?? [];
  if (!values.includes(value)) {
    errors.push(`${path} references unknown ${fieldName} value "${value}"`);
  }
}

function validateFilterRegistry(errors, registry, fields, taxonomy) {
  const filters = registry.pages?.filters ?? [];
  if (!Array.isArray(filters) || filters.length === 0) {
    errors.push("data/interface-registry.json: pages.filters must be a non-empty array");
    return;
  }

  addDuplicateErrors(errors, "pages.filters[].key", filters.map((filter) => filter.key));
  addDuplicateErrors(errors, "pages.filters[].control", filters.map((filter) => filter.control));
  addDuplicateErrors(errors, "pages.filters[].urlKey", filters.map((filter) => filter.urlKey));

  for (const filter of filters) {
    const path = `pages.filters.${filter.key || "(missing key)"}`;
    for (const property of ["key", "label", "group", "control", "urlKey"]) {
      if (!String(filter[property] ?? "").trim()) {
        errors.push(`${path}.${property} must not be blank`);
      }
    }
    if (filter.field) {
      assertKnownField(errors, fields, path, filter.field);
    }
    const source = filter.source ?? {};
    if (source.key && !Array.isArray(taxonomy[source.key])) {
      errors.push(`${path}.source.key references unknown taxonomy "${source.key}"`);
    }
    if (source.type === "boolean" && filter.field !== "has_negative_space") {
      errors.push(`${path} uses boolean source but field is not has_negative_space`);
    }
  }
}

function validateTaskModes(errors, registry, taxonomy) {
  const taskModes = registry.pages?.taskModes ?? [];
  addDuplicateErrors(errors, "pages.taskModes[].id", taskModes.map((task) => task.id));

  const valueFields = [
    ["recommendedUses", "recommended_uses"],
    ["moods", "mood_tags"],
    ["scenes", "scene_tags"],
    ["sponsorshipTags", "sponsorship_tags"],
    ["orientations", "orientation"],
    ["safeCrops", "safe_crop"],
  ];

  for (const task of taskModes) {
    const path = `pages.taskModes.${task.id || "(missing id)"}`;
    for (const property of ["id", "label", "description"]) {
      if (!String(task[property] ?? "").trim()) {
        errors.push(`${path}.${property} must not be blank`);
      }
    }
    for (const [property, taxonomyKey] of valueFields) {
      for (const value of task[property] ?? []) {
        assertKnownTaxonomyValue(errors, taxonomy, `${path}.${property}`, taxonomyKey, value);
      }
    }
  }
}

function validateFieldSets(errors, registry, fields) {
  const appsScript = registry.appsScript ?? {};
  const fieldSets = {
    "appsScript.publicReadFields": appsScript.publicReadFields ?? [],
    "appsScript.reviewPanel.fields": appsScript.reviewPanel?.fields ?? [],
    "appsScript.reviewWebApp.listFields": appsScript.reviewWebApp?.listFields ?? [],
    "appsScript.reviewWebApp.filterFields": appsScript.reviewWebApp?.filterFields ?? [],
  };

  for (const [path, fieldNames] of Object.entries(fieldSets)) {
    if (!Array.isArray(fieldNames) || fieldNames.length === 0) {
      errors.push(`${path} must be a non-empty array`);
      continue;
    }
    addDuplicateErrors(errors, path, fieldNames);
    for (const fieldName of fieldNames) {
      assertKnownField(errors, fields, path, fieldName);
    }
  }
}

function validateStatusPolicy(errors, registry, taxonomy) {
  const statusPolicy = registry.pages?.statusPolicy ?? {};
  for (const [fieldName, scores] of Object.entries(statusPolicy)) {
    if (!Array.isArray(taxonomy[fieldName])) {
      errors.push(`pages.statusPolicy references unknown taxonomy field "${fieldName}"`);
      continue;
    }
    for (const value of Object.keys(scores ?? {})) {
      assertKnownTaxonomyValue(errors, taxonomy, `pages.statusPolicy.${fieldName}`, fieldName, value);
    }
  }
}

function validateAnalyticsParams(errors, registry, ga4Dimensions) {
  const registeredParams = new Set((ga4Dimensions.customDimensions ?? []).map((item) => item.parameterName));
  for (const param of filterAnalyticsParams) {
    if (!registeredParams.has(param) && !param.endsWith("_count") && !param.endsWith("_used")) {
      errors.push(`analytics parameter "${param}" is not registered in config/ga4-custom-dimensions.json`);
    }
  }
  const filterKeys = new Set((registry.pages?.filters ?? []).map((filter) => filter.key));
  for (const key of ["album", "collection", "curationStatus", "mood", "orientation", "peopleCount", "priority", "publicStatus", "safeCrop", "scene", "sponsorshipItem", "sponsorshipTag", "subjectType", "use"]) {
    if (!filterKeys.has(key)) {
      errors.push(`analytics expects filter key "${key}" but registry does not define it`);
    }
  }
}

async function validateGeneratedConfig(errors, registry) {
  let generatedText = "";
  try {
    generatedText = await readFile(paths.generatedConfig, "utf8");
  } catch {
    errors.push(`${paths.generatedConfig} is missing; run pnpm apps-script:build-config`);
    return;
  }
  if (!generatedText.includes("interfaceRegistry")) {
    errors.push(`${paths.generatedConfig} does not include interfaceRegistry; run pnpm apps-script:build-config after updating the generator`);
    return;
  }
  const match = generatedText.match(/var SITCON_PHOTO_FINDER_CONFIG = ([\s\S]*);\s*$/);
  if (!match) {
    errors.push(`${paths.generatedConfig} does not contain a parseable SITCON_PHOTO_FINDER_CONFIG object`);
    return;
  }
  const generatedConfig = JSON.parse(match[1]);
  if (JSON.stringify(generatedConfig.interfaceRegistry ?? null) !== JSON.stringify(registry)) {
    errors.push(`${paths.generatedConfig} is out of date with ${paths.registry}; run pnpm apps-script:build-config and commit the result`);
  }
}

async function main() {
  const [schema, taxonomy, registry, ga4Dimensions] = await Promise.all([
    readJson(paths.schema),
    readJson(paths.taxonomy),
    readJson(paths.registry),
    readJson(paths.ga4Dimensions),
  ]);
  const errors = [];
  const photoFields = schema.tables?.photos?.fields ?? [];
  const fieldNames = new Set(photoFields.map((field) => field.name));

  validateFilterRegistry(errors, registry, fieldNames, taxonomy);
  validateTaskModes(errors, registry, taxonomy);
  validateFieldSets(errors, registry, fieldNames);
  validateStatusPolicy(errors, registry, taxonomy);
  validateAnalyticsParams(errors, registry, ga4Dimensions);
  await validateGeneratedConfig(errors, registry);

  if (errors.length === 0) {
    console.log("Shared value governance check passed.");
    return;
  }

  console.error("Shared value governance check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`Could not run shared value governance check: ${error.message}`);
  process.exitCode = 1;
}
