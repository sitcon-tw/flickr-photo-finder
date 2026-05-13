import { resultCountBucket } from "./analytics.js";
import { scoreOverlap, textMatches } from "./search-sort.js";

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

async function copyUrlToClipboard(url, button) {
  if (!url) {
    return false;
  }
  const copied = await copyTextToClipboard(url);
  if (copied) {
    setTemporaryButtonText(button, "已複製");
  }
  return copied;
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

function imageDownloadFilename(photo, url) {
  const title = safeFilenamePart(photoTitle(photo));
  const id = safeFilenamePart(photo.photo_id) || "photo";
  return `${id}${title ? `-${title}` : ""}.${imageFileExtension(url)}`;
}

async function downloadImageUrl(url, filename) {
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

function setActionButton(button, enabled) {
  button.disabled = !enabled;
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

function trackImageSizeOpen(photo, imageSize, resultRank, resultCount, context) {
  context.trackEvent("open_image_size", {
    photo_id: photo.photo_id,
    image_size: imageSize,
    ...photoEventParams(photo, resultRank, resultCount, context),
  });
}

function trackImageSizeDownload(photo, imageSize, resultRank, resultCount, context) {
  context.trackEvent("download_image_size", {
    photo_id: photo.photo_id,
    image_size: imageSize,
    ...photoEventParams(photo, resultRank, resultCount, context),
  });
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

function firstOverlap(photoValues, taskValues) {
  const values = Array.isArray(photoValues) ? photoValues : [photoValues].filter(Boolean);
  return values.find((value) => taskValues?.includes(value)) ?? "";
}

function appendSignal(signals, label) {
  if (label && !signals.includes(label)) {
    signals.push(label);
  }
}

function sortingSignals(photo, { task, searchValue, labelFor }) {
  const signals = [];
  if (searchValue && textMatches(photo, searchValue)) {
    appendSignal(signals, "搜尋命中");
  }
  if (task.id !== "all") {
    if (scoreOverlap(photo.recommended_uses, task.recommendedUses, 1)) {
      appendSignal(signals, "用途命中");
    }
    if (scoreOverlap(photo.scene_tags, task.scenes, 1)) {
      appendSignal(signals, "場景命中");
    }
    if (scoreOverlap(photo.mood_tags, task.moods, 1)) {
      appendSignal(signals, "氛圍命中");
    }
    if (scoreOverlap(photo.sponsorship_tags, task.sponsorshipTags, 1)) {
      appendSignal(signals, "贊助價值命中");
    }
    const matchedOrientation = firstOverlap(photo.orientation, task.orientations);
    if (matchedOrientation) {
      appendSignal(signals, labelFor("orientation", matchedOrientation));
    }
    const matchedCrop = firstOverlap(photo.safe_crop, task.safeCrops);
    if (matchedCrop) {
      appendSignal(signals, matchedCrop);
    }
    if (task.prefersNegativeSpace && photo.has_negative_space === "true") {
      appendSignal(signals, labelFor("has_negative_space", "true"));
    }
  }
  if (photo.priority_level === "high") {
    appendSignal(signals, labelFor("priority_level", "high"));
  }
  return signals.slice(0, 4);
}

function renderPhotoReference(container, photo, signals) {
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

export function renderPhotoCard(photo, resultRank, resultCount, context) {
  const { template, selectedPhotoIds, projectConfig, labelFor, toggleCandidate, trackEvent, openPreview } = context;
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".photo-card");
  const link = fragment.querySelector(".photo-link");
  const linkHint = fragment.querySelector(".photo-link-hint");
  const image = fragment.querySelector("img");
  const title = fragment.querySelector(".photo-title");
  const year = fragment.querySelector(".photo-year");
  const statuses = fragment.querySelector(".photo-statuses");
  const reference = fragment.querySelector(".photo-reference");
  const quickDetails = fragment.querySelector(".quick-details");
  const details = fragment.querySelector(".details");
  const downloadLargeButton = fragment.querySelector(".download-large-image-button");
  const originalImageLink = fragment.querySelector(".original-image-link");
  const sheetRowLinkElement = fragment.querySelector(".sheet-row-link");
  const candidateButton = fragment.querySelector(".candidate-toggle-button");
  const copyFlickrLinkButton = fragment.querySelector(".copy-flickr-link-button");
  const copyFinderLinkButton = fragment.querySelector(".copy-finder-link-button");
  const largeUrl = largeImageUrl(photo);
  const originalUrl = originalSizePageUrl(photo);
  const selected = selectedPhotoIds.has(photo.photo_id);
  const detailOptions = { labelFor };

  card.id = photoAnchorId(photo.photo_id);
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
  title.textContent = photoTitle(photo);
  year.textContent = photo.event_year || "";
  appendBadges(statuses, statusBadges(photo, labelFor));

  renderPhotoReference(reference, photo, sortingSignals(photo, context));

  appendDetail(quickDetails, "用途", photo.recommended_uses.slice(0, 3), detailOptions);
  appendDetail(quickDetails, "構圖", [labelFor("orientation", photo.orientation), ...photo.safe_crop].filter(Boolean), detailOptions);
  appendDetail(quickDetails, "贊助", [...photo.sponsorship_tags, ...photo.sponsorship_items].slice(0, 3), detailOptions);

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

  candidateButton.textContent = "候選";
  candidateButton.title = selected ? "從候選清單移出這張照片" : "加入候選清單";
  candidateButton.setAttribute("aria-label", selected ? "從候選清單移出這張照片" : "加入候選清單");
  candidateButton.setAttribute("aria-pressed", selected ? "true" : "false");
  candidateButton.classList.toggle("is-selected", selected);
  candidateButton.addEventListener("click", () => {
    toggleCandidate(photo.photo_id);
  });

  downloadLargeButton.title = "直接下載 Flickr large-1024 圖片";
  setActionButton(downloadLargeButton, Boolean(largeUrl));
  downloadLargeButton.addEventListener("click", async () => {
    if (!largeUrl) {
      return;
    }
    const originalText = downloadLargeButton.textContent;
    try {
      downloadLargeButton.disabled = true;
      downloadLargeButton.textContent = "下載中";
      await downloadImageUrl(largeUrl, imageDownloadFilename(photo, largeUrl));
      trackImageSizeDownload(photo, "large_1024", resultRank, resultCount, context);
      downloadLargeButton.textContent = "已下載";
    } catch {
      downloadLargeButton.textContent = "下載失敗";
    } finally {
      window.setTimeout(() => {
        downloadLargeButton.disabled = false;
        downloadLargeButton.textContent = originalText;
      }, 1900);
    }
  });
  setActionLink(originalImageLink, originalUrl);
  originalImageLink.title = "開啟 Flickr 原始尺寸頁";
  originalImageLink.addEventListener("click", (event) => {
    if (!originalUrl) {
      event.preventDefault();
      return;
    }
    trackImageSizeOpen(photo, "original", resultRank, resultCount, context);
  });
  setActionLink(sheetRowLinkElement, sheetRowLink(photo, projectConfig));
  sheetRowLinkElement.title = "開啟 Google Sheets 中的這一列";

  copyFlickrLinkButton.disabled = !photo.photo_url;
  copyFlickrLinkButton.title = "複製 Flickr 原始照片頁連結";
  copyFlickrLinkButton.addEventListener("click", async () => {
    try {
      const copied = await copyUrlToClipboard(photo.photo_url, copyFlickrLinkButton);
      if (copied) {
        trackEvent("copy_flickr_link", {
          photo_id: photo.photo_id,
          ...photoEventParams(photo, resultRank, resultCount, context),
        });
      }
    } catch {
      setTemporaryButtonText(copyFlickrLinkButton, "複製失敗");
    }
  });

  copyFinderLinkButton.title = "複製 Finder 中這張照片的 deep link";
  copyFinderLinkButton.addEventListener("click", async () => {
    try {
      const copied = await copyUrlToClipboard(finderLink(photo), copyFinderLinkButton);
      if (copied) {
        trackEvent("copy_finder_link", {
          photo_id: photo.photo_id,
          ...photoEventParams(photo, resultRank, resultCount, context),
        });
      }
    } catch {
      setTemporaryButtonText(copyFinderLinkButton, "複製失敗");
    }
  });

  return card;
}
