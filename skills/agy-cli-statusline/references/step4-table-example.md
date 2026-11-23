# 步驟 4：三欄 Markdown 對照表完整範例（Reference）

> [!NOTE]
> 本檔案為步驟 4 全選 **40 項標準指標** 時的三欄對照表完整範本（每欄 $R = \lceil 40 / 3 \rceil = 14$ 列，採直向優先 Column-major 排列）。
> 實際執行時請將以下「單行標題 ＋ 表格」先輸出至對話視窗（Chat Response），再於同一回合呼叫單行極簡版 `ask_question`（`ask_question` 規則與 JSON 範本保留於主檔 `SKILL.md`）。

---

## zh-tw 全選 40 項輸出範例（標題含填寫規則 ＋ 14 列表格）

```markdown
📋 **目前已選取的狀態列指標（共 40 項）** — *於下方 Write-in 輸入序號或代碼（如 `2, e1, n, e:quota`；純數字/`t` 為文字、`e` 為 Emoji、`n` 為換行）：*

| # | 指標名稱（識別碼） | # | 指標名稱（識別碼） | # | 指標名稱（識別碼） |
|---|---|---|---|---|---|
| **1** | 🤖 模型名稱 (`model-name`) | **15** | ✨ Argon 長條圖 (`quota-argon-bar`) | **29** | 💾 記憶體量 (`memory-usage`) |
| **2** | 🪪 使用中代理 (`agent-profile`) | **16** | ⏱️ Argon 倒數 (`quota-argon-countdown`) | **30** | 🚀 Agy CLI 版本 (`cli-version`) |
| **3** | ⚡ 代理狀態 (`agent-state`) | **17** | ⏰ Argon 時間 (`quota-argon-reset-time`) | **31** | 💬 對話 ID (`conversation-id`) |
| **4** | ⚙️ 運行模式 (`mode`) | **18** | 💎 訂閱方案 (`plan-tier`) | **32** | 🛡️ 沙盒狀態 (`sandbox-status`) |
| **5** | 🧭 協調器 (`active-model`) | **19** | 📧 帳號信箱 (`account-email`) | **33** | 🔔 工具確認框 (`tool-confirmation`) |
| **6** | 🔋 五小時額度 (`quota`) | **20** | 🧠 脈絡比例 (`context-used`) | **34** | 📥 待處理輸入 (`pending-input`) |
| **7** | 🔋 五小時長條圖 (`quota-bar`) | **21** | 🧠 脈絡長條圖 (`context-used-bar`) | **35** | 🔄 背景任務數 (`background-tasks`) |
| **8** | ⏳ 五小時倒數 (`quota-reset-countdown`) | **22** | 💰 權杖數量 (`token-count`) | **36** | 👥 活躍子代理 (`subagents`) |
| **9** | 🕒 五小時時間 (`quota-reset-time`) | **23** | 💰 權杖長條圖 (`token-count-bar`) | **37** | 📄 產出檔案數 (`artifacts`) |
| **10** | 📅 每週額度 (`quota-weekly`) | **24** | 📁 專案短路徑 (`project-path`) | **38** | 🧩 狀態列版本 (`plugin-version`) |
| **11** | 📅 每週長條圖 (`quota-weekly-bar`) | **25** | 📍 專案完整路徑 (`project-full-path`) | **39** | 🆕 狀態列更新提醒 (`plugin-update`) |
| **12** | ⏲️ 每週倒數 (`quota-weekly-countdown`) | **26** | 🔀 Git 分支 (`git-branch`) | **40** | 💻 Agy 2.0 版本 (`app-version`) |
| **13** | 🗓️ 每週時間 (`quota-weekly-reset-time`) | **27** | 🔍 未提交變更 (`vcs-dirty`) | | |
| **14** | ✨ Argon 額度 (`quota-argon`) | **28** | 🗃️ 版控類型 (`vcs-type`) | | |
```
