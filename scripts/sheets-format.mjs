import { albumHeaders, importBatchHeaders, photoHeaders } from "./photo-schema.mjs";

export const fixedSheetNames = [
  "photos",
  "albums",
  "import_batches",
  "taxonomy",
  "sponsorship_items",
];

export const taxonomyHeaders = ["taxonomy_key", "value", "order"];

export const sponsorshipItemHeaders = [
  "item_id",
  "name_zh",
  "name_en",
  "category",
  "order",
  "quantity",
  "unit",
  "deadline",
  "talent_recruitment_zh",
  "brand_exposure_zh",
  "product_promotion_zh",
  "sub_item_name_zh",
  "sub_item_name_en",
  "sub_item_price",
  "sub_item_remaining",
];

export const expectedSheetHeaders = {
  photos: photoHeaders,
  albums: albumHeaders,
  import_batches: importBatchHeaders,
  taxonomy: taxonomyHeaders,
  sponsorship_items: sponsorshipItemHeaders,
};
