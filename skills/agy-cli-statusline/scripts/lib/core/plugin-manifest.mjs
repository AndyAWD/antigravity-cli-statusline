import fsSync, { promises as fsPromises } from 'fs';
import os from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { HOOK_VERSION, PLUGIN_PACKAGE_NAME } from './constants.mjs';
import { readJsonSafeAsync, readJsonSafeSync } from './fs-utils.mjs';
import { compareSemver, formatVersionTag, normalizeSemver } from './semver.mjs';

const MANIFEST_FILES = ['plugin.json', 'package.json'];

/**
 * 驗證並擷取外掛清單物件中的有效版本號資訊。
 * @param {object|null} parsed
 * @param {string} fileName
 * @param {string} manifestPath
 * @param {boolean} requireExplicitName
 * @returns {{ version: string, tag: string, source: string }|null}
 */
function extractManifestInfo(parsed, fileName, manifestPath, requireExplicitName) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const manifestName = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  if (fileName === 'package.json' || requireExplicitName) {
    if (manifestName !== PLUGIN_PACKAGE_NAME) return null;
  } else if (manifestName && manifestName !== PLUGIN_PACKAGE_NAME) {
    return null;
  }
  if (typeof parsed.version === 'string' && parsed.version.trim()) {
    const norm = normalizeSemver(parsed.version);
    const tag = formatVersionTag(parsed.version);
    if (norm || tag) {
      return {
        version: norm || parsed.version.trim().replace(/^v/i, ''),
        tag,
        source: manifestPath
      };
    }
  }
  return null;
}

/**
 * 建立跨來源外掛安裝目錄候選清單（不含動態掃描 pluginsRoot 子目錄）。
 * @param {string} homeDir
 * @param {string} [workspacePath='']
 * @returns {Array<{ dir: string, requireExplicitName: boolean, priority: number }>}
 */
function createBaseCandidateDirs(homeDir, workspacePath = '') {
  const pluginsRoot = join(homeDir, '.gemini', 'config', 'plugins');
  const candidateDirs = [
    { dir: join(pluginsRoot, PLUGIN_PACKAGE_NAME), requireExplicitName: false, priority: 3 },
    { dir: join(homeDir, '.agents', 'plugins', PLUGIN_PACKAGE_NAME), requireExplicitName: false, priority: 2 }
  ];
  if (typeof workspacePath === 'string' && workspacePath.trim()) {
    candidateDirs.push({
      dir: join(workspacePath.trim(), '.agents', 'plugins', PLUGIN_PACKAGE_NAME),
      requireExplicitName: false,
      priority: 2
    });
  }
  return candidateDirs;
}

/**
 * 依完整 SemVer（含 prerelease）及路徑優先權選出最佳外掛版本候選項目。
 * @param {Array<object|null>} candidates
 * @returns {object|null}
 */
function selectBestPluginCandidate(candidates) {
  let best = null;
  for (const cand of candidates) {
    if (!cand) continue;
    if (!best) {
      best = cand;
      continue;
    }
    const cmp = compareSemver(cand.version, best.version);
    if (cmp !== null) {
      if (cmp > 0 || (cmp === 0 && cand.priority > best.priority)) {
        best = cand;
      }
    } else if (cand.priority > best.priority) {
      best = cand;
    }
  }
  return best;
}

/**
 * 非同步從指定外掛目錄讀取 plugin.json / package.json 版本資訊。
 * @param {string} dirPath
 * @param {boolean} [requireExplicitName=false]
 * @returns {Promise<{ version: string, tag: string, source: string }|null>}
 */
export async function readPluginManifestFromDirAsync(dirPath, requireExplicitName = false) {
  if (!dirPath) return null;
  for (const fileName of MANIFEST_FILES) {
    const manifestPath = join(dirPath, fileName);
    const parsed = await readJsonSafeAsync(manifestPath);
    const info = extractManifestInfo(parsed, fileName, manifestPath, requireExplicitName);
    if (info) return info;
  }
  return null;
}

/**
 * 同步從指定外掛目錄讀取 plugin.json / package.json 版本資訊。
 * @param {string} dirPath
 * @param {boolean} [requireExplicitName=false]
 * @returns {{ version: string, tag: string, source: string }|null}
 */
export function readPluginManifestFromDirSync(dirPath, requireExplicitName = false) {
  if (!dirPath) return null;
  for (const fileName of MANIFEST_FILES) {
    const manifestPath = join(dirPath, fileName);
    const parsed = readJsonSafeSync(manifestPath);
    const info = extractManifestInfo(parsed, fileName, manifestPath, requireExplicitName);
    if (info) return info;
  }
  return null;
}

/**
 * 非同步探索並解析已安裝的外掛版本（支援 Marketplace 數字目錄、.agents/plugins 與工作區目錄）。
 * @param {object} [options={}]
 * @returns {Promise<{ version: string, tag: string, source: string }>}
 */
export async function resolveInstalledPluginVersionAsync(options = {}) {
  if (options.pluginDir) {
    const explicitMatch = await readPluginManifestFromDirAsync(options.pluginDir, false);
    if (explicitMatch) return explicitMatch;
  } else {
    const homeDir = options.homeDir || os.homedir();
    const pluginsRoot = join(homeDir, '.gemini', 'config', 'plugins');
    const candidateDirs = createBaseCandidateDirs(homeDir, options.workspacePath || '');

    try {
      const entries = await fsPromises.readdir(pluginsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry || entry.name === PLUGIN_PACKAGE_NAME) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          candidateDirs.push({
            dir: join(pluginsRoot, entry.name),
            requireExplicitName: true,
            priority: 1
          });
        }
      }
    } catch (_) {}

    const resolvedCandidates = await Promise.all(
      candidateDirs.map(async (c) => {
        const found = await readPluginManifestFromDirAsync(c.dir, c.requireExplicitName);
        return found ? { ...found, priority: c.priority } : null;
      })
    );

    const best = selectBestPluginCandidate(resolvedCandidates);
    if (best) {
      return { version: best.version, tag: best.tag, source: best.source };
    }
  }

  if (options.allowScriptRelativeFallback !== false) {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    // 由 scripts/lib/core/ 往上 5 層即為外掛根目錄
    const repoMatch = await readPluginManifestFromDirAsync(join(moduleDir, '..', '..', '..', '..', '..'), false);
    if (repoMatch) return repoMatch;
  }

  if (options.fallbackVersion === null) {
    return { version: '', tag: '', source: '' };
  }
  const fallbackRaw = typeof options.fallbackVersion === 'string' ? options.fallbackVersion : HOOK_VERSION;
  const fallbackNorm = normalizeSemver(fallbackRaw);
  return {
    version: fallbackNorm || fallbackRaw,
    tag: formatVersionTag(fallbackRaw),
    source: 'embedded'
  };
}

/**
 * 同步探索已安裝的最高版本外掛目錄（與非同步探索規則完全一致，含工作區與完整 SemVer 比較）。
 * @param {string} [home=os.homedir()]
 * @param {string} [workspacePath='']
 * @returns {{ dir: string, version: string, tag: string, source: string, priority?: number }}
 */
export function discoverInstalledPluginSync(home = os.homedir(), workspacePath = '') {
  const pluginsRoot = join(home, '.gemini', 'config', 'plugins');
  const candidates = createBaseCandidateDirs(home, workspacePath);

  try {
    if (fsSync.existsSync(pluginsRoot)) {
      const entries = fsSync.readdirSync(pluginsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry || entry.name === PLUGIN_PACKAGE_NAME) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          candidates.push({
            dir: join(pluginsRoot, entry.name),
            requireExplicitName: true,
            priority: 1
          });
        }
      }
    }
  } catch (_) {}

  const resolved = candidates.map((cand) => {
    const info = readPluginManifestFromDirSync(cand.dir, cand.requireExplicitName);
    if (!info) return null;
    return {
      dir: cand.dir,
      version: info.version,
      tag: info.tag,
      source: info.source,
      priority: cand.priority
    };
  });

  const best = selectBestPluginCandidate(resolved);
  return best || { dir: join(pluginsRoot, PLUGIN_PACKAGE_NAME), version: '', tag: '', source: '' };
}
