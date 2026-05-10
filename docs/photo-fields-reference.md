# 照片欄位參考

這份文件是給整理照片資料志工使用的人類速查摘要，不是第二份 schema。欄位順序、欄位 metadata、必填、多值、reviewed 完整度與 approved 使用要求，以 `data/photo-schema.json` 為準；若本文件和 schema 不一致，請先更新 schema，再修正這份速查表。

資料權威來源請以 `docs/README.md` 的真理來源表為準；更完整的流程與判斷原則請看 `docs/data-entry-guide.md`。

## 格式規則

- 每列代表一張 Flickr 照片。
- 多值欄位使用分號分隔，例如 `攤位;會眾;交流`。
- 受控字彙欄位必須使用 `data/tag-taxonomy.json` 中已存在的值。
- 不確定的欄位可以先留空，但不要硬猜。
- `reviewed` 會有更高的完整度要求，請先補齊必要判斷再調整狀態。

## 欄位列表

| 欄位 | 必填 | 多值 | 受控字彙 | 主要維護者 | 填寫重點 |
| --- | --- | --- | --- | --- | --- |
| `photo_id` | 是 | 否 | 否 | 匯入工具 | Flickr 照片 ID，用來避免重複匯入。 |
| `photo_url` | 是 | 否 | 否 | 匯入工具 | Flickr 公開頁面，用來回到原始照片確認脈絡。 |
| `album_ids` | 否 | 是 | 否 | 匯入工具 | 來源 Flickr 相簿 ID。照片可能出現在多本相簿，多值用分號分隔。 |
| `image_preview_url` | 是 | 否 | 否 | 匯入工具 | 搜尋介面顯示用縮圖。 |
| `album_title` | 否 | 否 | 否 | 匯入工具或整理者 | Flickr 相簿名稱。若工具暫時抓不到，可以留空。 |
| `event_name` | 否 | 否 | 否 | 熟悉活動脈絡者 | 例如 `SITCON 年會`、`SITCON Camp`。不確定就留空。 |
| `event_year` | 否 | 否 | 否 | 熟悉活動脈絡者 | 四位年份，例如 `2026`。 |
| `people_count` | 否 | 否 | 否 | AI 或整理者 | 照片中可辨識的人數估計值。無人可填 `0`，不確定可留空。 |
| `subject_type` | 否 | 否 | 是 | AI 或整理者 | 照片海初篩用的主要視覺主體，例如 `people`、`object`、`food`、`text_signage`、`screen`、`space`。 |
| `photographer` | 否 | 否 | 否 | 匯入工具或整理者 | 攝影師署名。SITCON 是 Flickr 帳號擁有者，不等於攝影師。 |
| `license` | 否 | 否 | 否 | 整理者 | Flickr 顯示的授權資訊。不確定時留空並使用 `needs_review`。 |
| `scene_tags` | 否 | 是 | 是 | 整理者 | 活動情境或可見場景元素，例如 `攤位`、`會眾`、`舞台`、`指標`、`場地`、`螢幕`、`頒獎`。 |
| `mood_tags` | 否 | 是 | 是 | 宣傳、設計、整理者 | 照片帶來的感受，例如 `熱鬧`、`專注`、`青春感`。 |
| `recommended_uses` | 否 | 是 | 是 | 各組整理者 | 適合的工作用途，例如 `社群貼文`、`贊助提案`。 |
| `sponsorship_items` | 否 | 是 | 是 | 行銷組或熟悉贊助者 | 對應 CFS 贊助品項，必須對齊 `data/sponsorship-items.json`。 |
| `sponsorship_tags` | 否 | 是 | 是 | 行銷組或熟悉贊助者 | 贊助價值或佐證用途，例如 `品牌露出`、`會眾互動`。 |
| `orientation` | 否 | 否 | 是 | 設計、整理者 | `landscape`、`portrait`、`square`。 |
| `has_negative_space` | 否 | 否 | 否 | 設計、整理者 | `true` 或 `false`，表示是否有明顯留白可放字。 |
| `safe_crop` | 否 | 是 | 是 | 設計、整理者 | 適合裁切的比例，例如 `1:1`、`16:9`。 |
| `visual_description` | 否 | 否 | 否 | AI 或整理者 | 1 到 2 句中立的可見畫面描述，用於自然語言找圖輔助。 |
| `public_use_status` | 否 | 否 | 是 | 熟悉公開素材風險者 | `approved`、`needs_review`、`avoid`。不確定用 `needs_review`。 |
| `priority_level` | 否 | 否 | 是 | 整理者 | `high`、`normal`、`low`。表示推薦使用優先度，不是客觀照片品質。 |
| `collections` | 否 | 是 | 否 | 各組整理者 | 素材包，例如 `志工招募`、`贊助提案`、`網站 hero`。 |
| `curation_notes` | 否 | 否 | 否 | 整理者 | 公開 repo 中仍視為公開資料，不要寫入敏感內部資訊。 |
| `curation_status` | 否 | 否 | 是 | 整理者 | `unreviewed`、`ai_labeled`、`reviewed`。 |

## Reviewed 與 Approved 門檻

`reviewed` 完整度與 `approved` 使用要求由 `data/photo-schema.json` 定義：

- `reviewed_required_fields`
- `approved_required_fields`

請不要在文件中另外維護一份欄位清單。若規則改變，先改 `data/photo-schema.json`，再讓 `pnpm validate:data` 和相關文件跟著更新。

精選、素材包與不推薦使用不放在 `curation_status`。優先推薦用 `priority_level` 或 `collections` 表達；不建議推薦使用用 `public_use_status = avoid` 表達。

## 欄位責任不是組織邊界

表格中的「主要維護者」只是常見判斷來源，不代表只有該組能填。SITCON 籌備工作常常跨組協作，實際維護時可以由任何熟悉脈絡的人先填，再由相關組別回頭確認。

若某個欄位在實際整理時經常卡住，應回到欄位設計討論，而不是要求志工硬填。
