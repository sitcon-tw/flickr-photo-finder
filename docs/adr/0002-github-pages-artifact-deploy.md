# ADR 0002: GitHub Pages 透過 artifact 部署公開前端

## 狀態

Accepted

## 背景

公開搜尋前端要讓宣傳、設計、網站、公關、行銷與其他使用者能以低門檻搜尋照片索引。它是公開、唯讀、無登入需求的找圖介面，不是資料維護後台，也不應取得寫入 Google Sheets 的能力。

GitHub Pages 可以承載靜態前端，但若直接發布整個 repo root，容易把工具腳本、文件草稿、fixture、tmp artifact 或不該公開的檔案一起暴露，也會讓部署內容和原始碼邊界不清楚。

## 決策

GitHub Pages 應透過 GitHub Actions 產生乾淨 artifact 後部署：

- `pnpm finder:build` 產生 `tmp/pages/`。
- `pnpm finder:check` 檢查 artifact 內容與資料設定。
- GitHub Actions 上傳 `tmp/pages/` 作為 Pages artifact。
- repository Pages source 使用 GitHub Actions。
- artifact 只包含公開搜尋前端、必要靜態資源、部署版 config，以及前端讀取 schema、taxonomy、search aliases 需要的公開資料。

公開前端不保存 secret，也不使用需要私人 credential 的 Google API。初版 runtime 曾直接讀取 Google Sheets `photos` 工作表的公開 CSV 輸出；2026-05-17 起，部署版預設由 `pnpm finder:build` 在 build 階段讀公開 CSV，轉成 `data/finder-data/` static-sharded artifact，前端 runtime 讀靜態 index 與 detail shards。`runtime-csv` 保留為本機開發與緊急 fallback。

## 取捨

優點：

- 部署內容和 repo 原始碼、文件、工具清楚分離。
- CI 可以在 PR 檢查 artifact 是否真的可部署。
- 公開前端維持無 credential、唯讀與低維護成本。
- build 階段可以產生靜態 JSON、搜尋索引或 metadata，而不改變 Pages 的安全邊界。

代價：

- 部署流程依賴 GitHub Actions 與 Pages artifact 設定。
- build script 與 check script 必須隨前端檔案拆分同步維護。
- 若 Google Sheets 公開 CSV 延遲或格式改變，build 階段仍會受影響；但使用者瀏覽器不再直接依賴 CSV endpoint。

## 替代方案

- 直接發布 repo root：設定簡單，但容易暴露非部署檔案，也讓 artifact 邊界消失。
- Apps Script Web App 作為公開前端 API：會混淆公開唯讀找圖與授權維護介面。
- GitHub Actions 用 service account 匯出靜態資料：目前不需要。若未來公開 CSV 不足以支援 build-time 匯出，credential 只能留在 CI secret 邊界，產物仍必須是公開唯讀 artifact。
- 前端直接使用 Google Sheets API：會引入 API key、OAuth、quota 與前端 credential 管理問題。

## 維護邊界

公開前端資料載入方式可以持續優化，但不應降低公開唯讀與無 secret 的邊界：

- 需要進一步改善 build-time 搜尋索引、分頁 JSON、detail shard 或快取策略。
- GitHub Pages artifact 部署限制無法滿足正式上線需求。
- 需要多個公開前端環境，且 artifact 內容需要更明確的環境切分。

## 相關文件

- `docs/public-frontend-architecture.md`
- `docs/project-architecture.md`
- `.github/workflows/pages.yml`
- `scripts/commands/build-pages.mjs`
- `scripts/commands/check-pages-artifact.mjs`
