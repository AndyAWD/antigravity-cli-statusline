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
| 1 | 僅寫 `ui.footer` 而漏掉根節點的 `statusLine` 物件 | 全新電腦上 CLI 不會載入 Hook，自訂狀態列完全不顯現 | 寫入 `settings.json` 時同步寫入完整 `statusLine` 物件（`enabled: true`、`type: "command"`、`command` 指向 Hook 絕對路徑）|
| 2 | 漏掉 CLI 專屬設定檔 `~/.gemini/antigravity-cli/settings.json` | 全域設定被高優先級的 CLI 專屬設定無聲覆蓋，無任何錯誤訊息，極難排查 | **同步寫入三層設定檔**（全域、CLI 專屬、專案）— 詳見 [config-files.md §1](config-files.md#1-三層設定檔架構與優先級) |
| 3 | `command` 中使用環境變數 `$HOME` / `%USERPROFILE%` | CLI 背景以直接呼叫方式執行時無法 Shell 展開，Node.js 找不到路徑而失敗 | `settings.json` 一律寫入**絕對路徑**；`trusted_hooks.json` 同時追加絕對路徑與環境變數變體 |
| 4 | Windows 上 `fs.writeFileSync` 未指定 `{ encoding: 'utf8' }` | Windows 預設 UTF-16 編碼，agy CLI 啟動時解析錯誤直接崩潰 | 所有 `fs.writeFileSync` 強制加 `{ encoding: 'utf8' }` — 詳見 [windows.md §2](windows.md#2-windows-寫檔強制-encoding-utf8) |
| 5 | Windows 上以帶 BOM 的工具寫 `settings.json` | agy CLI（Go）的 JSON 解析器遇 BOM 崩潰報 `invalid character 'ï' looking for beginning of value` | 改用「保證不寫 BOM」的工具，並於寫入後驗證前 3 個位元組 — 詳見 [windows.md §1](windows.md#1-utf-8-bom-編碼鐵則寫設定檔絕對禁止帶-bom) |
| 6 | Windows 上依賴 `wmic` 查詢行程 | Windows 11 已棄用 wmic，行程查詢失敗，記憶體用量回傳「未知」 | 改用 `Get-CimInstance Win32_Process` — 詳見 [windows.md §4](windows.md#4-行程查詢get-ciminstance-取代-wmic) |
| 7 | Windows 上直接以 `powershell.exe` 替身 `sh.exe` | 每次背景更新閃爍黑色終端機視窗，UX 崩壞 | 利用 `csc.exe` 編譯靜默 `/target:winexe` 橋接器 — 詳見 [windows.md §6](windows.md#6-shexe-缺失修復編譯靜默無窗體橋接器) |
| 8 | AI 代理憑空生成或竄改 `statusline-quota.mjs` / `fetch-local-quota.mjs` 程式碼 | 狀態列功能殘缺、指標抓取失敗（如抓不到 Token 變成 `--`），甚至導致 CLI 崩潰 | **絕對禁令**：必須 100% 準確讀取本技能 `skills/antigravity-cli-statusline/scripts/` 目錄下的對應檔案原文部署，禁止自行發明或修改邏輯。要更新狀態列邏輯，必須先更新 `skills/antigravity-cli-statusline/scripts/*.mjs` 內容再部署 |
| 9 | agy CLI 內部指令（疑似 `/model` 切換模型時）覆寫 `~/.gemini/antigravity-cli/settings.json` 並把 `statusLine.command` 清空或刪除 | 三層合併後 `command` 為空字串，agy CLI 完全停止呼叫 hook → 狀態列**整條空白消失**（非退讓 UI，是真的不見）；無錯誤訊息、難以察覺 | 短期 workaround：重新執行本技能，會同步覆寫三層 `statusLine`。下次發生時請先**不要重跑技能**，立即執行 `node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs` 抓現場證據（重點看 CLI 專屬層的 `statusLine.command`），確認假設後再決定是否新增 watchdog 機制或向 agy CLI 上游回報 |

---

## 核心安全鐵則（保留於 skills/antigravity-cli-statusline/SKILL.md 主檔，本檔僅作對照索引）

關於陷阱 #8 的「禁止憑空生成 Hook 腳本」鐵則由於屬於每次部署都必須遵守的核心安全規則，已**完整保留於 skills/antigravity-cli-statusline/SKILL.md 主檔**步驟 7 區塊。本檔僅作對照索引，主檔規則才是 source of truth。
