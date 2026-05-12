import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSheetsService, explainGoogleSheetsError, quoteSheetName } from "../lib/sheets/google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "../lib/core/project-config.mjs";
import { allowedAiFieldSet, aiFieldLayerName, photoHeaders } from "../lib/core/photo-schema.mjs";

const defaultPlanFile = "metadata-update-plan.json";

function printUsage() {
  console.log(`Usage:
  pnpm sheets:apply-ai-updates -- --run-dir <dir>

Options:
  --run-dir <dir>       AI run directory containing metadata-update-plan.json.
  --plan <path>         Update plan JSON path. Default: <run-dir>/metadata-update-plan.json.
  --spreadsheet-id <id> Google Sheets spreadsheet ID. Default: config/project.json googleSheets.spreadsheetId.
  --layers <list>       Comma-separated AI field layers to apply: baseline,recall,optional.
                        Default: baseline,recall,optional.
  --allow-current-mismatch
                        Continue when Sheets values no longer match plan current_value.
                        Use only when intentionally overwriting existing AI metadata.
  --summary-only        Print counts and blockers/mismatches, not every cell update.
  --write               Apply changes. Without this flag the command only performs a dry-run.
  --help, -h            Show this help.

This command reads a validated AI metadata update plan, checks target photos
and current cell values in Google Sheets, then prints exact cell updates. It
only writes when --write is passed. The process environment must set
GOOGLE_APPLICATION_CREDENTIALS to a service account credential with access to
the target spreadsheet.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    layers: new Set(["baseline", "recall", "optional"]),
    planPath: "",
    runDir: "",
    spreadsheetId: googleSheetsSpreadsheetId,
    allowCurrentMismatch: false,
    summaryOnly: false,
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--run-dir") {
      options.runDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--plan") {
      options.planPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--spreadsheet-id") {
      options.spreadsheetId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--layers") {
      options.layers = parseLayers(args[index + 1] ?? "");
      index += 1;
    } else if (arg === "--allow-current-mismatch") {
      options.allowCurrentMismatch = true;
    } else if (arg === "--summary-only") {
      options.summaryOnly = true;
    } else if (arg === "--write") {
      options.write = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.runDir && !options.planPath) {
      throw new Error("--run-dir or --plan is required");
    }
    if (!options.planPath) {
      options.planPath = join(options.runDir, defaultPlanFile);
    }
    if (!options.spreadsheetId) {
      throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
    }
  }

  return options;
}

function parseLayers(value) {
  const validLayers = new Set(["baseline", "recall", "optional"]);
  const layers = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (layers.length === 0) {
    throw new Error("--layers requires at least one layer");
  }
  for (const layer of layers) {
    if (!validLayers.has(layer)) {
      throw new Error("--layers values must be one of: baseline,recall,optional");
    }
  }
  return new Set(layers);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function headersMatch(actual, expected) {
  return actual.length === expected.length && expected.every((header, index) => actual[index] === header);
}

function normalizeRow(row, length) {
  return Array.from({ length }, (_, index) => row[index] ?? "");
}

async function readSheetRows(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName("photos")}!A:ZZ`,
  });
  const rows = response.data.values ?? [];
  if (rows.length === 0) {
    throw new Error("photos is empty; expected a header row");
  }
  const headers = normalizeRow(rows[0], photoHeaders.length);
  if (!headersMatch(headers, photoHeaders)) {
    throw new Error("photos header does not match repo schema");
  }
  return rows;
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

function buildPhotoRowMap(rows) {
  const photoIdColumn = photoHeaders.indexOf("photo_id");
  const map = new Map();
  const duplicateIds = new Set();

  rows.slice(1).forEach((row, index) => {
    const photoId = row[photoIdColumn] ?? "";
    if (!photoId) {
      return;
    }
    if (map.has(photoId)) {
      duplicateIds.add(photoId);
      return;
    }
    map.set(photoId, {
      row,
      rowNumber: index + 2,
    });
  });

  return { duplicateIds, map };
}

function validatePlan(plan) {
  const errors = [];
  if (!isPlainObject(plan)) {
    return ["plan must be a JSON object"];
  }
  if (plan.plan_version !== 1) {
    errors.push("plan_version must be 1");
  }
  if (typeof plan.run_id !== "string" || !plan.run_id.trim()) {
    errors.push("run_id is required");
  }
  if (!Array.isArray(plan.updates)) {
    errors.push("updates must be an array");
  }

  const seenTargets = new Set();
  for (const update of plan.updates ?? []) {
    if (!isPlainObject(update)) {
      errors.push("each update must be an object");
      continue;
    }
    if (typeof update.photo_id !== "string" || !update.photo_id.trim()) {
      errors.push("update.photo_id is required");
    }
    if (typeof update.field !== "string" || !update.field.trim()) {
      errors.push(`${update.photo_id ?? "(unknown)"}: update.field is required`);
    } else if (!allowedAiFieldSet.has(update.field)) {
      errors.push(`${update.photo_id}.${update.field}: field is not allowed for AI update application`);
    }
    if (update.field_layer !== undefined && typeof update.field_layer !== "string") {
      errors.push(`${update.photo_id}.${update.field}: field_layer must be a string when present`);
    }
    if (typeof update.current_value !== "string") {
      errors.push(`${update.photo_id}.${update.field}: current_value must be a string`);
    }
    if (typeof update.proposed_value !== "string") {
      errors.push(`${update.photo_id}.${update.field}: proposed_value must be a string`);
    }
    if (update.changed !== true) {
      errors.push(`${update.photo_id}.${update.field}: changed must be true`);
    }
    const targetKey = `${update.photo_id}\t${update.field}`;
    if (seenTargets.has(targetKey)) {
      errors.push(`${update.photo_id}.${update.field}: duplicate update target`);
    }
    seenTargets.add(targetKey);
  }
  return errors;
}

function filterPlanByLayers(plan, layers) {
  return {
    ...plan,
    updates: (plan.updates ?? []).filter((update) => {
      const layer = update.field_layer || aiFieldLayerName(update.field);
      return layers.has(layer);
    }),
  };
}

function buildCellPlan(plan, rows, { allowCurrentMismatch = false } = {}) {
  const { duplicateIds, map: photoRowsById } = buildPhotoRowMap(rows);
  const blockers = [];
  const currentMismatches = [];
  const updates = [];

  for (const photoId of duplicateIds) {
    blockers.push(`duplicate photo_id in Sheets photos: ${photoId}`);
  }

  for (const update of plan.updates) {
    const rowInfo = photoRowsById.get(update.photo_id);
    const columnIndex = photoHeaders.indexOf(update.field);
    if (!rowInfo) {
      blockers.push(`${update.photo_id}.${update.field}: photo_id not found in Sheets photos`);
      continue;
    }
    if (columnIndex < 0) {
      blockers.push(`${update.photo_id}.${update.field}: field not found in photo schema`);
      continue;
    }

    const actualCurrentValue = rowInfo.row[columnIndex] ?? "";
    if (actualCurrentValue !== update.current_value) {
      const message = `${update.photo_id}.${update.field}: current Sheets value "${actualCurrentValue}" does not match plan current_value "${update.current_value}"`;
      if (!allowCurrentMismatch) {
        blockers.push(message);
        continue;
      }
      currentMismatches.push(message);
    }

    updates.push({
      ...update,
      actual_current_value: actualCurrentValue,
      range: `${quoteSheetName("photos")}!${getColumnLetter(columnIndex)}${rowInfo.rowNumber}`,
      row_number: rowInfo.rowNumber,
    });
  }

  return {
    blockers,
    currentMismatches,
    layers: plan.layers ?? [],
    runId: plan.run_id,
    updates,
  };
}

function printPlan(cellPlan, { summaryOnly, write }) {
  console.log(`Mode: ${write ? "write" : "dry-run"}`);
  console.log(`Run: ${cellPlan.runId}`);
  console.log(`Layers: ${cellPlan.layers.join(", ")}`);
  console.log(`- cell updates: ${cellPlan.updates.length}`);
  if (cellPlan.currentMismatches.length > 0) {
    console.log(`- current value mismatches allowed: ${cellPlan.currentMismatches.length}`);
  }
  if (!summaryOnly) {
    for (const update of cellPlan.updates) {
      console.log(`  - ${update.range}: ${update.photo_id}.${update.field} "${update.actual_current_value}" -> "${update.proposed_value}"`);
    }
  }
  if (cellPlan.blockers.length > 0) {
    console.log(`Blocked: ${cellPlan.blockers.join("; ")}`);
  }
  if (cellPlan.currentMismatches.length > 0 && !summaryOnly) {
    console.log(`Allowed current value mismatches: ${cellPlan.currentMismatches.join("; ")}`);
  }
}

async function applyCellUpdates(sheets, spreadsheetId, cellPlan) {
  if (cellPlan.updates.length === 0) {
    return;
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      data: cellPlan.updates.map((update) => ({
        range: update.range,
        values: [[update.proposed_value]],
      })),
      valueInputOption: "RAW",
    },
  });
}

async function verifyApplied(sheets, spreadsheetId, cellPlan) {
  const rows = await readSheetRows(sheets, spreadsheetId);
  const { map: photoRowsById } = buildPhotoRowMap(rows);
  const failures = [];

  for (const update of cellPlan.updates) {
    const rowInfo = photoRowsById.get(update.photo_id);
    const columnIndex = photoHeaders.indexOf(update.field);
    const actual = rowInfo?.row[columnIndex] ?? "";
    if (actual !== update.proposed_value) {
      failures.push(`${update.photo_id}.${update.field}: expected "${update.proposed_value}", got "${actual}"`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`write verification failed: ${failures.join("; ")}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const rawPlan = await readJson(options.planPath);
  const plan = {
    ...filterPlanByLayers(rawPlan, options.layers),
    layers: [...options.layers],
  };
  const planErrors = validatePlan(plan);
  if (planErrors.length > 0) {
    throw new Error(planErrors.join("\n"));
  }

  const sheets = await createSheetsService();
  const rows = await readSheetRows(sheets, options.spreadsheetId);
  const cellPlan = buildCellPlan(plan, rows, { allowCurrentMismatch: options.allowCurrentMismatch });

  console.log(`Spreadsheet: ${options.spreadsheetId}`);
  console.log(`Plan: ${options.planPath}`);
  printPlan(cellPlan, options);

  if (cellPlan.blockers.length > 0) {
    throw new Error(`refusing to write: ${cellPlan.blockers.join("; ")}`);
  }

  if (!options.write) {
    console.log("Dry-run only. Re-run with --write to apply these changes.");
    return;
  }

  await applyCellUpdates(sheets, options.spreadsheetId, cellPlan);
  await verifyApplied(sheets, options.spreadsheetId, cellPlan);
  console.log("AI metadata updates applied and verified.");
}

try {
  await main();
} catch (error) {
  console.error(`Could not apply AI metadata updates: ${explainGoogleSheetsError(error)}`);
  process.exitCode = 1;
}
