type Primitive = string | number | boolean | null | undefined;

type CandidatePhoto = Record<string, unknown> & {
  photo_id: string;
  photo_url?: string;
  image_preview_url?: string;
  public_use_status?: Primitive;
  curation_status?: Primitive;
  sponsorship_items: Primitive[];
  sponsorship_tags: Primitive[];
  visual_description?: string;
};

type CandidateHelpers = {
  photoTitle: (photo: CandidatePhoto) => string;
  finderLink: (photo: CandidatePhoto) => string;
  sheetRowLink: (photo: CandidatePhoto) => string;
  labelFor: (fieldName: string, value: Primitive) => string;
};

type CandidateCopyHelpers = CandidateHelpers & {
  candidateListLink: () => string;
};

/*! Generated app/candidate-copy.js from app-core/candidate-copy.ts; edit the TypeScript source. */
export function selectedPhotos<T extends { photo_id: string }>(selectedPhotoIds: Iterable<Primitive>, photos: T[]) {
  return [...selectedPhotoIds]
    .map((photoId) => photos.find((photo) => photo.photo_id === photoId))
    .filter((photo): photo is T => Boolean(photo));
}

export function candidateMarkdown(photo: CandidatePhoto, { photoTitle, finderLink, sheetRowLink, labelFor }: CandidateHelpers) {
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

export function labeledList(fieldName: string, values: Primitive[], labelFor: (fieldName: string, value: Primitive) => string) {
  return values.map((value) => labelFor(fieldName, value)).filter(Boolean).join("、");
}

function sponsorContext(photo: CandidatePhoto, labelFor: CandidateHelpers["labelFor"]) {
  const items = labeledList("sponsorship_items", photo.sponsorship_items, labelFor);
  const tags = labeledList("sponsorship_tags", photo.sponsorship_tags, labelFor);
  return {
    items: items || "未填",
    tags: tags || "未填",
    description: photo.visual_description || "未填",
  };
}

export function candidateCopyText(
  candidates: CandidatePhoto[],
  { photoTitle, finderLink, candidateListLink, sheetRowLink, labelFor }: CandidateCopyHelpers,
  templateId: string,
) {
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
