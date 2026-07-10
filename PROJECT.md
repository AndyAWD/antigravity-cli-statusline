# Project: Antigravity CLI Statusline Conflict Resolution

## Architecture
本專案為 `antigravity-cli-statusline` 外掛與技能衝突排查與修復專案。
主要涉及：
- 全域技能目錄：`~/.gemini/skills/antigravity-cli-statusline`
- 外掛安裝目錄：`~/.gemini/config/plugins/antigravity-cli-statusline`
- 專案根目錄（開發目錄）：`/Users/andyawd/Project/antigravity-cli-statusline`
- 本機備份目錄：`~/.gemini/skills/antigravity-cli-statusline.bak`

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Git 開發分支建立 | 開立並切換至 `feature/fix-plugin-loading-conflict` 分支 | none | DONE |
| 2 | M2: 目錄檔案差異分析 | 分析全域與安裝外掛目錄下 `SKILL.md` 與 `questions.json` 差異 | M1 | DONE |
| 3 | M3: 備份與安全刪除 | 自動備份並安全刪除舊全域技能目錄，確保 agy 載入 25 個最新指標的技能 | M2 | PLANNED |
| 4 | M4: 設定修正防衝突 | 修正專案或外掛設定，避免再次發生雙重路徑載入衝突 | M3 | PLANNED |
| 5 | M5: 驗證機制 | 驗證 GitHub Release 與 `agy plugin install` 是否自動 checkout 到 `v1.6.0` 標記或 clone 預設分支，確認 `SKILL.md` 為新版 | M4 | PLANNED |
| 6 | M6: 排查報告撰寫 | 撰寫完整排查報告並遞交給 Parent | M5 | PLANNED |

## Code Layout
- `.agents/` — 代理人協調中介資料與報告
- `skills/antigravity-cli-statusline/` — 外掛最新版技能目錄
  - `SKILL.md` — 25 項指標技能說明檔
  - `resources/questions.json` — 25 項指標定義檔
