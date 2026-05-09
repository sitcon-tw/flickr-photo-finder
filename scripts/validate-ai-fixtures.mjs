import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { validateAiProposals } from "./validate-ai-proposals.mjs";

const defaultFixturesDir = "fixtures/ai-proposals";

function printUsage() {
  console.log(`Usage:
  pnpm ai:validate-fixtures

Options:
  --fixtures-dir <dir>  Directory containing valid-* and invalid-* AI proposal fixtures.
                        Default: ${defaultFixturesDir}.
  --help, -h            Show this help.

Each child directory is treated as a minimal AI run directory containing
manifest.json, photos.json, and metadata-proposals.json. Directories prefixed
with valid- must pass validation with no warnings, warning- must pass with
warnings, and invalid- must fail.`);
}

function parseArgs(argv) {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  const options = {
    fixturesDir: defaultFixturesDir,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--fixtures-dir") {
      options.fixturesDir = args[index + 1] ?? "";
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!options.help && !options.fixturesDir) {
    throw new Error("--fixtures-dir requires a path");
  }

  return options;
}

async function listFixtureCases(fixturesDir) {
  const entries = await readdir(fixturesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.startsWith("valid-") || name.startsWith("warning-") || name.startsWith("invalid-"))
    .sort();
}

async function validateFixture(fixturesDir, fixtureName) {
  const runDir = join(fixturesDir, fixtureName);
  const shouldPass = fixtureName.startsWith("valid-");
  const shouldWarn = fixtureName.startsWith("warning-");

  try {
    const result = await validateAiProposals({
      proposalsPath: join(runDir, "metadata-proposals.json"),
      runDir,
    });
    if (!shouldPass && !shouldWarn) {
      return {
        error: `${fixtureName}: expected validation to fail, but it passed`,
        name: fixtureName,
        ok: false,
      };
    }
    if (shouldPass && result.warnings.length > 0) {
      return {
        error: `${fixtureName}: expected validation to pass without warnings, but got:\n${result.warnings.join("\n")}`,
        name: fixtureName,
        ok: false,
      };
    }
    if (shouldWarn && result.warnings.length === 0) {
      return {
        error: `${fixtureName}: expected validation warnings, but got none`,
        name: fixtureName,
        ok: false,
      };
    }
    return { name: fixtureName, ok: true };
  } catch (error) {
    if (shouldPass || shouldWarn) {
      return {
        error: `${fixtureName}: expected validation to pass, but it failed:\n${error.message}`,
        name: fixtureName,
        ok: false,
      };
    }
    return { expectedError: error.message, name: fixtureName, ok: true };
  }
}

async function validateFixtures(options) {
  const cases = await listFixtureCases(options.fixturesDir);
  if (cases.length === 0) {
    throw new Error(`${options.fixturesDir}: no valid-* or invalid-* fixture directories found`);
  }

  const results = [];
  for (const fixtureName of cases) {
    results.push(await validateFixture(options.fixturesDir, fixtureName));
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    throw new Error(failures.map((failure) => failure.error).join("\n\n"));
  }

  return results;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printUsage();
    return;
  }

  const results = await validateFixtures(options);
  console.log(`AI proposal fixtures passed (${results.length} case(s)).`);
  for (const result of results) {
    console.log(`- ${result.name}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`Could not validate AI proposal fixtures: ${error.message}`);
  process.exitCode = 1;
}
