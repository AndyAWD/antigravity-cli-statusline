# 步驟 4：三欄 Markdown 對照表完整範例（Reference）

> [!NOTE]
> 本檔案為步驟 4 全選 **39 項標準指標** 時的三欄對照表完整範本（每欄 $R = \lceil 39 / 3 \rceil = 13$ 列，採直向優先 Column-major 排列）。
> 實際執行時請將以下「單行標題 ＋ 表格」先輸出至對話視窗（Chat Response），再於同一回合呼叫單行極簡版 `ask_question`（`ask_question` 規則與 JSON 範本保留於主檔 `SKILL.md`）。

---

## zh-tw 全選 39 項輸出範例（標題含填寫規則 ＋ 13 列表格）

```markdown
📋 **目前已選取的狀態列指標（共 39 項）** — *於下方 Write-in 輸入序號或代碼（如 `2, e1, n, e:quota`；純數字/`t` 為文字、`e` 為 Emoji、`n` 為換行）：*

| # | 指標名稱（識別碼） | # | 指標名稱（識別碼） | # | 指標名稱（識別碼） |
|---|---|---|---|---|---|
| **1** | 🤖 模型名稱 (`model-name`) | **14** | ✨ Argon 長條圖 (`quota-argon-bar`) | **27** | 🗃️ 版控類型 (`vcs-type`) |
| **2** | 🪪 使用中代理 (`agent-profile`) | **15** | ⏱️ Argon 倒數 (`quota-argon-countdown`) | **28** | 💾 記憶體量 (`memory-usage`) |
| **3** | ⚡ 代理狀態 (`agent-state`) | **16** | ⏰ Argon 時間 (`quota-argon-reset-time`) | **29** | 🚀 Agy CLI 版本 (`cli-version`) |
| **4** | ⚙️ 運行模式 (`mode`) | **17** | 💎 訂閱方案 (`plan-tier`) | **30** | 💬 對話 ID (`conversation-id`) |
| **5** | 🔋 五小時額度 (`quota`) | **18** | 📧 帳號信箱 (`account-email`) | **31** | 🛡️ 沙盒狀態 (`sandbox-status`) |
| **6** | 🔋 五小時長條圖 (`quota-bar`) | **19** | 🧠 脈絡比例 (`context-used`) | **32** | 🔔 工具確認框 (`tool-confirmation`) |
| **7** | ⏳ 五小時倒數 (`quota-reset-countdown`) | **20** | 🧠 脈絡長條圖 (`context-used-bar`) | **33** | 📥 待處理輸入 (`pending-input`) |
| **8** | 🕒 五小時時間 (`quota-reset-time`) | **21** | 💰 權杖數量 (`token-count`) | **34** | 🔄 背景任務數 (`background-tasks`) |
| **9** | 📅 每週額度 (`quota-weekly`) | **22** | 💰 權杖長條圖 (`token-count-bar`) | **35** | 👥 活躍子代理 (`subagents`) |
| **10** | 📅 每週長條圖 (`quota-weekly-bar`) | **23** | 📁 專案短路徑 (`project-path`) | **36** | 📄 產出檔案數 (`artifacts`) |
| **11** | ⏲️ 每週倒數 (`quota-weekly-countdown`) | **24** | 📍 專案完整路徑 (`project-full-path`) | **37** | 🧩 狀態列版本 (`plugin-version`) |
| **12** | 🗓️ 每週時間 (`quota-weekly-reset-time`) | **25** | 🔀 Git 分支 (`git-branch`) | **38** | 🆕 狀態列更新提醒 (`plugin-update`) |
| **13** | ✨ Argon 額度 (`quota-argon`) | **26** | 🔍 未提交變更 (`vcs-dirty`) | **39** | 💻 Agy 2.0 版本 (`app-version`) |
```
