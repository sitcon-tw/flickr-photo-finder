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
6. 新照片以最低必要欄位寫入 `photos`。
7. 工具更新該相簿的 `last_processed_at`，並寫入 `import_batches`。
8. 新增照片預設 `curation_status = unreviewed`。

工具不應在未確認差異時覆蓋人類已整理的欄位。

現有低階工具仍可接受 Flickr 相簿 URL 作為開發與除錯入口；但正式使用流程應以「盤點 SITCON Flickr 相簿清單，再選擇要處理的相簿」為主。

目前可用的本機盤點指令：

```bash
npm run albums:discover
```

確認輸出後，可以更新本機 `data/albums.csv` fixture：

```bash
npm run albums:discover -- --write
```

`data/albums.csv` 仍只是 sample/export fixture，不是正式 Google Sheets 資料。正式流程要把相同欄位同步到 Google Sheets `albums`，再讓使用者從那張表選擇本次要處理的相簿。

若本機 `data/albums.csv` 已更新，低階相簿匯入工具可以用相簿 ID 解析 URL：

```bash
npm run album:add -- ALBUM_ID
```

## 匯出驗證流程

當需要檢查 Sheets 資料品質時：

1. 從 Google Sheets 匯出 `photos`，欄位順序應符合 `data/photo-schema.json`。
2. 放到本機或暫存路徑作為驗證輸入。
3. 執行 repo validation。
4. 將錯誤回報整理成 Sheets 使用者看得懂的列號、欄位與修正建議。
5. 回到 Google Sheets 修正。

正式資料不需要 commit 回 repo。只有 schema、taxonomy、工具、文件或 sample fixture 有意義改變時才需要 commit。

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
