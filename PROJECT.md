# Project: antigravity-cli-statusline Path Refactoring

## Architecture
本專案為 Antigravity CLI 的外掛，包含：
- `skills/antigravity-cli-statusline/`：包含 AI 技能 `SKILL.md`。
- `references/` (重構前)：包含參考文件。
- `scripts/` (重構前)：包含跨平台的 Node.js Hook 腳本。

重構後結構：
- `skills/antigravity-cli-statusline/references/`：放置重構後的參考文件。
- `skills/antigravity-cli-statusline/scripts/`：放置重構後的 Node.js Hook 腳本。
- `skills/antigravity-cli-statusline/SKILL.md`：更新所有路徑以指向上述重構後的位置，並更新步驟 6 的絕對路徑為安裝後標準路徑（`~/.gemini/config/plugins/...`）。

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: 探索分析 | 探索當前 `references`、`scripts` 內容，以及 `SKILL.md` 中的所有相對與絕對路徑參考。 | None | DONE |
| 2 | M2: 重構與更新 | 移動資料夾，並更新 `SKILL.md` 中的相對與絕對路徑。 | M1 | IN_PROGRESS |
| 3 | M3: 審查與驗證 | 審查變更、執行測試、透過 Auditor 進行誠信審計。 | M2 | PLANNED |

## Code Layout
- `skills/antigravity-cli-statusline/SKILL.md`
- `skills/antigravity-cli-statusline/references/`
- `skills/antigravity-cli-statusline/scripts/`
