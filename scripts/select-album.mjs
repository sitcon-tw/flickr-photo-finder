import readline from "node:readline/promises";
import { stdin as input, stderr as output } from "node:process";
import { readAlbumCatalog } from "./album-catalog.mjs";
import {
  defaultAlbumsPath,
  defaultPhotosExportPath,
  filterAndSortAlbums,
  formatIntakeCommand,
  selectOutputFormats,
  selectRows,
  truncate,
} from "./album-list-utils.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm albums:select

Options:
  --albums <path>         Albums CSV export. Default: tmp/sheets-export/albums.csv.
  --photos-export <path>  Photos CSV export for generated commands. Default: tmp/sheets-export/photos.csv.
  --query <text>          Filter by album title, event name, year, notes, or album ID.
  --unprocessed           Only show albums whose last_processed_at is empty.
  --limit <number>        Maximum rows to show. Default: 20.
  --choice <number>       Select the Nth shown row without prompting. Useful for tests or automation.
  --format <format>       Output format: command, id, or json. Default: command.
  --help, -h              Show this help.

Run pnpm sheets:export first to refresh tmp/sheets-export/albums.csv from the
formal Google Sheets database.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    albums: defaultAlbumsPath,
    choice: undefined,
    format: "command",
    help: false,
    limit: 20,
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
    } else if (arg === "--choice") {
      options.choice = Number(args[index + 1] ?? "");
      index += 1;
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
          source: options.albums,
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

  const albums = filterAndSortAlbums(await readAlbumCatalog(options.albums), options);
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
  printChoices(rows, { source: options.albums, matching });
  return promptChoice(rows.length);
}

try {
  await main();
} catch (error) {
  console.error(`Could not select album: ${error.message}`);
  process.exitCode = 1;
}
