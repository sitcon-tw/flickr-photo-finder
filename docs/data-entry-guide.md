# 照片索引資料填寫指南

## 目的

這份文件給第一批整理 SITCON Flickr 照片的人使用。目標是讓不同人填出來的資料可以被搜尋、驗證與後續維護，而不是只留下各自理解的備註。

第一批資料不追求完整收錄 Flickr。請優先整理高機率被籌備團隊重複使用的照片，例如社群宣傳、贊助提案、網站視覺、新聞稿、志工招募、活動回顧會用到的照片。

## 基本流程

1. 從 Flickr 找到候選照片。
2. 確認照片有公開頁面與可用縮圖。
3. 使用 `npm run photo:add -- <flickr-photo-url> --append` 產生基本資料，或在 `data/photos.csv` 手動新增一列。
4. 先填必填欄位，再補情境、標籤與使用判斷。
5. 執行 `npm run validate:data`。
6. 若驗證工具擋下資料，先修正欄位或標籤；若是標籤字典不足，另外提出要新增的標籤。

## 從 Flickr URL 建立資料列

可以用工具從 Flickr oEmbed 取得照片 ID、縮圖 URL、攝影者與標題備註：

```bash
npm run photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID
```

也可以一次處理多張照片：

```bash
npm run photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID https://www.flickr.com/photos/sitcon/PHOTO_ID_2
```

預設只會輸出 CSV 資料列，不會修改檔案。確認內容後，可以加上 `--append` 寫入 `data/photos.csv`：

```bash
npm run photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID --append
```

使用 `--append` 時，工具會在寫入後自動執行資料驗證。這個工具只處理 Flickr 基本中繼資料；情緒、用途、贊助品項、公開使用狀態等仍需人工判斷。

## CSV 填寫格式

`data/photos.csv` 使用一般 CSV 格式。多值欄位用分號分隔，不要用逗號。

例如：

```csv
scene_tags
攤位;會眾;交流
```

如果欄位內容本身含有逗號、換行或雙引號，請依 CSV 規則用雙引號包起來。

## 必填欄位

以下欄位目前由驗證工具強制檢查：

| 欄位 | 說明 |
| --- | --- |
| `photo_id` | Flickr 照片 ID。 |
| `photo_url` | Flickr 照片公開頁面。 |
| `image_preview_url` | 可在索引或未來 UI 顯示的縮圖或預覽圖 URL。 |

若暫時無法取得其他資訊，可以先留空；但高曝光用途的照片應補齊授權、攝影者與公開使用狀態。

## 常用欄位填寫方式

| 欄位 | 填寫方式 |
| --- | --- |
| `event_name` | 例如 `SITCON 年會`、`SITCON Camp`。不確定就留空，不要硬猜。 |
| `event_year` | 四位年份，例如 `2026`。 |
| `photographer` | 攝影者或 Flickr 上可辨識的署名資訊。 |
| `license` | Flickr 顯示的授權資訊。若不確定，先留空並將 `public_use_status` 設為 `needs_review`。 |
| `orientation` | `landscape`、`portrait`、`square`。 |
| `has_negative_space` | `true` 或 `false`，表示是否有明顯留白可放字。 |
| `safe_crop` | 可安全裁切的比例，例如 `1:1;16:9`。 |
| `public_use_status` | `approved`、`needs_review`、`avoid`。 |
| `quality_score` | 1 到 5。先用人工快速判斷，不需要假裝精密。 |
| `curation_status` | `unreviewed`、`ai_labeled`、`reviewed`、`featured`、`archived`。 |

## 標籤欄位

以下欄位都使用 `data/tag-taxonomy.json` 的受控字彙：

- `scene_tags`
- `mood_tags`
- `recommended_uses`
- `sponsorship_items`
- `sponsorship_tags`
- `safe_crop`
- `orientation`
- `public_use_status`
- `curation_status`

如果你想填的詞不存在於標籤字典，先不要直接塞進 CSV。請先記在 `internal_notes` 或提出標籤字典調整，避免同義詞越長越散。

## 贊助相關欄位

贊助找圖通常是在找「能證明某個贊助品項價值的照片」，所以請分清楚三種欄位：

| 欄位 | 用途 |
| --- | --- |
| `scene_tags` | 照片裡看到了什麼，例如攤位、會眾、交流。 |
| `sponsorship_items` | 對應哪個 CFS 贊助品項，例如 `會場攤位`、`Badge 繩廠商 Logo 曝光`。 |
| `sponsorship_tags` | 能支援哪種贊助價值，例如品牌露出、會眾互動、實體導流。 |

`sponsorship_items` 必須對齊 `data/sponsorship-items.json` 的 2026 CFS 固定版本資料。未來年度若有新的 CFS 品項，應建立新版本資料或明確更新標籤字典。

## 公開使用判斷

`public_use_status` 不只看照片好不好看。

- `approved`: 可合理用於公開素材，授權與脈絡足夠清楚。
- `needs_review`: 看起來可能可用，但授權、人物露出、脈絡或畫面狀態需要確認。
- `avoid`: 不建議用於公開素材，例如畫面尷尬、人物狀態不適合、授權不明且風險高。

如果不確定，請用 `needs_review`，不要為了讓資料漂亮而標成 `approved`。

## 素材包

`collections` 用來標示素材包。常見素材包包含：

- 志工招募
- 投稿宣傳
- 報名宣傳
- 贊助提案
- 贊助成果報告
- 網站 hero
- 新聞稿
- 社群介紹
- 活動回顧

同一張照片可以出現在多個素材包。素材包的目的不是分類照片，而是縮短真實工作流程。

## 驗證

修改 `data/photos.csv`、`data/tag-taxonomy.json` 或 `data/sponsorship-items.json` 後，請執行：

```bash
npm run validate:data
```

驗證通過只代表資料格式與受控字彙合理，不代表照片一定適合公開使用。公開使用仍需要人判斷。
