import { parseWeeklyBuckets } from './fetch-local-quota.mjs';
import assert from 'assert';

console.log("=== Running fetch-local-quota.test.mjs (R0) ===");

// R0: endpoint shape -> cache shape (data-layer, pure)
// Test justification: This test verifies that parseWeeklyBuckets properly filters RetrieveUserQuotaSummary response to select 'weekly' buckets under both unwrapped/wrapped shapes and both remaining/remainingFraction, reset/resetTime namings.
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

  const parsed = parseWeeklyBuckets(mockResponse);
  assert.ok(parsed.gemini, "gemini pool should exist");
  assert.ok(parsed['3p'], "3p pool should exist");
  assert.strictEqual(parsed.gemini.remaining_percentage, 87.90675);
  assert.strictEqual(parsed.gemini.reset_time, '2026-07-05T03:22:46Z');
  assert.strictEqual(parsed['3p'].remaining_percentage, 100);
  assert.strictEqual(parsed['3p'].reset_time, '2026-07-07T08:18:13Z');
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
