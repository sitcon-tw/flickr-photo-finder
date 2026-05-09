import { readFile } from "node:fs/promises";
import { createAnalyticsAdminService, explainGoogleAnalyticsError } from "./google-analytics-client.mjs";
import { ga4PropertyId } from "./project-config.mjs";

const customDimensionsUrl = new URL("../config/ga4-custom-dimensions.json", import.meta.url);
const blockedParameterNames = new Set(["photo_id", "content_id", "search_term", "result_rank"]);

function printUsage() {
  console.log(`Usage:
  pnpm ga4:dimensions:check
  pnpm ga4:dimensions:sync -- --write

Options:
  --property <id>   GA4 property ID. May be a plain ID or properties/<id>.
                    Default: GA4_PROPERTY_ID or config/project.json frontend.ga4PropertyId.
  --write           Create missing custom dimensions. Without this flag, the command is dry-run only.
  --help, -h        Show this help.

This command uses Google Analytics Admin API and GOOGLE_APPLICATION_CREDENTIALS.
See docs/ga4-operations.md for service account access setup.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    command: process.env.npm_lifecycle_event ?? "",
    help: false,
    propertyId: process.env.GA4_PROPERTY_ID || ga4PropertyId,
    write: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--property") {
      options.propertyId = args[index + 1] ?? "";
      index += 1;
    } else if (arg === "--write") {
      options.write = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help) {
    if (options.command === "ga4:dimensions:check" && options.write) {
      throw new Error("ga4:dimensions:check is always dry-run. Use pnpm ga4:dimensions:sync -- --write to create missing dimensions.");
    }
    options.propertyId = normalizePropertyId(options.propertyId);
    if (!options.propertyId) {
      throw new Error(
        "Set frontend.ga4PropertyId in config/project.json, set GA4_PROPERTY_ID, or pass --property. The property ID is the number in the GA4 URL after #/p.",
      );
    }
  }

  return options;
}

function normalizePropertyId(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "";
  }
  const propertyId = rawValue.replace(/^properties\//, "");
  if (!/^\d+$/.test(propertyId)) {
    throw new Error(`GA4 property ID must be numeric or properties/<numeric-id>: ${rawValue}`);
  }
  return propertyId;
}

function validateCustomDimension(entry, index) {
  const path = `customDimensions[${index}]`;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${path} must be an object`);
  }

  const parameterName = String(entry.parameterName ?? "").trim();
  const displayName = String(entry.displayName ?? "").trim();
  const description = String(entry.description ?? "").trim();
  const scope = String(entry.scope ?? "").trim();

  if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(parameterName)) {
    throw new Error(`${path}.parameterName must start with a letter and use only letters, numbers, or underscore, up to 40 chars`);
  }
  if (blockedParameterNames.has(parameterName)) {
    throw new Error(`${path}.parameterName "${parameterName}" is intentionally not registered as a GA4 custom dimension because it is high-cardinality or unstable`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_ ]{0,81}$/.test(displayName)) {
    throw new Error(`${path}.displayName must start with a letter and use only letters, numbers, spaces, or underscore, up to 82 chars`);
  }
  if (description.length > 150) {
    throw new Error(`${path}.description must be 150 characters or less`);
  }
  if (scope !== "EVENT") {
    throw new Error(`${path}.scope must be EVENT`);
  }

  return {
    description,
    displayName,
    parameterName,
    scope,
  };
}

async function readExpectedCustomDimensions() {
  const config = JSON.parse(await readFile(customDimensionsUrl, "utf8"));
  const entries = config.customDimensions;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("config/ga4-custom-dimensions.json requires a non-empty customDimensions array");
  }

  const dimensions = entries.map(validateCustomDimension);
  const seen = new Set();
  for (const dimension of dimensions) {
    if (seen.has(dimension.parameterName)) {
      throw new Error(`Duplicate GA4 custom dimension parameterName: ${dimension.parameterName}`);
    }
    seen.add(dimension.parameterName);
  }
  return dimensions;
}

async function listCustomDimensions(analyticsAdmin, parent) {
  const dimensions = [];
  let pageToken = "";

  do {
    const response = await analyticsAdmin.properties.customDimensions.list({
      pageSize: 200,
      pageToken,
      parent,
    });
    dimensions.push(...(response.data.customDimensions ?? []));
    pageToken = response.data.nextPageToken ?? "";
  } while (pageToken);

  return dimensions;
}

function compareDimensions(expected, existing) {
  const existingByParameterName = new Map(
    existing
      .filter((dimension) => dimension.parameterName)
      .map((dimension) => [dimension.parameterName, dimension]),
  );
  const expectedParameterNames = new Set(expected.map((dimension) => dimension.parameterName));

  return {
    existingExpected: expected.filter((dimension) => existingByParameterName.has(dimension.parameterName)),
    extra: existing.filter((dimension) => dimension.parameterName && !expectedParameterNames.has(dimension.parameterName)),
    missing: expected.filter((dimension) => !existingByParameterName.has(dimension.parameterName)),
  };
}

function printComparison({ existingExpected, extra, missing }) {
  console.log(`Expected dimensions already present: ${existingExpected.length}`);
  for (const dimension of existingExpected) {
    console.log(`- present: ${dimension.parameterName}`);
  }

  console.log(`Missing expected dimensions: ${missing.length}`);
  for (const dimension of missing) {
    console.log(`- missing: ${dimension.parameterName}`);
  }

  console.log(`Extra GA4 dimensions not managed by repo: ${extra.length}`);
  for (const dimension of extra) {
    console.log(`- extra: ${dimension.parameterName}`);
  }
}

async function createMissingDimensions(analyticsAdmin, parent, missing) {
  for (const dimension of missing) {
    const response = await analyticsAdmin.properties.customDimensions.create({
      parent,
      requestBody: dimension,
    });
    console.log(`Created ${response.data.parameterName ?? dimension.parameterName}: ${response.data.name ?? "(no resource name returned)"}`);
  }
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const expected = await readExpectedCustomDimensions();
  const parent = `properties/${options.propertyId}`;
  const analyticsAdmin = await createAnalyticsAdminService();
  const existing = await listCustomDimensions(analyticsAdmin, parent);
  const comparison = compareDimensions(expected, existing);

  console.log(`GA4 property: ${parent}`);
  console.log(`Mode: ${options.write ? "write" : "dry-run"}`);
  printComparison(comparison);

  if (!options.write) {
    console.log("Dry-run only. Pass --write to create missing custom dimensions.");
    return;
  }

  if (comparison.missing.length === 0) {
    console.log("No missing custom dimensions to create.");
    return;
  }

  await createMissingDimensions(analyticsAdmin, parent, comparison.missing);
}

try {
  await main();
} catch (error) {
  console.error(`Could not sync GA4 custom dimensions: ${explainGoogleAnalyticsError(error)}`);
  process.exitCode = 1;
}
