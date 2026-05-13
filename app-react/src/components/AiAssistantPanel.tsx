import { useState } from "react";
import { Button } from "react-aria-components";
import type { FinderData, FinderFilters, TaskMode } from "../domain";
import { labelFor } from "../filters";
import { buildAiAssistantPrompt } from "../finderCore";

type AiAssistantPanelProps = {
  data: FinderData;
  filters: FinderFilters;
  search: string;
  task?: TaskMode;
};

function photosSheetUrl(data: FinderData): string {
  const config = data.projectConfig as { googleSheets?: { spreadsheetId?: string; photosSheetGid?: string | number } };
  const spreadsheetId = String(config.googleSheets?.spreadsheetId ?? "").trim();
  if (!spreadsheetId) return "";
  const gid = encodeURIComponent(String(config.googleSheets?.photosSheetGid ?? 0));
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${gid}#gid=${gid}`;
}

function filterEntries(data: FinderData, filters: FinderFilters): [string, string, string][] {
  return Object.entries(filters).flatMap(([key, values]) =>
    values.map((value) => [key, key, labelFor(data, key, value)] as [string, string, string]),
  );
}

export function AiAssistantPanel({ data, filters, search, task }: AiAssistantPanelProps) {
  const [copyStatus, setCopyStatus] = useState("");
  const sheetUrl = photosSheetUrl(data);
  const prompt = buildAiAssistantPrompt({
    sheetUrl,
    taskLabel: task?.label ?? "全部照片",
    searchValue: search,
    filterEntries: filterEntries(data, filters),
  });

  async function copyPrompt() {
    if (!navigator.clipboard?.writeText) {
      setCopyStatus("瀏覽器不支援複製");
      return;
    }
    await navigator.clipboard.writeText(prompt);
    setCopyStatus("已複製");
    window.setTimeout(() => setCopyStatus(""), 1600);
  }

  return (
    <section className="assistant-panel" aria-label="AI 助手找照片">
      <div className="panel-heading">
        <div>
          <h2>AI 助手</h2>
          <p>把目前任務與條件交給熟悉的 AI 工具</p>
        </div>
      </div>
      <div className="assistant-actions">
        <Button type="button" onPress={copyPrompt}>複製提示詞</Button>
        <Button type="button" isDisabled={!sheetUrl} onPress={() => window.open(sheetUrl, "_blank", "noopener,noreferrer")}>開 Sheets</Button>
      </div>
      {copyStatus ? <p className="copy-status">{copyStatus}</p> : null}
    </section>
  );
}
