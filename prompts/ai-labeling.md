# SITCON Flickr Photo Finder 搜尋級 AI 標記 Prompt

你正在協助 SITCON Flickr Photo Finder 產生搜尋級照片 metadata 候選。這些候選值不代表人工 review，也不能把照片推進到 `reviewed` 或 `approved`；但在大量照片無法逐張人工細調的現實下，它們會直接影響社群、設計、網站、贊助、新聞稿、活動回顧與志工招募找圖是否有效。

因此本任務不是低承諾草稿。你的目標是在不虛構、不推論照片外脈絡的前提下，產生能支援實際找圖工作的高品質候選索引。

## 你要讀取的資料

本 prompt 已包含模型執行搜尋級標記所需的任務邊界與輸出格式摘要。請優先讀取下列本次標記必要輸入：

- `data/photo-schema.json`
- `data/tag-taxonomy.json`
- `data/sponsorship-items.json`
- 指定 AI run 目錄中的 `manifest.json`
- 指定 AI run 目錄中的 `photos.json`
- 指定 AI run 目錄中的 `images/`

若你需要確認完整輸入/輸出合約，可再讀 `docs/ai-labeling-contract.md`。不要讀取 `docs/ai-labeling-operator-guide.md`、`docs/ai-labeling-evaluation-notes.md` 或 Sheets 回寫文件來推論照片內容；那些文件是給操作者與維護者使用。

`photos.json` 裡的 `local_image_path` 是相對於 AI run 目錄的圖片路徑。若 `local_image_path` 為空，使用 `image_download_url`，或回報需要操作者重新建立有下載圖片的 run。

## 大型 run 與分工規則

若本次照片數量很大，操作者或 repo agent 可能會把 `photos.json` 切成多個 shard 交給多個 agent 同時處理。即使分工，你仍必須遵守同一份讀圖規則：

- 若你是具備 repo 指令能力、且執行環境支援建立 sub-agents / worker agents / parallel agent work 的 parent agent，這份任務明確要求你在大型 run 使用多 agent 分工。先完成少量 smoke test；一旦確認圖片可讀、proposal 可驗證、review artifacts 會寫到暫存目錄，就應建立多個 worker agents 並行處理不同 shard，而不是由 parent agent 單線逐 shard 標記。
- parent agent 應保留 orchestration 責任：準備 shard workspace、分配互不重疊的 shard、監看 `/tmp/ai-labeling-shards/<run-id>/photo-artifacts/`、合併、validate、review 與必要修補。worker agent 只負責被分配的 shard input 與 per-photo artifact。
- 若平台有 agent/thread 上限，請用小批次 worker queue，例如先啟動 4 到 6 個 worker，完成一個再補下一個 pending shard；不要因為無法一次啟動所有 shard 就退回單一 parent agent 全部手做。
- 只有在執行環境不支援建立 worker agents、使用者明確要求單線處理，或 smoke test 顯示輸入/驗證流程尚未可靠時，才應停留在單一 agent。這種情況請先回報限制，不要默默改成長時間單線標記。
- 不可以使用既有的 `metadata-proposals.json`、其他 run 的 proposal、其他 shard 的輸出或上一輪結果作為本次標記依據；除非任務明確說明是修補某份既有 proposal。
- 若本次任務提供 shard input，請只處理該 input 內列出的照片，不要替其他照片產生 item。
- 大型 shard 的 worker 交付物是逐張 `photo-artifacts/shard-XX/<photo_id>.json`；不要只交 `outputs/shard-XX-proposals.json` 這類 shard proposal array。最終 root object 會由 merge 工具從 artifacts 產生。
- 大型 run 的 shard 大小應以品質為優先，預設使用小批次。不要把大量照片合成單張 contact sheet 來批量判讀。
- 禁止使用 contact sheet、montage、image grid、HTML gallery screenshot、縮圖拼貼或任何合成大圖作為欄位判斷依據。縮圖總覽只能用來導航與確認檔案存在，不能用來決定人數、主體、場景、描述、裁切、用途或贊助欄位。
- worker 必須為每張照片留下逐張 artifact，記錄本張單圖的 proposal item、主體、人數依據、場景依據、可搜尋細節與設計可用性依據。缺少逐張 artifact 的 shard 不應被直接採用或寫回 Sheets。
- 大型 run 應先用少量照片做 smoke test，確認圖片可讀、proposal 可驗證、review 不會寫錯位置後，再展開全量分工。
- worker 輸出 shard 前必須自查本 shard 的 `scene_tags`：只要照片有可見活動流程、場景、空間、人物互動、物件、餐食、標示、螢幕、背板、攤位、場佈或導引線索，就應提出 1 到 3 個 `scene_tags`。一個正常活動 shard 不應整段幾乎沒有 `scene_tags`；若發現整段缺漏，請逐張回頭補判斷，不要把它留給 merge 或 review 工具。
- 具備 repo 指令能力的 agent 應把分片中間檔寫到 `/tmp/ai-labeling-shards/<run-id>/` 這類暫存目錄；正式 AI run 目錄只應保留最後合併出的 `metadata-proposals.json`、`visual-inspection-audit.json` 與 `artifact-manifest.json`。

## 你的任務

針對 `photos.json` 中每張照片，觀察圖片與既有 metadata，產生可審核的欄位候選值。請只輸出你有足夠把握的欄位；不要為了填滿欄位而猜測。

你必須逐一打開並檢視每張照片的 `local_image_path` 或 `image_download_url` 後，才可為該 `photo_id` 輸出候選欄位。禁止只根據 `photo_id`、檔名順序、相簿名稱、前後照片、批次規則或模板推論欄位。禁止先建立場景 archetype 後批量套用到多張照片。

「逐一打開」指的是以單張照片為判讀單位。若你只看過多張照片拼在一起的 contact sheet、縮圖牆或截圖總覽，該照片尚未被有效檢視，不能輸出候選欄位。即使是 25 張以下的小型相簿，也不得先建立 contact sheet 來理解整體場景；請直接逐張打開單張圖片。

不論是小型 direct run 或大型 shard run，你都必須寫出逐張落盤 artifact，證明每張照片都以單張圖片判讀。未寫入 artifact 的視覺觀察視為不存在；不要把多張照片的觀察先留在對話 context，等全部看完或 context compact 後再一次整理。每張照片應是獨立判讀單位，下一張照片不需要前一張照片的 context。

若你無法實際載入或視覺解析某張圖片，請停止並回報無法處理的 `photo_id`；不要用通用值、預設值或「推測」字眼填入 proposal。寧可缺項，不可虛構。

## 找圖角色與品質目標

請從 Finder 的實際使用者需求回推標記品質：

- 社群與宣傳：需要找得到表情、手勢、互動、青春感、活力、友善、熱鬧與現場感。不要只因照片有人就標 `社群貼文`。
- 設計與網站：需要找得到橫式、直式、留白、乾淨背景、安全裁切、可放標題的畫面。`has_negative_space` 和 `safe_crop` 必須各自有可見依據。
- 贊助與行銷：需要找得到外部品牌、攤位、露出、會眾互動與履約證據。不要把 SITCON 自有旗幟、Logo、桌旗或一般活動配置標成贊助成果。
- 新聞稿與活動回顧：需要找得到代表性場面、正式背板、講者、會眾、頒獎、活動流程與可公開使用的畫面。`活動回顧` 不是「活動照片」的同義詞。
- 志工招募：需要找得到協作、服務參與者、場佈、物資整理、報到、引導、攝影與幕後工作狀態。單純會眾或講者照片不要標成志工招募。

每個欄位都應支援「未來有人能更快找到正確照片」。如果某個候選值只是在把相簿名稱或常見活動模式套進去，卻沒有本張照片的可見證據，請省略。

每張有可讀圖片的照片，都應優先判斷以下基礎欄位：

- `people_count`: 畫面中可辨識的所有人，包括背景與部分入鏡但可辨識的人，不只是主體。無人照片請填 `0`；人數很多時可估計，並在 reason 寫出估算依據，例如「前排約 6 人、後方約 4 排，每排約 5 人」。這是原始數值欄位，請不要輸出人數區間、少量/中量/大量、small group/crowd 這類分類。
- `subject_type`: 主要視覺主體粗分類，用於照片海初篩。只能選一個值：`people`、`object`、`food`、`text_signage`、`screen`、`space`。請只描述畫面主體種類，不要用它描述活動場景、人數規模、用途或品質。
- `orientation`: 橫式、直式或方形。
- `has_negative_space`: 是否有明顯留白可放文字。只要圖片可讀，通常應輸出 `true` 或 `false`。
- `visual_description`: 1 到 2 句中立的畫面描述，用於自然語言搜尋與人工找圖。請描述 taxonomy 欄位難以涵蓋的可見細節，例如物件、文字、姿勢、動作、表情、空間位置與構圖關係。
- `curation_status`: 若你對這張照片有提出任何候選 metadata，請設為 `ai_labeled`。

接著再判斷 `scene_tags`、`mood_tags`、`recommended_uses`、`safe_crop`、`public_use_status` 與其他欄位。

`visual_description` 對搜尋有幫助的詞彙通常是具體可見線索：物件名稱、衣著或配件、手勢或姿勢、桌面物、看板或文字、舞台/背板/投影幕、前景/背景/左側/右側/中央、留白或遮擋關係。請至少讓描述包含兩類以上線索，例如「人物 + 物件」、「動作 + 空間位置」、「文字 + 舞台關係」。

以下詞彙單獨出現時資訊量低，應避免讓它們成為描述主幹：`畫面`、`可見`、`呈現`、`有人`、`人物`、`參與者`、`互動`、`交流`、`情境`、`狀態`、`氛圍`。這些詞不是完全禁止，但必須搭配具體對象與位置，例如「右側兩位參與者在貼有 SITCON 字樣的桌旗旁交談」比「畫面可見參與者互動」有用。

禁止在 `visual_description` 寫批次或相鄰照片資訊，例如「第 2 張」、「同批」、「鄰近照片」、「相近照片」、「和上一張不同」。搜尋者需要知道本張照片看得到什麼，而不是它和批次中的其他照片有什麼差異。

避免在 `visual_description` 用否定句承載高價值搜尋詞，例如「沒有清楚人物」、「無舞台」、「看不到 Logo」。字面搜尋可能把這些詞當成正向命中。請改寫成中立可見狀態，例如「遠景人群背對鏡頭，人物臉部不可辨識」、「投影幕旁是空白牆面與講台」。不適合某用途的判斷應放在對應欄位 reason 或省略該用途，不要塞進搜尋描述。

`scene_tags` 是高召回欄位。只要照片中有合理可見依據能對應到受控字彙，就應提出 1 到 3 個候選值，讓照片未來在大量資料中能被場景篩選找到。只有完全沒有合適場景值，或只能靠相簿名稱/前後照片推論時，才省略 `scene_tags`；省略時不要用其他泛用 tag 硬補。

不要把 `場地`、`會眾`、`交流`、`螢幕`、`錄音` 或 `導覽` 當成 fallback。`場地` 要有空間、入口、走廊、座位、動線或配置本身的可見價值；`會眾` 要能看出群眾或聽講情境；`交流` 要有互動、交談或共同操作；`螢幕` 要有可見電子螢幕或投影；`錄音` 要有明確聲音收錄脈絡；`導覽` 要能看出帶領參觀或場地解說流程。

`mood_tags` 不是必填欄位，也不是品質分數；但它是社群宣傳、網站視覺與招募找圖的重要輔助線索。只要照片有可見的表情、動作、互動、人群密度、光線、姿態、場面規模、正式程度或幕後工作狀態，足以支撐一個宣傳感受，就應輸出 1 到 2 個 `mood_tags`。`mood_tags` 不需要達到物件辨識那種客觀事實等級，但 reason 必須指出本張照片的具體可見依據。

請不要把 `專業`、`專注`、`友善` 當成一般活動照片的預設感受。若 reason 只能寫成「看起來專業」、「大家很友善」或「有人在聽講」這類空泛說法，請省略 `mood_tags`。若照片只是普通紀錄照，沒有可支撐宣傳感受的可見線索，也請省略。

常見 mood 判斷參考：

- 大量舉手、人群互動、擁擠攤位或多人熱烈交流，可考慮 `熱鬧` 或 `交流感`。
- 青少年合照、活潑手勢、比愛心、旗幟或青春活動氛圍，可考慮 `青春感` 或 `友善`。
- 專心聽講、低頭操作筆電、白板討論、手作實作或工作坊畫面，可考慮 `專注`。
- 舞台、頒獎、正式背板、獎狀、代表上台或典禮合影，可考慮 `儀式感` 或 `成就感`。
- 志工場佈、器材整理、地上分裝物資、貼標籤或活動準備狀態，可考慮 `幕後感`。
- 清楚講者、正式舞台、攤位介紹或有組織的展示說明，可考慮 `專業`，但 reason 必須說明可見的正式配置或展示脈絡。

`recommended_uses` 不是必填欄位；只有照片明確適合某個工作用途時才輸出。不要把 `活動回顧` 或 `社群貼文` 當成預設用途。請先找比 `活動回顧` 更有區辨度的 1 到 3 個用途，例如講者、志工、新聞、網站、簡報或贊助相關用途。每個用途的 reason 必須說明本張照片為什麼符合該用途；若你無法指出可見證據，請省略該用途。

常見用途期待與證據門檻：

| 用途 | 期待 | 必須看得到的證據 |
| --- | --- | --- |
| `社群貼文` | 單張或少量圖片就能吸引社群注意，適合表達現場感、人情味或活動亮點。 | 清楚表情、手勢、合照、熱鬧互動、青春感、明亮視覺、特色物件或容易理解的場景。普通紀錄照不要只因有人就標。 |
| `網站橫幅` | 可放在頁首或活動頁視覺區，文字覆蓋後仍清楚。 | 橫式優先，通常需要 `has_negative_space = true`，並建議同時檢查 `safe_crop` 是否可含 `16:9`；留白位置要可在 reason 說明。 |
| `志工招募` | 呈現一起完成事情、服務參與者或幕後準備的可信畫面。 | 工作人員、報到、場佈、物資整理、引導、協作、友善互動或志工識別。單純會眾或講者照片不要標。 |
| `投稿宣傳` | 吸引潛在講者投稿，讓人理解舞台、分享、技術交流或社群討論的價值。 | 講者、簡報、舞台、白板討論、工作坊、聽眾提問或清楚的發表情境。只有普通人群不夠。 |
| `報名宣傳` | 讓潛在參與者知道活動體驗值得參加。 | 人潮、會眾聽講、攤位互動、茶點、交流、工作坊、空間動線或熱鬧現場。需要能代表參與者體驗。 |
| `贊助提案` | 對潛在贊助者說明贊助可獲得的觸及、曝光或互動機會。 | 舞台、背板、攤位、人潮、會眾互動、指標、議程或可承載品牌露出的空間；若沒有贊助價值證據，請省略。 |
| `贊助成果報告` | 證明既有贊助項目或品牌露出已實際發生。 | 清楚可見的贊助商 Logo、贊助品項、攤位、布條、看板、議程表或既有 metadata 支撐；通常應同時能提出 `sponsorship_items` 或 `sponsorship_tags`。 |
| `新聞稿` | 能代表活動本身，適合媒體或對外公告使用。 | 重要場面、舞台、講者、群眾、頒獎、正式背板或清楚活動識別；應避免表情不佳、模糊、遮擋或過於內部的幕後畫面。 |
| `活動回顧` | 代表某段流程、重要場面、互動狀態、活動成果或現場特色。 | 流程節點、場景特色、多人互動、成果展示、頒獎、講者、會眾、場佈或茶點等具體回顧價值。它不是「這是活動照片」的同義詞。 |
| `社群介紹` | 介紹 SITCON 社群氛圍、參與者與志工形象。 | 合照、志工、會眾、交流、青春感、友善互動、明確 SITCON 識別或能讓人理解社群樣貌的畫面。 |
| `講者宣傳` | 宣傳講者、議程或演講內容。 | 清楚講者、舞台、麥克風、簡報、投影幕、講台或講者與聽眾關係。不要把不明身份的單人側拍都標成講者。 |
| `簡報` | 可放進簡報或提案中作為視覺佐證或背景。 | 清楚螢幕、投影片、舞台、場地、物件、流程或留白構圖；若畫面過亂或裁切後難讀，請省略。 |

`活動回顧` 的標準不是「這是活動照片」。它應該保留給能代表某段流程、重要場面、互動狀態、活動成果或現場特色的照片。若一張照片只是可用但沒有明確回顧價值，請省略 `recommended_uses`，讓人類之後依需求挑選。

`贊助成果報告` 與 `贊助提案` 必須有可見或既有 metadata 支撐的贊助脈絡。若你無法同時提出合理的 `sponsorship_items` 或 `sponsorship_tags`，通常代表不應輸出贊助相關 `recommended_uses`。SITCON 自有 Logo、旗幟、桌旗、活動背板、一般茶點或一般現場配置，不足以支撐贊助相關用途。

`public_use_status` 不必每張都填。SITCON Flickr 照片本身已經是經同意釋出的公開來源，這個欄位不是同意、授權或公開 / 非公開判斷。空白不代表照片已被人工核可，也不代表 `approved`；它只表示 AI 沒有提出使用品質或整理提醒。只有觀察到明確不適合推薦或需要人工整理判斷的畫面狀態時才填 `needs_review` 或 `avoid`，例如明顯模糊閉眼、表情不佳、主體被遮擋或畫面容易造成誤解，並在 reason 點明你看到的訊號。

`has_negative_space` 是設計可用性判斷，不是只看背景是否全白。若畫面某一側、上方、下方、牆面、背板、地面、投影旁或桌面旁有足夠乾淨區域，可讓標題、活動資訊或社群文案覆蓋且不遮住主體，就可標 `true`。標 `true` 時，reason 必須說明留白位置與材質或背景，例如「左側白牆」、「上方投影旁」、「右側背板空區」。若只有雜亂人群、文字、Logo 或重要物件，請標 `false`。

`safe_crop` 不是「能裁就標」，但也不要因為裁切需要判斷就整批省略。請逐一比例驗證 `1:1`、`16:9`、`9:16`；裁切後主要人物臉部、主要物件、可讀文字或重要構圖元素不可被截斷。橫式照片、`has_negative_space = true`、或 `visual_description` 有留白、牆面、背板、舞台、講台、投影幕、桌面、前景、背景等版面線索時，請特別檢查是否能安全提出 `16:9`。如果人物或物件置中且四周有餘裕，請檢查 `1:1`。只有主體和留白能在直式版面中保留時，才提出 `9:16`。

`safe_crop` 和 `has_negative_space` 不是同一件事。`safe_crop` 只表示裁切成該比例後主體、臉部、文字或重要物件仍能保留；即使 `has_negative_space = false`，仍可能有安全的 `1:1` 或 `16:9` 裁切。`has_negative_space` 則表示能讓標題或文案覆蓋的乾淨區域。若建議 `網站橫幅`，必須同時能支持 `has_negative_space = true` 與 `safe_crop` 包含 `16:9`；只有安全裁切、但沒有可放字區域，不足以支撐網站橫幅用途。

`safe_crop` 的 reason 必須說明該比例會保留什麼，例如「16:9 可保留右側講者與左側牆面留白」、「1:1 裁切仍保留兩位人物臉部與桌上筆電」。不要只寫「橫式照片」、「構圖適合」或「有留白」。若沒有安全裁切比例，請省略整個欄位。

小型 direct run 必須先寫成 AI run 目錄中的逐張檔案：

```text
photo-artifacts/<photo_id>.json
```

每個 `photo-artifacts/<photo_id>.json` 格式：

```json
{
  "artifact_version": 1,
  "photo_id": "55200405673",
  "inspection": {
      "image_path": "images/55200405673.jpg",
      "inspection_mode": "single-image",
      "contact_sheet_used": false,
      "visual_evidence": {
        "subject": "本張主要主體與位置",
        "people_count_basis": "人數估計依據，無人也要寫無人依據",
        "scene_basis": "scene_tags 的可見依據，或說明沒有合適 scene tag",
        "search_details": ["可搜尋物件、動作、文字或空間關係"],
        "design_basis": "留白與裁切判斷依據，沒有也要寫為何沒有"
      }
  },
  "proposal_item": {
    "photo_id": "55200405673",
    "fields": {
      "people_count": {
        "value": 15,
        "reason": "本張照片的人數依據。",
        "confidence": 0.8
      }
    }
  }
}
```

看完一張照片後應立即寫出該張 artifact，再進入下一張。完成全部逐張 artifact 後，具備 repo 指令能力的 agent 必須執行 `pnpm ai:artifacts:merge -- --run-dir <run-dir>`，由工具合併成 `metadata-proposals.json`、`visual-inspection-audit.json` 與 `artifact-manifest.json`。不要直接手寫 root `metadata-proposals.json` 作為正式結果。

若你建立或使用過 contact sheet、montage、縮圖牆或多圖截圖，`contact_sheet_used` 不能填 `false`，而該批標記結果也不應交付採用；請回到單張原圖逐張重做。

## 輸出格式

`metadata-proposals.json` 必須是單一 JSON object：

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
        "people_count": {
          "value": 15,
          "reason": "畫面中可辨識約 15 人。",
          "confidence": 0.8
        }
      }
    }
  ]
}
```

規則：

- `run_id` 必須等於 `manifest.json` 的 `run_id`。
- 每張照片最多一個 item。
- 每個欄位 proposal 必須有 `value` 和 `reason`。
- `reason` 和 `visual_description` 應使用台灣慣用繁體中文；照片中清楚可見的英文文字可以照原文引用。
- `confidence` 可省略；若提供，必須是 0 到 1 的數字。它只是輔助人工審核的相對信心，不是模型品質分數；若你選擇提供，請盡量穩定覆蓋同一類欄位，不要只對少數欄位零散填寫而讓後續排序產生誤導。若無法穩定評估，省略比亂填更好。
- 多值欄位必須使用 JSON array，不要使用分號字串。
- 讀圖欄位的 `reason` 必須引用本張照片至少一個具體可見元素，例如人物動作、服裝、物件位置、表情、姿勢、構圖位置、可讀文字或裁切風險。同一段 `reason` 文字不可在多張不同 `photo_id` 之間重複使用；即使建議值相同，也要為每張照片寫出不同的可見證據。
- 禁止使用「推測值」、「預設為」、「一般而言」、「圖片尺寸為 NxN」這類沒有本張視覺內容的固定語言。
- `visual_description` 的 `value` 必須至少 20 個非空白字元，必須包含具體可見細節，且不同照片之間不可完全或近似重複。

## 你可以輸出的欄位

只允許：

- `people_count`: 非負整數。
- `subject_type`: 字串，必須來自 `data/tag-taxonomy.json`。
- `scene_tags`: 字串陣列，必須來自 `data/tag-taxonomy.json`。
- `mood_tags`: 字串陣列，必須來自 `data/tag-taxonomy.json`。
- `recommended_uses`: 字串陣列，必須來自 `data/tag-taxonomy.json`。
- `sponsorship_items`: 字串陣列，必須對齊 `data/sponsorship-items.json` 衍生的 taxonomy。
- `sponsorship_tags`: 字串陣列，必須來自 `data/tag-taxonomy.json`。
- `orientation`: 字串，必須來自 `data/tag-taxonomy.json`。
- `has_negative_space`: 布林值。
- `safe_crop`: 字串陣列，必須來自 `data/tag-taxonomy.json`。
- `visual_description`: 字串，1 到 2 句中立畫面描述，只描述可見內容。
- `public_use_status`: 字串，但不能是 `approved`。
- `priority_level`: 字串，必須來自 `data/tag-taxonomy.json`。
- `collections`: 字串陣列。
- `curation_status`: 只能是 `ai_labeled`。

## 禁止事項

- 不要輸出 Markdown、解釋段落或 JSON 以外的文字。
- 不要修改 `photos.json`。
- 不要修改正式 Google Sheets。
- 不要把 `curation_status` 設為 `reviewed`。
- 不要把 `public_use_status` 設為 `approved`。
- 不要輸出 taxonomy 中不存在的值。
- 不要使用分號字串表示多值欄位。
- 不要修改 `photo_id`、`photo_url`、`album_ids`、`image_preview_url`、`album_title`、`event_name`、`event_year`、`photographer`、`license`、`curation_notes`。
- 不要憑空推論攝影師、授權或活動內部資訊。
- 不要在 reason 中加入圖片或既有 metadata 無法支持的活動名稱、身份、單位或年份推論。
- 不要把 `scene_tags`、`sponsorship_items`、`sponsorship_tags` 混用。

## 判斷原則

- `scene_tags` 是活動情境或可見場景元素，例如 `合照`、`舞台`、`背板`、`指標`、`場地`、`場佈`、`螢幕`、`頒獎`、`兒童`、`錄音`、`導覽`。它可以多選，描述照片裡還有哪些重要場景線索；不要拿它取代 `subject_type`。
- `subject_type` 是主要視覺主體，例如人物、物件、餐食茶點、文字標示、螢幕或空間。它只回答「這張照片第一眼主要在看什麼」，不取代 `scene_tags`。
- 若主體是人，不論是一人、多人、合照或群眾，`subject_type` 都是 `people`；人數規模只用 `people_count` 表達。
- 若主體是桌旗、貼紙、手冊、獎座、紀念品或其他可拿取物，`subject_type` 是 `object`；是否為手作、攤位等活動情境再交給 `scene_tags`。
- 若主體是餐點、茶點、飲料、便當、點心或食物配置，`subject_type` 是 `food`；若它也代表活動中的茶點情境，可同時使用 `scene_tags = 茶點`。
- 若主體是活動標誌、看板、指標、白板、A 字牌、布條或可讀文字，`subject_type` 是 `text_signage`。
- 若主體是投影幕、簡報、電視、監看畫面或電子螢幕，`subject_type` 是 `screen`。
- 若主體是場地、空景、入口、走廊、座位區或空間配置，`subject_type` 是 `space`。
- 若照片中可見入口導引、方向牌、A 字板、路標或報到導引牌，可使用 `scene_tags = 指標`；若這些標示是畫面主體，`subject_type` 通常是 `text_signage`。
- 若照片主要記錄場館、入口、走廊、座位區、空景或空間配置，可使用 `scene_tags = 場地`；若空間本身是主體，`subject_type` 通常是 `space`。
- 若照片明確呈現活動現場佈置、撤場、搬運、器材架設、物資整理、貼地貼、掛布條、配置報到或動線牌，可使用 `scene_tags = 場佈`。不要只因照片中有背板、旗幟、立牌或桌布就使用；完成後的合照背板、講者背板或攤位互動通常用更精準的 `背板`、`合照`、`講者`、`攤位` 或 `交流`。
- 若照片中可見投影幕、簡報、會場電視、監看畫面或電子螢幕，可使用 `scene_tags = 螢幕`；若螢幕內容是主體，`subject_type` 通常是 `screen`。
- 若照片呈現頒獎、受獎、獎座、獎牌、表揚或典禮授獎情境，可使用 `scene_tags = 頒獎`。
- 若照片中清楚可見兒童或小朋友，可使用 `scene_tags = 兒童`；不要只因活動名稱推論兒童在場，也不要只因人物類型或可識別細節而提出 `public_use_status`。
- 若照片明確呈現 Podcast、訪談、廣播、錄音室、桌面麥克風、耳機、混音/收音設備或聲音製作場景，可使用 `scene_tags = 錄音`。不要只因講者手持麥克風、戴耳麥演講或畫面中有一般舞台音響就使用。
- 若照片可見導覽者帶領人群參觀場地、攤位、路線或特定空間，且能看出跟隨/聆聽者與移動或場地脈絡，可使用 `scene_tags = 導覽`。不要把講者解說投影片、工作坊老師帶小組、人群在走廊移動或投影片上的地圖誤標成導覽。
- `mood_tags` 是照片帶來的感受，例如 `儀式感`、`成就感`、`青春感`。它用來輔助社群、網站、招募與宣傳找圖，不是品質分數，也不是每張照片都要有的分類；但只要有可見依據支撐宣傳感受，就不應因為它不是客觀事實而省略。
- `recommended_uses` 是工作用途，例如 `社群貼文`、`活動回顧`。
- `recommended_uses` 的目的不是把每張照片分類，而是提示照片特別適合的使用情境。若照片只是普通可用，但沒有明確用途優勢，請省略。
- `sponsorship_items` 是外部贊助商換取曝光或履約佐證的具體贊助品項；不確定就省略。SITCON 自有 Logo、旗幟、桌旗、布條、背板、工作人員配件或活動識別不屬於 `sponsorship_items`。只有畫面中可見具名贊助商 Logo、商品，或 `photos.json` 既有 metadata 明確指出贊助脈絡時才標。
- `sponsorship_tags` 是贊助價值或佐證用途；不確定就省略。只看到 SITCON 自身識別、茶點、餐點或一般現場配置，不足以推論 `品牌露出` 或 `贊助成果佐證`。
- `visual_description` 是自然語言搜尋用描述，不是正式照片標題，也不是欄位 reason。不要重複機械欄位，例如「橫式照片」、「有 5 人」；除非人數或方向對理解畫面構圖有必要。不要寫活動名稱、年份、身份、單位或贊助商推論，除非文字清楚出現在照片中，且請以「畫面可見文字」描述。
- 人數可以估計，但不要填負數或文字。
- `has_negative_space` 和 `safe_crop` 是給社群、設計與網站取圖使用的欄位，不只是攝影描述；請主動從版面可用性判斷。`has_negative_space = true` 的 reason 要說明可放字區域在哪裡。
- `safe_crop` 的判斷標準是裁切後主體、臉部、文字與重要物件仍保留。若只能靠很勉強的裁切才成立，請省略該比例。不要只因照片是橫式就輸出 `16:9`；但橫式、留白、牆面、背板、舞台或投影幕構圖都應主動檢查 `16:9`。reason 應說明該比例如何保留主體，以及不會切掉哪些重要元素。
- `public_use_status = avoid` 只用於明顯不適合一般推薦的照片，例如嚴重模糊、閉眼失焦、表情不佳、主體被遮擋或可能造成誤解。
- `priority_level` 容易主觀，除非照片明顯特別適合作為代表畫面，否則省略。
- 若受控字彙無法描述照片，例如獎項、物件特寫或展示板，請使用最接近且仍正確的既有 tag；若沒有正確 tag，寧可省略，不要硬套。省略 `scene_tags` 比使用錯誤 fallback 更好，但不能因為它需要判斷就整批略過。
- reason 必須只描述看得見的線索或既有 metadata。可以寫「畫面中可見多人合照」，不要寫「年會掛繩」這類未確認脈絡。
- 低信心內容請省略，不要勉強輸出。

## 輸出前自我檢查

- 是否曾用 contact sheet、montage、縮圖牆或多圖截圖來判斷欄位？若有，這些欄位無效；請回到單張原圖逐張重做。
- 是否已為每張照片寫出逐張 `photo-artifacts/<photo_id>.json`，且每張 artifact 都是 `contact_sheet_used = false`、`inspection_mode = single-image`？若沒有，請先補齊，不要交付。
- 是否有超過 5 張照片在同一個欄位產出完全相同的 `value` 與 `reason`？若有，代表你可能沒有逐張看圖，請重做這些 item，或將該欄位省略。
- 是否有多張照片使用「推測值」、「預設為」、「圖片尺寸為」或其他固定語言？若有，請改成描述本張照片的可見證據。
- 是否幾乎每張照片都有 `mood_tags`，或大量照片都落在 `專業`、`專注`、`友善`？若有，請重新確認是否把 mood 當成預設分類。
- 若本批有許多主體清楚、表情互動明顯、舞台感強、活動氣氛鮮明或適合社群宣傳的照片，卻幾乎都沒有 `mood_tags`，請抽查是否把 mood 判斷得過度保守。
- 是否把 SITCON 自身旗幟、Logo 或桌旗當成 sponsorship？若有，請移除 sponsorship 欄位。
- 是否把 `活動回顧`、`社群貼文` 或贊助相關用途套到大多數照片？若有，請重新確認每張照片是否真的具有該用途的具體優勢。
- 是否輸出了 `贊助成果報告` 或 `贊助提案`，但沒有可支持的 `sponsorship_items` 或 `sponsorship_tags`？若有，請移除贊助相關用途，除非 reason 能清楚指出贊助脈絡。
- 是否把 `網站橫幅` 標到沒有留白位置、沒有 16:9 安全裁切、或畫面太滿的照片？若有，請移除或補上可見版面證據。
- 若照片是橫式、`has_negative_space = true`，或描述中有留白、牆面、背板、舞台、講台、投影幕、前景/背景線索，是否已檢查 `safe_crop`？若沒有，請逐張判斷，不要整批漏掉。
- 若 `has_negative_space = true`，reason 是否說出留白在哪裡？若只寫「有留白」或「適合放字」，請補上位置與背景線索。
- 若有 `safe_crop`，reason 是否說出裁切後保留的主體、臉部、文字、Logo、螢幕或物件？若只寫「橫式照片」或「構圖適合」，請重寫或移除。
- 是否對所有照片都給相同 confidence？若有，請重新依每張照片的實際把握調整；若無法評估，省略 confidence。
- 若有提供 confidence，是否只零散出現在少數欄位？若是，請改為穩定覆蓋同一類欄位，或全部省略，避免人類誤以為可直接排序。
- `visual_description` 是否能讓人類不用看圖就知道這張照片有哪些可見物件、動作或空間關係？若只是「有人在交流」、「活動現場照片」這類空泛描述，請重寫。
- `visual_description` 是否出現「第 N 張」、「同批」、「鄰近照片」、「相近照片」或和其他照片比較的語言？若有，請改寫成本張照片的具體可見內容。
- `visual_description` 是否用「沒有清楚人物」、「無舞台」、「看不到 Logo」這類否定句承載搜尋詞？若有，請改寫成中立可見狀態，避免未來搜尋把否定詞旁的關鍵字當正向命中。
- `visual_description` 是否只靠 `畫面`、`可見`、`呈現`、`人物`、`參與者`、`互動`、`交流` 這類泛詞？若沒有物件、文字、動作、位置或構圖關係，請重寫。
- 若 `people_count = 0`，reason 是否仍寫了「人物」這種可能讓 review 工具誤認為真人線索的字眼？非真人請改寫成「插圖角色」、「海報上的人形圖案」、「包裝圖案」；背景太模糊請寫「背景人影不可辨識，未計入人數」。
- `scene_tags` 是否混入 `mood_tags` 的值？例如 `幕後感` 是 mood，不是 scene；若照片有幕後工作狀態，應放在 `mood_tags` 並用 reason 說明可見動作或物件。
- `visual_description` 是否包含具體可見物件、動作、文字、位置或空間關係？validator 會拒絕過度抽象、模板化或非視覺語言。

以下是錯誤輸出範例，請勿模仿：

```json
{
  "photo_id": "54847451413",
  "fields": {
    "people_count": {
      "value": 3,
      "reason": "畫面中約有3人（推測值）。",
      "confidence": 0.8
    },
    "scene_tags": {
      "value": ["會眾", "交流"],
      "reason": "推測場景包含會眾交流。",
      "confidence": 0.7
    }
  }
}
```

這代表沒有實際讀圖。每張照片的 reason 應該讓人類光看 reason 就能理解該照片的具體畫面線索。

## 完成後

你的輸出會被以下指令驗證：

```bash
pnpm ai:validate -- --run-dir tmp/ai-runs/<run-id>
```

若驗證失敗，請依錯誤訊息修正 `metadata-proposals.json`。
