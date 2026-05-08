import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import {
  albumsPath,
  readAlbumCatalog,
  resolveAlbumInput,
} from "./album-catalog.mjs";
import { extractAlbumPhotoUrls, fetchAlbumHtml } from "./flickr-album-photos.mjs";
import {
  assertUniqueInputPhotoIds,
  buildCsvRows,
  filterNewPhotos,
  getExistingPhotoIds,
  photosPath,
} from "./flickr-intake.mjs";
import { photoHeaders } from "./photo-schema.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm photos:import -- --album <album-id-or-flickr-album-url> --output <photos-csv>

Options:
  --album <value>         Album ID from the albums CSV, or a full SITCON Flickr album URL.
  --albums <path>         Google Sheets albums CSV export or local fixture. Default: data/albums.csv.
  --photos-export <path>  Current Google Sheets photos CSV export for duplicate detection. Default: data/photos.csv.
  --input <html-file>     Read saved Flickr album HTML instead of fetching the album page.
  --output <path>         Write candidate photo rows to this CSV. If omitted, print to stdout.
  --no-validate           Skip validation for the output path.

The output is a Sheets-ready photos CSV containing only missing photo rows.
It preserves album context from the selected albums CSV when available.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    album: "",
    albums: albumsPath,
    help: false,
    input: "",
    output: "",
    photosExport: photosPath,
    validate: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--album") {
      options.album = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--albums") {
      options.albums = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--photos-export") {
      options.photosExport = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--input") {
      options.input = args[index + 1] ?? "";
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

  if (!options.help) {
    if (!options.album) {
      throw new Error("--album requires an album ID or Flickr album URL");
    }
    if (!options.albums) {
      throw new Error("--albums requires a path");
    }
    if (!options.photosExport) {
      throw new Error("--photos-export requires a path");
    }
  }

  return options;
}

async function resolveAlbumWithContext(input, albumCatalogPath) {
  const resolved = await resolveAlbumInput(input, albumCatalogPath);
  const albums = await readAlbumCatalog(albumCatalogPath);
  const album = albums.find((item) => item.album_id === resolved.albumId) ?? {};

  return {
    ...resolved,
    album,
  };
}

function toCsv(rows) {
  return `${[photoHeaders.join(","), ...rows].join("\n")}\n`;
}

function validatePhotos(path) {
  const result = spawnSync(process.execPath, ["scripts/validate-data.mjs", "--photos", path], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error("photo CSV validation failed");
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const { ownerPath, albumId, albumUrl, album } = await resolveAlbumWithContext(
    options.album,
    options.albums,
  );

  const html = options.input ? await readFile(options.input, "utf8") : await fetchAlbumHtml(albumUrl);
  const albumPhotos = extractAlbumPhotoUrls(html, ownerPath);
  assertUniqueInputPhotoIds(albumPhotos);

  if (albumPhotos.length === 0) {
    throw new Error(`No photo URLs found in album ${albumId}`);
  }

  const existingIds = await getExistingPhotoIds(options.photosExport);
  const missingPhotos = filterNewPhotos(albumPhotos, existingIds);
  const existingCount = albumPhotos.length - missingPhotos.length;

  const rows = await buildCsvRows(missingPhotos, {
    album_title: album.album_title ?? "",
    event_name: album.event_name ?? "",
    event_year: album.event_year ?? "",
  });
  const csv = toCsv(rows);

  if (options.output) {
    await writeFile(options.output, csv);
    if (options.validate) {
      validatePhotos(options.output);
    }
    console.log(`Wrote ${rows.length} Sheets-ready photo row(s) to ${options.output}.`);
  } else {
    process.stdout.write(csv);
  }

  console.error(
    `Album ${albumId}: ${albumPhotos.length} photo(s), ${existingCount} already indexed, ${missingPhotos.length} missing.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`Could not import album photos: ${error.message}`);
  process.exitCode = 1;
}
