# 真實找圖評估

這份文件給要驗證照片 metadata 是否支援 SITCON 真實工作需求的維護者。輸入是正式 Sheets 的本機匯出與版本化情境題庫，輸出是本機評估 artifact；流程不寫 Google Sheets。

## 評估分成兩層

`eval:finder-scenarios` 是可重跑的 metadata 基準評估：

1. 只用情境的 `request` 與 `query_terms` 對照片 metadata 排序。
2. 排序完成後，才用 `acceptance_criteria` 與 `reject_criteria` 判定前幾名是否在表格欄位上符合需求。
3. 產生 `results.json` 與 `summary.md`，並記錄輸入檔路徑和 SHA-256。

這層不看圖片，也不使用 `app/search-sort.js`，所以不能宣稱照片視覺上可交付、公開 Finder 排序已改善，或需求提出者已接受結果。要回答這些問題，必須逐張看原圖，並另外保存人工 requester / finder / judge 的判定 artifact。

`eval:finder-candidates` 是多角色或人工驗收前的候選產生器。它可使用 `expected_fields` 幫忙縮小範圍，因此不是獨立的搜尋品質評估，不能把輸出名次當成 benchmark 成績。

## 準備輸入

先更新正式 Sheets 工作快取：

```bash
pnpm sheets:export
```

預設輸入是：

- `tmp/sheets-export/photos.csv`
- `tmp/sheets-export/albums.csv`
- `data/finder-real-world-eval-scenarios.json`

題庫的 `processed_after` 會選出 `albums.last_processed_at` 晚於該時間的相簿，再以 `photos.album_ids` 限定照片範圍。命令列的 `--processed-after` 可以明確覆寫它。

基準 CSV 是選填，不會由評估工具自行取得。若要比較先前匯出，操作者必須用 `--baseline-photos <path>` 指向同一 photo schema 的既有 CSV，並保存產出中的 SHA-256，避免把同一路徑的不同內容誤認為同一份基準。

## 執行情境評估

只評估目前匯出：

```bash
pnpm eval:finder-scenarios
```

比較明確指定的基準：

```bash
pnpm eval:finder-scenarios -- \
  --baseline-photos tmp/sheets-export/photos_20260611.csv \
  --output tmp/finder-evals/current-vs-20260611
```

也可以從 `pnpm eval -- --task finder-scenarios` 進入互動式流程。

輸出目錄包含：

- `results.json`：完整候選、metadata 判定理由、名次差異、題庫與輸入 provenance。
- `summary.md`：供人閱讀的情境結果與第一候選摘要。

`metadata-accepted` 只表示候選列符合題庫中的必要欄位且沒有命中排除條件。它不是人工驗收結果。

## 產生待看圖候選

任務檔是 JSON array；每題至少需要 `id` 和 `request`，`must_have`、`nice_to_have` 與 `expected_fields` 選填：

```json
[
  {
    "id": "volunteer-work",
    "request": "找一張志工正在處理現場任務的照片",
    "must_have": ["工作人員", "幕後"],
    "nice_to_have": ["報到", "攝影"],
    "expected_fields": {
      "recommended_uses": ["志工招募"],
      "scene_tags": ["工作人員", "報到", "攝影"]
    }
  }
]
```

執行：

```bash
pnpm eval:finder-candidates -- \
  --tasks tmp/finder-evals/tasks.json \
  --output tmp/finder-evals/candidates.json
```

工具只讀取表格 metadata，不看圖片。後續 finder 應逐張檢視候選，judge 再依原始需求記錄接受、部分接受或拒絕及理由。

## 維護題庫

- 情境應來自 SITCON 實際交付需求，不為特定照片 ID 寫答案。
- 排序線索放在 `request` 與 `query_terms`；驗收規則放在 `acceptance_criteria` 與 `reject_criteria`，兩者不可混用。
- 修改既有情境語意或判定規則時，調高題庫 `version`。
- 一次性人工判定、HTML review 與匯出資料留在 `tmp/finder-evals/`，不要 commit；可長期重跑的通用情境才留在 `data/`。

變更工具、題庫或文件後至少執行：

```bash
pnpm finder:test
pnpm command:smoke
pnpm data:validate
pnpm docs:check
pnpm language:check
```
