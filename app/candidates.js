import { labeledList, selectedPhotos } from "./candidate-copy.js";

export { candidateCopyText, candidateMarkdown, selectedPhotos } from "./candidate-copy.js";

export function renderCandidates({
  selectedPhotoIds,
  photos,
  elements,
  controls,
  photoTitle,
  finderLink,
  labelFor,
  toggleCandidate,
  openPreview,
  displayImageUrl,
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
    const thumbnail = document.createElement("button");
    thumbnail.type = "button";
    thumbnail.className = "candidate-thumb";
    thumbnail.setAttribute("aria-label", `預覽 ${photoTitle(photo)}`);
    thumbnail.addEventListener("click", () => openPreview(photo));
    const imageUrl = displayImageUrl(photo);
    if (imageUrl) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = photoTitle(photo);
      image.loading = "lazy";
      image.decoding = "async";
      thumbnail.append(image);
    } else {
      thumbnail.textContent = photo.photo_id;
    }
    const body = document.createElement("div");
    body.className = "candidate-body";
    const title = document.createElement("button");
    title.type = "button";
    title.className = "candidate-title-button";
    title.textContent = photoTitle(photo);
    title.addEventListener("click", () => openPreview(photo));
    const meta = document.createElement("p");
    const sponsorMeta = [
      labeledList("sponsorship_items", photo.sponsorship_items.slice(0, 2), labelFor),
      labeledList("sponsorship_tags", photo.sponsorship_tags.slice(0, 2), labelFor),
    ].filter(Boolean).join(" / ");
    const visualMeta = [
      photo.orientation ? labelFor("orientation", photo.orientation) : "",
      photo.has_negative_space ? labelFor("has_negative_space", photo.has_negative_space) : "",
      photo.safe_crop.slice(0, 2).join("、"),
    ].filter(Boolean).join(" / ");
    meta.textContent = [
      sponsorMeta,
      visualMeta,
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
