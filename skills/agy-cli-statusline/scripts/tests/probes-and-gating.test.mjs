import { writeFileSync, readFileSync, mkdirSync, rmSync, mkdtempSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { spawn, execFileSync } from 'child_process';
import assert from 'assert';
import {
  stripAnsi,
  extractMetricsAsync
} from '../statusline-quota.mjs';
import {
  runStatusline
} from './helpers.mjs';

async function main() {
  console.log("=== Running probes-and-gating.test.mjs (R34) ===");

  let testsPassed = true;

  try {
    // =========================================================================
    // Test Case R34: Gate subprocess & filesystem probes on configured footer items (Issue #33)
    // =========================================================================
    console.log("\n[Test R34] Verifying extractMetricsAsync gates subprocess and filesystem probes on footerItems...");
    const sandboxR34 = mkdtempSync(join(os.tmpdir(), 'statusline-issue33-'));
    const homeR34 = join(sandboxR34, 'home');
    const projR34 = join(sandboxR34, 'repo');
    const convIdR34 = 'conv-r34-probe-gate';
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;

    try {
      mkdirSync(join(homeR34, '.gemini', 'tmp', 'background-processes'), { recursive: true });
      mkdirSync(join(homeR34, '.gemini', 'antigravity-cli', 'brain', convIdR34), { recursive: true });
      mkdirSync(join(projR34, '.agents', 'worker-1'), { recursive: true });

      writeFileSync(join(homeR34, '.gemini', 'tmp', 'real_quota_cache.json'), JSON.stringify({ updatedAt: Date.now() }), 'utf8');
      writeFileSync(join(homeR34, '.gemini', 'tmp', 'pending_input_count'), '4', 'utf8');
      writeFileSync(join(homeR34, '.gemini', 'tmp', 'background-processes', 'job-1.json'), '{}', 'utf8');
      writeFileSync(join(projR34, '.agents', 'worker-1', 'progress.md'), 'active', 'utf8');
      writeFileSync(join(homeR34, '.gemini', 'antigravity-cli', 'brain', convIdR34, 'artifact.metadata.json'), '{}', 'utf8');
      writeFileSync(join(homeR34, '.gemini', 'antigravity-cli', 'cli.log'), 'applyAuthResult: email=r34-user@example.com\n', 'utf8');

      execFileSync('git', ['init', '-b', 'feat-r34'], { cwd: projR34, windowsHide: true, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: projR34, windowsHide: true, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: projR34, windowsHide: true, stdio: 'ignore' });
      execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: projR34, windowsHide: true, stdio: 'ignore' });
      writeFileSync(join(projR34, 'dirty.txt'), 'uncommitted', 'utf8');

      const metaR34 = {
        conversation_id: convIdR34,
        model: { display_name: 'Gemini 3.5 Flash' },
        project: { path: projR34 },
        terminal_width: 240
      };
      const quotaInfoR34 = { remaining_percentage: 100, refreshes_in: '' };
      const ctxInfoR34 = { totalInput: 0, contextSize: 1000000, effectiveTokenCeiling: 256000, usedPctNum: 0 };

      process.env.HOME = homeR34;
      process.env.USERPROFILE = homeR34;

      // 1. All 7 probes disabled when footerItems only enables 'model-name'
      const execCallsDisabled = [];
      const spyExecDisabled = async (cmd) => {
        execCallsDisabled.push(cmd);
        return { stdout: '', ok: false, notFound: false };
      };
      const disabledMetrics = await extractMetricsAsync(
        metaR34, 'us', 'Gemini 3.5 Flash', null, {}, quotaInfoR34, ctxInfoR34, quotaInfoR34,
        { footerItems: new Set(['model-name']), execFn: spyExecDisabled }
      );
      assert.strictEqual(execCallsDisabled.length, 0, `Disabled probes must not spawn subprocesses, got: ${JSON.stringify(execCallsDisabled)}`);
      assert.strictEqual(disabledMetrics.gitBranch, 'No VC', 'Disabled git-branch must not probe git');
      assert.strictEqual(disabledMetrics.vcsDirtyFlag, false, 'Disabled vcs-dirty must not probe git status');
      assert.strictEqual(disabledMetrics.memUsage, '0MB', 'Disabled memory-usage must not probe process memory');
      assert.strictEqual(disabledMetrics.pendingInputCount, 0, 'Disabled pending-input must not probe filesystem');
      assert.strictEqual(disabledMetrics.backgroundTasksCount, 0, 'Disabled background-tasks must not probe filesystem');
      assert.strictEqual(disabledMetrics.subagentsCount, 0, 'Disabled subagents must not probe filesystem');
      assert.strictEqual(disabledMetrics.artifactsCount, 0, 'Disabled artifacts must not probe filesystem');

      // 2. Single-item gating: enabling one probe runs only that probe
      const branchCalls = [];
      const branchMetrics = await extractMetricsAsync(
        metaR34, 'us', 'Gemini 3.5 Flash', null, {}, quotaInfoR34, ctxInfoR34, quotaInfoR34,
        {
          footerItems: ['git-branch'],
          execFn: async (cmd) => {
            branchCalls.push(cmd);
            return { stdout: 'feat-r34', ok: true, notFound: false };
          }
        }
      );
      assert.strictEqual(branchCalls.length, 1);
      assert.ok(branchCalls[0].includes('branch'), `Expected git branch probe, got: ${branchCalls[0]}`);
      assert.strictEqual(branchMetrics.gitBranch, 'feat-r34');
      assert.strictEqual(branchMetrics.vcsDirtyFlag, false);
      assert.strictEqual(branchMetrics.memUsage, '0MB');
      assert.strictEqual(branchMetrics.pendingInputCount, 0);
      assert.strictEqual(branchMetrics.backgroundTasksCount, 0);
      assert.strictEqual(branchMetrics.subagentsCount, 0);
      assert.strictEqual(branchMetrics.artifactsCount, 0);

      const dirtyCalls = [];
      const dirtyMetrics = await extractMetricsAsync(
        metaR34, 'us', 'Gemini 3.5 Flash', null, {}, quotaInfoR34, ctxInfoR34, quotaInfoR34,
        {
          footerItems: ['vcs-dirty'],
          execFn: async (cmd) => {
            dirtyCalls.push(cmd);
            return { stdout: '?? dirty.txt', ok: true, notFound: false };
          }
        }
      );
      assert.strictEqual(dirtyCalls.length, 1);
      assert.ok(dirtyCalls[0].includes('status --porcelain'), `Expected git status probe, got: ${dirtyCalls[0]}`);
      assert.strictEqual(dirtyMetrics.vcsDirtyFlag, true);
      assert.strictEqual(dirtyMetrics.gitBranch, 'No VC');
      assert.strictEqual(dirtyMetrics.memUsage, '0MB');

      const memCalls = [];
      const memMetrics = await extractMetricsAsync(
        metaR34, 'us', 'Gemini 3.5 Flash', null, {}, quotaInfoR34, ctxInfoR34, quotaInfoR34,
        {
          footerItems: ['memory-usage'],
          execFn: async (cmd) => {
            memCalls.push(cmd);
            return { stdout: process.platform === 'win32' ? String(256 * 1024 * 1024) : String(256 * 1024), ok: true, notFound: false };
          }
        }
      );
      assert.strictEqual(memCalls.length, 1);
      assert.ok(
        process.platform === 'win32' ? memCalls[0].includes('powershell.exe') : memCalls[0].includes('ps '),
        `Expected memory probe command, got: ${memCalls[0]}`
      );
      assert.strictEqual(memMetrics.memUsage, '256MB');
      assert.strictEqual(memMetrics.gitBranch, 'No VC');
      assert.strictEqual(memMetrics.vcsDirtyFlag, false);

      const fsGateExpectations = [
        { item: 'pending-input', field: 'pendingInputCount', expected: 4 },
        { item: 'background-tasks', field: 'backgroundTasksCount', expected: 1 },
        { item: 'subagents', field: 'subagentsCount', expected: 1 },
        { item: 'artifacts', field: 'artifactsCount', expected: 1 }
      ];
      for (const { item, field, expected } of fsGateExpectations) {
        const calls = [];
        const m = await extractMetricsAsync(
          metaR34, 'us', 'Gemini 3.5 Flash', null, {}, quotaInfoR34, ctxInfoR34, quotaInfoR34,
          {
            footerItems: [item],
            execFn: async (cmd) => {
              calls.push(cmd);
              return { stdout: '', ok: false, notFound: false };
            }
          }
        );
        assert.strictEqual(calls.length, 0, `${item} must not trigger subprocess probes`);
        assert.strictEqual(m[field], expected, `${item} must still resolve ${field}=${expected}`);
        for (const other of fsGateExpectations) {
          if (other.item !== item) {
            assert.strictEqual(m[other.field], 0, `${other.item} must stay 0 when only ${item} is enabled`);
          }
        }
      }

      // Subagent filtering tolerates null entries and leaves the caller's meta unchanged
      const rawSubagents = [null, { status: 'completed' }, { status: 'running' }, 'legacy-entry'];
      const metaSubagents = { ...metaR34, subagents: rawSubagents };
      const subagentMetrics = await extractMetricsAsync(
        metaSubagents, 'us', 'Gemini 3.5 Flash', null, {}, quotaInfoR34, ctxInfoR34, quotaInfoR34,
        { footerItems: ['subagents'] }
      );
      assert.strictEqual(subagentMetrics.subagentsCount, 2, 'Only active, non-null subagents must be counted');
      assert.strictEqual(metaSubagents.subagents, rawSubagents, 'meta.subagents must not be reassigned');
      assert.strictEqual(rawSubagents.length, 4, 'meta.subagents entries must not be removed');

      // project.path === '/' must fall back to '/' instead of empty basename('')
      const rootMetrics = await extractMetricsAsync(
        { ...metaR34, project: { path: '/' } }, 'us', 'Gemini 3.5 Flash', null, {}, quotaInfoR34, ctxInfoR34, quotaInfoR34,
        { footerItems: ['project-path'] }
      );
      assert.strictEqual(rootMetrics.projectName, '/', 'Root path projectName must fall back to "/"');

      // 3. Enabled real probes & E2E output stay unchanged
      const allProbeItems = [
        'model-name', 'git-branch', 'vcs-dirty', 'memory-usage',
        'pending-input', 'background-tasks', 'subagents', 'artifacts'
      ];
      const enabledRealMetrics = await extractMetricsAsync(
        metaR34, 'us', 'Gemini 3.5 Flash', null, {}, quotaInfoR34, ctxInfoR34, quotaInfoR34,
        { footerItems: new Set(allProbeItems) }
      );
      assert.strictEqual(enabledRealMetrics.gitBranch, 'feat-r34');
      assert.strictEqual(enabledRealMetrics.vcsDirtyFlag, true);
      assert.ok(parseInt(enabledRealMetrics.memUsage, 10) > 0, `Expected positive RAM MB, got: ${enabledRealMetrics.memUsage}`);
      assert.strictEqual(enabledRealMetrics.pendingInputCount, 4);
      assert.strictEqual(enabledRealMetrics.backgroundTasksCount, 1);
      assert.strictEqual(enabledRealMetrics.subagentsCount, 1);
      assert.strictEqual(enabledRealMetrics.artifactsCount, 1);

      const tmpDirR34 = join(homeR34, '.gemini', 'tmp');
      const quotaCachePathR34 = join(tmpDirR34, 'real_quota_cache.json');
      const quotaCacheBefore = readFileSync(quotaCachePathR34, 'utf8');
      writeFileSync(join(homeR34, '.gemini', 'settings.json'), JSON.stringify({
        ui: { language: 'us', footer: { items: allProbeItems } }
      }), 'utf8');
      const resE2eEnabled = await runStatusline(metaR34, homeR34);
      const plainE2eEnabled = stripAnsi(resE2eEnabled.stdout).trim();
      assert.strictEqual(resE2eEnabled.code, 0);
      assert.ok(plainE2eEnabled.includes('Branch: feat-r34'), `Expected Branch: feat-r34 in: ${plainE2eEnabled}`);
      assert.ok(plainE2eEnabled.includes('VCS Status: uncommitted'), `Expected VCS Status: uncommitted in: ${plainE2eEnabled}`);
      assert.ok(/RAM: \d+MB/.test(plainE2eEnabled), `Expected RAM in: ${plainE2eEnabled}`);
      assert.ok(plainE2eEnabled.includes('Queue: 4'), `Expected Queue: 4 in: ${plainE2eEnabled}`);
      assert.ok(plainE2eEnabled.includes('BG: 1'), `Expected BG: 1 in: ${plainE2eEnabled}`);
      assert.ok(plainE2eEnabled.includes('Subagents: 1'), `Expected Subagents: 1 in: ${plainE2eEnabled}`);
      assert.ok(plainE2eEnabled.includes('Outputs: 1'), `Expected Outputs: 1 in: ${plainE2eEnabled}`);

      writeFileSync(join(homeR34, '.gemini', 'settings.json'), JSON.stringify({
        ui: { language: 'us', footer: { items: ['model-name'] } }
      }), 'utf8');
      const resE2eDisabled = await runStatusline(metaR34, homeR34);
      const plainE2eDisabled = stripAnsi(resE2eDisabled.stdout).trim();
      assert.strictEqual(resE2eDisabled.code, 0);
      assert.strictEqual(plainE2eDisabled, 'Model: Gemini 3.5 Flash');

      // main() skips quota, context and CLI log I/O when no footer item needs them
      assert.strictEqual(readFileSync(quotaCachePathR34, 'utf8'), quotaCacheBefore, 'Quota cache must stay untouched without quota/account items');
      const ctxFiles = readdirSync(tmpDirR34).filter(f => f.startsWith('ctx_'));
      assert.deepStrictEqual(ctxFiles, [], 'Context cache must not be written without context/token items');
      const accountCachePathR34 = join(tmpDirR34, 'account_meta_cache.json');
      const accountCacheAfter = existsSync(accountCachePathR34) ? JSON.parse(readFileSync(accountCachePathR34, 'utf8')) : {};
      assert.strictEqual(accountCacheAfter.email, undefined, 'CLI log must not be scanned without account-email');

      writeFileSync(join(homeR34, '.gemini', 'settings.json'), JSON.stringify({
        ui: { language: 'us', footer: { items: ['account-email'] } }
      }), 'utf8');
      const resE2eEmail = await runStatusline(metaR34, homeR34);
      assert.strictEqual(resE2eEmail.code, 0);
      assert.ok(stripAnsi(resE2eEmail.stdout).includes('r34-user@example.com'), `account-email must still read the CLI log, got: ${resE2eEmail.stdout}`);

      console.log("✅ Test R34 passed! (Subprocess and filesystem probes are gated on configured footer items)");
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      if (origUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = origUserProfile;
      try { rmSync(sandboxR34, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }
    } catch (err) {
      console.error("Test R34 execution failed:", err);
      testsPassed = false;
    }

  if (testsPassed) {
    console.log("\n🎉 All probes-and-gating.test.mjs (R34) tests passed successfully!");
    process.exit(0);
  } else {
    console.error("\n❌ Some probes-and-gating.test.mjs (R34) tests failed.");
    process.exit(1);
  }
}

main();
