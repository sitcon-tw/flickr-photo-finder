import { google } from "googleapis";

export const sheetsReadWriteScopes = ["https://www.googleapis.com/auth/spreadsheets"];

export async function createSheetsService({ scopes = sheetsReadWriteScopes } = {}) {
  const auth = new google.auth.GoogleAuth({ scopes });
  const authClient = await auth.getClient();
  return google.sheets({ version: "v4", auth: authClient });
}

export function quoteSheetName(sheetName) {
  return `'${String(sheetName).replaceAll("'", "''")}'`;
}
