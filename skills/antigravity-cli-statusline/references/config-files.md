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
  "command": "node <真實的使用者家目錄絕對路徑>/.gemini/antigravity-cli/hooks/statusline-quota.mjs"
}
```

> ⚠️ **絕對禁止照抄** `<真實的使用者家目錄絕對路徑>` 此佔位符。AI 代理必須動態解析當前系統環境中真實的絕對路徑（例如 `/Users/andy`）後替換。

---

## 3. statusLine 物件結構（Windows）

詳見 [windows.md §5](windows.md#5-settingsjson-中-windows-路徑跳脫範本)。Windows 路徑必須使用雙反斜線跳脫，且寫檔時必須遵守 UTF-8 無 BOM 規範。

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

- `ui.language` 可為 `zh-tw` / `us` / `jp`
- `ui.footer.items` 為英文識別碼陣列，順序決定狀態列顯示順序
- 支援的識別碼：`model-name` / `agent-profile` / `agent-state` / `sandbox-status` / `context-used` / `token-count` / `artifacts` / `account-email` / `plan-tier` / `quota` / `quota-reset-countdown` / `ai-credits` / `tool-confirmation` / `pending-input` / `background-tasks` / `subagents` / `project-path` / `project-full-path` / `vcs-type` / `git-branch` / `vcs-dirty` / `memory-usage` / `cli-version` / `conversation-id`
- 特殊識別碼：`n` 或 `newline` 用於強制換行（可重複出現）

---

## 5. trusted_hooks.json 信任機制

路徑：`~/.gemini/trusted_hooks.json`（全域）

為防止 CLI 將 Hook 靜默阻擋，必須在下列三個鍵的陣列中註冊信任字串：

1. 當前工作區目錄（鍵為當前 workspace 絕對路徑）
2. 使用者家目錄（鍵為 `$HOME` / `USERPROFILE` 展開後的絕對路徑）
3. `"*"` 通配符鍵

### 信任字串格式

**macOS / Linux**：
```text
statusLine:node <真實的使用者家目錄絕對路徑>/.gemini/antigravity-cli/hooks/statusline-quota.mjs
```

**Windows**（請同時追加 forward slash 與 `%USERPROFILE%` 變體）：
```text
statusLine:node <真實的使用者家目錄絕對路徑>\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs
```

> ⚠️ 必須**同時追加**絕對路徑變體與環境變數變體（`$HOME` 或 `%USERPROFILE%`），以完美通過 CLI 的安全性檢驗。

---

## 6. 跨電腦移植的雙保險設計

### 寫入 `settings.json` 時：用絕對路徑

AI 代理動態獲取當前使用者的家目錄絕對路徑後，直接將**絕對路徑**寫入 `command` 中（例如 `node /Users/andy/.gemini/...`）。這 100% 確保在本機上執行成功，免去 Shell 展開的依賴。

❌ 錯誤：`node $HOME/.gemini/...`（CLI 背景以直接呼叫方式執行 Hook 時無法透過 Shell 展開環境變數，導致 Node.js 因找不到路徑而失敗）

### 寫入 `trusted_hooks.json` 時：同時追加絕對路徑與環境變數變體

```text
statusLine:node /Users/andy/.gemini/antigravity-cli/hooks/statusline-quota.mjs
statusLine:node $HOME/.gemini/antigravity-cli/hooks/statusline-quota.mjs
```

### 跨電腦移植時的自癒機制

由於開源分享或複製設定檔到新電腦時絕對路徑會改變，新電腦的 AI 代理在首次執行本技能時，會全自動動態重新解析新電腦的絕對路徑並覆寫更新設定。因此**直接寫入絕對路徑是最健壯且無副作用的方案**。
