# Plan — 2026-06-23T00:39:23+08:00

## 執行步驟

### 階段一：準備與規劃
1. **建立狀態檔案**：包括 `plan.md`、`context.md`、`PROJECT.md`。
2. **啟動心跳定時任務 (Heartbeat)**：以確保持續運作及異常偵測。

### 階段二：探索與設計 (Explorer)
1. **派發探索者代理 (Explorer)**：
   - 分析 `references/` 與 `scripts/` 的現有內容。
   - 分析 `skills/antigravity-cli-statusline/SKILL.md` 中所有引用到 `references/` 與 `scripts/` 的絕對與相對路徑。
   - 分析步驟 6 中的絕對路徑範例，並設計重構方案。
2. **設計重構與修改策略**：由 Explorer 報告並核准。

### 階段三：實作與執行 (Worker)
1. **派發工作者代理 (Worker)**：
   - 將 `references/` 與 `scripts/` 資料夾移動到 `skills/antigravity-cli-statusline/` 內。
   - 根據設計策略，更新 `skills/antigravity-cli-statusline/SKILL.md` 內的所有相關路徑，包括步驟 6 中的安裝後標準路徑（`~/.gemini/config/plugins/...`）。
   - 確保 Git 提交的 Author 正確設定。

### 階段四：審查、挑戰與審計 (Reviewer / Challenger / Auditor)
1. **派發審查者代理 (Reviewer)**：審查路徑修改是否正確，檔案移動是否完整。
2. **派發挑戰者代理 (Challenger)**：確認是否有任何遺漏的路徑，或是有壞掉的連結。
3. **派發法遵審計代理 (Forensic Auditor)**：審計是否含有硬編碼、虛假實作或違反誠信原則的行為，確保一切皆為真實實作。

### 階段五：完成與回報
1. **向 Sentinel 回報專案完成**。
