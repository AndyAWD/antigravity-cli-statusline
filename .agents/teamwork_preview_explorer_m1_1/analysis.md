# 專案路徑重構分析報告（Refactoring Analysis Report）

本報告針對 `antigravity-cli-statusline` 專案中之輔助資源資料夾——參考文件資料夾（references/）與指令碼資料夾（scripts/）的重構（Refactoring）進行調查與分析，旨在將其移動至技能（Skill）目錄 `skills/antigravity-cli-statusline/` 之下，以達到自我包含（Self-contained）的模組化封裝，並修正外掛（Plugin）安裝後的路徑參考錯誤。

---

## 1. 原始檔案結構清單（Original Directory Structure）

專案根目錄下之 `references` 與 `scripts` 的檔案結構如下：

### 參考文件資料夾 `references/`
- `references/config-files.md` (5,766 位元組) — 描述三層設定檔結構、`statusLine` 物件與 `trusted_hooks.json` 信任機制（Trust Mechanism）。
- `references/pitfalls.md` (4,102 位元組) — 狀態列設定常見陷阱對照表。
- `references/windows.md` (9,110 位元組) — Windows 平台的特定系統規範與 `sh.exe` 缺失處理。

### 指令碼資料夾 `scripts/`
- `scripts/diagnose-statusline.mjs` (8,307 位元組) — 狀態列故障診斷指令碼。
- `scripts/fetch-local-quota.mjs` (8,761 位元組) — 獲取本地 API 額度之指令碼。
- `scripts/statusline-quota.mjs` (27,651 位元組) — 狀態列的核心 Hook 指令碼。
- `scripts/sh_hidden.cs` (763 位元組) — Windows 平台用來編譯靜默 `sh.exe` 之 C# 原始碼。

---

## 2. 技能說明文件 `SKILL.md` 中的路徑引用清單

位於 `skills/antigravity-cli-statusline/SKILL.md` 檔案中，共有 9 處引用了 `references/`，以及 5 處引用了 `scripts/`：

### 2.1 引用 `references/` 的地方（共 9 處）
1. **第 13 行**：`-[`references/windows.md`](references/windows.md) — Windows 特定規範...`（相對路徑連結）
2. **第 14 行**：`-[`references/config-files.md`](references/config-files.md) — 三層設定檔結構...`（相對路徑連結）
3. **第 15 行**：`-[`references/pitfalls.md`](references/pitfalls.md) — 常見陷阱對照表`（相對路徑連結）
4. **第 33 行**：`...完整路徑解析規則、JSON 結構、跨電腦移植雙保險設計詳見 [references/config-files.md](references/config-files.md)。`（相對路徑連結）
5. **第 52 行**：`...Windows 平台的 BOM 鐵則...規範詳見 [references/windows.md](references/windows.md)。`（相對路徑連結）
6. **第 145-146 行**：`...詳見 [references/windows.md §1](references/windows.md) 與 §3。`（相對路徑連結）
7. **第 247 行**：`...trusted_hooks.json 信任機制細節...→ 詳見 [references/config-files.md](references/config-files.md)`（相對路徑連結）
8. **第 248 行**：`...保證不帶 BOM 的替代方案）→ 詳見 [references/windows.md](references/windows.md) §1`（相對路徑連結）
9. **第 253-254 行**：`...本步驟必須一併執行剝除流程。詳見 [references/windows.md §1](references/windows.md)。`（相對路徑連結）

### 2.2 引用 `scripts/` 的地方（共 5 處）
1. **第 258 行**：`...必須 100% 準確地讀取本外掛 scripts/ 資料夾（相對於本外掛根目錄為 scripts/）中的對應腳本檔案...`（說明文字）
2. **第 261 行**：`1. 優先讀取當前工作區（Workspace）根目錄下的 scripts/<filename>`（說明文字）
3. **第 262-264 行（步驟 6 讀取來源之絕對路徑範例，重構重點）**：
   - 描述：`2. 若不存在或在其他工作區，退回從本外掛安裝目錄下的 scripts/<filename> 讀取。AI 代理應動態推導真實絕對路徑，例如：`
   - macOS / Linux：`~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/scripts/<filename>`
   - Windows：`%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-cli-statusline\scripts\<filename>`
4. **第 272 行**：`...完整步驟（從 scripts/sh_hidden.cs 編譯）詳見 references/windows.md §6。`（說明文字與路徑）
5. **第 280 行**：`...請前往本外掛目錄執行 node scripts/diagnose-statusline.mjs，...`（說明文字與路徑）
6. **第 290 行**：`3. 絕對禁止憑空生成 Hook 腳本，必須從本外掛的 scripts/ 讀取原文部署`（說明文字）

---

## 3. 其他檔案中的路徑引用清單

除了 `SKILL.md` 之外，其餘檔案亦有下列引用：

### 3.1 參考文件內的引用 `references/`
- **`references/pitfalls.md` 第 23 行**：`...必須 100% 準確讀取本技能 scripts/ 目錄下的對應檔案...`
- **`references/pitfalls.md` 第 24 行**：`...立即執行 node scripts/diagnose-statusline.mjs 抓現場證據...`
- **`references/windows.md` 第 163 行**：`- 優先讀取當前工作區根目錄下 scripts/sh_hidden.cs`
- **`references/windows.md` 第 164 行**：`- 若不存在或在其他工作區，退回從本外掛根目錄 scripts/sh_hidden.cs 讀取`

### 3.2 診斷指令碼內的引用 `scripts/`
- **`scripts/diagnose-statusline.mjs` 第 144 行**：`findings.push('   → 高度符合 references/pitfalls.md 陷阱 #2 / #9 的徵兆...');`

### 3.3 GitHub 工作流程（Workflow）
- **`.github/workflows/release.yml` 第 24-25 行**：
  ```yaml
  cp -r scripts dist/antigravity-cli-statusline/
  cp -r references dist/antigravity-cli-statusline/
  ```

---

## 4. 重構計畫與路徑對照表（Refactoring Plan & Mapping）

### 4.1 檔案與資料夾搬移策略
將根目錄下的 `references/` 與 `scripts/` 移動至 `skills/antigravity-cli-statusline/` 目錄中。
移動後新實體路徑：
- `/Users/andyawd/Project/antigravity-cli-statusline/skills/antigravity-cli-statusline/references/`
- `/Users/andyawd/Project/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/`

### 4.2 替代路徑對照表（Path Mapping）

| 原始路徑類型 | 原始路徑表示 | 重構後目標路徑表示 | 備註說明 |
|---|---|---|---|
| **專案實體資料夾** | `/references/` | `/skills/antigravity-cli-statusline/references/` | 移動實體資料夾 |
| **專案實體資料夾** | `/scripts/` | `/skills/antigravity-cli-statusline/scripts/` | 移動實體資料夾 |
| **相對路徑引用 (SKILL.md)** | `references/windows.md` | `references/windows.md` | 因 `SKILL.md` 與 `references/` 移至同層目錄，相對路徑正好保持不變 |
| **相對路徑引用 (SKILL.md)** | `references/config-files.md` | `references/config-files.md` | 同上 |
| **相對路徑引用 (SKILL.md)** | `references/pitfalls.md` | `references/pitfalls.md` | 同上 |
| **絕對路徑範例 (SKILL.md macOS)** | `~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/scripts/<filename>` | `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/<filename>` | 修正外掛安裝後的標準路徑（移至 `config/` 下，並加上技能多層目錄） |
| **絕對路徑範例 (SKILL.md Windows)** | `%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-cli-statusline\scripts\<filename>` | `%USERPROFILE%\.gemini\config\plugins\antigravity-cli-statusline\skills\antigravity-cli-statusline\scripts\<filename>` | 同上 |
| **相對路徑說明 (windows.md)** | `scripts/sh_hidden.cs` | `skills/antigravity-cli-statusline/scripts/sh_hidden.cs` | 更新 Windows 參考文件中對本外掛預設腳本的路徑描述 |
| **相對路徑說明 (pitfalls.md)** | `node scripts/diagnose-statusline.mjs` | `node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs` | 更新常見陷阱對照表中的診斷指令執行路徑描述 |
| **相對路徑說明 (diagnose-statusline.mjs)** | `references/pitfalls.md` | `skills/antigravity-cli-statusline/references/pitfalls.md` | 更新診斷工具輸出 Log 中所提的參考文件路徑 |

---

## 5. 具體重構更新內容建議（精確編輯說明）

### 5.1 修改 `skills/antigravity-cli-statusline/SKILL.md`

#### 修改點 A：步驟 6 讀取來源（退回絕對路徑）
- **修改前**（第 262-264 行）：
  ```markdown
     - macOS / Linux：`~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/scripts/<filename>`
     - Windows：`%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-cli-statusline\scripts\<filename>`
  ```
- **修改後**：
  ```markdown
     - macOS / Linux：`~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/<filename>`
     - Windows：`%USERPROFILE%\.gemini\config\plugins\antigravity-cli-statusline\skills\antigravity-cli-statusline\scripts\<filename>`
  ```

#### 修改點 B：步驟 7 故障診斷指引路徑
- **修改前**（第 280 行）：
  ```markdown
  ...執行 `node scripts/diagnose-statusline.mjs`，並把完整輸出...
  ```
- **修改後**：
  ```markdown
  ...執行 `node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs`，並把完整輸出...
  ```

---

### 5.2 修改 `references/pitfalls.md`（移動後之路徑修正）

#### 修改點 A：第 23 行
- **修改前**：
  ```markdown
  ...必須 100% 準確讀取本技能 `scripts/` 目錄下的對應檔案原文部署...
  ```
- **修改後**：
  ```markdown
  ...必須 100% 準確讀取本技能 `skills/antigravity-cli-statusline/scripts/` 目錄下的對應檔案原文部署...
  ```

#### 修改點 B：第 24 行
- **修改前**：
  ```markdown
  ...立即執行 `node scripts/diagnose-statusline.mjs` 抓現場證據...
  ```
- **修改後**：
  ```markdown
  ...立即執行 `node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs` 抓現場證據...
  ```

---

### 5.3 修改 `references/windows.md`（移動後之路徑修正）

#### 修改點 A：第 164 行
- **修改前**：
  ```markdown
     - 若不存在或在其他工作區，退回從本外掛根目錄 `scripts/sh_hidden.cs` 讀取
  ```
- **修改後**：
  ```markdown
     - 若不存在或在其他工作區，退回從本外掛安裝目錄下 `skills/antigravity-cli-statusline/scripts/sh_hidden.cs` 讀取
  ```

---

### 5.4 修改 `scripts/diagnose-statusline.mjs`（移動後之 Log 輸出路徑修正）

#### 修改點 A：第 144 行
- **修改前**：
  ```javascript
      findings.push('   → 高度符合 references/pitfalls.md 陷阱 #2 / #9 的徵兆（可能是 /model 指令覆寫所致）');
  ```
- **修改後**：
  ```javascript
      findings.push('   → 高度符合 skills/antigravity-cli-statusline/references/pitfalls.md 陷阱 #2 / #9 的徵兆（可能是 /model 指令覆寫所致）');
  ```

---

### 5.5 修改 `.github/workflows/release.yml`

#### 修改點 A：移除無效的複製指令（第 24-25 行）
- **修改前**：
  ```yaml
            cp -r skills dist/antigravity-cli-statusline/
            cp -r scripts dist/antigravity-cli-statusline/
            cp -r references dist/antigravity-cli-statusline/
  ```
- **修改後**（因為搬移後，`references` 與 `scripts` 已整合進 `skills/` 中，僅需保留 `cp -r skills`）：
  ```yaml
            cp -r skills dist/antigravity-cli-statusline/
  ```

---

## 6. 結論與重構效益

本重構方案將所有的腳本與參考文件，移入符合外掛框架規範的 `skills/antigravity-cli-statusline/` 目錄中，並將退回的絕對路徑修正為最新的標準使用者設定路徑 `~/.gemini/config/plugins/`。

**效益如下**：
1. **符合封裝（Encapsulation）**：外掛的程式碼、指令碼、以及參考文件將會 100% 局限於自身技能目錄下，不會污染外掛根目錄。
2. **修復路徑 Bug**：AI 代理在讀取退回的 Hook 指令碼時，能夠成功根據最新的標準路徑定位到 `scripts/` 的檔案，防止自動部署失敗。
3. **簡化 CI/CD**：發布打包時只需單一 `cp -r skills` 指令即可，無需額外複製散落的資料夾。
