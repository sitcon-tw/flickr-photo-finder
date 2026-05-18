# Security Policy

這份文件說明 SITCON Flickr Photo Finder 的安全回報方式、公開資料邊界與 credential 管理原則。

## 回報安全問題

如果你發現可能影響本專案、公開搜尋前端、Google Sheets 索引、Apps Script 輔助工具或維護流程的安全問題，請不要先開公開 issue。

請改用下列其中一種私下管道：

- Email: sitcon-dev@googlegroups.com
- 使用 [GitHub Security Advisory](https://github.com/sitcon-tw/flickr-photo-finder/security/advisories)。
- 若你已知道 SITCON 維護者的私下聯絡方式，請直接聯絡維護者。

回報時請盡量包含：

- 受影響的 URL、檔案、command 或功能。
- 可重現步驟。
- 你認為可能外洩、被修改或被濫用的資料類型。
- 問題是否已被公開揭露。

## 範圍

在本專案安全回報範圍內：

- GitHub Pages 公開搜尋前端。
- repo 內的 CLI、validation、build、Sheets sync 與 AI labeling 工具。
- Apps Script source code、generated config 與部署輔助流程。
- Pages artifact 是否意外包含 credential、token、非公開資料或不必要的 repo 內容。
- 公開照片 metadata、公開欄位與敏感內容防呆。

不在本專案安全回報範圍內：

- Flickr、Google Sheets、Google Drive、Google Apps Script、GA4、GitHub 或其他第三方平台本身的漏洞。
- SITCON Flickr 原始照片的授權爭議。
- 已公開的 Flickr 照片、相簿、photo ID 或公開 metadata 本身。
- repo 文件已明確列為 public configuration 的 identifier。

若問題屬於第三方平台，請依該平台的安全回報流程處理。

## Public Identifiers Are Not Secrets

這個專案會公開一些固定 identifier。這些值不是 credential，也不應只因為出現在 repo 或 Pages artifact 就視為 secret leak：

- Google Sheets spreadsheet ID。
- Google Apps Script project 或 script ID。
- GA4 measurement ID 與 property ID。
- Flickr user ID、album ID、photo ID 與公開照片 URL。
- GitHub Pages URL。

真正不應提交或公開的是：

- Google service account JSON。
- OAuth token、browser login cache 或個人授權檔。
- `.clasp.json`、`.clasprc.json` 或個人 clasp token。
- AI API keys。
- 可寫入 Google Sheets、GA4、Apps Script、GitHub 或第三方服務的 credential。
- 內部需求單、私人文件連結、未公開人員資料、私人聯絡方式或敏感備註。

## Public Data Boundary

GitHub Pages 前端是唯讀公開介面。它應讀取公開照片索引資料，不應包含寫入 credential 或 server-side secret。

Google Sheets 是正式照片索引。部分資料會被公開搜尋前端、AI 助手與維護工具使用，因此：

- `curation_notes` 是公開欄位，不應放敏感內部資訊。
- 照片 metadata 不應包含未確認身份、私人聯絡方式、內部討論或未公開需求。
- AI-generated labels 只能是 human-reviewable candidates，不應直接視為人工確認事實。
- 實際發布或交付素材前，仍應回 Flickr 原頁確認來源、授權與使用脈絡。

## Maintainer Checklist

合併、部署或操作寫入流程前，維護者應確認：

- 工作樹沒有 credential、token 或 `tmp/` 工作產物要被提交。
- Pages artifact 不包含 repo 工具、維護文件草稿、credential 或非公開資料。
- Sheets write tools 預設 dry-run，只有明確 `--write` 才修改正式資料。
- GA4 custom dimensions 不註冊 `search_term`、`photo_id`、`content_id`、`result_rank` 等高基數或可能敏感參數。
- Apps Script push/deploy 使用 repo wrapper，且 target 正確。

相關文件：

- `docs/operations-handoff-checklist.md`
- `docs/public-frontend-architecture.md`
- `docs/frontend-analytics-design.md`
- `docs/ga4-operations.md`
- `docs/sheets-sync-workflow.md`
- `docs/apps-script-maintenance-design.md`
