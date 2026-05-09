import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const defaultArtifactDir = "tmp/pages";

function printUsage() {
  console.log(`Usage:
  pnpm pages:check

Options:
  --dir <path>  Pages artifact directory. Default: tmp/pages.
  --help, -h    Show this help.

This command checks that the GitHub Pages artifact contains the files needed
for the static frontend to load.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    artifactDir: defaultArtifactDir,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dir") {
      options.artifactDir = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help && !options.artifactDir) {
    throw new Error("--dir requires a path");
  }

  return options;
}

async function assertFile(path) {
  const fileStat = await stat(path);
  if (!fileStat.isFile()) {
    throw new Error(`${path} is not a file`);
  }
}

async function assertIncludes(path, text, label) {
  const content = await readFile(path, "utf8");
  if (!content.includes(text)) {
    throw new Error(`${path} does not reference ${label}`);
  }
  return content;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const requiredFiles = [
    ".nojekyll",
    "config.js",
    "config/project.json",
    "data/photo-schema.json",
    "data/tag-taxonomy.json",
    "index.html",
    "main.js",
    "styles.css",
  ];

  for (const file of requiredFiles) {
    await assertFile(join(options.artifactDir, file));
  }

  await assertIncludes(join(options.artifactDir, "index.html"), "./styles.css", "styles.css");
  await assertIncludes(join(options.artifactDir, "index.html"), "./main.js", "main.js");
  const config = await assertIncludes(join(options.artifactDir, "config.js"), "photosCsvUrl", "photosCsvUrl");
  if (!config.includes("schemaJsonUrl") || !config.includes("taxonomyJsonUrl")) {
    throw new Error("config.js must include schemaJsonUrl and taxonomyJsonUrl");
  }
  if (!/https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/gviz\/tq/.test(config)) {
    throw new Error("config.js does not appear to point photosCsvUrl at a public Google Sheets CSV URL");
  }

  JSON.parse(await readFile(join(options.artifactDir, "config/project.json"), "utf8"));
  JSON.parse(await readFile(join(options.artifactDir, "data/photo-schema.json"), "utf8"));
  JSON.parse(await readFile(join(options.artifactDir, "data/tag-taxonomy.json"), "utf8"));

  console.log(`GitHub Pages artifact looks valid: ${options.artifactDir}`);
}

try {
  await main();
} catch (error) {
  console.error(`Pages artifact check failed: ${error.message}`);
  process.exitCode = 1;
}
