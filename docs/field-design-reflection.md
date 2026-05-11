# 欄位設計反思紀錄

## 目的

這份文件記錄實際 AI 初標後，回頭檢視 photo schema、taxonomy 與 prompt 是否符合 SITCON 找照片需求的觀察。

早期欄位設計發生在還沒有大量真實標記資料的階段；現在已經有多輪不同活動場景的 AI run，可以用真實照片與標記結果檢查欄位是否真的能幫助人類與 AI 找到可用照片。

這份文件不是 schema 的最終決策。它是設計紀錄，後續仍應根據實際使用、人工整理回饋、模型輸出品質與搜尋體驗持續修正。

## 納入觀察的資料

本輪反思不只看 SITCON 2026 年會全量 run，也納入其他活動場景：

| run | 活動 / 相簿 | 張數 | 觀察重點 |
| --- | --- | ---: | --- |
| `ai-prepare-2026-05-09T20-00-35-981Z` | SITCON 2026 | 1077 | 年會全量、講者、舞台、攤位、合照、贊助與大批量多 worker 一致性 |
| `ai-prepare-2026-05-09T12-15-05-642Z-attempt-claude-r1` | 2025 SITCON Hour of Code 桃園場 | 122 | 兒童工作坊、報到互動、手作物件、場地導引、公開使用風險 |
| `ai-prepare-2026-05-08T22-58-30-741Z-claude` | SITCON 2026 負一籌＋BoF | 132 | 茶點、交流、個人特寫、輕量聚會、非正式場景 |
| `ai-prepare-2026-05-08T20-21-20-337Z` | 教育部青發署第三屆青志獎 | 25 | 頒獎、舞台、合照、背板、合作活動紀錄 |

抽看的代表照片包含：

- `55250547344`：桌上整齊擺放多包綠色點心。AI 標出 `茶點` 與 `贊助成果報告`，但沒有 `sponsorship_items` 或 `sponsorship_tags`。
- `55244869002`：深藍布料上的 `JAM THE CHAOS` 活動標誌特寫。`people_count = 0` 合理，但現有 taxonomy 對「物件 / 素材 / 活動識別」承接不足。
- `55245900948`：三人與 SITCON 標示同框。適合活動介紹或回顧，但不是 sponsorship。
- `55247911036`、`55247933626`：講者與背板同框。適合講者宣傳、新聞稿或活動回顧，但 `safe_crop`、`public_use_status` 與 reason 語言品質需要人工把關。
- `55200405673`：多人合照與 SITCON 旗幟。這類照片的工作用途和「情緒 / 場面」強相關。
- `54847195941`：茶點與 SITCON 小旗。它可能支援活動回顧、現場體驗或贊助佐證，但不能只因食物或旗幟自動推論贊助品項。
- `54978071218`：馬鈴薯、桌旗與人工草皮的手作/活動物件。這類長尾細節很難用 `scene_tags` 表達。
- `54977003667`：報到桌與多名參與者互動。它同時涉及人數、公開使用風險、工作人員、交流與活動流程。

## 確認有效的設計

### `visual_description` 是必要欄位

真實 run 顯示，taxonomy 無法承接所有找圖線索。自然語言找圖常會需要：

- 物件：馬鈴薯、紙箱、雞排桶、桌旗、耳機、講桌、相機。
- 文字：`JAM THE CHAOS`、報到招牌、投影幕文字、場館名稱。
- 動作：整理物資、指著表單、拿麥克風、拍攝、排隊取餐。
- 空間關係：講者在背板前、桌上物品排列、報到桌前互動。

`visual_description` 可以補足這些長尾語料，對未來自然語言搜尋或 embedding 搜尋有實際價值。它應維持為正式欄位，但不應列入 `reviewed_required_fields`，避免增加人工整理負擔。

需要持續要求：

- 使用繁體中文。
- 只描述可見畫面，不補活動身份、年份、單位或贊助推論。
- 不寫宣傳文案，不替照片下標題。
- 不和 reason 混用。`visual_description` 是搜尋語料；reason 是欄位判斷依據。

### `people_count` 應保留原始估計數值

`people_count` 對找圖很有用，因為使用者會找：

- 無人空景或物件照。
- 單人講者。
- 兩到五人的互動。
- 中型工作坊場景。
- 大合照或群眾。

但 AI 對大人數、局部人影、螢幕中人像、被遮擋人物容易不穩。SITCON 2026 全量 run 中，`people_count = 0` 有 58 張，其中 48 張被 review 工具標出仍有人物相關線索，需要人工確認。

這裡不建議新增正式資料欄位如 `people_count_range`。原因是 `small_group`、`medium_group`、`crowd` 這類文字對不同使用者、不同活動規模與不同 AI 模型會有不同想像，容易把主觀分類寫進正式資料。

正式資料應保留 `people_count` 的原始估計數值。若前端或 AI 需要「無人、單人、少人、多人、大合照」這種篩選體驗，應在取用層依數字即時計算或提供可調整門檻，而不是把固定 range 寫回 Sheets。這樣可以保留原始資料，也避免未來因分類標準改變而需要回頭重標。

### `mood_tags` 可用，但不能當成高信任精準分類

`mood_tags` 回應的是一開始的核心需求：社群、網站、招募或宣傳找圖時，常常會先想找「熱鬧」、「專注」、「友善」、「青春感」、「專業」、「幕後感」這類情緒與氛圍，而不是精確找某一年某一場活動。

從真實 AI run 來看，這個欄位有價值，但目前需要保守使用：

- 現存 19 個 proposal 檔案中，2269 筆 item 有 1737 筆提出 `mood_tags`，覆蓋率約 77%。
- SITCON 2026 年會全量 run 中，1077 張有 1050 張提出 `mood_tags`，覆蓋率約 97%。
- 該 run 中最常見的值是 `專業` 488 次、`專注` 415 次、`友善` 248 次、`交流感` 224 次。
- 多數照片落在 1 到 2 個 mood；常見組合包含 `專注;專業`、`友善;專業`、`交流感;專注`。

這代表 `mood_tags` 能幫助找圖，但模型可能把它當成半必填欄位，尤其容易把一般議程、講者、工作人員或幕後畫面標成 `專業`、`專注`。這些標籤不一定錯，但若覆蓋太廣，前端篩選和 AI 推薦的區辨度會下降。

採用邊界：

- 保留 `mood_tags`，因為它對宣傳情緒找圖有實際價值。
- 不列入 `reviewed_required_fields`，避免要求人工替每張照片判斷感受。
- 不把它當成品質分數或主要排序依據。
- 前端可提供 mood 篩選，但應搭配 `scene_tags`、`people_count`、`visual_description`、`recommended_uses` 一起使用。
- prompt 應要求只有在情緒或宣傳語感明確時才標，普通紀錄照可以省略。
- review 工具應提示 mood 覆蓋率過高或 `專業`、`專注`、`友善` 過度集中，讓操作者知道該批結果可能不夠有區辨度。

目前不建議刪除任何 mood enum。`溫暖` 在 2026 年會全量 run 中低頻，但在手寫卡片、祝福、柔和物件照等場景仍可能有價值；`專業` 則不是要刪，而是需要 prompt 與 review warning 收斂使用方式。

### `public_use_status` 不需要擴張，但語意要更明確

目前 `approved / needs_review / avoid` 三個值足夠。問題不在 enum 太少，而在解讀方式：

- AI 可以提出 `needs_review` 或 `avoid`。
- AI 不應把照片標成 `approved`。
- 空白不代表安全，只代表 AI 沒提出公開使用疑慮。
- `needs_review` 是提醒，不是排除。

Hour of Code 這類兒童工作坊照片顯示，`public_use_status` 很重要；但年會全量 run 也顯示，模型可能只標部分照片。未來 UI 與 AI 消費資料時，不應把空白視為已確認可公開。

## 已採納的設計調整

### 新增 `subject_type`

和夥伴討論後確認，照片海初篩時「這張照片主要在看什麼」是很好用的第一層條件。`scene_tags` 需要描述活動場景或可見元素，但不適合同時承擔主要視覺主體分類；否則物件照、標誌照、螢幕照、空景、合照和講者照都會被迫用同一組場景標籤描述。

實務上，找照片時常常會先問「這張照片主要是什麼」：

- 人物。
- 物件。
- 標誌 / 背板 / 指標。
- 場地空間。
- 螢幕或投影片。
- 茶點或餐食。
- 攤位。

`subject_type` 已進入正式 schema，初版 enum 收斂為：

```text
people
object
food
text_signage
screen
space
```

差異應明確寫入文件：

- `subject_type`：畫面主體是什麼。
- `scene_tags`：畫面中有哪些活動場景或元素。
- `people_count`：畫面中可辨識的人數規模。不要用 `subject_type` 表達單人、少人、多人或群眾。

例子：

- `55250547344`：`subject_type = food`，`scene_tags = 茶點`。
- `55244869002`：`subject_type = text_signage` 或 `object`，不一定需要 `scene_tags`。
- `55200405673`：`subject_type = people`，`scene_tags = 合照;舞台;背板`，人數規模看 `people_count`。
- `54977003667`：`subject_type = people`，`scene_tags = 報到;工作人員;交流`，人數規模看 `people_count`。

這個欄位會讓前端、AI 與人類更容易先縮小搜尋範圍，也能降低模型把物件照或食物照硬推成用途或贊助成果的機率。初版刻意不放 `stage`、`booth`，因為它們更像活動場景，容易和 `scene_tags = 舞台 / 攤位` 重複。`food` 則保留為主體類型，因為餐點、茶點或飲料作為照片主體時，使用者確實會想先把這類照片從照片海中篩出來；`scene_tags = 茶點` 仍保留為活動情境。

目前候選值的取捨：

| 候選 | 決策 | 理由 |
| --- | --- | --- |
| `people` | 放入 | 人物是照片海初篩最核心主體。單人、多人、合照或群眾都使用 `people`，規模交給 `people_count`。 |
| `object` | 放入 | 桌旗、貼紙、手冊、獎座、紀念品、道具、素材特寫都需要先從照片海篩出來。 |
| `food` | 放入 | 餐點、茶點、飲料常會作為照片主體被尋找，不應只視為場景。 |
| `text_signage` | 放入 | 招牌、指標、白板、活動標誌、背板文字是常見初篩入口。 |
| `screen` | 放入 | 投影幕、簡報、會場電視、監看畫面和一般文字標示或物件不同。 |
| `space` | 放入 | 空景、入口、走廊、座位區、場地配置是網站與設計常見素材。 |
| `stage` | 不放 | 多數舞台照主體是人物、螢幕、文字標示或空間；`舞台` 保留在 `scene_tags`。 |
| `booth` | 不放 | 攤位可能是人互動、物件、文字標示或空間；`攤位` 保留在 `scene_tags`。 |
| `document` | 暫不放 | 目前先歸 `object`；若未來常需要先找文件、手冊、表單、海報特寫，再拆出。 |
| `award` | 不放 | 頒獎是活動情境，應由 `scene_tags` 擴充承接；獎座或獎牌主體可歸 `object`。 |
| `child` / `student` | 不放 | 這是人物身份或公開使用風險脈絡，不是主體類型；應由 `scene_tags`、`visual_description` 或未來風險欄位處理。 |
| `brand_logo` | 不放 | 容易和贊助語意混淆；用 `text_signage`、`visual_description` 與 sponsorship 欄位分別處理。 |

## 已採納並工具化的調整

### 擴充 `scene_tags`

`subject_type` 進入 schema 後，`scene_tags` 的責任應收斂為「活動情境或可見場景元素」，而不是照片主體分類。真實資料顯示，原本的 `scene_tags` 太偏年會：講者、會眾、舞台、攤位、背板在年會很好用，但在 Hour of Code、BoF / 負一籌、青志獎等活動中，入口導引、場地空景、投影螢幕、頒獎與兒童互動會被迫靠 `visual_description` 承接。

以下初版補充值已加入 `data/tag-taxonomy.json`，並同步進入 prompt、AI contract、field reference、Apps Script config 與前端篩選脈絡：

| 新增值 | 使用時機 | 不該承擔的事 |
| --- | --- | --- |
| `指標` | 入口導引、方向牌、A 字板、路標、報到導引牌。 | 不代表主要主體；若標示是主體，搭配 `subject_type = text_signage`。 |
| `場地` | 場館、入口、走廊、座位區、空景、空間配置。 | 不取代 `subject_type = space`。 |
| `螢幕` | 投影幕、簡報、會場電視、監看畫面、電子螢幕。 | 不取代 `subject_type = screen`。 |
| `頒獎` | 頒獎、受獎、獎座、獎牌、表揚或典禮授獎情境。 | 不把獎座主體當成 scene；獎座本身可搭配 `subject_type = object`。 |
| `兒童` | 畫面中清楚可見兒童或小朋友。 | 不從活動名稱推論；若只是學生身份但看不出兒童，不應硬標。 |
| `場佈` | 佈置、撤場、搬運、器材架設、物資整理、動線或報到配置。 | 不代表所有背板、旗幟、立牌或桌布；完成後的講者背板、合照背板或攤位互動應用更精準 tag。 |
| `錄音` | Podcast、訪談、廣播、錄音室、桌面麥克風、耳機、混音或收音設備等聲音製作場景。 | 不代表一般講者手持麥克風、戴耳麥演講或舞台音響。 |
| `導覽` | 導覽者帶領人群參觀場地、攤位、路線或特定空間，且畫面能看出跟隨/聆聽與移動脈絡。 | 不代表講者解說投影片、工作坊帶小組、人群在走廊移動或投影片中的地圖。 |

暫不加入 `學生`，因為照片通常無法只靠畫面可靠判斷學生身份，容易變成活動脈絡推論。若未來需要學生族群搜尋，應考慮活動 metadata、participant context 或另一個更明確的欄位，而不是塞進 scene tag。

### 收斂 `recommended_uses`

`recommended_uses` 現在資訊量不足，尤其是：

- `活動回顧` 在 SITCON 2026 全量 run 出現 958/1077 張。
- `社群貼文` 容易成為泛用值。
- `贊助成果報告` 會在沒有贊助欄位佐證時被模型過度推論。

這表示 `recommended_uses` 不應被 prompt 當作「每張都要填」的欄位。它應代表「這張照片明顯適合的工作用途」，而不是所有可能用途。

以下規則已寫入 prompt，並由 `ai:review` 以 review warning 協助抽查：

- 沒有明確用途就省略。
- `活動回顧` 只用在能代表活動流程、成果、場面或情緒的照片，不是所有照片預設值。
- `社群貼文` 需要有明確情緒、主體或視覺吸引力，不是一般照片預設值。
- `贊助成果報告` 需要 sponsorship 欄位或清楚可見的贊助佐證，否則不應填。
- `贊助提案` 應更保守，通常是「可說明價值」而不是「已有成果」。

未來也可以考慮把 `recommended_uses` 拆成兩層：

- `recommended_uses`：具體工作用途。
- `content_roles` 或 `communication_intent`：這張照片能傳達的訊息，例如現場規模、志工投入、學員互動、講者專業、品牌識別、幕後準備。

目前先不拆欄；收斂 prompt 與 review warning 是已採納的 MVP 作法。若真實使用者仍覺得 `recommended_uses` 太粗，再評估 `content_roles` 或 `communication_intent`。

### 贊助欄位需要更嚴格的交互規則

`sponsorship_items`、`sponsorship_tags`、`recommended_uses = 贊助成果報告` 三者需要明確關係。

目前觀察到的問題是：模型會因為茶點、桌旗、SITCON 旗幟、背板或一般現場互動，推論適合 `贊助成果報告`，但沒有填任何 sponsorship 欄位。這會讓行銷組得到看似有用但實際需要大量人工確認的結果。

以下規則已寫入 prompt，並由 review summary / Review Focus 提醒操作者優先抽查：

- `sponsorship_items`：只有能對齊 CFS 贊助品項時填。
- `sponsorship_tags`：只有能說明贊助價值或佐證用途時填。
- `recommended_uses = 贊助成果報告`：至少應有 `sponsorship_items` 或 `sponsorship_tags`，否則 review warning 會明顯標出。
- SITCON 自有 Logo、旗幟、背板或活動識別不是 sponsorship。
- 茶點、食物或物件照如果無法對齊贊助品項，只能描述畫面內容，不自動推論贊助成果。

## prompt 是主要迭代槓桿

欄位和 enum 不應單獨承擔所有品質問題。實際 run 顯示，很多問題是 prompt 行為：

- 要不要每張都填 `recommended_uses`。
- 要不要保守填 `safe_crop`。
- `public_use_status` 空白代表什麼。
- reason 是否必須繁體中文。
- `visual_description` 是否足夠具體。
- sponsorship 是否能依畫面推論。
- 多 worker 是否會出現不同語言或風格。

因此未來調整應分成兩種：

1. **schema / taxonomy 調整**：當欄位無法承接真實需求，例如缺少 `subject_type`。
2. **prompt / validator / report 調整**：當欄位方向正確，但模型使用方式不穩，例如 `活動回顧` 過度泛用、英文 reason 混入、贊助成果過度推論。

這次觀察後，以下項目已先落在 prompt 與 review warning：

- `recommended_uses` 不是必填，沒有明確用途可省略。
- `活動回顧`、`社群貼文` 不可作為預設值。
- `贊助成果報告` 必須有 sponsorship 佐證，否則不要填。
- reason 與 `visual_description` 必須使用繁體中文；可見英文標誌可以保留原文。
- `safe_crop` 只在明確可裁切時填，不確定就省略。
- `public_use_status` 空白不等於 approved。

已進入 schema 的項目：

- 新增 `subject_type`。

仍適合進入後續設計討論的項目：

- 在前端、AI 查詢或報表層用 `people_count` 衍生人數篩選區間，不新增正式資料欄位。
- 評估是否新增 `communication_intent` / `content_roles` 來取代過度泛用的 `recommended_uses` 部分責任。

## 建議下一步

1. 先不刪現有欄位。
2. 繼續用 `pnpm eval:sample`、`pnpm ai:report -- --runs ...` 與 `pnpm eval:search` 檢查已採納規則是否真的改善人工審核與自然語言找圖。
3. 對小批跨活動樣本抽查 `subject_type` 的 enum 是否足夠，並同步檢查前端以 `people_count` 衍生人數篩選是否足夠，至少涵蓋：
   - 年會講者與舞台。
   - 年會攤位與贊助相關畫面。
   - BoF / 負一籌茶點與交流。
   - Hour of Code 兒童工作坊、手作物件與報到。
   - 青志獎頒獎、合照與合作活動舞台。
4. `data/ai-cross-activity-sample-plan.json` 與 `pnpm eval:sample` 已具體化這個需求。這份抽樣刻意混合已評估與未評估相簿，未評估類型包含 Podcast、Camp、Hackathon、合作攤位、紀念品、咖啡廳、導遊團與廣播錄音，避免欄位只被年會照片校準。
5. 若 `subject_type` 的 enum 或定義需要調整，應同步更新 `data/photo-schema.json`、`data/tag-taxonomy.json`、prompt、AI contract、field reference、Apps Script config 與前端篩選。
6. 尚未工具化的圖片幾何檢查仍可評估，例如 `orientation` 和實際圖片尺寸是否矛盾、`safe_crop` 是否會切掉主體臉部、文字或重要物件。

這樣可以避免因單一模型或單一活動場景過度修正 schema，也能讓 SITCON 多元活動照片都被納入設計範疇。
