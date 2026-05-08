import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { parseCsv, toCsvLine } from "./csv-utils.mjs";
import { albumsPath } from "./album-catalog.mjs";
import { albumHeaders } from "./photo-schema.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm albums:sync -- --sheets-export <albums-csv> --output <albums-csv>
  pnpm albums:sync -- --output <albums-csv>

Options:
  --sheets-export <path>  Current Google Sheets albums CSV export. If omitted, start from an empty sheet.
  --discovered <path>     Discovered SITCON Flickr albums CSV. Default: data/albums.csv.
  --output <path>         Write merged Sheets-ready albums CSV to this path. If omitted, print to stdout.
  --no-validate           Skip validation for the output path.

The merge preserves human-maintained Sheets fields such as event_name,
event_year, last_processed_at, and notes. It refreshes tool-owned fields from
the discovered album catalog: album_id, album_url, album_title, and photo_count.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    discovered: albumsPath,
    help: false,
    output: "",
    sheetsExport: "",
    validate: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--discovered") {
      options.discovered = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--sheets-export") {
      options.sheetsExport = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--output") {
      options.output = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--no-validate") {
      options.validate = false;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.discovered) {
    throw new Error("--discovered requires a path");
  }

  return options;
}

async function readAlbumCsv(path, { optional = false } = {}) {
  if (optional && !path) {
    return [];
  }

  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (optional && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const [headers, ...rows] = parseCsv(text);
  if (!headers) {
    return [];
  }

  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const missingHeaders = albumHeaders.filter((header) => !headerIndex.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`${path} is missing album header(s): ${missingHeaders.join(", ")}`);
  }

  const records = rows.map((row) =>
    Object.fromEntries(albumHeaders.map((header) => [header, row[headerIndex.get(header)] ?? ""])),
  );

  return records.filter((record) => record.album_id || record.album_url || record.album_title);
}

function normalizeAlbum(album) {
  return Object.fromEntries(
    albumHeaders.map((header) => [header, String(album[header] ?? "")]),
  );
}

function mergeAlbums({ sheetsAlbums, discoveredAlbums }) {
  const sheetsById = new Map(sheetsAlbums.map((album) => [album.album_id, normalizeAlbum(album)]));
  const discoveredIds = new Set();
  const merged = [];
  const stats = {
    added: 0,
    discovered: discoveredAlbums.length,
    existing: sheetsAlbums.length,
    retainedMissing: 0,
    updated: 0,
  };

  for (const discovered of discoveredAlbums) {
    const normalizedDiscovered = normalizeAlbum(discovered);
    const existing = sheetsById.get(normalizedDiscovered.album_id);
    discoveredIds.add(normalizedDiscovered.album_id);

    if (!existing) {
      stats.added += 1;
      merged.push(normalizedDiscovered);
      continue;
    }

    const next = {
      ...existing,
      album_id: normalizedDiscovered.album_id,
      album_url: normalizedDiscovered.album_url || existing.album_url,
      album_title: normalizedDiscovered.album_title || existing.album_title,
      photo_count: normalizedDiscovered.photo_count || existing.photo_count,
    };

    if (albumHeaders.some((header) => next[header] !== existing[header])) {
      stats.updated += 1;
    }

    merged.push(next);
  }

  for (const existing of sheetsAlbums.map(normalizeAlbum)) {
    if (discoveredIds.has(existing.album_id)) {
      continue;
    }
    stats.retainedMissing += 1;
    merged.push(existing);
  }

  return { albums: merged, stats };
}

function toCsv(albums) {
  return [
    albumHeaders.join(","),
    ...albums.map((album) => toCsvLine(albumHeaders, album)),
  ].join("\n");
}

function validateAlbums(path) {
  const result = spawnSync(process.execPath, ["scripts/validate-data.mjs", "--albums", path], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error("album CSV validation failed");
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const [sheetsAlbums, discoveredAlbums] = await Promise.all([
    readAlbumCsv(options.sheetsExport, { optional: true }),
    readAlbumCsv(options.discovered),
  ]);

  if (discoveredAlbums.length === 0) {
    throw new Error(`No discovered albums found in ${options.discovered}`);
  }

  const { albums, stats } = mergeAlbums({ sheetsAlbums, discoveredAlbums });
  const csv = `${toCsv(albums)}\n`;

  if (options.output) {
    await writeFile(options.output, csv);
    if (options.validate) {
      validateAlbums(options.output);
    }
    console.log(`Wrote ${albums.length} Sheets-ready album row(s) to ${options.output}.`);
  } else {
    process.stdout.write(csv);
  }

  console.error(
    `Albums sync: ${stats.discovered} discovered, ${stats.existing} existing, ${stats.added} added, ${stats.updated} updated, ${stats.retainedMissing} retained from Sheets only.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`Could not sync albums: ${error.message}`);
  process.exitCode = 1;
}
