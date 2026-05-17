# Agent 維護指南

這份文件給未來協助維護 SITCON Flickr Photo Finder 的 AI agent 與技術志工使用。

第一次接手專案時，請先讀 `docs/README.md` 的「先建立共同語言」與「整體資料生命週期」。本文件假設你已知道正式 Sheets、本機工作快取、intake run、AI run、attempt 與 prompt review 決策包在端到端流程中的位置。

## 先理解資料權威來源

正式資料與 repo fixture 的權威關係請先看 `docs/README.md` 的真理來源表。

專案 repo 的角色是：

- 保存 schema、taxonomy、validation 與工具。
- 提供相簿掃描、匯入、AI 輔助、匯出與同步流程。
- 保存文件，讓未來 agent 能理解專案目標與資料維護方式。
- 保存 sample / fixture / export format，方便本機開發與測試。

`data/photo-schema.json` 是照片、相簿與匯入批次欄位順序、欄位 metadata 與 reviewed 完整度規則的機器可讀來源。

欄位、taxonomy value、boolean value、狀態與人類審核報表文字不要在各介面各自翻譯。欄位顯示文字回到 `data/photo-schema.json`，taxonomy / boolean 顯示文字回到 `data/tag-taxonomy.json` 的 `option_labels`，Node 端人類輸出使用 `scripts/lib/core/metadata-display.mjs`。只有單一畫面專屬的操作文案，例如按鈕、空狀態與局部提示，才留在該畫面程式中。

跨介面 filter、task mode、URL key、狀態排序、people count bucket、Apps Script field set 等 interface policy 回到 `data/interface-registry.json`。不要為了單一 Pages、Apps Script 或 CLI 改動另寫一份欄位 mapping；需要短 label 或介面排序時，先更新 registry，再執行 `pnpm apps-script:build-config` 與 `pnpm shared-values:check`。

描述版本或狀態時不要使用含糊的相對版本詞。改用具體日期、prompt hash、schema version、header shape、target name 或「目前 repo source」；例如比較 AI prompt 時寫出 `prompt_template_sha256`，說明 Sheets 格式時寫出實際 header。`pnpm language:check` 會阻擋這類含糊版本詞再次進入 repo。

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

接手維運時，先用 `docs/operations-handoff-checklist.md` 確認本專案需要哪些資產、權限能力與 dry-run 驗證；遇到具體故障症狀時，再用 `docs/troubleshooting.md` 分流到對應 runbook。

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

依讀者角色選擇文件，避免把操作文件誤當成模型判斷依據：

| 任務類型 | 主要閱讀 | 不要讀成標註依據 |
| --- | --- | --- |
| 只產生初標 metadata | run 目錄的 `ai-labeling-prompt.md`、`docs/ai-labeling-contract.md`、schema、taxonomy、sponsorship items、`photos.json` 與圖片 | operator guide、Sheets 回寫文件、既有 proposals |
| 操作 AI run 或建立 attempt | `docs/ai-labeling-operator-guide.md`、`docs/ai-labeling-contract.md` | 不要把工具流程文件交給只負責標註的模型 |
| 評估 prompt / 搜尋增益 | `docs/ai-labeling-evaluation-notes.md`、`docs/ai-labeling-prompt-expert-review.md` | 不要把單次 search lift 當成品質保證 |
| 維護 repo 流程 | `AGENTS.md`、本文件、`docs/README.md` | 不要跳過 source-of-truth 文件與 run artifact |

若任務是操作 repo 流程來準備 AI 工作包、建立 attempt、檢查模型輸出、產生報表或安排 Sheets dry-run，請先讀 `docs/ai-labeling-operator-guide.md` 與 `docs/ai-labeling-contract.md`。前者是操作者 runbook，後者是 AI 初標階段的輸入、圖片來源、`metadata-proposals.json` 輸出格式與驗證命令的合約。

若任務只是替 `tmp/ai-runs/<run-id>/` 或 attempt 目錄裡的照片產生初標 metadata，模型或 agent 的主要入口應是該 run 目錄的 `ai-labeling-prompt.md`，再讀 `docs/ai-labeling-contract.md`、schema、taxonomy、sponsorship items、`photos.json` 與圖片；不需要整份讀完 operator guide。

若任務是評估模型輸出品質、調整 prompt 或判斷 `visual_description` 是否有搜尋增益，請再讀 `docs/ai-labeling-evaluation-notes.md`。若要統整多專家 prompt 建議或 owner 決策，請讀 `docs/ai-labeling-prompt-expert-review.md`，並用 `pnpm eval:prompt-review` 只產生 review artifact。

建議流程：

1. 先用 `pnpm ai:prepare` 建立 run；同一批輸入要交給多模型或多輪時，用 `pnpm eval:attempt` 建立 attempt，不要手動複製資料夾。
2. Agent 或模型讀取 `ai-labeling-prompt.md`、`photos.json`、`images/`、schema、taxonomy 與 sponsorship items。
3. Agent 或模型只輸出 `metadata-proposals.json`，不要改 `photos.json`、Sheets export 或正式 Google Sheets。大型 run 可先用 `pnpm ai:shard:prepare` 把分片中間檔放在 `/tmp/ai-labeling-shards/<run-id>/`，再用 `pnpm ai:shard:merge` 合併；不要手動沿用先前 proposal。若 parent agent 具備建立 sub-agents 或 worker agents 的能力，smoke test 通過後應分派多個 worker 平行處理不同 shard，parent agent 只負責 orchestration、合併、validate、review 與修補。
4. 用 `pnpm ai:review -- --run-dir <dir>` 驗證並產生 `metadata-review-summary.md`、`metadata-diff.md` 與 update plan。若要先檢查暫存 proposal，可用 `--proposals <path> --output-dir <tmp-dir>` 避免 review artifacts 寫進正式 run 目錄。
5. 用 `pnpm ai:report -- --run <dir>` 閱讀單次結果；比較多模型或多輪時，用 `pnpm ai:report -- --runs <dir> <dir>`。
6. 若本次重點是 `visual_description` 或自然語言找圖，先用 `pnpm eval:search -- --run-dir <dir>` 比較 taxonomy-only baseline 與 description 搜尋結果。
7. 若本次重點是 prompt、schema、workflow 或人工審核成本決策，先用 `pnpm eval:prompt-review -- --mode prepare --runs <dir> [dir...]` 建立決策包，收到專家 review 後再用 `--mode compile` 彙整。
8. 人類檢查後才用 `pnpm sheets:apply-ai-updates -- --run-dir <dir>` dry-run；確認後才可加上 `--write`。
9. AI 協助過但尚未人工確認的資料應標成 `ai_labeled`。

照片量大時，不預期所有 `ai_labeled` 照片都會被人工 review 完畢。Agent 不應把「清空 AI 待審佇列」當成預設目標；應優先協助建立抽查樣本、找出批次風險、整理高互動或高價值照片，並把任何接受率、修改率或拒絕率限定在實際被人類處理過的 subset。

`ai:review` 的終端 `Next:` 與 `metadata-review-summary.md` 的 `## Next Commands` 是這段流程的主要交接介面。若新增 AI 檢視、比較或回寫前檢查工具，請同步更新 README、operator guide、contract、這兩個 Next 區塊，以及必要時的 `pnpm workflow` 提示。

Agent 的 AI 初標工作不應把資料標成 `reviewed`。`curation_status = reviewed` 應該在 Google Sheets 中，由具有編輯權限的志工夥伴一起檢核、修正並補齊必要欄位後再更新。若整理者確認沒有使用提醒，再把 `public_use_status` 設為 `approved`。

`curation_status` 只描述資料可信度：`unreviewed`、`ai_labeled`、`reviewed`。不要用它表達精選或封存。推薦優先度請看 `priority_level`、`collections` 與 `public_use_status`。

若人類要求重新觸發 AI 調整欄位，agent 應保留可審核的輸出，不應靜默覆蓋既有人工整理結果。

## 維護資料時的基本檢查

更動 `data/photo-schema.json`、taxonomy、sample data 或 validation logic 後，請執行：

```bash
pnpm language:check
pnpm shared-values:check
pnpm data:validate
```

更動 JavaScript 後，請至少執行對應的語法檢查：

```bash
node --check scripts/commands/validate-data.mjs
node --check scripts/commands/discover-albums.mjs
node --check scripts/commands/add-photo.mjs
node --check scripts/commands/add-album.mjs
node --check app/main.js
node --check app/data-loader.js
node --check app/controls.js
node --check app/photo-render.js
node --check app/overview-render.js
node --check app/result-render.js
```

依實際更動範圍選擇需要檢查的檔案，不需要每次全部重跑。

新增或修改操作者會直接執行的 CLI command 時，請提供可在無 credential 環境執行的 `--help`，並執行：

```bash
pnpm command:smoke
```

這個檢查只驗證 command help path 與 import-time 基本穩定性；credential、網路、dry-run/write 與遠端整合分類見 `docs/command-smoke-tests.md`。

更動 GitHub Pages 前端時，先讀 `docs/public-frontend-architecture.md` 的模組邊界。若改到搜尋、篩選、排序、URL state、候選清單或 AI 助手提示詞，至少執行：

```bash
pnpm finder:test
pnpm finder:build
pnpm finder:check
```

前端純邏輯應優先放在可測試模組，例如 `app/search-sort.js`、`app/url-state.js`、`app/data-loader.js` 或 `app/result-render.js`。DOM control 行為放在 `app/controls.js`，照片卡片 DOM 與 action 放在 `app/photo-render.js`。`app/main.js` 應維持 bootstrap、state、URL state、資料載入順序、事件 wiring 與 render loop 組合，避免再把 domain logic 或大型 DOM render 寫回主檔。

## 文件優先順序

新 agent 接手時，最少必讀：

1. `README.md`
2. `docs/README.md`
3. `AGENTS.md`
4. `docs/project-architecture.md`

再依任務擴展閱讀：

- 資料庫與協作：`docs/database-collaboration-strategy.md`、`docs/google-sheets-database-design.md`
- 相簿匯入與同步：`docs/sheets-sync-workflow.md`
- 外部 AI 或 metadata 輔助：先依任務判斷讀者角色；模型初標以 run 目錄的 `ai-labeling-prompt.md` 與 `docs/ai-labeling-contract.md` 為主，操作者流程再讀 `docs/ai-labeling-operator-guide.md`，品質評估再讀 `docs/ai-labeling-evaluation-notes.md`，公開資料取用再讀 `docs/ai-readable-dataset.md`
- Apps Script：`docs/apps-script-maintenance-design.md`
- 共用值治理：`docs/shared-value-governance.md`
- 人工填寫欄位：`docs/data-entry-guide.md`、`docs/photo-fields-reference.md`
- 產品背景與 MVP 取捨：`docs/photo-finder-mvp.md`、`docs/mvp-implementation-plan.md`

如果文件互相矛盾，以 Google Sheets-first 架構為準，並優先修正文件矛盾。

## 文件入口品質

新增或調整文件時，先確認第一次接手專案的人能看懂入口段落：

- 若文件第一次使用正式 Sheets、本機工作快取、intake run、AI run、attempt、prompt review 決策包、dry-run/write 等專案術語，必須在同段或前段定義，或明確導回 `docs/README.md` 的共同語言。
- 流程圖不能先於術語與生命週期脈絡出現。若圖只描述子流程，標題與前文要說明它是整體資料生命週期中的哪一段。
- 文件開頭應說明讀者、範圍、上游輸入與下游輸出；不要讓讀者靠低階指令名稱猜測目前位於 Flickr、Sheets、AI run、eval 還是 Pages 流程。
- 高變動的指令清單與目前狀態回到 `docs/README.md`；穩定架構與責任邊界才留在各設計文件。
