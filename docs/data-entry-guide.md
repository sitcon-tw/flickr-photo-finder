# 照片索引資料填寫指南

## 目的

這份文件給整理 SITCON Flickr 照片資料的志工使用。目標是讓不同人填出的資料可以被搜尋、驗證與後續維護，而不是留下各自理解的備註。

資料權威來源請以 `docs/README.md` 的真理來源表為準；本指南只說明整理照片時的填寫判斷。

若只需要查欄位定義、必填狀態、多值格式與常見維護角色，請看 `docs/photo-fields-reference.md`。

第一次整理照片前，建議先從正式照片索引的 `使用說明` 分頁打開練習用試算表，熟悉 `SITCON Photo Finder` 選單與右側整理面板。不要在正式照片索引中試填測試內容；練習表可由維護者依 `docs/sheets-sync-workflow.md` 定期重置。

練習用試算表中的 `curation_notes` 會顯示 `練習提示：...`，用來提醒整理者本列的判斷重點。這些提示不是正式照片備註；正式照片索引的 `curation_notes` 仍是可公開閱讀的整理脈絡、注意事項或使用建議。

## 快速填寫流程

1. 從已盤點的 SITCON Flickr 相簿清單選擇本次要處理的相簿。
2. 由工具匯入或更新候選照片資料。
3. 確認照片有公開頁面與可用縮圖。
4. 先補足能判斷搜尋與使用風險的欄位。
5. 不確定的欄位先留空或使用 `needs_review`，不要硬猜。
6. 若資料經過 repo 工具、CSV 匯出或同步流程，執行 `pnpm data:validate`。
7. 若驗證失敗，先修正欄位或標籤；若是標籤字典不足，再提出 taxonomy 調整。

第一批資料不追求完整收錄 Flickr。請優先整理高機率被籌備團隊重複使用的照片，例如社群宣傳、贊助提案、網站橫幅、新聞稿、志工招募、活動回顧會用到的照片。

## 技術匯入入口

實際整理時，應以 SITCON Flickr 相簿為單位處理。正式流程應由工具先盤點 SITCON Flickr 目前有哪些相簿，更新 Google Sheets `albums` 清單，再讓使用者選擇本次要處理哪一本。

日常正式流程建議從互動入口開始，讓工具引導相簿選擇、工作檔產生、驗證與 Sheets dry-run：

```bash
pnpm workflow
```

完整 Sheets 同步流程請看 `docs/sheets-sync-workflow.md`。下列低階指令保留給 fixture 更新、demo、除錯或精確重跑；正式資料仍應以 Google Sheets 為準：

```bash
pnpm albums:discover
pnpm albums:discover -- --write
pnpm fixtures:album:add -- ALBUM_ID
pnpm fixtures:album:add -- ALBUM_ID --append
pnpm fixtures:photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID
```

`--append` 只會修改本機測試資料。正式流程仍應把確認後的資料同步回 Google Sheets。

SITCON Flickr 上的照片擁有者是 SITCON，但攝影師 credit 會放在 Flickr title 裡。請不要把 Flickr oEmbed 回傳的帳號擁有者直接填成攝影師；若 title 看不出攝影師署名，`photographer` 應先留空，並保留完整 Flickr title 在 `curation_notes` 供後續人工確認。

## 優先補哪些欄位

匯入工具通常只能取得 Flickr 基本資料。相簿匯入後，請優先補上這些會直接影響搜尋與使用判斷的欄位：

| 欄位 | 填寫重點 |
| --- | --- |
| `people_count` | 照片中可辨識的人數估計值。無人可填 `0`，人數很多但無法精確計算時可估算或先留空。 |
| `subject_type` | 照片第一眼主要視覺主體，只能單選 `people`、`object`、`food`、`text_signage`、`screen` 或 `space`。不要拿來描述人數規模或活動場景。 |
| `scene_tags` | 活動情境或可見場景元素，例如攤位、會眾、舞台、工作人員、合照、指標、場地、場佈、螢幕、頒獎、兒童、錄音、導覽。 |
| `mood_tags` | 照片帶來的感受，例如熱鬧、專注、友善、青春感、幕後感。 |
| `recommended_uses` | 適合的工作用途，例如社群貼文、網站橫幅、志工招募、贊助提案。 |
| `visual_description` | 1 到 2 句中立描述照片可見內容，例如人物動作、物件位置、畫面文字與空間關係。這不是 reviewed 必填，但能補足自然語言找圖。 |
| `public_use_status` | 不確定就用 `needs_review`。不要為了讓資料漂亮而標成 `approved`。 |
| `priority_level` | 推薦使用優先度，不是客觀照片品質。 |
| `collections` | 素材包，例如志工招募、贊助提案、網站橫幅、活動回顧。 |
| `curation_notes` | 可公開閱讀的整理脈絡、注意事項或使用建議。不要寫敏感內部資訊。 |

`reviewed` 完整度由 `data/photo-schema.json` 的 `reviewed_required_fields` 定義，並由 `pnpm data:validate` 檢查。不要在這份指南另外維護欄位清單；若規則改變，請先更新 schema。`public_use_status = approved` 不會讓 `photographer` 或 `license` 變成必填，缺值時只代表實際對外使用前仍要回 Flickr 原頁確認來源脈絡。

`scene_tags` 在 AI 初標階段是高召回候選，可能需要人類修正；在人工 `reviewed` 階段則是完成審核門檻，目的是讓已整理照片能被場景篩選找到。

## CSV 與多值格式

Google Sheets 欄位與 `fixtures/photos.csv` 匯出格式使用同一套欄位定義。多值欄位用分號分隔，不要用逗號。

例如：

```csv
scene_tags
攤位;會眾;交流
```

如果欄位內容本身含有逗號、換行或雙引號，請依 CSV 規則用雙引號包起來。

## 標籤與受控字彙

以下欄位使用 `data/tag-taxonomy.json` 的受控字彙：

- `scene_tags`
- `mood_tags`
- `recommended_uses`
- `sponsorship_items`
- `sponsorship_tags`
- `safe_crop`
- `orientation`
- `public_use_status`
- `priority_level`
- `curation_status`

Google Sheets、CSV、AI proposal 與 repo 工具儲存的是 taxonomy raw value。人類介面顯示文字由 `data/tag-taxonomy.json` 的 `option_labels` 統一維護；不要在 GitHub Pages、Apps Script、文件或報表另外手寫一份翻譯表。若需要調整顯示文字，先改 `option_labels`，再跑 `pnpm data:validate`。

如果想填的詞不存在於標籤字典，先不要直接塞進 CSV。請先記在 `curation_notes` 或提出標籤字典調整，避免同義詞越長越散。

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

如果不確定，請用 `needs_review`。

## 整理狀態與推薦優先度

`curation_status` 代表這筆資料整理到什麼程度，不是照片品質評分。

- `unreviewed`: 只匯入 Flickr 基本資料，還沒人工判斷。
- `ai_labeled`: 經過 AI 初標，但尚未人工確認。
- `reviewed`: 已由人確認到可以被搜尋與初步使用判斷。

`reviewed` 不代表公開使用風險已完全確認，也不代表已經排好推薦優先度。若公開使用仍不確定，可先讓 `public_use_status` 留空或標成 `needs_review`；若沒有明確推薦排序判斷，`priority_level` 可以留空。

優先推薦不要用整理狀態表示，請用 `priority_level`、`collections` 或素材包來表達。不建議推薦使用的照片請用 `public_use_status = avoid`，不要另外建立封存狀態。

`priority_level` 是找圖時的排序提示，不是照片品質分數：

- `high`: 優先推薦。
- `normal`: 一般候選。
- `low`: 低優先，除非很符合需求，否則不優先推薦。

## 驗證

修改本機測試資料、`data/tag-taxonomy.json` 或 `data/sponsorship-items.json` 後，請執行：

```bash
pnpm data:validate
```

驗證通過只代表資料格式與受控字彙合理，不代表照片一定適合公開使用。公開使用仍需要人判斷。
