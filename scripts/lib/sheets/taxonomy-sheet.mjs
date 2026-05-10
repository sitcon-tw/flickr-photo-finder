import { toCsvLine } from "../core/csv-utils.mjs";
import { taxonomyHeaders } from "./sheets-format.mjs";

export function taxonomyRows(taxonomy) {
  const rows = [];
  const optionLabels = taxonomy.option_labels ?? {};

  for (const [key, values] of Object.entries(taxonomy)) {
    if (!Array.isArray(values)) {
      continue;
    }

    values.forEach((value, index) => {
      rows.push({
        taxonomy_key: key,
        value,
        label_zh: optionLabels[key]?.[value] ?? value,
        order: String(index + 1),
      });
    });
  }

  return rows;
}

export function taxonomySheetValues(taxonomy) {
  return [
    taxonomyHeaders,
    ...taxonomyRows(taxonomy).map((row) => taxonomyHeaders.map((header) => row[header] ?? "")),
  ];
}

export function taxonomyToCsv(taxonomy) {
  const rows = taxonomyRows(taxonomy);
  return `${[
    taxonomyHeaders.join(","),
    ...rows.map((row) => toCsvLine(taxonomyHeaders, row)),
  ].join("\n")}\n`;
}
