---
name: antigravity-cli-statusline:agy-cli-statusline
description: 本技能用於設定 Antigravity 命令列介面（CLI）（agy）的狀態列（Statusline / Footer）顯示指標、標籤顯示樣式（文字標籤 text / Emoji 圖示 emoji）、顯示順序與多語系介面（繁體中文 zh-tw / 简体中文 zh-cn / English us / 日本語 jp），並自動部署跨平台 Node.js 掛鉤（Hook）腳本（statusline-quota.mjs、fetch-local-quota.mjs）至 ~/.gemini/antigravity-cli/hooks/，同步註冊三層 settings.json（全域、命令列介面（CLI）專屬、專案）與 trusted_hooks.json 信任機制。適用情境：使用者要求設定 / 客製化 / 啟用命令列介面（CLI）狀態列、調整命令列介面（CLI）頁尾顯示項目、切換文字或 Emoji 圖示標籤模式、顯示應用程式介面（API）額度（含長條圖與絕對重置時間） / 權杖（Token）用量與長條圖 / 上下文（Context）消耗與長條圖 / Git 分支 / 工作區是否乾淨（dirty）/ VCS 類型 / 人工智慧（AI）模型名稱 / 代理狀態（agent state）/ 等你回應的工具確認對話方塊（Dialog Box） / 輸入佇列 / 背景任務 / 子代理數 / 檔案數量（Artifacts） / 沙盒模式 / 命令列介面（CLI）版本 / 對話識別碼（ID） / 使用中代理（agent profile）/ 隨機存取記憶體（RAM）記憶體用量 / 訂閱方案等指標於命令列介面（CLI）底部、切換狀態列語言、在新電腦上啟用此狀態列，或使用者主動以 /antigravity-cli-statusline:agy-cli-statusline 觸發本技能時。支援 macOS、Linux、Windows（含 Windows 10 / 11）跨平台環境，並自動處理 Node.js 跨平台執行相容性（macOS/Linux 絕對路徑防 NVM 127、Windows 裸命令防空白與引號剝除）、sh.exe 缺失、UTF-8 位元組順序記號（BOM）污染、wmic 棄用等系統陷阱。
---

# Antigravity 狀態列設定技能

本技能提供 Antigravity 命令列介面（CLI）狀態列（Statusline / Footer）的客製化、標籤樣式（文字 / Emoji）、語系設定與跨平台掛鉤（Hook）部署能力。

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

自訂語系偏好記錄於 `ui.language` 屬性中；標籤顯示樣式記錄於 `ui.footer.labelStyle`（`"text"` 或 `"emoji"`）中；指標順序記錄於 `ui.footer.items` 陣列中；個別指標樣式覆寫記錄於 `ui.footer.itemStyles`（如 `{ "quota": "emoji" }`）中，未設定者一律強制以文字為預設。

---

## 🛠️ 技術標準

1. **純 Node.js 跨平台實作**：
   - macOS / Linux：`ps auxww` + `lsof`
   - Windows：`Get-CimInstance Win32_Process` + `netstat -ano`（不再使用已棄用的 `wmic`）
2. **所有 `fs.writeFileSync` 強制加 `{ encoding: 'utf8' }`**（防 Windows UTF-16 崩潰）
3. **智慧型多行換行（Smart Line Wrapping by Feature）**：讀取 `meta.terminal_width` 或 `process.stdout.columns` 得知終端機寬度。組合狀態列字串時，若下一個加入的指標會讓整行長度（不含 ANSI 碼，並精確計算中日韓全形字元與 Unicode 代理對 Emoji 為 2 格寬度）超過終端機寬度，必須將該指標折疊到新的一行（插入 `\n`）。
4. **四階段精確色彩辨識（24-bit truecolor 柔和配色）**：
   - `100~75%`：藍色 `#57caff`（`\x1b[38;2;87;202;255m`）
   - `74~50%`：綠色 `#5cdb6d`（`\x1b[38;2;92;219;109m`）
   - `49~25%`：黃色 `#ffd427`（`\x1b[38;2;255;212;39m`）
   - `24~0%`：紅色 `#ff7daf`（`\x1b[38;2;255;125;175m`）
5. **容量長條圖與相鄰自動合併（Bar Graph & Adjacent Auto-Merge）**：支援五小時可用額度（`quota-bar`）、每週可用額度（`quota-weekly-bar`）、脈絡用量（`context-used-bar`）與權杖數（`token-count-bar`）之長條圖（預設 10 格 `[████████░░]`）。當長條圖與對應數值指標相鄰且顯示樣式一致時，自動合併為單一標籤（文字模式如 `五小時可用: 88% [████████░░]`，Emoji 模式如 `🔋 88% [████████░░]`）。若樣式衝突（一為 text、一為 emoji）則不合併，拆開為兩個獨立區塊顯示。
6. **絕對重置時間（Reset Absolute Time）**：支援五小時重置時間（`quota-reset-time`）與每週重置時間（`quota-weekly-reset-time`），原生轉換為本機時區絕對時間，預設同日顯示 `HH:mm`、跨日顯示 `yyyy/MM/dd HH:mm`，亦支援於設定檔以 `ui.footer.timeFormat` 自訂（`smart` / `yyyy/MM/dd HH:mm` / `12h` / `24h`）。
7. **多樣化標籤顯示樣式（Label Style: 全域與個別指標支援）**：支援於設定檔 `ui.footer.itemStyles` 針對個別指標設定樣式覆寫（`"emoji"` 或 `"text"`，未設定者一律以文字為預設），亦支援於 `ui.footer.labelStyle` 設定全域標籤樣式。在 Emoji 樣式下，以專屬 Emoji 取代文字標籤並省略冒號、僅保留單一空白（如 `🤖 Gemini 3.1 Pro`、`🔋 100%`、`🔀 main`），狀態值仍依 `ui.language` 顯示本地化文字。

Windows 平台的 位元組順序記號（BOM）鐵則、`sh.exe` 越獄、`csc.exe` 編譯、`windowsHide: true` 規範詳見 [references/windows.md](references/windows.md)。

---

## 🌐 語言鎖定規則（Locale Locking — 全域強制）

> [!CAUTION]
> **使用者在步驟 1 一旦選定語系（`zh-tw` / `zh-cn` / `us` / `jp`），人工智慧（AI）代理在本次執行的剩餘所有對話輸出，都必須使用該語言。**

**為什麼必須鎖定**：使用者選擇英文（us）或日文（jp）的前提是「他可能不懂中文」，反之亦然。若中間穿插任何非所選語系的訊息，會破壞使用者體驗、甚至讓使用者讀不懂關鍵警告而誤判決策。**這也是為什麼語系選擇必須是第一步**——所有後續訊息（包括 Node.js 預檢的缺失警告）才能用使用者看得懂的語言呈現。

「對話輸出」涵蓋（不限於）：
- 步驟 2 Node.js 缺失時的 `ask_question` 警告對話
- 步驟 3（五大分類分頁勾選指標）與步驟 4 的 `ask_question` 問卷（`question` 文字、`options` 字串、`toolSummary`、`toolAction`）
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
      "question": "選擇顯示語系 / 选择显示语言 / Select Display Language / 表示言語の選択",
      "options": [
        "繁體中文 (zh-tw)",
        "简体中文 (zh-cn)",
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

選擇完成後，**將所選語言代碼（`zh-tw` / `zh-cn` / `us` / `jp`）記錄為本次執行的鎖定語系**，並依「🌐 語言鎖定規則」於後續所有步驟使用該語系撰寫對話輸出。

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
  2. **呼叫 `ask_question` 詢問使用者是否繼續**（問卷 `question`、`options`、`toolSummary`、`toolAction` 全部以所選語系撰寫）：

**zh-tw 範例**：
```json
{
  "questions": [
    {
      "question": "⚠️ 偵測到系統未安裝 Node.js。\n\n狀態列掛鉤（Hook）需要 Node.js 才能運作，缺少 Node.js 將導致命令列介面（CLI）底部狀態列完全空白且自動停用。\n\n建議先安裝 Node.js（例如：brew install node），再重新執行本技能。\n\n是否仍要繼續設定？（設定檔會正確寫入，但狀態列在安裝 Node.js 前不會顯示）",
      "options": [
        "中斷，我先去安裝 Node.js",
        "繼續設定（安裝 Node.js 後狀態列會自動生效）"
      ],
      "is_multi_select": false
    }
  ],
  "toolSummary": "Node 環境檢查",
  "toolAction": "確認 Node 安裝"
}
```

**zh-cn 範例**：
```json
{
  "questions": [
    {
      "question": "⚠️ 检测到系统未安装 Node.js。\n\n状态栏挂钩（Hook）需要 Node.js 才能运作，缺少 Node.js 将导致命令行界面（CLI）底部状态栏完全空白且自动停用。\n\n建议先安装 Node.js（例如：brew install node），再重新运行本技能。\n\n是否仍要继续设置？（配置文件会正确写入，但状态栏在安装 Node.js 前不会显示）",
      "options": [
        "中断，我先去安装 Node.js",
        "继续设置（安装 Node.js 后状态栏会自动生效）"
      ],
      "is_multi_select": false
    }
  ],
  "toolSummary": "Node 环境检查",
  "toolAction": "确认 Node 安装"
}
```

**us 範例**：
```json
{
  "questions": [
    {
      "question": "⚠️ Node.js is not installed on this system.\n\nThe statusline hook requires Node.js to function. Without Node.js, the CLI footer will be completely blank and automatically disabled.\n\nIt is recommended to install Node.js first (e.g.: brew install node), then re-run this skill.\n\nDo you still want to proceed? (Configuration files will be written, but the statusline will not appear until Node.js is installed)",
      "options": [
        "Abort, I will install Node.js first",
        "Continue setup (Statusline will automatically work once Node.js is installed)"
      ],
      "is_multi_select": false
    }
  ],
  "toolSummary": "Node environment check",
  "toolAction": "Confirm Node installation"
}
```

**jp 範例**：
```json
{
  "questions": [
    {
      "question": "⚠️ システムに Node.js がインストールされていません。\n\nステータスラインのフック（Hook）には Node.js が必要です。Node.js がないと、CLI 画面下部のステータスラインは完全に空白となり、自動的に無効化されます。\n\n先に Node.js をインストールしてから（例：brew install node）、本スキルを再実行することをお勧めします。\n\nそれでも設定を続行しますか？（設定ファイルは正常に書き込まれますが、Node.js がインストールされるまでステータスラインは表示されません）",
      "options": [
        "中断して、先に Node.js をインストールする",
        "設定を続行する（Node.js インストール後にステータスラインが自動的に有効になります）"
      ],
      "is_multi_select": false
    }
  ],
  "toolSummary": "Node 環境確認",
  "toolAction": "Node インストール確認"
}
```

  3. **若使用者選擇「中斷」**：以所選語系輸出安裝指引後結束本技能流程，不進行 any 設定檔寫入。
  4. **若使用者選擇「繼續」**：繼續執行後續步驟。設定檔會正確寫入，待使用者安裝 Node.js 並重新啟動 `agy` 命令列介面（CLI）後狀態列即會自動生效。

**【動態解析三層設定檔】**：在 Node.js 預檢通過（或使用者選擇繼續）後，動態展開 `$HOME` / `USERPROFILE`，讀取三層 `settings.json`。檢查目前 `ui.footer.items` 啟用了哪些項目、`ui.footer.labelStyle` 標籤樣式、`ui.language` 設定，以及各設定檔中是否存在空的或殘缺的 `statusLine` 物件（如 `{ "type": "", "command": "", "enabled": true }`）。

**【Windows 平台額外步驟：位元組順序記號（BOM）預檢】**：讀取每份 `settings.json` 與 `trusted_hooks.json` 時，必須檢查檔案前 3 個位元組是否為 `EF BB BF`（UTF-8 位元組順序記號（BOM））。若是，記錄該檔案路徑為「需於步驟 5 自動修復」的目標。詳見 [references/windows.md §1](references/windows.md) 與 §3。

### 步驟 3：第二階段問卷（讀取 questions.json、五大分類分頁勾選指標）

1. **讀取靜態問卷**：人工智慧（AI）代理必須優先讀取本外掛目錄底下的 `skills/agy-cli-statusline/resources/questions.json` 檔案。
2. **根據步驟 1 的語言代碼（`zh-tw` / `zh-cn` / `us` / `jp`）**，從 `questions.json` 中讀取對應語系的 `categories`（五大分類清單）。

> [!NOTE]
> **螢幕高度限制與分頁設計（Issue #1262）**：目前 Antigravity CLI 的 `ask_question` 在選項超過螢幕可容納行數（約 31 項）時存在無法滾動顯示的限制。為提供良好互動體驗，36 項指標拆分為五個分類頁籤（每個分頁 4~14 項，保證在任何終端機螢幕均能完整顯示），由代理依序呼叫 `ask_question` 引導使用者勾選：
> - 分類 1：模型與代理（4 項，`model-name`, `agent-profile`, `agent-state`, `mode`）
> - 分類 2：額度、計費與帳號（14 項，`quota`, `quota-bar`, `quota-reset-countdown`, `quota-reset-time`, `quota-weekly`, `quota-weekly-bar`, `quota-weekly-countdown`, `quota-weekly-reset-time`, `quota-argon`, `quota-argon-bar`, `quota-argon-countdown`, `quota-argon-reset-time`, `plan-tier`, `account-email`）
> - 分類 3：脈絡與權杖（4 項，`context-used`, `context-used-bar`, `token-count`, `token-count-bar`）
> - 分類 4：工作區與版本控制（5 項，`project-path`, `project-full-path`, `git-branch`, `vcs-dirty`, `vcs-type`）
> - 分類 5：系統狀態與背景任務（9 項，`memory-usage`, `cli-version`, `conversation-id`, `sandbox-status`, `tool-confirmation`, `pending-input`, `background-tasks`, `subagents`, `artifacts`）

在單次 `ask_question` 工具呼叫的 `questions` 陣列中，依序傳入五個分類的題目物件。Antigravity CLI 底層 TUI（`AskQuestionModel`）會原生以**分頁精靈（Wizard Pager）**形式渲染為 `Question 1/5:` 至 `Question 5/5:`。使用者在每一頁使用 `Space` 鍵勾選後按下 `Enter` 鍵，終端機會自動平滑翻頁至下一分類，直到五個分類皆作答完成：

```json
{
  "questions": [
    {
      "question": "<分類 1 的 question，例如: 選擇要顯示的模型與代理指標>",
      "options": [ /* 分類 1 的 options */ ],
      "is_multi_select": true
    },
    {
      "question": "<分類 2 的 question，例如: 選擇要顯示的額度、計費與帳號指標>",
      "options": [ /* 分類 2 的 options */ ],
      "is_multi_select": true
    },
    {
      "question": "<分類 3 的 question，例如: 選擇要顯示的脈絡與權杖指標>",
      "options": [ /* 分類 3 的 options */ ],
      "is_multi_select": true
    },
    {
      "question": "<分類 4 的 question，例如: 選擇要顯示的工作區與版本控制指標>",
      "options": [ /* 分類 4 的 options */ ],
      "is_multi_select": true
    },
    {
      "question": "<分類 5 的 question，例如: 選擇要顯示的系統狀態與背景任務指標>",
      "options": [ /* 分類 5 的 options */ ],
      "is_multi_select": true
    }
  ],
  "toolSummary": "指標選擇",
  "toolAction": "分類勾選指標"
}
```

作答完畢後，工具會一次性回傳多行答案（`A1: ..., A2: ..., A3: ..., A4: ..., A5: ...`）。代理將各題回傳的勾選項解析合併為一個完整的字串陣列（`selected`）。

### 步驟 4：第三階段問卷（手動排序、樣式前綴與最終篩選）

> [!CAUTION]
> **防截斷鐵則（Issue #1262）**：Antigravity 命令列介面（CLI）底層終端機使用者介面（TUI）在呼叫 `ask_question` 時，會將 `question` 文字**重複渲染兩次**（一次在對話歷史區 `? ...`，一次在底部 `Question 1/1: ...` 面板）。若 `question` 包含多行說明，重複兩次就會佔據 10~15 行垂直空間，進而把上方對話視窗的前幾行頂出畫面並遭終端機緩衝區裁切吃字！
> 因此，必須嚴格遵守以下三點：
> 1. **絕對禁止輸出單欄每項一行的長清單**（無論在對話視窗或 `ask_question` 內皆禁止）。
> 2. **在同一回合呼叫 `ask_question` 之前，先在一般對話（Chat Response）輸出「單行填寫規則標題 ＋ 三欄 Markdown 表格（3-Column Markdown Table）」**，將最多 36 項壓縮在 **12 列以內**。
> 3. **`ask_question` 的 `question` 欄位嚴格限制為「單純 1 行短句」（禁止包含換行 `\n` 或長篇規則說明）**，將底部面板高度壓到最低，確保上方三欄表格第 1~12 列 100% 留在可視畫面內、免捲動、零截斷！

1. **在同一回合呼叫 `ask_question` 之前，先在一般對話（Chat Response）輸出「單行填寫規則標題 ＋ 三欄 Markdown 表格」**：
   - 將步驟 3 中使用者在五個頁籤所勾選的全部指標選項（共 $N$ 項）按順序標上連續數字編號（從 `1` 到 $N$）。
   - 計算每欄列數 $R = \lceil N / 3 \rceil$（例如 $N = 36$ 時 $R = 12$ 列），採**直向優先（Column-major：左欄 `1`~$R$、中欄 $R+1$~$2R$、右欄 $2R+1$~$N$）**組成三欄 Markdown 表格，每格格式為 `🤖 簡稱 (\`metric-id\`)`（保持文字精簡以免單行過寬折行）。
   - **zh-tw 輸出範例（以全選 36 項為例，標題含填寫規則 + 12 列表格）**：
     ```markdown
     📋 **目前已選取的狀態列指標（共 36 項）** — *於下方 Write-in 輸入序號或代碼（如 `2, e1, n, e:quota`；純數字/`t` 為文字、`e` 為 Emoji、`n` 為換行）：*

     | # | 指標名稱（識別碼） | # | 指標名稱（識別碼） | # | 指標名稱（識別碼） |
     |---|---|---|---|---|---|
     | **1** | 🤖 模型名稱 (`model-name`) | **13** | ✨ Argon 額度 (`quota-argon`) | **25** | 🔀 Git 分支 (`git-branch`) |
     | **2** | 🪪 使用中代理 (`agent-profile`) | **14** | ✨ Argon 長條圖 (`quota-argon-bar`) | **26** | 🔍 未提交變更 (`vcs-dirty`) |
     | **3** | ⚡ 代理狀態 (`agent-state`) | **15** | ⏱️ Argon 倒數 (`quota-argon-countdown`) | **27** | 🗃️ 版控類型 (`vcs-type`) |
     | **4** | ⚙️ 運行模式 (`mode`) | **16** | ⏰ Argon 時間 (`quota-argon-reset-time`) | **28** | 💾 記憶體量 (`memory-usage`) |
     | **5** | 🔋 五小時額度 (`quota`) | **17** | 💎 訂閱方案 (`plan-tier`) | **29** | 🚀 CLI 版本 (`cli-version`) |
     | **6** | 🔋 五小時長條圖 (`quota-bar`) | **18** | 📧 帳號信箱 (`account-email`) | **30** | 💬 對話 ID (`conversation-id`) |
     | **7** | ⏳ 五小時倒數 (`quota-reset-countdown`) | **19** | 🧠 脈絡比例 (`context-used`) | **31** | 🛡️ 沙盒狀態 (`sandbox-status`) |
     | **8** | 🕒 五小時時間 (`quota-reset-time`) | **20** | 🧠 脈絡長條圖 (`context-used-bar`) | **32** | 🔔 工具確認框 (`tool-confirmation`) |
     | **9** | 📅 每週額度 (`quota-weekly`) | **21** | 💰 權杖數量 (`token-count`) | **33** | 📥 待處理輸入 (`pending-input`) |
     | **10** | 📅 每週長條圖 (`quota-weekly-bar`) | **22** | 💰 權杖長條圖 (`token-count-bar`) | **34** | 🔄 背景任務數 (`background-tasks`) |
     | **11** | ⏲️ 每週倒數 (`quota-weekly-countdown`) | **23** | 📁 專案短路徑 (`project-path`) | **35** | 👥 活躍子代理 (`subagents`) |
     | **12** | 🗓️ 每週時間 (`quota-weekly-reset-time`) | **24** | 📍 專案完整路徑 (`project-full-path`) | **36** | 📄 產出檔案數 (`artifacts`) |
     ```
   - **各語系單行標題與表頭範例**：
     - **zh-tw**：`📋 **目前已選取的狀態列指標（共 N 項）** — *於下方 Write-in 輸入序號或代碼（如 \`2, e1, n, e:quota\`；純數字/\`t\` 為文字、\`e\` 為 Emoji、\`n\` 為換行）：*` ／ 表頭 `| # | 指標名稱（識別碼） | # | 指標名稱（識別碼） | # | 指標名稱（識別碼） |`
     - **zh-cn**：`📋 **目前已选取的状态栏指标（共 N 项）** — *于下方 Write-in 输入序号或代码（如 \`2, e1, n, e:quota\`；纯数字/\`t\` 为文字、\`e\` 为 Emoji、\`n\` 为换行）：*` ／ 表頭 `| # | 指标名称（标识码） | # | 指标名称（标识码） | # | 指标名称（标识码） |`
     - **us**：`📋 **Currently Selected Metrics (Total N)** — *Enter comma-separated numbers/IDs in Write-in below (e.g. \`2, e1, n, e:quota\`; number/\`t\`=text, \`e\`=Emoji, \`n\`=line break):*` ／ 表頭 `| # | Metric (ID) | # | Metric (ID) | # | Metric (ID) |`
     - **jp**：`📋 **現在選択中の指標（全 N 項目）** — *下の Write-in に番号またはIDをカンマ区切りで入力（例: \`2, e1, n, e:quota\`；数字/\`t\`=テキスト、\`e\`=絵文字、\`n\`=改行）：*` ／ 表頭 `| # | 指標名（ID） | # | 指標名（ID） | # | 指標名（ID） |`
2. **緊接著在同一回合呼叫「單行極簡版」`ask_question`**（`question` 欄位**嚴格限制為單純 1 行文字，禁止包含 `\n` 換行**，以免重複渲染兩次推擠上方表格）：
   - **前綴規則**（已濃縮於上方表格標題中）：
     - 純數字（如 `1`）或 `t1` 或純英文 ID（如 `quota`）或 `t:quota` 均為文字樣式。
     - `e1` 或 `e:quota` 為繪圖符號（Emoji）樣式。
     - 大小寫不分；略過排序預設全部為文字樣式；可使用 `n` 強制換行；未填寫的指標不予顯示。

   **zh-tw 範例**：
   ```json
   {
     "questions": [
       {
         "question": "請設定狀態列顯示順序與個別樣式：",
         "options": [
           "略過，使用原勾選順序啟用全部指標（預設文字樣式）",
           "手動排序與設定樣式（請在下方「Write-in...」欄位中填寫）"
         ],
         "is_multi_select": false
       }
     ],
     "toolSummary": "排序設定",
     "toolAction": "詢問顯示順序與樣式"
   }
   ```

   **zh-cn 範例**：
   ```json
   {
     "questions": [
       {
         "question": "请设置状态栏显示顺序与个别样式：",
         "options": [
           "跳过，使用原勾选顺序启用全部指标（默认文字样式）",
           "手动排序与设定样式（请在下方“Write-in...”栏位中填写）"
         ],
         "is_multi_select": false
       }
     ],
     "toolSummary": "排序设置",
     "toolAction": "询问显示顺序与样式"
   }
   ```

   **us 範例**：
   ```json
   {
     "questions": [
       {
         "question": "Please set the statusline display order and individual styles:",
         "options": [
           "Skip, keep current selection order (default text labels)",
           "Manual order & styles (fill in the 'Write-in...' box below)"
         ],
         "is_multi_select": false
       }
     ],
     "toolSummary": "Sorting settings",
     "toolAction": "Ask display order and styles"
   }
   ```

   **jp 範例**：
   ```json
   {
     "questions": [
       {
         "question": "ステータスラインの表示順序と個別のスタイルを設定してください：",
         "options": [
           "スキップして選択順のまま全指標を有効化（デフォルトテキスト形式）",
           "手動で並べ替えとスタイル設定（下の「Write-in...」欄に入力）"
         ],
         "is_multi_select": false
       }
     ],
     "toolSummary": "並べ替え設定",
     "toolAction": "表示順序とスタイルの確認"
   }
   ```
3. 取得使用者的排序輸入（`order`）。

### 步驟 5：執行配置腳本

1. 取得使用者工作區（workspace）的絕對路徑（`workspace`）。
2. 呼叫 `run_command` 執行本外掛目錄下的 `configure-statusline.mjs` 腳本，傳入相關參數。腳本會全自動處理：
   - 排序輸入與個別標籤顯示樣式（前綴 `t`/`e` 解析並寫入 `ui.footer.itemStyles`，未設定者強制以文字為預設）。
   - 依平台智慧產生 Node.js 執行指令（macOS / Linux 使用絕對路徑以避免 NVM 等非互動式 Shell 遺失 `PATH` 引發 exit status 127；Windows 絕對禁止包含雙引號以避開 Go `exec.Command("cmd", "/c", command)` 的 `\"` 字面引號污染陷阱，無空格路徑使用 `node <path>`，含空格路徑自動轉為 `node --import file:///... -e 0`）。
   - 同步寫入三層 `settings.json`（已執行防禦性 位元組順序記號（BOM）剝除與寫入後無 位元組順序記號（BOM）驗證，包含 `items` 與 `itemStyles`）。
   - 寫入 `trusted_hooks.json` 註冊安全信任（含當前工作區、家目錄與 `"*"` 萬用字元（Wildcard）鍵，精確註冊設定檔命令並全面補齊引號、反斜線、正斜線與環境變數變體）。
   - 將 Hook 腳本安全拷貝部署至 `~/.gemini/antigravity-cli/hooks/` 目錄中，寫入時強制 `{ encoding: 'utf8' }`。
   - 若為 Windows 平台且 CLI 目錄缺少 `sh.exe`，自動編譯靜默無窗體橋接器。

   **指令範例**：
   ```bash
   node skills/agy-cli-statusline/scripts/configure-statusline.mjs --lang "<步驟1選定的語言>" --selected '<JSON字串格式的步驟3勾選結果>' --order "<步驟4的排序/樣式輸入>" --workspace "<當前工作區絕對路徑>"
   ```
   *注意：`--selected` 必須是合法的 JSON 字串陣列，例如 `'["🤖 目前使用的人工智慧模型名稱（model-name）","🔋 帳號五小時可用額度百分比（quota）"]'`。請注意外層與內層引號的正確跳脫。*

### 步驟 6：自動驗證

1. 配置腳本執行完成後，呼叫 `run_command` 執行原有的測試驗證腳本：
   ```bash
   node skills/agy-cli-statusline/scripts/test-counters.mjs
   ```
2. 確認測試無誤通過。若有任何錯誤，依照錯誤訊息進行對應修正。

### 步驟 7：回報與重新載入提示

1. **輸出排版順序設定（Order Configuration）**：
   - 在最終回報中，以程式碼區塊清楚列出**本次設定**與**先前設定**（若有先前含換行 `n` 或自訂排序紀錄）的排版順序字串，並同時提供以下兩種版本，方便使用者留存紀錄、日後重新設定或直接複製貼上至步驟 4 的 Write-in 欄位：
     - **數字序號版本**：以步驟 3 勾選項目序號與樣式前綴組成的逗號分隔字串（如 `1,e2,n,3`；若為略過則輸出對應序號字串如 `1,2,3...`）。
     - **英文識別碼版本**：以指標英文識別碼與樣式前綴組成的逗號分隔字串（文字樣式為純識別碼如 `model-name`，Emoji 樣式加上 `e:` 前綴如 `e:quota`，並保留換行 `n`，例如 `model-name,e:quota,n,context-used`），即使日後勾選項目增減也不會跑位。
2. **根據所選語系撰寫重新載入說明**：
   - **初次安裝或初次啟用狀態列**：向使用者說明，由於 agy 命令列介面（CLI）在執行期間不會動態監聽並註冊新增的掛鉤行程，**必須重新啟動 agy 命令列介面（CLI）（退出後重新開啟）** 才能載入掛鉤行程並顯示狀態列。
   - **已啟用狀態列之調整**：若使用者先前已啟用狀態列，本次僅為調整指標順序或切換語系，設定已自動在命令列介面（CLI）底部**即時熱更新（Hot Reload）生效**，無需重新啟動。
3. **舊版腳本檢查**：讀取或檢查 `~/.gemini/hooks/statusline-quota.mjs` 與 `~/.gemini/hooks/fetch-local-quota.mjs` 是否存在。若存在，則以所選語系提醒使用者可以安全地手動刪除它們。
4. **故障診斷指引**：在回覆末尾以所選語系加入提示：「若日後狀態列突然消失，請前往本外掛目錄執行 `node skills/agy-cli-statusline/scripts/diagnose-statusline.mjs`，並把完整輸出貼給 人工智慧（AI）代理進行診斷。」

---

## ! 常見陷阱速查

完整對照表（12 條陷阱與修正做法）詳見 [references/pitfalls.md](references/pitfalls.md)。最關鍵的三條速記：

1. **必須同步寫入三層設定檔**（特別是 命令列介面（CLI）專屬的 `~/.gemini/antigravity-cli/settings.json`，是最致命的盲點）
2. **Windows 寫設定檔絕對禁止帶 位元組順序記號（BOM）**，寫入後必須驗證前 3 個位元組
3. **絕對禁止憑空生成 掛鉤（Hook） 腳本**，必須從本外掛的 `skills/agy-cli-statusline/scripts/` 讀取原文部署
