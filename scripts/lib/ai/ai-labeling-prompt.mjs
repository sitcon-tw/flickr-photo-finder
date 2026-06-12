import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const aiLabelingPromptFile = "ai-labeling-prompt.md";
export const aiLabelingPromptSource = "prompts/ai-labeling.md";

export function getAiLabelingPromptMetadata() {
  const template = readFileSync(aiLabelingPromptSource, "utf8");
  return {
    prompt_template_path: aiLabelingPromptSource,
    prompt_template_sha256: createHash("sha256").update(template).digest("hex"),
  };
}

export function renderAiLabelingPrompt(runDir) {
  const basePrompt = readFileSync(aiLabelingPromptSource, "utf8").trim();

  return `# 本次 AI 搜尋級標記工作包

這份檔案是交給模型或 agent 執行照片搜尋級標記的主要任務提示。請使用下列本次工作路徑，並依照後方 prompt 範本執行。

不要讀取或套用操作者 runbook、評估筆記或 Google Sheets 回寫流程作為本次標記依據；那些文件給人類操作者與 repo 維護 agent 使用，不是模型判讀照片時的必要脈絡。

- AI run 目錄：\`${runDir}\`
- manifest：\`${runDir}/manifest.json\`
- photos：\`${runDir}/photos.json\`
- images：\`${runDir}/images/\`
- 逐張輸出目錄：\`${runDir}/photo-artifacts/\`
- 合併後輸出檔：\`${runDir}/metadata-proposals.json\`
- 合併後逐張視覺稽核：\`${runDir}/visual-inspection-audit.json\`
- 合併 manifest：\`${runDir}/artifact-manifest.json\`

小型 direct run 也必須逐張打開單張圖片，並在看完每張照片後立刻寫出 \`${runDir}/photo-artifacts/<photo_id>.json\`。不要先把多張照片的觀察累積在對話 context，因為 context compact 或長上下文注意力偏移會讓未落盤觀察遺失或被重寫。每張照片都是獨立判讀單位；下一張照片不需要前一張照片的 context。

禁止建立或使用 contact sheet、montage、縮圖牆、HTML gallery screenshot 或多圖截圖來判斷任何欄位；這些合成圖即使只用來「快速掌握整體」也會降低逐張標記品質，不能作為本任務步驟。

完成後請交還操作者執行檢查。若你是具備 repo 指令執行能力的 agent，小型 run 可接著執行：

\`\`\`bash
pnpm ai:artifacts:merge -- --run-dir ${runDir}
pnpm ai:review -- --run-dir ${runDir} --codex-session <parent-session-id>
\`\`\`

若本次照片數量很大，請先使用 repo 的 sharded 流程。worker 的唯一交付物仍是逐張 \`photo-artifacts/shard-XX/<photo_id>.json\`；不要把 \`outputs/shard-XX-proposals.json\` 這類 shard proposal array 當成可採用成果。合併後先用 \`--proposals\` 與 \`--output-dir\` 在暫存目錄執行 validate/review；確認後才把最後的 \`metadata-proposals.json\`、\`visual-inspection-audit.json\` 與 \`artifact-manifest.json\` 寫回 AI run 目錄。

如果你是具備 repo 指令能力、且執行環境支援建立 sub-agents / worker agents / parallel agent work 的 parent agent，本任務明確要求你在 smoke test 通過後建立多個 worker agents 並行處理 shard。請把每個 worker 的寫入範圍限定在各自的 \`/tmp/ai-labeling-shards/<run-id>/photo-artifacts/shard-XX/\`，parent agent 保留分配、artifact 合併、validate、review 與修補責任。若平台有 agent/thread 上限，請用 4 到 6 個 worker 的 queue 逐批補位，不要默默退回單一 parent agent 長時間逐 shard 標記。

---

${basePrompt}
`;
}

export function writeAiLabelingPrompt(runDir) {
  const promptPath = join(runDir, aiLabelingPromptFile);
  const prompt = renderAiLabelingPrompt(runDir);
  writeFileSync(promptPath, prompt);
  return {
    ...getAiLabelingPromptMetadata(),
    prompt,
    promptPath,
  };
}
