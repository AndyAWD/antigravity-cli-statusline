# 技術標準與更新檢查規格（Reference）

> [!IMPORTANT]
> 本檔案記錄狀態列渲染器（`statusline-quota.mjs`）的色彩、長條圖、時間格式、標籤樣式以及外掛版本更新檢查之完整技術規格。

---

## 1. 跨平台與編碼標準

1. **純 Node.js 跨平台實作**：相容 macOS、Linux 與 Windows（Windows 10 / 11），無需 Python 或外部二進位依賴。
2. **無 BOM UTF-8 寫檔**：所有 `fs.writeFileSync` 與 `fs.writeFile` 強制指定 `{ encoding: 'utf8' }`，寫入後並檢查與剝除前 3 位元組（`EF BB BF`），防止 Windows UTF-16 或 BOM 污染導致 `agy` 解析崩潰。
3. **智慧型多行換行（Smart Line Wrapping by Feature）**：讀取 `meta.terminal_width`（或快取／`process.stdout.columns`）計算可用寬度。組合狀態列字串時，若下一個加入的指標會使整行顯示寬度（已剝除 ANSI 控制碼，並將中日韓全形字元與 Emoji 精確計算為 2 格寬度、方塊與框線字元為 1 格）超出終端機寬度，自動將該指標折疊至新行。

---

## 2. 四階段精確色彩與模型識別色

### 四階段容量色彩（24-bit Truecolor）

| 剩餘比例（額度）／可用比例（脈絡） | 顏色 | Hex 色碼 | ANSI 跳脫序列 |
|---|---|---|---|
| `100% ~ 75%` | 藍色 | `#57caff` | `\x1b[38;2;87;202;255m` |
| `74% ~ 50%` | 綠色 | `#5cdb6d` | `\x1b[38;2;92;219;109m` |
| `49% ~ 25%` | 黃色 | `#ffd427` | `\x1b[38;2;255;212;39m` |
| `24% ~ 0%` | 紅色 | `#ff7daf` | `\x1b[38;2;255;125;175m` |

### 模型品牌專屬識別色

- **Claude**：`#dd5013`（`\x1b[38;2;221;80;19m`）
- **Gemini**：`#4796e3`（`\x1b[38;2;71;150;227m`）
- **GPT / ChatGPT**：`#74aa9c`（`\x1b[38;2;116;170;156m`）

---

## 3. 容量長條圖與相鄰自動合併

支援五組數值與長條圖指標配對（預設 10 格 `[████████░░]`，可於 `ui.footer.barLength` 自訂 1–50）：

| 數值指標 | 長條圖指標 | 自動合併鍵值 |
|---|---|---|
| `quota` | `quota-bar` | `quota+bar` |
| `quota-weekly` | `quota-weekly-bar` | `quota-weekly+bar` |
| `quota-argon` | `quota-argon-bar` | `quota-argon+bar` |
| `context-used` | `context-used-bar` | `context-used+bar` |
| `token-count` | `token-count-bar` | `token-count+bar` |

- **合併規則**：當數值與對應長條圖**相鄰排列**（順序不拘）且**標籤樣式一致**時，自動合併為單一標籤（文字模式如 `五小時可用: 88% [████████░░]`，Emoji 模式如 `🔋 88% [████████░░]`）。
- **樣式衝突拆分**：若一為 `text`、一為 `emoji`，或兩者之間隔有其他指標或換行 `n`，則不合併，拆開為兩個獨立區塊顯示。

---

## 4. 絕對重置時間（Reset Absolute Time）

支援 `quota-reset-time`、`quota-weekly-reset-time`、`quota-argon-reset-time`，自動轉換為本機時區，可透過 `ui.footer.timeFormat` 設定：

- `"smart"` / `"auto"`（預設）：同日顯示 `HH:mm`、跨日顯示 `yyyy/MM/dd HH:mm`
- `"yyyy/MM/dd HH:mm"`（或 `"full"`）：一律顯示完整年月日與時間
- `"24h"`：僅顯示 24 小時制時間 `HH:mm`
- `"12h"`：顯示 12 小時制時間 `hh:mm AM/PM`

---

## 5. 多樣化標籤樣式與版本標籤對照

- **`ui.footer.itemStyles`**：稀疏字典記錄個別覆寫（如 `{ "quota": "emoji" }`），未設定者一律強制以文字為預設。
- **`ui.footer.labelStyle`**：全域標籤樣式（`"text"` 或 `"emoji"`，無 `itemStyles` 時向後相容套用）。
- **Emoji 樣式格式**：以專屬 Emoji 取代文字標籤與冒號，僅保留單一空白（例如 `🤖 Gemini 3.1 Pro`、`🚀 v1.5.10`、`🧩 v1.11.4`），狀態值仍依 `ui.language` 顯示本地化文字。

### 版本指標四語系對照

| 指標識別碼 | Emoji | `zh-tw` | `zh-cn` | `us` | `jp` |
|---|---|---|---|---|---|
| `cli-version` | `🚀` | `Agy CLI 版本:` | `Agy CLI 版本:` | `Agy CLI Version:` | `Agy CLI バージョン:` |
| `plugin-version` | `🧩` | `外掛版本:` | `插件版本:` | `Plugin Version:` | `プラグイン版:` |

---

## 6. 外掛版本顯示與 GitHub Release 自動檢查規格

1. **作用域限制**：僅當 `ui.footer.items` 包含 `plugin-version` 時，才執行版本讀取、行程樹識別與 GitHub Release 檢查，並在落後時於最下方顯示更新提醒；未啟用該指標時完全不觸發任何行程查詢或網路請求。
2. **「第一次開啟」定義**：
   - 由狀態列子行程向上追蹤父行程樹，尋找最接近的 `agy`（或 Windows `agy.exe`）主行程（略過 `--hub` 背景中心行程），取得 `pid` 與行程啟動時間作為本次開啟識別（`sessionKey = "<pid>:<startTime>"`）。
   - 若該 `agy` 行程帶有 `-p`、`--print` 或 `--prompt`（含 `--flag=value` 形式，不含 `-i` / `--prompt-interactive`）非互動旗標，則**略過**線上更新檢查。
   - **跨平台實作**：Linux 優先讀取 `/proc/<pid>/stat` 與 `/proc/<pid>/cmdline`（失敗退回 `ps`）；macOS 呼叫 `ps -ww -o pid=,ppid=,lstart=,ucomm=`（於命中 `agy` 時再查 `args=`）；Windows 呼叫單次 PowerShell `Get-CimInstance Win32_Process`（強制 `windowsHide: true`）。
3. **快取與離線／失敗處理（`~/.gemini/tmp/plugin_update_cache.json`）**：
   - 每個互動式 `agy` 開啟識別僅嘗試查詢一次 `https://github.com/AndyAWD/antigravity-cli-statusline/releases/latest`（透過 HTTP 302 `Location` 標頭解析 `/releases/tag/<tag>`，避開 REST API 速率限制；具備 1.5 秒逾時保護並隨總預算調適）。
   - 若查詢失敗（離線、逾時、非 200 狀態等），立即將本次 `sessionKey` 與 `lastSessionStatus: "failed"` 寫入快取且保留先前已知的 `latestVersion`，本次開啟期間不再重試，並沿用快取中上次已知的 `latestVersion` 進行比對，待下次重啟 `agy` 時才重新查詢。
4. **兩行更新提醒排版**：
   - 當已安裝外掛版本（優先讀取 `~/.gemini/config/plugins/antigravity-cli-statusline/plugin.json` / `package.json`）在 SemVer 語意化版本比對上落後於最新 Release 版本時，於狀態列最下方固定附加兩行（不經由自動換行邏輯打散）：
     - 倒數第二行：依 `ui.language` 顯示版本差異與更新提示（如 `⚠️ 外掛有新版本可用（目前 v1.11.4 → 最新 v1.12.0），請執行以下指令更新：`）。
     - 最末行：獨立顯示 `! agy plugin install https://github.com/AndyAWD/antigravity-cli-statusline`。
5. **手動同步策略與診斷**：
   - 執行 `! agy plugin install` 只會更新 `~/.gemini/config/plugins/antigravity-cli-statusline/`，不會自動覆寫 `~/.gemini/antigravity-cli/hooks/`。
   - 因渲染器即時讀取外掛目錄內的 `plugin.json` 版本號，更新外掛後狀態列顯示之 `外掛版本` 會立即追平且更新提示立即消失；使用者需重跑 `/antigravity-cli-statusline:agy-cli-statusline` 才會將最新掛鉤程式碼重新部署至 `hooks/`。
   - `scripts/diagnose-statusline.mjs` 會比對外掛清單版本、`hooks/.hook-version.json` 及掛鉤腳本 SHA-256 雜湊，若偵測到不同步會輸出明確提醒。
