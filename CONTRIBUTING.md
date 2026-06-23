# Contributing to Antigravity CLI Statusline

[English](#english-us) | [繁體中文](#繁體中文-zh-tw)

---

## English (us)

### 💡 Add Your Language Translation via AI

You can easily generate a new language translation for this Skill using an AI agent (like Gemini). To ensure even fast models (like Gemini Flash) can process this perfectly, just copy and paste the prompt below.

Replace `[LANG_CODE]` with your target language code (e.g., `ja`), and `[Target Language]` with the language name (e.g., "Japanese"):

````text
I want to add a [Target Language] translation version for this Antigravity CLI Skill (Language Code: [LANG_CODE]).

Since this project dynamically handles languages within single files, please DO NOT create new directories. Please follow these explicit steps to modify the existing files:

### 1. Modify `skills/antigravity-cli-statusline/SKILL.md`
- **Find Step 1 (步驟 1)**: Add the `"[Target Language] ([LANG_CODE])"` option to the `options` JSON array.
- **Find Step 4 (步驟 4)**: Add a bullet point explaining the language format for your code (e.g., `* 若為 [LANG_CODE]，請使用[Target Language]說明配上英文識別碼。`).

### 2. Modify `skills/antigravity-cli-statusline/scripts/statusline-quota.mjs`
- **Find the `buildI18nDict(lang, m)` function**: Add a new `[LANG_CODE]` object inside the `dicts` map. Translate all 24 status indicators into [Target Language]. Look at the `zh-tw` or `us` examples and keep the ANSI color variables (like `${BOLD}`, `${WHITE}`, `${RESET}`) exactly the same.
- **Find the `getGitBranch(lang)` function**: Update **all** the hardcoded ternary operators (there are two places — inside the `return` statement and inside the `catch` block) to include the translation for "No VC" in [Target Language].
- **Find the `unknownStr` and `noneStr` variables**: Update the hardcoded ternary operators to include translations for "Unknown" and "N/A" / "None" in [Target Language]. These power fallback values for `countdownVal`, `accountEmail`, `aiCredits`, and a few other indicators.
````

### 🤝 Contributing

We welcome contributions! If you have ideas for new features, bug fixes, or improvements, feel free to open an issue or submit a Pull Request. Whether it's adding a new status indicator, improving cross-platform compatibility, or fixing a typo, your help is greatly appreciated.

### FAQ: `.gemini/` vs `.agents/`

These two directories serve completely different roles — do NOT rename `.gemini/` to `.agents/`:

| Directory | Role | When to use |
|---|---|---|
| `.gemini/settings.json` | agy CLI **runtime settings** (workspace layer) | The CLI itself reads this to apply `statusLine`, `ui.language`, `ui.footer.items` for the current project. |
| `.agents/skills/<name>.md` | Workspace-level **skill customization** | Override or add a skill description that only applies to this workspace. |
| `.agents/mcp_config.json` | Workspace-level **MCP server config** | Project-specific MCP connections. |

---

## 繁體中文 (zh-tw)

### 💡 使用 AI 一鍵新增其他語言

你可以使用 AI 助理快速產生其他語言的翻譯版本。為了讓快速模型（如 Gemini Flash）也能精確執行，請直接複製下方的提示詞（Prompt）。

請把 `[LANG_CODE]` 換成你的語系代碼（例如 `ja`），把 `【目標語言】` 換成語言名稱（例如「日文」）：

````text
我想為這個 Antigravity CLI Skill 新增【目標語言】翻譯版本（語系代碼：[LANG_CODE]）。

由於本專案是透過單一檔案動態處理多國語系，請「不要」建立新的資料夾。請嚴格遵守以下步驟，直接修改現有檔案：

### 1. 修改 `skills/antigravity-cli-statusline/SKILL.md`
- **尋找「步驟 1」**：在第一階段問卷 JSON 的 `options` 陣列中，新增 `"【目標語言】 ([LANG_CODE])"` 的選項。
- **尋找「步驟 4」**：在列舉說明格式的地方，補上你的語系（例如：`* 若為 [LANG_CODE]，請使用【目標語言】說明配上英文識別碼。`）。

### 2. 修改 `skills/antigravity-cli-statusline/scripts/statusline-quota.mjs`
- **尋找 `buildI18nDict(lang, m)` 函式**：在 `dicts` 物件內新增一個 `[LANG_CODE]` 子物件，並把全部 24 個狀態列指標翻譯成【目標語言】。請參考 `zh-tw` 或 `us` 的範本，務必保留原有的 ANSI 色彩變數（如 `${BOLD}`、`${WHITE}`、`${RESET}`）。
- **尋找 `getGitBranch(lang)` 函式**：修改裡面**所有**寫死的三元運算子（共兩處——一處在 `return` 句、另一處在 `catch` 區塊），加上【目標語言】對於「無版本控制」的翻譯。
- **尋找 `unknownStr` 與 `noneStr` 兩個變數**：修改三元運算子，加上【目標語言】對於「未知」與「無 / N/A」的翻譯。這兩個變數會作為 `countdownVal`、`accountEmail`、`aiCredits` 等指標的 fallback 值。
````

### 🤝 貢獻指南

非常歡迎大家提交 PR（Pull Request）來參與貢獻！如果你對這個專案有任何新功能的想法、發現 Bug，或是想要最佳化程式碼，都歡迎隨時發起 PR 或建立 Issue。不論是新增更多的狀態列指標、改善跨平台相容性（Compatibility），或是修正錯字，都非常期待你的加入！

### FAQ：`.gemini/` 與 `.agents/` 的差別

兩者角色完全不同，請**不要**將 `.gemini/` 改名為 `.agents/`：

| 目錄 | 角色 | 何時用 |
|---|---|---|
| `.gemini/settings.json` | agy CLI **runtime 設定**（專案層） | CLI 自身讀取，用以套用當下專案的 `statusLine`、`ui.language`、`ui.footer.items`。 |
| `.agents/skills/<name>.md` | 工作區層級 **skill 客製化** | 在單一工作區覆寫或新增 skill 描述。 |
| `.agents/mcp_config.json` | 工作區層級 **MCP 伺服器設定** | 該專案專屬的 MCP 連線設定。 |
