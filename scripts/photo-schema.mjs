export const photoHeaders = [
  "photo_id",
  "photo_url",
  "image_preview_url",
  "album_title",
  "event_name",
  "event_year",
  "photographer",
  "license",
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "sponsorship_items",
  "sponsorship_tags",
  "orientation",
  "has_negative_space",
  "safe_crop",
  "public_use_status",
  "quality_score",
  "collections",
  "internal_notes",
  "curation_status",
];

export const requiredFields = ["photo_id", "photo_url", "image_preview_url"];

export const listFields = [
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "sponsorship_items",
  "sponsorship_tags",
  "safe_crop",
  "collections",
];

export const controlledListFields = [
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "sponsorship_items",
  "sponsorship_tags",
  "safe_crop",
];

export const controlledScalarFields = [
  "orientation",
  "public_use_status",
  "curation_status",
];
