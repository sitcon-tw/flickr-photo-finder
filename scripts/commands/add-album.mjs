import { resolveAlbumInput } from "../lib/flickr/album-catalog.mjs";
import { fetchAlbumPhotoUrls } from "../lib/flickr/flickr-album-photos.mjs";
import {
  appendCsvRows,
  assertUniqueInputPhotoIds,
  buildCsvRows,
  filterNewPhotos,
  getExistingPhotoIds,
  photosPath,
  validateData,
} from "../lib/flickr/flickr-intake.mjs";
import { parseArgs as parseNodeArgs } from "node:util";

function printUsage() {
  console.log(`Usage:
  pnpm fixtures:album:add -- <flickr-album-url>
  pnpm fixtures:album:add -- <album-id>
  pnpm fixtures:album:add -- <flickr-album-url> --append
  pnpm fixtures:album:add -- <album-id> --append

Options:
  --append  Append missing album photo rows to fixtures/photos.csv and validate data.

Without --append, the command reports album coverage and prints missing photo
URLs. With --append, it imports the missing photos using Flickr oEmbed.

Album IDs are resolved from fixtures/albums.csv. Use pnpm albums:discover --
--write to update that local fixture before selecting by ID.`);
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
    albumUrl: positionals[0],
  };
}

async function main() {
  const { append, help, albumUrl: inputUrl } = parseArgs(process.argv);

  if (help || !inputUrl) {
    printUsage();
    process.exitCode = help ? 0 : 1;
    return;
  }

  const { ownerPath, albumId, albumUrl } = await resolveAlbumInput(inputUrl);
  const albumPhotoResult = await fetchAlbumPhotoUrls({ albumId, albumUrl, ownerPath });
  const albumPhotos = albumPhotoResult.photoUrls;
  assertUniqueInputPhotoIds(albumPhotos);

  if (albumPhotos.length === 0) {
    throw new Error(`No photo URLs found in album ${albumId}`);
  }

  const existingIds = await getExistingPhotoIds();
  const missingPhotos = filterNewPhotos(albumPhotos, existingIds);
  const importedCount = albumPhotos.length - missingPhotos.length;

  console.log(`Album ${albumId}: ${albumPhotos.length} photo(s) from ${albumPhotoResult.source}, ${importedCount} already indexed, ${missingPhotos.length} missing.`);

  if (!append) {
    for (const { photoUrl } of missingPhotos) {
      console.log(photoUrl);
    }
    return;
  }

  if (missingPhotos.length === 0) {
    console.log(`No missing photos to add to ${photosPath}.`);
    return;
  }

  const rows = await buildCsvRows(missingPhotos);
  await appendCsvRows(rows);
  console.log(`Added ${rows.length} Flickr album photo row(s) to ${photosPath}`);
  validateData();
}

try {
  await main();
} catch (error) {
  console.error(`Could not add album: ${error.message}`);
  process.exitCode = 1;
}
