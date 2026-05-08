import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const aiLabelingPromptFile = "ai-labeling-prompt.md";

export function renderAiLabelingPrompt(runDir) {
  const basePrompt = readFileSync("prompts/ai-labeling.md", "utf8").trim();

  return `# 本次 AI 初標工作包

請使用下列本次工作路徑，並依照後方 prompt 範本執行。

- AI run 目錄：\`${runDir}\`
- manifest：\`${runDir}/manifest.json\`
- photos：\`${runDir}/photos.json\`
- images：\`${runDir}/images/\`
- 輸出檔：\`${runDir}/metadata-proposals.json\`

完成後請執行：

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
    prompt,
    promptPath,
  };
}
