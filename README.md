# SITCON Flickr Photo Finder

SITCON Flickr Photo Finder 是 SITCON Flickr 之上的照片索引與搜尋工具，用來協助籌備團隊用真實工作需求找照片，例如社群宣傳、網站視覺、贊助提案、贊助成果報告、新聞稿、志工招募與活動回顧。

這個專案不取代 Flickr、不保存原圖，也不把 repo 當成正式照片資料庫。正式照片索引資料在 Google Sheets；這個 repo 保存專案設定、schema、受控字彙、驗證規則、匯入工具、公開搜尋前端、Apps Script source 規劃與 AI/agent 維護脈絡。

## 目前狀態

目前 repo 已有本機搜尋 UI、資料驗證、SITCON Flickr 相簿盤點、可回寫 Google Sheets `albums` 的同步 CSV 產生工具，以及可從選定相簿產生一次 intake run artifact 的工具。run artifact 會包含 Google Sheets `photos` 候選列、`albums.last_processed_at` 更新、`import_batches` 批次紀錄與摘要。正式 Google Sheets 表格讀寫的主要技術選擇改為官方 Google Sheets API SDK；Apps Script source 與 `clasp` deploy、GitHub Pages artifact deploy、AI metadata diff 工作流仍是目標流程。

完整「目前可用 / 尚未實作」狀態以 `docs/README.md` 為準，README 只保留快速入口。

## 資料權威

- Google Sheets `photos` 是正式照片索引資料庫。
- Google Sheets `albums` 是正式相簿清單與處理狀態資料。
- Google Sheets `import_batches` 是正式匯入批次紀錄資料。
- `photos` 主表本身就是公開照片索引；公開 CSV/JSON 只是同欄位匯出，不是額外篩選表。
- `data/photos.csv`、`data/albums.csv` 和 `data/import-batches.csv` 只是 MVP 測試資料與匯出格式參考。
- `data/photo-schema.json` 是照片、相簿與匯入批次欄位順序、欄位 metadata、reviewed 完整度與 approved 使用要求的機器可讀來源。
- `data/tag-taxonomy.json` 是受控字彙來源。
- `data/sponsorship-items.json` 是 SITCON 2026 CFS 贊助品項固定版本資料，不會自動追遠端更新。
- `config/project.json` 是組織名稱、Flickr 帳號路徑、Flickr 連結與前端標題等專案設定來源。
- `config/project.json` 也保存公開 Google Sheets 的 `spreadsheetId`。正式 tabs 固定使用 `photos`、`albums`、`import_batches`、`taxonomy`、`sponsorship_items`。

若 Google Sheets 正式資料和 repo 內測試資料不一致，以 Google Sheets 為準。若 Sheets 欄位或驗證規則和 repo schema 不一致，以 repo schema 為準，並更新 Sheets 或 Apps Script。

## 你可能想做的事

| 情境 | 入口 |
| --- | --- |
| 第一次理解專案 | `docs/project-architecture.md`、`docs/photo-finder-mvp.md` |
| 看目前已實作與尚未實作項目 | `docs/README.md` |
| 本機打開搜尋 UI | `pnpm dev` |
| 檢查本機測試資料和 schema 是否一致 | `pnpm validate:data` |
| 產生 Google Sheets MVP 初始化 CSV | `pnpm sheets:init` |
| 檢查公開 Google Sheets 初始化覆蓋風險 | `pnpm sheets:check` |
| 透過官方 SDK 套用初始化 CSV | `pnpm sheets:apply-init` |
| 盤點 SITCON Flickr 相簿 | `pnpm albums:discover` |
| 產生可回寫 Google Sheets `albums` 的 CSV | `pnpm albums:sync -- --sheets-export <csv> --output <csv>` |
| 從已選相簿產生一組可檢查後套用的匯入產物 | `pnpm intake:run -- --album <album-id> --photos-export <csv>` |
| 檢查匯入產物是否完整一致 | `pnpm intake:validate -- --run-dir <dir>` |
| 透過官方 SDK 套用匯入產物 | `pnpm sheets:apply-intake -- --run-dir <dir>` |
| 從已選相簿產生可追加到 `photos` 的候選 CSV | `pnpm photos:import -- --album <album-id> --photos-export <csv> --output <csv>` |
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

產生 Google Sheets MVP 初始化檔案：

```bash
pnpm sheets:init
```

這會輸出到 `tmp/sheets-init/`，包含 `photos.csv`、`albums.csv`、`import_batches.csv`、`taxonomy.csv`、`sponsorship_items.csv` 與 `manifest.json`。這個指令不會連線或寫入 Google Sheets；正式套用請使用 `pnpm sheets:apply-init`。

如果 `config/project.json` 已填入 `googleSheets.spreadsheetId`，可以檢查正式 Sheets 是否已有覆蓋風險：

```bash
pnpm sheets:check
```

這個指令只讀取公開 Google Sheets CSV export，不會寫入資料。它會檢查固定 tab 是否能讀取、header 是否符合預期，以及 tab 是否已經有資料。

確認沒有覆蓋風險後，正式 Sheets 寫入流程應由 repo CLI 透過官方 Google Sheets API SDK 執行，並保留 preflight、dry-run、人類確認與寫入後驗證。這個 repo 不自製 Google Drive 檔案搬運流程；若未來需要 Drive 檔案備份或搬運，再交由組織既有工具處理。

正式寫入建議使用 SITCON 管理的 service account 作為 repo CLI 寫入身份，並把該 service account email 加到正式 Google Sheets 的編輯者。個人 OAuth / ADC 可作為臨時本機操作，但不應作為正式交接方案。完整前置需求見 `docs/sheets-sync-workflow.md` 的「建議的正式寫入身份」。

若已設定 Google Application Default Credentials，例如 `GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`，並且授權身份對目標 Sheets 有編輯權限，可以先 dry-run 檢查初始化套用計畫：

```bash
pnpm sheets:apply-init
```

確認輸出顯示沒有覆蓋風險後，才加上 `--write` 寫入：

```bash
pnpm sheets:apply-init -- --write
```

這個指令會建立缺少的固定 tabs，並把 `tmp/sheets-init/` 中的 CSV 寫入對應 tab。若任何既有 tab 已有資料或 header 不符合預期，工具會拒絕寫入。

盤點 `config/project.json` 指定的 Flickr 帳號公開相簿清單：

```bash
pnpm albums:discover
```

確認輸出後，可寫入本機 `data/albums.csv` 測試資料，方便後續用相簿 ID 選擇要處理的相簿：

```bash
pnpm albums:discover -- --write
```

若已有 Google Sheets `albums` 匯出的 CSV，可以和目前盤點結果合併，產生可回寫 Google Sheets 的 CSV：

```bash
pnpm albums:sync -- --sheets-export /path/to/sheets-albums.csv --output /tmp/albums-to-import.csv
```

若是第一次建立 `albums` 工作表，還沒有 Sheets 匯出檔，可以省略 `--sheets-export`：

```bash
pnpm albums:sync -- --output /tmp/albums-to-import.csv
```

從已盤點或已同步的相簿選一本，產生可追加到 Google Sheets `photos` 的候選照片 CSV：

```bash
pnpm intake:run -- --album ALBUM_ID --photos-export /path/to/sheets-photos.csv
```

這會建立一個 `tmp/intake-runs/<run-id>/` 目錄，內含：

```text
photos-to-append.csv
albums-updated.csv
import-batch.csv
summary.json
```

這組檔案是一次處理相簿的可審核產物。正式寫回 Sheets 前，應先檢查 `summary.json`、候選照片列與相簿更新內容。

套用到 Google Sheets 前，先檢查整包產物是否完整一致：

```bash
pnpm intake:validate -- --run-dir tmp/intake-runs/RUN_ID
```

若已設定 Google Application Default Credentials，並且授權身份對目標 Sheets 有編輯權限，可以 dry-run 檢查這包匯入產物會如何套用：

```bash
pnpm sheets:apply-intake -- --run-dir tmp/intake-runs/RUN_ID
```

確認沒有重複 `photo_id`、重複 `batch_id` 或找不到相簿列等阻擋問題後，才加上 `--write`：

```bash
pnpm sheets:apply-intake -- --run-dir tmp/intake-runs/RUN_ID --write
```

這個指令只會把新照片追加到 `photos`、把一列追加到 `import_batches`，並只更新 `albums` 中該相簿的 `last_processed_at` 欄位；它不會用 `albums-updated.csv` 覆蓋整張 `albums` 表。

若只需要低階輸出，也可以直接指定每個輸出檔：

```bash
pnpm photos:import -- --album ALBUM_ID --photos-export /path/to/sheets-photos.csv --output /tmp/photos-to-append.csv --albums-output /tmp/albums-updated.csv --batch-output /tmp/import-batch.csv
```

如果使用的是本機測試資料，可省略 `--photos-export`，預設會用 `data/photos.csv` 做重複檢查。輸出檔只包含缺少的照片列，正式寫回前仍應由人類確認。

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
| `config/project.json` | 專案組織名稱、Flickr 帳號與前端顯示設定。 |
| `data/photo-schema.json` | 照片、相簿與匯入批次欄位 schema。 |
| `data/tag-taxonomy.json` | 受控字彙與列舉值。 |
| `data/sponsorship-items.json` | SITCON 2026 CFS 贊助品項固定版本資料。 |
| `data/photos.csv` | 本機照片測試資料，不是正式資料。 |
| `data/albums.csv` | 本機相簿測試資料，不是正式資料。 |
| `data/import-batches.csv` | 本機匯入批次測試資料，不是正式資料。 |
| `scripts/check-sheets.mjs` | 只讀檢查公開 Google Sheets 初始化覆蓋風險。 |
| `scripts/apply-sheets-init.mjs` | 透過官方 Google Sheets API SDK 套用初始化 CSV，預設 dry-run，`--write` 才寫入。 |
| `scripts/init-sheets.mjs` | 產生 Google Sheets MVP 初始化 CSV。 |
| `scripts/validate-data.mjs` | 資料驗證。 |
| `scripts/discover-albums.mjs` | SITCON Flickr 相簿盤點。 |
| `scripts/sync-albums.mjs` | 合併 Sheets 匯出與盤點結果，產生可回寫 `albums` 的 CSV。 |
| `scripts/run-intake.mjs` | 從選定相簿產生一次 intake run artifact，包裝候選照片、相簿更新、批次紀錄與摘要。 |
| `scripts/validate-intake-run.mjs` | 套用到 Sheets 前檢查 intake run artifact 是否完整一致。 |
| `scripts/apply-intake-run.mjs` | 透過官方 Google Sheets API SDK 套用已審核 intake run artifact，預設 dry-run。 |
| `scripts/import-album-photos.mjs` | 從相簿產生可追加到 `photos` 的候選照片 CSV、更新後 `albums` CSV 與 `import_batches` CSV。 |
| `scripts/flickr-album-photos.mjs` | Flickr 相簿照片 URL 解析共用工具。 |
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
