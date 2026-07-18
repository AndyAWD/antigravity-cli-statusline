# 使用 Antigravity CLI 打造自己的 Status Line

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
      <li><a href="https://www.facebook.com/groups/GDGKaohsiung" target="_blank" rel="noopener">https://www.facebook.com/groups/GDGKaohsiung</a></li>
    </ul>
  </div>
</div>

---

## 今日議程

1. **環境準備** 安裝 Antigravity CLI 和 Node.JS
2. **移動路徑** Windows 和 macOS 資料夾移動位置
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
2. Windows 使用者（User）：直接點擊下載 `.msi`，並執行安裝程序即可。
3. macOS 使用者（User）：直接點擊下載 `.pkg`，並執行安裝程序即可。

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

- **Windows 使用者（User）**
    1. 用檔案總管開啟你的專案資料夾
    2. 點擊上方的路徑列，刪除原本的路徑
    3. 輸入 `cmd`，按下 Enter
    4. 命令提示字元就會自動開啟在這個路徑！
- **macOS 使用者（User）**
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
| 2  | `/plan` (`Shift+Tab`)| 思考模式切換       |
| 3  | `/teamwork-preview`  | 子代理團隊模式      |
| 4  | `/goal`              | 長時間徹底完成任務    |
| 5  | `/schedule`          | 排程或定時任務      |
| 6  | `/learn`             | 讓 AI 記住修正行為  |
| 7  | `/artifact`          | 查看計畫文件       |
| 8  | `/resume`            | 載入之前的對話      |
| 9  | `/statusline`        | 客製底部狀態列開關    |
| 10 | `/clear`             | 清除目前對話串      |
| 11 | `/btw`               | 長對話中插入對話     |
| 12 | `/help`              | 顯示所有指令與快捷鍵  |
| 13 | `/antigravity-guide` | Agy CLI 內部知識 |
| 14 | `/model`             | 切換使用模型       |
| 15 | `/usage`             | 使用模型額度       |
| 16 | `/exit` (`/quit`)    | 離開 Agy CLI   |

💡 支援在同一行串接多個斜線指令，例如 `/plan /grill-me <提示詞>`，會依照輸入順序依序啟用每個指令。

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

## Step 1／3：請 Agy CLI 寫「抓額度」腳本

直接在 Agy CLI 的對話方塊（Dialog Box）輸入下面這段，它會把檔案寫到指定路徑，不必複製貼上到別處。

```text
請在 ~/.gemini/antigravity-cli/hooks/ 建立 my-status.mjs
（Windows：%USERPROFILE%\.gemini\antigravity-cli\hooks\my-status.mjs，若資料夾不存在請一併建立）

寫一支 Antigravity CLI (agy) 的 statusline 腳本，顯示「API 可用額度（百分比）」：

1. 找 agy 的 PID 與 CSRF Token
   - 使用 child_process 模組執行系統指令獲取行程列表。
   - Mac/Linux 執行：ps auxww
   - Windows 執行：powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name like '%agy%'\" | Select-Object ProcessId, CommandLine | ConvertTo-Json"
   - 解析 stdout（若為 JSON 字串）：注意 Get-CimInstance 回傳結果可能是單一 JSON 物件（只有一個行程匹配）或 JSON 陣列（多個行程匹配）。請在代碼中相容此兩種情況，遍歷並尋找 CommandLine 欄位中同時包含 "agy" 與 "--csrf_token=" 的項目，用正則表達式（Regular Expression）解析出其 PID（ProcessId）與 `--csrf_token` 的值。
   - Mac/Linux 的 stdout 可用正則直接搜尋含有 "agy" 且有 "--csrf_token=" 的行來取得對應的值。

2. 找監聽的 Port
   - 根據取得 the PID，查詢其監聽的 TCP Port。
   - Mac/Linux 執行：lsof -nP -a -p <PID> -iTCP -sTCP:LISTEN
     * 解析指引：從輸出中利用 Regex（如 `127\.0\.0\.1:(\d+)` 或 `localhost:(\d+)`）抓取本機監聽的 Port 數字。
   - Windows 執行：netstat -ano 篩選出 LISTENING 且最後一欄為該 PID 的列
     * 解析指引：尋找符合格式 `TCP 127.0.0.1:(\d+) ... LISTENING <PID>` 的列，從中以正則表達式解析出本機監聽的 Port 數字。

3. POST https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetUserStatus
   - 使用 Node.js 內建 https 模組發送 POST 請求。
   - 設定 rejectUnauthorized: false 以忽略自簽憑證錯誤。
   - 設定 Header：Content-Type: application/json、X-Codeium-Csrf-Token (設定為解析出的 CSRF Token)、Connect-Protocol-Version: 1
   - Payload 傳入 {"metadata":{"ideName":"antigravity"}}，將其轉為 JSON 字串以 req.write() 寫入並呼叫 req.end() 發送。
   - HTTPS 連線設定 timeout 為 2000ms。任何超時或連線失敗均捕獲異常，直接輸出 "API: --"，不拋出例外。

4. 解析 userStatus.cascadeModelConfigData.clientModelConfigs 陣列
   - 使用可選鏈（Optional Chaining `?.`）安全讀取 userStatus?.cascadeModelConfigData?.clientModelConfigs。若為空則輸出 "API: --" 並結束。
   - 從 clientModelConfigs 陣列中篩選出含有 quotaInfo 的物件。
   - 對於每個含有 quotaInfo 的物件，計算其可用百分比：
     a. 取得 remainingFraction 欄位。
     b. 核心邏輯：protobuf 在數值為 0 時會省略欄位。若 quotaInfo 含有 resetTime 但沒有 remainingFraction，請將 remainingFraction 視為 0。
     c. 核心邏輯：remainingFraction 可能大於 1（代表已是百分比，如 80），若小於或等於 1，才將其乘以 100。
     d. 使用 Math.round() 將百分比取整。
   - 找出所有模型中計算出百分比最小的那個（最吃緊的額度）。
   - console.log 輸出「API: 剩餘 X%」（例如「API: 剩餘 80%」）。若整個陣列都找不到 quotaInfo，則印出「API: --」。

跨平台必守規則：
- 用 process.platform === 'win32' 判斷平台，分別呼叫對應指令。
- 所有 child_process（spawn / exec / execFile）必須加 { windowsHide: true }，
  否則 Windows 每次執行都會閃一個黑色 CMD 視窗。
- PowerShell 用 spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })。
- 子行程 stdout 明確 { encoding: 'utf8' }，避免 Windows cp950/cp1252 吃掉中文。
- HTTPS timeout 設 2000ms；任何步驟失敗都 console.log 印「API: --」不要拋例外。
- 寫完後先用 node 直接執行這支腳本，確認輸出正常（需 agy 行程正在跑）；
  有問題先修好再進下一步。
- 只用 Node 內建模組（https / child_process / os / path），不要 npm install。
- 檔案請存 UTF-8 無 BOM；用 .mjs + import 語法。
- 路徑用 path.join(os.homedir(), '.gemini', ...) 動態組，
  不要寫死 ~ 或 $HOME 或 %USERPROFILE%（背景 hook 不經 shell，這些變數不會展開）。
```


---

## 補充：GetUserStatus 拿到了什麼？

在剛剛提示詞的第三步，我們讓腳本打了一個本地端 API 請求（`POST GetUserStatus`）。
這其實是向 Agy CLI 的語言伺服器（Language Server）索取當前狀態。

**發送的請求內容（Payload）：**
```json
{
  "metadata": {
    "ideName": "antigravity"
  }
}
```

**取得的回傳資料格式（完整的 Response JSON 範例）：**
```json
{
  "userStatus": {
    "name": "戴維廷",
    "email": "developer@example.com",
    "planStatus": {
      "planInfo": {
        "teamsTier": "TEAMS_TIER_PRO",
        "planName": "Pro",
        "hasAutocompleteFastMode": true,
        "allowStickyPremiumModels": true,
        "allowPremiumCommandModels": true,
        "hasTabToJump": true,
        "maxNumPremiumChatMessages": "-1",
        "maxNumChatInputTokens": "16384",
        "maxCustomChatInstructionCharacters": "600",
        "maxNumPinnedContextItems": "-1",
        "maxLocalIndexSize": "-1",
        "monthlyPromptCredits": 50000,
        "monthlyFlowCredits": 150000,
        "monthlyFlexCreditPurchaseAmount": 25000,
        "canBuyMoreCredits": true,
        "cascadeWebSearchEnabled": true,
        "canCustomizeAppIcon": true,
        "cascadeCanAutoRunCommands": true,
        "canGenerateCommitMessages": true,
        "knowledgeBaseEnabled": true,
        "defaultTeamConfig": {
          "allowMcpServers": true,
          "allowAutoRunCommands": true,
          "allowBrowserExperimentalFeatures": true
        },
        "canAllowCascadeInBackground": true,
        "browserEnabled": true
      },
      "availablePromptCredits": 500,
      "availableFlowCredits": 100
    },
    "cascadeModelConfigData": {
      "clientModelConfigs": [
        {
          "label": "Claude Opus 4.6 (Thinking)",
          "modelOrAlias": {
            "model": "MODEL_PLACEHOLDER_M26"
          },
          "supportsImages": true,
          "isRecommended": true,
          "allowedTiers": [
            "TEAMS_TIER_PRO",
            "TEAMS_TIER_TEAMS",
            "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
            "TEAMS_TIER_ENTERPRISE_SAAS",
            "TEAMS_TIER_HYBRID",
            "TEAMS_TIER_PRO_ULTIMATE"
          ],
          "quotaInfo": {
            "remainingFraction": 1,
            "resetTime": "2026-06-03T19:53:31Z"
          },
          "supportedMimeTypes": {
            "image/heic": true,
            "image/heif": true,
            "image/jpeg": true,
            "image/png": true,
            "image/webp": true,
            "video/jpeg2000": true,
            "video/videoframe/jpeg2000": true
          }
        },
        {
          "label": "GPT-OSS 120B (Medium)",
          "modelOrAlias": {
            "model": "MODEL_OPENAI_GPT_OSS_120B_MEDIUM"
          },
          "isRecommended": true,
          "allowedTiers": [
            "TEAMS_TIER_PRO",
            "TEAMS_TIER_TEAMS",
            "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
            "TEAMS_TIER_ENTERPRISE_SAAS",
            "TEAMS_TIER_HYBRID",
            "TEAMS_TIER_PRO_ULTIMATE"
          ],
          "quotaInfo": {
            "remainingFraction": 1,
            "resetTime": "2026-06-03T19:53:31Z"
          }
        },
        {
          "label": "Gemini 3.5 Flash (Medium)",
          "modelOrAlias": {
            "model": "MODEL_PLACEHOLDER_M20"
          },
          "supportsImages": true,
          "isRecommended": true,
          "allowedTiers": [
            "TEAMS_TIER_PRO",
            "TEAMS_TIER_TEAMS",
            "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
            "TEAMS_TIER_ENTERPRISE_SAAS",
            "TEAMS_TIER_HYBRID",
            "TEAMS_TIER_PRO_ULTIMATE"
          ],
          "quotaInfo": {
            "remainingFraction": 1,
            "resetTime": "2026-06-03T19:23:24Z"
          },
          "tagTitle": "Fast",
          "tagDescription": "Limited time",
          "supportedMimeTypes": {
            "application/json": true,
            "application/pdf": true,
            "application/rtf": true,
            "application/x-ipynb+json": true,
            "application/x-javascript": true,
            "application/x-python-code": true,
            "application/x-typescript": true,
            "audio/webm;codecs=opus": true,
            "image/heic": true,
            "image/heif": true,
            "image/jpeg": true,
            "image/png": true,
            "image/webp": true,
            "text/css": true,
            "text/csv": true,
            "text/html": true,
            "text/javascript": true,
            "text/markdown": true,
            "text/plain": true,
            "text/rtf": true,
            "text/x-python": true,
            "text/x-python-script": true,
            "text/x-typescript": true,
            "text/xml": true,
            "video/audio/s16le": true,
            "video/audio/wav": true,
            "video/jpeg2000": true,
            "video/mp4": true,
            "video/text/timestamp": true,
            "video/videoframe/jpeg2000": true,
            "video/webm": true
          }
        },
        {
          "label": "Gemini 3.5 Flash (High)",
          "modelOrAlias": {
            "model": "MODEL_PLACEHOLDER_M132"
          },
          "supportsImages": true,
          "isRecommended": true,
          "allowedTiers": [
            "TEAMS_TIER_PRO",
            "TEAMS_TIER_TEAMS",
            "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
            "TEAMS_TIER_ENTERPRISE_SAAS",
            "TEAMS_TIER_HYBRID",
            "TEAMS_TIER_PRO_ULTIMATE"
          ],
          "quotaInfo": {
            "remainingFraction": 1,
            "resetTime": "2026-06-03T19:23:24Z"
          },
          "tagTitle": "Fast",
          "tagDescription": "Limited time",
          "supportedMimeTypes": {
            "application/json": true,
            "application/pdf": true,
            "application/rtf": true,
            "application/x-ipynb+json": true,
            "application/x-javascript": true,
            "application/x-python-code": true,
            "application/x-typescript": true,
            "audio/webm;codecs=opus": true,
            "image/heic": true,
            "image/heif": true,
            "image/jpeg": true,
            "image/png": true,
            "image/webp": true,
            "text/css": true,
            "text/csv": true,
            "text/html": true,
            "text/javascript": true,
            "text/markdown": true,
            "text/plain": true,
            "text/rtf": true,
            "text/x-python": true,
            "text/x-python-script": true,
            "text/x-typescript": true,
            "text/xml": true,
            "video/audio/s16le": true,
            "video/audio/wav": true,
            "video/jpeg2000": true,
            "video/mp4": true,
            "video/text/timestamp": true,
            "video/videoframe/jpeg2000": true,
            "video/webm": true
          }
        },
        {
          "label": "Gemini 3.5 Flash (Low)",
          "modelOrAlias": {
            "model": "MODEL_PLACEHOLDER_M187"
          },
          "supportsImages": true,
          "isRecommended": true,
          "allowedTiers": [
            "TEAMS_TIER_PRO",
            "TEAMS_TIER_TEAMS",
            "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
            "TEAMS_TIER_ENTERPRISE_SAAS",
            "TEAMS_TIER_HYBRID",
            "TEAMS_TIER_PRO_ULTIMATE"
          ],
          "quotaInfo": {
            "remainingFraction": 1,
            "resetTime": "2026-06-03T19:23:24Z"
          },
          "tagTitle": "Fast",
          "tagDescription": "Limited time",
          "supportedMimeTypes": {
            "application/json": true,
            "application/pdf": true,
            "application/rtf": true,
            "application/x-ipynb+json": true,
            "application/x-javascript": true,
            "application/x-python-code": true,
            "application/x-typescript": true,
            "audio/webm;codecs=opus": true,
            "image/heic": true,
            "image/heif": true,
            "image/jpeg": true,
            "image/png": true,
            "image/webp": true,
            "text/css": true,
            "text/csv": true,
            "text/html": true,
            "text/javascript": true,
            "text/markdown": true,
            "text/plain": true,
            "text/rtf": true,
            "text/x-python": true,
            "text/x-python-script": true,
            "text/x-typescript": true,
            "text/xml": true,
            "video/audio/s16le": true,
            "video/audio/wav": true,
            "video/jpeg2000": true,
            "video/mp4": true,
            "video/text/timestamp": true,
            "video/videoframe/jpeg2000": true,
            "video/webm": true
          }
        },
        {
          "label": "Gemini 3.1 Pro (Low)",
          "modelOrAlias": {
            "model": "MODEL_PLACEHOLDER_M36"
          },
          "supportsImages": true,
          "isRecommended": true,
          "allowedTiers": [
            "TEAMS_TIER_PRO",
            "TEAMS_TIER_TEAMS",
            "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
            "TEAMS_TIER_ENTERPRISE_SAAS",
            "TEAMS_TIER_HYBRID",
            "TEAMS_TIER_PRO_ULTIMATE"
          ],
          "quotaInfo": {
            "remainingFraction": 1,
            "resetTime": "2026-06-03T19:23:24Z"
          },
          "supportedMimeTypes": {
            "application/json": true,
            "application/pdf": true,
            "application/rtf": true,
            "application/x-ipynb+json": true,
            "application/x-javascript": true,
            "application/x-python-code": true,
            "application/x-typescript": true,
            "audio/webm;codecs=opus": true,
            "image/heic": true,
            "image/heif": true,
            "image/jpeg": true,
            "image/png": true,
            "image/webp": true,
            "text/css": true,
            "text/csv": true,
            "text/html": true,
            "text/javascript": true,
            "text/markdown": true,
            "text/plain": true,
            "text/rtf": true,
            "text/x-python": true,
            "text/x-python-script": true,
            "text/x-typescript": true,
            "text/xml": true,
            "video/audio/s16le": true,
            "video/audio/wav": true,
            "video/jpeg2000": true,
            "video/mp4": true,
            "video/text/timestamp": true,
            "video/videoframe/jpeg2000": true,
            "video/webm": true
          }
        },
        {
          "label": "Gemini 3.1 Pro (High)",
          "modelOrAlias": {
            "model": "MODEL_PLACEHOLDER_M16"
          },
          "supportsImages": true,
          "isRecommended": true,
          "allowedTiers": [
            "TEAMS_TIER_PRO",
            "TEAMS_TIER_TEAMS",
            "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
            "TEAMS_TIER_ENTERPRISE_SAAS",
            "TEAMS_TIER_HYBRID",
            "TEAMS_TIER_PRO_ULTIMATE"
          ],
          "quotaInfo": {
            "remainingFraction": 1,
            "resetTime": "2026-06-03T19:23:24Z"
          },
          "supportedMimeTypes": {
            "application/json": true,
            "application/pdf": true,
            "application/rtf": true,
            "application/x-ipynb+json": true,
            "application/x-javascript": true,
            "application/x-python-code": true,
            "application/x-typescript": true,
            "audio/webm;codecs=opus": true,
            "image/heic": true,
            "image/heif": true,
            "image/jpeg": true,
            "image/png": true,
            "image/webp": true,
            "text/css": true,
            "text/csv": true,
            "text/html": true,
            "text/javascript": true,
            "text/markdown": true,
            "text/plain": true,
            "text/rtf": true,
            "text/x-python": true,
            "text/x-python-script": true,
            "text/x-typescript": true,
            "text/xml": true,
            "video/audio/s16le": true,
            "video/audio/wav": true,
            "video/jpeg2000": true,
            "video/mp4": true,
            "video/text/timestamp": true,
            "video/videoframe/jpeg2000": true,
            "video/webm": true
          }
        },
        {
          "label": "Claude Sonnet 4.6 (Thinking)",
          "modelOrAlias": {
            "model": "MODEL_PLACEHOLDER_M35"
          },
          "supportsImages": true,
          "isRecommended": true,
          "allowedTiers": [
            "TEAMS_TIER_PRO",
            "TEAMS_TIER_TEAMS",
            "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
            "TEAMS_TIER_ENTERPRISE_SAAS",
            "TEAMS_TIER_HYBRID",
            "TEAMS_TIER_PRO_ULTIMATE"
          ],
          "quotaInfo": {
            "remainingFraction": 1,
            "resetTime": "2026-06-03T19:53:31Z"
          },
          "supportedMimeTypes": {
            "image/heic": true,
            "image/heif": true,
            "image/jpeg": true,
            "image/png": true,
            "image/webp": true,
            "video/jpeg2000": true,
            "video/videoframe/jpeg2000": true
          }
        }
      ],
      "clientModelSorts": [
        {
          "name": "Recommended",
          "groups": [
            {
              "modelLabels": [
                "Gemini 3.5 Flash (Medium)",
                "Gemini 3.5 Flash (High)",
                "Gemini 3.5 Flash (Low)",
                "Gemini 3.1 Pro (Low)",
                "Gemini 3.1 Pro (High)",
                "Claude Sonnet 4.6 (Thinking)",
                "Claude Opus 4.6 (Thinking)",
                "GPT-OSS 120B (Medium)"
              ]
            }
          ]
        }
      ],
      "defaultOverrideModelConfig": {
        "modelOrAlias": {
          "model": "MODEL_PLACEHOLDER_M20"
        }
      }
    },
    "acceptedLatestTermsOfService": true,
    "userTier": {
      "id": "g1-pro-tier",
      "name": "Google AI Pro",
      "description": "Google AI Pro",
      "upgradeSubscriptionUri": "https://antigravity.google/g1-upgrade",
      "upgradeSubscriptionText": "You can upgrade to a Google AI Ultra plan to receive the highest rate limits.",
      "availableCredits": [
        {
          "creditType": "GOOGLE_ONE_AI",
          "creditAmount": "1000",
          "minimumCreditAmountForUsage": "50"
        }
      ]
    }
  }
}
```

---

## 設定檔在哪？告訴 CLI 執行腳本

- 注意事項
   1. `command` **必須用絕對路徑**，不能用 `~` / `$HOME` / `%USERPROFILE%`（Hook 在背景跑不經 shell，環境變數不會展開）
   2. Windows 使用者（User）請用 **VS Code** 或記事本（另存新檔→編碼選「UTF-8」不勾 BOM）編輯，**不要用 PowerShell 的 `Out-File` / `Set-Content` / `>` 重導向**，預設會寫成 UTF-16 LE 或加上 BOM，CLI 解析會出現 `invalid character 'ï'`
- 手動增加 
  1. 打開 `~/.gemini/antigravity-cli/settings.json`
  2. 在最外層 `{}` 內加上 statusLine 的資訊 
     - macOS
        ```json
        {
          "statusLine": {
            "enabled": true,
            "type": "command",
            "command": "node /Users/你的帳號/.gemini/antigravity-cli/hooks/my-status.mjs"
          },
          "ui": {
            "footer": {
              "items": ["model-name", "quota", "context-used"]
            }
          }
        }
        ```
     - Windows
        ```json
        {
          "statusLine": {
            "enabled": true,
            "type": "command",
            "command": "node C:\\Users\\你的帳號\\.gemini\\antigravity-cli\\hooks\\my-status.mjs"
          },
          "ui": {
            "footer": {
              "items": ["model-name", "quota", "context-used"]
            }
          }
        }
        ```
     - **注意**：必須同步寫入全域（Global）、CLI 專屬（CLI-specific）與專案（Project）三層設定檔，確保狀態列設定（Configuration）在所有執行層級與工作區路徑下都能被正確載入和繼承。

---

## 註冊安全白名單

CLI 預設拒絕執行未列管的腳本。**打開（或建立）** `~/.gemini/trusted_hooks.json`。為了安全考量與路徑匹配的完整性，不應只註冊 `"*"` 全域萬用字元（wildcard），還必須對當前工作區路徑（Workspaces）、家目錄路徑等進行多路徑註冊與環境變數註冊。

 - macOS
   ```json
   {
     "*": [
       "statusLine:node /Users/你的帳號/.gemini/antigravity-cli/hooks/my-status.mjs"
     ],
     "/Users/你的帳號/Project/your-project": [
       "statusLine:node /Users/你的帳號/.gemini/antigravity-cli/hooks/my-status.mjs"
     ]
   }
   ```
 - Windows
   ```json
   {
     "*": [
       "statusLine:node C:\\Users\\你的帳號\\.gemini\\antigravity-cli\\hooks\\my-status.mjs"
     ],
     "C:\\Users\\你的帳號\\Project\\your-project": [
       "statusLine:node C:\\Users\\你的帳號\\.gemini\\antigravity-cli\\hooks\\my-status.mjs"
     ]
   }
   ```


---

<!-- .slide: class="scroll-prompt" -->

## 設定 CLI ＋ 註冊白名單（同樣交給 Agy CLI）

理論講完了——實際操作就把下面這段貼給 Agy CLI，它會把 `settings.json` 與 `trusted_hooks.json` 同步寫好。

```text
請更新（或建立）設定檔，讓 Antigravity CLI 認得並信任剛剛的 my-status.mjs：

【1】~/.gemini/antigravity-cli/settings.json
（Windows：%USERPROFILE%\.gemini\antigravity-cli\settings.json）

在根節點合併以下欄位（保留其他既有欄位，勿覆蓋整個檔案），並請注意：必須同步寫入全域（Global）、CLI 專屬（CLI-specific）與專案（Project）三層設定檔，確保狀態列設定（Configuration）在所有執行層級下都能被正確套用與繼承。

三層設定檔路徑（三個都要寫入相同的 statusLine 設定）：
- CLI 專屬（最高優先級）：~/.gemini/antigravity-cli/settings.json
- 全域：~/.gemini/settings.json
- 專案：當前工作目錄下的 .gemini/settings.json
（Windows 的 ~ 即 %USERPROFILE%；實際寫入時用 os.homedir() 解析成絕對路徑）

{
  "statusLine": {
    "enabled": true,
    "type": "command",
    "command": "node <絕對路徑>/.gemini/antigravity-cli/hooks/my-status.mjs"
  },
  "ui": {
    "footer": {
      "items": ["model-name", "quota", "context-used"]
    }
  }
}

【2】~/.gemini/trusted_hooks.json
（Windows：%USERPROFILE%\.gemini\trusted_hooks.json）

不應只在全域 "*" 陣列註冊，還必須對當前工作區路徑（Workspaces）、家目錄路徑等進行多路徑註冊。請同時在 "*" 鍵的陣列、使用者家目錄絕對路徑鍵的陣列、以及當前工作區路徑鍵的陣列中，新增（append）對應的信任字串（保留各陣列既有項目，若鍵不存在請一併建立）：
"statusLine:node <絕對路徑>/.gemini/antigravity-cli/hooks/my-status.mjs"

規則：
- <絕對路徑> 動態用 os.homedir() 解析（macOS：/Users/xxx；Windows：C:\Users\xxx）
  別寫死 ~ / $HOME / %USERPROFILE%——hook 在背景跑不經 shell，這些變數不會展開
- Windows 規則：Windows 下的信任路徑必須同時註冊以下兩個變體（均寫入上述三個鍵 the 陣列中），以確保安全認證完美相容：
  1. 雙反斜線變體：statusLine:node C:\\Users\\xxx\\.gemini\\antigravity-cli\\hooks\\my-status.mjs
  2. 正斜線變體：statusLine:node C:/Users/xxx/.gemini/antigravity-cli/hooks/my-status.mjs
- 兩檔都用 UTF-8 無 BOM 存檔
- "statusLine:" 前綴與 settings.json 的 command 必須逐字相符，否則 CLI 拒絕執行

完成後請驗證：
1. 用 node 直接執行 my-status.mjs，確認有正常輸出（如「API: 剩餘 80%」）
2. 比對 settings.json 的 command 與 trusted_hooks.json 的 statusLine: 後字串完全相同
3. 都正確後告知使用者：回到 Agy CLI 輸入 /statusline 啟用
```

> ✅ Agy CLI 寫完後，下一頁直接在 CLI 輸入 `/statusline` 啟用。

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

## Step 2／3：請 Agy CLI 加上「重置倒數」

**接續剛剛的 Agy CLI 對話，貼這段，他會自己改寫 `my-status.mjs`：**

```text
請在 ~/.gemini/antigravity-cli/hooks/my-status.mjs 上，再加上一個資訊：
- 額度重置的倒數時間（距離現在還剩幾小時幾分）

實作要點：
1. resetTime 欄位在 quotaInfo 物件裡，是 ISO 8601 時間字串。
2. 計算時間差：用 new Date(resetTime).getTime() - Date.now() 算毫秒差（diffMs）。
3. 若 diffMs <= 0，顯示「現在」。
4. 若 diffMs > 0，換算成小時（hours）與分鐘（minutes）：
   - hours = Math.floor(diffMs / 3600000)
   - minutes = Math.floor((diffMs % 3600000) / 60000)
   - 若 hours > 0，格式為「Xh Ym」（例如：2h 30m）
   - 若 hours === 0，格式為「Ym」（例如：45m）
5. 最終 console.log 輸出：「API: 剩餘 X%  ⏰ 重置: Y」
6. 若沒有 resetTime 欄位，則保持原本輸出「API: 剩餘 X%」。
7. 確保所有改寫有 try-catch 保護，任何失敗均印「API: --」不崩潰。
```

> ✅ Agy CLI 改寫完後，回到下一張投影片再按 Enter，狀態列就會自動更新。

---

## Step 3／3：請 Agy CLI 套用色彩美化

**繼續在 Agy CLI 對話方塊（Dialog Box）貼這段，他會直接改寫腳本：**

```text
請在 ~/.gemini/antigravity-cli/hooks/my-status.mjs 上加 24位元（24-bit）ANSI 真彩色（Truecolor）：
1. 根據算出的剩餘百分比 pct 決定「API: 剩餘 X%」的顏色：
   - pct >= 75：藍色 #57caff (R:87, G:202, B:255)，即 \x1b[38;2;87;202;255m
   - pct >= 50 且 < 75：綠色 #5cdb6d (R:92, G:219, B:109)，即 \x1b[38;2;92;219;109m
   - pct >= 25 且 < 50：黃色 #ffd427 (R:255, G:212, B:39)，即 \x1b[38;2;255;212;39m
   - pct < 25：紅色 #ff7daf (R:255, G:125, B:175)，即 \x1b[38;2;255;125;175m

2. ⏰ 符號本身使用粗體（Bold），即 \x1b[1m⏰\x1b[0m。
3. 倒數時間標籤（如「重置: 」）使用灰色 \x1b[90m，後續數字與單位（如「2h 30m」或「現在」）使用白色 \x1b[97m。
4. 請注意：每次使用顏色代碼後，必須在字串結尾或切換顏色處加上 \x1b[0m 重置，避免污染命令列的後續輸出。
5. 確保任何異常捕獲（catch）時，能安全退回輸出無顏色的「API: --」。
```

> ✅ Agy CLI 改寫完後按 Enter，你的狀態列就會根據額度動態變色。

---

## 卡關了？五條跨平台排錯

1. **狀態列沒出現** → 檢查 `trusted_hooks.json` 是否漏 `statusLine:` 前綴；看 `~/.gemini/hook_error.log`（Windows：`%USERPROFILE%\.gemini\hook_error.log`）
2. **出現 `undefined` 或 `API: --`** → 確認 `settings.json` `command` 是絕對路徑 + 腳本存檔為 UTF-8 無 BOM + 確認 `agy` 行程還在跑（沒關就抓不到 PID）
3. **出現 `API: ` 但沒有百分比** → 額度耗盡時 protobuf 會省略 `remainingFraction=0`（只剩 `resetTime`），腳本要把這種情況視為 0%；另外 `remainingFraction` 可能 > 1，只有 ≤ 1 才乘 100
4. **Windows 路徑寫法** → 反斜線**必須雙倍** `C:\\Users\\xxx\\.gemini\\...`，或改用正斜線 `C:/Users/xxx/.gemini/...`；單一反斜線會被 JSON 當跳脫字元吃掉
5. **Windows 出現 `invalid character 'ï' looking for beginning of value`** → JSON 檔頭被偷塞 BOM。用 VS Code 開啟，右下角點「UTF-8 with BOM」改成「UTF-8」重新存檔

**Windows 黑色 CMD 視窗一直閃** → 注意！只在 `spawn` 加 `windowsHide: true` 無法完全解決因 Windows 系統中缺失 `sh` 執行檔而導致的黑視窗閃爍問題。在 Windows 環境下，必須編譯並設定 `sh.exe` 橋接器（bridge）來接管腳本執行，才能徹底消除視窗閃爍。

---

<!-- .slide: class="scroll-prompt" -->

## 不想自己排查？把這段丟給 Agy CLI

```text
我的狀態列現在沒有正常顯示，請幫我排查並修好。請依序：

1. 讀 ~/.gemini/trusted_hooks.json
   （Windows：%USERPROFILE%\.gemini\trusted_hooks.json）
   - 確認 "*" 陣列裡有 "statusLine:node <絕對路徑>/my-status.mjs"
   - 前綴 statusLine: 是否漏掉？
   - 路徑是否與 settings.json 的 command 逐字相符？

2. 讀 ~/.gemini/antigravity-cli/settings.json
   （Windows：%USERPROFILE%\.gemini\antigravity-cli\settings.json）
   - statusLine.command 是否為絕對路徑（不含 ~ / $HOME / %USERPROFILE%）？
   - Windows 反斜線是否寫成雙倍（C:\\Users\\...）？
   - 同時檢查另外兩層設定檔：~/.gemini/settings.json 與
     當前工作目錄下的 .gemini/settings.json，
     三層的 statusLine 設定必須一致（缺哪層就補哪層）

3. 用二進位（Binary）方式讀取兩個 JSON 檔案的前 3 個位元組（使用 fs.readFileSync 讀取為 Buffer 並檢查其位元組內容）：
   - 若出現 EF BB BF 表示被加了 UTF-8 BOM，請主動去除前 3 個位元組，重新存成無 BOM 的 UTF-8 版本。
   - 若出現 FF FE 或 FE FF 表示被存成 UTF-16，請將檔案重新編碼並改回 UTF-8 無 BOM 格式。

4. 讀 ~/.gemini/antigravity-cli/hooks/my-status.mjs
   - 所有 child_process（spawn / exec / execFile）是否都有 { windowsHide: true }？
   - 說明只加 windowsHide: true 無法解決 sh 缺失導致的黑視窗閃爍，必須確認是否已編譯與設定 sh.exe 橋接器以接管執行，若無則予以說明。
   - 檢查額度解析邏輯：quotaInfo 只有 resetTime 沒有 remainingFraction 時
     是否視為 0%（protobuf 會省略值為 0 的欄位）？
     remainingFraction > 1 時是否直接當百分比（只有 ≤ 1 才乘 100）？
     每層巢狀存取是否都有空值檢查？

5. 直接用 node 執行 my-status.mjs，把完整輸出（含錯誤）貼給我

6. 確認 agy 行程還在跑（沒關就抓不到 PID）：
   - Mac/Linux：ps auxww | grep agy
   - Windows：Get-Process | Where-Object { $_.ProcessName -like "*agy*" }

7. 查看最近的掛鉤（Hook）錯誤紀錄
   - cat ~/.gemini/hook_error.log（Windows：%USERPROFILE%\.gemini\hook_error.log）
   - 把最後 30 行貼給我，並指出可能的原因

修好後請告訴我改了哪些檔案、改了什麼。
```

> Agy CLI 會自動讀檔、診斷、必要時直接幫你改回正確版本。

---

## 我把全部的功能都放在這裡了，想要的話就去拿吧

<div style="margin-top:0.8em; padding:1.6em 1.8em; background:#fff;
            border-radius:16px; box-shadow:0 14px 40px rgba(0,0,0,0.12);
            border:1px solid #e8eaed; display:flex; gap:2em; align-items:center;">
  <div style="flex:0 0 260px; text-align:center;">
    <img src="qr-github-repo.png" alt="GitHub 倉庫 QR Code"
         style="width:260px; height:260px; display:block; margin:0;
                border:none; box-shadow:none; background:transparent;">
    <div style="font-size:0.65em; color:#5f6368; margin-top:0.5em;
                letter-spacing:0.08em;">SCAN ME</div>
  </div>
  <div style="flex:1; min-width:0;">
    <div style="font-family:'Menlo','Consolas',monospace; font-size:0.85em;
                color:#1a73e8; font-weight:700; margin-bottom:0.15em;">
      antigravity-cli-statusline
    </div>
    <div style="color:#5f6368; font-size:0.78em; margin-bottom:1.1em;">
      24 個指標 · 3 語系 · 跨平台 · 真彩色 · 動態折行
    </div>
    <div style="background:#1e1e1e; border-radius:10px;
                padding:0.85em 1.1em; font-family:'Menlo','Consolas',monospace;
                font-size:0.72em; line-height:1.9;">
      <div><span style="color:#888;">$ </span><span style="color:#57caff;">agy plugin install </span><span style="color:#fff;">https://github.com/andyawd/antigravity-cli-statusline</span></div>
      <div><span style="color:#888;">$ </span><span style="color:#fff;">agy</span></div>
      <div><span style="color:#5cdb6d;">&gt; </span><span style="color:#ffd427;">/antigravity-cli-statusline:antigravity-cli-statusline</span></div>
    </div>
    <div style="font-size:0.7em; color:#5f6368; margin-top:0.7em;">
      精靈會帶你勾選指標 · 選擇語系 · 自動寫好三層設定檔
    </div>
  </div>
</div>

---

## Thank You ＆ Q＆A
