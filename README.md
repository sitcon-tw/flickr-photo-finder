# SITCON Flickr Photo Finder

SITCON Flickr Photo Finder 是 SITCON Flickr 之上的照片索引與搜尋工具，用來協助籌備團隊用真實工作需求找照片，例如社群宣傳、網站視覺、贊助提案、贊助成果報告、新聞稿、志工招募與活動回顧。

這個專案不取代 Flickr、不保存原圖，也不把 repo 當成正式照片資料庫。正式照片索引資料在 Google Sheets；這個 repo 保存 schema、受控字彙、驗證規則、匯入工具、公開搜尋前端、Apps Script source 規劃與 AI/agent 維護脈絡。

## 目前狀態

目前 repo 已有本機搜尋 UI、資料驗證、SITCON Flickr 相簿盤點、單張照片與單本相簿候選匯入工具。正式 Google Sheets 同步、Apps Script source 與 `clasp` deploy、GitHub Pages artifact deploy、AI metadata diff 工作流仍是目標流程。

完整「目前可用 / 尚未實作」狀態以 `docs/README.md` 為準，README 只保留快速入口。

## 資料權威

- Google Sheets `photos` 是正式照片索引資料庫。
- Google Sheets `albums` 是正式相簿清單與處理狀態資料。
- `photos` 主表本身就是公開照片索引；公開 CSV/JSON 只是同欄位匯出，不是額外篩選表。
- `data/photos.csv` 和 `data/albums.csv` 只是 MVP 測試資料與匯出格式參考。
- `data/photo-schema.json` 是照片與相簿欄位順序、欄位 metadata、reviewed 完整度與 approved 使用要求的機器可讀來源。
- `data/tag-taxonomy.json` 是受控字彙來源。
- `data/sponsorship-items.json` 是 SITCON 2026 CFS 贊助品項固定版本資料，不會自動追遠端更新。

若 Google Sheets 正式資料和 repo 內測試資料不一致，以 Google Sheets 為準。若 Sheets 欄位或驗證規則和 repo schema 不一致，以 repo schema 為準，並更新 Sheets 或 Apps Script。

## 你可能想做的事

| 情境 | 入口 |
| --- | --- |
| 第一次理解專案 | `docs/project-architecture.md`、`docs/photo-finder-mvp.md` |
| 看目前已實作與尚未實作項目 | `docs/README.md` |
| 本機打開搜尋 UI | `pnpm dev` |
| 檢查本機測試資料和 schema 是否一致 | `pnpm validate:data` |
| 盤點 SITCON Flickr 相簿 | `pnpm albums:discover` |
| 從已盤點相簿檢查缺少照片 | `pnpm album:add -- <album-id>` |
| 整理照片欄位 | `docs/data-entry-guide.md`、`docs/photo-fields-reference.md` |
| 維護 Google Sheets 或同步流程 | `docs/google-sheets-database-design.md`、`docs/sheets-sync-workflow.md` |
| 維護公開前端 | `docs/public-frontend-architecture.md`、`app/config.js` |
| 維護 Apps Script | `docs/apps-script-maintenance-design.md` |
| 讓 AI 或 agent 讀資料 | `docs/ai-readable-dataset.md`、`docs/agent-maintenance-guide.md` |

## 本機操作

需要 Node.js 與 pnpm。目前已知可用 Node.js 版本為 `v24.15.0`，目前沒有額外 runtime dependency。

這個 repo 只使用 pnpm 作為套件管理工具。請不要使用 npm 或 yarn，避免不同 git worktree 平行開發時產生不一致的 lockfile 或安裝行為。`package.json` 的 `packageManager` 與 `preinstall` 會檢查這個限制。

驗證資料：

```bash
pnpm validate:data
```

啟動搜尋介面：

```bash
pnpm dev
```

開啟 `http://localhost:4173/`。本機搜尋 UI 預設讀取 repo 內測試資料，不是正式 Google Sheets 資料。

盤點 SITCON Flickr 公開相簿清單：

```bash
pnpm albums:discover
```

確認輸出後，可寫入本機 `data/albums.csv` 測試資料，方便後續用相簿 ID 選擇要處理的相簿：

```bash
pnpm albums:discover -- --write
```

檢查單本相簿中哪些照片尚未存在於本機 `data/photos.csv`：

```bash
pnpm album:add -- ALBUM_ID
```

匯入該相簿中尚未索引的照片到本機測試資料：

```bash
pnpm album:add -- ALBUM_ID --append
```

從單張 Flickr 照片 URL 產生候選資料列：

```bash
pnpm photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID
```

寫入本機 `data/photos.csv`：

```bash
pnpm photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID --append
```

`--append` 只會修改本機測試資料。正式流程仍應把確認後的資料同步回 Google Sheets。

## 資料流

```text
SITCON Flickr 相簿清單
  -> repo 工具盤點相簿
  -> 使用者選擇本次要處理的相簿
  -> repo 工具掃描選定相簿並產生候選資料
  -> Google Sheets photos 主表
  -> Apps Script 驗證與提示
  -> GitHub Pages 與外部 AI 讀取 photos 或同欄位公開匯出
```

GitHub Pages 只提供唯讀搜尋，不寫入資料庫。Apps Script 是 Sheets 內的維護輔助與驗證工具，應透過 `clasp` deploy。AI 與 agent 可以讀取公開照片索引、schema、taxonomy 與文件，協助找圖或產生可審核的 metadata diff。

## 資料填寫原則

- 多值欄位用分號分隔，例如 `攤位;會眾;交流`。
- `scene_tags` 描述照片裡看到什麼。
- `sponsorship_items` 描述對應哪個贊助品項，必須對齊 `data/sponsorship-items.json`。
- `sponsorship_tags` 描述能支援哪種贊助價值。
- `people_count` 是照片中可辨識的人數估計值，可留空；無人可填 `0`。
- 不確定是否可公開使用時，`public_use_status` 請填 `needs_review`。
- 不要把敏感資訊寫進公開欄位。`curation_notes` 是公開整理備註。

更多填寫規則請看 `docs/data-entry-guide.md`。

## 主要檔案

| 路徑 | 用途 |
| --- | --- |
| `app/` | 本機與 GitHub Pages 的唯讀搜尋前端。 |
| `data/photo-schema.json` | 照片與相簿欄位 schema。 |
| `data/tag-taxonomy.json` | 受控字彙與列舉值。 |
| `data/sponsorship-items.json` | SITCON 2026 CFS 贊助品項固定版本資料。 |
| `data/photos.csv` | 本機照片測試資料，不是正式資料。 |
| `data/albums.csv` | 本機相簿測試資料，不是正式資料。 |
| `scripts/validate-data.mjs` | 資料驗證。 |
| `scripts/discover-albums.mjs` | SITCON Flickr 相簿盤點。 |
| `scripts/add-album.mjs` | 單本相簿檢查與本機匯入。 |
| `scripts/add-photo.mjs` | 單張照片候選資料列產生與本機匯入。 |
| `docs/README.md` | 文件入口、目前狀態與真理來源。 |
| `AGENTS.md` | agent 協作規則。 |

## 進一步閱讀

- `docs/project-architecture.md`: 專案使用流程、資料流與部署架構。
- `docs/photo-finder-mvp.md`: MVP 產品判斷與欄位取捨脈絡。
- `docs/data-entry-guide.md`: 照片索引填寫指南。
- `docs/photo-fields-reference.md`: 欄位速查。
- `docs/google-sheets-database-design.md`: 正式 Google Sheets 資料庫設計。
- `docs/sheets-sync-workflow.md`: Sheets 與 repo 工具同步流程。
- `docs/public-frontend-architecture.md`: GitHub Pages 唯讀前端資料流。
- `docs/apps-script-maintenance-design.md`: Apps Script 維護輔助設計。
- `docs/ai-readable-dataset.md`: 外部 AI 與唯讀工具如何解讀照片索引資料。
- `docs/agent-maintenance-guide.md`: agent 與技術志工維護指南。
