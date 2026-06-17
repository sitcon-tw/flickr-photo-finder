# 共用值治理

這份文件定義 Sheets、Apps Script、GitHub Pages、CLI、AI prompt / report 之間共用欄位、受控字彙、狀態與介面設定的維護邊界。

## 分層

### Contract 層

Contract 層是資料契約，必須有機器可讀來源，不能在介面或文件中另建平行版本。

| 類型 | 來源 |
| --- | --- |
| 照片、相簿、匯入批次欄位 | `data/photo-schema.json` |
| taxonomy raw values 與顯示 label | `data/tag-taxonomy.json` |
| sponsorship item 名稱 | `data/sponsorship-items.json`，再衍生到 taxonomy |
| validation messages | `data/validation-messages.json` |
| GA4 custom dimensions | `config/ga4-custom-dimensions.json` |

### Interface Policy 層

Interface Policy 層描述介面如何使用 Contract 層，而不是重新定義 Contract。

`data/interface-registry.json` 是這一層的來源，包含：

- Pages filter key、schema field、URL key、短 label、placeholder、filter group。
- Pages 優先檢視控制項、primary filters、用途權重。
- people count buckets。
- Pages status score policy。
- Pages query phrase aliases。
- Apps Script public read fields、Review Panel fields、Review Web App list/filter fields。

Interface registry 可以引用欄位與 taxonomy value，但不能新增欄位或 taxonomy value。若 registry 指到不存在的欄位或值，`pnpm shared-values:check` 必須失敗。

### Local Copy 層

單一畫面的按鈕、空狀態、操作提示與長段說明可以留在該畫面或文件中。若同一組文案或語意跨兩個以上介面重複，應考慮提升到 Contract 或 Interface Policy 層。

AI prompt 和資料整理指南常需要直接列出 raw field / value 來約束模型或人類判斷，這是允許的。但它們不應另建顯示 label 對照表，也不應改寫 `curation_status`、`public_use_status` 等狀態語意。

## 檢查

| 指令 | 責任 |
| --- | --- |
| `pnpm language:check` | 阻擋含糊的相對版本詞與明確不符合台灣繁中技術文件習慣的詞彙。 |
| `pnpm shared-values:check` | 驗證 interface registry、Apps Script generated config 與 shared values。 |
| `pnpm data:validate` | 驗證 schema、taxonomy、search aliases、fixtures 與 validation messages。 |
| `pnpm project:check` | 執行目前專案層級的 contract checks。 |

`pnpm shared-values:check` 會檢查：

- Pages filters 的 key、control、URL key 不重複。
- registry 引用的欄位存在於 `data/photo-schema.json`。
- registry 引用的 taxonomy value 存在於 `data/tag-taxonomy.json`。
- Apps Script field sets 都是合法 photo fields。
- `apps-script/GeneratedConfig.js` 已包含目前的 interface registry。

## 維護流程

修改欄位、taxonomy 或 shared interface policy 時：

1. 先修改來源：schema、taxonomy、validation messages、GA4 config 或 interface registry。
2. 若修改 interface registry，執行 `pnpm apps-script:build-config` 更新 `apps-script/GeneratedConfig.js`。
3. 依影響範圍修改 Pages、Apps Script、CLI 或文件。
4. 執行 `pnpm project:check`。
5. 若改到 Pages artifact，另跑 `pnpm finder:build` 與 `pnpm finder:check`。

未來 agent 不應為了快速通過單一畫面需求，在 Pages、Apps Script 或 CLI 裡新增欄位翻譯表、taxonomy 顯示表、狀態語意表或另一組 filter mapping。若確實需要介面專屬短 label 或排序 policy，應加到 `data/interface-registry.json`，再讓使用端讀取或由檢查器驗證。
