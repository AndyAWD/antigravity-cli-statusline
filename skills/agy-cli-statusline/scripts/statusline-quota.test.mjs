import { writeFileSync, mkdirSync, rmSync, mkdtempSync, symlinkSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { spawn } from 'child_process';
import assert from 'assert';
import { fileURLToPath } from 'url';
import {
  formatAbsoluteResetTime,
  renderBarGraph,
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
} from './statusline-quota.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./statusline-quota.mjs', import.meta.url));

const BLUE_BOLD = "\x1b[38;2;87;202;255m\x1b[1m";
const GREEN_BOLD = "\x1b[38;2;92;219;109m\x1b[1m";
const YELLOW = "\x1b[38;2;255;212;39m";
const WHITE = "\x1b[38;2;255;255;255m";
const RESET = "\x1b[0m";

/**
 * Spawns the statusline script with redirected HOME and project directory.
 * @param {object} stdinData - Meta payload piped to stdin
 * @param {string} homeDir - Isolated temporary directory path
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runStatusline(stdinData, homeDir, scriptPath = SCRIPT_PATH) {
  return new Promise((resolve) => {
    const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    delete env.DISABLE_QUOTA_HOOK;            // explicit unset — Finding #1
    const child = spawn('node', [scriptPath], {
      env,
      cwd: homeDir,                            // project settings resolve under temp home — Finding #2
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.stdin.write(JSON.stringify(stdinData));
    child.stdin.end();
  });
}

/**
 * Creates a hermetic sandbox home directory containing mock cache and settings.
 * @param {object} cache - Mock quota cache content
 * @param {object} settings - Mock settings content
 * @returns {string} Path to the created temp home directory
 */
function makeTempHome(cache, settings) {
  const home = mkdtempSync(join(os.tmpdir(), 'statusline-weekly-'));
  mkdirSync(join(home, '.gemini', 'tmp'), { recursive: true });
  writeFileSync(join(home, '.gemini', 'tmp', 'real_quota_cache.json'), JSON.stringify(cache), 'utf8');
  writeFileSync(join(home, '.gemini', 'settings.json'), JSON.stringify(settings), 'utf8');
  return home;
}

async function main() {
  console.log("=== Running statusline-quota.test.mjs (R1-R4) ===");

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

      const expectedR1 = `${WHITE}Weekly Reset:${RESET} ${BLUE_BOLD}4d 11h${RESET}`;
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

      const expectedR2 = `${WHITE}Weekly Available:${RESET} ${BLUE_BOLD}90%${RESET}`;
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

      const expectedR3 = `${WHITE}Weekly Available:${RESET} ${GREEN_BOLD}61%${RESET}`;
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

      const expectedR4 = `${WHITE}Weekly Reset:${RESET} ${BLUE_BOLD}N/A${RESET}`;
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

      const expectedR5Quota = `${WHITE}Hourly Available:${RESET} ${YELLOW}\x1b[1m32%${RESET}`;
      const expectedR5Reset = `${WHITE}Hourly Reset:${RESET} ${BLUE_BOLD}2h 2m${RESET}`;
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

      const expectedR6Hourly = `${WHITE}Hourly Available:${RESET} ${BLUE_BOLD}75%${RESET}`;
      const expectedR6HourlyReset = `${WHITE}Hourly Reset:${RESET} ${BLUE_BOLD}2h${RESET}`;
      const expectedR6Weekly = `${WHITE}Weekly Available:${RESET} ${BLUE_BOLD}82%${RESET}`;
      const expectedR6WeeklyReset = `${WHITE}Weekly Reset:${RESET} ${BLUE_BOLD}4d 4h${RESET}`;

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
        "模型:", "小时可用:", "上下文用量:", "内存:", "令牌数:",
        "小时倒计时:", "每周可用:", "每周倒计时:", "Git:",
        "项目:", "完整路径:", "订阅计划:", "账号:", "代理状态:",
        "工具待确认:", "待处理输入:", "后台任务:", "子代理:", "产出文件数:",
        "工作区状态:", "VCS类型:", "沙箱状态:", "CLI版本:", "对话ID:",
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

        const hasZhCnQuota = resVar.stdout.includes("小时可用:");
        const hasZhCnCtx = resVar.stdout.includes("上下文用量:");
        const hasZhCnMem = resVar.stdout.includes("内存:");
        const hasZhCnClean = resVar.stdout.includes("干净");
        const hasZhCnSandbox = resVar.stdout.includes("关闭");
        const hasZhCnProfile = resVar.stdout.includes("默认");

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
      conversationIdShort: '12345678',
      agentProfileName: 'Default'
    };

    const newMetricKeys = [
      'quota-reset-time', 'quota-weekly-reset-time',
      'quota-bar', 'quota-weekly-bar',
      'context-used-bar', 'token-count-bar',
      'quota+bar', 'context-used+bar', 'quota-weekly+bar', 'token-count+bar'
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
    assert.ok(plainRendered.includes('小時可用: 88% [████████░░]'), `Expected merged quota text in: ${plainRendered}`);
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
      assert.ok(plainOut.includes('小時可用: 88% [████████░░]'), 'Output must contain merged hourly quota and bar');
      assert.ok(plainOut.includes('小時重置:'), 'Output must contain hourly reset time label');
      assert.ok(plainOut.includes('每週可用: 90% [█████████░]'), 'Output must contain merged weekly quota and bar');
      assert.ok(plainOut.includes('每週重置:'), 'Output must contain weekly reset time label');
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
      assert.ok(plainR15.includes('Hourly Reset Time:'), 'Must include Hourly Reset Time label');
      assert.ok(!plainR15.includes('Hourly Reset Time: N/A'), 'Hourly Reset Time must not be N/A when reset_in_seconds is provided');
      assert.ok(plainR15.includes('Weekly Reset Time:'), 'Must include Weekly Reset Time label');
      assert.ok(!plainR15.includes('Weekly Reset Time: N/A'), 'Weekly Reset Time must not be N/A when reset_in_seconds is provided');
      console.log("✅ R15 passed! (meta.quota reset_in_seconds derived valid absolute reset times)");
    } finally {
      try { rmSync(homeR15, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch(e) {}
    }

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
      vcsDirtyGlyph: '✓',
      vcsDirtyLabel: '乾淨',
      vcsType: 'git',
      projectName: 'my/proj',
      projectFullPath: '/Users/dev/my/proj',
      memUsage: '128MB',
      sandboxEnabled: true,
      sandboxAllowNet: true,
      sandboxStatusVal: '啟用（聯網）',
      cliVersion: 'v1.2.3',
      conversationIdShort: 'c4a861dd',
      agentProfileName: '預設',
      mode: 'Interactive'
    };

    for (const lang of ['zh-tw', 'zh-cn', 'us', 'jp']) {
      const emojiDict = buildI18nDict(lang, mockMetricsR21, 'emoji');
      const allKeys = Object.keys(EMOJI_MAP);
      assert.strictEqual(allKeys.length, 36, 'EMOJI_MAP must contain 32 metrics + 4 merged bar keys (36 total)');

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
    assert.strictEqual(stripAnsi(zhTwEmojiDict['tool-confirmation']), '🔔 在等你');
    assert.strictEqual(stripAnsi(zhTwEmojiDict['vcs-dirty']), '📝 ✓ 乾淨');
    assert.strictEqual(stripAnsi(zhTwEmojiDict['sandbox-status']), '🔒 啟用（聯網）');
    assert.strictEqual(stripAnsi(zhTwEmojiDict['agent-profile']), '🎭 預設');
    assert.strictEqual(stripAnsi(zhTwEmojiDict['quota+bar']), '🔋 100% [██████████]');

    // Verify renderStatusLine fallback rawModel extraction works with emoji dict
    const fallbackEmojiLines = renderStatusLine([], zhTwEmojiDict, 80);
    assert.strictEqual(fallbackEmojiLines.length, 1);
    assert.ok(stripAnsi(fallbackEmojiLines[0]).includes('Gemini 3.1 Pro'));
    assert.ok(!stripAnsi(fallbackEmojiLines[0]).includes('🤖'), 'Fallback shortcuts line should strip 🤖 prefix from model-name');
    console.log("✅ R21 passed! (All 36 emoji mappings and localized status values verified)");

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
      assert.ok(plainR22.includes("🌿 feat/emoji"), "Must render git-branch with 🌿 and no colon");
      assert.ok(plainR22.includes("📝 ✓ 乾淨"), "Must render vcs-dirty with 📝 and localized value");
      assert.ok(plainR22.includes("🔔 都好了"), "Must render tool-confirmation with 🔔 and localized value");
      assert.ok(!plainR22.includes("模型:"), "Must NOT contain text label '模型:'");
      assert.ok(!plainR22.includes("小時可用:"), "Must NOT contain text label '小時可用:'");
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
    const quotaRowLine1 = "脈絡用量: 0.0% [░░░░░░░░░░] │ 權杖數: 0 / 1.0M [░░░░░░░░░░] │ 小時倒數: 3h 52m │ 小時重置: 2026/10/16 01:09";
    const quotaRowLine2 = "小時可用: 88% [████████░░] │ 每週可用: 94% [█████████░] │ 每週倒數: 5d 17h │ 每週重置: 2026/10/21 14:47";
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

  } catch (err) {
    console.error("Test execution failed:", err);
    testsPassed = false;
  }

  if (testsPassed) {
    console.log("\n🎉 All rendering tests passed successfully!");
    process.exit(0);
  } else {
    console.error("\n❌ Some rendering tests failed.");
    process.exit(1);
  }
}

main();
