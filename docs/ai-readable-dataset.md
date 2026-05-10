# AI 讀取照片索引資料

## 目的

這份文件定義外部 AI、GitHub Pages 與其他唯讀工具應如何讀取 SITCON Flickr Photo Finder 的照片索引資料。

SITCON Flickr 照片量很大，要求每張照片都先完成人工 review 才能被搜尋不實際。照片索引資料應讓 AI 能探索完整資料，同時清楚理解哪些 metadata 已人工確認、哪些是整理提醒、哪些不應預設推薦。

## 資料來源

AI 使用者應讀取 `photos` 主表，或讀取由 `photos` 以同一套欄位匯出的公開 CSV/JSON。

公開匯出只是技術傳輸格式，不是另一層篩選資料表。AI 應把它視為 `photos` 的同欄位鏡像，而不是 curated subset。

AI 應依欄位值判斷資料，不應依賴 Google Sheets 畫面上的顏色、註解、排序、篩選檢視或儲存格格式。

## 給使用者的 AI 助手使用方式

除了 GitHub Pages 搜尋前端，使用者也可以使用自己熟悉的 AI 助手讀取公開 Google Sheets。這種方式適合尚未能用固定篩選條件描述的需求，例如「找有活力、適合社群、畫面右側能放字的照片」。

操作時，把正式 Google Sheets 連結提供給 AI 助手，請它讀取 `photos` 工作表。若 AI 助手不能直接讀取 Google Sheets，請改提供 `photos` 工作表匯出的公開 CSV。

可複製提示：

```text
請讀取這份 Google Sheets 的 photos 工作表，協助我找 SITCON Flickr 照片。

如果你無法直接讀取 Google Sheets，請先告訴我，並請我提供 photos CSV。

請不要只找 reviewed 照片；ai_labeled 和 unreviewed 也可以列為候選，但請標示整理狀態。public_use_status 是整理提醒，不是 Flickr 是否公開；avoid 預設不要推薦。

每個候選請提供：
- photo_id
- photo_url
- 為什麼符合需求
- curation_status
- public_use_status

請不要自行推測缺少的攝影師、授權、活動身份或照片外脈絡。
```

AI 若需要理解欄位與可用值，應同時讀取：

- `data/photo-schema.json`
- `data/tag-taxonomy.json`
- `data/sponsorship-items.json`
- 本文件

## AI 應理解的核心欄位

| 欄位 | AI 使用方式 |
| --- | --- |
| `photo_url` | 回答中應提供的 Flickr 原始連結。 |
| `album_ids` | 可用來理解照片來源相簿；同一張照片可能有多個來源相簿 ID。 |
| `image_preview_url` | 可用於人工預覽或前端顯示。 |
| `photographer` | 有值時應提供 credit。 |
| `license` | 有值時應提供授權資訊；缺值時不可假設。 |
| `subject_type` | 用來做大量照片初篩，判斷主要視覺主體是人物、物件、餐食茶點、文字標示、螢幕或空間。 |
| `scene_tags` | 用來判斷照片中實際可見內容。 |
| `people_count` | 用來回應人數條件，例如找單人、少人合照、大合照或群眾畫面；缺值時不可自行推測。 |
| `mood_tags` | 用來回應宣傳、社群、視覺情緒需求。 |
| `recommended_uses` | 用來對應工作情境，例如社群貼文、贊助提案、新聞稿。 |
| `sponsorship_items` | 用來找特定 CFS 贊助品項的照片。 |
| `sponsorship_tags` | 用來找贊助價值或佐證用途。 |
| `visual_description` | 用來補足 taxonomy 沒有覆蓋的可見細節，例如具體物件、人物動作、文字、位置與空間關係。 |
| `public_use_status` | 整理者的使用提醒，不是 Flickr 是否公開的判斷。 |
| `priority_level` | 用來排序推薦優先度，不是客觀品質分數。 |
| `collections` | 用來優先回應素材包或任務型需求。 |
| `curation_status` | 用來判斷資料是否人工確認。 |

### visual_description

`visual_description` 是自然語言找圖的輔助描述，不是審核 reason 的替代品。它應只描述照片中可見的事物，不能自行補活動名稱、年份、身份、單位、贊助商或照片外脈絡。

AI 搜尋時可以把 `visual_description` 當成長尾語料，用來處理 taxonomy 無法精準表達的需求，例如「桌上有整排披薩」、「人物站在背板右側」、「畫面左側有大片牆面可放字」。但它應搭配 `scene_tags`、`recommended_uses`、`public_use_status` 與 `curation_status` 使用，不應取代結構化欄位，也不應把其中的描述推論成未記錄的事實。

## 狀態解讀

### curation_status

`curation_status` 描述資料可信度，不描述推薦優先度。

- `reviewed`: 已由人類整理者檢核過，可信度較高。
- `ai_labeled`: 曾由 AI 輔助產生欄位，但尚未完成人工確認。
- `unreviewed`: 尚未完成整理，仍可用於探索。

AI 不應把 `ai_labeled` 或 `unreviewed` 當成不可搜尋。它們只是需要在回答中標示信心較低或尚未人工確認。

### public_use_status

`public_use_status` 描述整理者對照片使用的提醒。SITCON Flickr 照片本身已是公開來源，這個欄位不是公開 / 非公開判斷，也不是法律授權結論。

- `approved`: 可正常推薦。
- `needs_review`: 可以列為候選，但回答中應標示仍有整理提醒。
- `avoid`: 不應預設推薦。只有在使用者明確要求完整搜尋、排除原因或尋找反例時才列出。

### priority_level

`priority_level` 描述推薦優先度，不是照片品質分數。

- `high`: 優先推薦。
- `normal`: 一般推薦。
- `low`: 排序較後，通常作為補充候選。

這個欄位應搭配使用情境、標籤匹配度與整理提醒判斷，不應單獨決定答案。

## 推薦排序建議

AI 回答找圖需求時，建議排序權重由高到低考慮：

1. 使用者需求與 `subject_type`、`scene_tags`、`people_count`、`mood_tags`、`recommended_uses`、`sponsorship_items`、`sponsorship_tags` 的匹配度。
2. `curation_status`，其中 `reviewed` 優先於 `ai_labeled`，`ai_labeled` 優先於 `unreviewed`。
3. `priority_level`，其中 `high` 優先於 `normal`，`normal` 優先於 `low`。
4. `public_use_status`，其中 `avoid` 預設排除或放到最後；`needs_review` 只作為整理提醒。
5. `collections` 是否命中使用者指定任務或素材包。
6. 活動脈絡，例如 `event_name`、`event_year`、`album_title`。

這是建議，不是唯一排序規則。實際工具可以根據使用者回饋持續調整。

## 回答格式建議

AI 推薦照片時，每個候選至少應包含：

- Flickr 原始連結。
- 符合需求的理由。
- `curation_status`。
- `public_use_status`，但請把它說成整理提醒。
- 使用者需要來源交接或實際交付素材時，若有 `photographer` 與 `license`，再提供 credit 與授權資訊。

若照片是 `needs_review`、`ai_labeled` 或 `unreviewed`，回答應清楚標示整理狀態或使用提醒。

若 `photographer` 或 `license` 缺值，AI 應說明缺值，不應自行推測。

## 範例判斷

使用者要求「找適合贊助提案中呈現會眾互動的照片」時：

- 優先找 `recommended_uses` 包含 `贊助提案`。
- 優先找 `sponsorship_tags` 包含 `會眾互動` 或 `贊助成果佐證`。
- 若指定品項，使用 `sponsorship_items` 精準對應 CFS 品項。
- 避免把 `scene_tags = 攤位` 誤當成特定贊助品項，除非 `sponsorship_items` 也有對應。
- `curation_status = reviewed`、任務欄位命中且 `priority_level = high` 的照片優先；`public_use_status = avoid` 預設不推薦。
- `ai_labeled` 或 `unreviewed` 可以作為補充候選，但應提醒尚未人工確認。

## 不應做的事

- 不要把公開 CSV/JSON 匯出解讀成只包含精選或已 review 照片。
- 不要把 `quality_score` 當成欄位；目前已改用 `priority_level`。
- 不要把 `scene_tags`、`sponsorship_items`、`sponsorship_tags` 混用。
- 不要對缺少授權或 credit 的照片自行補值。
- 不要預設推薦 `public_use_status = avoid` 的照片。
- 不要把 `curation_status = ai_labeled` 說成已人工確認。
