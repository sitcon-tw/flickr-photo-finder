# 資料庫與協作維護策略

## 目的

這份文件記錄 SITCON Flickr Photo Finder 的資料庫方向。此工具的資料可以對外公開，但必須讓 SITCON 籌備團隊的志工容易維護、交接與共同整理。

這裡的「資料庫」不只指一套正式資料庫軟體，而是指照片索引資料的權威來源、驗證方式、協作流程、agent 維護方式與未來遷移路徑。

## 核心決策

MVP 階段採用 Google Sheets-first 架構：

- Google Sheets 是正式照片索引資料庫，也是主要人工維護介面。
- Repo 是治理與工具層，保存 schema、taxonomy、validation、匯入工具、Apps Script 來源、AI prompt 與操作文件。
- `data/photos.csv` 目前只是 MVP sample、local fixture 與未來 Sheets 匯出格式參考，不是正式資料來源。
- 若 Sheets 與 repo 內 sample data 發生衝突，以 Sheets 為準。
- 正式 Sheets 表格設計記錄在 `docs/google-sheets-database-design.md`。

這個選擇的重點是讓非技術背景志工可以直接理解、篩選與維護資料，同時保留技術志工與 agent 可重跑、可驗證、可交接的工具鏈。

## 團隊協作前提

SITCON 籌備團隊由不同職能的志工共同維護內容。找圖需求可能來自宣傳、行銷、設計、網站、公關、行政、議程或活動紀錄等角色，但不一定每個人都熟悉程式開發或資料庫操作。

因此資料庫設計必須優先滿足幾件事：

- 不把維護門檻綁死在工程背景。
- 讓不同組別能用自己的工作語言找照片。
- 讓資料修改可以被檢查、討論、回溯。
- 讓公開資料邊界清楚。
- 讓未來年度或新活動可以接續維護，而不是重做一套。
- 讓未來的 AI/agent 能讀懂 repo，知道如何協助資料維護。

## Repo 的角色

Repo 不保存正式照片資料，但仍然是這個工具能長期維護的關鍵。

Repo 應保存：

- 欄位 schema 與欄位文件。`data/photo-schema.json` 是 Google Sheets、CSV 匯出、Apps Script 與 CLI 共用的機器可讀欄位定義。
- 受控標籤與列舉值。
- 贊助品項固定版本資料。
- 資料驗證規則。
- Flickr 相簿掃描與匯入工具。
- 以官方 Google Sheets API SDK 實作的匯入、匯出、同步工具。
- Apps Script 原始碼或產生器。
- AI prompt、AI 初標流程與人工覆核規則。
- 給 agent 與技術志工的操作文件。

Repo 不應保存：

- Google API credential。
- OAuth client secret、refresh token 或 SDK token cache。
- rclone token。
- 正式 Google Sheets 權限資訊。
- 任何需要交接但不應公開的機密。

權限、credential 與 Google Drive 資產交接應接上 SITCON 既有文件與 Google Drive 管理制度。Repo 只需提供本專案的資產地圖與操作脈絡，不重新發明 SITCON 的交接制度。

## Sheets 的角色

Google Sheets 是正式資料庫與人工編輯介面。

Sheets 應支援：

- 非技術志工直接整理照片。
- 欄位下拉選單與格式提示。
- 用篩選檢視處理 `unreviewed`、`ai_labeled`、`needs_review`、贊助品項、素材包等工作佇列。
- 透過 Google Sheets 版本紀錄復原誤操作。
- 透過 Apps Script 提供即時提醒與欄位輔助。

Sheets 中的資料語意必須存在欄位值，不應依賴顏色、註解、排序、篩選狀態或合併儲存格。這樣未來才能穩定匯出成 CSV、JSON、SQLite 或 PostgreSQL。

## Apps Script 的角色

Apps Script 適合做編輯輔助，不應成為另一套資料治理來源。

適合放在 Apps Script 的功能：

- 從 `data/photo-schema.json` 與 repo taxonomy 產生欄位下拉選單。
- 檢查必填欄位、受控字彙與常見格式錯誤。
- 在 `reviewed` 缺少必要欄位時提醒。
- 協助開啟 Flickr 原始連結或顯示縮圖。
- 顯示目前使用的 schema/taxonomy 版本。

Apps Script source 應保存在 repo，並透過 `clasp` 部署到 Google Apps Script。`clasp` 是部署工具，不是資料治理來源；規則仍應來自 repo schema 與 taxonomy。

不適合由 Apps Script 承擔的功能：

- 大量 Flickr 相簿掃描。
- 大量 AI 標註。
- 權限敏感操作。
- 會產生成本或大量外部 API 呼叫的流程。

Apps Script 的規則來源應來自 `data/photo-schema.json`、`data/tag-taxonomy.json` 與其他 repo 設定，repo validation 仍是最後的權威檢查。

## GitHub Pages 的角色

GitHub Pages 適合做公開、唯讀、無登入門檻的檢索前端，讓更多人能夠搜尋與使用照片索引。

GitHub Pages 不應直接操作資料庫，也不應保存任何 secret 或 credential。它應讀取 Google Sheets `photos` 主表，或讀取由 `photos` 以同一套欄位匯出的公開 CSV/JSON。

更完整的公開前端資料流記錄在 `docs/public-frontend-architecture.md`。

MVP 不建立額外的公開篩選表。未 review 的照片仍可被搜尋，但前端與 AI 應使用 `curation_status`、`public_use_status`、`priority_level` 與 `collections` 做排序與提醒。

## AI 輔助原則

AI 可以在資料匯入階段協助初標，但不應取代人工判斷。

建議流程：

1. 技術志工或 agent 用 repo 工具匯入 Flickr 相簿資料。
2. AI 讀取照片縮圖與既有脈絡，產生初步欄位內容。
3. AI 產生結果寫入正式欄位前，必須讓人類看到差異並確認是否取代。
4. AI 輔助後的資料狀態應是 `ai_labeled`。
5. 具有 Sheets 編輯權限的志工檢核並修正後，才能把 `curation_status` 改成 `reviewed`。若公開使用判斷合適，再把 `public_use_status` 設為 `approved`。

不另外拆分 AI 欄位是為了降低資料表複雜度；因此 `curation_status` 的語意必須清楚。`ai_labeled` 代表資料曾經由 AI 協助，但尚未完成人工確認。

`curation_status` 只描述資料是否經過人工確認，不描述推薦優先度。優先推薦由 `priority_level`、`collections` 或素材包判斷；不建議推薦使用由 `public_use_status = avoid` 判斷。

外部 AI 如何解讀照片索引資料，記錄在 `docs/ai-readable-dataset.md`。

## 公開資料邊界

目前正式資料預設可以公開，但仍應避免把不適合公開的內容放進 Sheets。

可以公開的資料包含：

- Flickr 照片 ID、公開連結與縮圖。
- 活動、年份、相簿等公開脈絡。
- 攝影師署名與授權資訊。
- 場景、氛圍、用途、贊助品項、素材包等搜尋索引。
- 公開使用狀態與整理狀態。
- 可公開閱讀的整理備註。

應避免放進公開資料的內容包含：

- 對特定人物的負面描述或敏感判斷。
- 未公開的贊助、合作、議程或內部決策資訊。
- 會讓照片主體被不必要識別、標記或推論的細節。
- 只適合內部溝通的評論。

`curation_notes` 是公開整理備註欄位，只適合記錄可公開閱讀的整理脈絡、注意事項或使用建議。若某段內容只適合內部討論，就不應寫進這個欄位。

### 已寫入不適合公開內容時

若發現 Google Sheets、公開匯出或 repo fixture 中已經出現不適合公開的內容，應優先降低擴散，而不是把敏感文字複製到更多地方。

處理流程：

1. 直接在正式 Google Sheets 將敏感內容刪除或改寫成可公開的描述。
2. 若內容也已出現在 repo fixture、文件、issue、PR 或其他公開位置，同步移除或改寫。
3. 不要在 commit message、issue、PR、文件或 AI 對話摘要中重貼原始敏感內容。
4. 若需要留下維護紀錄，只記錄「已移除不適合公開的內容」與受影響欄位，不記錄原文。
5. 若需要查明何時寫入或由誰處理，使用 Google Sheets 版本紀錄與 SITCON 既有文件、權限和交接制度。
6. 修正後重新匯出或同步資料，並執行 repo validation 或等價的 Apps Script 檢查。

若內容涉及組織權限、合作關係、個人資料或其他高敏感情境，應交由 SITCON 既有權責流程處理；此 repo 不建立私密通報資料庫，也不保存非公開內容。

## 志工維護方式

MVP 階段應支援兩種維護路徑：

1. 非工程向維護：直接在正式 Google Sheets 補資料、篩選、檢核與調整狀態。
2. 工程向維護：透過 repo 工具掃描 Flickr 相簿、批次匯入、跑 AI 輔助、匯出驗證，並以官方 Google Sheets API SDK 同步回 Sheets。

無論哪一種路徑，正式寫回前都應盡可能經過 repo validation 或等價的 Apps Script 檢查。若兩者檢查結果不同，以 repo validation 為準，並回頭修正 Apps Script 規則來源。

## 欄位設計原則

欄位應該服務真實工作流程，不應只為了資料完整而增加。

新增欄位前應先確認：

- 這個欄位會被哪個角色拿來搜尋、篩選或判斷？
- 這個欄位是否能由志工穩定判斷？
- 這個欄位是否適合公開？
- 它是所有照片都需要，還是只適合特定素材包或任務？
- 是否可以先用 `collections`、`curation_notes` 或既有標籤觀察需求？

若欄位只對少數情境有用，應先記錄在文件或素材包流程，不急著變成主資料欄位。

## 未來正式資料庫路徑

若資料量、協作人數或查詢需求超過 Google Sheets 能承受的範圍，可以再導入正式資料庫。

可能路徑：

- PostgreSQL：適合已有正式後台、多人線上編輯、權限控管與 API 需求時使用。
- SQLite：適合仍以 repo 為主、需要更穩定查詢與轉換時使用。
- Airtable 或類似工具：適合非工程志工大量維護，但需要接受外部服務與資料同步成本。

不論未來選哪一種，公開資料輸出都應維持穩定格式，讓搜尋介面、文件與其他工具不必跟著後台實作大幅改寫。

## 判斷何時升級

出現以下情況時，再認真評估 Google Sheets 之外的正式資料庫：

- 多位志工需要更細緻的權限或審核流程。
- 公開索引與非公開審核資訊必須分層。
- 查詢需求超過靜態前端或 Sheets 篩選能合理處理。
- 需要記錄每筆照片的審核歷程、負責人或狀態流轉。
- 需要提供穩定 API 給其他 SITCON 網站或工具使用。

在這些情況出現前，MVP 的重點仍應放在資料品質、標籤是否符合真實需求，以及志工是否能持續維護。

## 目前結論

現階段應把 Google Sheets 視為正式照片索引資料庫，把 repo 視為治理與工具層。

下一步不是先導入 PostgreSQL 或完整後台，而是讓 Sheets-first 流程更容易被志工和 agent 維護：

- 保持欄位清楚。
- 用 repo validation 保護資料品質。
- 讓 Apps Script 從 repo 設定取得規則。
- 用文件說明欄位判斷方式。
- 用搜尋介面支援待整理與實際找圖。
- 讓 AI/agent 能協助匯入、初標、驗證與同步，但不取代人工確認。
