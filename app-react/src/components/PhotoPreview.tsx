import { Button } from "react-aria-components";
import type { FinderData, PhotoRecord } from "../domain";
import { labelFor } from "../filters";
import { largeImageUrl, originalSizePageUrl, photoTitle, sheetRowLink } from "../finderCore";

type PhotoPreviewProps = {
  data: FinderData;
  photo: PhotoRecord;
  selected: boolean;
  onToggleCandidate: (photoId: string) => void;
};

function openUrl(url: string) {
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function PhotoPreview({ data, photo, selected, onToggleCandidate }: PhotoPreviewProps) {
  const largeUrl = largeImageUrl(photo);
  const originalUrl = originalSizePageUrl(photo);
  const sheetsUrl = sheetRowLink(photo, data.projectConfig);

  return (
    <div className="photo-preview">
      <button className="preview-image-link" type="button" onClick={() => openUrl(photo.photo_url)} aria-label="開啟 Flickr">
        {photo.image_preview_url ? <img src={largeUrl || photo.image_preview_url} alt={photoTitle(photo)} /> : <span>無預覽圖</span>}
        <span>Flickr</span>
      </button>
      <div className="preview-body">
        <h2>{photoTitle(photo)}</h2>
        <p>{photo.visual_description || "尚無畫面描述"}</p>
        <dl>
          <div>
            <dt>使用提醒</dt>
            <dd>{labelFor(data, "public_use_status", photo.public_use_status) || "未填"}</dd>
          </div>
          <div>
            <dt>整理狀態</dt>
            <dd>{labelFor(data, "curation_status", photo.curation_status) || "未填"}</dd>
          </div>
          <div>
            <dt>構圖</dt>
            <dd>{[labelFor(data, "orientation", photo.orientation), ...photo.safe_crop].filter(Boolean).join(" / ") || "未填"}</dd>
          </div>
        </dl>
      </div>
      <div className="preview-actions">
        <Button type="button" onPress={() => onToggleCandidate(photo.photo_id)}>
          {selected ? "已候選" : "加候選"}
        </Button>
        <Button type="button" onPress={() => openUrl(photo.photo_url)}>
          Flickr
        </Button>
        <Button type="button" isDisabled={!largeUrl} onPress={() => openUrl(largeUrl)}>
          大圖
        </Button>
        <Button type="button" isDisabled={!originalUrl} onPress={() => openUrl(originalUrl)}>
          原圖
        </Button>
        <Button type="button" isDisabled={!sheetsUrl} onPress={() => openUrl(sheetsUrl)}>
          Sheets
        </Button>
      </div>
    </div>
  );
}
