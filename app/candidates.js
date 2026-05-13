// Candidate-list helpers for the Pages frontend. This module owns candidate
// list rendering and markdown shaping, while the caller supplies link/label helpers.
export function selectedPhotos(selectedPhotoIds, photos) {
  return [...selectedPhotoIds]
    .map((photoId) => photos.find((photo) => photo.photo_id === photoId))
    .filter(Boolean);
}

export function candidateMarkdown(photo, { photoTitle, finderLink, sheetRowLink, labelFor }) {
  const publicStatus = photo.public_use_status ? labelFor("public_use_status", photo.public_use_status) : "未填";
  const curationStatus = photo.curation_status ? labelFor("curation_status", photo.curation_status) : "未填";
  const rowLink = sheetRowLink(photo) || "未設定";

  return `- ${photoTitle(photo)} (${photo.photo_id})
  - Finder: ${finderLink(photo)}
  - Sheets: ${rowLink}
  - Flickr: ${photo.photo_url}
  - 縮圖: ${photo.image_preview_url || "未填"}
  - 整理: ${curationStatus}
  - 使用提醒: ${publicStatus}`;
}

export function candidateCopyText(candidates, { photoTitle, finderLink, candidateListLink, sheetRowLink, labelFor }, templateId) {
  if (templateId === "collaboration") {
    const listLink = candidateListLink();
    const items = candidates
      .map((photo, index) => {
        const rowLink = sheetRowLink(photo) || "未設定";
        return `${index + 1}. ${photo.photo_url || finderLink(photo)}
   Finder: ${finderLink(photo)}
   Sheets: ${rowLink}`;
      })
      .join("\n\n");
    return `候選照片:\nFinder 清單: ${listLink}\n\n${items}`;
  }

  if (templateId === "flickr_urls") {
    return candidates.map((photo) => photo.photo_url).filter(Boolean).join("\n");
  }

  const items = candidates
    .map((photo, index) => `${index + 1}. ${photo.photo_url || finderLink(photo)}`)
    .join("\n");
  return `候選照片:\n\n${items}`;
}

export function renderCandidates({
  selectedPhotoIds,
  photos,
  elements,
  controls,
  photoTitle,
  finderLink,
  labelFor,
  toggleCandidate,
}) {
  const candidates = selectedPhotos(selectedPhotoIds, photos);
  elements.candidateSummary.textContent = `${candidates.length} 張候選`;
  controls.copyCandidates.disabled = candidates.length === 0;
  controls.clearCandidates.disabled = candidates.length === 0;
  controls.candidateCopyTemplate.disabled = candidates.length === 0;
  elements.candidateList.replaceChildren();

  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "candidate-empty";
    empty.textContent = "尚無候選照片";
    elements.candidateList.append(empty);
    return;
  }

  for (const photo of candidates) {
    const item = document.createElement("article");
    item.className = "candidate-item";
    const thumbnail = document.createElement("a");
    thumbnail.className = "candidate-thumb";
    thumbnail.href = finderLink(photo);
    if (photo.image_preview_url) {
      const image = document.createElement("img");
      image.src = photo.image_preview_url;
      image.alt = photoTitle(photo);
      image.loading = "lazy";
      image.decoding = "async";
      thumbnail.append(image);
    } else {
      thumbnail.textContent = photo.photo_id;
    }
    const body = document.createElement("div");
    body.className = "candidate-body";
    const title = document.createElement("a");
    title.href = finderLink(photo);
    title.textContent = photoTitle(photo);
    const meta = document.createElement("p");
    meta.textContent = [
      photo.event_year,
      photo.recommended_uses.slice(0, 2).join("、"),
    ]
      .filter(Boolean)
      .join(" / ");
    body.append(title, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移除";
    remove.addEventListener("click", () => toggleCandidate(photo.photo_id));
    item.append(thumbnail, body, remove);
    elements.candidateList.append(item);
  }
}
