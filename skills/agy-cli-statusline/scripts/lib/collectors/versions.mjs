import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { runCmdDetailedAsync } from '../core/process-utils.mjs';
import { formatVersionTag, normalizeSemver } from '../core/semver.mjs';

const MAX_ASAR_HEADER_BYTES = 16 * 1024 * 1024;
const MAX_ASAR_PKG_BYTES = 256 * 1024;
const LOG_HEAD_BYTES = 4096;

/**
 * 自任意文字（例如 CLI `--version` 輸出或日誌行）擷取第一個合法 SemVer 版本字串（不含前導 v）。
 * @param {string} text
 * @returns {string}
 */
export function parseSemverFromText(text) {
  if (typeof text !== 'string' || !text.trim()) return '';
  const match = text.match(/\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b/);
  if (!match) return '';
  return normalizeSemver(match[1]) || '';
}

/**
 * 解析 macOS Info.plist XML 並驗證非 Antigravity IDE 後擷取應用程式版本號。
 * @param {string} xmlContent
 * @returns {string}
 */
export function parseInfoPlistVersion(xmlContent) {
  if (typeof xmlContent !== 'string' || !xmlContent.trim()) return '';
  const idMatch = xmlContent.match(/<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/i);
  if (idMatch) {
    const bundleId = idMatch[1].trim().toLowerCase();
    if (bundleId.includes('antigravity-ide') || (bundleId && bundleId !== 'com.google.antigravity')) {
      return '';
    }
  }
  const shortMatch = xmlContent.match(/<key>\s*CFBundleShortVersionString\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/i);
  if (shortMatch) {
    const norm = parseSemverFromText(shortMatch[1]);
    if (norm) return norm;
  }
  const verMatch = xmlContent.match(/<key>\s*CFBundleVersion\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/i);
  if (verMatch) {
    return parseSemverFromText(verMatch[1]);
  }
  return '';
}

/**
 * 檢查 Electron package.json 物件是否屬於 Antigravity 2.0（排除 Antigravity IDE）並回傳版本號。
 * @param {object|null} pkg
 * @returns {string}
 */
export function extractAppVersionFromPackageJson(pkg) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return '';
  const name = typeof pkg.name === 'string' ? pkg.name.trim().toLowerCase() : '';
  if (name && name !== 'antigravity' && name !== 'com.google.antigravity') {
    return '';
  }
  if (typeof pkg.version !== 'string') return '';
  return parseSemverFromText(pkg.version);
}

/**
 * 以純 Node.js 檔案讀取 Electron `app.asar` 標頭與內嵌 `package.json` 版本號（零子行程、跨平台）。
 * @param {string} asarPath
 * @returns {Promise<string>}
 */
export async function readAsarPackageVersionAsync(asarPath) {
  if (!asarPath || typeof asarPath !== 'string') return '';
  let handle = null;
  try {
    handle = await fs.open(asarPath, 'r');
    const headerBuf = Buffer.alloc(16);
    const { bytesRead: headRead } = await handle.read(headerBuf, 0, 16, 0);
    if (headRead < 16) return '';

    const headerPickleSize = headerBuf.readUInt32LE(4);
    const jsonLen = headerBuf.readUInt32LE(12);
    if (!jsonLen || jsonLen > MAX_ASAR_HEADER_BYTES || !headerPickleSize || headerPickleSize > MAX_ASAR_HEADER_BYTES + 64) {
      return '';
    }

    const jsonBuf = Buffer.alloc(jsonLen);
    const { bytesRead: jsonRead } = await handle.read(jsonBuf, 0, jsonLen, 16);
    if (jsonRead < jsonLen) return '';

    const header = JSON.parse(jsonBuf.toString('utf8'));
    const pkgEntry = header?.files?.['package.json'];
    if (!pkgEntry || typeof pkgEntry !== 'object' || pkgEntry.unpacked) return '';

    const pkgSize = Number(pkgEntry.size);
    const pkgRelOffset = Number(pkgEntry.offset);
    if (!Number.isFinite(pkgSize) || pkgSize <= 0 || pkgSize > MAX_ASAR_PKG_BYTES || !Number.isFinite(pkgRelOffset) || pkgRelOffset < 0) {
      return '';
    }

    const dataOffset = 8 + headerPickleSize + pkgRelOffset;
    const pkgBuf = Buffer.alloc(pkgSize);
    const { bytesRead: pkgRead } = await handle.read(pkgBuf, 0, pkgSize, dataOffset);
    if (pkgRead <= 0) return '';

    const pkg = JSON.parse(pkgBuf.subarray(0, pkgRead).toString('utf8').replace(/^\uFEFF/, ''));
    return extractAppVersionFromPackageJson(pkg);
  } catch (_) {
    return '';
  } finally {
    if (handle) {
      try { await handle.close(); } catch (_) {}
    }
  }
}

/**
 * 自 agentapi 包裝腳本（sh / cmd / bat）擷取實際指向的執行檔路徑。
 * @param {string} scriptText
 * @returns {string}
 */
export function extractExecutableFromAgentApiScript(scriptText) {
  if (typeof scriptText !== 'string' || !scriptText.trim()) return '';
  // POSIX sh: exec "/path/to/agy" agentapi "$@" 或 exec /path/to/agy agentapi "$@"
  const quotedMatch = scriptText.match(/(?:^|\n)\s*(?:exec\s+|@?call\s+|@?)?"([^"\r\n]+)"\s+agentapi\b/i);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1].trim();
  }
  const singleQuotedMatch = scriptText.match(/(?:^|\n)\s*(?:exec\s+)?'([^'\r\n]+)'\s+agentapi\b/i);
  if (singleQuotedMatch && singleQuotedMatch[1]) {
    return singleQuotedMatch[1].trim();
  }
  const unquotedMatch = scriptText.match(/(?:^|\n)\s*(?:exec\s+|@?call\s+|@?)?([^\s"'\r\n]+)\s+agentapi\b/i);
  if (unquotedMatch && unquotedMatch[1]) {
    return unquotedMatch[1].trim();
  }
  return '';
}

/**
 * 依 language_server 執行檔路徑反推所屬 Antigravity 2.0 應用程式根目錄。
 * @param {string} exePath
 * @param {string} [platform=process.platform]
 * @returns {string}
 */
export function deriveAppRootFromLanguageServerPath(exePath, platform = process.platform) {
  if (typeof exePath !== 'string' || !exePath.trim()) return '';
  const trimmed = exePath.trim();
  const normalized = trimmed.replace(/\\/g, '/');
  if (platform === 'darwin') {
    const m = normalized.match(/^(.*?\.app)\/Contents\/Resources\/bin\/language_server$/i);
    return m ? m[1] : '';
  }
  const winOrLinuxMatch = normalized.match(/^(.*)\/resources\/bin\/language_server(?:\.exe)?$/i);
  if (!winOrLinuxMatch) return '';
  return platform === 'win32' ? winOrLinuxMatch[1].replace(/\//g, '\\') : winOrLinuxMatch[1];
}

async function fileExistsAsync(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function readLogHeadVersionAsync(logPath) {
  if (!logPath) return '';
  let handle = null;
  try {
    handle = await fs.open(logPath, 'r');
    const buf = Buffer.alloc(LOG_HEAD_BYTES);
    const { bytesRead } = await handle.read(buf, 0, LOG_HEAD_BYTES, 0);
    if (bytesRead <= 0) return '';
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const match = text.match(/Language server version:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/i);
    return match ? (normalizeSemver(match[1]) || '') : '';
  } catch (_) {
    return '';
  } finally {
    if (handle) {
      try { await handle.close(); } catch (_) {}
    }
  }
}

async function readAgentApiTargetAsync(binDir, platform) {
  const candidates = platform === 'win32'
    ? ['agentapi.cmd', 'agentapi.bat', 'agentapi']
    : ['agentapi'];
  for (const name of candidates) {
    try {
      const content = await fs.readFile(path.join(binDir, name), 'utf8');
      const exe = extractExecutableFromAgentApiScript(content);
      if (exe) return exe;
    } catch (_) {}
  }
  return '';
}

function getCliCandidatePaths(homeDir, platform, env = process.env) {
  const pathMod = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') {
    const localAppData = env?.LOCALAPPDATA || pathMod.join(homeDir, 'AppData', 'Local');
    return [
      pathMod.join(localAppData, 'agy', 'bin', 'agy.exe'),
      pathMod.join(homeDir, '.local', 'bin', 'agy.exe'),
      pathMod.join(homeDir, '.gemini', 'bin', 'agy.exe'),
      pathMod.join(localAppData, 'Programs', 'agy', 'agy.exe')
    ];
  }
  return [
    pathMod.join(homeDir, '.local', 'bin', 'agy'),
    pathMod.join(homeDir, '.gemini', 'bin', 'agy'),
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
    '/usr/bin/agy'
  ];
}

function getAppCandidateRoots(homeDir, platform, env = process.env) {
  const pathMod = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'darwin') {
    return [
      '/Applications/Antigravity.app',
      pathMod.join(homeDir, 'Applications', 'Antigravity.app')
    ];
  }
  if (platform === 'win32') {
    const localAppData = env?.LOCALAPPDATA || pathMod.join(homeDir, 'AppData', 'Local');
    const programFiles = env?.ProgramFiles || env?.PROGRAMFILES || 'C:\\Program Files';
    const programFilesX86 = env?.['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    return [
      pathMod.join(localAppData, 'Programs', 'Antigravity'),
      pathMod.join(localAppData, 'Antigravity'),
      pathMod.join(programFiles, 'Antigravity'),
      pathMod.join(programFilesX86, 'Antigravity')
    ];
  }
  return [
    '/opt/Antigravity',
    '/opt/antigravity',
    '/usr/share/antigravity',
    '/usr/lib/antigravity',
    pathMod.join(homeDir, '.local', 'share', 'antigravity'),
    pathMod.join(homeDir, '.local', 'share', 'Antigravity'),
    pathMod.join(homeDir, 'Applications', 'Antigravity')
  ];
}

async function readAppVersionFromRootAsync(appRoot, platform) {
  if (!appRoot) return '';
  if (platform === 'darwin') {
    try {
      const plistPath = path.join(appRoot, 'Contents', 'Info.plist');
      const xml = await fs.readFile(plistPath, 'utf8');
      const ver = parseInfoPlistVersion(xml);
      if (ver) return ver;
    } catch (_) {}
    const asarVer = await readAsarPackageVersionAsync(path.join(appRoot, 'Contents', 'Resources', 'app.asar'));
    if (asarVer) return asarVer;
    try {
      const pkgText = await fs.readFile(path.join(appRoot, 'Contents', 'Resources', 'app', 'package.json'), 'utf8');
      const ver = extractAppVersionFromPackageJson(JSON.parse(pkgText.replace(/^\uFEFF/, '')));
      if (ver) return ver;
    } catch (_) {}
    return '';
  }

  const asarVer = await readAsarPackageVersionAsync(path.join(appRoot, 'resources', 'app.asar'));
  if (asarVer) return asarVer;
  try {
    const pkgText = await fs.readFile(path.join(appRoot, 'resources', 'app', 'package.json'), 'utf8');
    const ver = extractAppVersionFromPackageJson(JSON.parse(pkgText.replace(/^\uFEFF/, '')));
    if (ver) return ver;
  } catch (_) {}
  return '';
}

/**
 * 探測本機已安裝的 Antigravity CLI（`agy`）版本號（支援 macOS / Linux / Windows）。
 * 優先順序：顯式傳入 metaVersion -> PATH `agy --version` -> 常見安裝路徑與 agentapi 指向路徑 -> 確認執行檔存在時退讓讀取 `cli.log`。
 * @param {object} [options={}]
 * @returns {Promise<{ version: string, tag: string, installed: boolean, source: string }>}
 */
export async function resolveInstalledCliVersionAsync(options = {}) {
  const rawMeta = typeof options.metaVersion === 'string'
    ? options.metaVersion.trim().replace(/^v/i, '')
    : (options.metaVersion ? String(options.metaVersion).trim().replace(/^v/i, '') : '');
  if (rawMeta) {
    const norm = normalizeSemver(rawMeta) || rawMeta;
    return { version: norm, tag: formatVersionTag(norm), installed: true, source: 'meta' };
  }

  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir();
  const env = options.env || process.env;
  const execFn = typeof options.execFn === 'function' ? options.execFn : runCmdDetailedAsync;
  const cliBinName = platform === 'win32' ? 'agy.exe' : 'agy';

  let binaryFound = false;

  // 1. 優先嘗試 PATH 上的 agy --version
  if (options.skipPathLookup !== true) {
    try {
      const res = await execFn(`${cliBinName} --version`, {
        execFile: cliBinName,
        execArgs: ['--version'],
        timeout: 600
      });
      if (res && !res.notFound) {
        binaryFound = true;
      }
      if (res?.ok && res.stdout) {
        const ver = parseSemverFromText(res.stdout);
        if (ver) {
          return { version: ver, tag: formatVersionTag(ver), installed: true, source: 'path' };
        }
      }
    } catch (_) {}
  }

  // 2. 掃描常見安裝路徑與 ~/.gemini/antigravity-cli/bin/agentapi 指向的執行檔（補救 GUI App 缺少 ~/.local/bin PATH）
  const candidateSet = new Set();
  if (Array.isArray(options.cliPaths)) {
    for (const p of options.cliPaths) {
      if (typeof p === 'string' && p.trim()) candidateSet.add(p.trim());
    }
  } else {
    const agentApiTarget = await readAgentApiTargetAsync(path.join(homeDir, '.gemini', 'antigravity-cli', 'bin'), platform);
    if (agentApiTarget) candidateSet.add(agentApiTarget);
    for (const p of getCliCandidatePaths(homeDir, platform, env)) {
      candidateSet.add(p);
    }
  }

  for (const candidate of candidateSet) {
    if (!(await fileExistsAsync(candidate))) continue;
    binaryFound = true;
    try {
      const res = await execFn(`"${candidate}" --version`, {
        execFile: candidate,
        execArgs: ['--version'],
        timeout: 600
      });
      if (res?.ok && res.stdout) {
        const ver = parseSemverFromText(res.stdout);
        if (ver) {
          return { version: ver, tag: formatVersionTag(ver), installed: true, source: candidate };
        }
      }
    } catch (_) {}
  }

  // 3. 僅於已確認執行檔存在但 --version 逾時/失敗時，退讓讀取 ~/.gemini/antigravity-cli/cli.log 標頭
  if (binaryFound) {
    const logVer = await readLogHeadVersionAsync(path.join(homeDir, '.gemini', 'antigravity-cli', 'cli.log'));
    if (logVer) {
      return { version: logVer, tag: formatVersionTag(logVer), installed: true, source: 'cli_log' };
    }
  }

  return { version: '', tag: '', installed: binaryFound, source: '' };
}

/**
 * 探測本機已安裝的 Antigravity 2.0（Desktop App）版本號（純檔案讀取，零子行程，支援 macOS / Linux / Windows）。
 * 優先順序：顯式傳入 metaAppVersion -> 執行中 2.0 環境變數 `ANTIGRAVITY_LS_VERSION=hub-X.Y.Z` -> 應用程式安裝目錄（Info.plist / app.asar / package.json） -> 確認 language_server 存在時退讓讀取 `cli.log`。
 * @param {object} [options={}]
 * @returns {Promise<{ version: string, tag: string, installed: boolean, source: string }>}
 */
export async function resolveInstalledAppVersionAsync(options = {}) {
  const rawMeta = typeof options.metaAppVersion === 'string'
    ? options.metaAppVersion.trim().replace(/^v/i, '')
    : (options.metaAppVersion ? String(options.metaAppVersion).trim().replace(/^v/i, '') : '');
  if (rawMeta) {
    const norm = normalizeSemver(rawMeta) || rawMeta;
    return { version: norm, tag: formatVersionTag(norm), installed: true, source: 'meta' };
  }

  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir();
  const hasExplicitAppPaths = Array.isArray(options.appPaths);
  const hasExplicitEnv = options.env !== undefined;
  const env = hasExplicitEnv ? options.env : process.env;

  // 1. 執行於 Antigravity 2.0 內時可直接由 ANTIGRAVITY_LS_VERSION=hub-X.Y.Z 零 I/O 取得
  if (!hasExplicitAppPaths || hasExplicitEnv) {
    const lsVerEnv = typeof env?.ANTIGRAVITY_LS_VERSION === 'string' ? env.ANTIGRAVITY_LS_VERSION.trim() : '';
    const hubMatch = lsVerEnv.match(/^hub-v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/i);
    if (hubMatch) {
      const norm = normalizeSemver(hubMatch[1]) || hubMatch[1];
      return { version: norm, tag: formatVersionTag(norm), installed: true, source: 'env' };
    }
  }

  // 2. 收集候選應用程式根目錄（含 ANTIGRAVITY_AGENTAPI_EXE 與 ~/.gemini/antigravity/bin/agentapi 推導路徑）
  const rootSet = new Set();
  let agentApiExe = '';

  if (hasExplicitAppPaths) {
    for (const p of options.appPaths) {
      if (typeof p === 'string' && p.trim()) rootSet.add(p.trim());
    }
  } else {
    if (typeof env?.ANTIGRAVITY_AGENTAPI_EXE === 'string' && env.ANTIGRAVITY_AGENTAPI_EXE.trim()) {
      const derivedFromEnv = deriveAppRootFromLanguageServerPath(env.ANTIGRAVITY_AGENTAPI_EXE.trim(), platform);
      if (derivedFromEnv) rootSet.add(derivedFromEnv);
    }
    agentApiExe = await readAgentApiTargetAsync(path.join(homeDir, '.gemini', 'antigravity', 'bin'), platform);
    if (agentApiExe) {
      const derivedFromScript = deriveAppRootFromLanguageServerPath(agentApiExe, platform);
      if (derivedFromScript) rootSet.add(derivedFromScript);
    }
    for (const p of getAppCandidateRoots(homeDir, platform, env)) {
      rootSet.add(p);
    }
  }

  for (const appRoot of rootSet) {
    const ver = await readAppVersionFromRootAsync(appRoot, platform);
    if (ver) {
      return { version: ver, tag: formatVersionTag(ver), installed: true, source: appRoot };
    }
  }

  // 3. 若 agentapi 指向的 language_server 確實存在（如非標準目錄或 AppImage），退讓讀取 ~/.gemini/antigravity/cli.log
  if (agentApiExe && (await fileExistsAsync(agentApiExe))) {
    const logVer = await readLogHeadVersionAsync(path.join(homeDir, '.gemini', 'antigravity', 'cli.log'));
    if (logVer) {
      return { version: logVer, tag: formatVersionTag(logVer), installed: true, source: 'cli_log' };
    }
    return { version: '', tag: '', installed: true, source: '' };
  }

  return { version: '', tag: '', installed: false, source: '' };
}
