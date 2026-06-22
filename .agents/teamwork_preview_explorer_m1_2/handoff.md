# Handoff Report — 2026-06-23T00:42:15+08:00

## 1. Observation (觀察)
我們直接觀察並確認了專案結構與 `SKILL.md` 的引用情況：
- **原始目錄結構**：
  - `references/` 底下包含 `config-files.md`、`pitfalls.md`、`windows.md`。
  - `scripts/` 底下包含 `diagnose-statusline.mjs`、`fetch-local-quota.mjs`、`sh_hidden.cs`、`statusline-quota.mjs`。
- **SKILL.md (於 `skills/antigravity-cli-statusline/SKILL.md`) 引用點**：
  - 原相對路徑引用形式為 `(references/windows.md)` 等。在舊架構中，由於 `SKILL.md` 位於 `skills/antigravity-cli-statusline/` 目錄，此相對路徑實則無效（無法由 `SKILL.md` 直接指向根目錄的 `references`）。
  - 第 262-263 行的絕對路徑範例為：
    - macOS/Linux: `~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/scripts/<filename>`
    - Windows: `%USERPROFILE%\.gemini\antigravity-cli\plugins\antigravity-cli-statusline\scripts\<filename>`
- **其它檔案引用點**：
  - `references/pitfalls.md` 的第 23、24 行與 `references/windows.md` 的第 163、164 行亦存在對 `scripts/` 的相對路徑參考。

## 2. Logic Chain (邏輯鏈)
- **搬移前提**：依據專案規章 `PROJECT.md` 的規劃，所有外掛附屬的 `references/` 與 `scripts/` 皆須收納至 `skills/antigravity-cli-statusline/`。
- **相對路徑自癒**：當 `references/` 移動至 `skills/antigravity-cli-statusline/references/` 時，它與 `SKILL.md`（位於 `skills/antigravity-cli-statusline/`）將成為同層目錄。此時原本無效的相對路徑 `references/windows.md` 將自然生效，因此 `SKILL.md` 中的 Markdown 連結**不需做任何相對路徑調整**即可自癒。
- **絕對路徑更新**：配合新標準安裝路徑規章，`~/.gemini/antigravity-cli/plugins/` 應更新為 `~/.gemini/config/plugins/`，並且路徑中必須包含搬移後的完整巢狀路徑。因此外掛內腳本的本機路徑範例須變更為 `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/<filename>`（Windows 同理換為 `%USERPROFILE%` 與反斜線）。
- **依賴關聯同步更新**：為確保重構徹底，`references/pitfalls.md` 與 `references/windows.md` 中引用的 `scripts/` 路徑也應同步修正為 `skills/antigravity-cli-statusline/scripts/`。

## 3. Caveats (限制與假設)
- **唯讀角色限制**：本調查為唯讀（Read-only）性質，本 agent 未實際執行任何檔案搬移或程式碼修改動作。
- **安裝路徑假設**：假設外掛安裝後的標準路徑格式與規章所述之 `~/.gemini/config/plugins/...` 100% 一致。

## 4. Conclusion (結論)
重構計畫可行且清晰。搬移檔案後，需執行以下更新（細部對照表見 `analysis.md`）：
1. 原相對連結在搬移後會自然修復，無須修改。
2. 更新 `SKILL.md` 中關於讀取來源的描述，改為指向 `skills/antigravity-cli-statusline/scripts/`。
3. 將步驟 6 的安裝絕對路徑範例更新為：
   - macOS/Linux: `~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/<filename>`
   - Windows: `%USERPROFILE%\.gemini\config\plugins\antigravity-cli-statusline\skills\antigravity-cli-statusline\scripts\<filename>`
4. 同步更新 `pitfalls.md` 與 `windows.md` 內對 `scripts/` 的路徑參照。

## 5. Verification Method (驗證方法)
搬移檔案與修改路徑後，後續的實作者（Implementer）可依以下步驟驗證：
1. **Markdown 連結有效性**：在編輯器中點擊 `SKILL.md` 中的 `references/windows.md` 等連結，確認可正確跳轉至搬移後的新路徑。
2. **搜尋無遺漏殘留**：在專案根目錄執行 grep 搜尋舊的 `scripts/` 路徑，確認皆已消除：
   ```bash
   grep -rn "scripts/" skills/antigravity-cli-statusline/
   ```
   確認沒有殘留的舊格式相對/絕對路徑。
3. **專案規章比對**：比對 `/Users/andyawd/Project/antigravity-cli-statusline/PROJECT.md`，確認新結構完全符合 Layout 規定。
