# Original User Request

## Initial Request — 2026-06-23T00:39:04+08:00

修復 `antigravity-cli-statusline` 原始碼專案（Source Repository）的資料夾路徑參考錯誤，確保未來安裝此外掛時，AI 執行技能能正確讀取到 `references` 與 `scripts` 資料夾。

Working directory: /Users/andyawd/Project/antigravity-cli-statusline
Integrity mode: development

## Requirements

### R1. 重構輔助資源資料夾結構
目前的專案中，`references` 與 `scripts` 位於外掛根目錄，請將這兩個資料夾移動至標準的技能目錄內：`skills/antigravity-cli-statusline/`。

### R2. 更新 `SKILL.md` 內的絕對/相對路徑
1. 更新步驟 6 中的絕對路徑範例，反映安裝後的新標準路徑（`~/.gemini/config/plugins/...`）。
2. 更新說明，指示 AI 讀取「本技能」內的腳本，而非「本外掛」根目錄。

## Acceptance Criteria

### 路徑與執行正確性
- [ ] 原始專案的 `references` 與 `scripts` 必須位在 `skills/antigravity-cli-statusline/` 內。
- [ ] `SKILL.md` 內的參考連結必須能成功對應到重構後的位置。
