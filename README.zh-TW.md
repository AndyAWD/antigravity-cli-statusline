# Antigravity CLI 狀態列設定技能

[![版本](https://img.shields.io/badge/版本-1.5.0-blue.svg)](skills/antigravity-cli-statusline/SKILL.md)
[![授權條款: MIT](https://img.shields.io/badge/授權條款-MIT-yellow.svg)](LICENSE)
[![平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

繁體中文 | [English](README.md)

一個多語系、跨平台的技能，用來客製化 Antigravity CLI 狀態列（Footer）——精準勾選想顯示的指標、自由排序，並內建智慧型換行。

## 實際畫面

### Windows

| 繁體中文 (zh-tw) | English (us) | 日本語 (jp) |
| :---: | :---: | :---: |
| ![繁體中文](docs/images/agy-cli-statusline-windows-zhtw.png) | ![English](docs/images/agy-cli-statusline-windows-us.png) | ![日本語](docs/images/agy-cli-statusline-windows-jp.png) |

### macOS

| 繁體中文 (zh-tw) | English (us) | 日本語 (jp) |
| :---: | :---: | :---: |
| ![繁體中文](docs/images/agy-cli-statusline-macos-zhtw.png) | ![English](docs/images/agy-cli-statusline-macos-us.png) | ![日本語](docs/images/agy-cli-statusline-macos-jp.png) |

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
/antigravity-cli-statusline
```

技能會引導你選擇語系、勾選指標、排序，並把渲染腳本部署到位、寫入三層 `settings.json`。狀態列**熱更新立即生效**，無需重啟 CLI。

## 指標、排序與換行

### 可顯示的指標

**AI 模型與代理**
- **目前使用的 AI 模型名稱（`model-name`）**：即時顯示對話正在使用的模型
- **使用中代理（`agent-profile`）**：目前載入的 Agent Profile 名稱
- **代理當前狀態（`agent-state`）**：`idle / thinking / working / tool_use / initializing`

**額度與 Token**
- **帳號真實 API 可用額度（`quota`）**：百分比，搭配四階配色
- **API 重置時間倒數（`quota-reset-countdown`）**：距離下次額度重置剩餘時間
- **帳號每週 API 可用額度（`quota-weekly`）**：每週剩餘百分比，搭配四階配色
- **每週 API 重置時間倒數（`quota-weekly-countdown`）**：距離每週額度重置剩餘時間
- **目前對話已消耗的 Context 比例（`context-used`）**：百分比
- **目前 Session 消耗的精確 Token 數量（`token-count`）**
- **本次對話 AI 累計產出的成品 / 檔案數（`artifacts`）**
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

### 排序

在技能流程第三階段（步驟 4），於 Write-in 輸入框填入以逗號分隔的序號即可自訂排序：

```text
2,5,1
```

- 數字 = 步驟 3 勾選清單中的序號（從 1 起算）
- 也可混用英文識別碼（如 `quota`、`model-name`），但用數字最直觀
- **未提及的指標會被剔除**——排序結果即為最終顯示集合
- 若留白或選擇 `(Recommended) 略過` 就會沿用勾選順序、顯示全部勾選的指標

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
