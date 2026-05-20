# AI 初標輸入與輸出合約

這份文件定義新接手的 AI model、agent 或技術志工在「照片內容初標」階段要讀取哪些輸入、輸出什麼格式，以及後續工具如何驗證與使用結果。它刻意只描述 AI 初標工作目錄、輸入檔、輸出格式與責任邊界，不取代操作者 runbook。

第一次接手專案時，請先讀 `docs/README.md` 的「先建立共同語言」與「整體資料生命週期」。本文中的 run 目錄指 `tmp/ai-runs/<run-id>/`；attempt 指從既有 AI run 派生、用來比較模型或輪次的同形工作包。

AI 初標只產生候選 metadata。它不直接代表人工 review，也不應直接把照片推進到 `reviewed` 或 `approved`。

若只是把照片交給模型產生 `metadata-proposals.json`，主要任務提示應使用 run 目錄中的 `ai-labeling-prompt.md`。可重用的提示範本放在 `prompts/ai-labeling.md`。

若需要準備工作包、建立 attempt、執行 `ai:review`、閱讀報表、處理 stale review summary 或進行 Sheets dry-run，請看 `docs/ai-labeling-operator-guide.md`。這些是操作者流程，不是模型初標時的必讀脈絡。

## 適用階段

這份合約適用於 AI run 目錄已經由操作者或 repo 工具準備完成之後。若還沒有 run 目錄，請先依 `docs/ai-labeling-operator-guide.md` 建立工作包，不要由模型自行決定要從正式 Sheets 或 Flickr 取哪些照片。

進入本合約時應已具備：

- 正式 Google Sheets 已有 `photos` 資料。
- 操作者已匯出或選定本次要處理的照片範圍。
- 操作者已建立 `tmp/ai-runs/<run-id>/`；若是多模型或多輪比較，也可能是由既有 run 建立的 attempt 目錄。

attempt 目錄仍符合本文件的 run 目錄合約；AI 輸出的 `run_id` 應使用 attempt 目錄 `manifest.json` 內的 `run_id`。

## 輸入位置

AI 初標階段的主要輸入是單一工作目錄：

```text
tmp/ai-runs/<run-id>/
```

這個目錄由 `pnpm ai:prepare` 產生，通常包含：

```text
input-photos.csv
photos.json
manifest.json
ai-labeling-prompt.md
images/
```

attempt 目錄會額外包含 `attempt.json`，記錄 `base_run_id`、`model`、`round`、`label` 與來源 run。這份檔案供人類與比較報表辨識執行輪次；AI 初標仍以 `manifest.json`、`photos.json` 與圖片為主要輸入。

AI 或 agent 應以 `photos.json` 作為主要機器可讀輸入；`input-photos.csv` 只供人類檢查或除錯使用。

`ai-labeling-prompt.md` 是可直接交給模型或 agent 的本次任務提示，會包含 run 目錄路徑與通用 `prompts/ai-labeling.md` 內容。

## 必讀檔案

### `manifest.json`

`manifest.json` 描述這次 run 的範圍與建立方式。AI 應至少讀取：

- `run_id`: 輸出 `metadata-proposals.json` 時必須填入同一個值。
- `image_size`: 這次下載給 AI 判讀的圖片尺寸，例如 `large-1024` 或 `original`。
- `download_enabled`: 若為 `false`，可能沒有本機圖片檔，只能使用 `image_download_url`。
- `selected_photo_count`: 本次選入的照片數量。
- `photos_source`: 這次 run 來源的 `photos.csv`。
- `requested_focus`: 若操作者使用焦點抽樣，這裡會記錄 profile，例如 `design-metadata`。它只描述選樣目的，不代表照片一定要輸出該類欄位。
- `prompt_template_path`、`prompt_template_sha256`: 產生本次 `ai-labeling-prompt.md` 的 prompt 範本與 SHA-256。比較多模型或多輪結果時，這兩個值可用來確認是否使用同一版 prompt。

### `photos.json`

`photos.json` 是 AI 初標最重要的輸入。它是一個照片物件陣列，每個物件包含原本 `photos` 欄位，以及 AI 工作包新增的圖片資訊。

AI 應優先使用：

- `photo_id`: 輸出 proposals 時的索引鍵。
- `photo_url`: Flickr 公開頁面，用來回查脈絡。
- `album_ids`: 來源相簿 ID。
- `album_title`: 相簿名稱，提供活動脈絡。
- `event_name`、`event_year`: 若已有人工補上的活動脈絡，可輔助判斷。
- `curation_status`: 目前整理狀態。
- `curation_notes`: 既有公開整理備註。
- `image_download_url`: 本次 AI 判讀用圖片 URL。
- `image_size`: 本次圖片尺寸。
- `local_image_path`: 本機圖片相對路徑。

若 `local_image_path` 有值，應把它視為相對於 run 目錄的路徑。例如：

```text
tmp/ai-runs/<run-id>/images/55200405673.jpg
```

若 `local_image_path` 為空，代表本次可能使用 `--no-download`，AI 應改用 `image_download_url`，或請操作者重新建立有下載圖片的 run。

### `images/`

`images/` 放置 AI 判讀用圖片。檔案解析度由 `manifest.json` 的 `image_size` 決定。

`image_preview_url` 是 Google Sheets 正式欄位中的前端預覽縮圖，不等於本次 AI 判讀圖片。AI 初標應使用 `photos.json` 裡的 `local_image_path` 或 `image_download_url`。

### repo 規則資料

AI 產生候選欄位前，應讀取：

- `data/photo-schema.json`: 欄位定義與多值欄位語意。
- `data/tag-taxonomy.json`: 受控字彙與列舉值。
- `data/sponsorship-items.json`: 贊助品項字彙來源。

不要自行創造受控字彙。若 taxonomy 不足，應在 proposal 外提出需要人類討論的觀察，不要直接寫進 `metadata-proposals.json`。

## 輸出位置

AI 初標結果必須寫在同一個 run 目錄：

```text
tmp/ai-runs/<run-id>/metadata-proposals.json
```

不要直接修改 `photos.json`、`input-photos.csv`、`tmp/sheets-export/photos.csv` 或正式 Google Sheets。

大型 run 可以先用 repo shard 工具產生暫存分片輸入，分片中間結果預設放在：

```text
/tmp/ai-labeling-shards/<run-id>/
```

分片輸出可以是正式 `items[]` 物件的 JSON array；它不是最終 proposal。最終仍必須由 merge 工具合併成下方 root object 格式，並在交給操作者正式 review 或 Sheets dry-run 前寫成單一 `metadata-proposals.json`。除非任務明確要求修補既有 proposal，模型或 agent 不應沿用舊 run、舊 attempt 或既有 `metadata-proposals.json`。

大型 run 的暫存 proposal 可以先用既有 validator/review CLI 檢查，不必先寫回 run 目錄：

```bash
pnpm ai:validate -- --run-dir tmp/ai-runs/<run-id> --proposals /tmp/ai-labeling-shards/<run-id>/metadata-proposals.json
pnpm ai:review -- --run-dir tmp/ai-runs/<run-id> --proposals /tmp/ai-labeling-shards/<run-id>/metadata-proposals.json --output-dir /tmp/ai-review-runs/<run-id>
```

這種暫存 review 會讀取正式 run 的 `manifest.json` 與 `photos.json`，但把 `metadata-review-summary.md`、`metadata-diff.md` 與 update plan 寫到 `--output-dir`。確認要採用後，再把最終 `metadata-proposals.json` 寫回 run 目錄並執行一般 `pnpm ai:review -- --run-dir <run-dir>`。

## 輸出格式

`metadata-proposals.json` 必須是 JSON object，格式如下：

```json
{
  "proposal_version": 1,
  "run_id": "ai-prepare-...",
  "created_at": "2026-05-08T00:00:00.000Z",
  "producer": {
    "type": "ai",
    "name": "model or agent name"
  },
  "items": [
    {
      "photo_id": "55200405673",
      "fields": {
        "scene_tags": {
          "value": ["舞台"],
          "reason": "畫面中可見舞台或典禮區域。",
          "confidence": 0.8
        }
      }
    }
  ]
}
```

根節點規則：

- `proposal_version` 固定為 `1`。
- `run_id` 必須等於 `manifest.json` 的 `run_id`。
- `created_at` 使用可被 JavaScript `Date.parse` 解析的時間字串。
- `producer.type` 和 `producer.name` 必填。
- `items` 是陣列。

每個 `items[]` 規則：

- `photo_id` 必須存在於本次 `photos.json`。
- 同一個 `photo_id` 只能出現一次。
- `fields` 是 object，key 是建議調整的欄位名稱。
- 每個欄位 proposal 必須包含 `value` 和非空白 `reason`。
- `confidence` 可省略；若提供，必須是 `0` 到 `1` 的數字。它只是輔助人工審核的相對信心，不是模型品質分數；若模型選擇提供，應盡量在同一類欄位穩定覆蓋，避免只對少數欄位零散填寫而讓排序產生誤導。

## 可輸出欄位與 AI 分層

AI proposal 允許欄位由 `data/photo-schema.json` 的 `tables.photos.ai_field_layers` 定義。validator、update plan、report 與回寫工具都應讀同一份 schema，不要各自硬編清單。

分層語意：

- `ai_baseline_fields`: 圖片可讀時 AI 通常應提出的基礎讀圖候選，例如人數、主體、方向、留白、畫面描述與 `curation_status = ai_labeled`。
- `ai_recall_fields`: 高召回欄位。`scene_tags` 屬於這層，只要有合理可見依據就應提出，避免照片在大量資料中失去被場景篩選找到的機會；缺漏是 review warning，不是格式錯誤。
- `ai_optional_fields`: 有明確依據才提出的用途、裁切、使用提醒、推薦優先度與贊助欄位。
- `human_only_fields`: Flickr 匯入欄位、相簿/活動脈絡、攝影師、授權與人工備註等，不可由 AI proposal 修改。

目前允許以下 AI 欄位：

| 欄位 | `value` 型別 | 說明 |
| --- | --- | --- |
| `people_count` | 非負整數 | 照片中可辨識的人數估計。 |
| `subject_type` | 字串 | 主要視覺主體粗分類。值必須存在於 `data/tag-taxonomy.json`，且只能單選。 |
| `scene_tags` | 字串陣列 | 照片中看見的事實。值必須存在於 `data/tag-taxonomy.json`。 |
| `mood_tags` | 字串陣列 | 照片帶來的感受。值必須存在於 `data/tag-taxonomy.json`。 |
| `recommended_uses` | 字串陣列 | 適合用途。值必須存在於 `data/tag-taxonomy.json`。 |
| `sponsorship_items` | 字串陣列 | 贊助品項。值必須對齊 `data/sponsorship-items.json` 衍生的 taxonomy。 |
| `sponsorship_tags` | 字串陣列 | 贊助價值或佐證用途。值必須存在於 `data/tag-taxonomy.json`。 |
| `orientation` | 字串 | 照片方向。值必須存在於 `data/tag-taxonomy.json`。 |
| `has_negative_space` | 布林值 | 是否有明顯留白可放字。 |
| `safe_crop` | 字串陣列 | 適合裁切比例。值必須存在於 `data/tag-taxonomy.json`。 |
| `visual_description` | 字串 | 1 到 2 句中立畫面描述，用於自然語言搜尋與人工找圖輔助，只能描述照片中可見內容。 |
| `public_use_status` | 字串 | 使用品質或整理提醒。AI 只能建議 `needs_review` 或 `avoid`，不能建議 `approved`；不應用來標示同意、授權或公開 / 非公開狀態。 |
| `priority_level` | 字串 | 推薦優先度。值必須存在於 `data/tag-taxonomy.json`。 |
| `collections` | 字串陣列 | 可建議素材包名稱；仍須由人類判斷是否採用。 |
| `curation_status` | 字串 | AI 只能建議 `ai_labeled`。 |

多值欄位在 proposal 中必須使用 JSON array，不使用 CSV 裡的分號字串。後續工具會在產生 Sheets update plan 時轉成正式表格需要的格式。

AI 欄位值限制由 `data/photo-schema.json` 的 `tables.photos.ai_value_constraints` 定義。validator、update plan 與 Sheets 回寫工具應共用這份限制，例如 `curation_status` 只能是 `ai_labeled`，`public_use_status` 只能是 `needs_review` 或 `avoid`；不可在個別工具另外寫一份容易漂移的限制清單。

## 不可輸出欄位

AI proposal 不應修改以下欄位：

- `photo_id`
- `photo_url`
- `album_ids`
- `image_preview_url`
- `album_title`
- `event_name`
- `event_year`
- `photographer`
- `license`
- `curation_notes`

理由：

- Flickr 基本欄位、相簿關聯與縮圖 URL 應由匯入工具維護。
- 活動脈絡可能需要熟悉 SITCON 的人類整理者確認。
- 攝影師與授權不應只靠看圖推論。
- `curation_notes` 是公開人工備註，不應由 AI 靜默改寫。

## 判斷邊界

AI 應遵守以下限制：

- 不要把 `curation_status` 設為 `reviewed`。
- 不要把 `public_use_status` 設為 `approved`。
- 不要為了填滿欄位而猜測；不確定就省略該欄位。
- 不要創造 taxonomy 中不存在的值。
- 不要把 `sponsorship_items` 當成一般場景標籤；只有在畫面或相簿脈絡足夠支持時才建議。
- 不要把 `scene_tags`、`sponsorship_items`、`sponsorship_tags` 混用。
- 不要覆蓋人工值；proposal 只是候選，後續工具會呈現差異給人類確認。
- `people_count`、`subject_type`、`orientation`、`has_negative_space` 是 AI 初標的基礎讀圖欄位；只要圖片可讀，通常應提出候選值。
- `scene_tags` 是高召回欄位。只要照片中有合理可見場景、活動流程或重要元素，就應提出候選值；不要因為它不是 row-level 必填而整批省略。
- `scene_tags` 仍是人工 `reviewed` 的完成門檻。這代表人類在 Sheets 完成審核前要補齊或確認，不代表 AI proposal 缺漏時應被 validator hard fail。
- `subject_type` 只描述照片第一眼主要視覺主體是 `people`、`object`、`food`、`text_signage`、`screen` 或 `space`，不描述活動場景、人數規模、用途或品質。若主體是人，不論一人、多人或群眾都使用 `people`；人數規模只用 `people_count` 表達。
- `public_use_status` 只在照片本身有明確不建議推薦或需人工整理判斷的畫面狀態時提出，例如嚴重模糊、閉眼失焦、表情不佳、主體被遮擋或可能造成誤解。SITCON Flickr 照片本身已是經同意釋出的公開來源，AI 不應只因人物類型或可識別細節而提出 `needs_review`。
- `safe_crop` 應從版面可用性判斷。只有在裁切後主體、臉部、重要文字與主要物件仍可保留時才提出該比例。
- `has_negative_space = true` 必須能說明可放字區域的位置，例如左側牆面、上方投影旁、右側背板空區或大片地面；只寫「有留白」不足以支撐人工 review。
- `safe_crop` 的 reason 必須說明該比例裁切後保留哪些主體、臉部、文字、Logo、螢幕或物件；只寫「橫式照片」或「構圖適合」不足以支撐人工 review。
- `visual_description` 應描述 taxonomy 欄位難以涵蓋的可見細節，例如物件、文字、姿勢、動作、表情、空間位置與構圖關係。它不是照片標題，也不是欄位 reason。
- `visual_description` 不應重複機械欄位，例如「橫式照片」、「有 5 人」；除非人數或方向對理解畫面構圖有必要。
- `visual_description` 不應寫活動名稱、年份、身份、單位或贊助商推論，除非文字清楚出現在照片中，且應以「畫面可見文字」描述。
- `visual_description` 不應使用批次比較語，例如「第 N 張」、「同批」、「鄰近照片」、「相近照片」；也不應只靠 `畫面`、`可見`、`呈現`、`人物`、`參與者`、`互動`、`交流` 這類泛詞而缺少具體物件、動作、文字或位置。
- `visual_description` 不應用否定句承載高價值搜尋詞，例如「沒有清楚人物」、「無舞台」或「看不到 Logo」。若需要表達品質限制，請改寫成中立可見狀態，例如「遠景人群背對鏡頭，人物臉部不可辨識」，避免字面搜尋把否定語附近的詞當成正向命中。
- `recommended_uses` 應避免全部落在通用用途；請優先提出能幫助取圖排序與情境判斷的用途。
- `recommended_uses` 必須有用途期待與可見證據支撐。例如 `網站橫幅` 應能支撐留白與版面裁切，`志工招募` 應看得到工作或協作狀態，`講者宣傳` 應看得到講者或發表脈絡，贊助相關用途應有贊助品項或贊助價值證據。
- `safe_crop` 和 `has_negative_space` 應分開判斷：安全裁切代表裁切後重要內容仍保留；留白代表可覆蓋文字的乾淨區域。`網站橫幅` 應同時有 `has_negative_space = true` 與 `safe_crop` 包含 `16:9` 支撐。
- `reason` 必須只依據圖片可見內容或 `photos.json` 既有 metadata，不應自行補上未確認的活動名稱、身份、單位或年份。
- 讀圖欄位的 reason 和 `visual_description` 都不應跨照片重複套用模板。若多張照片建議值相同，也要描述每張照片各自的可見證據。
- 若現有 taxonomy 無法準確描述照片，應省略不精準欄位，並在人工檢查時另外記錄 taxonomy gap，不要硬套錯誤標籤。

## 驗證與後續使用

產生 `metadata-proposals.json` 後，後續工具會驗證 proposal，並產生 `metadata-review-summary.md`、`metadata-diff.md`、`metadata-update-plan.json` 與 `metadata-update-plan.csv`。具體操作指令由操作者依 `docs/ai-labeling-operator-guide.md` 執行。

驗證 warning 代表 proposal 格式和 AI 責任邊界可接受，但仍有批次品質疑慮需要人工判斷；warning 不等於一定要退回模型重跑。`ai:review` 可能產生 Adoption Readiness、Review Focus、Balanced Review Sample、confidence-by-field 摘要、設計 metadata、shard field coverage 與場景組合抽查提示。若 Adoption Readiness 顯示 `blocked`，代表回寫前應先修補該 blocker；唯讀 HTML 報表、跨 attempt 分歧比較、`visual_description` 搜尋增益比較與 Sheets dry-run 都是操作者後續流程，不是模型初標任務的一部分。

正式 review 不在 AI run 目錄中完成。AI run 最多把資料推進到 `ai_labeled`；`reviewed` 應回到 Google Sheets，由具有編輯權限的志工們協作檢查、修正並補齊必要欄位後再更新。

大型 AI run 不要求所有 proposal 都有最終人工 outcome。`metadata-proposals.json` 可能長期只被部分抽查、部分採用或部分回寫；沒有人工 outcome 的照片仍只是候選狀態，不應解讀為已拒絕、已接受或流程錯誤。任何 acceptance / review outcome 報表都應明確標示母體，例如全部 proposal、抽查樣本、已產生 update plan 的欄位、已寫回 Sheets 的欄位，或已被人工標成 `reviewed` 的照片。
