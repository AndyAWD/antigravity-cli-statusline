# Project: Antigravity CLI Statusline Cleanup Safety Fix

## Architecture
本專案為 `antigravity-cli-statusline` 清理與備份指令腳本之安全性漏洞排查與修護專案。
主要涉及：
- 清理腳本：`skills/antigravity-cli-statusline/scripts/configure-statusline.mjs`
- 舊版全域目錄：`~/.gemini/skills/antigravity-cli-statusline`
- 舊版備份路徑：`~/.gemini/skills/antigravity-cli-statusline.bak`
- 冗餘 questions.json 清除路徑：包含本機開發專案及全域配置等路徑。

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Git 開發分支建立與專案初始化 | 建立並切換至 `fix/safe-cleanup-script` 分支，更新 `PROJECT.md` | none | DONE |
| 2 | M2: 安全漏洞分析報告 | 分析 `configure-statusline.mjs` 中清理/備份舊目錄與冗餘 json 刪除邏輯的安全風險 | M1 | DONE |
| 3 | M3: 安全清理與備份實作 | 修改 `configure-statusline.mjs` 實作安全刪除，避免遞迴刪除 symlink/junction 指向內容與包含 .git 的專案目錄 | M2 | DONE |
| 4 | M4: 跨平台自動化測試實作 | 撰寫測試腳本以驗證在 macOS/Windows 上 symlink 解除連結與 .git 安全保護之正確性 | M3 | DONE |
| 5 | M5: 安全性驗證與鑑識稽核 | 執行測試、進行 Reviewer 程式碼審查、Challenger 對抗測試及 Forensic Auditor 稽核 | M4 | DONE |
| 6 | M6: 報告撰寫與 Parent 回報 | 撰寫排查修復報告並提交給 parent (Sentinel) 進行最終 Victory Auditor 稽核 | M5 | DONE |

## Code Layout
- `.agents/` — 代理人協調中介資料與報告
- `skills/antigravity-cli-statusline/` — 外掛與技能目錄
  - `scripts/configure-statusline.mjs` — 配置與部署掛鉤腳本（待修補）
  - `scripts/configure-statusline.test.mjs` — 跨平台安全性自動化測試腳本（待建立）
