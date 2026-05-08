# Sheets 與 repo 同步流程

## 目的

這份文件定義技術志工與 agent 如何在 Google Sheets 與 repo 工具之間同步資料。

MVP 的重點不是把 repo 變成正式資料庫，而是讓 repo 能穩定協助 Google Sheets 做匯入、驗證、公開讀取與 AI 輔助。

## 權威來源

- 正式照片資料以 Google Sheets 為準。
- repo 內 `data/photos.csv` 是 sample、fixture 與匯出格式參考。
- schema、taxonomy、validation 與工具規則以 repo 為準。
- 若 Sheets 資料和 repo sample data 不一致，不代表 Sheets 錯；應先確認 sample 是否只是過期測試資料。

## 相簿盤點與匯入流程

此專案的目標範圍已明確限定為 SITCON Flickr，因此主要輸入不應是使用者手動提供相簿 URL。

repo 工具應能盤點 SITCON Flickr 目前有哪些公開相簿，更新 Google Sheets `albums` 清單，讓使用者從清單中選擇本次要處理的相簿。

建議流程：

1. 技術志工或 agent 使用 repo 工具盤點 SITCON Flickr 相簿清單。
2. 工具將 `album_id`、`album_url`、`album_title`、照片數等資訊同步到 Google Sheets `albums`。
3. 使用者從 `albums` 清單中選擇本次要處理的相簿。
4. 工具掃描被選定相簿中的照片 ID、照片 URL、縮圖 URL、相簿名稱與可用的 Flickr metadata。
5. 工具和 Google Sheets `photos` 既有 `photo_id` 比對，避免重複匯入。
6. 工具產生一次 intake run artifact，讓人類檢查候選 `photos`、更新後 `albums` 與 `import_batches`。
7. 人類確認後再套用到 Google Sheets。
8. 新增照片預設 `curation_status = unreviewed`。

工具不應在未確認差異時覆蓋人類已整理的欄位。

現有低階工具仍可接受 Flickr 相簿 URL 作為開發與除錯入口；但正式使用流程應以「盤點 SITCON Flickr 相簿清單，再選擇要處理的相簿」為主。

目前可用的本機盤點指令：

```bash
pnpm albums:discover
```

確認輸出後，可以更新本機 `data/albums.csv` fixture：

```bash
pnpm albums:discover -- --write
```

`data/albums.csv` 仍只是 sample/export fixture，不是正式 Google Sheets 資料。正式流程要把相同欄位同步到 Google Sheets `albums`，再讓使用者從那張表選擇本次要處理的相簿。

若已經有正式 Google Sheets `albums` 匯出的 CSV，可以把它和目前盤點結果合併，產生可回寫 Sheets 的 CSV：

```bash
pnpm albums:sync -- --sheets-export /path/to/sheets-albums.csv --output /tmp/albums-to-import.csv
```

`albums:sync` 會保留 Sheets 上的人工作業欄位，例如 `event_name`、`event_year`、`last_processed_at` 與 `notes`，並用盤點結果更新 `album_id`、`album_url`、`album_title` 與 `photo_count`。若是第一次建立 `albums` 工作表，還沒有 Sheets 匯出檔，可以省略 `--sheets-export`。

產出的 CSV 通過 validation 後，再由人類匯入或貼回正式 Google Sheets。這一步不需要把正式 Sheets 資料 commit 回 repo。

若本機 `data/albums.csv` 已更新，低階相簿匯入工具可以用相簿 ID 解析 URL：

```bash
pnpm album:add -- ALBUM_ID
```

若要產生一次可審核的相簿匯入產物，請使用目前 Sheets `photos` 匯出檔做重複檢查：

```bash
pnpm intake:run -- --album ALBUM_ID --photos-export /path/to/sheets-photos.csv
```

`intake:run` 會建立 `tmp/intake-runs/<run-id>/`，並產生：

```text
photos-to-append.csv
albums-updated.csv
import-batch.csv
summary.json
```

這是目前建議的人機協作接口。`photos-to-append.csv` 是缺少照片的候選列，`albums-updated.csv` 是更新 `last_processed_at` 後的完整 albums CSV，`import-batch.csv` 是本次操作紀錄，`summary.json` 則讓人類、agent 或未來 Apps Script 先確認本次 run 的範圍與統計。

正式寫回前應由人類確認，並避免覆蓋既有人工整理欄位。現階段 Google Sheets 寫回仍由人類手動匯入或貼回；rclone、Google API 或 Apps Script 應在這個手動流程跑通後再自動化。

套用前先檢查整包產物：

```bash
pnpm intake:validate -- --run-dir tmp/intake-runs/RUN_ID
```

`intake:validate` 會確認：

- 三個 CSV 的欄位符合 `data/photo-schema.json`。
- `summary.json` 存在並包含必要欄位。
- `summary.json`、`import-batch.csv` 與 `albums-updated.csv` 的相簿、時間與統計數字一致。
- `photos-to-append.csv` 的資料列數等於本次新增照片數。

人工套用到 Google Sheets 時，建議順序是：

1. 看 `summary.json`，確認相簿、時間、找到/新增/略過照片數符合預期。
2. 檢查 `photos-to-append.csv`，確認候選列沒有明顯錯誤；這份檔案只追加到 `photos`，不要覆蓋整張表。
3. 用 `albums-updated.csv` 更新 `albums`，或至少把該相簿的 `last_processed_at` 更新成 `summary.json` 的 `created_at`。
4. 將 `import-batch.csv` 的單列追加到 `import_batches`。
5. 套用後再從 Sheets 匯出相關 CSV，用 `pnpm validate:data` 檢查正式資料。

若只需要低階輸出，可以直接指定各 CSV 路徑：

```bash
pnpm photos:import -- --album ALBUM_ID --photos-export /path/to/sheets-photos.csv --output /tmp/photos-to-append.csv --albums-output /tmp/albums-updated.csv --batch-output /tmp/import-batch.csv
```

`photos:import` 會從 `albums` CSV 取得相簿名稱、活動名稱與年份，掃描該相簿中的照片，排除已存在於 `photos` 匯出檔的 `photo_id`，再用 Flickr oEmbed 補 `image_preview_url`、攝影師候選署名與可公開整理備註。

## 匯出驗證流程

當需要檢查 Sheets 資料品質時：

1. 從 Google Sheets 匯出 `photos`，欄位順序應符合 `data/photo-schema.json`。
2. 放到本機或暫存路徑作為驗證輸入。
3. 執行 repo validation。
4. 將錯誤回報整理成 Sheets 使用者看得懂的列號、欄位與修正建議。
5. 回到 Google Sheets 修正。

正式資料不需要 commit 回 repo。只有 schema、taxonomy、工具、文件或 sample fixture 有意義改變時才需要 commit。

若要驗證 Sheets 匯出的 `albums` CSV，可以指定 albums 路徑：

```bash
pnpm validate:data -- --albums /path/to/sheets-albums.csv
```

若要驗證候選 `photos` CSV，可以指定 photos 路徑：

```bash
pnpm validate:data -- --photos /tmp/photos-to-append.csv
```

若要驗證匯入批次 CSV，可以指定 import batches 路徑：

```bash
pnpm validate:data -- --import-batches /tmp/import-batch.csv
```

## AI 輔助流程

AI 可以協助初標，但不能取代人工確認。

建議流程：

1. 從 Google Sheets 讀取待整理照片，例如 `curation_status = unreviewed`。
2. AI 讀取縮圖、Flickr title、相簿脈絡、既有欄位、taxonomy 與 sponsorship items。
3. AI 產生候選欄位值。
4. 工具產生 diff，讓人類確認是否回寫。
5. 人類確認後才寫入正式欄位。
6. AI 協助後但尚未人工完整確認的列標成 `curation_status = ai_labeled`。
7. 人類檢核並補齊必要欄位後，才改成 `curation_status = reviewed`。

若人類重新觸發 AI 調整欄位，工具仍應提供可審核 diff，不應靜默覆蓋人工整理內容。

## 公開讀取流程

GitHub Pages、外部 AI 與其他唯讀工具應讀取 `photos` 主表，或讀取由 `photos` 以同一套欄位匯出的公開 CSV/JSON。

公開匯出只是技術傳輸格式，不是另一份資料表，也不應做資料篩選。

產生流程：

1. 檢查 `photos` header 與 schema。
2. 檢查必要欄位與受控字彙。
3. 若需要 CSV/JSON，依固定欄位順序匯出 `photos`。
4. 保留 `curation_status`、`public_use_status`、`priority_level` 與 `collections`。
5. 不因尚未人工 review 排除照片。
6. 不因 `public_use_status = avoid` 排除照片。

公開前端與 AI 應使用欄位值排序與提示，不應依賴 Sheets 顏色、註解、排序或篩選檢視。

## 衝突處理

### Sheets 與 repo sample 不一致

以 Google Sheets 為準。repo sample data 只用於本機 UI、測試與匯出格式參考。

### Sheets 與 repo schema 不一致

以 repo schema 為準。應更新 Sheets header、Apps Script 或同步流程，並保留人類資料。

### AI 候選值與既有人工值不一致

不要自動覆蓋。工具應顯示原值、AI 建議值與理由，由人類決定是否採用。

### taxonomy 缺值

不要直接在 Sheets 中創造新受控字彙。先確認是否真的需要新增，若需要，更新 `data/tag-taxonomy.json`、文件與 validation。

## 權限與 credential

repo 不保存：

- Google API credential。
- rclone token。
- AI API key。
- 私人 Google Sheets 連結或權限設定。

SITCON 組織已有文件存放與交接制度。此 repo 只記錄本專案需要哪些資產、工具如何運作，以及未來 agent 如何接手維護流程；實際權限交接由 SITCON 既有 Google Drive 與文件管理原則處理。

## Commit 時機

適合 commit 的內容：

- schema 或 taxonomy 變更。
- validation 規則變更。
- 匯入、同步、AI 輔助工具變更。
- Apps Script source 或產生器變更。
- 文件流程與欄位語意變更。
- 有代表性的 sample fixture 更新。

不適合 commit 的內容：

- 正式 Google Sheets 的完整照片資料快照。
- credential、token、私人連結。
- 單純從 Sheets 匯出的工作中暫存檔。
