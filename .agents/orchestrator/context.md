# Context — 2026-06-23T00:39:23+08:00

## 專案背景與說明
- 專案名稱：`antigravity-cli-statusline`
- 目的：修復原始碼專案的資料夾路徑參考錯誤。
- 主要任務：
  1. 將 `references/` 與 `scripts/` 從外掛根目錄移動至 `skills/antigravity-cli-statusline/` 下。
  2. 修改 `skills/antigravity-cli-statusline/SKILL.md` 內的絕對與相對路徑。

## 目錄結構現況
- 外掛根目錄：`/Users/andyawd/Project/antigravity-cli-statusline`
- 包含檔案/資料夾：
  - `references/` (待移動)
  - `scripts/` (待移動)
  - `skills/antigravity-cli-statusline/SKILL.md` (待更新)

## 限制與規範
- 語言：台灣繁體中文。
- Git Author 偏好：`Gemini <218195315+gemini-cli@users.noreply.github.com>`。
- 不得直接修改代碼或執行 shell 命令來執行代碼變更，必須派發子代理 (Subagents) 執行。
