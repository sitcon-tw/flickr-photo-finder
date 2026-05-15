// Candidate-list helpers for the Pages frontend. This module owns candidate
// list rendering and markdown shaping, while the caller supplies link/label helpers.
export function selectedPhotos(selectedPhotoIds, photos) {
  return [...selectedPhotoIds]
    .map((photoId) => photos.find((photo) => photo.photo_id === photoId))
    .filter(Boolean);
}

function photoReviewStatus(photo, labelFor) {
  return {
    publicStatus: photo.public_use_status ? labelFor("public_use_status", photo.public_use_status) : "未填",
    curationStatus: photo.curation_status ? labelFor("curation_status", photo.curation_status) : "未填",
  };
}

export function candidateMarkdown(photo, { photoTitle, finderLink, sheetRowLink, labelFor }) {
  const { publicStatus, curationStatus } = photoReviewStatus(photo, labelFor);
  const rowLink = sheetRowLink(photo) || "未設定";

  return `- ${photoTitle(photo)} (${photo.photo_id})
  - Finder: ${finderLink(photo)}
  - Sheets: ${rowLink}
  - Flickr: ${photo.photo_url}
  - 縮圖: ${photo.image_preview_url || "未填"}
  - 整理: ${curationStatus}
  - 使用提醒: ${publicStatus}`;
}

function labeledList(fieldName, values, labelFor) {
  return values.map((value) => labelFor(fieldName, value)).filter(Boolean).join("、");
}

function sponsorContext(photo, labelFor) {
  const items = labeledList("sponsorship_items", photo.sponsorship_items, labelFor);
  const tags = labeledList("sponsorship_tags", photo.sponsorship_tags, labelFor);
  return {
    items: items || "未填",
    tags: tags || "未填",
    description: photo.visual_description || "未填",
  };
}

export function candidateCopyText(candidates, { photoTitle, finderLink, candidateListLink, sheetRowLink, labelFor }, templateId) {
  if (templateId === "sponsor") {
    const listLink = candidateListLink();
    const items = candidates
      .map((photo, index) => {
        const rowLink = sheetRowLink(photo) || "未設定";
        const context = sponsorContext(photo, labelFor);
        return `${index + 1}. ${photoTitle(photo)} (${photo.photo_id})
   Flickr: ${photo.photo_url || "未設定"}
   Finder: ${finderLink(photo)}
   Sheets: ${rowLink}
   贊助品項: ${context.items}
   贊助價值: ${context.tags}
   畫面描述: ${context.description}`;
      })
      .join("\n\n");
    return `贊助佐證候選照片:\nFinder 清單: ${listLink}\n\n${items}`;
  }

  if (templateId === "collaboration") {
    const listLink = candidateListLink();
    const items = candidates
      .map((photo, index) => {
        const rowLink = sheetRowLink(photo) || "未設定";
        const { publicStatus, curationStatus } = photoReviewStatus(photo, labelFor);
        return `${index + 1}. ${photo.photo_url || finderLink(photo)}
   Finder: ${finderLink(photo)}
   Sheets: ${rowLink}
   整理: ${curationStatus}
   使用提醒: ${publicStatus}`;
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
  openPreview,
  displayImageUrl,
}) {
  const candidates = selectedPhotos(selectedPhotoIds, photos);
  elements.candidateSummary.textContent = `${candidates.length} 張候選`;
  controls.copyCandidates.disabled = candidates.length === 0;
  controls.clearCandidates.disabled = candidates.length === 0;
  controls.candidateCopyMenuButton.disabled = candidates.length === 0;
  controls.candidateCopyMenu.hidden = true;
  controls.candidateCopyMenuButton.setAttribute("aria-expanded", "false");
  for (const item of controls.candidateCopyMenuItems) {
    item.disabled = candidates.length === 0;
  }
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
