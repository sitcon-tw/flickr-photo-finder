# 維運交接清單

這份清單給接手 SITCON Flickr Photo Finder 維運的人使用。它只列出本專案需要確認的資產、權限能力與驗證方式，不保存 credential、token、OAuth cache、私人連結或組織內部權限細節，也不取代 SITCON 既有 Google Drive 與帳號交接流程。

交接時請把以下三件事分開確認：

- 可公開讀取：公開前端、外部 AI 或匿名 CSV 能否讀到正式資料。
- 可寫入或部署：repo CLI、Apps Script、GA4 後台或 GitHub Actions 是否有相應權限。
- 資料格式正確：Sheets、schema、taxonomy、Apps Script generated config 與 Pages artifact 是否一致。

## 必要資產與權限

| 項目 | 接手者需要確認 | repo 內的固定入口 | 驗證方式 |
| --- | --- | --- | --- |
| GitHub repo | 能讀取 repo，且若需發布文件或工具變更，具備 push 或 PR 權限。 | `config/project.json` 的 `repository.url` | `git status --short --branch`；需要發布時確認 GitHub Actions 有權執行。 |
| GitHub Pages | Pages source 應是 GitHub Actions artifact，不是整個 repo root。 | `docs/public-frontend-architecture.md`、`.github/workflows/` | `pnpm finder:build`、`pnpm finder:check`；push 後確認 Actions / Pages deployment。 |
| 正式 Google Sheets | 知道正式表位置，且需要人工維護時具備 Sheets 編輯權。 | `config/project.json` 的 `googleSheets.spreadsheetId` | `pnpm sheets:check` 驗證公開讀取；人工用 Google Sheets UI 確認編輯權。 |
| 固定練習表 | 知道練習表位置，且維護者能重置練習資料。 | `config/project.json` 的 `googleSheets.practiceSpreadsheetId` | `pnpm sheets:onboarding:check`；需要重置時先跑 `pnpm sheets:practice:sync` dry-run。 |
| Sheets SDK service account | SITCON 管理的 service account email 已加入正式表；需要重置練習表時也要加入練習表。 | `docs/sheets-sync-workflow.md` | 在執行環境設定 `GOOGLE_APPLICATION_CREDENTIALS` 後跑 `pnpm sheets:export`。 |
| Apps Script 正式 target | 正式表的 Sheet-bound Apps Script ID 已記錄，且 clasp 登入帳號有該 script 權限。 | `config/project.json` 的 `googleSheets.appsScriptId` | `pnpm apps-script:status`；部署前確認同帳號已啟用 Apps Script API。 |
| Apps Script 練習 target | 練習表的 Sheet-bound Apps Script ID 已記錄，且 target 需明確指定。 | `config/project.json` 的 `googleSheets.practiceAppsScriptId` | `pnpm apps-script:status -- --target practice`。 |
| GA4 前端 measurement | Pages 前端使用的 measurement ID 已設定。 | `config/project.json` 的 `frontend.ga4MeasurementId` | 手動用 GA4 Realtime / DebugView 驗證事件；調整事件前讀 `docs/frontend-analytics-design.md`。 |
| GA4 property / Admin API | GA4 property ID 已設定；service account 或操作者具備管理 custom dimensions 的權限。 | `config/project.json` 的 `frontend.ga4PropertyId`、`config/ga4-custom-dimensions.json` | 設定 `GOOGLE_APPLICATION_CREDENTIALS` 後跑 `pnpm analytics:dimensions:check`。 |
| AI / external model access | 本 repo 不保存 AI API key；AI 標記只產生候選 metadata。 | `docs/ai-labeling-operator-guide.md`、`docs/ai-labeling-contract.md` | 以既有或 sample run 跑 `pnpm ai:validate` / `pnpm ai:review`；不要把模型輸出直接當 reviewed。 |

## 環境變數

| 變數 | 用途 | 交接注意事項 |
| --- | --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | 指向 service account credential 檔案，供 Sheets SDK 與 GA4 Admin API CLI 使用。 | 只在執行環境設定；不要把路徑、檔案內容或 key 放進 repo、`tmp/`、issue 或 PR。 |
| `GA4_PROPERTY_ID` | 臨時覆寫 `config/project.json` 的 `frontend.ga4PropertyId`。 | 日常應使用 repo 預設 property ID；只有臨時操作其他 property 時才設定。 |

## 接手驗證順序

第一次接手時，建議照以下順序建立信心。沒有對應 credential 時，就停在不需要權限的檢查，並把缺少的能力回報給專案 owner 或 SITCON 既有交接窗口。

1. 確認 repo 與文件入口：

```bash
git status --short --branch
pnpm language:check
```

2. 確認公開 Sheets 讀取與 Pages artifact：

```bash
pnpm sheets:check
pnpm finder:build
pnpm finder:check
```

3. 確認 service account 可讀正式 Sheets：

```bash
printenv GOOGLE_APPLICATION_CREDENTIALS
pnpm sheets:export
pnpm sheets:onboarding:check
```

4. 確認 Apps Script target 正確：

```bash
pnpm apps-script:status
pnpm apps-script:status -- --target practice
```

5. 確認 GA4 後台與 repo 設定一致：

```bash
pnpm analytics:dimensions:check
```

6. 若需要檢查整體本機健康度，再跑：

```bash
pnpm project:check
```

## 寫入與部署前檢查

任何會寫入正式服務或部署到使用者可見環境的操作，都應先完成 dry-run 或唯讀檢查。

| 操作 | 先做 | 確認後才做 | 注意事項 |
| --- | --- | --- | --- |
| 初始化或遷移正式 Sheets | `pnpm sheets:apply-init`、`pnpm sheets:migrate-headers` | 加上 `--write` | 寫入後工具應讀回驗證；不要用手動貼 CSV 當標準流程。 |
| 套用 intake run | `pnpm intake:validate -- --run-dir <dir>`、`pnpm sheets:apply-intake -- --run-dir <dir>` | `pnpm sheets:apply-intake -- --run-dir <dir> --write` | 先確認候選照片、相簿更新與 batch artifact。 |
| 套用 AI 候選 metadata | `pnpm ai:validate`、`pnpm ai:review`、`pnpm sheets:apply-ai-updates -- --run-dir <dir>` | `pnpm sheets:apply-ai-updates -- --run-dir <dir> --write` | AI 候選值不等於人工 reviewed；若 summary stale，先重跑 review。 |
| 重置固定練習表 | `pnpm sheets:practice:sync` | `pnpm sheets:practice:sync -- --write` | 工具應拒絕把正式表當成練習表；若防護失效，先修工具。 |
| 同步 taxonomy | `pnpm sheets:sync-taxonomy` | `pnpm sheets:sync-taxonomy -- --write` | 寫入後 `label_zh` 不應空白；不要手動維護另一套翻譯。 |
| 推送 Apps Script | `pnpm apps-script:status` | `pnpm apps-script:push` 或 `pnpm apps-script:push -- --target practice` | 正式表是預設 target；練習表必須明確指定。 |
| 同步 GA4 custom dimensions | `pnpm analytics:dimensions:check` | `pnpm analytics:dimensions:sync -- --write` | 只建立缺少的低基數 dimensions；不註冊 `search_term`、`photo_id` 等高基數參數。 |
| 部署 Pages | `pnpm finder:build`、`pnpm finder:check` | push / merge 後由 GitHub Actions 部署 artifact | artifact 不應包含 credential-like file 或 repo root。 |

## 權限缺口處理

若接手者缺少某項權限，請回報「缺少哪一種能力」，不要回報或要求貼 credential 內容。

- 無法讀公開 Sheets：回報正式表公開讀取、spreadsheet ID、固定 tabs 或 public CSV 是否可用。
- 無法用 SDK 讀寫 Sheets：回報 `GOOGLE_APPLICATION_CREDENTIALS` 是否有設定、service account 是否已加入目標 Sheet、錯誤是 scope 還是 permission。
- 無法 push Apps Script：回報 clasp 登入帳號、Apps Script API settings、正式或練習 target、Script ID 綁定。
- 無法同步 GA4：回報 property ID、service account 是否在 GA4 Property Access Management、角色是否為 `Editor`。
- 無法部署 Pages：回報 GitHub Actions / Pages 設定與 `pnpm finder:build`、`pnpm finder:check` 的輸出。

若症狀已經發生，先看 `docs/troubleshooting.md`。若是交接前要確認有哪些權限與資產，使用本清單。
