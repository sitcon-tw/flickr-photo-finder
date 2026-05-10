import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fieldLabel, formatDisplayValue, formatStoredValue } from "../lib/core/metadata-display.mjs";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultProposalFile = "metadata-proposals.json";
const defaultOutputFile = "metadata-diff.md";

function printUsage() {
  console.log(`Usage:
  pnpm ai:diff -- --run-dir <dir>

Options:
  --run-dir <dir>       AI run directory containing manifest.json and photos.json.
  --proposals <path>    Proposal JSON path. Default: <run-dir>/metadata-proposals.json.
  --output <path>       Markdown diff output path. Default: <run-dir>/metadata-diff.md.
  --help, -h            Show this help.

This command validates metadata-proposals.json first, then renders a
human-readable Markdown diff. It does not write Google Sheets.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    help: false,
    outputPath: "",
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
    } else if (arg === "--output") {
      options.outputPath = args[index + 1] ?? "";
      index += 1;
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
    if (!options.outputPath) {
      options.outputPath = join(options.runDir, defaultOutputFile);
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

function escapeMarkdownTable(value) {
  return formatStoredValue(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim();
}

function formatConfidence(value) {
  if (typeof value !== "number") {
    return "";
  }
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function renderTableRow(values) {
  return `| ${values.map(escapeMarkdownTable).join(" | ")} |`;
}

function buildDiffRows(photos, proposals) {
  const photosById = new Map(photos.map((photo) => [photo.photo_id, photo]));
  const rows = [];

  for (const item of proposals.items) {
    const photo = photosById.get(item.photo_id) ?? {};
    for (const [field, proposal] of Object.entries(item.fields)) {
      const currentStoredValue = formatStoredValue(photo[field] ?? "");
      const proposedStoredValue = formatStoredValue(proposal.value);
      rows.push({
        confidence: formatConfidence(proposal.confidence),
        currentValue: formatDisplayValue(field, currentStoredValue, { includeRaw: true }),
        field,
        fieldLabel: fieldLabel(field, { includeRaw: true }),
        changed: currentStoredValue === proposedStoredValue ? "no" : "yes",
        photoId: item.photo_id,
        photoUrl: photo.photo_url ?? "",
        proposedValue: formatDisplayValue(field, proposedStoredValue, { includeRaw: true }),
        reason: proposal.reason,
      });
    }
  }

  return rows;
}

function renderMarkdown({ manifest, proposals, rows }) {
  const lines = [
    "# AI Metadata Diff",
    "",
    `- Run: \`${manifest.run_id}\``,
    `- Proposal version: \`${proposals.proposal_version}\``,
    `- Producer: ${proposals.producer.type} / ${proposals.producer.name}`,
    `- AI image size: \`${manifest.image_size ?? ""}\``,
    `- Proposal items: ${proposals.items.length}`,
    `- Field changes: ${rows.length}`,
    "",
    "| photo_id | field | current | proposed | changed | confidence | reason | photo_url |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of rows) {
    lines.push(renderTableRow([
      row.photoId,
      row.fieldLabel,
      row.currentValue,
      row.proposedValue,
      row.changed,
      row.confidence,
      row.reason,
      row.photoUrl,
    ]));
  }

  lines.push("");
  return `${lines.join("\n")}`;
}

export async function renderDiff(options) {
  await validateAiProposals({
    proposalsPath: options.proposalsPath,
    runDir: options.runDir,
  });

  const [manifest, photos, proposals] = await Promise.all([
    readJson(join(options.runDir, "manifest.json")),
    readJson(join(options.runDir, "photos.json")),
    readJson(options.proposalsPath),
  ]);
  const rows = buildDiffRows(photos, proposals);
  const markdown = renderMarkdown({ manifest, proposals, rows });
  await writeFile(options.outputPath, markdown);

  return {
    outputPath: options.outputPath,
    rowCount: rows.length,
    runId: manifest.run_id,
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const result = await renderDiff(options);
  console.log(`AI metadata diff written: ${result.outputPath}`);
  console.log(`- run: ${result.runId}`);
  console.log(`- field changes: ${result.rowCount}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Could not render AI metadata diff: ${error.message}`);
    process.exitCode = 1;
  }
}
