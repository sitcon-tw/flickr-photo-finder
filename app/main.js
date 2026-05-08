import { dataSources } from "./config.js";

const listFields = [
  "scene_tags",
  "mood_tags",
  "recommended_uses",
  "sponsorship_items",
  "sponsorship_tags",
  "safe_crop",
  "collections",
];

const controls = {
  search: document.querySelector("#searchInput"),
  use: document.querySelector("#useFilter"),
  mood: document.querySelector("#moodFilter"),
  scene: document.querySelector("#sceneFilter"),
  sponsorshipItem: document.querySelector("#sponsorshipItemFilter"),
  publicStatus: document.querySelector("#publicStatusFilter"),
  priority: document.querySelector("#priorityFilter"),
  curationStatus: document.querySelector("#curationStatusFilter"),
  collection: document.querySelector("#collectionFilter"),
  reset: document.querySelector("#resetButton"),
};

const grid = document.querySelector("#photoGrid");
const summary = document.querySelector("#resultSummary");
const template = document.querySelector("#photoCardTemplate");

let photos = [];

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      field = "";
      row = [];
      continue;
    }

    field += char;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((value) => value !== "")) {
      rows.push(row);
    }
  }

  return rows;
}

function parseList(value) {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toObjects(rows) {
  const [headers, ...dataRows] = rows;
  return dataRows.map((row) => {
    const photo = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
    for (const field of listFields) {
      photo[field] = parseList(photo[field] ?? "");
    }
    return photo;
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, "zh-Hant-TW"),
  );
}

function fillSelect(select, label, values) {
  select.replaceChildren();
  select.append(new Option(label, ""));
  for (const value of values) {
    select.append(new Option(value, value));
  }
}

function setupFilters(taxonomy) {
  fillSelect(controls.use, "全部用途", taxonomy.recommended_uses ?? []);
  fillSelect(controls.mood, "全部氛圍", taxonomy.mood_tags ?? []);
  fillSelect(controls.scene, "全部場景", taxonomy.scene_tags ?? []);
  fillSelect(controls.sponsorshipItem, "全部品項", taxonomy.sponsorship_items ?? []);
  fillSelect(controls.publicStatus, "全部狀態", taxonomy.public_use_status ?? []);
  fillSelect(controls.priority, "全部優先度", taxonomy.priority_level ?? []);
  fillSelect(controls.curationStatus, "全部整理狀態", taxonomy.curation_status ?? []);
  fillSelect(
    controls.collection,
    "全部素材包",
    uniqueSorted(photos.flatMap((photo) => photo.collections)),
  );
}

function textMatches(photo, query) {
  if (!query) {
    return true;
  }

  const searchable = [
    photo.photo_id,
    photo.album_title,
    photo.event_name,
    photo.event_year,
    photo.photographer,
    photo.license,
    photo.orientation,
    photo.public_use_status,
    photo.priority_level,
    photo.internal_notes,
    photo.curation_status,
    ...photo.scene_tags,
    ...photo.mood_tags,
    ...photo.recommended_uses,
    ...photo.sponsorship_items,
    ...photo.sponsorship_tags,
    ...photo.collections,
  ]
    .join(" ")
    .toLowerCase();

  return searchable.includes(query.toLowerCase());
}

function hasListValue(photo, field, value) {
  return !value || photo[field].includes(value);
}

function matchesFilters(photo) {
  return (
    textMatches(photo, controls.search.value.trim()) &&
    hasListValue(photo, "recommended_uses", controls.use.value) &&
    hasListValue(photo, "mood_tags", controls.mood.value) &&
    hasListValue(photo, "scene_tags", controls.scene.value) &&
    hasListValue(photo, "sponsorship_items", controls.sponsorshipItem.value) &&
    hasListValue(photo, "collections", controls.collection.value) &&
    (!controls.publicStatus.value || photo.public_use_status === controls.publicStatus.value) &&
    (!controls.priority.value || photo.priority_level === controls.priority.value) &&
    (!controls.curationStatus.value || photo.curation_status === controls.curationStatus.value)
  );
}

function appendDetail(details, label, values, options = {}) {
  const normalizedValues = Array.isArray(values) ? values : [values].filter(Boolean);
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
    tag.className = options.status ? `tag status-${value}` : "tag";
    tag.textContent = value;
    description.append(tag);
  }

  row.append(term, description);
  details.append(row);
}

function renderPhoto(photo) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".photo-card");
  const link = fragment.querySelector(".photo-link");
  const image = fragment.querySelector("img");
  const title = fragment.querySelector(".photo-title");
  const year = fragment.querySelector(".photo-year");
  const details = fragment.querySelector(".details");
  const notes = fragment.querySelector(".notes");

  link.href = photo.photo_url;
  image.src = photo.image_preview_url;
  image.alt = [photo.event_name, photo.event_year, photo.photographer]
    .filter(Boolean)
    .join(" ");
  title.textContent = photo.event_name || photo.album_title || `Flickr ${photo.photo_id}`;
  year.textContent = photo.event_year || "";

  appendDetail(details, "用途", photo.recommended_uses);
  appendDetail(details, "氛圍", photo.mood_tags);
  appendDetail(details, "場景", photo.scene_tags);
  appendDetail(details, "贊助品項", photo.sponsorship_items);
  appendDetail(details, "贊助價值", photo.sponsorship_tags);
  appendDetail(details, "素材包", photo.collections);
  appendDetail(details, "攝影", photo.photographer);
  appendDetail(details, "授權", photo.license);
  appendDetail(details, "公開狀態", photo.public_use_status, { status: true });
  appendDetail(details, "推薦優先度", photo.priority_level, { status: true });
  appendDetail(details, "整理狀態", photo.curation_status, { status: true });
  appendDetail(details, "裁切", photo.safe_crop);
  appendDetail(details, "Flickr ID", photo.photo_id);

  notes.textContent = photo.internal_notes || "";
  if (!notes.textContent) {
    notes.remove();
  }

  return card;
}

function render() {
  const filtered = photos.filter(matchesFilters);
  grid.replaceChildren();
  summary.textContent = `${filtered.length} / ${photos.length} 張照片`;

  if (photos.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "data/photos.csv 目前沒有照片資料";
    grid.append(empty);
    return;
  }

  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "沒有符合條件的照片";
    grid.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const photo of filtered) {
    fragment.append(renderPhoto(photo));
  }
  grid.append(fragment);
}

function resetFilters() {
  controls.search.value = "";
  controls.use.value = "";
  controls.mood.value = "";
  controls.scene.value = "";
  controls.sponsorshipItem.value = "";
  controls.publicStatus.value = "";
  controls.priority.value = "";
  controls.curationStatus.value = "";
  controls.collection.value = "";
  render();
}

async function loadData() {
  const [photosResponse, taxonomyResponse] = await Promise.all([
    fetch(dataSources.photosCsvUrl),
    fetch(dataSources.taxonomyJsonUrl),
  ]);

  if (!photosResponse.ok || !taxonomyResponse.ok) {
    throw new Error("資料載入失敗");
  }

  const [photosText, taxonomy] = await Promise.all([
    photosResponse.text(),
    taxonomyResponse.json(),
  ]);
  photos = toObjects(parseCsv(photosText));
  setupFilters(taxonomy);
  render();
}

for (const control of Object.values(controls)) {
  if (control === controls.reset) {
    continue;
  }
  control.addEventListener("input", render);
}

controls.reset.addEventListener("click", resetFilters);

try {
  await loadData();
} catch (error) {
  summary.textContent = "資料載入失敗";
  grid.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = error.message;
  grid.append(empty);
}
