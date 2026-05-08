import { readAlbumCatalog } from "./album-catalog.mjs";
import {
  defaultAlbumsPath,
  defaultPhotosExportPath,
  filterAlbumsPreservingOrder,
  listOutputFormats,
  printAlbumCommands,
  printAlbumIds,
  printAlbumJson,
  printAlbumTable,
} from "./album-list-utils.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm albums:list

Options:
  --albums <path>         Albums CSV export. Default: tmp/sheets-export/albums.csv.
  --photos-export <path>  Photos CSV export for generated commands. Default: tmp/sheets-export/photos.csv.
  --query <text>          Filter by album title, event name, year, notes, or album ID.
  --unprocessed           Only show albums whose last_processed_at is empty.
  --limit <number>        Maximum rows to print. Default: 30. Use --all to print all rows.
  --all                   Print all matching rows.
  --format <format>       Output format: table, ids, commands, or json. Default: table.
  --help, -h              Show this help.

Run pnpm sheets:export first to refresh tmp/sheets-export/albums.csv from the
formal Google Sheets database. Output order follows the albums CSV row order,
which should preserve the Flickr album catalog order from discovery.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    albums: defaultAlbumsPath,
    all: false,
    format: "table",
    help: false,
    limit: 30,
    photosExport: defaultPhotosExportPath,
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
    } else if (arg === "--photos-export") {
      options.photosExport = args[index + 1] ?? "";
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
    } else if (arg === "--format") {
      options.format = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.albums) {
      throw new Error("--albums requires a path");
    }
    if (!options.photosExport) {
      throw new Error("--photos-export requires a path");
    }
    if (!listOutputFormats.has(options.format)) {
      throw new Error(`--format must be one of: ${Array.from(listOutputFormats).join(", ")}`);
    }
    if (!options.all && (!Number.isInteger(options.limit) || options.limit < 1)) {
      throw new Error("--limit must be a positive integer");
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const albums = filterAlbumsPreservingOrder(await readAlbumCatalog(options.albums), options);

  if (options.format === "ids") {
    printAlbumIds(albums, options);
  } else if (options.format === "commands") {
    printAlbumCommands(albums, options);
  } else if (options.format === "json") {
    printAlbumJson(albums, options);
  } else {
    console.log(`Albums source: ${options.albums}`);
    console.log(`Matching albums: ${albums.length}`);
    printAlbumTable(albums, options);
  }
}

try {
  await main();
} catch (error) {
  console.error(`Could not list albums: ${error.message}`);
  process.exitCode = 1;
}
