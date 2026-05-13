import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const defaultArtifactDir = "tmp/pages-react";

function printUsage() {
  console.log(`Usage:
  pnpm finder:react:check

Options:
  --dir <path>  React preview artifact directory. Default: tmp/pages-react.
  --help, -h    Show this help.

This command checks the preview-only React artifact. It does not validate the
formal GitHub Pages artifact; use pnpm finder:check for production Pages.`);
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
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Missing required React preview artifact file: ${path}`);
    }
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new Error(`${path} is not a file`);
  }
}

async function assertArtifactDir(path) {
  let dirStat;
  try {
    dirStat = await stat(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`React preview artifact directory not found: ${path}. Run pnpm finder:react:build first.`);
    }
    throw error;
  }

  if (!dirStat.isDirectory()) {
    throw new Error(`React preview artifact path is not a directory: ${path}`);
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

  await assertArtifactDir(options.artifactDir);

  const requiredFiles = [
    ".nojekyll",
    "config/project.json",
    "data/interface-registry.json",
    "data/photo-schema.json",
    "data/search-aliases.json",
    "data/tag-taxonomy.json",
    "index.html",
  ];

  for (const file of requiredFiles) {
    await assertFile(join(options.artifactDir, file));
  }

  const indexHtml = await assertIncludes(join(options.artifactDir, "index.html"), "type=\"module\"", "React module script");
  if (!/assets\/[^"]+\.js/.test(indexHtml)) {
    throw new Error("index.html does not reference a Vite JavaScript asset");
  }
  if (indexHtml.includes("./main.js")) {
    throw new Error("React preview artifact must not reference the vanilla main.js entry");
  }

  await assertFile(join(options.artifactDir, indexHtml.match(/assets\/[^"]+\.js/)?.[0] ?? ""));

  JSON.parse(await readFile(join(options.artifactDir, "config/project.json"), "utf8"));
  JSON.parse(await readFile(join(options.artifactDir, "data/interface-registry.json"), "utf8"));
  JSON.parse(await readFile(join(options.artifactDir, "data/photo-schema.json"), "utf8"));
  JSON.parse(await readFile(join(options.artifactDir, "data/search-aliases.json"), "utf8"));
  JSON.parse(await readFile(join(options.artifactDir, "data/tag-taxonomy.json"), "utf8"));

  console.log(`React preview artifact looks valid: ${options.artifactDir}`);
}

try {
  await main();
} catch (error) {
  console.error(`React preview artifact check failed: ${error.message}`);
  process.exitCode = 1;
}
