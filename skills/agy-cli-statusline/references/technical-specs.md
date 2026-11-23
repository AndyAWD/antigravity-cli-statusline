# 技術標準與更新檢查規格（Reference）

> [!IMPORTANT]
> 本檔案記錄狀態列入口（`statusline-quota.mjs`）與四層模組化架構（`scripts/lib/`）的色彩、長條圖、時間格式、標籤樣式、外掛版本更新檢查及掛鉤部署之完整技術規格。

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
| `app-version` | `💻` | `Agy 2.0 版本:` | `Agy 2.0 版本:` | `Agy 2.0 Version:` | `Agy 2.0 バージョン:` |
| `plugin-version` | `🧩` | `狀態列版本:` | `状态栏版本:` | `Statusline Version:` | `ステータスライン版:` |
| `plugin-update` | `🆕` | 兩行更新提醒（無更新自動隱藏） | 两行更新提醒（无更新自动隐藏） | 2-line update notice (auto-hidden if current) | 2行更新通知（最新時は自動非表示） |

---

## 6. 狀態列版本（`plugin-version`）與獨立更新檢查（`plugin-update`）規格

1. **雙指標完全解耦與作用域限制**：
   - **`plugin-version`（`#37`）**：僅讀取本機已安裝的外掛清單（優先讀取 `~/.gemini/config/plugins/antigravity-cli-statusline/plugin.json` / `package.json`）並輸出「狀態列版本」文字或 Emoji 標籤；**絕不**觸發行程樹追溯、GitHub Release 網路查詢或輸出兩行更新提醒。即使排在狀態列中間，也不會打亂單行排版。
   - **`plugin-update`（`#38`）**：獨立控制版本更新檢查與提醒區塊。僅當 `ui.footer.items` 包含 `plugin-update` 時，才執行行程樹識別與 GitHub Release 檢查；未啟用該指標時完全不觸發任何行程查詢或網路請求。
2. **「第一次開啟」定義**：
   - 由狀態列子行程向上追蹤父行程樹，尋找最接近的 `agy`（或 Windows `agy.exe`）主行程（略過 `--hub` 背景中心行程），取得 `pid` 與行程啟動時間作為本次開啟識別（`sessionKey = "<pid>:<startTime>"`）。
   - 若該 `agy` 行程帶有 `-p`、`--print` 或 `--prompt`（含 `--flag=value` 形式，不含 `-i` / `--prompt-interactive`）非互動旗標，則**略過**線上更新檢查。
   - **跨平台實作**：Linux 優先讀取 `/proc/<pid>/stat` 與 `/proc/<pid>/cmdline`（失敗退回 `ps`）；macOS 呼叫 `ps -ww -o pid=,ppid=,lstart=,ucomm=`（於命中 `agy` 時再查 `args=`）；Windows 呼叫單次 PowerShell `Get-CimInstance Win32_Process`（強制 `windowsHide: true`）。
3. **快取與離線／失敗處理（`~/.gemini/tmp/plugin_update_cache.json`）**：
   - 每個互動式 `agy` 開啟識別僅嘗試查詢一次 `https://github.com/AndyAWD/antigravity-cli-statusline/releases/latest`（透過 HTTP 302 `Location` 標頭解析 `/releases/tag/<tag>`，避開 REST API 速率限制；具備 1.5 秒逾時保護並隨總預算調適）。
   - 若查詢失敗（離線、逾時、非 200 狀態等），立即將本次 `sessionKey` 與 `lastSessionStatus: "failed"` 寫入快取且保留先前已知的 `latestVersion`，本次開啟期間不再重試，並沿用快取中上次已知的 `latestVersion` 進行比對，待下次重啟 `agy` 時才重新查詢。
4. **獨立兩行更新提醒排版與空行修剪**：
   - 當已安裝版本在 SemVer 語意化版本比對上落後於最新 Release 版本時，`plugin-update` 會於使用者在 `ui.footer.items` 排定的順序位置輸出固定兩行獨立區塊（不與相鄰指標以 `│` 合併，亦不經由自動換行邏輯打散）：
     - 第一行（文字樣式）：依 `ui.language` 顯示版本差異與更新提示（如 `⚠️ 狀態列有新版本可用（目前 v1.11.4 → 最新 v1.12.0），請執行以下指令更新：`）；Emoji 樣式則顯示精簡格式 `🆕 v1.11.4 → v1.12.0`。
     - 第二行：獨立顯示 `agy plugin install https://github.com/AndyAWD/antigravity-cli-statusline`（無前導 `! `，可在外部終端機直接複製貼上執行）。
   - 無新版本或非互動模式時，`plugin-update` 輸出空字串並自動隱藏不佔位，且渲染器會自動修剪狀態列頭尾殘留的純空白行（中間段落分隔之 `n,n` 保留）。
5. **手動同步策略與診斷**：
   - 執行 `agy plugin install` 只會更新 `~/.gemini/config/plugins/antigravity-cli-statusline/`，不會自動覆寫 `~/.gemini/antigravity-cli/hooks/`（含 `hooks/lib/`）。
   - 因渲染器即時讀取外掛目錄內的 `plugin.json` 版本號，更新外掛後狀態列顯示之 `狀態列版本` 會立即追平且 `plugin-update` 更新提示立即消失；使用者需重跑 `/antigravity-cli-statusline:agy-cli-statusline` 才會將最新掛鉤與 `hooks/lib/` 子模組程式碼重新部署至 `hooks/`。
   - `scripts/diagnose-statusline.mjs` 會比對外掛清單版本、`hooks/.hook-version.json` 及所有已部署掛鉤檔案（`statusline-quota.mjs`、`fetch-local-quota.mjs` 與 `lib/**/*.mjs`）的 SHA-256 雜湊，若偵測到不同步會輸出明確提醒。

---

## 7. 四層模組化架構、掛鉤部署與渲染器註冊

1. **四層模組化架構（`skills/agy-cli-statusline/scripts/lib/`）**：
   狀態列掛鉤與配置工具採用四層架構拆分職責（純 Node.js 零外部依賴 ESM）：
   - `core/`：常數與版本（`constants.mjs`）、無位元組順序記號（Byte Order Mark）檔案讀寫與 SHA-256 雜湊（`fs-utils.mjs`）、安全清理與符號連結防護（`safe-cleanup.mjs`）、參數正規化（`normalize.mjs`）、語意化版本（Semantic Versioning）比較（`semver.mjs`）、`windowsHide: true` 子行程工具（`process-utils.mjs`）、三層設定檔合併與命令產生（`settings.mjs`）、外掛清單探索（`plugin-manifest.mjs`）。
   - `collectors/`：資料採集層，包含時間格式（`time-format.mjs`）、本地額度與語言伺服器（Language Server）快取（`quota.mjs`）、對話脈絡與動態上限（`context.mjs`）、帳號快取（`account.mjs`）、系統探針（`probes.mjs` 負責 Git、記憶體與計數器探測）、跨平台版本探測（`versions.mjs` 負責獨立解析已安裝之 Agy CLI 與 Agy 2.0 版本號）以及父行程樹與 GitHub Release 更新檢查（`plugin-update.mjs`）。
   - `metrics/`：指標中繼資料與在地化層，包含單一真實來源 `registry.mjs`（管理 39 項指標、5 個分類、4 種語系、`EMOJI_MAP`（44 鍵）、`ADJACENT_PAIRS` 與問卷中繼資料，並透過 `scripts/sync-resources.mjs` 生成 `resources/questions.json` 與 `resources/prompts.json`）以及四語系標籤字典與相鄰長條圖合併邏輯（`i18n.mjs`）。
   - `renderers/`：視覺渲染層，包含美國國家標準協會（American National Standards Institute）24-bit 配色與終端顯示寬度計算（`ansi.mjs`）、渲染器註冊表（`index.mjs`）與預設的 `standard` 狀態列渲染器（`standard.mjs`）。
2. **遞迴掛鉤部署與 `.hook-version.json`**：
   - `scripts/configure-statusline.mjs` 執行時，除了部署主入口 `statusline-quota.mjs` 與背景採集器 `fetch-local-quota.mjs` 至 `~/.gemini/antigravity-cli/hooks/`，亦會遞迴同步整個 `scripts/lib/` 至 `~/.gemini/antigravity-cli/hooks/lib/`。
   - `hooks/.hook-version.json` 的 `files` 欄位記錄所有已部署檔案（含 `statusline-quota.mjs`、`fetch-local-quota.mjs` 與 `lib/...` 下所有 `.mjs` 檔案）的 SHA-256 雜湊值，供 `diagnose-statusline.mjs` 進行完整性與同步比對。
3. **渲染器選擇、`ui.footer.theme` 相容防禦與 `trusted_hooks.json`**：
   - 目前狀態列預設採用 `standard` 渲染器，透過 `lib/renderers/index.mjs` 的註冊機制（`registerRenderer` / `getRenderer` / `listRenderers`）解析。
   - `ui.footer.theme`（連同 `ui.footer.style`、`ui.labelStyle`）屬於為向下相容而主動清理的歷史鍵值：`lib/core/settings.mjs`（`getSettingsAsync`）與 `configure-statusline.mjs` 會在讀取或寫入設定時主動刪除該鍵，避免早期實驗性主題殘留干擾。未來若新增動畫或自訂風格渲染器（例如 `dino`），必須在 `lib/renderers/index.mjs` 註冊並使用明確的設定鍵（例如 `ui.footer.renderer`），不得沿用 `ui.footer.theme`。
   - `statusLine.command` 永遠保持指向 `~/.gemini/antigravity-cli/hooks/statusline-quota.mjs`，以維持與 `~/.gemini/trusted_hooks.json` 命令字串白名單的完全相容。

---

## 8. 動態配額池歸屬與重置過期寬限規格（`lib/collectors/quota.mjs`）

1. **動態配額池對照建立與過期模型條目過濾（`fetch-local-quota.mjs`）**：
   - 背景採集器呼叫 `parseModelPools(summaryResponse)`（解析群組 `buckets`、`description` 與結構化 `models` / `modelIds`）及 `inferModelPoolsFromModels(allModels, shortTerm)`（依相同短週期重置時間與 ±5% 剩餘百分比交叉推斷），建立「標準化模型名稱 → 配額池」對照表 `cache.modelPools` 並寫入 `~/.gemini/tmp/local_quota_cache.json`。
   - 合併前次快取時，會自動過濾 `reset_time <= Date.now()` 的過期 `prev.models` 條目，避免舊模型過期快照覆寫新重置狀態。
2. **四層優先序配額池解析（`resolveQuotaPool(fallbackModel, cache, meta)`）**：
   依序比對候選模型識別鍵（`fallbackModel`、`meta.model.id`、`meta.model.display_name`、`meta.model.name`）：
   - **第 1 層：動態群組對照（`cache.modelPools`）**：先查找精確命中，若無則針對長度 `>= 4` 的鍵執行最長子字串包含比對。
   - **第 2 層：明確品牌關鍵字**：`claude` / `gpt` / `chatgpt` / `openai` / `anthropic` 歸入 `3p`；`gemini` / `google` 歸入 `gemini`。
   - **第 3 層：模型目錄對照（`cache.modelLimits`）**：查閱 `slug`、`model`、`displayName` 欄位並套用品牌關鍵字判別。
   - **第 4 層：冷啟動編排器／代號退讓**：`orchestrator`、`neon`、`hydrogen`、`argon`、`carbon` 預設歸入 `gemini`。
3. **重置過期寬限期與即時倒數重算（`normalizeResolvedQuotaEntry`）**：
   - 定義過期寬限常數 `EXPIRED_RESET_GRACE_MS = 60_000`（60 秒）。
   - 當解析後條目的 `reset_time + 60 秒 <= nowMs` 時，視為額度已過重置點，自動轉為 `{ remaining_percentage: 100, refreshes_in: '' }`（保留 `window` 欄位）。
   - 仍在重置時間內或寬限期內時，呼叫 `formatResetTime(entry.reset_time, nowMs)`（於 `lib/collectors/time-format.mjs`）依據當前時間即時重算 `refreshes_in` 倒數字串，避免背景快取尚未刷新時顯示停滯倒數。
