# Pages Finder React 遷移計畫

## 文件狀態

這份文件是 GitHub Pages Finder 從 vanilla DOM 前端遷移到 Vite + React + TypeScript + React Aria Components 的執行基準。它整合桌面工作台、#5 手機 UX、多角色代理研究、MVP 產品定位與 GA4 分析邊界。

本遷移追求長期產品成功，不把既有 vanilla artifact、模組拆分、GA4 event names、URL query shape 或 candidate copy template 視為不可破壞契約。保留或翻掉任何舊設計，都應回到使用者能否更快從工作需求找到可用照片、整理候選並交給他人討論。

## React UI 重設基準

2026-05 React cutover 後，owner 決策調整為：React 版可以完全重設 UI 與資訊架構，不把 2026-05-13 前 `app/` vanilla Pages artifact 的視覺或版面當作硬性基準；但必須保留既有找圖功能與任務連續性，讓使用者仍能完成任務模式、搜尋、篩選、排序、結果瀏覽、照片 detail、候選清單、候選複製與 Flickr / 大圖 / 原圖 / Sheets 來源操作。

桌面與手機必須視為兩個產品表面：

- Desktop 是長時間找圖工作台，應提供高資訊密度、固定篩選區、結果 grid、常駐候選/概覽/AI 工具與 inspector/detail。Desktop 的 filter、candidate 與 detail 不應以 bottom sheet 作為主要操作模式。
- Mobile 是快速挑選與討論介面，沿用 #5 決策：結果優先、固定「篩選 / 候選」入口、filter/candidate/preview 以 sheet 管理、卡片第一層只保留手機主要 action。

React 實作可以共享 finder state、資料讀取、搜尋排序、URL state、候選輸出與 analytics；但 desktop/mobile 的 presentational components、layout、操作入口與資訊密度應分開，避免因共用單一 JSX 而把手機 UX 套到桌面。

## 參考基準

- `docs/photo-finder-mvp.md`：Finder 的核心目標是替 Flickr 加上可搜尋、可判斷用途的索引層，不取代 Flickr。
- `docs/public-frontend-agent-research.md`：桌面與整體 Finder 應以任務導向、效能、可用性提醒、角色必要篩選與候選分享為核心。
- `docs/public-frontend-redesign-brief.md`：P0/P1 產品能力包含任務模式、搜尋、排序、分批渲染、候選清單、detail、GA4 與 mobile/desktop 任務驗收。
- `docs/public-frontend-mobile-research.md`：#5 手機版以快速挑選與討論為主，結果優先，filter/candidate/detail 以 sheet 管理。
- `docs/frontend-analytics-design.md`：GA4 只作行為訊號，不作正式使用紀錄；React 遷移時可重設事件分類，但仍須遵守隱私、低基數與 no-credential 邊界。

## 不變產品邊界

- GitHub Pages Finder 是公開唯讀前端，不保存 credential，不寫入 Google Sheets。
- Google Sheets `photos` 仍是正式照片索引；fixture 與 build artifact 不是另一份權威資料。
- Finder 第一層心智模型是工作任務，不是 schema 欄位表單。
- 未整理或 AI 初標照片可以探索，但排序與狀態提示應清楚呈現風險。
- 使用者常需要整理 3 到 10 張候選，候選 workflow 是核心功能，不是附屬工具。
- Desktop 是主要工作台，mobile 是快速挑選與討論；兩者資訊架構可以不同，但能力不能缺失。

## 可重新設計的舊契約

- 正式 Pages artifact 可以在 React 產品能力達標後切換，不必等待 vanilla 完整平行相容。
- pure modules 不是必須保留；能提升型別、安全性、測試或 React 狀態模型時，可以 port 或改寫。
- URL query 可以改成新的 canonical shape；舊 deep link 只需盡量讀入主要狀態，不保證輸出格式相容。
- candidate copy template 可以重新設計，以目前手機與桌面協作選片需求為準。
- GA4 event names、parameters 與 custom dimensions 可以重設；過去紀錄尚未進入正式分析，不需為歷史報表犧牲 React 遷移後的資訊架構。

## React 產品能力

React 版 cutover 前必須完成：

- Data loading：讀取 project config、schema、taxonomy、search aliases、interface registry、photos CSV 與可選 albums CSV。
- URL state：支援任務、搜尋、排序、篩選與候選集合分享。
- Task/search/filter/sort：支援任務模式、debounced search、primary filters、advanced filters、推薦排序與探索排序。
- Results：顯示結果總數與已顯示數量，分批渲染、lazy image、load more，不一次 render 全部卡片。
- Desktop workbench：桌面提供任務/搜尋/篩選、結果 grid、detail、候選、overview 與 AI assistant 的完整工作流。
- Mobile sheets：手機 filter、candidate、preview/detail 使用 React Aria dialog/sheet，支援焦點管理、body scroll lock、下滑關閉與至少 44px 主要觸控目標。
- Photo detail：完整 metadata、Flickr、download/original、Sheets、copy link 與使用提醒放在 detail，不塞滿手機卡片。
- Candidate workflow：加入/移除、縮圖、候選 N、Markdown/plain text copy、候選 URL share。
- Analytics：以 React UX 重新定義事件，但不送 PII、完整 filter JSON、完整 query string 或未清理自由文字。
- QA：mobile/desktop smoke、10k 級 synthetic performance、build/check/typecheck 與多方觀點使用者 agent 實測回饋。

## Commit Plan

建議從目前 React scaffold 往後拆成以下可審查 commit：

1. `docs(pages): consolidate React migration baseline`
2. `refactor(pages): define typed finder domain state`
3. `feat(pages): load finder data and URL state in React`
4. `feat(pages): implement task search filters and sorting`
5. `feat(pages): render performant finder results`
6. `feat(pages): build desktop finder workbench`
7. `feat(pages): complete mobile sheets and touch UX`
8. `feat(pages): implement photo preview detail workflow`
9. `feat(pages): implement candidate workflow`
10. `feat(pages): restore overview and assistant tools`
11. `feat(pages): reset frontend analytics taxonomy`
12. `test(pages): add React finder QA coverage`
13. `chore(pages): switch Pages build to React`
14. `chore(pages): remove legacy vanilla finder UI`

大型 slice 可以使用短期 topic branch 開發，再以 `--no-ff` merge 回遷移分支。cutover 與 legacy cleanup 必須分開，方便 rollback 與 review。

## 驗收

每個 slice 至少執行相關的 `pnpm finder:react:typecheck`、`pnpm finder:react:build`、`pnpm finder:test` 或 `pnpm finder:check`。cutover 前必須完成完整驗收：

- 手機：首次畫面、filter sheet、candidate sheet、preview/detail、下滑關閉、sticky actions、44px touch targets。
- 桌面：社群貼文、網站 hero、贊助成果三種任務能完成找圖、查看 detail、加入候選與複製清單。
- 大資料：10k 級資料不一次 render 全部卡片，不造成明顯卡死。
- URL：主要工作狀態可分享與還原。
- GA4：DebugView 或 Realtime 驗證 React 遷移後的事件、no-op、隱私清理與低基數參數。
- 多方觀點 agent 實測回饋已評估，必要修正已納入 commit。
