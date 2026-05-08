# SITCON Flickr Photo Finder

這個 repo 用來建立 SITCON Flickr 照片索引，協助籌備團隊用實際工作情境找照片，例如社群宣傳、網站視覺、贊助提案、贊助成果報告、新聞稿、志工招募與活動回顧。

這裡不取代 Flickr，也不保存原圖。正式照片索引資料以 Google Sheets 維護；這個 repo 保存 schema、受控字彙、驗證規則、匯入工具、AI/agent 維護脈絡、GitHub Pages 公開檢索前端原始碼與 sample/export 格式。

目前的資料流方向：

```text
SITCON Flickr 相簿清單
  -> repo 工具盤點相簿
  -> 使用者選擇本次要處理的相簿
  -> repo 工具掃描選定相簿並產生候選資料
  -> Google Sheets photos 主表
  -> Apps Script 驗證與提示
  -> GitHub Pages 與外部 AI 讀取 photos 或同欄位公開匯出
```

## 快速開始

目前不需要安裝額外套件。需要 Node.js，已知可用版本為 `v24.15.0`。

驗證資料：

```bash
npm run validate:data
```

盤點 SITCON Flickr 公開相簿清單：

```bash
npm run albums:discover
```

寫入本機 `data/albums.csv` 作為 sample/export fixture，方便後續用相簿 ID 選擇要處理的相簿：

```bash
npm run albums:discover -- --write
```

啟動搜尋介面：

```bash
npm run dev
```

開啟 `http://localhost:4173/`。

相簿匯入後，可以在搜尋介面用「整理狀態」篩選 `unreviewed`，逐步補齊場景、氛圍、用途、贊助品項、授權與公開使用判斷。這個本機介面預設讀取 repo 內 sample/export data；部署到 GitHub Pages 時可透過 `app/config.js` 改讀 Google Sheets `photos` 的公開 CSV/JSON。

從 Flickr 照片 URL 產生一列 CSV：

```bash
npm run photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID
```

也可以一次處理多張：

```bash
npm run photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID https://www.flickr.com/photos/sitcon/PHOTO_ID_2
```

確認輸出後可以寫入本機 `data/photos.csv` 做 sample/export 測試：

```bash
npm run photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID --append
```

寫入後請補齊人工判斷欄位，再跑：

```bash
npm run validate:data
```

`--append` 寫入後會自動跑一次資料驗證；補齊人工欄位後仍建議再跑一次。

正式流程應由工具盤點 SITCON Flickr 相簿清單，再讓使用者選擇本次要處理哪一本。現有低階工具仍可用相簿 URL 檢查特定相簿有哪些照片尚未匯入：

```bash
npm run album:add -- https://www.flickr.com/photos/sitcon/albums/ALBUM_ID/
```

若已先用 `npm run albums:discover -- --write` 更新本機相簿 fixture，也可以直接用相簿 ID：

```bash
npm run album:add -- ALBUM_ID
```

匯入該相簿中尚未索引的照片：

```bash
npm run album:add -- https://www.flickr.com/photos/sitcon/albums/ALBUM_ID/ --append
npm run album:add -- ALBUM_ID --append
```

## 主要檔案

- `data/photos.csv`: MVP sample、local fixture 與 Sheets 匯出格式參考，不是正式資料來源。
- `data/albums.csv`: SITCON Flickr 相簿清單的本機 sample/export fixture，不是正式資料來源。
- `data/photo-schema.json`: Google Sheets、CSV 匯出、Apps Script 與 CLI 共用的欄位 schema。
- `data/tag-taxonomy.json`: 受控標籤與列舉值欄位。
- `data/sponsorship-items.json`: SITCON 2026 CFS 贊助品項固定版本資料。
- `app/`: GitHub Pages / 本機照片搜尋介面。
- `app/config.js`: 公開前端資料來源設定。
- `scripts/discover-albums.mjs`: 盤點 SITCON Flickr 公開相簿清單，可輸出或更新本機 `data/albums.csv` fixture。
- `scripts/add-album.mjs`: 低階相簿匯入工具；目前可用已盤點相簿 ID 或 Flickr 相簿 URL 檢查或匯入照片。
- `scripts/add-photo.mjs`: 從 Flickr URL 產生或寫入 CSV 資料列。
- `scripts/serve.mjs`: 本機靜態 server。
- `scripts/validate-data.mjs`: 檢查資料格式與標籤字典一致性。
- `docs/agent-maintenance-guide.md`: agent 與技術志工維護指南。
- `docs/ai-readable-dataset.md`: 外部 AI 與唯讀工具如何解讀照片索引資料。
- `docs/apps-script-maintenance-design.md`: Google Sheets Apps Script 維護輔助設計。
- `docs/data-entry-guide.md`: 照片索引填寫指南。
- `docs/database-collaboration-strategy.md`: 資料庫與志工協作維護策略。
- `docs/google-sheets-database-design.md`: 正式 Google Sheets 資料庫表格設計。
- `docs/README.md`: 文件入口、目前狀態與真理來源。
- `docs/photo-fields-reference.md`: Google Sheets 與 CSV 匯出欄位速查表。
- `docs/photo-finder-mvp.md`: MVP 產品判斷紀錄。
- `docs/project-architecture.md`: 專案使用流程、資料流與部署架構總覽。
- `docs/mvp-implementation-plan.md`: MVP 實作計畫。
- `docs/public-frontend-architecture.md`: GitHub Pages 公開唯讀前端資料流。
- `docs/sheets-sync-workflow.md`: Sheets 與 repo 工具同步流程。
- `AGENTS.md`: agent 協作規則。

## 架構總覽

完整使用流程與架構圖請看 `docs/project-architecture.md`。
目前已實作與規劃中的功能狀態請看 `docs/README.md`。

重點原則：

- Google Sheets `photos` 是正式照片索引資料庫，也是公開可讀的索引主表。
- 相簿處理應以 SITCON Flickr 既有相簿清單為入口，使用者只需選擇本次要處理哪一本。
- GitHub Pages 只提供唯讀搜尋，不寫入資料庫。
- Apps Script 用於 Sheets 內的維護輔助與驗證，source 應保存在 repo，並透過 `clasp` 部署。
- AI 與 agent 應讀取照片索引、schema、taxonomy 與文件，協助找圖或產生可審核的 metadata diff。

## 資料填寫原則

- Google Sheets 是正式照片索引資料庫；repo 內 `data/photos.csv` 只是 sample、fixture 與匯出格式參考。
- `photos` 主表本身就是公開照片索引；公開 CSV/JSON 只是同欄位匯出，不是額外篩選表。
- 多值欄位用分號分隔，例如 `攤位;會眾;交流`。
- `sponsorship_items` 必須對齊 `data/sponsorship-items.json` 的 CFS 品項。
- `scene_tags` 描述照片裡看到什麼。
- `sponsorship_items` 描述對應哪個贊助品項。
- `sponsorship_tags` 描述能支援哪種贊助價值。
- 不確定是否可公開使用時，`public_use_status` 請填 `needs_review`。

更多規則請看 `docs/data-entry-guide.md`。

## 2026 CFS 固定版本資料

`data/sponsorship-items.json` 是 SITCON 2026 贊助徵求資料的固定版本資料。2026 年會已結束，不需要自動同步這份資料。

未來年度若有新的 CFS，應明確建立新的版本資料，視情況取代或延伸目前版本。
