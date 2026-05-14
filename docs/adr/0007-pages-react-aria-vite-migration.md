# ADR 0007: Pages 前端長期遷移至 Vite、React、TypeScript 與 React Aria

## 狀態

Accepted

Implementation pending. Production Pages frontend remains the vanilla ES modules app until the final cutover phase is explicitly merged.

## 背景

GitHub Pages frontend 已是 SITCON Flickr Photo Finder 的長期主要產品介面。它不只展示資料，也承擔任務模式、搜尋、篩選、候選清單、preview/detail、GA4 事件、Sheets row link、mobile bottom sheet 與觸控互動。

目前 master 仍以 vanilla ES modules 與 imperative DOM shell 維護這些互動。既有模組拆分已經讓 search/sort、URL state、data loader、candidate copy 等核心邏輯可測，但 overlay、popover positioning、focus management、scroll lock、mobile keyboard、touch gesture 與 accessible select/listbox 仍需要大量自製補丁。

2026-05-14 前的 prototype 已封存為 tag `archive/pages-react-aria-migration-prototype-2026-05-14`，目前指向 commit `ad1003097b252b479474ce92bfcd1b44f2cc1ce7`。該 prototype 證明 Vite + React + TypeScript + React Aria 方向可行，也暴露出執行方式問題：不能邊實作邊補規格、邊 QA 邊修正。後續遷移需從 master 重新開始，先建立追蹤 issue、ADR、migration plan 與 acceptance gates，再分階段實作。

Tracking issue: <https://github.com/sitcon-tw/flickr-photo-finder/issues/44>

## 決策

Pages 前端長期 UI 架構採用 Vite + React + TypeScript + React Aria Components。

這個決策的目的不是導入大型視覺 UI kit，而是導入成熟的 interaction / accessibility primitives，降低 mobile sheet、popover、select/listbox、focus、scroll lock 與 keyboard/touch 行為反覆修補的風險。

遷移採多 PR / 多 phase，不做單一巨大 PR。每個 phase 都必須先定義：

- 目標。
- 不改什麼。
- 驗收 gate。
- rollback 條件。
- 和 tracking issue #44 的狀態同步方式。

## Non-goals

- 不改 Google Sheets schema、taxonomy、search aliases 或 public CSV 資料契約。
- 不新增 backend、SSR、登入、auth 或 Sheets write 能力。
- 不導入 Material UI、Ant Design 這類視覺 UI kit。
- 不把 React Aria 當成資料語意來源；filter、candidate 與 URL 語意仍由 finder state 與 repo contract 決定。
- 不直接合入或 cherry-pick prototype UI rewrite commit。封存 tag `archive/pages-react-aria-migration-prototype-2026-05-14` 只作 reference、風險清單與 QA 反例來源。

## 取捨

採用 Vite + React + TypeScript + React Aria 的理由：

- Pages 仍可維持 static artifact 部署，符合 ADR 0002。
- React state model 能把 finder state 從 DOM control state 中抽離。
- TypeScript 能讓 photo、filter、candidate、URL state 與 analytics contract 更早被檢查。
- React Aria 提供 dialog、modal、popover、select/listbox、focus 與 accessibility primitives，適合目前反覆出現的 mobile 與 overlay 問題。

接受的成本：

- 增加 frontend build step 與 dependencies。
- `build-pages.mjs` 需要逐步成為 build orchestrator。
- 需要 component / responsive / mobile regression gates。
- 遷移期會同時存在 vanilla shell 與 React shell。

暫不採用大型視覺 UI kit 的理由：

- 目前問題主要是 interaction primitive，不是需要完整視覺設計系統。
- Finder 已有既有產品語意、資料欄位與任務導向 UI，需要避免被 UI kit 的預設資訊架構牽著走。

## 維護邊界

- GitHub tracking issue #44 是遷移進度來源。
- `docs/public-frontend-react-migration-plan.md` 是 phase 與 acceptance gate 的穩定規格。
- `docs/public-frontend-architecture.md` 仍記錄目前 Pages 資料流、部署 artifact 與現況模組邊界。
- production Pages 若出現 P0 blocker，可以在 master vanilla UI 做最小 hotfix。
- P1/P2 UX、非緊急 polish 與新功能進 migration milestones，不再擴張 vanilla overlay/select/sheet 邏輯。
- 若 hotfix 影響 URL、candidate、analytics、filter 或 Pages artifact contract，必須同步更新 tracking issue #44 與 `docs/public-frontend-react-migration-plan.md`。
- final cutover 前，vanilla Pages surface 必須維持可 rollback；legacy cleanup 必須是最後獨立 phase。

## Rollback

每個 phase 應是可 review 的小 PR。若任一 phase 造成 Pages build、artifact check、URL/candidate contract 或 mobile P0 regression，應 revert 該 phase，而不是在同一 PR 內累積補丁。

final cutover 前，正式 Pages 應可回到 master vanilla artifact。cutover 與 legacy cleanup 必須分開，方便回退。
