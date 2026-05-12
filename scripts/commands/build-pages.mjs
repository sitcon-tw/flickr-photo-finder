import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { googleSheetsSpreadsheetId, projectConfig } from "../lib/core/project-config.mjs";

export const defaultOutputDir = "tmp/pages";

function printUsage() {
  console.log(`Usage:
  pnpm finder:build

Options:
  --output-dir <path>     Directory for the GitHub Pages artifact. Default: tmp/pages.
  --spreadsheet-id <id>   Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --photos-csv-url <url>  Override the public photos CSV URL.
  --help, -h              Show this help.

This command builds a clean GitHub Pages artifact. It does not write Google
Sheets and does not include repo tools, fixtures, tmp data, or credentials.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    outputDir: defaultOutputDir,
    photosCsvUrl: "",
    spreadsheetId: googleSheetsSpreadsheetId,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--output-dir") {
      options.outputDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--spreadsheet-id") {
      options.spreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--photos-csv-url") {
      options.photosCsvUrl = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.outputDir) {
      throw new Error("--output-dir requires a path");
    }
    if (!options.photosCsvUrl && !options.spreadsheetId) {
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

async function writePagesConfig(outputDir, photosCsvUrl) {
  const content = `export const projectConfigUrl = "./config/project.json";

export const dataSources = {
  photosCsvUrl: ${JSON.stringify(photosCsvUrl)},
  schemaJsonUrl: "./data/photo-schema.json",
  searchAliasesJsonUrl: "./data/search-aliases.json",
  taxonomyJsonUrl: "./data/tag-taxonomy.json",
};
`;
  await writeFile(join(outputDir, "config.js"), content);
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
  const description = String(metadata.description ?? "SITCON 公開照片索引，依任務、內容與整理狀態快速找圖。").trim();
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
  photosCsvUrl = "",
  spreadsheetId = googleSheetsSpreadsheetId,
} = {}) {
  if (!outputDir) {
    throw new Error("--output-dir requires a path");
  }
  if (!photosCsvUrl && !spreadsheetId) {
    throw new Error("Set googleSheets.spreadsheetId in config/project.json, pass --spreadsheet-id, or pass --photos-csv-url");
  }

  const resolvedPhotosCsvUrl = photosCsvUrl || googleSheetsCsvUrl(spreadsheetId, "photos");

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await writeIndexHtml(outputDir);
  await copyIntoArtifact("app/analytics.js", outputDir, "analytics.js");
  await copyIntoArtifact("app/ai-assistant.js", outputDir, "ai-assistant.js");
  await copyIntoArtifact("app/candidates.js", outputDir, "candidates.js");
  await copyIntoArtifact("app/controls.js", outputDir, "controls.js");
  await copyIntoArtifact("app/data-loader.js", outputDir, "data-loader.js");
  await copyIntoArtifact("app/data-utils.js", outputDir, "data-utils.js");
  await copyIntoArtifact("app/main.js", outputDir, "main.js");
  await copyIntoArtifact("app/overview-render.js", outputDir, "overview-render.js");
  await copyIntoArtifact("app/photo-render.js", outputDir, "photo-render.js");
  await copyIntoArtifact("app/result-render.js", outputDir, "result-render.js");
  await copyIntoArtifact("app/search-sort.js", outputDir, "search-sort.js");
  await copyIntoArtifact("app/task-modes.js", outputDir, "task-modes.js");
  await copyIntoArtifact("app/url-state.js", outputDir, "url-state.js");
  await copyIntoArtifact("app/styles.css", outputDir, "styles.css");
  await copyIntoArtifact("app/assets/og-image.png", outputDir, "assets/og-image.png");
  await copyIntoArtifact("config/project.json", outputDir);
  await copyIntoArtifact("data/photo-schema.json", outputDir);
  await copyIntoArtifact("data/search-aliases.json", outputDir);
  await copyIntoArtifact("data/tag-taxonomy.json", outputDir);
  await writePagesConfig(outputDir, resolvedPhotosCsvUrl);
  await writeFile(join(outputDir, ".nojekyll"), "");

  return {
    outputDir,
    photosCsvUrl: resolvedPhotosCsvUrl,
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
  console.log(`Photos CSV URL: ${result.photosCsvUrl}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not build GitHub Pages artifact: ${error.message}`);
    process.exitCode = 1;
  }
}
