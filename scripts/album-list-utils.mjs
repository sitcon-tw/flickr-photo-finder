import { sheetsExportAlbumsPath, sheetsExportPhotosPath } from "./workflow-paths.mjs";

export const defaultAlbumsPath = sheetsExportAlbumsPath;
export const defaultPhotosExportPath = sheetsExportPhotosPath;
export const listOutputFormats = new Set(["table", "ids", "commands", "json"]);
export const selectOutputFormats = new Set(["id", "ids", "command", "commands", "json"]);

export function filterAlbumsPreservingOrder(albums, { query = "", unprocessed = false } = {}) {
  return albums
    .filter((album) => album.album_id)
    .filter((album) => !unprocessed || !album.last_processed_at)
    .filter((album) => matchesQuery(album, query));
}

export function matchesQuery(album, query) {
  if (!query) {
    return true;
  }

  const needle = query.toLocaleLowerCase("zh-TW");
  return [
    album.album_id,
    album.album_title,
    album.event_name,
    album.event_year,
    album.notes,
  ]
    .join(" ")
    .toLocaleLowerCase("zh-TW")
    .includes(needle);
}

export function selectRows(albums, { all = false, limit = 30 } = {}) {
  return all ? albums : albums.slice(0, limit);
}

export function truncate(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

export function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function formatIntakeCommand(album, options) {
  return [
    "pnpm intake:run --",
    "--album",
    shellQuote(album.album_id),
    "--albums",
    shellQuote(options.albums),
    "--photos-export",
    shellQuote(options.photosExport),
  ].join(" ");
}

export function printAlbumTable(albums, options = {}) {
  const rows = selectRows(albums, options);
  console.log(["album_id", "photo_count", "last_processed_at", "album_title"].join("\t"));
  for (const album of rows) {
    console.log(
      [
        album.album_id,
        album.photo_count,
        album.last_processed_at,
        truncate(album.album_title, 64),
      ].join("\t"),
    );
  }

  if (!options.all && albums.length > rows.length) {
    console.log(`... ${albums.length - rows.length} more row(s). Use --all or --limit <number> to show more.`);
  }
}

export function printAlbumIds(albums, options = {}) {
  for (const album of selectRows(albums, options)) {
    console.log(album.album_id);
  }
}

export function printAlbumCommands(albums, options = {}) {
  for (const album of selectRows(albums, options)) {
    console.log(formatIntakeCommand(album, options));
  }
}

export function printAlbumJson(albums, options = {}) {
  const rows = selectRows(albums, options);
  console.log(
    JSON.stringify(
      {
        source: options.albums,
        matching: albums.length,
        shown: rows.length,
        albums: rows,
      },
      null,
      2,
    ),
  );
}
