import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const defaultArtifactDir = "tmp/pages";

function printUsage() {
  console.log(`Usage:
  pnpm finder:check

Options:
  --dir <path>  Pages artifact directory. Default: tmp/pages.
  --help, -h    Show this help.

This command checks that the GitHub Pages artifact contains the files needed
for the static frontend to load.

Usually run pnpm finder:build before this command so tmp/pages exists.`);
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
      throw new Error(`Missing required artifact file: ${path}`);
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
      throw new Error(`Pages artifact directory not found: ${path}. Run pnpm finder:build first.`);
    }
    throw error;
  }

  if (!dirStat.isDirectory()) {
    throw new Error(`Pages artifact path is not a directory: ${path}`);
  }
}

async function listArtifactEntries(root, relativeDir = "") {
  const entries = await readdir(join(root, relativeDir), { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    paths.push(relativePath);
    if (entry.isDirectory()) {
      paths.push(...await listArtifactEntries(root, relativePath));
    }
  }
  return paths;
}

async function assertNoForbiddenEntries(artifactDir) {
  const forbiddenTopLevelDirs = new Set(["app-core", "app-react", "docs", "fixtures", "scripts", "tests"]);
  const forbiddenTopLevelFiles = new Set(["package.json", "pnpm-lock.yaml", "tsconfig.json"]);
  const entries = await listArtifactEntries(artifactDir);

  for (const entry of entries) {
    const [topLevel] = entry.split("/");
    if (forbiddenTopLevelDirs.has(topLevel)) {
      throw new Error(`Pages artifact must not include repo source directory: ${entry}`);
    }
    if (forbiddenTopLevelFiles.has(entry)) {
      throw new Error(`Pages artifact must not include repo metadata file: ${entry}`);
    }
    if (/\.(?:map|ts|tsx)$/.test(entry)) {
      throw new Error(`Pages artifact must not include source or sourcemap file: ${entry}`);
    }
  }
}

async function assertOnlyExpectedEntries(artifactDir, requiredFiles) {
  const allowedEntries = new Set(requiredFiles);
  for (const file of requiredFiles) {
    const parts = file.split("/");
    while (parts.length > 1) {
      parts.pop();
      allowedEntries.add(parts.join("/"));
    }
  }

  for (const entry of await listArtifactEntries(artifactDir)) {
    if (!allowedEntries.has(entry)) {
      throw new Error(`Pages artifact contains unexpected file or directory: ${entry}`);
    }
  }
}

async function assertIncludes(path, text, label) {
  const content = await readFile(path, "utf8");
  if (!content.includes(text)) {
    throw new Error(`${path} does not reference ${label}`);
  }
  return content;
}

async function assertPngDimensions(path, expectedWidth, expectedHeight) {
  const buffer = await readFile(path);
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    throw new Error(`${path} is not a PNG file`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${path} must be ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  await assertArtifactDir(options.artifactDir);
  await assertNoForbiddenEntries(options.artifactDir);

  const requiredFiles = [
    ".nojekyll",
    "assets/og-image.png",
    "config.js",
    "config/project.json",
    "data/interface-registry.json",
    "data/photo-schema.json",
    "data/search-aliases.json",
    "data/tag-taxonomy.json",
    "index.html",
  ];

  const indexHtml = await assertIncludes(join(options.artifactDir, "index.html"), "type=\"module\"", "React module script");
  const viteAssets = [...indexHtml.matchAll(/assets\/[^"]+\.(?:js|css)/g)].map((match) => match[0]);
  if (!viteAssets.some((asset) => asset.endsWith(".js"))) {
    throw new Error("index.html does not reference a Vite JavaScript asset");
  }
  requiredFiles.push(...viteAssets);

  for (const file of requiredFiles) {
    await assertFile(join(options.artifactDir, file));
  }
  await assertOnlyExpectedEntries(options.artifactDir, requiredFiles);

  if (indexHtml.includes("./main.js")) {
    throw new Error("React Pages artifact must not reference the vanilla main.js entry");
  }
  if (indexHtml.includes("fixtures/")) {
    throw new Error("Production Pages artifact must not reference fixture data");
  }
  for (const asset of viteAssets.filter((path) => path.endsWith(".js"))) {
    const assetContent = await readFile(join(options.artifactDir, asset), "utf8");
    if (assetContent.includes("fixtures/")) {
      throw new Error(`Production Pages JavaScript asset must not reference fixture data: ${asset}`);
    }
  }
  const requiredMetadata = [
    'name="description"',
    'rel="canonical"',
    'property="og:title"',
    'property="og:description"',
    'property="og:url"',
    'property="og:image"',
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    'name="twitter:card" content="summary_large_image"',
    'name="twitter:image"',
  ];
  for (const metadataTag of requiredMetadata) {
    if (!indexHtml.includes(metadataTag)) {
      throw new Error(`index.html is missing ${metadataTag}`);
    }
  }
  if (!/property="og:image" content="https:\/\/[^"]+\/assets\/og-image\.png"/.test(indexHtml)) {
    throw new Error("index.html og:image must point at an absolute HTTPS URL for assets/og-image.png");
  }
  await assertPngDimensions(join(options.artifactDir, "assets/og-image.png"), 1200, 630);
  const config = await assertIncludes(join(options.artifactDir, "config.js"), "photosCsvUrl", "photosCsvUrl");
  if (
    !config.includes("albumsCsvUrl") ||
    !config.includes("interfaceRegistryJsonUrl") ||
    !config.includes("schemaJsonUrl") ||
    !config.includes("searchAliasesJsonUrl") ||
    !config.includes("taxonomyJsonUrl")
  ) {
    throw new Error("config.js must include albumsCsvUrl, interfaceRegistryJsonUrl, schemaJsonUrl, searchAliasesJsonUrl, and taxonomyJsonUrl");
  }
  if (!/https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/gviz\/tq/.test(config.match(/albumsCsvUrl: ([^,]+)/)?.[1] ?? "")) {
    throw new Error("config.js does not appear to point albumsCsvUrl at a public Google Sheets CSV URL");
  }
  if (!/https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/gviz\/tq/.test(config)) {
    throw new Error("config.js does not appear to point photosCsvUrl at a public Google Sheets CSV URL");
  }

  JSON.parse(await readFile(join(options.artifactDir, "config/project.json"), "utf8"));
  JSON.parse(await readFile(join(options.artifactDir, "data/interface-registry.json"), "utf8"));
  JSON.parse(await readFile(join(options.artifactDir, "data/photo-schema.json"), "utf8"));
  JSON.parse(await readFile(join(options.artifactDir, "data/search-aliases.json"), "utf8"));
  JSON.parse(await readFile(join(options.artifactDir, "data/tag-taxonomy.json"), "utf8"));

  console.log(`GitHub Pages artifact looks valid: ${options.artifactDir}`);
}

try {
  await main();
} catch (error) {
  console.error(`Pages artifact check failed: ${error.message}`);
  process.exitCode = 1;
}
