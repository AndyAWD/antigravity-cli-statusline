import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { spawn } from 'child_process';
import assert from 'assert';

const BLUE_BOLD = "\x1b[38;2;87;202;255m\x1b[1m";
const GREEN_BOLD = "\x1b[38;2;92;219;109m\x1b[1m";
const WHITE = "\x1b[38;2;255;255;255m";
const RESET = "\x1b[0m";

function runStatusline(stdinData) {
  return new Promise((resolve) => {
    const child = spawn('node', ['skills/antigravity-cli-statusline/scripts/statusline-quota.mjs'], {
      env: { ...process.env, DISABLE_QUOTA_HOOK: undefined },
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

async function main() {
  console.log("=== Running statusline-quota.test.mjs (R1-R4) ===");

  const homedir = os.homedir();
  const geminiTmpDir = join(homedir, '.gemini', 'tmp');
  if (!existsSync(geminiTmpDir)) {
    mkdirSync(geminiTmpDir, { recursive: true });
  }

  // Backup existing settings and cache
  const cachePath = join(geminiTmpDir, 'real_quota_cache.json');
  let originalCache = null;
  if (existsSync(cachePath)) {
    originalCache = readFileSync(cachePath, 'utf8');
  }

  const projSettingsDir = join(process.cwd(), '.gemini');
  if (!existsSync(projSettingsDir)) {
    mkdirSync(projSettingsDir, { recursive: true });
  }
  const projSettingsPath = join(projSettingsDir, 'settings.json');
  let originalSettings = null;
  if (existsSync(projSettingsPath)) {
    originalSettings = readFileSync(projSettingsPath, 'utf8');
  }

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
    writeFileSync(cachePath, JSON.stringify(mockCacheR1), { encoding: 'utf8' });

    const settingsR1 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly-countdown"]
        }
      }
    };
    writeFileSync(projSettingsPath, JSON.stringify(settingsR1), { encoding: 'utf8' });

    const metaR1 = {
      model: { display_name: "Gemini 1.5 Pro" },
      terminal_width: 120
    };

    const resR1 = await runStatusline(metaR1);
    console.log("R1 Output:", JSON.stringify(resR1.stdout));
    
    const expectedR1 = `${WHITE}Weekly API Reset in:${RESET} ${BLUE_BOLD}4d 11h${RESET}`;
    if (resR1.code === 0 && resR1.stdout.includes(expectedR1)) {
      console.log("✅ R1 passed!");
    } else {
      console.error(`❌ R1 failed! Expected output to contain: ${JSON.stringify(expectedR1)}`);
      testsPassed = false;
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
    writeFileSync(cachePath, JSON.stringify(mockCacheR2), { encoding: 'utf8' });

    const settingsR2 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly"]
        }
      }
    };
    writeFileSync(projSettingsPath, JSON.stringify(settingsR2), { encoding: 'utf8' });

    const metaR2 = {
      model: { display_name: "Gemini 1.5 Pro" },
      terminal_width: 120
    };

    const resR2 = await runStatusline(metaR2);
    console.log("R2 Output:", JSON.stringify(resR2.stdout));

    const expectedR2 = `${WHITE}Weekly API Available:${RESET} ${BLUE_BOLD}90%${RESET}`;
    if (resR2.code === 0 && resR2.stdout.includes(expectedR2)) {
      console.log("✅ R2 passed!");
    } else {
      console.error(`❌ R2 failed! Expected output to contain: ${JSON.stringify(expectedR2)}`);
      testsPassed = false;
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
    writeFileSync(cachePath, JSON.stringify(mockCacheR3), { encoding: 'utf8' });

    const settingsR3 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly"]
        }
      }
    };
    writeFileSync(projSettingsPath, JSON.stringify(settingsR3), { encoding: 'utf8' });

    const metaR3 = {
      model: { display_name: "Claude 3.5 Sonnet" },
      terminal_width: 120
    };

    const resR3 = await runStatusline(metaR3);
    console.log("R3 Output:", JSON.stringify(resR3.stdout));

    const expectedR3 = `${WHITE}Weekly API Available:${RESET} ${GREEN_BOLD}61%${RESET}`;
    if (resR3.code === 0 && resR3.stdout.includes(expectedR3)) {
      console.log("✅ R3 passed!");
    } else {
      console.error(`❌ R3 failed! Expected output to contain: ${JSON.stringify(expectedR3)}`);
      testsPassed = false;
    }

    // ----------------------------------------------------
    // Test Case R4: Graceful fallback
    // Justification: Verifies missing-data degradation (no weekly key returns N/A without crash).
    // ----------------------------------------------------
    console.log("\n[Test R4] Verifying graceful fallback...");
    const mockCacheR4 = {
      updatedAt: Date.now()
    };
    writeFileSync(cachePath, JSON.stringify(mockCacheR4), { encoding: 'utf8' });

    const settingsR4 = {
      ui: {
        language: "us",
        footer: {
          items: ["quota-weekly-countdown"]
        }
      }
    };
    writeFileSync(projSettingsPath, JSON.stringify(settingsR4), { encoding: 'utf8' });

    const metaR4 = {
      model: { display_name: "Gemini 1.5 Pro" },
      terminal_width: 120
    };

    const resR4 = await runStatusline(metaR4);
    console.log("R4 Output:", JSON.stringify(resR4.stdout));

    const expectedR4 = `${WHITE}Weekly API Reset in:${RESET} ${BLUE_BOLD}N/A${RESET}`;
    if (resR4.code === 0 && resR4.stdout.includes(expectedR4)) {
      console.log("✅ R4 passed!");
    } else {
      console.error(`❌ R4 failed! Expected output to contain: ${JSON.stringify(expectedR4)}`);
      testsPassed = false;
    }

  } catch (err) {
    console.error("Test execution failed:", err);
    testsPassed = false;
  } finally {
    // Restore original files
    console.log("\n[Cleanup] Restoring original environment...");
    if (originalCache !== null) {
      writeFileSync(cachePath, originalCache, { encoding: 'utf8' });
    } else if (existsSync(cachePath)) {
      unlinkSync(cachePath);
    }

    if (originalSettings !== null) {
      writeFileSync(projSettingsPath, originalSettings, { encoding: 'utf8' });
    } else if (existsSync(projSettingsPath)) {
      unlinkSync(projSettingsPath);
    }
    console.log("=== Cleanup finished ===");
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
