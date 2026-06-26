# Workshop 簡報視覺設定

這份文件記錄 `docs/workshop/` 下 GDG 工作坊簡報的視覺決定。任何要改 `index.html` 視覺的請求，先讀這份再動手。

**檔案結構**：
- `index.html` — reveal.js wrapper（所有 CSS 在 `<style>` 內，所有 hook 在 `<script>` 內）
- `prompt-workshop-slides.md` — 30 張投影片內容來源（**不能改**，這是 Andy 的稿）
- `STYLE.md` — 本檔，視覺設定備忘

**Why（為什麼這份文件存在）**：
跨對話接續設計工作時，重要的色票與兩種版型語意如果沒寫下來，得從頭討論一次。寫在這裡就跟著 git，協作者也能讀到。

**How to apply（什麼時候用到）**：
- 任何要改 `index.html` 視覺的請求，先讀這份再動手
- 看到「章節頁」或「內容頁」字眼，對照下方語意定義
- 若收到「請把第 N 張設為章節頁」之類的指令，直接編輯 HTML 內的 `CHAPTER_PAGE_INDEXES` 陣列

---

## GDG 三階色票（已寫入 `index.html` `:root`）

| 色族 | 500 主色 | Halftone | Pastel |
|---|---|---|---|
| Blue | `#4285f4` | `#57caff` | `#c3ecf6` |
| Red | `#ea4335` | `#ff7daf` | `#f8d8d8` |
| Yellow | `#f9ab00` | `#ffd427` | `#ffe7a5` |
| Green | `#34a853` | `#5cdb6d` | `#ccf6c5` |

灰階：
- OFF White：`#f0f0f0`（全頁背景、暗底文字）
- Black 02：`#1e1e1e`（程式碼框底色、章節頁底色）
- Soft gray：`#5f6368`（次要文字）
- Line gray：`#e0e0e0`（邊框）

CSS 變數命名（沿用此命名，下次別重新發明）：
```
--gdg-blue / --gdg-red / --gdg-yellow / --gdg-green        (500 主色)
--gdg-blue-ht / --gdg-red-ht / --gdg-yellow-ht / --gdg-green-ht   (Halftone)
--gdg-blue-p  / --gdg-red-p  / --gdg-yellow-p  / --gdg-green-p    (Pastel)
--gdg-offwhite / --gdg-ink / --gdg-soft / --gdg-line               (灰階)
```

**使用原則**：
- **500 主色**：標題重音、bullet 圓點、強調粗體文字
- **Halftone**：H2 漸層底線、progress bar、頁碼徽章漸層、章節頁的 H2/H3/連結色
- **Pastel**：bullet 圓點外圈光暈、`**標籤**：` chip 底、inline code 底、blockquote 底、table header 底

---

## 兩種版型語意

### 內容頁（預設，無 class）

平常上課主要看的頁，**清爽好讀**為原則。

特徵：
- 底色：OFF White `#f0f0f0`
- H2：左對齊、Halftone 4 色漸層底線
- 內文：黑字（`#1e1e1e`）、Inter + Noto Sans TC、22px 基底
- bullet：圓點 4 色輪替（500 主色 + Pastel 光暈）
- `**標籤**：...` bullet 自動把 `<strong>` 套 Pastel chip（4 色輪替）
- 程式碼框：**Black 02 純黑底 + 白字**，**沒有** macOS 終端機 chrome（traffic light）
  - 字級 `0.78em`（之前曾經是 `0.62em` 太小，這次調大）
  - 保留 Monokai 語法上色
- inline code：Pastel Blue 底 + Blue 500 字
- blockquote：Pastel Yellow 底 + Yellow 600 左框
- 表格：白底、Pastel Blue header

### 章節頁（class: `chapter-page`）

「進入新章節」的視覺停頓點 — **整張 section 就是一個 macOS 終端機視窗**。

特徵：
- 整張 section：Black 02 暗底、圓角 14px、深投影
- 頂端 36px：macOS chrome（紅黃綠 traffic light + 中央 title `andy@gdg — workshop — zsh`）
- 內容字級：**比內容頁大 25%**（H2 = 2.4em、p = 1.25em、li = 1.2em）
- 字體：**JetBrains Mono 等寬字**（仿終端機）
- H2 前加 `# `、H3 前加 `## `（Halftone Yellow 提示色）
- bullet：用 `$` 取代圓點（Halftone Green）
- 巢狀 bullet：用 `›`（Halftone Blue）
- inline code：暗底反白（Halftone Yellow）
- 強調粗體：Halftone Yellow

**重要：章節頁套用範圍由 Andy 決定，不要自作主張套**：
- `index.html` 內有一個 `CHAPTER_PAGE_INDEXES = []` 陣列
- Andy 會在後續對話補上（0-based slide index）
- 封面（index 0）與 Thank You（最後一張）有自己的特殊樣式，**永遠不要**放進 `CHAPTER_PAGE_INDEXES`

### 封面（第 1 張）與 Thank You（最後一張）

各有專屬樣式（非章節頁、非內容頁）：
- **封面**：H1 大字 + 4 色（500 主色）漸層底線、副標題灰色、置中、無外框
  - 第一輪曾經誤加 flex + 卡片背景導致出現偏右的「卡片框」，已修為極簡版本
- **Thank You**：H2 4 色漸層文字（`background-clip: text`）、置中

---

## 不可重蹈的歷史錯誤

1. **不要**把 macOS 終端機 chrome（traffic light）套在每個 `<pre>` 程式碼框上 —
   會把字級壓到 0.62em 並讓程式碼看起來既窄又小。
   終端機 chrome **只能**用在 `.chapter-page` 整張 section 的外觀上。
2. **不要**在封面用 `display: flex` + `background: radial-gradient` + `border-radius` —
   會產生「比畫布窄的偏移卡片框」。封面只用 `text-align: center + padding`。
3. **不要**修改 `prompt-workshop-slides.md` — 那是 Andy 的稿。任何視覺調整都在 `index.html` 完成。
4. **Yellow** 用 `#f9ab00`（Yellow 600），**不是** 舊版的 `#FBBC04`。

---

## 待 Andy 補

- `CHAPTER_PAGE_INDEXES` 陣列要包含哪些 0-based index
- 投影片 5 / 6 / 7 內的 `# Andy 待填` 區段內容（這由 Andy 自己改 .md，與視覺無關）
- 封面日期 / 地點資訊
- GitHub Pages 啟用（Settings → Pages → Branch `main` / Folder `/docs`）

---

## 預覽指令

```bash
cd /Users/andyawd/Project/antigravity-cli-statusline
python3 -m http.server 8000
# 開 http://localhost:8000/docs/workshop/
```

按 `S` 講者模式、`F` 全螢幕、`?` 顯示快捷鍵。
網址加 `?print-pdf` 可用 Chrome 列印另存 PDF。
