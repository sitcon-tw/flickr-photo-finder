# AI 初標輸入與輸出合約

這份文件定義新接手的 AI model、agent 或技術志工在「照片內容初標」階段要讀取哪些輸入、輸出什麼格式，以及後續工具如何驗證與使用結果。

AI 初標只產生候選 metadata。它不直接代表人工 review，也不應直接把照片推進到 `reviewed` 或 `approved`。

若需要逐步操作、prompt 使用方式、常見 validator 錯誤與判斷校準，請看 `docs/ai-labeling-operator-guide.md`。可直接交給模型的提示範本放在 `prompts/ai-labeling.md`。

## 適用階段

這份合約適用於已經完成以下流程之後：

1. 正式 Google Sheets 已有 `photos` 資料。
2. 技術志工或 agent 已執行 `pnpm sheets:export`，產生 `tmp/sheets-export/photos.csv`。
3. 技術志工或 agent 已執行 `pnpm ai:prepare`，產生 `tmp/ai-runs/<run-id>/`；若是多模型或多輪比較，也可再用 `pnpm ai:attempt` 從該 run 建立 attempt 目錄。

若還沒有 AI run 目錄，請先執行：

```bash
pnpm sheets:export
pnpm ai:prepare -- --limit 50 --image-size large-1024
```

`ai:prepare` 預設選出 `curation_status = unreviewed` 的照片。若需要特定照片、整本相簿或特定狀態，應由操作者在建立 run 時使用 `--photo-ids`、`--album`、`--status`、`--limit` 或 `--image-size` 控制，不應由 AI 自行改動正式 Sheets。`--limit all` 代表不設上限；整本相簿可使用 `--album <album-id> --limit all`，若要包含所有整理狀態再加上 `--status all`。

若要用同一批輸入比較不同模型或同一模型的不同輪次，應建立 attempt：

```bash
pnpm ai:attempt -- --from tmp/ai-runs/<run-id> --model claude --round 1
pnpm ai:attempt -- --from tmp/ai-runs/<run-id> --model claude --round 2 --label visual-description
```

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
- `confidence` 可省略；若提供，必須是 `0` 到 `1` 的數字。

## 可輸出欄位

AI proposal 目前只允許以下欄位：

| 欄位 | `value` 型別 | 說明 |
| --- | --- | --- |
| `people_count` | 非負整數 | 照片中可辨識的人數估計。 |
| `scene_tags` | 字串陣列 | 照片中看見的事實。值必須存在於 `data/tag-taxonomy.json`。 |
| `mood_tags` | 字串陣列 | 照片帶來的感受。值必須存在於 `data/tag-taxonomy.json`。 |
| `recommended_uses` | 字串陣列 | 適合用途。值必須存在於 `data/tag-taxonomy.json`。 |
| `sponsorship_items` | 字串陣列 | 贊助品項。值必須對齊 `data/sponsorship-items.json` 衍生的 taxonomy。 |
| `sponsorship_tags` | 字串陣列 | 贊助價值或佐證用途。值必須存在於 `data/tag-taxonomy.json`。 |
| `orientation` | 字串 | 照片方向。值必須存在於 `data/tag-taxonomy.json`。 |
| `has_negative_space` | 布林值 | 是否有明顯留白可放字。 |
| `safe_crop` | 字串陣列 | 適合裁切比例。值必須存在於 `data/tag-taxonomy.json`。 |
| `visual_description` | 字串 | 1 到 2 句中立畫面描述，用於自然語言搜尋與人工找圖輔助，只能描述照片中可見內容。 |
| `public_use_status` | 字串 | AI 只能建議 `needs_review` 或 `avoid`，不能建議 `approved`。 |
| `priority_level` | 字串 | 推薦優先度。值必須存在於 `data/tag-taxonomy.json`。 |
| `collections` | 字串陣列 | 可建議素材包名稱；仍須由人類判斷是否採用。 |
| `curation_status` | 字串 | AI 只能建議 `ai_labeled`。 |

多值欄位在 proposal 中必須使用 JSON array，不使用 CSV 裡的分號字串。後續工具會在產生 Sheets update plan 時轉成正式表格需要的格式。

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
- `people_count`、`orientation`、`has_negative_space` 是 AI 初標的基礎讀圖欄位；只要圖片可讀，通常應提出候選值。
- `safe_crop` 應從版面可用性判斷。只有在裁切後主體、臉部、重要文字與主要物件仍可保留時才提出該比例。
- `visual_description` 應描述 taxonomy 欄位難以涵蓋的可見細節，例如物件、文字、姿勢、動作、表情、空間位置與構圖關係。它不是照片標題，也不是欄位 reason。
- `visual_description` 不應重複機械欄位，例如「橫式照片」、「有 5 人」；除非人數或方向對理解畫面構圖有必要。
- `visual_description` 不應寫活動名稱、年份、身份、單位或贊助商推論，除非文字清楚出現在照片中，且應以「畫面可見文字」描述。
- `recommended_uses` 應避免全部落在通用用途；請優先提出能幫助取圖排序與情境判斷的用途。
- `reason` 必須只依據圖片可見內容或 `photos.json` 既有 metadata，不應自行補上未確認的活動名稱、身份、單位或年份。
- 讀圖欄位的 reason 和 `visual_description` 都不應跨照片重複套用模板。若多張照片建議值相同，也要描述每張照片各自的可見證據。
- 若現有 taxonomy 無法準確描述照片，應省略不精準欄位，並在人工檢查時另外記錄 taxonomy gap，不要硬套錯誤標籤。

## 驗證與後續使用

產生 `metadata-proposals.json` 後，先執行：

```bash
pnpm ai:review -- --run-dir tmp/ai-runs/<run-id>
```

`ai:review` 會驗證 proposal，並產生 `metadata-review-summary.md`、`metadata-diff.md`、`metadata-update-plan.json` 與 `metadata-update-plan.csv`。若只想執行單一步驟，可使用底層指令：

```bash
pnpm ai:validate -- --run-dir tmp/ai-runs/<run-id>
pnpm ai:diff -- --run-dir tmp/ai-runs/<run-id>
pnpm ai:plan -- --run-dir tmp/ai-runs/<run-id>
```

若要比較多個 run 或 attempt，可以產生唯讀 HTML 報表：

```bash
pnpm ai:report -- --runs tmp/ai-runs/<run-or-attempt-a> tmp/ai-runs/<run-or-attempt-b>
```

報表只讀取本機 artifact，不修改 proposal，也不寫入 Google Sheets。

檢查這份計畫會更新正式 Google Sheets 哪些 cells：

```bash
pnpm sheets:apply-ai-updates -- --run-dir tmp/ai-runs/<run-id>
```

這個指令預設 dry-run，不寫入 Sheets。只有人類確認 dry-run 顯示的欄位、原值與建議值都合理後，才可加上 `--write`。

正式 review 不在 AI run 目錄中完成。AI run 最多把資料推進到 `ai_labeled`；`reviewed` 應回到 Google Sheets，由具有編輯權限的志工們協作檢查、修正並補齊必要欄位後再更新。
