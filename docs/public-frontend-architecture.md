# 公開搜尋前端架構

## 目的

這份文件記錄公開唯讀照片搜尋前端的方向。

Google Sheets 是正式照片索引，Apps Script 可以作為具有授權的維護輔助介面；但更多使用者只需要能夠存取、搜尋與篩選照片，不需要編輯資料。公開搜尋前端應部署到 GitHub Pages，降低使用門檻。

Apps Script Web App 是另一個授權後的校對入口，適合需要批量瀏覽、編輯與儲存 metadata 的整理者。它不作為 GitHub Pages 的資料 API，也不讓公開前端取得寫入能力。

## 核心決策

- GitHub Pages 前端是公開、唯讀、無登入門檻的搜尋介面。
- 資料來源仍是 Google Sheets，不是 repo 內 sample data。
- GitHub Pages 前端不保存 secret，也不使用需要私人 credential 的 Google API。
- 1.0 階段 GitHub Pages 直接讀取 Google Sheets `photos` 工作表的公開 CSV 輸出。
- 公開 CSV 只是 `photos` 主表的傳輸格式，不是另一張篩選表或 curated subset。
- Apps Script 保留為授權維護介面與欄位驗證工具，不負責建立額外篩選表。
- Apps Script Web App 可以提供可寫入的校對 UI，但 GitHub Pages 不呼叫它，也不共用其授權狀態。

## 建議資料流

```text
Google Sheets
  photos              照片索引主表，公開可讀
  taxonomy            受控字彙
  sponsorship_items   贊助品項

Apps Script
  欄位驗證
  編輯輔助
  檢查 photos 公開讀取格式
  Web App 校對介面

GitHub Pages
  唯讀搜尋 UI
  讀取 photos 公開 CSV

專案工具與原始碼
  schema
  taxonomy
  validation
  CLI
  AI prompt
  Apps Script source
  GitHub Pages UI
```

## 為什麼不建立額外公開表

目前照片索引的目標是替 Flickr 照片加註 metadata，讓人類、前端與 AI 可以依欄位自行挑選。它不是要在索引內先做出另一層篩選結果。

因此 1.0 不建立 `photos` 之外的公開篩選表。公開前端可以直接讀 `photos`，或讀由 `photos` 匯出的同欄位 CSV/JSON。

這個設計的好處：

- 不會讓維護者以為有兩份照片資料需要同步。
- 不會讓 AI 誤以為公開匯出已經替它篩選過照片。
- 未整理照片仍可被搜尋，但會透過 `curation_status`、`priority_level` 與 `public_use_status` 等欄位排序與提示。`public_use_status` 是整理提醒，不是 Flickr 照片是否公開的判斷。
- 若未來真的需要隱藏欄位或拆分公開/非公開資料，再重新設計資料邊界。

前端不應依賴 Sheets 的顏色、註解、排序或篩選檢視。所有可搜尋、可排序、可提醒的語意都應來自欄位值。

## 1.0 資料讀取方式

1.0 採用 Google Sheets 公開 CSV URL：

```text
https://docs.google.com/spreadsheets/d/<spreadsheetId>/gviz/tq?tqx=out:csv&sheet=photos
```

`pnpm finder:build` 會依 `config/project.json` 的 `googleSheets.spreadsheetId` 產生部署版 `config.js`，並把 `photosCsvUrl` 指向上述公開 CSV URL。

採用這個方式的理由：

- GitHub Pages 可以直接用 browser `fetch()` 讀取，不需要 API key、OAuth 或 service account。
- 前端 artifact 不需要保存 credential，符合公開唯讀介面的安全邊界。
- Apps Script 仍可專注在授權後的 Sheets 維護輔助，不需要額外提供公開 API。
- 資料治理仍回到 `photos` 主表、repo schema、taxonomy、validation 與 Apps Script 檢查，不會多出另一套公開資料規則。

1.0 GitHub Pages 暫不採用以下方式：

- Google Sheets API from browser：會引入 API key / OAuth / quota 等前端不需要承擔的問題。
- Apps Script Web App API：公開前端不透過 Apps Script 讀寫資料；Web App 只作為授權校對介面存在。
- GitHub Actions 以 service account 匯出靜態資料：可作為未來選項，但 1.0 先避免 GitHub Secrets 與部署時資料快照同步問題。

## 上線前準備

使用 GitHub Pages 讀取正式 Google Sheets 前，維護者需要確認：

- `config/project.json` 已填入正式公開 Google Sheets 的 `googleSheets.spreadsheetId`。
- 正式 Google Sheets 已允許知道連結的人唯讀存取，或以其他方式讓公開 CSV URL 可以匿名讀取。
- `photos` 工作表名稱固定為 `photos`，header 順序符合 `data/photo-schema.json`。
- `photos` 不含敏感內部資訊；`curation_notes` 也視為公開欄位。
- Sheets 中所有可供篩選、排序、提醒的語意都寫在欄位值中，不依賴顏色、註解或篩選檢視。
- GitHub repository Settings > Pages 的來源設定為 GitHub Actions。
- `pnpm finder:build` 可以成功產生 `tmp/pages/`。
- 產生出的公開 CSV URL 能以匿名 HTTP request 讀到 `photos` header。

若其中任一項不成立，應先修正 Google Sheets 權限、header 或 repo 設定，不要在 GitHub Pages 前端加入 credential 或 fallback 寫入邏輯。

## 前端資料來源設定

本機開發前端應明確選擇資料來源，不應靠 `app/config.js` 和部署 artifact 的隱含差異判斷：

- `pnpm finder:dev`：預設讀正式 Google Sheets `photos` 公開 CSV，適合真實資料規模下的 UX、排序、篩選與效能檢查。
- `pnpm finder:dev:fixture`：讀 `fixtures/photos.csv`，適合最小樣本、離線 smoke test 與 regression 檢查。
- `pnpm finder:dev:export`：讀 `tmp/sheets-export/photos.csv`，適合使用最近一次正式 Sheets 匯出快照開發；若檔案不存在，先執行 `pnpm sheets:export`。

這三種入口都會先產生本機 dev artifact，預設放在 `tmp/pages-dev/<source>/`，並在 terminal 印出 `Data source` 與實際 `Photos CSV URL`。部署到 GitHub Pages 時，仍使用 `pnpm finder:build` 產生 `tmp/pages/`，讓 `photosCsvUrl` 指向 `config/project.json` 中 `googleSheets.spreadsheetId` 的 Google Sheets `photos` 公開 CSV 輸出。

前端可以讀公開資料 URL，但不能使用任何需要保密的 token、API key 或 OAuth credential。

## 前端模組邊界

公開前端維持原生 ES modules，不導入 bundler 或成熟前端 framework。目前的拆分原則是 Functional Core / Imperative Shell：

- `app/search-sort.js` 是可測試純函式核心，負責 search text、篩選、scoring、推薦排序與探索排序；不得直接讀 DOM 或全域控制項。
- `app/url-state.js` 負責 URL query encode/decode；selected ids、filters 與 sort deep link 行為應先在這裡調整。
- `app/analytics.js` 負責 GA4 setup、事件參數整理、搜尋字串清理與結果追蹤去重；前端其他模組只呼叫 `trackEvent` 或傳入 snapshot。
- `app/ai-assistant.js` 負責 AI 助手提示詞與事件參數的純資料組裝，不處理 clipboard 或 DOM。
- `app/candidates.js` 負責候選清單資料選取、markdown 與候選清單 DOM render；不改變搜尋或排序結果。
- `app/data-loader.js` 負責讀取 project config、schema、taxonomy、search aliases 與 `photos` CSV，並依 schema 正規化 list 欄位、sheet row number 與 `search_text`。
- `app/controls.js` 負責查詢 DOM controls/elements、建立可搜尋 select/autocomplete、填入篩選選項、任務模式按鈕與 active filter entry。控制項狀態仍由 `main.js` 組合進 render loop。
- `app/overview-render.js` 負責索引概覽統計與 DOM render；統計規則應從 `photoSchema`、`option_labels` 與照片資料推導。
- `app/photo-render.js` 負責主照片卡、Flickr / Finder / Sheets 連結、圖片尺寸下載、狀態 badge、排序訊號與卡片內 action。它接受目前 task/search/sort state 與 callback，不自行讀全域控制項。
- `app/result-render.js` 負責結果狀態文字、active filter chips、task mode active state、load-more panel 與 empty state。
- `app/main.js` 保留 bootstrap、專案設定套用、state、URL state、資料載入順序、事件 wiring 與 render loop 組合。新增前端行為時，先判斷是否屬於上述模組；只有跨模組協調才留在 `main.js`。

新增前端模組時，需同步 `scripts/commands/build-pages.mjs` 與 `scripts/commands/check-pages-artifact.mjs`，確保 GitHub Pages artifact 包含新檔案。可測試的純邏輯應加入 `pnpm finder:test`，並納入 `pnpm project:check`。

公開前端右上角的外部連結由 `config/project.json` 控制。除了 Flickr 來源連結，也應提供 GitHub 專案連結，讓使用者能回到 repo 了解專案細節或回報問題。

公開前端除了照片卡片搜尋，也應提供索引概覽，協助維護者快速判斷目前索引整理成效。概覽應優先使用 `data/photo-schema.json` 與 `data/tag-taxonomy.json` 理解欄位與必要規則，例如整理狀態、使用提醒、人數標記、reviewed 必要欄位完整度與贊助欄位覆蓋率，不應在前端另外維護一份欄位規則或 raw value 翻譯表。前端顯示文字應使用 `data/tag-taxonomy.json` 的 `option_labels`，但篩選值、URL 參數與資料比對仍使用 raw value。

公開前端遇到選項可能偏長的篩選欄位，例如活動/相簿、場景、素材包、贊助品項，應使用頁面內可搜尋的選單或 autocomplete，不依賴瀏覽器原生 `<select>` / `<datalist>` 彈出層。原生彈出層由瀏覽器與作業系統控制，長列表在小視窗或特定環境中可能出現 fallback 呈現，難以用 CSS 穩定修正。實作上仍可保留原本欄位值作為篩選狀態來源，但使用者操作層應提供可搜尋、可捲動且不離開頁面布局的選單。贊助品項仍應保留輸入片段文字搜尋的能力，不應被限制成只能選擇完整品項名稱。

面對上千或上萬張照片時，公開前端應以「工作任務」作為初始心智模型，而不是只提供欄位表單。任務模式可以調整推薦排序權重，但不應隱藏資料；使用者仍可透過活動/相簿、使用提醒、整理狀態、構圖、留白、裁切、贊助品項與素材包等欄位自行收斂結果。結果狀態列應清楚說明任務模式是排序情境，不是硬篩選。

活動/相簿篩選應使用 `album_ids` 作為主要判斷，並以 `event_year`、`event_name` 與 `album_title` 組成可讀選項文字；若舊資料沒有 `album_ids`，才退回用 `album_title` 比對。這是硬篩選，服務已知道目標活動或相簿的使用者，不應取代任務模式或文字搜尋。

照片卡片第一屏應顯示可複製的 `photo_id`，讓已經打開 Google Sheets 的資料維護者能快速貼到搜尋框找到同一列進行編輯。若有具體排序訊號，可以在 `photo_id` 後補上 `用途命中`、`橫式`、`16:9`、`有留白`、`高優先` 等短提示；整理狀態應留在上方狀態 badge，不應重複當作排序提示。若沒有具體訊號，不應顯示「符合目前排序條件」這類無法協助維護的 fallback 文字。

前端應提供 `推薦排序` 與 `探索更多` 兩種主要排序心智。`推薦排序` 保持找圖效率，優先呈現最符合任務、整理狀態較可靠、優先度較高的照片；`探索更多` 則在仍維持基本可用性的前提下，穩定分散年份、活動、相簿與素材包來源，避免所有人只看到同一小批高分照片。`探索更多` 不是正式使用頻率治理，也不應依賴隨機排序。

公開前端也應提供「用 AI 助手找照片」的輔助入口，讓宣傳、設計、網站、公關、行銷等工作需求使用者，把正式 `photos` 工作表交給自己熟悉的 AI 助手，以自然語言探索還不能被固定篩選條件描述的需求。這個入口應放在候選清單附近，提供正式 Sheets 連結與可複製提示詞；提示詞應帶入目前任務模式、搜尋字串與已套用篩選，並提醒使用者若 AI 助手不能直接讀取 Google Sheets，就改提供 `photos` CSV。提示詞也應要求 AI 助手不要只找 `reviewed` 照片、不要自行推測缺失欄位。

候選清單只存在瀏覽器當下狀態與 URL query，不寫回 Google Sheets。清單畫面應提供縮圖，避免只用 photo id 要求使用者記憶照片；複製出的清單應依用途分成不同格式。預設 IM 討論版應只保留編號與 Flickr URL，方便使用者在聊天工具中回覆「選第幾張」，必要時才附上簡短使用提醒。協作檢查版則應包含整批 Finder 清單連結、Google Sheets 列連結、Flickr URL、整理狀態與使用提醒，服務資料維護與跨角色檢查。純 Flickr URL 版應只輸出每張照片的 Flickr URL，方便工具或文件貼上。

Google Sheets 列連結應貼近 Google Sheets UI 的「Get link to this cell」格式：`edit?gid=<sheetId>#gid=<sheetId>&range=A<row>`，例如正式 `photos` 工作表第 28 列是 `edit?gid=1663351240#gid=1663351240&range=A28`。`gid` 指定工作表，`range` 只放該工作表內的 cell，不要放 `photos!A28` 這種 sheet-qualified A1 notation。`photos` 的 sheet id 應記錄在 `config/project.json` 的 `googleSheets.photosSheetGid`。

公開讀取規則記錄在 `docs/google-sheets-database-design.md`，外部 AI 讀取方式記錄在 `docs/ai-readable-dataset.md`。

## GitHub Pages 部署注意事項

GitHub Pages 應透過 GitHub Actions 發布乾淨的 Pages artifact，不應直接把整個 repo root 當成 Pages source。

`pnpm finder:build` 產生的 artifact 應只包含：

- 公開搜尋前端所需的 HTML、CSS、JavaScript。
- 經過資料流程產生或指定的公開資料來源設定。
- `data/photo-schema.json`、`data/tag-taxonomy.json` 與 `data/search-aliases.json`，讓前端用同一份欄位、受控字彙、顯示文字與資料值搜尋同義詞來源理解資料。
- 必要的靜態資源。

artifact 不應包含：

- repo 內的工具腳本。
- 文件草稿或維護文件。
- sample / fixture data，除非該部署明確是 demo。
- credential、token 或任何需要交接但不應公開的設定。

前端檔案應使用相對路徑，避免專案頁部署在 `https://<org>.github.io/<repo>/` 時因絕對路徑失效。
HTML metadata 則需要 crawler 在執行 JavaScript 前就能讀到，因此 `pnpm finder:build` 會依 `config/project.json` 的 `frontend.metadata` 產生 `<title>`、description、canonical、Open Graph 與 Twitter card tags。`frontend.metadata.siteUrl` 應填正式對外發布網址，例如 `https://sitcon.org/flickr-photo-finder/`；`frontend.metadata.imagePath` 目前指向 artifact 內的 `assets/og-image.png`，讓分享預覽可以使用 1200x630 的正式活動照片拼貼。

目前 repo 內的 `.github/workflows/pages.yml` 會在 pull request 執行 build/check，並在 `master` push 或手動觸發時部署：

1. 安裝 pnpm dependencies。
2. 執行 `pnpm data:validate`。
3. 執行 `pnpm finder:build -- --output-dir tmp/pages`。
4. 執行 `pnpm finder:check -- --dir tmp/pages`，確認 artifact 真的包含前端與資料設定。
5. 非 pull request 時，上傳 `tmp/pages` 作為 GitHub Pages artifact。
6. 非 pull request 時，使用 GitHub Pages deploy action 發布。

目前 repository Pages 來源已設定為 GitHub Actions。維護時若 Pages 無法部署，應先確認 repository Settings > Pages 仍使用 GitHub Actions 來源，再檢查 `.github/workflows/pages.yml` 的 build/check/deploy 結果。

## 搜尋規模

GitHub Pages 前端目前仍一次讀取公開 CSV，但不可一次把所有照片卡片渲染到 DOM。前端應先替每筆照片建立可搜尋文字，再以 debounce 處理文字搜尋與篩選變更，並只渲染第一批結果。使用者需要看更多時再用 `載入更多` 增加顯示數量。

目前推薦排序會優先考慮：

- 任務模式對 `recommended_uses`、`mood_tags`、`scene_tags`、`sponsorship_tags`、`orientation`、`safe_crop`、`has_negative_space` 的權重。
- `curation_status`、`priority_level` 與縮圖 URL 是否存在。
- `public_use_status = avoid` 作為不建議提醒；`approved` 不應被當成 Flickr 公開性的主要訊號。

`探索更多` 排序會先沿用推薦排序的基本可用性，再用穩定的前端排序分散近期結果中的 `event_year`、`event_name`、`album_ids` 與 `collections`。它只改變瀏覽順序，不改變篩選條件，也不新增 Google Sheets 欄位。若未來要治理實際對外使用頻率，應另建正式使用紀錄或分析 GA4 raw events，不應把前端排序或 GA4 UI 報表當成使用事實。

若未來公開 CSV 體積或瀏覽器記憶體成為瓶頸，再評估：

- 在 build 階段產生靜態搜尋索引或分頁資料。
- 改用可匿名讀取的靜態 JSON 分片。
- 改用 API 或其他正式資料層；若採用 API，仍需維持公開唯讀與無 credential 的前端邊界。

## 殘餘風險

- Google Sheets 公開輸出 URL 的格式或 CORS 行為可能改變。
- Google Sheets 更新到公開匯出 URL 可能有延遲。
- 若 `photos` 欄位格式沒有驗證，前端可能載入不完整資料。
- 若前端直接讀太大的 CSV，載入速度會下降。

這些風險應由 Apps Script、repo validation 與同步工具共同處理，而不是讓 GitHub Pages 前端承擔資料治理責任。
