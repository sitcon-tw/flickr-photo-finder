import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { googleSheetsSpreadsheetId } from "./project-config.mjs";

const defaultOutputDir = "tmp/pages";

function printUsage() {
  console.log(`Usage:
  pnpm pages:build

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

function googleSheetsCsvUrl(spreadsheetId, sheetName) {
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
  taxonomyJsonUrl: "./data/tag-taxonomy.json",
};
`;
  await writeFile(join(outputDir, "config.js"), content);
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const photosCsvUrl = options.photosCsvUrl || googleSheetsCsvUrl(options.spreadsheetId, "photos");

  await rm(options.outputDir, { recursive: true, force: true });
  await mkdir(options.outputDir, { recursive: true });
  await copyIntoArtifact("app/index.html", options.outputDir, "index.html");
  await copyIntoArtifact("app/main.js", options.outputDir, "main.js");
  await copyIntoArtifact("app/styles.css", options.outputDir, "styles.css");
  await copyIntoArtifact("config/project.json", options.outputDir);
  await copyIntoArtifact("data/tag-taxonomy.json", options.outputDir);
  await writePagesConfig(options.outputDir, photosCsvUrl);
  await writeFile(join(options.outputDir, ".nojekyll"), "");

  console.log(`GitHub Pages artifact written to ${options.outputDir}`);
  console.log(`Photos CSV URL: ${photosCsvUrl}`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not build GitHub Pages artifact: ${error.message}`);
  process.exitCode = 1;
}
