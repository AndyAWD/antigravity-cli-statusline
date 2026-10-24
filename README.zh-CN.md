# antigravity-cli-statusline

[English](README.md) | [繁體中文](README.zh-TW.md) | 简体中文

[![版本](https://img.shields.io/badge/版本-1.10.0-blue.svg)](skills/agy-cli-statusline/SKILL.md)
[![授权条款: MIT](https://img.shields.io/badge/授权条款-MIT-yellow.svg)](LICENSE)
[![平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

一个专为 Google Antigravity（AGY）设计的插件（Plugin），用于自定义 Antigravity 命令行界面（Command-Line Interface）（`agy`）的状态栏（Statusline / Footer）——支持从 36 项实时指标中自由勾选、切换文字（`text`）或表情符号（Emoji）（`emoji`）标签显示风格、自定义排序、切换百分比长条图的合并或分开显示模式，并内置自动与手动换行机制，提供 4 种显示语言（`zh-tw`、`zh-cn`、`us`、`jp`）。

全面支持 Google Antigravity 的三大核心平台：Antigravity 命令行界面（`agy`）、Antigravity 集成开发环境（Integrated Development Environment）以及 Antigravity 2.0 桌面应用程序。

## 实际效果截图

### Windows

| 繁体中文 (zh-tw) | 简体中文 (zh-cn) | English (us) | 日本语 (jp) |
| :---: | :---: | :---: | :---: |
| ![繁体中文](docs/images/agy-cli-statusline-windows-zhtw.png) | *(支持 zh-cn 模式)* | ![English](docs/images/agy-cli-statusline-windows-us.png) | ![日本语](docs/images/agy-cli-statusline-windows-jp.png) |

### macOS

| 繁体中文 (zh-tw) | 简体中文 (zh-cn) | English (us) | 日本语 (jp) |
| :---: | :---: | :---: | :---: |
| ![繁体中文](docs/images/agy-cli-statusline-macos-zhtw.png) | *(支持 zh-cn 模式)* | ![English](docs/images/agy-cli-statusline-macos-us.png) | ![日本语](docs/images/agy-cli-statusline-macos-jp.png) |

## 如何安装

通过 Antigravity 命令行界面进行全局安装：

```bash
agy plugin install https://github.com/AndyAWD/antigravity-cli-statusline
```

### 环境要求

- **Node.js**（必需）：渲染脚本以纯 `.mjs` 编写；若系统未安装 Node.js，状态栏将保持空白，且 `agy` 会在连续失败 30 次后自动禁用状态栏。本技能在写入配置前会先进行环境预检。
- **Git**（可选）：用于读取 `git-branch`、`vcs-dirty`、`vcs-type` 等版本控制系统（Version Control System）指标。

### 启用与生效机制

- **初次启用**：初次安装或初次启用状态栏时，`agy` 命令行界面不会在运行期间动态载入新增的挂钩（Hook）进程，请重新启动 `agy` 命令行界面（退出后重新打开）以载入状态栏。
- **热更新（Hot Reload）生效**：此前已启用状态栏者，后续调整指标顺序、切换标签显示风格（`text` / `emoji`）或切换语言时，状态栏会直接热更新生效，无需重新启动命令行界面。

## 特色亮点

1. **跨平台兼容**：支持 Antigravity 命令行界面终端、集成开发环境侧边栏对话框（Dialog Box）以及 Antigravity 2.0 桌面应用程序，覆盖 Windows、macOS 与 Linux 操作系统。
2. **36 项实时指标、4 种语言与双标签显示风格**：涵盖人工智能（Artificial Intelligence）模型状态、应用程序接口（Application Programming Interface）配额（含五小时、每周与 Gemini 4 Argon 专属配额）、上下文（Context）与令牌（Token）消耗、交互队列、Git 版本控制状态及系统资源，支持简体中文（`zh-cn`）、繁体中文（`zh-tw`）、英文（`us`）与日文（`jp`），并可自由切换**文字标签（`text`）**或**表情符号标签（`emoji`，无冒号精简排版）**显示风格（`ui.footer.labelStyle`）。
3. **灵活百分比长条图（支持合并与分开显示）**：针对五小时额度、每周额度、Gemini 4 Argon 额度、上下文用量与令牌数提供默认 10 格视觉长条图（`[████████░░]`）；当数值与长条图相邻时自动合并为单一标签，未相邻时则各自以独立标签显示。
4. **自定义排序与双轨换行机制**：支持以数字序号或英文标识码（Identifier）排序、使用 `n` 强制换行、使用 `n,n` 创建空白分隔行，并依终端宽度自动折行。
5. **24-bit 四阶动态色彩**：依据配额剩余比例或上下文消耗程度自动切换 4 个色阶（`100~75%` 蓝色、`74~50%` 绿色、`49~25%` 黄色、`24~0%` 粉红色），并为不同人工智能模型家族应用专属品牌识别色。
6. **三层配置文件同步与系统防护**：自动同步命令行界面专属、全局与项目三层 `settings.json` 及 `trusted_hooks.json`，内置 macOS/Linux NVM 绝对路径解析与 Windows UTF-8 字节顺序标记（Byte Order Mark）自动剥除机制。

## 如何管理与切换插件

• 列出已安装插件：

  ```bash
  agy plugin list
  ```

• 启用插件：

  ```bash
  agy plugin enable antigravity-cli-statusline
  ```

• 停用插件：

  ```bash
  agy plugin disable antigravity-cli-statusline
  ```

• 移除插件：

  ```bash
  agy plugin uninstall antigravity-cli-statusline
  ```

## 项目文件夹目录

```text
antigravity-cli-statusline/
├── plugin.json
├── package.json
├── LICENSE
├── CONTRIBUTING.md
├── README.md
├── README.zh-TW.md
├── README.zh-CN.md
├── docs/
│   └── images/
└── skills/
    └── agy-cli-statusline/
        ├── SKILL.md
        ├── references/
        │   ├── config-files.md
        │   ├── pitfalls.md
        │   └── windows.md
        ├── resources/
        │   └── questions.json
        └── scripts/
            ├── configure-statusline.mjs
            ├── diagnose-statusline.mjs
            ├── fetch-local-quota.mjs
            ├── sh_hidden.cs
            ├── statusline-quota.mjs
            └── test-counters.mjs
```

## 命令与技能说明

安装完成后，可在任何 AGY 界面通过语义对话或输入对应的斜线命令（Slash Command）触发：

### 1. 状态栏设置技能（Configure Statusline）

```text
/antigravity-cli-statusline:agy-cli-statusline
```

- **使用场景**：初次启用命令行界面状态栏、切换显示语言（`zh-tw` / `zh-cn` / `us` / `jp`）、切换文字（`text`）或表情符号（`emoji`）标签显示风格、增减显示指标，或重新调整多行排版顺序时。
- **运作流程**：
  1. 询问显示语言，并将后续所有设置交互锁定为所选语言。
  2. 执行 Node.js 环境预检，并读取命令行界面专属、全局与项目三层 `settings.json` 状态。
  3. 载入 `questions.json` 以五大分类分页依序提供指标勾选，避开终端机屏幕高度截断问题（Issue #1262）。
  4. 列出用户所选指标，接收自定义排序与个别样式前缀（支持纯数字、`t` 文字前缀、`e` 表情符号前缀与 `n` 换行符号），将 `ui.footer.items` 与 `ui.footer.itemStyles` 写入三层 `settings.json`，并将挂钩脚本部署至 `~/.gemini/antigravity-cli/hooks/` 完成测试验证。
  5. 设置完成后，自动以代码块回报先前与本次的排版顺序字符串，方便随时复制粘贴重现设置。

---

## 指标、排序与换行

### 可显示的指标（1–36）

以下编号对应技能步骤 3 问卷（`resources/questions.json`）中五大分类分页选项序号（从 1 起算），以及各指标在 `emoji` 模式下对应的表情符号：

**1. 模型与代理（4 项）**
- `1.` 🤖 **当前使用的人工智能模型名称（`model-name`）**：实时显示对话正在使用的模型
- `2.` 🪪 **使用中代理（`agent-profile`）**：当前加载的 Agent Profile 名称
- `3.` ⚡ **代理当前状态（`agent-state`）**：`闲置 / 思考中 / 执行中 / 调用工具 / 初始化`
- `4.` ⚙️ **当前运行模式（`mode`）**：`default / code-only / plan / interactive / accept-edits`

**2. 额度、计费与账号（14 项）**
- `5.` 🔋 **账号五小时可用额度百分比（`quota`）**：五小时应用程序接口可用额度百分比，搭配四阶配色
- `6.` 🔋 **五小时可用额度长条图（`quota-bar`）**：10 格五小时可用额度长条图（`[████████░░]`）
- `7.` ⏳ **账号五小时额度重置时间倒计时（`quota-reset-countdown`）**：距离五小时额度重置的剩余时间
- `8.` 🕒 **五小时重置时间（`quota-reset-time`）**：本机时区绝对重置时间（默认同日 `HH:mm`、跨日 `yyyy/MM/dd HH:mm`）
- `9.` 📅 **账号每周可用额度百分比（`quota-weekly`）**：每周应用程序接口可用额度百分比，搭配四阶配色
- `10.` 📅 **每周可用额度长条图（`quota-weekly-bar`）**：10 格每周可用额度长条图（`[███████░░░]`）
- `11.` ⏲️ **账号每周额度重置时间倒计时（`quota-weekly-countdown`）**：距离每周额度重置的剩余时间
- `12.` 🗓️ **每周重置时间（`quota-weekly-reset-time`）**：每周额度重置的本机绝对时间（如 `2026/10/18 16:00`）
- `13.` ✨ **Gemini 4 Argon 可用额度百分比（`quota-argon`）**：Gemini 4 Argon 专属配额百分比，搭配四阶配色
- `14.` ✨ **Gemini 4 Argon 可用额度长条图（`quota-argon-bar`）**：10 格 Argon 可用额度长条图（`[█████░░░░░]`）
- `15.` ⏱️ **Gemini 4 Argon 额度重置倒计时（`quota-argon-countdown`）**：距离 Argon 额度重置的剩余时间
- `16.` ⏰ **Gemini 4 Argon 重置时间（`quota-argon-reset-time`）**：Argon 额度重置的本机绝对时间（如 `2026/10/30 23:57`）
- `17.` 💎 **当前订阅计划等级（`plan-tier`）**：当前账号的订阅等级
- `18.` 📧 **账号电子邮件（`account-email`）**：当前登录的账号邮箱

**3. 上下文与令牌（4 项）**
- `19.` 🧠 **当前对话已消耗的上下文用量比例（`context-used`）**：上下文窗口已消耗百分比
- `20.` 🧠 **上下文用量长条图（`context-used-bar`）**：10 格上下文消耗长条图（`[█░░░░░░░░░]`）
- `21.` 💰 **当前会话（Session）消耗的精确令牌数量（`token-count`）**：当前对话累计令牌数
- `22.` 💰 **令牌数长条图（`token-count-bar`）**：10 格令牌消耗长条图（`[█░░░░░░░░░]`）

**4. 工作区与版本控制（5 项）**
- `23.` 📁 **当前工作区项目短路径（`project-path`）**：工作区文件夹名称
- `24.` 📍 **当前工作区项目完整路径（`project-full-path`）**：工作区绝对路径
- `25.` 🔀 **当前工作区项目的 Git 分支（`git-branch`）**：当前所在的 Git 分支名称
- `26.` 🔍 **工作区是否有未提交变更（`vcs-dirty`）**：`未提交 / 无变更`
- `27.` 🗃️ **版本控制类型（`vcs-type`）**：`git / jj / fig`

**5. 系统状态与后台任务（9 项）**
- `28.` 💾 **命令行界面进程所消耗的随机存取内存量（`memory-usage`）**：`agy` 进程占用的内存大小
- `29.` 🚀 **Antigravity 命令行界面版本号（`cli-version`）**：当前运行的命令行界面版本
- `30.` 💬 **当前对话标识码前 8 位（`conversation-id`）**：供调试定位使用
- `31.` 🛡️ **沙箱模式状态（`sandbox-status`）**：`off / on (net) / on (no-net)`
- `32.` 🔔 **是否有等你响应的工具确认对话框（`tool-confirmation`）**：提示是否有工具正在等待用户确认
- `33.` 📥 **队列中待处理的用户输入数（`pending-input`）**：排队等待执行的输入数量
- `34.` 🔄 **进行中的后台任务数（`background-tasks`）**：运行中的后台进程数量
- `35.` 👥 **活跃子代理数（`subagents`）**：运行中的子代理数量
- `36.` 📄 **本次对话人工智能累计产出的文件数量（`artifacts`）**：本次对话产出的 Artifacts 数量

### 标签显示风格：文字（`text`）与表情符号（`emoji`）

可在技能步骤 4 排序时设置个别指标样式前缀（保存于三层 `settings.json` 的 `ui.footer.itemStyles` 字典，未设置者一律强制为文字样式）：

- **文字标签样式（`text`，默认）**：以所选语言的文字标签搭配冒号呈现（例如 `模型: Gemini 3.1 Pro │ 五小时可用: 88% │ 分支: main`）。纯数字序号（如 `1`）、`t` 前缀（如 `t1`）或纯英文 ID（如 `quota`、`t:quota`）均为文字样式。
- **表情符号样式（`emoji`）**：将各指标前方的文字标签与冒号替换为对应的表情符号加单一空格（例如 `🤖 Gemini 3.1 Pro │ 🔋 88% │ 🔀 main`），并保留状态值（如 `无`、`无变更`、`关闭`）的多语言显示。以 `e` 为前缀（如 `e1`、`e:quota`）即可指定为 Emoji 样式。各指标可自由混搭（例如 `1, e2, t3, e:git-branch`）。
- **长条图样式冲突处理**：若相邻长条图指标的样式冲突（一为 text、一为 emoji），系统将不会合并，而是拆开为两个独立区块显示。

### 百分比长条图：合并显示与分开显示示例

长条图默认长度为 10 格（`[████████░░]`），可在配置文件 `ui.footer.barLength` 自定义格数；实心方块 `█` 代表当前容量或消耗进度，浅色方块 `░` 代表剩余空间。绝对重置时间格式可通过 `ui.footer.timeFormat` 设置为 `"smart"`（默认）、`"yyyy/MM/dd HH:mm"`、`"12h"` 或 `"24h"`。

系统支持五组百分比长条图配对：
- `quota`（`5`）+ `quota-bar`（`6`）
- `quota-weekly`（`9`）+ `quota-weekly-bar`（`10`）
- `quota-argon`（`13`）+ `quota-argon-bar`（`14`）
- `context-used`（`19`）+ `context-used-bar`（`20`）
- `token-count`（`21`）+ `token-count-bar`（`22`）

#### 1. 合并显示示例（相邻自动合并）

当数值指标与对应的长条图在排序中**相邻排列**时（不限前后顺序，例如 `5,6` 或 `6,5`），渲染器会自动将两者合并为单一标签与单一分隔线：

- **排序输入示例**：
  ```text
  19,20,21,22,n,5,6,9,10,n,13,14
  ```
- **合并显示效果预览（文字模式 `text`）**：
  ```text
  上下文用量: 18.5% [█░░░░░░░░░] │ 令牌数: 185.0k / 1.0M [█░░░░░░░░░]
  五小时可用: 88% [████████░░] │ 七日内可用: 78% [███████░░░]
  Argon 可用: 59% [█████░░░░░]
  ```
- **合并显示效果预览（表情符号模式 `emoji`）**：
  ```text
  🧠 18.5% [█░░░░░░░░░] │ 💰 185.0k / 1.0M [█░░░░░░░░░]
  🔋 88% [████████░░] │ 📅 78% [███████░░░]
  ✨ 59% [█████░░░░░]
  ```

#### 2. 分开显示示例（非相邻／独立标签显示）

当数值指标与对应的长条图在排序中**未相邻**（例如中间插入其他指标，或以 `n` 换行隔开），或是单独只勾选长条图指标时，各指标会保持各自的独立标签分开显示：

- **排序输入示例**：
  ```text
  19,21,n,20,22,n,5,7,6,n,9,11,10,n,13,15,14
  ```
- **分开显示效果预览**：
  ```text
  上下文用量: 18.5% │ 令牌数: 185.0k / 1.0M
  上下文用量: [█░░░░░░░░░] │ 令牌数: [█░░░░░░░░░]
  五小时可用: 88% │ 五小时倒数: 4h 50m │ 五小时可用: [████████░░]
  七日内可用: 78% │ 七日内倒数: 4d 5h │ 七日内可用: [███████░░░]
  Argon 可用: 59% │ Argon 倒数: 6d 1h │ Argon 可用: [█████░░░░░]
  ```

### 排序与个别样式前缀

在技能流程第三阶段（步骤 4），在 Write-in 输入框填入以逗号分隔的序号即可自定义排序与个别样式：

- **数字序号版本**：
  ```text
  e1,e18,e17,e31,n,e2,3,35,36,33,34,32,n,n,19,20,21,22,n,5,6,7,8,n,9,10,11,12,n,13,14,15,16,n,n,26,27,e25,n,e23,24,n,e4,e30,e28,29
  ```

- **英文标识码版本**：
  ```text
  e:model-name,e:account-email,e:plan-tier,e:sandbox-status,n,e:agent-profile,agent-state,subagents,artifacts,pending-input,background-tasks,tool-confirmation,n,n,context-used,context-used-bar,token-count,token-count-bar,n,quota,quota-bar,quota-reset-countdown,quota-reset-time,n,quota-weekly,quota-weekly-bar,quota-weekly-countdown,quota-weekly-reset-time,n,quota-argon,quota-argon-bar,quota-argon-countdown,quota-argon-reset-time,n,n,vcs-dirty,vcs-type,e:git-branch,n,e:project-path,project-full-path,n,e:mode,e:conversation-id,e:memory-usage,cli-version
  ```

- **数字序号**：代表步骤 3 勾选列表中的序号（从 1 起算；若全选 36 项指标，即对应上方 `1`～`36` 编号）。
- **样式前缀**：
  - 纯数字（如 `1`）或 `t1` 或纯英文标识码（如 `quota`）或 `t:quota` 均为**文字标签样式**。
  - `e1` 或 `e:quota` 为**表情符号（Emoji）样式**（大小写不分）。
  - 可自由混搭（例如 `e1, 18, e17, 31`），未指定样式者一律默认文字样式。
- **英文标识码**：可混用如 `quota`、`model-name` 等标识码，但使用数字序号最简洁。
- **`n` 换行符号**：插入 `n` 可在该位置强制换行；连续输入 `n,n` 可产生一行空行作为分区间隔。
- **未列入的指标将不予显示**：排序字符串的结果即为最终显示集合。
- 若留空或选择 `跳过`，则沿用原勾选顺序并启用全部已勾选指标（默认文字样式）。
- **顺序记录保存**：设置完成时，技能会自动输出先前与本次的排版顺序字符串，日后若需微调可直接复制粘贴重现。

排序后显示效果预览——**混搭／个别样式模式**（四大逻辑分区、共 8 行信息并搭配空行分隔）：

```text
🤖 Gemini 3.8 Flash (High) │ 📧 anandydy529@gmail.com │ 💎 Google AI Pro │ 🛡️ 关闭
🪪 Default │ 代理状态: 执行中 │ 子代理: 2 │ 产出文件: 0 │ 待处理输入: 0 │ 后台任务: 0 │ 工具待确认: 无

上下文用量: 18.5% [█░░░░░░░░░] │ 令牌数: 185.0k / 1.0M [█░░░░░░░░░]
五小时可用: 88% [████████░░] │ 五小时倒数: 4h 50m │ 五小时重置: 15:50
七日内可用: 78% [███████░░░] │ 七日内倒数: 4d 5h │ 七日内重置: 2026/10/18 16:00
Argon 可用: 59% [█████░░░░░] │ Argon 倒数: 6d 1h │ Argon 重置: 2026/10/30 23:57

版控状态: 无变更 │ 版控类型: git │ 🔀 main
📁 antigravity-cli-statusline │ 完整路径: /Users/andyawd/Project/antigravity-cli-statusline
⚙️ Accept-edits │ 💬 c5168b1c │ 💾 279MB │ 版本: v1.3.2
```

### 换行

两种换行机制并存运作：

1. **自动智能折行**：渲染脚本会自动检测终端宽度，当下一个指标加入后会超出单行宽度时，自动折叠至下一行，无需手动配置。
2. **强制换行（`n`）**：在排序字符串中插入 `n` 即可在指定位置强制换行，可重复使用：

```text
1,2,n,3,4
```

### 动态色彩

采用 24-bit truecolor 四阶柔和配色（`#57caff` 蓝 → `#5cdb6d` 绿 → `#ffd427` 黄 → `#ff7daf` 粉红），依据应用程序接口额度剩余比例或上下文消耗比例动态变色；不同人工智能模型家族（Gemini、Claude、GPT）也会应用专属的品牌识别色。

## 贡献指南

欢迎提交贡献——包括新增指标、跨平台修复以及新增其他语言翻译。详细工作流程请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 致谢

特别感谢 [60ke/antigravity-statusline](https://github.com/60ke/antigravity-statusline) 项目。本项目的额度监控灵感正是来自于此。由于该原项目主要使用 Python 编写，在 Windows 和 macOS 跨平台执行上可能遇到环境配置的困难，因此本项目使用 JavaScript (Node.js) 进行改写，以实现真正的跨平台免额外依赖执行。

## 许可证

本项目采用 MIT 许可证发布，详情请参阅 [LICENSE](LICENSE) 文件。
