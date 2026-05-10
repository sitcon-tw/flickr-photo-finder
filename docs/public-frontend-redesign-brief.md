# 公開前端重構需求簡報

## 狀態

這份 brief 依據 `docs/public-frontend-agent-research.md` 的代理使用者研究建立。它不是最終 UI 設計稿；目前應視為 GitHub Pages 前端重構的歷史需求基準與驗收 baseline，不是最新缺口清單。

截至 2026-05-11，目前前端已完成多數 P0/P1 方向，包含任務模式、搜尋 debounce、分批 render、載入更多、lazy loading、結果數、構圖與贊助篩選、候選清單、可解釋的排序訊號、Sheets/Flickr/下載操作、AI 助手找圖入口與 GA4 事件。仍應保留為後續驗證或 P2 的項目包含：

- 用正式或合成 10k 級資料重新驗證搜尋、篩選、載入更多與候選清單的效能。
- 用手機與桌機實際走完社群貼文、網站 hero、贊助成果等任務。
- QA 模式、贊助覆蓋率概覽與同義詞橋接。
- 若正式資料量超過 browser-side CSV 可接受範圍，再導入 build-time index。

## 目標

原始目標是把欄位導向的 MVP 前端，重構成面向大量照片的找圖工作台。使用者應能從工作任務出發，在上千到上萬張照片中快速得到可信候選，並能把候選交給其他人討論或使用。

成功標準：

- 使用者可從任務入口開始，不必先理解完整資料表欄位。
- 10k 級照片不會一次 render 全部卡片造成瀏覽器卡頓。
- 每張候選照片能清楚顯示任務匹配、整理狀態與必要使用提醒。
- 使用者能建立 3 到 10 張候選清單並複製分享。
- 前端仍維持公開唯讀，不保存 credential，不寫入 Google Sheets。

## P0 需求

### 任務模式

首頁提供下列任務入口：

- 社群貼文。
- 網站 hero。
- 主視覺/背景。
- 贊助提案。
- 贊助成果報告。
- 新聞稿/對外簡報。
- 志工招募。
- 活動回顧。

每個任務模式應套用對應的搜尋權重、預設排序與建議篩選。使用者進入任務後仍可調整完整篩選條件。

### 大量資料效能

- 載入資料後預先建立每張照片的搜尋文字，避免每次搜尋重新組長字串。
- 搜尋輸入 debounce。
- 篩選或搜尋狀態改變時重設到第一批結果。
- 預設只 render 第一批結果，提供閱讀流底部的載入更多。
- 圖片使用 lazy loading，並避免替未顯示卡片建立大量 DOM 與事件 listener。
- 顯示「符合 N 張，目前顯示 M 張」。

如果實測 10k 級 CSV parse 或搜尋仍太慢，再改由 Pages build 產生 optimized JSON 或搜尋索引 artifact。不要在公開前端加入 Google API credential。

### 可用性排序與風險提示

預設排序應優先：

- 任務用途命中。
- `curation_status = reviewed`。
- `priority_level = high`。
- 任務相關構圖欄位命中，例如 `orientation`、`safe_crop`、`has_negative_space`。
- 縮圖 URL 已填。

預設降權：

- `public_use_status = avoid`。
- `curation_status = unreviewed`。
- 與任務構圖條件不符。

卡片頂部必須用人類可理解的文字顯示：

- 推薦。
- 待整理確認。
- 不建議。
- AI 初標。
- 未整理。

`ai_labeled`、`unreviewed`、`needs_review` 不預設隱藏，但必須用整理狀態或使用提醒標示。SITCON Flickr 照片本身已公開；`public_use_status` 不應被當成 GitHub Pages 的公開 / 非公開門檻。

### 關鍵篩選

完整篩選仍沿用 schema/taxonomy；重構時必須補足研究當時的 MVP 缺口：

- `orientation`。
- `has_negative_space`。
- `safe_crop`。
- `sponsorship_tags`。
- 搜尋式 `sponsorship_items` picker，支援關鍵字與分類。

一般下拉不適合 40 個贊助品項；贊助品項應可搜尋，不要求使用者記完整品項名稱。

### 候選清單

支援使用者把照片加入候選清單，並能：

- 移除候選。
- 顯示縮圖，讓使用者能在候選清單中辨識是哪一張照片。
- 顯示候選數量。
- 批次複製 Markdown 或純文字清單。
- 清單內容至少包含 photo id、Flickr URL、finder URL、Google Sheets 列連結、整理狀態與必要使用提醒。
- 候選清單不寫回 Google Sheets；可先使用 browser state 或 URL state。

## P1 需求

- Active filters：顯示目前套用條件，並可移除單一條件。
- Query URL：搜尋詞、任務模式、篩選、排序可由 URL 分享。
- 命中理由：卡片顯示為什麼出現在結果中，例如用途、場景、氛圍、贊助品項、贊助價值、visual description 或狀態命中。
- 空結果與低結果引導：建議放寬整理狀態、切換相近任務、改用贊助價值、或清除特定篩選。
- 視覺優先卡片：照片、任務摘要、狀態、裁切/留白先顯示；完整 metadata 可收合或進 detail panel。
- Detail panel：集中 Flickr 原頁、下載大圖、原圖尺寸頁、Google Sheets 列連結、photo id 與完整欄位。
- GA4 事件延伸：追蹤任務模式、load more、候選加入/移除、候選清單複製、零結果；不得送 PII 或完整 filter JSON。

## P2 需求

- QA 模式：給整理志工找欄位矛盾與缺值，例如網站 hero 但無留白、贊助用途但缺贊助欄位、缺攝影師或授權資訊而需要回 Flickr 原頁確認。
- 贊助覆蓋率概覽：哪些贊助品項已有可用候選，哪些缺圖。
- 同義詞與任務語言橋接，例如「可放字」對應 `has_negative_space`，「品牌露出」對應 `sponsorship_tags`。
- 若正式資料量超過 browser-side CSV 可接受範圍，再導入 build-time index。

## 非目標

- 不在 GitHub Pages 寫入 Google Sheets。
- 不在前端保存 Google credential、OAuth token、service account 或 AI API key。
- 不把 GA4 互動當成正式照片使用紀錄。
- 不在第一版新增 photo schema 欄位；先使用既有欄位完成任務模式與找圖工作流。
- 不把 `ai_labeled` 自動視為 `reviewed`，也不把 `needs_review` 呈現成可直接對外使用。

## 預設假設

- 第一波使用者是 SITCON 內部籌備成員、志工與協作窗口。
- 正式體驗以 10k 級照片作為壓力目標。
- `needs_review` 可以進候選清單，但應以整理提醒呈現，不是 GitHub Pages 的公開 / 非公開門檻。
- `ai_labeled` 與 `unreviewed` 可以探索，但預設排序降權並清楚標示。
- 候選清單第一版可以只存在瀏覽器狀態或 URL，不需要跨裝置保存。
- 若 owner 後續提供更明確的平台比例、使用風險規則或贊助輸出格式，再更新這份 brief。

## 驗收

- `pnpm validate:data` 通過。
- `node --check app/main.js` 通過。
- `pnpm pages:build` 與 `pnpm pages:check` 通過。
- 用正式或合成 10k 級資料手動驗證搜尋、篩選、載入更多與候選清單。
- 手機與桌機都能完成至少三個任務：社群貼文、網站 hero、贊助成果。
- 每個任務都能在結果中看見任務匹配、整理狀態、Flickr 來源與必要使用提醒。
