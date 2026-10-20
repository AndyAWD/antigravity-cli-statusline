# antigravity-cli-statusline

English | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

[![Version](https://img.shields.io/badge/version-1.8.0-blue.svg)](skills/agy-cli-statusline/SKILL.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

An Antigravity plugin that customizes the Antigravity Command-Line Interface (CLI) statusline (footer) — select from 32 real-time indicators, switch between Text (`text`) and Emoji (`emoji`) label styles, arrange them in any order, display capacity bar graphs in merged or separate modes, and apply automatic or manual line wrapping across 4 languages (`us`, `zh-tw`, `zh-cn`, `jp`).

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
2. **32 Real-Time Indicators, 4 Locales & Dual Label Styles**: Provides 32 metrics across model status, API quotas, context/token consumption, interactive queues, Git/VCS state, and system telemetry in English (`us`), Traditional Chinese (`zh-tw`), Simplified Chinese (`zh-cn`), and Japanese (`jp`), with selectable **Text (`text`)** or **Emoji (`emoji`, no-colon compact)** label styles (`ui.footer.labelStyle`).
3. **Flexible Bar Graphs (Merged or Separate)**: Renders 10-block visual progress bars (`[████████░░]`) for hourly quota, weekly quota, context usage, and session tokens. Automatically merges labels when placed adjacent to numeric counterparts, or displays them with independent labels when separated.
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

---

## Indicators, Sorting & Line Wrapping

### Available Indicators (1–32)

The numbers below correspond to the 1-based option indices across the 5 categories in Step 3 (`resources/questions.json`), along with each indicator's Emoji prefix used in `emoji` mode:

**1. Model & Agent (4 items)**
- `1.` 🤖 **Current AI model name (`model-name`)** — the model serving the current conversation
- `2.` 🎭 **Active agent profile (`agent-profile`)** — the loaded Agent Profile name
- `3.` ⚡ **Agent state (`agent-state`)** — `idle / thinking / working / tool_use / initializing`
- `4.` 🧭 **Current running mode (`mode`)** — `default / code-only / plan / interactive / accept-edits`

**2. Quota, Billing & Account (10 items)**
- `5.` 🔋 **Hourly available quota (`quota`)** — 5-hour API remaining percentage, four-tier color-coded
- `6.` 🔋 **Hourly available quota bar graph (`quota-bar`)** — 10-block hourly quota bar (`[████████░░]`)
- `7.` ⏳ **Hourly quota reset countdown (`quota-reset-countdown`)** — time remaining until 5-hour quota refresh
- `8.` 🕒 **Hourly reset time (`quota-reset-time`)** — local timezone reset timestamp (`HH:mm` same day, `yyyy/MM/dd HH:mm` across days)
- `9.` 📅 **Weekly available quota (`quota-weekly`)** — weekly API remaining percentage, four-tier color-coded
- `10.` 📅 **Weekly available quota bar graph (`quota-weekly-bar`)** — 10-block weekly quota bar (`[███████░░░]`)
- `11.` 📆 **Weekly quota reset countdown (`quota-weekly-countdown`)** — time remaining until weekly refresh
- `12.` ⏰ **Weekly reset time (`quota-weekly-reset-time`)** — weekly local reset timestamp (e.g., `2026/10/18 16:00`)
- `13.` 💎 **Subscription plan tier (`plan-tier`)** — current subscription plan level
- `14.` 👤 **Account email (`account-email`)** — logged-in account email address

**3. Context & Tokens (4 items)**
- `15.` 🧠 **Context used percentage (`context-used`)** — percentage of context window consumed
- `16.` 🧠 **Context used bar graph (`context-used-bar`)** — 10-block context consumed bar (`[█░░░░░░░░░]`)
- `17.` 🪙 **Exact token count (`token-count`)** — token usage in the current session
- `18.` 🪙 **Token count bar graph (`token-count-bar`)** — 10-block token consumed bar (`[█░░░░░░░░░]`)

**4. Workspace & VCS (5 items)**
- `19.` 📁 **Workspace short path (`project-path`)** — current workspace directory basename
- `20.` 📂 **Workspace full path (`project-full-path`)** — absolute workspace directory path
- `21.` 🌿 **Current Git branch (`git-branch`)** — active branch name
- `22.` 📝 **Workspace dirty status (`vcs-dirty`)** — `✗ dirty / ✓ clean`
- `23.` 🌱 **VCS type (`vcs-type`)** — `git / jj / fig`

**5. System Status & Background Tasks (9 items)**
- `24.` 💾 **CLI RAM usage (`memory-usage`)** — RSS memory consumed by the `agy` process
- `25.` 🚀 **Antigravity CLI version (`cli-version`)** — current CLI version string
- `26.` 💬 **Conversation ID (`conversation-id`)** — first 8 characters of conversation ID for debugging
- `27.` 🔒 **Sandbox status (`sandbox-status`)** — `off / on (net) / on (no-net)`
- `28.` 🔔 **Pending tool confirmation (`tool-confirmation`)** — whether a tool confirmation dialog is awaiting response
- `29.` 📥 **Pending user inputs (`pending-input`)** — queued user inputs waiting to run
- `30.` 🔧 **Running background tasks (`background-tasks`)** — active background task count
- `31.` 👥 **Active subagents (`subagents`)** — running subagent count
- `32.` 📄 **Total artifacts (`artifacts`)** — cumulative files/outputs produced in this session

### Label Display Styles: Text (`text`) vs. Emoji (`emoji`)

Individual indicator styles can be customized during Step 4 sorting via style prefixes (saved in the `ui.footer.itemStyles` map across `settings.json`; unconfigured items strictly default to text):

- **Text label style (`text`, default)**: Displays localized text prefixes with a colon (e.g., `Model: Gemini 3.1 Pro │ Hourly Available: 88% │ Git: main`). Plain numeric indices (e.g. `1`), `t` prefix (e.g. `t1`), or plain English IDs (`quota`, `t:quota`) all resolve to text style.
- **Emoji label style (`emoji`)**: Replaces text label prefixes and colons with the indicator's Emoji followed by a single space (e.g., `🤖 Gemini 3.1 Pro │ 🔋 88% │ 🌿 main`), while keeping status values (`all clear`, `✓ clean`, `off`, `Default`) localized in your chosen language. Use an `e` prefix (e.g. `e1`, `e:quota`) to assign emoji style. Items can be mixed freely (e.g. `1, e2, t3, e:git-branch`).
- **Bar Graph Style Conflict Handling**: If adjacent bar graph indicators have conflicting styles (one text, one emoji), they will not merge; they render as two separate blocks.

### Percentage Bar Graphs: Merged vs. Separate Display

Default bar length is 10 blocks (`[████████░░]`), configurable via `ui.footer.barLength` in `settings.json`. Solid block `█` represents capacity or usage, while shaded block `░` represents empty space. Reset time format is configurable via `ui.footer.timeFormat` (`"smart"`, `"yyyy/MM/dd HH:mm"`, `"12h"`, or `"24h"`).

Four indicator pairs support percentage bar graphs:
- `quota` (`5`) + `quota-bar` (`6`)
- `quota-weekly` (`9`) + `quota-weekly-bar` (`10`)
- `context-used` (`15`) + `context-used-bar` (`16`)
- `token-count` (`17`) + `token-count-bar` (`18`)

#### 1. Merged Display Example (Adjacent Auto-Merge)

When a numeric indicator and its corresponding bar graph are placed **adjacent** to each other (in either order, e.g., `5,6` or `6,5`), the renderer automatically merges them under a single label and separator:

- **Sort Input**:
  ```text
  15,16,17,18,n,5,6,9,10
  ```
- **Merged Output Preview (Text Mode `text`)**:
  ```text
  Context Used: 18.5% [█░░░░░░░░░] │ Tokens: 185.0k / 1.0M [█░░░░░░░░░]
  Hourly Available: 88% [████████░░] │ Weekly Available: 78% [███████░░░]
  ```
- **Merged Output Preview (Emoji Mode `emoji`)**:
  ```text
  🧠 18.5% [█░░░░░░░░░] │ 🪙 185.0k / 1.0M [█░░░░░░░░░]
  🔋 88% [████████░░] │ 📅 78% [███████░░░]
  ```

#### 2. Separate Display Example (Non-Adjacent / Independent Labels)

When a numeric indicator and its corresponding bar graph are **separated** by another indicator or a newline `n` (or when only the bar indicator is selected), each indicator renders individually with its own label:

- **Sort Input**:
  ```text
  15,17,n,16,18,n,5,7,6,n,9,11,10
  ```
- **Separate Output Preview**:
  ```text
  Context Used: 18.5% │ Tokens: 185.0k / 1.0M
  Context Used: [█░░░░░░░░░] │ Tokens: [█░░░░░░░░░]
  Hourly Available: 88% │ Hourly Reset: 4h 50m │ Hourly Available: [████████░░]
  Weekly Available: 78% │ Weekly Reset: 4d 5h │ Weekly Available: [███████░░░]
  ```

### Sorting

In Step 4 of the skill workflow, enter a comma-separated list of numbers in the Write-in box to customize the layout:

```text
1,10,11,4,n,2,3,23,9,21,22,20,n,n,5,6,7,8,14,15,n,12,13,16,17,18,19,n,n,28,27,26,24,25,n,32,31,29,30
```

- **Numbers** refer to the 1-based position in your Step 3 selection (when all 32 indicators are selected, numbers `1`–`32` match the list above).
- **Identifiers** like `quota` or `model-name` can also be used or mixed with numbers.
- **`n` token** forces a line break; consecutive `n,n` inserts a blank line to separate logical groups.
- **Omitted indicators are excluded** — the sort string defines the exact final display set.
- Leave blank or choose `(Recommended) Skip` to keep the original selection order with all selected indicators enabled.

Preview of the sorted statusline in **Text Mode (`text`)** (3 logical groups across 6 content lines separated by blank lines):

```text
Model: Gemini 3.8 Flash (High) │ Account: anandydy529@gmail.com │ Plan: Google AI Pro │ Sandbox: off
Profile: Default │ Agent: working │ Subagents: 2 │ Cumulative Outputs: 0 │ Queue: 0 │ BG: 0 │ Awaiting You: all clear

Context Used: 18.5% [█░░░░░░░░░] │ Tokens: 185.0k / 1.0M [█░░░░░░░░░] │ Hourly Reset: 4h 50m │ Hourly Reset Time: 15:50
Hourly Available: 88% [████████░░] │ Weekly Available: 78% [███████░░░] │ Weekly Reset: 4d 5h │ Weekly Reset Time: 2026/10/18 16:00

Status: ✓ clean │ Git: main │ VCS: git │ Project: antigravity-cli-statusline │ Project Path: /Users/andyawd/Project/antigravity-cli-statusline
Mode: Accept-edits │ Conv: c5168b1c │ RAM: 279MB │ CLI: v1.3.2
```

Preview of the same sorted statusline in **Emoji Mode (`emoji`)**:

```text
🤖 Gemini 3.8 Flash (High) │ 👤 anandydy529@gmail.com │ 💎 Google AI Pro │ 🔒 off
🎭 Default │ ⚡ working │ 👥 2 │ 📄 0 │ 📥 0 │ 🔧 0 │ 🔔 all clear

🧠 18.5% [█░░░░░░░░░] │ 🪙 185.0k / 1.0M [█░░░░░░░░░] │ ⏳ 4h 50m │ 🕒 15:50
🔋 88% [████████░░] │ 📅 78% [███████░░░] │ 📆 4d 5h │ ⏰ 2026/10/18 16:00

📝 ✓ clean │ 🌿 main │ 🌱 git │ 📁 antigravity-cli-statusline │ 📂 /Users/andyawd/Project/antigravity-cli-statusline
🧭 Accept-edits │ 💬 c5168b1c │ 💾 279MB │ 🚀 v1.3.2
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
