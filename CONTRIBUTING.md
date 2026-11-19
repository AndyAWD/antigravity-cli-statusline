# Contributing to Antigravity CLI Statusline

[English](#english-us) | [繁體中文](#繁體中文-zh-tw) | [简体中文](#简体中文-zh-cn)

---

## English (us)

> For the complete 4-layer modular architecture map (`core/`, `collectors/`, `metrics/`, `renderers/`), extension recipes, and release checklist, see [docs/ARCHITECTURE_HANDOVER.md](docs/ARCHITECTURE_HANDOVER.md) (Traditional Chinese).

### 💡 Add Your Language Translation via AI

You can generate a new language translation for this plugin using an AI agent (such as Gemini Flash). To ensure fast models process this accurately, copy and paste the prompt below.

Replace `[LANG_CODE]` with your target language code (e.g., `kr` — note that `zh-tw`, `zh-cn`, `us`, and `jp` are already built-in), and `[Target Language]` with the language name (e.g., `"Korean"`):

````text
I want to add a [Target Language] translation version for this Antigravity CLI Statusline plugin (Language Code: [LANG_CODE]).

This project uses a 4-layer modular architecture (`core/`, `collectors/`, `metrics/`, `renderers/`) and generates JSON prompt/question resources from a single source of truth. Please DO NOT create new directories and DO NOT hand-edit `SKILL.md`, `resources/questions.json`, or `resources/prompts.json`. Follow these exact steps:

### 1. Modify `skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs` & Sync Resources
- Add `'[LANG_CODE]'` to `SUPPORTED_LOCALES`.
- Add `'[LANG_CODE]'` entries to `LOCALE_WIZARD_META` (including Step 1 option `"[Target Language] ([LANG_CODE])"`, Step 2 missing-Node.js prompt, Step 4 table title/header, and Step 4 single-line order question).
- Translate all 5 category titles/questions in `METRIC_CATEGORIES` and all **37 statusline indicators** (`#1` `model-name` through `#37` `plugin-version`) in `METRICS` into [Target Language] using `"<Emoji> <Localized Description> (<indicator-id>)"` (do NOT include extra parentheses besides the trailing `(<indicator-id>)`).
- Run `node skills/agy-cli-statusline/scripts/sync-resources.mjs` (or `npm run sync:resources`) to regenerate `skills/agy-cli-statusline/resources/questions.json` and `skills/agy-cli-statusline/resources/prompts.json`.

### 2. Modify `skills/agy-cli-statusline/scripts/lib/core/normalize.mjs`
- **Find `normalizeLanguage(lang)`**: Add matching rules to normalize `[LANG_CODE]` and related locale aliases to `'[LANG_CODE]'` (shared by both `statusline-quota.mjs` and `configure-statusline.mjs`).

### 3. Modify `skills/agy-cli-statusline/scripts/lib/metrics/i18n.mjs`
- **Find `buildI18nDict(lang, m, labelStyle = 'text')`**: Add a new `[LANG_CODE]` object translating all **42 keys** (**37 status indicators** + **5 merged bar graph keys**: `quota+bar`, `context-used+bar`, `quota-weekly+bar`, `quota-argon+bar`, `token-count+bar`) into [Target Language], preserving all ANSI color variables (`${BOLD}`, `${WHITE}`, `${RESET}`, etc.) and `${m.*}` template expressions.
- Add `'[LANG_CODE]'` translations for agent states (`AGENT_STATE_MAP` / state labels) and `formatPluginUpdateNoticeLines()`.

### 4. Modify `skills/agy-cli-statusline/scripts/lib/collectors/probes.mjs` (and metric collectors)
- Add `'[LANG_CODE]'` translations for `"No VC"` (`getGitBranch`), `"Unknown"`, `"None"` / `"N/A"`, `"uncommitted"` / `"no changes"` (`vcsDirtyLabel`), and sandbox status strings (`off` / `on (net)` / `on (no-net)`).
````

### 🛠️ Adding a New Statusline Indicator

To add a new statusline indicator (`<indicator-id>`):

1. **`skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs`**: Register `<indicator-id>` in `METRICS`, `ALL_STANDARD_METRIC_IDS`, `EMOJI_MAP`, and all supported locales (`zh-tw`, `zh-cn`, `us`, `jp`). If it pairs with a bar graph (`<indicator-id>-bar`), also register the pair in `ADJACENT_PAIRS` and add `<indicator-id>+bar` to `EMOJI_MAP`.
2. **`skills/agy-cli-statusline/scripts/lib/collectors/probes.mjs`** (or relevant collector in `lib/collectors/`): Compute the indicator value with timeout and `windowsHide: true` protection.
3. **`skills/agy-cli-statusline/scripts/lib/metrics/i18n.mjs`**: Add `<indicator-id>` (and `<indicator-id>+bar` if paired) to every locale dictionary in `buildI18nDict`.
4. **`skills/agy-cli-statusline/scripts/sync-resources.mjs`**: Run `npm run sync:resources` to regenerate `resources/questions.json` and `resources/prompts.json`.
5. **Renderers, Tests & Documentation**: To add or extend custom rendering styles, see `skills/agy-cli-statusline/scripts/lib/renderers/` and `docs/ARCHITECTURE_HANDOVER.md`; add unit tests in `skills/agy-cli-statusline/scripts/tests/*.test.mjs`; update `README.md`, `README.zh-TW.md`, `README.zh-CN.md`, and `README.ja.md`.

### 🧪 Testing & Verification

Run the resource sync, built-in test suite, plugin validation, and diagnostic script before submitting a Pull Request:

```bash
# Regenerate questions.json & prompts.json from registry.mjs
npm run sync:resources

# Run unit tests (skills/agy-cli-statusline/scripts/tests/*.test.mjs) and counter checks
npm test

# Validate plugin manifest and SKILL.md
agy plugin validate .

# Run the cross-platform diagnostic script
node skills/agy-cli-statusline/scripts/diagnose-statusline.mjs
```

### 🤝 Contributing

We welcome contributions! If you have ideas for new features, bug fixes, or improvements, feel free to open an Issue or submit a Pull Request. Whether it's adding a new status indicator, building a custom renderer, improving cross-platform compatibility, or fixing a typo, your help is appreciated.

### FAQ: `.gemini/` vs `.agents/` & Three-Layer `settings.json`

`.gemini/` and `.agents/` serve distinct roles — do **NOT** rename `.gemini/` to `.agents/`:

| Path | Role | Purpose |
| :--- | :--- | :--- |
| `~/.gemini/antigravity-cli/settings.json` | **CLI-Specific Settings (Highest Priority)** | Maintained by `agy` CLI; overrides global settings. Must be updated in sync. |
| `~/.gemini/settings.json` | **Global Settings (Medium Priority)** | Shared global configuration across Gemini / Antigravity tools. |
| `<workspace>/.gemini/settings.json` | **Workspace Runtime Settings (Project Layer)** | Project-specific `statusLine`, `ui.language`, `ui.footer.labelStyle`, and `ui.footer.items` overrides. |
| `.agents/skills/<name>.md` | **Workspace Skill Customization** | Override or add a skill description that applies only to the current workspace. |
| `.agents/mcp_config.json` | **Workspace MCP Server Config** | Project-specific Model Context Protocol (MCP) server connections. |

---

## 繁體中文 (zh-tw)

> 完整四層模組化架構地圖（`core/`、`collectors/`、`metrics/`、`renderers/`）、擴充配方與版本釋出檢查清單，請參閱 [docs/ARCHITECTURE_HANDOVER.md](docs/ARCHITECTURE_HANDOVER.md)。

### 💡 使用人工智慧一鍵新增其他語言

你可以使用人工智慧（Artificial Intelligence）代理（例如 Gemini Flash）產生其他語言的翻譯版本。請直接複製下方的提示詞（Prompt），將 `[LANG_CODE]` 替換為目標語系代碼（例如 `kr`；專案已內建 `zh-tw`、`zh-cn`、`us`、`jp` 四種語系），並將 `【目標語言】` 替換為語言名稱（例如「韓文」）：

````text
我想為這個 Antigravity CLI Statusline 外掛新增【目標語言】翻譯版本（語系代碼：[LANG_CODE]）。

本專案採用四層模組化架構（`core/`、`collectors/`、`metrics/`、`renderers/`），並透過單一真實來源自動生成問卷資源。請「不要」建立新的資料夾，也「不要」手動編輯 `SKILL.md`、`resources/questions.json` 或 `resources/prompts.json`。請嚴格遵守以下步驟：

### 1. 修改 `skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs` 並同步資源
- 將 `'[LANG_CODE]'` 加入 `SUPPORTED_LOCALES`。
- 於 `LOCALE_WIZARD_META` 補上 `'[LANG_CODE]'` 的精靈提示（包含步驟 1 選項 `"【目標語言】 ([LANG_CODE])"`、步驟 2 缺少 Node.js 警告、步驟 4 表格標題／表頭與單行排序問卷）。
- 於 `METRIC_CATEGORIES` 翻譯五大分類標題／問題，並於 `METRICS` 翻譯全部 **37 個狀態列指標**（`#1` `model-name` 至 `#37` `plugin-version`），格式維持 `"<繪圖符號> <目標語言說明> (<英文識別碼>)"`（除末尾 `(<英文識別碼>)` 外，不得出現額外括號）。
- 執行 `node skills/agy-cli-statusline/scripts/sync-resources.mjs`（或 `npm run sync:resources`），自動重新生成 `skills/agy-cli-statusline/resources/questions.json` 與 `skills/agy-cli-statusline/resources/prompts.json`。

### 2. 修改 `skills/agy-cli-statusline/scripts/lib/core/normalize.mjs`
- **尋找 `normalizeLanguage(lang)` 函式**：新增判斷規則，將 `[LANG_CODE]` 及相關語系別名標準化為 `'[LANG_CODE]'`（`statusline-quota.mjs` 與 `configure-statusline.mjs` 共用此模組）。

### 3. 修改 `skills/agy-cli-statusline/scripts/lib/metrics/i18n.mjs`
- **尋找 `buildI18nDict(lang, m, labelStyle = 'text')` 函式**：新增 `'[LANG_CODE]'` 字典，將全部 **42 個鍵值**（**37 個狀態列指標** ＋ **5 個長條圖合併鍵值**：`quota+bar`、`context-used+bar`、`quota-weekly+bar`、`quota-argon+bar`、`token-count+bar`）翻譯為【目標語言】，保留原有的美國國家標準協會（American National Standards Institute）色彩變數（如 `${BOLD}`、`${WHITE}`、`${RESET}`）與 `${m.*}` 變數插值。
- 同步於代理狀態對照（`AGENT_STATE_MAP`）與 `formatPluginUpdateNoticeLines()` 補上 `'[LANG_CODE]'` 翻譯。

### 4. 修改 `skills/agy-cli-statusline/scripts/lib/collectors/probes.mjs`（及資料採集模組）
- 補上 `'[LANG_CODE]'` 對應的「無版本控制（No VC）」（`getGitBranch`）、「未知」、「無」、「未提交 / 無變更」（`vcsDirtyLabel`）與沙盒狀態文字（`off` / `on (net)` / `on (no-net)`）。
````

### 🛠️ 新增狀態列指標指南

若要新增一個狀態列指標（假設識別碼為 `<indicator-id>`）：

1. **`skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs`**：在 `METRICS`、`ALL_STANDARD_METRIC_IDS`、`EMOJI_MAP` 與所有支援語系（`zh-tw`、`zh-cn`、`us`、`jp`）註冊 `<indicator-id>`（若支援長條圖相鄰合併，一併註冊於 `ADJACENT_PAIRS` 並為 `EMOJI_MAP` 補上 `<indicator-id>+bar`）。
2. **`skills/agy-cli-statusline/scripts/lib/collectors/probes.mjs`**（或 `lib/collectors/` 對應採集模組）：實作該指標資料採集，外部命令呼叫須具逾時與 `windowsHide: true` 防護。
3. **`skills/agy-cli-statusline/scripts/lib/metrics/i18n.mjs`**：於 `buildI18nDict` 所有語系的字典中補上 `<indicator-id>`（及配對時的 `<indicator-id>+bar`）。
4. **`skills/agy-cli-statusline/scripts/sync-resources.mjs`**：執行 `npm run sync:resources` 自動更新 `resources/questions.json` 與 `resources/prompts.json`。
5. **渲染器、測試與說明文件**：若需客製化或新增渲染風格，請參閱 `skills/agy-cli-statusline/scripts/lib/renderers/` 與 `docs/ARCHITECTURE_HANDOVER.md`；於 `skills/agy-cli-statusline/scripts/tests/*.test.mjs` 補齊單元測試；並將新指標補充至 `README.md`、`README.zh-TW.md`、`README.zh-CN.md` 與 `README.ja.md`。

### 🧪 測試與驗證

在提交拉取請求（Pull Request）之前，請執行資源同步、自動化測試、外掛驗證與診斷腳本：

```bash
# 由 registry.mjs 重新生成 questions.json 與 prompts.json
npm run sync:resources

# 執行所有單元測試（skills/agy-cli-statusline/scripts/tests/*.test.mjs）與計數器驗證
npm test

# 驗證外掛清單與 SKILL.md
agy plugin validate .

# 執行跨平台環境診斷腳本
node skills/agy-cli-statusline/scripts/diagnose-statusline.mjs
```

### 🤝 貢獻指南

歡迎提交拉取請求參與貢獻！如果你對本專案有新功能構想、發現錯誤，或欲改善渲染風格與跨平台相容性，歡迎隨時建立問題單（Issue）或發起拉取請求。

### FAQ：`.gemini/` 與 `.agents/` 的差別及三層設定檔架構

`.gemini/` 與 `.agents/` 職責不同，請**不要**將 `.gemini/` 重新命名為 `.agents/`：

| 路徑 | 層級與職責 | 用途說明 |
| :--- | :--- | :--- |
| `~/.gemini/antigravity-cli/settings.json` | **命令列介面專屬設定（最高優先級）** | 由 `agy` 維護，優先級高於全域設定檔，配置時必須同步寫入。 |
| `~/.gemini/settings.json` | **全域設定（中優先級）** | 跨 Gemini / Antigravity 工具共用的全域設定檔。 |
| `<workspace>/.gemini/settings.json` | **專案執行期設定（工作區層）** | 覆寫當前專案工作區的 `statusLine`、`ui.language`、`ui.footer.labelStyle` 與 `ui.footer.items`。 |
| `.agents/skills/<name>.md` | **工作區技能客製化** | 在單一工作區覆寫或新增技能描述。 |
| `.agents/mcp_config.json` | **工作區 MCP 伺服器設定** | 該專案專屬的模型內容協定（Model Context Protocol）連線設定。 |

---

## 简体中文 (zh-cn)

> 完整四层模块化架构地图（`core/`、`collectors/`、`metrics/`、`renderers/`）、扩展配方与版本发布检查清单，请参阅 [docs/ARCHITECTURE_HANDOVER.md](docs/ARCHITECTURE_HANDOVER.md)（繁体中文）。

### 💡 使用 AI 一键新增其他语言

你可以使用人工智能（Artificial Intelligence）代理（例如 Gemini Flash）快速生成其他语言的翻译版本。请直接复制下方的提示词（Prompt），把 `[LANG_CODE]` 换成目标语系代码（例如 `kr`；项目已内置 `zh-tw`、`zh-cn`、`us`、`jp` 四种语系），把 `【目标语言】` 换成语言名称（例如“韩文”）：

````text
我想为这个 Antigravity CLI Statusline 插件新增【目标语言】翻译版本（语系代码：[LANG_CODE]）。

本项目采用四层模块化架构（`core/`、`collectors/`、`metrics/`、`renderers/`），并通过单一数据源自动生成问卷资源。请“不要”建立新的文件夹，也“不要”手动编辑 `SKILL.md`、`resources/questions.json` 或 `resources/prompts.json`。请严格遵守以下步骤：

### 1. 修改 `skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs` 并同步资源
- 将 `'[LANG_CODE]'` 加入 `SUPPORTED_LOCALES`。
- 在 `LOCALE_WIZARD_META` 补上 `'[LANG_CODE]'` 的向导提示（包含步骤 1 选项 `"【目标语言】 ([LANG_CODE])"`、步骤 2 缺少 Node.js 警告、步骤 4 表格标题／表头与单行排序问卷）。
- 在 `METRIC_CATEGORIES` 翻译五大分类标题／问题，并在 `METRICS` 翻译全部 **37 个状态栏指标**（`#1` `model-name` 至 `#37` `plugin-version`），格式维持 `"<表情符号> <目标语言说明> (<英文标识码>)"`（除末尾 `(<英文标识码>)` 外，不得出现额外括号）。
- 运行 `node skills/agy-cli-statusline/scripts/sync-resources.mjs`（或 `npm run sync:resources`），自动重新生成 `skills/agy-cli-statusline/resources/questions.json` 与 `skills/agy-cli-statusline/resources/prompts.json`。

### 2. 修改 `skills/agy-cli-statusline/scripts/lib/core/normalize.mjs`
- **寻找 `normalizeLanguage(lang)` 函数**：新增判断规则，将 `[LANG_CODE]` 及相关语系别名标准化为 `'[LANG_CODE]'`（`statusline-quota.mjs` 与 `configure-statusline.mjs` 共用此模块）。

### 3. 修改 `skills/agy-cli-statusline/scripts/lib/metrics/i18n.mjs`
- **寻找 `buildI18nDict(lang, m, labelStyle = 'text')` 函数**：新增 `'[LANG_CODE]'` 字典，将全部 **42 个键值**（**37 个状态栏指标** + **5 个长条图合并键值**：`quota+bar`、`context-used+bar`、`quota-weekly+bar`、`quota-argon+bar`、`token-count+bar`）翻译成【目标语言】，保留原有的 ANSI 色彩变量（如 `${BOLD}`、`${WHITE}`、`${RESET}`）与 `${m.*}` 变量插值。
- 同步在代理状态映射（`AGENT_STATE_MAP`）与 `formatPluginUpdateNoticeLines()` 补上 `'[LANG_CODE]'` 翻译。

### 4. 修改 `skills/agy-cli-statusline/scripts/lib/collectors/probes.mjs`（及数据采集模块）
- 补上 `'[LANG_CODE]'` 对应的“无版本控制（No VC）”（`getGitBranch`）、“未知”、“无”、“未提交 / 无变更”（`vcsDirtyLabel`）与沙盒状态文本（`off` / `on (net)` / `on (no-net)`）。
````

### 🛠️ 新增状态栏指标指南

若要新增一个状态栏指标（假设标识码为 `<indicator-id>`）：

1. **`skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs`**：在 `METRICS`、`ALL_STANDARD_METRIC_IDS`、`EMOJI_MAP` 与所有支持语系（`zh-tw`、`zh-cn`、`us`、`jp`）注册 `<indicator-id>`（若支持长条图相邻合并，一并在 `ADJACENT_PAIRS` 注册配对并在 `EMOJI_MAP` 补上 `<indicator-id>+bar`）。
2. **`skills/agy-cli-statusline/scripts/lib/collectors/probes.mjs`**（或 `lib/collectors/` 对应采集模块）：实现该指标的数据采集，外部命令调用须具备超时与 `windowsHide: true` 防护。
3. **`skills/agy-cli-statusline/scripts/lib/metrics/i18n.mjs`**：在 `buildI18nDict` 所有语系的字典中新增 `<indicator-id>`（及配对时的 `<indicator-id>+bar`）。
4. **`skills/agy-cli-statusline/scripts/sync-resources.mjs`**：运行 `npm run sync:resources` 自动重新生成 `resources/questions.json` 与 `resources/prompts.json`。
5. **渲染器、测试与文档更新**：如需定制或新增渲染样式，请参阅 `skills/agy-cli-statusline/scripts/lib/renderers/` 与 `docs/ARCHITECTURE_HANDOVER.md`；在 `skills/agy-cli-statusline/scripts/tests/*.test.mjs` 补充单元测试；并将新指标补充至 `README.md`、`README.zh-TW.md`、`README.zh-CN.md` 与 `README.ja.md`。

### 🧪 测试与验证

在提交拉取请求（Pull Request）之前，请运行资源同步、自动化测试、插件验证与诊断脚本：

```bash
# 由 registry.mjs 重新生成 questions.json 与 prompts.json
npm run sync:resources

# 运行所有单元测试（skills/agy-cli-statusline/scripts/tests/*.test.mjs）与计数器验证
npm test

# 验证插件清单与 SKILL.md
agy plugin validate .

# 运行跨平台环境诊断脚本
node skills/agy-cli-statusline/scripts/diagnose-statusline.mjs
```

### 🤝 贡献指南

欢迎提交拉取请求参与贡献！如果你对本项目有新功能构想、发现错误（Bug），或想优化渲染风格与跨平台兼容性，欢迎随时创建 Issue 或发起 Pull Request。

### FAQ：`.gemini/` 与 `.agents/` 的区别及三层配置文件架构

`.gemini/` 与 `.agents/` 职责完全不同，请**不要**将 `.gemini/` 重命名为 `.agents/`：

| 路径 | 层级与职责 | 用途说明 |
| :--- | :--- | :--- |
| `~/.gemini/antigravity-cli/settings.json` | **CLI 专属配置（最高优先级）** | 由 `agy` CLI 自身维护，优先级高于全局配置文件，配置时必须同步写入。 |
| `~/.gemini/settings.json` | **全局配置（中优先级）** | 跨 Gemini / Antigravity 工具共用的全局配置文件。 |
| `<workspace>/.gemini/settings.json` | **项目运行时配置（工作区层）** | 覆盖当前项目工作区的 `statusLine`、`ui.language`、`ui.footer.labelStyle` 与 `ui.footer.items`。 |
| `.agents/skills/<name>.md` | **工作区技能定制** | 在单一工作区覆盖或新增技能（Skill）描述。 |
| `.agents/mcp_config.json` | **工作区 MCP 服务器配置** | 该项目专属的模型上下文协议（Model Context Protocol）连接设置。 |
