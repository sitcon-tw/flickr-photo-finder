# Agent 維護指南

這份文件給未來協助維護 SITCON Flickr Photo Finder 的 AI agent 與技術志工使用。

## 先理解資料權威來源

正式資料與 repo fixture 的權威關係請先看 `docs/README.md` 的真理來源表。

Repo 的角色是：

- 保存 schema、taxonomy、validation 與工具。
- 提供相簿掃描、匯入、AI 輔助、匯出與同步流程。
- 保存文件，讓未來 agent 能理解專案目標與資料維護方式。
- 保存 sample / fixture / export format，方便本機開發與測試。

`data/photo-schema.json` 是照片、相簿與匯入批次欄位順序、欄位 metadata、reviewed 完整度規則與 approved 使用要求的機器可讀來源。

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
- 擁有 Google Sheets、Google API、OAuth、第三方工具或 Apps Script credential。
- 某位維護者本機可用的授權方式，在其他使用者或未來 agent 手上也一定可用。
- 可以繞過 SITCON 既有文件與權限交接制度。
- AI 標註結果可以直接取代人工確認。

## 權限與交接

SITCON 組織已有既有文件存放與交接制度。這個 repo 不保存 credential，也不重新定義 Google Drive 權限交接。

遇到權限問題時，agent 應該：

1. 先確認需要哪一類資產或權限，例如 Google Sheets 編輯權限、Google Sheets API service account credential、Apps Script/clasp、第三方工具或 AI API。
2. 檢查 repo 內是否有本專案的資產地圖或操作文件。
3. 若需要組織權限或 credential，請人類依 SITCON 既有文件與 Google Drive 管理流程處理。
4. 不要把 token、API key、credential 或私人連結寫入 repo。

Agent 應把「可公開讀取」、「可寫入」、「資料格式正確」視為三件不同的事：

- `pnpm sheets:check` 只驗證公開讀取與初始化覆蓋風險，不代表具備寫入權限。
- 正式 Sheets 表格寫入的 repo CLI 方向是官方 Google Sheets API SDK；建議正式寫入身份是 SITCON 管理的 service account，且該 service account email 必須被加入正式 Google Sheets 編輯者。
- agent 不應因為自己本機某種授權可用，就把該 credential 或 token 流程寫成唯一交接方式。
- `pnpm validate:data` 驗證資料格式與 schema，不代表 Google Drive/Sheets 權限正確。
- `pnpm intake:validate` 驗證本次匯入產物內部一致，不代表它已經成功套用到正式 Sheets。

## AI 輔助資料流程

AI 只能作為資料匯入與整理輔助。

若任務是替 `tmp/ai-runs/<run-id>/` 裡的照片產生初標 metadata，請先讀 `docs/ai-labeling-operator-guide.md` 與 `docs/ai-labeling-contract.md`。前者是 prepare-to-validate 的操作指南，後者是 AI 初標階段的輸入、圖片來源、`metadata-proposals.json` 輸出格式與驗證命令的合約。若任務是評估模型輸出品質或調整 prompt，請再讀 `docs/ai-labeling-evaluation-notes.md`。

建議流程：

1. Agent 讀取 Flickr 照片、縮圖、title、相簿資訊與既有欄位。
2. Agent 依照 `data/tag-taxonomy.json` 和欄位文件產生候選欄位值。
3. Agent 呈現變更差異，讓人類決定是否回寫。
4. AI 協助過但尚未人工確認的資料應標成 `ai_labeled`。

Agent 的 AI 初標工作不應把資料標成 `reviewed`。`curation_status = reviewed` 應該在 Google Sheets 中，由具有編輯權限的志工夥伴一起檢核、修正並補齊必要欄位後再更新。若公開使用判斷合適，再把 `public_use_status` 設為 `approved`。

`curation_status` 只描述資料可信度：`unreviewed`、`ai_labeled`、`reviewed`。不要用它表達精選或封存。推薦優先度請看 `priority_level`、`collections` 與 `public_use_status`。

若人類要求重新觸發 AI 調整欄位，agent 應保留可審核的輸出，不應靜默覆蓋既有人工整理結果。

## 維護資料時的基本檢查

更動 `data/photo-schema.json`、taxonomy、sample data 或 validation logic 後，請執行：

```bash
pnpm validate:data
```

更動 JavaScript 後，請至少執行對應的語法檢查：

```bash
node --check scripts/validate-data.mjs
node --check scripts/discover-albums.mjs
node --check scripts/add-photo.mjs
node --check scripts/add-album.mjs
node --check app/main.js
```

依實際更動範圍選擇需要檢查的檔案，不需要每次全部重跑。

## 文件優先順序

新 agent 接手時，最少必讀：

1. `README.md`
2. `AGENTS.md`
3. `docs/README.md`
4. `docs/project-architecture.md`

再依任務擴展閱讀：

- 資料庫與協作：`docs/database-collaboration-strategy.md`、`docs/google-sheets-database-design.md`
- 相簿匯入與同步：`docs/sheets-sync-workflow.md`
- 外部 AI 或 metadata 輔助：`docs/ai-labeling-operator-guide.md`、`docs/ai-labeling-contract.md`、`docs/ai-labeling-evaluation-notes.md`、`docs/ai-readable-dataset.md`
- Apps Script：`docs/apps-script-maintenance-design.md`
- 人工填寫欄位：`docs/data-entry-guide.md`、`docs/photo-fields-reference.md`
- 產品背景與 MVP 取捨：`docs/photo-finder-mvp.md`、`docs/mvp-implementation-plan.md`

如果文件互相矛盾，以 Google Sheets-first 架構為準，並優先修正文件矛盾。
