# 公開檢索前端架構

## 目的

這份文件記錄公開唯讀照片檢索前端的方向。

Google Sheets 是正式照片索引資料庫，Apps Script 可以作為具有授權的維護輔助介面；但更多使用者只需要能夠存取、搜尋與篩選照片，不需要編輯資料。公開檢索前端應部署到 GitHub Pages，降低使用門檻。

## 核心決策

- GitHub Pages 前端是公開、唯讀、無登入門檻的搜尋介面。
- 資料來源仍是 Google Sheets，不是 repo 內 sample data。
- GitHub Pages 前端不保存 secret，也不使用需要私人 credential 的 Google API。
- 前端應讀取 Google Sheets 的公開輸出層，例如 `published_photos` sheet 匯出的 CSV 或 JSON。
- Apps Script 保留為授權維護介面，以及產生公開輸出層的工具。

## 建議資料流

```text
Google Sheets
  photos              人工編輯主表
  taxonomy            受控字彙
  sponsorship_items   贊助品項
  published_photos    給公開前端讀取的乾淨輸出

Apps Script
  欄位驗證
  編輯輔助
  產生或更新 published_photos

GitHub Pages
  唯讀搜尋 UI
  讀取 published_photos 公開輸出

Repo
  schema
  taxonomy
  validation
  CLI
  AI prompt
  Apps Script source
  GitHub Pages UI
```

## 為什麼不要直接讀人工編輯主表

即使照片索引資料預設可以公開，公開前端仍不應直接讀人工編輯主表。

原因：

- 人工編輯主表可能包含暫存欄位、檢查欄或整理中的資料。
- 未整理照片可能還不適合被一般使用者搜尋到。
- 公開前端需要穩定欄位與資料格式，人工編輯主表可能因整理需要而調整。
- 未來若需要隱藏某些維護欄位，公開輸出層比較容易控管。

因此應建立 `published_photos` 或等價的公開輸出。公開前端只讀這個乾淨輸出層。

## 前端資料來源設定

目前前端從 `app/config.js` 讀取資料來源：

```js
export const dataSources = {
  photosCsvUrl: "../data/photos.csv",
  taxonomyJsonUrl: "../data/tag-taxonomy.json",
};
```

本機開發預設讀 repo 內 sample/export data。部署到 GitHub Pages 時，`photosCsvUrl` 應改成 Google Sheets `published_photos` 的公開 CSV 或 JSON 輸出 URL。

前端可以讀公開資料 URL，但不能使用任何需要保密的 token、API key 或 OAuth credential。

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

MVP 的 100 到 300 張精選照片可以由前端一次載入並在瀏覽器內搜尋。

若未來資料量增加到數千張以上，再評估：

- 產生搜尋索引。
- 分頁或 lazy loading。
- 依 `curation_status`、`public_use_status`、`priority_level` 與 `collections` 產生推薦排序。
- 改用 API 或正式資料庫。

## 殘餘風險

- Google Sheets 公開輸出 URL 的格式或 CORS 行為可能改變。
- Google Sheets 更新到公開輸出可能有延遲。
- 若公開輸出層沒有驗證，前端可能載入不完整資料。
- 若前端直接讀太大的 CSV，載入速度會下降。

這些風險應由 Apps Script、repo validation、同步工具與公開輸出層共同處理，而不是讓 GitHub Pages 前端承擔資料治理責任。
