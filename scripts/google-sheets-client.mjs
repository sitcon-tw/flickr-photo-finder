import { google } from "googleapis";

export const sheetsReadWriteScopes = ["https://www.googleapis.com/auth/spreadsheets"];

function maskCredentialPath(path) {
  if (!path) {
    return "";
  }
  const normalized = String(path);
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  const basename = parts.at(-1) ?? normalized;
  return parts.length > 1 ? `.../${basename}` : basename;
}

export async function createSheetsService({ scopes = sheetsReadWriteScopes } = {}) {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "";
  if (credentialPath) {
    console.error(`Google ADC: using GOOGLE_APPLICATION_CREDENTIALS (${maskCredentialPath(credentialPath)}).`);
  } else {
    console.error("Google ADC: GOOGLE_APPLICATION_CREDENTIALS is not set; Google SDK will use another ADC source if available.");
  }

  const auth = new google.auth.GoogleAuth({ scopes });
  const authClient = await auth.getClient();
  return google.sheets({ version: "v4", auth: authClient });
}

export function explainGoogleSheetsError(error) {
  const message = error?.message ?? String(error);
  const status = error?.code ? `HTTP ${error.code}: ` : "";
  const base = `${status}${message}`;

  if (/insufficient authentication scopes/i.test(message)) {
    return `${base}\n\nThe current Google Application Default Credentials do not include the required Google Sheets scope: ${sheetsReadWriteScopes[0]}. Use a service account credential shared as Editor on the target Sheet, or recreate personal ADC/OAuth credentials with that scope. Do not commit credential files or token caches.`;
  }

  if (/permission|forbidden/i.test(message) || error?.code === 403) {
    return `${base}\n\nThe credential was accepted but does not appear to have access to the target spreadsheet. Confirm the service account or OAuth user has at least Viewer access for dry-run/export and Editor access for write operations.`;
  }

  return base;
}

export function quoteSheetName(sheetName) {
  return `'${String(sheetName).replaceAll("'", "''")}'`;
}
