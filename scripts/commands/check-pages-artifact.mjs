import { join } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { collectRelativeJavaScriptImportGraph } from "../lib/pages/js-import-graph.mjs";
import { defaultFinderDataDir } from "../lib/pages/static-finder-data.mjs";

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

async function listArtifactFiles(rootDir, relativeDir = "") {
  const entries = await readdir(join(rootDir, relativeDir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listArtifactFiles(rootDir, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function assertNoCredentialArtifacts(artifactDir) {
  const files = await listArtifactFiles(artifactDir);
  const blockedNamePattern = /(?:credential|credentials|token|secret|client_secret|service[-_]?account|oauth|^\.env$)/i;
  const blockedContentPattern = /(?:-----BEGIN PRIVATE KEY-----|private_key|client_secret|refresh_token|GOOGLE_APPLICATION_CREDENTIALS)/i;
  for (const file of files) {
    if (blockedNamePattern.test(file)) {
      throw new Error(`Pages artifact must not include credential-like file: ${file}`);
    }
    if (!/\.(?:css|html|js|json|txt)$/i.test(file)) {
      continue;
    }
    const content = await readFile(join(artifactDir, file), "utf8");
    if (blockedContentPattern.test(content)) {
      throw new Error(`Pages artifact contains credential-like content: ${file}`);
    }
  }
}

async function assertJavaScriptImportGraph(artifactDir, entryFile) {
  await collectRelativeJavaScriptImportGraph({ rootDir: artifactDir, entryFile });
}

function extractConfigString(config, key) {
  const match = config.match(new RegExp(`${key}: "([^"]*)"`));
  return match?.[1] ?? "";
}

async function assertJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function assertStaticFinderData(artifactDir) {
  const dataDir = join(artifactDir, defaultFinderDataDir);
  const manifest = await assertJson(join(dataDir, "manifest.json"));
  const albums = await assertJson(join(dataDir, "albums.json"));
  const index = await assertJson(join(dataDir, "photos-index.json"));

  if (manifest.artifactVersion !== "2026-05-static-sharded-v1") {
    throw new Error("finder-data manifest has an unknown artifactVersion");
  }
  if (!Number.isInteger(manifest.rowCount) || manifest.rowCount < 0) {
    throw new Error("finder-data manifest rowCount must be a non-negative integer");
  }
  if (!Array.isArray(manifest.shards) || (manifest.rowCount > 0 && manifest.shards.length === 0)) {
    throw new Error("finder-data manifest must list detail shards");
  }
  if (!Array.isArray(index.fields) || !index.fields.includes("photo_id") || !index.fields.includes("shard_id")) {
    throw new Error("photos-index.json must include photo_id and shard_id fields");
  }
  if (!Array.isArray(index.rows) || index.rows.length !== manifest.rowCount) {
    throw new Error("photos-index.json row count does not match manifest rowCount");
  }
  if (!Array.isArray(albums.fields) || !Array.isArray(albums.rows)) {
    throw new Error("albums.json must contain compact fields and rows");
  }

  let shardRowCount = 0;
  for (const shard of manifest.shards) {
    if (!shard.path || !shard.id || !Number.isInteger(shard.count)) {
      throw new Error("finder-data shard entries must include id, path, and count");
    }
    const payload = await assertJson(join(dataDir, shard.path));
    if (payload.shard_id !== shard.id) {
      throw new Error(`${shard.path} shard_id does not match manifest`);
    }
    if (!Array.isArray(payload.fields) || !payload.fields.includes("photo_id")) {
      throw new Error(`${shard.path} must include compact fields with photo_id`);
    }
    if (!Array.isArray(payload.rows) || payload.rows.length !== shard.count) {
      throw new Error(`${shard.path} row count does not match manifest`);
    }
    shardRowCount += payload.rows.length;
  }
  if (shardRowCount !== manifest.rowCount) {
    throw new Error("finder-data shard rows do not add up to manifest rowCount");
  }
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
    "assets/og-image.png",
    "config/project.json",
    "data/interface-registry.json",
    "data/photo-schema.json",
    "data/search-aliases.json",
    "data/tag-taxonomy.json",
    "index.html",
    "main.js",
    "pwa.js",
    "service-worker.js",
    "styles.css",
  ];

  for (const file of requiredFiles) {
    await assertFile(join(options.artifactDir, file));
  }
  await assertNoCredentialArtifacts(options.artifactDir);

  const indexHtml = await assertIncludes(join(options.artifactDir, "index.html"), "./styles.css", "styles.css");
  if (!indexHtml.includes("./main.js")) {
    throw new Error("index.html does not reference main.js");
  }
  const pwaModule = await assertIncludes(join(options.artifactDir, "pwa.js"), "./service-worker.js", "service worker registration");
  if (!pwaModule.includes("navigator.serviceWorker.register")) {
    throw new Error("pwa.js does not register a service worker");
  }
  const serviceWorker = await assertIncludes(
    join(options.artifactDir, "service-worker.js"),
    "self.__SITCON_PHOTO_FINDER_PRECACHE_URLS__ = [",
    "PWA precache list",
  );
  if (!serviceWorker.includes("data/finder-data/manifest.json") || !serviceWorker.includes("sitcon-photo-finder-cache-fallback")) {
    throw new Error("service-worker.js must cache finder data and report cache fallback usage");
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
  await assertJavaScriptImportGraph(options.artifactDir, "main.js");
  const config = await assertIncludes(join(options.artifactDir, "config.js"), "mode", "data mode");
  if (
    !config.includes("photosCsvUrl") ||
    !config.includes("albumsCsvUrl") ||
    !config.includes("finderDataManifestUrl") ||
    !config.includes("finderDataAlbumsUrl") ||
    !config.includes("finderDataIndexUrl") ||
    !config.includes("interfaceRegistryJsonUrl") ||
    !config.includes("schemaJsonUrl") ||
    !config.includes("searchAliasesJsonUrl") ||
    !config.includes("taxonomyJsonUrl")
  ) {
    throw new Error("config.js must include all data source URLs");
  }
  const dataMode = extractConfigString(config, "mode");
  if (dataMode === "runtime-csv") {
    if (!/https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/gviz\/tq/.test(config.match(/albumsCsvUrl: ([^,]+)/)?.[1] ?? "")) {
      throw new Error("config.js does not appear to point albumsCsvUrl at a public Google Sheets CSV URL");
    }
    if (!/https:\/\/docs\.google\.com\/spreadsheets\/d\/[^/]+\/gviz\/tq/.test(config)) {
      throw new Error("config.js does not appear to point photosCsvUrl at a public Google Sheets CSV URL");
    }
  } else if (dataMode === "static-sharded") {
    await assertStaticFinderData(options.artifactDir);
  } else {
    throw new Error(`config.js has unknown data source mode: ${dataMode}`);
  }

  await assertJson(join(options.artifactDir, "config/project.json"));
  await assertJson(join(options.artifactDir, "data/interface-registry.json"));
  await assertJson(join(options.artifactDir, "data/photo-schema.json"));
  await assertJson(join(options.artifactDir, "data/search-aliases.json"));
  await assertJson(join(options.artifactDir, "data/tag-taxonomy.json"));

  console.log(`GitHub Pages artifact looks valid: ${options.artifactDir}`);
}

try {
  await main();
} catch (error) {
  console.error(`Pages artifact check failed: ${error.message}`);
  process.exitCode = 1;
}
