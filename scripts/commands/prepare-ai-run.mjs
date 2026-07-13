import { copyFile, link, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { getAiLabelingPromptMetadata, writeAiLabelingPrompt } from "../lib/ai/ai-labeling-prompt.mjs";
import {
  buildImageInputErrorsArtifact,
  formatImageInputErrorSummary,
  imageInputErrorsFilename,
} from "../lib/ai/image-input-errors.mjs";
import { parseCsv, parseSemicolonList, toCsvLine } from "../lib/core/csv-utils.mjs";
import { photoHeaders } from "../lib/core/photo-schema.mjs";
import { createProgressThrottle } from "../lib/core/progress.mjs";
import { aiRunsDir, sheetsExportPhotosPath } from "../lib/core/workflow-paths.mjs";

const defaultLimit = 50;
const defaultImageSize = "large-1024";
const defaultStatus = "unreviewed";
const defaultFocus = "none";
const defaultDownloadConcurrency = 8;
const focusOptions = [defaultFocus, "design-metadata"];
const imageSizeSuffixes = new Map([
  ["medium-640", "z"],
  ["medium-800", "c"],
  ["large-1024", "b"],
]);
const imageSizeOptions = ["preview", ...imageSizeSuffixes.keys(), "original"];

function printUsage() {
  console.log(`Usage:
  pnpm ai:prepare

Options:
  --photos <path>       Source photos CSV. Default: tmp/sheets-export/photos.csv.
  --status <values>     Comma-separated curation_status values. Default: unreviewed.
                        Use "all" to include every status.
                        With --focus design-metadata, default is all.
  --album <album-id>    Only include photos whose album_ids contains this album ID.
                        May be repeated. Kept for single-album workflows.
  --albums <ids>        Comma-separated album IDs to include.
  --photo-ids <ids>     Comma-separated photo IDs to include.
  --focus <profile>     Focus selection profile. Options: ${focusOptions.join(", ")}.
                        design-metadata selects likely design-use photos that lack safe_crop.
  --limit <number|all>  Maximum selected photos. Use "all" for no limit.
                        Default: 50.
  --image-size <size>   Image size for AI downloads. Default: large-1024.
                        Options: ${imageSizeOptions.join(", ")}.
  --download-concurrency <n>
                        Parallel image downloads or URL resolutions. Default: ${defaultDownloadConcurrency}.
  --image-cache-dir <path>
                        Reuse existing images by photo_id before downloading. Accepts an
                        images directory or an AI run directory containing images/. May repeat.
  --output-dir <path>   Directory for AI run folders. Default: tmp/ai-runs.
  --run-id <id>         Run folder name. Default: ai-prepare-<timestamp>.
  --no-download         Create metadata files without downloading image files.
  --help, -h            Show this help.

The command creates tmp/ai-runs/<run-id>/ with input-photos.csv, photos.json,
manifest.json, ai-labeling-prompt.md, and downloaded images when downloads are
enabled. It does not write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    albumIds: [],
    download: true,
    downloadConcurrency: defaultDownloadConcurrency,
    focus: defaultFocus,
    help: false,
    imageCacheDirs: [],
    imageSize: defaultImageSize,
    limit: defaultLimit,
    outputDir: aiRunsDir,
    photoIds: [],
    photosPath: sheetsExportPhotosPath,
    runId: "",
    statusProvided: false,
    statusValues: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--photos") {
      options.photosPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--status") {
      options.statusValues = parseListOption(args[index + 1] ?? "");
      options.statusProvided = true;
      index += 1;
    } else if (arg === "--album") {
      options.albumIds.push(args[index + 1] ?? "");
      index += 1;
    } else if (arg === "--albums") {
      options.albumIds.push(...parseListOption(args[index + 1] ?? ""));
      index += 1;
    } else if (arg === "--photo-ids") {
      options.photoIds = parseListOption(args[index + 1] ?? "");
      index += 1;
    } else if (arg === "--focus") {
      options.focus = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--limit") {
      options.limit = parseLimitOption(args[index + 1] ?? "");
      index += 1;
    } else if (arg === "--image-size") {
      options.imageSize = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--download-concurrency") {
      options.downloadConcurrency = Number(args[index + 1] ?? "");
      index += 1;
    } else if (arg === "--image-cache-dir") {
      options.imageCacheDirs.push(args[index + 1] ?? "");
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--run-id") {
      options.runId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--no-download") {
      options.download = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.albumIds = [...new Set(options.albumIds.map((albumId) => albumId.trim()).filter(Boolean))];
  options.imageCacheDirs = [...new Set(options.imageCacheDirs.map((dir) => dir.trim()).filter(Boolean))];

  if (!options.help) {
    if (!options.photosPath) {
      throw new Error("--photos requires a path");
    }
    if (!focusOptions.includes(options.focus)) {
      throw new Error(`--focus must be one of: ${focusOptions.join(", ")}`);
    }
    if (!options.statusProvided) {
      options.statusValues = options.focus === "design-metadata" ? ["all"] : [defaultStatus];
    }
    if (!options.outputDir) {
      throw new Error("--output-dir requires a path");
    }
    if (options.limit !== "all" && (!Number.isInteger(options.limit) || options.limit <= 0)) {
      throw new Error('--limit must be a positive integer or "all"');
    }
    if (!Number.isInteger(options.downloadConcurrency) || options.downloadConcurrency <= 0) {
      throw new Error("--download-concurrency must be a positive integer");
    }
    if (options.statusValues.length === 0) {
      throw new Error("--status requires at least one value");
    }
    if (!imageSizeOptions.includes(options.imageSize)) {
      throw new Error(`--image-size must be one of: ${imageSizeOptions.join(", ")}`);
    }
    if (options.runId && sanitizeRunId(options.runId) !== options.runId) {
      throw new Error("--run-id may contain only letters, numbers, dots, underscores, and hyphens");
    }
  }

  return options;
}

function parseLimitOption(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "all") {
    return "all";
  }
  return Number.parseInt(value, 10);
}

function parseListOption(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeRunId(value) {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "-");
}

function defaultRunId() {
  return `ai-prepare-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
}

function validateHeaders(headers) {
  const matches = headers.length === photoHeaders.length
    && photoHeaders.every((header, index) => headers[index] === header);
  if (!matches) {
    throw new Error("photos CSV headers do not match data/photo-schema.json");
  }
}

function toRecord(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function hasValue(value) {
  return String(value ?? "").trim() !== "";
}

const designMetadataDescriptionPattern =
  /留白|放字|牆面|白牆|空白|空曠|大片|寬闊|舞台|講台|背板|看板|投影幕|螢幕|地面|前景|背景|左側|右側|中央|邊緣|桌面|橫幅|構圖|空間/;

const designMetadataRecommendedUses = new Set(["網站橫幅", "社群貼文", "講者宣傳", "新聞稿", "簡報"]);
const designMetadataSceneTags = new Set(["舞台", "背板", "場地", "場佈", "講者", "合照", "螢幕"]);

function matchesDesignMetadataFocus(photo) {
  if (hasValue(photo.safe_crop)) {
    return false;
  }

  const recommendedUses = parseSemicolonList(photo.recommended_uses ?? "");
  const sceneTags = parseSemicolonList(photo.scene_tags ?? "");

  return (
    photo.orientation === "landscape"
    || photo.has_negative_space === "true"
    || recommendedUses.some((value) => designMetadataRecommendedUses.has(value))
    || sceneTags.some((value) => designMetadataSceneTags.has(value))
    || designMetadataDescriptionPattern.test(photo.visual_description ?? "")
  );
}

function matchesFocusProfile(photo, focus) {
  if (focus === defaultFocus) {
    return true;
  }
  if (focus === "design-metadata") {
    return matchesDesignMetadataFocus(photo);
  }
  return false;
}

async function readPhotosCsv(path) {
  const text = await readFile(path, "utf8");
  const [headers, ...rows] = parseCsv(text);
  if (!headers) {
    throw new Error(`${path} is empty`);
  }
  validateHeaders(headers);
  return rows.map((row) => toRecord(headers, row));
}

function selectPhotos(photos, options) {
  const statusFilter = new Set(options.statusValues);
  const includeAllStatuses = statusFilter.has("all");
  const photoIdFilter = new Set(options.photoIds);
  const albumIdFilter = new Set(options.albumIds);

  const selected = photos
    .filter((photo) => photo.photo_id)
    .filter((photo) =>
      albumIdFilter.size === 0
      || parseSemicolonList(photo.album_ids ?? "").some((albumId) => albumIdFilter.has(albumId)),
    )
    .filter((photo) => photoIdFilter.size === 0 || photoIdFilter.has(photo.photo_id))
    .filter((photo) => includeAllStatuses || statusFilter.has(photo.curation_status || ""))
    .filter((photo) => matchesFocusProfile(photo, options.focus));

  return options.limit === "all" ? selected : selected.slice(0, options.limit);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function csvFromPhotos(photos) {
  return `${[photoHeaders.join(","), ...photos.map((photo) => toCsvLine(photoHeaders, photo))].join("\n")}\n`;
}

function buildSizedImageUrl(previewUrl, imageSize) {
  if (imageSize === "preview") {
    return previewUrl;
  }

  const suffix = imageSizeSuffixes.get(imageSize);
  if (!suffix) {
    throw new Error(`Cannot derive ${imageSize} from image_preview_url`);
  }

  let url;
  try {
    url = new URL(previewUrl);
  } catch {
    throw new Error(`Invalid image_preview_url: ${previewUrl}`);
  }

  const match = url.pathname.match(/^(.*\/\d+_[^/_]+)(?:_(?:s|q|t|m|n|w|z|c|b))?(\.[A-Za-z0-9]+)$/);
  if (!match) {
    throw new Error(`Could not derive Flickr ${imageSize} URL from: ${previewUrl}`);
  }

  url.pathname = `${match[1]}_${suffix}${match[2]}`;
  return url.toString();
}

function originalSizesUrl(photoUrl) {
  const url = new URL(photoUrl);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/$/, "");
  url.pathname = `${url.pathname}/sizes/o/`;
  return url.toString();
}

async function fetchOriginalImageUrl(photo) {
  if (!photo.photo_url) {
    throw new Error(`${photo.photo_id} has no photo_url`);
  }

  const response = await fetch(originalSizesUrl(photo.photo_url));
  if (!response.ok) {
    throw new Error(`${photo.photo_id} original size page fetch failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const match = html.match(/(?:https?:)?\/\/live\.staticflickr\.com\/[^"'\s<>]+_o\.[A-Za-z0-9]+|live\.staticflickr\.com\/[^"'\s<>]+_o\.[A-Za-z0-9]+/);
  if (!match) {
    throw new Error(`${photo.photo_id} original image URL was not found; Flickr may restrict original downloads`);
  }

  const url = match[0];
  if (url.startsWith("http")) {
    return url;
  }
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  return `https://${url}`;
}

async function resolveImageDownloadUrl(photo, imageSize) {
  if (imageSize === "original") {
    return fetchOriginalImageUrl(photo);
  }
  if (!photo.image_preview_url) {
    throw new Error(`${photo.photo_id} has no image_preview_url`);
  }
  return buildSizedImageUrl(photo.image_preview_url, imageSize);
}

function extensionFromUrl(url) {
  try {
    const extension = extname(basename(new URL(url).pathname)).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) {
      return extension === ".jpeg" ? ".jpg" : extension;
    }
  } catch {
    return "";
  }
  return "";
}

function extensionFromContentType(contentType) {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  return "";
}

function contentTypeFromExtension(extension) {
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "";
}

function safeFileStem(value) {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "-").replaceAll(/^-+|-+$/g, "");
}

async function readImageCacheDir(path, cache) {
  let entries;
  try {
    const stats = await stat(path);
    if (!stats.isDirectory()) {
      return;
    }
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Progress: image cache directory not found, skipping ${path}.`);
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) {
      continue;
    }
    const photoId = basename(entry.name, extension);
    if (!photoId || cache.has(photoId)) {
      continue;
    }
    cache.set(photoId, join(path, entry.name));
  }
}

async function readImageCache(paths) {
  const cache = new Map();
  for (const path of paths) {
    await readImageCacheDir(path, cache);
    await readImageCacheDir(join(path, "images"), cache);
  }
  return cache;
}

async function reuseCachedImage(photo, imagesDir, imageSize, imageCache) {
  const sourcePath = imageCache.get(photo.photo_id);
  if (!sourcePath) {
    return null;
  }

  const extension = extname(sourcePath).toLowerCase() || ".jpg";
  const fileStem = safeFileStem(photo.photo_id);
  if (!fileStem) {
    throw new Error(`${photo.photo_id} cannot be used as an image filename`);
  }

  const filePath = join(imagesDir, `${fileStem}${extension === ".jpeg" ? ".jpg" : extension}`);
  try {
    await link(sourcePath, filePath);
  } catch (error) {
    if (error.code === "EEXIST") {
      // A previous interrupted run may have already linked this cache entry.
    } else if (error.code === "EXDEV" || error.code === "EPERM" || error.code === "EOPNOTSUPP") {
      await copyFile(sourcePath, filePath);
    } else {
      throw error;
    }
  }

  let downloadUrl = "";
  try {
    downloadUrl = await resolveImageDownloadUrl(photo, imageSize);
  } catch {
    downloadUrl = photo.image_preview_url ?? "";
  }

  const stats = await stat(filePath);
  return {
    bytes: stats.size,
    content_type: contentTypeFromExtension(extension),
    download_url: downloadUrl,
    path: filePath,
    source_path: sourcePath,
  };
}

async function downloadImage(photo, imagesDir, imageSize) {
  const downloadUrl = await resolveImageDownloadUrl(photo, imageSize);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`${photo.photo_id} image download failed: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`${photo.photo_id} image download returned ${contentType}`);
  }

  const extension = extensionFromContentType(contentType) || extensionFromUrl(downloadUrl) || ".img";
  const fileStem = safeFileStem(photo.photo_id);
  if (!fileStem) {
    throw new Error(`${photo.photo_id} cannot be used as an image filename`);
  }

  const filePath = join(imagesDir, `${fileStem}${extension}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);

  return {
    bytes: buffer.byteLength,
    content_type: contentType,
    download_url: downloadUrl,
    path: filePath,
  };
}

async function prepareRun(options) {
  console.error(`Progress: reading photos CSV from ${options.photosPath}.`);
  const photos = await readPhotosCsv(options.photosPath);
  console.error(`Progress: selecting photos from ${photos.length} row(s).`);
  const selectedPhotos = selectPhotos(photos, options);
  if (selectedPhotos.length === 0) {
    throw new Error("No photos matched the requested filters");
  }
  console.error(`Progress: selected ${selectedPhotos.length} photo(s).`);

  const runId = options.runId || defaultRunId();
  const runDir = join(options.outputDir, runId);
  const imagesDir = join(runDir, "images");
  const imageInputErrorsPath = join(runDir, imageInputErrorsFilename);

  console.error(`Progress: creating AI run directory ${runDir}.`);
  await mkdir(runDir, { recursive: true });
  await rm(imageInputErrorsPath, { force: true });
  if (options.download) {
    await mkdir(imagesDir, { recursive: true });
  }

  const imageCache = options.download && options.imageCacheDirs.length > 0
    ? await readImageCache(options.imageCacheDirs)
    : new Map();
  if (imageCache.size > 0) {
    console.error(`Progress: loaded ${imageCache.size} cached image candidate(s).`);
  }

  console.error("Progress: writing input-photos.csv.");
  await writeFile(join(runDir, "input-photos.csv"), csvFromPhotos(selectedPhotos));

  let downloadedCount = 0;
  let cacheReusedCount = 0;
  let completedImageInputCount = 0;
  const shouldPrintImageProgress = createProgressThrottle();
  const errors = [];

  function printImageProgress({ force = false } = {}) {
    if (!shouldPrintImageProgress(completedImageInputCount, { force })) {
      return;
    }

    console.error(`Progress: image inputs ${completedImageInputCount}/${selectedPhotos.length} complete (downloaded ${downloadedCount}, cache reused ${cacheReusedCount}, failed ${errors.length}).`);
  }

  console.error(`Progress: preparing image inputs with concurrency ${options.downloadConcurrency}.`);
  const preparedPhotos = await mapWithConcurrency(selectedPhotos, options.downloadConcurrency, async (photo) => {
    const item = {
      ...photo,
      image_download_url: "",
      image_size: options.imageSize,
      local_image_path: "",
    };

    if (options.download) {
      try {
        let image = await reuseCachedImage(photo, imagesDir, options.imageSize, imageCache);
        if (image) {
          cacheReusedCount += 1;
        } else {
          image = await downloadImage(photo, imagesDir, options.imageSize);
          downloadedCount += 1;
        }
        item.image_download_url = image.download_url;
        item.local_image_path = relative(runDir, image.path);
        item.local_image_bytes = image.bytes;
        item.local_image_content_type = image.content_type;
        if (image.source_path) {
          item.local_image_source_path = image.source_path;
        }
      } catch (error) {
        errors.push({
          message: error.message,
          photo_id: photo.photo_id,
        });
      }
    } else {
      try {
        item.image_download_url = await resolveImageDownloadUrl(photo, options.imageSize);
      } catch (error) {
        errors.push({
          message: error.message,
          photo_id: photo.photo_id,
        });
      }
    }

    completedImageInputCount += 1;
    printImageProgress();
    return item;
  });
  printImageProgress({ force: true });

  if (errors.length > 0) {
    const artifact = buildImageInputErrorsArtifact({
      createdAt: new Date().toISOString(),
      downloadEnabled: options.download,
      errors,
      imageSize: options.imageSize,
      photosSource: options.photosPath,
      runId,
      selectedPhotoCount: selectedPhotos.length,
    });
    await writeFile(imageInputErrorsPath, `${JSON.stringify(artifact, null, 2)}\n`);
    throw new Error(formatImageInputErrorSummary(errors, imageInputErrorsPath));
  }

  const createdAt = new Date().toISOString();
  const promptMetadata = getAiLabelingPromptMetadata();
  const manifest = {
    created_at: createdAt,
    download_enabled: options.download,
    downloaded_photo_count: downloadedCount,
    cache_reused_photo_count: cacheReusedCount,
    image_size: options.imageSize,
    input_photos_csv: "input-photos.csv",
    manifest_version: 1,
    photos_json: "photos.json",
    photos_source: options.photosPath,
    ...promptMetadata,
    download_concurrency: options.downloadConcurrency,
    image_cache_dirs: options.imageCacheDirs,
    requested_album_id: options.albumIds.length === 1 ? options.albumIds[0] : "",
    requested_album_ids: options.albumIds,
    requested_focus: options.focus,
    requested_limit: options.limit,
    requested_photo_ids: options.photoIds,
    requested_status: options.statusValues,
    run_id: runId,
    selected_photo_count: selectedPhotos.length,
  };

  console.error("Progress: writing photos.json and manifest.json.");
  await writeFile(join(runDir, "photos.json"), `${JSON.stringify(preparedPhotos, null, 2)}\n`);
  await writeFile(join(runDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.error("Progress: writing ai-labeling-prompt.md.");
  const { promptPath } = writeAiLabelingPrompt(runDir);

  return {
    manifest,
    promptPath,
    runDir,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await prepareRun(options);
  console.log(`AI run prepared: ${result.runDir}`);
  console.log(`- selected photos: ${result.manifest.selected_photo_count}`);
  console.log(`- downloaded images: ${result.manifest.downloaded_photo_count}`);
  console.log(`- prompt: ${result.promptPath}`);
  console.log("- next: give ai-labeling-prompt.md and this run directory to the model. Direct runs should write per-photo artifacts under photo-artifacts/, then run pnpm ai:artifacts:merge -- --run-dir <dir> and pnpm ai:review -- --run-dir <dir>.");
  console.log("- large runs: use pnpm ai:shard:prepare -- --run-dir <dir>; workers must write per-photo artifacts under /tmp/ai-labeling-shards/<run-id>/photo-artifacts/ before merge/review.");
}

try {
  await main();
} catch (error) {
  console.error(`Could not prepare AI run: ${error.message}`);
  process.exitCode = 1;
}
