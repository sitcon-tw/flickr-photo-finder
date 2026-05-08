# 公開檢索前端架構

## 目的

這份文件記錄公開唯讀照片檢索前端的方向。

Google Sheets 是正式照片索引資料庫，Apps Script 可以作為具有授權的維護輔助介面；但更多使用者只需要能夠存取、搜尋與篩選照片，不需要編輯資料。公開檢索前端應部署到 GitHub Pages，降低使用門檻。

## 核心決策

- GitHub Pages 前端是公開、唯讀、無登入門檻的搜尋介面。
- 資料來源仍是 Google Sheets，不是 repo 內 sample data。
- GitHub Pages 前端不保存 secret，也不使用需要私人 credential 的 Google API。
- 前端應讀取 Google Sheets `photos` 主表，或讀取由 `photos` 以同一套欄位匯出的公開 CSV/JSON。
- Apps Script 保留為授權維護介面與欄位驗證工具，不負責建立額外篩選表。

## 建議資料流

```text
Google Sheets
  photos              照片索引主表，公開可讀
  taxonomy            受控字彙
  sponsorship_items   贊助品項

Apps Script
  欄位驗證
  編輯輔助
  檢查 photos 公開讀取格式

GitHub Pages
  唯讀搜尋 UI
  讀取 photos 或同欄位公開匯出

Repo
  schema
  taxonomy
  validation
  CLI
  AI prompt
  Apps Script source
  GitHub Pages UI
```

## 為什麼不建立額外公開表

目前資料庫的目標是替 Flickr 照片加註 metadata，讓人類、前端與 AI 可以依欄位自行挑選。它不是要在資料庫內先做出另一層篩選結果。

因此 MVP 不建立 `photos` 之外的公開篩選表。公開前端可以直接讀 `photos`，或讀由 `photos` 匯出的同欄位 CSV/JSON。

這個設計的好處：

- 不會讓維護者以為有兩份照片資料需要同步。
- 不會讓 AI 誤以為公開匯出已經替它篩選過照片。
- 未整理照片仍可被搜尋，但會透過 `curation_status`、`public_use_status`、`priority_level` 等欄位排序與提示。
- 若未來真的需要隱藏欄位或拆分公開/非公開資料，再重新設計資料邊界。

前端不應依賴 Sheets 的顏色、註解、排序或篩選檢視。所有可搜尋、可排序、可提醒的語意都應來自欄位值。

## 前端資料來源設定

目前前端從 `app/config.js` 讀取資料來源：

```js
export const dataSources = {
  photosCsvUrl: "../data/photos.csv",
  taxonomyJsonUrl: "../data/tag-taxonomy.json",
};
```

本機開發預設讀 repo 內 sample/export data。部署到 GitHub Pages 時，`photosCsvUrl` 應改成 Google Sheets `photos` 的公開 CSV 或 JSON 輸出 URL。

前端可以讀公開資料 URL，但不能使用任何需要保密的 token、API key 或 OAuth credential。

公開讀取規則記錄在 `docs/google-sheets-database-design.md`，外部 AI 讀取方式記錄在 `docs/ai-readable-dataset.md`。

## GitHub Pages 部署注意事項

GitHub Pages 應透過 GitHub Actions 發布乾淨的 Pages artifact，不應直接把整個 repo root 當成 Pages source。

發布 artifact 應只包含：

- 公開檢索前端所需的 HTML、CSS、JavaScript。
- 經過資料流程產生或指定的公開資料來源設定。
- 必要的靜態資源。

發布 artifact 不應包含：

- repo 內的工具腳本。
- 文件草稿或維護文件。
- sample / fixture data，除非該部署明確是 demo。
- credential、token 或任何需要交接但不應公開的設定。

前端檔案應使用相對路徑，避免專案頁部署在 `https://<org>.github.io/<repo>/` 時因絕對路徑失效。

## 搜尋規模

MVP 初期的 100 到 300 張公開索引照片可以由前端一次載入並在瀏覽器內搜尋。

若未來資料量增加到數千張以上，再評估：

- 產生搜尋索引。
- 分頁或 lazy loading。
- 依 `curation_status`、`public_use_status`、`priority_level` 與 `collections` 產生推薦排序。
- 改用 API 或正式資料庫。

## 殘餘風險

- Google Sheets 公開輸出 URL 的格式或 CORS 行為可能改變。
- Google Sheets 更新到公開匯出 URL 可能有延遲。
- 若 `photos` 欄位格式沒有驗證，前端可能載入不完整資料。
- 若前端直接讀太大的 CSV，載入速度會下降。

這些風險應由 Apps Script、repo validation 與同步工具共同處理，而不是讓 GitHub Pages 前端承擔資料治理責任。
