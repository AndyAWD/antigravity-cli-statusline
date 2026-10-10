import { spawnSync, execSync } from 'child_process';
import { writeFileSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import path, { dirname, join } from 'path';
import http from 'http';
import https from 'https';
import os from 'os';
import { pathToFileURL, fileURLToPath } from 'url';

const CACHE_FILE = join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');
const ENV_CACHE_FILE = join(os.homedir(), '.gemini', 'tmp', 'antigravity_ls_env.json');

function formatResetTime(resetTimeStr) {
  try {
    const reset = new Date(resetTimeStr);
    const diffSeconds = Math.floor((reset.getTime() - Date.now()) / 1000);
    if (diffSeconds <= 0) return 'now';
    const minutes = Math.floor((diffSeconds + 59) / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      return remHours ? `${days}d ${remHours}h` : `${days}d`;
    }
    return mins ? `${hours}h ${mins}m` : `${hours}h`;
  } catch (e) {
    return '';
  }
}

function findServerCandidates() {
  try {
    let output = '';
    const candidates = [];
    if (process.platform === 'win32') {
      try {
        const psCmd = "powershell.exe -NoProfile -Command \"Get-CimInstance Win32_Process -Filter 'Name like ''%antigravity%'' or Name like ''%agy%'' or Name like ''%language_server%''' | Select-Object ProcessID, Name, CommandLine | ConvertTo-Json -Compress\"";
        output = execSync(psCmd, { encoding: 'utf8', windowsHide: true }).trim();
        if (output) {
          const jsonStart = output.search(/\[|\{/);
          if (jsonStart !== -1) {
            output = output.slice(jsonStart);
          }
          let processes = JSON.parse(output);
          if (!Array.isArray(processes)) processes = [processes];
          for (const proc of processes) {
            const cmdLine = proc.CommandLine || '';
            const pid = proc.ProcessId || proc.ProcessID;
            if (!pid) continue;
            
            const lower = (cmdLine + ' ' + (proc.Name || '')).toLowerCase();
            const isCli = (lower.includes('antigravity') || lower.includes('agy')) && !lower.includes('statusline-quota');
            const isLang = lower.includes('language_server');
            if (!isCli && !isLang) continue;
            
            const fallbackToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
            const matchToken = cmdLine.match(/--csrf_token\s+([^\s"']+)/) || cmdLine.match(/--csrf_token=([^\s"']+)/);
            const token = matchToken ? matchToken[1] : fallbackToken;
            candidates.push({
              pid: pid,
              csrf_token: token,
              score: (isCli ? 40 : 0) + (isLang ? 20 : 0) + (token ? 10 : 0),
              kind: isCli ? 'cli' : 'language_server'
            });
          }
        }
      } catch (e) {}

      if (candidates.length === 0) {
        try {
          const wmicOut = execSync('wmic process get processid,caption,commandline /format:csv', { encoding: 'utf8', windowsHide: true });
          const lines = wmicOut.split('\n');
          for (const line of lines) {
            const lower = line.toLowerCase();
            if (!lower.includes('language_server') && !lower.includes('agy') && !lower.includes('antigravity')) continue;
            if (lower.includes('statusline-quota')) continue;
            const parts = line.split(',');
            if (parts.length >= 3) {
              const pidStr = parts[parts.length - 1].trim();
              const pid = parseInt(pidStr, 10);
              if (!isNaN(pid)) {
                const fallbackToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
                const matchToken = line.match(/--csrf_token\s+([^\s"']+)/) || line.match(/--csrf_token=([^\s"']+)/);
                const token = matchToken ? matchToken[1] : fallbackToken;
                candidates.push({
                  pid: pid,
                  csrf_token: token,
                  score: 20 + (token ? 10 : 0),
                  kind: 'language_server'
                });
              }
            }
          }
        } catch (e) {}
      }
    } else {
      try {
        output = execSync('ps auxww', { encoding: 'utf8', windowsHide: true });
        const lines = output.split('\n');
        for (const line of lines) {
          const lower = line.toLowerCase();
          const isCli = (/\bagy(\s|$)/.test(lower) || lower.includes('antigravity-cli')) && !lower.includes('statusline-quota');
          const isLang = lower.includes('language_server');
          if (!isCli && !isLang) continue;
          const parts = line.trim().split(/\s+/);
          if (parts.length < 11) continue;
          const pid = parseInt(parts[1], 10);
          if (isNaN(pid)) continue;
          
          const fallbackToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
          const matchToken = line.match(/--csrf_token(?:=|\s+)([^\s"']+)/);
          const token = matchToken ? matchToken[1] : fallbackToken;
          candidates.push({
            pid,
            csrf_token: token,
            score: (isCli ? 40 : 0) + (isLang ? 20 : 0) + (token ? 10 : 0) - (lower.includes('/applications/antigravity.app') ? 10 : 0),
            kind: isCli ? 'cli' : 'language_server'
          });
        }
      } catch (e) {}
    }
    return candidates.sort((a, b) => b.score - a.score);
  } catch (e) {
    return [];
  }
}

function getListeningPorts(pid) {
  const ports = [];
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr ${pid}`, { encoding: 'utf8', windowsHide: true });
      const matches = [...output.matchAll(/TCP\s+(?:127\.0\.0\.1|0\.0\.0\.0):(\d+).*?LISTENING/g)];
      for (const m of matches) {
        const port = parseInt(m[1], 10);
        if (!ports.includes(port)) ports.push(port);
      }
    } else {
      const output = execSync(`lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN`, { encoding: 'utf8', windowsHide: true });
      const matches = [...output.matchAll(/:(\d+)\s+\(LISTEN\)/g)];
      for (const m of matches) {
        const port = parseInt(m[1], 10);
        if (!ports.includes(port)) ports.push(port);
      }
    }
  } catch (e) {}
  return ports.sort((a, b) => a - b);
}

function requestRpc(host, port, csrfToken, rpcPath, useHttps = false) {
  return new Promise((resolve, reject) => {
    const client = useHttps ? https : http;
    const postData = JSON.stringify({
      metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' }
    });

    const options = {
      hostname: host || '127.0.0.1',
      port: port,
      path: rpcPath,
      method: 'POST',
      rejectUnauthorized: false,
      timeout: 2000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': csrfToken || '',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch(e) { reject(e); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

function requestService(host, port, csrfToken, rpcPath, preferHttps = true) {
  return requestRpc(host, port, csrfToken, rpcPath, preferHttps).catch((err) => {
    // 若伺服器已完成 TLS/HTTP 握手並回傳 HTTP 狀態碼錯誤（如 401/404/400），
    // 說明該協定已握手成功，不可切換協定。對 Go TLS 監聽端口發送明文 HTTP 會觸發終端握手錯誤。
    if (err.message && err.message.startsWith('HTTP ')) {
      throw err;
    }
    return requestRpc(host, port, csrfToken, rpcPath, !preferHttps);
  });
}

export function requestUserStatus(port, csrfToken, host = '127.0.0.1', preferHttps = true) {
  return requestService(host, port, csrfToken, '/exa.language_server_pb.LanguageServerService/GetUserStatus', preferHttps);
}

/**
 * Sends a request to retrieve the weekly quota summary from the language server.
 * @param {number} port - The port number of the active language server.
 * @param {string} csrfToken - The CSRF token for request authentication.
 * @param {string} [host='127.0.0.1'] - The host of the active language server.
 * @param {boolean} [preferHttps=true] - Whether to try HTTPS first before falling back to HTTP.
 * @returns {Promise<object>} A promise resolving to the parsed response JSON object.
 */
export function requestQuotaSummary(port, csrfToken, host = '127.0.0.1', preferHttps = true) {
  return requestService(host, port, csrfToken, '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary', preferHttps);
}

/**
 * Extracts weekly quota buckets from a RetrieveUserQuotaSummary response.
 * @param {object} summaryResponse - The parsed JSON response object from the language server.
 * @returns {Object<string, {remaining_percentage: number, reset_time?: string, refreshes_in?: string}>} Map of weekly pool remaining quota, reset time, and formatted refresh countdown.
 */
export function parseWeeklyBuckets(summaryResponse) {
  const weekly = {};
  if (!summaryResponse) return weekly;
  const resObj = summaryResponse.response || summaryResponse;
  if (!resObj.groups) return weekly;
  for (const group of resObj.groups) {
    if (!group.buckets) continue;
    for (const bucket of group.buckets) {
      const windowVal = bucket.window || bucket.windowVal || '';
      if (windowVal !== 'weekly') continue;
      const bucketId = bucket.bucketId || '';
      if (!bucketId) continue;
      const pool = bucketId.replace(/-weekly$/, '');

      let fraction = 1;
      const remainingField = bucket.remainingFraction !== undefined ? bucket.remainingFraction : bucket.remaining;
      if (remainingField !== undefined && remainingField !== null) {
        fraction = parseFloat(remainingField);
      } else if (bucket.resetTime || bucket.reset) {
        fraction = 0;
      }

      const remainingNum = fraction > 1 ? fraction : fraction * 100;
      const remaining = Math.max(0, Math.min(100, remainingNum));

      const entry = {
        remaining_percentage: remaining
      };

      const resetTime = bucket.resetTime || bucket.reset;
      if (resetTime) {
        entry.reset_time = resetTime;
        entry.refreshes_in = formatResetTime(resetTime);
      }

      if (!weekly[pool] || entry.remaining_percentage < weekly[pool].remaining_percentage) {
        weekly[pool] = entry;
      }
    }
  }
  return weekly;
}

/**
 * Extracts short-term (5h / 3h / hourly) quota buckets from a RetrieveUserQuotaSummary response.
 * @param {object} summaryResponse - The parsed JSON response object from the language server.
 * @returns {Object<string, {remaining_percentage: number, reset_time?: string, refreshes_in?: string}>} Map of short-term pool remaining quota, reset time, and formatted refresh countdown.
 */
export function parseShortTermBuckets(summaryResponse) {
  const shortTerm = {};
  if (!summaryResponse) return shortTerm;
  const resObj = summaryResponse.response || summaryResponse;
  if (!resObj.groups) return shortTerm;
  for (const group of resObj.groups) {
    if (!group.buckets) continue;
    for (const bucket of group.buckets) {
      const windowVal = bucket.window || bucket.windowVal || '';
      if (windowVal === 'weekly') continue;
      const bucketId = bucket.bucketId || '';
      if (!bucketId) continue;
      const pool = bucketId.replace(/-(5h|3h|hourly|shortterm)$/, '');

      let fraction = 1;
      const remainingField = bucket.remainingFraction !== undefined ? bucket.remainingFraction : bucket.remaining;
      if (remainingField !== undefined && remainingField !== null) {
        fraction = parseFloat(remainingField);
      } else if (bucket.resetTime || bucket.reset) {
        fraction = 0;
      }

      const remainingNum = fraction > 1 ? fraction : fraction * 100;
      const remaining = Math.max(0, Math.min(100, remainingNum));

      const entry = {
        remaining_percentage: remaining
      };

      const resetTime = bucket.resetTime || bucket.reset;
      if (resetTime) {
        entry.reset_time = resetTime;
        entry.refreshes_in = formatResetTime(resetTime);
      }

      if (!shortTerm[pool] || entry.remaining_percentage < shortTerm[pool].remaining_percentage) {
        shortTerm[pool] = entry;
      }
    }
  }
  return shortTerm;
}

export async function fetchLiveQuotaCache() {
  const allModels = {};
  const weekly = {};
  const shortTerm = {};
  let accountEmail = '';
  let planTierName = '';
  let planStatusData = {};

  const processStatusAndSummary = (response, summaryResponse) => {
    const userStatus = response?.userStatus || {};
    if (userStatus.email) accountEmail = userStatus.email;
    if (userStatus.userTier?.name) planTierName = userStatus.userTier.name;
    if (userStatus.planStatus) planStatusData = userStatus.planStatus;

    const cascade = userStatus.cascadeModelConfigData || {};
    for (const model of cascade.clientModelConfigs || []) {
      const quotaInfo = model.quotaInfo;
      if (!quotaInfo) continue;

      let fraction = 1;
      if (quotaInfo.remainingFraction !== undefined) {
        fraction = parseFloat(quotaInfo.remainingFraction);
      } else if (quotaInfo.resetTime) {
        fraction = 0;
      } else {
        continue;
      }

      const label = model.label || (model.modelOrAlias && model.modelOrAlias.model) || 'Unknown';
      const remainingNum = fraction > 1 ? fraction : fraction * 100;
      const remaining = Math.max(0, Math.min(100, remainingNum));
      const entry = {
        name: label,
        remaining_percentage: remaining,
      };
      if (quotaInfo.resetTime) {
        entry.reset_time = quotaInfo.resetTime;
        entry.refreshes_in = formatResetTime(quotaInfo.resetTime);
      }
      const normKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!allModels[normKey] || entry.remaining_percentage < allModels[normKey].remaining_percentage) {
        allModels[normKey] = entry;
      }
    }

    if (summaryResponse) {
      const weeklyBuckets = parseWeeklyBuckets(summaryResponse);
      for (const pool of Object.keys(weeklyBuckets)) {
        if (!weekly[pool] || weeklyBuckets[pool].remaining_percentage < weekly[pool].remaining_percentage) {
          weekly[pool] = weeklyBuckets[pool];
        }
      }
      const shortTermBuckets = parseShortTermBuckets(summaryResponse);
      for (const pool of Object.keys(shortTermBuckets)) {
        if (!shortTerm[pool] || shortTermBuckets[pool].remaining_percentage < shortTerm[pool].remaining_percentage) {
          shortTerm[pool] = shortTermBuckets[pool];
        }
      }
    }
  };

  // 1. 優先使用 Antigravity CLI 注入的環境變數 (極速直連，零進程開銷)
  let envLsAddr = process.env.ANTIGRAVITY_LS_ADDRESS;
  let envCsrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
  let envLoadedFromDisk = false;

  // 若 statusLine.command 等子進程環境未繼承環境變數，從最新會話快取中載入
  if (!envLsAddr || !envCsrfToken) {
    try {
      const savedEnv = JSON.parse(readFileSync(ENV_CACHE_FILE, 'utf8'));
      if (!envLsAddr && savedEnv.ls_address) {
        envLsAddr = savedEnv.ls_address;
        envLoadedFromDisk = true;
      }
      if (!envCsrfToken && savedEnv.csrf_token) envCsrfToken = savedEnv.csrf_token;
    } catch (_) {}
  } else {
    // 將有效的直連位址與 Token 持久化，供後續未獲取環境變數的 Hook 子進程共用
    try {
      mkdirSync(dirname(ENV_CACHE_FILE), { recursive: true });
      writeFileSyncAndVerifyNoBOM(ENV_CACHE_FILE, JSON.stringify({
        ls_address: envLsAddr,
        csrf_token: envCsrfToken,
        updatedAt: Date.now()
      }, null, 2));
    } catch (_) {}
  }

  if (envLsAddr) {
    try {
      const [host, portStr] = envLsAddr.split(':');
      const port = parseInt(portStr, 10);
      if (!isNaN(port)) {
        // ANTIGRAVITY_LS_ADDRESS 為 HTTP 協定，直接以 HTTP 快路徑連線
        const response = await requestUserStatus(port, envCsrfToken, host, false);
        let summaryResponse = null;
        try {
          summaryResponse = await requestQuotaSummary(port, envCsrfToken, host, false);
        } catch (_) {}
        processStatusAndSummary(response, summaryResponse);
      }
    } catch (_) {
      // 若從磁碟快取載入的連線位址失效（舊會話已終止），清除過期的 token 與快取檔案
      if (envLoadedFromDisk) {
        envCsrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '';
        try { unlinkSync(ENV_CACHE_FILE); } catch (_) {}
      }
    }
  }

  // 2. 若環境變數通道未獲取到資料，降級回進程掃描（向下相容舊版或獨立 IDE）
  if (Object.keys(allModels).length === 0 && Object.keys(weekly).length === 0) {
    const candidates = findServerCandidates();
    for (const info of candidates) {
      const ports = getListeningPorts(info.pid);
      for (const port of ports) {
        try {
          const token = info.csrf_token || envCsrfToken;
          // 未知掃描端口優先使用 HTTPS，避免對 Go TLS Listener 發送明文 HTTP 觸發終端報錯
          const response = await requestUserStatus(port, token, '127.0.0.1', true);
          let summaryResponse = null;
          try {
            summaryResponse = await requestQuotaSummary(port, token, '127.0.0.1', true);
          } catch (_) {}
          processStatusAndSummary(response, summaryResponse);
        } catch (_) {
          continue;
        }
      }
    }
  }

  if (Object.keys(allModels).length > 0 || Object.keys(weekly).length > 0 || Object.keys(shortTerm).length > 0) {
    return { 
      models: allModels, 
      weekly,
      shortTerm,
      updatedAt: Date.now(),
      email: accountEmail,
      planTier: planTierName,
      planStatus: planStatusData
    };
  }
  return null;
}

function writeFileSyncAndVerifyNoBOM(filePath, content) {
  writeFileSync(filePath, content, { encoding: 'utf8' });
  let buffer = readFileSync(filePath);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    buffer = buffer.slice(3);
    writeFileSync(filePath, buffer);
  }
}

async function main() {
  try {
    const cache = await fetchLiveQuotaCache();
    if (cache) {
      mkdirSync(dirname(CACHE_FILE), { recursive: true });
      writeFileSyncAndVerifyNoBOM(CACHE_FILE, JSON.stringify(cache, null, 2));
    }
  } catch (e) {}
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    const scriptPath = process.argv[1];
    const metaPath = fileURLToPath(import.meta.url);
    return path.resolve(scriptPath).toLowerCase() === path.resolve(metaPath).toLowerCase();
  } catch (e) {
    return false;
  }
}

// only auto-run when executed directly, not when imported by tests
if (isDirectExecution()) {
  main();
}