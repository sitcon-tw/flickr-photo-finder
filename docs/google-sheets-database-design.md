# Google Sheets 資料庫設計

## 目的

這份文件定義 SITCON Flickr Photo Finder 的正式 Google Sheets 資料庫結構。

此專案的正式照片資料不放在 repo 內。repo 負責保存 schema、taxonomy、驗證規則、匯入工具、同步流程、Apps Script 來源與 AI/agent 維護文件；Google Sheets 則是志工實際共同維護照片索引的資料庫。

## 核心決策

- Google Sheets 是正式照片索引資料庫。
- `data/photos.csv` 只是 sample、local fixture 與 Sheets 匯出格式參考。
- `data/photo-schema.json` 是照片主表欄位順序、欄位 metadata 與基本完整度規則的機器可讀來源。
- `data/tag-taxonomy.json` 是受控字彙與列舉值來源。
- `data/sponsorship-items.json` 是 SITCON 2026 CFS 贊助品項固定版本資料。
- `photos` 主表本身就是公開照片索引。資料庫的目標是為照片加註 metadata，方便人類、前端與 AI 挑選，而不是另外做一層篩選資料表。
- 資料語意必須存在欄位值，不依賴顏色、註解、篩選、排序或合併儲存格。

## 建議工作表

### photos

正式照片索引主表。每列代表一張 Flickr 照片。

欄位應以 `data/photo-schema.json` 的 `photos.fields` 為準。這張表可以包含尚未人工整理完成的照片，因為 SITCON Flickr 照片量很大，要求所有照片先完成人工 review 才能被搜尋會讓工具失去價值。

`curation_status`、`public_use_status`、`priority_level` 與 `collections` 應用來協助排序、提醒與推薦，而不是把未 review 的照片完全排除。

### taxonomy

受控字彙表。內容應由 `data/tag-taxonomy.json` 匯入或同步。

Apps Script 可以使用這張表產生下拉選單、欄位驗證與錯誤提示。若這張表和 repo taxonomy 不一致，以 repo taxonomy 為準，並重新同步。

### sponsorship_items

贊助品項表。內容應由 `data/sponsorship-items.json` 匯入或同步。

這份資料目前對應 SITCON 2026 CFS 固定版本，不需要自動同步遠端來源。未來年度若有新 CFS，應明確建立新版本資料或替換資料來源，而不是假設 2026 snapshot 會持續更新。

### albums

SITCON Flickr 相簿清單與處理紀錄。這張表應由工具盤點 SITCON Flickr 公開相簿後更新，讓使用者從既有相簿清單中選擇本次要處理哪一本，而不是手動提供相簿 URL。

建議欄位：

| 欄位 | 用途 |
| --- | --- |
| `album_id` | Flickr 相簿 ID，用來避免重複掃描。 |
| `album_url` | 工具從 SITCON Flickr 盤點出的 Flickr 相簿 URL。 |
| `album_title` | Flickr 相簿名稱。 |
| `event_name` | 活動名稱，例如 SITCON 年會、SITCON Camp。 |
| `event_year` | 活動年份。 |
| `photo_count` | 工具盤點到的相簿照片數。 |
| `last_processed_at` | 最近一次處理這本相簿的時間。 |
| `notes` | 可公開的整理備註。 |

### import_batches

匯入批次紀錄。這張表用來讓技術志工與 agent 回頭理解某次相簿匯入發生了什麼。

建議欄位：

| 欄位 | 用途 |
| --- | --- |
| `batch_id` | 匯入批次 ID。 |
| `album_id` | 對應 `albums.album_id`。 |
| `album_url` | 匯入來源相簿 URL。 |
| `imported_at` | 匯入時間。 |
| `operator` | 操作者或工具名稱。 |
| `source_tool` | 使用的 repo script、agent 或其他工具。 |
| `found_photo_count` | 相簿中找到的照片數。 |
| `new_photo_count` | 新增到 `photos` 的照片數。 |
| `skipped_photo_count` | 因已存在或格式問題略過的照片數。 |
| `notes` | 可公開的匯入備註。 |

### schema_meta

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
- `sponsorship_items`
- `sponsorship_tags`
- `orientation`
- `has_negative_space`
- `safe_crop`
- `public_use_status`
- `priority_level`
- `collections`
- `internal_notes`
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

能進入 `photos` 的最低條件：

- `photo_id`
- `photo_url`
- `image_preview_url`

標成 `curation_status = reviewed` 前，至少應補齊：

- `scene_tags`
- `mood_tags`
- `recommended_uses`
- `public_use_status`
- `priority_level`

若 `public_use_status = approved`，還必須補齊：

- `photographer`
- `license`

## 資料流

```text
SITCON Flickr albums
  -> repo CLI 盤點相簿清單
  -> 使用者選擇要處理的相簿
  -> repo CLI 掃描選定相簿
  -> 產生候選照片列
  -> 寫入 Google Sheets photos
  -> 更新 albums.last_processed_at 與 import_batches
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
