# AI 初標評估紀錄

這份文件記錄 AI 初標結果的評估方式與目前幾次測試觀察。它的目的不是替模型排名，而是讓未來調整 prompt、schema、taxonomy 或工具警訊時，有可追溯的判斷基準。

本文件中的單次 run 觀察只代表當時的 prompt、資料、圖片尺寸、操作方式與模型 session。未來不應把這些結論當成某個模型的永久能力評價；若 prompt、taxonomy、圖片尺寸或模型版本改變，應重新評估。

## 評估目標

AI 初標結果要能協助志工更快整理照片，但不能取代人工 review。評估時優先看：

- 是否符合 `docs/ai-labeling-contract.md`，能通過 `pnpm ai:review`。
- 是否產生足夠可審核的候選值，而不是只格式正確。
- `people_count` 是否可作為篩選輔助，且錯誤不會太離譜。
- `has_negative_space` 與 `safe_crop` 是否真的能幫助社群、設計與網站取圖。
- `recommended_uses` 是否有區辨度，而不是每張都落在同一兩個通用用途。
- `priority_level` 是否只在明顯代表性照片上提出，而不是每張都填。
- `reason` 是否只描述圖片可見內容或既有 metadata，沒有自行補活動、身份、單位或年份。
- 是否避免把 `scene_tags`、`sponsorship_items`、`sponsorship_tags` 混用。
- 是否保守處理 `public_use_status`，不把 AI 結果直接推成 `approved`。

## 建議評估流程

每次模型完成 `metadata-proposals.json` 後，先執行：

```bash
pnpm ai:review -- --run-dir tmp/ai-runs/<run-id>
```

先看 `metadata-review-summary.md`：

- Field Coverage: 是否有應該出現卻缺席的欄位。
- Value Distribution: 是否有單一值過度集中。
- Review Notes: 是否出現批次層級警訊。
- Planned Update Sample: reason 是否能讓人快速判斷建議值是否可信。

接著抽查 `metadata-diff.md` 與圖片本身。若要確認正式 Sheets 將被更新哪些 cells，再執行 dry-run：

```bash
pnpm sheets:apply-ai-updates -- --run-dir tmp/ai-runs/<run-id>
```

只有人類確認後，才加上 `--write`。正式 `reviewed` 仍應在 Google Sheets 中由志工協作完成。

## 目前測試觀察

以下觀察來自同一批相簿 `72177720333028101` 的 25 張照片，圖片尺寸多為 `large-1024`。這些 run 的 prompt 版本與產物完整度不完全相同，因此只能作為調校線索。

### `ai-prepare-2026-05-08T20-17-00-440Z`

- 檔案紀錄 producer: `claude-opus-4-7`。
- `pnpm ai:validate` 通過。
- 優點：
  - 輸出格式穩定，沒有把 AI 結果標成 `reviewed`。
  - 沒有亂填 `sponsorship_items` 或 `sponsorship_tags`。
  - `scene_tags`、`mood_tags`、`recommended_uses` 大致可作為初標候選。
- 主要問題：
  - `has_negative_space` 幾乎缺席，`safe_crop` 沒有被穩定提出。
  - `recommended_uses` 偏保守，常落在 `活動回顧`。
  - reason 曾出現未確認脈絡，例如把掛繩描述成年會相關內容。
  - 遇到獎項看板、物件特寫、展示物時，現有 taxonomy 不足會讓標籤變得勉強。
- 判斷：
  - 適合作為流程 smoke test，但不適合直接回寫。
  - 促成後續 prompt 加強 `has_negative_space`、`safe_crop` 與 reason 邊界。

### `ai-prepare-2026-05-08T20-19-10-501Z`

- 檔案紀錄 producer: `Gemini-CLI`。
- `pnpm ai:validate` 通過。
- 優點：
  - 25 張都有主要欄位候選值。
  - `recommended_uses` 比前一輪更有變化，包含 `講者宣傳`、`簡報`、`新聞稿`、`志工招募`、`網站 hero`、`贊助成果報告`。
  - 對 `has_negative_space` 與 `safe_crop` 有積極判斷。
- 主要問題：
  - `safe_crop = 1:1` 出現在每張照片，明顯過度樂觀。
  - `people_count` 有幾筆不穩，例如只看主要物件而忽略背景可見人數。
  - `orientation` 可能把接近方形的直式照片標成 `square`，會影響版型篩選。
  - `confidence = 1` 偏多，尤其人數、用途、情緒這類欄位不應過度自信。
  - `贊助成果報告` 的使用需要更保守；沒有明確贊助脈絡時，不應只因獎項看板就推到贊助成果用途。
- 判斷：
  - 格式完整，但回寫前需要嚴格抽查 `safe_crop`、`people_count`、`recommended_uses` 與 `confidence`。
  - 這輪結果促成 `ai:review` 摘要中的批次層級警訊，例如每張都有 `1:1`、每張都有 `priority_level`、`confidence = 1` 比例偏高。

### `ai-prepare-2026-05-08T20-21-20-337Z`

- 檔案紀錄 producer: `GPT-5 Codex`。
- `pnpm ai:validate` 通過。
- 優點：
  - 25 張都有 `people_count`、`orientation`、`has_negative_space`、`safe_crop`、`scene_tags`、`mood_tags`、`recommended_uses`、`priority_level` 與 `curation_status`。
  - `safe_crop` 沒有像前一輪一樣每張都給 `1:1`，相對收斂。
  - reason 大多能直接對應畫面線索。
- 主要問題：
  - `priority_level` 每張都有，資訊量有限。
  - `recommended_uses` 仍偏集中，`活動回顧` 與 `社群貼文` 出現比例高。
  - 曾產生 `contact-sheet.jpg` 這類輔助檔；若模型被要求「只輸出 `metadata-proposals.json`」，這在合約邊界上需要提醒。
  - 該 run 使用的是較舊版 `ai-labeling-prompt.md`，尚未包含後來針對 reason、`safe_crop` 與 `priority_level` 的校準。
- 判斷：
  - 比第一輪更接近可審核成果，但仍不應直接全量寫回。
  - 適合作為新版 prompt 重跑後的比較基準。

## 不完整相簿基底測試觀察

以下觀察來自相簿 `72177720331149380` 的三次模型測試。這輪測試發生時，intake 工具仍只從 Flickr 相簿初始 HTML 擷取照片，因此只選到 24 張；該相簿實際應有 37 張。這批結果只能用來觀察模型輸出品質、prompt 行為與 review 工具警訊，不應作為完整相簿評估，也不應直接回寫正式 Sheets。

後續已修正 intake 工具，改為優先使用 Flickr API 取得完整 `photosets.getPhotos` 結果，並在相簿 `photo_count` 和實際取得數量不一致時拒絕產生不完整 artifact。完整 37 張相簿應以修正後重新建立的 AI run 為準。

### `ai-prepare-2026-05-08T21-07-04-991Z`

- 使用者紀錄模型：Gemini 3。
- 檔案紀錄 producer: `Gemini CLI Agent`。
- 相簿：`72177720331149380`。
- 圖片尺寸：`large-1024`。
- 選入照片：24 張；完整相簿應為 37 張。
- `pnpm ai:review` 通過，產生 216 筆 planned updates。
- 優點：
  - 24 張都有 `people_count`、`orientation`、`has_negative_space`、`safe_crop`、`scene_tags`、`mood_tags`、`recommended_uses`、`public_use_status` 與 `curation_status`。
  - 每張都保守標為 `public_use_status = needs_review`，沒有直接推成 `approved`。
  - `safe_crop` 和 `recommended_uses` 有一定變化，沒有完全落在單一值。
- 主要問題：
  - 有 7 張照片建議 `贊助成果報告`，但沒有 `sponsorship_items` 或 `sponsorship_tags`，需要人工確認贊助脈絡。
  - `public_use_status = needs_review` 出現在 24 張全部照片，資訊量偏低。
  - 沒有提供 `confidence`，格式允許但不利於人工排序與抽查。
  - 抽查時發現 `people_count` 可能偏離實際畫面，例如把約 4 人的互動畫面標成 12 人，或把 3 人畫面標成 1 人。
  - 對 `贊助成果報告` 的判斷偏積極，容易在沒有明確贊助 exposure 或品項線索時推論用途。
- 判斷：
  - 產物完整且可被工具處理，但品質風險較高。
  - 回寫前必須嚴格抽查 `people_count`、`recommended_uses`、`public_use_status` 與贊助相關推論。
  - 這輪也顯示 `ai:review` 可再補強「整批缺少 confidence」的警訊。

### `ai-prepare-2026-05-08T21-08-30-941Z`

- 使用者紀錄模型：Claude Opus 4.7。
- 檔案紀錄 producer: `claude-opus-4-7`。
- 相簿：`72177720331149380`。
- 圖片尺寸：`large-1024`。
- 選入照片：24 張；完整相簿應為 37 張。
- `pnpm ai:review` 通過，產生 202 筆 planned updates。
- 優點：
  - `pnpm ai:review` 未偵測到明顯批次層級警訊。
  - 24 張都有核心欄位，且 `confidence` 大多有填。
  - `safe_crop` 沒有每張都硬填；24 張中有 22 張提出候選值。
  - reason 通常能描述可見畫面，對人數與工作人員互動的判斷相對保守。
  - 沒有出現 `贊助成果報告` 過度推論。
- 主要問題：
  - `recommended_uses` 仍偏集中，`活動回顧` 出現 20 次、`志工招募` 出現 12 次。
  - `public_use_status` 只出現在 12 張；這不一定錯，但需要確認模型是否有穩定判斷邏輯。
  - 由於本輪只涵蓋 24/37 張，不能代表整本相簿的欄位分布。
- 判斷：
  - 三輪中相對保守、可審核性高，適合作為人工抽查與 prompt 比較基準。
  - 若要回寫，仍應先用完整 37 張 run 重跑，不能直接使用這批不完整基底的結果。

### `ai-prepare-2026-05-08T21-09-56-815Z`

- 使用者紀錄模型：GPT 5.5。
- 檔案紀錄 producer: `codex`。
- 相簿：`72177720331149380`。
- 圖片尺寸：`large-1024`。
- 選入照片：24 張；完整相簿應為 37 張。
- `pnpm ai:review` 通過，產生 196 筆 planned updates。
- 優點：
  - 24 張都有核心欄位，且 `priority_level` 只出現在 4 張，沒有把優先級當成每張必填。
  - `recommended_uses` 分布比前兩輪更分散，包含 `活動回顧`、`志工招募`、`簡報`、`社群介紹`、`社群貼文`、`講者宣傳`、`報名宣傳`、`新聞稿`。
  - `people_count` 抽查結果相對接近實際畫面。
  - 沒有出現 `贊助成果報告` 無脈絡推論。
- 主要問題：
  - 沒有提供 `public_use_status` 候選值；若本批沒有明顯 avoid 照片可以接受，但回寫前仍需要人工確認。
  - 有些 `scene_tags` 可能過度解讀，例如把一般背景或旗幟附近畫面標成 `背板`。
  - `confidence = 1` 主要出現在 orientation，尚可接受；但仍要避免未來擴散到人數、情緒或用途判斷。
  - 由於本輪只涵蓋 24/37 張，不能用來判斷完整相簿的模型穩定度。
- 判斷：
  - 在這三個不完整基底測試中，最接近可進入人工抽查與 dry-run 的候選結果。
  - 但資料基底已確認不完整，因此應改用完整 37 張新 run 重新標記，再評估是否回寫。

## 完整相簿基底測試觀察

以下觀察來自相簿 `72177720331149380` 修正 intake 後的完整 37 張測試。三個模型都使用同一個 AI run 工作包：`ai-prepare-2026-05-08T21-48-29-597Z`，圖片尺寸為 `large-1024`，並都通過 `pnpm ai:review`。這輪比前一節的 24/37 張測試更適合作為是否進入 Sheets dry-run 的判斷依據。

### `ai-prepare-2026-05-08T21-48-29-597Z-gemini`

- 檔案紀錄 producer: `Gemini CLI`。
- `pnpm ai:review` 通過，37 張都有 proposal，產生 295 筆 planned updates。
- 批次警訊：
  - 沒有 `public_use_status` 候選值；若本批沒有明顯 avoid 照片可以接受，但回寫前仍需人工確認公開使用狀態。
- 優點：
  - 37 張都有 `people_count`、`orientation`、`has_negative_space`、`scene_tags`、`mood_tags`、`recommended_uses` 與 `curation_status`。
  - 沒有提出贊助相關欄位，避免把 SITCON 自身旗幟或背板誤判成贊助曝光。
  - sample 中 `people_count` 對已知幾張照片大致合理。
- 主要問題：
  - `has_negative_space = true` 出現在 36/37 張，明顯偏樂觀。
  - `safe_crop = 16:9` 出現 30 次，也偏寬鬆。
  - `recommended_uses` 偏向 `活動回顧`、`社群介紹`，但 `社群貼文` 只出現 1 次，和實際社群取圖需求可能不完全對齊。
- 判斷：
  - 適合觀察人數與一般 tag，但不適合直接回寫設計取用欄位。
  - 若採用，應特別抽查 `has_negative_space` 與 `safe_crop`。

### `ai-prepare-2026-05-08T21-48-29-597Z-claude`

- 檔案紀錄 producer: `claude-opus-4-7`。
- `pnpm ai:review` 通過，37 張都有 proposal，產生 298 筆 planned updates。
- 批次警訊：
  - 未偵測到明顯批次層級警訊。
- 優點：
  - `confidence` 大多有填，reason 可審核性較高。
  - `has_negative_space` 與 `safe_crop` 較保守，`safe_crop` 只出現在 12 張。
  - `recommended_uses` 沒有每張都硬填；25 張有用途建議，留下較多人工判斷空間。
  - 已用 `sheets:apply-ai-updates` dry-run，工具層沒有 current value 衝突。
- 主要問題：
  - 有 3 張提出 `sponsorship_tags = 品牌露出`，理由是 SITCON 綠色旗幟或背板清楚出現。這比較像 SITCON 自身品牌露出，不一定是贊助價值，可能混用了 `sponsorship_tags` 的語意。
  - `public_use_status = needs_review` 出現在 36 張，實用但資訊量有限。
  - `recommended_uses = 贊助提案` 出現在少數講者或背板照片，需要人工確認是否真的和贊助提案有關。
- 判斷：
  - 三輪中最適合作為後續人工抽查與 Sheets dry-run 基底。
  - 不建議直接 `--write` 全量回寫；至少應先移除或人工確認 `sponsorship_tags` 與 `贊助提案` 相關候選值。

### `ai-prepare-2026-05-08T21-48-29-597Z-gpt`

- 檔案紀錄 producer: `GPT-5 Codex`。
- `pnpm ai:review` 通過，37 張都有 proposal，產生 347 筆 planned updates。
- 批次警訊：
  - 所有候選值都未提供 `confidence`；格式允許省略，但不利於人工排序與抽查。
- 優點：
  - 37 張都有核心欄位，包含 `public_use_status`、`recommended_uses` 與 `safe_crop`。
  - 沒有提出贊助欄位，避免 sponsorship 語意混用。
  - `people_count` 對部分樣本合理。
- 主要問題：
  - planned updates 最多，欄位覆蓋積極，人工檢查成本較高。
  - `priority_level = high` 出現在 14 張，偏寬鬆，容易變成主觀品質分數。
  - `recommended_uses = 活動回顧` 出現 33 次、`社群貼文` 出現 22 次，區辨度偏低。
  - 沒有 confidence，無法用模型自評輔助人工排序。
- 判斷：
  - 可作為補充參考，但不適合作為第一個回寫基底。
  - 若採用，應先降低 `priority_level` 與通用 `recommended_uses` 的權重，並補上人工抽查。

### 本輪建議

目前不建議直接將任一模型結果全量寫回正式 Sheets。若要往回寫前進，建議以 Claude 版本作為候選基底，先人工處理以下項目：

1. 移除或確認 `sponsorship_tags = 品牌露出` 是否真的指向贊助價值，而不是 SITCON 自身品牌露出。
2. 抽查 `people_count`、`has_negative_space`、`safe_crop` 與 `recommended_uses`。
3. 確認 `public_use_status = needs_review` 是否只是保守預設，或有真正需要提醒的照片。
4. 修改 proposal 後重新跑 `pnpm ai:review`，再執行 Sheets dry-run。

### 本輪套用結果

後續已建立 `ai-prepare-2026-05-08T21-48-29-597Z-claude-curated`，保留原始 Claude 輸出，並只做以下修剪：

- 移除 3 筆 `sponsorship_tags = 品牌露出`。
- 從 2 筆 `recommended_uses` 移除 `贊助提案`。

curated 版重新執行 `pnpm ai:review` 後通過，planned updates 從 298 筆降為 295 筆。`sheets:apply-ai-updates` dry-run 無衝突後，已寫入正式 Google Sheets 並完成讀回驗證。

寫入後重新匯出正式 Sheets，確認相簿 `72177720331149380`：

- 共 37 張照片。
- 37 張 `curation_status = ai_labeled`。
- 37 張有 `people_count`。
- 36 張 `public_use_status = needs_review`。
- `sponsorship_items` 與 `sponsorship_tags` 仍為空白。

這些值仍是 AI 初標候選，不代表人工 `reviewed`。後續人工整理應在 Google Sheets 中修正錯誤、補齊欄位，再由志工決定是否標為 `reviewed` 或 `approved`。

## 大批量 132 張測試觀察

以下觀察來自相簿 `72177720329615498` 的 132 張測試。三個模型都使用同一個 AI run 工作包：`ai-prepare-2026-05-08T22-58-30-741Z`，圖片尺寸為 `large-1024`。這輪的目的不是直接挑選回寫基底，而是檢查模型在較大批次下是否仍會逐張判斷，以及現有 prompt / validator 能否擋住模板化結果。

這輪測試發生時，新的 anti-template validator 與 `visual_description` 欄位尚未完成。2026-05-09 以新版 `pnpm ai:validate -- --run-dir <dir>` 回頭檢查三個結果時，三者都已被擋下。因此以下 `planned updates` 是舊規則下的產物數量，不代表目前工具會接受這些 proposal。

### `ai-prepare-2026-05-08T22-58-30-741Z-gpt`

- 檔案紀錄 producer: `Codex GPT-5`。
- 132 張都有 proposal，產生 1259 筆 planned updates。
- 欄位覆蓋非常積極：132 張都有 `people_count`、`orientation`、`has_negative_space`、`scene_tags`、`mood_tags`、`recommended_uses`、`public_use_status` 與 `curation_status`，131 張有 `safe_crop`。
- 主要問題：
  - reason 大量模板化，例如 orientation 以圖片尺寸固定句式出現，`people_count`、`has_negative_space`、`safe_crop` 也有大量同句重複。
  - 36 張提出 `sponsorship_items = 午餐旗、點心旗`，且 36 張都有 `sponsorship_tags = 品牌露出;參與者體驗;贊助成果佐證`。抽查圖片後，部分只是 SITCON 自身旗幟或一般茶點畫面，不能支持外部贊助品項推論。
  - `recommended_uses = 活動回顧` 出現 93 次，`贊助成果報告` 36 次，`贊助提案` 34 次，贊助用途判斷偏積極且區辨度不足。
  - `public_use_status = needs_review` 出現 131/132 張，接近預設填空。
- 新 validator 回頭檢查已失敗，主要原因是讀圖欄位的 `value + reason` 在多張照片重複，以及使用圖片尺寸等非視覺 reason。實際錯誤包含：`orientation` 同值同 reason 重複 70 張與 54 張、`public_use_status = needs_review` 同 reason 重複 131 張、`sponsorship_items = 午餐旗、點心旗` 同 reason 重複 36 張、`sponsorship_tags` 同 reason 重複 36 張。
- 判斷：
  - 這輪可視為高覆蓋率初稿，但不適合作為 Sheets 回寫基底。
  - 速度與更新量不應直接視為品質優勢；這批結果有批次規則或模板展開的痕跡。

### `ai-prepare-2026-05-08T22-58-30-741Z-claude`

- 檔案紀錄 producer: `claude-opus-4-7`。
- 132 張都有 proposal，產生 991 筆 planned updates。
- 欄位覆蓋比 GPT 保守：132 張都有 `people_count`、`orientation`、`has_negative_space` 與 `curation_status`；128 張有 `public_use_status`；124 張有 `mood_tags`；97 張有 `scene_tags`；78 張有 `recommended_uses`；36 張有 `safe_crop`。
- 優點：
  - 沒有提出 `sponsorship_items` 或 `sponsorship_tags`，避免 GPT 那種把 SITCON 自身識別推成贊助露出的錯誤。
  - `safe_crop` 較保守，只有 36/132 張提出候選值。
  - `recommended_uses` 沒有每張都硬填，人工審核成本低於 GPT。
- 主要問題：
  - orientation reason 幾乎都是「圖片寬大於高」或「圖片高大於寬」，可審核資訊不足。
  - `public_use_status = needs_review` 出現在 128/132 張，仍然接近預設填空；多組 reason 也重複，例如「可辨識個人，需人工確認」。
  - `has_negative_space`、`mood_tags`、`scene_tags`、`recommended_uses` 仍有多張照片共用同一句 reason 的情形。
- 新 validator 回頭檢查已失敗，主要原因是 orientation、public use、negative space 等欄位重複 reason。實際錯誤包含：`orientation = landscape` 搭配「圖片寬大於高」重複 126 張、`orientation = portrait` 搭配「圖片高大於寬」重複 5 張，另有多組 `public_use_status = needs_review` reason 分別重複 48、28、11、5 張。
- 判斷：
  - 三輪中最接近可作為重新標記基底，但仍需要新版 prompt 重新跑，不能直接採用舊 proposal。
  - 若要驗證 `visual_description`，應先用 Claude 單一模型重跑，因為它在 sponsorship 與欄位保守性上比較接近人工審核需求。

### `ai-prepare-2026-05-08T22-58-30-741Z-gemini`

- 檔案紀錄 producer: `gemini-3.1-pro-preview`。
- 132 張都有 proposal，產生 660 筆 planned updates。
- 欄位覆蓋只包含 `people_count`、`orientation`、`has_negative_space`、`scene_tags`、`curation_status`。
- 主要問題：
  - 132 張全部輸出 `people_count = 3`、`orientation = landscape`、`has_negative_space = false`、`scene_tags = 會眾;交流`。
  - reason 使用「推測值」、「照片方向預設為橫向」、「推測場景包含會眾交流」等非視覺、模板化語言。
  - 這不是品質稍差，而是沒有逐張讀圖的失敗輸出。
- 新 validator 回頭檢查已失敗，且錯誤集中在整批同值、同 reason 與模板語言。實際錯誤包含：`people_count = 3`、`orientation = landscape`、`has_negative_space = false`、`scene_tags = 交流;會眾` 的同值同 reason 各重複 132 張，並以「推測值」、「照片方向預設為橫向」觸發非視覺語言檢查。
- 判斷：
  - 這輪應作為 anti-template validator 的負面案例，不應人工修剪後採用。

### 本輪促成的應對

這輪大批量測試直接促成以下調整：

- `prompts/ai-labeling.md` 加入逐張檢視要求，禁止只依 `photo_id`、相簿名稱、前後照片、批次規則或 archetype 批量套用。
- reason 規則收緊：讀圖欄位必須引用本張照片的具體可見證據，不可跨照片重複套用同一句。
- `people_count` 明確定義為畫面中可辨識的所有人，不只主體；大量人數應寫估算依據。
- sponsorship 規則收緊：SITCON 自有 Logo、旗幟、桌旗、背板或活動識別不屬於 `sponsorship_items`，不能只因茶點或 SITCON 旗幟推論贊助成果。
- `public_use_status` 不再鼓勵每張都填；沒有具體公開使用疑慮時應省略。
- `safe_crop` 改成逐比例驗證，不是「能裁就標」。
- `pnpm ai:validate` 新增 hard fail：同一讀圖欄位的 `value + reason` 在 5 張以上重複、reason 使用模板或非視覺語言。
- `pnpm ai:review` 新增批次警訊：`has_negative_space`、`scene_tags`、`needs_review`、confidence 過度集中。

### `visual_description` 設計評估

這輪也顯示 reason 裡確實藏有 taxonomy 不容易涵蓋的長尾資訊，例如具體物件、桌面配置、人物動作、旗幟位置、可見文字與空間關係。這些資訊對「用自然語言找照片」有潛在價值，但不適合直接把 reason 當成搜尋語料，因為 reason 的原始職責是解釋單一欄位判斷，且容易模板化、碎片化或混入推論。

因此後續新增 `visual_description` 作為正式 photo schema 欄位是合理方向：

- 它把「搜尋用自然語言描述」和「欄位審核 reason」分開，避免污染 reason 的審核職責。
- 它可補足 taxonomy 的長尾盲點，讓未來自然語言搜尋或 embedding 搜尋有更好的語料。
- 它不列入 `reviewed_required_fields` 或 `approved_required_fields`，避免變成每張照片的人工審核負擔。
- 它仍可進入 AI proposal / diff / update plan，讓人類在寫入前逐欄審核。

但 `visual_description` 也有新風險：

- 它是公開 metadata，若寫入正式 Sheets，應避免包含未確認身份、年份、單位、贊助推論或敏感特徵。
- 若 prompt 不夠嚴格，模型可能產生「有人在交流」這類空泛描述，對搜尋沒有幫助。
- 若沒有近似重複檢查，它也可能變成另一個批次模板欄位。

目前的應對是合理但仍屬第一階段：schema、prompt、contract、operator guide、validator 與 fixtures 已支援 `visual_description`，並用最小長度、禁用語句、具體視覺線索、完全與近似重複檢查降低品質下界。後續應使用 Claude 重新跑 132 張，再用 `pnpm search:experimental -- --run-dir <dir>` 的工作情境查詢比較 taxonomy-only 與 taxonomy + `visual_description`，確認它是否真的提升找圖效果。

## 目前已知容易失準的欄位

### `safe_crop`

常見問題是過度樂觀，尤其把 `1:1` 套到所有照片。判斷時應確認裁切後主體、臉部、文字與主要物件仍保留。若只是「大概能裁」，不應提出該比例。

### `people_count`

人數是篩選關鍵，但 AI 可能只數主體、忽略背景，也可能把前景局部人物納入或排除。人數可以是估計值，但 reason 應說明「約」與估計依據。

### `recommended_uses`

若 `活動回顧` 或 `社群貼文` 過度集中，取圖時區辨度會下降。模型應優先提出能反映工作情境的用途，例如 `講者宣傳`、`網站 hero`、`志工招募`、`新聞稿`、`贊助成果報告`，但也要避免沒有根據的用途推論。

### `priority_level`

這個欄位容易變成主觀品質分數。AI 不應每張都填；只有照片明顯具有代表性、辨識度或特殊工作價值時才建議。

### `confidence`

`confidence = 1` 應保留給非常明確的機械判斷，例如 orientation。人數、情緒、用途、版型安全性通常需要人工判斷，不應大量給滿分。

### `reason`

reason 是審核脈絡，不是正式 metadata。它應只描述可見畫面或 `photos.json` 已有資訊。若 reason 中出現未確認活動名稱、身份、組別、年份或贊助推論，該欄位應被人工特別檢查。

## 已工具化的檢查

`pnpm ai:review` 目前會輸出以下批次層級警訊：

- 若 `priority_level` 出現在所有照片，提示可能變成預設欄位。
- 若 `safe_crop` 的某個比例出現在 90% 以上照片，提示可能過度套用。
- 若 `has_negative_space` 的同一值出現在 90% 以上照片，提示可能沒有逐張判斷版面留白。
- 若 `scene_tags` 的同一值出現在 90% 以上照片，提示可能過度套用同一場景標籤。
- 若 `recommended_uses` 單一值出現在 90% 以上照片，提示用途區辨度不足。
- 若沒有任何 `public_use_status` 候選值，提示可接受但需視批次內容確認。
- 若 `public_use_status = needs_review` 出現在 90% 以上照片，提示可能被當成預設填空。
- 若所有候選值都沒有 `confidence`，提示不利於人工排序與抽查。
- 若 `confidence = 1` 比例高於 25%，提示 confidence 失去參考價值。
- 若同一個 confidence 值出現在 90% 以上候選欄位，提示信心分數可能沒有逐欄反映不確定性。
- 若 `贊助成果報告` 出現但沒有 `sponsorship_items` 或 `sponsorship_tags`，提示需要人工確認贊助脈絡。
- 若 `people_count = 0` 但 reason 或 scene_tags 提到會眾、講者、合照等人物相關線索，提示可能矛盾。
- `pnpm ai:attempt` 可從同一個 input run 建立不同模型或不同輪次的 attempt，避免手動複製圖片與 prompt。
- `pnpm ai:report` 可產生唯讀 HTML，比較多個 run/attempt 在同一張照片上的 value、reason、confidence 與 validator 狀態。
- `pnpm search:experimental` 可在 proposal 寫回前離線比較 taxonomy-only baseline 與 taxonomy + `visual_description` 的搜尋排序差異，用來驗證描述欄位是否有實際找圖增益。

`pnpm ai:validate` 也會擋下明顯不符合逐張檢視要求的產物：

- 同一個讀圖欄位的 `value` 與 `reason` 組合在 5 張以上不同照片重複出現。
- 讀圖欄位 reason 使用 `推測值`、`預設為`、`照片方向預設`、`圖片尺寸為`、`一般而言` 等模板或非視覺語言。
- `visual_description` 少於 20 個非空白字元、使用不確定或模板語言、缺少具體視覺線索，或和其他照片描述近似重複。

## 後續可工具化的檢查

未來可繼續考慮：

- 檢查 `orientation` 和實際圖片尺寸是否明顯矛盾。
- 檢查 `safe_crop` 是否和 `orientation`、主體位置或圖片尺寸有高風險組合。
- 對 `recommended_uses = 贊助成果報告` 增加更細緻的 sponsor exposure / item 檢查。
- 找出同一相簿內高度重複的講者照片或合照，只提示少數更適合優先審核的照片。
- 用 Claude 重新跑完整 132 張後，保留 `pnpm search:experimental` 的輸出摘要，記錄哪些真實工作查詢因 `visual_description` 讓更合適的照片進入前幾名。

這些檢查應先作為 review warning，不應直接讓 validation 失敗。validation 只負責格式與責任邊界；品質判斷仍應保留給人工與後續工具迭代。
