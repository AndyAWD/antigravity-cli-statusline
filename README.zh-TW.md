# Antigravity CLI 狀態列設定技能

[![版本](https://img.shields.io/badge/版本-1.8.0-blue.svg)](skills/agy-cli-statusline/SKILL.md)
[![授權條款: MIT](https://img.shields.io/badge/授權條款-MIT-yellow.svg)](LICENSE)
[![平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

繁體中文 | [简体中文](README.zh-CN.md) | [English](README.md)

一個多語系、跨平台的技能，用來客製化 Antigravity CLI 狀態列（Footer）——精準勾選想顯示的指標、自由排序，並內建智慧型換行。

## 實際畫面

### Windows

| 繁體中文 (zh-tw) | 簡體中文 (zh-cn) | English (us) | 日本語 (jp) |
| :---: | :---: | :---: | :---: |
| ![繁體中文](docs/images/agy-cli-statusline-windows-zhtw.png) | *(支援 zh-cn 模式)* | ![English](docs/images/agy-cli-statusline-windows-us.png) | ![日本語](docs/images/agy-cli-statusline-windows-jp.png) |

### macOS

| 繁體中文 (zh-tw) | 簡體中文 (zh-cn) | English (us) | 日本語 (jp) |
| :---: | :---: | :---: | :---: |
| ![繁體中文](docs/images/agy-cli-statusline-macos-zhtw.png) | *(支援 zh-cn 模式)* | ![English](docs/images/agy-cli-statusline-macos-us.png) | ![日本語](docs/images/agy-cli-statusline-macos-jp.png) |

## 安裝

### 環境需求

- **Node.js**（必要）：渲染腳本以純 `.mjs` 撰寫；若缺失，狀態列會空白並被 `agy` 在反覆失敗後自動停用。技能會在寫入設定前先預檢。
- **Git**（選用）：用於顯示 `git-branch`、`vcs-dirty`、`vcs-type` 指標。

### 步驟 A：安裝外掛

```bash
agy plugin install https://github.com/andyawd/antigravity-cli-statusline
```

> CLI 會把 bundle stage 至 `~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/`。

### 步驟 B：觸發 Skill 完成設定

在 Antigravity CLI 提示字元輸入：

```text
/antigravity-cli-statusline:agy-cli-statusline
```

技能會引導你選擇語系、勾選指標、排序，並把渲染腳本部署到位、寫入三層 `settings.json` 與 `trusted_hooks.json`。配置腳本會自動處理跨平台 Node.js 執行路徑相容性（macOS / Linux 自動使用 `process.execPath` 絕對路徑避免 NVM 環境遺失 PATH 發生 exit status 127；Windows 使用 `node` 裸命令避開路徑空白引號剝除與換行跳脫問題）。

- **初次啟用**：若是初次安裝或初次啟用狀態列，agy CLI 不會在執行期間動態載入新掛鉤行程，需重新啟動 agy CLI（退出後重新開啟）以載入狀態列。
- **熱更新生效**：先前已啟用狀態列者，後續調整指標順序或切換語系時，狀態列**熱更新立即生效**，無需重啟 CLI。

## 指標、排序與換行

### 可顯示的指標

**AI 模型與代理**
- **目前使用的 AI 模型名稱（`model-name`）**：即時顯示對話正在使用的模型
- **使用中代理（`agent-profile`）**：目前載入的 Agent Profile 名稱
- **代理當前狀態（`agent-state`）**：`idle / thinking / working / tool_use / initializing`
- **目前 CLI 運行模式（`mode`）**：目前作用中的運行模式（`default / code-only / plan / interactive / accept-edits`）

**額度與 Token**
- **帳號真實 API 可用額度（`quota`）**：百分比，搭配四階配色
- **五小時可用額度長條圖（`quota-bar`）**：10 格長條圖視覺回饋（`[████████░░]`），與 `quota` 相鄰時自動合併
- **API 重置時間倒數（`quota-reset-countdown`）**：距離下次額度重置剩餘時間
- **五小時 API 絕對重置時間（`quota-reset-time`）**：本機時區絕對時間，預設同日 `HH:mm`、跨日 `yyyy/MM/dd HH:mm`
- **帳號每週 API 可用額度（`quota-weekly`）**：每週剩餘百分比，搭配四階配色
- **每週可用額度長條圖（`quota-weekly-bar`）**：每週剩餘長條圖，與 `quota-weekly` 相鄰時自動合併
- **每週 API 重置時間倒數（`quota-weekly-countdown`）**：距離每週額度重置剩餘時間
- **每週 API 絕對重置時間（`quota-weekly-reset-time`）**：每週重置絕對時間（如 `2026/10/20 10:50`）
- **目前對話已消耗的 Context 比例（`context-used`）**：百分比
- **脈絡用量長條圖（`context-used-bar`）**：脈絡消耗長條圖，與 `context-used` 相鄰時自動合併
- **目前 Session 消耗的精確 Token 數量（`token-count`）**
- **權杖數長條圖（`token-count-bar`）**：Token 消耗長條圖，與 `token-count` 相鄰時自動合併
- **本次對話 AI 累計產出的檔案數量（`artifacts`）**
- **目前訂閱方案等級（`plan-tier`）**

**互動狀態**
- **等你回應的工具確認對話方塊（Dialog Box）（`tool-confirmation`）**
- **佇列中待處理的使用者輸入數（`pending-input`）**
- **進行中的背景任務數（`background-tasks`）**
- **活躍子代理數（`subagents`）**

**專案與版控**
- **目前工作區專案短路徑（`project-path`）**
- **目前工作區專案完整路徑（`project-full-path`）**
- **版本控制類型（`vcs-type`）**：`git / jj / fig`
- **目前工作區的 Git 分支（`git-branch`）**
- **工作區是否有未提交變更（`vcs-dirty`）**：`dirty / clean`

**系統與帳號**
- **CLI 行程所消耗的 RAM 記憶體量（`memory-usage`）**
- **Antigravity CLI 版本號（`cli-version`）**
- **目前對話 ID 前 8 碼（`conversation-id`）**：用於除錯
- **沙盒模式狀態（`sandbox-status`）**：`off / on (net) / on (no-net)`
- **帳號電子郵件（`account-email`）**

### 長條圖規格與相鄰自動合併

- **長條圖規格**：預設長度為 10 格（`[████████░░]`），可於設定檔 `ui.footer.barLength` 自訂格數。實心方塊 `█` 代表進度，底色淺方塊 `░` 代表剩餘/空白。配額指標依剩餘空間著色，脈絡與權杖指標依緊繃程度著色。
- **相鄰自動合併（Adjacent Auto-Merge）**：當數值指標與對應長條圖在狀態列相鄰時（無方向性限制），狀態列會自動將其合併為單一標籤與管道隔線：
  - `quota` + `quota-bar` → `小時可用: 88% [████████░░]`
  - `quota-weekly` + `quota-weekly-bar` → `每週可用: 90% [█████████░]`
  - `context-used` + `context-used-bar` → `脈絡用量: 15.2% [█░░░░░░░░░]`
  - `token-count` + `token-count-bar` → `權杖數: 12.5k / 1.0M [██░░░░░░░░]`
  - 若彼此未相鄰，則各自維持獨立標籤輸出。
- **絕對重置時間格式**：可於設定檔 `ui.footer.timeFormat` 自訂為 `"smart"`（預設，同日 `HH:mm`、跨日 `yyyy/MM/dd HH:mm`）、`"yyyy/MM/dd HH:mm"`、`"12h"` 或 `"24h"`。

### 排序

在技能流程第三階段（步驟 4），於 Write-in 輸入框填入以逗號分隔的序號即可自訂排序：

```text
1,5,6,10,11,n,2,14,7,15,16,17,n,n,8,9,18,19,n,22,21,12,13,n,n,26,25,3,4,23,20,24
```

- 數字 = 步驟 3 勾選清單中的序號（從 1 起算）
- 也可混用英文識別碼（如 `quota`、`model-name`），但用數字最直觀
- 可混入 `n` 進行強制換行（連續 `n,n` 可產生空行區隔）
- **未提及的指標會被剔除**——排序結果即為最終顯示集合
- 若留白或選擇 `(Recommended) 略過` 就會沿用勾選順序、顯示全部勾選的指標

排序後顯示效果預覽（五段分區並搭配空行區隔）：

```text
模型: Gemini 3.8 Flash (High) │ 脈絡用量: 3.4% │ 權杖數: 35.7k / 1.0M │ 小時可用: 98% │ 小時倒數: 4h 50m
代理角色: 預設 │ 工具待確認: 都好了 │ 檔案數量: 0 │ 待處理輸入: 0 │ 背景任務: 0 │ 子代理: 2

帳號: anandydy529@gmail.com │ 訂閱方案: Google AI Pro │ 專案: antigravity-cli-statusline
完整路徑: /Users/andyawd/Project/antigravity-cli-statusline
工作區狀態: ✓ 乾淨 │ Git: main │ 每週可用: 78% │ 每週倒數: 4d 5h

模式: Accept-edits │ 對話ID: c5168b1c │ 代理狀態: working │ 沙盒狀態: 關閉 │ 記憶體: 279MB │ VCS類型: git │ CLI版本: v1.3.2
```

### 換行

兩種機制並存：

1. **自動智慧折行**：渲染腳本會讀取終端機寬度，當下一個指標會超出時自動折到下一行，無需任何設定。
2. **強制換行**：在排序字串中插入 `n` token 即可在指定位置強制折行，可重複使用：

```text
1,2,n,3,4
```

（若步驟 3 勾選了 4 個指標，此例會把 1、2 顯示在第一行，並強制把 3、4 折到第二行。）

### 動態色彩

採用 24-bit truecolor 四階柔和配色（藍 → 綠 → 黃 → 粉紅），依 API 額度或 Context 消耗比例變色；不同 AI 模型家族也會套用專屬的品牌識別色。

## 貢獻指南

非常歡迎大家貢獻——包括新增指標、跨平台修正、以及透過 AI 一鍵新增其他語言翻譯。詳見 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

## 鳴謝

特別感謝 [60ke/antigravity-statusline](https://github.com/60ke/antigravity-statusline) 專案。本專案的額度監控靈感正是來自於此，由於該原專案主要是使用 Python 撰寫，在 Windows 和 macOS 跨平台執行上可能遇到環境設定的困難，因此我使用 JavaScript (Node.js) 進行改寫，以實現真正的跨平台免安裝依賴執行。

## 授權條款

本專案採用 [MIT License](LICENSE) 授權。
