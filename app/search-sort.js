// Pure search/filter/sort logic for the Pages frontend. This module must not
// read DOM state; callers pass plain filter, sort, and task objects instead.
export function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function isFilled(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return String(value ?? "").trim() !== "";
}

export function numericValue(value) {
  const normalized = String(value ?? "").trim();
  return /^(0|[1-9]\d*)$/.test(normalized) ? Number(normalized) : null;
}

function asList(value) {
  return Array.isArray(value) ? value : [value].filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function buildSearchText(photo, { searchTokensForField = (_fieldName, value) => asList(value) } = {}) {
  const derivedTokens = [
    ...searchTokensForField("has_negative_space", photo.has_negative_space),
    ...searchTokensForField("orientation", photo.orientation),
    ...searchTokensForField("public_use_status", photo.public_use_status),
    ...searchTokensForField("priority_level", photo.priority_level),
    ...searchTokensForField("curation_status", photo.curation_status),
    ...asList(photo.safe_crop).flatMap((value) => searchTokensForField("safe_crop", value)),
  ];

  return [
    photo.photo_id,
    photo.photo_url,
    ...asList(photo.album_ids),
    photo.album_title,
    photo.event_name,
    photo.event_year,
    photo.people_count,
    ...searchTokensForField("subject_type", photo.subject_type),
    photo.photographer,
    photo.license,
    photo.visual_description,
    photo.curation_notes,
    ...asList(photo.scene_tags),
    ...asList(photo.mood_tags),
    ...asList(photo.recommended_uses),
    ...asList(photo.sponsorship_items),
    ...asList(photo.sponsorship_tags),
    ...asList(photo.collections),
    ...derivedTokens,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function queryAlternatives(term) {
  const aliases = new Map([
    ["可放字", ["可放字", "留白", "negative space"]],
    ["放字", ["可放字", "留白", "negative space"]],
    ["留白", ["留白", "可放字", "negative space"]],
    ["網站橫幅", ["網站橫幅", "網頁橫幅", "橫幅", "背景素材"]],
    ["版面背景", ["版面背景", "背景素材", "橫幅", "網站橫幅"]],
    ["logo", ["logo", "品牌露出", "背板"]],
    ["品牌", ["品牌", "品牌露出", "贊助成果佐證"]],
    ["社群感", ["社群感", "社群介紹", "交流感", "友善"]],
    ["友善交流", ["友善", "交流感", "交流"]],
    ["舞台講者", ["舞台", "講者", "新聞稿", "簡報"]],
    ["志工", ["志工", "志工招募", "工作人員", "幕後感"]],
    ["正式", ["正式", "專業", "新聞稿", "簡報"]],
  ]);
  return aliases.get(term) ?? [term];
}

export function textMatches(photo, query) {
  const normalized = normalizeText(query);
  if (!normalized) {
    return true;
  }

  const terms = normalized.split(/\s+/).filter(Boolean);
  return terms.every((term) => queryAlternatives(term).some((alternative) => photo.search_text.includes(alternative)));
}

export function hasListValue(photo, field, value) {
  return !value || asList(photo[field]).includes(value);
}

export function valuePartiallyMatchesList(photo, field, query) {
  const normalized = normalizeText(query);
  if (!normalized) {
    return true;
  }
  return asList(photo[field]).some((value) => normalizeText(value).includes(normalized));
}

export function matchesAlbum(photo, value) {
  if (!value) {
    return true;
  }
  if (value.startsWith("id:")) {
    return asList(photo.album_ids).includes(value.slice(3));
  }
  if (value.startsWith("title:")) {
    return photo.album_title === value.slice(6);
  }
  return asList(photo.album_ids).includes(value) || photo.album_title === value;
}

export function matchesPeopleCount(photo, value) {
  if (!value) {
    return true;
  }

  const normalized = String(photo.people_count ?? "").trim();
  if (value === "unknown") {
    return normalized === "";
  }

  if (!/^(0|[1-9]\d*)$/.test(normalized)) {
    return false;
  }

  const count = Number(normalized);
  if (value === "21+") {
    return count >= 21;
  }

  if (value.includes("-")) {
    const [min, max] = value.split("-").map(Number);
    return count >= min && count <= max;
  }

  return count === Number(value);
}

export function matchesFilters(photo, filters = {}) {
  return (
    textMatches(photo, filters.search ?? "") &&
    matchesAlbum(photo, filters.album ?? "") &&
    hasListValue(photo, "recommended_uses", filters.recommendedUse ?? "") &&
    hasListValue(photo, "mood_tags", filters.mood ?? "") &&
    hasListValue(photo, "scene_tags", filters.scene ?? "") &&
    matchesPeopleCount(photo, filters.peopleCount ?? "") &&
    (!filters.subjectType || photo.subject_type === filters.subjectType) &&
    (!filters.orientation || photo.orientation === filters.orientation) &&
    (!filters.negativeSpace || photo.has_negative_space === filters.negativeSpace) &&
    hasListValue(photo, "safe_crop", filters.safeCrop ?? "") &&
    hasListValue(photo, "sponsorship_tags", filters.sponsorshipTag ?? "") &&
    valuePartiallyMatchesList(photo, "sponsorship_items", filters.sponsorshipItem ?? "") &&
    hasListValue(photo, "collections", filters.collection ?? "") &&
    (!filters.publicStatus || photo.public_use_status === filters.publicStatus) &&
    (!filters.priority || photo.priority_level === filters.priority) &&
    (!filters.curationStatus || photo.curation_status === filters.curationStatus)
  );
}

export function scoreOverlap(photoValues, taskValues, weight) {
  if (!taskValues?.length) {
    return 0;
  }
  const values = asList(photoValues);
  return values.some((value) => taskValues.includes(value)) ? weight : 0;
}

export function photoScore(photo, task = {}) {
  const publicScore = { approved: 0, needs_review: -10, avoid: -160 };
  const curationScore = { reviewed: 60, ai_labeled: 25, unreviewed: 0 };
  const priorityScore = { high: 80, normal: 25, low: -10 };

  let score = 0;
  score += publicScore[photo.public_use_status] ?? 0;
  score += curationScore[photo.curation_status] ?? 0;
  score += priorityScore[photo.priority_level] ?? 0;
  score += isFilled(photo.image_preview_url) ? 10 : -50;

  score += scoreOverlap(photo.recommended_uses, task.recommendedUses, 150);
  score += scoreOverlap(photo.mood_tags, task.moods, 45);
  score += scoreOverlap(photo.scene_tags, task.scenes, 45);
  score += scoreOverlap(photo.sponsorship_tags, task.sponsorshipTags, 65);
  score += scoreOverlap(photo.orientation, task.orientations, 35);
  score += scoreOverlap(photo.safe_crop, task.safeCrops, 35);
  if (task.prefersNegativeSpace && photo.has_negative_space === "true") {
    score += 35;
  }

  return score;
}

export function compareRecommended(left, right, task = {}) {
  return (
    photoScore(right, task) - photoScore(left, task) ||
    (numericValue(right.event_year) ?? 0) - (numericValue(left.event_year) ?? 0) ||
    String(left.photo_id).localeCompare(String(right.photo_id), "zh-Hant-TW")
  );
}

export function overlaps(leftValues, rightValues) {
  const left = asList(leftValues).filter(Boolean);
  const right = asList(rightValues).filter(Boolean);
  return left.some((value) => right.includes(value));
}

export function discoveryPenalty(photo, recentPhotos, windowOffset) {
  let penalty = windowOffset * 4;
  for (const recentPhoto of recentPhotos) {
    if (photo.event_name && photo.event_name === recentPhoto.event_name) {
      penalty += 18;
    }
    if (photo.event_year && photo.event_year === recentPhoto.event_year) {
      penalty += 6;
    }
    if (overlaps(photo.album_ids, recentPhoto.album_ids)) {
      penalty += 14;
    }
    if (overlaps(photo.collections, recentPhoto.collections)) {
      penalty += 10;
    }
  }
  return penalty;
}

export function sortForDiscovery(items, { task = {}, discoverHistorySize = 12, discoverWindowSize = 24 } = {}) {
  const remaining = [...items].sort((left, right) => compareRecommended(left, right, task));
  const selected = [];

  while (remaining.length > 0) {
    const recentPhotos = selected.slice(-discoverHistorySize);
    const windowLength = Math.min(discoverWindowSize, remaining.length);
    let bestOffset = 0;
    let bestPenalty = Number.POSITIVE_INFINITY;

    for (let offset = 0; offset < windowLength; offset += 1) {
      const penalty = discoveryPenalty(remaining[offset], recentPhotos, offset);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestOffset = offset;
      }
    }

    selected.push(remaining.splice(bestOffset, 1)[0]);
  }

  return selected;
}

export function sortPhotos(items, { sortMode = "recommended", task = {}, discoverHistorySize = 12, discoverWindowSize = 24 } = {}) {
  if (sortMode === "discover") {
    return sortForDiscovery(items, { task, discoverHistorySize, discoverWindowSize });
  }

  return [...items].sort((left, right) => {
    if (sortMode === "newest" || sortMode === "oldest") {
      const leftYear = numericValue(left.event_year) ?? 0;
      const rightYear = numericValue(right.event_year) ?? 0;
      return sortMode === "newest" ? rightYear - leftYear : leftYear - rightYear;
    }

    if (sortMode === "people-desc" || sortMode === "people-asc") {
      const leftCount = numericValue(left.people_count) ?? -1;
      const rightCount = numericValue(right.people_count) ?? -1;
      return sortMode === "people-desc" ? rightCount - leftCount : leftCount - rightCount;
    }

    return compareRecommended(left, right, task);
  });
}

export function prioritizeSelectedPhotos(items, selectedPhotoIds = []) {
  const selectedOrder = new Map([...selectedPhotoIds].map((photoId, index) => [String(photoId), index]));
  if (selectedOrder.size === 0) {
    return items;
  }
  return [...items].sort((left, right) => {
    const leftOrder = selectedOrder.get(String(left.photo_id));
    const rightOrder = selectedOrder.get(String(right.photo_id));
    if (leftOrder === undefined && rightOrder === undefined) {
      return 0;
    }
    if (leftOrder === undefined) {
      return 1;
    }
    if (rightOrder === undefined) {
      return -1;
    }
    return leftOrder - rightOrder;
  });
}

export function filterAndSortPhotos(
  photos,
  { filters = {}, sortMode = "recommended", task = {}, discoverHistorySize = 12, discoverWindowSize = 24, selectedPhotoIds = [] } = {},
) {
  const sorted = sortPhotos(photos.filter((photo) => matchesFilters(photo, filters)), {
    sortMode,
    task,
    discoverHistorySize,
    discoverWindowSize,
  });
  return prioritizeSelectedPhotos(sorted, selectedPhotoIds);
}

export function uniqueSearchTokens(fieldName, value, optionLabels = new Map(), searchAliases = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return [];
  }
  const label = optionLabels.get(normalized) ?? normalized;
  return unique([normalized, label, ...(searchAliases[fieldName]?.[normalized] ?? [])]);
}
