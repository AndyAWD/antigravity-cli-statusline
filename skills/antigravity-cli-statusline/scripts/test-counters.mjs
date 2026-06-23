import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmdirSync, renameSync, utimesSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { spawn } from 'child_process';

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const BLUE = "\x1b[38;2;87;202;255m";
const GREEN = "\x1b[38;2;92;219;109m";
const YELLOW = "\x1b[38;2;255;212;39m";
const RED = "\x1b[38;2;255;125;175m";

function getColorByCount(n) {
  if (n === 0) return BLUE;
  if (n <= 2) return GREEN;
  if (n <= 4) return YELLOW;
  return RED;
}

function escapeRegex(string) {
  return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

// 輔助函數：遞迴刪除目錄
function rmDirRecursive(dirPath) {
  if (existsSync(dirPath)) {
    const files = readdirSync(dirPath);
    for (const file of files) {
      const curPath = join(dirPath, file);
      if (statSync(curPath).isDirectory()) {
        rmDirRecursive(curPath);
      } else {
        unlinkSync(curPath);
      }
    }
    rmdirSync(dirPath);
  }
}

// 輔助函數：執行 statusline-quota.mjs
function runStatusline(stdinData) {
  return new Promise((resolve) => {
    const child = spawn('node', ['skills/antigravity-cli-statusline/scripts/statusline-quota.mjs'], {
      env: { ...process.env, DISABLE_QUOTA_HOOK: undefined },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    child.stdin.write(JSON.stringify(stdinData));
    child.stdin.end();
  });
}

async function main() {
  console.log("=== 開始測試狀態列計數器雙軌與防禦性更新機制 ===");

  // 1. 備份原有環境
  const homedir = os.homedir();
  const geminiTmpDir = join(homedir, '.gemini', 'tmp');
  if (!existsSync(geminiTmpDir)) {
    mkdirSync(geminiTmpDir, { recursive: true });
  }

  // 備份 statusline_counters.json
  const cachePath = join(geminiTmpDir, 'statusline_counters.json');
  let originalCache = null;
  if (existsSync(cachePath)) {
    originalCache = readFileSync(cachePath, 'utf8');
  }

  // 備份 pending_input_count
  const pendingInputPath = join(geminiTmpDir, 'pending_input_count');
  let originalPendingInput = null;
  if (existsSync(pendingInputPath)) {
    originalPendingInput = readFileSync(pendingInputPath, 'utf8');
  }

  // 備份 background-processes 目錄
  const bgTasksDir = join(geminiTmpDir, 'background-processes');
  const bgTasksBakDir = join(geminiTmpDir, 'background-processes.bak_test');
  if (existsSync(bgTasksDir)) {
    if (existsSync(bgTasksBakDir)) {
      rmDirRecursive(bgTasksBakDir);
    }
    renameSync(bgTasksDir, bgTasksBakDir);
  }

  // 備份專案 .gemini/settings.json
  const projSettingsDir = join(process.cwd(), '.gemini');
  if (!existsSync(projSettingsDir)) {
    mkdirSync(projSettingsDir, { recursive: true });
  }
  const projSettingsPath = join(projSettingsDir, 'settings.json');
  let originalSettings = null;
  if (existsSync(projSettingsPath)) {
    originalSettings = readFileSync(projSettingsPath, 'utf8');
  }

  // 建立臨時的 settings.json
  const tempSettings = {
    ui: {
      language: "zh-tw",
      footer: {
        items: ["pending-input", "background-tasks", "subagents", "artifacts"]
      }
    }
  };
  writeFileSync(projSettingsPath, JSON.stringify(tempSettings), { encoding: 'utf8' });

  let subActive1 = null;
  let subActive2 = null;
  let subInactive = null;
  let brainDir = null;

  let testsPassed = true;

  try {
    // ----------------------------------------------------
    // 測試 Case 0: Meta 優先軌道 (包含拼寫相容與 safeGetCount)
    // ----------------------------------------------------
    console.log("\n[測試 0] 驗證 Meta 優先軌道 (包含相容屬性名稱與型態)...");
    
    // 寫入快取 99 作為干擾，如果 Meta 優先，輸出必須是 Meta 的值而非 99
    const mockCache干扰 = {
      pending_input_count: 99,
      background_tasks_count: 99,
      subagents_count: 99,
      artifacts_count: 99
    };
    writeFileSync(cachePath, JSON.stringify(mockCache干扰), { encoding: 'utf8' });

    // 模擬 meta，使用非標準屬性名稱以測試 fallback
    const meta0 = {
      conversation_id: "test-meta-priority-id",
      terminal_width: 120,
      project: {
        path: process.cwd()
      },
      // 使用相容屬性與不同型態 (數字/陣列)
      pending_input: "11", // 字串型態
      background_jobs: 12, // 數字型態
      active_subagents: ["agent1", "agent2", "agent3", "agent4", "agent5", "agent6", "agent7", "agent8", "agent9", "agent10", "agent11", "agent12", "agent13"], // 陣列型態 (長度 13)
      artifacts_count: 14 // 數字型態
    };

    const res0 = await runStatusline(meta0);
    if (res0.code !== 0) {
      console.error(`執行失敗，離開碼: ${res0.code}, stderr: ${res0.stderr}`);
      testsPassed = false;
    } else {
      console.log(`狀態列輸出: ${res0.stdout.trim()}`);
      
      const regexPending = new RegExp("輸入佇列.*?" + escapeRegex(RED) + escapeRegex(BOLD) + "11" + escapeRegex(RESET));
      const regexBg = new RegExp("背景任務.*?" + escapeRegex(RED) + escapeRegex(BOLD) + "12" + escapeRegex(RESET));
      const regexSub = new RegExp("子代理.*?" + escapeRegex(RED) + escapeRegex(BOLD) + "13" + escapeRegex(RESET));
      const regexArt = new RegExp("累計產出.*?" + escapeRegex(BOLD) + "14" + escapeRegex(RESET));

      const p1 = regexPending.test(res0.stdout);
      const p2 = regexBg.test(res0.stdout);
      const p3 = regexSub.test(res0.stdout);
      const p4 = regexArt.test(res0.stdout);

      if (p1 && p2 && p3 && p4) {
        console.log("✅ 測試 0 通過！Meta 優先級與防禦性擷取完全正確。");
      } else {
        console.error("❌ 測試 0 失敗！Meta 優先或屬性相容無效。");
        console.error(`- 輸入佇列 (11, 紅色): ${p1 ? 'OK' : 'FAIL'}`);
        console.error(`- 背景任務 (12, 紅色): ${p2 ? 'OK' : 'FAIL'}`);
        console.error(`- 子代理 (13, 紅色): ${p3 ? 'OK' : 'FAIL'}`);
        console.error(`- 累計產出 (14, BOLD): ${p4 ? 'OK' : 'FAIL'}`);
        testsPassed = false;
      }
    }

    // ----------------------------------------------------
    // 測試 Case 1: 快取優先軌道 (Meta 為 0 或 undefined)
    // ----------------------------------------------------
    console.log("\n[測試 1] 驗證快取優先軌道 (當 Meta 無資料時)...");
    
    const mockCache = {
      pending_input_count: 2,
      background_tasks_count: 3,
      subagents_count: 4,
      artifacts_count: 5
    };
    writeFileSync(cachePath, JSON.stringify(mockCache), { encoding: 'utf8' });

    const meta1 = {
      conversation_id: "test-cache-priority-id",
      terminal_width: 120,
      project: {
        path: process.cwd()
      }
      // 不提供計數器屬性，或提供 0/null
    };

    const res1 = await runStatusline(meta1);
    if (res1.code !== 0) {
      console.error(`執行失敗，離開碼: ${res1.code}, stderr: ${res1.stderr}`);
      testsPassed = false;
    } else {
      console.log(`狀態列輸出: ${res1.stdout.trim()}`);
      
      // 驗證 2 (GREEN), 3 (YELLOW), 4 (YELLOW), 5 (BOLD)
      const regexPending = new RegExp("輸入佇列.*?" + escapeRegex(GREEN) + escapeRegex(BOLD) + "2" + escapeRegex(RESET));
      const regexBg = new RegExp("背景任務.*?" + escapeRegex(YELLOW) + escapeRegex(BOLD) + "3" + escapeRegex(RESET));
      const regexSub = new RegExp("子代理.*?" + escapeRegex(YELLOW) + escapeRegex(BOLD) + "4" + escapeRegex(RESET));
      const regexArt = new RegExp("累計產出.*?" + escapeRegex(BOLD) + "5" + escapeRegex(RESET));

      const p1 = regexPending.test(res1.stdout);
      const p2 = regexBg.test(res1.stdout);
      const p3 = regexSub.test(res1.stdout);
      const p4 = regexArt.test(res1.stdout);

      if (p1 && p2 && p3 && p4) {
        console.log("✅ 測試 1 通過！快取數據及配色完全正確。");
      } else {
        console.error("❌ 測試 1 失敗！輸出未匹配預期配色或數值。");
        console.error(`- 輸入佇列 (2, 綠色): ${p1 ? 'OK' : 'FAIL'}`);
        console.error(`- 背景任務 (3, 黃色): ${p2 ? 'OK' : 'FAIL'}`);
        console.error(`- 子代理 (4, 黃色): ${p3 ? 'OK' : 'FAIL'}`);
        console.error(`- 累計產出 (5, BOLD): ${p4 ? 'OK' : 'FAIL'}`);
        testsPassed = false;
      }
    }

    // ----------------------------------------------------
    // 測試 Case 2: 檔案系統退讓軌道 (Meta 與快取皆為 0 或 undefined)
    // ----------------------------------------------------
    console.log("\n[測試 2] 驗證檔案系統退讓軌道...");

    // 寫入空快取以觸發退讓
    writeFileSync(cachePath, JSON.stringify({}), { encoding: 'utf8' });

    // 2.1 pending-input 退讓: 寫入 pending_input_count 檔案
    writeFileSync(pendingInputPath, "8", { encoding: 'utf8' });

    // 2.2 background-tasks 退讓: 建立 background-processes 目錄及 6 個臨時檔案
    mkdirSync(bgTasksDir, { recursive: true });
    for (let i = 1; i <= 6; i++) {
      writeFileSync(join(bgTasksDir, `task_${i}.json`), `{"id": ${i}}`, { encoding: 'utf8' });
    }

    // 2.3 subagents 退讓:
    // 計算原有活躍子代理數
    const agentsDir = join(process.cwd(), '.agents');
    let baseCount = 0;
    if (existsSync(agentsDir)) {
      const dirs = readdirSync(agentsDir);
      const now = Date.now();
      for (const d of dirs) {
        if (d.startsWith('.')) continue;
        const dPath = join(agentsDir, d);
        try {
          const statD = statSync(dPath);
          if (statD.isDirectory()) {
            const progressPath = join(dPath, 'progress.md');
            if (existsSync(progressPath)) {
              const statP = statSync(progressPath);
              if (now - statP.mtimeMs <= 300000) {
                baseCount++;
              }
            }
          }
        } catch (e) {}
      }
    }
    console.log(`原本存在的活躍子代理數 (baseCount): ${baseCount}`);

    // 建立 2 個活躍與 1 個不活躍子代理
    subActive1 = join(agentsDir, 'test_sub_active_1');
    subActive2 = join(agentsDir, 'test_sub_active_2');
    subInactive = join(agentsDir, 'test_sub_inactive');

    mkdirSync(subActive1, { recursive: true });
    mkdirSync(subActive2, { recursive: true });
    mkdirSync(subInactive, { recursive: true });

    writeFileSync(join(subActive1, 'progress.md'), 'heartbeat', { encoding: 'utf8' });
    writeFileSync(join(subActive2, 'progress.md'), 'heartbeat', { encoding: 'utf8' });
    writeFileSync(join(subInactive, 'progress.md'), 'heartbeat', { encoding: 'utf8' });

    // 設定修改時間
    const nowSecs = Date.now() / 1000;
    const oldSecs = (Date.now() - 600 * 1000) / 1000; // 10 分鐘前

    utimesSync(join(subActive1, 'progress.md'), nowSecs, nowSecs);
    utimesSync(join(subActive2, 'progress.md'), nowSecs, nowSecs);
    utimesSync(join(subInactive, 'progress.md'), oldSecs, oldSecs);

    const expectedSubagents = baseCount + 2;
    const subagentsColor = getColorByCount(expectedSubagents);

    // 2.4 artifacts 退讓:
    const testConvId = "test_conv_9999";
    brainDir = join(homedir, '.gemini', 'antigravity-cli', 'brain', testConvId);
    if (existsSync(brainDir)) {
      rmDirRecursive(brainDir);
    }
    mkdirSync(brainDir, { recursive: true });
    for (let i = 1; i <= 7; i++) {
      writeFileSync(join(brainDir, `artifact_${i}.metadata.json`), `{}`, { encoding: 'utf8' });
    }

    // 執行
    const meta2 = {
      conversation_id: testConvId,
      terminal_width: 120,
      project: {
        path: process.cwd()
      }
    };

    const res2 = await runStatusline(meta2);

    if (res2.code !== 0) {
      console.error(`執行失敗，離開碼: ${res2.code}, stderr: ${res2.stderr}`);
      testsPassed = false;
    } else {
      console.log(`狀態列輸出: ${res2.stdout.trim()}`);
      
      // 驗證 8 (RED), 6 (RED), expectedSubagents (subagentsColor), 7 (BOLD)
      const regexPending = new RegExp("輸入佇列.*?" + escapeRegex(RED) + escapeRegex(BOLD) + "8" + escapeRegex(RESET));
      const regexBg = new RegExp("背景任務.*?" + escapeRegex(RED) + escapeRegex(BOLD) + "6" + escapeRegex(RESET));
      const regexSub = new RegExp("子代理.*?" + escapeRegex(subagentsColor) + escapeRegex(BOLD) + expectedSubagents + escapeRegex(RESET));
      const regexArt = new RegExp("累計產出.*?" + escapeRegex(BOLD) + "7" + escapeRegex(RESET));

      const p1 = regexPending.test(res2.stdout);
      const p2 = regexBg.test(res2.stdout);
      const p3 = regexSub.test(res2.stdout);
      const p4 = regexArt.test(res2.stdout);

      if (p1 && p2 && p3 && p4) {
        console.log("✅ 測試 2 通過！退讓數據及配色完全正確。");
      } else {
        console.error("❌ 測試 2 失敗！輸出未匹配預期配色或數值。");
        console.error(`- 輸入佇列 (8, 紅色): ${p1 ? 'OK' : 'FAIL'}`);
        console.error(`- 背景任務 (6, 紅色): ${p2 ? 'OK' : 'FAIL'}`);
        console.error(`- 子代理 (${expectedSubagents}, 配色): ${p3 ? 'OK' : 'FAIL'}`);
        console.error(`- 累計產出 (7, BOLD): ${p4 ? 'OK' : 'FAIL'}`);
        testsPassed = false;
      }
    }

    // ----------------------------------------------------
    // 測試 Case 3: 0值優先驗證 (Meta 明確為 0，快取為非 0)
    // ----------------------------------------------------
    console.log("\n[測試 3] 驗證 0 值優先於快取 (當 Meta 明確傳入 0，但快取有舊非零值時)...");

    // 寫入快取非零值
    const mockCache3 = {
      pending_input_count: 3,
      background_tasks_count: 4,
      subagents_count: 5,
      artifacts_count: 6
    };
    writeFileSync(cachePath, JSON.stringify(mockCache3), { encoding: 'utf8' });

    // Meta 明確傳入 0
    const meta3 = {
      conversation_id: "test-zero-priority-id",
      terminal_width: 120,
      project: {
        path: process.cwd()
      },
      pending_input_count: 0,
      background_tasks_count: 0,
      subagents_count: 0,
      artifacts_count: 0
    };

    const res3 = await runStatusline(meta3);
    if (res3.code !== 0) {
      console.error(`執行失敗，離開碼: ${res3.code}, stderr: ${res3.stderr}`);
      testsPassed = false;
    } else {
      console.log(`狀態列輸出: ${res3.stdout.trim()}`);

      // 驗證輸出是否為著色的 0 (0 值對應配色為 BLUE)
      const regexPending3 = new RegExp("輸入佇列.*?" + escapeRegex(BLUE) + escapeRegex(BOLD) + "0" + escapeRegex(RESET));
      const regexBg3 = new RegExp("背景任務.*?" + escapeRegex(BLUE) + escapeRegex(BOLD) + "0" + escapeRegex(RESET));
      const regexSub3 = new RegExp("子代理.*?" + escapeRegex(BLUE) + escapeRegex(BOLD) + "0" + escapeRegex(RESET));
      const regexArt3 = new RegExp("累計產出.*?" + escapeRegex(BOLD) + "0" + escapeRegex(RESET));

      const p1_3 = regexPending3.test(res3.stdout);
      const p2_3 = regexBg3.test(res3.stdout);
      const p3_3 = regexSub3.test(res3.stdout);
      const p4_3 = regexArt3.test(res3.stdout);

      if (p1_3 && p2_3 && p3_3 && p4_3) {
        console.log("✅ 測試 3 通過！0 值成功優先於非零快取，未發生錯誤退讓。");
      } else {
        console.error("❌ 測試 3 失敗！0 值退讓至快取或檔案系統。");
        console.error(`- 輸入佇列 (0, 藍色): ${p1_3 ? 'OK' : 'FAIL'}`);
        console.error(`- 背景任務 (0, 藍色): ${p2_3 ? 'OK' : 'FAIL'}`);
        console.error(`- 子代理 (0, 藍色): ${p3_3 ? 'OK' : 'FAIL'}`);
        console.error(`- 累計產出 (0, BOLD): ${p4_3 ? 'OK' : 'FAIL'}`);
        testsPassed = false;
      }
    }

    // ----------------------------------------------------
    // 測試 Case 4: 子代理狀態物件過濾驗證 (含有不同狀態物件的 subagents 陣列)
    // ----------------------------------------------------
    console.log("\n[測試 4] 驗證子代理狀態物件過濾邏輯...");

    // 寫入快取干擾，確認使用 Meta 的值
    const mockCache4 = {
      pending_input_count: 99,
      background_tasks_count: 99,
      subagents_count: 99,
      artifacts_count: 99
    };
    writeFileSync(cachePath, JSON.stringify(mockCache4), { encoding: 'utf8' });

    // 模擬 meta，包含不同狀態的子代理物件
    const meta4 = {
      conversation_id: "test-subagent-filtering-id",
      terminal_width: 120,
      project: {
        path: process.cwd()
      },
      subagents: [
        { id: "sub1", status: "running" },      // 保留
        { id: "sub2", status: "completed" },    // 過濾
        { id: "sub3", status: "stopped" },      // 過濾
        { id: "sub4", status: "error" },        // 過濾
        { id: "sub5", status: "thinking" },     // 保留
        "legacy-string-format",                 // 保留
        { id: "sub6" }                          // 保留
      ]
    };

    const res4 = await runStatusline(meta4);
    if (res4.code !== 0) {
      console.error(`執行失敗，離開碼: ${res4.code}, stderr: ${res4.stderr}`);
      testsPassed = false;
    } else {
      console.log(`狀態列輸出: ${res4.stdout.trim()}`);

      // 驗證輸出是否為子代理 4 (4 值對應配色為 YELLOW)
      const regexSub4 = new RegExp("子代理.*?" + escapeRegex(YELLOW) + escapeRegex(BOLD) + "4" + escapeRegex(RESET));

      const p3_4 = regexSub4.test(res4.stdout);

      if (p3_4) {
        console.log("✅ 測試 4 通過！子代理狀態物件成功過濾，僅保留活躍項目。");
      } else {
        console.error("❌ 測試 4 失敗！子代理狀態物件過濾無效或計數錯誤。");
        console.error(`- 子代理 (4, 黃色): ${p3_4 ? 'OK' : 'FAIL'}`);
        testsPassed = false;
      }
    }

  } catch (err) {
    console.error("測試執行時發生錯誤:", err);
    testsPassed = false;
  } finally {
    // ----------------------------------------------------
    // 4. 環境還原
    // ----------------------------------------------------
    console.log("\n[清理] 開始還原環境...");

    // 清理子代理與 brain 目錄
    if (subActive1 && existsSync(subActive1)) {
      try { rmDirRecursive(subActive1); } catch (e) {}
    }
    if (subActive2 && existsSync(subActive2)) {
      try { rmDirRecursive(subActive2); } catch (e) {}
    }
    if (subInactive && existsSync(subInactive)) {
      try { rmDirRecursive(subInactive); } catch (e) {}
    }
    if (brainDir && existsSync(brainDir)) {
      try { rmDirRecursive(brainDir); } catch (e) {}
    }

    // 還原 statusline_counters.json
    if (originalCache !== null) {
      writeFileSync(cachePath, originalCache, { encoding: 'utf8' });
    } else if (existsSync(cachePath)) {
      unlinkSync(cachePath);
    }

    // 還原 pending_input_count
    if (originalPendingInput !== null) {
      writeFileSync(pendingInputPath, originalPendingInput, { encoding: 'utf8' });
    } else if (existsSync(pendingInputPath)) {
      unlinkSync(pendingInputPath);
    }

    // 還原 background-processes
    if (existsSync(bgTasksDir)) {
      rmDirRecursive(bgTasksDir);
    }
    if (existsSync(bgTasksBakDir)) {
      renameSync(bgTasksBakDir, bgTasksDir);
    }

    // 還原專案 settings.json
    if (originalSettings !== null) {
      writeFileSync(projSettingsPath, originalSettings, { encoding: 'utf8' });
    } else if (existsSync(projSettingsPath)) {
      unlinkSync(projSettingsPath);
    }

    console.log("=== 環境清理完成 ===");
  }

  if (testsPassed) {
    console.log("\n🎉 所有狀態列計數器測試均成功通過！");
    process.exit(0);
  } else {
    console.error("\n❌ 有部分測試未通過，請檢查邏輯。");
    process.exit(1);
  }
}

main();
