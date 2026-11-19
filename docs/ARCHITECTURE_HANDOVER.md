# 架構交接與維護指南（Architecture Handover）

本文件為 `antigravity-cli-statusline` 專案之系統交接與擴充操作手冊，供後續人工智慧（Artificial Intelligence）代理與開發者直接依循維護。本專案僅使用 Antigravity 命令列介面（Command-Line Interface）（`agy`）進行開發與外掛驗證（已移除根目錄 `CLAUDE.md`）。

---

## 1. 目錄結構與四層樂高（Lego）模組化架構

### 1.1 專案目錄地圖

```text
antigravity-cli-statusline/
├── package.json                                  # 套件中繼資料與 npm 腳本定義
├── plugin.json                                   # Antigravity 外掛清單（版本需與程式同步）
├── CONTRIBUTING.md                               # 三語系貢獻指南（us / zh-tw / zh-cn）
├── README.md / README.zh-TW.md / README.zh-CN.md / README.ja.md
├── docs/
│   ├── ARCHITECTURE_HANDOVER.md                  # 本檔：架構交接、擴充配方與釋出規範
│   ├── images/                                   # 截圖與自動生成之狀態列範例向量圖
│   └── workshop/                                 # 工作坊簡報（index.html、STYLE.md 等）
└── skills/agy-cli-statusline/
    ├── SKILL.md                                  # 技能主檔（YAML name: agy-cli-statusline，< 24 KB）
    ├── references/                               # 技術規格、設定檔、Windows、表格與陷阱文件
    ├── resources/
    │   ├── questions.json                        # 由 sync-resources.mjs 自動生成（嚴禁手改）
    │   └── prompts.json                          # 四語系靜態對話範本（嚴禁手改）
    └── scripts/
        ├── statusline-quota.mjs                  # CLI statusLine.command 唯一掛鉤入口
        ├── fetch-local-quota.mjs                 # 背景配額與語言伺服器資料抓取腳本
        ├── configure-statusline.mjs              # 設定三層 settings.json 並遞迴部署 hooks/lib/
        ├── diagnose-statusline.mjs               # 三層設定、外掛與掛鉤 SHA-256 同步診斷工具
        ├── sync-resources.mjs                    # 由 registry.mjs 生成 questions.json 與 prompts.json
        ├── generate-svg-demos.mjs                # 產出 docs/images/statusline-demo*.svg
        ├── test-counters.mjs                     # 計數器與防禦性整合測試腳本
        ├── tests/*.test.mjs                      # 模組化單元與整合測試套件
        └── lib/                                  # 四層核心程式庫（純 Node.js 原生模組，零外部相依）
            ├── core/
            ├── collectors/
            ├── metrics/
            └── renderers/
```

### 1.2 `scripts/lib/` 四層職責切分

| 層級 | 目錄 | 核心檔案與職責 |
|---|---|---|
| **第 1 層：基礎核心** | `lib/core/` | `constants.mjs`（版本常數 `HOOK_VERSION`、倉儲網址、脈絡壓縮門檻）、`fs-utils.mjs`（無位元組順序記號〔Byte Order Mark〕讀寫、SHA-256 雜湊、`listMjsFilesRecursiveSync`、`isDirectExecution`）、`safe-cleanup.mjs`（Git 目錄防護與符號連結安全移除）、`normalize.mjs`（語系、標籤樣式、模型名稱與數字正規化）、`semver.mjs`（語意化版本〔Semantic Versioning〕含先行版本比較）、`process-utils.mjs`（`withTimeout` 與強制 `windowsHide: true` 子行程呼叫）、`settings.mjs`（三層 `settings.json` 讀取合併與跨平台 `statusLine.command` 生成）、`plugin-manifest.mjs`（統一同步與非同步外掛版本探索）。 |
| **第 2 層：資料採集** | `lib/collectors/` | `time-format.mjs`（重置倒數與時間格式）、`quota.mjs`（本地額度與語言伺服器〔Language Server〕快取）、`context.mjs`（對話脈絡與動態上限）、`account.mjs`（帳號資訊與日誌快取）、`probes.mjs`（Git、記憶體與計數器雙軌探針，匯出 `extractMetricsAsync`）、`plugin-update.mjs`（父行程樹識別與 GitHub Release 檢查）；對渲染層輸出與介面無關之結構化指標物件（含 `agentState`、`toolConfirmPending` 等狀態）。 |
| **第 3 層：指標與在地化** | `lib/metrics/` | `registry.mjs` 為全部 37 項指標、5 個分類、4 種語系（`zh-tw`、`zh-cn`、`us`、`jp`）、`EMOJI_MAP`（42 鍵）、`ADJACENT_PAIRS`（5 組長條圖配對）與問卷提示 `LOCALE_WIZARD_META` 的單一真實來源；`i18n.mjs` 負責 `buildI18nDict` 四語系格式化字典、相鄰長條圖合併與外掛更新提示雙行訊息。 |
| **第 4 層：視覺渲染** | `lib/renderers/` | `ansi.mjs`（美國國家標準協會〔American National Standards Institute〕24-bit 四階配色、品牌色、顯示寬度計算與進度條繪製）、`index.mjs`（以 `Map` 維護之 `registerRenderer`、`getRenderer`、`listRenderers` 註冊表）與 `standard.mjs`（預設的 `standard` 多行智慧換行渲染器）。 |

> [!NOTE]
> `configure-statusline.mjs` 部署掛鉤時，會將 `statusline-quota.mjs`、`fetch-local-quota.mjs` 及整個 `scripts/lib/` 遞迴複製至 `~/.gemini/antigravity-cli/hooks/`（含 `hooks/lib/`），並將全部已部署檔案的 SHA-256 雜湊寫入 `~/.gemini/antigravity-cli/hooks/.hook-version.json`。

---

## 2. 擴充開發配方（Recipes）

### 2.1 新增第 38 項以上指標（Metric #38+）

1. **註冊指標中繼資料**：開啟 [`skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs`](../skills/agy-cli-statusline/scripts/lib/metrics/registry.mjs)，於 `METRICS` 與 `ALL_STANDARD_METRIC_IDS` 新增識別碼，指定所屬分類（5 大分類之一）、於 `EMOJI_MAP` 補上繪圖符號，並填入 `zh-tw`、`zh-cn`、`us`、`jp` 4 種語系的選項說明。選項文字除末尾的 `(<metric-id>)` 外，不得額外包含括號，以免影響 `configure-statusline.mjs` 識別碼解析。若新增指標可與長條圖相鄰合併，同步於 `ADJACENT_PAIRS` 註冊配對並補上 `<metric-id>+bar` 的 Emoji。
2. **實作資料採集**：於 `skills/agy-cli-statusline/scripts/lib/collectors/`（如 `probes.mjs` 或對應採集模組）計算該指標數值或狀態字串；所有外部子行程必須使用 `process-utils.mjs` 並搭配逾時保護與 `windowsHide: true`。
3. **補齊四語系輸出字串**：於 `skills/agy-cli-statusline/scripts/lib/metrics/i18n.mjs` 的 `buildI18nDict` 為 4 種語系加上 `<metric-id>`（及若有配對之 `<metric-id>+bar`）格式字串，保留既有的色彩常數與變數插值。
4. **同步資源檔案**：執行 `npm run sync:resources` 重新生成無位元組順序記號的 `resources/questions.json` 與 `resources/prompts.json`。
5. **補齊測試與文件**：於 `skills/agy-cli-statusline/scripts/tests/*.test.mjs` 新增測試案例；同步更新 `skills/agy-cli-statusline/references/`（`config-files.md`、`step4-table-example.md`）、`SKILL.md` 指標總數與 4 份 `README*.md`，必要時執行 `npm run build:svg` 更新展示向量圖。

### 2.2 新增支援語系（New Language）

1. **`lib/metrics/registry.mjs`**：將新語系代碼加入 `SUPPORTED_LOCALES`，於 `LOCALE_WIZARD_META` 補上階段 1 選單項目、階段 2 缺少 Node.js 警告、階段 4 表格標題／表頭與單行排序問卷，並翻譯 `METRIC_CATEGORIES` 與全部指標描述。
2. **`lib/core/normalize.mjs`**：於 `normalizeLanguage()` 補上該語系代碼及常見地區別名的正規化規則（由 `statusline-quota.mjs` 與 `configure-statusline.mjs` 共用）。
3. **`lib/metrics/i18n.mjs`**：於 `buildI18nDict`、`formatAgentState(state, normLang)` 內部 `map`（代理狀態文字）及 `formatPluginUpdateNoticeLines` 補齊新語系全部鍵值與更新提醒翻譯。
4. **`lib/collectors/probes.mjs`（及採集器退讓標籤）**：補齊「無版本控制（No VC）」、「未知」、「無」、「未提交 / 無變更」與沙盒狀態文字的在地化分支。
5. **重新生成資源與驗證**：執行 `npm run sync:resources` 自動更新 `resources/questions.json` 與 `resources/prompts.json`（無須修改 `SKILL.md` 中的靜態文字），再執行 `npm test` 與更新 `CONTRIBUTING.md`。

### 2.3 新增狀態列渲染樣式（例如 `agy-dino` 動態風格）

1. **重複使用採集層輸出**：直接取用 `lib/collectors/` 產出的指標物件（包含 `agentState`、`toolConfirmPending`、配額與脈絡資訊），切勿在渲染器中重複啟動子行程或呼叫網路應用程式介面（Application Programming Interface）。
2. **實作渲染器模組**：於 `skills/agy-cli-statusline/scripts/lib/renderers/` 新增渲染器（例如 `dino.mjs`），透過 `lib/renderers/ansi.mjs` 計算顯示寬度與色彩，並保留極窄終端或空設定時的退讓輸出（不得回傳空字串）。
3. **向註冊表登記並於入口匯入**：於新渲染器模組本身（例如 `dino.mjs`）從 `lib/renderers/index.mjs` 匯入並呼叫 `registerRenderer('dino', renderDinoStatusLine)`（與 `standard.mjs` 相同），並於入口腳本 `statusline-quota.mjs`（或經由 `lib/renderers/`）匯入該模組以觸發註冊，與預設 `'standard'` 渲染器並列管理。
4. **使用明確設定鍵，嚴禁重複使用 `ui.footer.theme`**：
   > [!CAUTION]
   > `lib/core/settings.mjs`（`getSettingsAsync`）與 `configure-statusline.mjs` 內建歷史相容防禦，會在讀取與寫入 `settings.json` 時**主動刪除 `settings.ui.footer.theme`**（以及 `ui.footer.style`、`ui.labelStyle`）。新增渲染樣式時必須採用明確的新設定鍵（例如 `ui.footer.renderer`，預設 `'standard'`），絕對不可寫入 `ui.footer.theme`。
5. **維持掛鉤入口不變**：`statusLine.command` 仍須固定指向 `~/.gemini/antigravity-cli/hooks/statusline-quota.mjs`，由主入口依據渲染器設定鍵從 `getRenderer(...)` 分派渲染，避免破壞 `~/.gemini/trusted_hooks.json` 命令白名單。

---

## 3. 工作坊簡報視覺規範（承繼自已刪除之 `CLAUDE.md`）

任何修改 [`docs/workshop/index.html`](workshop/index.html) 視覺、色彩或版型的工作前，**必須先完整閱讀 [`docs/workshop/STYLE.md`](workshop/STYLE.md)**，該檔規範 GDG 三階色票、`--gdg-*` CSS 變數命名、「內容頁」與「章節頁（`chapter-page`）」兩種版型語意、`1em` 正文字級一致性與歷史錯誤清單；同時嚴禁修改 `docs/workshop/prompt-workshop-slides.md`。

---

## 4. 跨平台、Antigravity CLI 限制與釋出檢查清單

### 4.1 跨平台與執行邊界鐵則

| 限制項目 | 強制規範與原因 | 參考位置 |
|---|---|---|
| **Windows 無位元組順序記號 UTF-8** | 所有設定檔與掛鉤寫入皆須指定 `{ encoding: 'utf8' }` 並剝除開頭 `EF BB BF`（透過 `lib/core/fs-utils.mjs`），否則 Go JSON 解析器會直接崩潰。 | [`windows.md`](../skills/agy-cli-statusline/references/windows.md) |
| **Windows `statusLine.command` 禁雙引號** | `agy.exe` 經 Go `exec.CommandContext` + `cmd /c` 執行時會將 `"` 轉義為 `\"`，導致 `node.exe` 將引號視為字面路徑字元。無空格用 `node <path>`；含空格改用 `node --import file:///... -e 0`。 | [`config-files.md`](../skills/agy-cli-statusline/references/config-files.md) |
| **Windows `windowsHide: true`** | 所有 `spawn`、`execFile`、`exec` 子行程呼叫必須設定 `windowsHide: true`（集中於 `lib/core/process-utils.mjs`），防止終端視窗閃爍。 | [`windows.md`](../skills/agy-cli-statusline/references/windows.md) |
| **macOS / Linux 絕對路徑** | 非互動式 `/bin/sh` 不含 NVM / fnm / Homebrew 的 `PATH`，`statusLine.command` 必須寫入 `process.execPath` 絕對路徑以避免 `exit status 127`。 | [`config-files.md`](../skills/agy-cli-statusline/references/config-files.md) |
| **`SKILL.md` 容量與命名驗證** | 檔案總大小必須嚴格低於 Antigravity CLI 的 24 KB 上限（目前精簡至約 6–10 KB，四語系靜態問卷統一放於 `resources/prompts.json`）；YAML `name` 必須與資料夾名稱 `agy-cli-statusline` 一致以通過 `agy plugin validate .`。 | [`SKILL.md`](../skills/agy-cli-statusline/SKILL.md) |
| **`trusted_hooks.json` 白名單相容** | `~/.gemini/trusted_hooks.json` 以 `statusLine:<command>` 字串精確比對許可執行；切勿隨意變更 `hooks/statusline-quota.mjs` 檔名或路徑。 | [`config-files.md`](../skills/agy-cli-statusline/references/config-files.md) |
| **`~/.gemini/` 系統保護邊界** | 執行技能期間嚴禁使用 `read_file`、`write_file` 或 `edit_file` 直接存取 `~/.gemini/**/settings.json`；所有變更一律透過 `configure-statusline.mjs` 執行。 | [`pitfalls.md`](../skills/agy-cli-statusline/references/pitfalls.md) |

### 4.2 版本釋出同步檢查清單（Release Checklist）

發佈新版本（建立 `v*` Git 標籤前）必須同步更新下列位置的版本號並驗證一致：
1. [`package.json`](../package.json) — `version` 欄位
2. [`plugin.json`](../plugin.json) — `version` 欄位
3. [`skills/agy-cli-statusline/scripts/lib/core/constants.mjs`](../skills/agy-cli-statusline/scripts/lib/core/constants.mjs) — `HOOK_VERSION` 常數
4. 4 份多語系說明文件 — [`README.md`](../README.md)、[`README.zh-TW.md`](../README.zh-TW.md)、[`README.zh-CN.md`](../README.zh-CN.md)、[`README.ja.md`](../README.ja.md) 中的版本徽章與範例輸出
5. 執行 `npm run sync:resources` 與 `npm run build:svg`（若有調整問卷或展示項目）

---

## 5. 常用驗證指令

```bash
# 1. 由 registry.mjs 重新生成 questions.json 與 prompts.json
npm run sync:resources

# 2. 重新生成四語系狀態列展示 SVG 圖檔
npm run build:svg

# 3. 執行全部單元測試、整合測試與計數器防禦測試
npm test

# 4. 驗證外掛清單與 SKILL.md 格式（確認 0 warning）
agy plugin validate .

# 5. 檢查本機三層 settings.json、掛鉤檔案完整性與版本同步狀態
node skills/agy-cli-statusline/scripts/diagnose-statusline.mjs
```
