# GA4 後台操作與 service account 權限

這份文件記錄 SITCON Flickr Photo Finder 使用 GA4 後，後台需要做的最小操作。GA4 行為分析只是照片索引維護的訊號來源；正式照片資料仍以 Google Sheets 為準。

## 相關官方文件

- Google Analytics Admin API quickstart: <https://developers.google.com/analytics/devguides/config/admin/v1/quickstart>
- Google Analytics Data API quickstart: <https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart>
- GA4 新增、編輯、刪除使用者: <https://support.google.com/analytics/answer/9305788>
- GA4 access and data-restriction management: <https://support.google.com/analytics/answer/9305587>
- GA4 custom dimensions: <https://support.google.com/analytics/answer/14240153>
- GA4 Admin API access bindings: <https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties.accessBindings/create>
- GA4 Community thread, service account email from Google Cloud is not allowed: <https://support.google.com/analytics/thread/427838065>
- GA4 Community reply verified by this project on 2026-05-09: <https://support.google.com/analytics/thread/427838065?hl=en&msgid=431319335>

## 官方文件查證狀態

截至 2026-05-09，官方文件可確認以下事實：

- Google Analytics Admin API / Data API quickstart 支援用 service account 驗證。
- quickstart 要求在 Google Analytics UI 將 service account 授權到 GA property。
- GA4 使用者管理文件說明，新增使用者時要輸入 Google Account 或 Google Workspace Account 的 email。
- Google Cloud 文件說明 service account 是給 application / workload 使用的特殊 account，並以 email address 識別。
- GA4 Admin API `accessBindings` 可建立 account / property 的 user role binding，scope 為 `analytics.manage.users`，但文件沒有明確寫出 `user` 欄位是否接受 service account email。

因此，本 repo 可以把「使用 service account 呼叫 GA4 API」列為官方支援方向；但若 GA4 UI 顯示 `This email doesn't match a Google Account`，不能只憑官方文件斷定一般 UI 路徑可行。這時應改走已知社群回覆中的替代操作，或先用有 GA4 權限的人類帳號完成最小 GA4 後台設定。

2026-05-09 觀察：GA4 Help Community 已有同類問題討論，標題為 `service account email from google cloud is not allowed`。該回覆說明 GA4 UI 不支援直接加入 service account email，只接受一般 Gmail / Google Workspace 帳號；workaround 是使用 Google Analytics Admin API Explorer 建立 access binding。本專案已確認可依該回覆將 `flickr-photo-finder@sitcon-324316.iam.gserviceaccount.com` 加入 GA4 權限。Community thread 不是正式產品規格；但它是本專案目前已驗證可行的 workaround 來源。

## 權限模型

GA4 property 權限和 Google Cloud IAM 權限是兩件事。

- Google Cloud project 要啟用 Google Analytics Admin API / Data API，讓程式可以呼叫 API。
- GA4 property 要把 service account email 加進 Access Management，讓這個身份有權操作該 property。
- 只在 Google Cloud IAM 給 service account 角色，不會自動讓它取得 GA4 property 權限。
- 只在 GA4 加 service account，但 Google Cloud project 沒有啟用 API，也無法從 CLI 呼叫 API。

本專案可以沿用 Sheets CLI 使用的 service account，但要另外把同一個 service account email 加到 GA4 property。

## 將 service account 加入 GA4 property

需要由已經是 GA4 account 或 property `Administrator` 的人操作。`Editor` 可以管理 property 設定，但不能管理使用者。

操作步驟：

1. 找到 service account email，例如 `flickr-photo-finder-writer@PROJECT_ID.iam.gserviceaccount.com`。
2. 打開 Google Analytics，確認右上角或 property selector 選到正確的 GA4 property。
3. 進入 `Admin`。
4. 在 `Property` 欄位選 `Property access management`。
5. 點 `+`，選 `Add users`。
6. 貼上 service account email。
7. 取消或忽略通知 email；service account 不是給人收信的帳號。
8. 選擇 `Editor` 角色。
9. 點 `Add`。

若未來只需要讀取 GA4 報表，可以降為 `Viewer`。但建立 custom dimensions 需要 `Editor`。

## 若加不進去

先確認以下事項：

- 操作者是否在該 GA4 property 或上層 account 具有 `Administrator` 角色。沒有 `Administrator` 時，通常看得到部分設定，但無法新增使用者或調整角色。
- 是否選到正確的 GA4 property。GA4 account 下可能有多個 properties。
- 貼上的是否為 service account `Email`，不是 `Client ID`，也不是 private key 裡的其他欄位。
- service account email 是否完整，通常結尾是 `.iam.gserviceaccount.com`。
- Google Cloud project 是否已啟用 Google Analytics Admin API。這不會修正 GA4 權限，但會影響後續 CLI 呼叫。

如果 `Add users` 按鈕不存在、無法點擊，或新增後角色無法調整，通常代表目前登入的 Google 帳號不是該 GA4 resource 的 `Administrator`。此時需要請 GA4 管理者代為操作，或先把操作者提升為 `Administrator`。

### `This email doesn't match a Google Account`

如果貼上 service account email 後出現 `This email doesn't match a Google Account`，代表 GA4 UI 的新增使用者表單沒有接受這個 service account email。即使貼的是 credential JSON 裡的 `client_email`，仍可能遇到這個狀況。

先做基本檢查：

1. 從 service account JSON 或 Google Cloud Console 複製 `client_email` / `Email`。
2. 不要貼 `client_id`、OAuth client ID、private key ID 或 project ID。
3. email 通常長得像 `NAME@PROJECT_ID.iam.gserviceaccount.com`。

若確認貼的是 service account email 仍被 GA4 UI 拒絕，不要繼續嘗試 UI。此時有兩條路：

- 保守路徑：改由已有 GA4 `Administrator` / `Editor` 權限的人類帳號，手動建立 custom dimensions 或執行後續一次性 CLI。這是目前不被 service account 權限問題阻塞的建議路徑。
- 已驗證 workaround：依 GA4 Community 指定回覆操作，使用 Google Analytics Admin API Explorer 將 service account 加入 GA4 權限：<https://support.google.com/analytics/thread/427838065?hl=en&msgid=431319335>。
- API 驗證路徑：由已有 GA4 `Administrator` 的人類帳號，實測 Admin API `properties.accessBindings.create` 是否能把 service account email 加入 property。

### 使用 API Explorer 加入 service account

若 GA4 UI 拒絕 service account email，使用 API Explorer 執行一次 access binding 建立：

1. 打開 Google Analytics Admin API Explorer: <https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties.accessBindings/create>
2. 在右側打開 `API` 分頁。
3. 在 `parent` 欄位填入 `properties/<GA4_PROPERTY_ID>`。
4. GA4 property ID 可從 GA4 URL 取得，例如 `analytics.google.com/analytics/web/#/pXXXXXXXXX` 中的 `XXXXXXXXX`。
5. 在 `Request body` 貼上 access binding JSON。
6. 點 `Execute`，用具有該 GA4 property `Administrator` 權限的人類 Google 帳號登入。
7. 回傳 `200`，且 response 內有 service account email 與 roles，代表加入成功。
8. 回到 GA4 `Admin` > `Property Access Management` 確認 service account 已出現在清單中。

若只是讀報表，可以使用社群回覆中的 `predefinedRoles/viewer`。本專案後續要用 service account 建立 custom dimensions，因此應使用 `predefinedRoles/editor`：

```json
{
  "user": "flickr-photo-finder@sitcon-324316.iam.gserviceaccount.com",
  "roles": ["predefinedRoles/editor"]
}
```

這個驗證不能用「尚未加入 GA4 property 的同一個 service account」執行，因為它還沒有管理 GA4 使用者的權限。如果 API 成功，日常 custom dimensions 同步才可以改用 service account 執行；如果 API 也拒絕 service account email，GA4 後台操作就先改以人類帳號或另行建立可被 GA4 UI 接受的 Workspace 身份處理。

### 使用 curl 驗證 access binding

若要不用 API Explorer，改用 CLI 驗證 access binding 路徑：

1. 請已具有該 GA4 property `Administrator` 的人類 Google 帳號操作。
2. 用 Google Analytics Admin API `properties.accessBindings.create` 建立 access binding。
3. OAuth scope 需要 `https://www.googleapis.com/auth/analytics.manage.users`。
4. parent 使用 `properties/<GA4_PROPERTY_ID>`。
5. request body 的 `user` 填 service account email，`roles` 填 `predefinedRoles/editor`。

範例 request：

```json
{
  "user": "flickr-photo-finder-writer@PROJECT_ID.iam.gserviceaccount.com",
  "roles": ["predefinedRoles/editor"]
}
```

可由具有 GA4 `Administrator` 的人類帳號用 OAuth access token 執行一次：

```bash
ACCESS_TOKEN="$(gcloud auth print-access-token)"
GA4_PROPERTY_ID="填入 GA4 property ID"
SERVICE_ACCOUNT_EMAIL="flickr-photo-finder-writer@PROJECT_ID.iam.gserviceaccount.com"

curl -X POST \
  "https://analyticsadmin.googleapis.com/v1alpha/properties/${GA4_PROPERTY_ID}/accessBindings" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"user\": \"${SERVICE_ACCOUNT_EMAIL}\",
    \"roles\": [\"predefinedRoles/editor\"]
  }"
```

如果這個 API 回傳 permission / forbidden，代表執行 OAuth 的人類帳號不是該 GA4 property 的 `Administrator`，或該 access token 沒有 `analytics.manage.users` scope。此時需要由真正的 GA4 administrator 重新登入並取得正確 scope 後執行。

## 本機 CLI 驗證前置條件

在 repo 工具可以操作 GA4 前，需要：

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

credential 檔案不能 commit，也不應放在 repo 目錄、`tmp/`、issue 或 PR 內容中。

後續 GA4 CLI 應使用同一個環境變數，不另行引入個人 OAuth token 或瀏覽器登入狀態。

CLI 也需要 GA4 property ID。property ID 不是 measurement ID；它是 GA4 URL `analytics.google.com/analytics/web/#/pXXXXXXXXX` 中的 `XXXXXXXXX`。

本專案已在 `config/project.json` 的 `frontend.ga4PropertyId` 設定預設 property ID `536884920`。這不是 secret；credential 才是 secret。日常檢查可直接執行：

```bash
pnpm analytics:dimensions:check
```

若需要暫時操作其他 property，可用 `--property <id>` 或 `GA4_PROPERTY_ID=<id>` 覆寫 repo 預設值。

## Custom dimensions 原則

GA4 後台只註冊低基數 event-scoped custom dimensions，例如：

- `result_count_bucket`
- `search_surface`
- `has_filters`
- `has_search_term`
- `task_mode`
- `recommended_use`
- `sort_mode`
- `public_use_status`
- `priority_level`
- `curation_status`
- `sponsorship_filter_used`
- `album_filter_used`
- `collection_filter_used`
- `mood_filter_used`
- `scene_filter_used`
- `people_count_filter`
- `subject_type`
- `orientation_filter`
- `safe_crop_filter`
- `image_size`

這份清單的 repo source of truth 是 `config/ga4-custom-dimensions.json`。

不要註冊以下高基數或不穩定參數：

- `photo_id`
- `content_id`
- `album_id`
- `album_title`
- `search_term`
- `result_rank`

這些參數仍可送進 GA4 event；只是不要註冊成 GA4 custom dimensions。若未來需要逐筆分析照片互動或搜尋字串，應改用 BigQuery raw events 或匯出資料分析。

## Custom dimensions CLI

檢查 GA4 後台和 repo 設定的差異：

```bash
pnpm analytics:dimensions:check
```

這個指令只會列出：

- repo 預期且 GA4 已存在的 dimensions。
- repo 預期但 GA4 缺少的 dimensions。
- GA4 後台存在但不由 repo 管理的 extra dimensions。

建立缺少的 dimensions：

```bash
pnpm analytics:dimensions:sync -- --write
```

這個指令只會建立缺少的 custom dimensions，不會修改、刪除或 archive 既有 GA4 設定。重複執行應該是 idempotent。

若出現 permission / forbidden，先確認：

- service account 已出現在 GA4 `Admin` > `Property Access Management`。
- service account 角色是 `Editor`，不是只有 `Viewer`。
- Google Cloud project 已啟用 Google Analytics Admin API。
- 執行工具的 process 有設定 `GOOGLE_APPLICATION_CREDENTIALS`。

## 目前完成狀態

截至 2026-05-11，本專案 repo 端已完成：

- GA4 measurement ID 已設定在 `config/project.json` 的 `frontend.ga4MeasurementId`。
- GA4 property ID 已設定在 `config/project.json` 的 `frontend.ga4PropertyId`，供 GA4 Admin API 與 custom dimensions CLI 使用。
- service account 已可依 API Explorer workaround 加入 GA4 property。
- `config/ga4-custom-dimensions.json` 已定義低基數 event-scoped custom dimensions。
- 前端已送出任務模式、搜尋、篩選、零結果、載入更多、照片操作、候選清單與 AI 助手找圖入口事件；事件設計以 `docs/frontend-analytics-design.md` 為準。
- `pnpm analytics:dimensions:sync -- --write` 已可使用 repo 預設 property ID 將缺少的 custom dimensions 同步到 GA4。也可以用 `--property` 或 `GA4_PROPERTY_ID` 暫時覆寫；目前 repo 不把 property ID 當成 secret。

日後維護者應先用 dry-run 檢查 GA4 後台是否仍和 repo 設定一致：

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
pnpm analytics:dimensions:check
```

若輸出有 missing dimensions，確認差異後再執行：

```bash
pnpm analytics:dimensions:sync -- --write
```

## 事件驗收清單

每次前端 analytics 事件有調整，或 GA4 後台設定完成後，應至少手動驗收一次：

1. 開啟 finder 頁面，確認 GA4 Realtime 有目前使用者或 page view。
2. 切換任務模式，確認收到 `finder_task_select`，且 `task_mode` 與 `surface` 正確。
3. 點擊照片圖片或 detail 入口，確認收到 `finder_photo_preview`，且帶有 `task_mode`、`sort_mode`、`curation_status`、`public_use_status` 與 `surface`。
4. 加入與移出候選，確認收到 `finder_candidate_add`、`finder_candidate_remove`，且 `candidate_count` 與 `surface` 正確。
5. 複製候選清單，確認收到 `finder_candidate_copy`，且 `candidate_count`、`copy_template` 與 `surface` 正確。
6. 使用 AI 助手找圖入口，確認開啟 Sheets 收到 `finder_ai_sheet_open`，複製提示詞收到 `finder_ai_prompt_copy`。
7. 在 desktop 與 mobile 各驗收一次，確認 `surface` 分別為 `desktop` 與 `mobile`。

React 版目前不送完整搜尋字串、完整 filter JSON、逐張 photo id 或 2026-05-13 前 vanilla 事件。若後續重新加入搜尋、篩選、load more、source action 或 zero result 事件，需先更新 `docs/frontend-analytics-design.md`、`config/ga4-custom-dimensions.json` 與本清單。

Realtime 可用來快速確認事件名稱與單次事件參數；正式報表與 Exploration 通常需要等待 GA4 處理完成。

## 建立初始報表

建議先使用 GA4 `Explore` > `Free form`，不要先自訂標準 Reports。

在 Variables 先 import 這些 dimensions：

- `Event name`
- `Curation status`
- `Public use status`
- `Recommended use`
- `Result count bucket`
- `Image size`
- `Search surface`
- `Task mode`
- `Surface`
- `Copy template`

在 Metrics import：

- `Event count`
- `Total users` 或 `Active users`

### 搜尋結果品質

用途：找出哪些工作情境常常沒有結果或結果太少。

- Rows: `Recommended use`, `Result count bucket`
- Values: `Event count`
- Filter: 目前 React 版尚未送搜尋/篩選結果事件；待事件重新設計後再建立此探索表。

注意：`Recommended use` 是使用者選擇的用途篩選值，不是照片本身的 `recommended_uses`。

### 取圖意圖

用途：觀察接近取用或討論流程的互動，是否集中在尚未整理或被標成不建議的照片。

- Rows: `Event name`, `Curation status`, `Public use status`
- Values: `Event count`
- Filter: 目前 React 版以 `finder_photo_preview` 與 `finder_candidate_copy` 作為接近取用/討論的早期訊號；source action 事件待重新設計。

### 候選清單與 AI 助手入口

用途：觀察使用者是否把找圖結果帶入跨人討論，或改用自己的 AI / LLM 讀公開 Sheets 找照片。

- Rows: `Event name`, `Task mode`, `Curation status`, `Public use status`
- Values: `Event count`
- Filter: `Event name` matches `finder_candidate_add|finder_candidate_remove|finder_candidate_copy|finder_ai_sheet_open|finder_ai_prompt_copy`

### 原圖需求

用途：判斷使用者是直接下載大圖，還是接近取得原始解析度。

- Rows: `Image size`, `Curation status`, `Public use status`
- Values: `Event count`
- Filter: `Event name` matches `download_image_size|open_image_size`

### 目前不做的報表

目前不要在 GA4 UI 建逐張照片排行榜或原始搜尋字串排行榜。

- `photo_id`、`content_id`、`search_term`、`result_rank` 有送進 event，但沒有註冊成 custom dimensions。
- 這些值屬於高基數或不穩定資料，若需要逐筆分析，應改用 BigQuery raw events、Data API 匯出，或和 Google Sheets 離線 join。

## BigQuery 暫不自動化

目前先不把 BigQuery link 納入 CLI 自動化。

原因：

- 建立 GA4 to BigQuery link 需要更高的 Google Cloud project 權限。
- BigQuery link 和 custom dimensions 是不同風險層級。
- Photo Finder 目前可先用 GA4 Realtime、DebugView 與低基數 custom dimensions 驗證事件設計。

等真的需要逐筆 `photo_id` 或 raw `search_term` 分析時，再評估開啟 daily export；不要先開 streaming export。
