# 前端使用行為分析設計

## 目的

這份文件定義 GitHub Pages 前端導入 GA4 後，應該量測什麼、不要量測什麼，以及後續如何把行為訊號轉成照片索引維護工作。

分析的目的不是建立流量 KPI，而是驗證照片索引是否真的能協助使用者從工作需求找到可用照片，並找出 taxonomy、欄位、素材包與審核流程的缺口。

## 目前狀態

截至 2026-05-09，repo 內已加入 GA4 基礎追蹤與照片卡片操作事件。

已確認的程式碼狀態：

- `config/project.json` 的 `frontend.ga4MeasurementId` 保存 GA4 measurement ID。
- `app/index.html` 沒有 inline Google tag snippet；前端由 `app/main.js` 依專案設定動態載入 Google tag。
- `app/main.js` 會在有 measurement ID 時建立 `dataLayer` / `gtag`，並載入 `https://www.googletagmanager.com/gtag/js`。
- 照片卡片會追蹤文字搜尋、篩選、照片選擇、開啟 Flickr 原始頁、開啟大圖、開啟原圖尺寸頁、複製 Flickr 連結與複製 finder 連結。
- 卡片會提供 icon + text 操作：下載 icon + `大圖`、下載 icon + `原圖`、複製 icon + `Flickr 連結`、複製 icon + `本頁連結`。
- `複製 Flickr 連結` 複製的是 Flickr 原始照片頁，用於傳遞來源、授權與下載入口；`複製本頁連結` 複製的是 finder deep link，用於討論欄位、標籤與使用判斷是否合適。

評估前應重新檢查，避免把過期狀態當成事實：

```bash
rg -n "gtag|G-|google analytics|GA4|analytics|dataLayer|clipboard|copy_flickr_link|copy_finder_link|open_image_size|open_flickr|measurement" app docs data config scripts README.md package.json
sed -n '1,220p' config/project.json
sed -n '1,220p' app/index.html
sed -n '1,880p' app/main.js
pnpm pages:build
pnpm pages:check
```

## 產品問題

前端分析應優先回答這些問題：

1. 使用者是否能從工作需求找到候選照片？
2. 哪些搜尋沒有結果，或結果太少？
3. 哪些篩選欄位真的被使用？
4. 哪些照片雖被點擊、開啟來源、開啟大圖 / 原圖或複製連結，卻仍是 `unreviewed`、`ai_labeled` 或 `needs_review`？
5. 哪些照片接近被實際使用？
6. 哪些自然語言需求暗示需要調整 taxonomy、`visual_description`、素材包或欄位？

GA4 只能提供行為訊號。它不能取代 Google Sheets 的正式資料，也不能證明照片已實際發布或用於贊助提案。

## 事件設計

優先使用 GA4 recommended events；只有 recommended events 無法表達專案語意時才使用自訂事件。

| 事件 | 類型 | 觸發時機 | 主要用途 |
| --- | --- | --- | --- |
| `search` | GA4 recommended event | 使用者完成非空文字搜尋後看到結果。 | 觀察需求語言與零結果搜尋。 |
| `filter_results` | 自訂事件 | 使用者調整篩選器後看到結果。 | 觀察哪些欄位真的被拿來縮小候選照片。 |
| `select_content` | GA4 recommended event | 使用者選擇一張照片卡片或主要照片操作。 | 觀察哪些照片被點選。 |
| `open_flickr_source` | 自訂事件 | 使用者開啟 Flickr 原始頁。 | 觀察接近取用原圖的意圖。 |
| `open_image_size` | 自訂事件 | 使用者開啟大圖或原圖尺寸頁。 | 觀察哪些照片進入取圖流程。 |
| `copy_flickr_link` | 自訂事件 | 使用者成功複製 Flickr 原始照片頁 URL。 | 觀察哪些照片被拿去傳遞來源或下載入口。 |
| `copy_finder_link` | 自訂事件 | 使用者成功複製 finder deep link。 | 觀察哪些照片被拿去討論欄位與使用判斷。 |

### `search`

只在文字搜尋為非空時送出。篩選器變更應使用 `filter_results`，不要為了使用 recommended event 而把空搜尋或固定字串塞進 `search_term`。

建議參數：

| 參數 | 說明 |
| --- | --- |
| `search_term` | 清理後的非空搜尋字串。 |
| `result_count` | 搜尋後結果數。 |
| `result_count_bucket` | `0`、`1_5`、`6_20`、`21_plus`。 |
| `search_surface` | 例如 `main`。 |
| `has_filters` | 是否使用任一篩選器。 |
| `recommended_use` | 用途篩選值。 |
| `public_use_status` | 公開使用狀態篩選值。 |
| `curation_status` | 整理狀態篩選值。 |
| `sponsorship_filter_used` | 是否使用贊助品項篩選。 |
| `collection_filter_used` | 是否使用素材包篩選。 |

### `filter_results`

建議參數：

| 參數 | 說明 |
| --- | --- |
| `result_count` | 篩選後結果數。 |
| `result_count_bucket` | `0`、`1_5`、`6_20`、`21_plus`。 |
| `search_surface` | 例如 `main`。 |
| `has_search_term` | 是否同時有文字搜尋。 |
| `recommended_use` | 用途篩選值。 |
| `mood_filter_used` | 是否使用氛圍篩選。 |
| `scene_filter_used` | 是否使用場景篩選。 |
| `people_count_filter` | 人數篩選值。 |
| `public_use_status` | 公開使用狀態篩選值。 |
| `curation_status` | 整理狀態篩選值。 |
| `sponsorship_filter_used` | 是否使用贊助品項篩選。 |
| `collection_filter_used` | 是否使用素材包篩選。 |

`search` 與 `filter_results` 都應 debounce 並去除重複狀態，避免每次鍵盤輸入都送出事件。

### `select_content`

建議參數：

| 參數 | 說明 |
| --- | --- |
| `content_type` | 固定為 `photo`。 |
| `content_id` | `photo_id`。 |
| `result_rank` | 在當次結果中的排序位置，從 1 開始。 |
| `result_count_bucket` | 當次搜尋結果數 bucket。 |
| `public_use_status` | 該照片目前公開使用狀態。 |
| `curation_status` | 該照片目前整理狀態。 |

### `open_flickr_source`

建議參數：

| 參數 | 說明 |
| --- | --- |
| `photo_id` | Flickr 照片 ID。 |
| `result_rank` | 在當次結果中的排序位置。 |
| `public_use_status` | 該照片目前公開使用狀態。 |
| `curation_status` | 該照片目前整理狀態。 |

### `open_image_size`

`大圖` 會從 `image_preview_url` 推導 Flickr `large-1024` 圖片 URL。`原圖` 會開啟 Flickr 原始尺寸頁，讓使用者依 Flickr 頁面取得原始解析度；前端不直接解析原圖 URL。

建議參數：

| 參數 | 說明 |
| --- | --- |
| `photo_id` | Flickr 照片 ID。 |
| `image_size` | `large_1024` 或 `original`。 |
| `public_use_status` | 該照片目前公開使用狀態。 |
| `curation_status` | 該照片目前整理狀態。 |

### `copy_flickr_link`

只有在 Flickr 原始照片頁 URL 成功寫入 clipboard 後才送事件。若瀏覽器不支援 clipboard 或使用者未授權，不應送成功事件。

這個事件代表使用者可能要把來源、授權頁或下載入口交給其他人。

建議參數：

| 參數 | 說明 |
| --- | --- |
| `photo_id` | Flickr 照片 ID。 |
| `public_use_status` | 該照片目前公開使用狀態。 |
| `curation_status` | 該照片目前整理狀態。 |

### `copy_finder_link`

只有在 finder 連結成功寫入 clipboard 後才送事件。若瀏覽器不支援 clipboard 或使用者未授權，不應送成功事件。

finder 連結應指向卡片本身，例如 `#photo-<photo_id>`，方便其他人打開同一張照片並討論欄位、標籤、用途或公開使用判斷是否合適。

建議參數：

| 參數 | 說明 |
| --- | --- |
| `photo_id` | Flickr 照片 ID。 |
| `public_use_status` | 該照片目前公開使用狀態。 |
| `curation_status` | 該照片目前整理狀態。 |

## 隱私與資料品質限制

不要把 GA4 當成正式紀錄資料庫。

實作時應遵守以下限制：

- 不送 email、電話、姓名、私人備註、內部討論內容或任何可識別個人的資訊。
- 不送完整 `photo_url`、完整頁面 query string 或任意自由文字備註。
- `search_term` 送出前應 trim、截斷，並移除常見 email 與電話格式。
- 不把 `photo_id`、原始搜尋字串、完整 filter JSON 註冊成 GA4 custom dimension；這些屬於高基數資料，應留在 BigQuery raw events 查詢。
- GA4 custom dimensions 只註冊低基數參數；註冊清單以 `config/ga4-custom-dimensions.json` 為準，例如 `result_count_bucket`、`search_surface`、`public_use_status`、`curation_status`、`recommended_use`、`sponsorship_filter_used`。
- 每個事件參數數量應明顯低於 GA4 單事件 25 個參數限制。
- 事件名稱與參數名稱保持穩定；若需要改名，應在本文件記錄遷移。
- GA4 後台 service account 權限、custom dimensions 操作與 BigQuery 延後策略記錄在 `docs/ga4-operations.md`。

參考官方文件：

- GA4 recommended events: <https://developers.google.com/analytics/devguides/collection/ga4/reference/events>
- GA4 event parameters: <https://developers.google.com/analytics/devguides/collection/ga4/event-parameters>
- GA4 collection limits: <https://support.google.com/analytics/answer/9267744>
- GA4 custom dimensions limits: <https://support.google.com/analytics/answer/14240153>
- GA4 BigQuery export: <https://support.google.com/analytics/answer/9358801>
- Google Analytics PII guidance: <https://support.google.com/analytics/answer/6366371>

## 實作順序

1. 在 `config/project.json` 的 `frontend` 區塊加入可選 analytics 設定，例如 `ga4MeasurementId`。沒有設定時前端應 no-op。已完成。
2. 新增前端 analytics helper，集中處理 `gtag` 載入狀態、事件送出、字串清理、低基數 bucket 與 no-op。已完成。
3. 先追蹤 `search`、`filter_results`、`select_content` 與 `open_flickr_source`。已完成。
4. 新增 `大圖` 與 `原圖` 操作，並以 `open_image_size` 事件區分 `large_1024` 與 `original`。已完成。
5. 新增 `Flickr 連結` 與 `本頁連結` 複製操作，並以 `copy_flickr_link` / `copy_finder_link` 分別追蹤複製成功。已完成。
6. 使用 GA4 DebugView 或 Realtime 確認事件名稱、參數與 no-op 行為。待有 GA4 管理權限者驗證。
7. 依 `docs/ga4-operations.md` 將 service account 加入 GA4 property，並用 `pnpm ga4:dimensions:check` / `pnpm ga4:dimensions:sync -- --write` 管理低基數 custom dimensions。待有 GA4 管理權限者操作與驗證。
8. 執行 `pnpm pages:build` 與 `pnpm pages:check`，確認 GitHub Pages artifact 包含需要的設定但不包含 secret。每次前端變更後都應執行。

## 後續分析流程

每次回顧行為資料時，先區分「確認資料」與「推測」。

可確認：

- 零結果或低結果數搜尋。
- 被使用的篩選條件。
- 被點擊、開啟 Flickr、開啟大圖、開啟原圖尺寸頁、複製 Flickr 連結或複製 finder 連結的 `photo_id`。
- 這些照片當時的 `public_use_status`、`curation_status` 與 `recommended_uses`。

只能推測：

- 使用者是否真的下載原圖。
- 照片是否真的被用在社群、網站或提案。
- 搜尋失敗是因為缺照片、缺 metadata、UI 不好用，還是使用者輸入不清楚。

建議每月整理一次：

1. 零結果搜尋與低結果搜尋，轉成 taxonomy 或 `visual_description` 改善候選。
2. 高互動但未 reviewed 的照片，排進人工整理優先清單。
3. 經常被開啟 Flickr、開啟原圖尺寸頁、複製 Flickr 連結或複製 finder 連結的照片，檢查欄位、標籤、`photographer`、`license` 與 `public_use_status` 是否足夠。
4. 常用篩選器與幾乎沒用的篩選器，回頭檢查前端 UI 與欄位設計。
5. 若需要正式記錄「照片實際用在哪裡」，再新增 Google Form 或 Sheets 表，不要只依賴 GA4。

## 不應做的事

- 不因 GA4 有互動就自動修改 `priority_level`、`curation_status` 或 `public_use_status`。
- 不把 GA4 raw event 當成正式使用紀錄。
- 不用 GA4 收集內部需求單、私人備註或可識別個人的搜尋內容。
- 不為了追蹤方便而在公開前端加入寫入 Google Sheets 的 credential。
