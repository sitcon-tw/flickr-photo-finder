# SITCON Photo Finder MVP 實作計畫

## 目的

這份文件把 `photo-finder-mvp.md` 的產品判斷轉成可執行的第一版計畫。

MVP 的重點不是一次建立完整照片系統，而是先做出一個能被籌備團隊實際使用、回饋、修正的照片索引。第一版應該讓使用者能從常見情境出發，快速找到可用照片，並且保留足夠資料回到 Flickr 取得原圖與授權資訊。

## 第一版工作範圍

第一版處理可由相簿逐批匯入的照片索引，不追求一次完整收錄所有 Flickr 歷史照片。

建議範圍：

- 先從 100 到 300 張高機率會被使用的照片開始，或先選擇一批 SITCON Flickr 既有相簿逐本處理。
- 來源可以是程式盤點出的 SITCON Flickr 相簿清單、近年常用活動、過去社群與網站素材、行銷組贊助提案常用照片，或各組人工推薦照片。
- 每張照片都必須有 Flickr 原始連結。
- 匯入階段只要求最低必要欄位；人工整理完成後才要求 reviewed 完整度。
- 每次標註後都要用真實找圖任務驗證。

這個範圍足以驗證資料欄位、相簿匯入和搜尋方式是否正確，同時避免一開始被全量整理拖垮。

## 建議資料格式

第一版以 Google Sheets 作為正式照片索引資料庫與人工維護介面。技術上仍保留 CSV、JSON、SQLite、PostgreSQL 等匯出或遷移可能，但在欄位穩定前，不需要急著導入完整後台。

資料權威與 repo sample/fixture 角色以 `docs/README.md` 的真理來源表為準。這份文件只記錄 MVP 實作方向；協作原則記錄在 `docs/database-collaboration-strategy.md`，正式 Sheets 表格設計記錄在 `docs/google-sheets-database-design.md`。

目前 repo 內先保留三份資料：

- `fixtures/photos.csv`: 照片索引 sample 與匯出格式參考。
- `data/tag-taxonomy.json`: MVP 受控標籤字典。
- `data/sponsorship-items.json`: 從 SITCON 2026 贊助徵求書 `item.json` 精簡出的贊助品項固定版本資料。

SITCON 2026 年會已經結束，因此 `data/sponsorship-items.json` 應視為固定版本資料，不需要建立自動同步流程。未來年度的贊助徵求資料可能完全取代目前版本，也可能根據目前版本再次精進；屆時應明確建立新的版本資料，而不是假設 2026 資料會持續更新。

概念資料形狀如下：

```json
{
  "photo_id": "flickr-photo-id",
  "photo_url": "https://www.flickr.com/photos/sitcon/...",
  "album_ids": "flickr-album-id",
  "image_preview_url": "https://...",
  "album_title": "SITCON ...",
  "event_name": "SITCON 年會",
  "event_year": 2026,
  "people_count": 3,
  "photographer": "攝影者名稱",
  "license": "授權資訊",
  "scene_tags": ["攤位", "會眾", "交流"],
  "mood_tags": ["熱鬧", "友善"],
  "recommended_uses": ["贊助提案", "社群貼文"],
  "sponsorship_items": ["會場攤位"],
  "sponsorship_tags": ["攤位曝光", "會眾互動", "實體導流"],
  "orientation": "landscape",
  "has_negative_space": false,
  "safe_crop": ["1:1", "16:9"],
  "public_use_status": "approved",
  "priority_level": "high",
  "collections": ["贊助提案素材包"],
  "curation_notes": "適合呈現攤位人流與互動。",
  "curation_status": "reviewed"
}
```

## 欄位型別

| 欄位 | 型別 | 備註 |
| --- | --- | --- |
| `photo_id` | string | 必填。Flickr 唯一識別。 |
| `photo_url` | url | 必填。回到 Flickr 原始頁面。 |
| `album_ids` | string list | 可空。來源 Flickr 相簿 ID，多值以分號分隔。 |
| `image_preview_url` | url | 必填。搜尋與審核介面使用。 |
| `album_title` | string | 可從 Flickr 匯入。 |
| `event_name` | string | 允許空值，避免硬猜。 |
| `event_year` | number | 允許空值。 |
| `people_count` | number | 允許空值。照片中可辨識的人數估計值，無人可填 `0`。 |
| `subject_type` | 列舉值 | 允許空值。照片第一眼主要視覺主體，支援照片海初篩。 |
| `photographer` | string | 允許空值，但高曝光用途應補齊。 |
| `license` | string | 允許空值，但不能因此視為可公開使用。 |
| `scene_tags` | string array | 受控字彙，允許多選。 |
| `mood_tags` | string array | 受控字彙，允許多選。 |
| `recommended_uses` | string array | 受控字彙，允許多選。 |
| `sponsorship_items` | string array | 受控字彙，允許多選。行銷組高頻需求。 |
| `sponsorship_tags` | string array | 受控字彙，允許多選。描述贊助價值與證明力。 |
| `orientation` | 列舉值 | `landscape`、`portrait`、`square`。 |
| `has_negative_space` | boolean | 是否適合放字或裁成設計版面。 |
| `safe_crop` | string array | 例如 `1:1`、`16:9`、`9:16`。 |
| `public_use_status` | 列舉值 | `approved`、`needs_review`、`avoid`。 |
| `priority_level` | 列舉值 | `high`、`normal`、`low`。表示推薦使用優先度，不是照片品質分數。 |
| `collections` | string array | 素材包名稱。 |
| `curation_notes` | text | 補充脈絡、限制或推薦用法。 |
| `curation_status` | 列舉值 | `unreviewed`、`ai_labeled`、`reviewed`。只描述資料是否經過人工確認。 |

## MVP 標籤字典原則

標籤字典是起點，不是定稿。實際可用值以 `data/tag-taxonomy.json` 為準；若真實找圖語言和字典不同，應優先修正 taxonomy，而不是在文件裡另外維護一份清單。

`scene_tags` 描述照片中看得見的事實，例如人、物件、場域與活動狀態。這類標籤應盡量客觀，方便人類與 AI 都能用畫面內容判斷。

`mood_tags` 描述照片能帶來的情緒感受與宣傳語感。它不只追求畫面精準描述，也要支援社群、網站與招募文案在找照片時常用的語言，例如想找「熱鬧」、「專注」或「青春感」的畫面。

`recommended_uses` 描述照片適合支援的工作情境，例如宣傳、網站、公關、行銷或活動回顧。這個欄位讓使用者不用先知道照片在哪個相簿，只要從當下任務出發。

### `sponsorship_items`

`sponsorship_items` 不應手動用概略名稱維護。這個欄位應以 SITCON 2026 贊助徵求書的 `src/data/item.json` 為權威來源，因為該資料已精確描述每個贊助品項的名稱、分類、說明、子品項，以及在「人才招募」、「品牌曝光」、「產品推廣」三種目的下的價值描述。

目前已整理成固定版本資料 `data/sponsorship-items.json`，並由該資料衍生主品項名稱到 `data/tag-taxonomy.json`。

主品項共 40 個，分類包含：

- 打包專屬
- 數位媒體曝光
- 更多曝光方式
- 獨家議程
- 現場實體曝光
- 紀念品配件曝光

實際使用時，照片可以標主品項，例如 `會場攤位`、`午餐旗、點心旗`、`Badge 繩廠商 Logo 曝光`；若需要更精準，也可以參考 `sub_items` 標到子品項，例如 `午餐旗`、`點心旗`、`R0 會議室椅套曝光`。

`sponsorship_tags` 描述照片能證明或支援的贊助價值，例如品牌露出、會眾互動、實體導流或成果佐證。它和 `scene_tags` 的差異在於：`scene_tags` 是畫面事實，`sponsorship_tags` 是這張照片能在贊助溝通中被如何使用。

## 標註流程

第一版標註流程應該保持輕量：

1. 匯入候選照片的 Flickr 中繼資料與縮圖。
2. 由各組提供已知常用或高價值照片。
3. 對候選照片做第一輪快速標註。
4. 把照片分成 `unreviewed`、`ai_labeled` 或 `reviewed`，並另外用 `public_use_status` 判斷公開使用風險。
5. 用真實任務測試搜尋，例如「找 5 張志工招募照片」、「找 10 張攤位贊助照片」、「找 3 張適合網站 hero 的橫式照片」。
6. 記錄找不到、難判斷、標籤不自然、欄位不足的情況。
7. 回頭修正欄位、標籤字典與素材包。

AI 可以用來做初標，但不能取代人工審核。尤其是 `public_use_status`、`sponsorship_items`、`sponsorship_tags`、`recommended_uses` 這類欄位，牽涉使用判斷，應由熟悉 SITCON 語境的人確認。

## 第一批素材包

MVP 應該直接建立素材包，因為很多真實需求不是找一張，而是找一組可用照片。

建議第一批素材包：

- 志工招募
- 投稿宣傳
- 報名宣傳
- 贊助提案
- 贊助成果報告
- 網站 hero
- 新聞稿
- 社群介紹
- 活動回顧

每個素材包先收 10 到 30 張照片即可。素材包不需要互斥，同一張照片可以出現在多個素材包。

## 驗證方式

MVP 是否有效，應用任務完成度驗證，而不是用資料量驗證。

第一輪可以設計以下測試：

- 宣傳組能否在 5 分鐘內找到 5 張適合志工招募的照片。
- 行銷組能否在 10 分鐘內找到某個贊助品項的實際照片。
- 網站或設計夥伴能否找到橫式、有留白、適合放 hero 的照片。
- 公關或行政夥伴能否找到可公開、授權與署名資訊足夠的照片。
- 新接手的籌備夥伴能否不依賴老成員記憶完成找圖。

若測試失敗，優先檢查：

- 使用者的自然語言需求是否沒有對應標籤。
- 搜尋結果是否太多、太少或排序不合理。
- `public_use_status` 或授權資訊是否不足以讓人放心使用。
- 贊助相關需求是否缺少 `sponsorship_items` 或 `sponsorship_tags`。
- 設計相關需求是否缺少構圖資訊。

## 下一步

建議接下來做三件事：

1. 建立第一版正式 Google Sheets，使用本文件的 MVP 欄位。
2. 將 repo 工具已可盤點的 SITCON Flickr 相簿清單同步到正式 Google Sheets `albums`，讓使用者選擇第一批要處理的相簿，或選一批 100 到 300 張候選照片建立第一版公開索引。
3. 找宣傳、行銷、設計、網站、公關各 1 到 2 個真實任務來驗證欄位與標籤。

做完這三件事後，再決定是否需要 PostgreSQL、正式後台、公開 API、更完整的搜尋介面、Flickr 匯入腳本或 AI 初標流程。
