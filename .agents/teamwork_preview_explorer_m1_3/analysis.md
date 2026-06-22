# 路徑重構分析與規劃報告 (Path Refactoring Analysis & Plan Report)

本報告針對專案中 `references` 與 `scripts` 資料夾的重構進行探索與規劃，旨在將其移動至 `skills/antigravity-cli-statusline/` 底下，以符合專案規章（`PROJECT.md`）所要求的架構佈局，並確保外掛（Plugin）安裝後的路徑參考一致性。

---

## 1. 現有檔案結構清單 (Current File Structure List)

以下為專案根目錄下 `references/` 與 `scripts/` 資料夾內的現有檔案結構與容量：

### 1.1 `references/` 資料夾
*   **路徑**：`/Users/andyawd/Project/antigravity-cli-statusline/references`
*   **檔案清單**：
    1.  `config-files.md` (5,766 位元組) — 描述三層設定檔結構、`statusLine` 物件與信任機制。
    2.  `pitfalls.md` (4,102 位元組) — 常見陷阱與避坑指南。
    3.  `windows.md` (9,110 位元組) — Windows 平台的特定規範（UTF-8 BOM、csc.exe 編譯等）。

### 1.2 `scripts/` 資料夾
*   **路徑**：`/Users/andyawd/Project/antigravity-cli-statusline/scripts`
*   **檔案清單**：
    1.  `diagnose-statusline.mjs` (8,307 位元組) — 唯讀的狀態列故障診斷指令碼。
    2.  `fetch-local-quota.mjs` (8,761 位元組) — 本地 API 額度（Quota）獲取指令碼。
    3.  `sh_hidden.cs` (763 位元組) — Windows 平台用來編譯無窗體 `sh.exe` 的 C# 原始碼。
    4.  `statusline-quota.mjs` (27,651 位元組) — 狀態列主要 Hook 部署核心指令碼。

---

## 2. `SKILL.md` 中 `references` 與 `scripts` 路徑引用現況

經過詳細搜尋 `/Users/andyawd/Project/antigravity-cli-statusline/skills/antigravity-cli-statusline/SKILL.md`，共有下列地方引用到這兩個路徑：

### 2.1 對 `references/` 的引用（相對路徑）
*   **第 10-15 行**：
    *   `[`references/windows.md`](references/windows.md)` (指向 `references/windows.md`)
    *   `[`references/config-files.md`](references/config-files.md)` (指向 `references/config-files.md`)
    *   `[`references/pitfalls.md`](references/pitfalls.md)` (指向 `references/pitfalls.md`)
*   **第 33 行**：
    *   `[references/config-files.md](references/config-files.md)`
*   **第 52 行**：
    *   `[references/windows.md](references/windows.md)`
*   **第 145 行**：
    *   `[references/windows.md §1](references/windows.md) 與 §3`
*   **第 247-248 行**：
    *   `[references/config-files.md](references/config-files.md)`
    *   `[references/windows.md](references/windows.md) §1`
*   **第 253 行**：
    *   `[references/windows.md §1](references/windows.md)`
*   **第 272 行**：
    *   `[references/windows.md §6](references/windows.md)`
*   **第 280 行**：
    *   `[references/pitfalls.md](references/pitfalls.md) 陷阱 #9`
*   **第 286 行**：
    *   `[references/pitfalls.md](references/pitfalls.md)`

### 2.2 對 `scripts/` 的引用（相對與絕對路徑）
*   **第 258 行**（相對描述）：
    *   `讀取本外掛 scripts/ 資料夾（相對於本外掛根目錄為 scripts/）中的對應腳本檔案`
    *   `更新對應的 scripts/*.mjs 內容再進行部署`
*   **第 261-264 行**（工作區路由與外掛安裝絕對路徑範例）：
    *   `1. 優先讀取當前工作區（Workspace）根目錄下的 scripts/<filename>`
    *   `2. 若不存在或在其他工作區，退回從本外掛安裝目錄下的 scripts/<filename> 讀取。`
    *   macOS / Linux 範例：`~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/scripts/<filename>`
    *   Windows 範例：`%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-cli-statusline\scripts\<filename>`
*   **第 272 行**（相對路徑）：
    *   `完整步驟（從 scripts/sh_hidden.cs 編譯）`
*   **第 280 行**（相對描述）：
    *   `請前往本外掛目錄執行 node scripts/diagnose-statusline.mjs`
*   **第 290 行**（相對描述）：
    *   `3. 絕對禁止憑空生成 Hook 腳本，必須從本外掛的 scripts/ 讀取原文部署`

---

## 3. 重構與更新策略 (Refactoring & Update Strategy)

本重構計畫分為三大步驟：資料夾移動、相對路徑更新與絕對路徑範例更新。

### 3.1 資料夾移動策略
1.  將原位於根目錄下的 `references/` 資料夾完整移動至 `skills/antigravity-cli-statusline/references/`。
2.  將原位於根目錄下的 `scripts/` 資料夾完整移動至 `skills/antigravity-cli-statusline/scripts/`。
3.  *備註：移動後，原專案根目錄下將不再保留這兩個資料夾，以保持專案結構乾淨。*

### 3.2 `SKILL.md` 中相對路徑的更新策略
由於 `SKILL.md` 本身位於 `skills/antigravity-cli-statusline/` 目錄下：
1.  **針對 `references/` 的 Markdown 連結**：
    在舊版結構下，`SKILL.md` 中的 `[references/windows.md](references/windows.md)` 連結原本是無效的（或需要向上兩層才能找到），因為實體檔案位於根目錄。將 `references/` 移動到與 `SKILL.md` 同一級目錄後，**這些相對路徑連結將可以直接生效，因此無需修改其相對連結字串**。
2.  **針對 `scripts/` 的相對路徑描述**：
    *   **第 258 行**的描述應改為：
        *   原本：`讀取本外掛 scripts/ 資料夾（相對於本外掛根目錄為 scripts/）`
        *   修改為：`讀取本外掛 scripts/ 資料夾（相對於本外掛根目錄為 skills/antigravity-cli-statusline/scripts/，或相對於 SKILL.md 所在目錄為 ./scripts/）`
    *   **第 262 行**的描述應改為：
        *   原本：`退回從本外掛安裝目錄下的 scripts/<filename> 讀取`
        *   修改為：`退回從本外掛安裝目錄下的 skills/antigravity-cli-statusline/scripts/<filename> 讀取`
    *   **第 272 行**的描述應改為：
        *   原本：`從 scripts/sh_hidden.cs 編譯`
        *   修改為：`從技能目錄下的 scripts/sh_hidden.cs（即 skills/antigravity-cli-statusline/scripts/sh_hidden.cs）編譯`
    *   **第 280 行**的診斷說明應改為：
        *   原本：`node scripts/diagnose-statusline.mjs`
        *   修改為：`node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs`

### 3.3 步驟 6 絕對路徑範例的更新策略（新標準路徑）
配合外掛安裝後的新標準路徑（`~/.gemini/config/plugins/...`）以及重構後的目錄結構，`SKILL.md` 步驟 6 的絕對路徑範例（第 263-264 行）需進行如下更新：
*   **macOS / Linux 範例**：
    *   原本：`~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/scripts/<filename>`
    *   修改為：`~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/<filename>`
*   **Windows 範例**：
    *   原本：`%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-cli-statusline\scripts\<filename>`
    *   修改為：`%USERPROFILE%\.gemini\config\plugins\antigravity-cli-statusline\skills\antigravity-cli-statusline\scripts\<filename>`

### 3.4 其他關聯檔案的路徑更新
除了 `SKILL.md` 之外，其餘有引用到這些路徑的檔案亦須同步更新：
1.  **`references/windows.md`**（重構後路徑為 `skills/antigravity-cli-statusline/references/windows.md`）：
    *   第 164 行：`退回從本外掛根目錄 scripts/sh_hidden.cs 讀取`
        → 修改為：`退回從本外掛根目錄下 skills/antigravity-cli-statusline/scripts/sh_hidden.cs 讀取`
2.  **`references/pitfalls.md`**（重構後路徑為 `skills/antigravity-cli-statusline/references/pitfalls.md`）：
    *   第 23 行（修正做法）：`讀取本技能 scripts/ 目錄下的對應檔案原文部署`
        → 修改為：`讀取本技能目錄下 scripts/ 目錄（即 skills/antigravity-cli-statusline/scripts/）的對應檔案原文部署`
    *   第 24 行（修正做法）：`node scripts/diagnose-statusline.mjs`
        → 修改為：`node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs`
3.  **`CONTRIBUTING.md`**：
    *   第 24、63 行：`scripts/statusline-quota.mjs`
        → 修改為：`skills/antigravity-cli-statusline/scripts/statusline-quota.mjs`
4.  **`.claude/settings.local.json`**：
    *   第 7 行：`node --check scripts/statusline-quota.mjs`
        → 修改為：`node --check skills/antigravity-cli-statusline/scripts/statusline-quota.mjs`

---

## 4. 替代路徑對照表 (Alternative Path Comparison Table)

以下整理重構前後的完整路徑對照表：

| 檔案 / 目錄名稱 | 專案庫中重構前路徑 (Before) | 專案庫中重構後路徑 (After) | 外掛安裝後新標準路徑下的絕對路徑 (macOS / Linux) |
|---|---|---|---|
| **參考文件目錄** | `references/` | `skills/antigravity-cli-statusline/references/` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/references/` |
| `config-files.md` | `references/config-files.md` | `skills/antigravity-cli-statusline/references/config-files.md` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/references/config-files.md` |
| `pitfalls.md` | `references/pitfalls.md` | `skills/antigravity-cli-statusline/references/pitfalls.md` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/references/pitfalls.md` |
| `windows.md` | `references/windows.md` | `skills/antigravity-cli-statusline/references/windows.md` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/references/windows.md` |
| **指令碼目錄** | `scripts/` | `skills/antigravity-cli-statusline/scripts/` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/` |
| `statusline-quota.mjs`| `scripts/statusline-quota.mjs` | `skills/antigravity-cli-statusline/scripts/statusline-quota.mjs` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/statusline-quota.mjs` |
| `fetch-local-quota.mjs`| `scripts/fetch-local-quota.mjs` | `skills/antigravity-cli-statusline/scripts/fetch-local-quota.mjs` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/fetch-local-quota.mjs` |
| `diagnose-statusline.mjs`| `scripts/diagnose-statusline.mjs` | `skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs` |
| `sh_hidden.cs` | `scripts/sh_hidden.cs` | `skills/antigravity-cli-statusline/scripts/sh_hidden.cs` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/sh_hidden.cs` |

> *註：Windows 環境下的絕對路徑只需將 `~` 替換為 `%USERPROFILE%`，並將斜線 `/` 改為反斜線 `\` 即可。*
