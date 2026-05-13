import { performance } from "node:perf_hooks";

import { buildSearchText, filterAndSortPhotos } from "../../app/search-sort.js";
import { pageSize, taskModes } from "../../app/task-modes.js";

const args = process.argv.slice(2);
const countArgIndex = args.indexOf("--count");
const maxMsArgIndex = args.indexOf("--max-ms");
const photoCount = countArgIndex >= 0 ? Number(args[countArgIndex + 1]) : 10000;
const maxTotalMs =
  maxMsArgIndex >= 0 ? Number(args[maxMsArgIndex + 1]) : Number(process.env.FINDER_PERF_MAX_MS || 3500);

if (!Number.isInteger(photoCount) || photoCount <= 0) {
  console.error("--count must be a positive integer.");
  process.exit(1);
}

if (!Number.isFinite(maxTotalMs) || maxTotalMs <= 0) {
  console.error("--max-ms must be a positive number.");
  process.exit(1);
}

const events = ["SITCON 2023", "SITCON 2024", "SITCON 2025", "SITCON Camp 2026"];
const albums = [
  ["72157611111111111", "主議程"],
  ["72157622222222222", "贊助攤位"],
  ["72157633333333333", "會眾交流"],
  ["72157644444444444", "志工幕後"],
];
const scenes = ["舞台", "會眾", "交流", "攤位", "背板", "工作人員", "合照", "場地"];
const moods = ["友善", "交流感", "青春感", "專業", "熱鬧", "幕後感", "成就感", "活力"];
const uses = ["社群貼文", "社群介紹", "網站橫幅", "活動回顧", "贊助提案", "贊助成果報告", "新聞稿", "簡報"];
const sponsorshipTags = ["品牌露出", "會眾互動", "贊助成果佐證", "主舞台曝光", "觸及學生族群"];
const sponsorshipItems = ["攤位", "主舞台 Logo", "議程曝光", "社群貼文", "會眾互動"];
const collections = ["網站素材", "社群素材", "贊助素材", "回顧素材"];
const orientations = ["landscape", "portrait", "square"];
const safeCrops = ["16:9", "1:1", "9:16"];
const curationStatuses = ["reviewed", "ai_labeled", "unreviewed"];
const publicStatuses = ["approved", "needs_review", "avoid"];
const priorityLevels = ["high", "normal", "low"];

function pick(values, index, offset = 0) {
  return values[(index + offset) % values.length];
}

function pickPair(values, index, offset = 0) {
  return [pick(values, index, offset), pick(values, index, offset + 3)];
}

function createPhoto(index) {
  const [albumId, albumTitle] = pick(albums, index);
  const eventName = pick(events, index);
  const eventYear = String(2023 + (index % 4));
  const photo = {
    photo_id: `perf-${String(index + 1).padStart(5, "0")}`,
    photo_url: `https://www.flickr.com/photos/sitcon/9${String(index).padStart(10, "0")}/`,
    image_preview_url: `https://live.staticflickr.com/perf/${index}_m.jpg`,
    image_large_url: `https://live.staticflickr.com/perf/${index}_b.jpg`,
    original_url: `https://live.staticflickr.com/perf/${index}_o.jpg`,
    album_ids: [albumId],
    album_title: `${eventName} ${albumTitle}`,
    event_name: eventName,
    event_year: eventYear,
    people_count: String(index % 28),
    subject_type: index % 5 === 0 ? "space" : index % 3 === 0 ? "object" : "people",
    photographer: `攝影志工 ${index % 12}`,
    license: "CC BY 2.0",
    visual_description: `${eventName} ${albumTitle} 現場，包含${pick(scenes, index)}、${pick(moods, index)}與找圖用途。`,
    curation_notes: index % 7 === 0 ? "適合先檢查授權與人物露出。" : "",
    scene_tags: pickPair(scenes, index),
    mood_tags: pickPair(moods, index, 1),
    recommended_uses: pickPair(uses, index, 2),
    sponsorship_items: index % 4 === 0 ? pickPair(sponsorshipItems, index) : [],
    sponsorship_tags: index % 4 === 0 ? pickPair(sponsorshipTags, index, 1) : [],
    collections: [pick(collections, index)],
    orientation: pick(orientations, index),
    has_negative_space: index % 3 === 0 ? "true" : "false",
    safe_crop: pickPair(safeCrops, index),
    public_use_status: pick(publicStatuses, index),
    priority_level: pick(priorityLevels, index, 1),
    curation_status: pick(curationStatuses, index, 2),
    sheet_row_number: String(index + 2),
  };

  photo.search_text = buildSearchText(photo);
  return photo;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const photos = Array.from({ length: photoCount }, (_value, index) => createPhoto(index));
const tasksById = new Map(taskModes.map((task) => [task.id, task]));
const scenarios = [
  {
    name: "hero recommended with search",
    options: {
      filters: { search: "網站橫幅", orientation: ["landscape"], negativeSpace: ["true"], safeCrop: ["16:9"] },
      task: tasksById.get("hero"),
      sortMode: "recommended",
    },
  },
  {
    name: "sponsor report recommended",
    options: {
      filters: { search: "攤位", sponsorshipTag: ["會眾互動"], sponsorshipItem: ["攤位"] },
      task: tasksById.get("sponsor-report"),
      sortMode: "recommended",
    },
  },
  {
    name: "social discover spread",
    options: {
      filters: { search: "交流", scene: ["交流", "會眾"], publicStatus: ["approved", "needs_review"] },
      task: tasksById.get("social"),
      sortMode: "discover",
    },
  },
  {
    name: "curation review newest",
    options: {
      filters: { curationStatus: ["reviewed", "ai_labeled"], priority: ["high", "normal"] },
      task: tasksById.get("all"),
      sortMode: "newest",
      selectedPhotoIds: ["perf-00024", "perf-00240", "perf-02400"],
    },
  },
];

const started = performance.now();
const results = [];

try {
  for (const scenario of scenarios) {
    const scenarioStarted = performance.now();
    const sorted = filterAndSortPhotos(photos, scenario.options);
    const durationMs = performance.now() - scenarioStarted;
    const firstPage = sorted.slice(0, pageSize);

    assert(sorted.length > 0, `${scenario.name} returned no photos.`);
    assert(firstPage.length <= pageSize, `${scenario.name} first page exceeds pageSize.`);

    results.push({
      name: scenario.name,
      matches: sorted.length,
      firstPage: firstPage.length,
      durationMs,
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const totalMs = performance.now() - started;
const slowest = results.reduce((current, next) => (next.durationMs > current.durationMs ? next : current), results[0]);

for (const result of results) {
  console.log(
    `${result.name}: ${result.matches} matches, first page ${result.firstPage}, ${result.durationMs.toFixed(1)}ms`,
  );
}

console.log(`Synthetic finder performance: ${photoCount} photos, ${results.length} scenarios, ${totalMs.toFixed(1)}ms total.`);

if (totalMs > maxTotalMs) {
  console.error(
    `Finder performance check exceeded ${maxTotalMs}ms total. Slowest scenario: ${slowest.name} (${slowest.durationMs.toFixed(1)}ms).`,
  );
  process.exit(1);
}
