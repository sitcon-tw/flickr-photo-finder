import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "../lib/sheets/google-sheets-client.mjs";
import { headersMatch, normalizeSheetRow, readSheetRows } from "../lib/sheets/sheets-records.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { getTableHeaders, getTableSchema } from "../lib/core/photo-schema.mjs";
import { parseSemicolonList } from "../lib/core/csv-utils.mjs";

function printUsage() {
  console.log(`Usage:
  pnpm sheets:migrate-field-value -- --sheet photos --field recommended_uses --from <old-value> --to <new-value>

Options:
  --spreadsheet-id <id>  Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --sheet <name>         Fixed table tab to update, for example photos.
  --field <name>         Field to update.
  --from <value>         Exact old value to replace.
  --to <value>           Exact new value to write.
  --write                Apply the migration. Without this flag the command only performs a dry-run.
  --help, -h             Show this help.

This command migrates exact field values in a fixed Sheets table. For
semicolon-separated multi-value fields, it replaces only matching list items
and de-duplicates the new value. For scalar fields, it replaces only cells that
exactly equal --from. The process environment must set
GOOGLE_APPLICATION_CREDENTIALS to a service account credential with edit access
to the target spreadsheet.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    field: "",
    from: "",
    help: false,
    sheet: "",
    spreadsheetId: googleSheetsSpreadsheetId,
    to: "",
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--spreadsheet-id") {
      options.spreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--sheet") {
      options.sheet = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--field") {
      options.field = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--from") {
      options.from = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--to") {
      options.to = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--write") {
      options.write = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.spreadsheetId) {
      throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
    }
    for (const key of ["sheet", "field", "from", "to"]) {
      if (!options[key]) {
        throw new Error(`--${key} is required`);
      }
    }
    if (options.from === options.to) {
      throw new Error("--from and --to must be different values");
    }
  }

  return options;
}

function getColumnLetter(columnIndex) {
  let value = columnIndex + 1;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

function migrateListValue(value, { from, to }) {
  const items = parseSemicolonList(String(value ?? ""));
  if (!items.includes(from)) {
    return {
      changed: false,
      value: String(value ?? ""),
    };
  }

  const seen = new Set();
  const nextItems = [];
  for (const item of items) {
    const nextItem = item === from ? to : item;
    if (seen.has(nextItem)) {
      continue;
    }
    seen.add(nextItem);
    nextItems.push(nextItem);
  }

  return {
    changed: true,
    value: nextItems.join(";"),
  };
}

function migrateScalarValue(value, { from, to }) {
  const text = String(value ?? "");
  return {
    changed: text === from,
    value: text === from ? to : text,
  };
}

function getMigrationContext({ field, sheet }) {
  const tableSchema = getTableSchema(sheet);
  const headers = getTableHeaders(sheet);
  const fieldSchema = tableSchema.fields.find((item) => item.name === field);
  if (!fieldSchema) {
    throw new Error(`${sheet}.${field} does not exist in data/photo-schema.json`);
  }

  return {
    fieldSchema,
    headers,
  };
}

function buildPlan(rows, options, context) {
  const { field, from, sheet, to } = options;
  const { fieldSchema, headers } = context;

  if (rows.length === 0) {
    throw new Error(`${sheet} is empty; expected a header row`);
  }

  const sheetHeaders = normalizeSheetRow(rows[0], headers.length);
  if (!headersMatch(sheetHeaders, headers)) {
    throw new Error(`${sheet} header does not match repo schema`);
  }

  const idField = headers.includes("photo_id") ? "photo_id" : headers[0];
  const idIndex = headers.indexOf(idField);
  const targetIndex = headers.indexOf(field);
  const targetColumn = getColumnLetter(targetIndex);
  const migrateValue = fieldSchema.multi_value ? migrateListValue : migrateScalarValue;
  const changes = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = normalizeSheetRow(rows[rowIndex], headers.length);
    const current = String(row[targetIndex] ?? "");
    const migrated = migrateValue(current, { from, to });
    if (!migrated.changed) {
      continue;
    }

    changes.push({
      current,
      idField,
      idValue: String(row[idIndex] ?? ""),
      proposed: migrated.value,
      range: `${quoteSheetName(sheet)}!${targetColumn}${rowIndex + 1}`,
      rowNumber: rowIndex + 1,
    });
  }

  return changes;
}

function printPlan(changes, options, context) {
  const mode = context.fieldSchema.multi_value ? "semicolon-list" : "scalar";
  console.log(`Spreadsheet: ${options.spreadsheetId}`);
  console.log(`Mode: ${options.write ? "write" : "dry-run"}`);
  console.log(`- ${options.sheet}.${options.field}: ${changes.length} row(s) will replace "${options.from}" with "${options.to}" (${mode}).`);

  const preview = changes.slice(0, 40);
  for (const change of preview) {
    console.log(`  row ${change.rowNumber} ${change.idField}=${change.idValue || "(blank)"}: ${change.current} -> ${change.proposed}`);
  }
  if (changes.length > preview.length) {
    console.log(`  ... ${changes.length - preview.length} more row(s)`);
  }
}

async function writeChanges(sheets, spreadsheetId, changes) {
  if (changes.length === 0) {
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      data: changes.map((change) => ({
        range: change.range,
        values: [[change.proposed]],
      })),
      valueInputOption: "RAW",
    },
  });
}

async function verifyChanges(sheets, options, changes, context) {
  const rows = await readSheetRows(sheets, options.spreadsheetId, options.sheet);
  const targetIndex = context.headers.indexOf(options.field);
  const remainingOldValueRows = [];
  const mismatchedRows = [];

  for (const change of changes) {
    const row = normalizeSheetRow(rows[change.rowNumber - 1] ?? [], context.headers.length);
    const value = String(row[targetIndex] ?? "");
    const stillHasOldValue = context.fieldSchema.multi_value
      ? parseSemicolonList(value).includes(options.from)
      : value === options.from;

    if (stillHasOldValue) {
      remainingOldValueRows.push(change.rowNumber);
    }
    if (value !== change.proposed) {
      mismatchedRows.push({
        actual: value,
        expected: change.proposed,
        rowNumber: change.rowNumber,
      });
    }
  }

  if (remainingOldValueRows.length > 0) {
    throw new Error(`${options.sheet}.${options.field} still contains "${options.from}" on row(s): ${remainingOldValueRows.join(", ")}`);
  }

  if (mismatchedRows.length > 0) {
    const detail = mismatchedRows
      .slice(0, 5)
      .map((row) => `row ${row.rowNumber}: expected "${row.expected}" but found "${row.actual}"`)
      .join("; ");
    throw new Error(`${options.sheet}.${options.field} write verification failed: ${detail}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const context = getMigrationContext(options);
  const sheets = await createSheetsService();
  const rows = await readSheetRows(sheets, options.spreadsheetId, options.sheet);
  const changes = buildPlan(rows, options, context);

  printPlan(changes, options, context);

  if (!options.write) {
    console.log("Dry-run only. Re-run with --write to update matching cells.");
    return;
  }

  await writeChanges(sheets, options.spreadsheetId, changes);
  await verifyChanges(sheets, options, changes, context);
  console.log(`Updated ${changes.length} ${options.sheet}.${options.field} cell(s).`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not migrate Sheets field values: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
