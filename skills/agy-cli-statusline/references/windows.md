# Windows 平台特定規範（Reference）

> [!IMPORTANT]
> 本檔案記錄 Windows 平台的編碼與路徑相容規範。
> 1. **禁止以 `read_file` 或 `edit_file` 工具直接存取 `~/.gemini/` 下的 `settings.json`** — 所有設定檔更新均由 `scripts/configure-statusline.mjs` 自動處理。
> 2. **禁止改寫、簡化、重新格式化任何程式碼區塊內容**。

---

## 目錄

- [1. UTF-8 BOM 編碼鐵則（寫設定檔絕對禁止帶 BOM）](#1-utf-8-bom-編碼鐵則寫設定檔絕對禁止帶-bom)
- [2. Windows 寫檔強制 `{ encoding: 'utf8' }`](#2-windows-寫檔強制-encoding-utf8)
- [3. Windows BOM 自動清理（由配置腳本自動執行）](#3-windows-bom-自動清理由配置腳本自動執行)
- [4. 記憶體查詢：Get-CimInstance 取代已棄用的 wmic](#4-記憶體查詢get-ciminstance-取代已棄用的-wmic)
- [5. settings.json 中 Windows 路徑跳脫範本](#5-settingsjson-中-windows-路徑跳脫範本)
- [6. 舊版 sh.exe 相容橋接器廢棄說明（Issue #8）](#6-舊版-shexe-相容橋接器廢棄說明issue-8)
- [7. 子行程（Child Process）執行：強制 windowsHide: true](#7-子行程child-process執行強制-windowshide-true)

---

## 1. UTF-8 BOM 編碼鐵則（寫設定檔絕對禁止帶 BOM）

Windows 上有多個「預設帶 UTF-8 BOM（`EF BB BF`）」的寫檔路徑，無論代理使用 PowerShell 還是 cmd 觸發都可能中招。agy CLI（Go）的 JSON 解析器遇到 BOM 會直接崩潰報 `invalid character 'ï' looking for beginning of value`，且錯誤訊息完全看不出是編碼問題。

### ❌ 絕對禁止的寫檔路徑

寫入任何 `.gemini` 之下的 JSON 設定檔（`settings.json` 等）時，**絕對禁止**走下列任一路徑：

- ❌ **PowerShell 5.1**：`Set-Content -Encoding UTF8`、`Out-File -Encoding UTF8`、`Add-Content -Encoding UTF8`、`>` / `>>` 重新導向（**全部帶 BOM 且不可關閉**）
- ❌ **PowerShell 7+**：`Set-Content -Encoding UTF8`、`Out-File -Encoding UTF8`（**仍預設帶 BOM**；必須改用 `-Encoding utf8NoBOM`）
- ❌ **cmd 經由 PowerShell**：`powershell -Command "Set-Content ..."`、`pwsh -c "Out-File ..."`——表面在 cmd 環境，BOM 來源實際仍是 PowerShell
- ❌ **.NET 預設多載**：`[IO.File]::WriteAllText($p, $json)`、`[IO.File]::WriteAllText($p, $json, [Text.Encoding]::UTF8)`（兩者皆帶 BOM）
- ❌ **Python**：`open(p, 'w', encoding='utf-8-sig')`（顯式 BOM）、或在 Windows 上未指定 `encoding` 退回系統 locale（如 cp950，會直接破壞 JSON）
- ❌ **編輯器**：Notepad「UTF-8 with BOM」、舊版 Visual Studio 新檔預設、`code --wait` 後手動儲存為 UTF-8 with BOM
- ❌ **剪貼簿管線**：`clip` 或第三方剪貼簿管理員可能注入 BOM

### ✅ 必須改用的「保證不寫 BOM」路徑

按優先順序：

1. **首選**：Agent 內建的檔案寫入工具（純 UTF-8 無 BOM，不經由 Shell 中介）
2. **次選（PowerShell 7+）**：`Set-Content -Encoding utf8NoBOM`
3. **跨版本保險方案（PS 5.1 / PS 7 / .NET Framework / .NET Core 全版本通用）**：
   ```powershell
   [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
   ```
   透過明確傳入 `UTF8Encoding($false)`，保證無 BOM。
4. **Node 腳本路徑**：
   ```bash
   node -e "require('fs').writeFileSync(path, json, {encoding:'utf8'})"
   ```
   Node 的 UTF-8 預設不含 BOM。

### 寫入後驗證（強制）

每寫完一份設定檔，必須再次讀取前 3 個位元組驗證；若為 `EF BB BF`，必須就地剝除並重寫，直到通過為止。這是 Windows 上唯一可靠的最後一道防線：

```powershell
$b = [System.IO.File]::ReadAllBytes($path)
if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) {
  [System.IO.File]::WriteAllBytes($path, $b[3..($b.Length-1)])
}
```

若步驟 1 預檢階段曾標記出已被 BOM 污染的設定檔，本步驟必須一併執行上述剝除流程，將既有檔案修正為無 BOM 版本。

---

## 2. Windows 寫檔強制 `{ encoding: 'utf8' }`

部署 Hook 主腳本（`statusline-quota.mjs`）與背景快取程式（`fetch-local-quota.mjs`）時，所有 `fs.writeFileSync` 或 `fs.writeFile` 呼叫**必須且強制指定 `{ encoding: 'utf8' }`**。

若未指定，Windows 預設會以 UTF-16 編碼寫入檔案，導致 agy CLI 啟動時發生解析錯誤並直接崩潰。

```js
// ✅ 正確
fs.writeFileSync(targetPath, content, { encoding: 'utf8' });

// ❌ 錯誤（Windows 上會寫成 UTF-16）
fs.writeFileSync(targetPath, content);
```

---

## 3. Windows BOM 自動清理（由配置腳本自動執行）

`configure-statusline.mjs` 在讀寫設定檔時，會自動偵測並剝除檔案開頭的 `EF BB BF`（UTF-8 BOM），無須由 AI 代理手動呼叫 `read_file` 讀取設定檔。

---

## 4. 記憶體查詢：Get-CimInstance 取代已棄用的 wmic

Microsoft 已於 Windows 11 預設棄用並移除 `wmic`。在查詢 CLI 行程記憶體用量（WorkingSetSize）時，使用 PowerShell `Get-CimInstance Win32_Process`，同時相容 Windows 10 與 11。

---

## 5. settings.json 中 Windows 路徑跳脫範本

### 為什麼 Windows 平台使用 `node` 裸命令且「絕對禁止包含雙引號 `"`」（架構評估）

在跨平台評估中，Windows 的 `statusLine.command` 存在幾個關鍵的系統底層限制：
1. **Go `exec.CommandContext(ctx, "cmd", "/c", command)` 與 `\"` 字面引號污染陷阱（最關鍵）**：
   在 Windows 版 `agy.exe` 中，底層是透過 Go 標準庫 `exec.CommandContext(ctx, "cmd", "/c", command)` 執行狀態列指令。Go 的 `syscall.EscapeArg` 在組裝 Windows `CreateProcessW` 命令列時，只要參數包含空白或雙引號，就會在外層包裹雙引號 `"..."`，並將**內部所有的雙引號 `"` 強制加上反斜線轉義為 `\"`**（即 `cmd /c "node \"C:\Users\...\statusline-quota.mjs\""`）。
   然而 `cmd.exe /c` 僅會剝除最外層的雙引號，**不會解開 `\"` 跳脫**，而是原封不動將 `\"C:\Users\...\statusline-quota.mjs\"` 傳給 `node.exe`。接著 `node.exe`（MSVC CRT 命令列解析器）會將 `\"`（奇數個反斜線加雙引號）解析為**字面上的雙引號字元 `"`**（而非字串邊界！），導致 `process.argv[1]` 變成開頭帶有雙引號字元的相對路徑 `"\"C:\\Users\\..."`，進而與當前工作目錄（CWD）拼接並直接崩潰報錯：
   `Error: Cannot find module 'D:\Project\...\"C:\Users\...\statusline-quota.mjs"'`（累積 30 次後狀態列即被 CLI 自動停用 `enabled: false`）。
2. **路徑空格與 `cmd.exe` 雙引號剝除陷阱**：Windows 官方預設安裝於 `C:\Program Files\nodejs\node.exe`，內含空白字元，絕對不可寫入 `process.execPath` 絕對路徑。
3. **Windows 登錄檔 `PATH` 天然繼承**：不同於 macOS / Linux 下 NVM 為僅存在於互動式 Shell 的函式，Windows 下無論是官方 MSI、`nvm-windows`、`fnm` 或 `scoop`，皆會將 `node.exe` 寫入 Windows 系統或使用者環境變數（Windows 登錄檔 `PATH`）。所有父行程衍生的子行程（`cmd.exe`、`agy.exe`）皆會繼承完整 `PATH`。

因此，Windows 平台上的 `statusLine.command` **絕對禁止包含任何雙引號 `"`**，並依據腳本路徑是否含空格採雙軌無引號策略：
- **路徑不含空格時（多數情況）**：直接使用無雙引號的裸命令 `node <腳本絕對路徑>`。
- **路徑包含空格時（例如 `C:\Users\John Doe\...`）**：將腳本絕對路徑轉換為無空格、無引號的 `file:///` URL（空格編碼為 `%20`、反斜線轉為 `/`），並使用 `node --import file:///C:/Users/John%20Doe/.gemini/antigravity-cli/hooks/statusline-quota.mjs -e 0` 載入執行。此格式完全不含雙引號、不含單引號、亦不含未編碼空白，在 `cmd.exe /c` 下可 100% 零錯誤執行。

`statusLine` 物件的 `command` 欄位在 Windows 平台範本（無空格路徑）：

```json
"statusLine": {
  "enabled": true,
  "type": "command",
  "command": "node <真實的使用者家目錄絕對路徑>\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs"
}
```

若使用者家目錄包含空格（例如 `C:\Users\John Doe`），則為：

```json
"statusLine": {
  "enabled": true,
  "type": "command",
  "command": "node --import file:///C:/Users/John%20Doe/.gemini/antigravity-cli/hooks/statusline-quota.mjs -e 0"
}
```

> ⚠️ **絕對禁止照抄** `<真實的使用者家目錄絕對路徑>` 此佔位符。`configure-statusline.mjs` 會動態解析當前系統環境中的真實絕對路徑（例如 `C:\Users\andy`）替換之。

---

## 6. 舊版 sh.exe 相容橋接器廢棄說明（Issue #8）

### 歷史背景與廢棄原因

早期版（`< v1.3.5`）的 agy CLI 狀態列執行器在部分 Windows 環境下曾依賴 `sh -c` 執行指令。為避免以 `powershell.exe` 替代 `sh.exe` 導致每次更新閃爍黑色終端機視窗，過去 `configure-statusline.mjs` 會透過 `csc.exe /target:winexe` 在本地編譯一個無簽章、靜默轉發 `cmd.exe /c` 的 `sh.exe`（`4,608` 位元組）至 `%LOCALAPPDATA%\agy\bin\sh.exe`。

然而，此類本機動態編譯且無數位簽章的隱藏執行檔易觸發企業防毒軟體（如 Symantec 自動防護掃描 `Heur.AdvML.B`）誤判為惡意軟體並隔離，進而中斷後續執行。自 `agy.exe (v1.3.5+)` 起，Windows 底層已全面改由 Go `exec.CommandContext(ctx, "cmd", "/c", command)` 原生執行狀態列指令，不再需要 `sh.exe` 橋接器。

### 現行處置機制

1. **停止編譯 `sh.exe`**：`configure-statusline.mjs` 已移除 `csc.exe` 與 `sh_hidden.cs` 本地編譯流程，設定階段不再衍生外部編譯器或 PowerShell 子行程。
2. **自動清理舊版微型 `sh.exe` 殘留**：於 Windows 執行設定時，`cleanupLegacyWindowsShBridge()` 會檢查 `%LOCALAPPDATA%\agy\bin\sh.exe`；僅當該檔存在、非符號連結（Symbolic Link）且檔案大小 `<= 16,384` 位元組（對應舊版編譯的 `4,608` 位元組橋接器，排除大於 `1.5 MB` 的真實 Git / MSYS2 `sh.exe`）時予以安全移除。
3. **舊版 CLI 升級建議**：若極早期環境仍使用 `< v1.3.5` 的 `agy` 並出現 `sh` 缺失錯誤，應升級 `agy` CLI 至 `v1.3.5+`（目前為 `1.5.10+`），切勿手動複製 `powershell.exe` 或編譯未簽署 `sh.exe`。

---

## 7. 子行程（Child Process）執行：強制 windowsHide: true

在 Node.js 中使用 `child_process.spawn` 或 `child_process.execSync` 呼叫外部指令（如 `git`、`Get-CimInstance`）時，作業系統預設會瞬間彈出並關閉黑色終端機視窗。在高頻率背景輪詢場景下會造成毀滅性的視覺干擾（持續閃爍）。

**強制規範**：所有 `spawn` 與 `execSync` 呼叫必須攜帶 `{ windowsHide: true }`：

```js
execSync(cmd, { windowsHide: true, encoding: 'utf8' });
spawn(cmd, args, { windowsHide: true });
```
