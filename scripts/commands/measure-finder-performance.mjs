import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { join } from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { csvEscape, parseCsv } from "../lib/core/csv-utils.mjs";
import { buildOptionLabelMaps, createSearchTokenBuilder, normalizeAlbumRows, normalizePhotoRows } from "../../app/data-loader.js";
import { albumFilterOptions } from "../../app/controls.js";
import { applySearchRegistry, filterAndSortPhotos } from "../../app/search-sort.js";
import { buildStaticFinderPayloads, defaultShardSize } from "../lib/pages/static-finder-data.mjs";

const defaultOutputDir = "tmp/finder-perf";

function printUsage() {
  console.log(`Usage:
  pnpm finder:perf

Options:
  --source <source>       Data source: export. Default: export.
  --photos <path>         Photos CSV path. Default: tmp/sheets-export/photos.csv.
  --albums <path>         Albums CSV path. Default: tmp/sheets-export/albums.csv.
  --scale <counts>        Comma-separated synthetic row counts. Default: actual,26000,40000.
  --output-dir <path>     Output directory. Default: tmp/finder-perf.
  --shard-size <count>    Static artifact shard size. Default: 512.
  --help, -h              Show this help.

This command is local and read-only for Sheets. It writes only benchmark reports
under tmp/ and does not modify repo data or Google Sheets.`);
}

function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv.slice(2),
    options: {
      source: { type: "string" },
      photos: { type: "string" },
      albums: { type: "string" },
      scale: { type: "string" },
      "output-dir": { type: "string" },
      "shard-size": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const options = {
    albumsPath: "tmp/sheets-export/albums.csv",
    help: values.help ?? false,
    outputDir: values["output-dir"] ?? defaultOutputDir,
    photosPath: values.photos ?? "tmp/sheets-export/photos.csv",
    scale: values.scale
      ? values.scale.split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0)
      : [],
    shardSize: values["shard-size"] === undefined ? defaultShardSize : Number(values["shard-size"]),
    source: values.source ?? "export",
  };
  options.albumsPath = values.albums ?? options.albumsPath;

  if (!options.help) {
    if (options.source !== "export") {
      throw new Error("--source currently supports: export");
    }
    if (!options.photosPath) {
      throw new Error("--photos requires a path");
    }
    if (!options.albumsPath) {
      throw new Error("--albums requires a path");
    }
    if (!options.outputDir) {
      throw new Error("--output-dir requires a path");
    }
    if (!Number.isInteger(options.shardSize) || options.shardSize < 1) {
      throw new Error("--shard-size must be a positive integer");
    }
  }

  return options;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(label, fn) {
  const start = performance.now();
  const value = fn();
  const end = performance.now();
  return { label, ms: end - start, value };
}

function measureRepeated(label, iterations, fn) {
  const times = [];
  let value;
  for (let index = 0; index < iterations; index += 1) {
    const result = measure(label, fn);
    times.push(result.ms);
    value = result.value;
  }
  return {
    label,
    medianMs: Math.round(median(times)),
    minMs: Math.round(Math.min(...times)),
    maxMs: Math.round(Math.max(...times)),
    result: typeof value === "number" ? value : undefined,
  };
}

function sizeReport(label, text) {
  const buffer = Buffer.from(text);
  return {
    label,
    rawBytes: buffer.length,
    gzipBytes: gzipSync(buffer).length,
    brotliBytes: brotliCompressSync(buffer, { params: { [constants.BROTLI_PARAM_QUALITY]: 8 } }).length,
  };
}

function rowsToCsv(rows) {
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function scaledPhotosCsv(baseText, targetCount) {
  const [headers, ...dataRows] = parseCsv(baseText);
  if (!headers || dataRows.length === 0) {
    throw new Error("photos CSV requires a header and at least one data row");
  }
  const photoIdIndex = headers.indexOf("photo_id");
  const photoUrlIndex = headers.indexOf("photo_url");
  const outputRows = [headers];
  for (let index = 0; index < targetCount; index += 1) {
    const sourceRow = dataRows[index % dataRows.length];
    const row = [...sourceRow];
    if (photoIdIndex !== -1) {
      row[photoIdIndex] = `${sourceRow[photoIdIndex] || "photo"}-perf-${index + 1}`;
    }
    if (photoUrlIndex !== -1 && row[photoUrlIndex]) {
      row[photoUrlIndex] = `${row[photoUrlIndex]}?perf=${index + 1}`;
    }
    outputRows.push(row);
  }
  return rowsToCsv(outputRows);
}

function resultCount(result) {
  if (typeof result.value === "number") {
    return result.value;
  }
  if (Array.isArray(result.value)) {
    return result.value.length;
  }
  return undefined;
}

function markdownReport(report) {
  const lines = [
    "# Finder Performance Report",
    "",
    `Generated at: ${report.generatedAt}`,
    `Source: ${report.source.photosPath}, ${report.source.albumsPath}`,
    "",
    "| Rows | photos.csv raw | parse | normalize | recommended | discover | search 舞台 | static shards |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const item of report.results) {
    const size = item.sizes.find((entry) => entry.label === "photos.csv");
    const measurement = Object.fromEntries(item.measurements.map((entry) => [entry.label, entry]));
    lines.push([
      item.rows,
      size.rawBytes,
      `${measurement["parse photos CSV"].ms}ms`,
      `${measurement["normalize photos + build search_text"].ms}ms`,
      `${measurement["filter+recommended sort all/social"].medianMs}ms`,
      `${measurement["filter+discover sort all/social"].medianMs}ms`,
      `${measurement["search 舞台 + recommended/social"].medianMs}ms`,
      item.staticArtifact.shardCount,
    ].join(" | ").replace(/^/, "| ").replace(/$/," |"));
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function benchmarkCount({ albumsText, basePhotosText, count, registry, searchAliases, shardSize, photoSchema, taxonomy }) {
  const photosText = scaledPhotosCsv(basePhotosText, count);
  const optionLabelMaps = buildOptionLabelMaps(taxonomy);
  const searchTokensForField = createSearchTokenBuilder(optionLabelMaps, searchAliases);
  const task = registry.pages?.taskModes?.find((mode) => mode.id === "social") ?? {};
  const parsedPhotos = measure("parse photos CSV", () => parseCsv(photosText));
  const parsedAlbums = measure("parse albums CSV", () => parseCsv(albumsText));
  const normalizedPhotos = measure("normalize photos + build search_text", () => normalizePhotoRows(parsedPhotos.value, photoSchema, searchTokensForField));
  const normalizedAlbums = measure("normalize albums", () => normalizeAlbumRows(parsedAlbums.value));
  const photos = normalizedPhotos.value;
  const albums = normalizedAlbums.value;
  const staticPayloads = buildStaticFinderPayloads({
    albumsText,
    photoSchema,
    photosText,
    searchAliases,
    shardSize,
    source: { type: "benchmark" },
    taxonomy,
  });

  const measurements = [
    parsedPhotos,
    parsedAlbums,
    normalizedPhotos,
    normalizedAlbums,
    measure("build album filter options", () => albumFilterOptions(photos, albums).length),
    measureRepeated("filter+recommended sort all/social", 5, () => filterAndSortPhotos(photos, { task, sortMode: "recommended" }).length),
    measureRepeated("filter+discover sort all/social", 3, () => filterAndSortPhotos(photos, { task, sortMode: "discover" }).length),
    measureRepeated("search 舞台 + recommended/social", 5, () => filterAndSortPhotos(photos, { filters: { search: "舞台" }, task, sortMode: "recommended" }).length),
  ];

  const staticIndexJson = JSON.stringify(staticPayloads.index);
  const staticAlbumsJson = JSON.stringify(staticPayloads.albums);
  const staticShardBytes = staticPayloads.shards.map((shard) => Buffer.byteLength(JSON.stringify(shard.payload)));

  return {
    rows: count,
    sizes: [
      sizeReport("photos.csv", photosText),
      sizeReport("albums.csv", albumsText),
      sizeReport("static albums.json", staticAlbumsJson),
      sizeReport("static photos-index.json", staticIndexJson),
    ],
    staticArtifact: {
      indexRawBytes: Buffer.byteLength(staticIndexJson),
      maxShardRawBytes: Math.max(...staticShardBytes),
      shardCount: staticPayloads.shards.length,
      totalShardRawBytes: staticShardBytes.reduce((sum, value) => sum + value, 0),
    },
    measurements: measurements.map((item) => ({
      label: item.label,
      ms: item.ms === undefined ? undefined : Math.round(item.ms),
      medianMs: item.medianMs,
      minMs: item.minMs,
      maxMs: item.maxMs,
      result: item.result ?? resultCount(item),
    })),
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const [photosText, albumsText, photoSchema, taxonomy, searchAliases, registry] = await Promise.all([
    readFile(options.photosPath, "utf8"),
    readFile(options.albumsPath, "utf8"),
    readFile("data/photo-schema.json", "utf8").then(JSON.parse),
    readFile("data/tag-taxonomy.json", "utf8").then(JSON.parse),
    readFile("data/search-aliases.json", "utf8").then(JSON.parse),
    readFile("data/interface-registry.json", "utf8").then(JSON.parse),
  ]);
  applySearchRegistry(registry);
  const actualRows = Math.max(0, parseCsv(photosText).length - 1);
  const scale = options.scale.length > 0 ? options.scale : [...new Set([actualRows, 26000, 40000].filter(Boolean))];
  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      albumsPath: options.albumsPath,
      photosPath: options.photosPath,
    },
    shardSize: options.shardSize,
    results: [],
  };

  for (const count of scale) {
    console.error(`Measuring ${count} photo row(s)...`);
    report.results.push(await benchmarkCount({
      albumsText,
      basePhotosText: photosText,
      count,
      photoSchema,
      registry,
      searchAliases,
      shardSize: options.shardSize,
      taxonomy,
    }));
  }

  await mkdir(options.outputDir, { recursive: true });
  const jsonPath = join(options.outputDir, "report.json");
  const markdownPath = join(options.outputDir, "report.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownPath, markdownReport(report));
  console.log(`Finder performance report written to ${jsonPath}`);
  console.log(`Finder performance summary written to ${markdownPath}`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not measure finder performance: ${error.message}`);
  process.exitCode = 1;
}
