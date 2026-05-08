import { readFileSync } from "node:fs";

const configUrl = new URL("../config/project.json", import.meta.url);

function readProjectConfig() {
  try {
    return JSON.parse(readFileSync(configUrl, "utf8"));
  } catch (error) {
    throw new Error(`Could not read config/project.json: ${error.message}`);
  }
}

function requireString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`config/project.json requires ${path}`);
  }
  return value.trim();
}

function validateUrl(value, path) {
  const url = requireString(value, path);
  try {
    return new URL(url).toString();
  } catch {
    throw new Error(`config/project.json ${path} must be a valid URL`);
  }
}

function optionalString(value, path) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`config/project.json ${path} must be a string`);
  }
  return value.trim();
}

export const projectConfig = readProjectConfig();

export const organizationName = requireString(
  projectConfig.organization?.name,
  "organization.name",
);
export const organizationDisplayName = requireString(
  projectConfig.organization?.displayName ?? projectConfig.organization?.name,
  "organization.displayName",
);
export const flickrOwnerPath = requireString(projectConfig.flickr?.ownerPath, "flickr.ownerPath");
export const flickrAlbumsUrl = validateUrl(projectConfig.flickr?.albumsUrl, "flickr.albumsUrl");
export const flickrProfileUrl = validateUrl(
  projectConfig.flickr?.profileUrl,
  "flickr.profileUrl",
);
export const appTitle = requireString(projectConfig.frontend?.appTitle, "frontend.appTitle");
export const sourceLinkLabel = requireString(
  projectConfig.frontend?.sourceLinkLabel,
  "frontend.sourceLinkLabel",
);
export const googleSheetsSpreadsheetId = optionalString(
  projectConfig.googleSheets?.spreadsheetId,
  "googleSheets.spreadsheetId",
);
