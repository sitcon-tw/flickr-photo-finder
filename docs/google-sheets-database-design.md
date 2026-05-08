# Google Sheets 資料庫設計

## 目的

這份文件定義 SITCON Flickr Photo Finder 的正式 Google Sheets 資料庫結構。

此專案的正式照片資料不放在 repo 內。repo 負責保存 schema、taxonomy、驗證規則、匯入工具、同步流程、Apps Script 來源與 AI/agent 維護文件；Google Sheets 則是志工實際共同維護照片索引的資料庫。

## 核心決策

- 資料權威與 repo fixture 關係以 `docs/README.md` 的真理來源表為準。
- `data/photo-schema.json` 是 `photos`、`albums`、`import_batches` 欄位順序、欄位 metadata 與基本完整度規則的機器可讀來源。
- `data/tag-taxonomy.json` 是受控字彙與列舉值來源。
- `data/sponsorship-items.json` 是 SITCON 2026 CFS 贊助品項固定版本資料。
- `photos` 主表本身就是公開照片索引。資料庫的目標是為照片加註 metadata，方便人類、前端與 AI 挑選，而不是另外做一層篩選資料表。
- 資料語意必須存在欄位值，不依賴顏色、註解、篩選、排序或合併儲存格。

## 建議工作表

以下列出正式 Google Sheets 應有的工作表，以及目前 repo 工具或本機 fixture 的支援狀態。

建立 MVP Sheets 前，可以先執行：

```bash
pnpm sheets:init
```

此指令會在 `tmp/sheets-init/` 產生可匯入 Google Sheets 的初始化 CSV 與 `manifest.json`。建議建立以下同名 tabs：

- `photos`
- `albums`
- `import_batches`
- `taxonomy`
- `sponsorship_items`

`photos` 和 `import_batches` 初始可以只有 header；`albums` 可先使用 repo 目前已盤點的相簿清單，或先重新執行 `pnpm albums:discover -- --write` 再產生初始化檔。`taxonomy` 與 `sponsorship_items` 是輔助表，供 Apps Script、下拉選單與人類查詢使用。

Google Sheets tab 名稱在 MVP 固定，不提供 `worksheetNames` 對照設定。其他組織 fork 時若要複用，應使用同樣 tab 名稱；未來若真的有改名需求，再加入對照設定。

若 `config/project.json` 已填入 `googleSheets.spreadsheetId`，可先執行只讀檢查：

```bash
pnpm sheets:check
```

這個檢查用公開 CSV export 讀取固定 tabs，確認 header 與是否已有資料。它不處理 credential，也不寫入 Google Sheets；寫入權限仍由 Google Sheets 權限與後續 SDK 寫入工具處理。

確認沒有覆蓋風險後，正式表格寫入的主要技術選擇是官方 Google Sheets API SDK。repo 工具應使用 Sheets tab/range 語意處理初始化、append、batch update 與讀回驗證；rclone 或 Drive 檔案搬運工具不作為主要 Sheets 寫入流程。

### photos（正式主表；Sheets 建置時必備；候選列 CSV 目前可產生）

正式照片索引主表。每列代表一張 Flickr 照片。

欄位應以 `data/photo-schema.json` 的 `photos.fields` 為準。這張表可以包含尚未人工整理完成的照片，因為 SITCON Flickr 照片量很大，要求所有照片先完成人工 review 才能被搜尋會讓工具失去價值。

`curation_status`、`public_use_status`、`priority_level` 與 `collections` 應用來協助排序、提醒與推薦，而不是把未 review 的照片完全排除。

### taxonomy（正式輔助表；由 repo taxonomy 同步）

受控字彙表。內容應由 `data/tag-taxonomy.json` 匯入或同步。

Apps Script 可以使用這張表產生下拉選單、欄位驗證與錯誤提示。若這張表和 repo taxonomy 不一致，以 repo taxonomy 為準，並重新同步。

### sponsorship_items（正式輔助表；由固定 snapshot 同步）

贊助品項表。內容應由 `data/sponsorship-items.json` 匯入或同步。

這份資料目前對應 SITCON 2026 CFS 固定版本，不需要自動同步遠端來源。未來年度若有新 CFS，應明確建立新版本資料或替換資料來源，而不是假設 2026 snapshot 會持續更新。

### albums（目前可用：本機 fixture 與 Sheets-ready CSV；SDK 寫回規劃中）

SITCON Flickr 相簿清單與處理紀錄。這張表應由工具盤點 SITCON Flickr 公開相簿後更新，讓使用者從既有相簿清單中選擇本次要處理哪一本，而不是手動提供相簿 URL。

欄位應以 `data/photo-schema.json` 的 `albums.fields` 為準。工具盤點時應優先填入 `album_id`、`album_url`、`album_title` 與可取得的 `photo_count`；`event_name`、`event_year`、`last_processed_at` 與 `notes` 可由同步或匯入流程後續補上。

### import_batches（目前可用：Sheets-ready CSV；SDK 寫回規劃中）

匯入批次紀錄。這張表用來讓技術志工與 agent 回頭理解某次相簿匯入發生了什麼。

欄位應以 `data/photo-schema.json` 的 `import_batches.fields` 為準。工具應填入本次處理的相簿、執行時間、來源工具，以及找到、新增、略過的照片數。

### schema_meta（規劃中）

schema 與同步狀態紀錄。這張表讓人類、Apps Script 與 agent 能確認目前 Sheets 使用哪個 repo 規格。

建議欄位：

| 欄位 | 用途 |
| --- | --- |
| `schema_version` | 對應 `data/photo-schema.json` 的版本。 |
| `taxonomy_version` | taxonomy 同步版本或 repo commit。 |
| `sponsorship_items_version` | 贊助品項資料版本。 |
| `last_synced_at` | 最近一次同步時間。 |
| `synced_by` | 同步操作者或工具。 |
| `notes` | 可公開的同步備註。 |

## 欄位責任

工具應優先填入客觀、可從 Flickr 或相簿脈絡取得的資料：

- `photo_id`
- `photo_url`
- `image_preview_url`
- `album_title`
- `event_name`
- `event_year`
- `photographer`

人類整理者應負責需要判斷與工作脈絡的欄位：

- `scene_tags`
- `mood_tags`
- `recommended_uses`
- `people_count`
- `sponsorship_items`
- `sponsorship_tags`
- `orientation`
- `has_negative_space`
- `safe_crop`
- `public_use_status`
- `priority_level`
- `collections`
- `curation_notes`
- `curation_status`

AI 可以協助產生候選值，但不應靜默覆蓋人類已整理的值。AI 輔助後尚未人工確認的資料應標成 `curation_status = ai_labeled`。

## 公開讀取方式

MVP 階段不建立額外的公開篩選表。GitHub Pages、外部 AI 與其他唯讀工具應讀取 `photos` 主表，或讀取由 `photos` 以同一套欄位匯出的 CSV/JSON。

公開匯出只是技術傳輸格式，不是另一份資料表，也不應做資料篩選。它應：

- 使用 `data/photo-schema.json` 定義的欄位順序。
- 保留 `photos` 中所有公開索引列。
- 保留 `curation_status`、`public_use_status`、`priority_level`、`collections` 等挑選與排序所需 metadata。
- 不因 `curation_status = unreviewed` 或 `ai_labeled` 排除照片。
- 不因 `public_use_status = needs_review` 或 `avoid` 排除照片。

若未來真的出現不適合公開的欄位或資料，再重新設計公開/非公開資料邊界；不要在 MVP 先預設一張額外篩選表。

## 最低資料品質

能進入 `photos` 的最低條件、`curation_status = reviewed` 的完整度要求，以及 `public_use_status = approved` 的使用要求，都由 `data/photo-schema.json` 定義，並由 `pnpm validate:data` 檢查。

這份文件只記錄資料表設計與欄位責任；不要在這裡另外維護一份必填欄位清單。

## 資料流

```text
SITCON Flickr albums
  -> repo CLI 盤點相簿清單
  -> 使用者選擇要處理的相簿
  -> repo CLI 掃描選定相簿
  -> 產生 intake run artifact
  -> 人類檢查候選照片、相簿更新與批次紀錄
  -> 套用到 Google Sheets photos / albums / import_batches
  -> AI 輔助初標或人類直接整理
  -> 人類檢核與修正
  -> Apps Script 驗證與提示
  -> GitHub Pages 與外部 AI 讀取 photos 或同欄位公開匯出
```

## 維護保護

Google Sheets 應盡量提供以下保護：

- 鎖定 header row。
- 對受控欄位套用下拉選單。
- 對 `photo_id`、`photo_url`、`image_preview_url` 等工具欄位提供格式提醒。
- 避免合併儲存格。
- 避免用顏色或註解承載資料語意。
- 發生誤刪、誤排序、誤貼格式時，優先使用 Google Sheets 版本紀錄復原。

## 遷移性

這個 Sheets 設計應保留未來遷移到 PostgreSQL、SQLite 或其他資料庫的可能性。

因此：

- 每張工作表應有穩定主鍵。
- 多值欄位在 Sheets/CSV 中使用分號分隔。
- 受控字彙與 schema 由 repo 管理。
- `photos`、`albums`、`import_batches` 的責任要分清楚。
- 不把資料語意放在視覺格式中。
