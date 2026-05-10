# Google Sheets 照片索引表格設計

## 目的

這份文件定義 SITCON Flickr Photo Finder 的正式 Google Sheets 照片索引表格結構。

此專案的正式照片資料不放在 repo 內。repo 負責保存 schema、taxonomy、驗證規則、匯入工具、同步流程、Apps Script 來源與 AI/agent 維護文件；Google Sheets 則是志工實際共同維護照片索引的地方。

## 核心決策

- 資料權威與 repo fixture 關係以 `docs/README.md` 的真理來源表為準。
- `data/photo-schema.json` 是 `photos`、`albums`、`import_batches` 欄位順序、欄位 metadata 與基本完整度規則的機器可讀來源。
- `data/tag-taxonomy.json` 是受控字彙與列舉值來源。
- `data/sponsorship-items.json` 是 SITCON 2026 CFS 贊助品項固定版本資料。
- `photos` 主表本身就是公開照片索引。索引的目標是為照片加註 metadata，方便人類、前端與 AI 挑選，而不是另外做一層篩選資料表。
- 資料語意必須存在欄位值，不依賴顏色、註解、篩選、排序或合併儲存格。

## 建議工作表

以下列出正式 Google Sheets 應有的工作表與各表責任。工具支援狀態、目前可用指令與改善項目請以 `docs/README.md` 的「目前狀態」為準；同步與寫入流程請看 `docs/sheets-sync-workflow.md`。

建立 1.0 Sheets 前，可以先執行：

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

Google Sheets tab 名稱在 1.0 固定，不提供 `worksheetNames` 對照設定。其他組織 fork 時若要複用，應使用同樣 tab 名稱；未來若真的有改名需求，再加入對照設定。

若 `config/project.json` 已填入 `googleSheets.spreadsheetId`，可先執行只讀檢查：

```bash
pnpm sheets:check
```

這個檢查用公開 CSV export 讀取固定 tabs，確認 header 與是否已有資料。它不處理 credential，也不寫入 Google Sheets；寫入權限仍由 Google Sheets 權限與後續 SDK 寫入工具處理。

確認沒有覆蓋風險後，正式表格寫入的主要技術選擇是官方 Google Sheets API SDK。repo 工具應使用 Sheets tab/range 語意處理初始化、append、batch update 與讀回驗證；Drive 檔案搬運工具不作為主要 Sheets 寫入流程。

初始化 CSV 可用以下指令套用到正式 Sheets：

```bash
pnpm sheets:apply-init
pnpm sheets:apply-init -- --write
```

第一個指令只做 dry-run，第二個指令才寫入。工具會建立缺少的固定 tabs，但會拒絕覆蓋已有資料或 header 不符合預期的 tab。

### photos

正式照片索引主表。每列代表一張 Flickr 照片。

欄位應以 `data/photo-schema.json` 的 `photos.fields` 為準。這張表可以包含尚未人工整理完成的照片，因為 SITCON Flickr 照片量很大，要求所有照片先完成人工 review 才能被搜尋會讓工具失去價值。

`album_ids` 記錄照片和 Flickr 相簿的來源關係。它是多值欄位，因為同一張 Flickr 照片可能出現在多本相簿中；這個欄位應由匯入工具維護，人類通常不需要手動填寫。匯入批次 ID 不放在 `photos` 主表，批次層級的執行紀錄留在 `import_batches`，避免把照片主表變成操作 log。

`curation_status`、`public_use_status`、`priority_level` 與 `collections` 應用來協助排序、提醒與推薦，而不是把未 review 的照片完全排除。

### taxonomy

受控字彙表。內容應由 `data/tag-taxonomy.json` 匯入或同步。

表格欄位固定為：

| 欄位 | 用途 |
| --- | --- |
| `taxonomy_key` | 對應 taxonomy 分組或欄位 key。 |
| `value` | 實際寫入 `photos`、CSV、AI proposal 與驗證流程的 raw value。 |
| `label_zh` | 給人類查閱的中文顯示文字。來源是 `data/tag-taxonomy.json` 的 `option_labels`；若沒有另外定義，使用 raw value 本身。這欄不應空白。 |
| `order` | 顯示排序。 |

Apps Script 可以使用 repo 產生的設定同步這張表，也可以使用 `pnpm sheets:sync-taxonomy` 透過 Sheets API 明確 dry-run / write。若這張表和 repo taxonomy 不一致，以 repo taxonomy 為準，並重新同步；不要直接在 Sheets 中創造新受控字彙或手動補一套翻譯。

### sponsorship_items

贊助品項表。內容應由 `data/sponsorship-items.json` 匯入或同步。

這份資料目前對應 SITCON 2026 CFS 固定版本，不需要自動同步遠端來源。未來年度若有新 CFS，應明確建立新版本資料或替換資料來源，而不是假設 2026 snapshot 會持續更新。

### albums

SITCON Flickr 相簿清單與處理紀錄。這張表應由工具盤點 SITCON Flickr 公開相簿後更新，讓使用者從既有相簿清單中選擇本次要處理哪一本，而不是手動提供相簿 URL。

欄位應以 `data/photo-schema.json` 的 `albums.fields` 為準。工具盤點時應優先填入 `album_id`、`album_url`、`album_title` 與可取得的 `photo_count`；`event_name`、`event_year`、`last_processed_at` 與 `notes` 可由同步或匯入流程後續補上。

### import_batches

匯入批次紀錄。這張表用來讓技術志工與 agent 回頭理解某次相簿匯入發生了什麼。

欄位應以 `data/photo-schema.json` 的 `import_batches.fields` 為準。工具應填入本次處理的相簿、執行時間、來源工具，以及找到、新增、略過的照片數。

### schema_meta

schema 與同步狀態紀錄。這張表讓人類、Apps Script 與 agent 能確認目前 Sheets 使用哪個 repo 規格。

目前由 `SITCON Photo Finder` 選單中的 `更新欄位選項` 建立或更新。`schema_meta` 不應是空白工作表；至少應有 header row 與一列同步資訊。若 `schema_version`、`taxonomy_version`、`sponsorship_items_version`、`last_synced_at` 或 `synced_by` 空白，表示 Apps Script refresh 沒有成功完成。

欄位：

| 欄位 | 用途 |
| --- | --- |
| `schema_version` | 對應 `data/photo-schema.json` 的版本。 |
| `taxonomy_version` | taxonomy 同步版本或 repo commit。 |
| `sponsorship_items_version` | 贊助品項資料版本。 |
| `last_synced_at` | 最近一次同步時間。 |
| `synced_by` | 同步操作者或工具。 |
| `notes` | 可公開的同步備註。 |

### validation_report

最近一次 Apps Script 驗證結果。這張表由 `檢查這張照片`、`檢查全部照片` 或 `檢查公開資料格式` 覆寫，方便維護者處理 alert 放不下的大量錯誤。

`validation_report` 是維護輔助報表，不是正式資料表；公開前端、AI 初標與 repo 匯入流程不應把它當成資料來源。

欄位：

| 欄位 | 用途 |
| --- | --- |
| `checked_at` | 檢查時間。 |
| `target` | 本次檢查目標，例如 `photos` 或公開讀取格式。 |
| `status` | `passed` 或 `failed`。 |
| `row` | 錯誤所在列；非列層級錯誤可留空。 |
| `field` | 錯誤欄位；非欄位層級錯誤可留空。 |
| `message` | 中文錯誤或通過訊息。 |

## 欄位責任

工具應優先填入客觀、可從 Flickr 或相簿脈絡取得的資料：

- `photo_id`
- `photo_url`
- `album_ids`
- `image_preview_url`
- `album_title`
- `event_name`
- `event_year`
- `photographer`

人類整理者應負責需要判斷與工作脈絡的欄位：

- `scene_tags`
- `subject_type`
- `mood_tags`
- `recommended_uses`
- `people_count`
- `sponsorship_items`
- `sponsorship_tags`
- `orientation`
- `has_negative_space`
- `safe_crop`
- `visual_description`
- `public_use_status`
- `priority_level`
- `collections`
- `curation_notes`
- `curation_status`

AI 可以協助產生候選值，但不應靜默覆蓋人類已整理的值。AI 輔助後尚未人工確認的資料應標成 `curation_status = ai_labeled`。

## 公開讀取方式

1.0 階段不建立額外的公開篩選表。GitHub Pages 使用 Google Sheets `photos` 工作表的公開 CSV URL，外部 AI 與其他唯讀工具也應讀取 `photos` 主表，或讀取由 `photos` 以同一套欄位匯出的公開 CSV/JSON。

GitHub Pages 使用的公開 CSV URL 形式為：

```text
https://docs.google.com/spreadsheets/d/<spreadsheetId>/gviz/tq?tqx=out:csv&sheet=photos
```

這個 URL 由 `pnpm finder:build` 根據 `config/project.json` 的 `googleSheets.spreadsheetId` 產生。它不需要 API key、OAuth、service account 或 Apps Script Web App。

公開匯出只是技術傳輸格式，不是另一份資料表，也不應做資料篩選。它應：

- 使用 `data/photo-schema.json` 定義的欄位順序。
- 保留 `photos` 中所有公開索引列。
- 保留 `curation_status`、`public_use_status`、`priority_level`、`collections` 等挑選與排序所需 metadata。
- 不因 `curation_status = unreviewed` 或 `ai_labeled` 排除照片。
- 不因 `public_use_status = needs_review` 或 `avoid` 排除照片。

若未來真的出現不適合公開的欄位或資料，再重新設計公開/非公開資料邊界；不要在 1.0 先預設一張額外篩選表。

## 最低資料品質

能進入 `photos` 的最低條件，以及 `curation_status = reviewed` 的完整度要求，都由 `data/photo-schema.json` 定義，並由 `pnpm data:validate` 檢查。`public_use_status = approved` 是整理者的使用提醒，不會讓 `photographer` 或 `license` 變成必填。

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
  -> AI 輔助初標後回到 Sheets 成為 ai_labeled
  -> 志工在 Google Sheets 協作檢核、修正與標成 reviewed
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

這個 Sheets 設計應保留未來改用其他資料層的可能性，但 1.0 目標仍是維持 Google Sheets-first。

因此：

- 每張工作表應有穩定主鍵。
- 多值欄位在 Sheets/CSV 中使用分號分隔。
- 受控字彙與 schema 由 repo 管理。
- `photos`、`albums`、`import_batches` 的責任要分清楚。
- 不把資料語意放在視覺格式中。
