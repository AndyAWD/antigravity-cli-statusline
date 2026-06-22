# 專案路徑探索與重構分析報告 (Path Exploration and Refactoring Analysis Report)

本報告針對 `antigravity-cli-statusline` 專案中 `references` 與 `scripts` 資料夾的路徑使用狀況進行詳細探索，並規劃將其遷移至 `skills/antigravity-cli-statusline/` 的重構計畫。

---

## 1. 原始檔案結構與清單 (Original File Structure and Catalog)

### 1.1 參考文件 (References) 目錄
- **路徑**：`/Users/andyawd/Project/antigravity-cli-statusline/references/`
- **檔案清單**：
  1. `config-files.md` (5,766 位元組) — 說明三層設定檔結構、`statusLine` 物件與信任機制。
  2. `pitfalls.md` (4,102 位元組) — 常見陷阱對照表。
  3. `windows.md` (9,110 位元組) — Windows 特定規範（BOM、`sh.exe` 越獄、`csc.exe` 編譯）。

### 1.2 腳本 (Scripts) 目錄
- **路徑**：`/Users/andyawd/Project/antigravity-cli-statusline/scripts/`
- **檔案清單**：
  1. `diagnose-statusline.mjs` (8,307 位元組) — 唯讀狀態列診斷工具。
  2. `fetch-local-quota.mjs` (8,761 位元組) — 取得本地 API 額度用量腳本。
  3. `sh_hidden.cs` (763 位元組) — Windows 靜默執行橋接器之 C# 原始碼。
  4. `statusline-quota.mjs` (27,651 位元組) — 狀態列主體 Hook 腳本。

---

## 2. SKILL.md 中路徑引用狀況 (Path References in SKILL.md)

以下詳細列出 `/Users/andyawd/Project/antigravity-cli-statusline/skills/antigravity-cli-statusline/SKILL.md` 中所有引用 `references` 與 `scripts` 的地方。

### 2.1 對 `references` 的引用
| 行號 | 引用內容 (Code Snippet) | 類型 | 說明 |
| :--- | :--- | :--- | :--- |
| 10-15 | `references/` 資料夾引言與三個檔案的 Markdown 連結：<br> - `[references/windows.md](references/windows.md)` <br> - `[references/config-files.md](references/config-files.md)` <br> - `[references/pitfalls.md](references/pitfalls.md)` | 相對路徑 (Relative Path) | 用於引導開發者/代理閱讀細節規範。 |
| 18 | `禁止透過子代理...摘要 references/ 內容` | 資料夾名稱 | 載入規則之警示說明。 |
| 33 | `[references/config-files.md](references/config-files.md)` | 相對路徑 (Relative Path) | 指向設定檔解析規則連結。 |
| 52 | `[references/windows.md](references/windows.md)` | 相對路徑 (Relative Path) | 指向 Windows 平台規範連結。 |
| 145 | `[references/windows.md §1](references/windows.md)` | 相對路徑 (Relative Path) | 步驟 2 指向 BOM 預檢規範連結。 |
| 247 | `[references/config-files.md](references/config-files.md)` | 相對路徑 (Relative Path) | 步驟 5 指向設定檔合併機制連結。 |
| 248 | `[references/windows.md](references/windows.md) §1` | 相對路徑 (Relative Path) | 步驟 5 指向 BOM 編碼鐵則連結。 |
| 253 | `[references/windows.md §1](references/windows.md)` | 相對路徑 (Relative Path) | 步驟 5 指向 BOM 驗證流程連結。 |
| 272 | `[references/windows.md §6](references/windows.md)` | 相對路徑 (Relative Path) | 步驟 6 指向靜默 sh.exe 編譯步驟連結。 |
| 280 | `[references/pitfalls.md](references/pitfalls.md)` | 相對路徑 (Relative Path) | 步驟 7 指向故障診斷中提及之陷阱 #9 連結。 |
| 286 | `[references/pitfalls.md](references/pitfalls.md)` | 相對路徑 (Relative Path) | 🚨 常見陷阱速查對照表連結。 |

### 2.2 對 `scripts` 的引用
| 行號 | 引用內容 (Code Snippet) | 類型 | 說明 |
| :--- | :--- | :--- | :--- |
| 257 | `...讀取本外掛 scripts/ 資料夾（相對於本外掛根目錄為 scripts/）中的對應腳本檔案...` | 相對路徑 (Relative Path) | 部署 Hook 腳本之安全禁令描述。 |
| 260 | `1. 優先讀取當前工作區（Workspace）根目錄下的 scripts/<filename>` | 相對路徑 (Relative Path) | 優先的路由讀取來源描述。 |
| 261 | `2. 若不存在或在其他工作區，退回從本外掛安裝目錄下的 scripts/<filename> 讀取。` | 相對路徑 (Relative Path) | 退回的路由讀取來源描述。 |
| 262 | `~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/scripts/<filename>` | 絕對路徑範例 (Absolute Path Example) | macOS/Linux 環境之本機外掛腳本安裝絕對路徑範例。 |
| 263 | `%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-cli-statusline\scripts\<filename>` | 絕對路徑範例 (Absolute Path Example) | Windows 環境之本機外掛腳本安裝絕對路徑範例。 |
| 272 | `（從 scripts/sh_hidden.cs 編譯）` | 相對路徑 (Relative Path) | 說明 Windows 靜默 sh.exe 原始碼檔案來源。 |
| 280 | `node scripts/diagnose-statusline.mjs` | 相對路徑指令 (Relative Path Command) | 故障診斷引導之執行指令範例。 |
| 289 | `必須從本外掛的 scripts/ 讀取原文部署` | 相對路徑 (Relative Path) | 常見陷阱之速記鐵則描述。 |

---

## 3. 重構計畫與策略 (Refactoring Plan and Strategy)

為了精簡專案架構並統一將資源歸檔於 `skills/antigravity-cli-statusline/` 目錄，以下為重構策略規劃。

### 3.1 檔案搬移策略 (File Migration Strategy)
使用 Git 進行檔案搬移以保留歷史提交紀錄 (Commit History)。
```bash
# 搬移參考文件目錄
git mv references skills/antigravity-cli-statusline/references

# 搬移腳本目錄
git mv scripts skills/antigravity-cli-statusline/scripts
```
移動後，新專案結構將符合 `PROJECT.md` 規章：
```text
skills/antigravity-cli-statusline/
├── SKILL.md
├── references/
│   ├── config-files.md
│   ├── pitfalls.md
│   └── windows.md
└── scripts/
    ├── diagnose-statusline.mjs
    ├── fetch-local-quota.mjs
    ├── sh_hidden.cs
    └── statusline-quota.mjs
```

### 3.2 替代路徑對照表 (Path Replacement Mapping Table)

重構後，必須更新專案中所有相關的路徑參考，以確保相對連結正常且安裝路徑範例符合新版標準。

#### 3.2.1 SKILL.md 內部路徑更新對照表
| 檔案位置 | 類型 | 原始內容 (Before) | 變更後內容 (After) | 變更說明 |
| :--- | :--- | :--- | :--- | :--- |
| `SKILL.md` (全檔) | Markdown 連結 | `(references/windows.md)` | `(references/windows.md)` | **不需變更**。<br>原連結在原本結構中實際上無法運作，重構搬移後，`references/` 與 `SKILL.md` 成為同層目錄，原相對連結將自動變得可用。 |
| `SKILL.md` (全檔) | Markdown 連結 | `(references/config-files.md)` | `(references/config-files.md)` | **不需變更**（同上）。 |
| `SKILL.md` (全檔) | Markdown 連結 | `(references/pitfalls.md)` | `(references/pitfalls.md)` | **不需變更**（同上）。 |
| `SKILL.md` (L257) | 說明文字 | `相對於本外掛根目錄為 scripts/` | `相對於本外掛根目錄為 skills/antigravity-cli-statusline/scripts/` | 更新外掛目錄下之腳本正確相對路徑。 |
| `SKILL.md` (L260) | 說明文字 | `當前工作區（Workspace）根目錄下的 scripts/<filename>` | `當前工作區（Workspace）根目錄下的 skills/antigravity-cli-statusline/scripts/<filename>` | 更新工作區（專案）的腳本搜尋路徑。 |
| `SKILL.md` (L261) | 說明文字 | `本外掛安裝目錄下的 scripts/<filename>` | `本外掛安裝目錄下的 skills/antigravity-cli-statusline/scripts/<filename>` | 更新本機外掛安裝目錄之退回搜尋路徑。 |
| `SKILL.md` (L262) | 絕對路徑 | `~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/scripts/<filename>` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/<filename>` | **更新為新標準路徑格式**。 |
| `SKILL.md` (L263) | 絕對路徑 | `%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-cli-statusline\scripts\<filename>` | `%USERPROFILE%\.gemini\config\plugins\antigravity-cli-statusline\skills\antigravity-cli-statusline\scripts\<filename>` | **更新為新標準路徑格式**。 |
| `SKILL.md` (L272) | 說明文字 | `scripts/sh_hidden.cs` | `skills/antigravity-cli-statusline/scripts/sh_hidden.cs` | 更新 Windows 橋接器之專案相對路徑。 |
| `SKILL.md` (L280) | 指令說明 | `node scripts/diagnose-statusline.mjs` | `node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs` | 更新故障診斷腳本執行路徑。 |
| `SKILL.md` (L289) | 說明文字 | `scripts/` | `skills/antigravity-cli-statusline/scripts/` | 更新避坑指南之腳本資料夾參考路徑。 |

#### 3.2.2 其它關聯參考檔案更新對照表
除了 `SKILL.md`，以下關聯參考檔案中的對應內容亦須一併調整：

| 檔案位置 | 原始內容 (Before) | 變更後內容 (After) | 變更說明 |
| :--- | :--- | :--- | :--- |
| `references/pitfalls.md` (L23) | `scripts/` 目錄... `scripts/*.mjs` | `skills/antigravity-cli-statusline/scripts/` 目錄... `skills/antigravity-cli-statusline/scripts/*.mjs` | 更新避坑對照表中之腳本來源描述。 |
| `references/pitfalls.md` (L24) | `node scripts/diagnose-statusline.mjs` | `node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs` | 更新避坑對照表中的診斷工具指令。 |
| `references/windows.md` (L163) | `scripts/sh_hidden.cs` | `skills/antigravity-cli-statusline/scripts/sh_hidden.cs` | 更新 Windows 橋接原始碼工作區優先路徑。 |
| `references/windows.md` (L164) | `scripts/sh_hidden.cs` | `skills/antigravity-cli-statusline/scripts/sh_hidden.cs` | 更新 Windows 橋接原始碼本機外掛退回路徑。 |
