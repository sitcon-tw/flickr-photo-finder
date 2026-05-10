import { readFileSync } from "node:fs";
import { photoFields } from "./photo-schema.mjs";

const taxonomyUrl = new URL("../data/tag-taxonomy.json", import.meta.url);
const defaultTaxonomy = JSON.parse(readFileSync(taxonomyUrl, "utf8"));

export function createMetadataDisplayContext({
  fields = photoFields,
  taxonomy = defaultTaxonomy,
} = {}) {
  return {
    fieldByName: new Map(fields.map((field) => [field.name, field])),
    taxonomy,
  };
}

export const defaultMetadataDisplayContext = createMetadataDisplayContext();

function normalizedScalar(value) {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function valuesForDisplay(field, value) {
  if (Array.isArray(value)) {
    return value.map(normalizedScalar).filter(Boolean);
  }
  const normalized = normalizedScalar(value);
  if (!normalized) {
    return [];
  }
  if (field?.multi_value) {
    return normalized.split(";").map((item) => item.trim()).filter(Boolean);
  }
  return [normalized];
}

function optionLabel(context, fieldName, value) {
  return context.taxonomy.option_labels?.[fieldName]?.[value] ?? value;
}

export function fieldLabel(fieldName, {
  context = defaultMetadataDisplayContext,
  includeRaw = false,
} = {}) {
  const label = context.fieldByName.get(fieldName)?.label_zh ?? fieldName;
  return includeRaw && label !== fieldName ? `${label} (${fieldName})` : label;
}

export function formatStoredValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizedScalar).filter(Boolean).join(";");
  }
  return normalizedScalar(value);
}

export function formatDisplayValue(fieldName, value, {
  blank = "",
  context = defaultMetadataDisplayContext,
  includeRaw = false,
} = {}) {
  const field = context.fieldByName.get(fieldName);
  const values = valuesForDisplay(field, value);
  if (values.length === 0) {
    return blank;
  }

  return values
    .map((raw) => {
      const label = optionLabel(context, fieldName, raw);
      return includeRaw && label !== raw ? `${label} (${raw})` : label;
    })
    .join("; ");
}

export function searchTokensForValue(fieldName, value, {
  context = defaultMetadataDisplayContext,
} = {}) {
  const field = context.fieldByName.get(fieldName);
  return valuesForDisplay(field, value).flatMap((raw) => {
    const label = optionLabel(context, fieldName, raw);
    return label === raw ? [raw] : [raw, label];
  });
}
