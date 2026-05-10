# AI 初標操作指南

這份文件給執行 `prepare -> validate` 中間階段的操作者、agent 與模型協作者使用。它補足 `docs/ai-labeling-contract.md` 的操作層細節。

合約文件回答「格式是什麼」；本文件回答「接手後應該怎麼做、怎麼判斷、錯了怎麼修」。

## 操作流程

### 1. 取得正式 Sheets 工作快取

```bash
pnpm sheets:export
```

這會把正式 Google Sheets 固定 tabs 匯出到 `tmp/sheets-export/`。AI 初標不應直接讀 repo fixture 當正式資料來源。

### 2. 建立 AI run

```bash
pnpm ai:prepare -- --limit 50 --image-size large-1024
```

若要指定特定照片：

```bash
pnpm ai:prepare -- --photo-ids 55200405673,55200257281 --image-size large-1024
```

若要準備整本相簿中尚未整理的照片：

```bash
pnpm ai:prepare -- --album ALBUM_ID --limit all --image-size large-1024
```

若要整本相簿所有整理狀態都放進工作包：

```bash
pnpm ai:prepare -- --album ALBUM_ID --limit all --status all --image-size large-1024
```

若照片需要細節判讀，可少量使用：

```bash
pnpm ai:prepare -- --photo-ids PHOTO_ID --image-size original
```

`--limit all` 代表不設上限；若不指定，預設最多準備 50 張。`ai:prepare` 會輸出 `tmp/ai-runs/<run-id>/`，並在同一個目錄寫入 `ai-labeling-prompt.md`。後續所有 AI 初標工作都應限制在這個 run 目錄內。

若這次目的不是整理某一本相簿，而是回頭驗證欄位、taxonomy 或 prompt 是否能跨活動場景成立，請改用跨活動抽樣：

```bash
pnpm eval:sample
```

這會讀取 `data/ai-cross-activity-sample-plan.json`，從多本 SITCON Flickr 相簿依相簿順序等距抽樣，產生 `tmp/ai-samples/<run-id>/photos.csv` 與 `tmp/ai-runs/<run-id>/`。這份資料集只用於本機 AI 初標測試，不代表正式 Sheets 資料，也不會寫入 Google Sheets。

跨活動抽樣預設只用 `fixtures/photos.csv` 重用少量已知 metadata，其他照片 metadata 會即時從 Flickr 取得。若要刻意沿用正式 Sheets 匯出中的既有欄位值，可以加上 `--photos tmp/sheets-export/photos.csv`，但該檔案必須先和目前 schema 同步。

### 3. 多模型或多輪比較時建立 attempt

若要把同一批輸入交給不同模型，或同一模型重跑第二輪，請從既有 run 建立 attempt，不要手動複製整個資料夾：

```bash
pnpm eval:attempt -- --from tmp/ai-runs/<run-id> --model claude --round 1
pnpm eval:attempt -- --from tmp/ai-runs/<run-id> --model claude --round 2 --label visual-description
pnpm eval:attempt -- --from tmp/ai-runs/<run-id> --model gpt --round 1
```

attempt 目錄仍包含 `photos.json`、`manifest.json`、`ai-labeling-prompt.md` 與 `images/`，可以直接交給模型，也可以直接執行 `pnpm ai:review -- --run-dir <attempt-dir>`。圖片預設用 symlink 或 hardlink 共用；若環境不支援連結，可加上 `--copy-images`。

### 4. 交給模型前先確認工作包

操作者或 agent 應確認：

- `manifest.json` 存在且 `selected_photo_count` 符合預期。
- `photos.json` 存在且每筆都有 `photo_id`。
- `ai-labeling-prompt.md` 存在，可直接交給模型或 agent。
- 若是 attempt，`attempt.json` 存在且 `model`、`round`、`base_run_id` 符合預期。
- 若要讀本機圖片，`local_image_path` 有值且指向 `images/` 下的圖片。
- 若 `local_image_path` 為空，模型需要使用 `image_download_url`，或重新執行有下載圖片的 `ai:prepare`。

### 5. 將 prompt 與工作包交給模型

模型應使用 run 目錄中的 `ai-labeling-prompt.md` 作為任務提示。這份檔案會引用本次 run 目錄，並包含 `prompts/ai-labeling.md` 的通用提示內容。模型仍應讀取：

- `docs/ai-labeling-contract.md`
- `data/photo-schema.json`
- `data/tag-taxonomy.json`
- `data/sponsorship-items.json`
- `tmp/ai-runs/<run-id>/manifest.json`
- `tmp/ai-runs/<run-id>/photos.json`
- `tmp/ai-runs/<run-id>/images/`

模型只能輸出：

```text
tmp/ai-runs/<run-id>/metadata-proposals.json
```

### 6. 檢查模型輸出

```bash
pnpm ai:review -- --run-dir tmp/ai-runs/<run-id>
```

這個指令會一次完成：

- 驗證 `metadata-proposals.json`。
- 產生 `metadata-diff.md`，供人類逐欄看原值、建議值、信心與 reason。
- 產生 `metadata-update-plan.json` 與 `metadata-update-plan.csv`，列出後續可能回寫的欄位值。
- 產生 `metadata-review-summary.md`，整理欄位覆蓋率、常見值分布、批次層級警訊與下一步指令。

`ai:review` 終端輸出的 `Next:` 與 `metadata-review-summary.md` 的 `## Next Commands` 是這段流程的主要交接提示。若新增報表、比較、搜尋實驗或回寫前檢查工具，應同步更新這兩個地方。

若失敗，請根據錯誤訊息修正 `metadata-proposals.json`，不要改 `photos.json` 或正式 Sheets。

若通過但輸出 review warnings，代表格式與責任邊界可接受，但仍有批次品質疑慮需要人工判斷；例如相同 `public_use_status` reason 在多張照片重複，可能是模型套模板，也可能是同一活動情境下合理的共同限制。

常見錯誤：

| 錯誤 | 原因 | 修正 |
| --- | --- | --- |
| `value must be an array of non-empty strings` | 多值欄位用了分號字串。 | 改成 JSON array，例如 `["合照", "舞台"]`。 |
| `unknown taxonomy value` | 使用了 taxonomy 以外的值。 | 改用 `data/tag-taxonomy.json` 中既有值；若真的不足，先省略並另行回報。 |
| `AI proposals must not set approved` | AI 把 `public_use_status` 設成 `approved`。 | 改成 `needs_review`、`avoid`，或省略此欄。 |
| `AI proposals may only set ai_labeled` | AI 把 `curation_status` 設成 `reviewed`。 | 改成 `ai_labeled`，或省略此欄。 |
| `field is not allowed in AI proposals` | AI 嘗試改 Flickr 基本欄位或人工欄位。 | 移除該欄位 proposal。 |

### 7. 檢視單次結果或比較多模型/多輪結果

若要閱讀單次 AI 初標結果：

```bash
pnpm ai:report -- --run tmp/ai-runs/<attempt-or-run>
```

若要比較多個模型或多輪結果：

```bash
pnpm ai:report -- --runs tmp/ai-runs/<attempt-a> tmp/ai-runs/<attempt-b> tmp/ai-runs/<attempt-c>
```

這會產生 `tmp/ai-reports/<timestamp>/index.html`。報表是唯讀靜態 HTML；單一 run 會以每張照片為單位呈現縮圖、欄位覆蓋率與各 proposal 細節，多個 run 會並排顯示 value、reason、confidence、validator 狀態與差異。它不修改 proposal，也不寫入 Sheets。

若這次要驗證 `visual_description` 對自然語言找圖是否真的有幫助，可在寫回 Sheets 前跑離線搜尋比較：

```bash
pnpm eval:search -- --run-dir tmp/ai-runs/<attempt-or-run>
pnpm eval:search -- --run-dir tmp/ai-runs/<attempt-or-run> --query "有留白的橫式講者照片" --top 10
```

這個 prototype 不呼叫 LLM、不抓圖片，也不寫入 Sheets；它只比較 taxonomy-only baseline 與 taxonomy + `visual_description` 的排序差異。

### 8. 進階：只執行單一步驟

```bash
pnpm ai:validate -- --run-dir tmp/ai-runs/<run-id>
pnpm ai:diff -- --run-dir tmp/ai-runs/<run-id>
pnpm ai:plan -- --run-dir tmp/ai-runs/<run-id>
```

日常檢視請優先使用 `pnpm ai:review`。上述低階指令保留給自動化、除錯或只想重建其中一份產物的情境。

### 9. dry-run Sheets 更新

`sheets:apply-ai-updates` 會讀正式 Google Sheets；執行它的 shell、agent process 或 CI job 必須先設定 `GOOGLE_APPLICATION_CREDENTIALS`，並使用對目標 Sheets 有讀取權限的 service account。

```bash
pnpm sheets:apply-ai-updates -- --run-dir tmp/ai-runs/<run-id>
```

這一步只檢查會更新哪些 cells，預設不寫入。若正式 Sheets 中已有其他志工修改同一欄，工具會因 current value 不一致而阻擋，避免覆蓋人工整理結果。

## 判斷校準

### 人數

- `people_count` 是可辨識人數的估計值，不需要精確到每個模糊背景人影。
- 主體群像可估算整體人數；若人數過多且難以精準，可給接近值並在 `reason` 說明是估計。
- 無人照片可填 `0`。
- 無法判斷時省略，不要填負數或文字。

### 場景、氛圍、用途

- `subject_type` 是照片海初篩用的主要視覺主體粗分類，只能單選 `people`、`object`、`food`、`text_signage`、`screen` 或 `space`；不要拿它描述人數規模、活動場景或用途。
- `scene_tags` 寫畫面事實，例如 `合照`、`舞台`、`背板`。
- `mood_tags` 寫照片帶來的感受，例如 `儀式感`、`成就感`、`青春感`。
- `recommended_uses` 寫可能工作用途，例如 `社群貼文`、`活動回顧`、`新聞稿`。
- `mood_tags` 不應被當成品質分數；品質好但情緒中性的照片可以沒有 mood。相反地，只要照片有可見的表情、互動、人群密度、舞台正式感、青春氛圍、手作專注或幕後準備狀態，足以支撐宣傳感受，就應提出 1 到 2 個候選值。
- `mood_tags` 的 reason 要寫可見依據，例如「多人舉手互動」、「志工在地上整理物資」、「講者站在正式背板前說明」；不要只寫「看起來專業」、「氣氛友善」。
- `recommended_uses` 應選最有區辨度的 1 到 3 個用途；不要把 `活動回顧` 當成所有照片的預設答案。
- `活動回顧` 不是「這是活動照片」的同義詞。只有照片能代表流程、重要場面、互動狀態、活動成果或現場特色時才使用。
- 若只能勉強推論，寧可少填，不要填滿。

### 畫面描述

- `visual_description` 是自然語言搜尋與人工找圖輔助欄位，不是照片標題，也不是某個欄位的 reason。
- 請寫 1 到 2 句中立描述，只描述照片中可見內容。
- 優先描述 taxonomy 欄位難以涵蓋的長尾細節，例如物件、文字、姿勢、動作、表情、空間位置、構圖關係。
- 不要重複機械欄位，例如「橫式照片」、「有 5 人」，除非這些資訊對理解畫面構圖有必要。
- 不要自行補活動名稱、年份、身份、單位或贊助商推論；若照片中清楚可見文字，可寫成「畫面可見文字……」。
- 避免空泛句，例如「畫面有人在交流」或「活動現場照片」。不同照片不可套用完全或近似相同的描述。

### 設計取用欄位

- `has_negative_space` 是照片中是否有明顯留白可放標題、活動資訊或贊助訊息。只要圖片可讀，AI 通常應提出 `true` 或 `false` 候選值。
- `safe_crop` 是常見版型是否能安全裁切。判斷時要確認裁切後主體、臉部、重要文字與主要物件不會被切掉。
- `safe_crop` 可用值以 `data/tag-taxonomy.json` 為準；目前常見用途是 `1:1`、`16:9`、`9:16`。
- 若照片沒有安全裁切比例，省略 `safe_crop`，不要用空泛 reason 勉強提出。
- 橫式照片不等於 `16:9` 安全。若上下裁切會切到人臉、投影片文字、背板 Logo、桌面物件或重要手勢，就不要輸出該比例。
- 這兩個欄位對社群宣傳、網站 hero、簡報與設計素材很重要，不只是攝影描述。

### reason 寫法

- `reason` 只描述圖片中看得見的線索，或 `photos.json` 已提供的 metadata。
- 不要自行補上未確認的活動名稱、身份、單位、年份或組別。
- 可以寫「畫面中可見多人在背板前合照」。
- 不要寫「年會掛繩」、「某組得獎者」這類圖片或 metadata 沒有明確支持的內容。
- 若 taxonomy 無法描述照片，例如獎項、物件特寫或展示板，寧可省略不精準欄位，並在人工檢查時另外記錄 taxonomy gap。

### 贊助欄位

- `sponsorship_items` 必須對齊 `data/sponsorship-items.json`。
- 只有畫面或相簿脈絡足以支持時才建議 `sponsorship_items`。
- 不要因為看到 logo、旗幟、背板，就自動推論某個具體贊助品項。
- `sponsorship_tags` 是贊助價值或佐證用途，例如 `品牌露出`、`贊助成果佐證`。
- 不確定時先省略贊助欄位，讓行銷組在 Google Sheets 補充。

### 狀態與公開使用

- AI 最多把 `curation_status` 建議為 `ai_labeled`。
- AI 不得建議 `reviewed`。
- AI 不得建議 `public_use_status = approved`。
- 不確定公開使用狀態時，優先用 `needs_review` 或省略。
- 明顯不適合一般推薦時可建議 `avoid`，但理由要寫清楚。

### 信心分數

`confidence` 是輔助人類審核的相對信心，不是模型品質分數。

建議使用：

- `0.9` 左右：畫面非常清楚，幾乎不需推論。
- `0.7` 到 `0.8`：可合理判斷，但仍有少量不確定。
- `0.5` 到 `0.6`：可作為候選，但需要人類特別確認。

低於 `0.5` 的內容通常應省略，除非操作者明確要求保留弱訊號。

## 回歸測試

範例 proposal 放在 `fixtures/ai-proposals/`。驗證所有範例：

```bash
pnpm eval:validate-fixtures
```

這個指令會確認 valid example 必須通過，invalid examples 必須被 validator 擋下。若未來調整 `metadata-proposals.json` 格式、taxonomy 或 AI 邊界，應同步更新範例與此測試。
