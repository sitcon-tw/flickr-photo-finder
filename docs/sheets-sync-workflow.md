# Sheets 與 repo 同步流程

## 目的

這份文件定義技術志工與 agent 如何在 Google Sheets 與 repo 工具之間同步資料。

MVP 的重點不是把 repo 變成正式資料庫，而是讓 repo 能穩定協助 Google Sheets 做匯入、驗證、公開讀取與 AI 輔助。

日常操作建議先使用互動入口。它會先說明完整資料流，再依階段引導常見工作：

```bash
pnpm workflow
```

下方低階指令仍是 workflow 會呼叫的工具，也保留給自動化、除錯與文件交叉引用使用。

## 權威來源

- 正式照片資料以 Google Sheets 為準。
- repo 內 `data/*.json` 是 repo 持有的 schema、taxonomy 與固定版本規則資料。
- repo 內 `fixtures/*.csv` 是 sample、demo fixture 與匯出格式參考，不是正式資料，也不是 Google Sheets 快取。
- `tmp/sheets-export/*.csv` 是從正式 Google Sheets 匯出的本機工作快取，供 validation、相簿選擇與 intake 使用；可以刪除，不應 commit。
- schema、taxonomy、validation 與工具規則以 repo 為準。
- 若 Sheets 資料和 repo sample data 不一致，不代表 Sheets 錯；應先確認 sample 是否只是過期測試資料。

## 相簿盤點與匯入流程

此專案的目標範圍已明確限定為 SITCON Flickr，因此主要輸入不應是使用者手動提供相簿 URL。

repo 工具應能盤點 SITCON Flickr 目前有哪些公開相簿，更新 Google Sheets `albums` 清單，讓使用者從清單中選擇本次要處理的相簿。

## 建立 Google Sheets MVP

首次建立正式 Google Sheets 時，先產生初始化 CSV：

```bash
pnpm sheets:init
```

預設會輸出到 `tmp/sheets-init/`：

```text
photos.csv
albums.csv
import_batches.csv
taxonomy.csv
sponsorship_items.csv
manifest.json
```

建立 Google Sheets 後，請建立同名 tabs：

- `photos`
- `albums`
- `import_batches`
- `taxonomy`
- `sponsorship_items`

MVP 階段固定使用上述 tab 名稱，不提供 worksheet name 對照設定。

正式套用初始化資料時，應使用 repo CLI 透過官方 Google Sheets API SDK 寫入。`manifest.json` 用來確認這批初始化檔的 schema version、來源設定與檔案對應，不需要匯入 Sheets。

把公開 Google Sheets ID 填入 `config/project.json`：

```json
{
  "googleSheets": {
    "spreadsheetId": "..."
  }
}
```

這個 ID 可公開；寫入權限由 Google Drive/Sheets 管理。repo 工具在寫入前必須確認是否有覆蓋資料風險。

如果 Sheets 已公開可讀，可以先執行：

```bash
pnpm sheets:check
```

`sheets:check` 只讀取固定 tabs 的公開 CSV export，檢查 header 是否符合預期，以及 tab 是否已經有資料。若任何 tab 已有資料、header 不符合預期，或無法讀取，工具會回報初始化覆蓋風險。

確認沒有覆蓋風險後，正式 Sheets 表格寫入的主要技術選擇是官方 Google Sheets API SDK。repo 工具負責產生可檢查資料、schema、validation、風險檢查、dry-run 與寫入後驗證；不再把 Google Drive 檔案匯入當成主要 Sheets 寫入流程。

若維護者已設定 Google Application Default Credentials，且授權身份對目標 Sheets 具有編輯權限，可以使用 SDK 寫入工具 dry-run 初始化套用計畫：

```bash
pnpm sheets:apply-init
```

這個指令會讀取 `tmp/sheets-init/`，檢查目標 spreadsheet 中固定 tabs 的狀態，並輸出每張 tab 會被建立或寫入。沒有 `--write` 時不會修改 Google Sheets。

確認 dry-run 沒有覆蓋風險後，才執行：

```bash
pnpm sheets:apply-init -- --write
```

工具會建立缺少的固定 tabs，將初始化 CSV 寫入對應 tab，並在寫入後讀回驗證 header 與列數。若任何既有 tab 已有資料或 header 不符合預期，工具會拒絕寫入。

如果要用最新 Flickr 相簿清單初始化 `albums`，請先執行：

```bash
pnpm albums:discover -- --write
pnpm sheets:init
```

若不想把 repo 目前的 `fixtures/albums.csv` 帶入正式 Sheets，可以改用空白 albums 表：

```bash
pnpm sheets:init -- --empty-albums
```

初始化檔只用來建立正式 Sheets 的起點；正式資料後續以 Google Sheets 為準，不需要把完整 Sheets 內容 commit 回 repo。

## 套用 schema header 遷移

當 `data/photo-schema.json` 新增欄位，而正式 Google Sheets 已有資料時，不應重新初始化整份 Sheets。請先使用 header 遷移工具 dry-run：

```bash
pnpm sheets:migrate-headers
```

確認輸出只會插入預期欄位後，再執行：

```bash
pnpm sheets:migrate-headers -- --write
```

`sheets:migrate-headers` 只處理「目前 header 和 repo schema 順序相容，但缺少部分新增欄位」的情況。它會插入缺少欄位並保留既有資料欄位位置；它不會刪欄、改名、重排或覆蓋資料。若 header 已經被人工改名、調整順序或出現未知欄位，工具會阻擋，應先由人類判斷如何保留資料。

## 相簿工作流程

建議流程：

1. 技術志工或 agent 使用 repo 工具盤點 SITCON Flickr 相簿清單。
2. 工具將 `album_id`、`album_url`、`album_title`、照片數等資訊同步到 Google Sheets `albums`。
3. 使用者從 `albums` 清單中選擇本次要處理的相簿。
4. 工具掃描被選定相簿中的照片 ID、照片 URL、縮圖 URL、相簿名稱與可用的 Flickr metadata。
5. 工具和 Google Sheets `photos` 既有 `photo_id` 比對，避免重複匯入。
6. 工具產生一次 intake run artifact，讓人類檢查候選 `photos`、更新後 `albums` 與 `import_batches`。
7. 人類確認後再套用到 Google Sheets。
8. 新增照片預設 `curation_status = unreviewed`。

工具不應在未確認差異時覆蓋人類已整理的欄位。

現有低階工具仍可接受 Flickr 相簿 URL 作為開發與除錯入口；但正式使用流程應以「盤點 SITCON Flickr 相簿清單，再選擇要處理的相簿」為主。

新匯入的照片列會填入 `album_ids`。這是多值欄位，因為同一張照片可能出現在多本 Flickr 相簿中。現階段 intake 只會替新追加照片寫入本次相簿 ID；若照片已存在於 `photos` 而本次只是在另一個相簿再次被看到，工具會先略過，不會自動合併 `album_ids`。要支援這件事時，應新增可審核的 `photos-to-update` artifact 與對應 Sheets 更新工具，不應靜默覆蓋既有列。

目前可用的本機盤點指令：

```bash
pnpm albums:discover
```

確認輸出後，可以更新本機 `fixtures/albums.csv` fixture，供 demo、除錯或 fixture validation 使用：

```bash
pnpm albums:discover -- --write
```

`fixtures/albums.csv` 仍只是 sample/export fixture，不是正式 Google Sheets 資料。正式流程要把相同欄位同步到 Google Sheets `albums`，再使用 `pnpm sheets:export` 與 `pnpm albums:list` 從正式資料選擇本次要處理的相簿。

若已經有正式 Google Sheets `albums` 匯出的 CSV，可以把它和目前盤點結果合併，產生可回寫 Sheets 的 CSV：

```bash
pnpm albums:sync -- --sheets-export /path/to/sheets-albums.csv --output /tmp/albums-to-import.csv
```

`albums:sync` 會保留 Sheets 上的人工作業欄位，例如 `event_name`、`event_year`、`last_processed_at` 與 `notes`，並用盤點結果更新 `album_id`、`album_url`、`album_title` 與 `photo_count`。若是第一次建立 `albums` 工作表，還沒有 Sheets 匯出檔，可以省略 `--sheets-export`。

產出的 CSV 通過 validation 後，應由 SDK-based Sheets 寫入工具套用到正式 Google Sheets；在 `albums` 更新寫回工具尚未實作前，才由人類暫時手動匯入。這一步不需要把正式 Sheets 資料 commit 回 repo。

若本機 `fixtures/albums.csv` 已更新，低階相簿匯入工具可以用相簿 ID 解析 URL；正式流程則應改用 `tmp/sheets-export/albums.csv`：

```bash
pnpm album:add -- ALBUM_ID
```

正式 Google Sheets 已初始化後，應先匯出目前正式資料作為工作輸入：

```bash
pnpm sheets:export
```

這會將固定 tabs 輸出到 `tmp/sheets-export/`。其中 `photos.csv` 用於 `photo_id` 重複檢查，`albums.csv` 用於相簿 ID 解析、活動脈絡與 `last_processed_at` 更新。

使用 `albums:list` 從正式 Sheets 匯出的 `albums.csv` 選擇要處理的相簿：

```bash
pnpm albums:list
pnpm albums:list -- --unprocessed
pnpm albums:list -- --query "SITCON 2026"
pnpm albums:list -- --unprocessed --format commands --limit 5
pnpm albums:select -- --unprocessed
```

`--format commands` 會輸出可直接複製執行的 `pnpm intake:run` 指令；`--format ids` 適合接給 shell 工具，`--format json` 適合讓 agent 或後續互動式選單讀取。相簿陳列順序依循正式 `albums` 匯出檔的列順序，也就是由 Flickr 盤點流程保留下來的相簿順序，不依 `last_processed_at`、`photo_count` 或標題重新排序。若輸出要接給 shell pipeline、JSON parser 或其他程式，請用 `pnpm --silent albums:list -- --format json` 這類形式避免 pnpm script header 混入輸出。

`albums:select` 會把候選清單印到 stderr，讓 stdout 保持為選定相簿的輸出結果。預設輸出可直接執行的 `intake:run` 指令，也可用 `--format id` 或 `--format json` 調整；若要在非互動環境測試或自動化，可加上 `--choice <number>` 選擇畫面上的第 N 筆。

若要產生一次可審核的相簿匯入產物，請使用目前正式 Sheets 匯出的 `photos` 與 `albums`：

```bash
pnpm intake:run -- --album ALBUM_ID
```

`intake:run` 會建立 `tmp/intake-runs/<run-id>/`，並產生：

```text
photos-to-append.csv
albums-updated.csv
import-batch.csv
summary.json
```

這是目前建議的人機協作接口。`photos-to-append.csv` 是缺少照片的候選列，並會帶入本次來源相簿的 `album_ids`；`albums-updated.csv` 是更新 `last_processed_at` 與本次可確認 `photo_count` 後的完整 albums CSV，`import-batch.csv` 是本次操作紀錄，`summary.json` 則讓人類、agent 或未來 Apps Script 先確認本次 run 的範圍與統計。

相簿照片清單會優先透過 Flickr API 取得完整 `photosets.getPhotos` 結果，初始 HTML 解析只作為 fallback。若 `albums` 匯出檔中已有 `photo_count`，但本次實際取得的照片數不同，工具會拒絕產生 intake artifact，避免把只含 Flickr 初始頁面部分照片的不完整 run 寫入正式資料庫。

`intake:run` 預設使用 `tmp/sheets-export/albums.csv` 與 `tmp/sheets-export/photos.csv`。若要使用 repo fixture 做本機測試，請明確指定 `--albums fixtures/albums.csv --photos-export fixtures/photos.csv`，避免正式流程誤用 sample data。

正式寫回前應由人類確認，並避免覆蓋既有人工整理欄位。SDK-based Sheets 寫入工具會提供 dry-run、目標 tab/header 檢查、追加或更新範圍摘要，以及寫入後讀回驗證。

套用前先檢查整包產物：

```bash
pnpm intake:validate -- --run-dir tmp/intake-runs/RUN_ID
```

若維護者已設定 Google Application Default Credentials，且授權身份對目標 Sheets 具有編輯權限，可以 dry-run 檢查套用計畫：

```bash
pnpm sheets:apply-intake -- --run-dir tmp/intake-runs/RUN_ID
```

確認無阻擋問題後，才執行：

```bash
pnpm sheets:apply-intake -- --run-dir tmp/intake-runs/RUN_ID --write
```

`sheets:apply-intake` 只做三件事：

1. 將 `photos-to-append.csv` 的資料列追加到 `photos`。
2. 只更新 `albums` 中該相簿的 `last_processed_at` 欄位。
3. 將 `import-batch.csv` 的單列追加到 `import_batches`。

它不會用 `albums-updated.csv` 覆蓋整張 `albums` 表，以避免蓋掉人類在正式 Sheets 上新增或修正的相簿欄位。

`intake:validate` 會確認：

- 三個 CSV 的欄位符合 `data/photo-schema.json`。
- `summary.json` 存在並包含必要欄位。
- `summary.json`、`import-batch.csv` 與 `albums-updated.csv` 的相簿、時間與統計數字一致。
- `photos-to-append.csv` 的資料列數等於本次新增照片數。

人工套用到 Google Sheets 時，建議順序是：

1. 看 `summary.json`，確認相簿、時間、找到/新增/略過照片數符合預期。
2. 檢查 `photos-to-append.csv`，確認候選列沒有明顯錯誤；這份檔案只追加到 `photos`，不要覆蓋整張表。
3. 用 `albums-updated.csv` 更新 `albums`，或至少把該相簿的 `last_processed_at` 更新成 `summary.json` 的 `created_at`。
4. 將 `import-batch.csv` 的單列追加到 `import_batches`。
5. 套用後再從 Sheets 匯出相關 CSV，用 `pnpm validate:data` 檢查正式資料。

若只需要低階輸出，可以直接指定各 CSV 路徑：

```bash
pnpm photos:import -- --album ALBUM_ID --output /tmp/photos-to-append.csv --albums-output /tmp/albums-updated.csv --batch-output /tmp/import-batch.csv
```

`photos:import` 會從 `albums` CSV 取得相簿名稱、活動名稱、年份、來源相簿 ID 與可檢查的 `photo_count`，掃描該相簿中的照片，排除已存在於 `photos` 匯出檔的 `photo_id`，再用 Flickr oEmbed 補 `image_preview_url`、攝影師候選署名與可公開整理備註。

## 匯出驗證流程

當需要檢查 Sheets 資料品質時：

1. 從 Google Sheets 匯出 `photos`，欄位順序應符合 `data/photo-schema.json`。
2. 放到本機或暫存路徑作為驗證輸入。
3. 執行 repo validation。
4. 將錯誤回報整理成 Sheets 使用者看得懂的列號、欄位與修正建議。
5. 回到 Google Sheets 修正。

正式資料不需要 commit 回 repo。只有 schema、taxonomy、工具、文件或 sample fixture 有意義改變時才需要 commit。

若要驗證 Sheets 匯出的 `albums` CSV，可以指定 albums 路徑：

```bash
pnpm validate:data -- --albums /path/to/sheets-albums.csv
```

若要驗證候選 `photos` CSV，可以指定 photos 路徑：

```bash
pnpm validate:data -- --photos /tmp/photos-to-append.csv
```

若要驗證匯入批次 CSV，可以指定 import batches 路徑：

```bash
pnpm validate:data -- --import-batches /tmp/import-batch.csv
```

## AI 輔助流程

AI 可以協助初標，但不能取代人工確認。

建議流程：

1. 先用 `pnpm sheets:export` 匯出正式 Sheets 工作快取。
2. 用 `pnpm ai:prepare` 從 `tmp/sheets-export/photos.csv` 選出待整理照片，例如 `curation_status = unreviewed`。
3. 工具建立 `tmp/ai-runs/<run-id>/`，輸出 `input-photos.csv`、`photos.json`、`manifest.json`，並下載 AI 判讀用圖片到 `images/`。
4. AI 讀取 `photos.json`、`images/`、相簿脈絡、既有欄位、taxonomy 與 sponsorship items。
5. AI 產生 `metadata-proposals.json` 候選欄位值。
6. 用 `pnpm ai:review -- --run-dir tmp/ai-runs/<run-id>` 檢查候選欄位格式、受控字彙與責任邊界，並產生審核摘要、diff 與更新計畫。
7. 用 `pnpm sheets:apply-ai-updates -- --run-dir tmp/ai-runs/<run-id>` 對正式 Sheets 做 dry-run，確認會更新哪些 cells。
8. 人類確認後才加上 `--write` 寫入正式欄位。
9. AI 協助後但尚未人工完整確認的列標成 `curation_status = ai_labeled`。

AI 初標流程到 `ai_labeled` 就應停止。`curation_status = reviewed` 不應是本機 AI run 的收尾步驟，而是照片資料回到 Google Sheets 後，由具有 Sheets 編輯權限的志工們在同一份正式資料表中協作檢核、修正並補齊必要欄位後才更新。

準備一批 AI 初標輸入：

```bash
pnpm ai:prepare -- --limit 50
```

若要準備整本相簿，使用 album id 篩選並把上限設為 `all`：

```bash
pnpm ai:prepare -- --album ALBUM_ID --limit all
```

日常操作可直接使用 `pnpm workflow` 的「準備 AI 初標工作包」。它會先從正式 Sheets 匯出的 `albums` 清單選相簿，再把選到的 album id 傳給 `ai:prepare`。工作包建立完成後，workflow 會印出可直接複製給模型或 agent 的 prompt，並寫入該 run 目錄的 `ai-labeling-prompt.md`。

這仍會套用預設 `curation_status = unreviewed`。若要整本相簿所有整理狀態都放進工作包，請使用：

```bash
pnpm ai:prepare -- --album ALBUM_ID --limit all --status all
```

`ai:prepare` 預設使用 `--image-size large-1024`，因為 AI 初標需要比前端縮圖更清楚的內容判讀素材。`image_preview_url` 仍是 Google Sheets 正式欄位中給前端預覽的小縮圖；AI 工作包會在 `photos.json` 另外記錄本次使用的 `image_download_url` 與 `image_size`，不需要把 AI 下載尺寸寫回 Sheets。

可選尺寸：

```bash
pnpm ai:prepare -- --image-size preview
pnpm ai:prepare -- --image-size medium-640
pnpm ai:prepare -- --image-size medium-800
pnpm ai:prepare -- --image-size large-1024
pnpm ai:prepare -- --image-size original
```

`original` 是可選模式，會從 Flickr 公開尺寸頁解析原圖 URL。它適合少量、需要細節判讀的照片；大量批次使用前，應先評估下載流量、儲存空間與後續 AI 運算量。

若只想產生 metadata 檔、不下載圖片，可用：

```bash
pnpm ai:prepare -- --limit 50 --no-download
```

`ai:prepare` 只建立本機 `tmp/ai-runs/` 工作目錄，不寫入 Google Sheets。後續 AI 產生的欄位調整仍應以可審核 diff 表達，不能直接覆蓋 Sheets。

AI 候選 metadata 應寫成 `tmp/ai-runs/<run-id>/metadata-proposals.json`：

```json
{
  "proposal_version": 1,
  "run_id": "ai-prepare-...",
  "created_at": "2026-05-08T00:00:00.000Z",
  "producer": {
    "type": "ai",
    "name": "model or agent name"
  },
  "items": [
    {
      "photo_id": "55200405673",
      "fields": {
        "scene_tags": {
          "value": ["舞台"],
          "reason": "畫面中可見舞台或典禮區域。",
          "confidence": 0.8
        }
      }
    }
  ]
}
```

檢查候選 metadata 並產生審核資料：

```bash
pnpm ai:review -- --run-dir tmp/ai-runs/<run-id>
```

`ai:review` 會先執行 proposal validation，再輸出：

- `metadata-review-summary.md`: 給人類快速檢查批次成果、欄位分布與可能警訊。
- `metadata-diff.md`: 逐欄列出原值、AI 建議值、是否變更、信心與理由。
- `metadata-update-plan.json` / `metadata-update-plan.csv`: 只列出實際會改變的欄位，供後續 dry-run Sheets 更新工具使用。

AI 候選值只允許讀圖初標合理處理的欄位，例如 `people_count`、`scene_tags`、`mood_tags`、`recommended_uses`、`sponsorship_items`、`sponsorship_tags`、`orientation`、`has_negative_space`、`safe_crop`、`public_use_status`、`priority_level`、`collections` 與 `curation_status`。AI 候選值不能修改 Flickr 基本欄位、攝影師或授權；若建議 `curation_status`，只能是 `ai_labeled`；若建議 `public_use_status`，不能直接給 `approved`。

若只想執行單一步驟，仍可使用底層指令：

```bash
pnpm ai:validate -- --run-dir tmp/ai-runs/<run-id>
```

產生審核 diff：

```bash
pnpm ai:diff -- --run-dir tmp/ai-runs/<run-id>
```

`ai:diff` 會先執行同一套 proposal validation，再輸出 `metadata-diff.md`。這份檔案列出 `photo_id`、欄位、原值、AI 建議值、是否變更、信心與理由，讓人類可以先審核差異；它不寫入 Google Sheets。

產生機器可讀更新計畫：

```bash
pnpm ai:plan -- --run-dir tmp/ai-runs/<run-id>
```

`ai:plan` 會先執行同一套 proposal validation，再輸出 `metadata-update-plan.json` 與 `metadata-update-plan.csv`。這份計畫只列出實際會改變的欄位，供後續 dry-run Sheets 更新工具使用；它不寫入 Google Sheets。

dry-run 檢查正式 Sheets 更新：

```bash
pnpm sheets:apply-ai-updates -- --run-dir tmp/ai-runs/<run-id>
```

`sheets:apply-ai-updates` 會讀取正式 `photos` 工作表，確認 header 符合 repo schema、`photo_id` 存在，並確認目前 cell 值仍等於 update plan 的 `current_value`。若 dry-run 顯示的 cell 範圍與變更內容符合預期，才加上 `--write`：

```bash
pnpm sheets:apply-ai-updates -- --run-dir tmp/ai-runs/<run-id> --write
```

若 Sheets 已被其他志工修改，造成目前 cell 值和 plan 不一致，工具會阻擋寫入，避免覆蓋人工整理結果。

若人類重新觸發 AI 調整欄位，工具仍應提供可審核 diff，不應靜默覆蓋人工整理內容。

## 公開讀取流程

GitHub Pages、外部 AI 與其他唯讀工具應讀取 `photos` 主表，或讀取由 `photos` 以同一套欄位匯出的公開 CSV/JSON。

公開匯出只是技術傳輸格式，不是另一份資料表，也不應做資料篩選。

產生流程：

1. 檢查 `photos` header 與 schema。
2. 檢查必要欄位與受控字彙。
3. 若需要 CSV/JSON，依固定欄位順序匯出 `photos`。
4. 保留 `curation_status`、`public_use_status`、`priority_level` 與 `collections`。
5. 不因尚未人工 review 排除照片。
6. 不因 `public_use_status = avoid` 排除照片。

公開前端與 AI 應使用欄位值排序與提示，不應依賴 Sheets 顏色、註解、排序或篩選檢視。

## 衝突處理

### Sheets 與 repo sample 不一致

以 Google Sheets 為準。repo sample data 只用於本機 UI、測試與匯出格式參考。

### Sheets 與 repo schema 不一致

以 repo schema 為準。應更新 Sheets header、Apps Script 或同步流程，並保留人類資料。

### AI 候選值與既有人工值不一致

不要自動覆蓋。工具應顯示原值、AI 建議值與理由，由人類決定是否採用。

### taxonomy 缺值

不要直接在 Sheets 中創造新受控字彙。先確認是否真的需要新增，若需要，更新 `data/tag-taxonomy.json`、文件與 validation。

## 官方 Sheets API SDK 的定位

Google Sheets 表格語意包含 tab、range、header、append、batch update 與讀回驗證。這些操作應使用官方 Google Sheets API SDK 作為 repo CLI 的主要技術選擇，而不是透過 Drive 檔案同步工具間接處理。

官方 Node.js quickstart 可以作為理解 SDK 與本機 OAuth 流程的起點：

https://developers.google.com/workspace/sheets/api/quickstart/nodejs

但 quickstart 的 local OAuth 設計只適合開發與測試，不應直接等同於專案正式授權交接方案。正式工具應明確記錄：

- 需要啟用 Google Sheets API。
- 使用哪些 OAuth scopes。
- credential 檔與 token 檔的預期路徑。
- 哪些檔案不得 commit。
- 寫入前的 preflight 與 dry-run 行為。
- 寫入後如何讀回驗證。

現階段 repo 已有 `pnpm sheets:apply-init` 可以用 SDK 套用初始化 CSV，也有 `pnpm sheets:apply-intake` 可以 dry-run/write 已審核的 intake run artifact。正式 Sheets `albums` 目前透過 `pnpm sheets:export` 產生本機工作 CSV，再由 `pnpm albums:list` 或 `pnpm albums:select` 協助選擇 intake 目標；後續若要減少中介 CSV，才需要讓選擇流程直接讀取 Sheets API。

若未來需要 Google Drive 檔案備份、匯出檔搬運或組織既有檔案工作流，應視為 Sheets API SDK 之外的檔案維護工作，不作為 Sheets tab/range 寫入的主要流程。

## 權限與 credential

repo 不保存：

- Google API credential。
- OAuth client secret、refresh token 或 SDK token cache。
- 第三方工具 token。
- AI API key。
- 私人 Google Sheets 連結或權限設定。

SITCON 組織已有文件存放與交接制度。此 repo 只記錄本專案需要哪些資產、工具如何運作，以及未來 agent 如何接手維護流程；實際權限交接由 SITCON 既有 Google Drive 與文件管理原則處理。

## 建議的正式寫入身份

正式 Google Sheets 還是空白時，通常不是資料產生工具失敗，而是尚未完成「誰有權代表專案寫入 Sheets」這個前置設定。

此專案建議使用 **SITCON 管理的 service account** 作為正式 repo CLI 寫入身份，而不是依賴某位志工個人的 Google OAuth token。

如果接手者不熟悉 Google Cloud 或 service account，請先閱讀以下官方文件，再進行設定：

- Google Workspace 驗證與授權概念：<https://developers.google.com/workspace/guides/auth-overview>
- Google Workspace 建立 credentials：<https://developers.google.com/workspace/guides/create-credentials>
- Application Default Credentials 搜尋順序與用途：<https://cloud.google.com/docs/authentication/application-default-credentials>
- Google Sheets API scopes：<https://developers.google.com/workspace/sheets/api/scopes>

這裡的 service account 可以先理解成「給程式使用的 Google 身份」。它不是某位志工的個人帳號；只要把這個 service account email 加進正式 Google Sheets 的編輯者，它就能透過 Google Sheets API 寫入那份試算表。

Application Default Credentials，簡稱 ADC，是 Google 官方 client libraries 尋找本機或執行環境授權身份的通用方式。本 repo 的 SDK 工具會透過 ADC 取得授權，所以本機只需要設定好可用的 service account credential，程式不需要知道 credential 檔案內容。

理由：

- service account 是非個人身份，適合讓 CLI、agent 或未來自動化工具穩定使用。
- 志工交接時，不需要接手某位個人的 browser login、OAuth token cache 或本機狀態。
- 權限可以集中在正式 Google Sheets 檔案層級管理，只授予編輯這份試算表所需的最小權限。
- repo 工具目前使用 Google Application Default Credentials，service account credential 可以透過 `GOOGLE_APPLICATION_CREDENTIALS` 提供，不需要修改程式。

個人 OAuth / `gcloud auth application-default login` 仍可作為臨時本機操作或除錯方式，但不應成為正式交接方案。若用個人身份寫入，寫入者就是該個人帳號；離任、換機或 token 過期時都會影響流程。

domain-wide delegation 不是 MVP 需求。只有在未來需要 service account 代表特定 Workspace 使用者操作、存取使用者私有資料，或受組織政策限制無法直接分享 Sheet 給 service account 時，才應重新評估。MVP 只需要把目標 Google Sheets 明確分享給 service account email，讓它對該試算表有編輯權限。

### Service account 前置步驟

建議由 SITCON 管理的 Google Cloud project 或組織既有雲端資產負責建立 service account。

1. 在 Google Cloud project 啟用 Google Sheets API。
2. 建立用途明確的 service account，例如 `flickr-photo-finder-writer`。
3. 取得這個 service account 的 email，例如 `flickr-photo-finder-writer@PROJECT_ID.iam.gserviceaccount.com`。
4. 將正式 Google Sheets 分享給該 service account email，權限設為 `Editor`。
5. 產生或取得本機執行用 credential，並依 SITCON 既有文件制度保存與交接。
6. 在本機設定：

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

`export` 只會影響同一個 shell session 後續啟動的 process。若指令是由另一個 terminal、agent、CI job、IDE task 或新的 worktree 環境執行，不能假設它會繼承你剛剛在目前 shell 設定的環境變數。執行 SDK 工具前，請先確認該執行環境真的看得到：

```bash
printenv GOOGLE_APPLICATION_CREDENTIALS
```

若要避免環境傳遞混淆，可以用單次 inline env 執行：

```bash
GOOGLE_APPLICATION_CREDENTIALS="$PWD/credentials.json" pnpm sheets:apply-intake -- --run-dir tmp/intake-runs/RUN_ID
```

這只是讓 Google SDK 在該 process 使用指定 credential，不需要也不應該讀取或印出 credential 檔案內容。

7. 確認 `config/project.json` 的 `googleSheets.spreadsheetId` 指向正式 Google Sheets。
8. 先 dry-run：

```bash
pnpm sheets:apply-init
```

9. 人類確認 dry-run 沒有覆蓋風險後才寫入：

```bash
pnpm sheets:apply-init -- --write
```

service account key 是敏感 credential，不能 commit，也不應放在 `tmp/`、repo 目錄、issue、PR 或公開文件中。若 SITCON 有更好的組織級方式，例如不落地長期 key 的 workload identity 或由受控環境掛載 service account，應優先使用組織既有安全做法；repo 只要求工具能透過 ADC 取得具有 Sheets 編輯權限的身份。

### 常見 ADC / scope 問題

若 SDK 工具顯示 `Request had insufficient authentication scopes`，代表 Google client library 找到了某個 ADC credential，但這個 credential 沒有取得 `https://www.googleapis.com/auth/spreadsheets` scope。常見情境是使用個人 OAuth / `gcloud auth application-default login` 取得過較窄的 token；此時只更新 repo 設定或重新分享 Sheet 不會修好，必須改用已分享為 Editor 的 service account credential，或重新建立包含 Sheets scope 的個人 ADC/OAuth credential。

若你已經在某個 shell 裡 `export GOOGLE_APPLICATION_CREDENTIALS=...`，但工具仍顯示 `GOOGLE_APPLICATION_CREDENTIALS is not set`，代表實際執行工具的 process 沒有繼承該環境變數。請改在同一個 shell 執行工具，或使用上方的 inline env 寫法。

若錯誤是 permission / forbidden，通常代表 credential scope 足夠，但該 service account 或 OAuth 使用者沒有目標 Sheet 的讀取或編輯權限。dry-run / export 至少需要能讀取目標 Sheet，`--write` 還需要編輯權限。

## 授權方式與驗證邏輯

不同維護者本機可用的授權方式不一定相同。此 repo 不應假設某個人的 Google 帳號、OAuth token cache、`gcloud`、瀏覽器登入狀態、`clasp` 權限或第三方工具登入狀態能在其他人手上重現。

因此文件與工具應分清楚以下幾種能力：

| 能力 | 是否需要授權 | 驗證方式 | 失敗時代表什麼 |
| --- | --- | --- | --- |
| 產生初始化 CSV | 不需要 Google 授權 | `pnpm sheets:init` 通過並產生 `tmp/sheets-init/` | repo 工具或本機環境有問題，不代表 Sheets 權限有問題。 |
| 讀取公開 Sheets 狀態 | 不需要寫入權限；需要 Sheets 已公開可讀 | `pnpm sheets:check` 能讀固定 tabs 並回報狀態 | 可能是 Sheets 尚未公開、tab 不存在、網路受限或 ID 錯誤，不代表寫入權限不足。 |
| 匯出正式 Sheets 工作 CSV | 需要 Google Sheets API credential 與目標 Sheets 讀取權限 | `pnpm sheets:export` 產生 `tmp/sheets-export/*.csv` 並檢查 header | 可能是 OAuth credential、scope、Sheets 權限、tab/header 或網路問題。 |
| 套用初始化 CSV | 需要 Google Sheets API credential 與目標 Sheets 編輯權限 | `pnpm sheets:apply-init` dry-run 通過，人工確認後執行 `pnpm sheets:apply-init -- --write`，寫入後讀回驗證通過 | 可能是 OAuth credential、scope、Sheets 權限、tab/header 或資料格式問題，應依工具錯誤分類處理。 |
| 套用 header 遷移 | 需要 Google Sheets API credential 與目標 Sheets 編輯權限 | `pnpm sheets:migrate-headers` dry-run 通過，人工確認後執行 `pnpm sheets:migrate-headers -- --write`，寫入後讀回驗證通過 | 只支援新增缺少欄位；若 header 有未知欄位、改名或順序不相容，工具會阻擋。 |
| 套用 intake run artifact | 需要 Google Sheets API credential 與目標 Sheets 編輯權限 | `pnpm sheets:apply-intake -- --run-dir <dir>` dry-run 通過，人工確認後加上 `--write`，寫入後讀回驗證通過 | 可能是 OAuth credential、scope、Sheets 權限、tab/header、重複 `photo_id`、重複 `batch_id` 或找不到相簿列。 |
| 透過官方 SDK 寫入 Sheets | 需要 Google Sheets API credential 與目標 Sheets 編輯權限 | SDK 寫入工具的 preflight、dry-run、confirmed write 與寫入後讀回驗證都通過 | 可能是 OAuth credential、scope、Sheets 權限、tab/header 或資料格式問題，應依工具錯誤分類處理。 |
| 驗證正式資料格式 | 不需要寫入權限；需要能取得 Sheets 匯出的 CSV | `pnpm validate:data -- --photos <csv> --albums <csv> --import-batches <csv>` | 代表匯出資料和 repo schema 不一致，或匯出檔不是預期格式。 |
| 檢查 intake run artifact | 不需要 Google 授權 | `pnpm intake:validate -- --run-dir <dir>` | 代表本次匯入產物內部不一致，套用前應先修正。 |
| 部署 Apps Script | 需要 clasp 可用且 Google 帳號有 script 權限 | `clasp` 指令成功，且 Apps Script 專案顯示更新 | clasp 或 Google 帳號授權問題，不代表 repo schema 錯。 |

`sheets:check` 是公開讀取檢查，不是權限檢查。它只能回答「這份公開 Sheets 目前看起來是否適合初始化」，不能保證某個人或某個工具有寫入權限。

SDK credential、token cache 或其他個人授權設定不應 commit。若專案要記錄操作方式，只能記錄需要的能力、scope、檔案對應與驗證步驟，不記錄個人 token 或組織內部權限細節。

建議的可攜驗證順序：

1. 執行 `pnpm sheets:init`，確認初始化 CSV 可由 repo 產生。
2. 執行 `pnpm sheets:check`，確認公開 Sheets 固定 tabs 沒有覆蓋風險。
3. 執行 `pnpm sheets:apply-init` dry-run，確認目標 spreadsheet、tabs、header、預計新增或更新列數。
4. 人類確認後才執行 `pnpm sheets:apply-init -- --write`。
5. 寫入後由工具讀回驗證，並可再執行 `pnpm sheets:check` 確認 tabs 已有資料且 header 合理；此時出現 `has data` 是預期結果，不應再拿它判斷是否適合初始化。
6. 從 Sheets 匯出相關 CSV，執行 `pnpm validate:data` 驗證正式資料格式。

## Commit 時機

適合 commit 的內容：

- schema 或 taxonomy 變更。
- validation 規則變更。
- 匯入、同步、AI 輔助工具變更。
- Apps Script source 或產生器變更。
- 文件流程與欄位語意變更。
- 有代表性的 sample fixture 更新。

不適合 commit 的內容：

- 正式 Google Sheets 的完整照片資料快照。
- credential、token、私人連結。
- 單純從 Sheets 匯出的工作中暫存檔。
