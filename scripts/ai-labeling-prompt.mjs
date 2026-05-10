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

  return `# 本次 AI 初標工作包

這份檔案是交給模型或 agent 執行照片初標的主要任務提示。請使用下列本次工作路徑，並依照後方 prompt 範本執行。

不要讀取或套用操作者 runbook、評估筆記或 Google Sheets 回寫流程作為本次標記依據；那些文件給人類操作者與 repo 維護 agent 使用，不是模型判讀照片時的必要脈絡。

- AI run 目錄：\`${runDir}\`
- manifest：\`${runDir}/manifest.json\`
- photos：\`${runDir}/photos.json\`
- images：\`${runDir}/images/\`
- 輸出檔：\`${runDir}/metadata-proposals.json\`

完成後請交還操作者執行檢查。若你是具備 repo 指令執行能力的 agent，可接著執行：

\`\`\`bash
pnpm ai:review -- --run-dir ${runDir}
\`\`\`

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
