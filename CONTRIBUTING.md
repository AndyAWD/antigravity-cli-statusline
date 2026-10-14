# Contributing to Antigravity CLI Statusline

[English](#english-us) | [繁體中文](#繁體中文-zh-tw) | [简体中文](#简体中文-zh-cn)

---

## English (us)

### 💡 Add Your Language Translation via AI

You can generate a new language translation for this plugin using an AI agent (such as Gemini). To ensure even fast models (like Gemini Flash) can process this accurately, copy and paste the prompt below.

Replace `[LANG_CODE]` with your target language code (e.g., `kr` — note that `zh-tw`, `zh-cn`, `us`, and `jp` are already built-in), and `[Target Language]` with the language name (e.g., `"Korean"`):

````text
I want to add a [Target Language] translation version for this Antigravity CLI Statusline plugin (Language Code: [LANG_CODE]).

Since this project dynamically handles multiple languages within existing files, please DO NOT create new directories. Follow these exact steps to modify the existing files:

### 1. Modify `skills/agy-cli-statusline/SKILL.md`
- **Find Step 1 (步驟 1)**: Update the `question` title and add `"[Target Language] ([LANG_CODE])"` to the `options` JSON array.
- **Find Locale Locking (🌐 語言鎖定規則) and Step 3 (步驟 3)**: Add `[LANG_CODE]` to the list of supported language codes.

### 2. Modify `skills/agy-cli-statusline/resources/questions.json`
- Add a new `"[LANG_CODE]"` object at the root level with `"question"` and `"options"`.
- Translate all **32 statusline indicators** in `"options"` into [Target Language] using the exact format `"<Localized Description> (<indicator-id>)"` (keep the `(Recommended)` prefix on the first 4 items).

### 3. Modify `skills/agy-cli-statusline/scripts/statusline-quota.mjs`
- **Find `normalizeLanguage(lang)`**: Add matching rules to normalize `[LANG_CODE]` and related locale aliases to `'[LANG_CODE]'`.
- **Find `buildI18nDict(lang, m)`**: Add a new `[LANG_CODE]` object inside the `dicts` map. Translate all **36 keys** (**32 status indicators** + **4 merged bar graph keys**: `quota+bar`, `context-used+bar`, `quota-weekly+bar`, `token-count+bar`) into [Target Language]. Refer to the `zh-tw`, `zh-cn`, `us`, or `jp` entries and preserve all ANSI color variables (`${BOLD}`, `${WHITE}`, `${RESET}`, etc.) and `${m.*}` template expressions.
- **Find `getGitBranch(projectPath, lang)`**: Update both ternary expressions (inside the `return` statement and inside the `catch` block) to include the translation for `"No VC"` in [Target Language].
- **Find `unknownStr`, `noneStr`, `vcsDirtyLabel`, `sandboxStatusVal`, and `agentProfileName` in `main()`**: Update their ternary expressions to include [Target Language] translations for `"Unknown"`, `"None"`, `"Dirty"` / `"Clean"`, `"Sandbox"` / `"Local"`, and `"Default"`.

### 4. Modify `skills/agy-cli-statusline/scripts/configure-statusline.mjs`
- **Find `normalizeLanguage(l)`**: Add the same locale alias normalization rules for `'[LANG_CODE]'` as in `statusline-quota.mjs`.
- **Find the Windows `sh.exe` compilation warning**: Add an `else if (lang === '[LANG_CODE]')` branch with the translated warning message.
````

### 🛠️ Adding a New Statusline Indicator

To add a new statusline indicator (`<indicator-id>`):

1. **`skills/agy-cli-statusline/resources/questions.json`**: Append `"<Description> (<indicator-id>)"` to the `options` array across all supported locales (`zh-tw`, `zh-cn`, `us`, `jp`).
2. **`skills/agy-cli-statusline/scripts/statusline-quota.mjs`**:
   - Compute the indicator value in `main()` and pass it into the `metrics` object (`m`) supplied to `buildI18nDict(lang, m)`.
   - Add `<indicator-id>` to every locale dictionary inside `buildI18nDict(lang, m)`.
   - If the indicator pairs with a bar graph (`<indicator-id>-bar`), register the pair in `MERGEABLE_BAR_PAIRS` and add the combined `<indicator-id>+bar` key to `buildI18nDict(lang, m)`.
3. **Documentation**: Add the indicator ID and description to `README.md`, `README.zh-TW.md`, and `README.zh-CN.md`.

### 🧪 Testing & Verification

Run the built-in Node.js test suite and counter verification script before submitting a Pull Request:

```bash
# Run all unit tests and counter checks
npm test

# Run the cross-platform diagnostic script
node skills/agy-cli-statusline/scripts/diagnose-statusline.mjs
```

### 🤝 Contributing

We welcome contributions! If you have ideas for new features, bug fixes, or improvements, feel free to open an Issue or submit a Pull Request. Whether it's adding a new status indicator, improving cross-platform compatibility, or fixing a typo, your help is appreciated.

### FAQ: `.gemini/` vs `.agents/` & Three-Layer `settings.json`

`.gemini/` and `.agents/` serve distinct roles — do **NOT** rename `.gemini/` to `.agents/`:

| Path | Role | Purpose |
| :--- | :--- | :--- |
| `~/.gemini/antigravity-cli/settings.json` | **CLI-Specific Settings (Highest Priority)** | Maintained by `agy` CLI; overrides global settings. Must be updated in sync. |
| `~/.gemini/settings.json` | **Global Settings (Medium Priority)** | Shared global configuration across Gemini / Antigravity tools. |
| `<workspace>/.gemini/settings.json` | **Workspace Runtime Settings (Project Layer)** | Project-specific `statusLine`, `ui.language`, and `ui.footer.items` overrides. |
| `.agents/skills/<name>.md` | **Workspace Skill Customization** | Override or add a skill description that applies only to the current workspace. |
| `.agents/mcp_config.json` | **Workspace MCP Server Config** | Project-specific Model Context Protocol (MCP) server connections. |

---

## 繁體中文 (zh-tw)

### 💡 使用 AI 一鍵新增其他語言

你可以使用人工智慧（Artificial Intelligence）代理（例如 Gemini）產生其他語言的翻譯版本。為了讓輕量模型（如 Gemini Flash）也能精確執行，請直接複製下方的提示詞（Prompt）。

請將 `[LANG_CODE]` 替換為目標語系代碼（例如 `kr`；目前專案已內建 `zh-tw`、`zh-cn`、`us`、`jp` 四種語系），並將 `【目標語言】` 替換為語言名稱（例如「韓文」）：

````text
我想為這個 Antigravity CLI Statusline 外掛新增【目標語言】翻譯版本（語系代碼：[LANG_CODE]）。

由於本專案是透過現有檔案動態處理多國語系，請「不要」建立新的資料夾。請嚴格遵守以下步驟，直接修改現有檔案：

### 1. 修改 `skills/agy-cli-statusline/SKILL.md`
- **尋找「步驟 1」**：在第一階段問卷 JSON 的 `question` 標題與 `options` 陣列中，新增 `"【目標語言】 ([LANG_CODE])"` 選項。
- **尋找「🌐 語言鎖定規則」與「步驟 3」**：在支援的語言代碼列表中補上 `[LANG_CODE]`。

### 2. 修改 `skills/agy-cli-statusline/resources/questions.json`
- 在根物件下新增 `"[LANG_CODE]"` 子物件，包含 `"question"` 與 `"options"` 陣列。
- 將 `"options"` 中的全部 **32 個狀態列指標**翻譯成【目標語言】，格式維持 `"<目標語言說明> (<英文識別碼>)"`（前 4 項請保留 `(Recommended)` 前綴）。

### 3. 修改 `skills/agy-cli-statusline/scripts/statusline-quota.mjs`
- **尋找 `normalizeLanguage(lang)` 函式**：新增對應判斷條件，將 `[LANG_CODE]` 及相關語系別名標準化為 `'[LANG_CODE]'`。
- **尋找 `buildI18nDict(lang, m)` 函式**：在 `dicts` 物件內新增 `[LANG_CODE]` 子物件，將全部 **36 個鍵值**（包含 **32 個狀態列指標**與 **4 個長條圖合併鍵值**：`quota+bar`、`context-used+bar`、`quota-weekly+bar`、`token-count+bar`）翻譯成【目標語言】。請參考 `zh-tw`、`zh-cn`、`us` 或 `jp` 的範本，保留原有的美國國家標準協會（ANSI）色彩變數（如 `${BOLD}`、`${WHITE}`、`${RESET}`）與 `${m.*}` 變數插值。
- **尋找 `getGitBranch(projectPath, lang)` 函式**：修改 `return` 敘述與 `catch` 區塊中的三元運算子，加上【目標語言】對於「無版本控制（No VC）」的翻譯。
- **尋找 `main()` 內的 `unknownStr`、`noneStr`、`vcsDirtyLabel`、`sandboxStatusVal` 與 `agentProfileName` 變數**：修改三元運算子，補上【目標語言】對於「未知」、「無」、「有變更 / 乾淨」、「沙盒 / 本地」與「預設」的翻譯。

### 4. 修改 `skills/agy-cli-statusline/scripts/configure-statusline.mjs`
- **尋找 `normalizeLanguage(l)` 函式**：同步加入與 `statusline-quota.mjs` 相同的 `'[LANG_CODE]'` 語系標準化規則。
- **尋找 Windows `sh.exe` 編譯失敗警告**：新增 `else if (lang === '[LANG_CODE]')` 分支並填入【目標語言】的警告訊息。
````

### 🛠️ 新增狀態列指標指南

若要新增一個狀態列指標（假設識別碼為 `<indicator-id>`）：

1. **`skills/agy-cli-statusline/resources/questions.json`**：在所有支援語系（`zh-tw`、`zh-cn`、`us`、`jp`）的 `options` 陣列尾端，依 `"<指標說明> (<indicator-id>)"` 格式加入新指標。
2. **`skills/agy-cli-statusline/scripts/statusline-quota.mjs`**：
   - 在 `main()` 中計算該指標的數值或文字，並放入傳遞給 `buildI18nDict(lang, m)` 的 `metrics`（`m`）物件中。
   - 在 `buildI18nDict(lang, m)` 內所有語系的字典中新增 `<indicator-id>` 鍵值。
   - 若該指標支援相鄰長條圖自動合併（`<indicator-id>-bar`），請同步在 `MERGEABLE_BAR_PAIRS` 註冊配對，並於 `buildI18nDict(lang, m)` 新增 `<indicator-id>+bar` 合併鍵值。
3. **說明文件更新**：將新指標補充至 `README.md`、`README.zh-TW.md` 與 `README.zh-CN.md` 的指標總覽表格中。

### 🧪 測試與驗證

在提交拉取請求（Pull Request）之前，請執行內建的自動化單元測試與計數器驗證腳本：

```bash
# 執行所有單元測試與計數器驗證
npm test

# 執行跨平台環境診斷腳本
node skills/agy-cli-statusline/scripts/diagnose-statusline.mjs
```

### 🤝 貢獻指南

歡迎提交拉取請求參與貢獻！如果你對本專案有新功能構想、發現錯誤（Bug），或欲改善程式碼與跨平台相容性（Compatibility），歡迎隨時建立問題單（Issue）或發起拉取請求。

### FAQ：`.gemini/` 與 `.agents/` 的差別及三層設定檔架構

`.gemini/` 與 `.agents/` 職責不同，請**不要**將 `.gemini/` 重新命名為 `.agents/`：

| 路徑 | 層級與職責 | 用途說明 |
| :--- | :--- | :--- |
| `~/.gemini/antigravity-cli/settings.json` | **CLI 專屬設定（最高優先級）** | 由 `agy` CLI 自身維護，優先級高於全域設定檔，配置時必須同步寫入。 |
| `~/.gemini/settings.json` | **全域設定（中優先級）** | 跨 Gemini / Antigravity 工具共用的全域設定檔。 |
| `<workspace>/.gemini/settings.json` | **專案執行期設定（工作區層）** | 覆寫當前專案工作區的 `statusLine`、`ui.language` 與 `ui.footer.items`。 |
| `.agents/skills/<name>.md` | **工作區技能客製化** | 在單一工作區覆寫或新增技能（Skill）描述。 |
| `.agents/mcp_config.json` | **工作區 MCP 伺服器設定** | 該專案專屬的模型內容協定（Model Context Protocol）連線設定。 |

---

## 简体中文 (zh-cn)

### 💡 使用 AI 一键新增其他语言

你可以使用人工智能（Artificial Intelligence）代理（例如 Gemini）快速生成其他语言的翻译版本。为了让轻量模型（如 Gemini Flash）也能精确执行，请直接复制下方的提示词（Prompt）。

请把 `[LANG_CODE]` 换成你的目标语系代码（例如 `kr`；目前项目已内置 `zh-tw`、`zh-cn`、`us`、`jp` 四种语系），把 `【目标语言】` 换成语言名称（例如“韩文”）：

````text
我想为这个 Antigravity CLI Statusline 插件新增【目标语言】翻译版本（语系代码：[LANG_CODE]）。

由于本项目是通过现有文件动态处理多国语言，请“不要”建立新的文件夹。请严格遵守以下步骤，直接修改现有文件：

### 1. 修改 `skills/agy-cli-statusline/SKILL.md`
- **寻找“步骤 1”**：在第一阶段问卷 JSON 的 `question` 标题与 `options` 数组中，新增 `"【目标语言】 ([LANG_CODE])"` 选项。
- **寻找“🌐 语言锁定规则”与“步骤 3”**：在支持的语言代码列表中补上 `[LANG_CODE]`。

### 2. 修改 `skills/agy-cli-statusline/resources/questions.json`
- 在根对象下新增 `"[LANG_CODE]"` 子对象，包含 `"question"` 与 `"options"` 数组。
- 将 `"options"` 中的全部 **32 个状态栏指标**翻译成【目标语言】，格式维持 `"<目标语言说明> (<英文标识码>)"`（前 4 项请保留 `(Recommended)` 前缀）。

### 3. 修改 `skills/agy-cli-statusline/scripts/statusline-quota.mjs`
- **寻找 `normalizeLanguage(lang)` 函数**：新增对应判断条件，将 `[LANG_CODE]` 及相关语系别名标准化为 `'[LANG_CODE]'`。
- **寻找 `buildI18nDict(lang, m)` 函数**：在 `dicts` 对象内新增 `[LANG_CODE]` 子对象，将全部 **36 个键值**（包含 **32 个状态栏指标**与 **4 个长条图合并键值**：`quota+bar`、`context-used+bar`、`quota-weekly+bar`、`token-count+bar`）翻译成【目标语言】。请参考 `zh-tw`、`zh-cn`、`us` 或 `jp` 的范本，保留原有的 ANSI 色彩变量（如 `${BOLD}`、`${WHITE}`、`${RESET}`）与 `${m.*}` 变量插值。
- **寻找 `getGitBranch(projectPath, lang)` 函数**：修改 `return` 语句与 `catch` 区块中的三元运算符，加上【目标语言】对于“无版本控制（No VC）”的翻译。
- **寻找 `main()` 内的 `unknownStr`、`noneStr`、`vcsDirtyLabel`、`sandboxStatusVal` 与 `agentProfileName` 变量**：修改三元运算符，补上【目标语言】对于“未知”、“无”、“有更改 / 干净”、“沙盒 / 本地”与“默认”的翻译。

### 4. 修改 `skills/agy-cli-statusline/scripts/configure-statusline.mjs`
- **寻找 `normalizeLanguage(l)` 函数**：同步加入与 `statusline-quota.mjs` 相同的 `'[LANG_CODE]'` 语系标准化规则。
- **寻找 Windows `sh.exe` 编译失败警告**：新增 `else if (lang === '[LANG_CODE]')` 分支并填入【目标语言】的警告信息。
````

### 🛠️ 新增状态栏指标指南

若要新增一个状态栏指标（假设标识码为 `<indicator-id>`）：

1. **`skills/agy-cli-statusline/resources/questions.json`**：在所有支持语系（`zh-tw`、`zh-cn`、`us`、`jp`）的 `options` 数组末尾，按 `"<指标说明> (<indicator-id>)"` 格式加入新指标。
2. **`skills/agy-cli-statusline/scripts/statusline-quota.mjs`**：
   - 在 `main()` 中计算该指标的数值或文本，并放入传递给 `buildI18nDict(lang, m)` 的 `metrics`（`m`）对象中。
   - 在 `buildI18nDict(lang, m)` 内所有语系的字典中新增 `<indicator-id>` 键值。
   - 若该指标支持相邻长条图自动合并（`<indicator-id>-bar`），请同步在 `MERGEABLE_BAR_PAIRS` 注册配对，并在 `buildI18nDict(lang, m)` 新增 `<indicator-id>+bar` 合并键值。
3. **说明文档更新**：将新指标补充至 `README.md`、`README.zh-TW.md` 与 `README.zh-CN.md` 的指标总览表格中。

### 🧪 测试与验证

在提交拉取请求（Pull Request）之前，请运行内置的自动化单元测试与计数器验证脚本：

```bash
# 运行所有单元测试与计数器验证
npm test

# 运行跨平台环境诊断脚本
node skills/agy-cli-statusline/scripts/diagnose-statusline.mjs
```

### 🤝 贡献指南

欢迎提交拉取请求参与贡献！如果你对本项目有新功能构想、发现错误（Bug），或想优化代码与跨平台兼容性（Compatibility），欢迎随时创建 Issue 或发起 Pull Request。

### FAQ：`.gemini/` 与 `.agents/` 的区别及三层配置文件架构

`.gemini/` 与 `.agents/` 职责完全不同，请**不要**将 `.gemini/` 重命名为 `.agents/`：

| 路径 | 层级与职责 | 用途说明 |
| :--- | :--- | :--- |
| `~/.gemini/antigravity-cli/settings.json` | **CLI 专属配置（最高优先级）** | 由 `agy` CLI 自身维护，优先级高于全局配置文件，配置时必须同步写入。 |
| `~/.gemini/settings.json` | **全局配置（中优先级）** | 跨 Gemini / Antigravity 工具共用的全局配置文件。 |
| `<workspace>/.gemini/settings.json` | **项目运行时配置（工作区层）** | 覆盖当前项目工作区的 `statusLine`、`ui.language` 与 `ui.footer.items`。 |
| `.agents/skills/<name>.md` | **工作区技能定制** | 在单一工作区覆盖或新增技能（Skill）描述。 |
| `.agents/mcp_config.json` | **工作区 MCP 服务器配置** | 该项目专属的模型上下文协议（Model Context Protocol）连接设置。 |
