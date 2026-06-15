# ADR 0009: 照片 metadata 欄位邊界

## 狀態

Accepted

## 背景

照片索引需要同時支援人工整理、公開 Finder、外部 AI 找圖與 AI 搜尋級標記候選。若欄位責任不清，模型、前端與整理者容易把場景、用途、贊助、使用提醒與主體分類混用，造成搜尋召回、排序與人工 review 成本失控。

欄位順序、型別、受控值與 reviewed 完整度仍以 `data/photo-schema.json` 與 `data/tag-taxonomy.json` 為機器可讀 source of truth；本 ADR 只記錄目前採用的欄位語意邊界。

## 決策

照片 metadata 欄位維持下列分工：

- `visual_description` 是搜尋語料，描述可見物件、動作、文字、位置與構圖關係；不替照片下標題，不補活動身份、年份、單位或贊助推論，也不列入 reviewed 必填。
- `people_count` 保留原始估計數值；前端或 AI 查詢層可依數字衍生人數區間，但不把固定 range 寫回 Sheets。
- `subject_type` 表示主要視覺主體；`scene_tags` 表示活動情境或可見場景元素；`people_count` 表示可辨識人數規模。
- `mood_tags` 可支援宣傳語感與情緒找圖，但不是高信任精準分類，也不作為主要品質分數。
- `public_use_status` 是使用品質或整理提醒，不是照片是否公開、是否取得同意或是否已授權的判定；空白不等於 approved。
- `recommended_uses` 代表明確適合的工作用途，不是每張照片的泛用分類。
- `sponsorship_items` 對齊固定 CFS 品項；`sponsorship_tags` 表示贊助價值或佐證用途；`scene_tags` 只表示畫面事實。三者不可互相取代。

AI proposal 可以協助填寫搜尋級候選，但必須遵守 `docs/ai-labeling-contract.md` 的 AI 欄位分層與 human-only 邊界。

## 取捨

優點：

- 讓 Sheets、Apps Script、Finder、AI prompt、validator 與 report 對欄位語意有一致邊界。
- 減少模型把一般活動照片過度推論成贊助成果、公開批准或高優先推薦。
- 保留原始資料彈性，避免過早把衍生分類寫回正式 Sheets。

代價：

- 某些搜尋體驗需要在前端或 AI 查詢層做衍生，例如人數區間。
- 整理者與 agent 需要理解欄位分工，不能只靠欄位名稱猜測用途。
- 部分高階用途可能需要未來另開 schema 設計，而不是硬塞進既有欄位。

## 替代方案

- 增加更多正式欄位，例如 `people_count_range`、`content_roles` 或 `communication_intent`：可提升特定任務表達力，但會提高 schema、Apps Script、Finder、AI prompt 與 validation 維護成本。
- 讓 `recommended_uses` 承擔所有工作語意：短期簡單，但容易讓用途欄位過度泛用。
- 只依自然語言描述搜尋：彈性高，但失去受控篩選、排序與人工 review 的可預期性。

## 重新評估條件

出現以下情況時，應重新評估欄位設計：

- 真實找圖任務反覆無法由現有欄位、`visual_description` 與搜尋同義詞承接。
- `recommended_uses` 經 prompt 與 review warning 收斂後仍過度粗糙。
- 前端或 AI 查詢層的衍生欄位變成穩定且跨介面共用的政策。
- 贊助、設計或公關工作流需要新的受控欄位，且人工整理成本可接受。

## 相關文件

- `data/photo-schema.json`
- `data/tag-taxonomy.json`
- `data/interface-registry.json`
- `docs/photo-fields-reference.md`
- `docs/ai-labeling-contract.md`
- `docs/public-frontend-architecture.md`
