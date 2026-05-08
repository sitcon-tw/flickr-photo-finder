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
| Sheets 表格讀寫技術選擇 | `docs/sheets-sync-workflow.md` | repo CLI 應以官方 Google Sheets API SDK 為主要方向；rclone 只適合 Drive 檔案搬運或備份。 |
| 正式照片索引資料 | Google Sheets `photos` | repo 內 `data/photos.csv` 只是 sample、fixture 與匯出格式參考。 |
| 正式相簿清單資料 | Google Sheets `albums` | repo 內 `data/albums.csv` 只是 sample、fixture 與匯出格式參考。 |
| 正式匯入批次資料 | Google Sheets `import_batches` | repo 內 `data/import-batches.csv` 只是 sample、fixture 與匯出格式參考。 |
| 專案角色與資料流 | `docs/project-architecture.md` | 若架構改變，先更新架構總覽，再同步相關文件。 |

## 目前狀態

### 目前可用

- 本機 static search UI，預設讀 `data/photos.csv`。
- `pnpm validate:data`，檢查 sample/export data、schema 與 taxonomy。
- `pnpm sheets:init`，產生建立 Google Sheets MVP 所需的初始 CSV。
- `pnpm sheets:check`，只讀檢查公開 Google Sheets 固定 tabs 的 header 與初始化覆蓋風險。
- `pnpm albums:discover`，盤點 SITCON Flickr 公開相簿清單並輸出 CSV 預覽。
- `pnpm albums:discover -- --write`，更新本機 `data/albums.csv` fixture，方便用相簿 ID 選擇要處理的相簿。
- `pnpm albums:sync -- --sheets-export <csv> --output <csv>`，合併 Sheets 匯出與盤點結果，產生可回寫 Google Sheets `albums` 的 CSV。
- `pnpm intake:run -- --album <album-id> --photos-export <csv>`，從選定相簿產生一次可審核的 intake run artifact，包含候選 `photos`、更新後 `albums`、`import_batches` 與 `summary.json`。
- `pnpm intake:validate -- --run-dir <dir>`，套用到 Google Sheets 前檢查 intake run artifact 是否完整一致。
- `pnpm photos:import -- --album <album-id> --photos-export <csv> --output <csv>`，低階工具；從選定相簿產生可追加到 Google Sheets `photos` 的候選照片 CSV，並可同步產生 `albums` 更新與 `import_batches` 批次紀錄。
- `pnpm photo:add -- <flickr-photo-url>`，從單張 Flickr 照片產生候選列。
- `pnpm album:add -- <album-id-or-flickr-album-url>`，檢查或匯入單本相簿到本機 sample。
- schema、taxonomy、sponsorship items 與欄位文件。

### 目標流程，尚未完整實作

- 以官方 Google Sheets API SDK 實作 preflight、dry-run、confirmed write 與寫入後驗證。
- 將可回寫的 `albums` CSV 或等價資料實際寫回 Google Sheets。
- 讓使用者從正式 Google Sheets `albums` 清單選擇本次要處理哪本相簿。
- 將已審核的 intake run artifact、AI 輔助與驗證結果自動同步回正式 Google Sheets。
- Apps Script source 進 repo，並透過 `clasp` deploy。
- GitHub Pages 透過 GitHub Actions artifact deploy，資料來源改讀 Google Sheets `photos` 或同欄位公開匯出。
- AI metadata diff 工作流。

## 依角色閱讀

| 角色 | 建議閱讀 |
| --- | --- |
| 第一次理解專案的人 | `README.md`、`docs/project-architecture.md`、`docs/photo-finder-mvp.md` |
| 整理照片的志工 | `docs/data-entry-guide.md`、`docs/photo-fields-reference.md` |
| 技術志工 | `docs/project-architecture.md`、`docs/sheets-sync-workflow.md`、`docs/google-sheets-database-design.md` |
| 維護 Apps Script 的人 | `docs/apps-script-maintenance-design.md`、`data/photo-schema.json`、`data/tag-taxonomy.json` |
| 維護 GitHub Pages 前端的人 | `docs/public-frontend-architecture.md`、`app/config.js` |
| AI / agent | `AGENTS.md`、`docs/agent-maintenance-guide.md`、`docs/ai-readable-dataset.md` |

## 文件分工

- `photo-finder-mvp.md`: 產品判斷與欄位取捨脈絡。
- `mvp-implementation-plan.md`: MVP 實作方向與驗證方式。
- `project-architecture.md`: 端到端架構與資料流。
- `google-sheets-database-design.md`: Google Sheets 表格設計。
- `sheets-sync-workflow.md`: Sheets 與 repo 工具同步流程。
- `apps-script-maintenance-design.md`: Apps Script 維護輔助與 `clasp` 部署原則。
- `public-frontend-architecture.md`: GitHub Pages 唯讀前端資料流。
- `ai-readable-dataset.md`: AI 如何讀取照片索引資料。
- `data-entry-guide.md`: 人工整理照片資料的判斷流程。
- `photo-fields-reference.md`: 欄位速查；欄位清單仍以 `data/photo-schema.json` 為準。
- `database-collaboration-strategy.md`: Sheets-first 協作、公開資料邊界與未來遷移判斷。
- `agent-maintenance-guide.md`: agent 與技術志工維護注意事項。
