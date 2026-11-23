import { writeFileSync, readFileSync, mkdirSync, rmSync, mkdtempSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import http from 'http';
import { execFileSync } from 'child_process';
import assert from 'assert';
import {
  buildI18nDict,
  stripAnsi,
  PLUGIN_REPO_URL,
  normalizeSemver,
  formatVersionTag,
  compareSemver,
  isVersionBehind,
  tokenizeCommandLine,
  isAgyProcessName,
  extractArgsAfterExecutable,
  hasNonInteractiveAgyFlag,
  isHubAgyArgs,
  parseMacPsLine,
  parseLinuxProcStat,
  parseWinProcessChainJson,
  resolveAgySessionAsync,
  resolveInstalledPluginVersionAsync,
  fetchLatestPluginReleaseAsync,
  checkPluginUpdateAsync,
  formatPluginUpdateNoticeLines
} from '../statusline-quota.mjs';
import {
  runStatusline,
  SCRIPT_PATH,
  BLUE_BOLD,
  GREEN_BOLD
} from './helpers.mjs';

async function main() {
  console.log("=== Running plugin-update.test.mjs (R35) ===");

  let testsPassed = true;

  // ----------------------------------------------------
  // Test Case R35: cli-version rename, plugin-version 4-locale rendering, process-tree tracking, GitHub update check & 2-line notice
  // ----------------------------------------------------
  console.log("\n[Test R35] Verifying cli-version rename, plugin-version, process-tree session tracking & GitHub update check...");
  try {
    // A. Verify 4-locale labels & emoji modes for cli-version and plugin-version
    const metricsR35 = {
      model: 'Gemini 3.8 Flash',
      shortModel: 'Gemini 3.8 Flash',
      ctxStr: '10.0%',
      ctxPctNum: 10.0,
      ctxColor: BLUE_BOLD,
      tokenStr: '10k / 100k',
      tokenExactVal: '10.0k',
      tokenMaxVal: '100.0k',
      tokenColor: BLUE_BOLD,
      memUsage: '100MB',
      quotaPct: 90,
      quotaPctStr: '90%',
      quotaColor: BLUE_BOLD,
      quotaResetCountdown: '4h',
      quotaResetTimeStr: '15:00',
      weeklyPct: 90,
      weeklyPctStr: '90%',
      weeklyColor: BLUE_BOLD,
      weeklyResetCountdown: '4d',
      weeklyResetTimeStr: '2026/11/22 15:00',
      argonPct: 90,
      argonPctStr: '90%',
      argonColor: BLUE_BOLD,
      argonResetCountdown: '5d',
      argonResetTimeStr: '2026/11/23 15:00',
      projectName: 'proj',
      projectPath: '/tmp/proj',
      gitBranch: 'main',
      planTier: 'Google AI Pro',
      accountEmail: 'a@b.com',
      agentStateStr: 'idle',
      agentStateColor: GREEN_BOLD,
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
      cliVersion: 'v1.5.10',
      pluginVersion: 'v1.11.4',
      conversationIdShort: 'aabbccdd',
      agentProfileName: 'Default',
      mode: 'Default'
    };

    const expectedLocalePairs = {
      'zh-tw': { cli: 'Agy CLI 版本: v1.5.10', plugin: '狀態列版本: v1.11.4' },
      'zh-cn': { cli: 'Agy CLI 版本: v1.5.10', plugin: '状态栏版本: v1.11.4' },
      'us': { cli: 'Agy CLI Version: v1.5.10', plugin: 'Statusline Version: v1.11.4' },
      'jp': { cli: 'Agy CLI バージョン: v1.5.10', plugin: 'ステータスライン版: v1.11.4' }
    };
    for (const [langCode, exp] of Object.entries(expectedLocalePairs)) {
      const textDict = buildI18nDict(langCode, metricsR35, 'text');
      assert.strictEqual(stripAnsi(textDict['cli-version']), exp.cli, `[${langCode}] cli-version text label mismatch`);
      assert.strictEqual(stripAnsi(textDict['plugin-version']), exp.plugin, `[${langCode}] plugin-version text label mismatch`);

      const emojiDict = buildI18nDict(langCode, metricsR35, 'emoji');
      assert.strictEqual(stripAnsi(emojiDict['cli-version']), '🚀 v1.5.10', `[${langCode}] cli-version emoji label mismatch`);
      assert.strictEqual(stripAnsi(emojiDict['plugin-version']), '🧩 v1.11.4', `[${langCode}] plugin-version emoji label mismatch`);
    }

    // B. Semver helpers & boundaries
    assert.strictEqual(normalizeSemver('v1.11.4'), '1.11.4');
    assert.strictEqual(normalizeSemver(' V2.0.10-beta.1 '), '2.0.10-beta.1');
    assert.strictEqual(normalizeSemver('not-a-version'), '');
    assert.strictEqual(formatVersionTag('1.11.4'), 'v1.11.4');
    assert.strictEqual(formatVersionTag('V1.11.4'), 'v1.11.4');
    assert.strictEqual(compareSemver('1.11.4', '1.11.10') < 0, true);
    assert.strictEqual(compareSemver('1.12.0', '1.11.99') > 0, true);
    assert.strictEqual(compareSemver('2.0.0', '2.0.0-rc.1') > 0, true);
    assert.strictEqual(compareSemver('1.11.4', 'v1.11.4'), 0);
    assert.strictEqual(isVersionBehind('1.11.4', '1.11.10'), true);
    assert.strictEqual(isVersionBehind('1.11.4', '1.11.4'), false);
    assert.strictEqual(isVersionBehind('1.12.0', '1.11.4'), false);
    assert.strictEqual(isVersionBehind('', '1.12.0'), false);
    assert.strictEqual(isVersionBehind('1.11.4', 'bad'), false);

    // C. Command-line tokenizer, agy matcher, non-interactive/hub flags, OS parsers
    assert.deepStrictEqual(
      tokenizeCommandLine('"/Users/John Doe/.gemini/bin/agy" -p "hello world" --foo=\'bar baz\''),
      ['/Users/John Doe/.gemini/bin/agy', '-p', 'hello world', '--foo=bar baz']
    );
    assert.strictEqual(isAgyProcessName('agy'), true);
    assert.strictEqual(isAgyProcessName('agy.exe'), true);
    assert.strictEqual(isAgyProcessName('/usr/local/bin/agy'), true);
    assert.strictEqual(isAgyProcessName('C:\\Program Files\\Agy\\agy.EXE'), true);
    assert.strictEqual(isAgyProcessName('node'), false);
    assert.strictEqual(isAgyProcessName('agy-helper'), false);

    assert.deepStrictEqual(
      extractArgsAfterExecutable('/Users/John Doe/.gemini/bin/agy --model gemini -p hello', 'agy'),
      ['--model', 'gemini', '-p', 'hello']
    );
    assert.strictEqual(hasNonInteractiveAgyFlag('agy -p "explain this"', 'agy'), true);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy --print "explain this"', 'agy'), true);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy --prompt="explain"', 'agy'), true);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy -p=true', 'agy'), true);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy --print=1', 'agy'), true);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy -p=false', 'agy'), false);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy --print=false', 'agy'), false);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy --prompt=0', 'agy'), false);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy -i "interactive"', 'agy'), false);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy --prompt-interactive "interactive"', 'agy'), false);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy -- "-p"', 'agy'), false);
    assert.strictEqual(hasNonInteractiveAgyFlag('agy', 'agy'), false);
    assert.strictEqual(isHubAgyArgs('agy --hub --port 1234', 'agy'), true);
    assert.strictEqual(isHubAgyArgs('agy --hub=1', 'agy'), true);
    assert.strictEqual(isHubAgyArgs('agy', 'agy'), false);

    // Empty pluginVersion in buildI18nDict must fall back to Unknown/未知 instead of blank
    const emptyPluginDict = buildI18nDict('zh-tw', { ...metricsR35, pluginVersion: '' }, 'text');
    assert.strictEqual(stripAnsi(emptyPluginDict['plugin-version']), '狀態列版本: 未知');
    const emptyPluginDictUs = buildI18nDict('us', { ...metricsR35, pluginVersion: '' }, 'text');
    assert.strictEqual(stripAnsi(emptyPluginDictUs['plugin-version']), 'Statusline Version: Unknown');

    assert.deepStrictEqual(
      parseMacPsLine('  1234   1000 Wed Nov 18 09:05:01 2026 /Users/John Doe/.gemini/bin/agy'),
      { pid: 1234, ppid: 1000, startTime: 'Wed Nov 18 09:05:01 2026', name: '/Users/John Doe/.gemini/bin/agy' }
    );
    assert.deepStrictEqual(
      parseMacPsLine('  987    500 Wed Nov  4 09:05:01 2026 agy'),
      { pid: 987, ppid: 500, startTime: 'Wed Nov  4 09:05:01 2026', name: 'agy' }
    );
    assert.strictEqual(parseMacPsLine('bad line'), null);

    // Linux /proc/<pid>/stat with space & parens in comm name
    const procFieldsAfterComm = Array.from({ length: 20 }, (_, i) => (i === 1 ? '4321' : (i === 19 ? '99887766' : '0'))).join(' ');
    assert.deepStrictEqual(
      parseLinuxProcStat(`54321 (agy (worker)) ${procFieldsAfterComm}`),
      { pid: 54321, ppid: 4321, name: 'agy (worker)', startTime: '99887766' }
    );
    assert.strictEqual(parseLinuxProcStat('malformed'), null);

    // Win32 CIM process chain JSON (single object vs array & UTF-8 BOM)
    const winSingle = parseWinProcessChainJson('\uFEFF{"pid":300,"ppid":200,"name":"agy.exe","start":"2026-11-18T01:00:00.000Z","cmd":"\\"C:\\\\Agy\\\\agy.exe\\" --model flash"}');
    assert.strictEqual(winSingle.length, 1);
    assert.strictEqual(winSingle[0].pid, 300);
    assert.strictEqual(winSingle[0].name, 'agy.exe');
    assert.deepStrictEqual(parseWinProcessChainJson('invalid json'), []);

    // D. resolveAgySessionAsync across darwin, linux (/proc & ps fallback), win32 & live OS self-walk
    // D1. Darwin: sh(500) -> node(400) -> agy --hub(300, skipped) -> main agy(200)
    const darwinSession = await resolveAgySessionAsync({
      platform: 'darwin',
      ppid: 500,
      execFn: async (_cmd, opts) => {
        const flagIdx = opts.execArgs.indexOf('-p');
        const pid = opts.execArgs[flagIdx + 1];
        const query = opts.execArgs[2];
        if (query.startsWith('pid=')) {
          if (pid === '500') return { ok: true, stdout: '500 400 Wed Nov 18 09:00:00 2026 zsh\n' };
          if (pid === '400') return { ok: true, stdout: '400 300 Wed Nov 18 08:59:59 2026 node\n' };
          if (pid === '300') return { ok: true, stdout: '300 200 Wed Nov 18 08:59:50 2026 agy\n' };
          if (pid === '200') return { ok: true, stdout: '200 1 Wed Nov 18 08:59:00 2026 /Users/John Doe/.gemini/bin/agy\n' };
        }
        if (query === 'args=') {
          if (pid === '300') return { ok: true, stdout: 'agy --hub\n' };
          if (pid === '200') return { ok: true, stdout: '/Users/John Doe/.gemini/bin/agy\n' };
        }
        return { ok: false, stdout: '' };
      }
    });
    assert.strictEqual(darwinSession.found, true);
    assert.strictEqual(darwinSession.pid, 200);
    assert.strictEqual(darwinSession.nonInteractive, false);
    assert.strictEqual(darwinSession.sessionKey, '200:Wed Nov 18 08:59:00 2026');

    // D2. Linux /proc traversal + agy -p detection + ps fallback
    const linuxStat500 = `500 (sh) S ${Array.from({ length: 19 }, (_, i) => (i === 0 ? '400' : (i === 18 ? '111' : '0'))).join(' ')}`;
    const linuxStat400 = `400 (agy) S ${Array.from({ length: 19 }, (_, i) => (i === 0 ? '1' : (i === 18 ? '222333' : '0'))).join(' ')}`;
    const linuxNonInteractive = await resolveAgySessionAsync({
      platform: 'linux',
      ppid: 500,
      readFileFn: async (p) => {
        if (p === '/proc/500/stat') return linuxStat500;
        if (p === '/proc/400/stat') return linuxStat400;
        if (p === '/proc/400/cmdline') return '/usr/bin/agy\0-p\0hello world\0';
        throw new Error('ENOENT');
      }
    });
    assert.strictEqual(linuxNonInteractive.found, true);
    assert.strictEqual(linuxNonInteractive.pid, 400);
    assert.strictEqual(linuxNonInteractive.nonInteractive, true);
    assert.strictEqual(linuxNonInteractive.sessionKey, '400:222333');

    // Linux /proc traversal when agy is invoked via symlink (comm is target binary name, cmdline[0] is /usr/local/bin/agy)
    const linuxStat450 = `450 (antigravity-cli) S ${Array.from({ length: 19 }, (_, i) => (i === 0 ? '1' : (i === 18 ? '555666' : '0'))).join(' ')}`;
    const linuxSymlinkInteractive = await resolveAgySessionAsync({
      platform: 'linux',
      ppid: 450,
      readFileFn: async (p) => {
        if (p === '/proc/450/stat') return linuxStat450;
        if (p === '/proc/450/cmdline') return '/usr/local/bin/agy\0--model\0flash\0';
        throw new Error('ENOENT');
      }
    });
    assert.strictEqual(linuxSymlinkInteractive.found, true);
    assert.strictEqual(linuxSymlinkInteractive.pid, 450);
    assert.strictEqual(linuxSymlinkInteractive.nonInteractive, false);
    assert.strictEqual(linuxSymlinkInteractive.sessionKey, '450:555666');

    const linuxPsFallback = await resolveAgySessionAsync({
      platform: 'linux',
      ppid: 500,
      readFileFn: async () => { throw new Error('ENOENT'); },
      execFn: async (_cmd, opts) => {
        const pid = opts.execArgs[opts.execArgs.indexOf('-p') + 1];
        if (opts.execArgs[2].startsWith('pid=')) {
          if (pid === '500') return { ok: true, stdout: '500 1 Wed Nov 18 09:00:00 2026 agy\n' };
        }
        if (opts.execArgs[2] === 'args=' && pid === '500') {
          return { ok: true, stdout: 'agy\n' };
        }
        return { ok: false, stdout: '' };
      }
    });
    assert.strictEqual(linuxPsFallback.found, true);
    assert.strictEqual(linuxPsFallback.pid, 500);
    assert.strictEqual(linuxPsFallback.nonInteractive, false);

    // D3. Win32 traversal
    const winChainPayload = JSON.stringify([
      { pid: 900, ppid: 800, name: 'cmd.exe', start: '2026-11-18T01:00:01Z', cmd: 'cmd.exe /c node statusline-quota.mjs' },
      { pid: 800, ppid: 700, name: 'agy.exe', start: '2026-11-18T01:00:00Z', cmd: '"C:\\Program Files\\Agy\\agy.exe" --hub' },
      { pid: 700, ppid: 600, name: 'agy.exe', start: '2026-11-18T00:59:00Z', cmd: '"C:\\Program Files\\Agy\\agy.exe"' }
    ]);
    const winSession = await resolveAgySessionAsync({
      platform: 'win32',
      ppid: 900,
      execFn: async () => ({ ok: true, stdout: winChainPayload })
    });
    assert.strictEqual(winSession.found, true);
    assert.strictEqual(winSession.pid, 700);
    assert.strictEqual(winSession.nonInteractive, false);
    assert.strictEqual(winSession.sessionKey, '700:2026-11-18T00:59:00Z');

    // D4. Live real-OS process-tree self-walk must never throw
    const liveSelfWalk = await resolveAgySessionAsync();
    assert.strictEqual(typeof liveSelfWalk.found, 'boolean');

    // E. checkPluginUpdateAsync state machine & manifest resolution
    const sandboxR35 = mkdtempSync(join(os.tmpdir(), 'statusline-r35-'));
    let releaseServer = null;
    try {
      const fakeHomeR35 = join(sandboxR35, 'home');
      const pluginDirR35 = join(fakeHomeR35, '.gemini', 'config', 'plugins', 'antigravity-cli-statusline');
      const cachePathR35 = join(fakeHomeR35, '.gemini', 'tmp', 'plugin_update_cache.json');
      mkdirSync(pluginDirR35, { recursive: true });
      writeFileSync(join(pluginDirR35, 'plugin.json'), '\uFEFF' + JSON.stringify({ name: 'antigravity-cli-statusline', version: 'v1.11.4' }), 'utf8');

      // E1. resolveInstalledPluginVersionAsync prefers pluginDir/plugin.json and strips BOM/v
      const resolvedInstalled = await resolveInstalledPluginVersionAsync({ homeDir: fakeHomeR35 });
      assert.strictEqual(resolvedInstalled.version, '1.11.4');
      assert.strictEqual(resolvedInstalled.tag, 'v1.11.4');

      // E1b. Unrelated package.json (name !== 'antigravity-cli-statusline') must be ignored
      const unrelatedDirR35 = join(sandboxR35, 'unrelated-pkg');
      mkdirSync(unrelatedDirR35, { recursive: true });
      writeFileSync(join(unrelatedDirR35, 'package.json'), JSON.stringify({ name: 'user-home-dotfiles', version: '0.1.0' }), 'utf8');
      const resolvedUnrelated = await resolveInstalledPluginVersionAsync({
        pluginDir: unrelatedDirR35,
        allowScriptRelativeFallback: false,
        fallbackVersion: null
      });
      assert.strictEqual(resolvedUnrelated.version, '', 'Unrelated package.json must be ignored');
      assert.strictEqual(resolvedUnrelated.tag, '');

      // E1c. Marketplace numeric dir, .agents/plugins dir, unrelated unnamed plugin dir & highest SemVer resolution
      const mpHome = join(sandboxR35, 'marketplace-home');
      const numericDir = join(mpHome, '.gemini', 'config', 'plugins', '-1870732469773246571');
      const otherPluginDir = join(mpHome, '.gemini', 'config', 'plugins', '999999999');
      const otherNamedPluginDir = join(mpHome, '.gemini', 'config', 'plugins', 'some-other-plugin');
      mkdirSync(numericDir, { recursive: true });
      mkdirSync(otherPluginDir, { recursive: true });
      mkdirSync(otherNamedPluginDir, { recursive: true });
      writeFileSync(join(otherPluginDir, 'plugin.json'), JSON.stringify({ version: '9.9.9' }), 'utf8');
      writeFileSync(join(otherNamedPluginDir, 'plugin.json'), JSON.stringify({ name: 'other-plugin', version: '8.8.8' }), 'utf8');
      writeFileSync(join(numericDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.11.0' }), 'utf8');

      const resolvedNumericOnly = await resolveInstalledPluginVersionAsync({
        homeDir: mpHome,
        allowScriptRelativeFallback: false,
        fallbackVersion: null
      });
      assert.strictEqual(resolvedNumericOnly.version, '1.11.0', 'Must resolve Marketplace numeric dir with matching name');

      const standardMpDir = join(mpHome, '.gemini', 'config', 'plugins', 'antigravity-cli-statusline');
      mkdirSync(standardMpDir, { recursive: true });
      writeFileSync(join(standardMpDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.11.4' }), 'utf8');
      const resolvedCoexist = await resolveInstalledPluginVersionAsync({
        homeDir: mpHome,
        allowScriptRelativeFallback: false,
        fallbackVersion: null
      });
      assert.strictEqual(resolvedCoexist.version, '1.11.4', 'Higher SemVer standard plugin dir must beat legacy numeric dir');

      const agentsOnlyHome = join(sandboxR35, 'agents-home');
      const agentsPluginDir = join(agentsOnlyHome, '.agents', 'plugins', 'antigravity-cli-statusline');
      mkdirSync(agentsPluginDir, { recursive: true });
      writeFileSync(join(agentsPluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.11.2' }), 'utf8');
      const resolvedAgents = await resolveInstalledPluginVersionAsync({
        homeDir: agentsOnlyHome,
        allowScriptRelativeFallback: false,
        fallbackVersion: null
      });
      assert.strictEqual(resolvedAgents.version, '1.11.2', 'Must resolve .agents/plugins/antigravity-cli-statusline');

      // E2. When disabled (plugin-version not in ui.footer.items), never checks GitHub or writes cache
      let fetchCalls = 0;
      const disabledRes = await checkPluginUpdateAsync({
        enabled: false,
        homeDir: fakeHomeR35,
        cachePath: cachePathR35,
        session: { found: true, pid: 1001, startTime: 't1', nonInteractive: false, sessionKey: '1001:t1' },
        fetchReleaseFn: async () => { fetchCalls++; return { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' }; }
      });
      assert.strictEqual(disabledRes.checked, false);
      assert.strictEqual(disabledRes.updateAvailable, false);
      assert.strictEqual(fetchCalls, 0);
      assert.strictEqual(existsSync(cachePathR35), false, 'Cache must not be written when plugin-version is disabled');

      // E3. agy -p non-interactive session must skip query & cache write
      const nonInterRes = await checkPluginUpdateAsync({
        enabled: true,
        homeDir: fakeHomeR35,
        cachePath: cachePathR35,
        session: { found: true, pid: 1000, startTime: 't0', nonInteractive: true, sessionKey: '1000:t0' },
        fetchReleaseFn: async () => { fetchCalls++; return { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' }; }
      });
      assert.strictEqual(nonInterRes.skippedNonInteractive, true);
      assert.strictEqual(nonInterRes.checked, false);
      assert.strictEqual(fetchCalls, 0);
      assert.strictEqual(existsSync(cachePathR35), false);

      // E4. First open ever & offline failure: records failed marker, does not retry in same session, no error shown
      const offlineFirstOpen = await checkPluginUpdateAsync({
        enabled: true,
        homeDir: fakeHomeR35,
        cachePath: cachePathR35,
        session: { found: true, pid: 1001, startTime: 't1', nonInteractive: false, sessionKey: '1001:t1' },
        fetchReleaseFn: async () => { fetchCalls++; return { ok: false, error: 'offline' }; }
      });
      assert.strictEqual(offlineFirstOpen.checked, true);
      assert.strictEqual(offlineFirstOpen.updateAvailable, false);
      assert.strictEqual(fetchCalls, 1);
      const cacheAfterOfflineFirst = JSON.parse(readFileSync(cachePathR35, 'utf8'));
      assert.strictEqual(cacheAfterOfflineFirst.lastSessionKey, '1001:t1');
      assert.strictEqual(cacheAfterOfflineFirst.lastSessionStatus, 'failed');

      const offlineSameSessionRetry = await checkPluginUpdateAsync({
        enabled: true,
        homeDir: fakeHomeR35,
        cachePath: cachePathR35,
        session: { found: true, pid: 1001, startTime: 't1', nonInteractive: false, sessionKey: '1001:t1' },
        fetchReleaseFn: async () => { fetchCalls++; return { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' }; }
      });
      assert.strictEqual(offlineSameSessionRetry.checked, false, 'Must NOT retry GitHub within the same agy session after failure');
      assert.strictEqual(fetchCalls, 1);

      // E5. Restart interactive agy (new PID/startTime): fetches 1.12.0, writes ok cache, detects updateAvailable
      const onlineRestart = await checkPluginUpdateAsync({
        enabled: true,
        homeDir: fakeHomeR35,
        cachePath: cachePathR35,
        session: { found: true, pid: 1002, startTime: 't2', nonInteractive: false, sessionKey: '1002:t2' },
        fetchReleaseFn: async () => { fetchCalls++; return { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' }; }
      });
      assert.strictEqual(onlineRestart.checked, true);
      assert.strictEqual(onlineRestart.updateAvailable, true);
      assert.strictEqual(onlineRestart.latestTag, 'v1.12.0');
      assert.strictEqual(fetchCalls, 2);

      // Same session second render does NOT fetch again
      const sameSessionSecondRender = await checkPluginUpdateAsync({
        enabled: true,
        homeDir: fakeHomeR35,
        cachePath: cachePathR35,
        session: { found: true, pid: 1002, startTime: 't2', nonInteractive: false, sessionKey: '1002:t2' },
        fetchReleaseFn: async () => { fetchCalls++; return { ok: true, latestVersion: '1.13.0', latestTag: 'v1.13.0' }; }
      });
      assert.strictEqual(sameSessionSecondRender.checked, false);
      assert.strictEqual(sameSessionSecondRender.updateAvailable, true);
      assert.strictEqual(fetchCalls, 2);

      // E6. New restart while OFFLINE: queries once, fails, writes failed marker, keeps cached 1.12.0 and still shows updateAvailable
      const offlineWithCacheRestart = await checkPluginUpdateAsync({
        enabled: true,
        homeDir: fakeHomeR35,
        cachePath: cachePathR35,
        session: { found: true, pid: 1003, startTime: 't3', nonInteractive: false, sessionKey: '1003:t3' },
        fetchReleaseFn: async () => { fetchCalls++; throw new Error('network down'); }
      });
      assert.strictEqual(offlineWithCacheRestart.checked, true);
      assert.strictEqual(offlineWithCacheRestart.updateAvailable, true, 'Must preserve cached latestVersion 1.12.0 when offline');
      assert.strictEqual(offlineWithCacheRestart.latestVersion, '1.12.0');
      assert.strictEqual(fetchCalls, 3);
      const cacheAfterOfflineWithPrev = JSON.parse(readFileSync(cachePathR35, 'utf8'));
      assert.strictEqual(cacheAfterOfflineWithPrev.lastSessionKey, '1003:t3');
      assert.strictEqual(cacheAfterOfflineWithPrev.lastSessionStatus, 'failed');
      assert.strictEqual(cacheAfterOfflineWithPrev.latestVersion, '1.12.0');

      // Same failed session third restart still won't retry
      await checkPluginUpdateAsync({
        enabled: true,
        homeDir: fakeHomeR35,
        cachePath: cachePathR35,
        session: { found: true, pid: 1003, startTime: 't3', nonInteractive: false, sessionKey: '1003:t3' },
        fetchReleaseFn: async () => { fetchCalls++; return { ok: true, latestVersion: '9.9.9', latestTag: 'v9.9.9' }; }
      });
      assert.strictEqual(fetchCalls, 3);

      // E7. Simulate ! agy plugin install updating plugin.json to 1.12.0 -> version catches up, updateAvailable immediately false
      writeFileSync(join(pluginDirR35, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.12.0' }), 'utf8');
      const afterInstallUpdate = await checkPluginUpdateAsync({
        enabled: true,
        homeDir: fakeHomeR35,
        cachePath: cachePathR35,
        session: { found: true, pid: 1003, startTime: 't3', nonInteractive: false, sessionKey: '1003:t3' },
        fetchReleaseFn: async () => { fetchCalls++; return { ok: true, latestVersion: '9.9.9', latestTag: 'v9.9.9' }; }
      });
      assert.strictEqual(afterInstallUpdate.installedTag, 'v1.12.0');
      assert.strictEqual(afterInstallUpdate.updateAvailable, false);
      assert.strictEqual(fetchCalls, 3);

      // E7b. Concurrent calls for the same brand-new sessionKey must only fetch ONCE and never clobber 'ok'
      const concurrentCachePath = join(fakeHomeR35, '.gemini', 'tmp', 'plugin_update_cache_concurrent.json');
      writeFileSync(join(pluginDirR35, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.11.4' }), 'utf8');
      let concurrentFetches = 0;
      const concurrentFetchFn = async () => {
        concurrentFetches++;
        await new Promise(r => setTimeout(r, 40));
        return { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' };
      };
      const [concA, concB] = await Promise.all([
        checkPluginUpdateAsync({
          enabled: true,
          homeDir: fakeHomeR35,
          cachePath: concurrentCachePath,
          session: { found: true, pid: 1099, startTime: 't99', nonInteractive: false, sessionKey: '1099:t99' },
          fetchReleaseFn: concurrentFetchFn
        }),
        checkPluginUpdateAsync({
          enabled: true,
          homeDir: fakeHomeR35,
          cachePath: concurrentCachePath,
          session: { found: true, pid: 1099, startTime: 't99', nonInteractive: false, sessionKey: '1099:t99' },
          fetchReleaseFn: concurrentFetchFn
        })
      ]);
      assert.strictEqual(concurrentFetches, 1, 'Concurrent startup calls for the same sessionKey must only issue 1 fetch');
      const checkedCallers = [concA, concB].filter(r => r.checked);
      const skippedCallers = [concA, concB].filter(r => !r.checked);
      assert.strictEqual(checkedCallers.length, 1);
      assert.strictEqual(skippedCallers.length, 1);
      assert.strictEqual(checkedCallers[0].updateAvailable, true);
      const concurrentSaved = JSON.parse(readFileSync(concurrentCachePath, 'utf8'));
      assert.strictEqual(concurrentSaved.lastSessionStatus, 'ok');
      assert.strictEqual(concurrentSaved.latestVersion, '1.12.0');

      // E7c. Total budget clamping when session lookup consumes significant time
      const budgetCachePath = join(fakeHomeR35, '.gemini', 'tmp', 'plugin_update_cache_budget.json');
      let observedFetchTimeout = 0;
      await checkPluginUpdateAsync({
        enabled: true,
        homeDir: fakeHomeR35,
        cachePath: budgetCachePath,
        platform: 'darwin',
        ppid: 4242,
        env: {},
        sessionTimeoutMs: 2000,
        execFn: async (_cmd, opts) => {
          const query = opts.execArgs[2];
          if (query.startsWith('pid=')) {
            await new Promise(r => setTimeout(r, 1300));
            return { ok: true, stdout: '4242 1 Wed Nov 18 09:00:00 2026 agy\n' };
          }
          if (query === 'args=') return { ok: true, stdout: 'agy\n' };
          return { ok: false, stdout: '' };
        },
        fetchReleaseFn: async (_url, tMs) => {
          observedFetchTimeout = tMs;
          return { ok: true, latestVersion: '1.11.4', latestTag: 'v1.11.4' };
        }
      });
      assert.ok(observedFetchTimeout >= 400 && observedFetchTimeout <= 1050, `Expected clamped timeoutMs within [400, 1050], got ${observedFetchTimeout}`);

      // E7d. 預設 900ms 的 macOS / Linux 整體 sessionTimeoutMs 必須乾淨中止 1300ms 停滯的行程樹追溯（Bug #2）
      const stalledExecFn = async (_cmd, opts) => {
        const query = opts.execArgs[2];
        if (query.startsWith('pid=')) {
          await new Promise(r => setTimeout(r, 1300));
          return { ok: true, stdout: '4242 1 Wed Nov 18 09:00:00 2026 agy\n' };
        }
        if (query === 'args=') return { ok: true, stdout: 'agy\n' };
        return { ok: false, stdout: '' };
      };
      const stalledStartedAt = Date.now();
      const stalledSession = await resolveAgySessionAsync({
        platform: 'darwin',
        ppid: 4242,
        env: {},
        execFn: stalledExecFn
      });
      const stalledElapsed = Date.now() - stalledStartedAt;
      assert.deepStrictEqual(stalledSession, { found: false, pid: 0, startTime: '', nonInteractive: false, sessionKey: '' }, 'Default 900ms sessionTimeoutMs must abort a 1300ms-stalled walk with { found: false }');
      assert.ok(stalledElapsed < 1250, `Default session timeout must return before the stalled 1300ms exec finishes, took ${stalledElapsed}ms`);

      // 同一停滯情境下，顯式放寬 sessionTimeoutMs 為 2000ms 時應能成功取得會話
      const relaxedSession = await resolveAgySessionAsync({
        platform: 'darwin',
        ppid: 4242,
        env: {},
        sessionTimeoutMs: 2000,
        execFn: stalledExecFn
      });
      assert.strictEqual(relaxedSession.found, true, 'sessionTimeoutMs: 2000 must allow the 1300ms walk to finish');
      assert.strictEqual(relaxedSession.pid, 4242);

      // 逾時視為找不到會話時，checkPluginUpdateAsync 不得查詢 GitHub 也不得寫入快取
      const stalledCachePath = join(fakeHomeR35, '.gemini', 'tmp', 'plugin_update_cache_stalled.json');
      let stalledFetches = 0;
      const stalledCheck = await checkPluginUpdateAsync({
        enabled: true,
        homeDir: fakeHomeR35,
        cachePath: stalledCachePath,
        platform: 'darwin',
        ppid: 4242,
        env: {},
        execFn: stalledExecFn,
        fetchReleaseFn: async () => { stalledFetches++; return { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' }; }
      });
      assert.strictEqual(stalledCheck.checked, false);
      assert.strictEqual(stalledFetches, 0, 'No session resolved -> must not hit GitHub');
      assert.strictEqual(existsSync(stalledCachePath), false, 'No session resolved -> must not write cache');

      // ----------------------------------------------------
      // G. Bug #1 回歸測試：多視窗併行 agy 會話之 checkedSessions
      // ----------------------------------------------------
      const bug1Home = join(sandboxR35, 'bug1-home');
      const bug1PluginDir = join(bug1Home, '.gemini', 'config', 'plugins', 'antigravity-cli-statusline');
      mkdirSync(bug1PluginDir, { recursive: true });
      mkdirSync(join(bug1Home, '.gemini', 'tmp'), { recursive: true });
      writeFileSync(join(bug1PluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.11.4' }), 'utf8');
      const mkSession = (pid, startTime) => ({ found: true, pid, startTime, nonInteractive: false, sessionKey: `${pid}:${startTime}` });
      const mkCheckOpts = (cachePath, session, fetchFn) => ({
        enabled: true,
        homeDir: bug1Home,
        cachePath,
        session,
        fetchReleaseFn: fetchFn
      });

      // G1. 視窗 A 與 B 交替渲染：不得互相覆寫 checkedSessions、不得來回重複查詢 GitHub
      const pingPongCache = join(bug1Home, '.gemini', 'tmp', 'plugin_update_cache_pingpong.json');
      let pingPongFetches = 0;
      const pingPongFetch = async () => { pingPongFetches++; return { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' }; };
      const sessionA = mkSession(7001, 'win-A');
      const sessionB = mkSession(7002, 'win-B');

      const aFirst = await checkPluginUpdateAsync(mkCheckOpts(pingPongCache, sessionA, pingPongFetch));
      assert.strictEqual(aFirst.checked, true);
      assert.strictEqual(pingPongFetches, 1);
      const bFirst = await checkPluginUpdateAsync(mkCheckOpts(pingPongCache, sessionB, pingPongFetch));
      assert.strictEqual(bFirst.checked, true, 'Window B is a brand-new session and must be checked once');
      assert.strictEqual(pingPongFetches, 2);

      for (let round = 0; round < 3; round++) {
        const aAgain = await checkPluginUpdateAsync(mkCheckOpts(pingPongCache, sessionA, pingPongFetch));
        const bAgain = await checkPluginUpdateAsync(mkCheckOpts(pingPongCache, sessionB, pingPongFetch));
        assert.strictEqual(aAgain.checked, false, `Round ${round}: window A must not re-hit GitHub after window B ran`);
        assert.strictEqual(bAgain.checked, false, `Round ${round}: window B must not re-hit GitHub after window A ran`);
        assert.strictEqual(aAgain.updateAvailable, true);
        assert.strictEqual(bAgain.updateAvailable, true);
      }
      assert.strictEqual(pingPongFetches, 2, 'Interleaved renders of two windows must produce exactly 2 GitHub fetches total (no ping-pong)');
      const pingPongSaved = JSON.parse(readFileSync(pingPongCache, 'utf8'));
      assert.deepStrictEqual(Object.keys(pingPongSaved.checkedSessions).sort(), [sessionA.sessionKey, sessionB.sessionKey].sort(), 'Both window sessions must be retained in checkedSessions');
      assert.strictEqual(pingPongSaved.checkedSessions[sessionA.sessionKey].status, 'ok');
      assert.strictEqual(pingPongSaved.checkedSessions[sessionB.sessionKey].status, 'ok');
      assert.strictEqual(typeof pingPongSaved.checkedSessions[sessionA.sessionKey].attemptAt, 'number');
      assert.strictEqual(pingPongSaved.lastSessionKey, sessionB.sessionKey, 'lastSessionKey stays backward-compatible (most recent claimed session)');
      assert.strictEqual(pingPongSaved.lastSessionStatus, 'ok');
      assert.strictEqual(pingPongSaved.latestVersion, '1.12.0');

      // G1b. 兩視窗同時啟動（併發）時各自只查詢一次，且兩筆紀錄皆保留
      const concurrentWinCache = join(bug1Home, '.gemini', 'tmp', 'plugin_update_cache_concurrent_windows.json');
      let concurrentWinFetches = 0;
      const concurrentWinFetch = async () => {
        concurrentWinFetches++;
        await new Promise(r => setTimeout(r, 30));
        return { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' };
      };
      await Promise.all([
        checkPluginUpdateAsync(mkCheckOpts(concurrentWinCache, mkSession(7101, 'cw-A'), concurrentWinFetch)),
        checkPluginUpdateAsync(mkCheckOpts(concurrentWinCache, mkSession(7102, 'cw-B'), concurrentWinFetch))
      ]);
      assert.strictEqual(concurrentWinFetches, 2);
      const concurrentWinSaved = JSON.parse(readFileSync(concurrentWinCache, 'utf8'));
      assert.ok(concurrentWinSaved.checkedSessions['7101:cw-A'], 'Concurrent window A must be retained');
      assert.ok(concurrentWinSaved.checkedSessions['7102:cw-B'], 'Concurrent window B must be retained');

      // G2. 裁剪：保留最新 <= 32 筆與當前 sessionKey，丟棄超過 7 天的過期紀錄
      const pruneCache = join(bug1Home, '.gemini', 'tmp', 'plugin_update_cache_prune.json');
      const pruneNow = Date.now();
      const seededSessions = {};
      for (let i = 0; i < 35; i++) {
        seededSessions[`recent-${i}`] = { status: 'ok', attemptAt: pruneNow - (i + 1) * 1000 };
      }
      const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
      for (let i = 0; i < 3; i++) {
        seededSessions[`stale-${i}`] = { status: 'ok', attemptAt: pruneNow - eightDaysMs - i * 1000 };
      }
      writeFileSync(pruneCache, JSON.stringify({
        latestVersion: '1.12.0',
        latestTag: 'v1.12.0',
        lastSessionKey: 'recent-0',
        lastSessionStatus: 'ok',
        lastAttemptAt: pruneNow - 1000,
        checkedSessions: seededSessions
      }), 'utf8');
      const pruneResult = await checkPluginUpdateAsync(mkCheckOpts(pruneCache, mkSession(7201, 'prune-new'), async () => ({ ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' })));
      assert.strictEqual(pruneResult.checked, true);
      const prunedSaved = JSON.parse(readFileSync(pruneCache, 'utf8'));
      const prunedKeys = Object.keys(prunedSaved.checkedSessions);
      assert.ok(prunedKeys.length <= 32, `checkedSessions must be capped at 32 entries, got ${prunedKeys.length}`);
      assert.ok(prunedKeys.includes('7201:prune-new'), 'Current sessionKey must always be retained');
      for (let i = 0; i < 3; i++) {
        assert.ok(!prunedKeys.includes(`stale-${i}`), `Entry stale-${i} older than 7 days must be dropped`);
      }
      for (let i = 0; i < 31; i++) {
        assert.ok(prunedKeys.includes(`recent-${i}`), `Newest entries must be retained (recent-${i})`);
      }
      for (let i = 31; i < 35; i++) {
        assert.ok(!prunedKeys.includes(`recent-${i}`), `Oldest entries beyond the cap must be dropped (recent-${i})`);
      }

      // G3. 僅有舊版 lastSessionKey（無 checkedSessions）的快取：無痛遷移且不重複查詢
      const legacyCache = join(bug1Home, '.gemini', 'tmp', 'plugin_update_cache_legacy.json');
      const legacyAttemptAt = Date.now() - 5000;
      writeFileSync(legacyCache, JSON.stringify({
        latestVersion: '1.12.0',
        latestTag: 'v1.12.0',
        latestCheckedAt: legacyAttemptAt,
        lastSessionKey: '7301:legacy',
        lastSessionStatus: 'ok',
        lastAttemptAt: legacyAttemptAt
      }), 'utf8');
      let legacyFetches = 0;
      const legacyFetch = async () => { legacyFetches++; return { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' }; };
      const legacySame = await checkPluginUpdateAsync(mkCheckOpts(legacyCache, mkSession(7301, 'legacy'), legacyFetch));
      assert.strictEqual(legacySame.checked, false, 'Legacy lastSessionKey must still be treated as already checked');
      assert.strictEqual(legacySame.updateAvailable, true);
      assert.strictEqual(legacyFetches, 0);

      const legacyNew = await checkPluginUpdateAsync(mkCheckOpts(legacyCache, mkSession(7302, 'new-window'), legacyFetch));
      assert.strictEqual(legacyNew.checked, true);
      assert.strictEqual(legacyFetches, 1);
      const legacyMigrated = JSON.parse(readFileSync(legacyCache, 'utf8'));
      assert.ok(legacyMigrated.checkedSessions['7301:legacy'], 'Legacy lastSessionKey must be migrated into checkedSessions');
      assert.strictEqual(legacyMigrated.checkedSessions['7301:legacy'].status, 'ok');
      assert.strictEqual(legacyMigrated.checkedSessions['7301:legacy'].attemptAt, legacyAttemptAt);
      assert.ok(legacyMigrated.checkedSessions['7302:new-window']);
      assert.strictEqual(legacyMigrated.lastSessionKey, '7302:new-window');

      const legacyBack = await checkPluginUpdateAsync(mkCheckOpts(legacyCache, mkSession(7301, 'legacy'), legacyFetch));
      assert.strictEqual(legacyBack.checked, false, 'Migrated legacy window must not re-hit GitHub after another window ran');
      assert.strictEqual(legacyFetches, 1);

      // ----------------------------------------------------
      // H. Bug #2 回歸測試：Windows PowerShell 提早 break 與 main() 併行
      // ----------------------------------------------------
      let capturedPsScript = '';
      let capturedPsCommand = '';
      const winPayload = JSON.stringify([
        { pid: 9100, ppid: 9000, name: 'agy.exe', start: '2026-11-18T01:00:00.000Z', cmd: '"C:\\Agy\\agy.exe" --model flash' }
      ]);
      const winBreakSession = await resolveAgySessionAsync({
        platform: 'win32',
        ppid: 9200,
        env: {},
        execFn: async (cmd, opts) => {
          capturedPsCommand = cmd;
          capturedPsScript = (opts.execArgs || [])[2] || '';
          return { ok: true, stdout: winPayload };
        }
      });
      assert.strictEqual(winBreakSession.found, true);
      assert.strictEqual(winBreakSession.pid, 9100);
      assert.ok(capturedPsScript.startsWith('$cur = 9200;'), `PowerShell script must start from ppid, got: ${capturedPsScript.slice(0, 40)}`);
      assert.ok(capturedPsCommand.includes('powershell.exe'), 'Windows walk must invoke powershell.exe');
      // 追加鏈結點之後、移動到父行程之前，必須有「符合非 --hub 的 agy / agy.exe 即 break」的判斷
      const chainAddIdx = capturedPsScript.indexOf('$chain += ');
      const agyBreakMatch = /\(\$p\.Name -match '\^agy\(\\\\?\.exe\)\?\$'[^]*?\$p\.CommandLine -notmatch '\(\^\|\\s\)--hub\(=\|\\s\|\$\)'\) \{ break \}/.exec(capturedPsScript);
      const nextParentIdx = capturedPsScript.indexOf('$next = [int]$p.ParentProcessId');
      assert.ok(chainAddIdx > 0, 'Script must append the node to $chain');
      assert.ok(agyBreakMatch, `Script must break early on matching non-hub agy/agy.exe, got: ${capturedPsScript}`);
      assert.ok(agyBreakMatch.index > chainAddIdx, 'Early break check must run after the node is appended to $chain');
      assert.ok(nextParentIdx > agyBreakMatch.index + agyBreakMatch[0].length - 1, 'Early break check must run before walking to the parent process');
      assert.ok(capturedPsScript.includes('agy(\\\\.exe)?') || capturedPsScript.includes('agy(\\.exe)?'), 'Script must match both agy and agy.exe');
      assert.ok(capturedPsScript.includes('--hub'), 'Script must exclude --hub processes from the early break');

      // H2. main() 以 Promise.all 併行執行 pluginUpdatePromise 與 extractMetricsAsync（靜態檢查）
      const mainSource = readFileSync(SCRIPT_PATH, 'utf8');
      assert.ok(
        /Promise\.all\(\[\s*pluginUpdatePromise,\s*extractMetricsAsync\(/.test(mainSource),
        'statusline-quota.mjs main() must run pluginUpdatePromise and extractMetricsAsync in parallel via Promise.all'
      );
      assert.ok(/skipPluginVersionResolve:\s*needsPluginUpdate/.test(mainSource), 'main() must skip the redundant plugin version resolve inside extractMetricsAsync');

      // E8. formatPluginUpdateNoticeLines across all 4 locales
      const expectedNoticePrefix = {
        'zh-tw': '狀態列有新版本可用',
        'zh-cn': '状态栏有新版本可用',
        'us': 'Statusline update available',
        'jp': 'ステータスラインの新バージョンが利用可能です'
      };
      for (const lang of ['zh-tw', 'zh-cn', 'us', 'jp']) {
        const notice = formatPluginUpdateNoticeLines(lang, 'v1.11.0', 'v1.11.4');
        assert.strictEqual(notice.length, 2, `[${lang}] Notice must be fixed at 2 lines`);
        const p1 = stripAnsi(notice[0]);
        const p2 = stripAnsi(notice[1]);
        assert.ok(p1.includes(expectedNoticePrefix[lang]), `[${lang}] Line 1 must use statusline wording: ${p1}`);
        assert.ok(p1.includes('v1.11.0') && p1.includes('v1.11.4'), `[${lang}] Line 1 must include version diff: ${p1}`);
        assert.strictEqual(p2, `agy plugin install ${PLUGIN_REPO_URL}`, `[${lang}] Line 2 must be exact install command without !`);
      }

      // E9. fetchLatestPluginReleaseAsync invalid URL / loopback HTTP (with graceful EPERM handling)
      assert.strictEqual((await fetchLatestPluginReleaseAsync('not-a-url')).error, 'invalid_url');
      assert.strictEqual((await fetchLatestPluginReleaseAsync('ftp://example.com')).error, 'unsupported_protocol');

      let serverPort = null;
      let releaseServerHits = 0;
      let tagPageHits = 0;
      try {
        releaseServer = http.createServer((req, res) => {
          releaseServerHits++;
          if (req.url === '/redirect') {
            res.writeHead(302, { Location: '/latest' });
            res.end();
          } else if (req.url === '/tag-redirect') {
            res.writeHead(302, { Location: '/AndyAWD/antigravity-cli-statusline/releases/tag/v1.12.0' });
            res.end();
          } else if (req.url === '/bad-tag-redirect') {
            res.writeHead(302, { Location: '/AndyAWD/antigravity-cli-statusline/releases/tag/nightly' });
            res.end();
          } else if (req.url.startsWith('/AndyAWD/antigravity-cli-statusline/releases/tag/')) {
            tagPageHits++;
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html>should not be downloaded</html>');
          } else if (req.url === '/latest') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ tag_name: 'v1.12.0' }));
          } else if (req.url === '/err500') {
            res.writeHead(500);
            res.end('fail');
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ tag_name: 'bad-tag' }));
          }
        });
        await new Promise((resolve, reject) => {
          releaseServer.once('error', reject);
          releaseServer.listen(0, '127.0.0.1', () => {
            serverPort = releaseServer.address().port;
            resolve();
          });
        });
      } catch (bindErr) {
        if (bindErr && (bindErr.code === 'EPERM' || bindErr.code === 'EACCES')) {
          console.log('⚠️ Test R35 HTTP loopback bind blocked by sandbox (EPERM); continuing with pre-seeded cache E2E verification.');
          serverPort = null;
        } else {
          throw bindErr;
        }
      }

      if (serverPort) {
        const fetched200 = await fetchLatestPluginReleaseAsync(`http://127.0.0.1:${serverPort}/latest`, 1000);
        assert.deepStrictEqual(fetched200, { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' });
        const fetched302 = await fetchLatestPluginReleaseAsync(`http://127.0.0.1:${serverPort}/redirect`, 1000);
        assert.deepStrictEqual(fetched302, { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' });
        const fetchedTagRedirect = await fetchLatestPluginReleaseAsync(`http://127.0.0.1:${serverPort}/tag-redirect`, 1000);
        assert.deepStrictEqual(fetchedTagRedirect, { ok: true, latestVersion: '1.12.0', latestTag: 'v1.12.0' });
        const fetchedBadTagRedirect = await fetchLatestPluginReleaseAsync(`http://127.0.0.1:${serverPort}/bad-tag-redirect`, 1000);
        assert.strictEqual(fetchedBadTagRedirect.ok, false);
        assert.strictEqual(fetchedBadTagRedirect.error, 'invalid_tag');
        assert.strictEqual(tagPageHits, 0, 'Must extract tag directly from 302 Location without downloading HTML release page');
        const fetched500 = await fetchLatestPluginReleaseAsync(`http://127.0.0.1:${serverPort}/err500`, 1000);
        assert.strictEqual(fetched500.ok, false);
        assert.strictEqual(fetched500.error, 'http_500');
        const fetchedBadTag = await fetchLatestPluginReleaseAsync(`http://127.0.0.1:${serverPort}/badtag`, 1000);
        assert.strictEqual(fetchedBadTag.ok, false);
        assert.strictEqual(fetchedBadTag.error, 'invalid_tag');
      }

      // F. Full subprocess E2E with runStatusline
      const e2eHome = join(sandboxR35, 'e2e-home');
      const e2ePluginDir = join(e2eHome, '.gemini', 'config', 'plugins', 'antigravity-cli-statusline');
      const e2eCachePath = join(e2eHome, '.gemini', 'tmp', 'plugin_update_cache.json');
      mkdirSync(join(e2eHome, '.gemini', 'tmp'), { recursive: true });
      mkdirSync(e2ePluginDir, { recursive: true });
      writeFileSync(join(e2eHome, '.gemini', 'tmp', 'real_quota_cache.json'), JSON.stringify({ models: {} }), 'utf8');
      writeFileSync(join(e2ePluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.11.0' }), 'utf8');

      // F1. Only plugin-version enabled (even placed in the middle, WITHOUT plugin-update) -> shows version only, NEVER fetches release, writes cache, or prints update notice
      writeFileSync(join(e2eHome, '.gemini', 'settings.json'), JSON.stringify({
        ui: { language: 'zh-tw', footer: { items: ['cli-version', 'plugin-version', 'mode'] } }
      }), 'utf8');
      writeFileSync(e2eCachePath, JSON.stringify({
        latestVersion: '9.9.9',
        latestTag: 'v9.9.9',
        lastSessionKey: '2001:s1',
        lastSessionStatus: 'ok'
      }), 'utf8');
      const hitsBeforeVersionOnly = releaseServerHits;
      const e2eVersionOnly = await runStatusline(
        { model: { displayName: 'Gemini 3.8 Flash' }, version: '1.5.10', mode: 'default' },
        e2eHome,
        SCRIPT_PATH,
        {
          STATUSLINE_AGY_SESSION_JSON: JSON.stringify({ pid: 2001, startTime: 's1', nonInteractive: false }),
          ...(serverPort ? { STATUSLINE_PLUGIN_RELEASE_URL: `http://127.0.0.1:${serverPort}/latest` } : {})
        }
      );
      assert.strictEqual(e2eVersionOnly.code, 0);
      assert.strictEqual(stripAnsi(e2eVersionOnly.stdout).trim(), 'Agy CLI 版本: v1.5.10 │ 狀態列版本: v1.11.0 │ 模式: Default');
      assert.strictEqual(releaseServerHits, hitsBeforeVersionOnly, 'Enabling only plugin-version must not hit release server');
      rmSync(e2eCachePath, { force: true });

      const e2eVersionOnlyNoCache = await runStatusline(
        { model: { displayName: 'Gemini 3.8 Flash' }, version: '1.5.10' },
        e2eHome,
        SCRIPT_PATH,
        {
          STATUSLINE_AGY_SESSION_JSON: JSON.stringify({ pid: 2001, startTime: 's1', nonInteractive: false }),
          ...(serverPort ? { STATUSLINE_PLUGIN_RELEASE_URL: `http://127.0.0.1:${serverPort}/latest` } : {})
        }
      );
      assert.strictEqual(e2eVersionOnlyNoCache.code, 0);
      assert.strictEqual(stripAnsi(e2eVersionOnlyNoCache.stdout).trim(), 'Agy CLI 版本: v1.5.10 │ 狀態列版本: v1.11.0 │ 模式: Default');
      assert.strictEqual(existsSync(e2eCachePath), false, 'Update cache must stay absent when plugin-update is not enabled');
      assert.strictEqual(releaseServerHits, hitsBeforeVersionOnly);

      // F2. Non-interactive agy -p -> skipped even when both plugin-version & plugin-update are enabled
      writeFileSync(join(e2eHome, '.gemini', 'settings.json'), JSON.stringify({
        ui: { language: 'zh-tw', footer: { items: ['cli-version', 'plugin-version', 'plugin-update'] } }
      }), 'utf8');
      const e2eNonInter = await runStatusline(
        { model: { displayName: 'Gemini 3.8 Flash' }, version: '1.5.10' },
        e2eHome,
        SCRIPT_PATH,
        {
          STATUSLINE_AGY_SESSION_JSON: JSON.stringify({ pid: 2002, startTime: 's2', nonInteractive: true }),
          ...(serverPort ? { STATUSLINE_PLUGIN_RELEASE_URL: `http://127.0.0.1:${serverPort}/latest` } : {})
        }
      );
      assert.strictEqual(e2eNonInter.code, 0);
      assert.strictEqual(stripAnsi(e2eNonInter.stdout).trim(), 'Agy CLI 版本: v1.5.10 │ 狀態列版本: v1.11.0');
      assert.strictEqual(existsSync(e2eCachePath), false);
      assert.strictEqual(releaseServerHits, hitsBeforeVersionOnly);

      // F3. Interactive agy first open with plugin-version + plugin-update enabled across all 4 locales
      if (!serverPort) {
        // Pre-seed cache with same session key when sandbox blocks loopback HTTP
        writeFileSync(e2eCachePath, JSON.stringify({
          latestVersion: '1.12.0',
          latestTag: 'v1.12.0',
          lastSessionKey: '2003:s3',
          lastSessionStatus: 'ok'
        }), 'utf8');
      }
      const hitsBeforeInteractive = releaseServerHits;
      const e2eLocaleExpectations = {
        'zh-tw': { metricLine: 'Agy CLI 版本: v1.5.10 │ 狀態列版本: v1.11.0', noticeSub: '狀態列有新版本可用（目前 v1.11.0 → 最新 v1.12.0）' },
        'zh-cn': { metricLine: 'Agy CLI 版本: v1.5.10 │ 状态栏版本: v1.11.0', noticeSub: '状态栏有新版本可用（当前 v1.11.0 → 最新 v1.12.0）' },
        'us': { metricLine: 'Agy CLI Version: v1.5.10 │ Statusline Version: v1.11.0', noticeSub: 'Statusline update available (current v1.11.0 → latest v1.12.0)' },
        'jp': { metricLine: 'Agy CLI バージョン: v1.5.10 │ ステータスライン版: v1.11.0', noticeSub: 'ステータスラインの新バージョンが利用可能です（現在 v1.11.0 → 最新 v1.12.0）' }
      };
      for (const [loc, exp] of Object.entries(e2eLocaleExpectations)) {
        writeFileSync(join(e2eHome, '.gemini', 'settings.json'), JSON.stringify({
          ui: { language: loc, footer: { items: ['cli-version', 'plugin-version', 'plugin-update'] } }
        }), 'utf8');
        const resLoc = await runStatusline(
          { model: { displayName: 'Gemini 3.8 Flash' }, version: '1.5.10' },
          e2eHome,
          SCRIPT_PATH,
          {
            STATUSLINE_AGY_SESSION_JSON: JSON.stringify({ pid: 2003, startTime: 's3', nonInteractive: false }),
            ...(serverPort ? { STATUSLINE_PLUGIN_RELEASE_URL: `http://127.0.0.1:${serverPort}/latest` } : {})
          }
        );
        assert.strictEqual(resLoc.code, 0);
        const lines = stripAnsi(resLoc.stdout).trimEnd().split(/\r?\n/);
        assert.strictEqual(lines.length, 3, `[${loc}] Expected 1 metric line + 2 notice lines, got: ${JSON.stringify(lines)}`);
        assert.strictEqual(lines[0], exp.metricLine);
        assert.ok(lines[1].includes(exp.noticeSub), `[${loc}] Unexpected notice line: ${lines[1]}`);
        assert.strictEqual(lines[2], `agy plugin install ${PLUGIN_REPO_URL}`);
      }
      if (serverPort) {
        assert.strictEqual(releaseServerHits - hitsBeforeInteractive, 1, 'Live local HTTP server must be hit ONLY ONCE across 4 renders in the same agy session');
      }

      // F3b. Only plugin-update enabled (WITHOUT plugin-version) -> renders 2 update lines only
      writeFileSync(join(e2eHome, '.gemini', 'settings.json'), JSON.stringify({
        ui: { language: 'zh-tw', footer: { items: ['plugin-update'] } }
      }), 'utf8');
      const e2eUpdateOnly = await runStatusline(
        { model: { displayName: 'Gemini 3.8 Flash' }, version: '1.5.10' },
        e2eHome,
        SCRIPT_PATH,
        {
          STATUSLINE_AGY_SESSION_JSON: JSON.stringify({ pid: 2003, startTime: 's3', nonInteractive: false }),
          ...(serverPort ? { STATUSLINE_PLUGIN_RELEASE_URL: `http://127.0.0.1:${serverPort}/latest` } : {})
        }
      );
      assert.strictEqual(e2eUpdateOnly.code, 0);
      const updateOnlyLines = stripAnsi(e2eUpdateOnly.stdout).trimEnd().split(/\r?\n/);
      assert.strictEqual(updateOnlyLines.length, 2);
      assert.ok(updateOnlyLines[0].includes('狀態列有新版本可用（目前 v1.11.0 → 最新 v1.12.0）'));
      assert.strictEqual(updateOnlyLines[1], `agy plugin install ${PLUGIN_REPO_URL}`);

      // F3c. Free placement + leading/trailing n,n trimming + emoji style for plugin-update
      writeFileSync(join(e2eHome, '.gemini', 'settings.json'), JSON.stringify({
        ui: {
          language: 'zh-tw',
          footer: {
            items: ['plugin-update', 'n', 'n', 'cli-version', 'plugin-version'],
            itemStyles: { 'plugin-update': 'emoji' }
          }
        }
      }), 'utf8');
      const e2eTopUpdate = await runStatusline(
        { model: { displayName: 'Gemini 3.8 Flash' }, version: '1.5.10' },
        e2eHome,
        SCRIPT_PATH,
        {
          STATUSLINE_AGY_SESSION_JSON: JSON.stringify({ pid: 2003, startTime: 's3', nonInteractive: false }),
          ...(serverPort ? { STATUSLINE_PLUGIN_RELEASE_URL: `http://127.0.0.1:${serverPort}/latest` } : {})
        }
      );
      assert.strictEqual(e2eTopUpdate.code, 0);
      const topUpdateLines = stripAnsi(e2eTopUpdate.stdout).trimEnd().split(/\r?\n/);
      assert.strictEqual(topUpdateLines.length, 5, `Expected 2 emoji update lines + 2 blank lines from n,n after block + 1 metric line, got: ${JSON.stringify(topUpdateLines)}`);
      assert.strictEqual(topUpdateLines[0], '🆕 v1.11.0 → v1.12.0');
      assert.strictEqual(topUpdateLines[1], `agy plugin install ${PLUGIN_REPO_URL}`);
      assert.strictEqual(topUpdateLines[2].trim(), '');
      assert.strictEqual(topUpdateLines[3].trim(), '');
      assert.strictEqual(topUpdateLines[4], 'Agy CLI 版本: v1.5.10 │ 狀態列版本: v1.11.0');

      // F4. Simulate running agy plugin install updating plugin.json to 1.12.0 -> version updates, notice disappears & leading n,n trimmed
      writeFileSync(join(e2ePluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.12.0' }), 'utf8');
      const e2eAfterUpgrade = await runStatusline(
        { model: { displayName: 'Gemini 3.8 Flash' }, version: '1.5.10' },
        e2eHome,
        SCRIPT_PATH,
        {
          STATUSLINE_AGY_SESSION_JSON: JSON.stringify({ pid: 2003, startTime: 's3', nonInteractive: false }),
          ...(serverPort ? { STATUSLINE_PLUGIN_RELEASE_URL: `http://127.0.0.1:${serverPort}/latest` } : {})
        }
      );
      assert.strictEqual(e2eAfterUpgrade.code, 0);
      const linesAfterUpgrade = stripAnsi(e2eAfterUpgrade.stdout).trimEnd().split(/\r?\n/);
      assert.deepStrictEqual(linesAfterUpgrade, ['Agy CLI 版本: v1.5.10 │ 狀態列版本: v1.12.0']);

      // F4b. Bug #2：main() 併行執行外掛更新檢查與系統探測（以事件時間軸證明重疊，而非脆弱的總耗時門檻）
      if (process.platform !== 'win32') {
        const parHome = join(sandboxR35, 'parallel-home');
        const parPluginDir = join(parHome, '.gemini', 'config', 'plugins', 'antigravity-cli-statusline');
        const parBinDir = join(sandboxR35, 'parallel-bin');
        const parGitLog = join(sandboxR35, 'parallel-git-calls.log');
        mkdirSync(join(parHome, '.gemini', 'tmp'), { recursive: true });
        mkdirSync(parPluginDir, { recursive: true });
        mkdirSync(parBinDir, { recursive: true });
        writeFileSync(join(parHome, '.gemini', 'tmp', 'real_quota_cache.json'), JSON.stringify({ models: {} }), 'utf8');
        writeFileSync(join(parPluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.11.0' }), 'utf8');
        writeFileSync(join(parHome, '.gemini', 'settings.json'), JSON.stringify({
          ui: { language: 'us', footer: { items: ['git-branch', 'plugin-version', 'plugin-update'] } }
        }), 'utf8');
        // 假的 git：記錄被呼叫的起訖時間戳記並回傳分支名稱
        writeFileSync(join(parBinDir, 'git'), `#!${process.execPath}
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(parGitLog)}, 'start ' + Date.now() + '\\n');
setTimeout(() => {
  fs.appendFileSync(${JSON.stringify(parGitLog)}, 'end ' + Date.now() + '\\n');
  process.stdout.write('parallel-branch\\n');
}, 150);
`, { mode: 0o755 });

        // 預熱假 git（首次執行新建立之可執行檔在部分系統較慢，可能超過探測的 500ms 逾時），再清除預熱記錄
        execFileSync(join(parBinDir, 'git'), ['--warmup'], { stdio: 'ignore' });
        rmSync(parGitLog, { force: true });

        const parTimeline = { requestAt: 0, responseAt: 0 };
        let parServer = null;
        let parPort = null;
        try {
          parServer = http.createServer((req, res) => {
            parTimeline.requestAt = Date.now();
            setTimeout(() => {
              parTimeline.responseAt = Date.now();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ tag_name: 'v1.12.0' }));
            }, 1200);
          });
          await new Promise((resolve, reject) => {
            parServer.once('error', reject);
            parServer.listen(0, '127.0.0.1', () => { parPort = parServer.address().port; resolve(); });
          });
        } catch (bindErr) {
          if (bindErr && (bindErr.code === 'EPERM' || bindErr.code === 'EACCES')) {
            console.log('⚠️ Test R35 F4b loopback bind blocked by sandbox (EPERM); skipping parallel timeline verification.');
            parPort = null;
          } else {
            throw bindErr;
          }
        }

        if (parPort) {
          try {
            const parRes = await runStatusline(
              { model: { displayName: 'Gemini 3.8 Flash' }, version: '1.5.10', project: { path: parHome } },
              parHome,
              SCRIPT_PATH,
              {
                PATH: `${parBinDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`,
                STATUSLINE_AGY_SESSION_JSON: JSON.stringify({ pid: 4001, startTime: 'par1', nonInteractive: false }),
                STATUSLINE_PLUGIN_RELEASE_URL: `http://127.0.0.1:${parPort}/latest`
              }
            );
            assert.strictEqual(parRes.code, 0, `stderr: ${parRes.stderr}`);
            const parLines = stripAnsi(parRes.stdout).trimEnd().split(/\r?\n/);
            assert.ok(parLines[0].includes('parallel-branch'), `Slow git probe result must still render, got: ${parLines[0]}`);
            assert.ok(parLines[0].includes('v1.11.0'), `Plugin version must still be populated after parallel run, got: ${parLines[0]}`);
            assert.strictEqual(parLines.length, 3, 'Update notice (2 lines) must still be appended after the status line');
            assert.ok(parTimeline.requestAt > 0 && parTimeline.responseAt > 0, 'Release server must have been hit');

            const gitEvents = readFileSync(parGitLog, 'utf8').trim().split(/\r?\n/).map(l => l.split(' '));
            const gitStart = Number(gitEvents.find(e => e[0] === 'start')[1]);
            assert.ok(gitStart < parTimeline.responseAt, `Slow git probe must start while the release request is still pending (gitStart=${gitStart}, releaseResponseAt=${parTimeline.responseAt}); sequential execution would start it only after the response`);
            assert.ok(gitStart >= parTimeline.requestAt - 1000, 'Sanity: git probe belongs to this run');
          } finally {
            try { await new Promise(resolve => parServer.close(resolve)); } catch (_) {}
          }
        }
      }

      // F5. Real OS process-tree E2E without STATUSLINE_AGY_SESSION_JSON when invoked inside an active interactive agy session
      if (liveSelfWalk.found && !liveSelfWalk.nonInteractive && serverPort) {
        const realTreeHome = join(sandboxR35, 'real-tree-home');
        const realTreePluginDir = join(realTreeHome, '.gemini', 'config', 'plugins', 'antigravity-cli-statusline');
        const realTreeCachePath = join(realTreeHome, '.gemini', 'tmp', 'plugin_update_cache.json');
        mkdirSync(join(realTreeHome, '.gemini', 'tmp'), { recursive: true });
        mkdirSync(realTreePluginDir, { recursive: true });
        writeFileSync(join(realTreeHome, '.gemini', 'tmp', 'real_quota_cache.json'), JSON.stringify({ models: {} }), 'utf8');
        writeFileSync(join(realTreePluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-cli-statusline', version: '1.11.0' }), 'utf8');
        writeFileSync(join(realTreeHome, '.gemini', 'settings.json'), JSON.stringify({
          ui: { language: 'zh-tw', footer: { items: ['cli-version', 'plugin-version', 'plugin-update'] } }
        }), 'utf8');

        const hitsBeforeReal = releaseServerHits;
        const realRun1 = await runStatusline(
          { model: { displayName: 'Gemini 3.8 Flash' }, version: '1.5.10' },
          realTreeHome,
          SCRIPT_PATH,
          { STATUSLINE_PLUGIN_RELEASE_URL: `http://127.0.0.1:${serverPort}/latest` }
        );
        const realRun2 = await runStatusline(
          { model: { displayName: 'Gemini 3.8 Flash' }, version: '1.5.10' },
          realTreeHome,
          SCRIPT_PATH,
          { STATUSLINE_PLUGIN_RELEASE_URL: `http://127.0.0.1:${serverPort}/latest` }
        );
        assert.strictEqual(realRun1.code, 0);
        assert.strictEqual(realRun2.code, 0);
        assert.strictEqual(releaseServerHits - hitsBeforeReal, 1, 'Real OS agy process-tree walk must hit release server ONLY ONCE across two renders');
        const realCache = JSON.parse(readFileSync(realTreeCachePath, 'utf8'));
        assert.strictEqual(realCache.lastSessionKey, liveSelfWalk.sessionKey);
        assert.strictEqual(realCache.lastSessionStatus, 'ok');
        const realLines1 = stripAnsi(realRun1.stdout).trimEnd().split(/\r?\n/);
        assert.strictEqual(realLines1.length, 3);
        assert.strictEqual(realLines1[2], `agy plugin install ${PLUGIN_REPO_URL}`);
      }

      console.log("✅ Test R35 passed! (cli-version rename, plugin-version, process-tree tracking & GitHub update check verified)");
    } finally {
      if (releaseServer) {
        try { await new Promise(resolve => releaseServer.close(resolve)); } catch (_) {}
      }
      try { rmSync(sandboxR35, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (_) {}
    }
  } catch (err) {
    console.error("Test R35 execution failed:", err);
    testsPassed = false;
  }

  if (testsPassed) {
    console.log("\n🎉 All plugin-update.test.mjs (R35) tests passed successfully!");
    process.exit(0);
  } else {
    console.error("\n❌ Some plugin-update.test.mjs (R35) tests failed.");
    process.exit(1);
  }
}

main();
