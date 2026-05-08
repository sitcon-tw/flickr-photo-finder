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

`--limit all` 代表不設上限；若不指定，預設最多準備 50 張。`ai:prepare` 會輸出 `tmp/ai-runs/<run-id>/`。後續所有 AI 初標工作都應限制在這個 run 目錄內。

### 3. 交給模型前先確認工作包

操作者或 agent 應確認：

- `manifest.json` 存在且 `selected_photo_count` 符合預期。
- `photos.json` 存在且每筆都有 `photo_id`。
- 若要讀本機圖片，`local_image_path` 有值且指向 `images/` 下的圖片。
- 若 `local_image_path` 為空，模型需要使用 `image_download_url`，或重新執行有下載圖片的 `ai:prepare`。

### 4. 將 prompt 與工作包交給模型

模型應使用 `prompts/ai-labeling.md` 作為任務提示，並讀取：

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

### 5. 驗證模型輸出

```bash
pnpm ai:validate -- --run-dir tmp/ai-runs/<run-id>
```

若失敗，請根據錯誤訊息修正 `metadata-proposals.json`，不要改 `photos.json` 或正式 Sheets。

常見錯誤：

| 錯誤 | 原因 | 修正 |
| --- | --- | --- |
| `value must be an array of non-empty strings` | 多值欄位用了分號字串。 | 改成 JSON array，例如 `["合照", "舞台"]`。 |
| `unknown taxonomy value` | 使用了 taxonomy 以外的值。 | 改用 `data/tag-taxonomy.json` 中既有值；若真的不足，先省略並另行回報。 |
| `AI proposals must not set approved` | AI 把 `public_use_status` 設成 `approved`。 | 改成 `needs_review`、`avoid`，或省略此欄。 |
| `AI proposals may only set ai_labeled` | AI 把 `curation_status` 設成 `reviewed`。 | 改成 `ai_labeled`，或省略此欄。 |
| `field is not allowed in AI proposals` | AI 嘗試改 Flickr 基本欄位或人工欄位。 | 移除該欄位 proposal。 |

### 6. 產生審核資料

```bash
pnpm ai:diff -- --run-dir tmp/ai-runs/<run-id>
pnpm ai:plan -- --run-dir tmp/ai-runs/<run-id>
```

`metadata-diff.md` 給人類閱讀；`metadata-update-plan.json` 與 CSV 給後續 dry-run 工具使用。

### 7. dry-run Sheets 更新

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

- `scene_tags` 寫畫面事實，例如 `合照`、`舞台`、`背板`。
- `mood_tags` 寫照片帶來的感受，例如 `儀式感`、`成就感`、`青春感`。
- `recommended_uses` 寫可能工作用途，例如 `社群貼文`、`活動回顧`、`新聞稿`。
- 若只能勉強推論，寧可少填，不要填滿。

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
pnpm ai:validate-fixtures
```

這個指令會確認 valid example 必須通過，invalid examples 必須被 validator 擋下。若未來調整 `metadata-proposals.json` 格式、taxonomy 或 AI 邊界，應同步更新範例與此測試。
