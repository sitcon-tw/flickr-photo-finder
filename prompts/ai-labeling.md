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

你必須逐一打開並檢視每張照片的 `local_image_path` 或 `image_download_url` 後，才可為該 `photo_id` 輸出候選欄位。禁止只根據 `photo_id`、檔名順序、相簿名稱、前後照片、批次規則或模板推論欄位。禁止先建立場景 archetype 後批量套用到多張照片。

若你無法實際載入或視覺解析某張圖片，請停止並回報無法處理的 `photo_id`；不要用通用值、預設值或「推測」字眼填入 proposal。寧可缺項，不可虛構。

每張有可讀圖片的照片，都應優先判斷以下基礎欄位：

- `people_count`: 畫面中可辨識的所有人，包括背景與部分入鏡但可辨識的人，不只是主體。無人照片請填 `0`；人數很多時可估計，並在 reason 寫出估算依據，例如「前排約 6 人、後方約 4 排，每排約 5 人」。這是原始數值欄位，請不要輸出人數區間、少量/中量/大量、small group/crowd 這類分類。
- `orientation`: 橫式、直式或方形。
- `has_negative_space`: 是否有明顯留白可放文字。只要圖片可讀，通常應輸出 `true` 或 `false`。
- `safe_crop`: 不是「能裁就標」。請逐一比例驗證 `1:1`、`16:9`、`9:16`；裁切後主要人物臉部、主要物件、可讀文字或重要構圖元素不可被截斷。若沒有安全裁切比例，請省略整個欄位。
- `visual_description`: 1 到 2 句中立的畫面描述，用於自然語言搜尋與人工找圖。請描述 taxonomy 欄位難以涵蓋的可見細節，例如物件、文字、姿勢、動作、表情、空間位置與構圖關係。
- `curation_status`: 若你對這張照片有提出任何候選 metadata，請設為 `ai_labeled`。

接著再判斷 `scene_tags`、`mood_tags`、`recommended_uses`、`public_use_status` 與其他欄位。

`mood_tags` 不是必填欄位。只有照片有明確可見的情緒、氛圍或宣傳語感時才輸出，通常 1 到 2 個值就足夠。請不要把 `專業`、`專注`、`友善` 當成一般活動照片的預設感受；reason 必須指出具體視覺證據，例如表情、動作、人群密度、光線、姿態、現場互動、講台正式程度或幕後工作狀態。若照片只是普通紀錄照，沒有鮮明情緒辨識度，請省略 `mood_tags`。

`recommended_uses` 不是必填欄位；只有照片明確適合某個工作用途時才輸出。不要把 `活動回顧` 或 `社群貼文` 當成預設用途。請先找比 `活動回顧` 更有區辨度的 1 到 3 個用途，例如講者、志工、新聞、網站、簡報或贊助相關用途。只有其他用途都不適用，但這張照片仍有明確一般回顧價值時，才可單獨使用 `活動回顧`，且 reason 必須說明這張照片的具體回顧價值。

`贊助成果報告` 與 `贊助提案` 必須有可見或既有 metadata 支撐的贊助脈絡。若你無法同時提出合理的 `sponsorship_items` 或 `sponsorship_tags`，通常代表不應輸出贊助相關 `recommended_uses`。SITCON 自有 Logo、旗幟、桌旗、活動背板、一般茶點或一般現場配置，不足以支撐贊助相關用途。

`public_use_status` 不必每張都填。空白不代表照片已被人工核可，也不代表 `approved`；它只表示 AI 沒有提出公開使用警訊。整理流程本來就會讓未審照片停留在待審狀態；沒有具體風險訊號的照片請省略。只有觀察到明確疑慮時才填 `needs_review` 或 `avoid`，例如兒童面部清晰可辨、姓名或聯絡資訊曝光、明顯模糊閉眼、表情不佳、主體被遮擋或可能造成誤解，並在 reason 點明你看到的訊號。

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
- `reason` 和 `visual_description` 應使用台灣慣用繁體中文；照片中清楚可見的英文文字可以照原文引用。
- `confidence` 可省略；若提供，必須是 0 到 1 的數字。
- 多值欄位必須使用 JSON array，不要使用分號字串。
- 讀圖欄位的 `reason` 必須引用本張照片至少一個具體可見元素，例如人物動作、服裝、物件位置、表情、姿勢、構圖位置、可讀文字或裁切風險。同一段 `reason` 文字不可在多張不同 `photo_id` 之間重複使用；即使建議值相同，也要為每張照片寫出不同的可見證據。
- 禁止使用「推測值」、「預設為」、「一般而言」、「圖片尺寸為 NxN」這類沒有本張視覺內容的固定語言。
- `visual_description` 的 `value` 必須至少 20 個非空白字元，必須包含具體可見細節，且不同照片之間不可完全或近似重複。

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
- `visual_description`: 字串，1 到 2 句中立畫面描述，只描述可見內容。
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
- `mood_tags` 是照片帶來的感受，例如 `儀式感`、`成就感`、`青春感`。它用來輔助社群、網站、招募與宣傳找圖，不是品質分數，也不是每張照片都要有的分類。
- `recommended_uses` 是工作用途，例如 `社群貼文`、`活動回顧`。
- `recommended_uses` 的目的不是把每張照片分類，而是提示照片特別適合的使用情境。若照片只是普通可用，但沒有明確用途優勢，請省略。
- `sponsorship_items` 是外部贊助商換取曝光或履約佐證的具體贊助品項；不確定就省略。SITCON 自有 Logo、旗幟、桌旗、布條、背板、工作人員配件或活動識別不屬於 `sponsorship_items`。只有畫面中可見具名贊助商 Logo、商品，或 `photos.json` 既有 metadata 明確指出贊助脈絡時才標。
- `sponsorship_tags` 是贊助價值或佐證用途；不確定就省略。只看到 SITCON 自身識別、茶點、餐點或一般現場配置，不足以推論 `品牌露出` 或 `贊助成果佐證`。
- `visual_description` 是自然語言搜尋用描述，不是正式照片標題，也不是欄位 reason。不要重複機械欄位，例如「橫式照片」、「有 5 人」；除非人數或方向對理解畫面構圖有必要。不要寫活動名稱、年份、身份、單位或贊助商推論，除非文字清楚出現在照片中，且請以「畫面可見文字」描述。
- 人數可以估計，但不要填負數或文字。
- `has_negative_space` 和 `safe_crop` 是給社群、設計與網站取圖使用的欄位，不只是攝影描述；請主動從版面可用性判斷。
- `safe_crop` 的判斷標準是裁切後主體、臉部、文字與重要物件仍保留。若只能靠很勉強的裁切才成立，請省略該比例。
- `public_use_status = avoid` 只用於明顯不適合一般推薦的照片，例如嚴重模糊、閉眼失焦、表情不佳、主體被遮擋或可能造成誤解。
- `priority_level` 容易主觀，除非照片明顯特別適合作為代表畫面，否則省略。
- 若受控字彙無法描述照片，例如獎項、物件特寫或展示板，請使用最接近且仍正確的既有 tag；若沒有正確 tag，寧可省略，不要硬套。
- reason 必須只描述看得見的線索或既有 metadata。可以寫「畫面中可見多人合照」，不要寫「年會掛繩」這類未確認脈絡。
- 低信心內容請省略，不要勉強輸出。

## 輸出前自我檢查

- 是否有超過 5 張照片在同一個欄位產出完全相同的 `value` 與 `reason`？若有，代表你可能沒有逐張看圖，請重做這些 item，或將該欄位省略。
- 是否有多張照片使用「推測值」、「預設為」、「圖片尺寸為」或其他固定語言？若有，請改成描述本張照片的可見證據。
- 是否幾乎每張照片都有 `mood_tags`，或大量照片都落在 `專業`、`專注`、`友善`？若有，請重新確認是否把 mood 當成預設分類。
- 是否把 SITCON 自身旗幟、Logo 或桌旗當成 sponsorship？若有，請移除 sponsorship 欄位。
- 是否把 `活動回顧`、`社群貼文` 或贊助相關用途套到大多數照片？若有，請重新確認每張照片是否真的具有該用途的具體優勢。
- 是否輸出了 `贊助成果報告` 或 `贊助提案`，但沒有可支持的 `sponsorship_items` 或 `sponsorship_tags`？若有，請移除贊助相關用途，除非 reason 能清楚指出贊助脈絡。
- 是否對所有照片都給相同 confidence？若有，請重新依每張照片的實際把握調整；若無法評估，省略 confidence。
- `visual_description` 是否能讓人類不用看圖就知道這張照片有哪些可見物件、動作或空間關係？若只是「有人在交流」、「活動現場照片」這類空泛描述，請重寫。

以下是錯誤輸出範例，請勿模仿：

```json
{
  "photo_id": "54847451413",
  "fields": {
    "people_count": {
      "value": 3,
      "reason": "畫面中約有3人（推測值）。",
      "confidence": 0.8
    },
    "scene_tags": {
      "value": ["會眾", "交流"],
      "reason": "推測場景包含會眾交流。",
      "confidence": 0.7
    }
  }
}
```

這代表沒有實際讀圖。每張照片的 reason 應該讓人類光看 reason 就能理解該照片的具體畫面線索。

## 完成後

你的輸出會被以下指令驗證：

```bash
pnpm ai:validate -- --run-dir tmp/ai-runs/<run-id>
```

若驗證失敗，請依錯誤訊息修正 `metadata-proposals.json`。
