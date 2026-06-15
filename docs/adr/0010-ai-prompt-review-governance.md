# ADR 0010: AI prompt review 採 evidence 與 owner 決策 gate

## 狀態

Accepted

## 背景

AI 搜尋級標記會直接影響 Finder 的搜尋召回、篩選、排序與人工 review 成本。Prompt、validator、搜尋評估或 schema 變更如果只依單次模型觀察修改，容易把特定 run、特定模型或特定活動場景的偏差寫成長期規則。

專案已經有 `ai:review`、`ai:report`、`eval:search`、`eval:sample` 與 `eval:prompt-review` 等工具，可以把候選品質、搜尋增益、角色 review 與 owner 決策整理成可追溯 artifact。

## 決策

AI prompt、validator、搜尋或 schema 調整應先經過 evidence 與 owner 決策 gate：

- 一般標記任務仍以 run 目錄的 `ai-labeling-prompt.md` 與 `docs/ai-labeling-contract.md` 為模型入口。
- 操作者先用 `ai:review`、`ai:report`、`eval:search` 或相關 eval 工具取得 evidence。
- 需要 prompt / schema / search / docs 決策時，使用 `pnpm eval:prompt-review` 建立本機決策包。
- `eval:prompt-review` 只產生 review artifact，不自動呼叫外部 LLM、不自動分派 agent、不修改 prompt/schema、不寫 Google Sheets。
- 若需要獨立審查，操作者必須明確分派不同 agent 或不同可追溯 session，並在 `expert-reviews/` 記錄 provenance。
- Owner 接受決策包後，再另開實作切片修改 prompt、validator、search、docs 或 schema。

同一個 agent 依多個角色產生的 review 可以作為快速 synthesis，但不能標示成獨立審查共識。

## 取捨

優點：

- 讓 prompt 與 schema 變更可追溯到具體 run、prompt hash、review summary 與搜尋 evidence。
- 避免單次模型輸出或單一活動場景主導長期規則。
- 保留 owner 決策點，不讓工具自動把建議套進正式流程。

代價：

- 高影響 AI 流程變更多一個決策步驟。
- 操作者需要管理本機 prompt review artifact 與 reviewer provenance。
- 小幅 prompt copy 修正也需要判斷是否影響標記行為；若會影響行為，應回到本 ADR 的 gate。

## 替代方案

- 直接修改 prompt：速度快，但缺少可追溯 evidence 與 owner decision。
- 讓工具自動呼叫外部 LLM 審查者：可自動化，但 provider、credential、成本與品質邊界不應進入 repo 工具第一版。
- 把所有模型評估永久保存成 docs：可讀性高，但會讓 repo 充滿過期 run 觀察；歷史細節應回到 git history 或本機 run artifact。

## 重新評估條件

出現以下情況時，應重新評估 prompt review gate：

- AI 標記進入更高頻率的正式營運，需要更自動化的決策記錄。
- Owner 決策、prompt hash、review provenance 或 adoption outcome 有新的正式儲存位置。
- 組織決定導入受控的外部 LLM reviewer 執行環境。

## 相關文件

- `docs/ai-labeling-contract.md`
- `docs/ai-labeling-operator-guide.md`
- `prompts/ai-labeling.md`
- `scripts/commands/build-prompt-review-package.mjs`
