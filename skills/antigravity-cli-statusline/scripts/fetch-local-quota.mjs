import { spawnSync, execSync } from 'child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import https from 'https';
import os from 'os';
import { pathToFileURL } from 'url';

const CACHE_FILE = join(os.homedir(), '.gemini', 'tmp', 'real_quota_cache.json');

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
        const psCmd = "powershell.exe -NoProfile -Command \"Get-CimInstance Win32_Process -Filter 'Name like ''%antigravity%'' or Name like ''%agy%'' or Name like ''%language_server%''' | Select-Object ProcessID, CommandLine | ConvertTo-Json -Compress\"";
        output = execSync(psCmd, { encoding: 'utf8', windowsHide: true }).trim();
        if (output) {
          const jsonStart = output.search(/\[|\{/);
          if (jsonStart !== -1) {
            output = output.slice(jsonStart);
          }
          let processes = JSON.parse(output);
          if (!Array.isArray(processes)) {
            processes = [processes];
          }
          for (const proc of processes) {
            const cmdLine = proc.CommandLine || '';
            const pid = proc.ProcessID;
            if (!pid) continue;
            
            const lower = cmdLine.toLowerCase();
            const isCli = (lower.includes('antigravity') || lower.includes('agy')) && !lower.includes('statusline-quota');
            const isLang = lower.includes('language_server');
            if (!isCli && !isLang) continue;
            
            const matchToken = cmdLine.match(/--csrf_token\s+([^\s"']+)/) || cmdLine.match(/--csrf_token=([^\s"']+)/);
            const token = matchToken ? matchToken[1] : '';
            candidates.push({
              pid: pid,
              csrf_token: token,
              score: (isCli ? 40 : 0) + (isLang ? 20 : 0) + (token ? 10 : 0),
              kind: isCli ? 'cli' : 'language_server'
            });
          }
        }
      } catch (e) {}
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
          
          const matchToken = line.match(/--csrf_token(?:=|\s+)([^\s"']+)/);
          const token = matchToken ? matchToken[1] : '';
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

function requestUserStatus(port, csrfToken) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' }
    });
    
    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: '/exa.language_server_pb.LanguageServerService/GetUserStatus',
      method: 'POST',
      rejectUnauthorized: false,
      timeout: 2000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': csrfToken,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
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

/**
 * Sends a request to retrieve the weekly quota summary from the language server.
 * @param {number} port - The port number of the active language server.
 * @param {string} csrfToken - The CSRF token for request authentication.
 * @returns {Promise<object>} A promise resolving to the parsed response JSON object.
 */
function requestQuotaSummary(port, csrfToken) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' }
    });

    const options = {
      hostname: '127.0.0.1',
      port: port,
      path: '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',
      method: 'POST',
      rejectUnauthorized: false,
      timeout: 2000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
        'X-Codeium-Csrf-Token': csrfToken,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
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

async function fetchLiveQuotaCache() {
  const candidates = findServerCandidates();
  // 跨所有候選者合併模型資料，避免只取到部分模型
  const allModels = {};
  const weekly = {};
  let accountEmail = '';
  let planTierName = '';
  let planStatusData = {};
  
  for (const info of candidates) {
    const ports = getListeningPorts(info.pid);
    for (const port of ports) {
      try {
        const response = await requestUserStatus(port, info.csrf_token);
        const userStatus = response.userStatus || {};
        
        if (userStatus.email) accountEmail = userStatus.email;
        if (userStatus.userTier) {
          if (userStatus.userTier.name) planTierName = userStatus.userTier.name;
        }
        if (userStatus.planStatus) planStatusData = userStatus.planStatus;
        
        const cascade = userStatus.cascadeModelConfigData || {};
        for (const model of cascade.clientModelConfigs || []) {
          const quotaInfo = model.quotaInfo;
          if (!quotaInfo) continue; // 沒有 quotaInfo 視為不受限，或不需處理
          
          let fraction = 1;
          if (quotaInfo.remainingFraction !== undefined) {
            fraction = parseFloat(quotaInfo.remainingFraction);
          } else if (quotaInfo.resetTime) {
            // 如果有 resetTime 但沒有 remainingFraction，表示 protobuf 將 0 省略了
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
          // 若同一模型已存在，以最新（較低）的額度為準
          if (!allModels[normKey] || entry.remaining_percentage < allModels[normKey].remaining_percentage) {
            allModels[normKey] = entry;
          }
        }

        // Fetch RetrieveUserQuotaSummary
        try {
          const summaryResponse = await requestQuotaSummary(port, info.csrf_token);
          const weeklyBuckets = parseWeeklyBuckets(summaryResponse);
          for (const pool of Object.keys(weeklyBuckets)) {
            if (!weekly[pool] || weeklyBuckets[pool].remaining_percentage < weekly[pool].remaining_percentage) {
              weekly[pool] = weeklyBuckets[pool];
            }
          }
        } catch (weeklyErr) {
          // weekly failure never breaks the 5h path
        }
      } catch (e) {
        continue;
      }
    }
  }
  if (Object.keys(allModels).length > 0 || Object.keys(weekly).length > 0) {
    return { 
      models: allModels, 
      weekly,
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

// only auto-run when executed directly, not when imported by tests
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}