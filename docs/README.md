# 文件入口與狀態

這份文件整理 `docs/` 內文件的閱讀入口、目前狀態與真理來源。若其他文件和本文件的狀態描述不同，應優先回到這裡更新並修正矛盾。

## 真理來源

| 資訊 | 真理來源 | 備註 |
| --- | --- | --- |
| 照片與相簿欄位、欄位順序、reviewed 完整度、approved 使用要求 | `data/photo-schema.json` | 文件可以解釋判斷理由，但不應重複維護欄位清單。 |
| 受控字彙與列舉值 | `data/tag-taxonomy.json` | Apps Script、Sheets 下拉選單與 validation 應從這份資料衍生。 |
| SITCON 2026 CFS 贊助品項 | `data/sponsorship-items.json` | 這是固定版本資料，不自動追遠端更新。 |
| 正式照片索引資料 | Google Sheets `photos` | repo 內 `data/photos.csv` 只是 sample、fixture 與匯出格式參考。 |
| 正式相簿清單資料 | Google Sheets `albums` | repo 內 `data/albums.csv` 只是 sample、fixture 與匯出格式參考。 |
| 專案角色與資料流 | `docs/project-architecture.md` | 若架構改變，先更新架構總覽，再同步相關文件。 |

## 目前狀態

### 目前可用

- 本機 static search UI，預設讀 `data/photos.csv`。
- `npm run validate:data`，檢查 sample/export data、schema 與 taxonomy。
- `npm run albums:discover`，盤點 SITCON Flickr 公開相簿清單並輸出 CSV 預覽。
- `npm run albums:discover -- --write`，更新本機 `data/albums.csv` fixture，方便用相簿 ID 選擇要處理的相簿。
- `npm run photo:add -- <flickr-photo-url>`，從單張 Flickr 照片產生候選列。
- `npm run album:add -- <album-id-or-flickr-album-url>`，檢查或匯入單本相簿到本機 sample。
- schema、taxonomy、sponsorship items 與欄位文件。

### 目標流程，尚未完整實作

- 將已盤點的 SITCON Flickr 相簿清單同步到 Google Sheets `albums`。
- 讓使用者從正式 Google Sheets `albums` 清單選擇本次要處理哪本相簿。
- 將相簿匯入、AI 輔助、驗證結果同步回正式 Google Sheets。
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
