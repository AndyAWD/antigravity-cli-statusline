---
name: agy-cli-statusline
description: 設定 Antigravity 命令列介面（Command-Line Interface）（agy）狀態列（Statusline / Footer）之 40 項即時指標（含 Orchestrator 實際執行模型、獨立的 Agy CLI／Agy 2.0／狀態列版本顯示與 GitHub Release 更新提醒）、標籤樣式（text / emoji）、排序與多語系（zh-tw / zh-cn / us / jp），並透過跨平台 configure-statusline.mjs 部署掛鉤與同步設定。適用於客製化頁尾、切換圖示或文字標籤、顯示額度 / 脈絡 / 權杖 / Git / 代理 / 版本與更新提醒指標、切換語系、跨機啟用，或以 /antigravity-cli-statusline:agy-cli-statusline 觸發時（支援 macOS、Linux、Windows）。
---

# Antigravity 狀態列設定技能

本技能提供 Antigravity 命令列介面（`agy`）狀態列客製化、標籤樣式（`text` / `emoji`）、語系設定與跨平台腳本部署。

## ⚠️ 執行與路徑規範（必讀）

1. **禁止以 `read_file`、`write_file` 或 `edit_file` 存取 `~/.gemini/` 下的 `settings.json`**：受系統保護邊界限制，步驟 1–7 期間嚴禁直接讀寫設定檔，亦無須讀取 `scripts/*.mjs` 原始碼；所有讀寫與位元組順序記號（Byte Order Mark）清理一律於步驟 5 透過 `configure-statusline.mjs` 完成。
2. **禁止憑空生成或竄改掛鉤（Hook）腳本**：`statusline-quota.mjs`、`fetch-local-quota.mjs` 與 `hooks/lib/` 僅能透過 `configure-statusline.mjs` 部署，嚴禁自行編寫或修改邏輯。
3. **動態解析 `<SKILL_DIR>`**：本 `SKILL.md` 所在目錄即為 `<SKILL_DIR>`（如 `~/.gemini/config/plugins/antigravity-cli-statusline/skills/agy-cli-statusline` 或 `skills/agy-cli-statusline`）。讀取 `resources/*.json` 或執行 `scripts/*.mjs` 時必須使用 `<SKILL_DIR>` 完整路徑。
4. **純 CLI 專用保護禁令**：本技能專用於設定 Antigravity 命令列介面（`agy`）底部狀態列，必須完整執行下方步驟 1–7 並由 `configure-statusline.mjs` 寫入設定，**嚴禁**改呼叫 `statusline_dashboard` 或 `statusline_save_config` 等 MCP 工具替代。
5. **參考文件**：
   - [`references/technical-specs.md`](references/technical-specs.md) — 四階配色、長條圖合併、時間格式、`plugin-version` 更新檢查與四層模組規格
   - [`references/step4-table-example.md`](references/step4-table-example.md) — 步驟 4 全選 40 項三欄 14 列表格完整範例
   - [`references/windows.md`](references/windows.md) — Windows 無位元組順序記號編碼、無雙引號路徑與子行程規範
   - [`references/config-files.md`](references/config-files.md) — 三層設定檔、`statusLine` 格式與 40 項指標識別碼清單
   - [`references/pitfalls.md`](references/pitfalls.md) — 常見陷阱對照表

## 🎯 設定檔與技術摘要

| 層級 | 路徑語法 | 優先級 |
|---|---|---|
| **命令列介面專屬（最高）** | `~/.gemini/antigravity-cli/settings.json` | 🔥 高於全域 |
| 全域 | `~/.gemini/settings.json` | 中 |
| 專案（條件性） | `<workspace>/.gemini/settings.json` | 若存在則覆寫 |

- 語系存於 `ui.language`；全域標籤樣式為 `ui.footer.labelStyle`（`"text"` / `"emoji"`）；指標順序為 `ui.footer.items`；個別覆寫為 `ui.footer.itemStyles`（未指定者預設文字）；預設採用 `standard` 渲染器。
- 支援 24-bit 四階配色、相鄰容量長條圖自動合併（樣式衝突時拆分）、智慧換行與無位元組順序記號 UTF-8 寫入（見 [`references/technical-specs.md`](references/technical-specs.md)）。
- 僅當 `ui.footer.items` 啟用 `plugin-update` 時，互動式 `agy` 啟動會檢查一次 GitHub Release（略過 `agy -p` 非互動模式），版本落後時於指定位置顯示兩行更新提示與 `agy plugin install` 指令；`plugin-version` 則僅顯示狀態列版本號，不觸發網路檢查或更新提醒。

## 🌐 語言鎖定規則（Locale Locking — 全域強制）

> [!CAUTION]
> **步驟 1 選定語系（`zh-tw` / `zh-cn` / `us` / `jp`）後，人工智慧（Artificial Intelligence）代理於本次執行的剩餘所有對話輸出（含步驟 2–4 `ask_question`、進度說明、警告與錯誤、步驟 7 回報）必須嚴格使用該語系。**
> **例外（保持原文）**：技術識別碼（如 `model-name`、`plugin-version`、`statusLine`）、檔案路徑、程式碼區塊與系統錯誤原文。

## 🔄 執行步驟

### 步驟 1：第一階段問卷（語系選擇 — 必須最先執行）

為確保後續所有互動採用使用者指定語系，必須最先執行。讀取 `<SKILL_DIR>/resources/prompts.json`，取出 `step1` 物件直接傳入 `ask_question` 呼叫，將所選代碼（`zh-tw` / `zh-cn` / `us` / `jp`）記錄為鎖定語系 `<lang>`。

### 步驟 2：Node.js 環境預檢

> ⚠️ 所有互動文字須使用鎖定語系；嚴禁直接 `read_file` `~/.gemini/` 下的 `settings.json`。

依系統執行預檢（macOS / Linux：`command -v node && node --version`；Windows：`where node && node --version`）：
- ✅ **已安裝**：記錄版本號，進入步驟 3。
- ❌ **未安裝**：以鎖定語系說明缺少 Node.js 會導致底部狀態列空白且連續失敗 30 次後停用，從 `<SKILL_DIR>/resources/prompts.json` 讀取 `step2_missing_node.<lang>` 呼叫 `ask_question` 確認：
  - 選「中斷」：輸出安裝指引後結束，不寫入任何設定。
  - 選「繼續」：進入步驟 3。

### 步驟 3：第二階段問卷（讀取 `questions.json`、五大分類分頁勾選）

1. 讀取 `<SKILL_DIR>/resources/questions.json`，依 `<lang>` 取得 `categories`（共 5 個分類、40 項指標；為符合終端機高度限制 Issue #1262 分頁，`active-model` 位於第 1 分類最末）：
   - `model-and-agent`（5 項）、`quota-and-billing`（14 項）、`context-and-tokens`（4 項）、`workspace-and-vcs`（5 項）、`system-and-tasks`（12 項）。
2. 在**單次 `ask_question` 呼叫**的 `questions` 陣列依序傳入 5 個分類題目物件（各題設 `"is_multi_select": true`，CLI 渲染為 `Question 1/5:`–`5/5:`），將回傳勾選項合併為陣列 `selected`。

### 步驟 4：第三階段問卷（手動排序、樣式前綴與最終篩選）

> [!CAUTION]
> **防截斷鐵則（Issue #1262）**：CLI 底層介面會重複渲染 `ask_question.question` 兩次，多行 `question` 或單欄長清單會把上方內容頂出視窗遭裁切。必須遵守：
> 1. **禁止輸出單欄每項一行的長清單**。
> 2. **在同一回合呼叫 `ask_question` 前，先於對話輸出「單行填寫規則標題 ＋ 三欄 Markdown 表格」**（最多 14 列），並**必須在同一回合內立即呼叫 `ask_question`，嚴禁只輸出表格就結束回合**。
> 3. **`ask_question.question` 嚴格限為單純 1 行短句**（禁止含 `\n`）。

1. **輸出單行標題 ＋ 直向優先三欄表格**：
   - 從 `<SKILL_DIR>/resources/prompts.json` 讀取 `step4_table.<lang>.title`（將總數佔位符替換為實際選取數 $N$）與 `step4_table.<lang>.header`。
   - 將 `selected` 依序編號 `1`–$N$，每欄列數 $R = \lceil N / 3 \rceil$（40 項時 $R = 14$ 列），採**直向優先（Column-major：左欄 `1`–$R$、中欄 $R+1$–$2R$、右欄 $2R+1$–$N$）**輸出，每格簡化為 `🤖 簡稱 (\`metric-id\`)`（完整 40 項範本見 [`references/step4-table-example.md`](references/step4-table-example.md)）。
   - 表格下方可附帶一句鎖定語系的簡短備援提示（如「若未跳出選單，請直接輸入排序或告知繼續」），避免偶發未觸發選單時使用者卡住。
2. **同一回合立即呼叫單行 `ask_question`（不可省略或延後到下一回合）**：
   - 從 `<SKILL_DIR>/resources/prompts.json` 讀取 `step4_order_question.<lang>` 直接傳入 `ask_question`。
   - 輸入規則：純數字或 `t` 前綴為文字、`e` 前綴為 Emoji、`n` 為換行、大小寫不分、未填指標不顯示。取得排序輸入 `order`。

### 步驟 5：執行配置腳本

取得工作區絕對路徑 `<workspace>` 與 `<SKILL_DIR>`，透過 `run_command` 執行：

```bash
node "<SKILL_DIR>/scripts/configure-statusline.mjs" --lang "<步驟1語系>" --selected '<JSON字串格式的步驟3結果>' --order "<步驟4排序輸入>" --workspace "<工作區絕對路徑>"
```

腳本會解析排序與樣式、產生跨平台安全 `statusLine.command`、部署 `statusline-quota.mjs`、`fetch-local-quota.mjs`、遞迴 `hooks/lib/` 與 `.hook-version.json` 至 `~/.gemini/antigravity-cli/hooks/`，並寫入三層無位元組順序記號 `settings.json`（`--selected` 須為合法 JSON 陣列並正確跳脫引號）。

### 步驟 6：自動驗證

執行驗證腳本並確認通過：

```bash
node "<SKILL_DIR>/scripts/test-counters.mjs"
```

### 步驟 7：回報與重新載入提示

依鎖定語系輸出：
1. **排版順序設定（Order Configuration）**：以程式碼區塊列出**本次設定**（及若有之**先前設定**）的**數字序號版本**（如 `1,e2,n,3`）與**英文識別碼版本**（如 `model-name,e:quota,n,context-used`），供日後貼回步驟 4 沿用。
2. **生效與同步說明**：
   - **已啟用者**：順序、樣式與語系已**即時熱更新**，無須重啟。
   - **初次啟用者**：於 `agy` 輸入腳本輸出的 `/statusline <command>` 立即啟用，或重啟 `agy` CLI。
   - **外掛升級後**：執行 `agy plugin install` 後顯示的 `plugin-version` 會立即追平，但 `~/.gemini/antigravity-cli/hooks/` 維持手動同步，須重新執行 `/antigravity-cli-statusline:agy-cli-statusline` 才會更新掛鉤與 `hooks/lib/`。
3. **故障診斷**：告知使用者若狀態列異常或懷疑版本不同步，可執行 `node "<SKILL_DIR>/scripts/diagnose-statusline.mjs"` 並貼上完整輸出進行診斷。

## ! 常見陷阱速查

完整對照見 [`references/pitfalls.md`](references/pitfalls.md)，三條核心鐵則：
1. **嚴禁直接讀寫 `~/.gemini/**/settings.json`**，一律由步驟 5 執行 `configure-statusline.mjs`。
2. **Windows 設定檔嚴禁帶位元組順序記號**，且 `statusLine.command` 禁止包含雙引號 `"`。
3. **嚴禁憑空生成或竄改掛鉤腳本**，必須透過 `configure-statusline.mjs` 部署原始腳本與 `hooks/lib/`。
