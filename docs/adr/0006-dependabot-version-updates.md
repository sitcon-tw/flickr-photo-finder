# ADR 0006: 使用 Dependabot 追蹤依賴版本更新

## 狀態

Accepted

## 背景

這個 repo 使用 `pnpm` 管理 Node dependencies，並透過 GitHub Actions 執行 CI / Pages 部署。這些依賴不直接定義產品功能，但會影響 CLI、Sheets / GA4 整合、Pages build 與維護工具的可持續性。

GitHub 能從 `package.json` 與 `pnpm-lock.yaml` 建立 dependency graph，但這不等於會自動開一般版本更新 PR。一般版本更新需要設定 Dependabot version updates；安全性更新與一般版本更新也不是同一件事。

## 決策

使用 GitHub 原生 Dependabot version updates，不先導入 Renovate。

即使專案使用 `pnpm`，Dependabot 設定仍使用 `package-ecosystem: "npm"`。Dependabot 會依據 repo 中的 `pnpm-lock.yaml` 處理 pnpm lockfile，不應新增 `package-lock.json` 或改用 npm / yarn。

Node dependencies 每週檢查一次。minor 與 patch 更新用 group 合併成單一 PR，major 更新則保持獨立 PR，避免重大版本變更和低風險更新混在一起。

GitHub Actions 每月檢查一次，並和 Node dependencies 分開追蹤。

## 取捨

選 Dependabot 的理由：

- GitHub 原生功能，設定與權限成本最低。
- 目前不需要 Renovate 的複雜 grouping、automerge、range strategy 或 dashboard。
- PR 會走既有 CI 與人工 review 流程，符合目前小型維護節奏。

暫不選 Renovate 的理由：

- Renovate 功能更完整，但設定面與後續維護成本較高。
- 目前沒有 monorepo、多 ecosystem 或進階 release policy 需求。
- 若未來需要更細分 group、dependency dashboard 或更完整 automerge policy，再重新評估。

minor / patch 使用 group 的理由：

- 逐包開 minor / patch PR 容易增加維護噪音。
- minor / patch 通常風險較低，合併檢查成本比逐包 review 更合理。

major 不 group 的理由：

- major update 可能改變 API 或行為，應獨立 review。
- 若 grouped PR 失敗，拆分定位成本會較高；major 分開能保留較清楚的責任邊界。

## 維護邊界

- 仍只使用 `pnpm` 作為本 repo package manager。
- Dependabot PR 若更新 Node dependencies，應保留並更新 `pnpm-lock.yaml`。
- Dependabot PR 不應引入 `package-lock.json` 或 `yarn.lock`。
- 依賴更新若影響 CLI、Sheets、GA4、AI workflow 或 Pages build，應依更動範圍執行對應 `pnpm` checks。
