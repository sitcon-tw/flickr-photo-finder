# Pages React Finder QA 腳本

## 目的

這份文件記錄 React Finder cutover 後的人工與自動化驗收腳本。它不是設計稿，也不是一次性測試紀錄；每次修改 GitHub Pages finder 的桌面、手機、候選、篩選、preview/detail、analytics 或效能時，都應回到這裡確認受影響的情境。

## 驗收基準

- 使用者能以工作任務開始，而不是被迫理解整份照片 schema。
- Desktop 是長時間找圖工作台：固定篩選、結果 grid、detail inspector、候選清單、overview 與 AI 工具應同時服務找圖流程。
- Mobile 是快速挑選與討論：第一屏先看結果，固定「篩選 / 候選」入口，filter、candidate、preview/detail 以 sheet/dialog 管理。
- 手機主要觸控目標至少 44px；桌面工具按鈕至少 38px。
- 照片卡片第一層保留快速判斷所需資訊；完整 metadata、來源連結與檢查資訊放進 detail。
- 大資料下不一次 render 全部照片卡，搜尋與排序不能造成明顯卡死。
- GA4 event 只送低基數、已清理、不含 credential 或完整自由文字的行為訊號。

## 自動化檢查

基本檢查：

```bash
pnpm finder:build
pnpm finder:check
pnpm finder:performance:check
PORT=4174 pnpm finder:dev:fixture
pnpm finder:responsive:check -- http://127.0.0.1:<port>/
```

`finder:responsive:check` 需要先有本機 frontend server。若 4174 已被占用，改用其他 port，並把同一個 URL 傳給 responsive check。

完整本機健康檢查：

```bash
pnpm project:check
```

若只修改前端互動或樣式，至少跑 `pnpm finder:build`、`pnpm finder:check` 與 `pnpm finder:responsive:check`。若修改搜尋、排序、候選、URL state 或資料正規化，還要跑 `pnpm finder:test` 與 `pnpm finder:performance:check`。

## 桌面人工腳本

建議 viewport：1440 x 900。

### 社群貼文找圖

1. 開啟 Finder，確認桌面第一屏有任務、搜尋、篩選、結果 grid 與右側工具區。
2. 選擇社群貼文任務，輸入一個常見需求詞，例如「社群」或「講者」。
3. 使用活動/相簿、場景或推薦用途篩選收斂結果。
4. 點擊照片打開 detail inspector，確認完整 metadata、使用提醒、Flickr、大圖、原圖與 Sheets 連結都可用。
5. 加入 3 張候選，確認右側候選數量、縮圖與移除功能正常。
6. 複製候選清單，確認 IM 討論版只輸出編號與 Flickr URL。

通過條件：使用者不需要離開桌面工作台即可完成搜尋、判斷、候選與分享。

### 網站 hero 找圖

1. 選擇網站 hero / 橫幅相關任務。
2. 套用方向、留白或裁切相關篩選。
3. 檢查推薦排序是否優先呈現較適合橫幅、留白或裁切的照片。
4. 在 detail 檢查照片尺寸與來源連結。

通過條件：桌面版沒有把手機 sheet 模式套到主要工作流；篩選與 detail 不需要反覆打開遮罩。

### 贊助成果找圖

1. 選擇贊助成果或贊助提案相關任務。
2. 使用贊助品項、贊助價值或場景篩選。
3. 檢查卡片第一層可快速判斷是否值得打開 detail。
4. 用候選清單複製協作檢查版，確認 Sheets 列連結與整理狀態可供後續查核。

通過條件：贊助工作可同時完成探索、證據確認與跨角色交接。

## 手機人工腳本

建議 viewport：390 x 844。

### 第一次進入

1. 開啟 Finder，確認第一屏優先看到搜尋與照片結果，而不是展開的大量任務或篩選欄位。
2. 確認底部固定顯示「篩選」與「候選 N」入口，捲到結果後方仍可操作。
3. 檢查照片卡片第一層資訊密度：應能在一個畫面快速瀏覽，不應把完整 detail 塞回卡片。

通過條件：使用者能理解這是找照片工具，並能直接開始挑選。

### 篩選 sheet

1. 點擊底部「篩選」。
2. 確認 sheet 開啟後不自動彈出鍵盤，預設焦點不遮擋底部欄位。
3. 展開靠近畫面底部的篩選項目，確認選單仍在可視範圍內且可捲動選取。
4. 選取多個項目後，確認選單不會把整個頁面捲回清單開頭。
5. 下滑 sheet 內容區或使用右上角關閉，確認都可關閉。

通過條件：手機篩選以 sheet 內互動完成，不依賴瀏覽器原生 select 或不可控彈出層。

### 候選 sheet

1. 加入 2 到 3 張候選。
2. 點擊底部「候選 N」。
3. 確認候選 sheet 有縮圖、移除、複製與分享工作流。
4. 下滑 sheet 內容區或使用右上角關閉，確認都可關閉。

通過條件：候選清單可以在手機快速確認與分享，不需要記憶 photo id。

### Preview / detail

1. 點擊照片圖片或「預覽」提示開啟 preview/detail。
2. 確認 preview actions 在手機底部黏著，不需要捲到底才可按。
3. 點擊 preview image 的 Flickr 提示，確認開啟 Flickr 照片頁，而不是原圖檔案。
4. 下滑整個 preview dialog，確認可以關閉。
5. 檢查 preview actions 的 icon 與文字順序和卡片 actions 一致。

通過條件：手機 detail 不阻礙快速回到結果，也保留必要來源操作。

## 大資料腳本

大資料驗收不應依賴正式 Sheets 即時資料量。使用 synthetic 10k 級資料確認搜尋、篩選與排序核心，並使用 responsive check 確認 UI 不一次 render 全部卡片。

```bash
pnpm finder:performance:check
```

通過條件：

- 首批只 render 固定頁數照片卡。
- 搜尋、篩選、推薦排序與探索排序在 10k 級資料下維持可接受時間。
- load more 才增加畫面卡片數量。

目前 `pnpm finder:performance:check` 驗證的是 10k 級搜尋/排序核心；DOM 層「首批不超過 page size、load more 才增加卡片」仍需人工或後續 browser harness 驗證，不能只靠此指令代表完整 UI 壓力測試。

## Analytics 腳本

1. 開啟 GA4 DebugView 或本機 no-op 模式。
2. 執行任務切換、搜尋、preview、候選加入、候選移除、候選複製、AI prompt 複製與 Sheets 開啟。
3. 檢查 event parameters：
   - 不包含完整自由文字搜尋。
   - 不包含 photo id、完整 filter JSON 或完整 URL。
   - `surface` 能區分 desktop / mobile。
   - event name 與 parameter 維持低基數。

通過條件：事件足以分析使用流程瓶頸，但不能把照片資料或使用者輸入完整送出。

## 回歸紀錄原則

每次人工或代理 QA 後，應記錄：

- 測試日期與 commit hash。
- 資料來源：fixture、export 或正式 Sheets。
- viewport 與瀏覽器。
- 通過情境。
- 阻礙找圖任務的問題。
- 已納入的修正 commit，或明確延後原因。
