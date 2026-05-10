# 協作方式

這個專案會以開源方式釋出，歡迎用 issue 或 pull request 協助改善照片索引方法、資料流程、AI 初標規則、文件與公開搜尋前端。

## 可以協助的方向

- 修正文件，讓非技術背景的整理者更容易理解流程。
- 改善 `data/photo-schema.json`、`data/tag-taxonomy.json`、AI prompt 或 validator。
- 改善 Flickr intake、Google Sheets dry-run/write、AI review/report 或 GitHub Pages 前端工具。
- 回報實際找圖時遇到的搜尋困難，協助調整欄位與 taxonomy。

## 開發前檢查

請使用 pnpm，不要使用 npm 或 yarn。

```bash
pnpm data:validate
pnpm eval:validate-fixtures
pnpm finder:build
pnpm finder:check
```

如果只改文件，可以視情況只跑和變更相關的檢查。

## 資料與 credential 邊界

- 不要 commit `credentials.json`、OAuth token、AI API key、`.clasp.json` 或 `tmp/` 內的工作產物。
- `fixtures/*.csv` 是 sample 與測試資料，不是正式資料。
- 正式照片索引以 Google Sheets 為準；寫入工具預設 dry-run，加上 `--write` 才會修改正式 Sheets。
- AI 候選值必須先通過 validator 與人工檢查，不能直接把照片標成 `reviewed` 或 `approved`。

## 授權

提交 pull request 代表你同意將貢獻內容依本專案的 Apache-2.0 授權釋出。
