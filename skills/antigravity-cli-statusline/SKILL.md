---
name: antigravity-cli-statusline
description: 本技能用於設定 Antigravity 命令列介面（CLI）（agy）的狀態列（Statusline / Footer）顯示指標、顯示順序與多語系介面（繁體中文 zh-tw / English us / 日本語 jp），並自動部署跨平台 Node.js 掛鉤（Hook）腳本（statusline-quota.mjs、fetch-local-quota.mjs）至 ~/.gemini/antigravity-cli/hooks/，同步註冊三層 settings.json（全域、命令列介面（CLI）專屬、專案）與 trusted_hooks.json 信任機制。適用情境：使用者要求設定 / 客製化 / 啟用命令列介面（CLI）狀態列、調整命令列介面（CLI）頁尾顯示項目、顯示應用程式介面（API）額度 / 權杖（Token）用量 / 上下文（Context）消耗 / Git 分支 / 工作區是否乾淨（dirty）/ VCS 類型 / 人工智慧（AI）模型名稱 / 代理狀態（agent state）/ 等你回應的工具確認對話方塊（Dialog Box） / 輸入佇列 / 背景任務 / 子代理數 / 工件（Artifacts） / 沙盒模式 / 命令列介面（CLI）版本 / 對話識別碼（ID） / 使用中代理（agent profile）/ 隨機存取記憶體（RAM）記憶體用量 / 訂閱方案等指標於命令列介面（CLI）底部、切換狀態列語言、在新電腦上啟用此狀態列，或使用者主動以 /antigravity-cli-statusline 觸發本技能時。支援 macOS、Linux、Windows（含 Windows 10 / 11）跨平台環境，並於 Windows 上自動處理 sh.exe 缺失、UTF-8 位元組順序記號（BOM）污染、wmic 棄用等系統陷阱。
---

# Antigravity 狀態列設定技能

本技能提供 Antigravity 命令列介面（CLI）狀態列（Statusline / Footer）的客製化、語系設定與跨平台掛鉤（Hook）部署能力。

## ⚠️ References 載入規範（必讀）

本技能的細節分散於下列三份 references/：
- [`references/windows.md`](references/windows.md) — Windows 特定規範（位元組順序記號（BOM）鐵則、`sh.exe` 越獄、`csc.exe` 編譯等）
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
| **命令列介面（CLI）專屬（最高）** | `~/.gemini/antigravity-cli/settings.json` | 🔥 高於全域 |
| 全域 | `~/.gemini/settings.json` | 中 |
| 專案（條件性）| `<workspace>/.gemini/settings.json` | 若存在則覆寫 |

> [!CAUTION]
> 命令列介面（CLI）專屬設定檔由 agy 命令列介面（CLI）自身維護，優先級**高於**全域設定檔。若忽略此檔案，全域設定將被無聲覆蓋！這是本技能中**最致命且最隱蔽的 Bug**。完整路徑解析規則、JSON 結構、跨電腦移植雙保險設計詳見 [references/config-files.md](references/config-files.md)。

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

Windows 平台的 位元組順序記號（BOM）鐵則、`sh.exe` 越獄、`csc.exe` 編譯、`windowsHide: true` 規範詳見 [references/windows.md](references/windows.md)。

---

## 🌐 語言鎖定規則（Locale Locking — 全域強制）

> [!CAUTION]
> **使用者在步驟 1 一旦選定語系（`zh-tw` / `us` / `jp`），人工智慧（AI）代理在本次執行的剩餘所有對話輸出，都必須使用該語言。**

**為什麼必須鎖定**：使用者選擇英文（us）或日文（jp）的前提是「他可能不懂中文」，反之亦然。若中間穿插任何非所選語系的訊息，會破壞使用者體驗、甚至讓使用者讀不懂關鍵警告而誤判決策。**這也是為什麼語系選擇必須是第一步**——所有後續訊息（包括 Node.js 預檢的缺失警告）才能用使用者看得懂的語言呈現。

「對話輸出」涵蓋（不限於）：
- 步驟 2 Node.js 缺失時的 `ask_question` 警告對話
- 步驟 3 / 4 的 `ask_question` 問卷（`question` 文字、`options` 字串、`toolSummary`、`toolAction`）
- 步驟 5 / 6 進行中的 any 進度說明、確認語句、警告訊息
- 步驟 5（位元組順序記號（BOM）污染修復）與步驟 6（Windows 缺 `sh.exe`）的偵測與修復提示
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

**為何最先**：後續所有訊息（含 Node.js 缺失警告、設定檔讀寫進度、錯誤提示、最終回報）皆須用使用者選定的語言呈現，因此語系必須在 any 其他對話之前確定。

呼叫 `ask_question`（Antigravity 命令列介面（CLI）原生支援以 `/statusline` 切換啟用或關閉狀態列，因此無需提供冗長的還原選單）：

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
     - CLI 底部狀態列**完全空白**，不會顯示 any 指標
     - `agy` 命令列介面（CLI）會反覆記錄 `statusline: command failed: exit status 127 (stderr: sh: node: command not found)`，連續失敗 30 次後自動停用 statusline
  2. **呼叫 `ask_question` 詢問使用者是否繼續**（問卷 `question`、`options`、`toolSummary`、`toolAction` 全部以所選語系撰寫，以下範例為 `zh-tw` 版本）：

```json
{
  "questions": [
    {
      "question": "⚠️ 偵測到系統未安裝 Node.js。\n\n狀態列掛鉤（Hook）需要 Node.js 才能運作，缺少 Node.js 將導致命令列介面（CLI）底部狀態列完全空白且自動停用。\n\n建議先安裝 Node.js（例如：brew install node），再重新執行本技能。\n\n是否仍要繼續設定？（設定檔會正確寫入，但狀態列在安裝 Node.js 前不會顯示）",
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

  3. **若使用者選擇「中斷」**：以所選語系輸出安裝指引後結束本技能流程，不進行 any 設定檔寫入。
  4. **若使用者選擇「繼續」**：繼續執行後續步驟。設定檔會正確寫入，待使用者安裝 Node.js 並重新啟動 `agy` 命令列介面（CLI）後狀態列即會自動生效。

**【動態解析三層設定檔】**：在 Node.js 預檢通過（或使用者選擇繼續）後，動態展開 `$HOME` / `USERPROFILE`，讀取三層 `settings.json`。檢查目前 `ui.footer.items` 啟用了哪些項目、`ui.language` 設定，以及各設定檔中是否存在空的或殘缺的 `statusLine` 物件（如 `{ "type": "", "command": "", "enabled": true }`）。

**【Windows 平台額外步驟：位元組順序記號（BOM）預檢】**：讀取每份 `settings.json` 與 `trusted_hooks.json` 時，必須檢查檔案前 3 個位元組是否為 `EF BB BF`（UTF-8 位元組順序記號（BOM））。若是，記錄該檔案路徑為「需於步驟 5 自動修復」的目標。詳見 [references/windows.md §1](references/windows.md) 與 §3。

### 步驟 3：第二階段問卷（讀取 questions.json 與勾選指標）

1. **讀取靜態問卷**：人工智慧（AI）代理必須優先讀取本外掛目錄底下的 `skills/antigravity-cli-statusline/resources/questions.json` 檔案。
2. **根據步驟 1 的語言代碼（`zh-tw` / `us` / `jp`）**，從 `questions.json` 中讀取對應語系的問卷資訊，呼叫 `ask_question`。

請動態將選定語系的 `options` 內容填入（問卷問題及摘要也請使用對應語系）：
   ```json
   {
     "questions": [
       {
         "question": "<請填入對應語系的提問，例如: 選擇要顯示的狀態列指標（下一步將進行排序）>",
         "options": [
            // 從 resources/questions.json 讀取對應語系（如 zh-tw, us 或 jp）的 options 陣列並在此展開
         ],
         "is_multi_select": true
       }
     ],
     "toolSummary": "指標選擇",
     "toolAction": "詢問狀態列指標"
   }
   ```
3. 取得使用者所勾選的選項字串陣列（`selected`）。

### 步驟 4：第三階段問卷（手動排序與最終篩選）

1. 將**步驟 3 中使用者勾選的指標**按順序整理出來，標上數字編號（如 `1. 目前使用的人工智慧（AI）模型名稱（model-name）`），每項以 `\n` 分隔。
2. 呼叫 `ask_question` 引導使用者進行排序：
   ```json
   {
     "questions": [
       {
         "question": "請設定狀態列顯示順序。\n\n目前已選取：\n1. 目前使用的人工智慧（AI）模型名稱（model-name）\n2. 帳號五小時可用額度百分比（quota）\n3. 目前對話已消耗的脈絡（Context）用量比例（context-used）\n\n請在下方輸入框「Write-in...」中輸入以逗號分隔的數字序號或英文識別碼（如：2, 1, context-used）。可以使用 `n` 來強制換行。未填寫的指標將不予顯示。",
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
3. 取得使用者的排序輸入（`order`）。

### 步驟 5：執行配置腳本

1. 取得使用者工作區（workspace）的絕對路徑（`workspace`）。
2. 呼叫 `run_command` 執行本外掛目錄下的 `configure-statusline.mjs` 腳本，傳入相關參數。腳本會全自動處理：
   - 排序輸入解析。
   - 同步寫入三層 `settings.json`（已執行防禦性 位元組順序記號（BOM）剝除與寫入後無 位元組順序記號（BOM）驗證）。
   - 寫入 `trusted_hooks.json` 註冊安全信任（含當前工作區、家目錄與 `"*"` 萬用字元（Wildcard）鍵，並在 Windows 上註冊各種反斜線/環境變數變體）。
   - 將 Hook 腳本安全拷貝部署至 `~/.gemini/antigravity-cli/hooks/` 目錄中，寫入時強制 `{ encoding: 'utf8' }`。
   - 若為 Windows 平台且 CLI 目錄缺少 `sh.exe`，自動編譯靜默無窗體橋接器。

   **指令範例**：
   ```bash
   node skills/antigravity-cli-statusline/scripts/configure-statusline.mjs --lang "<步驟1選定的語言>" --selected '<JSON字串格式的步驟3勾選結果>' --order "<步驟4的排序/略過輸入>" --workspace "<當前工作區絕對路徑>"
   ```
   *注意：`--selected` 必須是合法的 JSON 字串陣列，例如 `'["目前使用的人工智慧（AI）模型名稱（model-name）","帳號五小時可用額度百分比（quota）"]'`。請注意外層與內層引號的正確跳脫。*

### 步驟 6：自動驗證

1. 配置腳本執行完成後，呼叫 `run_command` 執行原有的測試驗證腳本：
   ```bash
   node skills/antigravity-cli-statusline/scripts/test-counters.mjs
   ```
2. 確認測試無誤通過。若有任何錯誤，依照錯誤訊息進行對應修正。

### 步驟 7：回報與重新載入提示

1. **根據所選語系撰寫最終回覆**：告知使用者設定已自動在 命令列介面（CLI）底部即時熱更新 (Hot Reload) 生效，無需重新啟動。
2. **舊版腳本檢查**：讀取或檢查 `~/.gemini/hooks/statusline-quota.mjs` 與 `~/.gemini/hooks/fetch-local-quota.mjs` 是否存在。若存在，則以所選語系提醒使用者可以安全地手動刪除它們。
3. **故障診斷指引**：在回覆末尾以所選語系加入提示：「若日後狀態列突然消失，請前往本外掛目錄執行 `node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs`，並把完整輸出貼給 人工智慧（AI）代理進行診斷。」

---

## ! 常見陷阱速查

完整對照表（8 條陷阱與修正做法）詳見 [references/pitfalls.md](references/pitfalls.md)。最關鍵的三條速記：

1. **必須同步寫入三層設定檔**（特別是 命令列介面（CLI）專屬的 `~/.gemini/antigravity-cli/settings.json`，是最致命的盲點）
2. **Windows 寫設定檔絕對禁止帶 位元組順序記號（BOM）**，寫入後必須驗證前 3 個位元組
3. **絕對禁止憑空生成 掛鉤（Hook） 腳本**，必須從本外掛的 `skills/antigravity-cli-statusline/scripts/` 讀取原文部署
