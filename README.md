# antigravity-cli-statusline

English | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

[![Version](https://img.shields.io/badge/version-1.10.1-blue.svg)](skills/agy-cli-statusline/SKILL.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

An Antigravity plugin that customizes the Antigravity Command-Line Interface (CLI) statusline (footer) — select from 36 real-time indicators, switch between Text (`text`) and Emoji (`emoji`) label styles, arrange them in any order, display capacity bar graphs in merged or separate modes, and apply automatic or manual line wrapping across 4 languages (`us`, `zh-tw`, `zh-cn`, `jp`).

Comprehensive support across the three core platforms of Google Antigravity (AGY): Antigravity Command-Line Interface (CLI) (`agy`), Antigravity Integrated Development Environment (IDE), and Antigravity 2.0 Desktop Application.

## Screenshots

### Windows

| English (us) | Traditional Chinese (zh-tw) | Simplified Chinese (zh-cn) | Japanese (jp) |
| :---: | :---: | :---: | :---: |
| ![English](docs/images/agy-cli-statusline-windows-us.png) | ![Traditional Chinese](docs/images/agy-cli-statusline-windows-zhtw.png) | *(supports zh-cn mode)* | ![Japanese](docs/images/agy-cli-statusline-windows-jp.png) |

### macOS

| English (us) | Traditional Chinese (zh-tw) | Simplified Chinese (zh-cn) | Japanese (jp) |
| :---: | :---: | :---: | :---: |
| ![English](docs/images/agy-cli-statusline-macos-us.png) | ![Traditional Chinese](docs/images/agy-cli-statusline-macos-zhtw.png) | *(supports zh-cn mode)* | ![Japanese](docs/images/agy-cli-statusline-macos-jp.png) |

## Installation

Install the plugin globally using the Antigravity Command-Line Interface (CLI):

```bash
agy plugin install https://github.com/AndyAWD/antigravity-cli-statusline
```

### Prerequisites

- **Node.js** (required): The renderer scripts are written in pure `.mjs`. Without Node.js, the statusline stays blank and `agy` disables it after 30 consecutive failures. The skill pre-checks Node.js availability before writing configurations.
- **Git** (optional): Required for `git-branch`, `vcs-dirty`, and `vcs-type` indicators.

### Activation Behavior

- **First-time Enablement**: When installing or enabling the statusline for the first time, `agy` CLI does not dynamically register new hook processes at runtime; restart `agy` CLI (exit and reopen) to load the statusline hook.
- **Hot Reload**: Once enabled, subsequent changes to indicator ordering, label style (`text` / `emoji`), or display language take effect immediately without restarting the CLI.

## Key Features

1. **Multi-Platform Compatibility**: Supports Antigravity CLI terminal, Antigravity IDE sidebar chat, and Antigravity 2.0 Desktop Application across Windows, macOS, and Linux.
2. **36 Real-Time Indicators, 4 Locales & Dual Label Styles**: Provides 36 metrics across model status, API quotas (including 5-hour, weekly, and Gemini 4 Argon dedicated quota pools), context/token consumption, interactive queues, Git/VCS state, and system telemetry in English (`us`), Traditional Chinese (`zh-tw`), Simplified Chinese (`zh-cn`), and Japanese (`jp`), with selectable **Text (`text`)** or **Emoji (`emoji`, no-colon compact)** label styles (`ui.footer.labelStyle`).
3. **Flexible Bar Graphs (Merged or Separate)**: Renders 10-block visual progress bars (`[████████░░]`) for hourly quota, weekly quota, Gemini 4 Argon quota, context usage, and session tokens. Automatically merges labels when placed adjacent to numeric counterparts, or displays them with independent labels when separated.
4. **Custom Sorting & Dual Line-Wrapping**: Supports 1-based index sorting, `n` manual line breaks, `n,n` blank-line section separators, and terminal-width-aware automatic wrapping.
5. **24-Bit Four-Tier Color Coding**: Shifts colors across 4 thresholds (`100–75%` Blue, `74–50%` Green, `49–25%` Yellow, `24–0%` Pink) alongside model-family brand colors.
6. **Three-Layer Config Sync & OS Safeguards**: Synchronizes CLI-specific, global, and workspace `settings.json` plus `trusted_hooks.json`, while handling macOS/Linux NVM path resolution and Windows UTF-8 Byte Order Mark (BOM) prevention.

## Plugin Management

• List installed plugins:

  ```bash
  agy plugin list
  ```

• Enable this plugin:

  ```bash
  agy plugin enable antigravity-cli-statusline
  ```

• Disable this plugin:

  ```bash
  agy plugin disable antigravity-cli-statusline
  ```

• Uninstall this plugin:

  ```bash
  agy plugin uninstall antigravity-cli-statusline
  ```

## Directory Structure

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

## Commands and Skills

Once installed, trigger the configuration workflow using the slash command:

### 1. Configure Statusline

```text
/antigravity-cli-statusline:agy-cli-statusline
```

- **When to Use**: When enabling the statusline for the first time, switching display language (`us` / `zh-tw` / `zh-cn` / `jp`), switching between Text (`text`) and Emoji (`emoji`) label styles, selecting indicators, or customizing multi-line layout order.
- **How It Works**:
  1. Prompts for display language selection and locks the session output to that locale.
  2. Verifies Node.js environment availability and inspects the three-layer `settings.json` files.
  3. Sequentially prompts for indicator selection across 5 categorized tabs from `questions.json`, avoiding terminal screen height truncation (Issue #1262).
  4. Displays selected indicators and accepts a custom sort order with individual style prefixes (supporting plain numbers, `t` text prefix, `e` emoji prefix, and `n` newline tokens), writing `ui.footer.items` and `ui.footer.itemStyles` across all three `settings.json` layers, and deploys hook scripts to `~/.gemini/antigravity-cli/hooks/`.
  5. Upon completion, automatically prints code blocks containing the previous and current layout order strings for easy copy-paste reuse.

---

## Indicators, Sorting & Line Wrapping

### Available Indicators (1–36)

The numbers below correspond to the 1-based option indices across the 5 categories in Step 3 (`resources/questions.json`), along with each indicator's Emoji prefix used in `emoji` mode:

**1. Model & Agent (4 items)**
- `1.` 🤖 **Current AI model name (`model-name`)** — the model serving the current conversation
- `2.` 🪪 **Active agent profile (`agent-profile`)** — the loaded Agent Profile name
- `3.` ⚡ **Agent state (`agent-state`)** — `idle / thinking / working / tool_use / initializing`
- `4.` ⚙️ **Current running mode (`mode`)** — `default / code-only / plan / interactive / accept-edits`

**2. Quota, Billing & Account (14 items)**
- `5.` 🔋 **5-hour available quota (`quota`)** — 5-hour API remaining percentage, four-tier color-coded
- `6.` 🔋 **5-hour available quota bar graph (`quota-bar`)** — 10-block 5-hour quota bar (`[████████░░]`)
- `7.` ⏳ **5-hour quota reset countdown (`quota-reset-countdown`)** — time remaining until 5-hour quota refresh
- `8.` 🕒 **5-hour reset time (`quota-reset-time`)** — local timezone reset timestamp (`HH:mm` same day, `yyyy/MM/dd HH:mm` across days)
- `9.` 📅 **Weekly available quota (`quota-weekly`)** — weekly API remaining percentage, four-tier color-coded
- `10.` 📅 **Weekly available quota bar graph (`quota-weekly-bar`)** — 10-block weekly quota bar (`[███████░░░]`)
- `11.` ⏲️ **Weekly quota reset countdown (`quota-weekly-countdown`)** — time remaining until weekly refresh
- `12.` 🗓️ **Weekly reset time (`quota-weekly-reset-time`)** — weekly local reset timestamp (e.g., `2026/10/18 16:00`)
- `13.` ✨ **Gemini 4 Argon available quota (`quota-argon`)** — Gemini 4 Argon dedicated quota percentage, four-tier color-coded
- `14.` ✨ **Gemini 4 Argon quota bar graph (`quota-argon-bar`)** — 10-block Argon quota bar (`[█████░░░░░]`)
- `15.` ⏱️ **Gemini 4 Argon reset countdown (`quota-argon-countdown`)** — time remaining until Argon quota refresh
- `16.` ⏰ **Gemini 4 Argon reset time (`quota-argon-reset-time`)** — Argon local reset timestamp (e.g., `2026/10/30 23:57`)
- `17.` 💎 **Subscription plan tier (`plan-tier`)** — current subscription plan level
- `18.` 📧 **Account email (`account-email`)** — logged-in account email address

**3. Context & Tokens (4 items)**
- `19.` 🧠 **Context used percentage (`context-used`)** — percentage of context window consumed
- `20.` 🧠 **Context used bar graph (`context-used-bar`)** — 10-block context consumed bar (`[█░░░░░░░░░]`)
- `21.` 💰 **Exact token count (`token-count`)** — token usage in the current session
- `22.` 💰 **Token count bar graph (`token-count-bar`)** — 10-block token consumed bar (`[█░░░░░░░░░]`)

**4. Workspace & VCS (5 items)**
- `23.` 📁 **Workspace short path (`project-path`)** — current workspace directory basename
- `24.` 📍 **Workspace full path (`project-full-path`)** — absolute workspace directory path
- `25.` 🔀 **Current Git branch (`git-branch`)** — active branch name
- `26.` 🔍 **VCS uncommitted status (`vcs-dirty`)** — `uncommitted / no changes`
- `27.` 🗃️ **VCS type (`vcs-type`)** — `git / jj / fig`

**5. System Status & Background Tasks (9 items)**
- `28.` 💾 **CLI RAM usage (`memory-usage`)** — RSS memory consumed by the `agy` process
- `29.` 🚀 **Antigravity CLI version (`cli-version`)** — current CLI version string
- `30.` 💬 **Conversation ID (`conversation-id`)** — first 8 characters of conversation ID for debugging
- `31.` 🛡️ **Sandbox status (`sandbox-status`)** — `off / on (net) / on (no-net)`
- `32.` 🔔 **Pending tool confirmation (`tool-confirmation`)** — whether a tool confirmation dialog is awaiting response
- `33.` 📥 **Pending user inputs (`pending-input`)** — queued user inputs waiting to run
- `34.` 🔄 **Running background tasks (`background-tasks`)** — active background task count
- `35.` 👥 **Active subagents (`subagents`)** — running subagent count
- `36.` 📄 **Total artifacts (`artifacts`)** — cumulative files/outputs produced in this session

### Label Display Styles: Text (`text`) vs. Emoji (`emoji`)

Individual indicator styles can be customized during Step 4 sorting via style prefixes (saved in the `ui.footer.itemStyles` map across `settings.json`; unconfigured items strictly default to text):

- **Text label style (`text`, default)**: Displays localized text prefixes with a colon (e.g., `Model: Gemini 3.1 Pro │ 5-hr Available: 88% │ Branch: main`). Plain numeric indices (e.g. `1`), `t` prefix (e.g. `t1`), or plain English IDs (`quota`, `t:quota`) all resolve to text style.
- **Emoji label style (`emoji`)**: Replaces text label prefixes and colons with the indicator's Emoji followed by a single space (e.g., `🤖 Gemini 3.1 Pro │ 🔋 88% │ 🔀 main`), while keeping status values (`none`, `no changes`, `off`) localized in your chosen language. Use an `e` prefix (e.g. `e1`, `e:quota`) to assign emoji style. Items can be mixed freely (e.g. `1, e2, t3, e:git-branch`).
- **Bar Graph Style Conflict Handling**: If adjacent bar graph indicators have conflicting styles (one text, one emoji), they will not merge; they render as two separate blocks.

### Percentage Bar Graphs: Merged vs. Separate Display

Default bar length is 10 blocks (`[████████░░]`), configurable via `ui.footer.barLength` in `settings.json`. Solid block `█` represents capacity or usage, while shaded block `░` represents empty space. Reset time format is configurable via `ui.footer.timeFormat` (`"smart"`, `"yyyy/MM/dd HH:mm"`, `"12h"`, or `"24h"`).

Five indicator pairs support percentage bar graphs:
- `quota` (`5`) + `quota-bar` (`6`)
- `quota-weekly` (`9`) + `quota-weekly-bar` (`10`)
- `quota-argon` (`13`) + `quota-argon-bar` (`14`)
- `context-used` (`19`) + `context-used-bar` (`20`)
- `token-count` (`21`) + `token-count-bar` (`22`)

#### 1. Merged Display Example (Adjacent Auto-Merge)

When a numeric indicator and its corresponding bar graph are placed **adjacent** to each other (in either order, e.g., `5,6` or `6,5`), the renderer automatically merges them under a single label and separator:

- **Sort Input**:
  ```text
  19,20,21,22,n,5,6,9,10,n,13,14
  ```
- **Merged Output Preview (Text Mode `text`)**:
  ```text
  Context Used: 18.5% [█░░░░░░░░░] │ Tokens: 185.0k / 1.0M [█░░░░░░░░░]
  5-hr Available: 88% [████████░░] │ 7-day Available: 78% [███████░░░]
  Argon Available: 59% [█████░░░░░]
  ```
- **Merged Output Preview (Emoji Mode `emoji`)**:
  ```text
  🧠 18.5% [█░░░░░░░░░] │ 💰 185.0k / 1.0M [█░░░░░░░░░]
  🔋 88% [████████░░] │ 📅 78% [███████░░░]
  ✨ 59% [█████░░░░░]
  ```

#### 2. Separate Display Example (Non-Adjacent / Independent Labels)

When a numeric indicator and its corresponding bar graph are **separated** by another indicator or a newline `n` (or when only the bar indicator is selected), each indicator renders individually with its own label:

- **Sort Input**:
  ```text
  19,21,n,20,22,n,5,7,6,n,9,11,10,n,13,15,14
  ```
- **Separate Output Preview**:
  ```text
  Context Used: 18.5% │ Tokens: 185.0k / 1.0M
  Context Used: [█░░░░░░░░░] │ Tokens: [█░░░░░░░░░]
  5-hr Available: 88% │ 5-hr Reset: 4h 50m │ 5-hr Available: [████████░░]
  7-day Available: 78% │ 7-day Reset: 4d 5h │ 7-day Available: [███████░░░]
  Argon Available: 59% │ Argon Reset: 6d 1h │ Argon Available: [█████░░░░░]
  ```

### Sorting & Individual Style Prefixes

In Step 4 of the skill workflow, enter a comma-separated list of numbers in the Write-in box to customize the layout and individual styles:

- **Numeric Version**:
  ```text
  e1,e18,e17,e31,n,e2,3,35,36,33,34,32,n,n,19,20,21,22,n,5,6,7,8,n,9,10,11,12,n,13,14,15,16,n,n,26,27,e25,n,e23,24,n,e4,e30,e28,29
  ```

- **Identifier Version**:
  ```text
  e:model-name,e:account-email,e:plan-tier,e:sandbox-status,n,e:agent-profile,agent-state,subagents,artifacts,pending-input,background-tasks,tool-confirmation,n,n,context-used,context-used-bar,token-count,token-count-bar,n,quota,quota-bar,quota-reset-countdown,quota-reset-time,n,quota-weekly,quota-weekly-bar,quota-weekly-countdown,quota-weekly-reset-time,n,quota-argon,quota-argon-bar,quota-argon-countdown,quota-argon-reset-time,n,n,vcs-dirty,vcs-type,e:git-branch,n,e:project-path,project-full-path,n,e:mode,e:conversation-id,e:memory-usage,cli-version
  ```

- **Numbers** refer to the 1-based position in your Step 3 selection (when all 36 indicators are selected, numbers `1`–`36` match the list above).
- **Style Prefixes**:
  - Plain numbers (e.g., `1`) or `t1`, or plain English IDs (`quota`, `t:quota`) format as **Text labels**.
  - `e1` or `e:quota` formats as **Emoji icons** (case-insensitive).
  - Can be mixed freely (e.g., `e1, 18, e17, 31`), unformatted items default to text labels.
- **Identifiers** like `quota` or `model-name` can also be used or mixed with numbers.
- **`n` token** forces a line break; consecutive `n,n` inserts a blank line to separate logical groups.
- **Omitted indicators are excluded** — the sort string defines the exact final display set.
- Leave blank or choose `Skip` to keep the original selection order with all selected indicators enabled (default text style).
- **Configuration History**: The skill automatically displays both the previous and newly configured order strings upon completion, allowing instant copy-pasting for future adjustments.

Preview of the sorted statusline in **Mixed / Individual Style Mode** (4 logical groups across 8 content lines separated by blank lines):

```text
🤖 Gemini 3.8 Flash (High) │ 📧 anandydy529@gmail.com │ 💎 Google AI Pro │ 🛡️ off
🪪 Default │ Agent: working │ Subagents: 2 │ Outputs: 0 │ Queue: 0 │ BG: 0 │ Awaiting You: none

Context Used: 18.5% [█░░░░░░░░░] │ Tokens: 185.0k / 1.0M [█░░░░░░░░░]
5-hr Available: 88% [████████░░] │ 5-hr Reset: 4h 50m │ 5-hr Reset Time: 15:50
7-day Available: 78% [███████░░░] │ 7-day Reset: 4d 5h │ 7-day Reset Time: 2026/10/18 16:00
Argon Available: 59% [█████░░░░░] │ Argon Reset: 6d 1h │ Argon Reset Time: 2026/10/30 23:57

VCS Status: no changes │ VCS: git │ 🔀 main
📁 antigravity-cli-statusline │ Project Path: /Users/andyawd/Project/antigravity-cli-statusline
⚙️ Accept-edits │ 💬 c5168b1c │ 💾 279MB │ Version: v1.3.2
```

### Line Wrapping

Two mechanisms operate together:

1. **Smart automatic wrapping**: The renderer reads the terminal width and wraps the next indicator to a new line whenever it would overflow the current row.
2. **Manual newline (`n`)**: Insert `n` in the sort string to force a line break at that exact position:

```text
1,2,n,3,4
```

### Dynamic Colors

A 24-bit truecolor four-tier palette (`#57caff` Blue → `#5cdb6d` Green → `#ffd427` Yellow → `#ff7daf` Pink) updates dynamically based on remaining API quota and context window pressure; each AI model family (Gemini, Claude, GPT) also renders with its dedicated brand accent color.

## Contributing

Contributions are welcome — including new indicators, cross-platform fixes, and language translations. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## Acknowledgements

Special thanks to [60ke/antigravity-statusline](https://github.com/60ke/antigravity-statusline) for the inspiration behind the quota monitoring feature. Their original project paved the way for statusline integrations. Since their implementation was written in Python, which could be challenging to execute consistently across Windows and macOS, this project was rewritten in JavaScript (Node.js) to ensure seamless cross-platform compatibility without relying on external Python dependencies.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
