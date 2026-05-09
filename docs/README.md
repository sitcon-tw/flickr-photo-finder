# 文件入口與狀態

這份文件整理 `docs/` 內文件的閱讀入口、目前狀態與真理來源。若其他文件和本文件的狀態描述不同，應優先回到這裡更新並修正矛盾。

## 真理來源

| 資訊 | 真理來源 | 備註 |
| --- | --- | --- |
| 照片、相簿與匯入批次欄位、欄位順序、reviewed 完整度、approved 使用要求 | `data/photo-schema.json` | 文件可以解釋判斷理由，但不應重複維護欄位清單。 |
| 受控字彙與列舉值 | `data/tag-taxonomy.json` | Apps Script、Sheets 下拉選單與 validation 應從這份資料衍生。 |
| SITCON 2026 CFS 贊助品項 | `data/sponsorship-items.json` | 這是固定版本資料，不自動追遠端更新。 |
| 組織名稱、Flickr 帳號與前端標題 | `config/project.json` | SITCON 是此 repo 的預設實例；其他組織 fork 時應先改這份設定。 |
| 公開 Google Sheets ID | `config/project.json` 的 `googleSheets.spreadsheetId` | 這份 Sheets 預期可公開讀取；寫入權限由 Google Drive/Sheets 管理。 |
| 前端使用行為分析設計 | `docs/frontend-analytics-design.md` | 導入 GA4 或分析前，先確認目前前端狀態、事件邊界、隱私限制與後續分析流程。 |
| GA4 後台操作與 service account 權限 | `docs/ga4-operations.md` | 管理 GA4 權限、service account 加入 property、custom dimensions 與 BigQuery 延後策略。 |
| GA4 custom dimensions 註冊清單 | `config/ga4-custom-dimensions.json` | 低基數 event-scoped custom dimensions 的 repo source of truth；不要加入 `photo_id`、`content_id`、`search_term`、`result_rank`。 |
| Sheets 表格讀寫技術選擇 | `docs/sheets-sync-workflow.md` | repo CLI 應以官方 Google Sheets API SDK 為主要方向；Google Drive 檔案搬運不是 Sheets 寫入主流程。 |
| Sheets 正式寫入身份 | `docs/sheets-sync-workflow.md` | 建議使用 SITCON 管理的 service account，並將 service account email 加入正式 Sheets 編輯者。 |
| AI 初標輸入與輸出格式 | `docs/ai-labeling-contract.md` | 定義 `tmp/ai-runs/<run-id>/` 的輸入檔、圖片來源、`metadata-proposals.json` 格式與驗證流程。 |
| AI 初標操作與 prompt | `docs/ai-labeling-operator-guide.md`、`prompts/ai-labeling.md` | 操作指南說明 prepare-to-review、報表檢視與回寫前檢查流程；prompt 是可交給模型使用的任務範本。 |
| AI 初標品質評估 | `docs/ai-labeling-evaluation-notes.md` | 記錄模型 run 觀察、常見失準欄位與未來可工具化的檢查方向。 |
| AI proposal 範例 | `fixtures/ai-proposals/` | valid/invalid examples 應由 `pnpm ai:validate-fixtures` 驗證。 |
| AI 初標 review 後續交接提示 | `scripts/review-ai-run.mjs` | CLI `Next:` 與 `metadata-review-summary.md` 的 `## Next Commands` 應和目前報表、比較、dry-run 流程同步。 |
| 正式照片索引資料 | Google Sheets `photos` | repo 內 `fixtures/photos.csv` 只是 sample、fixture 與匯出格式參考。 |
| 正式相簿清單資料 | Google Sheets `albums` | repo 內 `fixtures/albums.csv` 只是 sample、fixture 與匯出格式參考。 |
| 正式匯入批次資料 | Google Sheets `import_batches` | repo 內 `fixtures/import-batches.csv` 只是 sample、fixture 與匯出格式參考。 |
| 本機 Sheets 工作快取 | `tmp/sheets-export/*.csv` | 從正式 Google Sheets 匯出，供 validation 與 intake 使用；可刪除，不 commit。 |
| 專案角色與資料流 | `docs/project-architecture.md` | 若架構改變，先更新架構總覽，再同步相關文件。 |

## 目前狀態

### 目前可用

- `pnpm workflow`，先說明完整資料流，再依階段引導常見工作流程，包含相簿匯入、AI prepare/attempt/review/report/search、Sheets 維護與 Pages artifact build/check，作為新接觸者與日常操作的主要入口。相簿匯入會在產生 intake run 後記住 run 目錄，並可直接接續 validation 與 Sheets dry-run。
- 本機 static search UI，預設讀 `fixtures/photos.csv`。
- `pnpm validate:data`，檢查 sample/export data、schema 與 taxonomy。
- `pnpm sheets:init`，產生建立 Google Sheets MVP 所需的初始 CSV。
- `pnpm sheets:check`，只讀檢查公開 Google Sheets 固定 tabs 的 header 與初始化覆蓋風險。
- `pnpm sheets:apply-init`，透過官方 Google Sheets API SDK dry-run 初始化套用計畫；加上 `--write` 才會建立缺少 tabs 並寫入初始化資料。
- `pnpm sheets:migrate-headers`，透過官方 Google Sheets API SDK dry-run 安全 header 遷移；加上 `--write` 才會插入 repo schema 新增的缺少欄位。
- `pnpm sheets:export`，透過官方 Google Sheets API SDK 匯出正式 Sheets 固定 tabs，供 validation 與 intake 流程使用。
- `pnpm albums:list`，從正式 Sheets 匯出的 `albums.csv` 或 `--source sheets` 直接讀取正式 `albums` 工作表列出與篩選相簿，並可輸出 album id、JSON 或可直接執行的 intake 指令。
- `pnpm albums:select`，從正式 Sheets 匯出的 `albums.csv` 或 `--source sheets` 直接讀取正式 `albums` 工作表互動式選擇單本相簿，並輸出 album id、JSON 或可直接執行的 intake 指令。
- `pnpm pages:build` / `pnpm pages:check`，產生並檢查 GitHub Pages artifact 到 `tmp/pages/`，部署版資料來源會讀公開 Google Sheets `photos` CSV。
- `pnpm apps-script:build-config`，從 repo schema、taxonomy 與 sponsorship items snapshot metadata 產生 Apps Script 使用的 `apps-script/GeneratedConfig.js`。
- `pnpm apps-script:bind`、`pnpm apps-script:status`、`pnpm apps-script:push`，包裝常用 clasp 綁定與推送流程。正式綁定應使用從目標 Sheet `擴充功能` -> `Apps Script` 開啟的專案 Script ID；第一次部署順序見 `docs/apps-script-maintenance-design.md`。
- `pnpm albums:discover`，盤點 SITCON Flickr 公開相簿清單並輸出 CSV 預覽。
- `pnpm albums:discover -- --write`，更新本機 `fixtures/albums.csv` fixture，供 demo、除錯或 fixture validation 使用。
- `pnpm albums:sync -- --sheets-export <csv> --output <csv>`，合併 Sheets 匯出與盤點結果，產生可回寫 Google Sheets `albums` 的 CSV。
- `pnpm intake:run -- --album <album-id>`，從選定相簿產生一次可審核的 intake run artifact，包含候選 `photos`、更新後 `albums`、`import_batches` 與 `summary.json`，並輸出 `Intake run directory:` 供 workflow 或人工接續使用。預設讀 `tmp/sheets-export/albums.csv` 與 `tmp/sheets-export/photos.csv`。
- `pnpm intake:validate -- --run-dir <dir>`，套用到 Google Sheets 前檢查 intake run artifact 是否完整一致。
- `pnpm sheets:apply-intake -- --run-dir <dir>`，透過官方 Google Sheets API SDK dry-run 已審核 intake run artifact；加上 `--write` 才會追加照片、更新該相簿 `last_processed_at` 並追加批次紀錄。
- `pnpm ai:prepare`，從正式 Sheets 匯出的 `photos.csv` 選出待初標照片，建立本機 `tmp/ai-runs/` 工作目錄與可供 AI 讀圖的輸入檔；預設下載 1024px 圖片，也可指定 `preview`、640、800 或 `original`。
- `pnpm ai:attempt -- --from <dir> --model <name> --round <number>`，從既有 AI run 建立可重複使用同一輸入的模型/輪次 attempt，圖片預設以 symlink 或 hardlink 共用。
- `pnpm ai:review -- --run-dir <dir>`，檢查 AI 候選 `metadata-proposals.json`，並一次產生 `metadata-review-summary.md`、`metadata-diff.md`、`metadata-update-plan.json` 與 CSV。
- `pnpm ai:validate -- --run-dir <dir>`，只檢查 AI 候選 `metadata-proposals.json` 是否符合 schema、taxonomy 與人工 review 邊界。
- `pnpm ai:validate-fixtures`，檢查 AI proposal valid/invalid 範例是否仍符合目前 validator 邊界。
- `pnpm ai:diff -- --run-dir <dir>`，只將已驗證的 AI 候選 metadata 轉成 `metadata-diff.md`，供人類審核，不寫入 Sheets。
- `pnpm ai:plan -- --run-dir <dir>`，只將已驗證的 AI 候選 metadata 轉成 `metadata-update-plan.json` 與 CSV，作為後續 dry-run 更新工具輸入，不寫入 Sheets。
- `pnpm ai:report -- --run <dir>` 或 `pnpm ai:report -- --runs <dir> <dir>`，產生單次檢視或多模型/多輪比較用的 AI 初標唯讀靜態 HTML 報表。
- `pnpm search:experimental -- --run-dir <dir>`，在 proposal 寫回前離線比較 taxonomy-only baseline 與 taxonomy + `visual_description` 的搜尋排序差異，用來驗證描述欄位是否有實際找圖增益。
- `pnpm sheets:apply-ai-updates -- --run-dir <dir>`，對 AI metadata 更新計畫執行 Sheets dry-run；加上 `--write` 才會更新 cells，且會檢查 current value 避免覆蓋人工變更。
- AI 初標候選 metadata 已可經由 `ai:prepare`、`ai:attempt`、`ai:review`、`ai:report`、必要時的 `search:experimental`、人工檢查與 `sheets:apply-ai-updates` dry-run/write 寫回 `photos` 主表；這只是候選 metadata 回寫，不代表照片已人工 review。
- `pnpm photos:import -- --album <album-id> --output <csv>`，低階工具；從選定相簿產生可追加到 Google Sheets `photos` 的候選照片 CSV，並可同步產生 `albums` 更新與 `import_batches` 批次紀錄。
- `pnpm photo:add -- <flickr-photo-url>`，從單張 Flickr 照片產生候選列。
- `pnpm album:add -- <album-id-or-flickr-album-url>`，檢查或匯入單本相簿到本機 sample。
- schema、taxonomy、sponsorship items 與欄位文件。

### 目前可用但仍待改善

- Apps Script source 已進 repo，MVP 維護選單已可部署使用；可在 Sheets 內提供校對 sidebar、欄位提示、單值下拉選單、`photos` 純文字格式防護、`schema_meta`、`validation_report` 與基本驗證。sidebar 會先驗證再寫入，儲存錯誤顯示在按鈕附近；載入錯誤顯示在列控制區附近。`schema_meta` 應有同步資訊，不應是空白工作表。實際 `clasp` 綁定、push 與 deploy 仍需由有權限的維護者操作。
- GitHub Pages workflow 已可產生並部署 artifact；repository Pages 來源已設定為 GitHub Actions。後續前端變更應用 `pnpm workflow -- --task pages-build` 與 GitHub Actions 部署紀錄驗證。
- 前端已加入 GA4 基礎追蹤與照片卡片操作事件；後續調整事件或分析流程前，先依 `docs/frontend-analytics-design.md` 重新確認程式碼現況與事件設計。
- GA4 後台 service account 權限與 custom dimensions 操作應依 `docs/ga4-operations.md` 執行；custom dimensions 清單由 `config/ga4-custom-dimensions.json` 管理，可用 `pnpm ga4:dimensions:check` dry-run 檢查，BigQuery export 暫不自動化。
- 更順手的多人 review 操作仍應在 Google Sheets 與後續 Apps Script 輔助中完善；AI 候選值寫入不等於 `curation_status = reviewed`。

## 依角色閱讀

| 角色 | 建議閱讀 |
| --- | --- |
| 第一次理解專案的人 | `README.md`、`docs/project-architecture.md`、`docs/photo-finder-mvp.md` |
| 整理照片的志工 | `docs/data-entry-guide.md`、`docs/photo-fields-reference.md` |
| 技術志工 | `pnpm workflow`、`docs/project-architecture.md`、`docs/sheets-sync-workflow.md`、`docs/google-sheets-database-design.md` |
| 維護 Apps Script 的人 | `docs/apps-script-maintenance-design.md`、`data/photo-schema.json`、`data/tag-taxonomy.json` |
| 維護 GitHub Pages 前端的人 | `docs/public-frontend-architecture.md`、`docs/frontend-analytics-design.md`、`docs/ga4-operations.md`、`app/config.js` |
| AI / agent | `AGENTS.md`、`docs/agent-maintenance-guide.md`、`docs/ai-labeling-operator-guide.md`、`docs/ai-labeling-contract.md`、`docs/ai-labeling-evaluation-notes.md`、`docs/ai-readable-dataset.md` |

## 文件分工

- `photo-finder-mvp.md`: 產品判斷與欄位取捨脈絡。
- `mvp-implementation-plan.md`: MVP 實作方向與驗證方式。
- `project-architecture.md`: 端到端架構與資料流。
- `google-sheets-database-design.md`: Google Sheets 表格設計。
- `sheets-sync-workflow.md`: Sheets 與 repo 工具同步流程。
- `apps-script-maintenance-design.md`: Apps Script 維護輔助與 `clasp` 部署原則。
- `public-frontend-architecture.md`: GitHub Pages 唯讀前端資料流。
- `frontend-analytics-design.md`: 前端使用行為分析目的、GA4 事件設計、實作前檢查與後續分析流程。
- `ga4-operations.md`: GA4 後台操作、service account 權限、custom dimensions 與 BigQuery 延後策略。
- `ai-readable-dataset.md`: AI 如何讀取照片索引資料。
- `ai-labeling-operator-guide.md`: AI 初標操作者與 agent 的 prepare-to-review、報表檢視與回寫前檢查指南。
- `ai-labeling-contract.md`: AI 初標工作包的輸入、輸出、限制與驗證合約。
- `ai-labeling-evaluation-notes.md`: AI 初標品質評估紀錄、常見失準欄位與工具化警訊候選。
- `data-entry-guide.md`: 人工整理照片資料的判斷流程。
- `photo-fields-reference.md`: 欄位速查；欄位清單仍以 `data/photo-schema.json` 為準。
- `database-collaboration-strategy.md`: Sheets-first 協作、公開資料邊界與未來遷移判斷。
- `agent-maintenance-guide.md`: agent 與技術志工維護注意事項。
