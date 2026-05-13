import { Button } from "react-aria-components";
import type { FinderData, PhotoRecord, TaskMode } from "../domain";
import { labelFor } from "../filters";
import { largeImageUrl, originalSizePageUrl, sheetRowLink } from "../finderCore";

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

function workHints(data: FinderData, photo: PhotoRecord): string[] {
  return [
    labelFor(data, "orientation", photo.orientation),
    photo.has_negative_space ? labelFor(data, "has_negative_space", photo.has_negative_space) : "",
    ...photo.safe_crop.slice(0, 2),
    ...photo.sponsorship_items.slice(0, 1),
    ...photo.sponsorship_tags.slice(0, 1),
  ].filter(Boolean).slice(0, 4);
}

function openUrl(url: string) {
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

function ActionLabel({ icon, text }: { icon: string; text: string }) {
  return (
    <span className="action-label">
      <span aria-hidden="true">{icon}</span>
      <span>{text}</span>
    </span>
  );
}

export function PhotoCard({ data, photo, task, selected, onPreview, onToggleCandidate }: PhotoCardProps) {
  const badges = statusBadges(data, photo);
  const signals = [...new Set([...taskSignals(data, photo, task), ...workHints(data, photo)])];
  const imageLabel = `預覽 ${titleFor(photo)}`;
  const largeUrl = largeImageUrl(photo) || photo.photo_url;
  const originalUrl = originalSizePageUrl(photo);
  const sheetsUrl = sheetRowLink(photo, data.projectConfig);

  return (
    <article className="photo-card" id={`photo-${photo.photo_id}`}>
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
        <div className="photo-reference">
          <Button className="photo-id-button" type="button" onPress={() => copyText(photo.photo_id)} aria-label="複製 photo id">
            {photo.photo_id}
          </Button>
          {signals.slice(0, 2).map((signal) => (
            <span className="sort-signal-text" key={signal}>{signal}</span>
          ))}
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
          <Button className={selected ? "candidate-action is-selected" : "candidate-action"} type="button" onPress={() => onToggleCandidate(photo.photo_id)}>
            <ActionLabel icon={selected ? "✓" : "+"} text={selected ? "已候選" : "加候選"} />
          </Button>
          <Button className="desktop-detail-action" type="button" onPress={() => onPreview(photo)}>
            <ActionLabel icon="i" text="詳情" />
          </Button>
          <Button className="desktop-source-action" type="button" onPress={() => openUrl(photo.photo_url)}>
            <ActionLabel icon="F" text="Flickr" />
          </Button>
          <Button className="desktop-source-action" type="button" onPress={() => openUrl(largeUrl)}>
            <ActionLabel icon="↗" text="大圖" />
          </Button>
          <Button className="desktop-source-action" type="button" isDisabled={!originalUrl} onPress={() => openUrl(originalUrl)}>
            <ActionLabel icon="⤓" text="原圖" />
          </Button>
          <Button className="desktop-source-action" type="button" isDisabled={!sheetsUrl} onPress={() => openUrl(sheetsUrl)}>
            <ActionLabel icon="S" text="Sheets" />
          </Button>
          <Button className="mobile-large-action" type="button" onPress={() => openUrl(largeUrl)}>
            <ActionLabel icon="↗" text="大圖" />
          </Button>
        </div>
      </div>
    </article>
  );
}
