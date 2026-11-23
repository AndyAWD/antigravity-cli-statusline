# 設定檔規範（Reference）

> [!IMPORTANT]
> 本檔案記錄狀態列設定檔的 JSON 結構與跨平台執行命令規範。
> 1. **禁止以 `read_file` 或 `edit_file` 工具直接存取 `~/.gemini/` 下的 `settings.json`** — 所有設定檔更新均由 `scripts/configure-statusline.mjs` 自動處理。
> 2. **禁止改寫、簡化、重新格式化任何 JSON 區塊或路徑範本**。

---

## 目錄

- [1. 三層設定檔架構與優先級](#1-三層設定檔架構與優先級)
- [2. statusLine 物件結構（macOS / Linux）](#2-statusline-物件結構macos--linux)
- [3. statusLine 物件結構（Windows）](#3-statusline-物件結構windows)
- [4. ui.language 與 ui.footer.items 結構](#4-uilanguage-與-uifooteritems-結構)
- [5. 原生 /statusline 斜線指令支援](#5-原生-statusline-斜線指令支援)
- [6. 跨電腦移植與相容性設計](#6-跨電腦移植與相容性設計)
- [7. 掛鉤部署清單與模組化相容規範](#7-掛鉤部署清單與模組化相容規範)

---

## 1. 三層設定檔架構與優先級

`configure-statusline.mjs` 腳本會自動同步更新三層設定檔，確保 CLI 本體與狀態列渲染腳本讀取一致的設定：

| 層級 | 路徑語法 | 動態解析方式 | 優先級 |
|---|---|---|---|
| **CLI 專屬設定檔（最高優先級）** | `~/.gemini/antigravity-cli/settings.json` | 展開 `$HOME` / `USERPROFILE` | **🔥 最高（覆蓋全域）** |
| **全域設定檔** | `~/.gemini/settings.json` | 展開 `$HOME` / `USERPROFILE` | 中 |
| **專案設定檔** | `<workspace>/.gemini/settings.json` | 當前工作區根目錄 | 條件性（若存在）|

> [!NOTE]
> CLI 專屬設定檔 `~/.gemini/antigravity-cli/settings.json` 由 `agy` CLI 讀取以決定 `statusLine.command`。`configure-statusline.mjs` 會在保留使用者既有屬性（如 `permissions`、`trustedWorkspaces`、`model`、`colorScheme` 等）的前提下，局部更新 `ui.language`、`ui.footer` 與 `statusLine`。

---

## 2. statusLine 物件結構（macOS / Linux）

寫入下列 JSON 至**所有三層**設定檔的根節點：

```json
"statusLine": {
  "enabled": true,
  "type": "command",
  "command": "<真實的 Node.js 執行檔絕對路徑> <真實的使用者家目錄絕對路徑>/.gemini/antigravity-cli/hooks/statusline-quota.mjs"
}
```

> [!IMPORTANT]
> **為什麼 macOS / Linux 必須使用 Node.js 絕對路徑**：
> agy CLI 的狀態列執行器底層透過 `/bin/sh -c "<command>"` 呼叫掛鉤。在 macOS 與 Linux 上，使用者廣泛採用 NVM、fnm、Homebrew 或 asdf 管理 Node.js，這些工具的 `PATH` 通常僅設定在使用者互動式 Shell 設定檔（如 `~/.zshrc` 或 `~/.bashrc`）中。非互動式（Non-interactive）與非登入（Non-login）的 `/bin/sh` 僅包含系統預設的 `/usr/bin:/bin:/usr/sbin:/sbin`，**完全找不到裸命令 `node`**，進而導致 `exit status 127 (sh: 1: node: not found)`，並在累積失敗 30 次後被 CLI 自動停用。
> 因此配置腳本自動取得當前執行的 `process.execPath`（例如 `/opt/homebrew/bin/node` 或 `/Users/andy/.nvm/versions/node/v20.0.0/bin/node`）寫入設定；若執行路徑或腳本路徑包含空白字元，則自動以雙引號包裹。

> ⚠️ **絕對禁止照抄** `<真實的 Node.js 執行檔絕對路徑>` 與 `<真實的使用者家目錄絕對路徑>` 此類佔位符。AI 代理必須動態解析當前系統環境中真實的絕對路徑後替換。

---

## 3. statusLine 物件結構（Windows）

詳見 [windows.md §5](windows.md#5-settingsjson-中-windows-路徑跳脫範本)。Windows 上因 `agy.exe` 底層透過 Go `exec.CommandContext(ctx, "cmd", "/c", command)` 呼叫，任何雙引號 `"` 都會被 Go 的 `syscall.EscapeArg` 轉義為 `\"` 並被 `node.exe`（MSVC CRT）當作字面上的雙引號字元，導致 `Cannot find module 'D:\cwd\"C:\...\statusline-quota.mjs"'` 錯誤。因此 Windows 指令**絕對禁止包含雙引號 `"`**：
- 若掛鉤腳本路徑**不含空白**，寫入無雙引號的 `node <腳本絕對路徑>`：

```json
"statusLine": {
  "enabled": true,
  "type": "command",
  "command": "node <真實的使用者家目錄絕對路徑>\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs"
}
```

- 若掛鉤腳本路徑**包含空白**（例如 `C:\Users\John Doe`），則將路徑轉為 `file:///` URL（空格編碼為 `%20`），寫入無雙引號的 `node --import <fileUrl> -e 0`：

```json
"statusLine": {
  "enabled": true,
  "type": "command",
  "command": "node --import file:///C:/Users/John%20Doe/.gemini/antigravity-cli/hooks/statusline-quota.mjs -e 0"
}
```

> [!NOTE]
> Windows 系統中，Node.js 官方安裝程式與版本管理工具（`nvm-windows`、`fnm`、`scoop`）皆會將 `node.exe` 登錄至系統或使用者環境變數（Windows 登錄檔 `PATH`），所有子行程（包含 `cmd.exe`）皆會繼承。
> 在 Windows 上使用無雙引號的 `node` 裸命令（含空格時搭配 `--import file:///... -e 0`）能完全避開 Go `EscapeArg` 的 `\"` 字面引號污染陷阱以及 `C:\Program Files\nodejs\node.exe` 空白字元引發的 `cmd.exe /c` 雙引號剝除陷阱。

---

## 4. ui.language 與 ui.footer.items 結構

```json
"ui": {
  "language": "zh-tw",
  "footer": {
    "labelStyle": "text",
    "items": [
      "model-name",
      "quota",
      "context-used",
      "memory-usage"
    ]
  }
}
```

- `ui.language` 可為 `zh-tw` / `zh-cn` / `us` / `jp`
- `ui.footer.labelStyle` 可為 `"text"`（預設，顯示文字標籤與冒號，如 `模型: Gemini 3.1 Pro`）或 `"emoji"`（以專屬 Emoji 取代文字標籤並省略冒號，如 `🤖 Gemini 3.1 Pro`）
- `ui.footer.items` 為英文識別碼陣列，順序決定狀態列顯示順序
- 支援的識別碼（共 39 項）：`model-name` / `agent-profile` / `agent-state` / `mode` / `quota` / `quota-bar` / `quota-reset-countdown` / `quota-reset-time` / `quota-weekly` / `quota-weekly-bar` / `quota-weekly-countdown` / `quota-weekly-reset-time` / `quota-argon` / `quota-argon-bar` / `quota-argon-countdown` / `quota-argon-reset-time` / `plan-tier` / `account-email` / `context-used` / `context-used-bar` / `token-count` / `token-count-bar` / `project-path` / `project-full-path` / `git-branch` / `vcs-dirty` / `vcs-type` / `memory-usage` / `cli-version` / `conversation-id` / `sandbox-status` / `tool-confirmation` / `pending-input` / `background-tasks` / `subagents` / `artifacts` / `plugin-version` / `plugin-update` / `app-version`
- 特殊識別碼：`n` 或 `newline` 用於強制換行（可重複出現）
- 自訂設定：
  - `ui.footer.labelStyle`：標籤顯示樣式（`"text"` 或 `"emoji"`，預設 `"text"`）
  - `ui.footer.barLength`：長條圖格數（預設 `10`）
  - `ui.footer.timeFormat`：重置時間格式，可選 `"smart"` / `"auto"`（預設，同日 `HH:mm`、跨日 `yyyy/MM/dd HH:mm`）、`"yyyy/MM/dd HH:mm"`、`"12h"`、`"24h"`
  - 渲染器與歷史鍵防禦：目前狀態列採用 `standard` 渲染器（透過 `lib/renderers/index.mjs` 管理）。`ui.footer.theme`（及 `ui.footer.style`、`ui.labelStyle`）為向下相容之清理鍵，於讀取與配置時會主動移除；未來若新增動畫或自訂風格（如 `dino`），應採用明確設定鍵（例如 `ui.footer.renderer`），不得重複使用 `ui.footer.theme`

---

## 5. 原生 `/statusline` 斜線指令支援

Antigravity CLI 內建 `/statusline` 斜線指令，可於 TUI 互動介面中直接管理狀態列：

- `/statusline`：切換啟用或停用狀態列。
- `/statusline <command>`：直接設定自訂狀態列命令並立即啟用（無需重啟 CLI）。
- `/statusline on` / `/statusline off`：明確開啟或關閉自訂狀態列。
- `/statusline delete` / `/statusline reset`：清除自訂命令並還原為內建預設狀態列。

此外，`configure-statusline.mjs` 亦向下相容維護舊版 CLI 所需的設定項目，無須由 AI 代理手動編輯設定檔。

---

## 6. 跨電腦移植與相容性設計

### 寫入 `settings.json` 時

- **macOS / Linux**：使用目前環境 Node.js 執行檔絕對路徑（`process.execPath`）搭配腳本絕對路徑，若路徑含空格以引號包裹。免去 non-interactive `sh` 遺失 `PATH` 的問題（exit status 127）。
- **Windows**：使用無雙引號的 `node` 裸命令搭配腳本絕對路徑（含空格時轉為 `node --import file:///... -e 0`）。免去 Go `exec.Command("cmd", "/c", command)` 的 `\"` 字面引號污染與 `C:\Program Files\nodejs\node.exe` 空白引號剝除問題。

### 跨電腦移植時的自動更新機制

由於複製設定檔到新電腦時絕對路徑可能改變，在新電腦執行本技能的 `configure-statusline.mjs` 時，腳本會自動動態解析新電腦的絕對路徑並更新設定。

---

## 7. 掛鉤部署清單與模組化相容規範

1. **四層模組化架構與遞迴部署**：
   - `skills/agy-cli-statusline/scripts/lib/` 依職責劃分為四層：`core/`、`collectors/`、`metrics/` 與 `renderers/`。
   - 執行 `configure-statusline.mjs` 時，會一併將 `statusline-quota.mjs`、`fetch-local-quota.mjs`、遞迴複製的 `hooks/lib/`（保留四層目錄結構）以及 `.hook-version.json` 部署至 `~/.gemini/antigravity-cli/hooks/`。
   - `hooks/.hook-version.json` 記錄所有已部署檔案（含 `statusline-quota.mjs`、`fetch-local-quota.mjs` 與 `lib/**/*.mjs`）的 SHA-256 雜湊值，供 `diagnose-statusline.mjs` 驗證同步狀態。
2. **`statusLine.command` 與 `trusted_hooks.json` 相容性**：
   - 即使內部邏輯拆分為 `hooks/lib/`，`statusLine.command` 仍固定指向 `~/.gemini/antigravity-cli/hooks/statusline-quota.mjs`，以確保既有的 `~/.gemini/trusted_hooks.json` 白名單（`statusLine:<command>`）持續相容，無須變更信任規則。
