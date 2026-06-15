# Troubleshooting Guide

這份文件是維護者遇到事故時的分流入口。它不取代各 runbook；目標是讓操作者先判斷壞在哪一層，再進入正確文件或命令。

處理任何故障前，先分清楚三件事：

- 公開讀取是否正常。
- 寫入或部署權限是否正常。
- 資料格式是否符合 repo schema / taxonomy。

不要把 credential、token、私人 Sheet 連結或組織內部權限細節貼到 issue、PR 或 repo 文件中。需要 credential 時，只記錄需要的能力、環境變數名稱與驗證方式。

## Pages artifact 缺檔或檢查失敗

### 症狀

- `pnpm finder:check` 顯示 `Pages artifact directory not found`。
- GitHub Pages artifact 缺少 `index.html`、config、static finder data 或必要 assets。
- artifact 檢查指出包含 credential-like file / content。

### 可能原因

- 尚未執行 `pnpm finder:build`，或 output directory 不是 `tmp/pages`。
- build-time 讀取公開 Google Sheets CSV 失敗，沒有產生 static-sharded finder data。
- artifact 打包範圍錯誤，把 repo source、credential 類檔案或不該部署的內容放進 `tmp/pages`。

### 檢查命令

```bash
pnpm finder:build
pnpm finder:check
```

若只要確認公開 Sheets CSV 本身可讀，可先用：

```bash
pnpm sheets:check
```

### 修復或升級路徑

- artifact 不存在時，先重跑 `pnpm finder:build`，再跑 `pnpm finder:check`。
- build 階段讀不到公開 CSV 時，先看「Sheets public CSV 或固定 tabs 讀不到」。
- 若正式部署需要緊急 fallback，可依 `docs/public-frontend-architecture.md` 使用 `--data-mode runtime-csv`，但不要在前端加入 credential 或寫入邏輯。
- 若檢查指出 credential-like content，先停止部署，確認 artifact allowlist 與 build output 來源。

相關入口：`docs/public-frontend-architecture.md`、`docs/adr/0002-github-pages-artifact-deploy.md`。

## Finder 顯示使用快取資料

### 症狀

- 公開前端結果狀態出現「離線模式：使用已快取資料」。
- 使用者重新開啟 Finder 時可搜尋照片，但某些尚未打開過的照片 detail 載入失敗。
- 部署後使用者仍短暫看到舊的索引概覽或搜尋結果。

### 可能原因

- 瀏覽器目前離線，或 GitHub Pages / 網路暫時無法讀取新的 static artifact。
- service worker 對 finder-data 使用網路優先策略，網路失敗時退回上一次快取。
- detail shards 只會在使用者實際預覽或複製需要完整欄位時快取；未快取過的 shard 不能離線補抓。

### 修復或升級路徑

- 先確認使用者是否在線上，並重新整理一次頁面。
- 若剛完成部署，先確認 GitHub Pages workflow 的 `pnpm finder:build` 與 `pnpm finder:check` 通過，再請使用者重新載入。
- 若單一瀏覽器持續卡在舊資料，請使用者清除該站台的瀏覽器資料或在 DevTools > Application unregister service worker 後重新開啟。
- 不要為了消除快取狀態而在公開前端加入 Google API credential、Sheets 寫入能力或 Apps Script Web App 授權串接。

相關入口：`docs/public-frontend-architecture.md` 的「PWA 快取邊界」。

## Sheets public CSV 或固定 tabs 讀不到

### 症狀

- `pnpm sheets:check` 無法讀取固定 tabs。
- Pages build-time CSV 讀取失敗。
- 前端顯示「資料載入失敗」或提示確認資料來源與公開讀取權限。

### 可能原因

- `config/project.json` 的 spreadsheet ID 不符合目標正式表。
- 正式 Sheets 沒有公開可讀，或固定 tabs 不存在。
- tab header 與 `data/photo-schema.json` 定義不一致。
- 網路或 Google Sheets public CSV export 暫時無法讀取。

### 檢查命令

```bash
pnpm sheets:check
```

若需要本機工作快取，且執行環境有 `GOOGLE_APPLICATION_CREDENTIALS` 與讀取權限：

```bash
pnpm sheets:export
```

### 修復或升級路徑

- `sheets:check` 是公開讀取檢查，不代表寫入權限；不要把公開讀不到解讀成 service account 無編輯權。
- 若固定 tab 缺少或 header 不符，先回到 `docs/sheets-sync-workflow.md` 判斷是初始化、header 遷移，還是人工改壞。
- 若 `sheets:export` 失敗但 `sheets:check` 通過，優先檢查 `GOOGLE_APPLICATION_CREDENTIALS`、credential scope 與 service account 是否有目標 Sheet 讀取權限。
- 若只是公開 CSV export 延遲，避免立刻改 schema 或前端；稍後重跑檢查並保留實際錯誤訊息。

相關入口：`docs/sheets-sync-workflow.md`、`docs/google-sheets-database-design.md`。

## Apps Script sidebar 讀不到目前列

### 症狀

- sidebar 顯示 `Authorization is required to perform that action`。
- sidebar 無法載入目前選取列，或沒有跳出授權 prompt。
- 開啟 sidebar 後欄位表單、縮圖或列號不符合目前 Sheet 狀態。

### 可能原因

- 使用者尚未完成 Google 授權。
- Google 多帳號 session 讓 sidebar iframe 使用第一個登入帳號的授權狀態。
- Sheet UI 目前使用的 bound script source 不是 repo 中的目前 source。
- 本機 `.clasp.json` 綁到錯誤 Apps Script 專案，或 push target 錯誤。

### 檢查命令

```bash
pnpm apps-script:status
pnpm apps-script:status -- --target practice
```

若要檢查本機 sidebar 排版而不碰真實 Apps Script：

```bash
pnpm review-panel:preview
```

### 修復或升級路徑

- 先確認使用者用有權限的 Google 帳號完成授權；多帳號時改用單一帳號的瀏覽器 profile 或無痕視窗。
- 確認正式表與練習表 target：正式表用 `pnpm apps-script:push`，練習表必須用 `pnpm apps-script:push -- --target practice`。
- 若錯誤要求 `script.container.ui` scope，確認 `apps-script/appsscript.json` 後重新 push，並在 Sheet 重新授權。
- 若不確定 Sheet UI 對到哪份 Apps Script，從 Sheet 的 `擴充功能` -> `Apps Script` 開啟 bound script，比對 `config/project.json` 的 script ID。

相關入口：`docs/apps-script-maintenance-design.md`。

## taxonomy label 空白

### 症狀

- `taxonomy.label_zh` 整欄空白或部分空白。
- Apps Script sidebar、Sheets 下拉選項或人工檢視只能看到 raw value。
- `pnpm sheets:sync-taxonomy` 寫入後讀回驗證失敗。

### 可能原因

- `taxonomy` tab 停在既有三欄格式 `taxonomy_key,value,order`。
- `data/tag-taxonomy.json` 的 `option_labels` 未同步到 Sheets。
- Apps Script source 或 GeneratedConfig 與 repo 目前 schema/taxonomy 不一致。

### 檢查命令

```bash
pnpm sheets:sync-taxonomy
pnpm apps-script:build-config -- --check
```

### 修復或升級路徑

- 先用 `pnpm sheets:sync-taxonomy` dry-run 確認 header 狀態、既有列數與空白 `label_zh` 數量。
- 人工確認後才執行 `pnpm sheets:sync-taxonomy -- --write`；此命令只重寫 `taxonomy` tab，寫入後會讀回驗證。
- 若 Sheets-side helper 也不同步，重新執行 `pnpm apps-script:push` 或 `pnpm apps-script:push -- --target practice`，再在 Sheet 執行 `更新欄位選項`。
- 不要直接在 Sheets 手動補一套翻譯；顯示文字來源是 `data/tag-taxonomy.json` 的 `option_labels`。

相關入口：`docs/apps-script-maintenance-design.md`、`docs/sheets-sync-workflow.md`、`docs/shared-value-governance.md`。

## AI proposal validation failure

### 症狀

- `pnpm ai:validate -- --run-dir <dir>` 失敗。
- `pnpm ai:review -- --run-dir <dir>` 無法產生 review summary、diff 或 update plan。
- proposal 包含未知 taxonomy value、格式錯誤、禁止 AI 修改的欄位，或試圖把資料標成 `reviewed` / `approved`。

### 可能原因

- 模型未遵守 `docs/ai-labeling-contract.md`。
- 使用的 run 目錄、attempt 或 proposal 檔案不符合 AI run 合約。
- prompt/schema/taxonomy 有調整，但 proposal 仍依先前輸入產生。
- 大型分片流程合併前沒有先做 shard 層級或 root 層級檢查。

### 檢查命令

```bash
pnpm ai:validate -- --run-dir tmp/ai-runs/<run-id>
pnpm ai:review -- --run-dir tmp/ai-runs/<run-id>
```

大型 run 先看狀態：

```bash
pnpm ai:bulk:status -- --run-dir tmp/ai-runs/<run-id>
```

### 修復或升級路徑

- 先修 proposal 或重新產生 proposal，不要改 `photos.json`、Sheets export 或正式 Google Sheets 來配合錯誤輸出。
- 若只是要檢查暫存 proposal，用 `--proposals <path> --output-dir <tmp-dir>`，避免把 review artifacts 寫進正式 run 目錄。
- 若 validator 指出 taxonomy 或 schema 不符，先確認 repo source，再判斷是 proposal 錯誤還是需要另開 schema/taxonomy 切片。
- AI 候選值只可作為人類 review 前的候選，不可把 `curation_status` 直接推成 `reviewed`。

相關入口：`docs/ai-labeling-contract.md`、`docs/ai-labeling-operator-guide.md`。

## stale review summary

### 症狀

- `pnpm ai:bulk:status` 顯示 review summary 是 `stale`。
- `pnpm ai:report -- --runs ...` 標示某個 run 是 `stale review` 或 `review summary 過期`。
- `metadata-review-summary.md` 比 `metadata-proposals.json` 還早，品質比較看起來和實際 proposal 不一致。

### 可能原因

- proposal 更新後沒有重跑 `pnpm ai:review`。
- root proposal 和 shard workspace 狀態不同步。
- 比較多模型或多輪 attempt 時，某些 run 的 review artifacts 仍是先前輸出。

### 檢查命令

```bash
pnpm ai:bulk:status -- --run-dir tmp/ai-runs/<run-id>
pnpm ai:review -- --run-dir tmp/ai-runs/<run-id>
```

比較多個 run 前可重建報表：

```bash
pnpm ai:report -- --runs tmp/ai-runs/<run-a> tmp/ai-runs/<run-b>
```

### 修復或升級路徑

- 先重跑 `pnpm ai:review -- --run-dir <dir>` 讓 summary、diff 與 update plan 對齊目前 proposal。
- 若是大型分片流程，先用 `pnpm ai:bulk:status` 確認 shard photo artifacts、暫存合併 proposal、artifact manifest 與 root proposal 的關係。
- stale review 不應作為品質比較或 Sheets dry-run 的依據。

相關入口：`docs/ai-labeling-operator-guide.md`、`docs/adr/0010-ai-prompt-review-governance.md`。

## clasp target 或本機 binding 錯誤

### 症狀

- `pnpm apps-script:status` 顯示的遠端檔案不是預期專案。
- 正式表或練習表的 Apps Script UI 沒有出現 repo source 的改動。
- `.clasp.json` 指向錯誤 script ID。
- `clasp` 顯示 `User has not enabled the Apps Script API`。

### 可能原因

- 維護者直接沿用本機 `.clasp.json`，而不是讓 wrapper 依 target 產生。
- 把練習表 target 當成正式表，或把正式表 target 推到練習表。
- clasp 登入帳號沒有 Apps Script 專案權限，或尚未啟用 Apps Script API。

### 檢查命令

```bash
pnpm apps-script:status
pnpm apps-script:status -- --target practice
```

### 修復或升級路徑

- 以 `config/project.json` 的 `googleSheets.appsScriptId` 與 `googleSheets.practiceAppsScriptId` 作為 target 來源；本機 `.clasp.json` 只是 wrapper 產生的暫存綁定。
- 正式表推送用 `pnpm apps-script:push`；練習表推送用 `pnpm apps-script:push -- --target practice`。
- 若出現 `User has not enabled the Apps Script API`，到 Apps Script settings 啟用 API，等待幾分鐘後重試。
- 不要用 `clasp create` 作為正式綁定主路徑；從目標 Sheet 開啟 bound script，確認 Script ID 後再推送 repo source。

相關入口：`docs/apps-script-maintenance-design.md`、`docs/sheets-sync-workflow.md`。

## GA4 custom dimensions 未同步或權限不足

### 症狀

- `pnpm analytics:dimensions:check` 顯示 repo 預期的 dimensions 在 GA4 後台缺少。
- `pnpm analytics:dimensions:sync -- --write` 回傳 permission / forbidden。
- GA4 UI 看得到 property，但 CLI 無法建立 custom dimensions。

### 可能原因

- service account 沒有被加入 GA4 property access management。
- service account 只有 `Viewer`，但建立 custom dimensions 需要 `Editor`。
- Google Cloud project 尚未啟用 Google Analytics Admin API。
- 操作者把 GA4 measurement ID 當成 property ID。

### 檢查命令

```bash
pnpm analytics:dimensions:check
```

需要建立缺少 dimensions 時：

```bash
pnpm analytics:dimensions:sync -- --write
```

### 修復或升級路徑

- 先確認 `config/project.json` 的 `frontend.ga4PropertyId`；property ID 不是 `G-` 開頭的 measurement ID。
- 確認 `GOOGLE_APPLICATION_CREDENTIALS` 指向可用 service account credential；不要讀取或貼出 credential 檔案內容。
- permission / forbidden 時，請 GA4 Administrator 檢查 service account 是否在該 property，且角色是 `Editor`。
- GA4 UI 若拒絕 service account email，依 `docs/ga4-operations.md` 的 API Explorer workaround 或改由有權限的人類帳號完成一次性設定。

相關入口：`docs/frontend-analytics-design.md`、`docs/ga4-operations.md`。
