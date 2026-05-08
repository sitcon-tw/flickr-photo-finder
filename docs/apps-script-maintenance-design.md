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

### 套用欄位驗證

依照 `data/photo-schema.json` 與 `data/tag-taxonomy.json`：

- 確認 `photos` header 是否符合 schema。
- 對受控字彙欄位套用下拉選單。
- 對單值欄位限制只能選一個值。
- 對多值欄位提供格式提示，說明使用分號分隔。
- 對 URL、年份、boolean 欄位提供基本格式提醒。

### 驗證目前列或整張表

提供選單讓志工檢查：

- 目前選取列。
- `photos` 全表。
- `photos` 公開讀取格式。

錯誤訊息應以人類可理解方式呈現，例如「`scene_tags` 包含未知值：XXX」而不是只顯示程式錯誤。

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

這些資訊應寫入 `schema_meta`。

## 非目標

MVP Apps Script 不處理：

- 大量 Flickr 相簿掃描。
- 大量 AI 標註。
- 需要 secret 的外部 API 呼叫。
- 權限交接。
- 正式審核工作流。
- 複雜的搜尋 UI。

上述工作應由 repo CLI、agent、Google Drive/SITCON 既有交接制度或 GitHub Pages 前端處理。

## 部署方式

Apps Script 應透過 `clasp` 進行部署。

這個決策的目的：

- Apps Script source 可以進入 git review。
- Apps Script 版本可以和 repo schema、taxonomy 與文件一起演進。
- 未來 agent 或技術志工可以從 repo 理解目前部署內容，不需要只靠 Google Apps Script 編輯器。
- 部署權限與 Google 帳號授權仍交由 SITCON 既有 Google Drive 與文件管理制度處理，不把 credential 放進 repo。

建議未來實作時：

- Apps Script source 放在 repo 內明確目錄，例如 `apps-script/`。
- `clasp` 設定只保存可公開的 script metadata；不提交個人 credential 或 token。
- 部署前先確認 repo schema、taxonomy 與 Apps Script 使用的設定一致。
- 部署後更新 `schema_meta` 或相關文件中的版本資訊。

`clasp` 是部署工具，不是資料治理來源。Apps Script 的驗證規則仍應來自 repo 中的 schema 與 taxonomy。

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
- `SITCON Photo Finder / Validate current row`
- `SITCON Photo Finder / Validate photos sheet`
- `SITCON Photo Finder / Validate public read format`
- `SITCON Photo Finder / Show schema status`

選單文字可以在實作時調整，但功能責任應維持清楚。

## 失敗處理

Apps Script 遇到以下狀況時應停止並提醒：

- `photos` header 與 schema 不一致。
- 缺少必要工作表。
- taxonomy 中找不到欄位需要的受控字彙。
- `schema_meta` 顯示版本過舊。
- `photos` 公開讀取格式缺少必要欄位。

不要在欄位不明確時自動猜測或重排資料。
