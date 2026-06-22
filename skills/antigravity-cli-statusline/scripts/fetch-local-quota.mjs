import { spawnSync, execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import https from 'https';
import os from 'os';

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
        const psCmd = "powershell.exe -NoProfile -Command \"Get-CimInstance Win32_Process -Filter 'Name like ''%agy%'' or Name like ''%language_server%''' | Select-Object ProcessID, CommandLine | ConvertTo-Json -Compress\"";
        output = execSync(psCmd, { encoding: 'utf8', windowsHide: true }).trim();
        if (output) {
          let processes = JSON.parse(output);
          if (!Array.isArray(processes)) {
            processes = [processes];
          }
          for (const proc of processes) {
            const cmdLine = proc.CommandLine || '';
            const pid = proc.ProcessID;
            if (!pid) continue;
            
            const lower = cmdLine.toLowerCase();
            const isCli = lower.includes('agy') && !lower.includes('statusline-quota');
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
          const isCli = /\bagy(\s|$)/.test(lower);
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

async function fetchLiveQuotaCache() {
  const candidates = findServerCandidates();
  // 跨所有候選者合併模型資料，避免只取到部分模型
  const allModels = {};
  let accountEmail = '';
  let planTierName = '';
  let aiCreditsAmount = '';
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
          if (userStatus.userTier.availableCredits && userStatus.userTier.availableCredits.length > 0) {
            aiCreditsAmount = userStatus.userTier.availableCredits[0].creditAmount || '';
          }
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
      } catch (e) {
        continue;
      }
    }
  }
  if (Object.keys(allModels).length > 0) {
    return { 
      models: allModels, 
      updatedAt: Date.now(),
      email: accountEmail,
      planTier: planTierName,
      aiCredits: aiCreditsAmount,
      planStatus: planStatusData
    };
  }
  return null;
}

async function main() {
  try {
    const cache = await fetchLiveQuotaCache();
    if (cache) {
      mkdirSync(dirname(CACHE_FILE), { recursive: true });
      writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), { encoding: 'utf8' });
    }
  } catch (e) {}
}

main();