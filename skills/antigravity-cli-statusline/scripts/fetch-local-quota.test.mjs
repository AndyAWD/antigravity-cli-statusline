import { parseWeeklyBuckets } from './fetch-local-quota.mjs';
import assert from 'assert';

console.log("=== Running fetch-local-quota.test.mjs (R0) ===");

// R0: endpoint shape -> cache shape (data-layer, pure)
// Test justification: This test verifies that parseWeeklyBuckets properly filters RetrieveUserQuotaSummary response to select 'weekly' buckets, converts remaining fraction to percentage, formatting reset times correctly, and maps to correct model pools.
function testParseWeeklyBuckets() {
  const mockResponse = {
    groups: [
      {
        buckets: [
          {
            bucketId: 'gemini-weekly',
            window: 'weekly',
            remaining: 0.9007,
            reset: '2026-07-05T03:22:46Z'
          },
          {
            bucketId: 'gemini-5h',
            window: '5h',
            remaining: 0.8709,
            reset: '2026-06-30T12:14:44Z'
          }
        ]
      },
      {
        buckets: [
          {
            bucketId: '3p-weekly',
            window: 'weekly',
            remaining: 1.0,
            reset: '2026-07-07T07:27:15Z'
          },
          {
            bucketId: '3p-5h',
            window: '5h',
            remaining: 1.0,
            reset: '2026-06-30T12:27:15Z'
          }
        ]
      }
    ]
  };

  const parsed = parseWeeklyBuckets(mockResponse);

  console.log("Parsed result:", JSON.stringify(parsed, null, 2));

  // Asserting model pools
  assert.ok(parsed.gemini, "gemini pool should exist");
  assert.ok(parsed['3p'], "3p pool should exist");

  // Asserting exact remaining_percentage conversion
  assert.strictEqual(parsed.gemini.remaining_percentage, 90.07, "gemini remaining_percentage should be 90.07");
  assert.strictEqual(parsed['3p'].remaining_percentage, 100, "3p remaining_percentage should be 100");

  // Asserting exact reset_time
  assert.strictEqual(parsed.gemini.reset_time, '2026-07-05T03:22:46Z');
  assert.strictEqual(parsed['3p'].reset_time, '2026-07-07T07:27:15Z');

  // Asserting refreshes_in matches duration regex pattern
  const durationRegex = /^(now|\d+m|\d+h( \d+m)?|\d+d( \d+h)?)$/;
  assert.ok(durationRegex.test(parsed.gemini.refreshes_in), `gemini refreshes_in format invalid: ${parsed.gemini.refreshes_in}`);
  assert.ok(durationRegex.test(parsed['3p'].refreshes_in), `3p refreshes_in format invalid: ${parsed['3p'].refreshes_in}`);

  console.log("✅ R0 test passed successfully!");
}

try {
  testParseWeeklyBuckets();
} catch (err) {
  console.error("❌ R0 test failed:", err);
  process.exit(1);
}
