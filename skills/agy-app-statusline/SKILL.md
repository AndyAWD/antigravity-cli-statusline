---
name: agy-app-statusline
description: 在 Antigravity App（2.0）開啟 Statusline 即時監控與視覺化分列拖曳排版面板（查看模型額度、脈絡權杖分解、Git 狀態、代理活動與自訂排序／語系）。適用於使用者在 Antigravity App 要求開啟狀態列面板、檢視額度或權杖明細，或輸入 /antigravity-cli-statusline:agy-app-statusline 時。
---

# Antigravity App Statusline 視覺化面板

本技能用於在 **Antigravity App（2.0）** 直接開啟交互式狀態列監控與分列拖曳排版面板（**不需執行任何 `ask_question` 問卷**）。

## 執行步驟

1. **直接呼叫 `statusline_dashboard` 工具**（不傳必填參數，或僅依需求帶入 `forceRefresh: true`），在右側輔助面板開啟 **Statusline**。
2. 告知使用者也可從以下入口隨時開啟：
   - 對話右上角 **Overview > Plugins > Statusline** 或側邊欄 **`+`** 選單（右側輔助面板）。
   - 左側導覽列 **Plugins > Statusline**（全頁寬版儀表板）。
3. **若目前處於 Antigravity CLI（`agy`）**：`statusline_dashboard` 會回傳純文字狀態摘要；若使用者要設定 CLI 底部狀態列，請引導改執行 `/antigravity-cli-statusline:agy-cli-statusline`。
