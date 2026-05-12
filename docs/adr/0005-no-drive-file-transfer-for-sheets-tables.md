# ADR 0005: 不用 Drive file transfer 表達 Sheets table semantics

## 狀態

Accepted

## 背景

這個 repo 要維護的是 Google Sheets 裡的固定表格語意：`photos`、`albums`、`import_batches`、`taxonomy`、`sponsorship_items` 以及相關 header、欄位順序、dry-run、寫入後驗證與覆蓋風險檢查。

Google Drive API 適合管理檔案，但把 CSV 或試算表檔案搬入 Drive 並不等於正確操作 Sheets tab、range、append、batch update 或 header migration。若用 Drive file transfer 表達 Sheets table semantics，工具很難準確檢查會寫到哪張 tab、是否覆蓋既有資料、header 是否相容，以及寫入後是否符合 repo schema。

## 決策

repo CLI 讀寫 Google Sheets table semantics 時，以官方 Google Sheets API SDK 為主要方向：

- 讀取固定 tab、range、header 與列資料。
- 以 dry-run 描述會建立、更新或拒絕的 tab 與 range。
- 寫入前檢查覆蓋風險、header 相容性與目標 spreadsheet。
- 寫入後讀回驗證 header、列數或更新結果。
- Google Drive file transfer 不作為 Sheets table 寫入主流程。

Drive 或瀏覽器 UI 仍可用於人工建立、分享或管理 spreadsheet 這類資產操作；它不承擔 repo 工具的表格語意。

## 取捨

優點：

- 工具能明確描述與驗證 tab、range、append、batch update 與 header migration。
- dry-run 與 write 行為可以一致，降低正式 Sheets 被覆蓋的風險。
- service account 權限、讀回驗證與錯誤訊息能對準 Sheets 操作本身。
- 文件能清楚區分 Google Drive 資產權限和 Google Sheets 表格資料語意。

代價：

- 需要維護 Google Sheets SDK client、credential wiring 與 service account 操作文件。
- 一次性人工匯入 CSV 看似比 SDK 工具快，但較難保證可重跑與可檢查。
- 需要對每個寫入工具實作 dry-run、write 與 read-back verification。

## 替代方案

- 用 Drive API 匯入或替換 CSV / spreadsheet 檔案：檔案層操作簡單，但無法可靠表達 tab-level semantics。
- 要求維護者手動貼 CSV 到 Sheets：可作緊急人工處理，但不適合作為可交接 workflow。
- Apps Script 執行全部寫入：適合 Sheets-side 輔助，但不適合大量 intake、AI apply 與 repo-driven validation。

## 維護邊界

寫入工具可以持續改善，但仍需保留 tab-level dry-run、write 與 read-back verification：

- Google Sheets API 限制使目前 SDK 工具無法可靠操作需要的資料量。
- SITCON 組織提供更正式的資料同步平台，能同等表達 tab、range、schema 與驗證語意。

## 相關文件

- `docs/sheets-sync-workflow.md`
- `docs/google-sheets-database-design.md`
- `docs/project-architecture.md`
- `scripts/lib/sheets/google-sheets-client.mjs`
