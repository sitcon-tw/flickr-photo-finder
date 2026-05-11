import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultGoogleTarget, resolveGoogleTarget } from "../lib/core/google-targets.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const appsScriptDir = resolve(repoRoot, "apps-script");
const localClaspConfigPath = resolve(appsScriptDir, ".clasp.json");
const appsScriptApiSettingsUrl = "https://script.google.com/home/usersettings";

function printUsage() {
  console.log(`Usage: pnpm apps-script:<command>

Commands:
  apps-script:login   Sign in to clasp with the current Google account.
  apps-script:bind    Create apps-script/.clasp.json for the Sheet-bound script ID.
                      Usage: pnpm apps-script:bind -- <script-id>
                      Or:    pnpm apps-script:bind -- --target production
                      Or:    pnpm apps-script:bind -- --target practice
  apps-script:status  Show local/remote clasp file status. Default target: production.
  apps-script:push    Rebuild generated config, validate data, then clasp push. Default target: production.
  apps-script:deployments
                      List Apps Script deployments. Default target: production.
  apps-script:open    Open the bound Apps Script project. Default target: production.

Configured defaults:
  rootDir: apps-script

Prerequisite:
  Enable the Apps Script API for the clasp login account:
  ${appsScriptApiSettingsUrl}
`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}

function runClasp(args, options = {}) {
  run("pnpm", ["dlx", "@google/clasp", ...args], options);
}

function printAppsScriptApiPrerequisite() {
  console.log(`Apps Script API prerequisite: enable it for the clasp login account at ${appsScriptApiSettingsUrl}`);
}

function requireScriptId(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Usage: pnpm apps-script:bind -- <script-id>, pnpm apps-script:bind -- --target production, or pnpm apps-script:bind -- --target practice. Open the Sheet, then Extensions > Apps Script > Project Settings to copy the Sheet-bound Script ID.");
  }
  return value.trim();
}

function commandLogin() {
  runClasp(["login"]);
}

function parseBindArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    scriptId: "",
    target: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      options.target = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
    } else if (!options.scriptId) {
      options.scriptId = arg;
    } else {
      throw new Error(`Unknown apps-script:bind argument: ${arg}`);
    }
  }

  if (options.target && options.scriptId) {
    throw new Error("Use either a direct script ID or --target, not both.");
  }
  if (options.target) {
    const targetConfig = resolveGoogleTarget(options.target, { requireAppsScriptId: true });
    options.scriptId = targetConfig.appsScriptId;
  }

  return options;
}

function parseTargetArgs(argv) {
  const args = argv.filter((arg) => arg !== "--");
  const options = {
    target: defaultGoogleTarget,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      options.target = args[index + 1] ?? "";
      index += 1;
    } else if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
    } else {
      throw new Error(`Unknown Apps Script target option: ${arg}`);
    }
  }

  return resolveGoogleTarget(options.target, { requireAppsScriptId: true });
}

function commandBind(argv) {
  const { scriptId } = parseBindArgs(argv);
  if (existsSync(localClaspConfigPath)) {
    throw new Error("apps-script/.clasp.json already exists. Refusing to overwrite the local clasp binding.");
  }
  writeLocalClaspConfig(requireScriptId(scriptId));
}

function writeLocalClaspConfig(scriptId) {
  const content = `${JSON.stringify({ scriptId, rootDir: "." }, null, 2)}\n`;
  writeFileSync(localClaspConfigPath, content);
  console.log("Created apps-script/.clasp.json. This local binding file is ignored by git.");
}

function writeTargetClaspConfig(targetConfig) {
  const content = `${JSON.stringify({ scriptId: targetConfig.appsScriptId, rootDir: "." }, null, 2)}\n`;
  writeFileSync(localClaspConfigPath, content);
}

function prepareTargetBinding(argv) {
  const targetConfig = parseTargetArgs(argv);
  writeTargetClaspConfig(targetConfig);
  console.log(`Target: ${targetConfig.target}`);
  console.log(`Script ID: ${targetConfig.appsScriptId}`);
  console.log("Local binding: apps-script/.clasp.json");
  return targetConfig;
}

function commandStatus(argv) {
  prepareTargetBinding(argv);
  printAppsScriptApiPrerequisite();
  runClasp(["status"], { cwd: appsScriptDir });
}

function commandPush(argv) {
  prepareTargetBinding(argv);
  run("pnpm", ["apps-script:build-config"]);
  run("pnpm", ["data:validate"]);
  printAppsScriptApiPrerequisite();
  runClasp(["push"], { cwd: appsScriptDir });
}

function commandDeployments(argv) {
  prepareTargetBinding(argv);
  printAppsScriptApiPrerequisite();
  runClasp(["deployments"], { cwd: appsScriptDir });
}

function commandOpen(argv) {
  prepareTargetBinding(argv);
  printAppsScriptApiPrerequisite();
  runClasp(["open"], { cwd: appsScriptDir });
}

const command = process.argv[2] ?? "help";

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
  } else if (command === "login") {
    commandLogin();
  } else if (command === "bind") {
    commandBind(process.argv.slice(3));
  } else if (command === "status") {
    commandStatus(process.argv.slice(3));
  } else if (command === "push") {
    commandPush(process.argv.slice(3));
  } else if (command === "deployments") {
    commandDeployments(process.argv.slice(3));
  } else if (command === "open") {
    commandOpen(process.argv.slice(3));
  } else {
    printUsage();
    throw new Error(`Unknown Apps Script clasp command: ${command}`);
  }
} catch (error) {
  console.error(`Apps Script clasp workflow failed: ${error.message}`);
  process.exitCode = 1;
}
