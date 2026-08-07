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

try {
  testParseWeeklyBucketsUnwrapped();
  testParseWeeklyBucketsWrappedAndCamelCase();
  console.log("✅ All R0 tests passed successfully!");
} catch (err) {
  console.error("❌ R0 test failed:", err);
  process.exit(1);
}
