# antigravity-cli-statusline

English | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

[![Version](https://img.shields.io/badge/version-2.1.1-blue.svg)](skills/agy-cli-statusline/SKILL.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)]()

A dual-interface telemetry and statusline plugin built for both **Antigravity CLI (`agy`)** and **Antigravity App (2.0, `v2.34.0+`)** — monitor 36 real-time indicators (AI model & Orchestrator active model tracking, 5-hour & 7-day quotas, context token breakdown, Git/VCS status, agent activity, and CLI & 2.0 versions), mix and match Text (`text`) and Emoji (`emoji`) label styles, arrange rows visually with drag-and-drop in Antigravity 2.0 or via the 7-step CLI wizard, across 4 languages (`us`, `zh-tw`, `zh-cn`, `jp`).

Comprehensive cross-platform support across Windows, macOS, and Linux for all three Google Antigravity surfaces: Antigravity Command-Line Interface (`agy`), Antigravity IDE sidebar chat, and Antigravity 2.0 Desktop Application.

## Statusline Setup & Interactive Telemetry in Action

<p align="center">
  <img src="docs/images/statusline-demo.svg" alt="Antigravity CLI statusline interactive setup and live telemetry demo: from running /antigravity-cli-statusline:agy-cli-statusline command, language selection, 5-category wizard, custom order Write-in, to full 10-row live statusline telemetry." width="100%">
</p>

Live animation demonstrating the complete CLI workflow from executing `/antigravity-cli-statusline:agy-cli-statusline`, interactive indicator selection, and custom layout input, to the full multi-row telemetry statusline.

## Key Features

1. **Native Dual-Surface Experience (Antigravity 2.0 Visual Panel + CLI Terminal)**:
   - **Antigravity 2.0 (MCP Apps)**: Works out of the box via `ui://statusline/app.html` with zero `npm install` required. Available in both the right auxiliary pane and full-page view, featuring in-place row-based drag-and-drop editing, a 5-category 36-metric drawer with live value previews, a collapsible context `tokenBreakdown` stacked bar, auto-follow / pinned conversation switching, 1-second live countdowns, legacy order import/export, and atomic flex-wrapped compact strips that never split an indicator mid-label.
   - **Antigravity CLI (`agy`)**: Provides a 7-step paginated interactive wizard, terminal-width-aware wrapping, and instant hot reload on layout or locale changes.
2. **36 Real-Time Indicators, 4 Locales & Dual Label Styles**: Covers model status (including live Orchestrator tracking that keeps the outer wrapper name on `model-name` while displaying the routed `Planner` / `Executor` underlying model on `active-model`, or red `off` in single-model sessions), API quotas (5-hour and weekly quotas with 4-tier dynamic quota pool resolution and 60s expiry grace-period countdown recalculation), context/token consumption, interactive queues, Git/VCS state, system resources, and independent cross-platform detection for both Agy CLI and Agy 2.0 versions—localized in `us`, `zh-tw`, `zh-cn`, and `jp`, with selectable **Text (`text`)** or **Emoji (`emoji`)** label styles per indicator.
3. **Flexible Bar Graphs (Merged or Separate)**: Renders 10-block visual progress bars (`[████████░░]`) for 5-hour quota, weekly quota, context usage, and session tokens. Adjacent pairs with matching styles merge automatically under a single label; separated or style-mismatched items render independently.
4. **Custom Sorting & Dual Line-Wrapping**: Supports 1-based index or English identifier sorting, per-item style prefixes (`t` / `e`), `n` manual line breaks, `n,n` blank-line section separators, and automatic wrapping across both terminal width and 2.0 panel width.
5. **24-Bit Four-Tier Color Coding**: Shifts colors dynamically across 4 thresholds (`#57caff` Blue `100–75%`, `#5cdb6d` Green `74–50%`, `#ffd427` Yellow `49–25%`, `#ff7daf` Pink `24–0%`) alongside dedicated brand accent colors for each AI model family.
6. **Cross-Surface Config Sync, Smart Hook Maintenance & Hardened Security**:
   - Shares a unified core between CLI and 2.0 for 4-tier context ceilings, Language Server RPC telemetry parsing, and config/hook deployment, enforced by strict CSP and workspace path allowlisting.
   - On first run in Antigravity 2.0, automatically inherits your existing CLI `settings.json` layout and offers dual save modes (**Apply to 2.0 Panel Only** vs. **Sync to 2.0 + CLI**). Syncing to CLI automatically updates outdated or hash-mismatched CLI hook scripts without mutating your custom `statusLine` command (skipping up-to-date, newer, or uninstalled setups).
   - On CLI, synchronizes CLI-specific, global, and workspace `settings.json` plus `trusted_hooks.json`, with built-in macOS/Linux NVM path resolution and Windows UTF-8 BOM prevention.
7. **Non-Intrusive Update Checks**: When `plugin-update` (`#35`) is enabled, checks GitHub Releases once per interactive `agy` launch (skipping `agy -p`), auto-hides while trimming leading/trailing blank lines when up to date, falls back cleanly to cached release data offline, and renders a localized 2-line notice (or compact `🆕 vX → vY` in `emoji` style) when behind—completely decoupled from `plugin-version` (`#34`). Run `diagnose-statusline.mjs` anytime to inspect plugin-vs-hook version alignment.

## Installation

Install the plugin globally using the Antigravity Command-Line Interface (CLI):

```bash
agy plugin install https://github.com/AndyAWD/antigravity-cli-statusline
```

### Prerequisites

- **Node.js** (required): The renderer and MCP scripts are written in pure `.mjs`. Without Node.js, the CLI statusline stays blank and `agy` disables it after 30 consecutive failures. The CLI skill pre-checks Node.js availability before writing configurations.
- **Git** (optional): Required for `git-branch`, `vcs-dirty`, and `vcs-type` indicators.

### Activation Behavior

- **Antigravity App (2.0, `v2.34.0+`)**: Ready immediately after installation with **zero `npm install`**. Open **Statusline** from **Overview > Plugins > Statusline**, the sidebar **`+`** menu (`aux_pane`), or the left navigation bar **Plugins > Statusline** (`global`). First launch inherits your existing CLI `settings.json` layout; saving with **Sync to 2.0 + CLI** also keeps outdated CLI hook scripts up to date automatically.
- **First-Open Enablement (CLI)**: When enabling the CLI statusline for the first time, run `/statusline <command>` (printed by `configure-statusline.mjs`) inside `agy` to activate it immediately, or restart `agy` CLI (exit and reopen) to load the statusline hook.
- **Hot Reload (CLI)**: Once enabled, subsequent changes to indicator ordering, label style (`text` / `emoji`), or display language take effect immediately without restarting the CLI.

## Commands and Skills

Once installed, use the slash command matching your interface:

### 1. Open Visual Statusline Panel (Antigravity 2.0 App)

```text
/antigravity-cli-statusline:agy-app-statusline
```

- **When to Use**: In Antigravity App (`v2.34.0+`) to open the interactive **Statusline** monitor and drag-and-drop layout editor directly in the right auxiliary pane (no `ask_question` prompts). You can also open it anytime from **Overview > Plugins > Statusline**, the sidebar **`+`** menu, or the left navigation bar **Plugins > Statusline** (`global`).
- **CLI Fallback**: If invoked from Antigravity CLI (`agy`), the underlying `statusline_dashboard` tool returns a plain-text status summary and directs you to `/antigravity-cli-statusline:agy-cli-statusline` for footer configuration.

### 2. Configure CLI Statusline (Antigravity CLI)

```text
/antigravity-cli-statusline:agy-cli-statusline
```

- **When to Use**: When enabling the CLI statusline for the first time, switching display language (`us` / `zh-tw` / `zh-cn` / `jp`), switching between Text (`text`) and Emoji (`emoji`) label styles, selecting indicators, or customizing multi-line layout order.
- **How It Works**:
  1. Prompts for display language selection and locks the session output to that locale.
  2. Verifies Node.js environment availability before setup (all three-layer `settings.json` reads and writes are safely delegated to `configure-statusline.mjs` rather than directly editing `~/.gemini/`).
  3. Sequentially prompts for indicator selection across 5 categorized tabs from `questions.json`, avoiding terminal screen height truncation.
  4. Displays selected indicators in a compact 3-column table and accepts a custom sort order with individual style prefixes (plain numbers, `t` text prefix, `e` emoji prefix, and `n` newline tokens), writing `ui.footer.items` and `ui.footer.itemStyles` across all three `settings.json` layers, and deploys hook scripts and the 4-layer `lib/` modules (plus `.hook-version.json` SHA-256 manifest) to `~/.gemini/antigravity-cli/hooks/`.
  5. Upon completion, automatically prints code blocks containing the previous and current layout order strings for easy copy-paste reuse.

## Plugin Management

- List installed plugins:

  ```bash
  agy plugin list
  ```

- Enable this plugin:

  ```bash
  agy plugin enable antigravity-cli-statusline
  ```

- Disable this plugin:

  ```bash
  agy plugin disable antigravity-cli-statusline
  ```

- Uninstall this plugin:

  ```bash
  agy plugin uninstall antigravity-cli-statusline
  ```

## Project Structure

```text
antigravity-cli-statusline/
├── plugin.json                                     # Antigravity plugin manifest
├── mcp_config.json                                 # MCP server configuration for Antigravity 2.0
├── hooks.json                                      # Lifecycle hooks (SessionStart/PreInvocation/PostInvocation/Stop)
├── package.json                                    # Package metadata & npm scripts
├── LICENSE                                         # MIT License
├── CONTRIBUTING.md                                 # 3-language contributor guide
├── README.md / README.zh-TW.md / README.zh-CN.md / README.ja.md
├── assets/
│   └── logo.svg                                    # Plugin icon for Antigravity App
├── docs/
│   ├── ARCHITECTURE_HANDOVER.md                    # 4-layer architecture & extension guide
│   ├── images/                                     # Screenshots & generated demo SVGs
│   └── workshop/                                   # Workshop slides & assets
├── src/app/                                        # Antigravity 2.0 MCP App frontend source (esbuild)
├── scripts/
│   ├── build-app.mjs                               # Bundles src/app/ into scripts/mcp/statusline-app.html
│   ├── hooks/record-session.mjs                    # Lifecycle hook writer (isolated in ${PLUGIN_DATA})
│   ├── mcp/                                        # MCP server, LS telemetry, transcript reader & CLI bridge
│   └── tests/                                      # Antigravity 2.0 hook, MCP & sync-contract tests
└── skills/
    ├── agy-app-statusline/
    │   └── SKILL.md                                # Antigravity 2.0 visual panel entrypoint
    └── agy-cli-statusline/
        ├── SKILL.md                                # CLI 7-step wizard entrypoint
        ├── references/                             # Technical specs, config, Windows & pitfalls docs
        ├── resources/                              # Generated 4-locale prompts & 5-category questions
        └── scripts/                                # CLI statusLine hook & 4-layer zero-dep ESM modules
```

---

## Indicators, Sorting & Line Wrapping

### Available Indicators (1–36)

The numbers below correspond to the 1-based option indices across the 5 categories in Step 3 (`resources/questions.json`), along with each indicator's Emoji prefix used in `emoji` mode:

**1. Model & Agent (5 items)**
- `1.` 🤖 **Current AI model name (`model-name`)** — the model serving the current conversation (displays the outer wrapper name such as `Orchestrator (Neon)` under Orchestrator mode)
- `2.` 🪪 **Active agent profile (`agent-profile`)** — the loaded Agent Profile name
- `3.` ⚡ **Agent state (`agent-state`)** — `idle / thinking / working / tool_use / initializing`
- `4.` ⚙️ **Current running mode (`mode`)** — `default / code-only / plan / interactive / accept-edits`
- `5.` 🪄 **Active underlying model under Orchestrator (`active-model`)** — shows the live routed model with dynamic role labels (`Planner:` / `Executor:` in `text`, `🪄 Planner →` / `🪄 Executor →` in `emoji`, or `Orchestrator: Pending` before routing), or `off` in red for single-model sessions

**2. Quota, Billing & Account (10 items)**
- `6.` 🔋 **5-hour available quota (`quota`)** — 5-hour API remaining percentage, four-tier color-coded
- `7.` 🔋 **5-hour available quota bar graph (`quota-bar`)** — 10-block 5-hour quota bar (`[████████░░]`)
- `8.` ⏳ **5-hour quota reset countdown (`quota-reset-countdown`)** — time remaining until 5-hour quota refresh
- `9.` 🕒 **5-hour reset time (`quota-reset-time`)** — local timezone reset timestamp (`HH:mm` same day, `yyyy/MM/dd HH:mm` across days)
- `10.` 📅 **Weekly available quota (`quota-weekly`)** — weekly API remaining percentage, four-tier color-coded
- `11.` 📅 **Weekly available quota bar graph (`quota-weekly-bar`)** — 10-block weekly quota bar (`[███████░░░]`)
- `12.` ⏲️ **Weekly quota reset countdown (`quota-weekly-countdown`)** — time remaining until weekly refresh
- `13.` 🗓️ **Weekly reset time (`quota-weekly-reset-time`)** — weekly local reset timestamp (e.g., `2026/10/18 16:00`)
- `14.` 💎 **Subscription plan tier (`plan-tier`)** — current subscription plan level
- `15.` 📧 **Account email (`account-email`)** — logged-in account email address

**3. Context & Tokens (4 items)**
- `16.` 🧠 **Context used percentage (`context-used`)** — percentage of context window consumed
- `17.` 🧠 **Context used bar graph (`context-used-bar`)** — 10-block context consumed bar (`[█░░░░░░░░░]`)
- `18.` 💰 **Exact token count (`token-count`)** — token usage in the current session
- `19.` 💰 **Token count bar graph (`token-count-bar`)** — 10-block token consumed bar (`[█░░░░░░░░░]`)

**4. Workspace & VCS (5 items)**
- `20.` 📁 **Workspace short path (`project-path`)** — current workspace directory basename
- `21.` 📍 **Workspace full path (`project-full-path`)** — absolute workspace directory path
- `22.` 🔀 **Current Git branch (`git-branch`)** — active branch name
- `23.` 🔍 **VCS uncommitted status (`vcs-dirty`)** — `uncommitted / no changes`
- `24.` 🗃️ **VCS type (`vcs-type`)** — `git / jj / fig`

**5. System Status & Background Tasks (12 items)**
- `25.` 💾 **CLI RAM usage (`memory-usage`)** — RSS memory consumed by the `agy` process
- `26.` 🚀 **Antigravity CLI version (`cli-version`)** — installed `agy` CLI version (`Agy CLI Version:` in text mode; auto-detected in both CLI and 2.0)
- `27.` 💬 **Conversation ID (`conversation-id`)** — first 8 characters of conversation ID for debugging
- `28.` 🛡️ **Sandbox status (`sandbox-status`)** — `off / on (net) / on (no-net)`
- `29.` 🔔 **Pending tool confirmation (`tool-confirmation`)** — whether a tool confirmation dialog is awaiting response
- `30.` 📥 **Pending user inputs (`pending-input`)** — queued user inputs waiting to run
- `31.` 🔄 **Running background tasks (`background-tasks`)** — active background task count
- `32.` 👥 **Active subagents (`subagents`)** — running subagent count
- `33.` 📄 **Total artifacts (`artifacts`)** — cumulative files/outputs produced in this session
- `34.` 🧩 **Statusline version (`plugin-version`)** — displays installed `antigravity-cli-statusline` version only (`Statusline Version:` in text mode; does not trigger update checks or reminders)
- `35.` 🆕 **Statusline update reminder (`plugin-update`)** — checks GitHub Releases once per interactive `agy` launch (skipping `agy -p`), auto-hides when up to date, and renders a 2-line update command at its configured position when behind
- `36.` 💻 **Antigravity 2.0 App version (`app-version`)** — installed Antigravity 2.0 desktop app version (`Agy 2.0 Version:` in text mode; auto-detected in both CLI and 2.0)

### Sorting Rules & Style Configuration

In Step 4 of the CLI wizard (or via the order import/export box in Antigravity 2.0), enter a comma-separated list of indicator indices to customize the layout and individual styles (unlisted indicators are excluded; leaving blank or choosing Skip keeps the original selection with default text style):

- **Style Prefixes**:
  - **Text label style (`text`, default)**: Plain numbers (e.g., `1`), `t` prefix (e.g., `t1`), or plain English IDs (`quota`, `t:quota`) format as localized text labels with colons (e.g., `5-hr Available: 88%`).
  - **Emoji icon style (`emoji`)**: Use an `e` prefix (e.g., `e1`, `e:quota`, case-insensitive) to replace text labels with the indicator's Emoji icon and a single space (e.g., `🔋 88%`), while keeping status values localized.
  - **Mix & Match**: Items can be styled independently (e.g., `e1, 15, e14, 28`); unformatted items default to text style.
- **Percentage Bar Graph Merging & Separation**:
  - For the four indicator pairs (`quota` `6`+`7`, `quota-weekly` `10`+`11`, `context-used` `16`+`17`, `token-count` `18`+`19`), placing a numeric indicator **adjacent** to its corresponding bar graph (e.g., `6,7`) with matching styles automatically merges them under a single label and progress bar.
  - When **separated** (by other indicators or newlines) or when styles conflict (one `text`, one `emoji`), each renders individually with its own label.
  - Default bar length is 10 blocks (`[████████░░]`, configurable via `ui.footer.barLength`), and reset time format is configurable via `ui.footer.timeFormat`.
- **Line Wrapping & Spacing**:
  - **Manual line breaks (`n`)**: Insert `n` to force a newline at that position; consecutive `n,n` inserts a blank line separator.
  - **Smart automatic wrapping**: Automatically wraps whole indicators to the next line when total width exceeds the terminal or 2.0 panel width.
- **Dynamic Color Shifts**:
  - 24-bit truecolor four-tier palette (`#57caff` Blue → `#5cdb6d` Green → `#ffd427` Yellow → `#ff7daf` Pink) shifts based on remaining quota or context pressure; each AI model family also applies its brand color.

#### Sort Input Example

- **Identifier Version**:
  ```text
  e:model-name,active-model,e:account-email,e:plan-tier,e:sandbox-status,n,e:agent-profile,agent-state,subagents,artifacts,pending-input,background-tasks,tool-confirmation,n,n,context-used,context-used-bar,token-count,token-count-bar,n,quota,quota-bar,quota-reset-countdown,quota-reset-time,n,quota-weekly,quota-weekly-bar,quota-weekly-countdown,quota-weekly-reset-time,n,n,vcs-dirty,vcs-type,e:git-branch,n,e:project-path,project-full-path,n,n,e:mode,e:conversation-id,e:memory-usage,cli-version,app-version,plugin-version,n,e:plugin-update
  ```

#### Output Preview (Mixed Mode)

4 logical groups across 8 content lines separated by blank lines (when up to date, `e:plugin-update` hides automatically and trims the trailing newline):

```text
🤖 Orchestrator (Neon) │ Planner: Gemini 4 Neon (High) │ 📧 anandydy529@gmail.com │ 💎 Google AI Pro │ 🛡️ off
🪪 Default │ Agent: working │ Subagents: 2 │ Outputs: 0 │ Queue: 0 │ BG: 0 │ Awaiting You: none

Context Used: 18.5% [█░░░░░░░░░] │ Tokens: 47.4k / 256.0k [█░░░░░░░░░]
5-hr Available: 88% [████████░░] │ 5-hr Reset: 4h 50m │ 5-hr Reset Time: 15:50
7-day Available: 78% [███████░░░] │ 7-day Reset: 4d 5h │ 7-day Reset Time: 2026/10/18 16:00

VCS Status: no changes │ VCS: git │ 🔀 main
📁 antigravity-cli-statusline │ Project Path: /Users/andyawd/Project/antigravity-cli-statusline

⚙️ Accept-edits │ 💬 c5168b1c │ 💾 279MB │ Agy CLI Version: v1.5.10 │ Agy 2.0 Version: v2.34.0 │ Statusline Version: v2.1.1
```

When a newer GitHub Release is available, `e:plugin-update` appends two standalone notice lines after the blank line (the warning disappears automatically after running `agy plugin install` in your terminal; sync outdated CLI hooks via **Sync to 2.0 + CLI** in Antigravity 2.0 or `/antigravity-cli-statusline:agy-cli-statusline` in CLI, or inspect status with `node skills/agy-cli-statusline/scripts/diagnose-statusline.mjs`):

```text
🆕 v2.1.0 → v2.1.1
agy plugin install https://github.com/AndyAWD/antigravity-cli-statusline
```

*(In Text style `35` / `plugin-update`, the first line renders as `⚠️ Statusline update available (current v2.1.0 → latest v2.1.1). Run to update:`.)*

## Contributing

Contributions are welcome — including new indicators, cross-platform fixes, and language translations. See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed project structure and workflow.

## Acknowledgements

- **[60ke/antigravity-statusline](https://github.com/60ke/antigravity-statusline)**: Special thanks for the inspiration behind the quota monitoring feature—their original project paved the way for statusline integrations. Since their implementation was written in Python, which could be challenging to execute consistently across Windows and macOS, this project was rewritten in JavaScript (Node.js) to ensure seamless cross-platform compatibility without relying on external Python dependencies.
- **[ericsk/agy-gcp-companion](https://github.com/ericsk/agy-gcp-companion)**: The migration of the bottom CLI statusline into an interactive Antigravity 2.0 panel was directly inspired by this project's sidebar design.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
