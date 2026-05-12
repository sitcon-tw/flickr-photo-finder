# ADR 0004: 贊助品項採用固定 snapshot

## 狀態

Accepted

## 背景

行銷與贊助相關找圖需求常常不是只找「攤位」或「背板」，而是需要證明特定贊助品項的曝光、互動或成果價值。因此 `sponsorship_items` 應對齊 CFS 贊助品項名稱，而不是由整理者另創平行詞彙。

目前 `data/sponsorship-items.json` 來源是 SITCON 2026 CFS item data。SITCON 2026 CFS 已結束，這份資料代表特定年度與版本的贊助品項，不應被當作會持續變動的遠端資料。

## 決策

`data/sponsorship-items.json` 作為固定 snapshot：

- `sponsorship_items` 欄位對齊 snapshot 中的品項名稱。
- `data/tag-taxonomy.json` 由這份 snapshot 衍生可用 sponsorship item raw values。
- `sponsorship_items`、`sponsorship_tags` 與 `scene_tags` 保持概念分離。
- 不建立自動同步遠端 CFS 的流程。
- 未來年度或新版 CFS 應明確引入新版本資料或替換 snapshot，而不是假設 2026 snapshot 持續更新。

## 取捨

優點：

- 贊助找圖 vocabulary 對齊實際 CFS 品項，避免人工概略分類失真。
- 固定 snapshot 讓 schema、taxonomy、Apps Script、Pages 與 AI validator 可重現。
- 不會因遠端 CFS 結構或內容變動而意外改變既有照片索引語意。

代價：

- 2026 以外的活動或未來年度需要明確資料遷移或新版 snapshot。
- 若 CFS 原始資料後續修正，repo 不會自動跟進。
- 同一張照片在不同年度 sponsorship vocabulary 下的意義可能需要人工重新整理。

## 替代方案

- 自動同步 CFS 遠端資料：保持來源新鮮，但會讓既有 taxonomy 與 validation 非預期漂移。
- 手動維護另一本 sponsorship vocabulary：短期彈性高，但容易和 CFS 品項名稱分裂。
- 只用 `scene_tags` 表示贊助需求：能簡化欄位，但無法回答具體品項與贊助成果佐證需求。

## 重新評估條件

出現以下情況時，應重新評估 sponsorship snapshot 策略：

- 新年度 CFS 成為正式工作需求。
- 需要同時支援多年度 CFS vocabulary。
- 贊助品項名稱、分類或子品項需要和照片索引建立穩定版本對照。
- 行銷或贊助回饋證明目前 snapshot 粒度不足。

## 相關文件

- `data/sponsorship-items.json`
- `data/tag-taxonomy.json`
- `docs/google-sheets-database-design.md`
- `docs/mvp-implementation-plan.md`
- `docs/photo-finder-mvp.md`
