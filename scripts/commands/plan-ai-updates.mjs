import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { csvEscape } from "../lib/core/csv-utils.mjs";
import { fieldLabel, formatDisplayValue, formatStoredValue } from "../lib/core/metadata-display.mjs";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultProposalFile = "metadata-proposals.json";
const defaultJsonOutputFile = "metadata-update-plan.json";
const defaultCsvOutputFile = "metadata-update-plan.csv";

function printUsage() {
  console.log(`Usage:
  pnpm ai:plan -- --run-dir <dir>

Options:
  --run-dir <dir>       AI run directory containing manifest.json and photos.json.
  --proposals <path>    Proposal JSON path. Default: <run-dir>/metadata-proposals.json.
  --json-output <path>  JSON update plan path. Default: <run-dir>/metadata-update-plan.json.
  --csv-output <path>   CSV update plan path. Default: <run-dir>/metadata-update-plan.csv.
  --include-unchanged   Include proposals where current and proposed values are identical.
  --help, -h            Show this help.

This command validates metadata-proposals.json first, then renders a
machine-readable update plan. It does not write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    csvOutputPath: "",
    help: false,
    includeUnchanged: false,
    jsonOutputPath: "",
    proposalsPath: "",
    runDir: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--run-dir") {
      options.runDir = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--proposals") {
      options.proposalsPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--json-output") {
      options.jsonOutputPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--csv-output") {
      options.csvOutputPath = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--include-unchanged") {
      options.includeUnchanged = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (!options.runDir) {
      throw new Error("--run-dir requires a path");
    }
    if (!options.proposalsPath) {
      options.proposalsPath = join(options.runDir, defaultProposalFile);
    }
    if (!options.jsonOutputPath) {
      options.jsonOutputPath = join(options.runDir, defaultJsonOutputFile);
    }
    if (!options.csvOutputPath) {
      options.csvOutputPath = join(options.runDir, defaultCsvOutputFile);
    }
  }

  return options;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

function buildUpdates(photos, proposals, { includeUnchanged }) {
  const photosById = new Map(photos.map((photo) => [photo.photo_id, photo]));
  const updates = [];

  for (const item of proposals.items) {
    const photo = photosById.get(item.photo_id) ?? {};
    for (const [field, proposal] of Object.entries(item.fields)) {
      const currentValue = formatStoredValue(photo[field] ?? "");
      const proposedValue = formatStoredValue(proposal.value);
      const changed = currentValue !== proposedValue;
      if (!changed && !includeUnchanged) {
        continue;
      }

      updates.push({
        changed,
        confidence: proposal.confidence ?? null,
        current_value: currentValue,
        field,
        photo_id: item.photo_id,
        photo_url: photo.photo_url ?? "",
        proposed_value: proposedValue,
        reason: proposal.reason,
      });
    }
  }

  return updates;
}

function updatesToCsv(updates) {
  const headers = [
    "photo_id",
    "photo_url",
    "field",
    "field_label",
    "current_value",
    "current_display",
    "proposed_value",
    "proposed_display",
    "changed",
    "confidence",
    "reason",
  ];
  const rowForCsv = (update) => ({
    ...update,
    current_display: formatDisplayValue(update.field, update.current_value, { includeRaw: true }),
    field_label: fieldLabel(update.field, { includeRaw: true }),
    proposed_display: formatDisplayValue(update.field, update.proposed_value, { includeRaw: true }),
  });
  const lines = [
    headers.join(","),
    ...updates.map((update) => {
      const row = rowForCsv(update);
      return headers.map((header) => csvEscape(row[header] ?? "")).join(",");
    }),
  ];
  return `${lines.join("\n")}\n`;
}

export async function buildPlan(options) {
  await validateAiProposals({
    proposalsPath: options.proposalsPath,
    runDir: options.runDir,
  });

  const [manifest, photos, proposals] = await Promise.all([
    readJson(join(options.runDir, "manifest.json")),
    readJson(join(options.runDir, "photos.json")),
    readJson(options.proposalsPath),
  ]);

  const updates = buildUpdates(photos, proposals, options);
  const plan = {
    created_at: new Date().toISOString(),
    csv_output: options.csvOutputPath,
    include_unchanged: options.includeUnchanged,
    json_output: options.jsonOutputPath,
    plan_version: 1,
    proposal_created_at: proposals.created_at,
    proposal_producer: proposals.producer,
    proposal_version: proposals.proposal_version,
    run_id: manifest.run_id,
    source_image_size: manifest.image_size ?? "",
    source_photos: join(options.runDir, "photos.json"),
    source_proposals: options.proposalsPath,
    update_count: updates.length,
    updates,
  };

  await Promise.all([
    writeFile(options.jsonOutputPath, `${JSON.stringify(plan, null, 2)}\n`),
    writeFile(options.csvOutputPath, updatesToCsv(updates)),
  ]);

  return plan;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const plan = await buildPlan(options);
  console.log(`AI update plan written: ${plan.json_output}`);
  console.log(`AI update plan CSV written: ${plan.csv_output}`);
  console.log(`- run: ${plan.run_id}`);
  console.log(`- updates: ${plan.update_count}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not plan AI metadata updates: ${error.message}`);
    process.exitCode = 1;
  }
}
