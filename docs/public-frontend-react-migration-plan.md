# Pages React Migration Plan

## 接手入口

任何 agent 或維護者繼續 Pages React migration 前，必須先讀：

1. Tracking issue: <https://github.com/sitcon-tw/flickr-photo-finder/issues/44>
2. `docs/adr/0007-pages-react-aria-vite-migration.md`
3. `docs/public-frontend-react-migration-plan.md`
4. `docs/public-frontend-architecture.md`

Tracking issue 是目前進度來源；本文件是穩定執行規格。若兩者衝突，先更新 issue 或本文件，不直接實作。

## Summary

Pages frontend 從 master 重新啟動長期遷移。目標是把長期 UI shell 從 vanilla ES modules 逐步遷移到 Vite + React + TypeScript + React Aria，同時保留公開唯讀資料邊界、既有 finder 指令、GitHub Pages artifact 部署、URL/candidate contract 與 Google Sheets 資料契約。

目前進度已進入 Phase 7 final cutover：正式 `pnpm finder:build` / `pnpm finder:check` 目標改為 React Pages artifact。`app/` vanilla surface 在 Phase 8 legacy cleanup 前只作 rollback 參考，不再是正式 Pages artifact 入口。

下方 Phase 0-6 保留為已完成階段的歷史 gate；其中提到的 `preview-only`、`正式 UI 仍為 vanilla` 或 `cutover 前` 是當時驗收條件，不代表目前 production 狀態。

封存 tag `archive/pages-react-aria-migration-prototype-2026-05-14` 目前指向 commit `ad1003097b252b479474ce92bfcd1b44f2cc1ce7`。它只作 reference，不 cherry-pick prototype 實作 commit。後續每個 phase 都必須先定義目標、不改什麼、驗收 gate 與 rollback 條件。

## Phase Plan

### Phase 0: Governance

目的：先固定決策、進度入口與驗收方式，不改 UI、不加 dependencies、不動 build pipeline。

要做：

- 建立 tracking issue #44。
- 新增 ADR 0007。
- 新增本 migration plan。
- 更新 `docs/README.md` 與 `docs/public-frontend-architecture.md`，讓新 agent 找得到入口。

驗收：

- `pnpm language:check`
- `pnpm project:check`

Rollback：

- 只 revert docs commit，不影響 production Pages。

### Phase 1: Build scaffold

目的：導入 Vite + React + TypeScript build path，但不改正式 UI。

要做：

- 新增 Vite/React/TypeScript toolchain 與 `app-react/` scaffold。
- Vite build output 只產生 preview artifact，例如 `tmp/pages-react/`，不寫入正式 `tmp/pages/`。
- 正式 `pnpm finder:build` 仍輸出 vanilla Pages artifact；`index.html` 仍引用 vanilla `./main.js`。
- 保留 `pnpm finder:dev`、`finder:dev:fixture`、`finder:dev:export`、`finder:build`、`finder:check` 指令名稱與資料來源語意。
- 若新增 React dev/build 指令，必須是 preview-only，例如 `finder:react:dev` / `finder:react:build`；不要改變正式 finder 指令的使用者語意。
- `check-pages-artifact.mjs` 在 Phase 1 仍檢查 vanilla artifact；React preview artifact 可新增獨立檢查，但不得讓正式 artifact check 誤判 production 已 cutover。
- 若 React preview gate 納入 `project:check`，需在 PR body 與 tracking issue 記錄 blast radius：preview-only stack 失敗會阻擋 GitHub Pages workflow，即使正式 artifact 仍是 vanilla。
- `tmp/pages/` 仍是 GitHub Pages artifact 輸出。

不改：

- 不切換正式 UI。
- 不讓 React/Vite bundle 進入正式 `tmp/pages/`。
- 不改 URL query。
- 不改 candidate list behavior。
- 不改 Google Sheets data contract。

驗收：

- `pnpm project:check`
- `pnpm finder:build`
- `pnpm finder:check`
- React preview build 指令若已新增，需在 PR body 貼出 preview artifact 路徑與 smoke 結果。
- artifact 不包含 repo scripts、docs、fixtures、tmp data 或 credential。

Rollback：

- revert scaffold PR；vanilla artifact build path 仍可使用。
- 若 production vanilla P0 hotfix 被 preview-only gate 阻擋，先在 #44 記錄原因，再以最小 PR 修復或暫時移除該 preview gate；不得讓 preview scaffold 阻止緊急 Pages 修復。

### Phase 2: Contract tests

目的：先鎖住資料與互動 contract，不在同一 PR 內 port core。

要做：

- 補 URL state tests：task、search、sort、多選 filters、selected candidate order、unknown query 不 crash。
- 補 candidate output tests：IM、collaboration、sponsor、Flickr URL formats。
- 補 filter semantics tests：同欄位 OR、不同欄位 AND、active chips 一值一顆。

不改：

- 不改 UI。
- 不改 URL semantics。
- 不改 candidate URL behavior。
- 不做 TypeScript port。

驗收：

- `pnpm finder:test`
- `pnpm project:check`

Rollback：

- revert contract test PR；若 tests 揭露既有 bug，先在 issue #44 記錄再決定修復 phase。

### Phase 3: Core TypeScript migration

目的：在 contract tests 保護下，逐步把 pure finder core 移到 TypeScript。

要做：

- Port search/sort、URL state、data normalization、candidate copy、analytics pure helpers。
- 保留 finder test import path 或提供明確 compatibility layer，避免一次改動測試與產品入口。

不改：

- 不改 UI。
- 不改正式 Pages artifact。
- 不改 URL/candidate/data contract。

驗收：

- `pnpm finder:test`
- `pnpm project:check`

Rollback：

- 每個 core area 獨立 PR；任一 port regression 可 revert，不影響 vanilla shell。

### Phase 4: React shell

目的：建立 React product shell，但先不處理最複雜 overlay/picker。

要做：

- React AppShell、data loading、result grid、photo card、result status、candidate state、preview state。
- 使用單一 finder state：task mode、search、sort、filters、selected candidates、active preview。
- DOM 不作 canonical state source；component 只接收 state 並發出 action。
- Desktop 與 mobile presentational layout 分開，不把 mobile sheet 模式套到 desktop。

不改：

- 不提前移除 vanilla UI。
- 不改 data contract。
- 不擴張 analytics taxonomy，除非先更新 `docs/frontend-analytics-design.md`。

驗收：

- PR body 必須貼出 fixture、export、sheets 三種來源的 smoke 結果與使用指令。
- URL/candidate round-trip tests 通過。
- `pnpm project:check`

Rollback：

- cutover 前 React shell 可撤回，不影響 vanilla Pages。

### Phase 5: React Aria interactions

目的：處理真正高風險互動 primitive。

要做：

- FilterSheet、CandidateSheet、PhotoPreviewSheet 使用 React Aria Dialog/Modal。
- FilterMultiSelect 使用 Button + Popover + SearchField/ListBox multiple selection。
- Sort 使用 Select；不要把 multi-value filter 語意塞進單選 Select。
- 贊助品項保留片段文字搜尋能力，不限制只能選完整品項。
- 下滑關閉集中在單一 dismissible sheet hook。
- 手機搜尋框與多選搜尋框不 auto focus。

驗收：

- close button、outside click、Escape、focus restore。
- background scroll lock。
- popover 不超出 viewport。
- 主要 touch target 至少 44px。
- mobile 無水平 overflow。

Rollback：

- sheet/picker migration 各自獨立 PR；單一互動回歸不應拖垮整個 React shell。

### Phase 6: Regression coverage

目的：在正式切換前補足自動與人工驗收，不切換 production artifact。

要做：

- 導入 tracked mobile regression test，優先 Playwright；若短期不用 Playwright，至少把 mobile QA script 納入 repo。
- 覆蓋 360x800、390x844、430x932、1366x768、1440x900。
- 驗證 first screen、filter sheet、candidate sheet、preview/detail、URL with candidates、44px touch targets、scroll lock、popover placement。
- 建立 cutover 前必須通過的 responsive/mobile gate。

驗收：

- `pnpm project:check`
- `pnpm finder:build`
- `pnpm finder:check`
- mobile/responsive regression
- fixture、export snapshot、正式 Sheets manual QA

Rollback：

- revert regression harness PR 不影響 production Pages。

### Phase 7: Final cutover

目的：正式 Pages artifact 切到 React app，但保留 vanilla surface 以便 rollback。Phase 7 合併後，production Pages P0 hotfix 應優先修 React artifact；若需要回退才 revert cutover PR。

要做：

- `pnpm finder:build` 開始輸出 React Pages artifact。
- `pnpm finder:check` 改驗證 React artifact。
- `pnpm finder:dev`、`finder:dev:fixture`、`finder:dev:export` 透過同一個 build orchestrator 產生 React dev artifact，再用靜態伺服器預覽。
- `docs/public-frontend-architecture.md`、ADR 0007 與 ADR index 必須同步反映 production 已切到 React。
- PR body 必須附 fixture、export snapshot、正式 Sheets manual QA 結果。

不改：

- 不刪除 vanilla source。
- 不移除 vanilla rollback path。

驗收：

- `pnpm project:check`
- mobile/responsive regression
- fixture、export snapshot、正式 Sheets manual QA

Rollback：

- revert cutover PR 即可回到 vanilla artifact。

### Phase 8: Legacy cleanup

目的：cutover 穩定後，移除 vanilla surface 與過渡補丁。

要做：

- 移除 final cutover 後已不再使用的 vanilla UI surface。
- 更新 docs、artifact check 與 maintenance guide。
- 在 issue #44 記錄 cutover 穩定證據後才執行。

驗收：

- `pnpm project:check`
- `pnpm finder:build`
- `pnpm finder:check`
- mobile/responsive regression

Rollback：

- 若 cleanup 後發現仍需 rollback surface，revert cleanup PR，不 revert cutover PR。

## Manual QA Scripts

- 社群快速挑 5 張照片，加入候選並複製 IM 討論清單。
- 設計找橫式、留白、可裁切照片，檢查 preview/detail 與大圖來源。
- 贊助成果用 sponsorship filters 收斂，複製 collaboration / sponsor checklist。
- Desktop 檢查固定工作台心智：filter、result grid、detail inspector、candidate、overview、AI assistant。
- Mobile 檢查快速挑選心智：first screen、固定「篩選 / 候選」入口、filter sheet、candidate sheet、preview/detail、44px targets。

## Commit / PR Plan

- `docs(pages): define React migration governance`
- `chore(pages): scaffold Vite React build path`
- `test(pages): lock finder URL and candidate contracts`
- `refactor(pages): migrate finder core contracts to TypeScript`
- `feat(pages): add React finder shell behind build path`
- `feat(pages): migrate mobile sheets with React Aria`
- `feat(pages): migrate filter controls with React Aria`
- `test(pages): add responsive finder regression coverage`
- `chore(pages): switch Pages artifact to React`
- `chore(pages): retire vanilla finder surface`

## Assumptions

- Pages remains a static GitHub Pages frontend.
- Google Sheets remains the authoritative photo index.
- Public frontend remains read-only and credential-free.
- React Aria is used for interaction and accessibility primitives, not as a visual UI kit.
- Final cutover 後，production P0 hotfixes 應落在 React artifact；vanilla UI 只保留到 Phase 8 cleanup 前作 rollback surface。
