import { createSheetsService, quoteSheetName } from "./google-sheets-client.mjs";
import { googleSheetsSpreadsheetId } from "../core/project-config.mjs";
import { expectedSheetHeaders } from "./sheets-format.mjs";

export function normalizeSheetRow(row, length) {
  return Array.from({ length }, (_, index) => row[index] ?? "");
}

export function headersMatch(actual, expected) {
  return actual.length === expected.length && expected.every((header, index) => actual[index] === header);
}

export function rowsToRecords(rows, expectedHeaders) {
  const [headers, ...dataRows] = rows;
  if (!headers) {
    return [];
  }

  const normalizedHeaders = normalizeSheetRow(headers, expectedHeaders.length);
  if (!headersMatch(normalizedHeaders, expectedHeaders)) {
    throw new Error("sheet header does not match repo schema");
  }

  return dataRows.map((row) => {
    const normalizedRow = normalizeSheetRow(row, expectedHeaders.length);
    return Object.fromEntries(expectedHeaders.map((header, index) => [header, normalizedRow[index] ?? ""]));
  });
}

export async function readSheetRows(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetName(sheetName)}!A:ZZ`,
  });
  return response.data.values ?? [];
}

export async function readSheetRecords({
  sheets,
  sheetName,
  spreadsheetId = googleSheetsSpreadsheetId,
} = {}) {
  if (!spreadsheetId) {
    throw new Error("Set googleSheets.spreadsheetId in config/project.json or pass --spreadsheet-id");
  }
  const expectedHeaders = expectedSheetHeaders[sheetName];
  if (!expectedHeaders) {
    throw new Error(`Unknown fixed sheet name: ${sheetName}`);
  }

  const sheetsService = sheets ?? (await createSheetsService());
  const rows = await readSheetRows(sheetsService, spreadsheetId, sheetName);
  if (rows.length === 0) {
    throw new Error(`${sheetName} is empty; expected a header row`);
  }

  try {
    return rowsToRecords(rows, expectedHeaders);
  } catch (error) {
    throw new Error(`${sheetName} ${error.message}`);
  }
}
