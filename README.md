# Antigravity CLI Statusline Skill

[![Version](https://img.shields.io/badge/version-1.5.0-blue.svg)](skills/antigravity-cli-statusline/SKILL.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

[繁體中文](README.zh-TW.md) | English

A multilingual, cross-platform skill that customizes the Antigravity CLI statusline (footer) — pick exactly which indicators to show, in any order you like, with smart line wrapping out of the box.

## Screenshots

### Windows

| English (us) | Traditional Chinese (zh-tw) | Japanese (jp) |
| :---: | :---: | :---: |
| ![English](docs/images/agy-cli-statusline-windows-us.png) | ![Traditional Chinese](docs/images/agy-cli-statusline-windows-zhtw.png) | ![Japanese](docs/images/agy-cli-statusline-windows-jp.png) |

### macOS

| English (us) | Traditional Chinese (zh-tw) | Japanese (jp) |
| :---: | :---: | :---: |
| ![English](docs/images/agy-cli-statusline-macos-us.png) | ![Traditional Chinese](docs/images/agy-cli-statusline-macos-zhtw.png) | ![Japanese](docs/images/agy-cli-statusline-macos-jp.png) |

## Installation

### Prerequisites

- **Node.js** (required) — the renderer scripts are pure `.mjs`. Without Node.js the statusline stays blank and `agy` will auto-disable it after repeated failures. The skill pre-checks this for you.
- **Git** (optional) — needed for `git-branch`, `vcs-dirty`, and `vcs-type` indicators.

### Step A — Install the plugin

```bash
agy plugin install https://github.com/andyawd/antigravity-cli-statusline
```

> The CLI stages the bundle at `~/.gemini/antigravity-cli/plugins/antigravity-cli-statusline/`.

### Step B — Trigger the skill to finish setup

In the Antigravity CLI prompt, type:

```text
/antigravity-cli-statusline
```

The skill walks you through language selection, indicator picking, and sorting, then deploys the renderer scripts and writes the three-layer `settings.json`. The statusline updates **live without a CLI restart**.

## Indicators, Sorting & Line Wrapping

### Available Indicators

**AI Model & Agent**
- **Current AI model name (`model-name`)** — the model serving the current conversation
- **Active agent profile (`agent-profile`)** — the loaded Agent Profile name
- **Agent state (`agent-state`)** — `idle / thinking / working / tool_use / initializing`

**Quota & Tokens**
- **Account API available quota (`quota`)** — percentage, color-coded across four tiers
- **API reset countdown (`quota-reset-countdown`)** — time remaining until quota refreshes
- **Weekly API quota remaining (`quota-weekly`)** — weekly remaining percentage, color-coded
- **Weekly API reset countdown (`quota-weekly-countdown`)** — time remaining until weekly refresh
- **Context window usage (`context-used`)** — percentage of context consumed
- **Session token count (`token-count`)** — precise token usage this session
- **Cumulative AI artifacts (`artifacts`)** — files/outputs produced this session
- **Account plan tier (`plan-tier`)** — current subscription level

**Interactive State**
- **Pending tool confirmation (`tool-confirmation`)** — a tool dialog is waiting on you
- **Pending user input queue (`pending-input`)** — queued inputs waiting to run
- **Running background tasks (`background-tasks`)** — active background task count
- **Active subagents (`subagents`)** — running subagent count

**Project & VCS**
- **Project short path (`project-path`)** — current workspace basename
- **Project full path (`project-full-path`)** — absolute workspace path
- **VCS type (`vcs-type`)** — `git / jj / fig`
- **Current Git branch (`git-branch`)**
- **Working tree status (`vcs-dirty`)** — `dirty / clean`

**System & Account**
- **CLI RAM usage (`memory-usage`)** — RSS memory consumed by the `agy` process
- **Antigravity CLI version (`cli-version`)**
- **Conversation ID (`conversation-id`)** — first 8 chars, for debugging
- **Sandbox mode (`sandbox-status`)** — `off / on (net) / on (no-net)`
- **Account email (`account-email`)**

### Sorting

In the skill's third stage (Step 4), enter a comma-separated list of numbers in the Write-in box to set the order:

```text
2,5,1
```

- Numbers refer to the position in your Step 3 selection (1-based)
- Identifiers like `quota` or `model-name` also work and can be mixed in, but numbers are the most direct
- **Indicators you don't list are dropped** — the result is your final display set
- Leave it blank or pick `(Recommended) Skip` to keep the original selection order with all indicators shown

### Line Wrapping

Two mechanisms work together:

1. **Smart automatic wrapping** — the renderer reads the terminal width and wraps the next indicator to a new line when it would overflow. No setup required.
2. **Manual newline** — insert the `n` token in your sort string to force a line break at that position. Reusable:

```text
1,2,n,3,4
```

(If you picked 4 indicators in Step 3, this puts items 1–2 on line one and forces 3–4 onto line two.)

### Dynamic Colors

A 24-bit truecolor four-tier palette (Blue → Green → Yellow → Pink) shifts with API quota and context usage; each AI model family also gets its own brand accent color.

## Contributing

Contributions are welcome — including new indicators, cross-platform fixes, and AI-assisted language translations. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the workflow.

## Acknowledgements

Special thanks to [60ke/antigravity-statusline](https://github.com/60ke/antigravity-statusline) for the inspiration behind the quota monitoring feature. Their original project paved the way for statusline integrations. Since their implementation was written in Python, which could be challenging to execute consistently across Windows and macOS, this project was rewritten in JavaScript (Node.js) to ensure seamless cross-platform compatibility without relying on external Python dependencies.

## License

This project is licensed under the [MIT License](LICENSE).
