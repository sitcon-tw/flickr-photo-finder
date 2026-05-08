# Agent 維護指南

這份文件給未來協助維護 SITCON Flickr Photo Finder 的 AI agent 與技術志工使用。

## 先理解資料權威來源

正式照片索引資料在 Google Sheets，不在 repo 內。

Repo 的角色是：

- 保存 schema、taxonomy、validation 與工具。
- 提供相簿掃描、匯入、AI 輔助、匯出與同步流程。
- 保存文件，讓未來 agent 能理解專案目標與資料維護方式。
- 保存 sample / fixture / export format，方便本機開發與測試。

`data/photo-schema.json` 是照片欄位順序、欄位 metadata、reviewed 完整度規則與 approved 使用要求的機器可讀來源。`data/photos.csv` 不是正式資料來源。它目前只用於 MVP 示範、本機 UI、驗證工具與未來匯出格式測試。若它和 Google Sheets 的正式資料不一致，以 Google Sheets 為準。

## Agent 可以協助的工作

Agent 適合協助：

- 讀懂 repo 文件並更新維護流程。
- 掃描 Flickr 相簿，找出尚未匯入的照片。
- 產生可寫入 Google Sheets 的候選資料。
- 根據 repo schema/taxonomy 檢查資料格式。
- 協助維護 Apps Script 或同步工具。
- 協助 AI 初標照片內容。
- 產生人類可審核的欄位調整 diff。
- 維護搜尋 UI、validation script 與文件。

Agent 不應自行假設：

- repo 內 sample data 是正式資料。
- 擁有 Google Drive、Google Sheets、rclone 或 API credential。
- 可以繞過 SITCON 既有文件與權限交接制度。
- AI 標註結果可以直接取代人工確認。

## 權限與交接

SITCON 組織已有既有文件存放與交接制度。這個 repo 不保存 credential，也不重新定義 Google Drive 權限交接。

遇到權限問題時，agent 應該：

1. 先確認需要哪一類資產或權限，例如 Google Sheets、Apps Script、rclone、Google API 或 AI API。
2. 檢查 repo 內是否有本專案的資產地圖或操作文件。
3. 若需要組織權限或 credential，請人類依 SITCON 既有文件與 Google Drive 管理流程處理。
4. 不要把 token、API key、credential 或私人連結寫入 repo。

## AI 輔助資料流程

AI 只能作為資料匯入與整理輔助。

建議流程：

1. Agent 讀取 Flickr 照片、縮圖、title、相簿資訊與既有欄位。
2. Agent 依照 `data/tag-taxonomy.json` 和欄位文件產生候選欄位值。
3. Agent 呈現變更差異，讓人類決定是否回寫。
4. AI 協助過但尚未人工確認的資料應標成 `ai_labeled`。
5. 人類修正與確認後，才可以改成 `reviewed` 或 `approved`。

`curation_status` 只描述資料可信度：`unreviewed`、`ai_labeled`、`reviewed`。不要用它表達精選或封存。推薦優先度請看 `priority_level`、`collections` 與 `public_use_status`。

若人類要求重新觸發 AI 調整欄位，agent 應保留可審核的輸出，不應靜默覆蓋既有人工整理結果。

## 維護資料時的基本檢查

更動 `data/photo-schema.json`、taxonomy、sample data 或 validation logic 後，請執行：

```bash
npm run validate:data
```

更動 JavaScript 後，請至少執行對應的語法檢查：

```bash
node --check scripts/validate-data.mjs
node --check scripts/add-photo.mjs
node --check scripts/add-album.mjs
node --check app/main.js
```

依實際更動範圍選擇需要檢查的檔案，不需要每次全部重跑。

## 文件優先順序

新 agent 接手時，建議依序閱讀：

1. `README.md`
2. `AGENTS.md`
3. `docs/database-collaboration-strategy.md`
4. `docs/photo-fields-reference.md`
5. `docs/data-entry-guide.md`
6. `docs/photo-finder-mvp.md`
7. `docs/mvp-implementation-plan.md`

如果文件互相矛盾，以 Google Sheets-first 架構為準，並優先修正文件矛盾。
