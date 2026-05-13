# 架構決策紀錄

這個目錄記錄已經影響專案形狀的架構決策。ADR 不取代 `docs/project-architecture.md`、各 workflow runbook 或 `data/*.json` 真理來源；它只補上「當時為什麼這樣選、接受了哪些取捨、如何維持這個決策的邊界」。

## 閱讀方式

- 需要理解目前完整資料流時，先讀 `docs/project-architecture.md`。
- 需要操作或維護某條流程時，回到 `docs/README.md` 選對 runbook。
- 需要知道某個架構選擇為什麼存在、接受了哪些取捨與維護邊界時，再讀這裡。

## 狀態

- `Accepted`: 目前採用，後續實作與文件應維持一致。
- `Superseded`: 已被另一份 ADR 或文件明確取代。
- `Proposed`: 尚未成為專案共識，不能當作目前架構依據。

## 決策列表

| ADR | 狀態 | 決策 |
| --- | --- | --- |
| [0001](0001-sheets-first.md) | Accepted | Google Sheets-first 作為 1.0 正式照片索引與人工維護介面。 |
| [0002](0002-github-pages-artifact-deploy.md) | Accepted | GitHub Pages 透過 GitHub Actions artifact 部署公開唯讀前端。 |
| [0003](0003-ai-candidate-only.md) | Accepted | AI 只產生人類可審核候選 metadata，不直接完成 review 或批准公開使用。 |
| [0004](0004-sponsorship-items-snapshot.md) | Accepted | SITCON 2026 CFS 贊助品項作為固定 snapshot，不自動同步遠端來源。 |
| [0005](0005-no-drive-file-transfer-for-sheets-tables.md) | Accepted | repo CLI 不用 Google Drive file transfer 表達 Sheets table semantics。 |
| [0006](0006-dependabot-version-updates.md) | Accepted | 使用 Dependabot 追蹤 pnpm 專案的 Node dependency 與 GitHub Actions 版本更新。 |
| [0007](0007-pages-react-aria-vite-migration.md) | Accepted | Pages 前端長期遷移至 Vite、React、TypeScript 與 React Aria；production 仍維持 vanilla app 到 final cutover。 |
