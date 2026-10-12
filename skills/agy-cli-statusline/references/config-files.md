# 設定檔規範（Reference）

> [!IMPORTANT]
> 本檔案內含必須**逐字（verbatim）使用**的 JSON 結構、路徑範本與信任機制字串。
> AI 代理載入本檔案時必須遵守：
> 1. **禁止透過 Explore / 子代理（subagent）摘要本檔案** — 主代理必須親自以 Read 工具讀取
> 2. **禁止改寫、簡化、重新格式化任何 JSON 區塊或路徑範本**
> 3. **禁止省略多層設定檔中任何一層**（特別是 CLI 專屬設定檔，是最致命的盲點）
> 4. 若內容與你熟悉的其他 CLI / 工具格式不同，**一律以本檔案為準**（此為 agy CLI 專用規範）

---

## 目錄

- [1. 三層設定檔架構與優先級](#1-三層設定檔架構與優先級)
- [2. statusLine 物件結構（macOS / Linux）](#2-statusline-物件結構macos--linux)
- [3. statusLine 物件結構（Windows）](#3-statusline-物件結構windows)
- [4. ui.language 與 ui.footer.items 結構](#4-uilanguage-與-uifooteritems-結構)
- [5. trusted_hooks.json 信任機制](#5-trusted_hooksjson-信任機制)
- [6. 跨電腦移植的雙保險設計](#6-跨電腦移植的雙保險設計)

---

## 1. 三層設定檔架構與優先級

Antigravity CLI（agy）讀取**三層**設定檔。AI 代理**必須同時更新全部三層**，否則狀態列將無聲無息失效。

| 層級 | 路徑語法 | 動態解析方式 | 優先級 |
|---|---|---|---|
| **CLI 專屬設定檔（最高優先級）** | `~/.gemini/antigravity-cli/settings.json` | 展開 `$HOME` / `USERPROFILE` | **🔥 最高（覆蓋全域）** |
| **全域設定檔** | `~/.gemini/settings.json` | 展開 `$HOME` / `USERPROFILE` | 中 |
| **專案設定檔** | `<workspace>/.gemini/settings.json` | 當前工作區根目錄 | 條件性（若存在）|

> [!CAUTION]
> **最致命的隱蔽 Bug**：CLI 專屬設定檔 `~/.gemini/antigravity-cli/settings.json` 由 agy CLI 自身維護，優先級**高於**全域設定檔。若該檔案存在一個 `statusLine` 物件且 `command` 為空字串（如 `{ "type": "", "command": "", "enabled": true }`），全域設定檔中正確的 Hook 設定會被完全覆蓋。AI 代理**必須**在 Pre-check 階段讀取此檔案、在寫入階段同步覆寫此檔案。

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

詳見 [windows.md §5](windows.md#5-settingsjson-中-windows-路徑跳脫範本)。Windows 上寫入裸命令 `node`（若掛鉤腳本路徑含空白則為腳本路徑加上雙引號）：

```json
"statusLine": {
  "enabled": true,
  "type": "command",
  "command": "node \"<真實的使用者家目錄絕對路徑>\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs\""
}
```

> [!NOTE]
> Windows 系統中，Node.js 官方安裝程式與版本管理工具（`nvm-windows`、`fnm`、`scoop`）皆會將 `node.exe` 登錄至系統/使用者環境變數（Windows 登錄檔 `PATH`），所有子行程（包含 `cmd.exe`）皆會繼承。
> 在 Windows 上使用 `node` 裸命令能完全避開 `C:\Program Files\nodejs\node.exe` 空白字元引發的 `cmd.exe /c` 雙引號剝除陷阱，以及 Git Bash `sh.exe` 反斜線 `\n` 換行跳脫問題。

---

## 4. ui.language 與 ui.footer.items 結構

```json
"ui": {
  "language": "zh-tw",
  "footer": {
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
- `ui.footer.items` 為英文識別碼陣列，順序決定狀態列顯示順序
- 支援的識別碼：`model-name` / `agent-profile` / `agent-state` / `sandbox-status` / `context-used` / `token-count` / `artifacts` / `account-email` / `plan-tier` / `quota` / `quota-reset-countdown` / `quota-weekly` / `quota-weekly-countdown` / `tool-confirmation` / `pending-input` / `background-tasks` / `subagents` / `project-path` / `project-full-path` / `vcs-type` / `git-branch` / `vcs-dirty` / `memory-usage` / `cli-version` / `conversation-id` / `mode`
- 特殊識別碼：`n` 或 `newline` 用於強制換行（可重複出現）

---

## 5. trusted_hooks.json 信任機制

路徑：`~/.gemini/trusted_hooks.json`（全域）

為防止 CLI 將 Hook 靜默阻擋，必須在下列三個鍵的陣列中註冊信任字串：

1. 當前工作區目錄（鍵為當前 workspace 絕對路徑）
2. 使用者家目錄（鍵為 `$HOME` / `USERPROFILE` 展開後的絕對路徑）
3. `"*"` 萬用字元（Wildcard）鍵

### 信任字串格式

**macOS / Linux**（精確指令 + 絕對路徑變體 + `$HOME` 變體 + 裸命令相容）：
```text
statusLine:<真實的 Node.js 執行檔絕對路徑> <真實的使用者家目錄絕對路徑>/.gemini/antigravity-cli/hooks/statusline-quota.mjs
statusLine:"<真實的 Node.js 執行檔絕對路徑>" "<真實的使用者家目錄絕對路徑>/.gemini/antigravity-cli/hooks/statusline-quota.mjs"
statusLine:<真實的 Node.js 執行檔絕對路徑> $HOME/.gemini/antigravity-cli/hooks/statusline-quota.mjs
statusLine:node <真實的使用者家目錄絕對路徑>/.gemini/antigravity-cli/hooks/statusline-quota.mjs
statusLine:node $HOME/.gemini/antigravity-cli/hooks/statusline-quota.mjs
```

**Windows**（精確指令 + 雙反斜線 + forward slash + `%USERPROFILE%` + 引號變體）：
```text
statusLine:node <真實的使用者家目錄絕對路徑>\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs
statusLine:node "<真實的使用者家目錄絕對路徑>\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs"
statusLine:node <真實的使用者家目錄絕對路徑>/.gemini/antigravity-cli/hooks/statusline-quota.mjs
statusLine:node "<真實的使用者家目錄絕對路徑>/.gemini/antigravity-cli/hooks/statusline-quota.mjs"
statusLine:node %USERPROFILE%\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs
statusLine:node "%USERPROFILE%\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs"
```

> ⚠️ 必須**同時追加**寫入 `settings.json` 的精確指令字串、各類引號變體與環境變數變體（`$HOME` 或 `%USERPROFILE%`），以完美通過 CLI 的安全性檢驗。

---

## 6. 跨電腦移植的雙保險設計

### 寫入 `settings.json` 時

- **macOS / Linux**：使用目前環境 Node.js 執行檔絕對路徑（`process.execPath`）搭配腳本絕對路徑，若路徑含空格以引號包裹。免去 non-interactive `sh` 遺失 PATH 的問題（exit status 127）。
- **Windows**：使用 `node` 裸命令搭配腳本絕對路徑（含空格加引號）。免去 `C:\Program Files\nodejs\node.exe` 空白引號剝除與 Git Bash 換行跳脫問題。

### 寫入 `trusted_hooks.json` 時：全方位註冊

同時寫入精確命令、引號變體、環境變數變體與歷史裸命令變體，確保設定檔無論如何遷移都能保持信任狀態。

### 跨電腦移植時的自癒機制

由於開源分享或複製設定檔到新電腦時絕對路徑會改變，新電腦的 AI 代理在首次執行本技能時，會全自動動態重新解析新電腦的絕對路徑並覆寫更新設定。因此**直接由腳本動態解析並寫入適當的跨平台指令是最健壯且無副作用的方案**。
