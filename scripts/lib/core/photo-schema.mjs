import { readFileSync } from "node:fs";

const schemaUrl = new URL("../../../data/photo-schema.json", import.meta.url);

export const photoSchema = JSON.parse(readFileSync(schemaUrl, "utf8"));

export function getTableSchema(tableName) {
  const tableSchema = photoSchema.tables[tableName];
  if (!tableSchema) {
    throw new Error(`Unknown table schema: ${tableName}`);
  }
  return tableSchema;
}

export function getTableHeaders(tableName) {
  return getTableSchema(tableName).fields.map((field) => field.name);
}

export const photoTableSchema = getTableSchema("photos");
export const photoFields = photoTableSchema.fields;

export const photoHeaders = getTableHeaders("photos");
export const albumTableSchema = getTableSchema("albums");
export const albumHeaders = getTableHeaders("albums");
export const importBatchTableSchema = getTableSchema("import_batches");
export const importBatchHeaders = getTableHeaders("import_batches");

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

const aiFieldLayers = photoTableSchema.ai_field_layers ?? {};

export const aiBaselineFields = aiFieldLayers.ai_baseline_fields ?? [];
export const aiRecallFields = aiFieldLayers.ai_recall_fields ?? [];
export const aiOptionalFields = aiFieldLayers.ai_optional_fields ?? [];
export const humanOnlyFields = aiFieldLayers.human_only_fields ?? [];
export const aiValueConstraints = photoTableSchema.ai_value_constraints ?? {};

export const allowedAiFields = [
  ...aiBaselineFields,
  ...aiRecallFields,
  ...aiOptionalFields,
];

export const allowedAiFieldSet = new Set(allowedAiFields);
export const humanOnlyFieldSet = new Set(humanOnlyFields);

export const aiFieldLayerByName = new Map([
  ...aiBaselineFields.map((field) => [field, "baseline"]),
  ...aiRecallFields.map((field) => [field, "recall"]),
  ...aiOptionalFields.map((field) => [field, "optional"]),
  ...humanOnlyFields.map((field) => [field, "human_only"]),
]);

export function aiFieldLayerName(field) {
  return aiFieldLayerByName.get(field) ?? "";
}
