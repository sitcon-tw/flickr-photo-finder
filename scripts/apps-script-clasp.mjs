import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const appsScriptDir = resolve(repoRoot, "apps-script");
const localClaspConfigPath = resolve(appsScriptDir, ".clasp.json");
const appsScriptApiSettingsUrl = "https://script.google.com/home/usersettings";

function printUsage() {
  console.log(`Usage: pnpm apps-script:<command>

Commands:
  apps-script:login   Sign in to clasp with the current Google account.
  apps-script:bind    Create apps-script/.clasp.json for the Sheet-bound script ID.
  apps-script:status  Show local/remote clasp file status.
  apps-script:push    Rebuild generated config, validate data, then clasp push.
  apps-script:open    Open the bound Apps Script project.

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
    throw new Error("Usage: pnpm apps-script:bind -- <script-id>. Open the Sheet, then Extensions > Apps Script > Project Settings to copy the Sheet-bound Script ID.");
  }
  return value.trim();
}

function requireLocalClaspConfig() {
  if (!existsSync(localClaspConfigPath)) {
    throw new Error("apps-script/.clasp.json is missing. Open the Sheet, then Extensions > Apps Script > Project Settings, copy the Script ID, and run pnpm apps-script:bind -- <script-id>.");
  }
}

function commandLogin() {
  runClasp(["login"]);
}

function commandBind(scriptId) {
  if (existsSync(localClaspConfigPath)) {
    throw new Error("apps-script/.clasp.json already exists. Refusing to overwrite the local clasp binding.");
  }
  writeLocalClaspConfig(requireScriptId(scriptId));
}

function firstCommandArgument() {
  return process.argv.slice(3).find((value) => value !== "--");
}

function writeLocalClaspConfig(scriptId) {
  const content = `${JSON.stringify({ scriptId, rootDir: "." }, null, 2)}\n`;
  writeFileSync(localClaspConfigPath, content);
  console.log("Created apps-script/.clasp.json. This local binding file is ignored by git.");
}

function commandStatus() {
  requireLocalClaspConfig();
  printAppsScriptApiPrerequisite();
  runClasp(["status"], { cwd: appsScriptDir });
}

function commandPush() {
  requireLocalClaspConfig();
  run("pnpm", ["apps-script:build-config"]);
  run("pnpm", ["validate:data"]);
  printAppsScriptApiPrerequisite();
  runClasp(["push"], { cwd: appsScriptDir });
}

function commandOpen() {
  requireLocalClaspConfig();
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
    commandBind(firstCommandArgument());
  } else if (command === "status") {
    commandStatus();
  } else if (command === "push") {
    commandPush();
  } else if (command === "open") {
    commandOpen();
  } else {
    printUsage();
    throw new Error(`Unknown Apps Script clasp command: ${command}`);
  }
} catch (error) {
  console.error(`Apps Script clasp workflow failed: ${error.message}`);
  process.exitCode = 1;
}
