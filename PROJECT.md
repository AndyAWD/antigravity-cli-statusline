# Project: Antigravity CLI Statusline Review & Fixes

## Architecture
本專案為 `antigravity-cli-statusline` 外掛，提供 Antigravity CLI（agy）狀態列顯示指標。主要邏輯位於 `skills/antigravity-cli-statusline/` 中，包含：
- `SKILL.md`: 外掛之技能說明與核心指示
- `scripts/statusline-quota.mjs`, `scripts/fetch-local-quota.mjs`: 動態配額與指標收集腳本
- `scripts/diagnose-statusline.mjs`, `scripts/test-counters.mjs`: 測試與診斷腳本

## Milestones
| # | Name | Scope | Dependencies | Status | Conversation ID |
|---|------|-------|-------------|--------|-----------------|
| 1 | Milestone 1: Exploration | 診斷盤點 `SKILL.md` 及 `scripts/` 下的動態生成與跨平台寫入 (BOM) 問題 | None | DONE | 6b06ab94-0b69-4f64-a220-240263ce8815 |
| 2 | Milestone 2: Implementation | 修正所發現之動態生成陷阱 (R1) 與跨平台檔案寫入 bug (R2) | Milestone 1 | IN_PROGRESS (Gen 2) | 1f9e1f85-2db1-4bf3-b702-23986dfac472 |
| 3 | Milestone 3: Verification & Audit | 進行 Reviewer 審查、Challenger 測試與 Forensic Auditor 完整性審計 | Milestone 2 | PLANNED | - |

## Interface Contracts
- 外掛與 Antigravity CLI 之間透過狀態列設定機制（如三層 `settings.json` 與 `trusted_hooks.json`）進行整合。
- 指標腳本輸出格式必須符合 CLI 狀態列解析之 JSON 或文字格式。
- `statusline-quota.mjs` 與 `fetch-local-quota.mjs` 等腳本之跨平台檔案寫入操作需確保不被 BOM 污染。
