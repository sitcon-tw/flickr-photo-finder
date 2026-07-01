import readline from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import { parseArgs as parseNodeArgs } from "node:util";
import { readAlbumCatalog } from "../lib/flickr/album-catalog.mjs";
import {
  defaultAlbumsPath,
  defaultPhotosExportPath,
  filterAlbumsPreservingOrder,
  formatIntakeCommand,
  selectOutputFormats,
  selectRows,
  truncate,
} from "../lib/flickr/album-list-utils.mjs";
import { explainGoogleSheetsError } from "../lib/sheets/google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { readSheetRecords } from "../lib/sheets/sheets-records.mjs";

const albumSources = new Set(["csv", "sheets"]);

function printUsage() {
  console.log(`Usage:
  pnpm albums:select

Options:
  --albums <path>         Albums CSV export. Default: tmp/sheets-export/albums.csv.
  --source <source>       Album source: csv or sheets. Default: csv.
  --spreadsheet-id <id>   Google Sheets spreadsheet ID for --source sheets.
  --photos-export <path>  Photos CSV export for generated commands. Default: tmp/sheets-export/photos.csv.
  --query <text>          Filter by album title, event name, year, notes, or album ID.
  --unprocessed           Only show albums whose last_processed_at is empty.
  --limit <number>        Maximum rows to show. Default: 20.
  --choice <number>       Select the Nth shown row without prompting. Useful for tests or automation.
  --format <format>       Output format: command, id, or json. Default: command.
  --help, -h              Show this help.

With --source csv, run pnpm sheets:export first to refresh
tmp/sheets-export/albums.csv from the formal Google Sheets database. With
--source sheets, this command reads the albums tab directly through the official
Google Sheets API SDK. Display order follows the source row order, which should
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
      choice: { type: "string" },
      format: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const options = {
    albums: values.albums ?? defaultAlbumsPath,
    choice: values.choice === undefined ? undefined : Number(values.choice),
    format: values.format ?? "command",
    help: values.help ?? false,
    limit: values.limit === undefined ? 20 : Number(values.limit),
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
    if (!selectOutputFormats.has(options.format)) {
      throw new Error(`--format must be one of: ${Array.from(selectOutputFormats).join(", ")}`);
    }
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error("--limit must be a positive integer");
    }
    if (options.choice !== undefined && (!Number.isInteger(options.choice) || options.choice < 1)) {
      throw new Error("--choice must be a positive integer");
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

function printChoices(rows, { source, matching }) {
  output.write(`Albums source: ${source}\n`);
  output.write(`Matching albums: ${matching}\n`);
  output.write(["#", "album_id", "photo_count", "last_processed_at", "album_title"].join("\t"));
  output.write("\n");

  rows.forEach((album, index) => {
    output.write(
      [
        String(index + 1),
        album.album_id,
        album.photo_count,
        album.last_processed_at,
        truncate(album.album_title, 56),
      ].join("\t"),
    );
    output.write("\n");
  });
}

async function promptChoice(maxChoice) {
  if (!input.isTTY) {
    throw new Error("stdin is not interactive. Pass --choice <number> to select a row non-interactively.");
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question("Select album number: ");
    const choice = Number(answer.trim());
    if (!Number.isInteger(choice) || choice < 1 || choice > maxChoice) {
      throw new Error(`Choice must be a number between 1 and ${maxChoice}`);
    }
    return choice;
  } finally {
    rl.close();
  }
}

function printSelected(album, options) {
  if (options.format === "id" || options.format === "ids") {
    console.log(album.album_id);
  } else if (options.format === "json") {
    console.log(
      JSON.stringify(
        {
          source: albumSourceLabel(options),
          selected: album,
          command: formatIntakeCommand(album, options),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatIntakeCommand(album, options));
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const albums = filterAlbumsPreservingOrder(await readAlbums(options), options);
  if (albums.length === 0) {
    throw new Error("No albums matched the current filters.");
  }

  const rows = selectRows(albums, options);
  if (options.choice !== undefined && options.choice > rows.length) {
    throw new Error(`--choice must be between 1 and ${rows.length}`);
  }

  const choice = options.choice ?? (await promptChoiceAfterPrinting(rows, options, albums.length));
  printSelected(rows[choice - 1], options);
}

async function promptChoiceAfterPrinting(rows, options, matching) {
  printChoices(rows, { source: albumSourceLabel(options), matching });
  return promptChoice(rows.length);
}

try {
  await main();
} catch (error) {
  console.error(`Could not select album: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
