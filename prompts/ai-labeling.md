# SITCON Flickr Photo Finder AI 初標 Prompt

你正在協助 SITCON Flickr Photo Finder 進行照片 metadata 初標。你的輸出只會作為人類可審核候選值，不代表人工 review。

## 你要讀取的資料

請先閱讀：

- `docs/ai-labeling-contract.md`
- `data/photo-schema.json`
- `data/tag-taxonomy.json`
- `data/sponsorship-items.json`
- 指定 AI run 目錄中的 `manifest.json`
- 指定 AI run 目錄中的 `photos.json`
- 指定 AI run 目錄中的 `images/`

`photos.json` 裡的 `local_image_path` 是相對於 AI run 目錄的圖片路徑。若 `local_image_path` 為空，使用 `image_download_url`，或回報需要操作者重新建立有下載圖片的 run。

## 你的任務

針對 `photos.json` 中每張照片，觀察圖片與既有 metadata，產生可審核的欄位候選值。請只輸出你有足夠把握的欄位；不要為了填滿欄位而猜測。

每張有可讀圖片的照片，都應優先判斷以下基礎欄位：

- `people_count`: 可辨識人數。無人照片請填 `0`；人數很多時可估計，並在 reason 寫明「約」。
- `orientation`: 橫式、直式或方形。
- `has_negative_space`: 是否有明顯留白可放文字。只要圖片可讀，通常應輸出 `true` 或 `false`。
- `safe_crop`: 若適合裁成 `1:1`、`16:9` 或 `9:16` 且不會明顯切掉主體，請輸出可用比例；若沒有安全裁切比例，請省略。
- `curation_status`: 若你對這張照片有提出任何候選 metadata，請設為 `ai_labeled`。

接著再判斷 `scene_tags`、`mood_tags`、`recommended_uses`、`public_use_status` 與其他欄位。`recommended_uses` 請選最有區辨度的 1 到 3 個用途；不要把 `活動回顧` 當作所有照片的預設答案。

輸出必須寫成 AI run 目錄中的：

```text
metadata-proposals.json
```

## 輸出格式

輸出必須是單一 JSON object：

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
        "people_count": {
          "value": 15,
          "reason": "畫面中可辨識約 15 人。",
          "confidence": 0.8
        }
      }
    }
  ]
}
```

規則：

- `run_id` 必須等於 `manifest.json` 的 `run_id`。
- 每張照片最多一個 item。
- 每個欄位 proposal 必須有 `value` 和 `reason`。
- `confidence` 可省略；若提供，必須是 0 到 1 的數字。
- 多值欄位必須使用 JSON array，不要使用分號字串。

## 你可以輸出的欄位

只允許：

- `people_count`: 非負整數。
- `scene_tags`: 字串陣列，必須來自 `data/tag-taxonomy.json`。
- `mood_tags`: 字串陣列，必須來自 `data/tag-taxonomy.json`。
- `recommended_uses`: 字串陣列，必須來自 `data/tag-taxonomy.json`。
- `sponsorship_items`: 字串陣列，必須對齊 `data/sponsorship-items.json` 衍生的 taxonomy。
- `sponsorship_tags`: 字串陣列，必須來自 `data/tag-taxonomy.json`。
- `orientation`: 字串，必須來自 `data/tag-taxonomy.json`。
- `has_negative_space`: 布林值。
- `safe_crop`: 字串陣列，必須來自 `data/tag-taxonomy.json`。
- `public_use_status`: 字串，但不能是 `approved`。
- `priority_level`: 字串，必須來自 `data/tag-taxonomy.json`。
- `collections`: 字串陣列。
- `curation_status`: 只能是 `ai_labeled`。

## 禁止事項

- 不要輸出 Markdown、解釋段落或 JSON 以外的文字。
- 不要修改 `photos.json`。
- 不要修改正式 Google Sheets。
- 不要把 `curation_status` 設為 `reviewed`。
- 不要把 `public_use_status` 設為 `approved`。
- 不要輸出 taxonomy 中不存在的值。
- 不要使用分號字串表示多值欄位。
- 不要修改 `photo_id`、`photo_url`、`album_ids`、`image_preview_url`、`album_title`、`event_name`、`event_year`、`photographer`、`license`、`curation_notes`。
- 不要憑空推論攝影師、授權或活動內部資訊。
- 不要在 reason 中加入圖片或既有 metadata 無法支持的活動名稱、身份、單位或年份推論。
- 不要把 `scene_tags`、`sponsorship_items`、`sponsorship_tags` 混用。

## 判斷原則

- `scene_tags` 是畫面事實，例如 `合照`、`舞台`、`背板`。
- `mood_tags` 是感受，例如 `儀式感`、`成就感`、`青春感`。
- `recommended_uses` 是工作用途，例如 `社群貼文`、`活動回顧`。
- `sponsorship_items` 是具體贊助品項；不確定就省略。
- `sponsorship_tags` 是贊助價值或佐證用途；不確定就省略。
- 人數可以估計，但不要填負數或文字。
- `has_negative_space` 和 `safe_crop` 是給社群、設計與網站取圖使用的欄位，不只是攝影描述；請主動從版面可用性判斷。
- `safe_crop` 的判斷標準是裁切後主體、臉部、文字與重要物件仍保留。若只能靠很勉強的裁切才成立，請省略該比例。
- `public_use_status = avoid` 只用於明顯不適合一般推薦的照片，例如嚴重模糊、閉眼失焦、表情不佳、主體被遮擋或可能造成誤解。
- `priority_level` 容易主觀，除非照片明顯特別適合作為代表畫面，否則省略。
- 若受控字彙無法描述照片，例如獎項、物件特寫或展示板，請使用最接近且仍正確的既有 tag；若沒有正確 tag，寧可省略，不要硬套。
- reason 必須只描述看得見的線索或既有 metadata。可以寫「畫面中可見多人合照」，不要寫「年會掛繩」這類未確認脈絡。
- 低信心內容請省略，不要勉強輸出。

## 完成後

你的輸出會被以下指令驗證：

```bash
pnpm ai:validate -- --run-dir tmp/ai-runs/<run-id>
```

若驗證失敗，請依錯誤訊息修正 `metadata-proposals.json`。
