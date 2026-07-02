import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as parseNodeArgs } from "node:util";
import { googleSheetsSpreadsheetId, projectConfig } from "../lib/core/project-config.mjs";
import { collectRelativeJavaScriptImportGraph } from "../lib/pages/js-import-graph.mjs";
import {
  buildStaticFinderPayloads,
  defaultFinderDataDir,
  defaultShardSize,
  finderDataModes,
  finderDataSources,
  readStaticFinderDataInputs,
  sha256,
  writeStaticFinderDataArtifacts,
} from "../lib/pages/static-finder-data.mjs";

export const defaultOutputDir = "tmp/pages";

function printUsage() {
  console.log(`Usage:
  pnpm finder:build

Options:
  --output-dir <path>     Directory for the GitHub Pages artifact. Default: tmp/pages.
  --spreadsheet-id <id>   Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --albums-csv-url <url>  Override the public albums CSV URL.
  --photos-csv-url <url>  Override the public photos CSV URL.
  --data-mode <mode>      runtime-csv or static-sharded. Default: static-sharded.
  --data-source <source>  public-csv or export for static-sharded. Default: public-csv.
  --shard-size <count>    Photos per detail shard for static-sharded. Default: 512.
  --help, -h              Show this help.

This command builds a clean GitHub Pages artifact. It does not write Google
Sheets and does not include repo tools, fixtures, tmp data, or credentials.
In static-sharded mode it builds a public read model from Google Sheets data
at build time so production Pages does not fetch Google Sheets at runtime.`);
}

function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv.slice(2),
    options: {
      "output-dir": { type: "string" },
      "spreadsheet-id": { type: "string" },
      "albums-csv-url": { type: "string" },
      "photos-csv-url": { type: "string" },
      "data-mode": { type: "string" },
      "data-source": { type: "string" },
      "shard-size": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const options = {
    help: values.help ?? false,
    outputDir: values["output-dir"] ?? defaultOutputDir,
    albumsCsvUrl: values["albums-csv-url"] ?? "",
    dataMode: values["data-mode"] ?? "static-sharded",
    dataSource: values["data-source"] ?? "public-csv",
    photosCsvUrl: values["photos-csv-url"] ?? "",
    shardSize: values["shard-size"] === undefined ? defaultShardSize : Number(values["shard-size"]),
    spreadsheetId: values["spreadsheet-id"] ?? googleSheetsSpreadsheetId,
  };

  if (!options.help) {
    if (!options.outputDir) {
      throw new Error("--output-dir requires a path");
    }
    if (!finderDataModes.has(options.dataMode)) {
      throw new Error(`--data-mode must be one of: ${[...finderDataModes].join(", ")}`);
    }
    if (!finderDataSources.has(options.dataSource)) {
      throw new Error(`--data-source must be one of: ${[...finderDataSources].join(", ")}`);
    }
    if (!Number.isInteger(options.shardSize) || options.shardSize < 1) {
      throw new Error("--shard-size must be a positive integer");
    }
    if (options.dataMode === "runtime-csv" && !options.photosCsvUrl && !options.spreadsheetId) {
      throw new Error("Set googleSheets.spreadsheetId in config/project.json, pass --spreadsheet-id, or pass --photos-csv-url");
    }
    if (options.dataMode === "static-sharded" && options.dataSource === "public-csv" && !options.spreadsheetId && !options.photosCsvUrl) {
      throw new Error("Set googleSheets.spreadsheetId in config/project.json, pass --spreadsheet-id, or pass --photos-csv-url");
    }
  }

  return options;
}

export function googleSheetsCsvUrl(spreadsheetId, sheetName) {
  const url = new URL(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  url.searchParams.set("sheet", sheetName);
  return url.toString();
}

async function copyIntoArtifact(sourcePath, outputDir, targetPath = sourcePath) {
  const destination = join(outputDir, targetPath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(sourcePath, destination);
}

async function copyPagesJavaScriptModules(outputDir) {
  const files = await collectRelativeJavaScriptImportGraph({ rootDir: "app", entryFile: "main.js" });
  for (const file of files) {
    if (file === "config.js") {
      continue;
    }
    await copyIntoArtifact(join("app", file), outputDir, file);
  }
  return files.filter((file) => file !== "config.js");
}

function artifactUrl(path) {
  return `./${String(path).replace(/\\/g, "/")}`;
}

function uniqueSortedUrls(urls) {
  return [...new Set(urls)].sort();
}

export function buildFinderDataUrls(dataMode) {
  const urls = [
    "./config/project.json",
    "./data/interface-registry.json",
    "./data/photo-schema.json",
    "./data/search-aliases.json",
    "./data/tag-taxonomy.json",
  ];

  if (dataMode === "static-sharded") {
    urls.push(
      `./${defaultFinderDataDir}/manifest.json`,
      `./${defaultFinderDataDir}/albums.json`,
      `./${defaultFinderDataDir}/photos-index.json`,
    );
  }

  return uniqueSortedUrls(urls);
}

function buildPrecacheUrls({ dataMode, jsFiles }) {
  const urls = [
    "./",
    "./index.html",
    "./styles.css",
    "./config.js",
    "./assets/og-image.png",
    ...buildFinderDataUrls(dataMode),
    ...jsFiles.map(artifactUrl),
  ];

  return uniqueSortedUrls(urls);
}

function pwaCacheVersion({ dataMode, dataSource, precacheUrls, staticManifest }) {
  return sha256(JSON.stringify({
    dataMode,
    dataSource,
    generatedAt: staticManifest?.generatedAt ?? "",
    photosSha256: staticManifest?.source?.photosSha256 ?? "",
    precacheUrls,
    rowCount: staticManifest?.rowCount ?? 0,
    schemaVersion: staticManifest?.schemaVersion ?? "",
  })).slice(0, 16);
}

async function writeServiceWorker(outputDir, { dataMode, dataSource, jsFiles, staticManifest }) {
  const precacheUrls = buildPrecacheUrls({ dataMode, jsFiles });
  const finderDataUrls = buildFinderDataUrls(dataMode);
  const cacheVersion = pwaCacheVersion({ dataMode, dataSource, precacheUrls, staticManifest });
  const source = await readFile("app/service-worker.js", "utf8");
  const header = [
    `self.__SITCON_PHOTO_FINDER_PRECACHE_URLS__ = ${JSON.stringify(precacheUrls)};`,
    `self.__SITCON_PHOTO_FINDER_DATA_URLS__ = ${JSON.stringify(finderDataUrls)};`,
    `self.__SITCON_PHOTO_FINDER_CACHE_VERSION__ = ${JSON.stringify(cacheVersion)};`,
    "",
  ].join("\n");
  await writeFile(join(outputDir, "service-worker.js"), `${header}${source}`);
}

async function writePagesConfig(outputDir, { albumsCsvUrl, dataMode, photosCsvUrl }) {
  const content = `export const projectConfigUrl = "./config/project.json";

export const dataSources = {
  mode: ${JSON.stringify(dataMode)},
  albumsCsvUrl: ${JSON.stringify(albumsCsvUrl)},
  photosCsvUrl: ${JSON.stringify(photosCsvUrl)},
  finderDataManifestUrl: "./${defaultFinderDataDir}/manifest.json",
  finderDataAlbumsUrl: "./${defaultFinderDataDir}/albums.json",
  finderDataIndexUrl: "./${defaultFinderDataDir}/photos-index.json",
  interfaceRegistryJsonUrl: "./data/interface-registry.json",
  schemaJsonUrl: "./data/photo-schema.json",
  searchAliasesJsonUrl: "./data/search-aliases.json",
  taxonomyJsonUrl: "./data/tag-taxonomy.json",
};
`;
  await writeFile(join(outputDir, "config.js"), content);
}

async function fetchText(url, label) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch ${label}: HTTP ${response.status}`);
  }
  return response.text();
}

async function readPublicCsvInputs({ albumsCsvUrl, photosCsvUrl }) {
  const [albumsText, photosText, photoSchema, taxonomy, searchAliases] = await Promise.all([
    albumsCsvUrl ? fetchText(albumsCsvUrl, "albums CSV") : Promise.resolve(""),
    fetchText(photosCsvUrl, "photos CSV"),
    readFile("data/photo-schema.json", "utf8").then(JSON.parse),
    readFile("data/tag-taxonomy.json", "utf8").then(JSON.parse),
    readFile("data/search-aliases.json", "utf8").then(JSON.parse),
  ]);
  return { albumsText, photoSchema, photosText, searchAliases, taxonomy };
}

async function buildStaticFinderData({ albumsCsvUrl, outputDir, photosCsvUrl, dataSource, shardSize }) {
  const input =
    dataSource === "export"
      ? await readStaticFinderDataInputs()
      : await readPublicCsvInputs({ albumsCsvUrl, photosCsvUrl });
  const payloads = buildStaticFinderPayloads({
    ...input,
    shardSize,
    source: dataSource === "export"
      ? { type: "export", albumsCsvPath: "tmp/sheets-export/albums.csv", photosCsvPath: "tmp/sheets-export/photos.csv" }
      : { type: "public-csv", albumsCsvUrl, photosCsvUrl },
  });
  await writeStaticFinderDataArtifacts({
    outputDir: join(outputDir, defaultFinderDataDir),
    payloads,
  });
  return payloads.manifest;
}

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeSiteUrl(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "";
  }
  const siteUrl = new URL(rawValue).toString();
  return siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
}

function absoluteMetadataUrl(siteUrl, path) {
  if (!siteUrl) {
    return "";
  }
  return new URL(String(path ?? "").trim() || ".", siteUrl).toString();
}

function renderMetadataHtml() {
  const title = String(projectConfig.frontend?.appTitle ?? "Flickr Photo Finder").trim();
  const metadata = projectConfig.frontend?.metadata ?? {};
  const description = String(metadata.description ?? "SITCON 公開照片索引，依工作需求、內容與整理狀態快速找圖。").trim();
  const siteUrl = normalizeSiteUrl(metadata.siteUrl);
  const imageUrl = absoluteMetadataUrl(siteUrl, metadata.imagePath ?? "./assets/og-image.png");
  const imageAlt = String(metadata.imageAlt ?? `${title} 分享預覽圖`).trim();

  const tags = [
    `<title>${escapeHtmlAttribute(title)}</title>`,
    `<meta name="description" content="${escapeHtmlAttribute(description)}" />`,
    siteUrl ? `<link rel="canonical" href="${escapeHtmlAttribute(siteUrl)}" />` : "",
    `<meta property="og:locale" content="zh_TW" />`,
    `<meta property="og:site_name" content="${escapeHtmlAttribute(title)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtmlAttribute(title)}" />`,
    `<meta property="og:description" content="${escapeHtmlAttribute(description)}" />`,
    siteUrl ? `<meta property="og:url" content="${escapeHtmlAttribute(siteUrl)}" />` : "",
    imageUrl ? `<meta property="og:image" content="${escapeHtmlAttribute(imageUrl)}" />` : "",
    imageUrl ? `<meta property="og:image:type" content="image/png" />` : "",
    imageUrl ? `<meta property="og:image:width" content="1200" />` : "",
    imageUrl ? `<meta property="og:image:height" content="630" />` : "",
    imageUrl ? `<meta property="og:image:alt" content="${escapeHtmlAttribute(imageAlt)}" />` : "",
    imageUrl ? `<meta name="twitter:card" content="summary_large_image" />` : `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeHtmlAttribute(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtmlAttribute(description)}" />`,
    imageUrl ? `<meta name="twitter:image" content="${escapeHtmlAttribute(imageUrl)}" />` : "",
    imageUrl ? `<meta name="twitter:image:alt" content="${escapeHtmlAttribute(imageAlt)}" />` : "",
  ];

  return tags.filter(Boolean).map((tag) => `    ${tag}`).join("\n");
}

async function writeIndexHtml(outputDir) {
  const source = await readFile("app/index.html", "utf8");
  const startMarker = "    <!-- app-metadata:start -->";
  const endMarker = "    <!-- app-metadata:end -->";
  const startIndex = source.indexOf(startMarker);
  const endIndex = source.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error("app/index.html must contain app-metadata markers");
  }

  const before = source.slice(0, startIndex);
  const after = source.slice(endIndex + endMarker.length);
  const metadataHtml = renderMetadataHtml();
  await writeFile(join(outputDir, "index.html"), `${before}${startMarker}\n${metadataHtml}\n${endMarker}${after}`);
}

export async function buildPagesArtifact({
  outputDir = defaultOutputDir,
  albumsCsvUrl = "",
  dataMode = "static-sharded",
  dataSource = "public-csv",
  photosCsvUrl = "",
  shardSize = defaultShardSize,
  spreadsheetId = googleSheetsSpreadsheetId,
} = {}) {
  if (!outputDir) {
    throw new Error("--output-dir requires a path");
  }
  if (!finderDataModes.has(dataMode)) {
    throw new Error(`--data-mode must be one of: ${[...finderDataModes].join(", ")}`);
  }
  if (!finderDataSources.has(dataSource)) {
    throw new Error(`--data-source must be one of: ${[...finderDataSources].join(", ")}`);
  }
  if (!photosCsvUrl && !spreadsheetId && dataMode === "runtime-csv") {
    throw new Error("Set googleSheets.spreadsheetId in config/project.json, pass --spreadsheet-id, or pass --photos-csv-url");
  }
  if (!photosCsvUrl && !spreadsheetId && dataMode === "static-sharded" && dataSource === "public-csv") {
    throw new Error("Set googleSheets.spreadsheetId in config/project.json, pass --spreadsheet-id, or pass --photos-csv-url");
  }

  const resolvedAlbumsCsvUrl = albumsCsvUrl || (spreadsheetId ? googleSheetsCsvUrl(spreadsheetId, "albums") : "");
  const resolvedPhotosCsvUrl = photosCsvUrl || (spreadsheetId ? googleSheetsCsvUrl(spreadsheetId, "photos") : "");

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await writeIndexHtml(outputDir);
  const jsFiles = await copyPagesJavaScriptModules(outputDir);
  await copyIntoArtifact("app/styles.css", outputDir, "styles.css");
  await copyIntoArtifact("app/assets/og-image.png", outputDir, "assets/og-image.png");
  await copyIntoArtifact("config/project.json", outputDir);
  await copyIntoArtifact("data/interface-registry.json", outputDir);
  await copyIntoArtifact("data/photo-schema.json", outputDir);
  await copyIntoArtifact("data/search-aliases.json", outputDir);
  await copyIntoArtifact("data/tag-taxonomy.json", outputDir);
  let staticManifest = null;
  if (dataMode === "static-sharded") {
    staticManifest = await buildStaticFinderData({
      albumsCsvUrl: resolvedAlbumsCsvUrl,
      dataSource,
      outputDir,
      photosCsvUrl: resolvedPhotosCsvUrl,
      shardSize,
    });
  }
  await writePagesConfig(outputDir, {
    albumsCsvUrl: dataMode === "runtime-csv" ? resolvedAlbumsCsvUrl : "",
    dataMode,
    photosCsvUrl: dataMode === "runtime-csv" ? resolvedPhotosCsvUrl : "",
  });
  await writeServiceWorker(outputDir, {
    dataMode,
    dataSource,
    jsFiles,
    staticManifest,
  });
  await writeFile(join(outputDir, ".nojekyll"), "");

  return {
    dataMode,
    dataSource,
    outputDir,
    albumsCsvUrl: resolvedAlbumsCsvUrl,
    photosCsvUrl: resolvedPhotosCsvUrl,
    staticManifest,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await buildPagesArtifact(options);

  console.log(`GitHub Pages artifact written to ${result.outputDir}`);
  console.log(`Data mode: ${result.dataMode}`);
  console.log(`Data source: ${result.dataSource}`);
  if (result.dataMode === "runtime-csv") {
    console.log(`Albums CSV URL: ${result.albumsCsvUrl || "(none)"}`);
    console.log(`Photos CSV URL: ${result.photosCsvUrl}`);
  } else {
    console.log(`Static photos: ${result.staticManifest.rowCount}`);
    console.log(`Static shards: ${result.staticManifest.shards.length}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not build GitHub Pages artifact: ${error.message}`);
    process.exitCode = 1;
  }
}
