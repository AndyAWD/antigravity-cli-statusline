import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { spawn } from 'child_process';
import assert from 'assert';
import { fileURLToPath } from 'url';

const SCRIPT_PATH = fileURLToPath(new URL('./statusline-quota.mjs', import.meta.url));

const BLUE_BOLD = "\x1b[38;2;87;202;255m\x1b[1m";
const GREEN_BOLD = "\x1b[38;2;92;219;109m\x1b[1m";
const WHITE = "\x1b[38;2;255;255;255m";
const RESET = "\x1b[0m";

/**
 * Spawns the statusline script with redirected HOME and project directory.
 * @param {object} stdinData - Meta payload piped to stdin
 * @param {string} homeDir - Isolated temporary directory path
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runStatusline(stdinData, homeDir) {
  return new Promise((resolve) => {
    const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
    delete env.DISABLE_QUOTA_HOOK;            // explicit unset — Finding #1
    const child = spawn('node', [SCRIPT_PATH], {
      env,
      cwd: homeDir,                            // project settings resolve under temp home — Finding #2
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
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

/**
 * Creates a hermetic sandbox home directory containing mock cache and settings.
 * @param {object} cache - Mock quota cache content
 * @param {object} settings - Mock settings content
 * @returns {string} Path to the created temp home directory
 */
function makeTempHome(cache, settings) {
  const home = mkdtempSync(join(os.tmpdir(), 'statusline-weekly-'));
  mkdirSync(join(home, '.gemini', 'tmp'), { recursive: true });
  writeFileSync(join(home, '.gemini', 'tmp', 'real_quota_cache.json'), JSON.stringify(cache), 'utf8');
  writeFileSync(join(home, '.gemini', 'settings.json'), JSON.stringify(settings), 'utf8');
  return home;
}

async function main() {
  console.log("=== Running statusline-quota.test.mjs (R1-R4) ===");

  let testsPassed = true;

  try {
    // ----------------------------------------------------
    // Test Case R1: Weekly countdown renders
    // Justification: Verifies that weekly reset countdown displays in BLUE+BOLD for a Gemini model.
    // ----------------------------------------------------
    console.log("\n[Test R1] Verifying weekly countdown rendering...");
    const mockCacheR1 = {
      weekly: {
        gemini: {
          remaining_percentage: 90.07,
          reset_time: '2026-07-05T03:22:46Z',
          refreshes_in: '4d 11h'
        }
      },
      updatedAt: Date.now()
    };
    const settingsR1 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly-countdown"]
        }
      }
    };
    const metaR1 = {
      model: { display_name: "Gemini 1.5 Pro" },
      terminal_width: 120
    };

    const homeR1 = makeTempHome(mockCacheR1, settingsR1);
    try {
      const resR1 = await runStatusline(metaR1, homeR1);
      console.log("R1 Output:", JSON.stringify(resR1.stdout));
      
      const expectedR1 = `${WHITE}Weekly API Reset in:${RESET} ${BLUE_BOLD}4d 11h${RESET}`;
      if (resR1.code === 0 && resR1.stdout.includes(expectedR1)) {
        console.log("✅ R1 passed!");
      } else {
        console.error(`❌ R1 failed! Expected output to contain: ${JSON.stringify(expectedR1)}`);
        testsPassed = false;
      }
    } finally {
      rmSync(homeR1, { recursive: true, force: true });
    }

    // ----------------------------------------------------
    // Test Case R2: Weekly % color tier
    // Justification: Verifies color tier mapping for new weekly quota (90% -> BLUE+BOLD).
    // ----------------------------------------------------
    console.log("\n[Test R2] Verifying weekly quota % color tier...");
    const mockCacheR2 = {
      weekly: {
        gemini: {
          remaining_percentage: 90.07,
          reset_time: '2026-07-05T03:22:46Z',
          refreshes_in: '4d 11h'
        }
      },
      updatedAt: Date.now()
    };
    const settingsR2 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly"]
        }
      }
    };
    const metaR2 = {
      model: { display_name: "Gemini 1.5 Pro" },
      terminal_width: 120
    };

    const homeR2 = makeTempHome(mockCacheR2, settingsR2);
    try {
      const resR2 = await runStatusline(metaR2, homeR2);
      console.log("R2 Output:", JSON.stringify(resR2.stdout));

      const expectedR2 = `${WHITE}Weekly API Available:${RESET} ${BLUE_BOLD}90%${RESET}`;
      if (resR2.code === 0 && resR2.stdout.includes(expectedR2)) {
        console.log("✅ R2 passed!");
      } else {
        console.error(`❌ R2 failed! Expected output to contain: ${JSON.stringify(expectedR2)}`);
        testsPassed = false;
      }
    } finally {
      rmSync(homeR2, { recursive: true, force: true });
    }

    // ----------------------------------------------------
    // Test Case R3: Pool mapping (Claude -> 3p)
    // Justification: Exercises family -> pool resolver (Claude/GPT model maps to '3p' weekly bucket).
    // ----------------------------------------------------
    console.log("\n[Test R3] Verifying pool mapping (Claude -> 3p)...");
    const mockCacheR3 = {
      weekly: {
        '3p': {
          remaining_percentage: 60.5,
          reset_time: '2026-07-07T07:27:15Z',
          refreshes_in: '6d 15h'
        }
      },
      updatedAt: Date.now()
    };
    const settingsR3 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly"]
        }
      }
    };
    const metaR3 = {
      model: { display_name: "Claude 3.5 Sonnet" },
      terminal_width: 120
    };

    const homeR3 = makeTempHome(mockCacheR3, settingsR3);
    try {
      const resR3 = await runStatusline(metaR3, homeR3);
      console.log("R3 Output:", JSON.stringify(resR3.stdout));

      const expectedR3 = `${WHITE}Weekly API Available:${RESET} ${GREEN_BOLD}61%${RESET}`;
      if (resR3.code === 0 && resR3.stdout.includes(expectedR3)) {
        console.log("✅ R3 passed!");
      } else {
        console.error(`❌ R3 failed! Expected output to contain: ${JSON.stringify(expectedR3)}`);
        testsPassed = false;
      }
    } finally {
      rmSync(homeR3, { recursive: true, force: true });
    }

    // ----------------------------------------------------
    // Test Case R4: Graceful fallback
    // Justification: Verifies missing-data degradation (no weekly key returns N/A without crash).
    // ----------------------------------------------------
    console.log("\n[Test R4] Verifying graceful fallback...");
    const mockCacheR4 = {
      updatedAt: Date.now()
    };
    const settingsR4 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly-countdown"]
        }
      }
    };
    const metaR4 = {
      model: { display_name: "Gemini 1.5 Pro" },
      terminal_width: 120
    };

    const homeR4 = makeTempHome(mockCacheR4, settingsR4);
    try {
      const resR4 = await runStatusline(metaR4, homeR4);
      console.log("R4 Output:", JSON.stringify(resR4.stdout));

      const expectedR4 = `${WHITE}Weekly API Reset in:${RESET} ${BLUE_BOLD}N/A${RESET}`;
      if (resR4.code === 0 && resR4.stdout.includes(expectedR4)) {
        console.log("✅ R4 passed!");
      } else {
        console.error(`❌ R4 failed! Expected output to contain: ${JSON.stringify(expectedR4)}`);
        testsPassed = false;
      }
    } finally {
      rmSync(homeR4, { recursive: true, force: true });
    }

  } catch (err) {
    console.error("Test execution failed:", err);
    testsPassed = false;
  }

  if (testsPassed) {
    console.log("\n🎉 All rendering tests passed successfully!");
    process.exit(0);
  } else {
    console.error("\n❌ Some rendering tests failed.");
    process.exit(1);
  }
}

main();
