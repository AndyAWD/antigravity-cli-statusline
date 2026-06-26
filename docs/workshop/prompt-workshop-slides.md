# GDG 2026 / 06 月特別場 — Google IO「使用 Antigravity 系列」

## 使用 Antigravity CLI 打造自己的 Status Line

---

## 講者介紹

<div style="display:flex; align-items:center; justify-content:center; gap:3.5rem; margin-top:1.2rem;">
  <div style="flex:0 0 352px; width:352px; height:352px; box-sizing:border-box;
              padding:6px; border-radius:50%;
              background: conic-gradient(from 135deg, #4285f4, #ea4335, #f9ab00, #34a853, #4285f4);
              box-shadow: 0 18px 40px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.10);">
    <div style="width:100%; height:100%; border-radius:50%; overflow:hidden;
                border:5px solid #f0f0f0; box-sizing:border-box; background:#fff;">
      <img src="DevFest2024.jpg" alt="戴維廷（Andy）"
           style="display:block; width:100%; height:100%; object-fit:cover;
                  transform:scale(1.02) translateY(-6%); transform-origin:center top;
                  border:none !important; border-radius:0 !important;
                  box-shadow:none !important; max-height:none !important;
                  max-width:none !important; background:transparent !important;">
    </div>
  </div>
  <div style="font-size:1.15em;">
    <ul>
      <li>戴維廷 / Andy</li>
      <li>GDG Kaohsiung 組織者</li>
      <li>Android 工程師</li>
      <li>目前還是個人類</li>
    </ul>
  </div>
</div>

---

## 今日議程

1. **環境準備** 安裝 Antigravity CLI 和 Node.JS
2. **終端機移動路徑** Windows 和 macOS 資料夾移動位置
3. **基本指令** 瞭解 Antigravity CLI 的內建指令操作
4. **深入實作** 做出自己的底部狀態列 Status Line

---

環境準備：安裝 `Antigravity CLI` 和 `Node.JS`

---

## 如何安裝 Antigravity CLI 

**官方下載頁**：<https://antigravity.google/download#antigravity-cli>

**macOS / Linux**

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```
**Windows PowerShell**

```powershell
irm https://antigravity.google/cli/install.ps1 | iex
```
**Windows CMD**

```cmd
curl -fsSL https://antigravity.google/cli/install.cmd -o install.cmd && install.cmd && del install.cmd
```

---

## 如何安裝 Node.js（底部狀態列會用到）

1. 前往網址：`https://nodejs.org/zh-tw/download`
2. Windows 用戶：直接點擊下載 `.msi`，並執行安裝程序即可。
3. macOS 用戶：直接點擊下載 `.pkg`，並執行安裝程序即可。

**裝完驗證，有出現版本號**

```bash
andyawd@AndydeMacBook-Pro workshop % agy --version
1.0.12
andyawd@AndydeMacBook-Pro workshop % node -v
v24.14.0
```

---

終端機移動路徑：`Windows` 和 `macOS` 資料夾移動位置

---

## 為什麼要先移動到專案資料夾？

- **控制權管理** AI 代理會自動幫我們操作檔案，所以不能給他太大的資料夾控制權。
    - 假如給他整個 C 槽的控制權，然後 AI 執行刪除系統檔，那就慘了！
- **原則** 先移動到專案資料夾，再啟動 Agy CLI。
- **啟動方式**
    - ❌ 危險
      ```
      C:\Users\你的名字>agy
      ```
    - ✅ 安全  
      ```
      D:\你的專案資料夾>agy
      ```

---

## 簡單易懂的終端機移動路徑（Windows / macOS）

- **Windows 用戶**
    1. 用檔案總管開啟你的專案資料夾
    2. 點擊上方的路徑列，刪除原本的路徑
    3. 輸入 `cmd`，按下 Enter
    4. 命令提示字元就會自動開啟在這個路徑！
- **macOS 用戶**
    1. 開啟終端機
    2. 輸入 `cd `（cd 後面要空一格）
    3. 打開 Finder，把專案資料夾拖曳到終端機視窗
    4. 終端機會自動帶入路徑，按下 Enter 即可！

---

基本指令：瞭解 `Antigravity CLI` 的內建指令操作

---

## Antigravity CLI 基本指令

| 編號 | 指令                   | 用途           |
|----|----------------------|--------------|
| 1  | `/grill-me`          | 互動式訪談模式      |
| 2  | `/fast` ` /planning` | 快速 / 思考模式切換  |
| 3  | `/teamwork-preview`  | 子代理團隊模式      |
| 4  | `/artifact`          | 查看計畫文件       |
| 5  | `/resume`            | 載入之前的對話      |
| 6  | `/statusline`        | 客製底部狀態列開關    |
| 7  | `/clear`             | 清除目前對話串      |
| 8  | `/btw`               | 長對話中插入對話     |
| 9  | `/antigravity-guide` | Agy CLI 內部知識 |
| 10 | `/model`             | 切換使用模型       |
| 11 | `/usage`             | 使用模型額度       |
| 12 | `/exit (quit)`             | 離開 Agy CLI   |

---

深入實作：做出自己的底部狀態列 `Status Line`

---

## 你會碰到的 3 個檔案 + 1 個指令

| 角色 | 路徑 | 用途 |
|---|---|---|
| 你的腳本 | `~/.gemini/antigravity-cli/hooks/my-status.mjs` | AI 幫你寫，負責輸出狀態列內容 |
| CLI 設定 | `~/.gemini/antigravity-cli/settings.json` | 告訴 CLI 要執行哪個腳本 |
| 信任白名單 | `~/.gemini/trusted_hooks.json` | 同意 CLI 執行這個腳本 |
| 啟用指令 | `/statusline` | 在 Agy CLI 內輸入即可開關 |

**流程：** 寫腳本 → 設定 `settings.json` → 加白名單 → 在 CLI 內 `/statusline` 啟用

---

<!-- .slide: class="scroll-prompt" -->

## Step 1／3：請 agy 寫「抓額度」腳本

直接在 Agy CLI 的對話框輸入下面這段，它會把檔案寫到指定路徑，不必複製貼上到別處。

```text
請在 ~/.gemini/antigravity-cli/hooks/ 建立 my-status.mjs
（Windows：%USERPROFILE%\.gemini\antigravity-cli\hooks\my-status.mjs，若資料夾不存在請一併建立）

寫一支 Antigravity CLI (agy) 的 statusline 腳本，顯示「API 可用額度（百分比）」：

1. 找 agy 的 PID 與 CSRF Token
   - Mac/Linux：ps auxww；Windows：PowerShell Get-CimInstance Win32_Process（別用 wmic）
   - 從 CommandLine 解析 --csrf_token=<token>
2. 找監聽的 Port
   - Mac/Linux：lsof -nP -a -p <PID> -iTCP -sTCP:LISTEN
   - Windows：netstat -ano 篩 LISTENING + PID
3. POST https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus
   - Header：X-Codeium-Csrf-Token、Connect-Protocol-Version: 1，rejectUnauthorized: false
   - Payload：{"metadata":{"ideName":"antigravity"}}
4. 解析 userStatus.cascadeModelConfigData.clientModelConfigs 陣列
   找帶 quotaInfo 的物件，remainingFraction * 100，console.log「API: 剩餘 80%」

跨平台必守規則：
- 用 process.platform === 'win32' 判斷平台，分別呼叫對應指令
- 所有 child_process（spawn / exec / execFile）必須加 { windowsHide: true }，
  否則 Windows 每次執行都會閃一個黑色 CMD 視窗
- PowerShell 用 spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })
- 子行程 stdout 明確 { encoding: 'utf8' }，避免 Windows cp950/cp1252 吃掉中文
- HTTPS timeout 設 2000ms；任何步驟失敗都 console.log 印「API: --」不要拋例外
- 只用 Node 內建模組（https / child_process / os / path），不要 npm install
- 檔案請存 UTF-8 無 BOM；用 .mjs + import 語法
- 路徑用 path.join(os.homedir(), '.gemini', ...) 動態組，
  不要寫死 ~ 或 $HOME 或 %USERPROFILE%（背景 hook 不經 shell，這些變數不會展開）
```

> ✅ agy 寫完後，在另一個終端機跑：`node ~/.gemini/antigravity-cli/hooks/my-status.mjs`
> 看到「API: 剩餘 X%」就過關。

---

<!-- .slide: class="compact-code" -->

## 設定檔在哪？告訴 CLI 執行腳本

**打開（或建立）** `~/.gemini/antigravity-cli/settings.json`
（Windows：`%USERPROFILE%\.gemini\antigravity-cli\settings.json`）

**在最外層 `{}` 內加：**

```json
{
  "statusLine": {
    "enabled": true,
    "type": "command",
    "command": "node /Users/你的帳號/.gemini/antigravity-cli/hooks/my-status.mjs"
  }
}
```

**Windows 範例**（反斜線必須雙倍）：

```json
{
  "statusLine": {
    "enabled": true,
    "type": "command",
    "command": "node C:\\Users\\你的帳號\\.gemini\\antigravity-cli\\hooks\\my-status.mjs"
  }
}
```

⚠️ **兩個關鍵警告**

- `command` **必須用絕對路徑**，不能用 `~` / `$HOME` / `%USERPROFILE%`（Hook 在背景跑不經 shell，環境變數不會展開）
- Windows 用戶請用 **VS Code** 或記事本（另存新檔→編碼選「UTF-8」不勾 BOM）編輯，**不要用 PowerShell 的 `Out-File` / `Set-Content` / `>` 重導向**——預設會寫成 UTF-16 LE 或加上 BOM，CLI 解析會爆 `invalid character 'ï'`

---

## 註冊安全白名單

CLI 預設拒絕執行未列管的腳本。**打開（或建立）** `~/.gemini/trusted_hooks.json`
（Windows：`%USERPROFILE%\.gemini\trusted_hooks.json`）

```json
{
  "*": [
    "statusLine:node /Users/你的帳號/.gemini/antigravity-cli/hooks/my-status.mjs"
  ]
}
```

**Windows 範例**：

```json
{
  "*": [
    "statusLine:node C:\\Users\\你的帳號\\.gemini\\antigravity-cli\\hooks\\my-status.mjs"
  ]
}
```

⚠️ **前綴 `statusLine:` 不能漏**，後面字串要與 settings.json 的 `command` **逐字相符**，否則 CLI 直接拒絕。

---

## 啟用！看到你的第一個狀態列

**回到 Antigravity CLI 介面，輸入：**

```
/statusline
```

**最下面那一行應該出現：**

```
API: 剩餘 80%
```

🎉 **看到了嗎？恭喜，你已經做出自己的狀態列！**

> 看不到？跳到後面「卡關了？」那頁。

---

## Step 2／3：請 AI 加上「重置倒數」

**接續剛剛的 AI 對話，貼這段：**

```text
請在剛剛的腳本上，再加上一個資訊：
- 額度重置的倒數時間（距離現在還剩幾小時幾分）

實作要點：
- resetTime 欄位在 quotaInfo 物件裡，是 ISO 8601 時間字串
- 用 new Date(resetTime).getTime() - Date.now() 算毫秒差
- 換算成「2h 30m」或「45m」格式
- 已過期顯示「現在」
- 最終輸出：「API: 剩餘 80%  ⏰ 重置: 2h 30m」
```

**存檔覆蓋原本的 `my-status.mjs`**，回到 Antigravity CLI 按 Enter，狀態列就會自動更新。

---

## Step 3／3：請 AI 套用色彩美化

```text
請在剛剛的腳本上加 24-bit ANSI 真彩色：
- 額度 ≥ 75%：藍 #57caff
- 額度 ≥ 50%：綠 #5cdb6d
- 額度 ≥ 25%：黃 #ffd427
- 額度 <  25%：紅 #ff7daf

ANSI 寫法：\x1b[38;2;R;G;Bm <文字> \x1b[0m

⏰ emoji 本身用 BOLD（\x1b[1m），倒數數字（例如「2h 30m」）用白色（\x1b[97m）。
所有色彩串末尾記得加 \x1b[0m 重置，避免污染後續輸出。
```

**存檔覆蓋**，現在你的狀態列會根據額度動態變色。

---

## 卡關了？四條跨平台排錯

1. **狀態列沒出現** → 檢查 `trusted_hooks.json` 是否漏 `statusLine:` 前綴；看 `~/.gemini/hook_error.log`（Windows：`%USERPROFILE%\.gemini\hook_error.log`）
2. **出現 `undefined` 或 `API: --`** → 確認 `settings.json` `command` 是絕對路徑 + 腳本存檔為 UTF-8 無 BOM + 確認 `agy` 行程還在跑（沒關就抓不到 PID）
3. **Windows 路徑寫法** → 反斜線**必須雙倍** `C:\\Users\\xxx\\.gemini\\...`，或改用正斜線 `C:/Users/xxx/.gemini/...`；單一反斜線會被 JSON 當跳脫字元吃掉
4. **Windows 出現 `invalid character 'ï' looking for beginning of value`** → JSON 檔頭被偷塞 BOM。用 VS Code 開啟，右下角點「UTF-8 with BOM」改成「UTF-8」重新存檔

**Windows 黑色 CMD 視窗一直閃** → AI 寫的腳本忘了在 `spawn` 加 `windowsHide: true`，回 Step 1 把那條規則補強再請 AI 重寫。

---

## 進階：想要 24 個指標？

**本工作坊開源專案**

- GitHub：<https://github.com/AndyAWD/antigravity-cli-statusline>
- 24 個指標 / 3 語系 / 跨平台 / 動態折行 / 真彩色配色

**一鍵安裝設定精靈**

```bash
agy plugin install antigravity-cli-statusline
agy
# 進入 Agy CLI 後輸入：
/antigravity-cli-statusline
```

精靈會帶你勾選想要的指標、選擇語系、自動寫好三層設定檔。

---

## Thank You

**感謝**

- GDG Kaohsiung 與 Google Developer 社群提供舞台
- 每一位願意把終端機底部留給狀態列的你

**期待下一次 GDG 活動再見**
