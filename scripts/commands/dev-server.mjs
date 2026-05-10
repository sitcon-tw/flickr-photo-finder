import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { buildPagesArtifact } from "./build-pages.mjs";
import { appTitle } from "../lib/core/project-config.mjs";
import { startStaticServer } from "../lib/finder/serve.mjs";

const defaultOutputBaseDir = "tmp/pages-dev";
const localPhotosCsvUrl = "./local/photos.csv";
const localPhotosTarget = "local/photos.csv";
const sourceChoices = new Set(["sheets", "fixture", "export"]);

function printUsage() {
  console.log(`Usage:
  pnpm finder:dev
  pnpm finder:dev:fixture
  pnpm finder:dev:export

Options:
  --source <source>       Data source: sheets, fixture, or export. Default: sheets.
  --output-dir <path>     Directory for the local dev artifact. Default: tmp/pages-dev/<source>.
  --photos-csv-url <url>  Override the photos CSV URL.
  --help, -h              Show this help.

Environment:
  HOST                    Local server host. Default: 127.0.0.1.
  PORT                    Local server port. Default: 4173.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    outputDir: "",
    photosCsvUrl: "",
    source: "sheets",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--source") {
      options.source = args[index + 1] ?? "";
      if (!options.source || options.source.startsWith("--")) {
        throw new Error("--source requires a value");
      }
      index += 1;
    } else if (arg === "--output-dir") {
      options.outputDir = args[index + 1] ?? "";
      if (!options.outputDir || options.outputDir.startsWith("--")) {
        throw new Error("--output-dir requires a path");
      }
      index += 1;
    } else if (arg === "--photos-csv-url") {
      options.photosCsvUrl = args[index + 1] ?? "";
      if (!options.photosCsvUrl || options.photosCsvUrl.startsWith("--")) {
        throw new Error("--photos-csv-url requires a URL");
      }
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!sourceChoices.has(options.source)) {
      throw new Error(`--source must be one of: ${[...sourceChoices].join(", ")}`);
    }
  }

  return options;
}

async function assertReadableFile(path, guidance) {
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) {
      throw new Error(`${path} is not a file`);
    }
  } catch (error) {
    throw new Error(`${path} is not readable. ${guidance}`);
  }
}

async function resolveDataSource(options) {
  if (options.photosCsvUrl) {
    return {
      label: "custom",
      photosCsvUrl: options.photosCsvUrl,
      localPhotosPath: "",
    };
  }

  if (options.source === "fixture") {
    const localPhotosPath = "fixtures/photos.csv";
    await assertReadableFile(localPhotosPath, "The fixture photos CSV should be committed in the repo.");
    return {
      label: "fixture",
      photosCsvUrl: localPhotosCsvUrl,
      localPhotosPath,
    };
  }

  if (options.source === "export") {
    const localPhotosPath = "tmp/sheets-export/photos.csv";
    await assertReadableFile(localPhotosPath, "Run pnpm sheets:export before using pnpm finder:dev:export.");
    return {
      label: "export",
      photosCsvUrl: localPhotosCsvUrl,
      localPhotosPath,
    };
  }

  return {
    label: "sheets",
    photosCsvUrl: "",
    localPhotosPath: "",
  };
}

async function copyLocalPhotosCsv(sourcePath, outputDir) {
  const destination = join(outputDir, localPhotosTarget);
  await mkdir(join(outputDir, "local"), { recursive: true });
  await copyFile(sourcePath, destination);
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const dataSource = await resolveDataSource(options);
  const outputDir = options.outputDir || join(defaultOutputBaseDir, dataSource.label);
  const result = await buildPagesArtifact({
    outputDir,
    photosCsvUrl: dataSource.photosCsvUrl,
  });

  if (dataSource.localPhotosPath) {
    await copyLocalPhotosCsv(dataSource.localPhotosPath, result.outputDir);
  }

  console.log(`Frontend dev artifact written to ${result.outputDir}`);
  console.log(`Data source: ${dataSource.label}`);
  if (dataSource.localPhotosPath) {
    console.log(`Local photos CSV: ${dataSource.localPhotosPath}`);
  }
  console.log(`Photos CSV URL: ${result.photosCsvUrl}`);

  startStaticServer({
    rootDir: result.outputDir,
    title: appTitle,
  });
}

try {
  await main();
} catch (error) {
  console.error(`Could not start frontend dev server: ${error.message}`);
  process.exitCode = 1;
}
