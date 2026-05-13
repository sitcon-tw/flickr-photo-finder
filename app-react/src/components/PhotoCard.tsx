import { Button } from "react-aria-components";
import type { FinderData, PhotoRecord, TaskMode } from "../domain";
import { labelFor } from "../filters";

type PhotoCardProps = {
  data: FinderData;
  photo: PhotoRecord;
  task?: TaskMode;
  selected: boolean;
  onPreview: (photo: PhotoRecord) => void;
  onToggleCandidate: (photoId: string) => void;
};

function titleFor(photo: PhotoRecord): string {
  return photo.event_name || photo.album_title || photo.photo_id;
}

function statusBadges(data: FinderData, photo: PhotoRecord): string[] {
  return [
    photo.public_use_status ? labelFor(data, "public_use_status", photo.public_use_status) : "",
    photo.curation_status ? labelFor(data, "curation_status", photo.curation_status) : "",
    photo.priority_level === "high" ? labelFor(data, "priority_level", photo.priority_level) : "",
  ].filter(Boolean);
}

function taskSignals(data: FinderData, photo: PhotoRecord, task?: TaskMode): string[] {
  const signals = [];
  if (task?.recommendedUses?.some((value) => photo.recommended_uses.includes(value))) {
    signals.push("用途命中");
  }
  if (task?.scenes?.some((value) => photo.scene_tags.includes(value))) {
    signals.push("場景命中");
  }
  if (task?.sponsorshipTags?.some((value) => photo.sponsorship_tags.includes(value))) {
    signals.push("贊助命中");
  }
  if (task?.orientations?.includes(photo.orientation)) {
    signals.push(labelFor(data, "orientation", photo.orientation));
  }
  if (task?.prefersNegativeSpace && photo.has_negative_space === "true") {
    signals.push(labelFor(data, "has_negative_space", "true"));
  }
  return signals.slice(0, 3);
}

export function PhotoCard({ data, photo, task, selected, onPreview, onToggleCandidate }: PhotoCardProps) {
  const badges = statusBadges(data, photo);
  const signals = taskSignals(data, photo, task);
  const imageLabel = `預覽 ${titleFor(photo)}`;

  return (
    <article className="photo-card">
      <button className="photo-image-button" type="button" aria-label={imageLabel} onClick={() => onPreview(photo)}>
        {photo.image_preview_url ? (
          <img src={photo.image_preview_url} alt={titleFor(photo)} loading="lazy" decoding="async" />
        ) : (
          <span className="photo-missing-image">無預覽圖</span>
        )}
        <span className="photo-preview-hint">預覽</span>
      </button>
      <div className="photo-card-body">
        <div className="photo-card-heading">
          <h3>{titleFor(photo)}</h3>
          <span>{photo.event_year}</span>
        </div>
        <div className="photo-badges" aria-label="狀態">
          {badges.map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </div>
        <p>{photo.visual_description || "尚無畫面描述"}</p>
        <div className="photo-signals" aria-label="命中理由">
          {signals.map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
        </div>
        <div className="photo-card-actions">
          <Button type="button" onPress={() => onToggleCandidate(photo.photo_id)}>
            {selected ? "已候選" : "加候選"}
          </Button>
          <Button type="button" onPress={() => onPreview(photo)}>
            詳情
          </Button>
        </div>
      </div>
    </article>
  );
}
