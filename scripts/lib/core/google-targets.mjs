import {
  googleSheetsAppsScriptId,
  googleSheetsPracticeAppsScriptId,
  googleSheetsPracticeSpreadsheetId,
  googleSheetsSpreadsheetId,
} from "./project-config.mjs";

export const defaultGoogleTarget = "production";

const targetAliases = {
  formal: "production",
  main: "production",
  prod: "production",
};

const googleTargets = {
  production: {
    appsScriptConfigPath: "googleSheets.appsScriptId",
    appsScriptId: googleSheetsAppsScriptId,
    spreadsheetConfigPath: "googleSheets.spreadsheetId",
    spreadsheetId: googleSheetsSpreadsheetId,
    target: "production",
  },
  practice: {
    appsScriptConfigPath: "googleSheets.practiceAppsScriptId",
    appsScriptId: googleSheetsPracticeAppsScriptId,
    spreadsheetConfigPath: "googleSheets.practiceSpreadsheetId",
    spreadsheetId: googleSheetsPracticeSpreadsheetId,
    target: "practice",
  },
};

export function normalizeGoogleTarget(target = defaultGoogleTarget) {
  const rawTarget = String(target ?? "").trim().toLowerCase();
  const normalized = targetAliases[rawTarget] ?? rawTarget;
  if (!normalized || !googleTargets[normalized]) {
    throw new Error("--target currently supports: production, practice");
  }
  return normalized;
}

export function resolveGoogleTarget(
  target = defaultGoogleTarget,
  { requireAppsScriptId = false, requireSpreadsheetId = false } = {},
) {
  const normalized = normalizeGoogleTarget(target);
  const config = googleTargets[normalized];
  if (requireAppsScriptId && !config.appsScriptId) {
    throw new Error(`config/project.json ${config.appsScriptConfigPath} is not set.`);
  }
  if (requireSpreadsheetId && !config.spreadsheetId) {
    throw new Error(`config/project.json ${config.spreadsheetConfigPath} is not set.`);
  }
  return config;
}
