import { readAlbumCatalog } from "./album-catalog.mjs";

const defaultAlbumsPath = "tmp/sheets-export/albums.csv";

function printUsage() {
  console.log(`Usage:
  pnpm albums:list

Options:
  --albums <path>   Albums CSV export. Default: tmp/sheets-export/albums.csv.
  --query <text>    Filter by album title, event name, year, notes, or album ID.
  --unprocessed     Only show albums whose last_processed_at is empty.
  --limit <number>  Maximum rows to print. Default: 30. Use --all to print all rows.
  --all             Print all matching rows.
  --help, -h        Show this help.

Run pnpm sheets:export first to refresh tmp/sheets-export/albums.csv from the
formal Google Sheets database.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    albums: defaultAlbumsPath,
    all: false,
    help: false,
    limit: 30,
    query: "",
    unprocessed: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--albums") {
      options.albums = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--query") {
      options.query = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--unprocessed") {
      options.unprocessed = true;
    } else if (arg === "--limit") {
      options.limit = Number(args[index + 1] ?? "");
      index += 1;
    } else if (arg === "--all") {
      options.all = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.albums) {
      throw new Error("--albums requires a path");
    }
    if (!options.all && (!Number.isInteger(options.limit) || options.limit < 1)) {
      throw new Error("--limit must be a positive integer");
    }
  }

  return options;
}

function matchesQuery(album, query) {
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

function compareAlbums(left, right) {
  const leftProcessed = left.last_processed_at ? 1 : 0;
  const rightProcessed = right.last_processed_at ? 1 : 0;
  if (leftProcessed !== rightProcessed) {
    return leftProcessed - rightProcessed;
  }

  const leftCount = Number(left.photo_count || 0);
  const rightCount = Number(right.photo_count || 0);
  if (leftCount !== rightCount) {
    return rightCount - leftCount;
  }

  return left.album_title.localeCompare(right.album_title, "zh-TW");
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}

function printAlbums(albums, { all, limit }) {
  const rows = all ? albums : albums.slice(0, limit);
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

  if (!all && albums.length > rows.length) {
    console.log(`... ${albums.length - rows.length} more row(s). Use --all or --limit <number> to show more.`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const albums = (await readAlbumCatalog(options.albums))
    .filter((album) => album.album_id)
    .filter((album) => !options.unprocessed || !album.last_processed_at)
    .filter((album) => matchesQuery(album, options.query))
    .sort(compareAlbums);

  console.log(`Albums source: ${options.albums}`);
  console.log(`Matching albums: ${albums.length}`);
  printAlbums(albums, options);
}

try {
  await main();
} catch (error) {
  console.error(`Could not list albums: ${error.message}`);
  process.exitCode = 1;
}
