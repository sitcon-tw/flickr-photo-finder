import { resultCountBucket } from "./analytics.js";

function appendDetail(details, label, values, { labelFor, status = false, fieldName = "" } = {}) {
  const normalizedValues = (Array.isArray(values) ? values : [values]).filter(Boolean);
  if (normalizedValues.length === 0) {
    return;
  }

  const row = document.createElement("div");
  row.className = "detail-row";
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");

  for (const value of normalizedValues) {
    const tag = document.createElement("span");
    tag.className = status ? `tag status-${value}` : "tag";
    tag.textContent = fieldName ? labelFor(fieldName, value) : value;
    description.append(tag);
  }

  row.append(term, description);
  details.append(row);
}

function formatPeopleCount(photo) {
  const value = String(photo.people_count ?? "").trim();
  return value === "" ? "" : `${value} 人`;
}

function flickrTitle(photo) {
  const match = String(photo.curation_notes ?? "").match(/Flickr title:\s*([^.;]+)/i);
  return match?.[1]?.trim() ?? "";
}

export function photoTitle(photo) {
  return photo.event_name || photo.album_title || flickrTitle(photo) || photo.photo_id;
}

export function photoAnchorId(photoId) {
  return `photo-${photoId}`;
}

export function finderLink(photo) {
  const url = new URL(window.location.href);
  url.hash = photoAnchorId(photo.photo_id);
  return url.toString();
}

export function sheetRowLink(photo, projectConfig) {
  const spreadsheetId = String(projectConfig.googleSheets?.spreadsheetId ?? "").trim();
  if (!spreadsheetId || !photo._sheet_row_number) {
    return "";
  }
  const gid = encodeURIComponent(String(projectConfig.googleSheets?.photosSheetGid ?? 0));
  const range = encodeURIComponent(`A${photo._sheet_row_number}`);
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}&range=${range}`;
}

export async function copyTextToClipboard(text) {
  if (!text) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

export function setTemporaryButtonText(button, text) {
  const original = button.textContent;
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = original;
  }, 1800);
}

function buildSizedImageUrl(previewUrl, suffix) {
  if (!previewUrl) {
    return "";
  }

  try {
    const url = new URL(previewUrl);
    const match = url.pathname.match(/^(.*\/\d+_[^/_]+)(?:_(?:s|q|t|m|n|w|z|c|b))?(\.[A-Za-z0-9]+)$/);
    if (!match) {
      return "";
    }
    url.pathname = `${match[1]}_${suffix}${match[2]}`;
    return url.toString();
  } catch {
    return "";
  }
}

export function largeImageUrl(photo) {
  return buildSizedImageUrl(photo.image_preview_url, "b");
}

export function displayImageUrl(photo) {
  return buildSizedImageUrl(photo.image_preview_url, "z") || photo.image_preview_url;
}

function imageFileExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([A-Za-z0-9]+)$/);
    return match?.[1]?.toLowerCase() || "jpg";
  } catch {
    return "jpg";
  }
}

function safeFilenamePart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function imageDownloadFilename(photo, url) {
  const title = safeFilenamePart(photoTitle(photo));
  const id = safeFilenamePart(photo.photo_id) || "photo";
  return `${id}${title ? `-${title}` : ""}.${imageFileExtension(url)}`;
}

export async function downloadImageUrl(url, filename) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error("圖片下載失敗");
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function originalSizePageUrl(photo) {
  if (!photo.photo_url) {
    return "";
  }

  try {
    const url = new URL(photo.photo_url);
    url.hash = "";
    url.search = "";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/sizes/o/`;
    return url.toString();
  } catch {
    return "";
  }
}

function setActionLink(link, href) {
  if (!href) {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
    return;
  }

  link.href = href;
  link.removeAttribute("aria-disabled");
}

function photoEventParams(photo, resultRank, resultCount, { taskMode, sortMode }) {
  return {
    result_rank: resultRank,
    result_count_bucket: resultCountBucket(resultCount),
    task_mode: taskMode,
    sort_mode: sortMode,
    public_use_status: photo.public_use_status,
    curation_status: photo.curation_status,
  };
}

function trackOpenFlickr(photo, resultRank, resultCount, context) {
  context.trackEvent("select_content", {
    content_type: "photo",
    content_id: photo.photo_id,
    ...photoEventParams(photo, resultRank, resultCount, context),
  });
  context.trackEvent("open_flickr_source", {
    photo_id: photo.photo_id,
    ...photoEventParams(photo, resultRank, resultCount, context),
  });
}

function statusBadges(photo, labelFor) {
  const badges = [];
  if (photo.public_use_status === "avoid") {
    badges.push(["danger", labelFor("public_use_status", "avoid")]);
  } else if (photo.public_use_status === "needs_review") {
    badges.push(["warning", labelFor("public_use_status", "needs_review")]);
  }

  if (photo.priority_level === "high") {
    badges.push(["success", labelFor("priority_level", "high")]);
  }
  if (photo.curation_status === "reviewed") {
    badges.push(["info", labelFor("curation_status", "reviewed")]);
  } else if (photo.curation_status === "ai_labeled") {
    badges.push(["ai", labelFor("curation_status", "ai_labeled")]);
  } else {
    badges.push(["neutral", labelFor("curation_status", "unreviewed")]);
  }

  return badges;
}

export function renderPhotoReference(container, photo, signals = []) {
  const idButton = document.createElement("button");
  idButton.type = "button";
  idButton.className = "photo-id-button";
  idButton.textContent = `photo_id: ${photo.photo_id}`;
  idButton.title = "複製 photo_id";
  idButton.addEventListener("click", async () => {
    try {
      const copied = await copyTextToClipboard(photo.photo_id);
      if (copied) {
        setTemporaryButtonText(idButton, "已複製 photo_id");
      }
    } catch {
      setTemporaryButtonText(idButton, "複製失敗");
    }
  });

  container.replaceChildren(idButton);

  if (signals.length === 0) {
    return;
  }

  const signalText = document.createElement("span");
  signalText.className = "sort-signal-text";
  signalText.textContent = signals.join(" / ");
  container.append(signalText);
}

function appendBadges(container, badges) {
  container.replaceChildren();
  for (const [type, label] of badges) {
    const badge = document.createElement("span");
    badge.className = `status-badge status-${type}`;
    badge.textContent = label;
    container.append(badge);
  }
}

export function renderPhotoStatuses(container, photo, labelFor) {
  appendBadges(container, statusBadges(photo, labelFor));
}

export function renderPhotoDetails(details, photo, { labelFor } = {}) {
  const detailOptions = { labelFor };
  details.replaceChildren();
  appendDetail(details, "用途", photo.recommended_uses, detailOptions);
  appendDetail(details, "氛圍", photo.mood_tags, detailOptions);
  appendDetail(details, "場景", photo.scene_tags, detailOptions);
  appendDetail(details, "人數", formatPeopleCount(photo), detailOptions);
  appendDetail(details, "主體", photo.subject_type, { ...detailOptions, fieldName: "subject_type" });
  appendDetail(details, "方向", photo.orientation, { ...detailOptions, fieldName: "orientation" });
  appendDetail(details, "留白", photo.has_negative_space, { ...detailOptions, fieldName: "has_negative_space" });
  appendDetail(details, "裁切", photo.safe_crop, detailOptions);
  appendDetail(details, "贊助品項", photo.sponsorship_items, detailOptions);
  appendDetail(details, "贊助價值", photo.sponsorship_tags, detailOptions);
  appendDetail(details, "素材包", photo.collections, detailOptions);
  appendDetail(details, "攝影", photo.photographer, detailOptions);
  appendDetail(details, "授權", photo.license, detailOptions);
  appendDetail(details, "使用提醒", photo.public_use_status, { ...detailOptions, status: true, fieldName: "public_use_status" });
  appendDetail(details, "推薦優先度", photo.priority_level, { ...detailOptions, status: true, fieldName: "priority_level" });
  appendDetail(details, "整理狀態", photo.curation_status, { ...detailOptions, status: true, fieldName: "curation_status" });
  appendDetail(details, "Sheets 列", photo._sheet_row_number ? String(photo._sheet_row_number) : "", detailOptions);
  appendDetail(details, "照片 ID", photo.photo_id, detailOptions);
  appendDetail(details, "描述", photo.visual_description, detailOptions);
  appendDetail(details, "備註", photo.curation_notes, detailOptions);
}

export function renderPhotoCard(photo, resultRank, resultCount, context) {
  const { template, selectedPhotoIds, toggleCandidate, openPreview } = context;
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".photo-card");
  const link = fragment.querySelector(".photo-link");
  const linkHint = fragment.querySelector(".photo-link-hint");
  const candidateButton = fragment.querySelector(".photo-candidate-button");
  const image = fragment.querySelector("img");
  const selected = selectedPhotoIds.has(photo.photo_id);

  card.id = photoAnchorId(photo.photo_id);
  card.classList.toggle("is-candidate-selected", selected);
  const openFlickrLabel = `預覽照片：${photoTitle(photo)}`;
  setActionLink(link, photo.photo_url);
  link.setAttribute("aria-label", openFlickrLabel);
  link.title = openFlickrLabel;
  linkHint.textContent = openPreview ? "預覽" : "開啟 Flickr";
  link.addEventListener("click", (event) => {
    if (openPreview) {
      event.preventDefault();
      openPreview(photo);
      return;
    }
    if (!photo.photo_url) {
      event.preventDefault();
      return;
    }
    trackOpenFlickr(photo, resultRank, resultCount, context);
  });
  link.classList.toggle("is-preview-link", Boolean(openPreview));

  image.src = displayImageUrl(photo);
  image.alt = [photoTitle(photo), photo.event_year].filter(Boolean).join(" ");

  candidateButton.textContent = selected ? "已加入" : "候選";
  candidateButton.title = selected ? "從候選清單移出這張照片" : "加入候選清單";
  candidateButton.setAttribute("aria-label", selected ? "從候選清單移出這張照片" : "加入候選清單");
  candidateButton.setAttribute("aria-pressed", selected ? "true" : "false");
  candidateButton.classList.toggle("is-selected", selected);
  candidateButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleCandidate(photo.photo_id);
  });

  return card;
}
