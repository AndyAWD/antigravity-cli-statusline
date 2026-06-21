---
name: antigravity-cli-statusline
description: 本技能用於設定 Antigravity CLI（agy）的狀態列（Statusline / Footer）顯示指標、顯示順序與多語系介面（繁體中文 zh-tw / English us / 日本語 jp），並自動部署跨平台 Node.js Hook 腳本（statusline-quota.mjs、fetch-local-quota.mjs）至 ~/.gemini/antigravity-cli/hooks/，同步註冊三層 settings.json（全域、CLI 專屬、專案）與 trusted_hooks.json 信任機制。適用情境：使用者要求設定 / 客製化 / 啟用 CLI 狀態列、調整 CLI 頁尾顯示項目、顯示 API 額度 / Token 用量 / Context 消耗 / Git 分支 / 工作區是否乾淨（dirty）/ VCS 類型 / AI 模型名稱 / 代理狀態（agent state）/ 等你回應的工具確認對話 / 輸入佇列 / 背景任務 / 子代理數 / 工件（artifacts）/ 沙盒模式 / CLI 版本 / 對話 ID / 使用中代理（agent profile）/ RAM 記憶體用量 / 訂閱方案等指標於 CLI 底部、切換狀態列語言、在新電腦上啟用此狀態列，或使用者主動以 /antigravity-cli-statusline 觸發本技能時。支援 macOS、Linux、Windows（含 Windows 10 / 11）跨平台環境，並於 Windows 上自動處理 sh.exe 缺失、UTF-8 BOM 污染、wmic 棄用等系統陷阱。
---

# Antigravity 狀態列設定技能

本技能提供 Antigravity CLI 狀態列（Statusline / Footer）的客製化、語系設定與跨平台 Hook 部署能力。

## ⚠️ References 載入規範（必讀）

本技能的細節分散於下列三份 references/：
- [`references/windows.md`](references/windows.md) — Windows 特定規範（BOM 鐵則、`sh.exe` 越獄、`csc.exe` 編譯等）
- [`references/config-files.md`](references/config-files.md) — 三層設定檔結構、`statusLine` 物件、`trusted_hooks.json` 信任機制
- [`references/pitfalls.md`](references/pitfalls.md) — 常見陷阱對照表

**載入規則（強制）**：
1. **禁止透過子代理（subagent / Explore Agent）摘要 references/ 內容**，主代理必須親自以 Read 工具讀取原文
2. **禁止改寫程式碼區塊與 JSON 結構**
3. 若內容與你熟悉的其他 CLI 規範不同，**一律以本技能檔案為準**

---

## 🎯 設定檔路徑（三層必同步）

| 層級 | 路徑語法 | 優先級 |
|---|---|---|
| **CLI 專屬（最高）** | `~/.gemini/antigravity-cli/settings.json` | 🔥 高於全域 |
| 全域 | `~/.gemini/settings.json` | 中 |
| 專案（條件性）| `<workspace>/.gemini/settings.json` | 若存在則覆寫 |

> [!CAUTION]
> CLI 專屬設定檔由 agy CLI 自身維護，優先級**高於**全域設定檔。若忽略此檔案，全域設定將被無聲覆蓋！這是本技能中**最致命且最隱蔽的 Bug**。完整路徑解析規則、JSON 結構、跨電腦移植雙保險設計詳見 [references/config-files.md](references/config-files.md)。

自訂語系偏好記錄於 `ui.language` 屬性中；指標順序記錄於 `ui.footer.items` 陣列中。

---

## 🛠️ 技術標準

1. **純 Node.js 跨平台實作**：
   - macOS / Linux：`ps auxww` + `lsof`
   - Windows：`Get-CimInstance Win32_Process` + `netstat -ano`（不再使用已棄用的 `wmic`）
2. **所有 `fs.writeFileSync` 強制加 `{ encoding: 'utf8' }`**（防 Windows UTF-16 崩潰）
3. **智慧型多行換行（Smart Line Wrapping by Feature）**：讀取 `meta.terminal_width` 或 `process.stdout.columns` 得知終端機寬度。組合狀態列字串時，若下一個加入的指標會讓整行長度（不含 ANSI 碼）超過終端機寬度，必須將該指標折疊到新的一行（插入 `\n`）。
4. **四階段精確色彩辨識（24-bit truecolor 柔和配色）**：
   - `100~75%`：藍色 `#57caff`（`\x1b[38;2;87;202;255m`）
   - `74~50%`：綠色 `#5cdb6d`（`\x1b[38;2;92;219;109m`）
   - `49~25%`：黃色 `#ffd427`（`\x1b[38;2;255;212;39m`）
   - `24~0%`：紅色 `#ff7daf`（`\x1b[38;2;255;125;175m`）

Windows 平台的 BOM 鐵則、`sh.exe` 越獄、`csc.exe` 編譯、`windowsHide: true` 規範詳見 [references/windows.md](references/windows.md)。

---

## 🌐 語言鎖定規則（Locale Locking — 全域強制）

> [!CAUTION]
> **使用者在步驟 1 一旦選定語系（`zh-tw` / `us` / `jp`），AI 代理在本次執行的剩餘所有對話輸出，都必須使用該語言。**

**為什麼必須鎖定**：使用者選擇英文（us）或日文（jp）的前提是「他可能不懂中文」，反之亦然。若中間穿插任何非所選語系的訊息，會破壞使用者體驗、甚至讓使用者讀不懂關鍵警告而誤判決策。**這也是為什麼語系選擇必須是第一步**——所有後續訊息（包括 Node.js 預檢的缺失警告）才能用使用者看得懂的語言呈現。

「對話輸出」涵蓋（不限於）：
- 步驟 2 Node.js 缺失時的 `ask_question` 警告對話
- 步驟 3 / 4 的 `ask_question` 問卷（`question` 文字、`options` 字串、`toolSummary`、`toolAction`）
- 步驟 5 / 6 進行中的任何進度說明、確認語句、警告訊息
- 步驟 5（BOM 污染修復）與步驟 6（Windows 缺 `sh.exe`）的偵測與修復提示
- 步驟 7 的最終回報訊息與舊版腳本溫馨提醒
- 任何例外、錯誤、降級、再次詢問使用者意見時的訊息

**例外（保持原文不翻譯）**：
- 技術識別碼（如 `model-name`、`statusLine`、`fs.writeFileSync`）
- 檔案路徑（如 `~/.gemini/antigravity-cli/settings.json`）
- 程式碼區塊內容
- 系統錯誤訊息原文（如 `invalid character 'ï' looking for beginning of value`）

---

## 🔄 執行步驟

### 步驟 1：第一階段問卷（語系選擇 — 必須最先執行）

**為何最先**：後續所有訊息（含 Node.js 缺失警告、設定檔讀寫進度、錯誤提示、最終回報）皆須用使用者選定的語言呈現，因此語系必須在任何其他對話之前確定。

呼叫 `ask_question`（Antigravity CLI 原生支援以 `/statusline` 切換啟用或關閉狀態列，因此無需提供冗長的還原選單）：

```json
{
  "questions": [
    {
      "question": "選擇顯示語系 / Select Display Language / 表示言語の選択",
      "options": [
        "繁體中文 (zh-tw)",
        "English (us)",
        "日本語 (jp)"
      ],
      "is_multi_select": false
    }
  ],
  "toolSummary": "語系選擇",
  "toolAction": "詢問顯示語系"
}
```

選擇完成後，**將所選語言代碼（`zh-tw` / `us` / `jp`）記錄為本次執行的鎖定語系**，並依「🌐 語言鎖定規則」於後續所有步驟使用該語系撰寫對話輸出。

### 步驟 2：Node.js 預檢 + 三層設定檔讀取

> 本步驟所有與使用者互動的文字必須用步驟 1 所選語系呈現。

**【Node.js 環境預檢 — 最優先】**：依作業系統執行對應的偵測指令：
- macOS / Linux：`command -v node` 或 `which node`
- Windows：`where node`（cmd）或 `Get-Command node`（PowerShell）
- 跨平台通用：`node --version`

- ✅ **若 Node.js 已安裝**：記錄版本號並繼續後續流程。
- ❌ **若 Node.js 未安裝**（指令回傳 `command not found` 或非零退出碼）：
  1. **向使用者發出明確警告（以所選語系撰寫）**，說明缺少 Node.js 將導致：
     - CLI 底部狀態列**完全空白**，不會顯示任何指標
     - `agy` CLI 會反覆記錄 `statusline: command failed: exit status 127 (stderr: sh: node: command not found)`，連續失敗 30 次後自動停用 statusline
  2. **呼叫 `ask_question` 詢問使用者是否繼續**（問卷 `question`、`options`、`toolSummary`、`toolAction` 全部以所選語系撰寫，以下範例為 `zh-tw` 版本）：

```json
{
  "questions": [
    {
      "question": "⚠️ 偵測到系統未安裝 Node.js。\n\n狀態列 Hook 需要 Node.js 才能運作，缺少 Node.js 將導致 CLI 底部狀態列完全空白且自動停用。\n\n建議先安裝 Node.js（例如：brew install node），再重新執行本技能。\n\n是否仍要繼續設定？（設定檔會正確寫入，但狀態列在安裝 Node.js 前不會顯示）",
      "options": [
        "(Recommended) 中斷，我先去安裝 Node.js",
        "繼續設定（安裝 Node.js 後狀態列會自動生效）"
      ],
      "is_multi_select": false
    }
  ],
  "toolSummary": "Node 環境檢查",
  "toolAction": "確認 Node 安裝"
}
```

  3. **若使用者選擇「中斷」**：以所選語系輸出安裝指引後結束本技能流程，不進行任何設定檔寫入。
  4. **若使用者選擇「繼續」**：繼續執行後續步驟。設定檔會正確寫入，待使用者安裝 Node.js 並重新啟動 `agy` CLI 後狀態列即會自動生效。

**【動態解析三層設定檔】**：在 Node.js 預檢通過（或使用者選擇繼續）後，動態展開 `$HOME` / `USERPROFILE`，讀取三層 `settings.json`。檢查目前 `ui.footer.items` 啟用了哪些項目、`ui.language` 設定，以及各設定檔中是否存在空的或殘缺的 `statusLine` 物件（如 `{ "type": "", "command": "", "enabled": true }`）。

**【Windows 平台額外步驟：BOM 預檢】**：讀取每份 `settings.json` 與 `trusted_hooks.json` 時，必須檢查檔案前 3 個位元組是否為 `EF BB BF`（UTF-8 BOM）。若是，記錄該檔案路徑為「需於步驟 5 自動修復」的目標。詳見 [references/windows.md §1](references/windows.md) 與 §3。

### 步驟 3：第二階段問卷（動態語系細部設定 — 勾選啟用項目）

**根據階段一所選的語言**，動態組合對應語系的問卷內容呼叫 `ask_question`。由於 `options` 僅支援字串陣列（不支援 `label` / `description` 物件），統一採用 `「說明文字 (識別碼)」` 格式：

- `zh-tw`：中文說明 + 英文識別碼
- `us`：英文說明 + 英文識別碼
- `jp`：日文說明 + 英文識別碼

由於 CLI 狀態列支援「多行智慧折行」且容納指標無上限，**嚴禁將指標拆分為多個問題發送**，必須合併至單一多選問題：

```json
{
  "questions": [
    {
      "question": "選擇要顯示的狀態列指標（下一步將進行排序）",
      "options": [
        "目前使用的 AI 模型名稱 (model-name)",
        "使用中代理 (agent-profile)",
        "代理當前狀態（idle / thinking / working / tool_use / initializing）(agent-state)",
        "沙盒模式狀態（off / on (net) / on (no-net)）(sandbox-status)",
        "目前對話已消耗的 Context 比例 (context-used)",
        "目前 Session 消耗的精確 Token 數量 (token-count)",
        "本次對話 AI 累計產出的成品 / 檔案數 (artifacts)",
        "帳號電子郵件 (account-email)",
        "目前訂閱方案等級 (plan-tier)",
        "帳號真實 API 可用額度 (quota)",
        "API 重置時間倒數 (quota-reset-countdown)",
        "AI 額度點數 (ai-credits)",
        "是否有等你回應的工具確認對話框 (tool-confirmation)",
        "佇列中待處理的使用者輸入數 (pending-input)",
        "進行中的背景任務數 (background-tasks)",
        "活躍子代理數 (subagents)",
        "目前工作區專案短路徑 (project-path)",
        "目前工作區專案完整路徑 (project-full-path)",
        "版本控制類型（git / jj / fig）(vcs-type)",
        "目前工作區專案的 Git 分支 (git-branch)",
        "工作區是否有未提交變更（dirty / clean）(vcs-dirty)",
        "CLI 行程所消耗的 RAM 記憶體量 (memory-usage)",
        "Antigravity CLI 版本號 (cli-version)",
        "目前對話 ID（前 8 碼，用於除錯）(conversation-id)"
      ],
      "is_multi_select": true
    }
  ],
  "toolSummary": "指標選擇",
  "toolAction": "詢問狀態列指標"
}
```

### 步驟 4：第三階段問卷（手動排序與最終篩選）

將**步驟 3 中使用者勾選的指標**按順序整理出來，標上數字編號（如 `1. 目前使用的 AI 模型名稱 (model-name)`），每項以 `\n` 分隔。在問卷說明中引導使用者透過 Write-in 輸入以逗號分隔的序號或英文識別碼進行自訂排序（支援混合輸入）：

```json
{
  "questions": [
    {
      "question": "請設定狀態列顯示順序。\n\n目前已選取：\n1. 目前使用的 AI 模型名稱 (model-name)\n2. 帳號真實 API 可用額度 (quota)\n3. 目前對話已消耗的 Context 比例 (context-used)\n\n請在下方輸入框「Write-in...」中輸入以逗號分隔的數字序號或英文識別碼（如：2, 1, context-used）。可以使用 `n` 來強制換行。未填寫的指標將不予顯示。",
      "options": [
        "(Recommended) 略過，使用原勾選順序啟用全部指標",
        "手動排序（請在下方「Write-in...」欄位中填寫）"
      ],
      "is_multi_select": false
    }
  ],
  "toolSummary": "排序設定",
  "toolAction": "詢問顯示順序"
}
```

#### 排序輸入解析規則（每次必執行）

1. **提取步驟 3 的基礎勾選項目**：在腦中套用正則表達式 `/\(([^)]+)\)$/`，從步驟 3 勾選的項目字串尾端提取英文識別碼，得到依勾選順序排列的「已勾選英文識別碼陣列」（例如 `['model-name', 'quota', 'memory-usage']`）。
   > ⚠️ **防呆警告**：此正則套用於**內部推理（純文字處理）**，**絕對禁止為此呼叫工具撰寫或執行任何 Node.js / Python 腳本**。

2. **讀取步驟 4 的排序輸入**：
   - 若使用者選擇預設選項（"略過..." 或其他語系的同義略過項），或 Write-in 欄位為空白：直接使用「已勾選英文識別碼陣列」作為最終順序。
   - 若 Write-in 輸入了自訂排序字串（如 `"3, model-name, 2"`）：
     1. 以逗號 `,` 拆分，去除每個元素前後的空白。
     2. 遍歷每個拆分項目：
        - **若項目為 `n` 或 `newline`**：視為「強制換行符號」，直接保留（允許使用者透過此方式強制折行）。
        - **若項目為正整數 N**：檢查 N 是否介於 `1` 至「已勾選英文識別碼陣列」長度之間；若符合則對應索引 N-1 的識別碼；若超出範圍則排除該項。
        - **若項目為其他字串**：檢查是否精確等於「已勾選英文識別碼陣列」中的某個識別碼；若符合則直接使用；不符合則排除。
     3. **去重（Deduplication）**：解析出來的識別碼若已存在於排序結果則忽略（**但 `n` / `newline` 允許重複出現**），以第一個出現的為準。
     4. **捨棄未提及項目**：最終寫入的 `ui.footer.items` **僅保留**此排序過程成功匹配到的識別碼，未提及的項目將被剔除（不啟用）。

例：已勾選為 `['model-name', 'quota', 'memory-usage']`，若排序輸入 `"3, 1, invalid-item"`，則解析結果為 `['memory-usage', 'model-name']`（`invalid-item` 排除、未提及的 `quota` 被捨棄）。

### 步驟 5：設定檔合併與寫入

**確定語言代碼**：採用第一階段問卷的選擇結果。

**【關鍵：多層設定檔同步寫入 — 三檔缺一不可】**：必須同時更新以下 3 個設定檔，否則狀態列將會失效：

1. **全域**：`~/.gemini/settings.json`
2. **CLI 專屬（最高優先級，極度重要）**：`~/.gemini/antigravity-cli/settings.json`
3. **專案**（若存在）：`<workspace>/.gemini/settings.json`

寫入內容：`ui.language` + 解析後的 `ui.footer.items` + 完整的 `statusLine` 物件（含 `enabled`、`type`、`command`）。

- macOS / Linux 與 Windows 的 `statusLine` JSON 範本、`command` 動態絕對路徑替換規則、`trusted_hooks.json` 信任機制細節（含當前工作區、家目錄、`"*"` 通配符三個鍵）→ 詳見 [references/config-files.md](references/config-files.md)
- **Windows 平台的 UTF-8 BOM 編碼鐵則（絕對禁止帶 BOM 寫檔的工具清單與保證不帶 BOM 的替代方案）** → 詳見 [references/windows.md](references/windows.md) §1

> [!CAUTION]
> 寫入 `command` 時**絕對禁止照抄範例中的 `<真實的使用者家目錄絕對路徑>` 佔位符**，必須動態解析並替換為當下系統環境真實的絕對路徑（例如 `/Users/andy/.gemini/antigravity-cli/hooks/statusline-quota.mjs`）。

**寫入後驗證（Windows 強制）**：每寫完一份設定檔，必須讀回前 3 個位元組驗證；若為 `EF BB BF` 必須就地剝除並重寫，直到通過為止。若步驟 2 預檢階段曾標記出已被 BOM 污染的設定檔，本步驟必須一併執行剝除流程。詳見 [references/windows.md §1](references/windows.md)。

### 步驟 6：自動部署 Hook 腳本

> [!CAUTION]
> **絕對禁令（最關鍵的安全規則）**：AI 代理**絕對禁止**自行發明、撰寫、或修改 `statusline-quota.mjs` 與 `fetch-local-quota.mjs` 的底層程式碼來部署！部署時，**必須 100% 準確地讀取本外掛 `scripts/` 資料夾（相對於本外掛根目錄為 `scripts/`）中的對應腳本檔案，原封不動地寫入**到使用者的 `hooks` 目錄中。若要更新狀態列邏輯，必須先更新對應的 `scripts/*.mjs` 內容再進行部署，**嚴禁憑空發明或竄改邏輯**！違反此規則將導致狀態列功能殘缺、指標抓取失敗、甚至 CLI 崩潰。

**讀取來源（Workspace-First 路由）**：
1. **優先**讀取當前工作區（Workspace）根目錄下的 `scripts/<filename>`
2. 若不存在或在其他工作區，**退回**從本外掛安裝目錄下的 `scripts/<filename>` 讀取。AI 代理應動態推導真實絕對路徑，例如：
   - macOS / Linux：`~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/scripts/<filename>`
   - Windows：`%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-cli-statusline\scripts\<filename>`

**部署目標**：
- `~/.gemini/antigravity-cli/hooks/statusline-quota.mjs`
- `~/.gemini/antigravity-cli/hooks/fetch-local-quota.mjs`

**寫入規範**：必須使用 `fs.writeFileSync(targetPath, content, { encoding: 'utf8' })`，防止 Windows 預設 UTF-16 編碼導致 CLI 崩潰。

**【僅 Windows】編譯靜默 sh.exe**：CLI 底層強制依賴 `sh -c` 執行指令，Windows 缺 `sh.exe`，必須利用內建 `csc.exe` 編譯一個無窗體（`/target:winexe`）的 `sh.exe` 橋接器，徹底消除黑框閃爍。完整步驟（從 `scripts/sh_hidden.cs` 編譯）詳見 [references/windows.md §6](references/windows.md)。

### 步驟 7：回報與重新載入提示

完成檔案編輯與 Hook 部署後，**根據使用者在第一階段所選擇的語系（zh-tw / us / jp）撰寫最終的回覆訊息**（例如選擇日本語 jp 請務必全程使用流利的日文回覆）。在回覆中告知使用者：「狀態列設定支援熱更新（Hot Reload），設定已自動在 CLI 底部即時生效，無需重新啟動。」

**舊版腳本檢查**：使用 Node 的 `fs.existsSync`，或跨平台終端機指令（macOS/Linux：`test -f`、Windows PowerShell：`Test-Path`）檢查 `~/.gemini/hooks/statusline-quota.mjs` 與 `~/.gemini/hooks/fetch-local-quota.mjs`。**只有當偵測到任一舊版腳本存在時**，才在回覆最後溫馨提醒：「若不再使用舊版的 Gemini CLI，可安全地手動刪除上述兩個舊版腳本檔，以節省空間並避免混淆。」若檔案皆不存在則完全略過此提醒，避免造成使用者困惑。

**故障診斷指引（依語系翻譯）**：在最終回覆末尾加入一句提示：「若日後狀態列突然完全消失（特別是在 agy CLI 內使用 `/statusline`、`/model` 等指令切換之後），請前往本外掛目錄執行 `node scripts/diagnose-statusline.mjs`，並把完整輸出貼給 AI 代理。該腳本為唯讀診斷工具，會檢查三層 `settings.json`、`trusted_hooks.json`、Hook 檔案存在性、以及最關鍵的 CLI 專屬層 `statusLine.command` 是否被清空（參見 [references/pitfalls.md](references/pitfalls.md) 陷阱 #9）。」

---

## 🚨 常見陷阱速查

完整對照表（8 條陷阱與修正做法）詳見 [references/pitfalls.md](references/pitfalls.md)。最關鍵的三條速記：

1. **必須同步寫入三層設定檔**（特別是 CLI 專屬的 `~/.gemini/antigravity-cli/settings.json`，是最致命的盲點）
2. **Windows 寫設定檔絕對禁止帶 BOM**，寫入後必須驗證前 3 個位元組
3. **絕對禁止憑空生成 Hook 腳本**，必須從本外掛的 `scripts/` 讀取原文部署
