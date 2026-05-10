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

接著產生本機唯讀報表，方便逐張閱讀或比較多模型/多輪結果：

```bash
pnpm ai:report -- --run tmp/ai-runs/<run-id-or-attempt>
pnpm ai:report -- --runs tmp/ai-runs/<attempt-a> tmp/ai-runs/<attempt-b>
```

報表不取代 `metadata-diff.md`，而是讓人更快看到縮圖、proposal 狀態、欄位覆蓋率與不同 attempt 的差異。若本次重點是 `visual_description`，再用搜尋實驗檢查它是否真的改善工作情境找圖：

```bash
pnpm search:experimental -- --run-dir tmp/ai-runs/<run-id-or-attempt>
```

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

## 2026-05-09 新版 prompt 後的 122 張三模型 attempt

本輪以同一個 base run `ai-prepare-2026-05-09T12-15-05-642Z` 建立三個 attempt：

- `ai-prepare-2026-05-09T12-15-05-642Z-attempt-claude-r1`
- `ai-prepare-2026-05-09T12-15-05-642Z-attempt-gemini-r1`
- `ai-prepare-2026-05-09T12-15-05-642Z-attempt-gpt-r1`

base run 來源為 `2025 SITCON Hour of Code 桃園場` 相簿 `72177720330876634`，選出 122 張 `unreviewed` 照片，圖片尺寸為 `large-1024`。三個 attempt 都使用同一份 `prompts/ai-labeling.md`，並已由 `pnpm ai:review` 重新產生 review summary、diff 與 update plan。

三者都通過目前 validator，代表新版 prompt、`visual_description` 欄位與 anti-template 檢查已擋下前一輪那種整批完全偷懶輸出。這不代表三者都適合直接寫回；本輪更適合拿來觀察模型在「通過格式與責任邊界後」仍存在的品質差異。

比較報表已產生於：

```bash
tmp/ai-reports/ai-report-2026-05-09T18-00-38-219Z/index.html
```

### 彙整數字

| attempt | proposals | planned updates | review warnings | 主要覆蓋欄位 |
| --- | ---: | ---: | ---: | --- |
| Claude | 122 | 1108 | 10 | people_count、orientation、has_negative_space、visual_description、scene_tags、mood_tags、recommended_uses、public_use_status、safe_crop |
| Gemini | 122 | 786 | 1 | people_count、orientation、has_negative_space、safe_crop、visual_description，少量 scene_tags / mood_tags |
| GPT | 122 | 852 | 0 | people_count、orientation、has_negative_space、visual_description、scene_tags、recommended_uses |

### Claude attempt 評估

Claude 這輪最完整，也最接近「可交給人類挑選後寫回」的候選基底：

- 122 張都有 `visual_description`，且描述平均約 92 個非空白字元，內容通常包含服裝、姿勢、物件、可見文字與空間關係。
- 有提供 confidence，分布從 0.5 到 0.95，對人工抽查有幫助。
- 欄位覆蓋最完整，包含 `mood_tags`、`public_use_status`、`safe_crop` 與少量 `priority_level`。
- `safe_crop` 相對保守，只出現在 32/122 張，不像前一輪常見的「能裁就標」。

但 Claude 也暴露出新的保守性問題：

- `public_use_status = needs_review` 出現在 107/122 張，原因主要是這批 Hour of Code 照片包含大量兒童與助教清晰臉部。這個判斷方向合理，但 reason 重複度偏高，例如「兒童臉部清晰可辨，須先確認家長公開授權」重複 22 張、「助教臉部清晰可辨，須先確認公開授權」重複 13 張。
- `recommended_uses` 的 `活動回顧` 出現在 110/122 張，仍有用途區辨度不足問題。
- 部分 `orientation` reason 還是接近模板，例如「圖像寬大於高，講者與白板水平排列」重複 10 張。
- 有 7 張被標 `people_count = 0`，但 reason 或 scene tags 仍出現人物相關線索，需要抽查。

判斷：Claude 是三者中最適合進一步人工抽查與可能寫回的版本，但寫回前應特別修剪 `public_use_status`、`recommended_uses` 與重複 reason。這輪不應直接整包套用。

### Gemini attempt 評估

Gemini 比 2026-05-08 那輪有明顯進步：這次 122 張都有獨特 `visual_description`，不再是整批 `{3 人, landscape, false}` 的退化輸出。它有讀到許多具體物件、服裝、文字與場景，例如 SITCON 旗幟、木質告示牌、馬鈴薯、人造草皮、合照手勢等。

但它仍有嚴重的批次偏誤：

- `orientation = landscape` 搭配 reason「橫向取景。」重複 121 張，雖然多數照片可能確實為 landscape，但 reason 仍不可審核。
- `has_negative_space = true` 出現在 121/122 張，明顯過度樂觀，尤其桌面靜物、多人工作坊與群體合照不應大多被視為可放字。
- `safe_crop` 出現在所有 122 張，且 `1:1` 出現 76 次、`16:9` 出現 53 次，仍像是預設填值，而不是逐比例驗證。
- 完全沒有 confidence，不利於人工排序與抽查。
- 沒有 `public_use_status`。若模型不主動判斷公開使用風險可以接受，但在這批大量兒童臉部清晰的照片中，至少應有部分 `needs_review` 候選。
- 欄位覆蓋較窄，沒有 `recommended_uses`，`scene_tags` 只出現在 43/122 張、`mood_tags` 只出現在 11/122 張。

判斷：Gemini 的 `visual_description` 可作為自然語言搜尋素材參考，但 `has_negative_space`、`safe_crop`、`orientation reason` 不應採用。若要讓 Gemini 進入正式候選，prompt 或 validator 仍需加強「safe_crop / negative_space 過度覆蓋」的批次檢查。

### GPT attempt 評估

GPT 這輪沒有 review warning，代表它避開了目前 validator 可偵測的重複與模板問題。但人工閱讀後可見另一種風險：它把一段短 visual summary 重複灌進多個欄位 reason，語句形式穩定但資訊密度偏低。

優點：

- 122 張都有 `visual_description`，且全部唯一。
- `has_negative_space` 分布比 Gemini 合理，`false` 81 張、`true` 41 張。
- `recommended_uses` 覆蓋 122 張，且沒有像 Claude 那樣幾乎全部塞 `活動回顧`：`活動回顧` 76 張、`社群貼文` 52 張、`簡報` 21 張、`講者宣傳` 16 張。
- `scene_tags` 覆蓋 120/122 張。

主要問題：

- 沒有 confidence。
- 沒有 `public_use_status`，對大量兒童照片的公開使用風險沒有提供候選提醒。
- 沒有 `safe_crop` 與 `mood_tags`，可用欄位比 Claude 少。
- `visual_description` 平均約 31 個非空白字元，比 Claude 和 Gemini 短很多，雖然能過最小長度，但對搜尋長尾細節的幫助有限。
- reason 常把同一段描述套到 `orientation`、`has_negative_space`、`scene_tags`、`recommended_uses`，再接上「構圖主要以左右方向展開」「這些可見元素適合對應到建議用途」等泛用句。這不一定觸發重複檢查，卻降低人工審核價值。
- 有 10 張 `people_count = 0` 但 reason 或 scene tags 提到人物相關線索，需要人工確認。

判斷：GPT 是三者中最「乾淨通過 validator」的一輪，但不是最有審核資訊的一輪。它適合作為較保守的 baseline，尤其可參考 `scene_tags` 與部分 `recommended_uses`；但 `visual_description` 對搜尋的長尾價值不如 Claude。

### 跨模型觀察

1. 新 prompt 與 validator 有效改善下界
   三個模型都不再產生前一輪 Gemini 式的整批通用值；`visual_description` 也都能逐張產出不同內容。這表示「逐張可見證據」與 anti-template 規則有效。

2. 但通過 validator 不等於可寫回
   Gemini 的 `has_negative_space = true` 121/122、safe crop 全覆蓋；GPT 的短描述與 reason 套句；Claude 的 `needs_review` 與 `活動回顧` 過度集中，都沒有直接變成 hard fail。這些應繼續留在 review/report 層判斷，而不是全部塞進 validator。

3. `visual_description` 確實有搜尋價值，但模型差異很大
   Claude 描述最完整，適合搜尋「木質招牌」「馬鈴薯」「藍色椅子」「投影幕文字」「雙馬尾口罩女童」這類 taxonomy 覆蓋不到的長尾細節。Gemini 描述也有物件細節，但常伴隨版型欄位過度樂觀。GPT 描述較短，能支援基本搜尋，但較少保留可區分照片的細節。

4. 兒童照片讓 `public_use_status` 規則變得重要
   Claude 幾乎全部標 `needs_review` 的做法很保守，但這批 Hour of Code 確實大量包含兒童清晰面部。GPT / Gemini 完全不填 `public_use_status` 會讓後續寫回少一層風險提醒。提示可以進一步要求：若清晰可辨兒童臉部是畫面主體，應提出 `needs_review`，但 reason 仍需逐張說明具體畫面而不是套一句。

5. `has_negative_space` 與 `safe_crop` 仍是最不穩定欄位
   Gemini 幾乎把 `has_negative_space` 與 `safe_crop` 當預設欄位；Claude 較保守；GPT 中等但缺少 safe crop。這兩個欄位仍應人工抽查，且不宜只因模型通過 validator 就回寫。

### 本輪採用建議

- 不建議直接整包寫回任何一個 attempt。
- 若要挑一個作為人工修剪基底，優先選 Claude，因為它的 `visual_description`、confidence、mood、public-use 風險與 safe crop 資訊最完整。
- 若目標是快速補基本搜尋欄位，可以參考 GPT 的 `scene_tags` 與 `recommended_uses`，但需接受描述較短與缺少 confidence 的限制。
- Gemini 的 `visual_description` 可以用來比較自然語言搜尋效果，但不應採用它的 `has_negative_space`、`safe_crop` 與 orientation reason。
- 下一步應使用 `pnpm ai:report -- --runs ...` 的比較報表，人工抽查 10 到 20 張代表照片，特別看：兒童公開風險、人數估算、negative space、safe crop、以及 `visual_description` 是否真的讓搜尋更容易。

## 2026-05-09 GPT 5.5 / Codex CLI 1077 張多 worker run

本輪 run 為：

```bash
tmp/ai-runs/ai-prepare-2026-05-09T20-00-35-981Z
```

來源是 SITCON 2026 相簿 `72177720333438501`，從 `tmp/sheets-export/photos.csv` 選出 `status=all` 的 1077 張照片，圖片尺寸為 `large-1024`。操作者回報本輪使用 GPT 5.5，在 Codex CLI 中啟用 6 個 worker，將照片分成 44 份處理，總耗時約 45 分鐘。以牆鐘時間估算，這大約是每張照片 2.5 秒，代表多 worker 分工對大批量初標有實際效率價值。

本輪已重新執行：

```bash
pnpm ai:review -- --run-dir tmp/ai-runs/ai-prepare-2026-05-09T20-00-35-981Z
pnpm ai:report -- --run tmp/ai-runs/ai-prepare-2026-05-09T20-00-35-981Z
```

單次報表產生於：

```bash
tmp/ai-reports/ai-report-2026-05-10T06-57-13-628Z/index.html
```

### 彙整數字

| 指標 | 數值 |
| --- | ---: |
| proposal items | 1077 |
| planned updates | 9551 |
| review warnings | 21 |
| `visual_description` | 1077 |
| `scene_tags` | 1062 |
| `mood_tags` | 1050 |
| `safe_crop` | 711 |
| `public_use_status` | 236 |
| `sponsorship_tags` | 22 |
| `sponsorship_items` | 8 |

`people_count`、`orientation`、`has_negative_space`、`recommended_uses`、`visual_description`、`curation_status` 都覆蓋 1077 張。`visual_description` 1077 筆全部唯一，平均約 48 個字，長度中位數約 40 字。這比 122 張 GPT attempt 的 31 字更有搜尋價值，但仍遠短於 Claude attempt 的 92 字。

confidence 只出現在 209 個欄位，且分布在 0.62 到 0.96 之間。這表示部分 worker 或部分欄位有提供把握度，但整體不一致；若要把 confidence 當人工排序依據，仍需要要求所有欄位或至少高風險欄位穩定產出。

### 優點

這輪最重要的成果是證明「大批量、多 worker、同一份輸入」可以產生結構完整的候選資料。1077 張照片都有核心欄位，沒有出現前一輪 Gemini 式整批退化成同一組值的狀況，也沒有產生合併失敗或 schema 崩壞。

`visual_description` 的品質已足以支援基本自然語言搜尋。它不像舊 reason 那樣只解釋欄位，而是能保留人物姿勢、場地、紙箱、講桌、相機、投影幕、攤位、桌面物件等 taxonomy 不會完整覆蓋的細節。這支持先前把 `visual_description` 納入主 schema 的方向：它不是多餘欄位，而是搜尋體驗需要的長尾語料。

`has_negative_space` 分布為 `false` 684、`true` 393，比 Gemini 那種幾乎全標 `true` 的結果合理。`safe_crop` 只出現在 711/1077 張，也比「所有照片都能裁」保守。贊助相關欄位也沒有大規模亂填，`sponsorship_items` 只有 8 張、`sponsorship_tags` 22 張，表示新版 sponsorship 邊界至少抑制了舊 GPT 把 SITCON 自有旗幟誤當贊助品項的問題。

### 主要風險

多 worker 分工帶來明顯的一致性問題。review summary 中可見英文 reason 混入，例如 `The speaker's face is visible.`、`Several attendee faces are visible.`、`One presenter is visible at the podium.`。這不是單張判斷錯誤，但對中文資料庫、人工審核與未來公開 metadata 都是品質問題。下一輪 prompt 或 validator 應明確要求 reason 與 `visual_description` 使用繁體中文，並在 post-review 階段標示非中文 reason。

reason 仍有局部模板化。`curation_status = ai_labeled` 的同一句 reason 重複 100 次；`people_count = 1` 在講者照片中有多組重複 reason，例如「講桌後只有一名拿麥克風的講者」18 張、「講桌後只有一名講者」17 張；`safe_crop = ["1:1"]` 也有講者上半身與麥克風的重複句。這些不一定代表值錯，但代表 worker 在大量相似講者照片中開始用批次語言，人工審核價值下降。

`recommended_uses` 仍偏向低區辨度。`活動回顧` 出現在 958/1077 張，雖然大型相簿本來就多數可回顧，但這會讓欄位對搜尋排序的幫助變弱。更大的問題是 `贊助成果報告` 出現 117 張，其中 95 張沒有 `sponsorship_items` 或 `sponsorship_tags`。這表示模型可能把攤位、看板、桌面展示或群眾互動泛化成「適合贊助成果」，但沒有足夠贊助證據。這類欄位不應直接寫回，必須由人類確認贊助脈絡。

`people_count` 仍需要抽查。review summary 指出 48 張 `people_count = 0` 的照片，其 scene tags 或 reason 仍提到人物相關線索。這可能包含海報、空景、螢幕畫面、局部肢體或被遮擋人物，但也可能是漏數。大批量 run 若要寫回人數欄位，應先抽查這批矛盾清單。

`public_use_status` 比 Claude 保守性低，只有 234 張 `needs_review`、2 張 `avoid`。這比「幾乎全部 needs_review」有資訊量，但也可能漏掉清楚人臉、兒童、姓名或聯絡資訊等風險。此欄位應被視為「有標就優先注意」，不應被視為「沒標就安全」。

### 本輪採用建議

這輪不建議整包直接寫回 Google Sheets。它比較適合作為 SITCON 2026 全相簿的第一層候選索引，讓人類透過報表快速篩選，再分欄位或分批套用。

可優先考慮採用或抽查的欄位是 `visual_description`、`scene_tags`、部分 `mood_tags`、部分 `people_count`。`visual_description` 的唯一性與具體度已能服務專案目標，尤其能補上 taxonomy 找不到的長尾線索；`scene_tags` 覆蓋率高，可作為搜尋與篩選基礎。

`mood_tags` 有助於情緒與宣傳語感找圖，但本輪 1050/1077 張都有 mood 候選值，`專業` 488 次、`專注` 415 次，顯示模型可能把它當成半必填分類。它應作為輔助線索，而不是高信任精準篩選條件；採用前應特別抽查 `專業`、`專注`、`友善` 這類泛用值是否真的有明確視覺證據。

需要更嚴格人工守門的欄位是 `recommended_uses`、`safe_crop`、`public_use_status`、贊助相關欄位。`recommended_uses` 要特別壓低 `活動回顧` 與無贊助證據的 `贊助成果報告`；`safe_crop` 要抽查相似講者照片是否真的不裁臉、不裁字、不裁主要物件；`public_use_status` 要避免把未標記誤讀為安全。

下一輪多 worker 流程應增加幾個 QA 檢查：

- 檢查 reason 與 `visual_description` 是否為繁體中文。
- 檢查 `mood_tags` 是否幾乎每張都有，或 `專業`、`專注`、`友善` 是否過度集中。
- 針對每個 worker 或 chunk 產生欄位分布統計，避免某個 worker 特別愛填或漏填某欄。
- 對 `recommended_uses = 贊助成果報告` 但沒有贊助欄位的照片維持 warning，並在報表中更醒目呈現。
- 對 `people_count = 0` 但描述、reason、scene tags 提到人物線索的照片維持人工確認清單。
- 將 confidence 的產出規則收斂成一致要求，否則不要把 confidence 當主要審核排序訊號。

整體判斷：這輪代表流程已經能支撐千張級照片的 AI 初標，但尚未達到無人工挑選即可寫回的程度。它最有價值的不是「一次完成資料庫」，而是證明 `visual_description` 加上報表與 warning 可以把 1077 張照片壓縮成可審核的候選集。

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

`pnpm ai:validate` 會擋下格式、責任邊界與明顯不可審核的單欄位內容，例如：

- `visual_description` 少於 20 個非空白字元、使用不確定或模板語言，或缺少具體視覺線索。

它也會輸出人工 review warning，提示可能不符合逐張檢視要求的批次品質問題：

- 同一個讀圖欄位的 `value` 與 `reason` 組合在 5 張以上不同照片重複出現。
- 讀圖欄位 reason 使用 `推測值`、`預設為`、`照片方向預設`、`圖片尺寸為`、`一般而言` 等模板或非視覺語言。
- `visual_description` 和其他照片描述近似重複。

## 後續可工具化的檢查

未來可繼續考慮：

- 檢查 `orientation` 和實際圖片尺寸是否明顯矛盾。
- 檢查 `safe_crop` 是否和 `orientation`、主體位置或圖片尺寸有高風險組合。
- 對 `recommended_uses = 贊助成果報告` 增加更細緻的 sponsor exposure / item 檢查。
- 找出同一相簿內高度重複的講者照片或合照，只提示少數更適合優先審核的照片。
- 用 Claude 重新跑完整 132 張後，保留 `pnpm search:experimental` 的輸出摘要，記錄哪些真實工作查詢因 `visual_description` 讓更合適的照片進入前幾名。

批次品質檢查應先作為 review warning，不應直接讓 validation 失敗。validation 只負責格式與責任邊界；品質判斷仍應保留給人工與後續工具迭代。
