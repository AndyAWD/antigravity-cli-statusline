import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import http from 'http';
import https from 'https';
import { join } from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { GITHUB_LATEST_RELEASE_URL, PLUGIN_PACKAGE_NAME } from '../core/constants.mjs';
import { isDirectExecution, readJsonSafeAsync, writeFileAndVerifyNoBOM } from '../core/fs-utils.mjs';
import { resolveInstalledPluginVersionAsync } from '../core/plugin-manifest.mjs';
import { runCmdDetailedAsync, withTimeout } from '../core/process-utils.mjs';
import { formatVersionTag, isVersionBehind, normalizeSemver } from '../core/semver.mjs';

export const SHARED_UPDATE_CACHE_TTL_MS = 60 * 60 * 1000;
export const PENDING_LEASE_TTL_MS = 5000;
export const MAX_INTERRUPTED_ATTEMPTS = 3;

const SESSION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_CACHE_MAX_ENTRIES = 32;

/**
 * 取得 CLI 與 Antigravity 2.0 共用的外掛更新快取檔案路徑。
 * @param {string} [homeDir=os.homedir()]
 * @param {string} [pluginDataDir='']
 * @returns {string}
 */
export function getSharedUpdateCachePath(homeDir = os.homedir(), pluginDataDir = '') {
  if (typeof pluginDataDir === 'string' && pluginDataDir.trim()) {
    return join(pluginDataDir.trim(), 'update_cache.json');
  }
  return join(homeDir, '.gemini', 'antigravity', 'plugin_data', PLUGIN_PACKAGE_NAME, 'update_cache.json');
}

/**
 * 取得舊版 CLI 專屬外掛更新快取路徑（僅供相容唯讀遷移與診斷退讓）。
 * @param {string} [homeDir=os.homedir()]
 * @returns {string}
 */
export function getLegacyCliUpdateCachePath(homeDir = os.homedir()) {
  return join(homeDir, '.gemini', 'tmp', 'plugin_update_cache.json');
}

/**
 * 將命令列字串拆解為參數陣列，正確處理單雙引號與反斜線跳脫。
 * @param {string} cmdLine
 * @returns {string[]}
 */
export function tokenizeCommandLine(cmdLine) {
  if (typeof cmdLine !== 'string') return [];
  const tokens = [];
  let current = '';
  let quote = '';
  let hasToken = false;

  for (let i = 0; i < cmdLine.length; i++) {
    const ch = cmdLine[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < cmdLine.length && (cmdLine[i + 1] === '"' || cmdLine[i + 1] === '\\')) {
        current += cmdLine[i + 1];
        i++;
      } else if (ch === quote) {
        quote = '';
      } else {
        current += ch;
      }
      hasToken = true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (hasToken) tokens.push(current);
  return tokens;
}

/**
 * 判斷行程名稱或執行檔路徑是否為 Antigravity CLI 主程式（agy / agy.exe）。
 * @param {string} nameOrPath
 * @returns {boolean}
 */
export function isAgyProcessName(nameOrPath) {
  if (typeof nameOrPath !== 'string') return false;
  const trimmed = nameOrPath.trim();
  if (!trimmed) return false;
  const parts = trimmed.split(/[\\/]/);
  const base = parts[parts.length - 1];
  return /^agy(?:\.exe)?$/i.test(base);
}

/**
 * 自命令列或 argv 陣列中擷取執行檔之後的參數清單（相容無引號且路徑含空白之 macOS ps 輸出）。
 * @param {string|string[]} argsInput
 * @param {string} [knownName='']
 * @returns {string[]}
 */
export function extractArgsAfterExecutable(argsInput, knownName = '') {
  if (Array.isArray(argsInput)) {
    return argsInput.slice(1).map(t => String(t ?? ''));
  }
  if (typeof argsInput !== 'string') return [];
  const trimmed = argsInput.trim();
  if (!trimmed) return [];
  const tokens = tokenizeCommandLine(trimmed);
  if (tokens.length === 0) return [];

  // 若命令列開頭即為引號包裹之執行檔路徑，或 tokens[0] 本身即為 agy，直接取後續參數
  if (trimmed.startsWith('"') || trimmed.startsWith("'") || isAgyProcessName(tokens[0])) {
    return tokens.slice(1);
  }

  // 若無引號之執行檔路徑含空白（如 macOS ps 輸出 /Users/John Doe/.gemini/bin/agy --flag），
  // 於第一個選項旗標之前尋找符合 agy 執行檔名稱之分界位置
  let firstFlagIdx = tokens.findIndex(t => t.startsWith('-'));
  if (firstFlagIdx === -1) firstFlagIdx = tokens.length;
  for (let i = firstFlagIdx - 1; i >= 0; i--) {
    if (isAgyProcessName(tokens[i])) {
      return tokens.slice(i + 1);
    }
  }
  if (knownName && isAgyProcessName(knownName)) {
    return tokens.slice(firstFlagIdx);
  }
  return tokens.slice(1);
}

/**
 * 判斷 agy 啟動參數是否包含非互動式旗標（-p / --print / --prompt）。
 * @param {string|string[]} argsInput
 * @param {string} [knownName='']
 * @returns {boolean}
 */
export function hasNonInteractiveAgyFlag(argsInput, knownName = '') {
  const args = extractArgsAfterExecutable(argsInput, knownName);
  for (const tok of args) {
    if (tok === '--') break;
    if (tok === '-p' || tok === '--print' || tok === '--prompt') return true;
    const eqMatch = tok.match(/^(?:-p|--print|--prompt)=(.*)$/i);
    if (eqMatch) {
      const val = eqMatch[1].trim().toLowerCase();
      if (val !== 'false' && val !== '0' && val !== 'no' && val !== '') return true;
    }
  }
  return false;
}

/**
 * 判斷 agy 行程是否為子 Hub 輔助行程（--hub）。
 * @param {string|string[]} argsInput
 * @param {string} [knownName='']
 * @returns {boolean}
 */
export function isHubAgyArgs(argsInput, knownName = '') {
  const args = extractArgsAfterExecutable(argsInput, knownName);
  for (const tok of args) {
    if (tok === '--') break;
    if (tok === '--hub' || tok.startsWith('--hub=')) return true;
  }
  return false;
}

/**
 * 解析 macOS / BSD `ps -ww -o pid=,ppid=,lstart=,ucomm=` 單行輸出。
 * @param {string} line
 * @returns {{ pid: number, ppid: number, startTime: string, name: string }|null}
 */
export function parseMacPsLine(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/) ||
    trimmed.match(/^(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/);
  if (!match) return null;
  return {
    pid: parseInt(match[1], 10),
    ppid: parseInt(match[2], 10),
    startTime: match[3].trim(),
    name: match[4].trim()
  };
}

/**
 * 解析 Linux `/proc/<pid>/stat` 單行內容（以最後一個右括號為界避免 comm 名稱內含空白或括號造成位移）。
 * @param {string} statStr
 * @returns {{ pid: number, ppid: number, name: string, startTime: string }|null}
 */
export function parseLinuxProcStat(statStr) {
  if (typeof statStr !== 'string') return null;
  const lparen = statStr.indexOf('(');
  const rparen = statStr.lastIndexOf(')');
  if (lparen === -1 || rparen === -1 || rparen <= lparen) return null;
  const pid = parseInt(statStr.slice(0, lparen).trim(), 10);
  const comm = statStr.slice(lparen + 1, rparen);
  const fields = statStr.slice(rparen + 1).trim().split(/\s+/);
  if (isNaN(pid) || fields.length < 20) return null;
  const ppid = parseInt(fields[1], 10);
  const startTime = fields[19];
  if (isNaN(ppid) || !startTime) return null;
  return { pid, ppid, name: comm, startTime };
}

/**
 * 解析 Windows PowerShell CIM 行程鏈 JSON 輸出（相容單物件、陣列與前導 UTF-8 BOM）。
 * @param {string} stdout
 * @returns {Array<{ pid: number, ppid: number, name: string, startTime: string, args: string }>}
 */
export function parseWinProcessChainJson(stdout) {
  if (typeof stdout !== 'string' || !stdout.trim()) return [];
  try {
    const parsed = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? [parsed] : []);
    return list
      .filter(p => p && typeof p === 'object')
      .map(p => ({
        pid: Number(p.pid),
        ppid: Number(p.ppid),
        name: String(p.name || ''),
        startTime: String(p.start || ''),
        args: String(p.cmd || '')
      }))
      .filter(p => !isNaN(p.pid) && p.pid > 0);
  } catch (_) {
    return [];
  }
}

/**
 * 向上追溯父代行程樹以識別目前所屬的 Antigravity CLI 會話（略過 --hub 子行程，並標記非互動式模式）。
 * @param {object} [options={}]
 * @returns {Promise<{ found: boolean, pid: number, startTime: string, nonInteractive: boolean, sessionKey: string }>}
 */
export async function resolveAgySessionAsync(options = {}) {
  const envObj = options.env || process.env;
  const overrideRaw = envObj?.STATUSLINE_AGY_SESSION_JSON;
  if (typeof overrideRaw === 'string' && overrideRaw.trim()) {
    try {
      const ov = JSON.parse(overrideRaw.replace(/^\uFEFF/, '').trim());
      if (ov && typeof ov === 'object' && ov.pid) {
        const pid = Number(ov.pid);
        const startTime = String(ov.startTime || '');
        return {
          found: true,
          pid,
          startTime,
          nonInteractive: Boolean(ov.nonInteractive),
          sessionKey: `${pid}:${startTime}`
        };
      }
    } catch (_) {}
  }

  const fallbackSession = { found: false, pid: 0, startTime: '', nonInteractive: false, sessionKey: '' };
  const platform = options.platform || process.platform;
  const startPid = Number(options.ppid ?? process.ppid);
  const execFn = typeof options.execFn === 'function' ? options.execFn : runCmdDetailedAsync;
  const readFileFn = typeof options.readFileFn === 'function'
    ? options.readFileFn
    : (p, enc) => fs.readFile(p, enc);

  if (!startPid || isNaN(startPid) || startPid <= 0) {
    return fallbackSession;
  }

  if (platform === 'win32') {
    try {
      const script = `$cur = ${startPid}; $chain = @(); for ($i = 0; $i -lt 16 -and $cur -gt 0; $i++) { $p = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $cur); if (-not $p) { break }; $st = if ($p.CreationDate) { $p.CreationDate.ToUniversalTime().ToString('o') } else { '' }; $chain += [pscustomobject]@{ pid = [int]$p.ProcessId; ppid = [int]$p.ParentProcessId; name = [string]$p.Name; start = $st; cmd = [string]$p.CommandLine }; if (($p.Name -match '^agy(\\.exe)?$' -or (-not $p.Name -and $p.CommandLine -match '(^|[\\\\/])agy(\\.exe)?(["\\s]|$)')) -and $p.CommandLine -notmatch '(^|\\s)--hub(=|\\s|$)') { break }; $next = [int]$p.ParentProcessId; if ($next -eq $cur) { break }; $cur = $next }; $chain | ConvertTo-Json -Compress`;
      const execArgs = ['-NoProfile', '-Command', script];
      const res = await withTimeout(
        execFn(`powershell.exe -NoProfile -Command "${script}"`, { execFile: 'powershell.exe', execArgs, timeout: 1500 }),
        1600,
        null
      );
      if (res && res.ok && res.stdout) {
        const chain = parseWinProcessChainJson(res.stdout);
        for (const node of chain) {
          const isAgy = isAgyProcessName(node.name) || (!node.name && isAgyProcessName(tokenizeCommandLine(node.args)[0] || ''));
          if (!isAgy) continue;
          if (isHubAgyArgs(node.args, node.name)) continue;
          return {
            found: true,
            pid: node.pid,
            startTime: node.startTime,
            nonInteractive: hasNonInteractiveAgyFlag(node.args, node.name),
            sessionKey: `${node.pid}:${node.startTime}`
          };
        }
      }
    } catch (_) {}
    return fallbackSession;
  }

  const sessionTimeoutMs = options.sessionTimeoutMs ?? 900;
  return await withTimeout(
    (async () => {
      try {
        const visited = new Set();
        let cur = startPid;
        let useProcFs = platform === 'linux';

        for (let hop = 0; hop < 16 && cur > 0 && !visited.has(cur); hop++) {
          visited.add(cur);

          if (useProcFs) {
            try {
              const statContent = await readFileFn(`/proc/${cur}/stat`, 'utf8');
              const parsed = parseLinuxProcStat(statContent);
              if (!parsed) break;
              let argv = [];
              let cmdlineLoaded = false;
              const loadCmdline = async () => {
                if (cmdlineLoaded) return;
                cmdlineLoaded = true;
                try {
                  const cmdRaw = await readFileFn(`/proc/${cur}/cmdline`, 'utf8');
                  argv = cmdRaw.split('\0').filter((s, idx, arr) => !(idx === arr.length - 1 && s === ''));
                } catch (_) {}
              };
              let isAgy = isAgyProcessName(parsed.name);
              if (!isAgy) {
                await loadCmdline();
                if (argv.length > 0 && isAgyProcessName(argv[0])) {
                  isAgy = true;
                }
              }
              if (isAgy) {
                await loadCmdline();
                const knownName = isAgyProcessName(parsed.name) ? parsed.name : (argv[0] || '');
                if (!isHubAgyArgs(argv, knownName)) {
                  return {
                    found: true,
                    pid: parsed.pid,
                    startTime: parsed.startTime,
                    nonInteractive: hasNonInteractiveAgyFlag(argv, knownName),
                    sessionKey: `${parsed.pid}:${parsed.startTime}`
                  };
                }
              }
              if (!parsed.ppid || parsed.ppid === cur || parsed.ppid <= 0) break;
              cur = parsed.ppid;
              continue;
            } catch (_) {
              useProcFs = false;
            }
          }

          const commField = platform === 'darwin' ? 'ucomm=' : 'comm=';
          const psArgs = ['-ww', '-o', `pid=,ppid=,lstart=,${commField}`, '-p', String(cur)];
          const psRes = await execFn(`ps ${psArgs.join(' ')}`, {
            execFile: 'ps',
            execArgs: psArgs,
            env: { ...process.env, LC_ALL: 'C' },
            timeout: 500
          });
          if (!psRes || !psRes.ok || !psRes.stdout) break;
          const firstLine = psRes.stdout.split(/\r?\n/).find(l => l.trim());
          const parsed = parseMacPsLine(firstLine || '');
          if (!parsed) break;

          if (isAgyProcessName(parsed.name)) {
            const argQuery = ['-ww', '-o', 'args=', '-p', String(cur)];
            const argRes = await execFn(`ps ${argQuery.join(' ')}`, {
              execFile: 'ps',
              execArgs: argQuery,
              env: { ...process.env, LC_ALL: 'C' },
              timeout: 500
            });
            const cmdLine = (argRes && argRes.ok) ? argRes.stdout : '';
            if (!isHubAgyArgs(cmdLine, parsed.name)) {
              return {
                found: true,
                pid: parsed.pid,
                startTime: parsed.startTime,
                nonInteractive: hasNonInteractiveAgyFlag(cmdLine, parsed.name),
                sessionKey: `${parsed.pid}:${parsed.startTime}`
              };
            }
          }
          if (!parsed.ppid || parsed.ppid === cur || parsed.ppid <= 0) break;
          cur = parsed.ppid;
        }
      } catch (_) {}

      return fallbackSession;
    })(),
    sessionTimeoutMs,
    fallbackSession
  );
}

/**
 * 向 GitHub Releases API 或 latest 重新導向端點查詢最新外掛發行版本。
 * @param {string} [url=GITHUB_LATEST_RELEASE_URL]
 * @param {number} [timeoutMs=1500]
 * @param {number} [maxRedirects=3]
 * @returns {Promise<{ ok: boolean, latestVersion?: string, latestTag?: string, error?: string }>}
 */
export function fetchLatestPluginReleaseAsync(url = GITHUB_LATEST_RELEASE_URL, timeoutMs = 1500, maxRedirects = 3) {
  return new Promise((resolve) => {
    const deadline = Date.now() + Math.max(100, Number(timeoutMs) || 1500);
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const requestUrl = (targetUrl, redirectsLeft) => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        return finish({ ok: false, error: 'timeout' });
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(targetUrl);
      } catch (_) {
        return finish({ ok: false, error: 'invalid_url' });
      }
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        return finish({ ok: false, error: 'unsupported_protocol' });
      }

      const client = parsedUrl.protocol === 'https:' ? https : http;
      const useHead = parsedUrl.hostname.toLowerCase() === 'github.com' && /\/releases\/latest\/?$/i.test(parsedUrl.pathname);
      let req;
      const timer = setTimeout(() => {
        try { if (req) req.destroy(); } catch (_) {}
        finish({ ok: false, error: 'timeout' });
      }, remainingMs);

      try {
        req = client.request(parsedUrl, {
          method: useHead ? 'HEAD' : 'GET',
          agent: false,
          headers: {
            'User-Agent': 'antigravity-cli-statusline',
            'Accept': 'application/vnd.github+json'
          }
        }, (res) => {
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            clearTimeout(timer);
            res.resume();
            try {
              const nextUrl = new URL(res.headers.location, parsedUrl);
              const tagMatch = nextUrl.pathname.match(/\/releases\/tag\/([^/?#]+)\/?$/i);
              if (tagMatch) {
                const rawTag = decodeURIComponent(tagMatch[1]).trim();
                const norm = normalizeSemver(rawTag);
                if (!norm) {
                  return finish({ ok: false, error: 'invalid_tag' });
                }
                return finish({
                  ok: true,
                  latestVersion: norm,
                  latestTag: formatVersionTag(rawTag)
                });
              }
              if (redirectsLeft > 0) {
                return requestUrl(nextUrl.toString(), redirectsLeft - 1);
              }
              return finish({ ok: false, error: 'too_many_redirects' });
            } catch (_) {
              return finish({ ok: false, error: 'invalid_redirect' });
            }
          }

          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
            if (body.length > 512 * 1024) {
              clearTimeout(timer);
              try { req.destroy(); } catch (_) {}
              finish({ ok: false, error: 'response_too_large' });
            }
          });
          res.on('end', () => {
            clearTimeout(timer);
            if (status < 200 || status >= 300) {
              return finish({ ok: false, error: `http_${status}` });
            }
            try {
              const json = JSON.parse(body);
              const rawTag = (json && typeof json.tag_name === 'string') ? json.tag_name.trim() : '';
              const norm = normalizeSemver(rawTag);
              if (!norm) {
                return finish({ ok: false, error: 'invalid_tag' });
              }
              return finish({
                ok: true,
                latestVersion: norm,
                latestTag: formatVersionTag(rawTag)
              });
            } catch (_) {
              return finish({ ok: false, error: 'invalid_json' });
            }
          });
          res.on('error', () => {
            clearTimeout(timer);
            finish({ ok: false, error: 'response_error' });
          });
        });

        req.on('error', () => {
          clearTimeout(timer);
          finish({ ok: false, error: 'request_error' });
        });
        req.end();
      } catch (_) {
        clearTimeout(timer);
        finish({ ok: false, error: 'request_throw' });
      }
    };

    requestUrl(url, maxRedirects);
  });
}

let pluginUpdateWriteQueue = Promise.resolve();

function hasPlainCheckedSessions(cacheObj) {
  return Boolean(
    cacheObj &&
    typeof cacheObj.checkedSessions === 'object' &&
    cacheObj.checkedSessions !== null &&
    !Array.isArray(cacheObj.checkedSessions)
  );
}

function extractPreservedVersionFields(cacheObj) {
  const preserved = {};
  const diskLatestVersion = normalizeSemver(cacheObj?.latestVersion || '');
  if (diskLatestVersion) {
    preserved.latestVersion = diskLatestVersion;
    preserved.latestTag = formatVersionTag(cacheObj?.latestTag || diskLatestVersion);
    const ts = Number(cacheObj?.checkedAt || cacheObj?.latestCheckedAt || 0);
    if (Number.isFinite(ts) && ts > 0) {
      preserved.checkedAt = ts;
      preserved.latestCheckedAt = ts;
    }
  }
  return preserved;
}

function isSessionAlreadyChecked(cacheObj, sessionKey, now = Date.now(), pendingLeaseMs = PENDING_LEASE_TTL_MS) {
  if (!cacheObj || !sessionKey) return false;
  if (hasPlainCheckedSessions(cacheObj)) {
    if (!Object.prototype.hasOwnProperty.call(cacheObj.checkedSessions, sessionKey)) {
      return false;
    }
    const entry = cacheObj.checkedSessions[sessionKey];
    if (!entry) return false;
    if (typeof entry !== 'object') return Boolean(entry);
    if (entry.status === 'pending') {
      const attempts = Number(entry.attempts || 1);
      if (attempts >= MAX_INTERRUPTED_ATTEMPTS) return true;
      const attemptAt = Number(entry.attemptAt || 0);
      if (attemptAt > 0 && (now - attemptAt) < pendingLeaseMs) return true;
      return false;
    }
    return true;
  }
  if (cacheObj.lastSessionKey !== sessionKey) return false;
  if (cacheObj.lastSessionStatus === 'pending') {
    const attemptAt = Number(cacheObj.lastAttemptAt || 0);
    if (attemptAt > 0 && (now - attemptAt) < pendingLeaseMs) return true;
    return false;
  }
  return true;
}

/**
 * 合併磁碟上已紀錄的多視窗 checkedSessions（含遷移舊版 lastSessionKey），
 * 更新當前 sessionKey 狀態（ok / failed / pending）並依 7 天 TTL 與上限 32 筆裁剪舊紀錄（永遠保留當前 sessionKey）。
 * @param {object|null} diskCache
 * @param {string} sessionKey
 * @param {{ status: 'ok'|'failed'|'pending', attemptAt: number, attempts?: number, lastError?: string }} currentEntry
 * @param {number} now
 * @returns {Record<string, { status: 'ok'|'failed'|'pending', attemptAt: number, attempts?: number, lastError?: string }>}
 */
function mergeAndPruneCheckedSessions(diskCache, sessionKey, currentEntry, now) {
  const merged = {};

  if (hasPlainCheckedSessions(diskCache)) {
    for (const [key, val] of Object.entries(diskCache.checkedSessions)) {
      if (!key || !val || typeof val !== 'object' || Array.isArray(val)) continue;
      const hasAttemptAt = val.attemptAt !== undefined && val.attemptAt !== null;
      const attemptAt = hasAttemptAt
        ? (Number.isFinite(Number(val.attemptAt)) ? Number(val.attemptAt) : 0)
        : (Number.isFinite(Number(diskCache?.lastAttemptAt)) && Number(diskCache.lastAttemptAt) > 0
            ? Number(diskCache.lastAttemptAt)
            : now);
      if (now - attemptAt > SESSION_CACHE_TTL_MS) continue;
      const status = val.status === 'ok' ? 'ok' : (val.status === 'pending' ? 'pending' : 'failed');
      const item = { status, attemptAt };
      if (Number.isFinite(Number(val.attempts)) && Number(val.attempts) > 0) {
        item.attempts = Number(val.attempts);
      }
      if (status === 'failed' && typeof val.lastError === 'string' && val.lastError.trim()) {
        item.lastError = val.lastError.trim();
      }
      merged[key] = item;
    }
  }

  // 若磁碟快取僅有舊版 lastSessionKey 尚未寫入 checkedSessions，一併遷移以免遺失
  const legacyKey = typeof diskCache?.lastSessionKey === 'string' ? diskCache.lastSessionKey : '';
  if (legacyKey && !Object.prototype.hasOwnProperty.call(merged, legacyKey)) {
    const legacyAttemptRaw = Number(diskCache?.lastAttemptAt);
    const legacyAttemptAt = (Number.isFinite(legacyAttemptRaw) && legacyAttemptRaw > 0)
      ? legacyAttemptRaw
      : now;
    if (now - legacyAttemptAt <= SESSION_CACHE_TTL_MS) {
      const legacyStatus = diskCache?.lastSessionStatus === 'ok'
        ? 'ok'
        : (diskCache?.lastSessionStatus === 'pending' ? 'pending' : 'failed');
      merged[legacyKey] = {
        status: legacyStatus,
        attemptAt: legacyAttemptAt
      };
    }
  }

  const nextStatus = currentEntry.status === 'ok'
    ? 'ok'
    : (currentEntry.status === 'pending' ? 'pending' : 'failed');
  const nextEntry = {
    status: nextStatus,
    attemptAt: currentEntry.attemptAt
  };
  if (Number.isFinite(Number(currentEntry.attempts)) && Number(currentEntry.attempts) > 0) {
    nextEntry.attempts = Number(currentEntry.attempts);
  }
  if (nextStatus === 'failed' && typeof currentEntry.lastError === 'string' && currentEntry.lastError.trim()) {
    nextEntry.lastError = currentEntry.lastError.trim();
  }
  merged[sessionKey] = nextEntry;

  const allKeys = Object.keys(merged);
  if (allKeys.length > SESSION_CACHE_MAX_ENTRIES) {
    const keepOthers = allKeys
      .filter(k => k !== sessionKey)
      .sort((a, b) => (merged[b].attemptAt || 0) - (merged[a].attemptAt || 0))
      .slice(0, SESSION_CACHE_MAX_ENTRIES - 1);
    const pruned = {};
    for (const k of keepOthers) {
      pruned[k] = merged[k];
    }
    pruned[sessionKey] = merged[sessionKey];
    return pruned;
  }

  return merged;
}

function updatePluginUpdateCacheAsync(cachePath, updaterFn) {
  let result = null;
  const run = pluginUpdateWriteQueue.then(async () => {
    const latestOnDisk = await readJsonSafeAsync(cachePath);
    const outcome = updaterFn(latestOnDisk);
    result = outcome?.result ?? null;
    if (outcome && outcome.nextData) {
      try {
        await writeFileAndVerifyNoBOM(cachePath, JSON.stringify(outcome.nextData, null, 2));
      } catch (_) {}
    }
  });
  pluginUpdateWriteQueue = run.catch(() => {});
  return run.then(() => result);
}

async function finalizePluginUpdateResultAsync({
  cachePath,
  sessionKey,
  attemptAt,
  attempts = 1,
  res,
  fallbackSeed = null
}) {
  if (res && res.ok && res.latestVersion) {
    const latestVersion = res.latestVersion;
    const latestTag = res.latestTag || formatVersionTag(res.latestVersion);
    return await updatePluginUpdateCacheAsync(cachePath, (diskCache) => {
      const effectiveDisk = diskCache || fallbackSeed;
      const okAt = Date.now();
      const checkedSessions = mergeAndPruneCheckedSessions(
        effectiveDisk,
        sessionKey,
        { status: 'ok', attemptAt, attempts },
        okAt
      );
      return {
        nextData: {
          latestVersion,
          latestTag,
          checkedAt: okAt,
          latestCheckedAt: okAt,
          lastSessionKey: sessionKey,
          lastSessionStatus: 'ok',
          lastAttemptAt: attemptAt,
          checkedSessions
        },
        result: { latestVersion, latestTag }
      };
    });
  }

  const lastError = String(res?.error || 'unknown');
  return await updatePluginUpdateCacheAsync(cachePath, (diskCache) => {
    const effectiveDisk = diskCache || fallbackSeed;
    const failAt = Date.now();
    const basePreserved = extractPreservedVersionFields(effectiveDisk);
    const checkedSessions = mergeAndPruneCheckedSessions(
      effectiveDisk,
      sessionKey,
      { status: 'failed', attemptAt, attempts, lastError },
      failAt
    );
    return {
      nextData: {
        ...basePreserved,
        lastSessionKey: sessionKey,
        lastSessionStatus: 'failed',
        lastAttemptAt: attemptAt,
        checkedSessions
      },
      result: basePreserved
    };
  });
}

async function runDetachedFetchAndWaitAsync({
  workerScriptPath,
  cachePath,
  sessionKey,
  releaseUrl,
  workerTimeoutMs,
  parentWaitMs,
  attemptAt,
  attempts,
  envObj
}) {
  try {
    await fs.access(workerScriptPath);
  } catch (_) {
    return { spawned: false };
  }

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (spawned, timedOut = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ spawned, timedOut });
    };
    const timer = setTimeout(() => finish(true, true), Math.max(100, parentWaitMs));
    try {
      const proc = spawn(process.execPath, [workerScriptPath, '--worker'], {
        env: {
          ...envObj,
          DISABLE_QUOTA_HOOK: '1',
          STATUSLINE_PLUGIN_UPDATE_WORKER: '1',
          STATUSLINE_PLUGIN_UPDATE_CACHE_PATH: cachePath,
          STATUSLINE_PLUGIN_UPDATE_SESSION_KEY: sessionKey,
          STATUSLINE_PLUGIN_UPDATE_RELEASE_URL: releaseUrl,
          STATUSLINE_PLUGIN_UPDATE_TIMEOUT_MS: String(workerTimeoutMs),
          STATUSLINE_PLUGIN_UPDATE_ATTEMPT_AT: String(attemptAt),
          STATUSLINE_PLUGIN_UPDATE_ATTEMPTS: String(attempts)
        },
        stdio: 'ignore',
        detached: true,
        windowsHide: true
      });
      proc.on('error', () => finish(false, false));
      proc.on('close', () => finish(true, false));
      proc.unref();
    } catch (_) {
      finish(false, false);
    }
  });
}

/**
 * 檢查外掛是否有可用的 GitHub 新版本；單一互動式 agy 視窗會話僅查詢一次，支援多視窗併行紀錄、pending 租約自癒與背景抓取。
 * @param {object} [options={}]
 * @returns {Promise<object>}
 */
export async function checkPluginUpdateAsync(options = {}) {
  const checkStartedAt = Date.now();
  const installed = await resolveInstalledPluginVersionAsync(options);
  if (options.enabled === false) {
    return {
      installedVersion: installed.version,
      installedTag: installed.tag,
      latestVersion: '',
      latestTag: '',
      updateAvailable: false,
      checked: false,
      skippedNonInteractive: false
    };
  }

  const session = options.session !== undefined ? options.session : await resolveAgySessionAsync(options);
  if (session.found && session.nonInteractive) {
    return {
      installedVersion: installed.version,
      installedTag: installed.tag,
      latestVersion: '',
      latestTag: '',
      updateAvailable: false,
      checked: false,
      skippedNonInteractive: true,
      sessionKey: session.sessionKey
    };
  }

  const homeDir = options.homeDir || os.homedir();
  const explicitCachePath = typeof options.cachePath === 'string' ? options.cachePath.trim() : '';
  const pluginDataDir = typeof options.pluginDataDir === 'string' ? options.pluginDataDir.trim() : '';
  const cachePath = explicitCachePath || getSharedUpdateCachePath(homeDir, pluginDataDir);
  const legacyCachePath = (!explicitCachePath && !pluginDataDir) ? getLegacyCliUpdateCachePath(homeDir) : '';

  const existingCache = await readJsonSafeAsync(cachePath);
  const legacySeed = (!existingCache && legacyCachePath) ? await readJsonSafeAsync(legacyCachePath) : null;
  const seedSource = existingCache || legacySeed;

  const cachedLatestVersion = normalizeSemver(seedSource?.latestVersion || '');
  const cachedLatestTag = cachedLatestVersion
    ? formatVersionTag(seedSource?.latestTag || cachedLatestVersion)
    : '';

  let latestVersion = cachedLatestVersion;
  let latestTag = cachedLatestTag;
  let checked = false;

  const pendingLeaseMs = typeof options.pendingLeaseMs === 'number' && options.pendingLeaseMs >= 0
    ? options.pendingLeaseMs
    : PENDING_LEASE_TTL_MS;

  if (!existingCache && legacySeed && session.found && session.sessionKey && isSessionAlreadyChecked(seedSource, session.sessionKey, checkStartedAt, pendingLeaseMs)) {
    await updatePluginUpdateCacheAsync(cachePath, (diskCache) => {
      if (diskCache) return {};
      return { nextData: legacySeed };
    });
  }

  if (session.found && session.sessionKey && !isSessionAlreadyChecked(seedSource, session.sessionKey, checkStartedAt, pendingLeaseMs)) {
    const now = Date.now();
    // 先於寫入佇列寫入 pending 租約，防止併發重複請求；若程序遭中止導致租約過期，下一次刷新可安全接手重試
    const claimOutcome = await updatePluginUpdateCacheAsync(cachePath, (diskCache) => {
      const effectiveDisk = diskCache || legacySeed;
      if (isSessionAlreadyChecked(effectiveDisk, session.sessionKey, now, pendingLeaseMs)) {
        return { result: { claimed: false, diskCache: effectiveDisk } };
      }
      const prevEntry = hasPlainCheckedSessions(effectiveDisk) ? effectiveDisk.checkedSessions[session.sessionKey] : null;
      const attempts = (prevEntry && typeof prevEntry === 'object' && prevEntry.status === 'pending')
        ? (Number(prevEntry.attempts || 1) + 1)
        : 1;
      const basePreserved = extractPreservedVersionFields(effectiveDisk);
      const checkedSessions = mergeAndPruneCheckedSessions(
        effectiveDisk,
        session.sessionKey,
        { status: 'pending', attemptAt: now, attempts },
        now
      );
      return {
        nextData: {
          ...basePreserved,
          lastSessionKey: session.sessionKey,
          lastSessionStatus: 'pending',
          lastAttemptAt: now,
          checkedSessions
        },
        result: { claimed: true, diskCache: effectiveDisk, attempts }
      };
    });

    if (claimOutcome && claimOutcome.claimed === false) {
      const diskLatest = normalizeSemver(claimOutcome.diskCache?.latestVersion || '');
      if (diskLatest) {
        latestVersion = diskLatest;
        latestTag = formatVersionTag(claimOutcome.diskCache?.latestTag || diskLatest);
      }
    } else {
      const envObj = options.env || process.env;
      const releaseUrl = options.releaseUrl || envObj?.STATUSLINE_PLUGIN_RELEASE_URL || GITHUB_LATEST_RELEASE_URL;
      const envWait = parseInt(envObj?.STATUSLINE_PLUGIN_UPDATE_WAIT_MS || '', 10);
      const elapsedMs = Math.max(0, Date.now() - checkStartedAt);
      const autoBudgetTimeout = Math.min(1500, Math.max(400, 2200 - elapsedMs));
      const timeoutMs = typeof options.timeoutMs === 'number'
        ? options.timeoutMs
        : (!isNaN(envWait) && envWait > 0 ? envWait : autoBudgetTimeout);
      const useDetachedWorker = typeof options.fetchReleaseFn !== 'function' && options.detachedWorker !== false;
      const attempts = claimOutcome?.attempts || 1;

      checked = true;
      let ranDetached = false;
      if (useDetachedWorker) {
        const workerScriptPath = options.workerScriptPath || fileURLToPath(import.meta.url);
        const defaultParentWait = Math.min(850, Math.max(250, 950 - elapsedMs));
        const parentWaitMs = typeof options.timeoutMs === 'number'
          ? options.timeoutMs
          : (!isNaN(envWait) && envWait > 0 ? envWait : defaultParentWait);
        const workerRes = await runDetachedFetchAndWaitAsync({
          workerScriptPath,
          cachePath,
          sessionKey: session.sessionKey,
          releaseUrl,
          workerTimeoutMs: Math.max(timeoutMs, 3500),
          parentWaitMs,
          attemptAt: now,
          attempts,
          envObj
        });
        if (workerRes.spawned) {
          ranDetached = true;
          const afterWorker = await readJsonSafeAsync(cachePath);
          const refreshedLatest = normalizeSemver(afterWorker?.latestVersion || '');
          if (refreshedLatest) {
            latestVersion = refreshedLatest;
            latestTag = formatVersionTag(afterWorker?.latestTag || refreshedLatest);
          }
        }
      }

      if (!ranDetached) {
        const fetchFn = typeof options.fetchReleaseFn === 'function' ? options.fetchReleaseFn : fetchLatestPluginReleaseAsync;
        const res = await fetchFn(releaseUrl, timeoutMs).catch((err) => ({
          ok: false,
          error: err?.message || 'fetch_throw'
        }));
        const finalized = await finalizePluginUpdateResultAsync({
          cachePath,
          sessionKey: session.sessionKey,
          attemptAt: now,
          attempts,
          res,
          fallbackSeed: legacySeed
        });
        if (finalized?.latestVersion) {
          latestVersion = finalized.latestVersion;
          latestTag = finalized.latestTag || formatVersionTag(finalized.latestVersion);
        }
      }
    }
  }

  const updateAvailable = Boolean(installed.version && latestVersion && isVersionBehind(installed.version, latestVersion));
  return {
    installedVersion: installed.version,
    installedTag: installed.tag,
    latestVersion,
    latestTag,
    updateAvailable,
    checked,
    skippedNonInteractive: false,
    sessionKey: session.sessionKey
  };
}

/**
 * 供 Antigravity 2.0 常駐服務共用的 TTL 更新檢查與快取合併寫入函式（保留 CLI checkedSessions 不被覆寫）。
 * @param {object} [options={}]
 * @returns {Promise<{ installedVersion: string, installedTag: string, latestVersion: string, latestTag: string, updateAvailable: boolean, releaseUrl: string, checkedAt: number }>}
 */
export async function resolvePluginUpdateByTtlAsync(options = {}) {
  const installedVersion = typeof options.installedVersion === 'string' ? options.installedVersion : '';
  const homeDir = options.homeDir || os.homedir();
  const pluginDataDir = typeof options.pluginDataDir === 'string' ? options.pluginDataDir : '';
  const targetCachePath = options.cachePath || getSharedUpdateCachePath(homeDir, pluginDataDir);
  const ttlMs = typeof options.ttlMs === 'number' && options.ttlMs >= 0 ? options.ttlMs : SHARED_UPDATE_CACHE_TTL_MS;
  const forceCheck = Boolean(options.forceCheck);
  const releaseUrl = options.releaseUrl || GITHUB_LATEST_RELEASE_URL;
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 1500;
  const fetchFn = typeof options.fetchReleaseFn === 'function' ? options.fetchReleaseFn : fetchLatestPluginReleaseAsync;

  const cached = await readJsonSafeAsync(targetCachePath);
  const now = Date.now();
  let latestVersion = normalizeSemver(cached?.latestVersion || '') || (cached?.latestVersion || '');
  let latestTag = latestVersion ? (cached?.latestTag || formatVersionTag(latestVersion)) : '';
  let checkedAt = Number(cached?.checkedAt || cached?.latestCheckedAt || 0);

  if (forceCheck || !checkedAt || (now - checkedAt) > ttlMs) {
    const res = await fetchFn(releaseUrl, timeoutMs).catch(() => ({ ok: false }));
    if (res?.ok && res.latestVersion) {
      const normalizedLatest = normalizeSemver(res.latestVersion) || res.latestVersion;
      const resolvedTag = res.latestTag || formatVersionTag(normalizedLatest);
      const updated = await updatePluginUpdateCacheAsync(targetCachePath, (diskCache) => {
        const okAt = Date.now();
        const base = (diskCache && typeof diskCache === 'object' && !Array.isArray(diskCache)) ? diskCache : {};
        return {
          nextData: {
            ...base,
            latestVersion: normalizedLatest,
            latestTag: resolvedTag,
            checkedAt: okAt,
            latestCheckedAt: okAt
          },
          result: {
            latestVersion: normalizedLatest,
            latestTag: resolvedTag,
            checkedAt: okAt
          }
        };
      });
      if (updated) {
        latestVersion = updated.latestVersion;
        latestTag = updated.latestTag;
        checkedAt = updated.checkedAt;
      }
    }
  }

  const updateAvailable = Boolean(installedVersion && latestVersion && isVersionBehind(installedVersion, latestVersion));
  return {
    installedVersion,
    installedTag: installedVersion ? `v${installedVersion}` : '',
    latestVersion,
    latestTag,
    updateAvailable,
    releaseUrl,
    checkedAt
  };
}

async function runDetachedPluginUpdateWorkerAsync() {
  const cachePath = process.env.STATUSLINE_PLUGIN_UPDATE_CACHE_PATH || '';
  const sessionKey = process.env.STATUSLINE_PLUGIN_UPDATE_SESSION_KEY || '';
  const releaseUrl = process.env.STATUSLINE_PLUGIN_UPDATE_RELEASE_URL || GITHUB_LATEST_RELEASE_URL;
  const timeoutMs = parseInt(process.env.STATUSLINE_PLUGIN_UPDATE_TIMEOUT_MS || '', 10) || 3500;
  const attemptAt = Number(process.env.STATUSLINE_PLUGIN_UPDATE_ATTEMPT_AT || '') || Date.now();
  const attempts = Number(process.env.STATUSLINE_PLUGIN_UPDATE_ATTEMPTS || '') || 1;
  if (!cachePath || !sessionKey) return;

  const res = await fetchLatestPluginReleaseAsync(releaseUrl, timeoutMs).catch((err) => ({
    ok: false,
    error: err?.message || 'worker_throw'
  }));
  await finalizePluginUpdateResultAsync({
    cachePath,
    sessionKey,
    attemptAt,
    attempts,
    res
  });
}

if (
  process.env.STATUSLINE_PLUGIN_UPDATE_WORKER === '1' &&
  process.argv.includes('--worker') &&
  isDirectExecution(import.meta.url, { treatEmptyArgv1AsDirect: false })
) {
  runDetachedPluginUpdateWorkerAsync().finally(() => process.exit(0));
}
