# Apps Script 維護輔助設計

## 目的

這份文件定義 Google Sheets 內 Apps Script 的 MVP 職責。

Apps Script 的定位是授權後的 Sheets 維護輔助，不是另一套資料庫、不是真正的後台，也不應成為和 repo validation 分裂的規則來源。

## 核心原則

- Google Sheets 是正式資料庫。
- Repo schema 與 taxonomy 是規則來源。
- Apps Script 應從 repo 匯出的設定更新欄位驗證、下拉選單與提示。
- Apps Script 可以協助檢查 `photos` 是否能被公開前端與 AI 讀取，但不應建立另一張篩選表。
- Apps Script source 應保存在 repo，並透過 `clasp` 部署到 Google Apps Script。
- Apps Script 不保存 API credential、AI token 或其他 secret。

## MVP 功能

### 校對 sidebar

Apps Script 提供 Sheet-bound sidebar，讓整理者可以用較易讀的畫面校對目前選取的 `photos` 列：

- 顯示縮圖、`photo_id`、相簿脈絡與 Flickr 連結。
- 依 repo schema 產生欄位表單。
- 單值 taxonomy 與 boolean 欄位使用選單。
- 多值 taxonomy 欄位使用可搜尋的多選選單；已選項目會顯示為可移除的標籤，降低手打分號與重複值錯誤；自由多值與文字欄位使用可編輯文字區。
- `photo_id`、`photo_url` 與 `image_preview_url` 在 sidebar 中只讀，避免校對時誤改識別與來源欄位。
- 可用列號載入指定 `photos` 列，也可重新讀取 Sheet 目前選取列。
- 儲存前先驗證目前列；驗證失敗時不寫入 Sheet，錯誤會顯示在 `儲存並驗證` 按鈕附近，並更新 `validation_report`。
- 載入或切換列失敗時，錯誤會顯示在 sidebar 上方列控制區附近；成功載入後不保留暫時狀態訊息。

這個 sidebar 使用使用者既有的 Sheet / Apps Script 權限寫回資料，不需要 GitHub Pages 保存 credential，也不提供公開寫入 API。

sidebar 初始資料由 `Open review panel` 選單函式讀取目前選取列後注入。後續可在 sidebar 內切換列；若使用 Google 多帳號，應確認有權限且已授權的帳號是第一個登入帳號，否則 sidebar iframe 的 `google.script.run` 可能使用未授權帳號而失敗。

### 套用欄位驗證

依照 `data/photo-schema.json` 與 `data/tag-taxonomy.json`：

- 確認 `photos` header 是否符合 schema。
- 對單值受控字彙欄位套用下拉選單，並限制只能選一個值。
- 對單值 boolean 欄位套用 `true` / `false` 下拉選單。
- 對多值欄位提供格式提示，說明使用分號分隔。
- 對多值欄位檢查同一儲存格內不可重複填寫相同值。
- 對 URL、年份、整數、boolean 欄位在選單驗證時提供基本格式檢查。
- 將 `photos` 資料區設為純文字格式，避免 Google Sheets 將 `9:16`、ID、比例或看似日期/時間的值自動轉型。

Apps Script 讀取 `photos` 列時應使用 Sheets 顯示值，而不是原始 typed value。這可避免 `safe_crop` 的 `9:16` 等比例字串被 Sheets / Apps Script 當成時間或日期處理。

### 驗證目前列或整張表

提供選單讓志工檢查：

- 目前選取列。
- `photos` 全表。
- `photos` 公開讀取格式。

錯誤訊息應以人類可理解方式呈現，例如「`scene_tags` 包含未知值：XXX」而不是只顯示程式錯誤。驗證結果會同時顯示在 alert，並寫入 `validation_report` 工作表，方便處理大量錯誤。

### 檢查 reviewed 完整度

Apps Script 應依 `data/photo-schema.json` 的 `reviewed_required_fields` 與 `approved_required_fields` 提醒缺漏欄位。

不要在 Apps Script 中另寫一份永久分歧的規則，也不要在文件中重複維護欄位清單。

### 檢查公開讀取格式

Apps Script 應提供功能檢查 `photos` 是否適合公開前端與 AI 讀取。

MVP 規則：

- header 順序符合 `data/photo-schema.json`。
- 必要欄位存在。
- 受控字彙符合 taxonomy。
- `curation_status`、`public_use_status`、`priority_level` 與 `collections` 保留在同一份 `photos` 資料中。
- 不建立額外的公開篩選表。

### 顯示 schema 狀態

Apps Script 應能顯示目前 Sheets 使用的：

- schema version。
- taxonomy version 或 repo commit。
- sponsorship items version。
- 最近同步時間。
- 同步工具來源。

這些資訊應寫入 `schema_meta`。

## 非目標

MVP Apps Script 不處理：

- 大量 Flickr 相簿掃描。
- 大量 AI 標註。
- 需要 secret 的外部 API 呼叫。
- Sheets API SDK credential 或權限交接。
- 正式審核工作流。
- 複雜的搜尋 UI。

上述工作應由 repo CLI、agent、官方 Google Sheets API SDK 寫入工具、SITCON 既有交接制度或 GitHub Pages 前端處理。正式 repo CLI 寫入身份建議使用 SITCON 管理的 service account；Apps Script 的使用者授權與 `clasp` 部署身份是另一條流程，不應混在一起。

## 部署方式

Apps Script 應透過 `clasp` 進行部署。

這個決策的目的：

- Apps Script source 可以進入 git review。
- Apps Script 版本可以和 repo schema、taxonomy 與文件一起演進。
- 未來 agent 或技術志工可以從 repo 理解目前部署內容，不需要只靠 Google Apps Script 編輯器。
- 部署權限與 Google 帳號授權仍交由 SITCON 既有 Google Drive 與文件管理制度處理，不把 credential 放進 repo。

目前 repo 內已有 MVP Apps Script source：

- `apps-script/Code.js`：Sheets 選單、欄位提示、基本下拉選單、`schema_meta` 同步狀態與資料檢查。
- `apps-script/GeneratedConfig.js`：由 repo schema、taxonomy 與 sponsorship items snapshot metadata 產生，供 Apps Script 使用。不要手動編輯。
- `apps-script/ReviewPanel.html`：Sheet-bound 校對 sidebar UI。
- `apps-script/appsscript.json`：Apps Script manifest。
- `apps-script/.clasp.json.example`：本機 clasp 綁定範例，不是正式 credential。
- `scripts/build-apps-script-config.mjs`：從 `data/photo-schema.json`、`data/tag-taxonomy.json` 與 `data/sponsorship-items.json` 重新產生 `GeneratedConfig.js`。

更新 Apps Script 設定來源時，先執行：

```bash
pnpm apps-script:build-config
```

實際部署應由有 Google Apps Script 權限的維護者使用 `clasp` 操作。若是既有 Apps Script 專案，維護者可以在 `apps-script/` 目錄建立本機 `.clasp.json`，內容可參考 `.clasp.json.example`；這個檔案不應 commit。

此 repo 不把 `@google/clasp` 加進 dependency；標準交接入口是 `pnpm apps-script:*` scripts，內部使用 `pnpm dlx @google/clasp`，避免一般資料工具使用者被迫安裝部署工具，也減少維護者手動輸入重複參數。

`apps-script/` 固定作為 clasp rootDir。正式綁定不由 wrapper 自動建立 Apps Script 專案；維護者應先從目標 Sheet 的 `擴充功能` -> `Apps Script` 打開或建立該 Sheet 的 bound script，再把那份專案的 Script ID 交給 repo wrapper。

常用入口：

```bash
pnpm apps-script:login
pnpm apps-script:bind -- <script-id>
pnpm apps-script:status
pnpm apps-script:push
pnpm apps-script:open
pnpm apps-script:smoke-test -- --check
```

`clasp` status/push/open 需要目前登入的 Google 帳號已啟用 Apps Script API。若出現 `User has not enabled the Apps Script API`，先到 <https://script.google.com/home/usersettings> 啟用，等待幾分鐘後重試。

Apps Script manifest 目前需要以下 scopes：

- `https://www.googleapis.com/auth/spreadsheets.currentonly`：讀寫目前綁定的 spreadsheet。
- `https://www.googleapis.com/auth/script.container.ui`：在 Google Sheets 容器內顯示 sidebar。

### 第一次部署快速流程

接手者第一次把 repo Apps Script 部署到正式 Sheet 時，請照這個順序：

1. 執行 `pnpm apps-script:login`，用有目標 Sheet / Apps Script 權限的 Google 帳號登入 clasp。
2. 到 <https://script.google.com/home/usersettings>，確認同一個 Google 帳號已啟用 Apps Script API。
3. 打開正式 Sheet，從功能列選 `擴充功能` -> `Apps Script`。這一步打開的專案才是 Sheet UI 會使用的 bound script。
4. 在 Apps Script 編輯器的 Project Settings 複製 Script ID。
5. 回 repo 執行 `pnpm apps-script:bind -- <script-id>`，建立本機 `apps-script/.clasp.json`。
6. 執行 `pnpm apps-script:status`，確認 tracked files 是 `appsscript.json`、`Code.js`、`GeneratedConfig.js`、`ReviewPanel.html`。
7. 執行 `pnpm apps-script:push`。
8. 回正式 Sheet 重新整理，確認出現 `SITCON Photo Finder` 選單。

### 綁定 Sheet UI 的 Apps Script 專案

維護者應從正式 Sheet 的 `擴充功能` -> `Apps Script` 打開該 Sheet 綁定的 Apps Script 專案，再到 Apps Script 編輯器的 Project Settings 複製 Script ID，然後產生本機 `.clasp.json`：

```bash
pnpm apps-script:bind -- <script-id>
```

綁定後可用 `pnpm apps-script:status` 檢查連線。若需要用 clasp clone 檢查既有專案，請只在暫存目錄操作，不要讓 clone 覆蓋 repo source；正式 source 以 repo 版本為準。

不要用 clasp create 作為正式綁定的主要路徑。若從 Sheet 功能列 `擴充功能` -> `Apps Script` 打開的是空白專案，仍應複製那份空白專案的 Script ID，使用 `pnpm apps-script:bind -- <script-id>` 後再 push repo source。這樣 Sheet UI 和 repo 推送目標才會是同一份 bound script。

### 推送與驗收

推送入口會先確認 repo schema、taxonomy 與 Apps Script 產生設定一致：

```bash
pnpm apps-script:push
```

`apps-script:push` 會依序執行 `pnpm apps-script:build-config`、`pnpm validate:data` 與 clasp push。如果只想檢查本機與遠端差異，使用 `pnpm apps-script:status`。

推送後到正式或測試 Sheet 重新整理頁面，依序檢查：

1. 選單出現 `SITCON Photo Finder`。
2. 在 `photos` 選一列資料，執行 `Open review panel`。若 Google 要求授權，完成授權後回到 Sheet 重跑一次；成功時 sidebar 應顯示縮圖、Flickr 連結與欄位表單。
3. 在 sidebar 修改一個非識別欄位並儲存，確認合法資料會寫回同一列，且 `validation_report` 更新。
4. 執行 `Refresh schema and taxonomy`，確認 `photos` header 有 note、資料區是純文字格式、單值 taxonomy 欄位與 boolean 欄位有下拉選單，且 `schema_meta` 已建立或更新。
5. 檢查 `schema_meta` 至少有 header row 與一列同步資訊。`schema_version`、`taxonomy_version`、`sponsorship_items_version`、`last_synced_at` 與 `synced_by` 不應空白；`notes` 可依 sponsorship snapshot 狀態填寫或留空。
6. 執行 `Show schema status`，確認看得到 repo generated config 與 `schema_meta` 內容。若 `schema_meta` 空白或缺少必要欄位，應重新執行 `Refresh schema and taxonomy`，不能把空白 sheet 當成成功狀態。
7. 在 `photos` 選一列資料執行 `Validate current row`。正常資料列應通過；可暫時把該列的 URL 欄位改成 `abc`，或把多值欄位改成 `合照;會眾;會眾`，確認會出現中文錯誤，再復原該儲存格。
8. 在 sidebar 測試非法儲存，例如把 `recommended_uses` 改成 `講者宣傳;社群貼文;社群貼文`，確認錯誤顯示在 `儲存並驗證` 按鈕附近，且資料不會寫入 Sheet。
9. 檢查 `safe_crop` 類似 `9:16` 的值在 sidebar 讀取與儲存後仍是文字，不應變成 Date 字串。
10. 檢查 `validation_report` 已更新，內容包含 `checked_at`、`target`、`status`、`row`、`field` 與 `message`。驗證通過時會寫入一列 `passed`；驗證失敗時會逐列列出錯誤。
11. 執行 `Validate photos sheet` 與 `Validate public read format`，確認沒有非預期錯誤。`Validate public read format` 只檢查 `photos` 主表，不建立額外公開篩選表。

`clasp` 是部署工具，不是資料治理來源。Apps Script 的驗證規則仍應來自 repo 中的 schema 與 taxonomy。

### Review panel manual QA checklist

在正式 Sheet 或測試 Sheet 驗收 sidebar 時，建議至少跑以下案例：

1. 以有權限的 Google 帳號作為第一個登入帳號開啟 Sheet，避免多帳號 session 讓 sidebar iframe 使用未授權帳號。
2. 在 `photos` 選一列資料，執行 `Open review panel`，確認縮圖、Flickr 連結、列號與欄位表單正確。
3. 使用 `目前列` 重新讀取選取列，成功後頂部暫時狀態應消失。
4. 輸入不存在或超出範圍的列號後按 `載入`，錯誤應顯示在上方列控制區附近。
5. 在 `recommended_uses` 輸入 `講者宣傳;社群貼文;社群貼文` 後按 `儲存並驗證`，錯誤應顯示在按鈕附近，且該值不應寫入 Sheet。
6. 在 `safe_crop` 使用 `9:16`，重新載入與儲存後都應維持文字，不應顯示成 Date 字串。
7. 儲存合法欄位變更，確認資料寫回同一列，且 `validation_report` 更新為最近一次結果。

## 與 repo validation 的關係

Apps Script 是第一時間提醒；repo validation 是較完整、可版本控管的權威檢查。

若兩者結果不同：

1. 先以 repo validation 為準。
2. 檢查 Apps Script 是否使用舊版 schema 或 taxonomy。
3. 更新 Apps Script 設定來源。
4. 必要時修正 repo validation 或文件。

## 建議選單

Google Sheets 中可提供以下選單：

- `SITCON Photo Finder / Refresh schema and taxonomy`
- `SITCON Photo Finder / Open review panel`
- `SITCON Photo Finder / Validate current row`
- `SITCON Photo Finder / Validate photos sheet`
- `SITCON Photo Finder / Validate public read format`
- `SITCON Photo Finder / Show schema status`

選單文字可以在實作時調整，但功能責任應維持清楚。

驗證選單會覆寫 `validation_report`，只保留最近一次檢查結果。它是維護輔助報表，不是正式資料表，也不應被公開前端或 AI 流程當成資料來源。

### 驗證邊界 smoke test

若需要驗證 Sheet-bound Apps Script 和 repo validation 的基本 parity，可用 repo 指令追加一組明確標記的錯誤列。預設為 dry-run，必須加上 `--write` 才會修改正式 Sheet：

```bash
pnpm apps-script:smoke-test -- --append
pnpm apps-script:smoke-test -- --append --write
pnpm apps-script:smoke-test -- --check
```

這組測試列會使用 `__apps_script_validation_test_manual_` 開頭的 `photo_id`，並在 `curation_notes` 標記 `APP_SCRIPT_VALIDATION_SMOKE_TEST_DELETE_ME`。追加後在 Sheet 執行 `Validate photos sheet`，`validation_report` 應看到多值重複、未知 taxonomy、單值 taxonomy 錯誤、boolean 錯誤、URL 錯誤、`reviewed` 缺欄位與 `approved` 缺欄位。

測完後刪除測試列：

```bash
pnpm apps-script:smoke-test -- --delete
pnpm apps-script:smoke-test -- --delete --write
pnpm apps-script:smoke-test -- --check
```

若曾用不同 `--run-id` 產生測試列，可用同一個 `--run-id` 清理；若要列出或刪除所有 smoke-test 列，可搭配 `--all`。刪除前仍會先列出將處理的列，且一樣需要 `--write` 才會修改 Sheet。

## 失敗處理

Apps Script 遇到以下狀況時應停止並提醒：

- `photos` header 與 schema 不一致。
- 缺少必要工作表。
- `schema_meta` 同步資訊空白。
- `photos` 公開讀取格式缺少必要欄位。

不要在欄位不明確時自動猜測或重排資料。

### 常見部署與執行錯誤

若 `Refresh schema and taxonomy` 執行後 `schema_meta` 是整張空白，這不是成功狀態。重新推送最新版 Apps Script 後再執行 refresh；目前 source 會在寫入後讀回檢查，若必要欄位仍空白應直接報錯。

若 sidebar 顯示 `Authorization is required to perform that action`，或顯示需要授權但沒有自動跳出 prompt，先確認使用者已完成 Google 授權。若已授權仍出現同樣錯誤，通常是 Google 多帳號 session 讓 sidebar iframe 使用第一個登入帳號的授權狀態；若第一個登入帳號不是有權限並已授權的帳號，就會在 sidebar 內呼叫 `google.script.run` 時失敗。請改用有權限的 Google 帳號作為第一個登入帳號，或用單一帳號的瀏覽器 profile / 無痕視窗重開 Sheet。

若出現 `User has not enabled the Apps Script API`，代表 clasp 登入帳號尚未啟用 Apps Script API。到 <https://script.google.com/home/usersettings> 啟用後，等待幾分鐘再重試 `pnpm apps-script:push`。

若出現 `指定的權限不足，無法呼叫 Ui.showSidebar` 或要求 `https://www.googleapis.com/auth/script.container.ui`，代表部署的 manifest 缺少 sidebar UI scope。請確認 `apps-script/appsscript.json` 包含 `script.container.ui`，重新執行 `pnpm apps-script:push`，並在 Sheet 重新授權。

若錯誤訊息要求目前 manifest 未列出的 scope，通常代表 Sheet UI 使用的 bound script 仍是舊版 source，或本機 `.clasp.json` 綁到錯誤的 Apps Script 專案。請確認已重新執行 `pnpm apps-script:push`，且 Sheet UI 開啟的是同一份 bound script。
