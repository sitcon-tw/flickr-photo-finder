import {
  appendCsvRows,
  assertUniqueInputPhotoIds,
  buildCsvRows,
  filterNewPhotos,
  getExistingPhotoIds,
  normalizeFlickrPhotoUrl,
  photosPath,
  validateData,
} from "../lib/flickr/flickr-intake.mjs";
import { parseArgs as parseNodeArgs } from "node:util";

function printUsage() {
  console.log(`Usage:
  pnpm fixtures:photo:add -- <flickr-photo-url> [more-flickr-photo-urls...]
  pnpm fixtures:photo:add -- <flickr-photo-url> [more-flickr-photo-urls...] --append

Options:
  --append  Append generated rows to fixtures/photos.csv and validate data.

The script uses Flickr oEmbed to fill photo_id, photo_url, image_preview_url,
photographer, and a basic internal note. Other curation fields stay blank for
human review.`);
}

function parseArgs(argv) {
  const { values, positionals } = parseNodeArgs({
    allowPositionals: true,
    args: argv.slice(2),
    options: {
      append: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  return {
    append: values.append ?? false,
    help: values.help ?? false,
    photoUrls: positionals,
  };
}

async function main() {
  const { append, help, photoUrls } = parseArgs(process.argv);

  if (help || photoUrls.length === 0) {
    printUsage();
    process.exitCode = help ? 0 : 1;
    return;
  }

  const normalizedPhotos = photoUrls.map(normalizeFlickrPhotoUrl);
  assertUniqueInputPhotoIds(normalizedPhotos);

  const existingIds = await getExistingPhotoIds();
  const newPhotos = filterNewPhotos(normalizedPhotos, existingIds);
  if (newPhotos.length !== normalizedPhotos.length) {
    const existingInput = normalizedPhotos
      .filter(({ photoId }) => existingIds.has(photoId))
      .map(({ photoId }) => photoId)
      .join(", ");
    throw new Error(`Photo already exists in ${photosPath}: ${existingInput}`);
  }

  const rows = await buildCsvRows(normalizedPhotos);

  if (append) {
    await appendCsvRows(rows);
    console.log(`Added ${rows.length} Flickr photo row(s) to ${photosPath}`);
    validateData();
  } else {
    console.log(rows.join("\n"));
  }
}

try {
  await main();
} catch (error) {
  console.error(`Could not add photo: ${error.message}`);
  process.exitCode = 1;
}
