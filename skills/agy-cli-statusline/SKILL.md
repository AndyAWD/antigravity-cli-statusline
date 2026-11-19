---
name: antigravity-cli-statusline:agy-cli-statusline
description: 本技能用於設定 Antigravity 命令列介面（CLI）（agy）的狀態列（Statusline / Footer）顯示指標（共 37 項，含外掛版本與 GitHub Release 自動更新提醒）、標籤顯示樣式（text / emoji）、顯示順序與多語系介面（繁體中文 zh-tw / 简体中文 zh-cn / English us / 日本語 jp），並透過隨附的跨平台 Node.js 配置腳本（configure-statusline.mjs）完成狀態列腳本部署與設定同步。適用情境：使用者要求設定 / 客製化 / 啟用命令列介面（CLI）狀態列、調整頁尾顯示項目、切換文字或 Emoji 圖示標籤模式、顯示 API 額度 / 權杖與脈絡用量 / Git 分支 / 代理狀態 / 對話 ID / Agy CLI 版本 / 外掛版本與更新提醒等指標、切換狀態列語言、在新電腦上啟用此狀態列，或主動以 /antigravity-cli-statusline:agy-cli-statusline 觸發本技能時。支援 macOS、Linux、Windows 跨平台環境。
---

# Antigravity 狀態列設定技能

本技能提供 Antigravity 命令列介面（CLI）狀態列（Statusline / Footer）的客製化、標籤樣式（文字 / Emoji）、語系設定與跨平台腳本部署能力。

## ⚠️ 執行與路徑規範（必讀）

1. **禁止以 `read_file`、`write_file` 或 `edit_file` 存取 `~/.gemini/` 下的 `settings.json`**：
   - `~/.gemini/antigravity-cli/settings.json` 等路徑受系統保護邊界保護，步驟 1 至步驟 7 期間嚴禁直接讀寫，亦無須讀取 `scripts/*.mjs` 原始碼。所有讀寫與位元組順序記號（BOM）清理一律於步驟 5 透過 `configure-statusline.mjs` 自動完成。
2. **動態解析本技能目錄路徑（`<SKILL_DIR>`）**：
   - 本 `SKILL.md` 所在目錄即為 `<SKILL_DIR>`（例如 `~/.gemini/config/plugins/antigravity-cli-statusline/skills/agy-cli-statusline` 或開發工作區下的 `skills/agy-cli-statusline`）。讀取 `resources/questions.json` 或執行 `scripts/*.mjs` 時，必須使用 `<SKILL_DIR>` 完整路徑。
3. **參考文件（需要查閱細節時讀取）**：
   - [`references/technical-specs.md`](references/technical-specs.md) — 四階配色、長條圖自動合併、時間格式、`plugin-version` 更新檢查與行程識別規格
   - [`references/step4-table-example.md`](references/step4-table-example.md) — 步驟 4 全選 37 項三欄 13 列表格完整範例
   - [`references/windows.md`](references/windows.md) — Windows 平台相容規範（無 BOM 編碼、無雙引號路徑格式等）
   - [`references/config-files.md`](references/config-files.md) — 三層設定檔結構、`statusLine` 格式與 37 項指標識別碼清單
   - [`references/pitfalls.md`](references/pitfalls.md) — 常見陷阱對照表

---

## 🎯 設定檔與技術摘要

| 層級 | 路徑語法 | 優先級 |
|---|---|---|
| **命令列介面（CLI）專屬（最高）** | `~/.gemini/antigravity-cli/settings.json` | 🔥 高於全域 |
| 全域 | `~/.gemini/settings.json` | 中 |
| 專案（條件性）| `<workspace>/.gemini/settings.json` | 若存在則覆寫 |

- 語系記錄於 `ui.language`；全域標籤樣式為 `ui.footer.labelStyle`（`"text"` / `"emoji"`）；指標順序為 `ui.footer.items`；個別樣式覆寫為 `ui.footer.itemStyles`（未設定者一律強制以文字為預設）。
- 支援 24-bit 四階配色、相鄰容量長條圖自動合併（樣式衝突時拆分）、智慧自動換行與跨平台無 BOM UTF-8 寫入（明細見 [`references/technical-specs.md`](references/technical-specs.md)）。
- 僅當 `ui.footer.items` 啟用 `plugin-version` 時，互動式 `agy` CLI 每次啟動會檢查一次 GitHub Release（略過 `agy -p` 非互動模式），若外掛版本落後則於狀態列最下方顯示兩行更新提示與 `! agy plugin install` 指令。

---

## 🌐 語言鎖定規則（Locale Locking — 全域強制）

> [!CAUTION]
> **使用者在步驟 1 一旦選定語系（`zh-tw` / `zh-cn` / `us` / `jp`），AI 代理在本次執行的剩餘所有對話輸出（含步驟 2–4 的 `ask_question` 題目與選項、進度說明、警告與錯誤、步驟 7 回報），都必須嚴格使用該語言。**

**例外（保持原文不翻譯）**：技術識別碼（如 `model-name`、`plugin-version`、`statusLine`）、檔案路徑、程式碼區塊內容與系統錯誤原文。

---

## 🔄 執行步驟

### 步驟 1：第一階段問卷（語系選擇 — 必須最先執行）

**為何最先**：後續所有訊息與問卷皆須使用所選語系呈現，必須先於任何其他操作確定語系。呼叫 `ask_question`：

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
  ]
}
```

選定後，將語言代碼（`zh-tw` / `zh-cn` / `us` / `jp`）記錄為鎖定語系。

### 步驟 2：Node.js 環境預檢

> ⚠️ 所有互動文字必須使用步驟 1 所選語系；嚴格禁止於本步驟直接 `read_file` `~/.gemini/` 下的 `settings.json`。

依作業系統執行預檢指令：`node --version`（macOS/Linux 可搭配 `command -v node && node --version`；Windows 可用 `where node && node --version`）。
- ✅ **已安裝**：記錄版本號並進入步驟 3。
- ❌ **未安裝**：以所選語系說明缺少 Node.js 會導致底部狀態列空白且連續失敗 30 次後停用，並呼叫 `ask_question` 確認是否繼續：

**zh-tw 範例**：
```json
{
  "questions": [
    {
      "question": "⚠️ 偵測到系統未安裝 Node.js。\n\n狀態列腳本需要 Node.js 才能運作，缺少 Node.js 將導致命令列介面（CLI）底部狀態列完全空白且自動停用。\n\n建議先安裝 Node.js（例如：brew install node），再重新執行本技能。\n\n是否仍要繼續設定？（設定檔會正確寫入，但狀態列在安裝 Node.js 前不會顯示）",
      "options": [
        "中斷，我先去安裝 Node.js",
        "繼續設定（安裝 Node.js 後狀態列會自動生效）"
      ],
      "is_multi_select": false
    }
  ]
}
```

**zh-cn 範例**：
```json
{
  "questions": [
    {
      "question": "⚠️ 检测到系统未安装 Node.js。\n\n状态栏脚本需要 Node.js 才能运作，缺少 Node.js 将导致命令行界面（CLI）底部状态栏完全空白且自动停用。\n\n建议先安装 Node.js（例如：brew install node），再重新运行本技能。\n\n是否仍要继续设置？（配置文件会正确写入，但状态栏在安装 Node.js 前不会显示）",
      "options": [
        "中断，我先去安装 Node.js",
        "继续设置（安装 Node.js 后状态栏会自动生效）"
      ],
      "is_multi_select": false
    }
  ]
}
```

**us 範例**：
```json
{
  "questions": [
    {
      "question": "⚠️ Node.js is not installed on this system.\n\nThe statusline script requires Node.js to function. Without Node.js, the CLI footer will be completely blank and automatically disabled.\n\nIt is recommended to install Node.js first (e.g.: brew install node), then re-run this skill.\n\nDo you still want to proceed? (Configuration files will be written, but the statusline will not appear until Node.js is installed)",
      "options": [
        "Abort, I will install Node.js first",
        "Continue setup (Statusline will automatically work once Node.js is installed)"
      ],
      "is_multi_select": false
    }
  ]
}
```

**jp 範例**：
```json
{
  "questions": [
    {
      "question": "⚠️ システムに Node.js がインストールされていません。\n\nステータスラインのスクリプトには Node.js が必要です。Node.js がないと、CLI 画面下部のステータスラインは完全に空白となり、自動的に無効化されます。\n\n先に Node.js をインストールしてから（例：brew install node）、本スキルを再実行することをお勧めします。\n\nそれでも設定を続行しますか？（設定ファイルは正常に書き込まれますが、Node.js がインストールされるまでステータスラインは表示されません）",
      "options": [
        "中断して、先に Node.js をインストールする",
        "設定を続行する（Node.js インストール後にステータスラインが自動的に有効になります）"
      ],
      "is_multi_select": false
    }
  ]
}
```

- 選擇「中斷」：輸出安裝指引後結束流程，不寫入任何設定。
- 選擇「繼續」：進入步驟 3。

### 步驟 3：第二階段問卷（讀取 `questions.json`、五大分類分頁勾選指標）

1. 讀取 `<SKILL_DIR>/resources/questions.json`，依步驟 1 語言代碼（`zh-tw` / `zh-cn` / `us` / `jp`）取得 `categories`（共 5 個分類、37 項指標）。
   > [!NOTE]
   > **螢幕高度限制與分頁設計（Issue #1262）**：為避免單頁超過終端機可容納行數（約 31 項）導致無法捲動，37 項指標拆分為五個分頁（每頁 4–14 項），既有 `#1–#36` 編號不變，新增 `#37` 外掛版本（`plugin-version`）於分類 5 最末：
   > - 分類 1：模型與代理（4 項：`model-name`, `agent-profile`, `agent-state`, `mode`）
   > - 分類 2：額度、計費與帳號（14 項：`quota`, `quota-bar`, `quota-reset-countdown`, `quota-reset-time`, `quota-weekly`, `quota-weekly-bar`, `quota-weekly-countdown`, `quota-weekly-reset-time`, `quota-argon`, `quota-argon-bar`, `quota-argon-countdown`, `quota-argon-reset-time`, `plan-tier`, `account-email`）
   > - 分類 3：脈絡與權杖（4 項：`context-used`, `context-used-bar`, `token-count`, `token-count-bar`）
   > - 分類 4：工作區與版本控制（5 項：`project-path`, `project-full-path`, `git-branch`, `vcs-dirty`, `vcs-type`）
   > - 分類 5：系統狀態與背景任務（10 項：`memory-usage`, `cli-version`, `conversation-id`, `sandbox-status`, `tool-confirmation`, `pending-input`, `background-tasks`, `subagents`, `artifacts`, `plugin-version`）

2. 在單次 `ask_question` 呼叫的 `questions` 陣列依序傳入 5 個分類題目物件（Antigravity CLI 原生渲染為 `Question 1/5:` 至 `Question 5/5:` 分頁精靈）：

```json
{
  "questions": [
    { "question": "<categories[0].question>", "options": ["<categories[0].options...>"], "is_multi_select": true },
    { "question": "<categories[1].question>", "options": ["<categories[1].options...>"], "is_multi_select": true },
    { "question": "<categories[2].question>", "options": ["<categories[2].options...>"], "is_multi_select": true },
    { "question": "<categories[3].question>", "options": ["<categories[3].options...>"], "is_multi_select": true },
    { "question": "<categories[4].question>", "options": ["<categories[4].options...>"], "is_multi_select": true }
  ]
}
```

將 5 題回傳的勾選項合併為陣列 `selected`。

### 步驟 4：第三階段問卷（手動排序、樣式前綴與最終篩選）

> [!CAUTION]
> **防截斷鐵則（Issue #1262）**：Antigravity CLI 底層 TUI 會將 `ask_question` 的 `question` 文字重複渲染兩次，多行 `question` 或單欄長清單會把上方內容頂出可視視窗遭裁切！因此必須嚴格遵守：
> 1. **禁止輸出單欄每項一行的長清單**。
> 2. **在同一回合呼叫 `ask_question` 之前，先在對話視窗輸出「單行填寫規則標題 ＋ 三欄 Markdown 表格」**，將最多 37 項壓縮在 **13 列以內**。
> 3. **`ask_question` 的 `question` 欄位嚴格限制為「單純 1 行短句」（禁止包含 `\n` 換行或長篇說明）**。

1. **先輸出單行標題 ＋ 直向優先三欄表格**：
   - 將 `selected`（共 $N$ 項）依序編號 `1`~$N$，計算每欄列數 $R = \lceil N / 3 \rceil$（$N=37$ 時 $R=13$ 列），採**直向優先（Column-major：左欄 `1`~$R$、中欄 $R+1$~$2R$、右欄 $2R+1$~$N$）**輸出三欄表格，每格精簡格式 `🤖 簡稱 (\`metric-id\`)`（完整 37 項 13 列範本見 [`references/step4-table-example.md`](references/step4-table-example.md)）：
     ```markdown
     📋 **目前已選取的狀態列指標（共 37 項）** — *於下方 Write-in 輸入序號或代碼（如 `2, e1, n, e:quota`；純數字/`t` 為文字、`e` 為 Emoji、`n` 為換行）：*

     | # | 指標名稱（識別碼） | # | 指標名稱（識別碼） | # | 指標名稱（識別碼） |
     |---|---|---|---|---|---|
     | **1** | 🤖 模型名稱 (`model-name`) | **14** | ✨ Argon 長條圖 (`quota-argon-bar`) | **27** | 🗃️ 版控類型 (`vcs-type`) |
     | ... | ... | ... | ... | ... | ... |
     | **13** | ✨ Argon 額度 (`quota-argon`) | **26** | 🔍 未提交變更 (`vcs-dirty`) | **37** | 🧩 外掛版本 (`plugin-version`) |
     ```
   - **各語系單行標題與表頭**：
     - **zh-tw**：`📋 **目前已選取的狀態列指標（共 N 項）** — *於下方 Write-in 輸入序號或代碼（如 \`2, e1, n, e:quota\`；純數字/\`t\` 為文字、\`e\` 為 Emoji、\`n\` 為換行）：*` ／ `| # | 指標名稱（識別碼） | # | 指標名稱（識別碼） | # | 指標名稱（識別碼） |`
     - **zh-cn**：`📋 **目前已选取的状态栏指标（共 N 项）** — *于下方 Write-in 输入序号或代码（如 \`2, e1, n, e:quota\`；纯数字/\`t\` 为文字、\`e\` 为 Emoji、\`n\` 为换行）：*` ／ `| # | 指标名称（标识码） | # | 指标名称（标识码） | # | 指标名称（标识码） |`
     - **us**：`📋 **Currently Selected Metrics (Total N)** — *Enter comma-separated numbers/IDs in Write-in below (e.g. \`2, e1, n, e:quota\`; number/\`t\`=text, \`e\`=Emoji, \`n\`=line break):*` ／ `| # | Metric (ID) | # | Metric (ID) | # | Metric (ID) |`
     - **jp**：`📋 **現在選択中の指標（全 N 項目）** — *下の Write-in に番号またはIDをカンマ区切りで入力（例: \`2, e1, n, e:quota\`；数字/\`t\`=テキスト、\`e\`=絵文字、\`n\`=改行）：*` ／ `| # | 指標名（ID） | # | 指標名（ID） | # | 指標名（ID） |`

2. **緊接著在同一回合呼叫「單行極簡版」`ask_question`**（純數字 / `t` = 文字、`e` = Emoji、`n` = 換行、大小寫不分、未填不顯示；`question` 嚴禁含 `\n`）：

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
  ]
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
  ]
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
  ]
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
  ]
}
```

取得排序輸入（`order`）。

### 步驟 5：執行配置腳本

取得工作區絕對路徑（`workspace`）與 `<SKILL_DIR>`，呼叫 `run_command` 執行配置腳本（會自動解析前綴樣式、產生跨平台無引號/絕對路徑指令、部署 `statusline-quota.mjs` 與 `fetch-local-quota.mjs` 至 `~/.gemini/antigravity-cli/hooks/` 並寫入 `.hook-version.json` 與三層無 BOM `settings.json`）：

```bash
node "<SKILL_DIR>/scripts/configure-statusline.mjs" --lang "<步驟1語系>" --selected '<JSON字串格式的步驟3結果>' --order "<步驟4排序輸入>" --workspace "<工作區絕對路徑>"
```
*注意：`--selected` 必須是合法 JSON 字串陣列，需正確跳脫內外引號。*

### 步驟 6：自動驗證

執行測試驗證腳本並確認通過：
```bash
node "<SKILL_DIR>/scripts/test-counters.mjs"
```

### 步驟 7：回報與重新載入提示

1. **輸出排版順序設定（Order Configuration）**：以程式碼區塊列出**本次設定**（及若有之**先前設定**）的**數字序號版本**（如 `1,e2,n,3`）與**英文識別碼版本**（如 `model-name,e:quota,n,context-used`），方便日後直接貼回步驟 4 沿用。
2. **生效與同步說明（依鎖定語系）**：
   - **已啟用狀態列者**：順序、樣式與語系變更已**即時熱更新**生效，無須重啟。
   - **初次啟用者**：可於 `agy` 輸入配置腳本輸出的 `/statusline <command>` 立即啟用，或重啟 `agy` CLI。
   - **外掛升級後的掛鉤同步**：若日後透過 `! agy plugin install` 更新外掛，外掛顯示版號會立即追平並消除更新提醒，但 `~/.gemini/antigravity-cli/hooks/` 維持手動同步，需重新執行本技能才會更新掛鉤程式碼。
3. **故障診斷指引**：提示使用者若狀態列異常或懷疑外掛與掛鉤版本不同步，可執行 `node "<SKILL_DIR>/scripts/diagnose-statusline.mjs"` 並將完整輸出貼給 AI 代理診斷。

---

## ! 常見陷阱速查

完整對照表見 [`references/pitfalls.md`](references/pitfalls.md)。最關鍵的三條鐵則：
1. **禁止直接以 `read_file` / `edit_file` 讀寫 `~/.gemini/antigravity-cli/settings.json`**，一律由步驟 5 執行 `configure-statusline.mjs`。
2. **Windows 寫入設定檔絕對禁止帶 BOM**，且 `statusLine.command` 禁止包含雙引號 `"`。
3. **絕對禁止憑空生成或竄改 Hook 腳本**，必須透過 `scripts/configure-statusline.mjs` 部署原始腳本。
