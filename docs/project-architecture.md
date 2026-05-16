# 專案使用流程與架構

## 目的

SITCON Flickr Photo Finder 是 Flickr 之上的照片索引層，不是相簿替代品，也不是原圖保存系統。

這個專案要解決的問題是：籌備團隊常常不是用「哪一年哪個相簿」找照片，而是用工作需求找照片，例如社群宣傳、網站橫幅、贊助提案、贊助成果報告、新聞稿、志工招募、活動回顧、設計素材或對外簡報。

因此照片索引的核心任務是替 Flickr 照片加上可搜尋、可排序、可被 AI 理解的 metadata，讓人類和 AI 都能更快挑出合適照片。

第一次接手專案時，請先讀 `docs/README.md` 的「先建立共同語言」與「整體資料生命週期」。本文件說明穩定架構與責任邊界；目前可用指令、工具入口與文件分流仍以 `docs/README.md` 為準。

## 使用者與需求

| 使用者 | 主要需求 | 主要入口 |
| --- | --- | --- |
| 非技術志工 | 補標籤、檢查授權、整理用途、建立素材包。 | Google Sheets |
| 新加入的整理者 | 先理解工具列、右側整理面板與欄位填寫方式，避免直接改到正式資料。 | 練習用試算表、Google Sheets `使用說明` |
| 宣傳、設計、網站、公關、行銷組 | 找適合當下工作情境的照片。 | GitHub Pages、Google Sheets、AI |
| 行銷組 | 找特定贊助品項與贊助價值佐證照片。 | `sponsorship_items`、`sponsorship_tags` |
| 技術志工 | 掃描相簿、匯入資料、跑驗證、部署工具。 | 專案 CLI、GitHub Actions、clasp |
| AI / agent | 讀 schema、taxonomy 與照片索引，協助找圖或產生候選 metadata。 | 專案文件、AI run artifact、公開 CSV/JSON、Google Sheets |

## 架構總覽

```mermaid
flowchart LR
  Flickr[Flickr<br/>照片與相簿來源]
  Sheets[Google Sheets<br/>正式照片索引]
  AppsScript[Apps Script<br/>Sheets 內維護輔助]
  Pages[公開搜尋前端<br/>唯讀找圖介面]
  AI[AI 助手與 agent<br/>找圖與初標候選]
  Users[籌備團隊與公開使用者]

  subgraph Project[這個專案提供的能力]
    Rules[資料規則<br/>schema / taxonomy / 欄位文件]
    Intake[匯入與同步工具<br/>相簿盤點 / intake / validation]
    Interfaces[使用介面原始碼<br/>GitHub Pages / Apps Script]
    AIGuide[AI 輔助流程<br/>prompt / run artifact / report]
  end

  Flickr -->|相簿與照片 metadata| Intake
  Rules --> Intake
  Intake -->|候選列與同步計畫| Sheets
  Interfaces -->|clasp deploy| AppsScript
  Interfaces -->|GitHub Actions artifact| Pages
  Rules --> AppsScript
  AppsScript -->|提示與校對| Sheets
  Sheets -->|公開 photos CSV / Sheet| Pages
  Sheets -->|公開 photos CSV / Sheet| AI
  AIGuide -->|輸入規則與報表| AI
  AI -->|找圖建議或候選標註| Users
  Pages -->|搜尋與篩選| Users
  Users -->|確認後編輯| Sheets
```

## 資料模型

資料權威來源請以 `docs/README.md` 的真理來源表為準；本節只說明架構中的資料模型。

主要工作表：

- `photos`: 照片索引主表。每列是一張 Flickr 照片，欄位依 `data/photo-schema.json`。
- `taxonomy`: 從 `data/tag-taxonomy.json` 同步的受控字彙。
- `sponsorship_items`: 從 `data/sponsorship-items.json` 同步的 SITCON 2026 CFS 贊助品項固定版本資料。
- `albums`: 程式從 SITCON Flickr 盤點出的相簿清單，以及每本相簿最後一次處理日期。
- `import_batches`: 每次匯入相簿或照片的批次紀錄。
- `schema_meta`: Sheets 目前使用的 schema、taxonomy 與同步狀態。

`photos` 主表本身就是公開照片索引。公開 CSV/JSON 只是同欄位匯出，不是額外篩選表。

`使用說明` 與練習用試算表是 onboarding 輔助。前者幫第一次進入 Sheets 的人判斷要找照片、整理資料或檢查資料；後者讓新整理者試編輯與測試 Apps Script，而不碰正式照片索引。它們不改變正式資料權威來源。

## 維護流程

維護流程從 SITCON Flickr 相簿開始：

1. 專案工具盤點 SITCON Flickr 相簿清單，更新 Google Sheets `albums`。
2. 使用者從 `albums` 選擇本次要處理的相簿。
3. 技術志工或 agent 掃描選定相簿，比對 Google Sheets `photos` 既有 `photo_id`。
4. 工具產生一次 intake run artifact，包含缺少照片的最低必要欄位、更新後的 `albums.last_processed_at`、`import_batches` 與摘要。
5. 人類檢查 run artifact 後，透過官方 Google Sheets API SDK 寫入工具套用到 Google Sheets；新照片可以直接由志工在 Google Sheets 補資料，也可以先由 AI 產生候選 metadata。
6. AI 候選值必須先經過 `ai:review`、`ai:report` 或必要的搜尋實驗檢視，以 diff / report 形式給人類確認，確認後才回寫。
7. Apps Script 在 Sheets 內提供即時提示；必要時匯出資料並執行專案 validation。

匯入階段最低必要欄位、`reviewed` 完整度與 `approved` 使用要求由 `data/photo-schema.json` 定義，並由 `pnpm data:validate` 檢查。文件只說明流程與判斷，不另外維護欄位清單。

## 找圖流程

找圖流程應把自然語言需求拆成可搜尋條件：

- 場景與畫面內容：`scene_tags`。
- 大量照片初篩主體：`subject_type`。
- 情緒與宣傳感受：`mood_tags`。
- 工作用途或素材包：`recommended_uses`、`collections`。
- 贊助品項與贊助價值：`sponsorship_items`、`sponsorship_tags`。
- 畫面條件：`people_count`、`orientation`、`safe_crop`、`has_negative_space`。
- taxonomy 難以涵蓋的長尾細節：`visual_description`。

搜尋後應先依任務命中、`curation_status`、`priority_level` 與構圖條件排序，再把 `public_use_status` 作為使用提醒，特別是將 `avoid` 放到後面或標示為不建議。SITCON Flickr 照片本身已是公開來源，公開前端不應把 `public_use_status` 當成照片是否公開的主門檻；需要實際發布或交付素材時，再回到 Flickr 原頁保留來源脈絡。

找圖結果不應只依 `reviewed` 篩掉其他照片。SITCON Flickr 照片量很大，`unreviewed` 與 `ai_labeled` 仍可用於探索，但必須在排序與提示上清楚標示。

若需求是找特定公開人物、講者或工作人員照片，應優先用活動時間、相簿、公開議程資料、Flickr 原頁脈絡、`scene_tags = 講者 / 合照 / 工作人員`、`people_count`、`recommended_uses` 與人工確認的 `collections` 縮小範圍。專案不以人臉辨識、人物聚類或自動人名標註作為找圖入口；這是隱私、肖像權與社群信任邊界，不是目前缺少的搜尋功能。

## 部署流程

公開前端與 Sheets 維護工具分開部署：

- GitHub Pages 應透過 GitHub Actions 發布 artifact，不應直接把整個 repo root 當成 Pages source。
- Apps Script 應透過 `clasp` 部署。Apps Script source 應保存在 repo 中，讓修改能被 review，也讓未來 agent 能理解目前部署內容。
- `clasp` credential、Google API credential、OAuth token cache、第三方工具 token 與 AI API key 都不應 commit。

## 專案工具層的責任

這個專案保存：

- schema 與欄位文件。
- taxonomy 與贊助品項固定版本資料。
- validation script。
- Flickr 相簿與照片匯入工具。
- Apps Script source 與 clasp 部署文件。
- GitHub Pages 前端 source。
- AI/agent 維護指南與資料解讀文件。

這個專案不保存：

- 正式 Google Sheets 完整資料快照。
- Google Drive、Google API、OAuth、第三方工具或 AI API credential。
- 原圖檔案。
- 私人授權資訊或不該公開的內部資料。

## 現況與演進邊界

目前的成果重點是讓以下 Sheets-first 流程穩定成立：

1. 技術志工或 agent 能從 SITCON Flickr 盤點目前有哪些相簿。
2. 使用者能從已盤點的相簿清單選擇本次要處理哪一本。
3. 技術志工或 agent 能掃描選定相簿並匯入缺少照片。
4. 非技術志工能在 Google Sheets 補 metadata。
5. Apps Script 能用 repo 規則提供即時驗證與提示。
6. GitHub Pages 和外部 AI 能讀同一份公開照片索引。
7. 真實使用者能用工作需求找到照片，並回饋標籤或欄位是否足夠。

目前專案已支援相簿盤點、相簿選擇、intake run 產生、Sheets 初始化與匯入 dry-run/write、AI 初標 prepare/review/report/apply、公開搜尋前端 artifact build/check，以及 Apps Script 維護輔助 source。GitHub Pages 部署已走 GitHub Actions artifact；Apps Script source 可透過 `clasp` 部署到 Sheet-bound script，但實際綁定與部署仍需由有目標 Sheet / Apps Script 權限的維護者執行。最新可用指令、低階工具與改善項目請以 `docs/README.md` 的「目前狀態」為準。

未來發展仍應延伸這個架構：改善公開搜尋體驗、Sheets 內維護輔助、AI 初標審核與資料品質檢查。若資料量或搜尋體驗帶來壓力，應優先改善公開前端的載入、索引、分片、快取與排序策略，正式資料權威仍維持在 Google Sheets。
