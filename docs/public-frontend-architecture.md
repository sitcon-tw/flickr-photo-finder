# 公開搜尋前端架構

## 目的

這份文件記錄公開唯讀照片搜尋前端的方向。

Google Sheets 是正式照片索引，Apps Script 可以作為具有授權的維護輔助介面；但更多使用者只需要能夠存取、搜尋與篩選照片，不需要編輯資料。公開搜尋前端應部署到 GitHub Pages，降低使用門檻。

Apps Script Web App 是另一個授權後的校對入口，適合需要批量瀏覽、編輯與儲存 metadata 的整理者。它不作為 GitHub Pages 的資料 API，也不讓公開前端取得寫入能力。

## 核心決策

- GitHub Pages 前端是公開、唯讀、無登入門檻的搜尋介面。
- 資料來源仍是 Google Sheets，不是 repo 內 sample data。
- GitHub Pages 前端不保存 secret，也不使用需要私人 credential 的 Google API。
- GitHub Pages 部署版預設讀取 build 階段產生的靜態搜尋 artifact，不在使用者瀏覽器端直接抓 Google Sheets CSV。
- Finder 是 Flickr 上方的照片索引輔助；搜尋、篩選與空結果不可作為 Flickr 照片不存在的判定，信任邊界見 `docs/adr/0007-finder-index-results-are-not-absence-proof.md`。
- 公開 CSV 仍只是 `photos` 主表的傳輸格式，不是另一張篩選表或 curated subset；runtime CSV 模式只作為開發與緊急 fallback。
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
  讀取靜態搜尋 index 與 detail shards

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

因此不建立 `photos` 之外的公開篩選表。部署版公開前端讀由 `photos` / `albums` 轉出的 static artifact；runtime CSV fallback 與外部唯讀工具可讀 `photos`，或讀由 `photos` 匯出的同欄位 CSV/JSON。

這個設計的好處：

- 不會讓維護者以為有兩份照片資料需要同步。
- 不會讓 AI 誤以為公開匯出已經替它篩選過照片。
- 未整理照片仍可被搜尋，但會透過 `curation_status`、`priority_level` 與 `public_use_status` 等欄位排序與提示。`public_use_status` 是整理提醒，不是 Flickr 照片是否公開的判斷。
- 若未來真的需要隱藏欄位或拆分公開/非公開資料，再重新設計資料邊界。

前端不應依賴 Sheets 的顏色、註解、排序或篩選檢視。所有可搜尋、可排序、可提醒的語意都應來自欄位值。

## 部署版資料讀取方式

部署版採用 build-time 靜態資料 artifact。`pnpm finder:build` 預設會依 `config/project.json` 的 `googleSheets.spreadsheetId` 讀取 Google Sheets 公開 CSV，將 `photos` 和 `albums` 轉成 `tmp/pages/data/finder-data/`：

```text
data/finder-data/
  manifest.json
  albums.json
  photos-index.json
  shards/photos-000.json
  shards/photos-001.json
  ...
```

`photos-index.json` 只保留搜尋、篩選、排序、卡片顯示與 shard 定位需要的欄位；完整 `photos` 欄位會依 `--shard-size` 分片寫入 detail shards。預設 `--shard-size 512` 代表每個 shard 最多包含 512 張照片的完整欄位。使用者開啟頁面時先讀 manifest、album catalog 與搜尋 index；打開預覽、複製需要完整欄位的候選格式時，才 lazy load 對應 detail shard。

採用這個方式的理由：

- 使用者瀏覽器不再依賴 Google Sheets 公開 CSV endpoint 的即時回應時間與 CORS 行為。
- 前端 artifact 不需要保存 credential，符合公開唯讀介面的安全邊界。
- build 階段產生的 JSON 能被 GitHub Pages/CDN 快取，並讓 index 與 detail 欄位分層，避免初始載入完整 40k 筆 detail。
- Apps Script 仍可專注在授權後的 Sheets 維護輔助，不需要額外提供公開 API。
- 資料治理仍回到 `photos` 主表、repo schema、taxonomy、validation 與 Apps Script 檢查，不會多出另一套公開資料規則。

部署版仍保留 `--data-mode runtime-csv` 作為 fallback：

```bash
pnpm finder:build -- --data-mode runtime-csv
```

runtime CSV 會讓瀏覽器直接讀取下列 Google Sheets 公開 CSV URL，適合緊急退回或確認 Sheets 公開輸出本身：

```text
https://docs.google.com/spreadsheets/d/<spreadsheetId>/gviz/tq?tqx=out:csv&sheet=photos
```

GitHub Pages 暫不採用以下方式：

- Google Sheets API from browser：會引入 API key / OAuth / quota 等前端不需要承擔的問題。
- Apps Script Web App API：公開前端不透過 Apps Script 讀寫資料；Web App 只作為授權校對介面存在。
- 使用 service account 從 browser 讀資料：credential 不得進入公開前端。若未來 GitHub Actions 需要用 service account 補強 build-time export，也必須只在 CI secret 邊界使用，產物仍是公開唯讀 static artifact。

## PWA 快取邊界

GitHub Pages Finder 可以註冊 service worker，讓已開啟過的公開搜尋前端在弱網路或離線時仍有基本可用性。這層 PWA 能力只處理公開唯讀 artifact，不新增安裝提示、不寫入 Google Sheets，也不串接 Apps Script Web App 或任何 credential。

部署版 service worker 的快取策略：

- app shell、JavaScript 模組、CSS、metadata image 與固定設定檔採快取優先並背景更新。
- `data/finder-data/manifest.json`、`albums.json`、`photos-index.json`、schema、taxonomy、search aliases 與 project config 採網路優先；網路失敗才退回快取。
- detail shards 採網路優先並只快取使用者實際打開過的 shard；離線時只能讀已快取過的照片 detail。
- 前端狀態文字會在離線或使用快取 fallback 時提示「使用已快取資料」，資料時間取自 finder-data manifest 的 `generatedAt`。

這個快取不是第二份資料庫。正式資料權威仍是 Google Sheets，部署 artifact 仍由 `pnpm finder:build` 從公開資料產生。`runtime-csv` 模式保留為開發與緊急 fallback，不承諾完整 PWA 離線體驗。

## 上線前準備

使用 GitHub Pages 讀取正式 Google Sheets 前，維護者需要確認：

- `config/project.json` 已填入正式公開 Google Sheets 的 `googleSheets.spreadsheetId`。
- 正式 Google Sheets 已允許知道連結的人唯讀存取，或以其他方式讓公開 CSV URL 可以匿名讀取。
- `photos` 工作表名稱固定為 `photos`，header 順序符合 `data/photo-schema.json`。
- `photos` 不含敏感內部資訊；`curation_notes` 也視為公開欄位。
- Sheets 中所有可供篩選、排序、提醒的語意都寫在欄位值中，不依賴顏色、註解或篩選檢視。
- GitHub repository Settings > Pages 的來源設定為 GitHub Actions。
- `pnpm finder:build` 可以成功產生 `tmp/pages/` 與 `tmp/pages/data/finder-data/`。
- 產生出的公開 CSV URL 能以匿名 HTTP request 讀到 `photos` header。

若其中任一項不成立，應先修正 Google Sheets 權限、header 或 repo 設定，不要在 GitHub Pages 前端加入 credential 或 fallback 寫入邏輯。

## 前端資料來源設定

本機開發前端應明確選擇資料來源，不應靠 `app/config.js` 和部署 artifact 的隱含差異判斷：

- `pnpm finder:dev`：預設讀正式 Google Sheets `photos` 公開 CSV，適合真實資料規模下的 UX、排序、篩選與效能檢查。
- `pnpm finder:dev:fixture`：讀 `fixtures/photos.csv`，適合最小樣本、離線 smoke test 與 regression 檢查。
- `pnpm finder:dev:export`：讀 `tmp/sheets-export/photos.csv`，適合使用最近一次正式 Sheets 匯出快照開發；若檔案不存在，先執行 `pnpm sheets:export`。

這三種入口都會先產生本機 dev artifact，預設放在 `tmp/pages-dev/<source>/`，並在 terminal 印出 `Data source` 與實際 `Photos CSV URL`。本機 dev 入口刻意使用 `runtime-csv`，方便直接對照 Sheets/fixture/export。部署到 GitHub Pages 時，使用 `pnpm finder:build` 產生 `tmp/pages/`，預設改為 `static-sharded`。

若要用最近一次正式 Sheets 匯出快照產生 static artifact，可執行：

```bash
pnpm finder:build -- --data-source export
```

若要量測目前 export 快照和 26k/40k 合成規模，可執行：

```bash
pnpm finder:perf
```

前端可以讀公開資料 URL，但不能使用任何需要保密的 token、API key 或 OAuth credential。

## 前端模組邊界

公開前端維持原生 ES modules，不導入 bundler 或成熟前端 framework。目前的拆分原則是 Functional Core / Imperative Shell：

- `app/search-sort.js` 是可測試純函式核心，負責 search text、篩選、scoring、推薦排序與探索排序；不得直接讀 DOM 或全域控制項。
- `app/url-state.js` 負責 URL query encode/decode；selected ids、filters 與 sort deep link 行為應先在這裡調整。Filter URL 使用重複 query 參數表示多選，例如 `scene=攤位&scene=會眾`；早期單值 query 格式不保證相容。
- `app/analytics.js` 負責 GA4 setup、事件參數整理、搜尋字串清理與結果追蹤去重；前端其他模組只呼叫 `trackEvent` 或傳入 snapshot。
- `app/ai-assistant.js` 負責 AI 助手提示詞與事件參數的純資料組裝，不處理 clipboard 或 DOM。
- `app/candidates.js` 負責候選清單資料選取、markdown 與候選清單 DOM render；不改變搜尋或排序結果。
- `app/data-loader.js` 負責讀取 project config、schema、taxonomy、search aliases 與 finder data source。`runtime-csv` 會讀 CSV 並正規化 list 欄位、sheet row number 與 `search_text`；`static-sharded` 會讀 compact index 並在需要完整欄位時 lazy load detail shard。
- `app/controls.js` 負責查詢 DOM controls/elements、建立可搜尋 multi-select / token autocomplete、填入篩選選項、任務模式按鈕、任務感知篩選分層與 active filter entry。控制項狀態仍由 `main.js` 的 finder state 組合進 render loop。
- `app/overview-render.js` 負責索引概覽統計與 DOM render；統計規則應從 `photoSchema`、`option_labels` 與照片資料推導。
- `app/photo-render.js` 負責主照片卡與照片預覽 dialog 的 render。主照片卡維持視覺優先，只呈現大圖、預覽入口與候選快速操作；photo id、整理狀態、Flickr / Finder / Sheets 連結、圖片尺寸下載與完整 metadata 應集中在預覽 dialog。它接受目前 task/search/sort state 與 callback，不自行讀全域控制項。
- `app/result-render.js` 負責結果狀態文字、active filter chips、task mode active state、load-more panel 與 empty state。
- `app/main.js` 保留 bootstrap、專案設定套用、state、URL state、資料載入順序、事件 wiring 與 render loop 組合。目前 preview action、候選清單 action menu、AI prompt copy 與 mobile sheet 手勢仍由 `main.js` 協調；新增或大幅修改這類 imperative interaction 時，應優先評估是否能抽成 controller module，不要把新的 domain logic 放回主檔。

新增由 `app/main.js` 可追蹤到的前端 ES module 時，`scripts/commands/build-pages.mjs` 與 `scripts/commands/check-pages-artifact.mjs` 會透過共用 import graph 自動複製與驗證；若新增的是非 JS 資源、資料檔或特殊產物，才需要同步 build/check 清單。可測試的純邏輯應加入 `pnpm finder:test`，並納入 `pnpm project:check`。

## Pages 維護 checklist

修改 Pages 前端前，先依影響範圍讀文件：

- 一般 Pages 變更：`docs/README.md` 與本文件。
- filter、task mode、URL key、狀態排序或跨介面 field set：再讀 `docs/shared-value-governance.md`，並從 `data/interface-registry.json` 修改 source of truth。
- GA4 event、custom dimension 或分析流程：再讀 `docs/frontend-analytics-design.md` 與 `docs/ga4-operations.md`。
- 歷史研究與驗收背景：只在需要理解設計脈絡時讀 `docs/research/public-frontend-agent-research.md`、`docs/research/public-frontend-mobile-research.md` 與 `docs/research/public-frontend-redesign-brief.md`；目前實作規格以本文件為準。搜尋信任邊界與空結果風險見 `docs/adr/0007-finder-index-results-are-not-absence-proof.md`，研究證據見 `docs/research/public-frontend-user-literacy-research.md`。

常見改檔對照：

- 搜尋、篩選、排序與 scoring：`app/search-sort.js`，測試放 `tests/pages-search-sort.test.mjs`。
- URL state、deep link、候選清單 URL：`app/url-state.js`。
- filter controls、enhanced select、task filter layout、active filter entry：`app/controls.js`；跨介面設定先改 `data/interface-registry.json`。
- task mode defaults 與 page size 等 registry fallback：`app/task-modes.js`。
- 照片卡片、preview dialog、照片 action：`app/photo-render.js` 與 `app/styles.css`。
- 候選清單輸出格式：`app/candidates.js`。
- AI 助手提示詞：`app/ai-assistant.js`。
- GA4 事件 shaping：`app/analytics.js` 與呼叫事件的 UI 模組；custom dimensions source of truth 是 `config/ga4-custom-dimensions.json`。
- 新增 `app/*.js` 模組：由 `app/main.js` 或其依賴模組 import；`finder:build` 與 `finder:check` 會共用 ES module import graph，避免 build/check 兩邊維護不同清單。

驗證門檻：

- 一般 Pages 邏輯變更：`pnpm finder:test`、`pnpm finder:build`、`pnpm finder:check`。
- 發布前或跨模組變更：`pnpm project:check`。
- mobile filter、bottom sheet、enhanced select 或小視窗互動：`pnpm finder:mobile-filter-smoke`。
- registry / shared values：`pnpm shared-values:check`；若影響 Apps Script generated config，再跑 `pnpm apps-script:build-config -- --check`。
- schema、taxonomy、fixture data 或 validation logic：`pnpm data:validate`。
- GA4 custom dimensions：`pnpm analytics:dimensions:check`；真的要同步後台才依 `docs/ga4-operations.md` 使用 `--write`。

常見陷阱：

- Pages 前端是公開唯讀，不加 credential，不寫 Google Sheets，不呼叫 Apps Script Web App 取得寫入能力。
- `fixtures/` 與 `tmp/sheets-export/` 不是 production data；真實資料來源仍是公開 Google Sheets。
- GitHub Pages 發布 `tmp/pages` artifact，不發布 repo root。
- 多選 filter URL 使用重複 query params，例如 `scene=攤位&scene=會眾`。
- 沒有命中目前索引不代表 Flickr 沒有相關照片；不要把空結果、篩選結果或任務模式寫成存在性判定。
- `public_use_status` 是使用提醒，不是 Flickr 是否公開；`curation_status = ai_labeled` 不等於人工 `reviewed`。
- 卡片與 preview 的目前規格看本文件；redesign brief 是歷史 baseline，不是目前缺口清單。
- GA4 不註冊 `photo_id`、`content_id`、`search_term`、`result_rank` 等高基數或可能敏感參數為 custom dimensions。

公開前端右上角的外部連結由 `config/project.json` 控制。除了 Flickr 來源連結，也應提供 GitHub 專案連結，讓使用者能回到 repo 了解專案細節或回報問題。

公開前端除了照片卡片搜尋，也應提供索引概覽，協助維護者快速判斷目前索引整理成效。概覽應優先使用 `data/photo-schema.json` 與 `data/tag-taxonomy.json` 理解欄位與必要規則，例如整理狀態、使用提醒、人數標記、reviewed 必要欄位完整度與贊助欄位覆蓋率，不應在前端另外維護一份欄位規則或 raw value 翻譯表。前端顯示文字應使用 `data/tag-taxonomy.json` 的 `option_labels`，但篩選值、URL 參數與資料比對仍使用 raw value。

公開前端遇到選項可能偏長的篩選欄位，例如活動/相簿、場景、素材包、贊助品項，應使用頁面內可搜尋的選單或 autocomplete，不依賴瀏覽器原生 `<select>` / `<datalist>` 彈出層。原生彈出層由瀏覽器與作業系統控制，長列表在小視窗或特定環境中可能出現 fallback 呈現，難以用 CSS 穩定修正。實作上仍可保留原本欄位值作為篩選狀態來源，但使用者操作層應提供可搜尋、可捲動且不離開頁面布局的選單。贊助品項仍應保留輸入片段文字搜尋的能力，不應被限制成只能選擇完整品項名稱。

篩選狀態應以 finder state 為唯一來源，DOM 控制項只負責呈現與發出變更事件。所有篩選欄位都以陣列表示，即使資料欄位本身是單值，例如照片方向或整理狀態。篩選語意固定為同一欄位內 OR、不同欄位間 AND；active chips 應一值一顆，移除時只移除該值，不清掉整個欄位。

篩選區應採「固定核心 + 任務重點 + 進階條件」分層，而不是把整份 schema 攤在第一層。固定核心包含任務模式、搜尋、活動/相簿、排序與清除。主要找圖條件應先放使用者最常用來收斂照片的欄位，目前排序為用途、主體、氛圍、場景，再接續人數、照片方向、留白、安全裁切、贊助價值、贊助品項、使用提醒、推薦優先度、整理狀態與素材包。`subject_type` 已是主要收斂條件，應放在用途之後、氛圍之前。任務重點依目前任務提升相關條件，例如網站橫幅與設計素材提升方向、留白與裁切，贊助提案與贊助成果提升贊助價值與贊助品項。其他條件保留在進階區，讓使用者需要時再收斂。

清除按鈕應協助使用者辨識自己目前是否位在已收斂的結果狀態。只要存在搜尋字串、非預設任務模式、非預設排序或任何篩選條件，清除按鈕就應以 active 樣式呈現；清除後回到預設狀態才移除 active 樣式。

面對上千或上萬張照片時，公開前端應以「工作任務」作為初始心智模型，而不是只提供欄位表單。任務模式可以調整推薦排序權重，但不應隱藏資料；使用者仍可透過活動/相簿、構圖、留白、裁切、場景、用途、贊助品項與素材包等欄位自行收斂結果。結果狀態列應清楚說明任務模式是排序情境，不是硬篩選。

`curation_status` 與 `public_use_status` 不應成為主要找圖入口。照片量級很大時，只有少量照片會是人工處理過的整理狀態；若把 `reviewed` 或 `approved` 放成第一層門檻，Finder 會過早排除大量仍可探索的公開 Flickr 照片。這兩個欄位應保留在進階篩選與預覽細節中，作為使用前提醒與後續檢查依據，而不是預設探索範圍。

活動/相簿篩選應使用 `album_ids` 作為主要判斷，並以 `event_year`、`event_name` 與 `album_title` 組成可讀選項文字；若舊資料沒有 `album_ids`，才退回用 `album_title` 比對。這是硬篩選，服務已知道目標活動或相簿的使用者，不應取代任務模式或文字搜尋。

照片卡片應優先服務日常找圖的視覺掃描，而不是把維護資訊外顯在結果牆上。主卡片只保留大圖、預覽入口與候選快速操作；`photo_id`、整理狀態、使用提醒、完整欄位與資料維護連結都應收進 `photoPreviewDialog`。這讓使用者先用影像判斷是否值得細看，避免在大量照片牆中被 metadata 噪音干擾。

卡片上的主要動作是預覽照片。桌機或精準指標環境中，未加入候選的卡片可在 hover 或 keyboard focus 時顯示 `候選` 快速按鈕；已加入候選的卡片則無論 hover 與否都應持續顯示 `已加入`，同時允許使用者直接從卡片移除。手機版不要求未加入狀態的 `候選` 按鈕外顯，使用者可以進入預覽後再加入候選；已加入狀態仍可作為卡片上的持續提示。候選快速操作不得取代預覽入口，也不應讓使用者誤以為點擊照片會直接開 Flickr 原頁。

預覽 dialog 是照片細節與維護操作的集中位置。它應顯示 photo id、整理狀態、使用提醒、用途、主體、氛圍、場景、構圖、贊助欄位、描述與備註，並提供候選切換、下載大圖、原圖頁、Google Sheets 列連結、Flickr URL 複製與 Finder URL 複製。資料維護者仍能在預覽中複製 `photo_id` 或前往 Sheets，但這不應重新成為卡片第一屏資訊。

Finder deep link 使用 `#photo-<photo_id>`。使用者直接開啟這類連結時，前端應載入目標卡片所在頁段、把卡片捲到視窗附近，並立即打開同一張照片的 preview dialog，讓連結接收者不用再手動點卡片。

前端應提供 `推薦排序` 與 `探索更多` 兩種主要排序心智。`推薦排序` 保持找圖效率，優先呈現最符合任務、整理狀態較可靠、優先度較高的照片；`探索更多` 則在仍維持基本可用性的前提下，穩定分散年份、活動、相簿與素材包來源，避免所有人只看到同一小批高分照片。`探索更多` 不是正式使用頻率治理，也不應依賴隨機排序。

公開前端也應提供「用 AI 助手找照片」的輔助入口，讓宣傳、設計、網站、公關、行銷等工作需求使用者，把正式 `photos` 工作表交給自己熟悉的 AI 助手，以自然語言探索還不能被固定篩選條件描述的需求。這個入口應放在候選清單附近，提供正式 Sheets 連結與可複製提示詞；提示詞應帶入目前任務模式、搜尋字串與已套用篩選，並提醒使用者若 AI 助手不能直接讀取 Google Sheets，就改提供 `photos` CSV。提示詞也應要求 AI 助手不要只找 `reviewed` 照片、不要自行推測缺失欄位。

候選清單只存在瀏覽器當下狀態與 URL query，不寫回 Google Sheets。清單畫面應提供縮圖，避免只用 photo id 要求使用者記憶照片；照片卡片與預覽 dialog 都可以切換候選狀態，但同一張照片只能在候選清單中出現一次。預設複製動作應複製可重現目前 Finder 狀態的 canonical URL，包含任務、搜尋、篩選、排序與 `selected` 候選照片，讓接收者打開後直接看到同一批候選。其他文字輸出格式應放在複製按鈕旁的 action menu，點選後直接複製，不保留持久選取狀態。桌面版可用 split button 節省空間；手機版應顯示 `其他格式` 與 `複製連結` 兩個並排按鈕，並把格式清單展開在候選 bottom sheet 內，避免 dropdown 超出畫面。預設 IM 討論版應只保留編號與 Flickr URL，方便使用者在聊天工具中回覆「選第幾張」，必要時才附上簡短使用提醒。協作檢查版則應包含整批 Finder 清單連結、Google Sheets 列連結、Flickr URL、整理狀態與使用提醒，服務資料維護與跨角色檢查。純 Flickr URL 版應只輸出每張照片的 Flickr URL，方便工具或文件貼上。

Google Sheets 列連結應貼近 Google Sheets UI 的「Get link to this cell」格式：`edit?gid=<sheetId>#gid=<sheetId>&range=A<row>`，例如正式 `photos` 工作表第 28 列是 `edit?gid=1663351240#gid=1663351240&range=A28`。`gid` 指定工作表，`range` 只放該工作表內的 cell，不要放 `photos!A28` 這種 sheet-qualified A1 notation。`photos` 的 sheet id 應記錄在 `config/project.json` 的 `googleSheets.photosSheetGid`。

公開讀取規則記錄在 `docs/google-sheets-database-design.md`，外部 AI 讀取方式記錄在 `docs/ai-readable-dataset.md`。

## GitHub Pages 部署注意事項

GitHub Pages 應透過 GitHub Actions 發布乾淨的 Pages artifact，不應直接把整個 repo root 當成 Pages source。

`pnpm finder:build` 產生的 artifact 應只包含：

- 公開搜尋前端所需的 HTML、CSS、JavaScript。
- 經過資料流程產生或指定的公開資料來源設定。
- `data/finder-data/manifest.json`、`albums.json`、`photos-index.json` 與 detail shards。
- `data/interface-registry.json`、`data/photo-schema.json`、`data/tag-taxonomy.json` 與 `data/search-aliases.json`，讓前端用同一份 filter/task policy、欄位、受控字彙、顯示文字與資料值搜尋同義詞來源理解資料。
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
2. 執行 `pnpm project:check`，涵蓋語言治理、shared values、syntax、Apps Script generated config、data validation、AI fixtures、finder tests、Pages build 與 artifact check。
3. 執行 `pnpm finder:mobile-filter-smoke`，用 headless browser 檢查手機 filter picker 不退回不穩定的原生彈出層。
4. 非 pull request 時，上傳 `tmp/pages` 作為 GitHub Pages artifact。
5. 非 pull request 時，使用 GitHub Pages deploy action 發布。

目前 repository Pages 來源已設定為 GitHub Actions。維護時若 Pages 無法部署，應先確認 repository Settings > Pages 仍使用 GitHub Actions 來源，再檢查 `.github/workflows/pages.yml` 的 build/check/deploy 結果。

## 搜尋規模

GitHub Pages 部署版不應在瀏覽器端一次下載完整 `photos` CSV。build 階段會先產生搜尋 index 與 detail shards，前端初始只讀取 index，並且不可一次把所有照片卡片渲染到 DOM。使用者捲到接近結果底部時，前端會自動增加顯示數量；`載入更多` 按鈕仍保留為明確操作與 fallback。

production 資料已達 26k 級，且 40k 是可預見規模。照片 grid 在資料載入前應呈現明確 loading state，例如 spinner 與 skeleton cards，並透過 `aria-busy` / status text 告知索引仍在讀取中；載入失敗才進入錯誤狀態。這個 loading feedback 是狀態辨識，不是裝飾動畫，因此即使使用者設定 `prefers-reduced-motion: reduce`，仍應保留足以辨識正在載入的視覺變化。

目前推薦排序會優先考慮：

- 任務模式對 `recommended_uses`、`mood_tags`、`scene_tags`、`sponsorship_tags`、`orientation`、`safe_crop`、`has_negative_space` 的權重。
- `curation_status`、`priority_level` 與縮圖 URL 是否存在。
- `public_use_status = avoid` 作為不建議提醒；`approved` 不應被當成 Flickr 公開性的主要訊號。

`探索更多` 排序會先沿用推薦排序的基本可用性，再用穩定的前端排序分散近期結果中的 `event_year`、`event_name`、`album_ids` 與 `collections`。它只改變瀏覽順序，不改變篩選條件，也不新增 Google Sheets 欄位。為了讓 40k 規模仍可預期，探索排序只對推薦排序前 `discoverCandidateLimit` 筆做多樣化，預設 2000；其餘結果維持推薦排序接在後面。若未來要治理實際對外使用頻率，應另建正式使用紀錄或分析 GA4 raw events，不應把前端排序或 GA4 UI 報表當成使用事實。

後續若 40k 以上仍遇到瓶頸，優先評估下列方向：

- 縮小 index 欄位或替高重複字串做 dictionary encoding。
- 依相簿、年份或任務建立二級 index，避免每次搜尋掃描全 index。
- 以 Web Worker 承接搜尋與排序，避免主執行緒卡住互動。
- 以 GA4 raw events 或正式使用紀錄判斷是否需要 server-side search；不要只因資料量成長就提早導入需要維運的後端。

## 殘餘風險

- Google Sheets 公開輸出 URL 的格式或 CORS 行為可能改變，導致 build-time static artifact 產生失敗。
- Google Sheets 更新到公開匯出 URL 可能有延遲。
- 若 `photos` 欄位格式沒有驗證，前端可能載入不完整資料。
- 若 static index 繼續膨脹，初始下載、記憶體與主執行緒搜尋仍可能成為瓶頸。

這些風險應由 Apps Script、repo validation 與同步工具共同處理，而不是讓 GitHub Pages 前端承擔資料治理責任。
