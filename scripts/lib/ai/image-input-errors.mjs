export const imageInputErrorsFilename = "image-input-errors.json";

export function buildImageInputErrorsArtifact({
  createdAt,
  downloadEnabled,
  errors,
  imageSize,
  photosSource,
  runId,
  selectedPhotoCount,
}) {
  return {
    artifact_version: 1,
    created_at: createdAt,
    download_enabled: downloadEnabled,
    error_count: errors.length,
    errors,
    image_size: imageSize,
    photos_source: photosSource,
    run_id: runId,
    selected_photo_count: selectedPhotoCount,
  };
}

export function formatImageInputErrorSummary(errors, path, exampleLimit = 5) {
  const examples = errors
    .slice(0, exampleLimit)
    .map((error) => `${error.photo_id}: ${error.message}`)
    .join("; ");
  const remaining = errors.length - Math.min(errors.length, exampleLimit);
  const suffix = remaining > 0 ? `; +${remaining} more` : "";

  return `Failed to prepare ${errors.length} image input(s). Full details: ${path}. Examples: ${examples}${suffix}`;
}
