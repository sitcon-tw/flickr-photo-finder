import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";

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
  await copyIntoArtifact("app/index.html", outputDir, "index.html");
  await copyIntoArtifact("app/main.js", outputDir, "main.js");
  await copyIntoArtifact("app/data-utils.js", outputDir, "data-utils.js");
  await copyIntoArtifact("app/task-modes.js", outputDir, "task-modes.js");
  await copyIntoArtifact("app/styles.css", outputDir, "styles.css");
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
