import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deriveAppRootFromLanguageServerPath,
  extractAppVersionFromPackageJson,
  extractExecutableFromAgentApiScript,
  parseInfoPlistVersion,
  parseSemverFromText,
  readAsarPackageVersionAsync,
  resolveInstalledAppVersionAsync,
  resolveInstalledCliVersionAsync
} from '../lib/collectors/versions.mjs';
import { buildI18nDict, extractMetricsAsync, stripAnsi } from '../statusline-quota.mjs';
import { rmRfSync, runStatusline } from './helpers.mjs';

/**
 * 建立最小合法 Electron ASAR 二進位緩衝區，僅包含 package.json 條目供跨平台讀取測試。
 * @param {object} pkgObj
 * @returns {Buffer}
 */
function buildTestAsarBuffer(pkgObj) {
  const pkgBytes = Buffer.from(JSON.stringify(pkgObj), 'utf8');
  const headerJson = JSON.stringify({
    files: {
      'package.json': {
        size: pkgBytes.length,
        offset: '0'
      }
    }
  });
  const headerJsonBytes = Buffer.from(headerJson, 'utf8');
  const padding = (4 - (headerJsonBytes.length % 4)) % 4;
  const headerPickleSize = 8 + headerJsonBytes.length + padding;
  const headerBuf = Buffer.alloc(16 + headerJsonBytes.length + padding);
  headerBuf.writeUInt32LE(4, 0);
  headerBuf.writeUInt32LE(headerPickleSize, 4);
  headerBuf.writeUInt32LE(headerPickleSize - 4, 8);
  headerBuf.writeUInt32LE(headerJsonBytes.length, 12);
  headerJsonBytes.copy(headerBuf, 16);
  return Buffer.concat([headerBuf, pkgBytes]);
}

test('parseSemverFromText & Info.plist / package.json parsers distinguish Antigravity 2.0 from IDE', () => {
  assert.equal(parseSemverFromText('1.5.15'), '1.5.15');
  assert.equal(parseSemverFromText('agy v1.5.15-beta.2\n'), '1.5.15-beta.2');
  assert.equal(parseSemverFromText('no version here'), '');

  const appPlist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.google.antigravity</string>
  <key>CFBundleShortVersionString</key><string>2.34.0</string>
</dict></plist>`;
  assert.equal(parseInfoPlistVersion(appPlist), '2.34.0');

  const idePlist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.google.antigravity-ide</string>
  <key>CFBundleShortVersionString</key><string>2.7.0</string>
</dict></plist>`;
  assert.equal(parseInfoPlistVersion(idePlist), '', 'Must exclude Antigravity IDE bundle');

  assert.equal(extractAppVersionFromPackageJson({ name: 'antigravity', version: '2.35.1' }), '2.35.1');
  assert.equal(extractAppVersionFromPackageJson({ name: 'antigravity-ide', version: '2.7.0' }), '');
});

test('extractExecutableFromAgentApiScript & deriveAppRootFromLanguageServerPath handle POSIX and Windows', () => {
  assert.equal(
    extractExecutableFromAgentApiScript('#!/bin/sh\nexec "/Applications/Antigravity.app/Contents/Resources/bin/language_server" agentapi "$@"\n'),
    '/Applications/Antigravity.app/Contents/Resources/bin/language_server'
  );
  assert.equal(
    extractExecutableFromAgentApiScript('#!/bin/sh\nexec "/Users/dev/.local/bin/agy" agentapi "$@"\n'),
    '/Users/dev/.local/bin/agy'
  );
  assert.equal(
    extractExecutableFromAgentApiScript('@echo off\r\n"C:\\Users\\Dev\\AppData\\Local\\Programs\\Antigravity\\resources\\bin\\language_server.exe" agentapi %*\r\n'),
    'C:\\Users\\Dev\\AppData\\Local\\Programs\\Antigravity\\resources\\bin\\language_server.exe'
  );

  assert.equal(
    deriveAppRootFromLanguageServerPath('/Applications/Antigravity.app/Contents/Resources/bin/language_server', 'darwin'),
    '/Applications/Antigravity.app'
  );
  assert.equal(
    deriveAppRootFromLanguageServerPath('C:\\Users\\Dev\\AppData\\Local\\Programs\\Antigravity\\resources\\bin\\language_server.exe', 'win32'),
    'C:\\Users\\Dev\\AppData\\Local\\Programs\\Antigravity'
  );
  assert.equal(
    deriveAppRootFromLanguageServerPath('/opt/Antigravity/resources/bin/language_server', 'linux'),
    '/opt/Antigravity'
  );
});

test('readAsarPackageVersionAsync reads valid Electron app.asar and rejects IDE or malformed files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-asar-'));
  try {
    const appAsar = path.join(tmpDir, 'app.asar');
    fs.writeFileSync(appAsar, buildTestAsarBuffer({ name: 'antigravity', version: '2.34.0' }));
    assert.equal(await readAsarPackageVersionAsync(appAsar), '2.34.0');

    const ideAsar = path.join(tmpDir, 'ide.asar');
    fs.writeFileSync(ideAsar, buildTestAsarBuffer({ name: 'antigravity-ide', version: '2.7.0' }));
    assert.equal(await readAsarPackageVersionAsync(ideAsar), '');

    const badAsar = path.join(tmpDir, 'bad.asar');
    fs.writeFileSync(badAsar, Buffer.from('not-an-asar-file'));
    assert.equal(await readAsarPackageVersionAsync(badAsar), '');
  } finally {
    rmRfSync(tmpDir);
  }
});

test('resolveInstalledCliVersionAsync supports meta fast-path, PATH, fallback paths, agentapi, cli.log fallback, and uninstalled state', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-cli-ver-'));
  try {
    // 1. metaVersion fast path (zero exec)
    let called = 0;
    const fromMeta = await resolveInstalledCliVersionAsync({
      metaVersion: '1.5.15',
      execFn: async () => { called++; return { ok: false, stdout: '', notFound: true }; }
    });
    assert.equal(called, 0);
    assert.equal(fromMeta.tag, 'v1.5.15');
    assert.equal(fromMeta.source, 'meta');

    // 2. PATH agy --version
    const fromPath = await resolveInstalledCliVersionAsync({
      homeDir: tmpDir,
      execFn: async (cmd, opts) => {
        if (opts?.execFile === 'agy' || opts?.execFile === 'agy.exe') {
          return { ok: true, stdout: '1.5.15\n', notFound: false };
        }
        return { ok: false, stdout: '', notFound: true };
      }
    });
    assert.equal(fromPath.tag, 'v1.5.15');
    assert.equal(fromPath.source, 'path');

    // 3. Fallback path when PATH lacks ~/.local/bin (GUI app scenario)
    const customBin = path.join(tmpDir, 'custom-bin', 'agy');
    fs.mkdirSync(path.dirname(customBin), { recursive: true });
    fs.writeFileSync(customBin, '#!/bin/sh\necho 1.5.16\n', 'utf8');
    fs.mkdirSync(path.join(tmpDir, '.gemini', 'antigravity-cli', 'bin'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.gemini', 'antigravity-cli', 'bin', 'agentapi'),
      `#!/bin/sh\nexec "${customBin}" agentapi "$@"\n`,
      'utf8'
    );

    const fromAgentApi = await resolveInstalledCliVersionAsync({
      homeDir: tmpDir,
      platform: 'darwin',
      execFn: async (cmd, opts) => {
        if (opts?.execFile === customBin) {
          return { ok: true, stdout: '1.5.16', notFound: false };
        }
        return { ok: false, stdout: '', notFound: true };
      }
    });
    assert.equal(fromAgentApi.tag, 'v1.5.16');
    assert.equal(fromAgentApi.source, customBin);

    // 4. cli.log fallback ONLY when binary exists but --version timed out
    fs.writeFileSync(
      path.join(tmpDir, '.gemini', 'antigravity-cli', 'cli.log'),
      'I1123 17:04:52.234641 22 server.go:2715] Language server version: 1.5.17\n',
      'utf8'
    );
    const fromLogWhenBinaryExists = await resolveInstalledCliVersionAsync({
      homeDir: tmpDir,
      platform: 'darwin',
      cliPaths: [customBin],
      skipPathLookup: true,
      execFn: async () => ({ ok: false, stdout: '', notFound: false })
    });
    assert.equal(fromLogWhenBinaryExists.tag, 'v1.5.17');
    assert.equal(fromLogWhenBinaryExists.source, 'cli_log');

    // 5. Uninstalled: stale cli.log alone must NOT falsely report an installed version
    const uninstalled = await resolveInstalledCliVersionAsync({
      homeDir: tmpDir,
      platform: 'darwin',
      cliPaths: [path.join(tmpDir, 'missing-agy')],
      skipPathLookup: true,
      execFn: async () => ({ ok: false, stdout: '', notFound: true })
    });
    assert.equal(uninstalled.installed, false);
    assert.equal(uninstalled.tag, '');
  } finally {
    rmRfSync(tmpDir);
  }
});

test('resolveInstalledAppVersionAsync supports hub env var, macOS Info.plist, Win/Linux app.asar, and uninstalled state', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-app-ver-'));
  try {
    // 1. Live ANTIGRAVITY_LS_VERSION=hub-2.34.0
    const fromHubEnv = await resolveInstalledAppVersionAsync({
      homeDir: tmpDir,
      env: { ANTIGRAVITY_LS_VERSION: 'hub-2.34.0' },
      appPaths: []
    });
    assert.equal(fromHubEnv.tag, 'v2.34.0');
    assert.equal(fromHubEnv.source, 'env');

    // Non-hub LS version must NOT be treated as Antigravity 2.0
    const nonHubEnv = await resolveInstalledAppVersionAsync({
      homeDir: tmpDir,
      env: { ANTIGRAVITY_LS_VERSION: 'cli-1.5.15' },
      appPaths: []
    });
    assert.equal(nonHubEnv.tag, '');

    // 2. macOS Info.plist bundle detection (and IDE exclusion)
    const macApp = path.join(tmpDir, 'Antigravity.app');
    fs.mkdirSync(path.join(macApp, 'Contents'), { recursive: true });
    fs.writeFileSync(
      path.join(macApp, 'Contents', 'Info.plist'),
      '<plist><dict><key>CFBundleIdentifier</key><string>com.google.antigravity</string><key>CFBundleShortVersionString</key><string>2.34.2</string></dict></plist>',
      'utf8'
    );
    const fromMacPlist = await resolveInstalledAppVersionAsync({
      platform: 'darwin',
      homeDir: tmpDir,
      env: {},
      appPaths: [macApp]
    });
    assert.equal(fromMacPlist.tag, 'v2.34.2');
    assert.equal(fromMacPlist.source, macApp);

    // 3. Windows / Linux resources/app.asar detection
    const winApp = path.join(tmpDir, 'WinAntigravity');
    fs.mkdirSync(path.join(winApp, 'resources'), { recursive: true });
    fs.writeFileSync(
      path.join(winApp, 'resources', 'app.asar'),
      buildTestAsarBuffer({ name: 'antigravity', version: '2.35.0' })
    );
    const fromWinAsar = await resolveInstalledAppVersionAsync({
      platform: 'win32',
      homeDir: tmpDir,
      env: {},
      appPaths: [winApp]
    });
    assert.equal(fromWinAsar.tag, 'v2.35.0');
    assert.equal(fromWinAsar.source, winApp);

    // 4. Uninstalled
    const missing = await resolveInstalledAppVersionAsync({
      platform: 'linux',
      homeDir: tmpDir,
      env: {},
      appPaths: [path.join(tmpDir, 'does-not-exist')]
    });
    assert.equal(missing.installed, false);
    assert.equal(missing.tag, '');
  } finally {
    rmRfSync(tmpDir);
  }
});

test('app-version and cli-version render across all 4 locales (text & emoji) and gate probes in extractMetricsAsync', async () => {
  const sampleMetrics = {
    fallbackModel: 'Gemini 3.8 Flash',
    quotaColor: '',
    quotaVal: '100%',
    contextColor: '',
    usedPct: '0.0%',
    memUsage: '100MB',
    tokenCount: '0 / 256.0k',
    countdownVal: '5h',
    gitBranch: 'main',
    projectName: 'proj',
    projectFullPath: '/proj',
    planTier: 'Pro',
    accountEmail: 'a@b.com',
    agentState: 'idle',
    toolConfirmPending: false,
    pendingInputCount: 0,
    backgroundTasksCount: 0,
    subagentsCount: 0,
    artifactsCount: 0,
    vcsDirtyFlag: false,
    vcsDirtyGlyph: '',
    vcsDirtyLabel: 'ok',
    vcsType: 'git',
    sandboxEnabled: false,
    sandboxAllowNet: false,
    sandboxStatusVal: 'off',
    cliVersion: 'v1.5.15',
    appVersion: 'v2.34.0',
    pluginVersion: 'v1.13.0',
    conversationIdShort: '12345678',
    agentProfileName: 'Default',
    weeklyQuotaColor: '',
    weeklyQuotaVal: '100%',
    weeklyCountdownVal: '7d',
    mode: 'Default',
    quotaResetTimeVal: '12:00',
    weeklyResetTimeVal: '12:00',
    quotaBarVal: '[██████████]',
    weeklyQuotaBarVal: '[██████████]',
    contextBarVal: '[░░░░░░░░░░]',
    tokenBarVal: '[░░░░░░░░░░]'
  };

  const expectedLabels = {
    'zh-tw': { cli: 'Agy CLI 版本: v1.5.15', app: 'Agy 2.0 版本: v2.34.0', unknownApp: 'Agy 2.0 版本: 未知' },
    'zh-cn': { cli: 'Agy CLI 版本: v1.5.15', app: 'Agy 2.0 版本: v2.34.0', unknownApp: 'Agy 2.0 版本: 未知' },
    'us': { cli: 'Agy CLI Version: v1.5.15', app: 'Agy 2.0 Version: v2.34.0', unknownApp: 'Agy 2.0 Version: Unknown' },
    'jp': { cli: 'Agy CLI バージョン: v1.5.15', app: 'Agy 2.0 バージョン: v2.34.0', unknownApp: 'Agy 2.0 バージョン: 不明' }
  };

  for (const [loc, exp] of Object.entries(expectedLabels)) {
    const textDict = buildI18nDict(loc, sampleMetrics, 'text');
    const emojiDict = buildI18nDict(loc, sampleMetrics, 'emoji');
    assert.equal(stripAnsi(textDict['cli-version']), exp.cli);
    assert.equal(stripAnsi(textDict['app-version']), exp.app);
    assert.equal(stripAnsi(emojiDict['cli-version']), '🚀 v1.5.15');
    assert.equal(stripAnsi(emojiDict['app-version']), '💻 v2.34.0');

    const unknownDict = buildI18nDict(loc, { ...sampleMetrics, appVersion: '' }, 'text');
    assert.equal(stripAnsi(unknownDict['app-version']), exp.unknownApp);
  }

  // Probe gating: disabled cli-version & app-version must NOT run execFn
  const quotaInfo = { remaining_percentage: 100, refreshes_in: '' };
  const ctxInfo = { totalInput: 0, contextSize: 1000000, effectiveTokenCeiling: 256000, usedPctNum: 0 };
  const execCalls = [];
  const disabled = await extractMetricsAsync(
    { model: { display_name: 'Gemini' } },
    'us',
    'Gemini',
    null,
    {},
    quotaInfo,
    ctxInfo,
    quotaInfo,
    {
      footerItems: ['model-name'],
      execFn: async (cmd) => { execCalls.push(cmd); return { ok: true, stdout: '1.5.15', notFound: false }; },
      env: { ANTIGRAVITY_LS_VERSION: 'hub-2.34.0' }
    }
  );
  assert.equal(execCalls.length, 0, 'Disabled cli-version must not execute agy --version');
  assert.equal(disabled.cliVersion, 'Unknown');
  assert.equal(disabled.appVersion, 'Unknown');

  // Enabled both without meta.version: probes resolve both independently
  const enabledBoth = await extractMetricsAsync(
    { model: { display_name: 'Gemini' } },
    'us',
    'Gemini',
    null,
    {},
    quotaInfo,
    ctxInfo,
    quotaInfo,
    {
      footerItems: ['cli-version', 'app-version'],
      execFn: async (cmd) => { execCalls.push(cmd); return { ok: true, stdout: '1.5.15', notFound: false }; },
      env: { ANTIGRAVITY_LS_VERSION: 'hub-2.34.0' },
      appPaths: []
    }
  );
  assert.equal(execCalls.length, 1);
  assert.equal(enabledBoth.cliVersion, 'v1.5.15');
  assert.equal(enabledBoth.appVersion, 'v2.34.0');
});

test('E2E CLI statusline-quota.mjs renders both cli-version and app-version simultaneously', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-e2e-ver-'));
  try {
    const fakeHome = path.join(sandbox, 'home');
    fs.mkdirSync(path.join(fakeHome, '.gemini'), { recursive: true });
    fs.writeFileSync(
      path.join(fakeHome, '.gemini', 'settings.json'),
      JSON.stringify({
        ui: {
          language: 'zh-tw',
          footer: {
            items: ['cli-version', 'app-version'],
            itemStyles: {}
          }
        }
      }),
      'utf8'
    );

    const res = await runStatusline(
      {
        version: '1.5.15',
        model: { display_name: 'Gemini 3.8 Flash' },
        terminal_width: 160
      },
      fakeHome,
      undefined,
      { ANTIGRAVITY_LS_VERSION: 'hub-2.34.0' }
    );
    assert.equal(res.code, 0);
    const plain = stripAnsi(res.stdout).trim();
    assert.equal(plain, 'Agy CLI 版本: v1.5.15 │ Agy 2.0 版本: v2.34.0');

    // Emoji mode verification
    fs.writeFileSync(
      path.join(fakeHome, '.gemini', 'settings.json'),
      JSON.stringify({
        ui: {
          language: 'zh-tw',
          footer: {
            items: ['cli-version', 'app-version'],
            itemStyles: { 'cli-version': 'emoji', 'app-version': 'emoji' }
          }
        }
      }),
      'utf8'
    );
    const resEmoji = await runStatusline(
      {
        version: '1.5.15',
        model: { display_name: 'Gemini 3.8 Flash' },
        terminal_width: 160
      },
      fakeHome,
      undefined,
      { ANTIGRAVITY_LS_VERSION: 'hub-2.34.0' }
    );
    assert.equal(resEmoji.code, 0);
    assert.equal(stripAnsi(resEmoji.stdout).trim(), '🚀 v1.5.15 │ 💻 v2.34.0');
  } finally {
    rmRfSync(sandbox);
  }
});
