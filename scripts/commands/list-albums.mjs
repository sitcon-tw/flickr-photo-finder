import { parseArgs as parseNodeArgs } from "node:util";
import { readAlbumCatalog } from "../lib/flickr/album-catalog.mjs";
import {
  defaultAlbumsPath,
  defaultPhotosExportPath,
  filterAlbumsPreservingOrder,
  listOutputFormats,
  printAlbumCommands,
  printAlbumIds,
  printAlbumJson,
  printAlbumTable,
} from "../lib/flickr/album-list-utils.mjs";
import { explainGoogleSheetsError } from "../lib/sheets/google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { readSheetRecords } from "../lib/sheets/sheets-records.mjs";

const albumSources = new Set(["csv", "sheets"]);

function printUsage() {
  console.log(`Usage:
  pnpm albums:list

Options:
  --albums <path>         Albums CSV export. Default: tmp/sheets-export/albums.csv.
  --source <source>       Album source: csv or sheets. Default: csv.
  --spreadsheet-id <id>   Google Sheets spreadsheet ID for --source sheets.
  --photos-export <path>  Photos CSV export for generated commands. Default: tmp/sheets-export/photos.csv.
  --query <text>          Filter by album title, event name, year, notes, or album ID.
  --unprocessed           Only show albums whose last_processed_at is empty.
  --limit <number>        Maximum rows to print. Default: 30. Use --all to print all rows.
  --all                   Print all matching rows.
  --format <format>       Output format: table, ids, commands, or json. Default: table.
  --help, -h              Show this help.

With --source csv, run pnpm sheets:export first to refresh
tmp/sheets-export/albums.csv from the formal Google Sheets database. With
--source sheets, this command reads the albums tab directly through the official
Google Sheets API SDK. Output order follows the source row order, which should
preserve the Flickr album catalog order from discovery.`);
}

function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv.slice(2),
    options: {
      albums: { type: "string" },
      source: { type: "string" },
      "spreadsheet-id": { type: "string" },
      "photos-export": { type: "string" },
      query: { type: "string" },
      unprocessed: { type: "boolean" },
      limit: { type: "string" },
      all: { type: "boolean" },
      format: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const options = {
    albums: values.albums ?? defaultAlbumsPath,
    all: values.all ?? false,
    format: values.format ?? "table",
    help: values.help ?? false,
    limit: values.limit === undefined ? 30 : Number(values.limit),
    photosExport: values["photos-export"] ?? defaultPhotosExportPath,
    query: values.query ?? "",
    source: values.source ?? "csv",
    spreadsheetId: values["spreadsheet-id"] ?? googleSheetsSpreadsheetId,
    unprocessed: values.unprocessed ?? false,
  };

  if (!options.help) {
    if (!options.albums) {
      throw new Error("--albums requires a path");
    }
    if (!albumSources.has(options.source)) {
      throw new Error(`--source must be one of: ${Array.from(albumSources).join(", ")}`);
    }
    if (options.source === "sheets" && !options.spreadsheetId) {
      throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
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

async function readAlbums(options) {
  if (options.source === "sheets") {
    return readSheetRecords({
      sheetName: "albums",
      spreadsheetId: options.spreadsheetId,
    });
  }
  return readAlbumCatalog(options.albums);
}

function albumSourceLabel(options) {
  return options.source === "sheets" ? `Google Sheets albums (${options.spreadsheetId})` : options.albums;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const albums = filterAlbumsPreservingOrder(await readAlbums(options), options);

  if (options.format === "ids") {
    printAlbumIds(albums, options);
  } else if (options.format === "commands") {
    printAlbumCommands(albums, options);
  } else if (options.format === "json") {
    printAlbumJson(albums, { ...options, sourceLabel: albumSourceLabel(options) });
  } else {
    console.log(`Albums source: ${albumSourceLabel(options)}`);
    console.log(`Matching albums: ${albums.length}`);
    printAlbumTable(albums, options);
  }
}

try {
  await main();
} catch (error) {
  console.error(`Could not list albums: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
