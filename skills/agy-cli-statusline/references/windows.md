# Windows 平台特定規範（Reference）

> [!IMPORTANT]
> 本檔案內含必須**逐字（verbatim）使用**的指令片段、JSON 結構與路徑範本。
> AI 代理載入本檔案時必須遵守：
> 1. **禁止透過 Explore / 子代理（subagent）摘要本檔案** — 主代理必須親自以 Read 工具讀取
> 2. **禁止改寫、簡化、重新格式化任何程式碼區塊內容**
> 3. **禁止將指令翻譯成「等效」做法**（例如不可將 PowerShell `utf8NoBOM` 改寫為 `Out-File -Encoding UTF8`）
> 4. 若內容與你熟悉的其他 CLI / API 格式不同，**一律以本檔案為準**（此為 agy CLI 專用規範）

---

## 目錄

- [1. UTF-8 BOM 編碼鐵則（寫設定檔絕對禁止帶 BOM）](#1-utf-8-bom-編碼鐵則寫設定檔絕對禁止帶-bom)
- [2. Windows 寫檔強制 `{ encoding: 'utf8' }`](#2-windows-寫檔強制-encoding-utf8)
- [3. Windows BOM 預檢（讀檔時必執行）](#3-windows-bom-預檢讀檔時必執行)
- [4. 行程查詢：Get-CimInstance 取代 wmic](#4-行程查詢get-ciminstance-取代-wmic)
- [5. settings.json 中 Windows 路徑跳脫範本](#5-settingsjson-中-windows-路徑跳脫範本)
- [6. sh.exe 缺失修復：編譯靜默無窗體橋接器](#6-shexe-缺失修復編譯靜默無窗體橋接器)
- [7. 子行程（Child Process）執行：強制 windowsHide: true](#7-子行程child-process執行強制-windowshide-true)

---

## 1. UTF-8 BOM 編碼鐵則（寫設定檔絕對禁止帶 BOM）

Windows 上有多個「預設帶 UTF-8 BOM（`EF BB BF`）」的寫檔路徑，無論代理使用 PowerShell 還是 cmd 觸發都可能中招。agy CLI（Go）的 JSON 解析器遇到 BOM 會直接崩潰報 `invalid character 'ï' looking for beginning of value`，且錯誤訊息完全看不出是編碼問題。

### ❌ 絕對禁止的寫檔路徑

AI 代理寫入任何 `.gemini` 之下的 JSON 設定檔（`settings.json`、`trusted_hooks.json` 等）時，**絕對禁止**走下列任一路徑：

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

## 3. Windows BOM 預檢（讀檔時必執行）

讀取每一份 `settings.json` 與 `trusted_hooks.json` 時，必須同時檢查檔案的前 3 個位元組是否為 `EF BB BF`（UTF-8 BOM）。若是，請將該檔案路徑記錄為「需於後續寫入步驟自動修復」的目標。

PowerShell 檢測片段：

```powershell
$b = [System.IO.File]::ReadAllBytes($path)
$hasBOM = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
```

---

## 4. 行程查詢：Get-CimInstance 取代 wmic

Microsoft 已於 Windows 11 預設棄用並移除 `wmic`。若依賴 `wmic` 將導致行程查詢直接失敗，狀態列無聲無息地回傳「未知」與「無」。

**正確做法**：使用 PowerShell `Get-CimInstance Win32_Process`，同時相容 Windows 10 與 11。

```powershell
Get-CimInstance Win32_Process -Filter "Name like '%agy%'"
```

此命令能穩定獲取 `ProcessID` 與 `CommandLine`（用以解析 `--csrf_token` 參數），是高相容性、零 dependency 的跨 Windows 世代黃金方案。

---

## 5. settings.json 中 Windows 路徑跳脫範本

### 為什麼 Windows 平台使用 `node` 裸命令（架構評估）

在跨平台評估中，若直接將 Node.js 完整路徑（例如 `process.execPath`）寫入 Windows 的 `statusLine.command`，會引發數個極其嚴重的 Windows 系統陷阱：
1. **路徑空格與 cmd.exe 雙引號剝除陷阱**：Windows 官方預設安裝於 `C:\Program Files\nodejs\node.exe`，內含空白字元。若指令寫為 `"C:\Program Files\nodejs\node.exe" "C:\Users\...\statusline-quota.mjs"`，當 agy CLI 底層透過 `sh -c` 轉發至 `cmd.exe /c` 時，依據 Windows cmd 解析規則，以雙引號開頭且包含多組雙引號的指令會被**自動剝除最外層的第一個與最後一個雙引號**，導致命令變成 `C:\Program Files\nodejs\node.exe" "C:\Users\...`，系統會尋找名為 `C:\Program` 的指令並直接崩潰報錯：`'C:\Program' is not recognized as an internal or external command`。
2. **Git Bash sh.exe 反斜線跳脫陷阱**：若 Windows 機器裝有 Git for Windows 且 PATH 中包含其 `sh.exe`，POSIX Shell 會將反斜線 `\` 視為跳脫符號，路徑中的 `\n`（例如 `\nodejs` 或 `\new_folder`）會被轉換為換行字元（Newline），導致找不到檔案。
3. **Windows 登錄檔 PATH 天然繼承**：不同於 macOS/Linux 下 NVM 為僅存在於互動式 Shell 的函式，Windows 下無論是官方 MSI、`nvm-windows`、`fnm` 或 `scoop`，皆會將 `node.exe` 寫入 Windows 系統/使用者環境變數（Windows 登錄檔 `PATH`）。所有父行程衍生的子行程（`cmd.exe`、`agy.exe`）皆會繼承完整 PATH。

因此 Windows 平台上**使用裸命令 `node` 搭配雙引號包裹腳本絕對路徑為最健壯的黃金方案**。腳本絕對路徑一律以雙引號包裹：
- **路徑空格防護**：使用者家目錄常包含空白（例如 `C:\Users\John Doe`），雙引號可確保路徑參數不被截斷。
- **Git Bash 反斜線防護**：若 Windows 機器裝有 Git for Windows（PATH 中含 `sh.exe`），雙引號可防止 POSIX Shell 誤將反斜線 `\` 當作跳脫字元剝除損毀。
- **免於引號剝除**：因為指令開頭為 `node `（第一個字元非雙引號），`cmd.exe /c` 絕對不會觸發最外層雙引號剝除規則，內部雙引號將完整保留傳入 `node`！

`statusLine` 物件的 `command` 欄位在 Windows 平台必須使用雙反斜線跳脫：

```json
"statusLine": {
  "enabled": true,
  "type": "command",
  "command": "node \"<真實的使用者家目錄絕對路徑>\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs\""
}
```

`trusted_hooks.json` 中對應的 Windows 信任字串（必須包含精確命令，並同時追加單/雙反斜線、forward slash、引號與 `%USERPROFILE%` 變體以確保相容性）：

```text
"statusLine:node <真實的使用者家目錄絕對路徑>\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs"
"statusLine:node \"<真實的使用者家目錄絕對路徑>\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs\""
"statusLine:node <真實的使用者家目錄絕對路徑>/.gemini/antigravity-cli/hooks/statusline-quota.mjs"
"statusLine:node \"<真實的使用者家目錄絕對路徑>/.gemini/antigravity-cli/hooks/statusline-quota.mjs\""
"statusLine:node %USERPROFILE%\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs"
"statusLine:node \"%USERPROFILE%\\.gemini\\antigravity-cli\\hooks\\statusline-quota.mjs\""
```

> ⚠️ **絕對禁止照抄** `<真實的使用者家目錄絕對路徑>` 此佔位符。AI 代理必須動態解析當前系統環境中的真實絕對路徑（例如 `C:\Users\andy`）替換之。

---

## 6. sh.exe 缺失修復：編譯靜默無窗體橋接器

### 背景

agy CLI 的 `statusline_runner.go` 底層強制依賴 `sh -c` 執行指令。Windows 預設沒有 `sh.exe`，若直接複製 `powershell.exe` 當作替身，每次狀態列背景更新時都會閃爍一個黑色終端機視窗。

### 完美越獄方案（無彈窗 + 引號防禦）

利用 Windows 內建的 `.NET Compiler (csc.exe)` 編譯一個無窗體（`/target:winexe`）的 `sh.exe` 橋接器，徹底消除彈窗。原始碼中特別增加針對雙引號開頭指令的外層引號防禦包裹，防止 `cmd.exe /c` 誤剝除內部雙引號。

### 執行步驟

1. **取得 CLI 執行目錄**：
   ```bash
   cmd.exe /c where agy
   ```
   提取所在資料夾（例如 `C:\Users\...\AppData\Local\agy\bin`）。

2. **檢查並清理舊版錯置的 sh.exe**：
   ```bash
   node -e "console.log(require('path').dirname(process.execPath))"
   ```
   若該目錄下存在之前錯誤放置的 `sh.exe`，**務必**提示使用者手動將其刪除（提供精確的絕對路徑，例如 `C:\Program Files\nodejs\sh.exe`），以免嚴重污染系統環境。

3. **讀取 sh_hidden.cs 原始碼**：
   - 優先讀取當前工作區根目錄下 `skills/agy-cli-statusline/scripts/sh_hidden.cs`
   - 若不存在或在其他工作區，退回從本外掛根目錄 `skills/agy-cli-statusline/scripts/sh_hidden.cs` 讀取
   - 將其複製或寫入到暫存資料夾

4. **動態尋找 csc.exe 並編譯**：
   嚴禁寫死路徑與版本號。透過 PowerShell 取得最新版編譯器：
   ```powershell
   (Get-ChildItem -Path 'C:\Windows\Microsoft.NET\Framework64\v*\csc.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
   ```
   編譯至真正的 CLI 目錄：
   ```bash
   "<動態取得的 csc.exe 絕對路徑>" /target:winexe /out:"<CLI 執行目錄>\sh.exe" "暫存目錄\sh_hidden.cs"
   ```

完成後，當 CLI 發出 `sh -c "node ..."` 時，會被這個靜默程式完美攔截，在完全沒有黑框閃爍的情況下執行背景更新。

---

## 7. 子行程（Child Process）執行：強制 windowsHide: true

在 Node.js 中使用 `child_process.spawn` 或 `child_process.execSync` 呼叫外部指令（如 `git`、`Get-CimInstance`）時，作業系統預設會瞬間彈出並關閉黑色終端機視窗。在高頻率背景輪詢場景下會造成毀滅性的視覺干擾（持續閃爍）。

**強制規範**：所有 `spawn` 與 `execSync` 呼叫必須攜帶 `{ windowsHide: true }`：

```js
execSync(cmd, { windowsHide: true, encoding: 'utf8' });
spawn(cmd, args, { windowsHide: true });
```
