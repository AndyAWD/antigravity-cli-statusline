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
