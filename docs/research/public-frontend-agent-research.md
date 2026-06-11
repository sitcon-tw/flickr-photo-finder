# 公開前端代理使用者研究

## 文件狀態

這份文件是 GitHub Pages 前端重構前的代理使用者研究快照，不是目前前端缺口清單。後續前端已依這份研究完成多項 P0/P1 改善；要了解目前資料來源、部署與前端架構，請以 `docs/public-frontend-architecture.md` 與 `docs/README.md` 為準。

## 目的

這份文件整理 6 個代理角色對 GitHub Pages Photo Finder 的模擬訪談與任務測試。它不是實際真人訪談結果；用途是先用已知 SITCON 工作脈絡、repo 文件、schema、taxonomy 與重構前的 MVP 前端，建立一份可執行的前端重構依據。

後續真實使用者回饋、GA4 行為資料與找圖失敗案例仍應回到這份文件修正假設。

## 方法

代理角色依照下列材料推演：

- `docs/project-architecture.md` 的使用者與找圖流程。
- `docs/photo-finder-mvp.md` 的產品脈絡與欄位目的。
- `docs/public-frontend-architecture.md` 的 GitHub Pages 唯讀邊界與資料來源。
- `docs/frontend-analytics-design.md` 的行為分析邊界。
- `data/photo-schema.json`、`data/tag-taxonomy.json`、`data/sponsorship-items.json`。
- 研究當時 `app/` 前端與 `fixtures/photos.csv` 的 MVP 狀態。

參與的代理角色：

| 角色 | 模擬任務 |
| --- | --- |
| 社群/宣傳 | 找社群貼文、志工招募、活動回顧候選照片。 |
| 網站/視覺設計 | 找網站橫幅、背景素材、社群版型素材。 |
| 贊助/行銷 | 找贊助提案、成果報告、品牌露出佐證照片。 |
| 新聞稿/對外文件 | 找新聞稿主圖、活動介紹、對外簡報代表照片。 |
| 照片整理志工 | 用公開前端反查 metadata、AI 標記與 review 缺口。 |
| 技術/資料維護 | 評估資料流、效能、部署、analytics 與維運風險。 |

## 確認事實

- 研究當時 GitHub Pages 是公開唯讀前端，直接讀取 Google Sheets `photos` 公開 CSV，不保存 credential，也不寫入 Sheets；目前 production Pages 已改為 build-time static-sharded artifact，現況以 `docs/public-frontend-architecture.md` 為準。
- `photos` 主表是正式照片索引，repo fixture 不是正式資料。
- 找圖情境包含社群宣傳、網站橫幅、贊助提案、贊助成果、新聞稿、志工招募、活動回顧、設計素材與對外簡報。
- 目前 schema 已支援用途、氛圍、場景、贊助品項、贊助價值、構圖、裁切、使用提醒、整理狀態與推薦優先度。
- SITCON Flickr 上的照片本身已是公開來源；`public_use_status` 是整理者對使用的提醒，不是公開 / 非公開的主判斷。
- 研究當時的 MVP 前端是欄位導向搜尋與多個下拉篩選，並一次 render 全部符合結果。
- 研究當時的前端沒有 `orientation`、`has_negative_space`、`safe_crop`、`sponsorship_tags` 的一級篩選。
- 研究當時的 fixture 只有 30 筆照片，不能代表上千或上萬張資料的正式體驗。

## 跨角色共識

### P0：任務導向入口

所有角色都不會先從資料欄位開始思考，而是從工作任務開始，例如：

- 社群貼文。
- 網站橫幅 / 背景素材。
- 贊助提案。
- 贊助成果報告。
- 新聞稿 / 對外簡報。
- 志工招募。
- 活動回顧。

前端第一層應是任務模式或快捷入口，再把任務映射到用途、場景、氛圍、構圖、贊助、使用提醒與整理狀態。完整欄位篩選仍要存在，但不應成為第一印象。

### P0：大量資料效能

代理角色一致認為上千到上萬張照片時，MVP 的一次性 render 會失效。重構至少需要：

- 載入後預先建立搜尋文字或索引。
- 搜尋與篩選 debounce。
- 分批 render 或 virtual grid。
- 圖片 lazy loading。
- 清楚顯示結果總數與已顯示數量。
- filter 變更後回到第一批結果。

若 10k 級資料直接讀 CSV 與 browser 端篩選仍不足，再評估由 GitHub Actions 產生 optimized JSON 或搜尋索引 artifact；但 Google Sheets 仍是權威來源。

### P0：可用性與風險提示

非資料維護者不會自然理解 `needs_review`、`ai_labeled`、`reviewed` 的差異。卡片應用任務語言顯示整理狀態與真正需要注意的提醒：

- 推薦。
- 待整理確認。
- 不建議。
- AI 標記。
- 未整理。

預設排序應優先看任務命中、`reviewed`、`high` 與構圖條件，並把 `avoid` 放到後面。不應把授權或攝影署名缺值變成一般找圖卡片的主要警示；需要實際交付素材時，再回到 Flickr 原頁保留來源脈絡。不應完全隱藏 `ai_labeled` 或 `unreviewed`，因為 SITCON Flickr 照片量大，探索仍有價值。

### P0：角色必要篩選缺口

設計角色需要 `orientation`、`has_negative_space`、`safe_crop` 成為一級篩選。贊助角色需要 `sponsorship_tags` 與可搜尋、可分類的 `sponsorship_items` picker。這些都不是資料模型缺口，而是目前 UI 沒有把既有欄位提升到工作流程中。

### P1：候選清單與分享

社群、設計、贊助、公關都不是只找單張照片，而是先整理 3 到 10 張候選交給其他人討論。前端需要：

- 加入/移除候選。
- 批次複製 Flickr links / finder links。
- 匯出 Markdown 或純文字清單，包含 photo id、Flickr URL、finder URL、Google Sheets 列連結與推薦理由。
- 清單畫面必須顯示縮圖，否則上千張照片中只看 photo id 會讓使用者失去記憶線索。
- 分享目前搜尋、篩選與候選集合。

### P1：命中理由與空結果引導

使用者需要知道照片為什麼出現在結果中，例如命中用途、場景、氛圍、贊助品項、贊助價值、visual description 或狀態。零結果或低結果時，前端應提示可放寬的條件，例如從 `approved` 放寬到 `needs_review`，或從精確贊助品項改用贊助價值。

## 角色重點

### 社群/宣傳

- 真實語言偏向「社群感、友善、青春感、交流、可放字、不要太硬」。
- 需要 1:1、16:9、9:16 等版型視角，以及可放字/留白條件。
- 需要 5 到 10 張候選給文案、設計或負責人討論。

### 網站/視覺設計

- 最需要橫式、留白、裁切比例、主體位置、畫面乾淨度與高解析取用信心。
- 目前 schema 已有部分欄位，但 UI 缺少一級篩選。
- 卡片應視覺優先，metadata 詳情可以收合。

### 贊助/行銷

- 需要 `sponsorship_items` 與 `sponsorship_tags` 同時工作：前者是品項，後者是價值或佐證。
- 長品項清單不適合普通 select，應改為搜尋式 picker 並支援分類。
- 成果報告與提案需要候選清單和批次匯出。

### 新聞稿/對外文件

- 優先考慮正式、代表性、畫面清楚、任務匹配與來源可追溯。
- `needs_review` 可進候選，但應以整理提醒呈現，不應蓋過照片本身是否符合任務。
- 對外簡報通常需要一組照片，而不是單一最佳照片。

### 照片整理志工

- 會把前端當成 metadata QA 工具，用找圖失敗反查 taxonomy、AI 標記與欄位缺口。
- 需要 QA-oriented filters，例如「網站橫幅但沒有留白」、「贊助用途但缺 sponsorship_items」、「缺攝影師或授權資訊，需要回 Flickr 原頁確認」。
- 這類 QA 功能可以晚於一般找圖體驗，但不應和公開找圖需求混淆。

### 技術/資料維護

- 必須維持公開唯讀，不引入前端 credential 或寫入能力。
- 大量資料下最先會遇到 DOM render、圖片請求與事件 listener 壓力。
- 需要保留 GA4 聚合行為訊號，但不能把 GA4 當正式使用紀錄。

## 推測與待確認

以下不是確認事實，實作時應作為預設假設或回頭驗證：

- 第一波使用者以 SITCON 內部籌備、志工與協作窗口為主，不以完全不了解 SITCON 的外部大眾為主。
- `ai_labeled` 與 `unreviewed` 應可被探索，但預設排序降權並清楚警示。
- `needs_review` 可進候選清單，但不應呈現為可直接發布。
- 大批次體驗應按 10k 級照片設計，至少不能因結果過多而讓瀏覽器卡住。
- 候選清單可以先存在瀏覽器狀態或 URL，不需要寫回 Google Sheets。
- 第一版不新增照片 schema 欄位；先把既有欄位在前端用好，再根據使用回饋評估留白位置、主體位置、畫面雜訊、亮度、色調等新欄位。

## 需要 owner 決策的問題

這些問題會影響細節，但不阻塞第一版重構 brief：

1. 第一波公開頁使用者是否只限 SITCON 內部與協作窗口，還是會刻意讓外部合作夥伴直接使用？
2. `needs_review` 在社群、新聞稿、贊助成果等對外任務中是否只能作為候選？
3. 是否需要把畫面品質、遮擋、容易誤解的構圖或贊助商 logo 等線索列為更明確的使用提醒分類？
4. 社群平台與網站橫幅的主要比例是否需要補 `4:5`、`21:9` 或 `2:1`？
5. 贊助成果報告輸出偏向簡報、文件、Sheets、Notion，還是純連結清單？
6. 是否需要搜尋贊助商公司名稱？若需要，該資訊是否適合公開？

在 owner 未回覆前，重構 brief 採保守預設：公開唯讀、任務導向、候選而非批准、保留探索但強提示風險。
