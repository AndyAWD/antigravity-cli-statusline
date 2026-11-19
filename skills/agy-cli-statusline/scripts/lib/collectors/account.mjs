import { promises as fs } from 'fs';
import { join } from 'path';
import os from 'os';
import { readJsonSafeAsync, writeFileAndVerifyNoBOM } from '../core/fs-utils.mjs';

/**
 * 自 Antigravity CLI 日誌檔頭部讀取已登入帳號的電子郵件地址。
 * @returns {Promise<string>}
 */
export async function readEmailFromCliLogAsync() {
  const cliDir = join(os.homedir(), '.gemini', 'antigravity-cli');
  const candidates = [join(cliDir, 'cli.log')];
  try {
    const logDir = join(cliDir, 'log');
    const files = await fs.readdir(logDir);
    const latestLogs = files.filter(f => f.startsWith('cli-') && f.endsWith('.log')).sort().reverse().slice(0, 2);
    for (const f of latestLogs) {
      candidates.push(join(logDir, f));
    }
  } catch (_) {}

  for (const logPath of candidates) {
    let fh;
    try {
      fh = await fs.open(logPath, 'r');
      const buf = Buffer.alloc(65536);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      fh = null;
      if (bytesRead > 0) {
        const text = buf.subarray(0, bytesRead).toString('utf8');
        const m = text.match(/(?:applyAuthResult:\s*email=|authenticated successfully as\s+)([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (m && m[1]) return m[1];
      }
    } catch (_) {
      if (fh) {
        try { await fh.close(); } catch (_) {}
      }
    }
  }
  return '';
}

/**
 * 讀取並更新帳號中繼資料快取（電子郵件、訂閱方案等級與終端機寬度）。
 * @param {object} [meta]
 * @param {{ allowCliLogScan?: boolean }} [options]
 * @returns {Promise<object>}
 */
export async function manageAccountMetaCacheAsync(meta, { allowCliLogScan = true } = {}) {
  const accountMetaPath = join(os.homedir(), '.gemini', 'tmp', 'account_meta_cache.json');
  const cachedAccount = (await readJsonSafeAsync(accountMetaPath)) || {};

  let email = meta?.email || meta?.account?.email;
  if (allowCliLogScan && !email && !cachedAccount.email) {
    email = await readEmailFromCliLogAsync();
  }
  const planTier = meta?.plan_tier || meta?.account?.plan_tier;
  const termWidth = (typeof meta?.terminal_width === 'number' && meta.terminal_width > 80) ? meta.terminal_width : 0;

  let updated = false;
  if (email && cachedAccount.email !== email) {
    cachedAccount.email = email;
    updated = true;
  }
  if (planTier && cachedAccount.planTier !== planTier) {
    cachedAccount.planTier = planTier;
    updated = true;
  }
  if (termWidth && cachedAccount.terminalWidth !== termWidth) {
    cachedAccount.terminalWidth = termWidth;
    updated = true;
  }

  if (updated) {
    try {
      await writeFileAndVerifyNoBOM(accountMetaPath, JSON.stringify(cachedAccount));
    } catch (_) {}
  }
  return cachedAccount;
}
