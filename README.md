# SITCON Flickr Photo Finder

SITCON Flickr Photo Finder 是一套放在 SITCON Flickr 之上的照片索引方法。它的目標不是取代 Flickr，也不是在 repo 裡保存原圖，而是讓籌備團隊可以用真實工作需求找到合適照片，例如社群宣傳、網站視覺、贊助提案、贊助成果報告、新聞稿、志工招募與活動回顧。

這個 repo 保存方法與工具：欄位設計、受控字彙、驗證規則、匯入流程、公開搜尋前端、AI 初標流程與維護文件。正式照片索引資料在 Google Sheets；Flickr 仍是照片與相簿的來源。

## 核心想法

照片本身已經在 Flickr，但活動籌備時真正需要的是「找得到」。只靠 Flickr 標題、相簿名稱或人工記憶，很難回答這類問題：

- 有沒有適合贊助提案使用、能看出會眾互動的照片？
- 有沒有橫式、可放字、適合網站 hero 的照片？
- 有沒有能呈現講者、工作人員、茶點、舞台或合照情境的照片？
- 這張照片是否已整理過，是否適合公開使用？

因此這個專案把照片整理成一層可維護的索引：

1. 從 Flickr 找到相簿與照片。
2. 把需要整理的照片列入 Google Sheets。
3. 用固定欄位與受控字彙描述照片。
4. 用 AI 輔助產生候選 metadata，但不讓 AI 直接取代人工審核。
5. 用公開搜尋前端讀取同一份資料，讓籌備團隊能用工作情境找圖。
6. 把實際找圖回饋帶回欄位、taxonomy、prompt 與工具。

## 角色分工

| 角色 | 負責什麼 |
| --- | --- |
| Flickr | 保存原始照片、相簿與公開圖片來源。 |
| Google Sheets | 正式照片索引資料庫，讓志工可以協作整理與審核。 |
| 這個 repo | 保存欄位規則、工具、驗證、AI prompt、前端與維護文件。 |
| AI / agent | 讀圖後產生可審核的候選 metadata，協助補足人工整理成本。 |
| GitHub Pages | 提供公開唯讀搜尋介面，讀取 Google Sheets 的公開輸出。 |
| Apps Script | 在 Sheets 內提供維護輔助與驗證提示，實際部署由有權限者處理。 |

## 資料原則

- Google Sheets `photos` 是正式照片索引資料庫。
- Google Sheets `albums` 是正式相簿清單與處理狀態資料。
- Google Sheets `import_batches` 是正式匯入批次紀錄資料。
- `photos` 主表本身就是公開照片索引；公開 CSV/JSON 只是同欄位輸出，不是另一份資料庫。
- `data/photo-schema.json` 是欄位順序、欄位 metadata、reviewed 完整度與 approved 使用要求的機器可讀來源。
- `data/tag-taxonomy.json` 是受控字彙來源。
- `fixtures/*.csv` 只是本機 demo、測試資料與匯出格式參考，不是正式資料。
- `tmp/sheets-export/*.csv` 是從正式 Google Sheets 匯出的本機工作快取，可刪除、不可 commit。

正式照片索引可從這份 Google Sheets 閱讀：<https://docs.google.com/spreadsheets/d/1JM2QzJo5kpeILZPyTSE6gUK3z-FyRcaGhPJlYE-FMbs/edit>

如果 Google Sheets 正式資料和 repo 內測試資料不一致，以 Google Sheets 為準。若 Sheets 欄位或驗證規則和 repo schema 不一致，以 repo schema 為準，並更新 Sheets 或 Apps Script。

## 主流程

### 1. 建立或更新照片索引

技術志工先從 Flickr 相簿開始，選擇這次要處理的相簿，工具會產生一份可檢查的匯入產物。人類確認後，才把新照片追加到 Google Sheets。

這個流程的重點是避免直接改正式表：先產生候選資料、先檢查、先 dry-run，再寫入。

### 2. 整理照片 metadata

整理者在 Google Sheets 中補上照片用途、場景、氛圍、贊助相關資訊、公開使用狀態與整理狀態。這些欄位不是為了讓資料漂亮，而是為了讓未來的工作需求能被搜尋與篩選。

例如「會眾」、「講者」、「茶點」、「有留白」、「適合新聞稿」、「需要人工確認」都比單純的相簿名稱更接近實際找圖方式。

### 3. 用 AI 輔助初標

AI 初標只是一種加速整理的方法。它可以讀圖後提出候選值，例如人數、場景標籤、建議用途、安全裁切比例與 `visual_description`。

AI 產出的內容必須先通過 validator，並產生 diff、更新計畫與報表。人類看過之後，才可以 dry-run 寫回 Google Sheets。即使寫回 Sheets，也只代表 `ai_labeled`，不代表照片已經人工 review。

`visual_description` 是自然語言找圖輔助欄位，用來補足 taxonomy 難以覆蓋的長尾細節，例如人物動作、物件位置、畫面文字、空間關係與構圖特徵。它不是照片標題，也不應包含看不出來的推論。

### 4. 用公開前端找照片

GitHub Pages 前端只讀公開 Google Sheets 輸出，不保存 credential，也不寫入資料庫。它讓使用者用搜尋、篩選與資料概覽理解目前照片索引能支援哪些工作情境。

前端找不到的需求很重要：它會反過來告訴我們 taxonomy 是否不夠、欄位是否難用、AI prompt 是否需要調整。

## 安全邊界

- 不把 Google credential、OAuth token、AI API key 或私人連結放進 repo。
- 寫入 Google Sheets 的 CLI 必須從執行環境的 `GOOGLE_APPLICATION_CREDENTIALS` 取得授權。
- 寫入工具預設 dry-run；加上 `--write` 才會修改正式 Sheets。
- AI 候選值不能直接把照片標成 `reviewed` 或 `approved`。
- 公開前端只能讀資料，不能保存 secret，也不能寫入資料庫。
- `curation_notes` 等公開欄位不要放敏感內部資訊。

## 授權與協作

這個 repo 會以開源方式釋出；程式碼、文件、schema、taxonomy、prompt 與工具預設採用 Apache-2.0 授權，詳見 `LICENSE`。

這份授權不代表 SITCON Flickr 上的原始照片也被重新授權。照片的使用仍應回到 Flickr 原頁、攝影者標示與該照片本身的授權條件確認。正式 Google Sheets 內容是專案維護的公開索引資料；重用時請保留來源脈絡，並尊重欄位中標示的公開使用狀態。

歡迎用 issue 或 pull request 協助改善欄位設計、taxonomy、AI 初標規則、資料流程、文件與公開搜尋前端。協作方式請看 `CONTRIBUTING.md`。

## 開始使用

第一次接觸專案，建議先用互動入口了解目前能做的工作：

```bash
pnpm workflow
```

常用起點：

| 想做的事 | 入口 |
| --- | --- |
| 理解專案架構 | `docs/project-architecture.md` |
| 看完整文件與工具索引 | `docs/README.md` |
| 開啟本機搜尋 UI | `pnpm dev` |
| 檢查資料與 AI fixtures | `pnpm workflow -- --task check` |
| 處理一本 Flickr 相簿，並接續檢查 / dry-run | `pnpm workflow -- --task album-intake` |
| 準備 AI 初標工作包 | `pnpm workflow -- --task ai-prepare` |
| 檢查 AI 初標結果 | `pnpm workflow -- --task ai-review` |
| 維護 Google Sheets | `pnpm workflow -- --task sheets` |
| 建立並檢查公開前端 artifact | `pnpm workflow -- --task pages-build` |

需要完整 command list、低階除錯工具或各流程細節時，請看 `docs/README.md`、`docs/sheets-sync-workflow.md`、`docs/ai-labeling-operator-guide.md` 與 `docs/public-frontend-architecture.md`。

## 本機需求

需要 Node.js 與 pnpm。目前已知可用 Node.js 版本為 `v24.15.0`。

這個 repo 只使用 pnpm 作為套件管理工具。請不要使用 npm 或 yarn，避免不同 git worktree 平行開發時產生不一致的 lockfile 或安裝行為。

```bash
pnpm validate:data
pnpm ai:validate-fixtures
```

## 資料流

```text
SITCON Flickr 相簿
  -> repo 工具盤點與選擇相簿
  -> 產生可審核的 intake run
  -> 人類確認後寫入 Google Sheets photos / albums / import_batches
  -> 人工整理與 AI 候選 metadata 輔助
  -> Google Sheets 成為正式照片索引
  -> GitHub Pages 與外部 AI 讀取公開索引
  -> 實際找圖回饋改善欄位、taxonomy、prompt 與工具
```

## 進一步閱讀

| 文件 | 適合什麼時候看 |
| --- | --- |
| `docs/README.md` | 想看完整文件入口、目前狀態與工具索引。 |
| `docs/project-architecture.md` | 想理解端到端架構與資料流。 |
| `docs/photo-finder-mvp.md` | 想理解產品判斷與欄位取捨。 |
| `docs/data-entry-guide.md` | 要人工整理照片資料。 |
| `docs/photo-fields-reference.md` | 要查欄位用途。 |
| `docs/google-sheets-database-design.md` | 要理解正式 Sheets 表格設計。 |
| `docs/sheets-sync-workflow.md` | 要操作 Sheets 匯出、匯入、dry-run 或寫入。 |
| `docs/public-frontend-architecture.md` | 要維護 GitHub Pages 唯讀前端。 |
| `docs/ai-labeling-operator-guide.md` | 要準備、檢查或回寫 AI 初標結果。 |
| `docs/ai-labeling-contract.md` | 要知道 AI run 的輸入、輸出與驗證合約。 |
| `docs/ai-labeling-evaluation-notes.md` | 要評估模型輸出品質與常見失準。 |
| `docs/ai-readable-dataset.md` | 要讓外部 AI 或唯讀工具理解照片索引。 |
| `docs/agent-maintenance-guide.md` | agent 或技術志工接手維護時閱讀。 |
