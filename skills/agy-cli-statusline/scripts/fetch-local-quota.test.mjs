import { parseWeeklyBuckets, parseShortTermBuckets, mergeQuotaBuckets, formatResetTime } from './fetch-local-quota.mjs';
import assert from 'assert';

console.log("=== Running fetch-local-quota.test.mjs (R0) ===");

// R0: endpoint shape -> cache shape (data-layer, pure)
// Test justification: This test verifies that parseWeeklyBuckets and parseShortTermBuckets properly filter RetrieveUserQuotaSummary response to select 'weekly' and '5h' short-term buckets.
function testParseWeeklyBucketsUnwrapped() {
  console.log("Testing unwrapped mock response format...");
  const mockResponse = {
    groups: [
      {
        buckets: [
          {
            bucketId: 'gemini-weekly',
            window: 'weekly',
            remaining: 0.9007,
            reset: '2026-07-05T03:22:46Z'
          }
        ]
      }
    ]
  };

  const parsed = parseWeeklyBuckets(mockResponse);
  assert.ok(parsed.gemini, "gemini pool should exist");
  assert.strictEqual(parsed.gemini.remaining_percentage, 90.07);
  assert.strictEqual(parsed.gemini.reset_time, '2026-07-05T03:22:46Z');

  const durationRegex = /^(now|\d+m|\d+h( \d+m)?|\d+d( \d+h)?)$/;
  assert.ok(durationRegex.test(parsed.gemini.refreshes_in), `gemini refreshes_in format invalid: ${parsed.gemini.refreshes_in}`);
  console.log("✅ Unwrapped format verification passed.");
}

function testParseWeeklyBucketsWrappedAndCamelCase() {
  console.log("Testing wrapped and camelCase mock response format...");
  const mockResponse = {
    response: {
      groups: [
        {
          buckets: [
            {
              bucketId: 'gemini-weekly',
              window: 'weekly',
              remainingFraction: 0.8790675,
              resetTime: '2026-07-05T03:22:46Z'
            },
            {
              bucketId: 'gemini-5h',
              window: '5h',
              remainingFraction: 0.318,
              resetTime: '2026-07-05T05:00:00Z'
            },
            {
              bucketId: '3p-weekly',
              window: 'weekly',
              remainingFraction: 1.0,
              resetTime: '2026-07-07T08:18:13Z'
            }
          ]
        }
      ]
    }
  };

  const parsedWeekly = parseWeeklyBuckets(mockResponse);
  assert.ok(parsedWeekly.gemini, "gemini pool should exist");
  assert.ok(parsedWeekly['3p'], "3p pool should exist");
  assert.strictEqual(parsedWeekly.gemini.remaining_percentage, 87.90675);
  assert.strictEqual(parsedWeekly.gemini.reset_time, '2026-07-05T03:22:46Z');

  const parsedShortTerm = parseShortTermBuckets(mockResponse);
  assert.ok(parsedShortTerm.gemini, "gemini shortTerm pool should exist");
  assert.strictEqual(parsedShortTerm.gemini.remaining_percentage, 31.8);
  assert.strictEqual(parsedShortTerm.gemini.reset_time, '2026-07-05T05:00:00Z');

  const durationRegex = /^(now|\d+m|\d+h( \d+m)?|\d+d( \d+h)?)$/;
  assert.ok(durationRegex.test(parsedWeekly.gemini.refreshes_in), `gemini refreshes_in format invalid: ${parsedWeekly.gemini.refreshes_in}`);
  assert.ok(durationRegex.test(parsedWeekly['3p'].refreshes_in), `3p refreshes_in format invalid: ${parsedWeekly['3p'].refreshes_in}`);
  console.log("✅ Wrapped + CamelCase format verification passed.");
}

import http from 'http';
import fs from 'fs';
import os from 'os';
import path, { join } from 'path';
import {
  requestUserStatus,
  requestQuotaSummary,
  requestAvailableModels,
  requestTrajectoryGeneratorMetadata,
  parseModelLimits,
  extractRuntimeGeneratorContext,
  persistRuntimeContextToCtxFile,
  fetchLiveQuotaCache
} from './fetch-local-quota.mjs';

async function testHttpEndpointAndEnvDiscovery() {
  console.log("Testing HTTP endpoint and ANTIGRAVITY_LS_ADDRESS discovery...");
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const csrf = req.headers['x-codeium-csrf-token'];
      if (csrf !== 'test-token-123') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'unauthenticated' }));
        return;
      }
      if (req.url === '/exa.language_server_pb.LanguageServerService/GetUserStatus') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          userStatus: {
            email: 'test@example.com',
            userTier: { name: 'Pro' },
            cascadeModelConfigData: {
              clientModelConfigs: [
                {
                  label: 'Gemini 3.5 Flash',
                  quotaInfo: { remainingFraction: 0.85, resetTime: '2026-07-05T03:22:46Z' }
                }
              ]
            }
          }
        }));
      } else if (req.url === '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          groups: [
            {
              buckets: [
                { bucketId: 'gemini-weekly', window: 'weekly', remainingFraction: 0.9, resetTime: '2026-07-05T03:22:46Z' }
              ]
            }
          ]
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const origLs = process.env.ANTIGRAVITY_LS_ADDRESS;
  const origToken = process.env.ANTIGRAVITY_CSRF_TOKEN;

  try {
    // 1. Direct requestUserStatus test over HTTP (with preferHttps=false fast path)
    const statusFast = await requestUserStatus(port, 'test-token-123', '127.0.0.1', false);
    assert.strictEqual(statusFast.userStatus.email, 'test@example.com');

    // 2. Direct requestUserStatus test with preferHttps=true (fallback from HTTPS to HTTP)
    const statusFallback = await requestUserStatus(port, 'test-token-123', '127.0.0.1', true);
    assert.strictEqual(statusFallback.userStatus.email, 'test@example.com');

    // 3. Direct requestQuotaSummary test over HTTP
    const summary = await requestQuotaSummary(port, 'test-token-123', '127.0.0.1', false);
    assert.ok(summary.groups.length > 0);

    // 4. fetchLiveQuotaCache via ANTIGRAVITY_LS_ADDRESS and ANTIGRAVITY_CSRF_TOKEN
    process.env.ANTIGRAVITY_LS_ADDRESS = `127.0.0.1:${port}`;
    process.env.ANTIGRAVITY_CSRF_TOKEN = 'test-token-123';

    const cache = await fetchLiveQuotaCache();
    assert.ok(cache, "Cache should be generated from env LS address");
    assert.strictEqual(cache.email, 'test@example.com');
    assert.strictEqual(cache.planTier, 'Pro');
    assert.ok(cache.weekly.gemini);
    assert.strictEqual(cache.weekly.gemini.remaining_percentage, 90);

    // 5. fetchLiveQuotaCache recovery when env vars are absent (via ENV_CACHE_FILE)
    delete process.env.ANTIGRAVITY_LS_ADDRESS;
    delete process.env.ANTIGRAVITY_CSRF_TOKEN;
    const cacheRecovered = await fetchLiveQuotaCache();
    assert.ok(cacheRecovered, "Cache should be generated from persisted env file");
    assert.strictEqual(cacheRecovered.email, 'test@example.com');

    // 6. Invalidation of dead session ENV_CACHE_FILE
    const envCachePath = join(os.homedir(), '.gemini', 'tmp', 'antigravity_ls_env.json');
    fs.writeFileSync(envCachePath, JSON.stringify({
      ls_address: '127.0.0.1:1', // deliberately dead port
      csrf_token: 'dead-token-123'
    }), 'utf8');

    await fetchLiveQuotaCache();
    assert.strictEqual(fs.existsSync(envCachePath), false, "Dead ENV_CACHE_FILE should be unlinked on connection failure");
  } catch (err) {
    if (err.code === 'EPERM' || err.message?.includes('EPERM')) {
      console.log("⚠️ Sandbox network restriction detected (EPERM). Local loopback test skipped in sandbox.");
      return;
    }
    throw err;
  } finally {
    if (origLs !== undefined) process.env.ANTIGRAVITY_LS_ADDRESS = origLs;
    else delete process.env.ANTIGRAVITY_LS_ADDRESS;

    if (origToken !== undefined) process.env.ANTIGRAVITY_CSRF_TOKEN = origToken;
    else delete process.env.ANTIGRAVITY_CSRF_TOKEN;

    await new Promise(resolve => server.close(resolve));
  }
}

function testMergeQuotaBuckets() {
  console.log("Testing mergeQuotaBuckets preservation and anti-jitter...");
  const now = Date.now();

  // 1. Missing incoming pools (e.g. summaryResponse failed or omitted Argon) must keep base pools
  const prevWeekly = {
    gemini: { remaining_percentage: 92, reset_time: new Date(now + 400000000).toISOString() },
    'gemini-argon-wtu': { remaining_percentage: 8.9, reset_time: new Date(now + 400000000).toISOString() }
  };
  const emptyIncoming = {};
  const preserved = mergeQuotaBuckets(prevWeekly, emptyIncoming);
  assert.strictEqual(preserved.gemini.remaining_percentage, 92);
  assert.strictEqual(preserved['gemini-argon-wtu'].remaining_percentage, 8.9, "gemini-argon-wtu must be preserved when incoming is empty");

  // 2. Same window with 6-minute dialogue drift: lower percentage must win (NOT jump to 100%)
  const baseShort = {
    gemini: { remaining_percentage: 99, reset_time: new Date(now + 17100 * 1000).toISOString() }
  };
  const staleIncoming6MinDrift = {
    gemini: { remaining_percentage: 100, reset_time: new Date(now + (17100 + 360) * 1000).toISOString() }
  };
  const lowerWon = mergeQuotaBuckets(baseShort, staleIncoming6MinDrift);
  assert.strictEqual(lowerWon.gemini.remaining_percentage, 99, "Lower percentage must win across 6-min dialogue drift in 5h window");

  // 3. Weekly quota with 10-minute drift: must stay at 93%, NOT jump to 100%
  const baseWeekly = {
    gemini: { remaining_percentage: 93, reset_time: new Date(now + 500000 * 1000).toISOString() },
    'gemini-argon-wtu': { remaining_percentage: 8.9, reset_time: new Date(now + 400000 * 1000).toISOString() }
  };
  const staleIncomingWeeklyDrift = {
    gemini: { remaining_percentage: 100, reset_time: new Date(now + (500000 + 600) * 1000).toISOString() },
    'gemini-argon-wtu': { remaining_percentage: 100, reset_time: new Date(now + (400000 + 600) * 1000).toISOString() }
  };
  const weeklyWon = mergeQuotaBuckets(baseWeekly, staleIncomingWeeklyDrift);
  assert.strictEqual(weeklyWon.gemini.remaining_percentage, 93, "Weekly quota must remain 93% despite 10m drift");
  assert.strictEqual(weeklyWon['gemini-argon-wtu'].remaining_percentage, 8.9, "Argon quota must remain 8.9% despite 10m drift");

  // 4. Expired existing window: incoming 100% must win immediately (NOT stuck at lower percentage)
  const expiredShort = {
    gemini: { remaining_percentage: 12, reset_time: new Date(now - 60000).toISOString() }
  };
  const freshResetIncoming = {
    gemini: { remaining_percentage: 100, reset_time: new Date(now + 18000 * 1000).toISOString() }
  };
  const resetWon = mergeQuotaBuckets(expiredShort, freshResetIncoming);
  assert.strictEqual(resetWon.gemini.remaining_percentage, 100, "Fresh quota must supersede expired existing quota window");

  // 5. Expired existing window with missing reset_time on incoming: 100% must still win
  const freshResetNoTimestamp = {
    gemini: { remaining_percentage: 100 }
  };
  const resetNoTsWon = mergeQuotaBuckets(expiredShort, freshResetNoTimestamp);
  assert.strictEqual(resetNoTsWon.gemini.remaining_percentage, 100, "Fresh quota without timestamp must supersede expired existing quota");

  // 6. Genuinely new reset window in the future (>30m advance): incoming 100% wins
  const previousWindow = {
    gemini: { remaining_percentage: 45, reset_time: new Date(now + 3600 * 1000).toISOString() }
  };
  const newFutureWindow = {
    gemini: { remaining_percentage: 100, reset_time: new Date(now + (3600 + 18000) * 1000).toISOString() }
  };
  const newWindowWon = mergeQuotaBuckets(previousWindow, newFutureWindow);
  assert.strictEqual(newWindowWon.gemini.remaining_percentage, 100, "New future window must supersede previous window");

  // 7. 40-minute ultra-long dialogue drift (2400 seconds) in 5h quota: must stay at 99%, NOT jump back to 100%
  const baseShort40Min = {
    gemini: { remaining_percentage: 99, reset_time: new Date(now + 17100 * 1000).toISOString(), refreshes_in: "4h 45m" }
  };
  const incomingDrifted40Min = {
    gemini: { remaining_percentage: 100, reset_time: new Date(now + (17100 + 2400) * 1000).toISOString(), refreshes_in: "5h 25m" }
  };
  const drift40MinWon = mergeQuotaBuckets(baseShort40Min, incomingDrifted40Min, true);
  assert.strictEqual(drift40MinWon.gemini.remaining_percentage, 99, "Lower percentage must win across 40-minute dialogue drift in 5h window (threshold=2h)");

  // 8. Genuinely new window (>2 hours advance, e.g. 2.5 hours): incoming 100% wins
  const incomingNewWindow2h5 = {
    gemini: { remaining_percentage: 100, reset_time: new Date(now + (17100 + 9000) * 1000).toISOString() }
  };
  const newWindow2h5Won = mergeQuotaBuckets(baseShort40Min, incomingNewWindow2h5, true);
  assert.strictEqual(newWindow2h5Won.gemini.remaining_percentage, 100, "Genuine new cycle (>2h advance) must supersede previous window");

  // 9. Dynamic countdown recalculation: refreshes_in dynamically recalculated from reset_time
  const targetResetTime1h = new Date(now + 3600 * 1000).toISOString();
  const staleCountdownEntry = {
    gemini: { remaining_percentage: 97, reset_time: targetResetTime1h, refreshes_in: "4h 59m" }
  };
  const dynamicCountdownMerged = mergeQuotaBuckets(staleCountdownEntry, { gemini: { remaining_percentage: 100, reset_time: targetResetTime1h } }, true);
  assert.strictEqual(dynamicCountdownMerged.gemini.remaining_percentage, 97);
  assert.strictEqual(dynamicCountdownMerged.gemini.refreshes_in, "1h", "refreshes_in must be dynamically recalculated to '1h'");

  // 10. formatResetTime defensive checks for empty / null / boolean / array / invalid strings
  assert.strictEqual(formatResetTime(''), '');
  assert.strictEqual(formatResetTime(null), '');
  assert.strictEqual(formatResetTime(undefined), '');
  assert.strictEqual(formatResetTime(true), '');
  assert.strictEqual(formatResetTime(false), '');
  assert.strictEqual(formatResetTime([]), '');
  assert.strictEqual(formatResetTime('invalid-date-string'), '');

  // 11. Gemini weekly quota with pool name 'gemini' (suffix -weekly stripped): 3-hour drift must NOT jump to 100%
  const baseGeminiWeekly = {
    gemini: { remaining_percentage: 93, reset_time: new Date(now + 500000 * 1000).toISOString(), window: 'weekly' }
  };
  const driftedGeminiWeekly3h = {
    gemini: { remaining_percentage: 100, reset_time: new Date(now + (500000 + 10800) * 1000).toISOString(), window: 'weekly' }
  };
  const geminiWeeklyDriftRes = mergeQuotaBuckets(baseGeminiWeekly, driftedGeminiWeekly3h, true);
  assert.strictEqual(geminiWeeklyDriftRes.gemini.remaining_percentage, 93, "Gemini weekly quota must use 24h threshold and stay at 93% after 3h drift");

  // 12. Genuinely new weekly window (>24h advance) supersedes old window with 100%
  const newWeeklyWindow26h = {
    gemini: { remaining_percentage: 100, reset_time: new Date(now + (500000 + 26 * 3600) * 1000).toISOString(), window: 'weekly' }
  };
  const newWeeklyWon = mergeQuotaBuckets(baseGeminiWeekly, newWeeklyWindow26h, true);
  assert.strictEqual(newWeeklyWon.gemini.remaining_percentage, 100, "Genuine new weekly cycle (>24h advance) must supersede previous window");

  console.log("✅ mergeQuotaBuckets preservation and anti-jitter tests passed.");
}

function testParseModelLimitsAndGeneratorContext() {
  console.log("Testing parseModelLimits and extractRuntimeGeneratorContext...");
  const mockGam = {
    response: {
      models: {
        'gemini-4-argon-medium': {
          displayName: 'Gemini 4 Argon (Medium)',
          maxTokens: 1048576,
          model: 'MODEL_PLACEHOLDER_M418',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '512000', enabled: true })
              }
            }
          }
        },
        'gemini-4-carbon-disabled': {
          displayName: 'Gemini 4 Carbon',
          maxTokens: 1048576,
          model: 'MODEL_PLACEHOLDER_M670',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '512000', enabled: true })
              }
            }
          }
        },
        'gemini-4-hydrogen-high': {
          displayName: 'Gemini 4 Hydrogen (High)',
          maxTokens: 1048576,
          model: 'MODEL_PLACEHOLDER_M525',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '512000', enabled: true })
              }
            }
          }
        },
        'gemini-4-hydrogen-tiered-high': {
          displayName: 'Gemini 4 Hydrogen (High)',
          maxTokens: 1048576,
          model: 'MODEL_PLACEHOLDER_M530',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '512000', enabled: true })
              }
            }
          }
        },
        'gemini-3.8-flash-high': {
          displayName: 'Gemini 3.8 Flash (High)',
          maxTokens: 1048576,
          model: 'MODEL_PLACEHOLDER_M318',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '256000', enabled: true })
              }
            }
          }
        },
        'gemini-3.8-flash-tiered': {
          maxTokens: 1048576,
          model: 'MODEL_PLACEHOLDER_M322',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '256000', enabled: true })
              }
            }
          }
        },
        'gemini-2.5-flash': {
          displayName: 'Gemini 3.5 Flash Lite',
          maxTokens: 1048576,
          model: 'MODEL_GOOGLE_GEMINI_2_5_FLASH',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '128000', enabled: true })
              }
            }
          }
        },
        'gemini-3.5-flash-lite': {
          displayName: 'Gemini 3.5 Flash Lite',
          maxTokens: 1048576,
          model: 'MODEL_PLACEHOLDER_M198',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '128000', enabled: true })
              }
            }
          }
        },
        'gemini-pro-orchestrator-g1-pro': {
          displayName: 'Orchestrator (Argon)',
          maxTokens: 1048576,
          model: 'MODEL_PLACEHOLDER_M668',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '512000', enabled: true })
              }
            }
          }
        },
        'gpt-oss-120b-medium': {
          displayName: 'GPT-OSS 120B (Medium)',
          maxTokens: 131072,
          model: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '80000', enabled: true })
              }
            }
          }
        },
        'claude-opus-5-5-medium': {
          displayName: 'Claude Opus 5.5 (Medium)',
          maxTokens: 1000000,
          model: 'MODEL_PLACEHOLDER_M401',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '256000', enabled: true })
              },
              'CASCADE_USE_EXPERIMENT_CHECKPOINTER/claude-1m_840k': {
                stringValue: JSON.stringify({ max_token_limit: '840000', enabled: true })
              }
            }
          }
        },
        'collision-a': {
          displayName: 'Shared Label',
          maxTokens: 1048576,
          model: 'MODEL_COLLISION_A',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '128000', enabled: true })
              }
            }
          }
        },
        'collision-b': {
          displayName: 'Shared Label',
          maxTokens: 1048576,
          model: 'MODEL_COLLISION_B',
          modelExperiments: {
            experiments: {
              CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                stringValue: JSON.stringify({ max_token_limit: '512000', enabled: true })
              }
            }
          }
        }
      }
    }
  };

  const limits = parseModelLimits(mockGam);
  assert.strictEqual(limits['gemini4argonmedium']?.limit, 512000);
  assert.strictEqual(limits['gemini4carbon']?.limit, 512000);
  assert.strictEqual(limits['gemini4hydrogenhigh']?.limit, 512000);
  assert.strictEqual(limits['gemini4hydrogentieredhigh']?.limit, 512000);
  assert.strictEqual(limits['gemini38flashhigh']?.limit, 256000);
  assert.strictEqual(limits['gemini38flashtiered']?.limit, 256000);
  assert.strictEqual(limits['modelplaceholderm322']?.limit, 256000);
  assert.strictEqual(limits['gemini35flashlite']?.limit, 128000);
  assert.strictEqual(limits['orchestratorargon']?.limit, 512000);
  assert.strictEqual(limits['geminiproorchestratorg1pro']?.limit, 512000);
  assert.strictEqual(limits['gptoss120bmedium']?.limit, 80000);
  assert.strictEqual(limits['gptoss120bmedium']?.maxTokens, 131072);
  assert.strictEqual(limits['claudeopus55medium']?.limit, 256000);
  assert.strictEqual(limits['sharedlabel']?.ambiguous, true, "Conflicting displayName limits must be marked ambiguous");
  assert.strictEqual(limits['collisiona']?.limit, 128000, "Primary slug key must remain unambiguous");
  assert.strictEqual(limits['collisionb']?.limit, 512000, "Primary slug key must remain unambiguous");

  const emptyCtx = extractRuntimeGeneratorContext({});
  assert.strictEqual(emptyCtx.maxContextTokens, 0);
  assert.strictEqual(emptyCtx.count, 0);

  const populatedCtx = extractRuntimeGeneratorContext({
    generatorMetadata: [
      { chatModel: { model: 'MODEL_A', modelDisplayName: 'Old Model', chatStartMetadata: { contextWindowMetadata: { maxContextTokens: 256000 } } } },
      { chatModel: { model: 'MODEL_PLACEHOLDER_M401', modelDisplayName: 'Claude Opus 5.5 (Medium)', chatStartMetadata: { contextWindowMetadata: { maxContextTokens: 840000 } } } }
    ]
  });
  assert.strictEqual(populatedCtx.maxContextTokens, 840000);
  assert.strictEqual(populatedCtx.modelDisplayName, 'Claude Opus 5.5 (Medium)');
  assert.strictEqual(populatedCtx.model, 'MODEL_PLACEHOLDER_M401');
  assert.strictEqual(populatedCtx.count, 2);
  console.log("✅ parseModelLimits and extractRuntimeGeneratorContext tests passed.");
}

async function testAvailableModelsAndTrajectoryPagination() {
  console.log("Testing GetAvailableModels & paginated GetCascadeTrajectoryGeneratorMetadata...");
  const offsetsSeen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (req.url === '/exa.language_server_pb.LanguageServerService/GetUserStatus') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          userStatus: {
            email: 'dynamic@example.com',
            userTier: { name: 'Pro' },
            cascadeModelConfigData: { clientModelConfigs: [] }
          }
        }));
      } else if (req.url === '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ groups: [] }));
      } else if (req.url === '/exa.language_server_pb.LanguageServerService/GetAvailableModels') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          response: {
            models: {
              'gemini-4-argon-medium': {
                displayName: 'Gemini 4 Argon (Medium)',
                maxTokens: 1048576,
                model: 'MODEL_PLACEHOLDER_M418',
                modelExperiments: {
                  experiments: {
                    CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                      stringValue: JSON.stringify({ max_token_limit: '512000', enabled: true })
                    }
                  }
                }
              }
            }
          }
        }));
      } else if (req.url === '/exa.language_server_pb.LanguageServerService/GetCascadeTrajectoryGeneratorMetadata') {
        const parsedReq = JSON.parse(body || '{}');
        offsetsSeen.push(parsedReq.generatorMetadataOffset);
        if (parsedReq.cascadeId === 'conv-missing-404') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'not_found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (parsedReq.generatorMetadataOffset === 0) {
          const page1 = Array.from({ length: 256 }, () => ({
            chatModel: {
              model: 'MODEL_PLACEHOLDER_M418',
              modelDisplayName: 'Gemini 4 Argon (Medium)',
              chatStartMetadata: { contextWindowMetadata: { maxContextTokens: 512000 } }
            }
          }));
          res.end(JSON.stringify({ generatorMetadata: page1 }));
        } else {
          res.end(JSON.stringify({
            generatorMetadata: [
              {
                chatModel: {
                  model: 'MODEL_PLACEHOLDER_M401',
                  modelDisplayName: 'Claude Opus 5.5 (Medium)',
                  chatStartMetadata: { contextWindowMetadata: { maxContextTokens: 840000 } }
                }
              }
            ]
          }));
        }
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const tempHome = fs.mkdtempSync(join(os.tmpdir(), 'fetch-quota-pag-'));
  const origHome = process.env.HOME;
  const origProfile = process.env.USERPROFILE;
  const origLs = process.env.ANTIGRAVITY_LS_ADDRESS;
  const origTok = process.env.ANTIGRAVITY_CSRF_TOKEN;

  try {
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    process.env.ANTIGRAVITY_LS_ADDRESS = `127.0.0.1:${port}`;
    process.env.ANTIGRAVITY_CSRF_TOKEN = 'tok-pag';

    const gamRes = await requestAvailableModels(port, 'tok-pag', '127.0.0.1', false);
    assert.ok(gamRes.response.models['gemini-4-argon-medium']);
    const genRes = await requestTrajectoryGeneratorMetadata(port, 'tok-pag', 'conv-pag-1', 256, '127.0.0.1', false);
    assert.strictEqual(genRes.generatorMetadata.length, 1);

    offsetsSeen.length = 0;
    const ctxPath = join(tempHome, '.gemini', 'tmp', 'ctx_conv-pag-1.json');
    fs.mkdirSync(path.dirname(ctxPath), { recursive: true });
    fs.writeFileSync(ctxPath, JSON.stringify({ total_input_tokens: 12000, context_window_size: 1000000 }), 'utf8');

    const cache = await fetchLiveQuotaCache({ conversationId: 'conv-pag-1' });
    assert.ok(cache, "Cache must be returned from GetAvailableModels even when quota buckets are empty");
    assert.strictEqual(cache.modelLimits['gemini4argonmedium']?.limit, 512000);
    assert.ok(cache.modelLimitsUpdatedAt > 0);
    assert.deepStrictEqual(offsetsSeen, [0, 256], "Must paginate past 256-entry cap");
    assert.strictEqual(cache._runtimeContext?.maxContextTokens, 840000);
    assert.strictEqual(cache._runtimeContext?.nextOffset, 257);

    persistRuntimeContextToCtxFile(ctxPath, cache._runtimeContext);
    const savedCtx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
    assert.strictEqual(savedCtx.total_input_tokens, 12000, "Existing token stats must be preserved");
    assert.strictEqual(savedCtx.runtime_max_context_tokens, 840000);
    assert.strictEqual(savedCtx.runtime_model_key, 'claudeopus55medium');
    assert.strictEqual(savedCtx.generator_metadata_offset, 257);

    // 404 from trajectory metadata must not break GetAvailableModels
    const cache404 = await fetchLiveQuotaCache({ conversationId: 'conv-missing-404' });
    assert.strictEqual(cache404.modelLimits['gemini4argonmedium']?.limit, 512000);
    console.log("✅ GetAvailableModels & paginated GetCascadeTrajectoryGeneratorMetadata tests passed.");
  } catch (err) {
    if (err.code === 'EPERM' || err.message?.includes('EPERM')) {
      console.log("⚠️ Sandbox network restriction detected (EPERM). Loopback pagination test skipped.");
      return;
    }
    throw err;
  } finally {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
    if (origProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = origProfile;
    if (origLs === undefined) delete process.env.ANTIGRAVITY_LS_ADDRESS; else process.env.ANTIGRAVITY_LS_ADDRESS = origLs;
    if (origTok === undefined) delete process.env.ANTIGRAVITY_CSRF_TOKEN; else process.env.ANTIGRAVITY_CSRF_TOKEN = origTok;
    try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch (_) {}
    await new Promise(resolve => server.close(resolve));
  }
}

async function runAll() {
  try {
    testParseWeeklyBucketsUnwrapped();
    testParseWeeklyBucketsWrappedAndCamelCase();
    testMergeQuotaBuckets();
    testParseModelLimitsAndGeneratorContext();
    await testHttpEndpointAndEnvDiscovery();
    await testAvailableModelsAndTrajectoryPagination();
    console.log("✅ All R0 tests passed successfully!");
  } catch (err) {
    console.error("❌ R0 test failed:", err);
    process.exit(1);
  }
}

runAll();
