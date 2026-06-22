# 變更紀錄 (Changes)

以下為本次任務所做的修改與操作清單：

## 1. 目錄結構搬移 (Directory Restructuring)
- 使用 `git mv` 將根目錄下的 `references/` 資料夾移至 `skills/antigravity-cli-statusline/references/`。
- 使用 `git mv` 將根目錄下的 `scripts/` 資料夾移至 `skills/antigravity-cli-statusline/scripts/`。

## 2. 路徑引用更新 (Path Reference Updates)
- **`skills/antigravity-cli-statusline/SKILL.md`**：
  - 更新步驟 6 中 macOS / Linux 與 Windows 的絕對路徑範例為安裝後的新標準路徑（包含 `config/` 與 `skills/antigravity-cli-statusline/`）。
  - 更新第 258、272、280、290 行的說明文字路徑。
- **`skills/antigravity-cli-statusline/references/pitfalls.md`**：
  - 更新表格中第 8、9 條陷阱（第 23、24 行）的路徑引用：
    - `scripts/` -> `skills/antigravity-cli-statusline/scripts/`
    - `node scripts/diagnose-statusline.mjs` -> `node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs`
- **`skills/antigravity-cli-statusline/references/windows.md`**：
  - 更新第 163、164 行編譯 `sh_hidden.cs` 時對 `scripts/` 的路徑引用 -> `skills/antigravity-cli-statusline/scripts/sh_hidden.cs`
- **`skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs`**：
  - 更新第 144 行 Log 輸出中所提之 `references/pitfalls.md` -> `skills/antigravity-cli-statusline/references/pitfalls.md`
- **`.github/workflows/release.yml`**：
  - 第 24-25 行移除 `cp -r scripts ...` 與 `cp -r references ...`，僅保留 `cp -r skills dist/antigravity-cli-statusline/` 及 `cp -r docs ...` 複製指令。
- **`.claude/settings.local.json`**：
  - 第 7 行更新路徑引用：`node --check scripts/statusline-quota.mjs` -> `node --check skills/antigravity-cli-statusline/scripts/statusline-quota.mjs`
- **`CONTRIBUTING.md`**：
  - 第 24、63 行更新路徑引用：`scripts/statusline-quota.mjs` -> `skills/antigravity-cli-statusline/scripts/statusline-quota.mjs`

## 3. 驗證結果 (Verification Results)
- 修改之 `.mjs` 檔案僅變更 Log 字串，結構未受破壞，基本語法正確。
- 專案程式碼與說明文件中的路徑引用皆已對齊新的外掛技能目錄結構。
