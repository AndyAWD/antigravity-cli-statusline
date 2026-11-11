# antigravity-cli-statusline

[English](README.md) | 繁體中文 | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

[![版本](https://img.shields.io/badge/版本-1.11.1-blue.svg)](skills/agy-cli-statusline/SKILL.md)
[![授權條款: MIT](https://img.shields.io/badge/授權條款-MIT-yellow.svg)](LICENSE)
[![平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

一個專為 Google Antigravity（AGY）設計的外掛程式（Plugin），用於客製化 Antigravity 命令列介面（Command-Line Interface）（`agy`）的狀態列（Statusline / Footer）——支援從 36 項即時指標中自由勾選、切換文字（`text`）或繪圖符號（Emoji）（`emoji`）標籤顯示風格、自訂排序、切換百分比長條圖的合併或分開顯示模式，並具備自動與手動換行機制，提供 4 種顯示語系（`zh-tw`、`zh-cn`、`us`、`jp`）。

全面支援 Google Antigravity 的三大核心平台：Antigravity 命令列介面（`agy`）、Antigravity 整合開發環境（Integrated Development Environment）以及 Antigravity 2.0 桌面應用程式。

## 狀態列實際運作展示

<p align="center">
  <img src="docs/images/statusline-demo-zh-tw.svg" alt="Antigravity 命令列介面狀態列互動設定與動態遙測展示：從執行 /antigravity-cli-statusline:agy-cli-statusline 指令、語系選擇、五大分類分頁勾選、自訂排序 Write-in 到 11 列完整狀態列即時運作。" width="100%">
</p>

動態展示從執行設定指令 `/antigravity-cli-statusline:agy-cli-statusline`、問卷互動選取指標、自訂排序輸入，到最終呈現 11 列高資訊密度狀態列的完整即時遙測流程。

## 如何安裝

透過 Antigravity 命令列介面進行全域安裝：

```bash
agy plugin install https://github.com/AndyAWD/antigravity-cli-statusline
```

### 環境需求

- **Node.js**（必要）：渲染腳本以純 `.mjs` 撰寫；若系統未安裝 Node.js，狀態列將呈現空白，且 `agy` 會在連續失敗 30 次後自動停用狀態列。本技能在寫入設定前會先執行環境預檢。
- **Git**（選用）：用於讀取 `git-branch`、`vcs-dirty`、`vcs-type` 等版本控制系統（Version Control System）指標。

### 啟用與生效機制

- **初次啟用**：初次安裝或初次啟用狀態列時，`agy` 命令列介面不會在執行期間動態載入新增的掛鉤（Hook）行程，請重新啟動 `agy` 命令列介面（退出後重新開啟）以載入狀態列。
- **熱更新（Hot Reload）生效**：先前已啟用狀態列者，後續調整指標順序、切換標籤顯示風格（`text` / `emoji`）或切換語系時，狀態列會直接熱更新生效，無需重新啟動命令列介面。

## 特色亮點

1. **跨平台相容**：支援 Antigravity 命令列介面終端機、整合開發環境側邊欄對話方塊（Dialog Box）以及 Antigravity 2.0 桌面應用程式，涵蓋 Windows、macOS 與 Linux 作業系統。
2. **36 項即時指標、4 種語系與雙標籤顯示風格**：涵蓋人工智慧（Artificial Intelligence）模型狀態、應用程式介面（Application Programming Interface）配額（含五小時、每週與 Gemini 4 Argon 專屬配額）、脈絡（Context）與權杖（Token）消耗、互動佇列、Git 版本控制狀態及系統資源，支援繁體中文（`zh-tw`）、簡體中文（`zh-cn`）、英文（`us`）與日文（`jp`），並可自由切換**文字標籤（`text`）**或**繪圖符號標籤（`emoji`，無冒號精簡排版）**顯示風格（`ui.footer.labelStyle`）。
3. **彈性百分比長條圖（支援合併與分開顯示）**：針對五小時額度、每週額度、Gemini 4 Argon 額度、脈絡用量與權杖數提供預設 10 格視覺長條圖（`[████████░░]`）；當數值與長條圖相鄰時自動合併為單一標籤，未相鄰時則各自以獨立標籤顯示。
4. **自訂排序與雙軌換行機制**：支援以數字序號或英文識別碼（Identifier）排序、使用 `n` 強制換行、使用 `n,n` 建立空白分隔行，並依終端機寬度自動智慧折行。
5. **24-bit 四階動態色彩**：依據配額剩餘比例或脈絡消耗程度自動切換 4 個色階（`#57caff` 藍色 `100~75%`、`#5cdb6d` 綠色 `74~50%`、`#ffd427` 黃色 `49~25%`、`#ff7daf` 粉紅色 `24~0%`），並為不同人工智慧模型家族套用專屬品牌識別色。
6. **三層設定檔同步與系統防護**：自動同步命令列介面專屬、全域與專案三層 `settings.json` 及 `trusted_hooks.json`，內建 macOS/Linux NVM 絕對路徑解析與 Windows UTF-8 位元組順序記號（Byte Order Mark）自動剝除機制。

## 如何管理與切換外掛程式

```bash
# 列出已安裝外掛
agy plugin list

# 啟用外掛
agy plugin enable antigravity-cli-statusline

# 停用外掛
agy plugin disable antigravity-cli-statusline

# 移除外掛
agy plugin uninstall antigravity-cli-statusline
```

## 指令功能說明

安裝完成後，可在任何 AGY 介面透過語意對話或輸入對應的斜線指令（Slash Command）觸發：

### 狀態列設定技能（Configure Statusline）

```text
/antigravity-cli-statusline:agy-cli-statusline
```

- **使用情境**：初次啟用命令列介面狀態列、切換顯示語系（`zh-tw` / `zh-cn` / `us` / `jp`）、切換文字（`text`）或繪圖符號（`emoji`）標籤顯示風格、增減顯示指標，或重新調整多行排版順序時。
- **運作流程**：
  1. 詢問顯示語系，並將後續所有設定互動鎖定為所選語系。
  2. 執行 Node.js 環境預檢，並讀取命令列介面專屬、全域與專案三層 `settings.json` 狀態。
  3. 載入 `questions.json` 以五大分類分頁依序提供指標勾選，避開終端機螢幕高度截斷問題。
  4. 列出使用者所選指標，接收自訂排序與個別樣式前綴（支援純數字、`t` 文字前綴、`e` 繪圖符號前綴與 `n` 換行符號），將 `ui.footer.items` 與 `ui.footer.itemStyles` 寫入三層 `settings.json`，並將掛鉤腳本部署至 `~/.gemini/antigravity-cli/hooks/` 完成測試驗證。
  5. 設定完成後，自動以程式碼區塊回報先前與本次的排版順序字串，方便隨時複製貼上重現設定。

---

## 指標、排序與換行

### 可顯示的指標（1–36）

以下編號對應技能步驟 3 問卷（`resources/questions.json`）中五大分類分頁選項序號（從 1 起算），以及各指標在 `emoji` 模式下對應的繪圖符號：

**1. 模型與代理（4 項）**
- `1.` 🤖 **目前使用的人工智慧模型名稱（`model-name`）**：即時顯示對話正在使用的模型
- `2.` 🪪 **使用中代理（`agent-profile`）**：目前載入的 Agent Profile 名稱
- `3.` ⚡ **代理當前狀態（`agent-state`）**：`閒置 / 思考中 / 執行中 / 呼叫工具 / 初始化`
- `4.` ⚙️ **目前運行模式（`mode`）**：`default / code-only / plan / interactive / accept-edits`

**2. 額度、計費與帳號（14 項）**
- `5.` 🔋 **帳號五小時可用額度百分比（`quota`）**：五小時應用程式介面可用額度百分比，搭配四階配色
- `6.` 🔋 **五小時可用額度長條圖（`quota-bar`）**：10 格五小時可用額度長條圖（`[████████░░]`）
- `7.` ⏳ **帳號五小時額度重置時間倒數（`quota-reset-countdown`）**：距離五小時額度重置的剩餘時間
- `8.` 🕒 **五小時重置時間（`quota-reset-time`）**：本機時區絕對重置時間（預設同日 `HH:mm`、跨日 `yyyy/MM/dd HH:mm`）
- `9.` 📅 **帳號每週可用額度百分比（`quota-weekly`）**：每週應用程式介面可用額度百分比，搭配四階配色
- `10.` 📅 **每週可用額度長條圖（`quota-weekly-bar`）**：10 格每週可用額度長條圖（`[███████░░░]`）
- `11.` ⏲️ **帳號每週額度重置時間倒數（`quota-weekly-countdown`）**：距離每週額度重置的剩餘時間
- `12.` 🗓️ **每週重置時間（`quota-weekly-reset-time`）**：每週額度重置的本機絕對時間（如 `2026/10/18 16:00`）
- `13.` ✨ **Gemini 4 Argon 可用額度百分比（`quota-argon`）**：Gemini 4 Argon 專屬配額百分比，搭配四階配色
- `14.` ✨ **Gemini 4 Argon 可用額度長條圖（`quota-argon-bar`）**：10 格 Argon 可用額度長條圖（`[█████░░░░░]`）
- `15.` ⏱️ **Gemini 4 Argon 額度重置時間倒數（`quota-argon-countdown`）**：距離 Argon 額度重置的剩餘時間
- `16.` ⏰ **Gemini 4 Argon 重置時間（`quota-argon-reset-time`）**：Argon 額度重置的本機絕對時間（如 `2026/10/30 23:57`）
- `17.` 💎 **目前訂閱方案等級（`plan-tier`）**：目前帳號的訂閱等級
- `18.` 📧 **帳號電子郵件（`account-email`）**：目前登入的帳號信箱

**3. 脈絡與權杖（4 項）**
- `19.` 🧠 **目前對話已消耗的脈絡用量比例（`context-used`）**：脈絡視窗已消耗百分比
- `20.` 🧠 **脈絡用量長條圖（`context-used-bar`）**：10 格脈絡消耗長條圖（`[█░░░░░░░░░]`）
- `21.` 💰 **目前工作階段（Session）消耗的精確權杖數量（`token-count`）**：目前對話累計權杖數
- `22.` 💰 **權杖數長條圖（`token-count-bar`）**：10 格權杖消耗長條圖（`[█░░░░░░░░░]`）

**4. 工作區與版本控制（5 項）**
- `23.` 📁 **目前工作區專案短路徑（`project-path`）**：工作區資料夾名稱
- `24.` 📍 **目前工作區專案完整路徑（`project-full-path`）**：工作區絕對路徑
- `25.` 🔀 **目前工作區專案的 Git 分支（`git-branch`）**：目前所在的 Git 分支名稱
- `26.` 🔍 **工作區是否有未提交變更（`vcs-dirty`）**：`未提交 / 無變更`
- `27.` 🗃️ **版本控制類型（`vcs-type`）**：`git / jj / fig`

**5. 系統狀態與背景任務（9 項）**
- `28.` 💾 **命令列介面行程所消耗的隨機存取記憶體量（`memory-usage`）**：`agy` 行程佔用的記憶體大小
- `29.` 🚀 **Antigravity 命令列介面版本號（`cli-version`）**：目前執行的命令列介面版本
- `30.` 💬 **目前對話識別碼前 8 碼（`conversation-id`）**：供除錯定位使用
- `31.` 🛡️ **沙盒模式狀態（`sandbox-status`）**：`off / on (net) / on (no-net)`
- `32.` 🔔 **是否有等你回應的工具確認對話方塊（`tool-confirmation`）**：提示是否有工具正在等待使用者確認
- `33.` 📥 **佇列中待處理的使用者輸入數（`pending-input`）**：排隊等待執行的輸入數量
- `34.` 🔄 **進行中的背景任務數（`background-tasks`）**：執行中的背景行程數量
- `35.` 👥 **活躍子代理數（`subagents`）**：運行中的子代理數量
- `36.` 📄 **本次對話人工智慧累計產出的檔案數量（`artifacts`）**：本次對話產出的 Artifacts 數量

### 排序規則與樣式設定

在技能步驟 4 的自訂排序輸入框（Write-in）填入以逗號分隔的指標序號，即可完成排序與個別樣式設定（未列入的指標不予顯示；留白或選擇略過則沿用原勾選順序與預設文字樣式）：

- **樣式前綴設定**：
  - **文字標籤樣式（`text`，預設）**：純數字序號（如 `1`）、`t` 前綴（如 `t1`）或純英文識別碼（如 `quota`、`t:quota`），顯示為所選語系的文字標籤搭配冒號（例如 `五小時可用: 88%`）。
  - **繪圖符號樣式（`emoji`）**：使用 `e` 前綴（如 `e1`、`e:quota`，大小寫不分），將文字標籤替換為繪圖符號加單一空白（例如 `🔋 88%`），狀態值仍維持多語系顯示。
  - **個別混搭**：各指標可獨立指定樣式（例如 `e1, 18, e17, 31`），未指定者預設為文字樣式。
- **百分比長條圖合併與分開機制**：
  - 針對五組指標配對（`quota` `5`+`6`、`quota-weekly` `9`+`10`、`quota-argon` `13`+`14`、`context-used` `19`+`20`、`token-count` `21`+`22`），當數值指標與長條圖**相鄰排列**（如 `5,6`）且樣式一致時，自動合併為單一標籤與進度條。
  - 若兩者**未相鄰**（中間隔有其他指標或換行）或樣式衝突（一為 `text`、一為 `emoji`）時，則各自以獨立標籤分開顯示。
  - 長條圖預設長度為 10 格（`[████████░░]`，可透過 `ui.footer.barLength` 自訂），絕對重置時間格式可透過 `ui.footer.timeFormat` 設定。
- **換行與分區間隔**：
  - **強制換行（`n`）**：插入 `n` 在指定位置換行；連續插入 `n,n` 可產生一行空白分隔行。
  - **自動智慧折行**：當指標總長度超出終端機視窗寬度時，渲染器會自動折疊至下一行。
- **動態色彩變換**：
  - 狀態列採用 24-bit truecolor 四階柔和配色（`#57caff` 藍色 → `#5cdb6d` 綠色 → `#ffd427` 黃色 → `#ff7daf` 粉紅色），依據額度剩餘比例或脈絡消耗比例動態變色；不同模型家族亦套用專屬品牌識別色。

#### 排序輸入範例

- **數字序號版本**：
  ```text
  e1,e18,e17,e31,n,e2,3,35,36,33,34,32,n,n,19,20,21,22,n,5,6,7,8,n,9,10,11,12,n,13,14,15,16,n,n,26,27,e25,n,e23,24,n,e4,e30,e28,29
  ```

- **英文識別碼版本**：
  ```text
  e:model-name,e:account-email,e:plan-tier,e:sandbox-status,n,e:agent-profile,agent-state,subagents,artifacts,pending-input,background-tasks,tool-confirmation,n,n,context-used,context-used-bar,token-count,token-count-bar,n,quota,quota-bar,quota-reset-countdown,quota-reset-time,n,quota-weekly,quota-weekly-bar,quota-weekly-countdown,quota-weekly-reset-time,n,quota-argon,quota-argon-bar,quota-argon-countdown,quota-argon-reset-time,n,n,vcs-dirty,vcs-type,e:git-branch,n,e:project-path,project-full-path,n,e:mode,e:conversation-id,e:memory-usage,cli-version
  ```

*(註：亦支援 `model-name`、`e:quota` 等英文識別碼，但使用數字序號最為簡潔實用。)*

#### 效果預覽（混搭模式）

包含四大邏輯分區、共 9 行資訊並搭配空白分隔行：

```text
🤖 Gemini 3.8 Flash (High) │ 📧 anandydy529@gmail.com │ 💎 Google AI Pro │ 🛡️ 關閉
🪪 Default │ 代理狀態: 執行中 │ 子代理: 2 │ 產出檔案: 0 │ 待處理輸入: 0 │ 背景任務: 0 │ 工具待確認: 無

脈絡用量: 18.5% [█░░░░░░░░░] │ 權杖數: 47.4k / 256.0k [█░░░░░░░░░]
五小時可用: 88% [████████░░] │ 五小時倒數: 4h 50m │ 五小時重置: 15:50
七日內可用: 78% [███████░░░] │ 七日內倒數: 4d 5h │ 七日內重置: 2026/10/18 16:00
Argon 可用: 59% [█████░░░░░] │ Argon 倒數: 6d 1h │ Argon 重置: 2026/10/30 23:57

版控狀態: 無變更 │ 版控類型: git │ 🔀 main
📁 antigravity-cli-statusline │ 完整路徑: /Users/andyawd/Project/antigravity-cli-statusline
⚙️ Accept-edits │ 💬 c5168b1c │ 💾 279MB │ 版本: v1.3.2
```

## 貢獻指南

歡迎提交貢獻——包含新增指標、跨平台修正以及新增其他語系翻譯。詳細專案結構與工作流程請參閱 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 鳴謝

特別感謝 [60ke/antigravity-statusline](https://github.com/60ke/antigravity-statusline) 專案。本專案的額度監控靈感正是來自於此。由於該原專案主要是使用 Python 撰寫，在 Windows 和 macOS 跨平台執行上可能遇到環境設定的困難，因此本專案使用 JavaScript (Node.js) 進行改寫，以實現真正的跨平台免額外依賴執行。

## 授權條款

本專案採用 MIT 授權條款釋出，詳情請參閱 [LICENSE](LICENSE) 檔案。
