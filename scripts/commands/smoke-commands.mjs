import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const smokeRoots = [
  "scripts/commands",
  "scripts/workflows",
];

function printUsage() {
  console.log(`Usage: pnpm command:smoke [--list] [--verbose]

Runs lightweight command-level smoke tests that do not require Google,
Flickr, Apps Script, GA4, or AI credentials.

Default behavior:
  - discover command/workflow entrypoints that implement --help
  - run each entrypoint as: node <entrypoint> --help
  - fail if the help path crashes or prints no output

Options:
  --list       Print the discovered help-smoke entrypoints without running them.
  --verbose    Print each entrypoint while running the smoke test.
  --help, -h   Show this help.

Credential-required integration tests are intentionally outside this CI-safe
smoke test. See docs/command-smoke-tests.md.
`);
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function helpEntrypoints() {
  const files = (await Promise.all(smokeRoots.map((root) => collectFiles(root))))
    .flat()
    .sort();
  const entrypoints = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (supportsHelpOption(content)) {
      entrypoints.push(file);
    }
  }

  return entrypoints;
}

function supportsHelpOption(content) {
  return [
    /\barg\s*===\s*["']--help["']/,
    /\bcommand\s*===\s*["']--help["']/,
    /\bargs\.includes\(["']--help["']\)/,
    /\bprocess\.argv\.includes\(["']--help["']\)/,
  ].some((pattern) => pattern.test(content));
}

function runHelp(file, { verbose }) {
  if (verbose) {
    console.log(`Help smoke: node ${file} --help`);
  }

  const result = spawnSync(process.execPath, [file, "--help"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.error) {
    return {
      ok: false,
      message: `${file}: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      message: `${file}: exited with status ${result.status}\n${output}`,
    };
  }
  if (!output) {
    return {
      ok: false,
      message: `${file}: --help produced no output`,
    };
  }

  return { ok: true };
}

function parseArgs(argv) {
  const options = {
    list: false,
    verbose: false,
  };

  for (const arg of argv) {
    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--list") {
      options.list = true;
    } else if (arg === "--verbose") {
      options.verbose = true;
    } else {
      throw new Error(`Unknown command smoke option: ${arg}`);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const entrypoints = await helpEntrypoints();
  if (options.list) {
    console.log(`Command help smoke entrypoints (${entrypoints.length}):`);
    for (const file of entrypoints) {
      console.log(`- ${file}`);
    }
    return;
  }

  const failures = [];
  for (const file of entrypoints) {
    const result = runHelp(file, options);
    if (!result.ok) {
      failures.push(result.message);
    }
  }

  if (failures.length > 0) {
    console.error(`Command help smoke failed (${failures.length}/${entrypoints.length}).`);
    for (const failure of failures) {
      console.error(`\n${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Command help smoke passed (${entrypoints.length} entrypoints).`);
}

try {
  await main();
} catch (error) {
  console.error(`Could not run command smoke tests: ${error.message}`);
  process.exitCode = 1;
}
