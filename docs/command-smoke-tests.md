# Command smoke tests

這份文件說明 command-level smoke tests 的範圍。目標是讓 CI 提早發現 CLI entrypoint、help path、import-time dependency 或 shared helper 變更造成的基本壞掉狀態；它不是 Google Sheets、Flickr、Apps Script 或 GA4 的 integration test。

## CI 預設檢查

`pnpm command:smoke` 會掃描 `scripts/commands/` 與 `scripts/workflows/` 中支援 `--help` 的 `.mjs` entrypoint，逐一執行：

```bash
node <entrypoint> --help
```

這個檢查不需要 credential，不應呼叫外部 API，不寫入 `tmp/` 以外的資料，也不應開啟互動式 prompt。若新增 command entrypoint，請提供 `--help`，讓它自然納入 `pnpm command:smoke`。

`pnpm project:check` 已包含 `pnpm command:smoke`，因此 GitHub Actions 的 Pages workflow 會在 PR 與 `master` push 時執行這層檢查。

## 已由其他 no-credential 檢查涵蓋

以下檢查也可在 CI 跑，且不需要 Google credential：

| 檢查 | 用途 |
| --- | --- |
| `pnpm docs:check` | 本機 Markdown link、docs index 覆蓋與文件中的 package script reference 檢查。 |
| `pnpm language:check` | 文件與程式輸出用語治理，包含相對版本詞與台灣繁中技術詞彙。 |
| `pnpm shared-values:check` | `data/interface-registry.json` 與 schema/taxonomy 對齊。 |
| `pnpm data:validate` | fixture/schema/taxonomy 基本資料驗證。 |
| `pnpm eval:validate-fixtures` | AI proposal fixture 合約驗證。 |
| `pnpm finder:test` | GitHub Pages 前端純邏輯測試。 |
| `pnpm finder:build` / `pnpm finder:check` | 產生並檢查 Pages artifact。 |
| `pnpm finder:mobile-filter-smoke` | 需要本機 Chrome/Chromium，但不需要 credential。 |

## 不放入 CI 預設 smoke 的類型

### 需要 Google credential 的 dry-run 或唯讀整合

這些 command 即使是 dry-run 或唯讀，也需要 `GOOGLE_APPLICATION_CREDENTIALS` 或 Google 後台權限，因此不放進無 credential CI smoke：

| 類型 | 例子 |
| --- | --- |
| Sheets 讀取或 dry-run 寫入 | `sheets:export`、`sheets:report -- --source sheets`、`sheets:onboarding:check`、`sheets:apply-init`、`sheets:migrate-headers`、`sheets:migrate-field-value`、`sheets:sync-guide`、`sheets:sync-taxonomy`、`sheets:practice:sync`、`sheets:apply-intake`、`sheets:apply-ai-updates` |
| 直接讀正式 Sheets 的相簿選擇 | `albums:list -- --source sheets`、`albums:select -- --source sheets` |
| GA4 Admin API | `analytics:dimensions:check`、`analytics:dimensions:sync` |
| Apps Script smoke rows | `apps-script:smoke-test -- --check`、`apps-script:smoke-test -- --append`、`apps-script:smoke-test -- --delete` |

這些流程需要在有正確 service account、scope、目標 Sheet/GA4 權限與人工確認的環境中另外跑。

### 需要外部服務穩定性的流程

這些 command 不一定需要 credential，但會依賴 Flickr、公開 Google Sheets CSV、網路或下載穩定性。它們可以作為人工驗證或特定 workflow 的檢查，不應只為了 command smoke 而加入 CI 預設層：

| 類型 | 例子 |
| --- | --- |
| Flickr album/photo 讀取 | `albums:discover`、`photos:import`、`intake:run` |
| AI run 圖片下載 | `ai:prepare` |
| dev server | `finder:dev`、`finder:dev:fixture`、`finder:dev:export` |

### 會改變遠端狀態或本機授權狀態的流程

這些 command 不屬於 smoke test，必須由有權限的維護者明確操作：

| 類型 | 例子 |
| --- | --- |
| Google Sheets write | 任何加上 `--write` 的 Sheets apply/sync/migrate command |
| Apps Script/clasp | `apps-script:login`、`apps-script:bind`、`apps-script:push`、`apps-script:deployments`、`apps-script:status`、`apps-script:open` |
| GA4 write | `analytics:dimensions:sync` |

## 維護規則

- 新增 command 時，若它是給操作者使用的 CLI，請實作 `--help`，並確認 `pnpm command:smoke` 會涵蓋它。
- 若 command 必須依賴 credential、網路或寫入狀態，`--help` 仍應可在無 credential 環境執行。
- 若新增真正的 integration test，請在文件中明確標示需要的 credential、scope、dry-run/write 行為與驗證方式，不要混入 `pnpm command:smoke`。
