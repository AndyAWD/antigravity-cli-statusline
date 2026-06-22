## 2026-06-23T00:42:46+08:00
【任務目標】將 `references` 與 `scripts` 移動至 `skills/antigravity-cli-statusline/` 目錄中，並更新所有相關檔案中的相對與絕對路徑引用，隨後進行 Git 提交。

【您的身分與工作目錄】
- Archetype: teamwork_preview_worker
- Role: Worker M2 1
- 工作目錄: /Users/andyawd/Project/antigravity-cli-statusline/.agents/teamwork_preview_worker_m2_1
- 專案根目錄: /Users/andyawd/Project/antigravity-cli-statusline
- 綜合分析報告: /Users/andyawd/Project/antigravity-cli-statusline/.agents/orchestrator/synthesis.md

【具體實作任務】
1. **目錄結構搬移**：
   - 透過 Git 指令將根目錄下的 `references/` 資料夾移至 `skills/antigravity-cli-statusline/references/`。
   - 透過 Git 指令將根目錄下的 `scripts/` 資料夾移至 `skills/antigravity-cli-statusline/scripts/`。
   - 範例指令：`git mv references skills/antigravity-cli-statusline/` 與 `git mv scripts skills/antigravity-cli-statusline/`。
2. **路徑引用更新**（請使用 replace_file_content 進行編輯）：
   - **`skills/antigravity-cli-statusline/SKILL.md`**：
     - 更新步驟 6 中 macOS / Linux 與 Windows 的絕對路徑範例為安裝後的新標準路徑（加上 `config/` 與 `skills/antigravity-cli-statusline/`）：
       - macOS / Linux：`~/.gemini/config/plugins/antigravity-cli-statusline/skills/antigravity-cli-statusline/scripts/<filename>`
       - Windows：`%USERPROFILE%\.gemini\config\plugins\antigravity-cli-statusline\skills\antigravity-cli-statusline\scripts\<filename>`
     - 修正第 258、272、280、290 行的說明文字路徑。
   - **`skills/antigravity-cli-statusline/references/pitfalls.md`**：
     - 更新第 23 行：`scripts/` -> `skills/antigravity-cli-statusline/scripts/`
     - 更新第 24 行：`node scripts/diagnose-statusline.mjs` -> `node skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs`
   - **`skills/antigravity-cli-statusline/references/windows.md`**：
     - 更新第 164 行：`scripts/sh_hidden.cs` -> `skills/antigravity-cli-statusline/scripts/sh_hidden.cs`
   - **`skills/antigravity-cli-statusline/scripts/diagnose-statusline.mjs`**：
     - 更新第 144 行 Log 輸出中所提之 `references/pitfalls.md` -> `skills/antigravity-cli-statusline/references/pitfalls.md`
   - **`.github/workflows/release.yml`**：
     - 第 24-25 行移除 `cp -r scripts ...` 與 `cp -r references ...`，僅保留 `cp -r skills dist/antigravity-cli-statusline/` 複製指令。
   - **`.claude/settings.local.json`**：
     - 第 7 行：`node --check scripts/statusline-quota.mjs` -> `node --check skills/antigravity-cli-statusline/scripts/statusline-quota.mjs`
   - **`CONTRIBUTING.md`**：
     - 第 24、63 行：`scripts/statusline-quota.mjs` -> `skills/antigravity-cli-statusline/scripts/statusline-quota.mjs`
3. **驗證**：
   - 執行基本語法檢查：對修改後的 `.mjs` 檔案執行 `node --check` 確保無語法錯誤。
   - 執行 `git status` 與 `git diff` 驗證修改成果。
4. **Git 提交**：
   - 暫存所有變更，並提交。
   - **注意：提交作者（Author）必須指定為：`Gemini <218195315+gemini-cli@users.noreply.github.com>`。**
   - 範例指令：`git commit --author="Gemini <218195315+gemini-cli@users.noreply.github.com>" -m "refactor: 將 references 與 scripts 搬移至技能目錄內並更新路徑引用"`
5. **產出報告與回報**：
   - 將修改清單與驗證結果寫入您工作目錄中的 `changes.md`。
   - 寫完後，寫入 `handoff.md` 並使用 `send_message` 向 Parent (ID: 12b29afd-77aa-4e2a-9385-51c2b542b6b6) 回報任務完成。
