import { rmSync } from 'fs';
import assert from 'assert';
import {
  buildI18nDict,
  preprocessAdjacentItems,
  renderStatusLine,
  stripAnsi,
  getDisplayWidth,
  normalizeLabelStyle,
  EMOJI_MAP,
  getGitBranch,
  getGitDirty,
  resolveTerminalWidth
} from '../statusline-quota.mjs';
import {
  runStatusline,
  makeTempHome,
  BLUE_BOLD,
  GREEN_BOLD,
  RESET
} from './helpers.mjs';

async function main() {
  console.log("=== Running render-and-i18n.test.mjs (R8, R16-R27) ===");

  let testsPassed = true;

  try {
    // ----------------------------------------------------
    // Test Case R8: Simplified Chinese (zh-cn) rendering (all 26 indicators)
    // Justification: Verifies that zh-cn renders correct metric labels, status values, and fallback strings across all 26 indicators.
    // ----------------------------------------------------
    console.log("\n[Test R8] Verifying Simplified Chinese (zh-cn) rendering for all 26 indicators...");
    const mockCacheR8 = {
      shortTerm: {
        gemini: {
          remaining_percentage: 88,
          refreshes_in: '3h'
        }
      },
      weekly: {
        gemini: {
          remaining_percentage: 75,
          refreshes_in: '5d 2h'
        }
      },
      planTier: 'Google AI Pro',
      email: 'test@example.com',
      updatedAt: Date.now()
    };
    const all26Items = [
      "model-name", "quota", "context-used", "memory-usage", "token-count",
      "quota-reset-countdown", "quota-weekly", "quota-weekly-countdown", "git-branch",
      "project-path", "project-full-path", "plan-tier", "account-email", "agent-state",
      "tool-confirmation", "pending-input", "background-tasks", "subagents", "artifacts",
      "vcs-dirty", "vcs-type", "sandbox-status", "cli-version", "conversation-id",
      "agent-profile", "mode"
    ];
    const settingsR8 = {
      ui: {
        language: "zh-cn",
        footer: {
          items: all26Items
        }
      }
    };
    const metaR8 = {
      model: { display_name: "Gemini 3.5 Flash" },
      terminal_width: 1000,
      version: "1.7.0",
      conversation_id: "test-conv-12345678",
      vcs: { dirty: false, branch: "main", type: "git" },
      context_window: { total_input_tokens: 1500, context_window_size: 1000000, used_percentage: 0.15 },
      agent_state: "idle",
      mode: "default"
    };

    const homeR8 = makeTempHome(mockCacheR8, settingsR8);
    try {
      const resR8 = await runStatusline(metaR8, homeR8);
      console.log("R8 Output:", JSON.stringify(resR8.stdout));

      const expectedR8Labels = [
        "模型:", "五小时可用:", "上下文用量:", "内存:", "令牌数:",
        "五小时倒数:", "七日内可用:", "七日内倒数:", "分支:",
        "项目:", "完整路径:", "订阅计划:", "账号:", "代理状态:",
        "工具待确认:", "待处理输入:", "后台任务:", "子代理:", "产出文件:",
        "版控状态:", "版控类型:", "沙箱状态:", "Agy CLI 版本:", "对话编号:",
        "代理角色:", "模式:"
      ];
      const missingLabels = expectedR8Labels.filter(item => !resR8.stdout.includes(item));
      if (resR8.code === 0 && missingLabels.length === 0) {
        console.log("✅ R8 passed! (All 26 Simplified Chinese zh-cn indicators rendered correctly)");
      } else {
        console.error(`❌ R8 failed! Missing labels: ${JSON.stringify(missingLabels)}. Output: ${JSON.stringify(resR8.stdout)}`);
        testsPassed = false;
      }
    } finally {
      try { rmSync(homeR8, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }


    // R26 / R27 共用之 i18n 夾具（原定義於 R12，拆檔後於此重新宣告）
    const dummyMetrics = {
      fallbackModel: 'Gemini 3.5 Flash',
      quotaColor: '\x1b[38;2;87;202;255m',
      quotaVal: '88%',
      contextColor: '\x1b[38;2;92;219;109m',
      usedPct: '15.2%',
      memUsage: '50MB',
      tokenCount: '12.5k / 1.0M',
      countdownVal: '3h 10m',
      weeklyQuotaColor: '\x1b[38;2;87;202;255m',
      weeklyQuotaVal: '90%',
      weeklyCountdownVal: '4d 11h',
      mode: 'Default',
      quotaResetTimeVal: '15:50',
      weeklyResetTimeVal: '2026/10/20 10:50',
      quotaBarVal: '[████████░░]',
      weeklyQuotaBarVal: '[█████████░]',
      contextBarVal: '[█░░░░░░░░░]',
      tokenBarVal: '[██░░░░░░░░]',
      gitBranch: 'main',
      projectName: 'project',
      projectFullPath: '/path/project',
      planTier: 'Pro',
      accountEmail: 'user@example.com',
      agentState: 'idle',
      toolConfirmPending: false,
      pendingInputCount: 0,
      backgroundTasksCount: 0,
      subagentsCount: 0,
      artifactsCount: 0,
      vcsDirtyFlag: false,
      vcsDirtyGlyph: '✓',
      vcsDirtyLabel: 'clean',
      vcsType: 'git',
      sandboxEnabled: false,
      sandboxAllowNet: false,
      sandboxStatusVal: 'off',
      cliVersion: 'v1.7.0',
      pluginVersion: 'v1.11.4',
      conversationIdShort: '12345678',
      agentProfileName: 'Default'
    };

    // ----------------------------------------------------
    // Test Case R16: Fallback when ui.footer.items is empty array [] (dino bug reproduction)
    // ----------------------------------------------------
    console.log("\n[Test R16] Verifying fallback mode when ui.footer.items is empty array [] (dino config)...");
    const settingsR16 = {
      ui: {
        language: "zh-tw",
        footer: {
          theme: "dino",
          items: []
        }
      }
    };
    const metaR16 = {
      model: { display_name: "Gemini 3.8 Flash (High)" },
      terminal_width: 80
    };
    const homeR16 = makeTempHome({}, settingsR16);
    try {
      const resR16 = await runStatusline(metaR16, homeR16);
      console.log("R16 Output:", JSON.stringify(resR16.stdout));
      const plainR16 = stripAnsi(resR16.stdout).trim();

      assert.strictEqual(resR16.code, 0);
      assert.ok(plainR16.length > 0, "Output must NOT be empty string");
      assert.ok(plainR16.startsWith("? for shortcuts"), "Output must start with '? for shortcuts'");
      assert.ok(plainR16.includes("Gemini 3.8 Flash (High)"), "Output must contain fallback model name");
      console.log("✅ R16 passed! (Empty items array successfully triggered fallback mode instead of empty output)");
    } finally {
      try { rmSync(homeR16, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R17: Fallback when ui.footer.items is null or missing
    // ----------------------------------------------------
    console.log("\n[Test R17] Verifying fallback mode when ui.footer.items is null/missing...");
    const settingsR17 = {
      ui: {
        language: "zh-tw",
        footer: {}
      }
    };
    const metaR17 = {
      model: { display_name: "Gemini 3.5 Pro" },
      terminal_width: 80
    };
    const homeR17 = makeTempHome({}, settingsR17);
    try {
      const resR17 = await runStatusline(metaR17, homeR17);
      console.log("R17 Output:", JSON.stringify(resR17.stdout));
      const plainR17 = stripAnsi(resR17.stdout).trim();

      assert.strictEqual(resR17.code, 0);
      assert.ok(plainR17.length > 0, "Output must NOT be empty string");
      assert.ok(plainR17.startsWith("? for shortcuts"), "Output must start with '? for shortcuts'");
      assert.ok(plainR17.includes("Gemini 3.5 Pro"), "Output must contain fallback model name");
      console.log("✅ R17 passed! (Missing items successfully triggered fallback mode)");
    } finally {
      try { rmSync(homeR17, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R18: renderStatusLine defense against empty array / invalid items
    // ----------------------------------------------------
    console.log("\n[Test R18] Verifying renderStatusLine never returns empty array or blank line...");
    const emptyLines1 = renderStatusLine([], {}, 80, 'Test-Model');
    assert.strictEqual(emptyLines1.length, 1, "renderStatusLine([]) must return 1 fallback line");
    assert.ok(stripAnsi(emptyLines1[0]).includes('? for shortcuts'), "renderStatusLine([]) must contain '? for shortcuts'");
    assert.ok(stripAnsi(emptyLines1[0]).includes('Test-Model'), "renderStatusLine([]) must contain fallback model name");

    const emptyLines2 = renderStatusLine(['nonexistent-metric'], {}, 80, 'Fallback-Model-2');
    assert.strictEqual(emptyLines2.length, 1, "renderStatusLine with unknown items must return 1 fallback line");
    assert.ok(stripAnsi(emptyLines2[0]).includes('Fallback-Model-2'), "renderStatusLine must contain fallback model name");
    // ----------------------------------------------------
    // Test Case R19: renderStatusLine defense against newline-only or null items
    // ----------------------------------------------------
    console.log("\n[Test R19] Verifying renderStatusLine defense against newline-only, null, or undefined items...");
    const emptyLines3 = renderStatusLine(['n', 'newline'], {}, 80, 'Fallback-Model-3');
    assert.strictEqual(emptyLines3.length, 1, "renderStatusLine with only newlines must return 1 fallback line");
    assert.ok(stripAnsi(emptyLines3[0]).includes('? for shortcuts'), "renderStatusLine with only newlines must contain '? for shortcuts'");
    assert.ok(stripAnsi(emptyLines3[0]).includes('Fallback-Model-3'), "renderStatusLine must contain fallback model name");

    const emptyLines4 = renderStatusLine([null, undefined, ''], {}, 80, 'Fallback-Model-4');
    assert.strictEqual(emptyLines4.length, 1, "renderStatusLine with null/undefined items must return 1 fallback line");
    assert.ok(stripAnsi(emptyLines4[0]).includes('Fallback-Model-4'), "renderStatusLine must contain fallback model name");

    // Also test rawModel label stripping when fallbackModel is omitted
    const emptyLines5 = renderStatusLine([], { 'model-name': '\u001b[37m模型:\u001b[0m \u001b[1mGemini 3.5 Pro\u001b[0m' }, 80);
    assert.strictEqual(emptyLines5.length, 1);
    assert.ok(stripAnsi(emptyLines5[0]).includes('Gemini 3.5 Pro'), "renderStatusLine must extract raw model name without label");
    assert.ok(!stripAnsi(emptyLines5[0]).includes('模型:'), "renderStatusLine must NOT include '模型:' label in shortcuts line");
    console.log("✅ R19 passed! (renderStatusLine safely handles newline-only, null, and extracts raw model cleanly)");

    // ----------------------------------------------------
    // Test Case R20: E2E fallback when items is a string or non-array (e.g. items: 'dino')
    // ----------------------------------------------------
    console.log("\n[Test R20] Verifying E2E fallback mode when items is non-array string/object...");
    const settingsR20 = {
      ui: {
        language: "zh-tw",
        footer: {
          theme: "custom-theme",
          items: "dino"
        }
      }
    };
    const metaR20 = {
      model: { display_name: "Gemini 3.8 Pro" },
      terminal_width: 80
    };
    const homeR20 = makeTempHome({}, settingsR20);
    try {
      const resR20 = await runStatusline(metaR20, homeR20);
      console.log("R20 Output:", JSON.stringify(resR20.stdout));
      const plainR20 = stripAnsi(resR20.stdout).trim();

      assert.strictEqual(resR20.code, 0);
      assert.ok(plainR20.length > 0, "Output must NOT be empty string");
      assert.ok(plainR20.startsWith("? for shortcuts"), "Output must start with '? for shortcuts'");
      assert.ok(plainR20.includes("Gemini 3.8 Pro"), "Output must contain fallback model name");
      console.log("✅ R20 passed! (Non-array items string successfully triggered fallback mode)");
    } finally {
      try { rmSync(homeR20, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R21: Unit test for Emoji labelStyle, EMOJI_MAP (all 32 + 4 merged keys), and getDisplayWidth
    // ----------------------------------------------------
    console.log("\n[Test R21] Verifying normalizeLabelStyle, getDisplayWidth with emojis, and buildI18nDict('emoji')...");
    assert.strictEqual(normalizeLabelStyle('text'), 'text');
    assert.strictEqual(normalizeLabelStyle('emoji'), 'emoji');
    assert.strictEqual(normalizeLabelStyle('Emoji 圖示（例如：🤖 Gemini 3.1 Pro）（emoji）'), 'emoji');
    assert.strictEqual(normalizeLabelStyle('文字標籤（例如：模型: Gemini 3.1 Pro）（text）'), 'text');
    assert.strictEqual(normalizeLabelStyle(undefined), 'text');

    // Display width checks for surrogate-pair emojis and variation selectors
    assert.strictEqual(getDisplayWidth('🤖'), 2, '🤖 should have display width 2');
    assert.strictEqual(getDisplayWidth('🔋 100%'), 7, '🔋 (2) + space (1) + 100% (4) = 7');
    assert.strictEqual(getDisplayWidth('⏳ 4h 30m'), 9, '⏳ (2) + space (1) + 4h 30m (6) = 9');

    const mockMetricsR21 = {
      fallbackModel: 'Gemini 3.1 Pro',
      quotaColor: BLUE_BOLD,
      quotaVal: '100%',
      quotaBarVal: `${BLUE_BOLD}[██████████]${RESET}`,
      countdownVal: '4h 59m',
      quotaResetTimeVal: '18:30',
      weeklyQuotaColor: GREEN_BOLD,
      weeklyQuotaVal: '72%',
      weeklyQuotaBarVal: `${GREEN_BOLD}[███████░░░]${RESET}`,
      weeklyCountdownVal: '5d 12h',
      weeklyResetTimeVal: '2026/10/20 12:00',
      argonQuotaColor: GREEN_BOLD,
      argonQuotaVal: '59%',
      argonQuotaBarVal: `${GREEN_BOLD}[█████░░░░░]${RESET}`,
      argonCountdownVal: '6d 1h',
      argonResetTimeVal: '2026/10/30 23:57',
      contextColor: BLUE_BOLD,
      usedPct: '15%',
      contextBarVal: `${BLUE_BOLD}[██░░░░░░░░]${RESET}`,
      tokenCount: `${BLUE_BOLD}12.5k${RESET}`,
      tokenBarVal: `${BLUE_BOLD}[█░░░░░░░░░]${RESET}`,
      planTier: 'Pro',
      accountEmail: 'dev@example.com',
      agentState: 'working',
      toolConfirmPending: true,
      pendingInputCount: 2,
      backgroundTasksCount: 1,
      subagentsCount: 3,
      artifactsCount: 4,
      gitBranch: 'main',
      vcsDirtyFlag: false,
      vcsDirtyGlyph: '',
      vcsDirtyLabel: '無變更',
      vcsType: 'git',
      projectName: 'my/proj',
      projectFullPath: '/Users/dev/my/proj',
      memUsage: '128MB',
      sandboxEnabled: true,
      sandboxAllowNet: true,
      sandboxStatusVal: '啟用（聯網）',
      cliVersion: 'v1.2.3',
      pluginVersion: 'v1.11.4',
      conversationIdShort: 'c4a861dd',
      agentProfileName: 'Default',
      mode: 'Interactive'
    };

    for (const lang of ['zh-tw', 'zh-cn', 'us', 'jp']) {
      const emojiDict = buildI18nDict(lang, mockMetricsR21, 'emoji');
      const allKeys = Object.keys(EMOJI_MAP);
      assert.strictEqual(allKeys.length, 42, 'EMOJI_MAP must contain 37 metrics + 5 merged bar keys (42 total)');

      for (const key of allKeys) {
        const rendered = stripAnsi(emojiDict[key]);
        const expectedEmoji = EMOJI_MAP[key];
        assert.ok(
          rendered.startsWith(`${expectedEmoji} `),
          `[${lang}] Metric "${key}" in emoji mode must start with "${expectedEmoji} ", got: "${rendered}"`
        );
        const afterPrefix = rendered.slice(`${expectedEmoji} `.length);
        assert.ok(
          !afterPrefix.startsWith(':'),
          `[${lang}] Metric "${key}" in emoji mode must NOT have a colon after emoji, got: "${rendered}"`
        );
      }
    }

    // Verify localized status values are preserved in emoji mode
    const zhTwEmojiDict = buildI18nDict('zh-tw', mockMetricsR21, 'emoji');
    assert.strictEqual(stripAnsi(zhTwEmojiDict['agent-state']), '⚡ 執行中');
    assert.strictEqual(stripAnsi(zhTwEmojiDict['tool-confirmation']), '🔔 待確認');
    assert.strictEqual(stripAnsi(zhTwEmojiDict['vcs-dirty']), '🔍 無變更');
    assert.strictEqual(stripAnsi(zhTwEmojiDict['sandbox-status']), '🛡️ 啟用（聯網）');
    assert.strictEqual(stripAnsi(zhTwEmojiDict['agent-profile']), '🪪 Default');
    assert.strictEqual(stripAnsi(zhTwEmojiDict['quota+bar']), '🔋 100% [██████████]');

    // Verify renderStatusLine fallback rawModel extraction works with emoji dict
    const fallbackEmojiLines = renderStatusLine([], zhTwEmojiDict, 80);
    assert.strictEqual(fallbackEmojiLines.length, 1);
    assert.ok(stripAnsi(fallbackEmojiLines[0]).includes('Gemini 3.1 Pro'));
    assert.ok(!stripAnsi(fallbackEmojiLines[0]).includes('🤖'), 'Fallback shortcuts line should strip 🤖 prefix from model-name');
    console.log("✅ R21 passed! (All 42 emoji mappings across 37 metrics + 5 merged bars and localized status values verified)");

    // ----------------------------------------------------
    // Test Case R22: E2E test with ui.footer.labelStyle = "emoji"
    // ----------------------------------------------------
    console.log("\n[Test R22] Verifying E2E execution with ui.footer.labelStyle = 'emoji'...");
    const settingsR22 = {
      ui: {
        language: "zh-tw",
        footer: {
          labelStyle: "emoji",
          items: [
            "model-name",
            "quota",
            "quota-bar",
            "git-branch",
            "vcs-dirty",
            "tool-confirmation"
          ]
        }
      }
    };
    const cacheR22 = {
      updatedAt: Date.now(),
      accountEmail: "dev@example.com",
      planTier: "Pro",
      models: {
        "gemini 3.1 pro": {
          remaining_percentage: 90,
          reset_time: new Date(Date.now() + 3600 * 1000).toISOString()
        }
      }
    };
    const metaR22 = {
      model: { display_name: "Gemini 3.1 Pro" },
      vcs: { type: "git", branch: "feat/emoji", dirty: false },
      has_tool_confirmation: false,
      terminal_width: 120
    };
    const homeR22 = makeTempHome(cacheR22, settingsR22);
    try {
      const resR22 = await runStatusline(metaR22, homeR22);
      console.log("R22 Output:", JSON.stringify(resR22.stdout));
      const plainR22 = stripAnsi(resR22.stdout).trim();

      assert.strictEqual(resR22.code, 0);
      assert.ok(plainR22.includes("🤖 Gemini 3.1 Pro"), "Must render model with 🤖 and no colon");
      assert.ok(plainR22.includes("🔋 90% [█████████░]"), "Must render merged quota+bar with 🔋 and no colon");
      assert.ok(plainR22.includes("🔀 feat/emoji"), "Must render git-branch with 🔀 and no colon");
      assert.ok(plainR22.includes("🔍 無變更"), "Must render vcs-dirty with 🔍 and localized value");
      assert.ok(plainR22.includes("🔔 無"), "Must render tool-confirmation with 🔔 and localized value");
      assert.ok(!plainR22.includes("模型:"), "Must NOT contain text label '模型:'");
      assert.ok(!plainR22.includes("五小時可用:"), "Must NOT contain text label '五小時可用:'");
      console.log("✅ R22 passed! (E2E Emoji statusline rendered cleanly)");
    } finally {
      try { rmSync(homeR22, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // =========================================================================
    // Test R23: getDisplayWidth accuracy for block elements, box drawing & checkmarks
    // =========================================================================
    console.log("Running Test R23: getDisplayWidth accuracy for block elements & quota line wrapping...");
    assert.strictEqual(getDisplayWidth("█"), 1, "Block element █ must have display width 1");
    assert.strictEqual(getDisplayWidth("░"), 1, "Block element ░ must have display width 1");
    assert.strictEqual(getDisplayWidth("│"), 1, "Box drawing │ must have display width 1");
    assert.strictEqual(getDisplayWidth("✓"), 1, "Checkmark ✓ must have display width 1");
    assert.strictEqual(getDisplayWidth("✗"), 1, "Cross ✗ must have display width 1");
    assert.strictEqual(getDisplayWidth("[█████████░]"), 12, "10-char progress bar with brackets must have display width 12");
    assert.strictEqual(getDisplayWidth("脈絡用量"), 8, "4 CJK chars must have display width 8");
    assert.strictEqual(getDisplayWidth("🤖"), 2, "Emoji must have display width 2");

    // Verify the exact 4-item quota row from the user's bug report fits within 120 columns (termWidth for 135-col terminal)
    const quotaRowLine1 = "脈絡用量: 0.0% [░░░░░░░░░░] │ 權杖數: 0 / 1.0M [░░░░░░░░░░] │ 五小時倒數: 3h 52m │ 五小時重置: 2026/10/16 01:09";
    const quotaRowLine2 = "五小時可用: 88% [████████░░] │ 七日內可用: 94% [█████████░] │ 七日內倒數: 5d 17h │ 七日內重置: 2026/10/21 14:47";
    assert.ok(getDisplayWidth(quotaRowLine1) <= 120, `Quota line 1 width (${getDisplayWidth(quotaRowLine1)}) must fit in 120 cols`);
    assert.ok(getDisplayWidth(quotaRowLine2) <= 120, `Quota line 2 width (${getDisplayWidth(quotaRowLine2)}) must fit in 120 cols`);
    console.log("✅ R23 passed! (getDisplayWidth accurately counts 1-col symbols and prevents premature wrapping)");

    // =========================================================================
    // Test R24: getGitDirty & getGitBranch do NOT retry fallback binaries when git succeeds or exits non-ENOENT
    // =========================================================================
    console.log("Running Test R24: getGitDirty clean repo & getGitBranch non-repo single invocation...");
    let dirtyCalls = 0;
    const mockCleanGitExec = async (cmd) => {
      dirtyCalls++;
      return { stdout: "", ok: true, notFound: false };
    };
    const isDirtyClean = await getGitDirty({ vcs: { type: "git" } }, mockCleanGitExec);
    assert.strictEqual(isDirtyClean, false, "Clean repo should return false for dirty");
    assert.strictEqual(dirtyCalls, 1, "Clean repo must invoke git status only once (no fallback path retries)");

    let branchCalls = 0;
    const mockNonGitExec = async (cmd) => {
      branchCalls++;
      return { stdout: "", ok: false, notFound: false }; // git found, but non-zero exit (e.g. not a git repo)
    };
    const branchRes = await getGitBranch('zh-tw', '/tmp', mockNonGitExec);
    assert.strictEqual(branchRes, "無版本控制", "Non-git repo should return '無版本控制'");
    assert.strictEqual(branchCalls, 1, "Must only run git branch --show-current once with PATH git without probing fallback binaries");
    console.log("✅ R24 passed! (Subprocess fallback storm eliminated)");

    // =========================================================================
    // Test R25: resolveTerminalWidth & E2E startup terminal_width fallback from account cache
    // =========================================================================
    console.log("Running Test R25: resolveTerminalWidth & E2E startup width stability...");
    assert.strictEqual(resolveTerminalWidth({ terminal_width: 140 }, { terminalWidth: 160 }), 125, "Explicit width > 80 uses meta.terminal_width - 15");
    assert.strictEqual(resolveTerminalWidth({ terminal_width: 80 }, { terminalWidth: 150 }), 135, "Default 80 width at startup falls back to cached terminalWidth - 15");
    assert.strictEqual(resolveTerminalWidth({}, { terminalWidth: 150 }), 135, "Missing terminal_width falls back to cached terminalWidth - 15");
    assert.strictEqual(resolveTerminalWidth({ terminal_width: 80 }, {}), 65, "Uncached 80 width preserves 80 - 15 = 65");

    // E2E verify: First run with terminal_width=150 caches width; second run with terminal_width=80 (conversation start) keeps 2-line quota block
    const settingsR25 = {
      ui: {
        language: "zh-tw",
        footer: {
          items: [
            "context-used", "context-used-bar", "token-count", "token-count-bar", "quota-countdown", "quota-reset-time", "n",
            "quota", "quota-bar", "quota-weekly", "quota-weekly-bar", "quota-weekly-countdown", "quota-weekly-reset-time"
          ],
          barLength: 10,
          timeFormat: "smart"
        }
      }
    };
    const cacheR25 = {
      shortTerm: {
        gemini: {
          remaining_percentage: 88,
          reset_time: "2026-10-16T01:09:00.000Z",
          refreshes_in: "3h 52m"
        }
      },
      weekly: {
        gemini: {
          remaining_percentage: 94,
          reset_time: "2026-10-21T06:47:00.000Z",
          refreshes_in: "5d 17h"
        }
      },
      updatedAt: Date.now()
    };
    const homeR25 = makeTempHome(cacheR25, settingsR25);
    try {
      // Step 1: Normal session with 150-col terminal caches terminalWidth=150
      await runStatusline({
        model: { display_name: "Gemini 3.5 Flash (High)" },
        context_window: { total_input_tokens: 50000, context_window_size: 1000000, used_percentage: 5 },
        terminal_width: 150
      }, homeR25);

      // Step 2: Simulate new conversation start where CLI initially passes terminal_width: 80 and 0 context tokens
      const metaR25Start = {
        model: { display_name: "Gemini 3.5 Flash (High)" },
        context_window: { total_input_tokens: 0, context_window_size: 1000000, used_percentage: 0 },
        terminal_width: 80
      };
      const resR25 = await runStatusline(metaR25Start, homeR25);
      const plainR25Lines = stripAnsi(resR25.stdout).trim().split("\n");
      assert.strictEqual(resR25.code, 0);
      assert.strictEqual(plainR25Lines.length, 2, `Expected 2 lines for quota block at conversation start, got ${plainR25Lines.length}:\n${plainR25Lines.join("\n")}`);
      console.log("✅ R25 passed! (Initial conversation startup maintains stable 2-line quota layout)");
    } finally {
      try { rmSync(homeR25, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // =========================================================================
    // Test R26: Verifying itemStyles, style conflict in adjacent items (no merge on conflict, merge when matched)
    // =========================================================================
    console.log("\n[Test R26] Verifying itemStyles, style conflict in adjacent items & E2E rendering...");
    
    // 1. preprocessAdjacentItems with itemStyles
    // Case A: Style conflict (quota is emoji, quota-bar is text / default) -> DO NOT MERGE
    assert.deepStrictEqual(
      preprocessAdjacentItems(['quota', 'quota-bar'], { quota: 'emoji' }),
      ['quota', 'quota-bar'],
      'Style conflict (emoji vs text) must NOT merge into quota+bar'
    );
    assert.deepStrictEqual(
      preprocessAdjacentItems(['quota', 'quota-bar'], { 'quota-bar': 'emoji' }),
      ['quota', 'quota-bar'],
      'Style conflict (text vs emoji) must NOT merge into quota+bar'
    );

    // Case B: Same style (both emoji) -> DO MERGE
    assert.deepStrictEqual(
      preprocessAdjacentItems(['quota', 'quota-bar'], { quota: 'emoji', 'quota-bar': 'emoji' }),
      ['quota+bar'],
      'Matching emoji styles must merge into quota+bar'
    );

    // Case C: Same style (both text / empty itemStyles) -> DO MERGE
    assert.deepStrictEqual(
      preprocessAdjacentItems(['quota', 'quota-bar'], {}),
      ['quota+bar'],
      'Default matching text styles must merge into quota+bar'
    );

    // Case D: Other adjacent pairs with conflict
    assert.deepStrictEqual(
      preprocessAdjacentItems(['context-used', 'context-used-bar'], { 'context-used': 'emoji' }),
      ['context-used', 'context-used-bar'],
      'Context bar conflict must NOT merge'
    );
    assert.deepStrictEqual(
      preprocessAdjacentItems(['quota-weekly', 'quota-weekly-bar'], { 'quota-weekly': 'emoji' }),
      ['quota-weekly', 'quota-weekly-bar'],
      'Weekly quota bar conflict must NOT merge'
    );
    assert.deepStrictEqual(
      preprocessAdjacentItems(['token-count', 'token-count-bar'], { 'token-count-bar': 'emoji' }),
      ['token-count', 'token-count-bar'],
      'Token count bar conflict must NOT merge'
    );

    // 2. buildI18nDict with itemStyles
    const dictR26 = buildI18nDict('zh-tw', dummyMetrics, 'text', { quota: 'emoji' });
    const plainQuotaR26 = stripAnsi(dictR26['quota']);
    const plainBarR26 = stripAnsi(dictR26['quota-bar']);
    const plainModelR26 = stripAnsi(dictR26['model-name']);

    assert.ok(plainQuotaR26.includes('🔋 88%'), 'Quota with emoji style must render 🔋 88%');
    assert.ok(!plainQuotaR26.includes('五小時可用:'), 'Quota with emoji style must not have text label');
    assert.ok(plainBarR26.includes('五小時可用: [████████░░]'), 'Quota-bar without emoji style must default to text label');
    assert.ok(plainModelR26.includes('模型: Gemini 3.5 Flash'), 'Model without emoji style must default to text label');

    // 2b. buildI18nDict when both paired items are emoji -> MUST render with emoji prefix
    const dictR26Both = buildI18nDict('zh-tw', dummyMetrics, 'text', {
      'quota': 'emoji',
      'quota-bar': 'emoji',
      'context-used': 'emoji',
      'context-used-bar': 'emoji',
      'quota-weekly': 'emoji',
      'quota-weekly-bar': 'emoji',
      'token-count': 'emoji',
      'token-count-bar': 'emoji'
    });
    const plainQuotaBarBoth = stripAnsi(dictR26Both['quota+bar']);
    const plainContextBarBoth = stripAnsi(dictR26Both['context-used+bar']);
    const plainWeeklyBarBoth = stripAnsi(dictR26Both['quota-weekly+bar']);
    const plainTokenBarBoth = stripAnsi(dictR26Both['token-count+bar']);

    assert.ok(plainQuotaBarBoth.includes('🔋 88% [████████░░]'), 'Merged quota+bar when both are emoji must render 🔋');
    assert.ok(!plainQuotaBarBoth.includes('五小時可用:'), 'Merged quota+bar with emoji must not contain text label');
    assert.ok(plainContextBarBoth.includes('🧠 15.2% [█░░░░░░░░░]'), 'Merged context-used+bar when both are emoji must render 🧠');
    assert.ok(plainWeeklyBarBoth.includes('📅 90% [█████████░]'), 'Merged quota-weekly+bar when both are emoji must render 📅');
    assert.ok(plainTokenBarBoth.includes('💰 12.5k / 1.0M [██░░░░░░░░]'), 'Merged token-count+bar when both are emoji must render 💰');

    // 3. E2E execution with itemStyles
    // 3a. Style conflict test: quota=emoji, quota-bar=text -> separate
    const settingsR26 = {
      ui: {
        language: "zh-tw",
        footer: {
          items: [
            "model-name",
            "quota",
            "quota-bar",
            "git-branch"
          ],
          itemStyles: {
            "quota": "emoji",
            "git-branch": "emoji"
          }
        }
      }
    };
    const cacheR26 = {
      updatedAt: Date.now(),
      accountEmail: "dev@example.com",
      planTier: "Pro",
      models: {
        "gemini 3.1 pro": {
          remaining_percentage: 90,
          reset_time: new Date(Date.now() + 3600 * 1000).toISOString()
        }
      }
    };
    const metaR26 = {
      model: { display_name: "Gemini 3.1 Pro" },
      vcs: { type: "git", branch: "feat/styles", dirty: false },
      terminal_width: 140
    };
    const homeR26 = makeTempHome(cacheR26, settingsR26);
    try {
      const resR26 = await runStatusline(metaR26, homeR26);
      const plainR26 = stripAnsi(resR26.stdout).trim();
      console.log("R26 Output:", JSON.stringify(resR26.stdout));

      assert.strictEqual(resR26.code, 0);
      assert.ok(plainR26.includes("模型: Gemini 3.1 Pro"), "model-name without override must be text");
      assert.ok(plainR26.includes("🔋 90%"), "quota with emoji override must be emoji");
      assert.ok(plainR26.includes("五小時可用: [█████████░]"), "quota-bar without override must be text");
      assert.ok(plainR26.includes("🔀 feat/styles"), "git-branch with emoji override must be emoji");
      assert.ok(plainR26.includes("🔋 90% │ 五小時可用: [█████████░]"), "Style conflict must prevent merge and render as two separate blocks");
      console.log("✅ R26 style conflict separation passed!");
    } finally {
      try { rmSync(homeR26, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // 3b. Matching emoji test: both quota and quota-bar are emoji -> merged with 🔋
    const settingsR26Merged = {
      ui: {
        language: "zh-tw",
        footer: {
          items: [
            "model-name",
            "quota",
            "quota-bar",
            "git-branch"
          ],
          itemStyles: {
            "quota": "emoji",
            "quota-bar": "emoji",
            "git-branch": "emoji"
          }
        }
      }
    };
    const homeR26Merged = makeTempHome(cacheR26, settingsR26Merged);
    try {
      const resR26Merged = await runStatusline(metaR26, homeR26Merged);
      const plainR26Merged = stripAnsi(resR26Merged.stdout).trim();
      console.log("R26 Merged Output:", JSON.stringify(resR26Merged.stdout));

      assert.strictEqual(resR26Merged.code, 0);
      assert.ok(plainR26Merged.includes("模型: Gemini 3.1 Pro"), "model-name without override must be text");
      assert.ok(plainR26Merged.includes("🔋 90% [█████████░]"), "Both quota and quota-bar with emoji override must merge into 🔋 90% [█████████░]");
      assert.ok(!plainR26Merged.includes("五小時可用:"), "Merged emoji bar must not contain text label");
      assert.ok(plainR26Merged.includes("🔀 feat/styles"), "git-branch with emoji override must be emoji");
      console.log("✅ R26 matching emoji merged passed!");
    } finally {
      try { rmSync(homeR26Merged, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // =========================================================================
    // Test R27: All pure numbers / skipped sorting with itemStyles: {} and residual labelStyle: "emoji"
    // MUST strictly enforce text style across all indicators (Defects 1 & 2 regression test)
    // =========================================================================
    console.log("\n[Test R27] Verifying pure numbers / skipped sorting (itemStyles: {}) with residual labelStyle: 'emoji' enforces text style...");

    // 1. Unit test: buildI18nDict with itemStyles: {} and global labelStyle: 'emoji'
    const dictR27 = buildI18nDict('zh-tw', dummyMetrics, 'emoji', {});
    const baseTextDict = buildI18nDict('zh-tw', dummyMetrics, 'text');
    for (const key of Object.keys(baseTextDict)) {
      const rendered = stripAnsi(dictR27[key]);
      const expectedText = stripAnsi(baseTextDict[key]);
      assert.strictEqual(
        rendered,
        expectedText,
        `Metric "${key}" with itemStyles: {} must strictly match base text dict, got: "${rendered}"`
      );
      if (EMOJI_MAP[key]) {
        assert.ok(
          !rendered.startsWith(EMOJI_MAP[key]),
          `Metric "${key}" must NOT start with emoji "${EMOJI_MAP[key]}" when itemStyles is {}`
        );
      }
    }

    // 2. Unit test: preprocessAdjacentItems with itemStyles: {} and defaultStyle: 'emoji'
    const mergedR27 = preprocessAdjacentItems(['quota', 'quota-bar'], {}, 'emoji');
    assert.deepStrictEqual(
      mergedR27,
      ['quota+bar'],
      'preprocessAdjacentItems with itemStyles: {} and defaultStyle: "emoji" must resolve items to "text" and merge'
    );

    // 2b. Unit test: preprocessAdjacentItems with 2nd argument as defaultStyle string 'emoji'
    const mergedStringStyle = preprocessAdjacentItems(['quota', 'quota-bar'], 'emoji');
    assert.deepStrictEqual(
      mergedStringStyle,
      ['quota+bar'],
      'preprocessAdjacentItems with 2nd argument as string "emoji" must correctly treat it as defaultStyle'
    );

    // 2c. Unit test: Array defense for itemStyles in buildI18nDict and preprocessAdjacentItems
    const arrayGuardDict = buildI18nDict('zh-tw', dummyMetrics, 'emoji', []);
    assert.strictEqual(
      stripAnsi(arrayGuardDict['model-name']),
      '🤖 Gemini 3.5 Flash',
      'buildI18nDict with itemStyles as array [] must NOT be treated as sparse style object'
    );
    const arrayGuardMerged = preprocessAdjacentItems(['quota', 'quota-bar'], []);
    assert.deepStrictEqual(
      arrayGuardMerged,
      ['quota+bar'],
      'preprocessAdjacentItems with array [] itemStyles must safely merge without throwing'
    );

    // 3. E2E test: settings containing residual labelStyle: "emoji" and itemStyles: {}
    const settingsR27 = {
      ui: {
        language: "zh-tw",
        footer: {
          labelStyle: "emoji", // residual old setting
          itemStyles: {},      // Step 4 pure numbers generates empty sparse dictionary
          items: [
            "model-name",
            "quota",
            "quota-bar",
            "git-branch",
            "vcs-dirty",
            "tool-confirmation"
          ]
        }
      }
    };
    const cacheR27 = {
      updatedAt: Date.now(),
      accountEmail: "dev@example.com",
      planTier: "Pro",
      models: {
        "gemini 3.1 pro": {
          remaining_percentage: 90,
          reset_time: new Date(Date.now() + 3600 * 1000).toISOString()
        }
      }
    };
    const metaR27 = {
      model: { display_name: "Gemini 3.1 Pro" },
      vcs: { type: "git", branch: "feat/pure-numbers", dirty: false },
      has_tool_confirmation: false,
      terminal_width: 140
    };
    const homeR27 = makeTempHome(cacheR27, settingsR27);
    try {
      const resR27 = await runStatusline(metaR27, homeR27);
      const plainR27 = stripAnsi(resR27.stdout).trim();
      console.log("R27 Output:", JSON.stringify(resR27.stdout));

      assert.strictEqual(resR27.code, 0);
      assert.ok(plainR27.includes("模型: Gemini 3.1 Pro"), "Must render text label '模型:'");
      assert.ok(plainR27.includes("五小時可用: 90% [█████████░]"), "Must render merged quota+bar with text label '五小時可用:'");
      assert.ok(plainR27.includes("分支: feat/pure-numbers"), "Must render text label '分支:'");
      assert.ok(plainR27.includes("版控狀態: 無變更"), "Must render text label '版控狀態:'");
      assert.ok(plainR27.includes("工具待確認: 無"), "Must render text label '工具待確認:'");

      // Verify no emoji prefixes leaked into the statusline
      assert.ok(!plainR27.includes("🤖"), "Must NOT contain robot emoji");
      assert.ok(!plainR27.includes("🔋"), "Must NOT contain battery emoji");
      assert.ok(!plainR27.includes("🔀"), "Must NOT contain branch emoji");
      assert.ok(!plainR27.includes("🔍"), "Must NOT contain dirty emoji");
      assert.ok(!plainR27.includes("🔔"), "Must NOT contain bell emoji");
      console.log("✅ R27 pure numbers text enforcement passed!");
    } finally {
      try { rmSync(homeR27, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // 4. Backward compatibility E2E test: legacy settings with labelStyle: "emoji" and NO itemStyles key
    const settingsLegacy = {
      ui: {
        language: "zh-tw",
        footer: {
          labelStyle: "emoji",
          items: ["model-name", "quota", "quota-bar", "git-branch"]
        }
      }
    };
    const homeLegacy = makeTempHome(cacheR27, settingsLegacy);
    try {
      const resLegacy = await runStatusline(metaR27, homeLegacy);
      const plainLegacy = stripAnsi(resLegacy.stdout).trim();
      console.log("Legacy Emoji Output:", JSON.stringify(resLegacy.stdout));

      assert.strictEqual(resLegacy.code, 0);
      assert.ok(plainLegacy.includes("🤖 Gemini 3.1 Pro"), "Legacy config without itemStyles must preserve emoji mode");
      assert.ok(plainLegacy.includes("🔋 90% [█████████░]"), "Legacy config must preserve merged emoji bar");
      assert.ok(plainLegacy.includes("🔀 feat/pure-numbers"), "Legacy config must preserve emoji branch");
      console.log("✅ Legacy emoji backward compatibility passed!");
    } finally {
      try { rmSync(homeLegacy, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }
  } catch (err) {
    console.error("Test execution failed:", err);
    testsPassed = false;
  }

  if (testsPassed) {
    console.log("\n🎉 All render-and-i18n.test.mjs (R8, R16-R27) tests passed successfully!");
    process.exit(0);
  } else {
    console.error("\n❌ Some render-and-i18n.test.mjs (R8, R16-R27) tests failed.");
    process.exit(1);
  }
}

main();
