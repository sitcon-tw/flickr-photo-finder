# ADR 0001: Google Sheets-first 作為正式照片索引

## 狀態

Accepted

## 背景

SITCON Flickr Photo Finder 的核心不是保存原圖，也不是取代 Flickr，而是在 Flickr 之上建立可搜尋、可排序、可由人類與 AI 理解的照片索引。維護者包含非工程志工、宣傳、設計、網站、公關、行銷與技術志工；正式資料需要能被多人直接檢視、編輯、篩選、討論與交接。

專案同時需要保留可驗證、可重跑、可由 agent 維護的工具鏈，例如 schema、taxonomy、validation、Flickr intake、Apps Script、AI prompt 與公開前端原始碼。

## 決策

1.0 採用 Google Sheets-first 架構：

- Google Sheets 是正式照片索引與主要人工維護介面。
- repo 是治理與工具層，保存 schema、taxonomy、validation、匯入與同步工具、Apps Script source、AI prompt 與文件。
- `fixtures/*.csv` 只是 sample、demo fixture 與匯出格式參考，不是正式資料。
- `tmp/sheets-export/*.csv` 是從正式 Google Sheets 匯出的本機工作快取，不 commit。
- 固定練習表是 onboarding 資產，不是第二份正式資料庫。

## 取捨

優點：

- 非工程志工可以直接使用既有 Google Sheets 協作能力整理資料。
- Sheets 版本紀錄、篩選檢視與手動檢查符合目前團隊維護方式。
- repo 仍能透過 schema、validation、Apps Script 與 SDK 工具把資料維護流程工具化。
- 公開前端、AI 與匯出工具可以讀同一份正式 `photos` 主表。

代價：

- 權限分層、審核歷程、多人衝突處理與複雜查詢能力有限。
- 大量資料與大量前端搜尋可能遇到效能瓶頸。
- 資料品質必須靠欄位規則、Apps Script、repo validation 與人類流程共同維護。

## 替代方案

- PostgreSQL 或正式後台：適合權限、審核流、API 與查詢需求成熟後採用；目前會提高維護門檻。
- SQLite 或 repo-managed data：便於版本化與查詢，但不適合作為非工程志工的主要協作介面。
- Airtable 或類似工具：能降低部分資料庫門檻，但引入外部服務、費用與資料同步問題。

## 重新評估條件

出現以下情況時，應重新評估是否需要 Google Sheets 之外的正式資料層：

- 需要公開索引與非公開審核資訊分層。
- 多位志工需要細緻權限、審核歷程或負責人欄位。
- 查詢需求超過 Sheets 與靜態前端可合理處理的範圍。
- 需要穩定 API 給其他 SITCON 網站或工具使用。
- Sheets-based 協作讓資料品質或維護成本明顯不可接受。

## 相關文件

- `docs/project-architecture.md`
- `docs/database-collaboration-strategy.md`
- `docs/google-sheets-database-design.md`
- `docs/sheets-sync-workflow.md`
