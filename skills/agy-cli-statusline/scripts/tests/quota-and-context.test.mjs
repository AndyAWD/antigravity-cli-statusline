import { writeFileSync, readFileSync, mkdirSync, rmSync, mkdtempSync, symlinkSync, copyFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import http from 'http';
import { spawn } from 'child_process';
import assert from 'assert';
import {
  formatAbsoluteResetTime,
  renderBarGraph,
  buildI18nDict,
  preprocessAdjacentItems,
  renderStatusLine,
  stripAnsi,
  resolveArgonQuota,
  parseMetaQuota,
  mergeQuotaBuckets,
  formatResetTime,
  STEP_UP_INTERMEDIATE_THRESHOLD,
  parseCeilingValue,
  extractModelCandidateKeys,
  computeSteppedCeiling,
  calculateContextUsageAsync,
  extractMetricsAsync
} from '../statusline-quota.mjs';
import {
  runStatusline,
  makeTempHome,
  withHomeEnv,
  SCRIPT_PATH,
  FETCH_SCRIPT_PATH,
  SCRIPTS_DIR,
  copyDirRecursiveSync,
  BLUE_BOLD,
  GREEN_BOLD,
  YELLOW,
  WHITE,
  RESET
} from './helpers.mjs';

async function main() {
  console.log("=== Running quota-and-context.test.mjs (R1-R7, R9-R15, R28-R33) ===");

  let testsPassed = true;

  try {
    // ----------------------------------------------------
    // Test Case R1: Weekly countdown renders
    // Justification: Verifies that weekly reset countdown displays in BLUE+BOLD for a Gemini model.
    // ----------------------------------------------------
    console.log("\n[Test R1] Verifying weekly countdown rendering...");
    const mockCacheR1 = {
      weekly: {
        gemini: {
          remaining_percentage: 90.07,
          reset_time: '2026-07-05T03:22:46Z',
          refreshes_in: '4d 11h'
        }
      },
      updatedAt: Date.now()
    };
    const settingsR1 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly-countdown"]
        }
      }
    };
    const metaR1 = {
      model: { display_name: "Gemini 1.5 Pro" },
      terminal_width: 120
    };

    const homeR1 = makeTempHome(mockCacheR1, settingsR1);
    try {
      const resR1 = await runStatusline(metaR1, homeR1);
      console.log("R1 Output:", JSON.stringify(resR1.stdout));

      const expectedR1 = `${WHITE}7-day Reset:${RESET} ${BLUE_BOLD}4d 11h${RESET}`;
      if (resR1.code === 0 && resR1.stdout.includes(expectedR1)) {
        console.log("✅ R1 passed!");
      } else {
        console.error(`❌ R1 failed! Expected output to contain: ${JSON.stringify(expectedR1)}`);
        testsPassed = false;
      }
    } finally {
      try { rmSync(homeR1, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R2: Weekly % color tier
    // Justification: Verifies color tier mapping for new weekly quota (90% -> BLUE+BOLD).
    // ----------------------------------------------------
    console.log("\n[Test R2] Verifying weekly quota % color tier...");
    const mockCacheR2 = {
      weekly: {
        gemini: {
          remaining_percentage: 90.07,
          reset_time: '2026-07-05T03:22:46Z',
          refreshes_in: '4d 11h'
        }
      },
      updatedAt: Date.now()
    };
    const settingsR2 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly"]
        }
      }
    };
    const metaR2 = {
      model: { display_name: "Gemini 1.5 Pro" },
      terminal_width: 120
    };

    const homeR2 = makeTempHome(mockCacheR2, settingsR2);
    try {
      const resR2 = await runStatusline(metaR2, homeR2);
      console.log("R2 Output:", JSON.stringify(resR2.stdout));

      const expectedR2 = `${WHITE}7-day Available:${RESET} ${BLUE_BOLD}90%${RESET}`;
      if (resR2.code === 0 && resR2.stdout.includes(expectedR2)) {
        console.log("✅ R2 passed!");
      } else {
        console.error(`❌ R2 failed! Expected output to contain: ${JSON.stringify(expectedR2)}`);
        testsPassed = false;
      }
    } finally {
      try { rmSync(homeR2, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R3: Pool mapping (Claude -> 3p)
    // Justification: Exercises family -> pool resolver (Claude/GPT model maps to '3p' weekly bucket).
    // ----------------------------------------------------
    console.log("\n[Test R3] Verifying pool mapping (Claude -> 3p)...");
    const mockCacheR3 = {
      weekly: {
        '3p': {
          remaining_percentage: 60.5,
          reset_time: '2026-07-07T07:27:15Z',
          refreshes_in: '6d 15h'
        }
      },
      updatedAt: Date.now()
    };
    const settingsR3 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly"]
        }
      }
    };
    const metaR3 = {
      model: { display_name: "Claude 3.5 Sonnet" },
      terminal_width: 120
    };

    const homeR3 = makeTempHome(mockCacheR3, settingsR3);
    try {
      const resR3 = await runStatusline(metaR3, homeR3);
      console.log("R3 Output:", JSON.stringify(resR3.stdout));

      const expectedR3 = `${WHITE}7-day Available:${RESET} ${GREEN_BOLD}61%${RESET}`;
      if (resR3.code === 0 && resR3.stdout.includes(expectedR3)) {
        console.log("✅ R3 passed!");
      } else {
        console.error(`❌ R3 failed! Expected output to contain: ${JSON.stringify(expectedR3)}`);
        testsPassed = false;
      }
    } finally {
      try { rmSync(homeR3, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R4: Graceful fallback
    // Justification: Verifies missing-data degradation (no weekly key returns N/A without crash).
    // ----------------------------------------------------
    console.log("\n[Test R4] Verifying graceful fallback...");
    const mockCacheR4 = {
      updatedAt: Date.now()
    };
    const settingsR4 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly-countdown"]
        }
      }
    };
    const metaR4 = {
      model: { display_name: "Gemini 1.5 Pro" },
      terminal_width: 120
    };

    const homeR4 = makeTempHome(mockCacheR4, settingsR4);
    try {
      const resR4 = await runStatusline(metaR4, homeR4);
      console.log("R4 Output:", JSON.stringify(resR4.stdout));

      const expectedR4 = `${WHITE}7-day Reset:${RESET} ${BLUE_BOLD}N/A${RESET}`;
      if (resR4.code === 0 && resR4.stdout.includes(expectedR4)) {
        console.log("✅ R4 passed!");
      } else {
        console.error(`❌ R4 failed! Expected output to contain: ${JSON.stringify(expectedR4)}`);
        testsPassed = false;
      }
    } finally {
      try { rmSync(homeR4, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R5: Hourly Available uses shortTerm 5h quota
    // Justification: Verifies that Hourly Available prefers shortTerm 5h quota (32% / 2h 2m) over weekly bottleneck model quota (4.7% / 1h 20m).
    // ----------------------------------------------------
    console.log("\n[Test R5] Verifying shortTerm 5h quota priority for Hourly Available...");
    const mockCacheR5 = {
      models: {
        gemini36flashhigh: {
          remaining_percentage: 4.67,
          reset_time: '2026-08-07T11:12:18Z',
          refreshes_in: '1h 20m'
        }
      },
      shortTerm: {
        gemini: {
          remaining_percentage: 31.8,
          reset_time: '2026-08-07T11:54:34Z',
          refreshes_in: '2h 2m'
        }
      },
      updatedAt: Date.now()
    };
    const settingsR5 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota", "quota-reset-countdown"]
        }
      }
    };
    const metaR5 = {
      model: { display_name: "Gemini 3.6 Flash (High)" },
      terminal_width: 120
    };

    const homeR5 = makeTempHome(mockCacheR5, settingsR5);
    try {
      const resR5 = await runStatusline(metaR5, homeR5);
      console.log("R5 Output:", JSON.stringify(resR5.stdout));

      const expectedR5Quota = `${WHITE}5-hr Available:${RESET} ${YELLOW}\x1b[1m32%${RESET}`;
      const expectedR5Reset = `${WHITE}5-hr Reset:${RESET} ${BLUE_BOLD}2h 2m${RESET}`;
      if (resR5.code === 0 && resR5.stdout.includes(expectedR5Quota) && resR5.stdout.includes(expectedR5Reset)) {
        console.log("✅ R5 passed!");
      } else {
        console.error(`❌ R5 failed! Expected output to contain 32% and 2h 2m.`);
        testsPassed = false;
      }
    } finally {
      try { rmSync(homeR5, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R6: Direct meta.quota integration (Native CLI quota, zero disk dependency)
    // ----------------------------------------------------
    console.log("\n[Test R6] Verifying native meta.quota rendering and persistence...");
    const settingsR6 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota", "quota-reset-countdown", "quota-weekly", "quota-weekly-countdown"]
        }
      }
    };
    const metaR6 = {
      model: { display_name: "Gemini 3.8 Flash (High)" },
      quota: {
        "gemini-5h": {
          remaining_fraction: 0.75,
          reset_in_seconds: 7200
        },
        "gemini-weekly": {
          remaining_fraction: 0.82,
          reset_in_seconds: 360000
        }
      },
      plan_tier: "Google AI Pro",
      email: "test@example.com",
      terminal_width: 160
    };

    const homeR6 = makeTempHome({}, settingsR6);
    try {
      const resR6 = await runStatusline(metaR6, homeR6);
      console.log("R6 Output:", JSON.stringify(resR6.stdout));

      const expectedR6Hourly = `${WHITE}5-hr Available:${RESET} ${BLUE_BOLD}75%${RESET}`;
      const expectedR6HourlyReset = `${WHITE}5-hr Reset:${RESET} ${BLUE_BOLD}2h${RESET}`;
      const expectedR6Weekly = `${WHITE}7-day Available:${RESET} ${BLUE_BOLD}82%${RESET}`;
      const expectedR6WeeklyReset = `${WHITE}7-day Reset:${RESET} ${BLUE_BOLD}4d 4h${RESET}`;

      if (resR6.code === 0 && 
          resR6.stdout.includes(expectedR6Hourly) && 
          resR6.stdout.includes(expectedR6HourlyReset) &&
          resR6.stdout.includes(expectedR6Weekly) &&
          resR6.stdout.includes(expectedR6WeeklyReset)) {
        console.log("✅ R6 passed!");
      } else {
        console.error(`❌ R6 failed! Output did not contain expected values.`);
        testsPassed = false;
      }
    } finally {
      try { rmSync(homeR6, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R7: Symbolic link execution regression test
    // ----------------------------------------------------
    console.log("\n[Test R7] Verifying execution when invoked via symbolic link...");
    const homeR7 = makeTempHome({}, settingsR6);
    const symlinkPath = join(homeR7, 'symlink-statusline.mjs');
    let symlinkTested = false;
    try {
      try {
        symlinkSync(SCRIPT_PATH, symlinkPath, 'file');
        symlinkTested = true;
      } catch (symlinkErr) {
        console.log(`⚠️ Symlinks not permitted in this environment (${symlinkErr.code || symlinkErr.message}), skipping R7 symlink invocation.`);
      }

      if (symlinkTested) {
        const resR7 = await runStatusline(metaR6, homeR7, symlinkPath);
        if (resR7.code === 0 && resR7.stdout && resR7.stdout.trim().length > 0) {
          console.log("✅ R7 passed! (Symbolic link executed statusline successfully)");
        } else {
          console.error(`❌ R7 failed! Statusline returned 0 bytes or failed when invoked via symbolic link. Code: ${resR7.code}, Output: ${JSON.stringify(resR7.stdout)}`);
          testsPassed = false;
        }
      }
    } finally {
      try { rmSync(homeR7, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }


    // R9 用之 R8 共用夾具（模擬快取與 meta，拆檔後於此重新宣告）
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

    // ----------------------------------------------------
    // Test Case R9: Case-insensitive & complex language code normalization (zh-CN, cn & 简体中文 (zh-cn))
    // Justification: Verifies that 'zh-CN', 'cn', and full label '简体中文 (zh-cn)' are properly normalized to 'zh-cn' and render Simplified Chinese instead of falling back to zh-tw.
    // ----------------------------------------------------
    console.log("\n[Test R9] Verifying case-insensitive & label language normalization (zh-CN, cn, 简体中文 (zh-cn))...");
    const langVariants = ["zh-CN", "cn", "简体中文 (zh-cn)"];
    for (const testLang of langVariants) {
      const settingsVar = {
        ui: {
          language: testLang,
          footer: {
            items: ["quota", "context-used", "memory-usage", "vcs-dirty", "sandbox-status", "agent-profile"]
          }
        }
      };
      const homeVar = makeTempHome(mockCacheR8, settingsVar);
      try {
        const resVar = await runStatusline(metaR8, homeVar);
        console.log(`R9 (${testLang}) Output:`, JSON.stringify(resVar.stdout));

        const hasZhCnQuota = resVar.stdout.includes("五小时可用:");
        const hasZhCnCtx = resVar.stdout.includes("上下文用量:");
        const hasZhCnMem = resVar.stdout.includes("内存:");
        const hasZhCnClean = resVar.stdout.includes("无变更");
        const hasZhCnSandbox = resVar.stdout.includes("关闭");
        const hasZhCnProfile = resVar.stdout.includes("代理角色:") && resVar.stdout.includes("Default");

        if (resVar.code === 0 && hasZhCnQuota && hasZhCnCtx && hasZhCnMem && hasZhCnClean && hasZhCnSandbox && hasZhCnProfile) {
          console.log(`✅ R9 passed for "${testLang}"! (Properly normalized to Simplified Chinese zh-cn)`);
        } else {
          console.error(`❌ R9 failed for "${testLang}"! Did not render Simplified Chinese. Output: ${JSON.stringify(resVar.stdout)}`);
          testsPassed = false;
        }
      } finally {
        try { rmSync(homeVar, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
      }
    }

    // ----------------------------------------------------
    // Test Case R10: formatAbsoluteResetTime verification
    // ----------------------------------------------------
    console.log("\n[Test R10] Verifying formatAbsoluteResetTime (smart, 12h, 24h, custom)...");
    const refDate = new Date(2026, 9, 13, 10, 0, 0);
    const sameDayIso = new Date(2026, 9, 13, 15, 30, 0).toISOString();
    const nextDayIso = new Date(2026, 9, 20, 11, 45, 0).toISOString();
    const morningIso = new Date(2026, 9, 13, 9, 5, 0).toISOString();

    assert.strictEqual(formatAbsoluteResetTime(sameDayIso, 'smart', refDate), '15:30');
    assert.strictEqual(formatAbsoluteResetTime(sameDayIso, 'auto', refDate), '15:30');
    assert.strictEqual(formatAbsoluteResetTime(nextDayIso, 'smart', refDate), '2026/10/20 11:45');
    assert.strictEqual(formatAbsoluteResetTime(sameDayIso, 'yyyy/MM/dd HH:mm', refDate), '2026/10/13 15:30');
    assert.strictEqual(formatAbsoluteResetTime(sameDayIso, 'yyyy-MM-dd HH:mm', refDate), '2026/10/13 15:30');
    assert.strictEqual(formatAbsoluteResetTime(sameDayIso, 'full', refDate), '2026/10/13 15:30');
    assert.strictEqual(formatAbsoluteResetTime(sameDayIso, '12h', refDate), '03:30 PM');
    assert.strictEqual(formatAbsoluteResetTime(morningIso, '12h', refDate), '09:05 AM');
    assert.strictEqual(formatAbsoluteResetTime(nextDayIso, '24h', refDate), '11:45');
    assert.strictEqual(formatAbsoluteResetTime('', 'smart'), '');
    assert.strictEqual(formatAbsoluteResetTime(null, 'smart'), '');
    assert.strictEqual(formatAbsoluteResetTime('invalid-date', 'smart'), '');
    assert.strictEqual(formatAbsoluteResetTime(sameDayIso, 'smart', null), formatAbsoluteResetTime(sameDayIso, 'smart', new Date()));
    console.log("✅ R10 passed! (formatAbsoluteResetTime formatted all cases accurately)");

    // ----------------------------------------------------
    // Test Case R11: renderBarGraph verification
    // ----------------------------------------------------
    console.log("\n[Test R11] Verifying renderBarGraph (0%, 50%, 88%, 100%, lengths, colors)...");
    assert.strictEqual(stripAnsi(renderBarGraph(0, 10)), '[░░░░░░░░░░]');
    assert.strictEqual(stripAnsi(renderBarGraph(50, 10)), '[█████░░░░░]');
    assert.strictEqual(stripAnsi(renderBarGraph(88, 10)), '[████████░░]');
    assert.strictEqual(stripAnsi(renderBarGraph("88%", 10)), '[████████░░]');
    assert.strictEqual(stripAnsi(renderBarGraph(100, 10)), '[██████████]');
    assert.strictEqual(stripAnsi(renderBarGraph(-10, 10)), '[░░░░░░░░░░]');
    assert.strictEqual(stripAnsi(renderBarGraph(150, 10)), '[██████████]');
    assert.strictEqual(stripAnsi(renderBarGraph(NaN, 10)), '[░░░░░░░░░░]');
    assert.strictEqual(stripAnsi(renderBarGraph(50, 6)), '[███░░░]');
    assert.strictEqual(stripAnsi(renderBarGraph(50, 0)), '[█████░░░░░]'); // 0 defaults to 10
    assert.strictEqual(stripAnsi(renderBarGraph(50, 100)), '[' + '█'.repeat(25) + '░'.repeat(25) + ']'); // capped at 50

    const coloredBar = renderBarGraph(80, 10, '\x1b[38;2;87;202;255m');
    assert.ok(coloredBar.includes('\x1b[38;2;87;202;255m████████\x1b[0m░░'));

    const invertedLow = renderBarGraph(20, 10, '', true);
    assert.ok(invertedLow.includes('\x1b[38;2;87;202;255m██\x1b[0m░░░░░░░░'));
    const invertedHigh = renderBarGraph(90, 10, '', true);
    assert.ok(invertedHigh.includes('\x1b[38;2;255;125;175m█████████\x1b[0m░'));
    console.log("✅ R11 passed! (renderBarGraph rendered block graphics and colors accurately)");

    // ----------------------------------------------------
    // Test Case R12: 4-language i18n dictionary completeness for 6 new metrics
    // ----------------------------------------------------
    console.log("\n[Test R12] Verifying buildI18nDict for 6 new metrics and merged items in all 4 languages...");
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

    const newMetricKeys = [
      'quota-reset-time', 'quota-weekly-reset-time',
      'quota-bar', 'quota-weekly-bar',
      'context-used-bar', 'token-count-bar',
      'quota+bar', 'context-used+bar', 'quota-weekly+bar', 'token-count+bar',
      'quota-argon', 'quota-argon-bar', 'quota-argon-countdown', 'quota-argon-reset-time', 'quota-argon+bar',
      'plugin-version'
    ];

    for (const testLang of ['zh-tw', 'zh-cn', 'us', 'jp']) {
      const dict = buildI18nDict(testLang, dummyMetrics);
      for (const k of newMetricKeys) {
        assert.ok(dict[k], `Language ${testLang} must define metric "${k}"`);
        assert.ok(typeof dict[k] === 'string' && dict[k].length > 0, `Metric "${k}" in ${testLang} must not be empty`);
      }
    }
    console.log("✅ R12 passed! (All 4 languages define all 6 new metrics and 4 merged items)");

    // ----------------------------------------------------
    // Test Case R13: Adjacent auto-merge preprocessor verification
    // ----------------------------------------------------
    console.log("\n[Test R13] Verifying adjacent auto-merge preprocessor...");
    assert.deepStrictEqual(preprocessAdjacentItems(['quota', 'quota-bar']), ['quota+bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(['quota-bar', 'quota']), ['quota+bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(['context-used', 'context-used-bar']), ['context-used+bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(['context-used-bar', 'context-used']), ['context-used+bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(['quota-weekly', 'quota-weekly-bar']), ['quota-weekly+bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(['quota-weekly-bar', 'quota-weekly']), ['quota-weekly+bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(['quota-argon', 'quota-argon-bar']), ['quota-argon+bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(['quota-argon-bar', 'quota-argon']), ['quota-argon+bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(['token-count', 'token-count-bar']), ['token-count+bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(['token-count-bar', 'token-count']), ['token-count+bar']);

    // Non-adjacent items remain unmerged
    assert.deepStrictEqual(preprocessAdjacentItems(['quota', 'model-name', 'quota-bar']), ['quota', 'model-name', 'quota-bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(['quota', 'n', 'quota-bar']), ['quota', 'n', 'quota-bar']);
    assert.deepStrictEqual(preprocessAdjacentItems(null), []);

    // renderStatusLine with merged items
    const zhTwDict = buildI18nDict('zh-tw', dummyMetrics);
    const renderedLines = renderStatusLine(['quota', 'quota-bar', 'context-used', 'context-used-bar'], zhTwDict, 200);
    const plainRendered = stripAnsi(renderedLines[0]);
    assert.ok(plainRendered.includes('五小時可用: 88% [████████░░]'), `Expected merged quota text in: ${plainRendered}`);
    assert.ok(plainRendered.includes('脈絡用量: 15.2% [█░░░░░░░░░]'), `Expected merged context text in: ${plainRendered}`);
    console.log("✅ R13 passed! (Adjacent items merged cleanly without directional constraint)");

    // ----------------------------------------------------
    // Test Case R14: Hermetic E2E execution with new metrics & auto-merge
    // ----------------------------------------------------
    console.log("\n[Test R14] Verifying hermetic E2E execution with new metrics & auto-merge...");
    const mockCacheR14 = {
      shortTerm: {
        gemini: {
          remaining_percentage: 88.0,
          reset_time: '2026-10-13T07:50:47Z',
          refreshes_in: '3h 10m'
        }
      },
      weekly: {
        gemini: {
          remaining_percentage: 90.0,
          reset_time: '2026-10-20T07:50:47Z',
          refreshes_in: '7d'
        }
      },
      updatedAt: Date.now()
    };

    const settingsR14 = {
      ui: {
        language: "zh-tw",
        footer: {
          items: [
            "quota", "quota-bar", "quota-reset-time",
            "quota-weekly", "quota-weekly-bar", "quota-weekly-reset-time",
            "context-used", "context-used-bar",
            "token-count", "token-count-bar"
          ],
          barLength: 10,
          timeFormat: "smart"
        }
      }
    };

    const metaR14 = {
      model: { display_name: "Gemini 3.5 Flash" },
      terminal_width: 300,
      context_window: { total_input_tokens: 152000, context_window_size: 1000000, used_percentage: 15.2 }
    };

    const homeR14 = makeTempHome(mockCacheR14, settingsR14);
    try {
      const resR14 = await runStatusline(metaR14, homeR14);
      console.log("R14 Output:", JSON.stringify(resR14.stdout));
      const plainOut = stripAnsi(resR14.stdout);

      assert.strictEqual(resR14.code, 0);
      assert.ok(plainOut.includes('五小時可用: 88% [████████░░]'), 'Output must contain merged hourly quota and bar');
      assert.ok(plainOut.includes('五小時重置:'), 'Output must contain hourly reset time label');
      assert.ok(plainOut.includes('七日內可用: 90% [█████████░]'), 'Output must contain merged weekly quota and bar');
      assert.ok(plainOut.includes('七日內重置:'), 'Output must contain weekly reset time label');
      assert.ok(plainOut.includes('脈絡用量: 15.2% [█░░░░░░░░░]'), 'Output must contain merged context used and bar');
      assert.ok(plainOut.includes('權杖數:'), 'Output must contain token count');
      assert.ok(plainOut.includes('[█░░░░░░░░░]'), 'Output must contain token bar graph');
      console.log("✅ R14 passed! (Hermetic E2E execution rendered merged and new indicators perfectly)");
    } finally {
      try { rmSync(homeR14, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R15: meta.quota reset_in_seconds derivation of reset-time
    // ----------------------------------------------------
    console.log("\n[Test R15] Verifying meta.quota with reset_in_seconds derives absolute reset time...");
    const settingsR15 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-reset-time", "quota-weekly-reset-time"]
        }
      }
    };
    const metaR15 = {
      model: { display_name: "Gemini 3.8 Flash (High)" },
      quota: {
        "gemini-5h": {
          remaining_fraction: 0.8,
          reset_in_seconds: 3600
        },
        "gemini-weekly": {
          remaining_fraction: 0.9,
          reset_in_seconds: 86400
        }
      },
      terminal_width: 160
    };

    const homeR15 = makeTempHome({}, settingsR15);
    try {
      const resR15 = await runStatusline(metaR15, homeR15);
      console.log("R15 Output:", JSON.stringify(resR15.stdout));
      const plainR15 = stripAnsi(resR15.stdout);

      assert.strictEqual(resR15.code, 0);
      assert.ok(plainR15.includes('5-hr Reset Time:'), 'Must include 5h Reset Time label');
      assert.ok(!plainR15.includes('5-hr Reset Time: N/A'), '5h Reset Time must not be N/A when reset_in_seconds is provided');
      assert.ok(plainR15.includes('7-day Reset Time:'), 'Must include Weekly Reset Time label');
      assert.ok(!plainR15.includes('7-day Reset Time: N/A'), 'Weekly Reset Time must not be N/A when reset_in_seconds is provided');
      console.log("✅ R15 passed! (meta.quota reset_in_seconds derived valid absolute reset times)");
    } finally {
      try { rmSync(homeR15, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }


    // R28 共用之 R27 meta 夾具（拆檔後於此重新宣告）
    const metaR27 = {
      model: { display_name: "Gemini 3.1 Pro" },
      vcs: { type: "git", branch: "feat/pure-numbers", dirty: false },
      has_tool_confirmation: false,
      terminal_width: 140
    };

    console.log("\n[Test R28] Verifying Gemini 4 Argon quota resolution, auto-merge, and 4-locale rendering...");
    // 1. Direct function test for resolveArgonQuota
    const mockArgonCache = {
      updatedAt: Date.now(),
      weekly: {
        "gemini-argon-wtu": {
          remaining_percentage: 58.93,
          reset_time: "2026-10-30T14:57:31Z",
          refreshes_in: "6d 1h"
        },
        "gemini": {
          remaining_percentage: 90,
          reset_time: "2026-10-25T12:00:00Z",
          refreshes_in: "4d 11h"
        }
      }
    };
    const argonRes = resolveArgonQuota(mockArgonCache);
    assert.ok(argonRes !== null, "resolveArgonQuota should find gemini-argon-wtu pool");
    assert.strictEqual(Math.round(argonRes.remaining_percentage), 59, "Argon percentage should round to 59");
    assert.strictEqual(argonRes.refreshes_in, "6d 1h");
    assert.strictEqual(argonRes.reset_time, "2026-10-30T14:57:31Z");

    // Test missing Argon pool
    const mockNoArgonCache = {
      updatedAt: Date.now(),
      weekly: {
        "gemini": {
          remaining_percentage: 90,
          reset_time: "2026-10-25T12:00:00Z",
          refreshes_in: "4d 11h"
        }
      }
    };
    const noArgonRes = resolveArgonQuota(mockNoArgonCache);
    assert.strictEqual(noArgonRes.remaining_percentage, 100);
    assert.strictEqual(noArgonRes.refreshes_in, "");

    // 2. E2E rendering with 4 locales and Emoji mode
    const localesR28 = [
      { lang: 'zh-tw', quotaPrefix: 'Argon 可用: 59%', countdownPrefix: 'Argon 倒數: 6d 1h', resetPrefix: 'Argon 重置:' },
      { lang: 'zh-cn', quotaPrefix: 'Argon 可用: 59%', countdownPrefix: 'Argon 倒数: 6d 1h', resetPrefix: 'Argon 重置:' },
      { lang: 'us', quotaPrefix: 'Argon Available: 59%', countdownPrefix: 'Argon Reset: 6d 1h', resetPrefix: 'Argon Reset Time:' },
      { lang: 'jp', quotaPrefix: 'Argon 残量: 59%', countdownPrefix: 'Argon リセット: 6d 1h', resetPrefix: 'Argon リセット時刻:' }
    ];

    for (const loc of localesR28) {
      const settingsLoc = {
        ui: {
          language: loc.lang,
          footer: {
            labelStyle: "text",
            items: ["quota-argon", "quota-argon-bar", "quota-argon-countdown", "quota-argon-reset-time"]
          }
        }
      };
      const homeLoc = makeTempHome(mockArgonCache, settingsLoc);
      try {
        const resLoc = await runStatusline(metaR27, homeLoc);
        const plainLoc = stripAnsi(resLoc.stdout).trim();
        assert.strictEqual(resLoc.code, 0);
        assert.ok(plainLoc.includes(loc.quotaPrefix), `[${loc.lang}] Should contain "${loc.quotaPrefix}", got: "${plainLoc}"`);
        assert.ok(plainLoc.includes("[█████░░░░░]"), `[${loc.lang}] Should contain auto-merged bar "[█████░░░░░]", got: "${plainLoc}"`);
        assert.ok(plainLoc.includes(loc.countdownPrefix), `[${loc.lang}] Should contain "${loc.countdownPrefix}", got: "${plainLoc}"`);
        assert.ok(plainLoc.includes(loc.resetPrefix), `[${loc.lang}] Should contain "${loc.resetPrefix}", got: "${plainLoc}"`);
      } finally {
        try { rmSync(homeLoc, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
      }
    }

    // Emoji mode E2E test for Argon
    const settingsEmoji = {
      ui: {
        language: "zh-tw",
        footer: {
          labelStyle: "emoji",
          items: ["quota-argon", "quota-argon-bar", "quota-argon-countdown", "quota-argon-reset-time"]
        }
      }
    };
    const homeEmoji = makeTempHome(mockArgonCache, settingsEmoji);
    try {
      const resEmoji = await runStatusline(metaR27, homeEmoji);
      const plainEmoji = stripAnsi(resEmoji.stdout).trim();
      assert.strictEqual(resEmoji.code, 0);
      assert.ok(plainEmoji.includes("✨ 59% [█████░░░░░]"), `Emoji mode should merge quota-argon+bar into "✨ 59% [█████░░░░░]", got: "${plainEmoji}"`);
      assert.ok(plainEmoji.includes("⏱️ "), `Emoji mode should format countdown with "⏱️ ", got: "${plainEmoji}"`);
      assert.ok(plainEmoji.includes("⏰ "), `Emoji mode should format reset-time with "⏰ ", got: "${plainEmoji}"`);
    } finally {
      try { rmSync(homeEmoji, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    console.log("✅ Test R28 passed! Gemini 4 Argon quota, countdown, and rendering work across all 4 locales!");

    // =========================================================================
    // Test R29: Real-time quota sync (Argon meta.quota classification, incomplete meta.quota fallback, state-transition & micro-wait)
    // =========================================================================
    console.log("\n[Test R29] Verifying Argon meta.quota classification, incomplete meta.quota fallback, and state-transition micro-wait...");

    // 1. Unit test: parseMetaQuota classifies gemini-argon-wtu into weekly['gemini-argon-wtu']
    const parsedArgonMeta = parseMetaQuota({
      quota: {
        "gemini-weekly": { remaining_fraction: 0.91, reset_in_seconds: 300000 },
        "gemini-argon-wtu": { remaining_fraction: 0.54, reset_in_seconds: 400000 }
      }
    });
    assert.ok(parsedArgonMeta, "parseMetaQuota must return non-null for weekly + argon");
    assert.ok(parsedArgonMeta.weekly["gemini-argon-wtu"], "gemini-argon-wtu must be classified under weekly");
    assert.strictEqual(Math.round(parsedArgonMeta.weekly["gemini-argon-wtu"].remaining_percentage), 54);
    assert.strictEqual(parsedArgonMeta.shortTerm["gemini-argon-wtu"], undefined, "gemini-argon-wtu must NOT pollute shortTerm");

    // 2. Unit test: mergeQuotaBuckets behavior
    const mergedSameWindow = mergeQuotaBuckets(
      { gemini: { remaining_percentage: 68, reset_time: "2026-10-25T10:00:00Z" } },
      { gemini: { remaining_percentage: 75, reset_time: "2026-10-25T10:00:00Z" } },
      true
    );
    assert.strictEqual(mergedSameWindow.gemini.remaining_percentage, 68, "When freshlyFetchedFromLs=true in same window, lower percentage wins");

    const mergedResetCrossed = mergeQuotaBuckets(
      { gemini: { remaining_percentage: 12, reset_time: "2026-10-25T05:00:00Z" } },
      { gemini: { remaining_percentage: 100, reset_time: "2026-10-25T10:00:00Z" } },
      true
    );
    assert.strictEqual(mergedResetCrossed.gemini.remaining_percentage, 100, "When reset_time advances by >5m, new window (100%) wins");

    // 3. E2E test: Incomplete meta.quota (only gemini-weekly, missing gemini-5h) + state transition (working -> idle) within 2s cooldown
    const settingsR29 = {
      ui: {
        language: "zh-tw",
        footer: {
          items: ["quota", "quota-weekly", "quota-argon"]
        }
      }
    };
    const staleCacheR29 = {
      updatedAt: Date.now() - 3000, // 3 seconds ago (would have been blocked by old 30s cooldown!)
      lsUpdatedAt: Date.now() - 3000,
      lastAgentState: "working",
      lastOutputTokens: 100,
      lastTotalTokens: 1100,
      shortTerm: {
        gemini: { remaining_percentage: 88, refreshes_in: "4h" }
      },
      weekly: {
        gemini: { remaining_percentage: 95, refreshes_in: "6d" },
        "gemini-argon-wtu": { remaining_percentage: 70, refreshes_in: "5d" }
      }
    };
    const homeR29 = makeTempHome(staleCacheR29, settingsR29);
    try {
      // Deploy a mock fetch-local-quota.mjs in tempHome that writes freshly deducted quota (88% -> 62%, Argon 70% -> 51%) in 20ms
      const hooksDirR29 = join(homeR29, '.gemini', 'antigravity-cli', 'hooks');
      mkdirSync(hooksDirR29, { recursive: true });
      const mockUpdaterPath = join(hooksDirR29, 'fetch-local-quota.mjs');
      const targetCacheFile = join(homeR29, '.gemini', 'tmp', 'real_quota_cache.json').replace(/\\/g, '/');
      writeFileSync(mockUpdaterPath, `
import { writeFileSync, readFileSync } from 'fs';
const p = "${targetCacheFile}";
let prev = {};
try { prev = JSON.parse(readFileSync(p, 'utf8')); } catch (_) {}
const now = Date.now();
const next = {
  ...prev,
  updatedAt: now,
  lsUpdatedAt: now,
  shortTerm: {
    gemini: { remaining_percentage: 62, refreshes_in: '3h 50m' }
  },
  weekly: {
    gemini: { remaining_percentage: 91, refreshes_in: '6d' },
    'gemini-argon-wtu': { remaining_percentage: 51, refreshes_in: '5d' }
  }
};
writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
`, 'utf8');

      // Simulate CLI transitioning to 'idle' with only gemini-weekly in meta.quota (missing gemini-5h)
      const metaR29 = {
        model: { display_name: "Gemini 4 Argon (Medium)" },
        agent_state: "idle",
        context_window: { total_input_tokens: 1500, total_output_tokens: 350, context_window_size: 1048576, used_percentage: 0.18 },
        quota: {
          "gemini-weekly": { remaining_fraction: 0.91, reset_in_seconds: 518400 }
        },
        terminal_width: 160
      };

      const resR29 = await runStatusline(metaR29, homeR29);
      const plainR29 = stripAnsi(resR29.stdout).trim();
      console.log("R29 Output:", plainR29);
      assert.strictEqual(resR29.code, 0);
      assert.ok(plainR29.includes("五小時可用: 62%"), `Must render freshly fetched 5h quota (62%) on the spot instead of stale 88%, got: "${plainR29}"`);
      assert.ok(plainR29.includes("七日內可用: 91%"), `Must render updated weekly quota (91%), got: "${plainR29}"`);
      assert.ok(plainR29.includes("Argon 可用: 51%"), `Must render freshly fetched Argon quota (51%), got: "${plainR29}"`);
      console.log("✅ Test R29 passed! (Real-time quota micro-wait and incomplete meta.quota fallback verified)");
    } finally {
      try { rmSync(homeR29, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // =========================================================================
    // Test R30: Fix 100% <-> 99% jumping bug (anti-jitter for 5h, weekly, and argon quota during active conversation)
    // =========================================================================
    console.log("\n[Test R30] Verifying anti-jitter protection across 5h, weekly, and Argon quota during active conversation...");

    // 1. Unit test: mergeQuotaBuckets default preferLowerWhenSameReset=true prevents stale 100% from overwriting 99%
    const unjitteredSameWindow = mergeQuotaBuckets(
      { gemini: { remaining_percentage: 99, reset_time: "2026-10-25T15:00:00Z", refreshes_in: "4h 45m" } },
      { gemini: { remaining_percentage: 100, reset_time: "2026-10-25T15:00:00Z", refreshes_in: "4h 45m" } }
    );
    assert.strictEqual(unjitteredSameWindow.gemini.remaining_percentage, 99, "Lower percentage (99%) MUST win over stale 100% even without 3rd parameter");
    assert.strictEqual(unjitteredSameWindow.gemini.reset_time, "2026-10-25T15:00:00Z");

    // 2. Unit test: mergeQuotaBuckets preserves reset_time when incoming has lower percentage without reset_time
    const incomingLowerNoReset = mergeQuotaBuckets(
      { gemini: { remaining_percentage: 99, reset_time: "2026-10-25T15:00:00Z", refreshes_in: "4h 45m" } },
      { gemini: { remaining_percentage: 97 } }
    );
    assert.strictEqual(incomingLowerNoReset.gemini.remaining_percentage, 97, "Incoming 97% must win over existing 99%");
    assert.strictEqual(incomingLowerNoReset.gemini.reset_time, "2026-10-25T15:00:00Z", "reset_time must not be lost");

    // 3. Unit test: weekly and argon anti-jitter behavior
    const weeklyJitterTest = mergeQuotaBuckets(
      {
        gemini: { remaining_percentage: 93.1, reset_time: "2026-10-31T07:00:00Z" },
        "gemini-argon-wtu": { remaining_percentage: 8.9, reset_time: "2026-10-30T14:00:00Z" }
      },
      {
        gemini: { remaining_percentage: 100, reset_time: "2026-10-31T07:00:00Z" },
        "gemini-argon-wtu": { remaining_percentage: 50, reset_time: "2026-10-30T14:00:00Z" }
      }
    );
    assert.strictEqual(weeklyJitterTest.gemini.remaining_percentage, 93.1, "Weekly lower percentage (93.1%) must win over stale 100%");
    assert.strictEqual(weeklyJitterTest["gemini-argon-wtu"].remaining_percentage, 8.9, "Argon lower percentage (8.9%) must win over stale 50%");

    // 4. E2E test: Active conversation scenario (Conversation ID: e9caef1c reproduction)
    // Stale stdin meta.quota has 100% for 5h and weekly, but local cache has real consumed quota (99%, 93%, 8.9%)
    // Redraw during active working state within rate-limit cooldown (freshlyFetchedFromLs = false)
    const settingsR30 = {
      ui: {
        language: "zh-tw",
        footer: {
          items: ["quota", "quota-weekly", "quota-argon"]
        }
      }
    };
    const future5h = new Date(Date.now() + 17100 * 1000).toISOString();
    const futureWeekly = new Date(Date.now() + 475200 * 1000).toISOString();
    const futureArgon = new Date(Date.now() + 417600 * 1000).toISOString();
    const cacheR30 = {
      updatedAt: Date.now() - 500, // 500ms ago (within 1500ms cooldown)
      lsUpdatedAt: Date.now() - 500,
      lastAgentState: "working",
      lastOutputTokens: 200,
      lastTotalTokens: 1500,
      shortTerm: {
        gemini: { remaining_percentage: 99, reset_time: future5h, refreshes_in: "4h 45m" }
      },
      weekly: {
        gemini: { remaining_percentage: 93, reset_time: futureWeekly, refreshes_in: "5d 12h" },
        "gemini-argon-wtu": { remaining_percentage: 8.9, reset_time: futureArgon, refreshes_in: "4d 20h" }
      }
    };
    const homeR30 = makeTempHome(cacheR30, settingsR30);
    try {
      // Step A: Active conversation frame - CLI passes stale 100% in stdin meta.quota while model is working
      const metaR30Active = {
        conversation_id: "e9caef1c-3cb2-491c-aaee-3f48807ba76a",
        model: { display_name: "Gemini 4 Argon (Medium)" },
        agent_state: "working",
        context_window: { total_input_tokens: 1300, total_output_tokens: 200, context_window_size: 1048576, used_percentage: 0.14 },
        quota: {
          "gemini-5h": { remaining_fraction: 1.0, reset_in_seconds: 17100 },
          "gemini-weekly": { remaining_fraction: 1.0, reset_in_seconds: 475200 }
        },
        terminal_width: 160
      };

      const resR30Active = await runStatusline(metaR30Active, homeR30);
      const plainR30Active = stripAnsi(resR30Active.stdout).trim();
      console.log("R30 Active Output:", plainR30Active);
      assert.strictEqual(resR30Active.code, 0);
      assert.ok(plainR30Active.includes("五小時可用: 99%"), `Must stay at 99% during conversation turn, NOT jump to 100%! Got: "${plainR30Active}"`);
      assert.ok(plainR30Active.includes("七日內可用: 93%"), `Weekly must stay at 93%, NOT jump to 100%! Got: "${plainR30Active}"`);
      assert.ok(plainR30Active.includes("Argon 可用: 9%"), `Argon must stay at 9% (rounded from 8.9%), NOT jump to 100%! Got: "${plainR30Active}"`);

      // Verify the cache on disk was not poisoned with 100%
      const targetCacheFileR30 = join(homeR30, '.gemini', 'tmp', 'real_quota_cache.json');
      const diskCacheContent = JSON.parse(readFileSync(targetCacheFileR30, 'utf8'));
      assert.strictEqual(diskCacheContent.shortTerm.gemini.remaining_percentage, 99, "Disk cache shortTerm must remain 99%");
      assert.strictEqual(diskCacheContent.weekly.gemini.remaining_percentage, 93, "Disk cache weekly must remain 93%");
      assert.strictEqual(diskCacheContent.weekly["gemini-argon-wtu"].remaining_percentage, 8.9, "Disk cache Argon must remain 8.9%");

      // Step B: Conversation finishes - CLI updates to 97% and agent becomes idle
      const metaR30Finished = {
        conversation_id: "e9caef1c-3cb2-491c-aaee-3f48807ba76a",
        model: { display_name: "Gemini 4 Argon (Medium)" },
        agent_state: "idle",
        context_window: { total_input_tokens: 1300, total_output_tokens: 450, context_window_size: 1048576, used_percentage: 0.17 },
        quota: {
          "gemini-5h": { remaining_fraction: 0.97, reset_in_seconds: 17000 },
          "gemini-weekly": { remaining_fraction: 0.93, reset_in_seconds: 475100 }
        },
        terminal_width: 160
      };

      const resR30Finished = await runStatusline(metaR30Finished, homeR30);
      const plainR30Finished = stripAnsi(resR30Finished.stdout).trim();
      console.log("R30 Finished Output:", plainR30Finished);
      assert.strictEqual(resR30Finished.code, 0);
      assert.ok(plainR30Finished.includes("五小時可用: 97%"), `Must update to 97% when conversation finishes! Got: "${plainR30Finished}"`);
      assert.ok(plainR30Finished.includes("七日內可用: 93%"), `Weekly remains 93%! Got: "${plainR30Finished}"`);
      assert.ok(plainR30Finished.includes("Argon 可用: 9%"), `Argon remains 9%! Got: "${plainR30Finished}"`);

      // Step C: Subsequent frame with stale meta - must STAY at 97% and never jump back
      const metaR30Followup = {
        conversation_id: "e9caef1c-3cb2-491c-aaee-3f48807ba76a",
        model: { display_name: "Gemini 4 Argon (Medium)" },
        agent_state: "idle",
        context_window: { total_input_tokens: 1300, total_output_tokens: 450, context_window_size: 1048576, used_percentage: 0.17 },
        quota: {
          "gemini-5h": { remaining_fraction: 0.99, reset_in_seconds: 16900 } // stale higher value
        },
        terminal_width: 160
      };
      const resR30Followup = await runStatusline(metaR30Followup, homeR30);
      const plainR30Followup = stripAnsi(resR30Followup.stdout).trim();
      assert.strictEqual(resR30Followup.code, 0);
      assert.ok(plainR30Followup.includes("五小時可用: 97%"), `Must stay at 97% and NEVER jump back to 99%! Got: "${plainR30Followup}"`);

      console.log("✅ Test R30 passed! Anti-jitter protection across 5h, weekly, and Argon quota verified.");
    } finally {
      try { rmSync(homeR30, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // ----------------------------------------------------
    // Test Case R31: Drift beyond 5 minutes in long conversation & expired reset window recovery
    // ----------------------------------------------------
    console.log("\n[Test R31] Verifying 6-minute dialogue drift anti-jitter and expired window recovery...");
    const nowR31 = Date.now();

    // 1. Long active dialogue: 6 minutes (360 seconds) elapsed. Stdin passes stale 100% with shifted reset_time
    const existingActiveShort = {
      gemini: { remaining_percentage: 99, reset_time: new Date(nowR31 + 17100 * 1000).toISOString() }
    };
    const incomingDrifted6Min = {
      gemini: { remaining_percentage: 100, reset_time: new Date(nowR31 + (17100 + 360) * 1000).toISOString() }
    };
    const driftedMergeRes = mergeQuotaBuckets(existingActiveShort, incomingDrifted6Min, true);
    assert.strictEqual(driftedMergeRes.gemini.remaining_percentage, 99, "Must stay at 99% after 6-minute dialogue drift (should NOT jump back to 100%!)");

    // 2. Weekly & Argon drift during long conversation (15 minutes drift)
    const existingWeekly = {
      gemini: { remaining_percentage: 93, reset_time: new Date(nowR31 + 475200 * 1000).toISOString() },
      "gemini-argon-wtu": { remaining_percentage: 8.9, reset_time: new Date(nowR31 + 417600 * 1000).toISOString() }
    };
    const incomingWeeklyDrifted = {
      gemini: { remaining_percentage: 100, reset_time: new Date(nowR31 + (475200 + 900) * 1000).toISOString() },
      "gemini-argon-wtu": { remaining_percentage: 100, reset_time: new Date(nowR31 + (417600 + 900) * 1000).toISOString() }
    };
    const weeklyDriftRes = mergeQuotaBuckets(existingWeekly, incomingWeeklyDrifted, true);
    assert.strictEqual(weeklyDriftRes.gemini.remaining_percentage, 93, "Weekly quota must remain at 93% despite 15m dialogue drift");
    assert.strictEqual(weeklyDriftRes["gemini-argon-wtu"].remaining_percentage, 8.9, "Argon quota must remain at 8.9% despite 15m dialogue drift");

    // 3. Expired quota window (reset_time was 2 minutes ago)
    const expiredOldWindow = {
      gemini: { remaining_percentage: 12, reset_time: new Date(nowR31 - 120000).toISOString() }
    };
    const freshNewWindow100 = {
      gemini: { remaining_percentage: 100, reset_time: new Date(nowR31 + 18000 * 1000).toISOString() }
    };
    const expiredRecoveryRes = mergeQuotaBuckets(expiredOldWindow, freshNewWindow100, true);
    assert.strictEqual(expiredRecoveryRes.gemini.remaining_percentage, 100, "100% fresh quota must supersede expired 12% window");

    // 4. Expired quota window when incoming lacks reset_time
    const freshNewWindowNoTimestamp = {
      gemini: { remaining_percentage: 100 }
    };
    const expiredNoTsRecoveryRes = mergeQuotaBuckets(expiredOldWindow, freshNewWindowNoTimestamp, true);
    assert.strictEqual(expiredNoTsRecoveryRes.gemini.remaining_percentage, 100, "100% fresh quota without timestamp must supersede expired 12% window");

    console.log("✅ Test R31 passed! 6-minute dialogue drift anti-jitter and expired window recovery verified.");

    // ----------------------------------------------------
    // Test Case R32: 40-minute ultra-long dialogue drift, dynamic countdown recalculation, and cache aging auto-update in main()
    // ----------------------------------------------------
    console.log("\n[Test R32] Verifying 40-minute dialogue drift, dynamic countdown recalculation, and cache aging auto-update in main()...");
    const nowR32 = Date.now();

    // 1. 40-minute dialogue drift (2400 seconds) in 5-hour quota: must stay at 99%, NOT jump back to 100%
    const existingActive40Min = {
      gemini: {
        remaining_percentage: 99,
        reset_time: new Date(nowR32 + 17100 * 1000).toISOString(),
        refreshes_in: "4h 45m"
      }
    };
    const incomingDrifted40Min = {
      gemini: {
        remaining_percentage: 100,
        reset_time: new Date(nowR32 + (17100 + 2400) * 1000).toISOString(),
        refreshes_in: "5h 25m"
      }
    };
    const drift40MinRes = mergeQuotaBuckets(existingActive40Min, incomingDrifted40Min, true);
    assert.strictEqual(drift40MinRes.gemini.remaining_percentage, 99, "Must stay at 99% after 40-minute dialogue drift (windowThresholdMs=2h protects against jumping back to 100%)");

    // 2. Genuinely new window (>2 hours advance, e.g. 2.5 hours = 9000 seconds) supersedes existing window
    const incomingNewWindow = {
      gemini: {
        remaining_percentage: 100,
        reset_time: new Date(nowR32 + (17100 + 9000) * 1000).toISOString(),
        refreshes_in: "7h 15m"
      }
    };
    const newWindowRes = mergeQuotaBuckets(existingActive40Min, incomingNewWindow, true);
    assert.strictEqual(newWindowRes.gemini.remaining_percentage, 100, "Genuine new cycle (>2h advance) must supersede old window with 100%");

    // 3. Dynamic countdown recalculation: refreshes_in must be dynamically computed from reset_time rather than frozen at stale string
    const targetResetTime1h = new Date(nowR32 + 3600 * 1000).toISOString();
    const staleEntryWithOldCountdown = {
      gemini: {
        remaining_percentage: 97,
        reset_time: targetResetTime1h,
        refreshes_in: "4h 59m" // stale countdown from 4 hours ago
      }
    };
    const incomingSameWindow = {
      gemini: {
        remaining_percentage: 100,
        reset_time: targetResetTime1h
      }
    };
    const dynamicCountdownRes = mergeQuotaBuckets(staleEntryWithOldCountdown, incomingSameWindow, true);
    assert.strictEqual(dynamicCountdownRes.gemini.remaining_percentage, 97);
    assert.strictEqual(dynamicCountdownRes.gemini.refreshes_in, "1h", "refreshes_in must be dynamically recalculated to '1h', NOT frozen at '4h 59m'");

    // 4. Invalid reset_time format defensively returns empty string in formatResetTime
    assert.strictEqual(formatResetTime(''), '');
    assert.strictEqual(formatResetTime(null), '');
    assert.strictEqual(formatResetTime(undefined), '');
    assert.strictEqual(formatResetTime(true), '');
    assert.strictEqual(formatResetTime(false), '');
    assert.strictEqual(formatResetTime([]), '');
    assert.strictEqual(formatResetTime('not-a-valid-date'), '');

    // 4b. Gemini weekly quota (pool = 'gemini', window = 'weekly'): 3-hour drift must NOT jump to 100%
    const baseWeeklyR32 = {
      gemini: { remaining_percentage: 93, reset_time: new Date(nowR32 + 500000 * 1000).toISOString(), window: 'weekly' }
    };
    const driftedWeeklyR32_3h = {
      gemini: { remaining_percentage: 100, reset_time: new Date(nowR32 + (500000 + 10800) * 1000).toISOString(), window: 'weekly' }
    };
    const weeklyDrift3hRes = mergeQuotaBuckets(baseWeeklyR32, driftedWeeklyR32_3h, true);
    assert.strictEqual(weeklyDrift3hRes.gemini.remaining_percentage, 93, "Gemini weekly quota with stripped pool must use 24h threshold and stay at 93% after 3h drift");

    // 5. E2E: Stale cache (>15s age) auto-triggers background update even when meta.quota is complete and state/tokens have not changed
    const settingsR32 = {
      ui: {
        language: "zh-tw",
        footer: { items: ["quota", "quota-weekly"] }
      }
    };
    const staleCacheR32 = {
      updatedAt: Date.now() - 25000, // 25 seconds ago (isCacheStale: true)
      lsUpdatedAt: Date.now() - 25000,
      lastAgentState: "idle",
      lastOutputTokens: 200,
      lastTotalTokens: 1200,
      shortTerm: {
        gemini: { remaining_percentage: 100, refreshes_in: "5h" }
      },
      weekly: {
        gemini: { remaining_percentage: 95, refreshes_in: "6d" }
      }
    };
    const homeR32 = makeTempHome(staleCacheR32, settingsR32);
    try {
      const hooksDirR32 = join(homeR32, '.gemini', 'antigravity-cli', 'hooks');
      mkdirSync(hooksDirR32, { recursive: true });
      const mockUpdaterPathR32 = join(hooksDirR32, 'fetch-local-quota.mjs');
      const targetCacheFileR32 = join(homeR32, '.gemini', 'tmp', 'real_quota_cache.json').replace(/\\/g, '/');
      writeFileSync(mockUpdaterPathR32, `
import { writeFileSync, readFileSync } from 'fs';
const p = "${targetCacheFileR32}";
let prev = {};
try { prev = JSON.parse(readFileSync(p, 'utf8')); } catch (_) {}
const now = Date.now();
const next = {
  ...prev,
  updatedAt: now,
  lsUpdatedAt: now,
  shortTerm: {
    gemini: { remaining_percentage: 77, refreshes_in: '4h 10m' }
  },
  weekly: {
    gemini: { remaining_percentage: 92, refreshes_in: '5d 20h' }
  }
};
writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
`, 'utf8');

      // Complete meta.quota with identical state (idle) and unchanged tokens
      const metaR32 = {
        model: { display_name: "Gemini 3.5 Flash" },
        agent_state: "idle",
        context_window: { total_input_tokens: 1000, total_output_tokens: 200, context_window_size: 1048576, used_percentage: 0.12 },
        quota: {
          "gemini-5h": { remaining_fraction: 1.0, reset_in_seconds: 18000 },
          "gemini-weekly": { remaining_fraction: 0.95, reset_in_seconds: 518400 }
        },
        terminal_width: 160
      };

      const resR32 = await runStatusline(metaR32, homeR32);
      const plainR32 = stripAnsi(resR32.stdout).trim();
      console.log("R32 Output:", plainR32);
      assert.strictEqual(resR32.code, 0);
      assert.ok(plainR32.includes("五小時可用: 77%"), `Must trigger background update on cache aging and render fresh 77%! Got: "${plainR32}"`);
      assert.ok(plainR32.includes("七日內可用: 92%"), `Weekly must update to fresh 92%! Got: "${plainR32}"`);
      console.log("✅ Test R32 passed! (40-minute drift, countdown dynamic recalculation, and cache aging auto-update verified)");
    } finally {
      try { rmSync(homeR32, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

    // =========================================================================
    // Test Case R33: 256.0k Compaction Threshold & Step-Up Auto-Unlock Architecture
    // =========================================================================
    console.log("\n[Test R33] Verifying 256.0k compaction threshold, independent alert color, Claude 200k preservation, step-up auto-unlock, and tokenCeiling overrides...");

    // (1) 預設 256.0k 門檻與四國語系渲染 (zh-tw, zh-cn, us, jp)
    const langExpectationsR33 = [
      { lang: 'zh-tw', expectedLabel: '權杖數: 47.4k / 256.0k' },
      { lang: 'zh-cn', expectedLabel: '令牌数: 47.4k / 256.0k' },
      { lang: 'us',    expectedLabel: 'Tokens: 47.4k / 256.0k' },
      { lang: 'jp',    expectedLabel: 'トークン: 47.4k / 256.0k' }
    ];

    for (const { lang, expectedLabel } of langExpectationsR33) {
      const homeR33Lang = makeTempHome({}, {
        ui: {
          language: lang,
          footer: { items: ['token-count'] }
        }
      });
      try {
        const metaR33Lang = {
          model: { display_name: "Gemini 3.5 Flash" },
          context_window: {
            total_input_tokens: 47400,
            context_window_size: 1048576
          },
          terminal_width: 120
        };
        const res = await runStatusline(metaR33Lang, homeR33Lang);
        assert.strictEqual(res.code, 0);
        const plain = stripAnsi(res.stdout);
        assert.ok(plain.includes(expectedLabel), `Language '${lang}' must render '${expectedLabel}', got: "${plain.trim()}"`);
      } finally {
        try { rmSync(homeR33Lang, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
      }
    }
    console.log("  -> Subtest 1 passed: Default 256.0k threshold renders across all 4 languages.");

    // (2) 獨立預警顏色（200K 時為紅色警示而非 1.0M 的富藍色）
    const metaR33_200k = {
      model: { display_name: "Gemini 3.5 Flash" },
      context_window: {
        total_input_tokens: 200000, // 200k out of 256k = 78.1% used -> 21.9% remain (<25% -> RED)
        context_window_size: 1048576 // 200k out of 1.0M = 19.1% used -> 80.9% remain (>=75% -> BLUE)
      }
    };
    // Direct calls in Subtests 2, 3 and 6 write ctx_*.json under os.homedir(), so they run in a sandbox home
    const homeR33_Direct = makeTempHome({}, {});
    const ctxInfoR33_200k = await withHomeEnv(homeR33_Direct, () => calculateContextUsageAsync(metaR33_200k, 'r33_200k_test'));
    assert.strictEqual(ctxInfoR33_200k.effectiveTokenCeiling, 256000);
    const metricsR33_200k = await withHomeEnv(homeR33_Direct, () => extractMetricsAsync(
      metaR33_200k, 'zh-tw', 'Gemini 3.5 Flash', null, {}, {}, ctxInfoR33_200k, { remaining_percentage: 100, refreshes_in: '' }, { barLength: 10, footerItems: ['token-count', 'context-used'] }
    ));
    // Context is based on 1.0M physical window -> remain > 75% -> BLUE
    assert.strictEqual(metricsR33_200k.contextColor, "\x1b[38;2;87;202;255m", "Context color must remain BLUE (80.9% remaining of 1.0M)");
    // Token is based on 256k compaction threshold -> remain < 25% -> RED
    assert.strictEqual(metricsR33_200k.tokenColor, "\x1b[38;2;255;125;175m", "Token color must be RED (<25% remaining of 256.0k)");
    assert.ok(metricsR33_200k.tokenCount.includes("\x1b[38;2;255;125;175m200.0k"), "tokenCount must render with RED warning prefix");
    assert.ok(metricsR33_200k.tokenCount.includes("/ 256.0k"), "tokenCount must show / 256.0k");
    console.log("  -> Subtest 2 passed: Independent alert color (200k triggers RED for tokens, while context remains BLUE).");

    // (3) 小視窗模型（Claude 200.0k）不放大
    const metaR33_Claude = {
      model: { display_name: "Claude 3.5 Sonnet" },
      context_window: {
        total_input_tokens: 50000,
        context_window_size: 200000
      }
    };
    const ctxInfoR33_Claude = await withHomeEnv(homeR33_Direct, () => calculateContextUsageAsync(metaR33_Claude, 'r33_claude_test'));
    assert.strictEqual(ctxInfoR33_Claude.effectiveTokenCeiling, 200000, "Claude 200k context size must NOT be enlarged to 256k");
    const homeR33_Claude = makeTempHome({}, {
      ui: {
        language: 'zh-tw',
        footer: { items: ['token-count'] }
      }
    });
    try {
      const resClaude = await runStatusline(metaR33_Claude, homeR33_Claude);
      assert.strictEqual(resClaude.code, 0);
      const plainClaude = stripAnsi(resClaude.stdout);
      assert.ok(plainClaude.includes("50.0k / 200.0k"), `Must render / 200.0k without enlarging to 256k! Got: "${plainClaude.trim()}"`);
      assert.ok(!plainClaude.includes("256.0k"), "Must not mention 256.0k for Claude 200k");
    } finally {
      try { rmSync(homeR33_Claude, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }
    console.log("  -> Subtest 3 passed: Small window model (Claude 200.0k) is preserved and not enlarged.");

    // (4) 方案 B：離線無快取時退回 256k 基準＋單一模型／單一對話破頂步進自癒（256k -> 512k -> 1.0M），不跨模型污染，且無視舊版 unlockedVersions
    const homeR33_StepUp = makeTempHome({}, {
      ui: {
        language: 'zh-tw',
        footer: { items: ['token-count+bar'] }
      }
    });
    try {
      // 先預埋舊版 unlockedVersions，確認新版徹底無視之
      const stateFilePath = join(homeR33_StepUp, '.gemini', 'tmp', 'compaction_ceiling_state.json');
      writeFileSync(stateFilePath, JSON.stringify({
        unlockedVersions: { "1.5.9": true, "1.5.10": true, "1.11.0": true }
      }, null, 2), 'utf8');

      // 4A: 剛開局 1.0k (同在 legacy unlockedVersions 中) 必須仍為 256.0k
      const resLegacyIgnored = await runStatusline({
        version: "1.5.10",
        conversation_id: "conv-r33-legacy-ignored",
        model: { id: "Gemini 3.8 Flash (High)", display_name: "Gemini 3.8 Flash (High)" },
        context_window: { total_input_tokens: 1000, context_window_size: 1048576 },
        terminal_width: 120
      }, homeR33_StepUp);
      assert.strictEqual(resLegacyIgnored.code, 0);
      assert.ok(stripAnsi(resLegacyIgnored.stdout).includes("1.0k / 256.0k"), `Legacy unlockedVersions must be ignored! Got: "${stripAnsi(resLegacyIgnored.stdout).trim()}"`);

      // 4B: 第一個對話突破 256k 門檻 (totalInput = 300,000) -> 步進至 512.0k（非直接鎖死 1.0M）
      const metaR33_OverCeiling = {
        version: "1.5.10",
        conversation_id: "conv-r33-session-1",
        model: { id: "Gemini 4 Hydrogen (Medium)", display_name: "Gemini 4 Hydrogen (Medium)" },
        context_window: {
          total_input_tokens: 300000,
          context_window_size: 1048576
        },
        terminal_width: 120
      };
      const resOver = await runStatusline(metaR33_OverCeiling, homeR33_StepUp);
      assert.strictEqual(resOver.code, 0);
      const plainOver = stripAnsi(resOver.stdout);
      assert.ok(plainOver.includes("300.0k / 512.0k"), `Must step up to / 512.0k on 300k tokens! Got: "${plainOver.trim()}"`);
      assert.ok(!plainOver.includes("[██████████]"), `Progress bar must NOT be stuck at 100%! Got: "${plainOver.trim()}"`);

      const parsedState = JSON.parse(readFileSync(stateFilePath, 'utf8'));
      assert.strictEqual(parsedState.unlockedVersions, undefined, "Legacy unlockedVersions must not be retained");
      assert.strictEqual(parsedState.modelCeilings?.gemini4hydrogenmedium, 512000, "Per-model ceiling 512000 must be recorded under modelCeilings");

      // 4C: 同模型新對話 (1,000 tokens) 繼承該模型 512.0k；同 CLI 版本另一模型 (Gemini 3.8 Flash) 不受影響維持 256.0k
      const resSameModel = await runStatusline({
        version: "1.5.10",
        conversation_id: "conv-r33-session-2-same-model",
        model: { id: "Gemini 4 Hydrogen (Medium)", display_name: "Gemini 4 Hydrogen (Medium)" },
        context_window: { total_input_tokens: 1000, context_window_size: 1048576 },
        terminal_width: 120
      }, homeR33_StepUp);
      assert.ok(stripAnsi(resSameModel.stdout).includes("1.0k / 512.0k"), `Same model must inherit 512.0k! Got: "${stripAnsi(resSameModel.stdout).trim()}"`);

      const resOtherModel = await runStatusline({
        version: "1.5.10",
        conversation_id: "conv-r33-session-3-other-model",
        model: { id: "Gemini 3.8 Flash (High)", display_name: "Gemini 3.8 Flash (High)" },
        context_window: { total_input_tokens: 1000, context_window_size: 1048576 },
        terminal_width: 120
      }, homeR33_StepUp);
      assert.ok(stripAnsi(resOtherModel.stdout).includes("1.0k / 256.0k"), `Other model on same CLI version must stay at 256.0k! Got: "${stripAnsi(resOtherModel.stdout).trim()}"`);

      // 4D: 單一極端對話超過 512k (600,000) -> 僅該對話步進至 1.0M，不將模型跨對話上限鎖死為 1.0M
      const resOutlier = await runStatusline({
        version: "1.5.10",
        conversation_id: "conv-r33-session-4-outlier",
        model: { id: "Gemini 4 Hydrogen (Medium)", display_name: "Gemini 4 Hydrogen (Medium)" },
        context_window: { total_input_tokens: 600000, context_window_size: 1048576 },
        terminal_width: 120
      }, homeR33_StepUp);
      assert.ok(stripAnsi(resOutlier.stdout).includes("600.0k / 1.0M"), `Outlier >512k conversation must step up to 1.0M! Got: "${stripAnsi(resOutlier.stdout).trim()}"`);

      const resFreshHydrogen = await runStatusline({
        version: "1.5.10",
        conversation_id: "conv-r33-session-5-fresh",
        model: { id: "Gemini 4 Hydrogen (Medium)", display_name: "Gemini 4 Hydrogen (Medium)" },
        context_window: { total_input_tokens: 1000, context_window_size: 1048576 },
        terminal_width: 120
      }, homeR33_StepUp);
      assert.ok(stripAnsi(resFreshHydrogen.stdout).includes("1.0k / 512.0k"), `Fresh Hydrogen conversation must stay at 512.0k, NOT poisoned to 1.0M! Got: "${stripAnsi(resFreshHydrogen.stdout).trim()}"`);
    } finally {
      try { rmSync(homeR33_StepUp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }
    console.log("  -> Subtest 4 passed: Per-model / per-conversation step-up (256k -> 512k -> 1.0M) verified without cross-model pollution.");

    // (5) 外部設定檔 tokenCeiling 覆寫與原生欄位嗅探
    // 5A: ui.footer.tokenCeiling = "model"
    const homeR33_ConfigModel = makeTempHome({}, {
      ui: {
        footer: {
          items: ['token-count'],
          tokenCeiling: "model"
        }
      }
    });
    try {
      const metaR33_Cfg = {
        model: { display_name: "Gemini 3.5 Flash" },
        context_window: { total_input_tokens: 1000, context_window_size: 1048576 },
        terminal_width: 120
      };
      const res = await runStatusline(metaR33_Cfg, homeR33_ConfigModel);
      assert.strictEqual(res.code, 0);
      const plain = stripAnsi(res.stdout);
      assert.ok(plain.includes("1.0k / 1.0M"), `tokenCeiling='model' must force 1.0M ceiling! Got: "${plain.trim()}"`);
    } finally {
      try { rmSync(homeR33_ConfigModel, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }

    // 5B: ui.footer.tokenCeiling = 512000
    const homeR33_ConfigNum = makeTempHome({}, {
      ui: {
        footer: {
          items: ['token-count'],
          tokenCeiling: 512000
        }
      }
    });
    try {
      const metaR33_CfgNum = {
        model: { display_name: "Gemini 3.5 Flash" },
        context_window: { total_input_tokens: 1000, context_window_size: 1048576 },
        terminal_width: 120
      };
      const res = await runStatusline(metaR33_CfgNum, homeR33_ConfigNum);
      assert.strictEqual(res.code, 0);
      const plain = stripAnsi(res.stdout);
      assert.ok(plain.includes("1.0k / 512.0k"), `tokenCeiling=512000 must render 512.0k ceiling! Got: "${plain.trim()}"`);
    } finally {
      try { rmSync(homeR33_ConfigNum, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }

    // 5C: 原生擴充欄位嗅探 (compaction_threshold, compaction_token_limit, compact_threshold, effective_context_window_size)
    const nativeFieldsToTest = [
      { field: 'compaction_threshold', val: 300000, expected: '300.0k' },
      { field: 'compaction_token_limit', val: 400000, expected: '400.0k' },
      { field: 'compact_threshold', val: 350000, expected: '350.0k' },
      { field: 'effective_context_window_size', val: 600000, expected: '600.0k' }
    ];

    for (const { field, val, expected } of nativeFieldsToTest) {
      const homeR33_Native = makeTempHome({}, {
        ui: {
          footer: { items: ['token-count'] }
        }
      });
      try {
        const metaNative = {
          model: { display_name: "Gemini 3.5 Flash" },
          context_window: {
            total_input_tokens: 1000,
            context_window_size: 1048576,
            [field]: val
          },
          terminal_width: 120
        };
        const res = await runStatusline(metaNative, homeR33_Native);
        assert.strictEqual(res.code, 0);
        const plain = stripAnsi(res.stdout);
        assert.ok(plain.includes(`1.0k / ${expected}`), `Native field '${field}' must be sniffed and render / ${expected}, got: "${plain.trim()}"`);
      } finally {
        try { rmSync(homeR33_Native, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
      }
    }
    console.log("  -> Subtest 5 passed: External tokenCeiling settings override and native field sniffing verified.");

    // (6) 跨輪次快取維持原生嗅探上限、字串單位解析與負數設定值防禦退讓
    // 6A: 跨輪次快取保存 native limit（如 compaction_token_limit: 400000）
    const metaR33_Turn1 = {
      conversation_id: 'conv-r33-turn-cache',
      context_window: { total_input_tokens: 50000, context_window_size: 1048576, compaction_token_limit: 400000 }
    };
    const ctxTurn1 = await withHomeEnv(homeR33_Direct, () => calculateContextUsageAsync(metaR33_Turn1, 'conv-r33-turn-cache'));
    assert.strictEqual(ctxTurn1.effectiveTokenCeiling, 400000, "Turn 1 must sniff compaction_token_limit = 400k");

    const metaR33_Turn2 = {
      conversation_id: 'conv-r33-turn-cache',
      context_window: { total_input_tokens: 0, total_output_tokens: 0 }
    };
    const ctxTurn2 = await withHomeEnv(homeR33_Direct, () => calculateContextUsageAsync(metaR33_Turn2, 'conv-r33-turn-cache'));
    assert.strictEqual(ctxTurn2.effectiveTokenCeiling, 400000, "Turn 2 (idle) must restore sniffed 400k from ctx cache");

    // 6B: 原生欄位字串後綴 (如 "400k", "1m")
    const metaR33_StrLimit = {
      conversation_id: 'conv-r33-str-limit',
      context_window: { total_input_tokens: 1000, context_window_size: 1048576, compact_threshold: '400k' }
    };
    const ctxStrLimit = await withHomeEnv(homeR33_Direct, () => calculateContextUsageAsync(metaR33_StrLimit, 'conv-r33-str-limit'));
    assert.strictEqual(ctxStrLimit.effectiveTokenCeiling, 400000, "compact_threshold='400k' string must parse to 400000");

    // 6C: 負數與無效設定值防禦退讓
    const metaR33_Neg = {
      conversation_id: 'conv-r33-neg',
      context_window: { total_input_tokens: 1000, context_window_size: 1048576 }
    };
    const ctxNeg = await withHomeEnv(homeR33_Direct, () => calculateContextUsageAsync(metaR33_Neg, 'conv-r33-neg', { ui: { footer: { tokenCeiling: -100 } } }));
    assert.strictEqual(ctxNeg.effectiveTokenCeiling, 256000, "Negative tokenCeiling must safely fall back to 256k");

    const metricsNeg = await withHomeEnv(homeR33_Direct, () => extractMetricsAsync(
      metaR33_Neg, 'zh-tw', 'Gemini 3.5 Flash', null, {}, {}, ctxNeg, { remaining_percentage: 100, refreshes_in: '' }, { barLength: 10, footerItems: ['token-count'] }
    ));
    assert.ok(metricsNeg.tokenCount.includes("/ 256.0k"), "tokenCount must safely fall back to / 256.0k on negative config");
    try { rmSync(homeR33_Direct, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    console.log("  -> Subtest 6 passed: Cross-turn cache persistence, string unit sniffing, and negative setting guards verified.");

    // (7) 高並發 20 個模型同時寫入狀態檔原子性、既有屬性保留與清理舊版 unlockedVersions
    const homeR33_Conc = makeTempHome({}, {});
    try {
      const statePathConc = join(homeR33_Conc, '.gemini', 'tmp', 'compaction_ceiling_state.json');
      mkdirSync(join(homeR33_Conc, '.gemini', 'tmp'), { recursive: true });
      writeFileSync(statePathConc, JSON.stringify({ existingProp: "preserved", unlockedVersions: { "1.5.9": true } }), 'utf8');

      await withHomeEnv(homeR33_Conc, async () => {
        const concPromises = [];
        for (let i = 0; i < 20; i++) {
          const metaConc = {
            version: `2.0.${i}`,
            conversation_id: `conv-conc-${i}`,
            model: { display_name: `Test Model ${i}` },
            context_window: { total_input_tokens: 300000, context_window_size: 1048576 }
          };
          concPromises.push(calculateContextUsageAsync(metaConc, `conv-conc-${i}`));
        }
        await Promise.all(concPromises);

        const savedContent = readFileSync(statePathConc, 'utf8');
        const parsedSaved = JSON.parse(savedContent);
        assert.strictEqual(parsedSaved.existingProp, "preserved", "Existing properties must be preserved during concurrent writes");
        assert.strictEqual(parsedSaved.unlockedVersions, undefined, "Legacy unlockedVersions must be stripped when rewriting state");
        const modelCount = Object.keys(parsedSaved.modelCeilings || {}).length;
        assert.strictEqual(modelCount, 20, `All 20 concurrent models must be recorded! Got: ${modelCount}`);
      });
    } finally {
      try { rmSync(homeR33_Conc, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }
    console.log("  -> Subtest 7 passed: High concurrency (20 parallel models) atomic writes and metadata preservation verified.");

    // (8) Layer 1 環境變數覆寫 (AGY_TOKEN_CEILING 與 AGY_CLI_AUTO_COMPACT_OVERRIDE 百分比/數值)
    assert.strictEqual(parseCeilingValue('50%', 1000000, true), 500000);
    assert.strictEqual(parseCeilingValue('50%', 1000000, false), null);
    assert.strictEqual(parseCeilingValue('-50', 1000000, true), null);
    assert.deepStrictEqual(
      extractModelCandidateKeys({ model: { id: 'Gemini 4 Argon (Medium)', display_name: 'Gemini 4 Argon (Medium)' } }),
      ['gemini4argonmedium']
    );
    assert.strictEqual(computeSteppedCeiling(300000, 1048576, 256000), STEP_UP_INTERMEDIATE_THRESHOLD);

    const homeR33_Env = makeTempHome({}, {
      ui: { language: 'zh-tw', footer: { items: ['token-count'] } }
    });
    try {
      const metaR33_Env = {
        conversation_id: 'conv-r33-env',
        model: { id: 'Gemini 3.8 Flash (High)', display_name: 'Gemini 3.8 Flash (High)' },
        context_window: { total_input_tokens: 1000, context_window_size: 1048576 },
        terminal_width: 120
      };
      const resAgyToken = await runStatusline(metaR33_Env, homeR33_Env, SCRIPT_PATH, { AGY_TOKEN_CEILING: '512k' });
      assert.ok(stripAnsi(resAgyToken.stdout).includes('1.0k / 512.0k'), `AGY_TOKEN_CEILING=512k failed: ${resAgyToken.stdout}`);

      const resCompactPct = await runStatusline(metaR33_Env, homeR33_Env, SCRIPT_PATH, {
        AGY_TOKEN_CEILING: '',
        AGY_CLI_AUTO_COMPACT_OVERRIDE: '50%'
      });
      assert.ok(stripAnsi(resCompactPct.stdout).includes('1.0k / 524.3k'), `AGY_CLI_AUTO_COMPACT_OVERRIDE=50% of 1048576 failed: ${resCompactPct.stdout}`);
    } finally {
      try { rmSync(homeR33_Env, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }
    console.log("  -> Subtest 8 passed: AGY_TOKEN_CEILING & AGY_CLI_AUTO_COMPACT_OVERRIDE overrides verified.");

    // (9) Layer 3 動態模型目錄對照 (GetAvailableModels 快取) 與 /model 即時切換（含僅設定 token-count 且 meta.model.id === display_name）
    const catalogLimits = {
      gemini4argonmedium: { limit: 512000, maxTokens: 1048576, slug: 'gemini-4-argon-medium', displayName: 'Gemini 4 Argon (Medium)' },
      gemini4carbon: { limit: 512000, maxTokens: 1048576, slug: 'gemini-4-carbon-disabled', displayName: 'Gemini 4 Carbon' },
      gemini4hydrogenhigh: { limit: 512000, maxTokens: 1048576, slug: 'gemini-4-hydrogen-high', displayName: 'Gemini 4 Hydrogen (High)' },
      gemini38flashhigh: { limit: 256000, maxTokens: 1048576, slug: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)' },
      gemini38flashtiered: { limit: 256000, maxTokens: 1048576, slug: 'gemini-3.8-flash-tiered', displayName: '' },
      modelplaceholderm322: { limit: 256000, maxTokens: 1048576, slug: 'gemini-3.8-flash-tiered', displayName: '' },
      gemini35flashlite: { limit: 128000, maxTokens: 1048576, slug: 'gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash Lite' },
      gptoss120bmedium: { limit: 80000, maxTokens: 131072, slug: 'gpt-oss-120b-medium', displayName: 'GPT-OSS 120B (Medium)' },
      orchestratorargon: { limit: 512000, maxTokens: 1048576, slug: 'gemini-pro-orchestrator-g1-pro', displayName: 'Orchestrator (Argon)' },
      sharedlabel: { limit: 0, maxTokens: 1048576, ambiguous: true }
    };
    const homeR33_Catalog = makeTempHome({
      updatedAt: Date.now(),
      lsUpdatedAt: Date.now(),
      modelLimitsUpdatedAt: Date.now(),
      modelLimits: catalogLimits
    }, {
      ui: { language: 'zh-tw', footer: { items: ['token-count'] } } // Deliberately NO quota items!
    });
    try {
      const modelExpectations = [
        { id: 'Gemini 4 Argon (Medium)', display_name: 'Gemini 4 Argon (Medium)', expected: '0 / 512.0k' },
        { id: 'Gemini 3.8 Flash (High)', display_name: 'Gemini 3.8 Flash (High)', expected: '0 / 256.0k' },
        { id: 'Gemini 4 Carbon', display_name: 'Gemini 4 Carbon', expected: '0 / 512.0k' },
        { id: 'Gemini 4 Hydrogen (High)', display_name: 'Gemini 4 Hydrogen (High)', expected: '0 / 512.0k' },
        { id: 'Gemini 3.5 Flash Lite', display_name: 'Gemini 3.5 Flash Lite', expected: '0 / 128.0k' },
        { id: 'GPT-OSS 120B (Medium)', display_name: 'GPT-OSS 120B (Medium)', expected: '0 / 80.0k' },
        { id: 'Orchestrator (Argon)', display_name: 'Orchestrator (Argon)', expected: '0 / 512.0k' },
        { id: 'MODEL_PLACEHOLDER_M322', display_name: 'gemini-3.8-flash-tiered', expected: '0 / 256.0k' }
      ];
      for (const m of modelExpectations) {
        const resModel = await runStatusline({
          conversation_id: 'conv-r33-catalog-switch',
          model: { id: m.id, display_name: m.display_name },
          context_window: { total_input_tokens: 0, context_window_size: 0 },
          terminal_width: 120
        }, homeR33_Catalog);
        assert.strictEqual(resModel.code, 0);
        const plainModel = stripAnsi(resModel.stdout).trim();
        assert.ok(plainModel.includes(m.expected), `Model '${m.display_name}' must render '${m.expected}', got: "${plainModel}"`);
      }

      // Ambiguous displayName entry must fall back cleanly to 256.0k
      const resAmbig = await runStatusline({
        conversation_id: 'conv-r33-ambiguous',
        model: { id: 'Shared Label', display_name: 'Shared Label' },
        context_window: { total_input_tokens: 0, context_window_size: 1048576 },
        terminal_width: 120
      }, homeR33_Catalog);
      assert.ok(stripAnsi(resAmbig.stdout).includes('0 / 256.0k'));
    } finally {
      try { rmSync(homeR33_Catalog, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }
    console.log("  -> Subtest 9 passed: Layer 3 dynamic modelLimits catalog lookup (with token-count-only footer and /model switching) verified.");

    // (10) Layer 2 對話執行期 maxContextTokens（區分 Claude 256k vs 840k）、切換模型失效防護與 E2E LS 背景同步
    const homeR33_Runtime = makeTempHome({
      updatedAt: Date.now(),
      lsUpdatedAt: Date.now(),
      modelLimitsUpdatedAt: Date.now(),
      modelLimits: {
        claudeopus55medium: { limit: 256000, maxTokens: 1000000, slug: 'claude-opus-5-5-medium', displayName: 'Claude Opus 5.5 (Medium)' },
        gemini38flashhigh: { limit: 256000, maxTokens: 1048576, slug: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)' },
        gemini4hydrogenmedium: { limit: 512000, maxTokens: 1048576, slug: 'gemini-4-hydrogen-medium', displayName: 'Gemini 4 Hydrogen (Medium)' }
      }
    }, {
      ui: { language: 'zh-tw', footer: { items: ['token-count'] } }
    });
    try {
      const runtimeConvId = 'conv-r33-runtime-claude';
      const runtimeCtxPath = join(homeR33_Runtime, '.gemini', 'tmp', `ctx_${runtimeConvId}.json`);
      writeFileSync(runtimeCtxPath, JSON.stringify({
        total_input_tokens: 12000,
        context_window_size: 1000000,
        runtime_max_context_tokens: 840000,
        runtime_model_display_name: 'Claude Opus 5.5 (Medium)',
        runtime_model_enum: 'MODEL_PLACEHOLDER_M401',
        runtime_model_key: 'claudeopus55medium',
        generator_metadata_offset: 3
      }), 'utf8');

      // 10A: Claude 對話匹配 runtime_max_context_tokens = 840000（覆蓋目錄預設 256000）
      const resClaude840 = await runStatusline({
        conversation_id: runtimeConvId,
        model: { id: 'Claude Opus 5.5 (Medium)', display_name: 'Claude Opus 5.5 (Medium)' },
        context_window: { total_input_tokens: 12000, context_window_size: 1000000 },
        terminal_width: 120
      }, homeR33_Runtime);
      assert.ok(stripAnsi(resClaude840.stdout).includes('12.0k / 840.0k'), `Claude runtime 840k must override catalog 256k! Got: "${stripAnsi(resClaude840.stdout).trim()}"`);

      // 10B: 同一對話切換至 Gemini 3.8 Flash (High) -> 不得沿用 Claude 舊的 840k，立即改用目錄 256.0k
      const resSwitchToFlash = await runStatusline({
        conversation_id: runtimeConvId,
        model: { id: 'Gemini 3.8 Flash (High)', display_name: 'Gemini 3.8 Flash (High)' },
        context_window: { total_input_tokens: 12000, context_window_size: 1048576 },
        terminal_width: 120
      }, homeR33_Runtime);
      assert.ok(stripAnsi(resSwitchToFlash.stdout).includes('12.0k / 256.0k'), `Model switch must invalidate stale Claude 840k runtime ceiling! Got: "${stripAnsi(resSwitchToFlash.stdout).trim()}"`);
    } finally {
      try { rmSync(homeR33_Runtime, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }

    // 10C: E2E statusline-quota.mjs -> spawn real fetch-local-quota.mjs with STATUSLINE_CONVERSATION_ID against mock HTTP LS
    const e2eServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        if (req.url === '/exa.language_server_pb.LanguageServerService/GetUserStatus') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ userStatus: { email: 'e2e@example.com', cascadeModelConfigData: { clientModelConfigs: [] } } }));
        } else if (req.url === '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ groups: [] }));
        } else if (req.url === '/exa.language_server_pb.LanguageServerService/GetAvailableModels') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            response: {
              models: {
                'gemini-4-argon-medium': {
                  displayName: 'Gemini 4 Argon (Medium)',
                  maxTokens: 1048576,
                  model: 'MODEL_PLACEHOLDER_M418',
                  modelExperiments: {
                    experiments: {
                      CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                        stringValue: JSON.stringify({ max_token_limit: '512000', enabled: true })
                      }
                    }
                  }
                },
                'claude-opus-5-5-medium': {
                  displayName: 'Claude Opus 5.5 (Medium)',
                  maxTokens: 1000000,
                  model: 'MODEL_PLACEHOLDER_M401',
                  modelExperiments: {
                    experiments: {
                      CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                        stringValue: JSON.stringify({ max_token_limit: '256000', enabled: true })
                      }
                    }
                  }
                }
              }
            }
          }));
        } else if (req.url === '/exa.language_server_pb.LanguageServerService/GetCascadeTrajectoryGeneratorMetadata') {
          const parsedBody = JSON.parse(body || '{}');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (parsedBody.cascadeId === 'conv-e2e-dynamic-ls' && parsedBody.generatorMetadataOffset === 0) {
            res.end(JSON.stringify({
              generatorMetadata: [
                {
                  chatModel: {
                    model: 'MODEL_PLACEHOLDER_M401',
                    modelDisplayName: 'Claude Opus 5.5 (Medium)',
                    chatStartMetadata: { contextWindowMetadata: { maxContextTokens: 840000 } }
                  }
                }
              ]
            }));
          } else {
            res.end(JSON.stringify({}));
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    const homeR33_E2E = mkdtempSync(join(os.tmpdir(), 'statusline-r33-e2e-'));
    try {
      await new Promise(resolve => e2eServer.listen(0, '127.0.0.1', resolve));
      const e2ePort = e2eServer.address().port;
      mkdirSync(join(homeR33_E2E, '.gemini', 'tmp'), { recursive: true });
      mkdirSync(join(homeR33_E2E, '.gemini', 'antigravity-cli', 'hooks'), { recursive: true });
      copyFileSync(FETCH_SCRIPT_PATH, join(homeR33_E2E, '.gemini', 'antigravity-cli', 'hooks', 'fetch-local-quota.mjs'));
      // fetch-local-quota.mjs 已改為薄入口，須一併部署 lib/ 讓 ./lib/... 相對匯入可解析
      copyDirRecursiveSync(join(SCRIPTS_DIR, 'lib'), join(homeR33_E2E, '.gemini', 'antigravity-cli', 'hooks', 'lib'), (p) => p.endsWith('.mjs'));
      writeFileSync(join(homeR33_E2E, '.gemini', 'tmp', 'antigravity_ls_env.json'), JSON.stringify({
        ls_address: `127.0.0.1:${e2ePort}`,
        csrf_token: 'e2e-csrf',
        prefer_https: false
      }), 'utf8');
      writeFileSync(join(homeR33_E2E, '.gemini', 'settings.json'), JSON.stringify({
        ui: { language: 'zh-tw', footer: { items: ['token-count'] } }
      }), 'utf8');

      // Frame 1: Empty cache -> statusline spawns real fetch-local-quota.mjs -> resolves Claude 840k runtime + Argon 512k catalog
      const resE2eClaude = await runStatusline({
        conversation_id: 'conv-e2e-dynamic-ls',
        model: { id: 'Claude Opus 5.5 (Medium)', display_name: 'Claude Opus 5.5 (Medium)' },
        context_window: { total_input_tokens: 5000, context_window_size: 1000000 },
        terminal_width: 120
      }, homeR33_E2E);
      assert.strictEqual(resE2eClaude.code, 0);
      assert.ok(stripAnsi(resE2eClaude.stdout).includes('5.0k / 840.0k'), `E2E spawn must resolve runtime 840.0k! Got: "${stripAnsi(resE2eClaude.stdout).trim()}"`);

      // Frame 2: Brand-new conversation on Argon -> immediately hits newly synced modelLimits 512.0k
      const resE2eArgon = await runStatusline({
        conversation_id: 'conv-e2e-argon-turn0',
        model: { id: 'Gemini 4 Argon (Medium)', display_name: 'Gemini 4 Argon (Medium)' },
        context_window: { total_input_tokens: 0, context_window_size: 1048576 },
        terminal_width: 120
      }, homeR33_E2E);
      assert.strictEqual(resE2eArgon.code, 0);
      assert.ok(stripAnsi(resE2eArgon.stdout).includes('0 / 512.0k'), `E2E turn 0 Argon must render synced 512.0k! Got: "${stripAnsi(resE2eArgon.stdout).trim()}"`);
      console.log("  -> Subtest 10 passed: Runtime maxContextTokens override, /model switch invalidation, and E2E LS sync verified.");
    } catch (err) {
      if (err.code === 'EPERM' || err.message?.includes('EPERM')) {
        console.log("  -> Subtest 10 skipped loopback bind due to sandbox EPERM (10A/10B passed).");
      } else {
        throw err;
      }
    } finally {
      try { await new Promise(resolve => e2eServer.close(resolve)); } catch (_) {}
      try { rmSync(homeR33_E2E, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }

    console.log("✅ Test R33 passed! (4-layer dynamic ceiling resolution, per-model/per-conversation step-up, modelLimits catalog, runtime maxContextTokens, and overrides all verified)");
  } catch (err) {
    console.error("Test execution failed:", err);
    testsPassed = false;
  }

  if (testsPassed) {
    console.log("\n🎉 All quota-and-context.test.mjs (R1-R7, R9-R15, R28-R33) tests passed successfully!");
    process.exit(0);
  } else {
    console.error("\n❌ Some quota-and-context.test.mjs (R1-R7, R9-R15, R28-R33) tests failed.");
    process.exit(1);
  }
}

main();
