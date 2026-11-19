import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * 為非同步 Promise 加上逾時與錯誤防禦，超時或失敗時回傳預設值。
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {T} fallbackVal
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, fallbackVal) {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackVal), ms);
  });
  return Promise.race([
    promise
      .then((val) => {
        clearTimeout(timer);
        return val;
      })
      .catch(() => {
        clearTimeout(timer);
        return fallbackVal;
      }),
    timeoutPromise
  ]);
}

/**
 * 執行外部探測指令且永不拋出例外。
 * 當設定 options.execFile 與 options.execArgs 時，會直接呼叫目標執行檔
 * （不經由 cmd.exe / shell 包裝），確保逾時終止時直接結束探測行程而不遺留孤兒孫行程。
 * @param {string} cmd
 * @param {object} [options]
 * @returns {Promise<{ stdout: string, ok: boolean, notFound: boolean }>}
 */
export async function runCmdDetailedAsync(cmd, options = {}) {
  const { execFile: file, execArgs, ...execOpts } = options;
  const opts = {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 500,
    ...execOpts
  };
  try {
    const { stdout } = (file && Array.isArray(execArgs))
      ? await execFileAsync(file, execArgs, opts)
      : await execAsync(cmd, opts);
    return { stdout: (stdout || '').trim(), ok: true, notFound: false };
  } catch (err) {
    const errMsg = `${err?.stderr || ''} ${err?.message || ''}`;
    const notFound =
      err?.code === 'ENOENT' ||
      err?.code === 127 ||
      /not found|not recognized|找不到|不是內部或外部命令|不是内部或外部命令/i.test(errMsg);
    return { stdout: (err?.stdout || '').trim(), ok: false, notFound };
  }
}
