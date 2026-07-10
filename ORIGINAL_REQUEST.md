# Original User Request

## Initial Request — 2026-06-27T07:43:53Z

# Teamwork Project Prompt — Draft

全面審查 `antigravity-cli-statusline` 外掛，尋找並修正因 AI 動態生成或跨平台造成的潛在 Bug（延續剛才修復的英文選項截斷問題）。

Working directory: /Users/andyawd/Project/antigravity-cli-statusline

## Requirements

### R1. 全面盤點動態生成陷阱
檢查整個外掛（特別是 `SKILL.md` 與 `scripts/`）是否還有依賴 AI 動態翻譯、動態推導長陣列，或可能引發截斷、幻覺的設定，並將其改為明確的靜態定義。

### R2. 跨平台相容性複查
確認 Windows / macOS 雙平台的檔案寫入（如 `fs.writeFileSync` 是否都有防護 BOM 的邏輯）皆符合 `cross-platform-cli-skill-pitfalls` 的最高標準。

## Acceptance Criteria

### 驗證標準
- [ ] 提交的任何修改都不能破壞原本的三層設定檔寫入邏輯
- [ ] 所有修改皆需確保在切換不同語系時，AI 代理不需要自行翻譯長清單或複雜 JSON

## Follow-up — 2026-07-10T17:04:41Z

本專案旨在排查與修復 Antigravity 命令列介面（CLI）（agy）在載入狀態列（statusline）外掛（plugin）與技能（skills）時發生的衝突問題（例如全域技能目錄下殘留舊版寫死 12 功能的 `SKILL.md`，導致新版 25 功能的 `SKILL.md` 無法被人工智慧（AI）正確載入），並在執行前自動建立 Git 開發分支進行修正。

Working directory: /Users/andyawd/Project/antigravity-cli-statusline
Integrity mode: benchmark

## Requirements

### R1. Git 開發分支建立與切換
在進行任何檔案修改或排查之前，必須先以當前 `main` 分支為基礎，開立並切換至一個新的 Git 分支（例如 `feature/fix-plugin-loading-conflict`），以遵循專案的開發規範。

### R2. 排查與修復技能加載衝突
1. 分析全域技能目錄（`~/.gemini/skills/antigravity-cli-statusline`）與安裝外掛目錄（`~/.gemini/config/plugins/antigravity-cli-statusline`）下 `SKILL.md` 與 `resources/questions.json` 的檔案差異。
2. 自動備份並安全刪除舊的全域技能目錄（`~/.gemini/skills/antigravity-cli-statusline`），確保 `agy` 載入的是擁有 25 個指標的最新外掛版技能。
3. 修正專案或外掛設定以防再次發生因雙重路徑導致的載入衝突。

### R3. 驗證 GitHub Release 與 agy plugin install 機制
驗證 `agy plugin install` 下載的機制是否會自動 checkout 到最新發行（Release）標記（tag）`v1.6.0`，還是直接複製（clone）預設分支。確認最新 tag `v1.6.0` 的 `SKILL.md` 是否已是 25 個功能的新版。

## Acceptance Criteria

### Git 分支驗證
- [ ] 執行 any 實質修改前，Git 必須已成功建立並切換至新開發分支。

### 功能與加載驗證
- [ ] 移除或解決 `~/.gemini/skills/` 底下的舊版衝突後，AI 代理在重新載入此技能時，必須能正確載入 `questions.json` 中的 25 項完整指標。
- [ ] 確保在不影響其他內建技能的前提下，狀態列能正確顯示最新的二十幾項功能。
- [ ] 產出一份完整的排查報告，包含：(1) 全域與外掛目錄的衝突原因分析、(2) `agy plugin install` 下載機制之驗證結論（例如它是否指向 tag `v1.6.0` 或者是預設分支）。
