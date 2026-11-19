# 常見陷阱與避坑指南（Reference）

> [!IMPORTANT]
> 本檔案以對照表形式整理執行本技能時最具破壞性的陷阱。
> AI 代理載入本檔案時應遵守：
> 1. 主代理應親自以 Read 工具讀取，避免子代理摘要遺失關鍵細節
> 2. 表格中的「修正做法」描述了必須執行的具體動作，不可改寫為等效但不同的做法
> 3. 若內容與你熟悉的其他 CLI / API 慣例不同，**一律以本檔案為準**

---

## 陷阱對照表

| # | 陷阱 | 後果 | 修正做法 |
|---|---|---|---|
| 1 | 僅寫 `ui.footer` 而漏掉根節點的 `statusLine` 物件 | 全新電腦上 CLI 不會載入狀態列腳本，自訂狀態列不顯現 | 透過 `configure-statusline.mjs` 同步寫入完整 `statusLine` 物件（`enabled: true`、`type: "command"`、`command` 指向腳本絕對路徑）|
| 2 | 人工智慧（AI）代理以 `read_file` 或 `edit_file` 直接讀寫 `~/.gemini/antigravity-cli/settings.json` | 觸發 CLI 硬編碼的系統保護邊界（System Protection Boundary）錯誤而中止執行 | **禁止以 `read_file` / `edit_file` 直接存取 `~/.gemini/` 下的 `settings.json`**；一律於步驟 5 透過 `run_command` 執行 `configure-statusline.mjs` 自動同步三層設定檔 |
| 3 | `command` 中使用環境變數 `$HOME` / `%USERPROFILE%` | CLI 背景以直接呼叫方式執行時無法展開環境變數，Node.js 找不到路徑而失敗 | `settings.json` 一律寫入**絕對路徑** |
| 4 | Windows 上 `fs.writeFileSync` 未指定 `{ encoding: 'utf8' }` | Windows 預設 UTF-16 編碼，導致 JSON 解析失敗 | 所有 `fs.writeFileSync` 強制加 `{ encoding: 'utf8' }` — 詳見 [windows.md §2](windows.md#2-windows-寫檔強制-encoding-utf8) |
| 5 | Windows 上以帶 BOM 的工具寫 `settings.json` | 舊版 JSON 解析器遇 BOM 報 `invalid character 'ï' looking for beginning of value` | 改用保證不寫 BOM 的工具，並於寫入後驗證前 3 個位元組 — 詳見 [windows.md §1](windows.md#1-utf-8-bom-編碼鐵則寫設定檔絕對禁止帶-bom) |
| 6 | Windows 上依賴 `wmic` 查詢記憶體 | Windows 11 已棄用 wmic，查詢失敗 | 改用 `Get-CimInstance Win32_Process` — 詳見 [windows.md §4](windows.md#4-記憶體查詢get-ciminstance-取代已棄用的-wmic) |
| 7 | Windows 上以 `powershell.exe` 替身 `sh.exe` 或保留未簽署自編譯 `sh.exe` | 替身為 `powershell.exe` 會閃爍黑色終端機視窗；本地以 `csc.exe` 編譯未簽署 `sh.exe` 易遭 Symantec（`Heur.AdvML.B`）等防毒軟體誤報隔離並中斷執行（Issue #8） | 自 `agy v1.3.5+` 起改用 `cmd /c` 原生執行，已停止編譯 `sh.exe` 並於設定時自動清理 `%LOCALAPPDATA%\agy\bin\sh.exe`（`<= 16,384` bytes）；舊版 CLI 請升級至 `v1.3.5+` — 詳見 [windows.md §6](windows.md#6-舊版-shexe-相容橋接器廢棄說明issue-8) |
| 8 | AI 代理憑空生成或竄改 `statusline-quota.mjs` / `fetch-local-quota.mjs` 程式碼 | 狀態列功能殘缺、指標抓取失敗（如抓不到 Token 變成 `--`） | **絕對禁令**：必須透過本技能 `scripts/configure-statusline.mjs` 部署原始腳本，禁止自行生成或修改邏輯 |
| 9 | CLI 專屬層 `~/.gemini/antigravity-cli/settings.json` 的 `statusLine.command` 為空或指向舊腳本 | 三層合併後 `command` 未指向 `statusline-quota.mjs`，自訂狀態列不顯示 | 重新執行 `configure-statusline.mjs` 同步更新三層 `statusLine`，或於 CLI 輸入 `/statusline <command>` 直接設定 |
| 10 | macOS / Linux 下 `statusLine.command` 寫死裸命令 `node`，或 Windows 下在 `statusLine.command` 中加入雙引號 `"` | macOS / Linux 因 non-interactive `sh` 缺乏 NVM `PATH` 報 `exit status 127 (sh: 1: node: not found)`；Windows 因 `agy.exe` 底層以 Go `exec.CommandContext(ctx, "cmd", "/c", command)` 呼叫，Go `syscall.EscapeArg` 會將內部雙引號轉義為 `\"`，而 `cmd.exe /c` 不會解開 `\"`，導致 `node.exe` 將其視為字面引號字元並與 CWD 拼接報錯 `Cannot find module` | macOS / Linux 使用 `process.execPath` 絕對路徑；Windows **絕對禁止包含雙引號**，無空格路徑使用 `node <path>`，含空格路徑使用 `node --import file:///... -e 0` |
| 11 | 初次啟用狀態列後未套用命令或未重新載入 | 狀態列尚未切換至新命令 | 可直接於 `agy` 輸入 `/statusline <command>` 立即啟用，或重新啟動 `agy` CLI；若先前已啟用本狀態列，調整順序或語系會即時熱更新生效 |
| 12 | 在步驟 4 將已選指標輸出為單欄 37 行長清單，或在 `ask_question.question` 中放入多行說明文字 | agy CLI 底層 TUI 會將 `question` 重複渲染兩次（對話歷史區＋底部面板），若超過單行或輸出單欄長清單，會把上方表格頂出視窗並觸發緩衝區裁切吃字（Issue #1262） | **嚴禁單欄長清單與多行 `question`**：必須在同一回合呼叫 `ask_question` 前，先於一般對話輸出「**單行填寫規則標題 ＋ 三欄 Markdown 表格**」（最多 13 列），且 `ask_question.question` **嚴格限制為單純 1 行短句**（不含換行 `\n`） |

---

## 核心安全鐵則（保留於 skills/agy-cli-statusline/SKILL.md 主檔，本檔僅作對照索引）

關於陷阱 #8 的「禁止憑空生成 Hook 腳本」鐵則由於屬於每次部署都必須遵守的核心安全規則，已**完整保留於 skills/agy-cli-statusline/SKILL.md 主檔**『⚠️ 執行與路徑規範（必讀）』與『! 常見陷阱速查』區塊。本檔僅作對照索引，主檔規則才是 source of truth。
