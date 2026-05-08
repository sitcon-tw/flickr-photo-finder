# SITCON Flickr Photo Finder

這個 repo 用來建立 SITCON Flickr 照片索引，協助籌備團隊用實際工作情境找照片，例如社群宣傳、網站視覺、贊助提案、贊助成果報告、新聞稿、志工招募與活動回顧。

這裡不取代 Flickr，也不保存原圖。核心資料是 Flickr 照片連結、縮圖、標籤、用途判斷與素材包。

## 快速開始

目前不需要安裝額外套件。需要 Node.js，已知可用版本為 `v24.15.0`。

驗證資料：

```bash
npm run validate:data
```

啟動搜尋介面：

```bash
npm run dev
```

開啟 `http://localhost:4173/`。

從 Flickr 照片 URL 產生一列 CSV：

```bash
npm run photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID
```

也可以一次處理多張：

```bash
npm run photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID https://www.flickr.com/photos/sitcon/PHOTO_ID_2
```

確認輸出後寫入 `data/photos.csv`：

```bash
npm run photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID --append
```

寫入後請補齊人工判斷欄位，再跑：

```bash
npm run validate:data
```

`--append` 寫入後會自動跑一次資料驗證；補齊人工欄位後仍建議再跑一次。

## 主要檔案

- `data/photos.csv`: 第一版照片索引。
- `data/tag-taxonomy.json`: 受控標籤與列舉值欄位。
- `data/sponsorship-items.json`: SITCON 2026 CFS 贊助品項固定版本資料。
- `app/`: 本機照片搜尋介面。
- `scripts/add-photo.mjs`: 從 Flickr URL 產生或寫入 CSV 資料列。
- `scripts/serve.mjs`: 本機靜態 server。
- `scripts/validate-data.mjs`: 檢查資料格式與標籤字典一致性。
- `docs/data-entry-guide.md`: 照片索引填寫指南。
- `docs/photo-finder-mvp.md`: MVP 產品判斷紀錄。
- `docs/mvp-implementation-plan.md`: MVP 實作計畫。
- `AGENTS.md`: agent 協作規則。

## 資料填寫原則

- 多值欄位用分號分隔，例如 `攤位;會眾;交流`。
- `sponsorship_items` 必須對齊 `data/sponsorship-items.json` 的 CFS 品項。
- `scene_tags` 描述照片裡看到什麼。
- `sponsorship_items` 描述對應哪個贊助品項。
- `sponsorship_tags` 描述能支援哪種贊助價值。
- 不確定是否可公開使用時，`public_use_status` 請填 `needs_review`。

更多規則請看 `docs/data-entry-guide.md`。

## 2026 CFS 固定版本資料

`data/sponsorship-items.json` 是 SITCON 2026 贊助徵求資料的固定版本資料。2026 年會已結束，不需要自動同步這份資料。

未來年度若有新的 CFS，應明確建立新的版本資料，視情況取代或延伸目前版本。
