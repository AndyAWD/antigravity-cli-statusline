# antigravity-cli-statusline

[English](README.md) | [繁體中文](README.zh-TW.md) | 简体中文 | [日本語](README.ja.md)

[![版本](https://img.shields.io/badge/版本-2.1.3-blue.svg)](skills/agy-cli-statusline/SKILL.md)
[![授权条款: MIT](https://img.shields.io/badge/授权条款-MIT-yellow.svg)](LICENSE)
[![平台](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

专为 **Antigravity 命令行界面（`agy`）** 与 **Antigravity App（2.0，`v2.34.0+`）** 打造的双端实时遥测与状态栏插件（Plugin）——提供 36 项实时指标（人工智能模型与 Orchestrator 协调器实际底层模型追踪、5 小时／7 日双轨额度、上下文令牌分解、Git 状态、代理活动，以及 CLI 与 2.0 双端版本号），支持个别混搭文字（`text`）或表情符号（`emoji`）标签风格、在 Antigravity 2.0 以鼠标分列拖拽调序与换行（或在 CLI 通过 7 步骤问卷向导自定义），并内置 4 种语言（`zh-cn`、`zh-tw`、`us`、`jp`）。

全面跨平台支持 Windows、macOS 与 Linux，覆盖 Google Antigravity 的三大使用界面：Antigravity 命令行界面（`agy`）、Antigravity 集成开发环境（Integrated Development Environment）侧边栏，以及 Antigravity 2.0 桌面应用程序。

## 状态栏实际运作展示

<p align="center">
  <img src="docs/images/statusline-demo-zh-cn.svg" alt="Antigravity 命令行界面状态栏交互设置与动态遥测展示：从执行 /antigravity-cli-statusline:agy-cli-statusline 指令、语言选择、五大分类分页勾选、自定义排序 Write-in 到 10 列完整状态栏即时运作。" width="100%">
</p>

动态展示从执行设置命令 `/antigravity-cli-statusline:agy-cli-statusline`、问卷交互选取指标、自定义排序输入，到最终呈现多行高信息密度状态栏的完整 CLI 实时遥测流程。

## 特色亮点

1. **双端原生体验（Antigravity 2.0 可视化面板 ＋ CLI 终端）**：
   - **Antigravity 2.0（MCP Apps）**：通过 `ui://statusline/app.html` 零依赖开箱即用（无需 `npm install`），提供右侧辅助面板与全页仪表板双视图，支持就地分列拖拽排版、5 大分类 36 项指标抽屉与实时数值预览、可折叠令牌分类明细（`tokenBreakdown`）堆叠条、自动跟随／固定对话切换、1 秒实时倒计时、旧版排序语法导入／导出，以及紧凑行不断开指标自动换行。
   - **Antigravity CLI（`agy`）**：提供 7 步骤分页问卷向导、终端宽度感知智能折行与即时热更新。
2. **36 项实时指标、4 种语言与双标签风格**：涵盖人工智能（Artificial Intelligence）模型状态（在 Orchestrator 模式下，`model-name` 保留外层包装模型名称，`active-model` 实时追踪 `规划者` 与 `执行者` 角色对应的实际底层模型，非协调器模式则一律以红色显示关闭）、应用程序接口（Application Programming Interface）配额（五小时与每周双轨额度，具备四层动态配额池归属解析与 60 秒过期宽限期实时倒计时重算）、上下文（Context）与令牌（Token）消耗、交互队列、Git 版本控制状态、系统资源，以及同时跨平台检测的 Agy CLI 与 Agy 2.0 双端版本号；支持简体中文（`zh-cn`）、繁体中文（`zh-tw`）、英文（`us`）与日文（`jp`），并可为各指标独立切换**文字标签（`text`）**或**表情符号标签（`emoji`）**。
3. **灵活百分比长条图（支持合并与分开显示）**：针对五小时额度、每周额度、上下文用量与令牌数提供默认 10 格视觉长条图（`[████████░░]`）；数值与长条图相邻且样式一致时自动合并为单一标签，未相邻或样式不同时则各自独立显示。
4. **自定义排序与双轨换行机制**：支持以 1 起算数字序号或英文标识码（Identifier）排序、个别样式前缀（`t` / `e`）、`n` 强制换行、`n,n` 空白分隔行，并依终端或 2.0 面板宽度自动整组折行。
5. **24-bit 四阶动态色彩与品牌识别色**：依据配额剩余比例或上下文消耗程度动态切换 4 个色阶（`#57caff` 蓝色 `100~75%`、`#5cdb6d` 绿色 `74~50%`、`#ffd427` 黄色 `49~25%`、`#ff7daf` 粉红色 `24~0%`），并为各人工智能模型家族应用专属品牌识别色。
6. **跨端配置同步、智能挂钩维护与安全边界**：
   - CLI 与 2.0 共用 4 层上下文上限计算、Language Server RPC 遥测解析与配置／挂钩部署核心，并强化严格内容安全策略（CSP）与工作区路径白名单。
   - 在 Antigravity 2.0 首次打开会自动继承既有 CLI `settings.json` 排版，并提供“仅应用至 2.0 面板”与“同步应用至 2.0 ＋ CLI”双保存模式；同步至 CLI 时会自动更新过旧或哈希不同步的既有 CLI 挂钩脚本（不覆盖既有 `statusLine` 命令，对已同步、更新版本或未安装状态保持跳过）。
   - CLI 端同步命令行界面专属、全局与项目三层 `settings.json` 及 `trusted_hooks.json`，内置 macOS/Linux NVM 绝对路径解析与 Windows UTF-8 字节顺序标记（Byte Order Mark）自动剥除机制。
7. **非侵入式版本更新检查**：当 `ui.footer.items` 启用 `plugin-update`（`#35`）时，每次启动交互式 `agy` 检查一次 GitHub Releases（跳过 `agy -p`），无更新自动隐藏并修剪首尾纯空白行，离线时沿用缓存版本比对，落后时在配置位置独立显示两行本地化更新命令提醒（表情符号模式精简显示 `🆕 vX → vY`），与仅显示状态栏版本号的 `plugin-version`（`#34`）完全解耦；随时可运行 `diagnose-statusline.mjs` 检查插件与挂钩版本一致性。

## 如何安装

通过 Antigravity 命令行界面进行全局安装：

```bash
agy plugin install https://github.com/AndyAWD/antigravity-cli-statusline
```

### 环境要求

- **Node.js**（必需）：渲染与 MCP 脚本均以纯 `.mjs` 编写；若系统未安装 Node.js，CLI 状态栏将保持空白，且 `agy` 会在连续失败 30 次后自动禁用状态栏。CLI 设置技能在写入配置前会先进行环境预检。
- **Git**（可选）：用于读取 `git-branch`、`vcs-dirty`、`vcs-type` 等版本控制系统（Version Control System）指标。

### 启用与生效机制

- **Antigravity App（2.0，`v2.34.0+`）**：安装后即可开箱即用，**无需执行 `npm install`**。可在 **Overview > Plugins > Statusline**、侧边栏 **`+`** 菜单（右侧辅助面板）或左侧导航栏 **Plugins > Statusline**（全页仪表板）打开；首次运行会自动继承 CLI `settings.json` 排版，通过“同步应用至 2.0 ＋ CLI”保存时也会自动更新过旧的既有 CLI 挂钩脚本。
- **初次启用（CLI）**：初次安装或初次启用 CLI 状态栏时，可直接在 `agy` 输入配置脚本输出的 `/statusline <command>` 立即启用，或重新启动 `agy` 命令行界面（退出后重新打开）以载入状态栏挂钩（Hook）。
- **热更新（Hot Reload，CLI）**：此前已启用状态栏者，后续调整指标顺序、切换标签显示风格（`text` / `emoji`）或切换语言时，状态栏会直接热更新生效，无需重新启动命令行界面。

## 命令与技能说明

安装完成后，可根据当前使用的界面执行对应斜线命令（Slash Command）：

### 1. 打开可视化状态栏面板（Antigravity 2.0 App）

```text
/antigravity-cli-statusline:agy-app-statusline
```

- **使用场景**：在 Antigravity App（`v2.34.0+`）直接在右侧辅助面板打开 **Statusline** 实时监控与分列拖拽排版界面（无需回答任何 `ask_question` 问卷）；也可随时从右上角 **Overview > Plugins > Statusline**、侧边栏 **`+`** 菜单或左侧导航栏 **Plugins > Statusline**（全页）打开。
- **CLI 回退行为**：若在 Antigravity CLI（`agy`）中调用，`statusline_dashboard` 工具会返回纯文本状态摘要，并引导改用 `/antigravity-cli-statusline:agy-cli-statusline` 进行终端底部状态栏配置。

### 2. 状态栏设置技能（Antigravity CLI）

```text
/antigravity-cli-statusline:agy-cli-statusline
```

- **使用场景**：初次启用命令行界面状态栏、切换显示语言（`zh-tw` / `zh-cn` / `us` / `jp`）、切换文字（`text`）或表情符号（`emoji`）标签显示风格、增减显示指标，或重新调整多行排版顺序时。
- **运作流程**：
  1. 询问显示语言，并将后续所有设置交互锁定为所选语言。
  2. 执行 Node.js 环境预检（三层 `settings.json` 的读写均由步骤 5 的 `configure-statusline.mjs` 安全处理，不直接访问 `~/.gemini/`）。
  3. 载入 `questions.json` 以五大分类分页依序提供指标勾选，避开终端屏幕高度截断问题。
  4. 以精简三栏表格列出所选指标，接收自定义排序与个别样式前缀（纯数字、`t` 文字前缀、`e` 表情符号前缀与 `n` 换行符号），将 `ui.footer.items` 与 `ui.footer.itemStyles` 写入三层 `settings.json`，并将主挂钩脚本、四层 `lib/` 子模块与 `.hook-version.json` SHA-256 哈希清单同步部署至 `~/.gemini/antigravity-cli/hooks/` 完成验证。
  5. 设置完成后，自动以代码块回报先前与本次的排版顺序字符串，方便随时复制粘贴重现设置。

## 如何管理与切换插件

- 列出已安装插件：

  ```bash
  agy plugin list
  ```

- 启用插件：

  ```bash
  agy plugin enable antigravity-cli-statusline
  ```

- 停用插件：

  ```bash
  agy plugin disable antigravity-cli-statusline
  ```

- 移除插件：

  ```bash
  agy plugin uninstall antigravity-cli-statusline
  ```

## 项目文件夹目录

```text
antigravity-cli-statusline/
├── plugin.json                                     # Antigravity 插件清单
├── mcp_config.json                                 # Antigravity 2.0 MCP 服务器配置
├── hooks.json                                      # 生命周期挂钩（SessionStart/PreInvocation/PostInvocation/Stop）
├── package.json                                    # 包元数据与 npm 脚本
├── LICENSE                                         # MIT 许可证
├── CONTRIBUTING.md                                 # 三语系贡献指南
├── README.md / README.zh-TW.md / README.zh-CN.md / README.ja.md
├── assets/
│   └── logo.svg                                    # Antigravity App 插件图标
├── docs/
│   ├── ARCHITECTURE_HANDOVER.md                    # 四层架构交接与扩展指南
│   ├── images/                                     # 实机截图与动态示例矢量图
│   └── workshop/                                   # 工作坊幻灯片与素材
├── src/app/                                        # Antigravity 2.0 MCP App 前端源码（esbuild）
├── scripts/
│   ├── build-app.mjs                               # 编译 src/app/ 为单一文件 scripts/mcp/statusline-app.html
│   ├── hooks/record-session.mjs                    # 生命周期挂钩写入脚本（隔离于 ${PLUGIN_DATA}）
│   ├── mcp/                                        # MCP 服务器、LS 遥测、对话记录读取与 CLI 桥接
│   └── tests/                                      # Antigravity 2.0 Hook、MCP 与同步契约测试
└── skills/
    ├── agy-app-statusline/
    │   └── SKILL.md                                # Antigravity 2.0 可视化面板技能入口
    └── agy-cli-statusline/
        ├── SKILL.md                                # CLI 七步骤问卷向导入口
        ├── references/                             # 技术规范、配置文件、Windows 与陷阱文档
        ├── resources/                              # 自动生成的四语系对话模板与五大分类问卷
        └── scripts/                                # CLI statusLine 挂钩与四层零依赖 ESM 模块
```

---

## 指标、排序与换行

### 可显示的指标（1–36）

以下编号对应技能步骤 3 问卷（`resources/questions.json`）中五大分类分页选项序号（从 1 起算），以及各指标在 `emoji` 模式下对应的表情符号：

**1. 模型与代理（5 项）**
- `1.` 🤖 **当前使用的人工智能模型名称（`model-name`）**：实时显示对话正在使用的模型（在 Orchestrator 模式下显示外层包装模型名称，如 `Orchestrator (Neon)`）
- `2.` 🪪 **使用中代理（`agent-profile`）**：当前加载的 Agent Profile 名称
- `3.` ⚡ **代理当前状态（`agent-state`）**：`闲置 / 思考中 / 执行中 / 调用工具 / 初始化`
- `4.` ⚙️ **当前运行模式（`mode`）**：`default / code-only / plan / interactive / accept-edits`
- `5.` 🪄 **协调器当前实际执行的底层模型（`active-model`）**：使用 Orchestrator 时实时显示实际执行的底层模型与角色分工（文字样式为 `规划者:`／`执行者:`，表情符号为 `🪄 规划者 →`／`🪄 执行者 →`；尚未路由前显示 `协调器: 待命`）；非 Orchestrator 模式一律以红色显示 `关闭`

**2. 额度、计费与账号（10 项）**
- `6.` 🔋 **账号五小时可用额度百分比（`quota`）**：五小时应用程序接口可用额度百分比，搭配四阶配色
- `7.` 🔋 **五小时可用额度长条图（`quota-bar`）**：10 格五小时可用额度长条图（`[████████░░]`）
- `8.` ⏳ **账号五小时额度重置时间倒计时（`quota-reset-countdown`）**：距离五小时额度重置的剩余时间
- `9.` 🕒 **五小时重置时间（`quota-reset-time`）**：本机时区绝对重置时间（默认同日 `HH:mm`、跨日 `yyyy/MM/dd HH:mm`）
- `10.` 📅 **账号每周可用额度百分比（`quota-weekly`）**：每周应用程序接口可用额度百分比，搭配四阶配色
- `11.` 📅 **每周可用额度长条图（`quota-weekly-bar`）**：10 格每周可用额度长条图（`[███████░░░]`）
- `12.` ⏲️ **账号每周额度重置时间倒计时（`quota-weekly-countdown`）**：距离每周额度重置的剩余时间
- `13.` 🗓️ **每周重置时间（`quota-weekly-reset-time`）**：每周额度重置的本机绝对时间（如 `2026/10/18 16:00`）
- `14.` 💎 **当前订阅计划等级（`plan-tier`）**：当前账号的订阅等级
- `15.` 📧 **账号电子邮件（`account-email`）**：当前登录的账号邮箱

**3. 上下文与令牌（4 项）**
- `16.` 🧠 **当前对话已消耗的上下文用量比例（`context-used`）**：上下文窗口已消耗百分比
- `17.` 🧠 **上下文用量长条图（`context-used-bar`）**：10 格上下文消耗长条图（`[█░░░░░░░░░]`）
- `18.` 💰 **当前会话（Session）消耗的精确令牌数量（`token-count`）**：当前对话累计令牌数
- `19.` 💰 **令牌数长条图（`token-count-bar`）**：10 格令牌消耗长条图（`[█░░░░░░░░░]`）

**4. 工作区与版本控制（5 项）**
- `20.` 📁 **当前工作区项目短路径（`project-path`）**：工作区文件夹名称
- `21.` 📍 **当前工作区项目完整路径（`project-full-path`）**：工作区绝对路径
- `22.` 🔀 **当前工作区项目的 Git 分支（`git-branch`）**：当前所在的 Git 分支名称
- `23.` 🔍 **工作区是否有未提交变更（`vcs-dirty`）**：`未提交 / 无变更`
- `24.` 🗃️ **版本控制类型（`vcs-type`）**：`git / jj / fig`

**5. 系统状态与后台任务（12 项）**
- `25.` 💾 **命令行界面进程所消耗的随机存取内存量（`memory-usage`）**：`agy` 进程占用的内存大小
- `26.` 🚀 **Antigravity 命令行界面版本号（`cli-version`）**：已安装的 `agy` 命令行界面版本（文字模式标签为 `Agy CLI 版本:`；在 CLI 与 2.0 均会自动检测显示）
- `27.` 💬 **当前对话标识码前 8 位（`conversation-id`）**：供调试定位使用
- `28.` 🛡️ **沙箱模式状态（`sandbox-status`）**：`off / on (net) / on (no-net)`
- `29.` 🔔 **是否有等你响应的工具确认对话框（`tool-confirmation`）**：提示是否有工具正在等待用户确认
- `30.` 📥 **队列中待处理的用户输入数（`pending-input`）**：排队等待执行的用户输入数量
- `31.` 🔄 **进行中的后台任务数（`background-tasks`）**：运行中的后台进程数量
- `32.` 👥 **活跃子代理数（`subagents`）**：运行中的子代理数量
- `33.` 📄 **本次对话人工智能累计产出的文件数量（`artifacts`）**：本次对话产出的 Artifacts 数量
- `34.` 🧩 **状态栏版本号（`plugin-version`）**：仅显示已安装的 `antigravity-cli-statusline` 版本号（文字模式标签为 `状态栏版本:`；不触发更新检查或提醒）
- `35.` 🆕 **状态栏新版本更新提醒（`plugin-update`）**：在每次启动交互式 `agy` 时检查一次 GitHub Releases（跳过 `agy -p`），无更新自动隐藏，有新版时在排定位置显示两行更新提醒
- `36.` 💻 **Antigravity 2.0 应用程序版本号（`app-version`）**：已安装的 Antigravity 2.0 桌面应用程序版本号（文字模式标签为 `Agy 2.0 版本:`；在 CLI 与 2.0 均会自动检测显示）

### 排序规则与样式设置

在 CLI 向导步骤 4 的自定义排序输入框（或 Antigravity 2.0 面板的排序语法导入／导出栏位）填入以逗号分隔的指标序号，即可完成排序与个别样式设置（未列入的指标不予显示；留空或选择跳过则沿用原勾选顺序与默认文字样式）：

- **样式前缀设置**：
  - **文字标签样式（`text`，默认）**：纯数字序号（如 `1`）、`t` 前缀（如 `t1`）或纯英文标识码（如 `quota`、`t:quota`），显示为所选语言的文字标签搭配冒号（例如 `五小时可用: 88%`）。
  - **表情符号样式（`emoji`）**：使用 `e` 前缀（如 `e1`、`e:quota`，大小写不分），将文字标签替换为表情符号加单一空格（例如 `🔋 88%`），状态值仍保持多语言显示。
  - **个别混搭**：各指标可独立指定样式（例如 `e1, 15, e14, 28`），未指定者默认文字样式。
- **百分比长条图合并与分开机制**：
  - 针对四组指标配对（`quota` `6`+`7`、`quota-weekly` `10`+`11`、`context-used` `16`+`17`、`token-count` `18`+`19`），当数值指标与长条图**相邻排列**（如 `6,7`）且样式一致时，自动合并为单一标签与进度条。
  - 若两者**未相邻**（中间隔有其他指标或换行）或样式冲突（一为 `text`、一为 `emoji`）时，则各自以独立标签分开显示。
  - 长条图默认长度为 10 格（`[████████░░]`，可通过 `ui.footer.barLength` 自定义），绝对重置时间格式可通过 `ui.footer.timeFormat` 设置。
- **换行与分区间隔**：
  - **强制换行（`n`）**：插入 `n` 在指定位置换行；连续插入 `n,n` 可产生一行空白分隔行。
  - **自动智能折行**：当指标总长度超出终端或 2.0 面板宽度时，会以完整指标为单位自动折叠至下一行。
- **动态色彩变换**：
  - 状态栏采用 24-bit truecolor 四阶柔和配色（`#57caff` 蓝色 → `#5cdb6d` 绿色 → `#ffd427` 黄色 → `#ff7daf` 粉红色），依据额度剩余比例或上下文消耗比例动态变色；不同模型家族也会应用专属品牌识别色。

#### 排序输入示例

- **英文标识码版本**：
  ```text
  e:model-name,active-model,e:account-email,e:plan-tier,e:sandbox-status,n,e:agent-profile,agent-state,subagents,artifacts,pending-input,background-tasks,tool-confirmation,n,n,context-used,context-used-bar,token-count,token-count-bar,n,quota,quota-bar,quota-reset-countdown,quota-reset-time,n,quota-weekly,quota-weekly-bar,quota-weekly-countdown,quota-weekly-reset-time,n,n,vcs-dirty,vcs-type,e:git-branch,n,e:project-path,project-full-path,n,n,e:mode,e:conversation-id,e:memory-usage,cli-version,app-version,plugin-version,n,e:plugin-update
  ```

#### 效果预览（混搭模式）

包含四大逻辑分区、共 8 行信息并搭配空白分隔行（版本已是最新时，`e:plugin-update` 会自动隐藏并修剪尾端换行）：

```text
🤖 Orchestrator (Neon) │ 规划者: Gemini 4 Neon (High) │ 📧 anandydy529@gmail.com │ 💎 Google AI Pro │ 🛡️ 关闭
🪪 Default │ 代理状态: 执行中 │ 子代理: 2 │ 产出文件: 0 │ 待处理输入: 0 │ 后台任务: 0 │ 工具待确认: 无

上下文用量: 18.5% [█░░░░░░░░░] │ 令牌数: 47.4k / 256.0k [█░░░░░░░░░]
五小时可用: 88% [████████░░] │ 五小时倒数: 4h 50m │ 五小时重置: 15:50
七日内可用: 78% [███████░░░] │ 七日内倒数: 4d 5h │ 七日内重置: 2026/10/18 16:00

版控状态: 无变更 │ 版控类型: git │ 🔀 main
📁 antigravity-cli-statusline │ 完整路径: /Users/andyawd/Project/antigravity-cli-statusline

⚙️ Accept-edits │ 💬 c5168b1c │ 💾 279MB │ Agy CLI 版本: v1.5.10 │ Agy 2.0 版本: v2.34.0 │ 状态栏版本: v2.1.3
```

当启用 `plugin-update`（`#35`）且检测到较新的 GitHub Release 时，会在配置的位置独立显示两行更新提醒（在终端执行 `agy plugin install` 后版本即追平并自动消除提醒；如需同步过旧的 CLI 挂钩脚本，可在 Antigravity 2.0 点击“同步应用至 2.0 ＋ CLI”或在 CLI 重跑 `/antigravity-cli-statusline:agy-cli-statusline`，也可运行 `node skills/agy-cli-statusline/scripts/diagnose-statusline.mjs` 检查版本号差异）：

```text
⚠️ 状态栏有新版本可用（当前 v2.1.2 → 最新 v2.1.3），请执行以下命令更新：
agy plugin install https://github.com/AndyAWD/antigravity-cli-statusline
```

采用表情符号样式（`e35` / `e:plugin-update`）时，第一行会精简显示为 `🆕 v2.1.2 → v2.1.3` 并搭配第二行独立更新命令；若版本已是最新则自动隐藏并修剪首尾纯空白行。

## 贡献指南

欢迎提交贡献——包括新增指标、跨平台修复以及新增其他语言翻译。详细项目结构与工作流程请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 致谢

- **[60ke/antigravity-statusline](https://github.com/60ke/antigravity-statusline)**：本项目的额度监控灵感正是来自于此。由于该原项目主要使用 Python 编写，在 Windows 和 macOS 跨平台执行上可能遇到环境配置的困难，因此本项目使用 JavaScript (Node.js) 进行改写，以实现真正的跨平台免额外依赖执行。
- **[ericsk/agy-gcp-companion](https://github.com/ericsk/agy-gcp-companion)**：本次将底部状态栏转移并整合至 Antigravity 2.0 的交互式面板，正是受到该项目侧边栏设计的启发而实现。

## 许可证

本项目采用 MIT 许可证发布，详情请参阅 [LICENSE](LICENSE) 文件。
