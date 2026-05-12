# ADR 0003: AI 只產生候選 metadata

## 狀態

Accepted

## 背景

SITCON Flickr 照片量大，AI 可以協助初步描述畫面、補齊場景標籤、找出可能用途與贊助相關線索。但照片是否已人工審核、是否適合對外推薦、是否能對應特定贊助品項或公開使用，仍牽涉組織語境、授權、肖像權、活動脈絡與資料品質責任。

若 AI 直接把資料標成 `reviewed` 或 `approved`，使用者容易把模型輸出誤認為已由人類確認。

## 決策

AI 初標只產生人類可審核的候選 metadata：

- AI 輸出寫入 run 目錄的 `metadata-proposals.json`。
- AI 不直接修改正式 Google Sheets、`photos.json`、`input-photos.csv` 或 Sheets export。
- `ai:review`、`ai:report`、`ai:diff`、`ai:plan` 與 Sheets dry-run 先產生人類可檢查的差異、報表與更新計畫。
- AI 只能把 `curation_status` 建議為 `ai_labeled`，不能建議或寫入 `reviewed`。
- AI 不能建議 `public_use_status = approved`；需要人類確認後才可批准公開使用。
- 人類 review 應回到 Google Sheets 進行，並由具有編輯權限的志工確認與補齊必要欄位。

## 取捨

優點：

- 保留 AI 對大量照片的初篩與描述效率。
- 避免把模型推論誤包裝成人工審核事實。
- 所有候選值可用 diff、report、update plan 與 dry-run 接受人類檢查。
- `curation_status` 能清楚表達 `unreviewed`、`ai_labeled`、`reviewed` 的差異。

代價：

- AI 結果不能直接完成資料整理，需要額外 review 成本。
- 大型 run 需要更多 artifact 管理、validation 與報表閱讀流程。
- 若人類沒有完成後續審核，AI metadata 仍只能作為較低信任度候選。

## 替代方案

- AI 直接寫入正式 Sheets 並標成 reviewed：速度快，但資料可信度與責任邊界錯誤。
- AI 欄位與人工欄位完全拆表：可保留來源，但增加 Sheets 複雜度，對非工程整理者不友善。
- 不使用 AI 初標：責任邊界最簡單，但大量照片整理成本過高。

## 重新評估條件

出現以下情況時，可以重新評估 AI workflow，但不應未經人類確認就把模型輸出視為人工審核：

- 已建立穩定的人類抽查、簽核與責任歸屬流程。
- 需要保存每個欄位的 AI source、model、confidence 或審核歷程。
- `ai_labeled` 資料量變大，導致現有 Google Sheets review 流程無法有效處理。
- 需要對不同 AI 欄位採取不同信任層級或分階段回寫策略。

## 相關文件

- `docs/ai-labeling-contract.md`
- `docs/ai-labeling-operator-guide.md`
- `docs/ai-readable-dataset.md`
- `docs/project-architecture.md`
- `data/photo-schema.json`
