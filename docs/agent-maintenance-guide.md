# Agent 維護指南

這份文件給未來協助維護 SITCON Flickr Photo Finder 的 AI agent 與技術志工使用。

## 先理解資料權威來源

正式資料與 repo fixture 的權威關係請先看 `docs/README.md` 的真理來源表。

專案 repo 的角色是：

- 保存 schema、taxonomy、validation 與工具。
- 提供相簿掃描、匯入、AI 輔助、匯出與同步流程。
- 保存文件，讓未來 agent 能理解專案目標與資料維護方式。
- 保存 sample / fixture / export format，方便本機開發與測試。

`data/photo-schema.json` 是照片、相簿與匯入批次欄位順序、欄位 metadata 與 reviewed 完整度規則的機器可讀來源。

欄位、taxonomy value、boolean value、狀態與人類審核報表文字不要在各介面各自翻譯。欄位顯示文字回到 `data/photo-schema.json`，taxonomy / boolean 顯示文字回到 `data/tag-taxonomy.json` 的 `option_labels`，Node 端人類輸出使用 `scripts/lib/core/metadata-display.mjs`。只有單一畫面專屬的操作文案，例如按鈕、空狀態與局部提示，才留在該畫面程式中。

## Agent 可以協助的工作

Agent 適合協助：

- 讀懂專案文件並更新維護流程。
- 掃描 Flickr 相簿，找出尚未匯入的照片。
- 產生可寫入 Google Sheets 的候選資料。
- 根據 repo schema/taxonomy 檢查資料格式。
- 協助維護 Apps Script 或同步工具。
- 協助 AI 初標照片內容。
- 產生人類可審核的欄位調整 diff。
- 維護搜尋 UI、validation script 與文件。

Agent 不應自行假設：

- repo 內 sample data 是正式資料。
- 擁有 Google Sheets、Google API、OAuth、第三方工具或 Apps Script credential。
- 某位維護者本機可用的授權方式，在其他使用者或未來 agent 手上也一定可用。
- 可以繞過 SITCON 既有文件與權限交接制度。
- AI 標註結果可以直接取代人工確認。

## 權限與交接

SITCON 組織已有既有文件存放與交接制度。這個專案不保存 credential，也不重新定義 Google Drive 權限交接。

遇到權限問題時，agent 應該：

1. 先確認需要哪一類資產或權限，例如 Google Sheets 編輯權限、Google Sheets API service account credential、Apps Script/clasp、第三方工具或 AI API。
2. 檢查 repo 內是否有本專案的資產地圖或操作文件。
3. 若需要組織權限或 credential，請人類依 SITCON 既有文件與 Google Drive 管理流程處理。
4. 不要把 token、API key、credential 或私人連結寫入 repo。

Agent 應把「可公開讀取」、「可寫入」、「資料格式正確」視為三件不同的事：

- `pnpm sheets:check` 只驗證公開讀取與初始化覆蓋風險，不代表具備寫入權限。
- 正式 Sheets 表格寫入的 repo CLI 方向是官方 Google Sheets API SDK；建議正式寫入身份是 SITCON 管理的 service account，且該 service account email 必須被加入正式 Google Sheets 編輯者。
- agent 不應因為自己本機某種授權可用，就把該 credential 或 token 流程寫成唯一交接方式。
- `pnpm data:validate` 驗證資料格式與 schema，不代表 Google Drive/Sheets 權限正確。
- `pnpm intake:validate` 驗證本次匯入產物內部一致，不代表它已經成功套用到正式 Sheets。

## Sheets onboarding 與練習表

正式表的 `使用說明` 分頁與固定練習用試算表是整理者 onboarding 的正式路徑。遇到「新整理者怎麼開始」、「練習資料怎麼重置」、「使用說明怎麼同步」這類問題時，先讀 `docs/sheets-sync-workflow.md`，再檢查 `config/project.json` 的 `googleSheets.spreadsheetId`、`googleSheets.appsScriptId`、`googleSheets.practiceSpreadsheetId` 與 `googleSheets.practiceAppsScriptId`。

維護這條流程時請注意：

- `pnpm sheets:practice:build` 只產生本機 `tmp/sheets-practice/` 資料包，不寫入 Google Sheets。
- `pnpm sheets:practice:sync` 是重置固定練習表的 SDK 工具，預設 dry-run，加上 `--write` 才會寫入。
- `pnpm sheets:sync-guide` 會同步正式表或練習表的 `使用說明`；正式表應連到固定練習表，練習表應連回正式表。
- `pnpm apps-script:push` 預設推正式表；練習表必須用 `pnpm apps-script:push -- --target practice`。push/status/open/deployments 應依 target 重建本機 `.clasp.json`，不要把既有 `.clasp.json` 當作推送目標的權威來源。
- 練習表不是正式資料來源，不應被 intake、AI 初標、公開前端或正式 validation 當作正式照片索引。
- 工具應拒絕把正式 `spreadsheetId` 當成練習表目標；若這個防護失效，應先修工具，不要用文件要求操作者記得避開。

## AI 輔助資料流程

AI 只能作為資料匯入與整理輔助。

若任務是操作 repo 流程來準備 AI 工作包、建立 attempt、檢查模型輸出、產生報表或安排 Sheets dry-run，請先讀 `docs/ai-labeling-operator-guide.md` 與 `docs/ai-labeling-contract.md`。前者是操作者 runbook，後者是 AI 初標階段的輸入、圖片來源、`metadata-proposals.json` 輸出格式與驗證命令的合約。

若任務只是替 `tmp/ai-runs/<run-id>/` 或 attempt 目錄裡的照片產生初標 metadata，模型或 agent 的主要入口應是該 run 目錄的 `ai-labeling-prompt.md`，再讀 `docs/ai-labeling-contract.md`、schema、taxonomy、sponsorship items、`photos.json` 與圖片；不需要整份讀完 operator guide。

若任務是評估模型輸出品質、調整 prompt 或判斷 `visual_description` 是否有搜尋增益，請再讀 `docs/ai-labeling-evaluation-notes.md`。

建議流程：

1. 先用 `pnpm ai:prepare` 建立 run；同一批輸入要交給多模型或多輪時，用 `pnpm eval:attempt` 建立 attempt，不要手動複製資料夾。
2. Agent 或模型讀取 `ai-labeling-prompt.md`、`photos.json`、`images/`、schema、taxonomy 與 sponsorship items。
3. Agent 或模型只輸出 `metadata-proposals.json`，不要改 `photos.json`、Sheets export 或正式 Google Sheets。大型 run 可先用 `pnpm ai:shard:prepare` 把分片中間檔放在 `/tmp/ai-labeling-shards/<run-id>/`，再用 `pnpm ai:shard:merge` 合併；不要手動沿用舊 proposal。
4. 用 `pnpm ai:review -- --run-dir <dir>` 驗證並產生 `metadata-review-summary.md`、`metadata-diff.md` 與 update plan。若要先檢查暫存 proposal，可用 `--proposals <path> --output-dir <tmp-dir>` 避免 review artifacts 寫進正式 run 目錄。
5. 用 `pnpm ai:report -- --run <dir>` 閱讀單次結果；比較多模型或多輪時，用 `pnpm ai:report -- --runs <dir> <dir>`。
6. 若本次重點是 `visual_description` 或自然語言找圖，先用 `pnpm eval:search -- --run-dir <dir>` 比較 taxonomy-only baseline 與 description 搜尋結果。
7. 人類檢查後才用 `pnpm sheets:apply-ai-updates -- --run-dir <dir>` dry-run；確認後才可加上 `--write`。
8. AI 協助過但尚未人工確認的資料應標成 `ai_labeled`。

`ai:review` 的終端 `Next:` 與 `metadata-review-summary.md` 的 `## Next Commands` 是這段流程的主要交接介面。若新增 AI 檢視、比較或回寫前檢查工具，請同步更新 README、operator guide、contract、這兩個 Next 區塊，以及必要時的 `pnpm workflow` 提示。

Agent 的 AI 初標工作不應把資料標成 `reviewed`。`curation_status = reviewed` 應該在 Google Sheets 中，由具有編輯權限的志工夥伴一起檢核、修正並補齊必要欄位後再更新。若公開使用判斷合適，再把 `public_use_status` 設為 `approved`。

`curation_status` 只描述資料可信度：`unreviewed`、`ai_labeled`、`reviewed`。不要用它表達精選或封存。推薦優先度請看 `priority_level`、`collections` 與 `public_use_status`。

若人類要求重新觸發 AI 調整欄位，agent 應保留可審核的輸出，不應靜默覆蓋既有人工整理結果。

## 維護資料時的基本檢查

更動 `data/photo-schema.json`、taxonomy、sample data 或 validation logic 後，請執行：

```bash
pnpm data:validate
```

更動 JavaScript 後，請至少執行對應的語法檢查：

```bash
node --check scripts/commands/validate-data.mjs
node --check scripts/commands/discover-albums.mjs
node --check scripts/commands/add-photo.mjs
node --check scripts/commands/add-album.mjs
node --check app/main.js
```

依實際更動範圍選擇需要檢查的檔案，不需要每次全部重跑。

更動 GitHub Pages 前端時，先讀 `docs/public-frontend-architecture.md` 的模組邊界。若改到搜尋、篩選、排序、URL state、候選清單或 AI 助手提示詞，至少執行：

```bash
pnpm finder:test
pnpm finder:build
pnpm finder:check
```

前端純邏輯應優先放在可測試模組，例如 `app/search-sort.js` 或 `app/url-state.js`，避免在 `app/main.js` 直接讀 DOM 控制項後混入 domain logic。

## 文件優先順序

新 agent 接手時，最少必讀：

1. `README.md`
2. `AGENTS.md`
3. `docs/README.md`
4. `docs/project-architecture.md`

再依任務擴展閱讀：

- 資料庫與協作：`docs/database-collaboration-strategy.md`、`docs/google-sheets-database-design.md`
- 相簿匯入與同步：`docs/sheets-sync-workflow.md`
- 外部 AI 或 metadata 輔助：先依任務判斷讀者角色；模型初標以 run 目錄的 `ai-labeling-prompt.md` 與 `docs/ai-labeling-contract.md` 為主，操作者流程再讀 `docs/ai-labeling-operator-guide.md`，品質評估再讀 `docs/ai-labeling-evaluation-notes.md`，公開資料取用再讀 `docs/ai-readable-dataset.md`
- Apps Script：`docs/apps-script-maintenance-design.md`
- 人工填寫欄位：`docs/data-entry-guide.md`、`docs/photo-fields-reference.md`
- 產品背景與 MVP 取捨：`docs/photo-finder-mvp.md`、`docs/mvp-implementation-plan.md`

如果文件互相矛盾，以 Google Sheets-first 架構為準，並優先修正文件矛盾。
