import { useState } from "react";
import { Button } from "react-aria-components";
import type { FinderData, PhotoRecord } from "../domain";
import { labelFor } from "../filters";
import { candidateCopyText, finderLink, photoTitle, selectedPhotos, sheetRowLink } from "../finderCore";
import { trackReactEvent } from "../analytics";

type CandidatePanelProps = {
  data: FinderData;
  selectedPhotoIds: string[];
  onPreview: (photo: PhotoRecord) => void;
  onRemove: (photoId: string) => void;
};

async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

export function CandidatePanel({ data, selectedPhotoIds, onPreview, onRemove }: CandidatePanelProps) {
  const [copyStatus, setCopyStatus] = useState("");
  const candidates = selectedPhotos(selectedPhotoIds, data.photos) as PhotoRecord[];

  async function copyCandidates(templateId: string) {
    const text = candidateCopyText(
      candidates,
      {
        photoTitle,
        finderLink,
        candidateListLink: () => window.location.href,
        sheetRowLink: (photo: PhotoRecord) => sheetRowLink(photo, data.projectConfig),
        labelFor: (fieldName: string, value: string) => labelFor(data, fieldName, value),
      },
      templateId,
    );
    const copied = await copyText(text);
    if (copied) {
      trackReactEvent("finder_candidate_copy", {
        candidate_count: candidates.length,
        copy_template: templateId,
      });
    }
    setCopyStatus(copied ? "已複製" : "複製失敗");
    window.setTimeout(() => setCopyStatus(""), 1600);
  }

  return (
    <section className="candidate-panel" aria-label="候選清單">
      <div className="panel-heading">
        <div>
          <h2>候選照片</h2>
          <p>{candidates.length} 張</p>
        </div>
      </div>
      {candidates.length === 0 ? <p className="candidate-empty">尚未加入候選</p> : null}
      <div className="candidate-list">
        {candidates.map((photo) => (
          <article className="candidate-item" key={photo.photo_id}>
            <button type="button" onClick={() => onPreview(photo)}>
              {photo.image_preview_url ? <img src={photo.image_preview_url} alt={photoTitle(photo)} loading="lazy" decoding="async" /> : photo.photo_id}
            </button>
            <div>
              <strong>{photoTitle(photo)}</strong>
              <span>{photo.visual_description || photo.photo_url}</span>
            </div>
            <Button type="button" onPress={() => onRemove(photo.photo_id)}>
              移除
            </Button>
          </article>
        ))}
      </div>
      <div className="candidate-actions">
        <Button type="button" isDisabled={candidates.length === 0} onPress={() => copyCandidates("collaboration")}>
          複製協作
        </Button>
        <Button type="button" isDisabled={candidates.length === 0} onPress={() => copyCandidates("flickr_urls")}>
          複製 Flickr
        </Button>
      </div>
      {copyStatus ? <p className="copy-status">{copyStatus}</p> : null}
    </section>
  );
}
