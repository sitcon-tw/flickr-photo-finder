# AI 初標評估紀錄

這份文件記錄 AI 初標結果的評估方式與目前幾次測試觀察。它的目的不是替模型排名，而是讓未來調整 prompt、schema、taxonomy 或工具警訊時，有可追溯的判斷基準。

本文件中的單次 run 觀察只代表當時的 prompt、資料、圖片尺寸、操作方式與模型 session。未來不應把這些結論當成某個模型的永久能力評價；若 prompt、taxonomy、圖片尺寸或模型版本改變，應重新評估。最新操作流程請以 `docs/ai-labeling-operator-guide.md` 與 `docs/ai-labeling-contract.md` 為準，本文件只作為歷史品質觀察與調校線索。

新的 AI run/attempt 會在 `manifest.json` 記錄 `prompt_template_sha256`。比較多模型或多輪結果時，應先確認 prompt hash 一致；若缺少紀錄或與目前 repo prompt 不同，該結果只能作為歷史觀察或調校線索，不應直接當作公平模型比較。

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

照片量大時，不預期所有 AI proposal 都會被人工 review 完畢，因此評估指標必須說清楚母體。`coverage` 可以看整批 proposal；`sample quality` 應來自隨機樣本、failure-focused sample、`Review Focus` 或 `Balanced Review Sample`；`adoption outcome` 只能用已被人類套用、修改、拒絕或推進到 `reviewed` 的 subset 計算。缺少 outcome 不代表該 proposal 錯誤或被拒絕，也不應把 subset acceptance rate 外推成整批品質。

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
pnpm eval:search -- --run-dir tmp/ai-runs/<run-id-or-attempt>
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
  - `recommended_uses` 比前一輪更有變化，包含 `講者宣傳`、`簡報`、`新聞稿`、`志工招募`、`網站橫幅`、`贊助成果報告`。
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
- 它不列入 `reviewed_required_fields`，避免變成每張照片的人工審核負擔。
- 它仍可進入 AI proposal / diff / update plan，讓人類在寫入前逐欄審核。

但 `visual_description` 也有新風險：

- 它是公開 metadata，若寫入正式 Sheets，應避免包含未確認身份、年份、單位、贊助推論或敏感特徵。
- 若 prompt 不夠嚴格，模型可能產生「有人在交流」這類空泛描述，對搜尋沒有幫助。
- 若沒有近似重複檢查，它也可能變成另一個批次模板欄位。

目前的應對是合理但仍屬第一階段：schema、prompt、contract、operator guide、validator 與 fixtures 已支援 `visual_description`，並用最小長度、禁用語句、具體視覺線索、完全與近似重複檢查降低品質下界。後續應使用 Claude 重新跑 132 張，再用 `pnpm eval:search -- --run-dir <dir>` 的工作情境查詢比較 taxonomy-only 與 taxonomy + `visual_description`，確認它是否真的提升找圖效果。

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

## 2026-05-10 跨活動 43 張三模型評估

本輪使用 `pnpm eval:sample` 建立跨活動測試工作包：

```bash
tmp/ai-runs/ai-cross-activity-sample-2026-05-10
```

樣本共 43 張，來自 12 種活動或場景類型，混合已評估和未評估相簿：

- 已評估基準：SITCON 2026、SITCON 2026 負一籌＋BoF、2025 SITCON Hour of Code 桃園場、教育部青發署第三屆青志獎。
- 未評估類型：SITCON 學生戰鬥機 Podcast、SITCON Camp 2025 Day 1、SITCON Hackathon 2024、SITCON 2025 合作攤位、SITCON 2025 紀念品&衣服、SITCON 2025 咖啡廳、SITCON 2025 導遊團、SITCON 2022 教育廣播電台錄音。

本輪目的不是挑選回寫基底，而是檢查 `subject_type`、新擴充後的 `scene_tags`、`mood_tags`、`recommended_uses`、`visual_description` 與 prompt 是否能跨活動成立。

三個 attempt 為：

```bash
tmp/ai-runs/ai-cross-activity-sample-2026-05-10-attempt-claude-r1-cross-activity
tmp/ai-runs/ai-cross-activity-sample-2026-05-10-attempt-gemini-r1-cross-activity
tmp/ai-runs/ai-cross-activity-sample-2026-05-10-attempt-gpt-r1-cross-activity
```

比較報表：

```bash
tmp/ai-reports/ai-report-2026-05-10T10-49-54-786Z/index.html
```

操作者紀錄：

- Claude attempt 使用 Claude Opus 4.7。
- Gemini attempt 使用 Gemini 3.1 Pro Preview，耗時最久，過程中曾發生 repetition loop，重複輸出 `.0000000000002.0000000000002.0000000000002.`。
- GPT attempt 使用 GPT 5.5，耗時約 5 分 30 秒。

注意：Gemini 的 `metadata-proposals.json` producer 寫成 `gemini-2.5-pro`，但操作者紀錄為 Gemini 3.1 Pro Preview；後續比較應以操作者紀錄為準，並把 producer 欄位視為本次執行時人工或模型填寫不一致的 metadata 問題。

### 彙整數字

| attempt | proposals | planned updates | review warnings | confidence fields | visual_description 平均字數 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude Opus 4.7 | 43 | 389 | 1 | 346 | 132 |
| Gemini 3.1 Pro Preview | 43 | 404 | 3 | 0 | 46 |
| GPT 5.5 | 43 | 374 | 2 | 0 | 40 |

三者都通過 validator，43 張都有 `people_count`、`subject_type`、`orientation`、`has_negative_space`、`visual_description` 與 `curation_status`。這表示目前 schema 與 prompt 至少能讓三個模型在跨活動樣本上產出完整基礎欄位。

### Claude Opus 4.7

Claude 這輪最有審核資訊量：

- `visual_description` 平均約 132 字，明顯比 Gemini 與 GPT 更能保存長尾細節，例如攤位文字、指標、道具、人物姿勢與空間關係。
- 346 個欄位有 confidence，對人工抽查排序有幫助。
- `recommended_uses` 只出現在 15 張，沒有把用途欄位當成每張必填；這有助於降低低區辨度填值。
- `subject_type` 覆蓋完整，並且出現 people、object、text_signage、food、screen，對本輪跨活動抽樣的主體初篩足夠。

主要問題：

- `safe_crop` 出現在 41/43 張，其中 `16:9` 出現 37 次，仍可能偏樂觀。
- 有 5 張 `people_count = 0` 但 scene tags 或 reason 提到人物相關線索，需要人工確認。
- `sponsorship_tags` 有 5 張、`sponsorship_items` 有 4 張，應抽查是否真的有贊助脈絡，而不是把合作單位、主辦單位或一般品牌畫面都當成贊助成果。

判斷：Claude 是本輪最適合做 prompt / schema 評估基準的輸出，尤其適合觀察 `visual_description` 是否能支援自然語言找圖。不建議直接全量寫回，但值得優先人工抽查。

### Gemini 3.1 Pro Preview

Gemini 這輪比早期整批退化輸出好很多，43 張都有完整基礎欄位，`scene_tags` 40 張、`mood_tags` 33 張、`recommended_uses` 21 張，代表它有嘗試逐張讀圖。

主要問題：

- orientation reason 明顯模板化：40 張重複「照片長寬比例為橫式。」。
- 所有候選值都沒有 confidence。
- `visual_description` 平均約 46 字，能提供基本搜尋線索，但細節密度低於 Claude。
- 有 8 張 `people_count = 0` 但 scene tags 或 reason 提到人物相關線索。
- 操作過程中發生 repetition loop，這是執行穩定性風險，不只是輸出品質問題。

判斷：Gemini 的輸出可用來觀察 taxonomy 覆蓋與基本欄位，但本輪不適合作為回寫基底。repetition loop 應被視為大型批次或長任務風險，後續若使用 Gemini，應偏向更小 chunk 或更嚴格中途檢查。

### GPT 5.5

GPT 這輪速度最快，約 5 分 30 秒完成 43 張。它通過 validator，planned updates 最少，欄位覆蓋比 Claude / Gemini 保守。

優點：

- `recommended_uses` 23 張，比 Claude 積極，但沒有像大型 run 那樣把 `活動回顧` 塞到幾乎每張。
- `has_negative_space = false` 33 張、`true` 10 張，比 Gemini / Claude 更保守。
- `priority_level` 只出現 1 張，沒有把它當成品質分數預設填值。
- 贊助相關欄位只出現少量，沒有大規模亂填。

主要問題：

- 所有候選值都沒有 confidence。
- `visual_description` 平均約 40 字，偏短，對長尾搜尋的幫助有限。
- `mood_tags` 只出現在 6 張，若社群宣傳需要情緒找圖，這輪訊號不足。
- 有 7 張 `people_count = 0` 但 scene tags 或 reason 提到人物相關線索。
- 抽樣第一張攤位合照中，GPT 將 `people_count` 標為 3，但 Claude / Gemini 皆標為 4，顯示仍需抽查人數。

判斷：GPT 適合作為快速 baseline，尤其適合看保守欄位覆蓋與流程速度；但若目標是提升自然語言搜尋與情緒找圖，這輪輸出不如 Claude。

### 搜尋實驗觀察

三個 attempt 都執行了：

```bash
pnpm eval:search -- --run-dir <attempt-dir> --top 5
```

初步觀察：

- Claude 的 `visual_description` 對「有留白可放字的網站橫幅照片」和「適合社群貼文的青春感合照」有明顯補充效果，能讓 taxonomy-only 找不到或排序較後的照片進入 combined top results。
- Gemini 的 `visual_description` 也能讓部分照片進入搜尋結果，例如志工招募、網站橫幅、講者宣傳查詢，但描述偏短，排序提升多半只是補基本線索。
- GPT 的 description lift 最少，這和它的 `visual_description` 較短一致。
- 在部分查詢中，structured taxonomy 欄位本身權重過強，`visual_description` 只能微調排序，無法修正 `recommended_uses` 或 `has_negative_space` 一旦填錯造成的錯誤高分。

這支持兩個方向：

1. `visual_description` 應保留，且品質差異會直接影響自然語言搜尋效果。
2. 搜尋實驗不能只看 description lift；也要檢查 structured 欄位是否因錯誤或過度泛用而主導排序。

### 本輪欄位設計判斷

`subject_type` 在跨活動樣本中是有價值的。people 仍是最多，但 object、food、text_signage、screen、space 都有出現需求，特別是在紀念品、咖啡廳、導遊團、廣播錄音與舞台畫面中能幫助初篩。

`scene_tags` 目前比前一版更能涵蓋跨活動場景。新加入的 `指標`、`場地`、`螢幕`、`頒獎`、`兒童` 都有用武之地。後續兩個大型 run 顯示 `scene_tags` 召回率會直接影響找圖機會，因此本輪再加入 `場佈`、`錄音`、`導覽`，並用嚴格負例與 album/shard-level QA 控制誤標。

`mood_tags` 仍是低信任輔助欄位。Claude / Gemini 覆蓋較高，GPT 很低，表示 prompt 對 mood 的要求仍不穩。它適合搜尋語感，不適合作為精準篩選條件。

GPT 5.5 這輪 `mood_tags` 只出現在 6/43 張，顯示模型可能把「低信心省略」與「不要把 mood 當預設分類」理解成接近客觀事實欄位才可輸出。後續 prompt 已調整為：`mood_tags` 不是品質分數，也不是每張必填；但只要照片有可見的表情、互動、人群密度、舞台正式感、青春氛圍、手作專注或幕後準備狀態，足以支撐宣傳感受，就應提出 1 到 2 個候選值，並以 reason 說明可見依據。`ai:review` 也補上低 mood 覆蓋率提醒，協助操作者發現過度保守的模型輸出。

GPT 5.5 使用調整後 prompt 重新執行 r2 後，`mood_tags` 從 r1 的 6/43 提升到 38/43，planned updates 從 374 提升到 418。這表示 mood prompt 校準有效，模型不再把情緒感受視為幾乎不可輸出的欄位；同時也沒有出現 value + reason 重複群組，逐張 reason 仍可被人工審核。r2 的 mood 分布以 `專注` 14、`專業` 7、`交流感` 6、`幕後感` 5、`儀式感` 5 為主，尚未觸發泛用 mood 集中警訊。

r2 仍不應直接作為全量回寫基底。`safe_crop = 16:9` 出現在 40/43 張，已觸發過度套用警訊；`recommended_uses = 活動回顧` 也從 r1 的 8 張升到 21 張，顯示用途欄位可能變成泛用補值。這輪比較顯示：降低 mood 保守性是正確方向，但不能讓模型連帶提高所有主觀欄位覆蓋率。後續 prompt 已補強 `recommended_uses` 和 `safe_crop` 守門：`活動回顧` 不是「這是活動照片」的同義詞；橫式照片也不代表一定能安全裁成 `16:9`。`ai:review` 也把 `活動回顧` 的集中提醒門檻從 60% 收緊到 45%，讓 r2 這類接近半數照片都使用通用用途的情況會被提醒。

GPT 5.5 使用再調整後 prompt 與 validator / report 規則重新執行 r3：

```bash
tmp/ai-runs/ai-cross-activity-sample-2026-05-10-attempt-gpt-r3-cross-activity
```

本輪和 r1 / r2 的比較報表：

```bash
tmp/ai-reports/ai-report-2026-05-10T15-16-22-887Z/index.html
```

r3 產生 43 筆 proposal、410 個 planned updates，已通過 `pnpm ai:validate`。review summary 只有兩個 notes：run 沒有記錄 `prompt_template_sha256`，以及所有候選值都沒有 confidence。這點需要小心解讀：attempt 檔案顯示 `prompt_source = prompts/ai-labeling.md`、`round = 3`，但 manifest 沒有 prompt hash，因此「使用新版 prompt」是依操作者流程與 attempt metadata 推定，不能像後續有 hash 的 run 一樣做機器可追溯比對。這也說明 prompt hash 相關變更是必要的；未來比較 prompt 成效時，應使用有 `prompt_template_sha256` 的 run。

r3 和 r2 相比有明顯改善：

| 指標 | GPT r1 | GPT r2 | GPT r3 |
| --- | ---: | ---: | ---: |
| planned updates | 374 | 418 | 410 |
| `scene_tags` 覆蓋 | 36/43 | 40/43 | 43/43 |
| `mood_tags` 覆蓋 | 6/43 | 38/43 | 31/43 |
| `recommended_uses` 覆蓋 | 23/43 | 30/43 | 31/43 |
| `safe_crop` 覆蓋 | 42/43 | 43/43 | 43/43 |
| `safe_crop = 16:9` | 34 | 40 | 18 |
| `safe_crop = 1:1` | 13 | 15 | 27 |
| `recommended_uses = 活動回顧` | 8 | 21 | 4 |
| `visual_description` 平均字數 | 40 | 44 | 56 |
| confidence 欄位數 | 0 | 0 | 0 |

這輪最重要的差異是主觀欄位的方向被拉回來。r2 修正了 mood 過度保守，但同時讓 `活動回顧` 和 `16:9` safe crop 過度膨脹；r3 則把 `活動回顧` 從 21/43 降到 4/43，`16:9` 從 40/43 降到 18/43，同時保留 31/43 的 mood 覆蓋。這表示後續 prompt 裡對 `recommended_uses`、`活動回顧` 與 `safe_crop` 的守門是有效的，沒有把模型打回 r1 那種 mood 幾乎不輸出的狀態。

`recommended_uses` 的分布也更符合工作情境：r3 以 `社群貼文` 10、`簡報` 8、`志工招募` 7、`社群介紹` 7 為主，`活動回顧` 只剩 4，沒有出現 r2 那種把回顧當成通用補值的狀況。這比 r1 更有用，因為 r1 雖然保守，但缺少 `志工招募` 等實際工作用途；r3 在用途區辨度和覆蓋率之間比較平衡。

`mood_tags` 的 r3 分布比 r2 更像「有宣傳感受才標」：`專注` 13、`交流感` 11、`專業` 6、`青春感` 5、`友善` 4、`幕後感` 4。它沒有回到 r1 的 6/43 過度保守，也沒有全部照片都有 mood。這支持目前 prompt 對 mood 的描述：它不是客觀物件欄位，但也不該因為主觀就省略。

`visual_description` 從 r1 的平均約 40 字、r2 的 44 字提升到 r3 的 56 字。樣本 reason 顯示它開始保留更多可搜尋細節，例如 OpenCulture Foundation 攤位文字、QR code、直立說明背板、紙箱、紙張、走廊與玻璃門。這對 `visual_description` 作為自然語言搜尋欄位是正向訊號，雖然仍不如 Claude 的長描述有資訊密度。

但 r3 仍有兩個重要限制。第一，`safe_crop` 仍然 43/43 全覆蓋，只是最常見比例從 `16:9` 轉向 `1:1`。這可能表示「不要濫用 16:9」有效，但模型仍傾向至少找一個可裁比例。下一步應抽查 r3 的 `1:1` 是否真的沒有裁到人臉、文字、攤位背板或桌面重點物件；若不是，就需要把 safe crop 的守門從「不要只因橫式填 16:9」再推進到「沒有明確安全裁切就整欄省略」。

第二，r3 仍沒有 confidence。這不是 validator hard fail，但它讓人工審核排序少一個訊號。若未來要比較模型輸出可審核性，confidence 是否穩定提供應列入品質指標，而不是只看 planned updates 或 warning 數。

整體判斷：r3 是目前 GPT 5.5 跨活動三輪中最平衡的一版。它修掉 r1 的 mood 過度保守，也修掉 r2 的 `活動回顧` 與 `16:9` 過度泛用；`visual_description` 也更有搜尋價值。仍不建議直接全量寫回，主要卡在 safe crop 全覆蓋與缺 confidence，但它可以作為後續 GPT prompt 校準的較佳基準。

`recommended_uses` 仍需要守門。Gemini 對 `贊助提案` 和 `贊助成果報告` 較積極；Claude 較保守；GPT 中間偏保守。這個欄位仍不應由模型直接全量採用。

`safe_crop` 仍是高風險欄位。三個模型都大量提出 `16:9`，但是否真的安全需要看主體、文字和人臉位置，不應只因橫式就填。

## 大型平行批次觀察（2026-05-11）

以下兩次 run 是目前最接近正式大量生產的 AI 初標經驗。操作者紀錄使用模型為 GPT 5.5 xhigh，且都以平行 shard 方式在一小時內完成。這個結果很重要：大型相簿標記的瓶頸不只是模型判讀，也包括圖片下載、工作包建立、shard 分配、merge、review artifact 產生與回寫前檢查；只要工作包和中間產物邊界清楚，數千張照片的初標可以被拆成可管理的平行任務。

| run | proposals | planned updates | producer | prompt hash | shard / source 觀察 |
| --- | ---: | ---: | --- | --- | --- |
| `ai-prepare-bulk-key-albums-2026-05-11` | 3226 | 24783 | `ai / codex-parallel-shard-workers` | `71bffee49068` | 由 10 個既有 run 合併，圖片以 symlink 共用；review 時偵測到 24 個 shard inputs、11 個 run 內 proposal shards，以及 `/tmp/ai-labeling-shards` 的 legacy shard outputs。 |
| `ai-prepare-bulk-selected-unimported-2026-05-11` | 4324 | 36054 | `ai / sharded-ai-agents` | `4405fb95243a` | 標準 `/tmp/ai-labeling-shards/<run-id>/` workspace 有 33 個 input shards 與 33 個 proposal shards；同時仍偵測到 legacy root outputs，只能當診斷資料。 |

兩個 run 合計處理 7550 張照片、60837 筆 planned updates。這個規模已經不是「測試模型能不能輸出 JSON」，而是驗證整條操作鏈能否承受大量資料：準備、分片、平行執行、合併、驗證、產生 review summary、產生 update plan，再交給人類決定是否 dry-run / write。

### 品質觀察

兩個 run 的 baseline 欄位覆蓋都達到 100%，包含 `people_count`、`subject_type`、`orientation`、`has_negative_space`、`visual_description` 與 `curation_status`。這表示 GPT 5.5 xhigh 在大型平行批次中可以穩定產出基礎欄位，不會因照片量放大而直接崩潰或缺漏核心 schema。

`scene_tags` 是這兩輪最重要的品質訊號：

- `ai-prepare-bulk-key-albums-2026-05-11` 的 `scene_tags` 覆蓋率為 2167/3226（67%），低於 75%。其中多個 shard 的 scene 覆蓋率為 0%，也有 `SITCON Camp 2025 Day 2`、`SITCON Camp 2025 Day 3` 等相簿低於 50%。這顯示大型平行批次不能只看整體 validator 通過，還要看 shard / album 層級是否有整段漏標。
- `ai-prepare-bulk-selected-unimported-2026-05-11` 的 `scene_tags` 覆蓋率為 3590/4324（83%），整體較好，但仍有 `SITCON Hackathon 2024`、`SITCON Camp 2025 工人相見歡`、`SITCON 2024 負一籌`、`2015 SITCON Hackgen` 等相簿需要抽查；也有部分 shard scene 覆蓋率為 0%。這表示整體覆蓋率合格不代表每個相簿或分片都可靠。

兩個 run 都沒有提供 `confidence`，這會讓人工排序與抽查少一個訊號。未來若同樣使用 GPT 5.5 xhigh 執行大量初標，confidence 應被視為 prompt / output contract 的可審核性問題，而不是單純的可選欄位。

`people_count = 0` 但 reason 或 scene 線索提到人物的情況仍存在。這些不一定都是錯誤，例如手部特寫或模糊背景人群是否應計入人數本來就有邊界；但它們是很好的 review focus，因為人數會直接影響搜尋與篩選。

### 操作與架構觀察

這兩輪證明「不複製大量圖片」是正確方向。`ai-prepare-bulk-key-albums-2026-05-11` 使用 symlink 共用圖片，讓大型成果可以合併成新工作包而不放大磁碟成本。未來大型 run 應持續優先使用 symlink / hardlink / manifest 指向既有圖片，只有環境不支援連結時才允許 `--copy-images`。

分片工作區應有明確生命週期。標準做法應是 `/tmp/ai-labeling-shards/<run-id>/inputs`、`worker-prompts`、`outputs`，merge 前先在 `/tmp` 產生暫存 proposal，review 通過後才 `--write-run`。legacy root outputs 會造成判讀混亂；review summary 應持續把它們列為 artifact provenance / warning，而不是默默採用。

`metadata-proposals.json` 的權威位置必須保持單一。正式結果以 run root 的 `metadata-proposals.json` 為準；shard outputs、legacy outputs、暫存 merged proposal 都只能作為診斷或 review-before-write 來源。這個邊界可以避免 agent 在後續步驟偷用本機舊資料，或把未確認中間檔覆蓋成正式成果。

大型 run 的 review artifact 不應預設寫回正式 run。先用 `pnpm ai:review -- --run-dir <run> --output-dir /tmp/ai-review-runs/<run-id>` 檢查 summary / diff / update plan，確認品質與來源後再決定是否採用。這讓操作者能檢查 GPT 5.5 xhigh 的大量輸出，而不污染正式工作包。

### 互動回顧與專案精進方向

這次互動顯示，專案可以再把幾個人為協調點工具化：

- 大型相簿選擇前，需要更完整的候選清單、照片數估算與「尚未匯入 Sheets / 尚未標記 / 尚未回寫」狀態篩選。操作者不應靠聊天中人工計算相簿編號與張數。
- 下載與初標都是可平行化階段。工具應把「下載圖片」、「建立工作包」、「shard prepare」、「AI 初標」、「merge」、「review」拆成明確階段，並在每階段顯示進度與可重跑命令。
- 高頻命令應被包成 repo workflow，減少操作者反覆貼長指令與授權確認。特別是 `ai:shard:merge --write-run`、`ai:review --output-dir /tmp/...`、`sheets:apply-ai-updates` 這類高風險但常用步驟，應提供清楚 dry-run、write、resume 介面。
- AI output contract、schema、sidebar 必填規則與 Sheets reviewed gate 必須共用來源。`scene_tags` 可以是 AI 高召回候選，但正式 `reviewed` 仍要由人確認；工具應用 layer coverage / Scene QA 提醒低覆蓋，而不是把 AI 沒填 `scene_tags` 當成格式失敗。
- Review summary 的 `Artifact Provenance`、`Layer Coverage`、`Scene QA` 很有價值，應視為大型 run 的必要交接資料。未來如果加入 HTML report，也應讓人能從相簿、shard、warning 類型直接跳到抽查照片。
- 在啟動新大型任務前，應清理或隔離舊的標記文字檔與 legacy proposal outputs，或至少讓工具在 summary 中明確指出哪些檔案不是本次 run 的正式輸入。這能降低 agent 使用本機舊資料的風險。
- Prompt 版本差異要被當成品質評估的一部分。兩個大型 run 的 prompt hash 都不同於後續 repo 版本；這些成果仍然寶貴，但不能直接當成新版 prompt 的模型能力評估。若要評估新 taxonomy 或新 scene policy，應建立新 attempt 或新 run。

整體判斷：GPT 5.5 xhigh 搭配平行 shard 已經足以支援數千張照片的一小時級初標工作，但專案真正要精進的不是「再讓模型多標一點」，而是把大批次工作變成可恢復、可追溯、可抽查、可 dry-run 的正式資料流程。

### 全量重跑觀察：7718 張、6 worker、GPT 5.5 medium

後續又執行一次更接近正式重跑的全量工作包：`ai-prepare-bulk-relabel-all-2026-05-11`。本次處理 7718 張照片，操作者紀錄總耗時 2h 06m 05s，過程中主要使用 6 個 worker，worker 主要模型為 GPT 5.5 medium。以牆鐘時間計算，平均約 0.98 秒處理一張照片；這不是單張模型推論時間，而是包含分片執行、worker 回收補位、局部修正、合併、validator 與 review 的端到端互動時間。

本輪採用標準 shard workspace：`/tmp/ai-labeling-shards/ai-prepare-bulk-relabel-all-2026-05-11/inputs` 與 `outputs`，共 58 個 shard。前 57 個 shard 多為 133 張，最後一個 shard 為 134 張。正式寫回前仍只在 `/tmp` 產生暫存合併 proposal：`/tmp/ai-labeling-shard-validation/bulk-relabel-all-metadata-proposals.json`，沒有寫回 Google Sheets，也沒有把 review artifacts 寫入正式 run 目錄。

最終整批 validator 通過：

- proposal items：7718。
- `pnpm ai:validate -- --run-dir tmp/ai-runs-local/ai-prepare-bulk-relabel-all-2026-05-11 --proposals /tmp/ai-labeling-shard-validation/bulk-relabel-all-metadata-proposals.json` 通過。
- validator 只留下 16 組 `visual_description` near-duplicate warning，主要集中在連拍、相似合照或高度重複的活動場景。
- `pnpm ai:review` 產生 63542 筆 planned updates，review warnings 26。

本輪欄位覆蓋如下：

| layer / field | 覆蓋 |
| --- | ---: |
| baseline 欄位：`people_count`、`subject_type`、`orientation`、`has_negative_space`、`visual_description`、`curation_status` | 7718/7718 |
| `scene_tags` | 7718/7718 |
| `mood_tags` | 5683/7718 |
| `recommended_uses` | 3259/7718 |
| `public_use_status` | 306/7718 |
| `safe_crop` | 146/7718 |
| `sponsorship_items` / `sponsorship_tags` | 60/7718 |
| `priority_level` | 2/7718 |
| `confidence` | 0 |

這輪和前兩個大型 run 的最大差異是：`scene_tags` 最後被補到 100%。但這不是模型自然一開始就完整做到，而是全體覆蓋檢查後發現 73 張缺 `scene_tags`，分布在 11 個 shard，才再依 `visual_description`、`subject_type`、`people_count` 與可見畫面補齊。這點很重要：只跑每個 shard 的 validator 不足以代表 AI 入口要求已滿足；`scene_tags` 若在 AI 初標階段被視為必填，就需要 merge 前的跨 shard coverage gate，而不是只靠 review summary 的提醒。

本輪也暴露出幾個可修正的品質問題：

- shard-54 有 4 張 `visual_description` 因為沒有踩到 validator 認定的具體視覺詞而失敗。實際內容包含冰櫃、冰品、背板與跑步姿勢，但描述需要補入前景、背景、文字標示、人物動作等更明確詞彙。這表示 `visual_description` validator 雖然粗糙，但仍能有效攔下不夠可搜尋的描述。
- 早期 shard 有 0 人照片 reason 使用「畫面可辨識約 0 人」但同句提到人物、人群或人像照片，造成 review focus 噪音。後續把沒有可辨識真人的 reason 正規化為「畫面沒有可辨識人物」，review focus 從 56 張降到 22 張。
- 剩下 22 張 `people_count = 0` 的 focus 多屬邊界案例，例如空拍機、攝影機、相機手部特寫、線上活動虛擬角色、螢幕中的角色或模糊人物。這些不一定是錯，但應保留給人工抽查，不應由工具自動改成人數大於 0。
- review 仍提示部分相簿或 shard 的 scene tag density 高，例如 Hour of Code、工人合照、線上活動與合作攤位。這多半反映相簿內容本身高度一致，但仍應作為抽查入口，避免整段 worker 過度套用同一標籤。
- GPT 5.5 medium 本輪仍沒有提供 `confidence`。對正式審核而言，這代表人工排序少了一個訊號；若未來需要大量回寫，confidence 仍應列為 prompt / contract 的改善目標。

操作上，6 worker 是可行的，而且對 7718 張照片能把時間壓到兩小時級。但真正的瓶頸已經不只是 worker 數量，而是後段品質閘門與大型 artifact 產生。整批 `ai:review` 會產生 19MB 等級的 diff 與 6 萬多筆 update plan，執行時間明顯長於單 shard review。未來工具應考慮：

- 在 shard merge 前內建全體 coverage check：總照片數、跨 shard duplicate、missing / extra photo_id、必填欄位、`scene_tags` 覆蓋率。
- 在 `ai:review` 或 shard merge 中加入「本次 AI 入口要求」概念，讓 `scene_tags` 這種 AI 階段任務必填欄位能被明確 gate，而不是只靠 Sheets reviewed completeness。
- 大型 review artifact 應分層產生：先 summary / warnings，再按需產生完整 diff / update CSV，避免操作者只是想看品質卻被大型 diff 產生時間卡住。
- Worker prompt 應明確要求「逐張看圖、不使用既有 proposal、scene_tags 必填」，但仍要有 merge 後的程式檢查，因為人類或 worker 回報的「必填都有」不等於跨 shard 全體真的完整。
- 對 `people_count = 0` 的 reason 可以在 prompt 或 post-check 中標準化，要求明確寫「沒有可辨識人物」或「只有螢幕/海報/虛擬角色/模糊局部」，以降低人工 review 噪音。

整體判斷：GPT 5.5 medium 搭配 6 worker 已足以支援 7718 張照片的全量初標生產，但「可完成」不等於「可直接寫回」。本輪最可靠的是 baseline 欄位、`scene_tags`、`visual_description` 與部分 `mood_tags` / `recommended_uses`；高風險欄位仍是 `people_count` 邊界、`recommended_uses` 主觀用途、`public_use_status`、`safe_crop` 與缺少 confidence。這批成果可以作為正式回寫前的候選基底，但應先保留 `/tmp` 合併 proposal 與 review artifacts，讓人類依 review focus 抽查後再決定是否寫入 run 目錄與 Google Sheets。

## 2026-05-10 cross-activity 43 張平行化三模型 attempt

本輪以同一批 cross-activity sample 建立三個 attempt，目標是同時觀察新版 prompt 下的模型輸出差異，以及不同 agent 執行環境的平行化能力：

```bash
tmp/ai-runs/ai-cross-activity-sample-2026-05-10-attempt-gpt-r2-cross-activity-parallel
tmp/ai-runs/ai-cross-activity-sample-2026-05-10-attempt-gemini-r2-cross-activity-parallel
tmp/ai-runs/ai-cross-activity-sample-2026-05-10-attempt-claude-r2-cross-activity-parallel
```

三個 attempt 都包含 43 張照片，且 `manifest.json` 的 `prompt_template_sha256` 相同：

```text
c5635d130e3adb74ebe7ae68a3d9f90c55f35eb661c204f61227cf4e687cbf8b
```

因此這輪比早期 prompt 不一致的測試更適合做本輪橫向比較。不過這仍是 43 張 challenge sample，不是完整模型排名，也不能單獨推導某模型的永久能力。

本節的證據邊界如下：

- 可由目前工作站 artifact 驗證：三個 `manifest.json` / `attempt.json`、三份 `metadata-proposals.json`、43 個 proposal items、同一 prompt hash、重新執行 `pnpm ai:review -- --output-dir /tmp/ai-eval-research/<model>` 後的 review summary 與欄位覆蓋。
- 來自操作者或執行 agent 回報：牆鐘耗時、agent / worker 數、Codex thread limit、Gemini 修補歷程、Claude shard failure 0，以及 GPT 5.5 medium / Gemini 3.1 Pro Preview / Claude Code Opus 4.7 這些完整執行環境名稱。
- `/tmp/ai-eval-research/*` 和 `/tmp/ai-labeling-shards/*` 是本機暫存觀察資料，不是 git 版本永久保存的 artifact；未來重查時應以當時 run 目錄與可重建的 review summary 為準。

### 彙整數字

| attempt | 執行環境紀錄 | proposals | planned updates | review notes | 平行化摘要 |
| --- | --- | ---: | ---: | ---: | --- |
| GPT 5.5 medium / Codex | 25m 35s | 43 | 430 | 3 | 嘗試一次開 11 worker，平台實際上限 6；後續以完成一個補一個跑完 11 shard。 |
| Gemini CLI `gemini-3.1-pro-preview` | 約 10 分鐘 | 43 | 390 | 5 | 10 個 shard 同步啟動；合併後發現部分 `visual_description` 缺 reason 或過度抽象，再平行修補後通過。 |
| Claude Code Opus 4.7 | 約 6m 11s | 43 | 366 | 1 | 15 個 agent 單次 spawn，43 張每 agent 2 到 3 張；shard 失敗 0，validate 通過。 |

`review notes` 是 `metadata-review-summary.md` 中 Review Notes 的提醒數量，不是整體品質分數。Gemini 的錯圖級問題多半是人工抽查發現，沒有完全反映在 notes count；Claude notes 最少也不代表 optional 欄位最完整。

欄位覆蓋差異如下：

| field | GPT | Gemini | Claude |
| --- | ---: | ---: | ---: |
| baseline 欄位：`people_count`、`subject_type`、`orientation`、`has_negative_space`、`visual_description`、`curation_status` | 43 | 43 | 43 |
| `scene_tags` | 40 | 41 | 42 |
| `mood_tags` | 38 | 41 | 32 |
| `recommended_uses` | 33 | 18 | 11 |
| `safe_crop` | 41 | 28 | 15 |
| `public_use_status` | 6 | 0 | 1 |
| `sponsorship_items` / `sponsorship_tags` | 6 / 7 | 2 / 2 | 3 / 4 |
| `priority_level` | 1 | 0 | 0 |
| confidence 欄位數 | 0 | 0 | 52 |

`visual_description` 長度與欄位密度也有明顯差異。下表的長度是字元數，不是人工語意上的詞數：

| attempt | 平均欄位數 / item | `visual_description` 平均字元數 | 最短 / 最長 |
| --- | ---: | ---: | ---: |
| GPT | 10.0 | 58 | 41 / 110 |
| Gemini | 9.1 | 45 | 31 / 57 |
| Claude | 8.5 | 104 | 59 / 196 |

三模型在同一張照片上的分歧也很高，尤其是需要判斷語意的欄位：

| field | 三者完全相同 | 兩者相同、一者不同 | 三者都不同 |
| --- | ---: | ---: | ---: |
| `people_count` | 5 | 26 | 12 |
| `subject_type` | 31 | 9 | 3 |
| `orientation` | 38 | 5 | 0 |
| `has_negative_space` | 24 | 19 | 0 |
| `scene_tags` | 2 | 10 | 31 |
| `mood_tags` | 2 | 18 | 23 |
| `recommended_uses` | 7 | 21 | 15 |
| `safe_crop` | 3 | 19 | 21 |
| `public_use_status` | 37 | 6 | 0 |
| `sponsorship_items` | 35 | 7 | 1 |
| `sponsorship_tags` | 34 | 8 | 1 |

### Review notes 與欄位策略

GPT 的策略最積極，planned updates 也最多。它幾乎每張都給 `safe_crop`，`recommended_uses` 覆蓋 33/43，並且提出 6 張 `public_use_status = needs_review`。這讓可用候選值最多，也讓公開使用風險召回率相對高；抽查中可見兒童臉部、名牌或 QR code 類型的提醒。不過它也帶來人工審核成本：`recommended_uses = 活動回顧` 出現在 26/43 張，`safe_crop = 16:9` 出現 38 次，且所有候選值都沒有 confidence。review note 也提示 `54476968062` 為 `people_count = 0` 但文字中仍有人物相關線索，需要人工確認。

Gemini 的覆蓋率介於 GPT 與 Claude 之間，但這個 r2 parallel attempt 的輸出最不穩定。目前資料能證明 final proposal 有多張錯圖級失準，但不能排除 agent 圖片開啟、shard 工作流或輸出對齊問題；因此這裡不應直接推論為模型本體能力。它在 `mood_tags` 上非常積極，41/43 張都有 mood，且 `專注` 出現 21 次，因此觸發 mood 過度覆蓋警訊。它沒有 `public_use_status` 和 confidence。代表抽查中還看到更嚴重的對圖問題：例如 `55246322689` 實際是 4 人站在 OpenCulture Foundation 攤位後合照，但 Gemini 寫成講廳大合照並估 100 人；`54477810096` 實際是兩人在藍牆前互動，Gemini 寫成帆布袋特寫並標 `people_count = 0`；`52366000893` 實際是錄音室螢幕與麥克風空景，Gemini 寫成三人圍坐錄音。這類錯誤不是單純欄位保守或積極，而是有跨圖或錯圖描述風險。

Claude 的策略最保守，planned updates 最少，review note 也最少。它的 `visual_description` 最長，通常包含可見文字、物件位置與構圖細節，且有 52 個欄位提供 confidence，對人工排序可能有幫助；但其中多數集中在 `people_count`，不是所有欄位都有校準過的把握度。代價是 optional 欄位較少：`recommended_uses` 只有 11 張、`safe_crop` 15 張、`public_use_status` 1 張。代表抽查中，Claude 對物件照與錄音室畫面的描述最接近可搜尋語料，例如 `54478007919` 能列出 LINE TECH FRESH、Klick&Klack 文宣、Attendee 卡片與掛繩；`52366000893` 能描述 About SITCON、Code of Conduct、音訊編輯軟體與桌面麥克風。

### 代表抽查觀察

這次抽查 12 張跨活動照片，重點放在人數矛盾、贊助欄位、食物 / 物件 / 螢幕主體、導覽與錄音等邊界。這是 failure-focused / challenge sample，不是 random sample；它適合找風險與反例，不適合直接計算整體精準度。

- `55246322689` 攤位合照：GPT 與 Claude 都判為 4 人攤位合照，且能辨識 OpenCulture Foundation；Gemini 明顯寫成另一張大合照。GPT 額外提出 `會場攤位`、`攤位曝光`、`品牌露出`，可作候選但需人工確認是否為贊助脈絡；Claude 較保守，只給一般活動回顧。
- `54847451413` 單人低頭操作物件：GPT / Claude 都判 1 人，Claude 給 `工作人員`；Gemini 寫成講者在白板前對聽眾發言並估 5 人，是錯圖或強烈幻覺。
- `54476968062` 紀念吊飾物件照：GPT / Claude 都判 0 人物件照；Gemini 寫成攤位排隊領物並估 4 人。這張也顯示 review 的「0 人但 reason 提人物」警訊不一定代表 GPT / Claude 值錯，而是工具對「沒有出現人臉或人體」這類 reason 文字仍會保守提示。
- `54478007919` 桌面文宣與掛繩：GPT / Claude 都判 0 人物件照並提出贊助相關候選；Claude 的 `visual_description` 對可見文字最完整。Gemini 寫成 T-shirt 整理攤位，和圖片內容不符。
- `54476973647` 背板前自拍：GPT / Claude 都抓到背板與自拍；Gemini 寫成導覽人員向群眾解說，場景不符。
- `54478096543` 導覽說明：三者都判為人物場景，但 Gemini 寫成 20 多人在捷運驗票閘門前合照，和實際持麥克風導覽不符。GPT / Claude 都能抓到「我是導遊」紙牌與小旗。
- `52366000893` 錄音室螢幕空景：GPT / Claude 都判 0 人、`screen`、`錄音` / `螢幕`；Gemini 寫成三人圍坐錄音，和畫面不符。
- `53897968092` 頒獎合影：GPT / Claude 都標 `頒獎`、`合照` 並判 4 人；Gemini 寫成 5 人圍桌討論，錯圖。
- `54476983947` 走廊飲料與指標：GPT 判為茶點，Claude 判為物件 / 場佈 / 指標；兩者都有可審核依據。Gemini 寫成享用咖啡廳點心，細節偏泛且人數偏低。
- `54847512125` 披薩茶點：GPT / Claude 都判 `food` 與 `茶點`；Gemini 寫成會議室座位空景，和圖片內容不符。
- `55250302941` 地板場佈：GPT / Claude 都判 3 人、`場佈` / `工作人員`；Gemini 寫成女性手持文宣微笑站立，和圖片內容不符。
- `54477810096` 藍牆前人物互動：GPT / Claude 都判 2 人、偏社群 / 青春感；Gemini 寫成帆布袋特寫並標贊助，風險較高。

抽查也顯示 GPT / Claude 不是沒有爭議：`55199363642` 中 Claude 把橫式舞台照標成 `portrait`；`55200504889` 中 GPT / Claude 都描述舞台與螢幕，但人數估計為 22 與 12；`54476983947` 的飲料長桌可被 GPT 判為 `food`，也可被 Claude 判為 `object` / `場佈`；`54978186735` 的綠色 SITCON 旗幟在 GPT / Claude 間也落在 `text_signage` 與 `object` 邊界。這些爭議代表 Claude 較可審核不等於所有欄位最準，GPT 高召回也不等於可直接採用。

抽查結論是：Claude 的描述與欄位較保守，較適合作為文字描述初稿；GPT 的欄位較完整，適合產生更多候選，但 `recommended_uses`、`safe_crop`、贊助相關欄位需抽查；Gemini 雖然整體 validate 通過，但這個 attempt 有多張代表照片出現錯圖級描述，不應未修補回寫。

### 平行化成效

這輪把「模型能力」和「agent 平台平行能力」分開看會比較準確。

牆鐘時間可以拆成幾個部分：平台併發與排隊、worker 冷啟動、每張圖片判讀、merge / validate / review、以及修補返工。這輪沒有完整 per-shard start/end log，因此不能把總耗時當成模型推論速度。

Claude Code 在本次平台與 15 agent 條件下展現最好的平行槽位利用：15 個 agent 單次 spawn，43 張每個 agent 2 到 3 張，無 shard 失敗，總牆鐘約 6 分鐘。本輪顯示小批量照片若 agent 環境允許高併發，可以把人工等待時間壓到數分鐘級；但這仍是單次執行觀察，不是可泛化 benchmark。

Gemini CLI 能同時啟動 10 個 sub-agent，但第一次合併後需要修補 `visual_description` reason 或抽象描述問題，總牆鐘約 10 分鐘。這代表平行化本身可行，但返工成本會吃掉一部分速度收益。更重要的是，validate 通過後仍可能有錯圖級內容，因此不能只用平行完成速度判斷品質。

Codex / GPT 5.5 medium 在本次環境中實際 thread 上限為 6。嘗試一次開 11 個 worker 時，後 5 個被 thread limit 擋下，最後採用「完成一個補一個」跑完 11 shard，總耗時 25m 35s。這個結果不能單純解讀為模型較慢；它混合了平台併發限制、worker 冷啟動、等待補位、合併修補與 review 的互動成本。優點是過程可控，且最終 proposal 與正式 review artifacts 都在 run 目錄內完整產生。

對 43 張這種小批次，過度切碎會讓每個 worker 重讀 schema、taxonomy、contract 與 prompt，token 成本和啟動 overhead 變高。Claude 15 shard 在該平台仍有速度優勢，但這不一定能外推到所有 agent 環境；Codex 目前更適合 6 worker 左右的穩定隊列。若照片量放大到 200 張以上，10 到 15 張 / shard 可以作為初始策略，再依 shard duration、修補率與錯圖抽查率調整；本輪不足以推導固定最佳粒度。

### 本輪採用建議

- 不建議直接把三者任何一份全量寫回 Sheets。
- 若目標是挑人工修剪起點，Claude 較適合作為 `visual_description` 文字初稿；但 optional 欄位需用 GPT 補召回，且 Claude 仍要逐張檢查 orientation、people_count 與 public-use 風險。
- 若目標是取得更高召回的候選欄位，可把 GPT 當補充來源，特別是 `public_use_status`、`recommended_uses`、`safe_crop` 與 sponsorship 候選；但這些欄位不應無抽查回寫。
- Gemini 這個 r2 parallel attempt 應視為「平行化可行但輸出對齊風險高」的案例。validate 通過只能證明格式與基本合約成立，不能保證逐張圖像對齊正確；未來若要再評估 Gemini，應保留更完整的 shard log 與隨機抽查樣本。
- 後續工具若要支援多模型比較，應把三類資訊一起呈現：平行化執行紀錄、review summary 統計、代表抽查照片。單看 planned updates、review notes 數或耗時都會誤導。
- 若要把這類比較升級成品質排名，下一步需要人工 gold label，或至少採用 random sample 加 failure-focused sample 的雙軌抽查，並分欄位估算錯圖率、false positive 與 confidence calibration。

## 目前已知容易失準的欄位

### `safe_crop`

常見問題是過度樂觀，尤其把 `1:1` 套到所有照片。判斷時應確認裁切後主體、臉部、文字與主要物件仍保留。若只是「大概能裁」，不應提出該比例。

### `people_count`

人數是篩選關鍵，但 AI 可能只數主體、忽略背景，也可能把前景局部人物納入或排除。人數可以是估計值，但 reason 應說明「約」與估計依據。

### `recommended_uses`

若 `活動回顧` 或 `社群貼文` 過度集中，取圖時區辨度會下降。模型應優先提出能反映工作情境的用途，例如 `講者宣傳`、`網站橫幅`、`志工招募`、`新聞稿`、`贊助成果報告`，但也要避免沒有根據的用途推論。`活動回顧` 應保留給能代表流程、重要場面、互動狀態、活動成果或現場特色的照片，不應只因照片來自活動相簿就使用。

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
- 若 20 張以上的批次中 `mood_tags` 覆蓋率低於 20%，提示模型可能過度保守，不足以支援情緒找圖。
- 若 `mood_tags` 出現在 90% 以上照片，提示可能把情緒標籤當成預設分類。
- 若 `recommended_uses` 單一值出現在 90% 以上照片，提示用途區辨度不足。
- 若 `recommended_uses = 活動回顧` 出現在 45% 以上照片，提示可能被當成通用預設用途。
- 若沒有任何 `public_use_status` 候選值，提示可接受但需視批次內容確認。
- 若 `public_use_status = needs_review` 出現在 90% 以上照片，提示可能被當成預設填空。
- 若所有候選值都沒有 `confidence`，提示不利於人工排序與抽查。
- 若 `confidence = 1` 比例高於 25%，提示 confidence 失去參考價值。
- 若同一個 confidence 值出現在 90% 以上候選欄位，提示信心分數可能沒有逐欄反映不確定性。
- 若 `贊助成果報告` 出現但沒有 `sponsorship_items` 或 `sponsorship_tags`，提示需要人工確認贊助脈絡。
- 若 `people_count = 0` 但 reason 或 scene_tags 提到會眾、講者、合照等人物相關線索，提示可能矛盾。
- `pnpm eval:attempt` 可從同一個 input run 建立不同模型或不同輪次的 attempt，避免手動複製圖片與 prompt。
- `pnpm ai:report` 可產生唯讀 HTML，比較多個 run/attempt 在同一張照片上的 value、reason、confidence 與 validator 狀態；若 summary 已有 `Review Focus`，報表會提供「需優先抽查」篩選，且會提示 summary 是否比 proposal 舊。
- `pnpm eval:search` 可在 proposal 寫回前離線比較 taxonomy-only baseline 與 taxonomy + `visual_description` 的搜尋排序差異，用來驗證描述欄位是否有實際找圖增益。
- `metadata-review-summary.md` 會輸出 `Review Focus`，從現有 warning 中挑出第一批優先抽查照片，例如 `safe_crop` 過度套用、`活動回顧` 過度集中、贊助用途缺少贊助欄位、`people_count = 0` 但有人物線索等情況。

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
- 用 Claude 重新跑完整 132 張後，保留 `pnpm eval:search` 的輸出摘要，記錄哪些真實工作查詢因 `visual_description` 讓更合適的照片進入前幾名。

批次品質檢查應先作為 review warning，不應直接讓 validation 失敗。validation 只負責格式與責任邊界；品質判斷仍應保留給人工與後續工具迭代。
