# SITCON Flickr Photo Finder

SITCON Flickr Photo Finder 是 SITCON Flickr 之上的照片索引與搜尋工具，用來協助籌備團隊用真實工作需求找照片，例如社群宣傳、網站視覺、贊助提案、贊助成果報告、新聞稿、志工招募與活動回顧。

這個專案不取代 Flickr、不保存原圖，也不把 repo 當成正式照片資料庫。正式照片索引資料在 Google Sheets；這個 repo 保存專案設定、schema、受控字彙、驗證規則、匯入工具、公開搜尋前端、Apps Script source 規劃與 AI/agent 維護脈絡。

## 目前狀態

目前 repo 已有本機搜尋 UI、資料驗證、SITCON Flickr 相簿盤點、可回寫 Google Sheets `albums` 的同步 CSV 產生工具、從正式 Sheets 匯出或直接從 Sheets API 讀取相簿清單後互動式選擇本次處理相簿的 CLI、可從選定相簿產生一次 intake run artifact 的工具、準備/attempt/review/report/search/dry-run/write AI 初標候選 metadata 的本機工作流程、GitHub Pages artifact build/deploy workflow，以及 Apps Script 維護輔助 source。run artifact 會包含 Google Sheets `photos` 候選列、`albums.last_processed_at` 更新、`import_batches` 批次紀錄與摘要；AI metadata 更新流程會先產生可審核 diff、update plan 與唯讀報表，dry-run 後才可選擇寫入 Sheets，且寫入後會讀回驗證。正式 Google Sheets 表格讀寫的主要技術選擇是官方 Google Sheets API SDK；Apps Script 實際 `clasp` 綁定與部署仍需由有權限的維護者完成。

完整「目前可用 / 尚未實作」狀態以 `docs/README.md` 為準，README 只保留快速入口。

## 資料權威

- Google Sheets `photos` 是正式照片索引資料庫。
- Google Sheets `albums` 是正式相簿清單與處理狀態資料。
- Google Sheets `import_batches` 是正式匯入批次紀錄資料。
- `photos` 主表本身就是公開照片索引；公開 CSV/JSON 只是同欄位匯出，不是額外篩選表。
- `data/photo-schema.json` 是照片、相簿與匯入批次欄位順序、欄位 metadata、reviewed 完整度與 approved 使用要求的機器可讀來源。
- `data/tag-taxonomy.json` 是受控字彙來源。
- `data/sponsorship-items.json` 是 SITCON 2026 CFS 贊助品項固定版本資料，不會自動追遠端更新。
- `fixtures/photos.csv`、`fixtures/albums.csv` 和 `fixtures/import-batches.csv` 只是 MVP demo、測試資料與匯出格式參考。
- `tmp/sheets-export/*.csv` 是從正式 Google Sheets 匯出的本機工作快取，可刪除、不可 commit。
- `config/project.json` 是組織名稱、Flickr 帳號路徑、Flickr 連結與前端標題等專案設定來源。
- `config/project.json` 也保存公開 Google Sheets 的 `spreadsheetId`。正式 tabs 固定使用 `photos`、`albums`、`import_batches`、`taxonomy`、`sponsorship_items`。

若 Google Sheets 正式資料和 repo 內測試資料不一致，以 Google Sheets 為準。若 Sheets 欄位或驗證規則和 repo schema 不一致，以 repo schema 為準，並更新 Sheets 或 Apps Script。

## 你可能想做的事

新接觸專案時，建議先使用互動入口：

```bash
pnpm workflow
```

`pnpm workflow` 會先說明完整資料流，再依任務標示目前階段、需要的輸入、會產生的輸出與下一步，協助使用者開始操作常見流程，例如檢查資料、處理一本 Flickr 相簿、從相簿準備 AI 初標工作包、驗證 AI 初標結果、操作 Google Sheets 工具或開本機搜尋 UI。下表中的低階指令仍保留給自動化、除錯與文件交叉引用。

| 情境 | 入口 |
| --- | --- |
| 第一次理解專案 | `docs/project-architecture.md`、`docs/photo-finder-mvp.md` |
| 看目前已實作與尚未實作項目 | `docs/README.md` |
| 互動式選擇要執行的工作流程 | `pnpm workflow` |
| 本機打開搜尋 UI | `pnpm dev` |
| 檢查本機測試資料和 schema 是否一致 | `pnpm validate:data` |
| 產生 Google Sheets MVP 初始化 CSV | `pnpm sheets:init` |
| 檢查公開 Google Sheets 初始化覆蓋風險 | `pnpm sheets:check` |
| 透過官方 SDK 套用初始化 CSV | `pnpm sheets:apply-init` |
| 透過官方 SDK 套用安全 header 遷移 | `pnpm sheets:migrate-headers` |
| 透過官方 SDK 匯出正式 Sheets CSV | `pnpm sheets:export` |
| 盤點 SITCON Flickr 相簿 | `pnpm albums:discover` |
| 列出可處理相簿 | `pnpm albums:list`，或直接讀 Sheets：`pnpm albums:list -- --source sheets` |
| 互動式選擇本次要處理的相簿 | `pnpm albums:select -- --unprocessed`，或直接讀 Sheets：`pnpm albums:select -- --source sheets --unprocessed` |
| 產生可直接執行的相簿匯入指令 | `pnpm albums:list -- --format commands --limit 5` |
| 產生可回寫 Google Sheets `albums` 的 CSV | `pnpm albums:sync -- --sheets-export <csv> --output <csv>` |
| 從已選相簿產生一組可檢查後套用的匯入產物 | `pnpm intake:run -- --album <album-id>` |
| 檢查匯入產物是否完整一致 | `pnpm intake:validate -- --run-dir <dir>` |
| 透過官方 SDK 套用匯入產物 | `pnpm sheets:apply-intake -- --run-dir <dir>` |
| 準備 AI 初標工作目錄 | `pnpm ai:prepare -- --limit 50 --image-size large-1024`，整本相簿可用 `--album <album-id> --limit all` |
| 從既有 AI run 建立模型/輪次 attempt | `pnpm ai:attempt -- --from <dir> --model claude --round 1` |
| 檢查 AI 候選 metadata 並產生審核摘要 | `pnpm ai:review -- --run-dir <dir>` |
| 評估 AI 初標品質與常見失準 | `docs/ai-labeling-evaluation-notes.md` |
| 檢查 AI proposal 範例 | `pnpm ai:validate-fixtures` |
| 只驗證 AI 候選 metadata | `pnpm ai:validate -- --run-dir <dir>` |
| 只產生 AI 候選 metadata diff | `pnpm ai:diff -- --run-dir <dir>` |
| 只產生 AI 候選 metadata 更新計畫 | `pnpm ai:plan -- --run-dir <dir>` |
| 產生單次檢視或多模型/多輪 AI 初標比較網頁 | `pnpm ai:report -- --run <dir>`，或 `pnpm ai:report -- --runs <dir> <dir>` |
| 比較 taxonomy-only 與 `visual_description` 搜尋結果 | `pnpm search:experimental -- --run-dir <dir>` |
| dry-run 檢查 AI metadata 將更新哪些 Sheets cells | `pnpm sheets:apply-ai-updates -- --run-dir <dir>` |
| 了解 AI 初標操作與輸出格式 | `docs/ai-labeling-operator-guide.md`、`docs/ai-labeling-contract.md` |
| 從已選相簿產生可追加到 `photos` 的候選 CSV | `pnpm photos:import -- --album <album-id> --output <csv>` |
| 從已盤點相簿檢查缺少照片 | `pnpm album:add -- <album-id>` |
| 整理照片欄位 | `docs/data-entry-guide.md`、`docs/photo-fields-reference.md` |
| 維護 Google Sheets 或同步流程 | `docs/google-sheets-database-design.md`、`docs/sheets-sync-workflow.md` |
| 建立 GitHub Pages artifact | `pnpm pages:build` |
| 維護公開前端 | `docs/public-frontend-architecture.md`、`app/config.js` |
| 產生 Apps Script 設定 | `pnpm apps-script:build-config` |
| 維護 Apps Script | `docs/apps-script-maintenance-design.md`、`apps-script/` |
| 讓 AI 或 agent 讀資料 | `docs/ai-readable-dataset.md`、`docs/agent-maintenance-guide.md` |

## 本機操作

需要 Node.js 與 pnpm。目前已知可用 Node.js 版本為 `v24.15.0`，目前沒有額外 runtime dependency。

這個 repo 只使用 pnpm 作為套件管理工具。請不要使用 npm 或 yarn，避免不同 git worktree 平行開發時產生不一致的 lockfile 或安裝行為。`package.json` 的 `packageManager` 與 `preinstall` 會檢查這個限制。

驗證資料：

```bash
pnpm validate:data
```

啟動搜尋介面：

```bash
pnpm dev
```

開啟 `http://localhost:4173/`。本機搜尋 UI 預設讀取 repo 內測試資料，不是正式 Google Sheets 資料。

建立 GitHub Pages artifact：

```bash
pnpm pages:build
pnpm pages:check
```

這會輸出乾淨的 `tmp/pages/`，只包含公開前端、必要設定、schema 與 taxonomy。部署版 `config.js` 會把 `photosCsvUrl` 指向 `config/project.json` 中 `googleSheets.spreadsheetId` 的公開 Google Sheets `photos` CSV 輸出；它不會包含 repo scripts、fixtures、tmp 工作資料或任何 credential。`pages:check` 會檢查 artifact 是否包含 `index.html`、`main.js`、`styles.css`、schema、taxonomy 與公開 Sheets CSV 設定。前端會使用 schema 計算資料庫概覽，例如整理狀態、公開使用狀態、人數標記、reviewed 必要欄位完整度與贊助欄位覆蓋率。

MVP 的 GitHub Pages 資料讀取方式是公開 CSV URL，不使用前端 Google API key、OAuth、service account 或 Apps Script Web App。上線前需要確認正式 Google Sheets 允許公開唯讀讀取、`photos` header 符合 `data/photo-schema.json`，且 GitHub repository Pages 來源設定為 GitHub Actions。完整準備清單見 `docs/public-frontend-architecture.md`。

產生 Google Sheets MVP 初始化檔案：

```bash
pnpm sheets:init
```

這會輸出到 `tmp/sheets-init/`，包含 `photos.csv`、`albums.csv`、`import_batches.csv`、`taxonomy.csv`、`sponsorship_items.csv` 與 `manifest.json`。這個指令不會連線或寫入 Google Sheets；正式套用請使用 `pnpm sheets:apply-init`。

如果 `config/project.json` 已填入 `googleSheets.spreadsheetId`，可以檢查正式 Sheets 是否已有覆蓋風險：

```bash
pnpm sheets:check
```

這個指令只讀取公開 Google Sheets CSV export，不會寫入資料。它會檢查固定 tab 是否能讀取、header 是否符合預期，以及 tab 是否已經有資料。

確認沒有覆蓋風險後，正式 Sheets 寫入流程應由 repo CLI 透過官方 Google Sheets API SDK 執行，並保留 preflight、dry-run、人類確認與寫入後驗證。這個 repo 不自製 Google Drive 檔案搬運流程；若未來需要 Drive 檔案備份或搬運，再交由組織既有工具處理。

正式寫入使用 SITCON 管理的 service account 作為 repo CLI 寫入身份，並把該 service account email 加到正式 Google Sheets 的編輯者。repo 的 Sheets API 工具只從執行環境的 `GOOGLE_APPLICATION_CREDENTIALS` 取得授權，不依賴個人 `gcloud` ADC 或 OAuth token cache。若不熟悉 service account，請先看 `docs/sheets-sync-workflow.md` 的「建議的正式寫入身份」，其中包含 Google 官方文件入口與完整前置需求。

在同一個 shell、agent process 或 CI job 先設定環境變數，並確認授權身份對目標 Sheets 有編輯權限後，可以先 dry-run 檢查初始化套用計畫：

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
printenv GOOGLE_APPLICATION_CREDENTIALS
```

```bash
pnpm sheets:apply-init
```

確認輸出顯示沒有覆蓋風險後，才加上 `--write` 寫入：

```bash
pnpm sheets:apply-init -- --write
```

這個指令會建立缺少的固定 tabs，並把 `tmp/sheets-init/` 中的 CSV 寫入對應 tab。若任何既有 tab 已有資料或 header 不符合預期，工具會拒絕寫入。

若 repo schema 新增欄位，而正式 Sheets 已有資料，請不要重新初始化。先 dry-run 檢查是否能安全插入缺少欄位：

```bash
pnpm sheets:migrate-headers
```

確認只會插入預期欄位後，再加上 `--write`：

```bash
pnpm sheets:migrate-headers -- --write
```

這個指令只處理新增欄位，例如在 `photos` 插入 `album_ids`。它不會刪欄、改名、重排或覆蓋資料。

正式 Sheets 已初始化後，後續相簿匯入前應先匯出正式 Sheets 工作用 CSV：

```bash
pnpm sheets:export
```

這會輸出到 `tmp/sheets-export/`，包含 `photos.csv`、`albums.csv`、`import_batches.csv`、`taxonomy.csv`、`sponsorship_items.csv`。其中 `photos.csv` 與 `albums.csv` 應提供給 `intake:run` 使用，避免用 repo fixture 判斷重複照片或相簿脈絡。

列出可處理的相簿。預設會讀 `tmp/sheets-export/albums.csv` 工作快取；若同一個執行環境已設定 `GOOGLE_APPLICATION_CREDENTIALS`，也可用 `--source sheets` 直接讀正式 `albums` 工作表：

```bash
pnpm albums:list
pnpm albums:select -- --unprocessed
pnpm albums:list -- --source sheets
pnpm albums:select -- --source sheets --unprocessed
```

常用篩選：

```bash
pnpm albums:list -- --unprocessed
pnpm albums:list -- --query "SITCON 2026"
pnpm albums:list -- --limit 50
```

盤點 `config/project.json` 指定的 Flickr 帳號公開相簿清單：

```bash
pnpm albums:discover
```

確認輸出後，可寫入本機 `fixtures/albums.csv` 測試資料，供 demo、除錯或 fixture validation 使用：

```bash
pnpm albums:discover -- --write
```

若已有 Google Sheets `albums` 匯出的 CSV，可以和目前盤點結果合併，產生可回寫 Google Sheets 的 CSV：

```bash
pnpm albums:sync -- --sheets-export /path/to/sheets-albums.csv --output /tmp/albums-to-import.csv
```

若是第一次建立 `albums` 工作表，還沒有 Sheets 匯出檔，可以省略 `--sheets-export`：

```bash
pnpm albums:sync -- --output /tmp/albums-to-import.csv
```

從已盤點或已同步的相簿選一本，產生可追加到 Google Sheets `photos` 的候選照片 CSV。正式流程應使用 `pnpm sheets:export` 產生的 `photos` 與 `albums` 匯出檔：

```bash
pnpm albums:list -- --unprocessed --format commands --limit 5
pnpm intake:run -- --album ALBUM_ID
```

`albums:list -- --format commands` 會依目前篩選條件輸出可直接複製執行的 `intake:run` 指令；陳列順序依循來源列順序，也就是由 Flickr 盤點流程保留下來的相簿順序。若要給其他工具讀取，可改用 `--format ids` 或 `--format json`。若輸出要接給 shell pipeline、JSON parser 或其他程式，請用 `pnpm --silent albums:list -- --format json` 這類形式避免 pnpm script header 混入輸出。

若要由 CLI 顯示候選清單並互動式選擇單本相簿，使用 `pnpm albums:select -- --unprocessed`。它預設輸出可直接執行的 `intake:run` 指令，也可用 `--format id` 或 `--format json` 調整輸出；候選清單同樣保留 Flickr 相簿順序。

這會建立一個 `tmp/intake-runs/<run-id>/` 目錄，內含：

```text
photos-to-append.csv
albums-updated.csv
import-batch.csv
summary.json
```

這組檔案是一次處理相簿的可審核產物。正式寫回 Sheets 前，應先檢查 `summary.json`、候選照片列與相簿更新內容。

套用到 Google Sheets 前，先檢查整包產物是否完整一致：

```bash
pnpm intake:validate -- --run-dir tmp/intake-runs/RUN_ID
```

若同一個執行環境已設定 `GOOGLE_APPLICATION_CREDENTIALS`，並且授權身份對目標 Sheets 有編輯權限，可以 dry-run 檢查這包匯入產物會如何套用：

```bash
pnpm sheets:apply-intake -- --run-dir tmp/intake-runs/RUN_ID
```

確認沒有重複 `photo_id`、重複 `batch_id` 或找不到相簿列等阻擋問題後，才加上 `--write`：

```bash
pnpm sheets:apply-intake -- --run-dir tmp/intake-runs/RUN_ID --write
```

這個指令只會把新照片追加到 `photos`、把一列追加到 `import_batches`，並只更新 `albums` 中該相簿的 `last_processed_at` 欄位；它不會用 `albums-updated.csv` 覆蓋整張 `albums` 表。

若要準備 AI 初標輸入，先匯出正式 Sheets，再建立本機 AI run：

```bash
pnpm sheets:export
pnpm ai:prepare -- --limit 50
```

這會建立 `tmp/ai-runs/<run-id>/`，包含 `input-photos.csv`、`photos.json`、`manifest.json`、`ai-labeling-prompt.md` 與 `images/`。這些檔案只供本機 AI 初標與人工審核使用，不會寫入 Google Sheets。`ai:prepare` 預設下載 Flickr 1024px 圖片作為 AI 判讀素材；`image_preview_url` 仍是正式 Sheets 中給前端預覽用的小縮圖。若只想測試 metadata 輸出，可加上 `--no-download`。

AI 圖片尺寸可依任務調整：

```bash
pnpm ai:prepare -- --image-size preview
pnpm ai:prepare -- --image-size medium-640
pnpm ai:prepare -- --image-size medium-800
pnpm ai:prepare -- --image-size large-1024
pnpm ai:prepare -- --image-size original
```

`original` 會嘗試從 Flickr 公開尺寸頁解析原圖 URL，適合需要細節判讀的少量照片；大量批次仍應先評估下載流量、儲存空間與後續 AI 運算量。

若要針對整本相簿準備 AI 初標工作包，使用 album id 篩選並把上限設為 `all`：

```bash
pnpm ai:prepare -- --album ALBUM_ID --limit all
```

使用互動入口時，`pnpm workflow` 的「準備 AI 初標工作包」會先從正式 Sheets 匯出的 `albums` 清單選相簿，再把選到的 album id 傳給 `ai:prepare`。工作包建立完成後，`ai:prepare` 會寫入該 run 目錄的 `ai-labeling-prompt.md`；workflow 也會把同一份 prompt 印出，方便直接複製給模型或 agent。

若要把同一批輸入交給多個模型，或同一模型重跑第二輪，不要手動複製整個工作包；請從既有 run 建立 attempt：

```bash
pnpm ai:attempt -- --from tmp/ai-runs/RUN_ID --model claude --round 1
pnpm ai:attempt -- --from tmp/ai-runs/RUN_ID --model claude --round 2 --label visual-description
pnpm ai:attempt -- --from tmp/ai-runs/RUN_ID --model gpt --round 1
```

attempt 目錄仍是一般 AI run 形狀，可以直接交給模型並用 `pnpm ai:review -- --run-dir <attempt-dir>` 檢查；圖片預設用 symlink 或 hardlink 共用，不會重複複製。

這仍會套用預設 `curation_status = unreviewed` 篩選。若要整本相簿所有整理狀態都放進工作包，請加上：

```bash
pnpm ai:prepare -- --album ALBUM_ID --limit all --status all
```

AI 初標輸入、圖片來源、可輸出欄位與 `metadata-proposals.json` 格式以 `docs/ai-labeling-contract.md` 為準。AI 初標結果應寫成 `tmp/ai-runs/<run-id>/metadata-proposals.json`，再用 review 入口檢查：

```bash
pnpm ai:review -- --run-dir tmp/ai-runs/RUN_ID
```

這個指令會一次完成 proposal validation、產生 `metadata-diff.md`、產生 `metadata-update-plan.json` / `metadata-update-plan.csv`，並寫出 `metadata-review-summary.md`。摘要會列出欄位覆蓋率、常見值分布、可能需要人工注意的批次層級警訊，以及下一步報表、比較與 dry-run 指令。`ai:review` 終端輸出的 `Next:` 和 summary 裡的 `## Next Commands` 是這段流程的主要交接提示。

若只想執行單一底層步驟，仍可使用：

```bash
pnpm ai:validate -- --run-dir tmp/ai-runs/RUN_ID
pnpm ai:diff -- --run-dir tmp/ai-runs/RUN_ID
pnpm ai:plan -- --run-dir tmp/ai-runs/RUN_ID
```

這些指令仍然只是審核資料，不會寫入 Google Sheets。

若要檢視單次 AI 初標結果，可產生本機靜態 HTML 報表：

```bash
pnpm ai:report -- --run tmp/ai-runs/RUN_ID-attempt-claude-r1
```

單次報表會以照片為單位顯示縮圖、proposal 狀態、欄位覆蓋率，以及每個欄位的 value、reason、confidence。若要比較多個模型或多輪結果，改傳多個 run/attempt：

```bash
pnpm ai:report -- --runs tmp/ai-runs/RUN_ID-attempt-claude-r1 tmp/ai-runs/RUN_ID-attempt-claude-r2 tmp/ai-runs/RUN_ID-attempt-gpt-r1
```

報表會輸出到 `tmp/ai-reports/<timestamp>/index.html`。多 run 報表會以同一張照片並排顯示各 run/attempt 的 value、reason、confidence、validator 狀態與差異。這是 read-only 檢視工具，不會修改 proposal 或寫入 Sheets。

若要在寫回 Sheets 前評估 `visual_description` 是否真的改善自然語言找圖，可先跑離線搜尋比較：

```bash
pnpm search:experimental -- --run-dir tmp/ai-runs/RUN_ID
pnpm search:experimental -- --run-dir tmp/ai-runs/RUN_ID --query "有留白的橫式講者照片" --top 10
```

這個 prototype 會把 `metadata-proposals.json` overlay 到該 run 的 `photos.json`，同時輸出 taxonomy-only baseline 與 taxonomy + `visual_description` 的排序差異。它不呼叫 LLM、不抓圖片，也不寫入 Google Sheets；用途是驗證描述欄位是否帶來搜尋增益。

產生機器可讀更新計畫：

```bash
pnpm ai:plan -- --run-dir tmp/ai-runs/RUN_ID
```

這會先執行同一套 proposal validation，再輸出 `metadata-update-plan.json` 與 `metadata-update-plan.csv`。它只列出會改變的欄位，作為後續 dry-run Sheets 更新工具的輸入；這一步仍然不寫入 Google Sheets。

檢查更新計畫會落在哪些 Sheets cells：

```bash
pnpm sheets:apply-ai-updates -- --run-dir tmp/ai-runs/RUN_ID
```

這個指令預設只做 dry-run，會讀取正式 Google Sheets，確認 `photo_id` 存在、header 符合 schema，且目前 cell 值仍等於 update plan 的 `current_value`。若有人已經在 Sheets 改過資料，工具會阻擋，避免覆蓋人工整理結果。只有人工確認 dry-run 後，才可加上 `--write` 套用。

若只需要低階輸出，也可以直接指定每個輸出檔：

```bash
pnpm photos:import -- --album ALBUM_ID --output /tmp/photos-to-append.csv --albums-output /tmp/albums-updated.csv --batch-output /tmp/import-batch.csv
```

`intake:run` 與 `photos:import` 預設使用 `tmp/sheets-export/albums.csv` 與 `tmp/sheets-export/photos.csv`，避免正式流程誤用 repo fixture 判斷相簿脈絡或重複照片。如果使用的是本機測試資料，請明確指定 `--albums fixtures/albums.csv --photos-export fixtures/photos.csv`。輸出檔只包含缺少的照片列，正式寫回前仍應由人類確認。

檢查單本相簿中哪些照片尚未存在於本機 `fixtures/photos.csv`：

```bash
pnpm album:add -- ALBUM_ID
```

匯入該相簿中尚未索引的照片到本機測試資料：

```bash
pnpm album:add -- ALBUM_ID --append
```

從單張 Flickr 照片 URL 產生候選資料列：

```bash
pnpm photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID
```

寫入本機 `fixtures/photos.csv`：

```bash
pnpm photo:add -- https://www.flickr.com/photos/sitcon/PHOTO_ID --append
```

`--append` 只會修改本機測試資料。正式流程仍應把確認後的資料同步回 Google Sheets。

## 資料流

```text
SITCON Flickr 相簿清單
  -> repo 工具盤點相簿
  -> 使用者選擇本次要處理的相簿
  -> repo 工具掃描選定相簿並產生候選資料
  -> Google Sheets photos 主表
  -> Apps Script 驗證與提示
  -> GitHub Pages 與外部 AI 讀取 photos 或同欄位公開匯出
```

GitHub Pages 只提供唯讀搜尋，不寫入資料庫。Apps Script 是 Sheets 內的維護輔助與驗證工具，應透過 `clasp` deploy。AI 與 agent 可以讀取公開照片索引、schema、taxonomy 與文件，協助找圖或產生可審核的 metadata diff。

## 資料填寫原則

- 多值欄位用分號分隔，例如 `攤位;會眾;交流`。
- `scene_tags` 描述照片裡看到什麼。
- `sponsorship_items` 描述對應哪個贊助品項，必須對齊 `data/sponsorship-items.json`。
- `sponsorship_tags` 描述能支援哪種贊助價值。
- `people_count` 是照片中可辨識的人數估計值，可留空；無人可填 `0`。
- 不確定是否可公開使用時，`public_use_status` 請填 `needs_review`。
- 不要把敏感資訊寫進公開欄位。`curation_notes` 是公開整理備註。

更多填寫規則請看 `docs/data-entry-guide.md`。

## 主要檔案

| 路徑 | 用途 |
| --- | --- |
| `app/` | 本機與 GitHub Pages 的唯讀搜尋前端。 |
| `config/project.json` | 專案組織名稱、Flickr 帳號與前端顯示設定。 |
| `data/photo-schema.json` | 照片、相簿與匯入批次欄位 schema。 |
| `data/tag-taxonomy.json` | 受控字彙與列舉值。 |
| `data/sponsorship-items.json` | SITCON 2026 CFS 贊助品項固定版本資料。 |
| `fixtures/photos.csv` | 本機照片 demo/fixture，不是正式資料，也不是 Sheets 快取。 |
| `fixtures/albums.csv` | 本機相簿 demo/fixture，不是正式資料，也不是 Sheets 快取。 |
| `fixtures/import-batches.csv` | 本機匯入批次 fixture，不是正式資料，也不是 Sheets 快取。 |
| `fixtures/ai-proposals/` | AI proposal valid/invalid 範例與 validator 回歸測試資料。 |
| `prompts/ai-labeling.md` | 可交給模型使用的 AI 初標 prompt 範本。 |
| `scripts/check-sheets.mjs` | 只讀檢查公開 Google Sheets 初始化覆蓋風險。 |
| `scripts/apply-sheets-init.mjs` | 透過官方 Google Sheets API SDK 套用初始化 CSV，預設 dry-run，`--write` 才寫入。 |
| `scripts/init-sheets.mjs` | 產生 Google Sheets MVP 初始化 CSV。 |
| `scripts/migrate-sheets-headers.mjs` | 透過官方 Google Sheets API SDK 安全插入 repo schema 新增的缺少欄位，預設 dry-run。 |
| `scripts/export-sheets.mjs` | 透過官方 Google Sheets API SDK 匯出固定 tabs，供 validation 與 intake 使用。 |
| `scripts/validate-data.mjs` | 資料驗證。 |
| `scripts/validate-ai-fixtures.mjs` | 驗證 AI proposal valid/invalid fixtures 是否符合目前 validator 邊界。 |
| `scripts/create-ai-attempt.mjs` | 從既有 AI run 建立可重複使用同一輸入的模型/輪次 attempt。 |
| `scripts/build-ai-report.mjs` | 產生單次檢視或多模型/多輪比較用的 AI 初標唯讀靜態 HTML 報表。 |
| `scripts/search-experimental.mjs` | 離線比較 taxonomy-only 與 `visual_description` 的搜尋排序差異。 |
| `scripts/discover-albums.mjs` | SITCON Flickr 相簿盤點。 |
| `scripts/list-albums.mjs` | 從正式 Sheets 匯出的 `albums.csv` 列出與篩選相簿，並可輸出 album id、JSON 或可直接執行的 intake 指令。 |
| `scripts/select-album.mjs` | 從正式 Sheets 匯出的 `albums.csv` 互動式選擇單本相簿，輸出 album id、JSON 或可直接執行的 intake 指令。 |
| `scripts/sync-albums.mjs` | 合併 Sheets 匯出與盤點結果，產生可回寫 `albums` 的 CSV。 |
| `scripts/run-intake.mjs` | 從選定相簿產生一次 intake run artifact，包裝候選照片、相簿更新、批次紀錄與摘要。 |
| `scripts/validate-intake-run.mjs` | 套用到 Sheets 前檢查 intake run artifact 是否完整一致。 |
| `scripts/apply-intake-run.mjs` | 透過官方 Google Sheets API SDK 套用已審核 intake run artifact，預設 dry-run。 |
| `scripts/import-album-photos.mjs` | 從相簿產生可追加到 `photos` 的候選照片 CSV、更新後 `albums` CSV 與 `import_batches` CSV。 |
| `scripts/flickr-album-photos.mjs` | Flickr 相簿照片 URL 解析共用工具。 |
| `scripts/add-album.mjs` | 單本相簿檢查與本機匯入。 |
| `scripts/add-photo.mjs` | 單張照片候選資料列產生與本機匯入。 |
| `docs/README.md` | 文件入口、目前狀態與真理來源。 |
| `AGENTS.md` | agent 協作規則。 |

## 進一步閱讀

- `docs/project-architecture.md`: 專案使用流程、資料流與部署架構。
- `docs/photo-finder-mvp.md`: MVP 產品判斷與欄位取捨脈絡。
- `docs/data-entry-guide.md`: 照片索引填寫指南。
- `docs/photo-fields-reference.md`: 欄位速查。
- `docs/google-sheets-database-design.md`: 正式 Google Sheets 資料庫設計。
- `docs/sheets-sync-workflow.md`: Sheets 與 repo 工具同步流程。
- `docs/public-frontend-architecture.md`: GitHub Pages 唯讀前端資料流。
- `docs/apps-script-maintenance-design.md`: Apps Script 維護輔助設計。
- `docs/ai-readable-dataset.md`: 外部 AI 與唯讀工具如何解讀照片索引資料。
- `docs/ai-labeling-operator-guide.md`: AI 初標操作者與 agent 的 prepare-to-review、報表檢視與回寫前檢查指南。
- `docs/ai-labeling-contract.md`: AI 初標工作包的輸入、輸出、限制與驗證合約。
- `docs/agent-maintenance-guide.md`: agent 與技術志工維護指南。
