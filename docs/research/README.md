# 研究紀錄索引

這個目錄保存研究、代理訪談、歷史 brief 與驗收背景。這些文件用來追溯當時看到的問題、採用的方法、限制與後續產品判斷；它們不是目前架構或資料契約的真理來源。

## 撰寫規則

- 研究文件應明確寫出文件狀態、方法與限制，避免讓讀者誤認為是真人訪談或已完成 usability test。
- 研究文件可以記錄觀察、推測、owner 評估、採納結果與後續問題，但長期決策應回到 `docs/adr/`。
- 若研究結果已改變公開前端、資料流程或維護邊界，應在相關 ADR、architecture 或 runbook 補上目前規則，並從研究文件連回該決策來源。
- 若後續實作已改變原始 brief 的假設，研究文件應標明它是歷史 baseline，不應被當成目前缺口清單。
- 新增研究文件時，放在本目錄並更新下方索引；不要放在 `docs/` 根目錄或 `docs/README.md` 的「真理來源」區段。

## 文件列表

| 文件 | 用途 |
| --- | --- |
| [public-frontend-agent-research.md](public-frontend-agent-research.md) | GitHub Pages 前端重構前的多角色代理使用者研究快照。 |
| [public-frontend-mobile-research.md](public-frontend-mobile-research.md) | #5 手機版重設計的代理深訪、owner 評估表、P0 範圍與驗收建議。 |
| [public-frontend-redesign-brief.md](public-frontend-redesign-brief.md) | GitHub Pages 前端重構的歷史需求基準與驗收 baseline。 |
| [public-frontend-user-literacy-research.md](public-frontend-user-literacy-research.md) | 一般找圖者可能誤解索引完整性、待人工確認與空結果的代理研究紀錄。 |
