import { readFileSync } from "node:fs";

const schemaUrl = new URL("../data/photo-schema.json", import.meta.url);

export const photoSchema = JSON.parse(readFileSync(schemaUrl, "utf8"));
export const photoTableSchema = photoSchema.tables.photos;
export const photoFields = photoTableSchema.fields;

export const photoHeaders = photoFields.map((field) => field.name);

export const requiredFields = photoFields
  .filter((field) => field.required)
  .map((field) => field.name);

export const listFields = photoFields
  .filter((field) => field.multi_value)
  .map((field) => field.name);

export const controlledListFields = photoFields
  .filter((field) => field.multi_value && field.taxonomy_key)
  .map((field) => field.name);

export const controlledScalarFields = photoFields
  .filter((field) => !field.multi_value && field.taxonomy_key)
  .map((field) => field.name);

export const reviewedRequiredFields = photoTableSchema.reviewed_required_fields;
export const approvedRequiredFields = photoTableSchema.approved_required_fields;
