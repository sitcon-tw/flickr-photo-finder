# AI Proposal Fixtures

這個目錄保存 AI 初標 proposal 的回歸測試範例。每個子目錄都是一個最小 AI run 目錄，包含：

- `manifest.json`
- `photos.json`
- `metadata-proposals.json`

驗證所有範例：

```bash
pnpm ai:validate-fixtures
```

命名規則：

- `valid-*` 必須通過 `pnpm ai:validate`。
- `warning-*` 必須通過 `pnpm ai:validate`，但要產生人工 review warning。
- `invalid-*` 必須被 `pnpm ai:validate` 擋下。
