import { parseWeeklyBuckets, parseShortTermBuckets } from './fetch-local-quota.mjs';
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
import { requestUserStatus, requestQuotaSummary, fetchLiveQuotaCache } from './fetch-local-quota.mjs';

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
    console.log("✅ HTTP endpoint, env discovery, persistence, and stale cache invalidation tests passed.");
  } finally {
    if (origLs !== undefined) process.env.ANTIGRAVITY_LS_ADDRESS = origLs;
    else delete process.env.ANTIGRAVITY_LS_ADDRESS;

    if (origToken !== undefined) process.env.ANTIGRAVITY_CSRF_TOKEN = origToken;
    else delete process.env.ANTIGRAVITY_CSRF_TOKEN;

    await new Promise(resolve => server.close(resolve));
  }
}

async function runAll() {
  try {
    testParseWeeklyBucketsUnwrapped();
    testParseWeeklyBucketsWrappedAndCamelCase();
    await testHttpEndpointAndEnvDiscovery();
    console.log("✅ All R0 tests passed successfully!");
  } catch (err) {
    console.error("❌ R0 test failed:", err);
    process.exit(1);
  }
}

runAll();
