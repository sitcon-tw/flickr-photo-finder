import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  appsScriptProjectTitle,
  googleSheetsSpreadsheetId,
} from "./project-config.mjs";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const appsScriptDir = resolve(repoRoot, "apps-script");
const localClaspConfigPath = resolve(appsScriptDir, ".clasp.json");
const appsScriptApiSettingsUrl = "https://script.google.com/home/usersettings";

function printUsage() {
  console.log(`Usage: pnpm apps-script:<command>

Commands:
  apps-script:login   Sign in to clasp with the current Google account.
  apps-script:bind    Create apps-script/.clasp.json for an existing script ID.
  apps-script:create  Create a Sheet-bound Apps Script project for this repo.
  apps-script:status  Show local/remote clasp file status.
  apps-script:push    Rebuild generated config, validate data, then clasp push.
  apps-script:open    Open the bound Apps Script project.

Configured defaults:
  project title: ${appsScriptProjectTitle}
  spreadsheetId: ${googleSheetsSpreadsheetId || "(missing)"}
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
    throw new Error("Usage: pnpm apps-script:bind -- <script-id>");
  }
  return value.trim();
}

function requireSpreadsheetId() {
  if (!googleSheetsSpreadsheetId) {
    throw new Error("config/project.json requires googleSheets.spreadsheetId before creating a Sheet-bound Apps Script project.");
  }
}

function requireLocalClaspConfig() {
  if (!existsSync(localClaspConfigPath)) {
    throw new Error("apps-script/.clasp.json is missing. Run pnpm apps-script:create or create it from apps-script/.clasp.json.example.");
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

function writeLocalClaspConfig(scriptId) {
  const content = `${JSON.stringify({ scriptId, rootDir: "." }, null, 2)}\n`;
  writeFileSync(localClaspConfigPath, content);
  console.log("Created apps-script/.clasp.json. This local binding file is ignored by git.");
}

function commandCreate() {
  requireSpreadsheetId();
  if (existsSync(localClaspConfigPath)) {
    throw new Error("apps-script/.clasp.json already exists. Refusing to create a second bound Apps Script project.");
  }
  printAppsScriptApiPrerequisite();
  const tempRoot = mkdtempSync(resolve(tmpdir(), "photo-finder-clasp-"));
  runClasp([
    "create",
    "--title",
    appsScriptProjectTitle,
    "--type",
    "sheets",
    "--parentId",
    googleSheetsSpreadsheetId,
    "--rootDir",
    ".",
  ], { cwd: tempRoot });
  const createdConfig = JSON.parse(readFileSync(resolve(tempRoot, ".clasp.json"), "utf8"));
  rmSync(tempRoot, { recursive: true, force: true });
  writeLocalClaspConfig(createdConfig.scriptId);
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
    commandBind(process.argv[3]);
  } else if (command === "create") {
    commandCreate();
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
