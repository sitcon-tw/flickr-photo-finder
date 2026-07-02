export function adjacentPhoto(results, activePhotoId, step) {
  const index = results.findIndex((photo) => photo.photo_id === activePhotoId);
  if (index < 0) {
    return null;
  }
  return results[index + step] ?? null;
}

export function horizontalSwipeStep({ startX, startY, endX, endY }, threshold = 48) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  if (Math.abs(deltaX) < threshold || Math.abs(deltaX) <= Math.abs(deltaY)) {
    return 0;
  }
  return deltaX < 0 ? 1 : -1;
}
