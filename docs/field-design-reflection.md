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

### `people_count` 有用，但不應只靠精確數值

`people_count` 對找圖很有用，因為使用者會找：

- 無人空景或物件照。
- 單人講者。
- 兩到五人的互動。
- 中型工作坊場景。
- 大合照或群眾。

但 AI 對大人數、局部人影、螢幕中人像、被遮擋人物容易不穩。SITCON 2026 全量 run 中，`people_count = 0` 有 58 張，其中 48 張被 review 工具標出仍有人物相關線索，需要人工確認。

建議保留 `people_count`，但未來可新增衍生欄位 `people_count_range` 作為搜尋與篩選主要依據：

```text
none
single
small_group
medium_group
crowd
```

精確數值可繼續作為 AI 或整理者估計值；前端與 AI 推薦則優先用 range，降低錯誤成本。

### `public_use_status` 不需要擴張，但語意要更明確

目前 `approved / needs_review / avoid` 三個值足夠。問題不在 enum 太少，而在解讀方式：

- AI 可以提出 `needs_review` 或 `avoid`。
- AI 不應把照片標成 `approved`。
- 空白不代表安全，只代表 AI 沒提出公開使用疑慮。
- `needs_review` 是提醒，不是排除。

Hour of Code 這類兒童工作坊照片顯示，`public_use_status` 很重要；但年會全量 run 也顯示，模型可能只標部分照片。未來 UI 與 AI 消費資料時，不應把空白視為已確認可公開。

## 需要調整的設計

### 新增 `subject_type`

目前 `scene_tags` 需要同時承擔「畫面包含哪些活動元素」和「畫面主體是什麼」兩件事，導致物件照、標誌照、茶點照、合照、講者照都被迫用同一組場景標籤描述。

實務上，找照片時常常會先問「這張照片主要是什麼」：

- 人物。
- 多人互動。
- 大合照。
- 物件。
- 標誌 / 背板 / 指標。
- 場地空間。
- 螢幕或投影片。
- 茶點或餐食。
- 攤位。

建議新增 `subject_type`，初版 enum 可先收斂為：

```text
person
group
crowd
object
signage
stage
booth
food
space
screen
document
```

差異應明確寫入文件：

- `subject_type`：畫面主體是什麼。
- `scene_tags`：畫面中有哪些活動場景或元素。

例子：

- `55250547344`：`subject_type = food`，`scene_tags = 茶點`。
- `55244869002`：`subject_type = object` 或 `signage`，不一定需要 `scene_tags`。
- `55200405673`：`subject_type = group`，`scene_tags = 合照;舞台;背板`。
- `54977003667`：`subject_type = group`，`scene_tags = 報到;工作人員;交流`。

這個欄位會讓前端、AI 與人類更容易先縮小搜尋範圍，也能降低模型把物件照硬推成用途或贊助成果的機率。

### 收斂 `recommended_uses`

`recommended_uses` 現在資訊量不足，尤其是：

- `活動回顧` 在 SITCON 2026 全量 run 出現 958/1077 張。
- `社群貼文` 容易成為泛用值。
- `贊助成果報告` 會在沒有贊助欄位佐證時被模型過度推論。

這表示 `recommended_uses` 不應被 prompt 當作「每張都要填」的欄位。它應代表「這張照片明顯適合的工作用途」，而不是所有可能用途。

建議規則：

- 沒有明確用途就省略。
- `活動回顧` 只用在能代表活動流程、成果、場面或情緒的照片，不是所有照片預設值。
- `社群貼文` 需要有明確情緒、主體或視覺吸引力，不是一般照片預設值。
- `贊助成果報告` 需要 sponsorship 欄位或清楚可見的贊助佐證，否則不應填。
- `贊助提案` 應更保守，通常是「可說明價值」而不是「已有成果」。

未來也可以考慮把 `recommended_uses` 拆成兩層：

- `recommended_uses`：具體工作用途。
- `content_roles` 或 `communication_intent`：這張照片能傳達的訊息，例如現場規模、志工投入、學員互動、講者專業、品牌識別、幕後準備。

但 MVP 下一步不一定要立刻拆欄；先收斂 prompt 與 review warning 會更務實。

### 贊助欄位需要更嚴格的交互規則

`sponsorship_items`、`sponsorship_tags`、`recommended_uses = 贊助成果報告` 三者需要明確關係。

目前觀察到的問題是：模型會因為茶點、桌旗、SITCON 旗幟、背板或一般現場互動，推論適合 `贊助成果報告`，但沒有填任何 sponsorship 欄位。這會讓行銷組得到看似有用但實際需要大量人工確認的結果。

建議規則：

- `sponsorship_items`：只有能對齊 CFS 贊助品項時填。
- `sponsorship_tags`：只有能說明贊助價值或佐證用途時填。
- `recommended_uses = 贊助成果報告`：至少應有 `sponsorship_items` 或 `sponsorship_tags`，否則 review warning 應明顯標出。
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

1. **schema / taxonomy 調整**：當欄位無法承接真實需求，例如缺少 `subject_type` 或 `people_count_range`。
2. **prompt / validator / report 調整**：當欄位方向正確，但模型使用方式不穩，例如 `活動回顧` 過度泛用、英文 reason 混入、贊助成果過度推論。

這次觀察後，較適合先改 prompt 與 review warning 的項目：

- `recommended_uses` 不是必填，沒有明確用途可省略。
- `活動回顧`、`社群貼文` 不可作為預設值。
- `贊助成果報告` 必須有 sponsorship 佐證，否則不要填。
- reason 與 `visual_description` 必須使用繁體中文；可見英文標誌可以保留原文。
- `safe_crop` 只在明確可裁切時填，不確定就省略。
- `public_use_status` 空白不等於 approved。

較適合進入 schema 討論的項目：

- 新增 `subject_type`。
- 新增 `people_count_range` 或在工具層衍生同等欄位。
- 評估是否新增 `communication_intent` / `content_roles` 來取代過度泛用的 `recommended_uses` 部分責任。

## 建議下一步

1. 先不刪現有欄位。
2. 在 prompt 與 review 工具中收斂 `recommended_uses`、sponsorship、繁體中文 reason 與 `safe_crop` 規則。
3. 以小批跨活動樣本測試 `subject_type` 與 `people_count_range`，至少涵蓋：
   - 年會講者與舞台。
   - 年會攤位與贊助相關畫面。
   - BoF / 負一籌茶點與交流。
   - Hour of Code 兒童工作坊、手作物件與報到。
   - 青志獎頒獎、合照與合作活動舞台。
4. 確認新欄位真的改善找圖後，再更新 `data/photo-schema.json`、prompt、AI contract、field reference、Apps Script config 與前端篩選。

這樣可以避免因單一模型或單一活動場景過度修正 schema，也能讓 SITCON 多元活動照片都被納入設計範疇。
