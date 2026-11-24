import fs from 'fs';
import path from 'path';
import os from 'os';
import assert from 'assert';
import { HOOK_VERSION } from '../lib/core/constants.mjs';
import { hasBOM } from '../lib/core/fs-utils.mjs';
import {
  SUPPORTED_LOCALES,
  METRIC_CATEGORIES,
  METRICS,
  ALL_STANDARD_METRIC_IDS,
  ADJACENT_PAIRS,
  EMOJI_MAP,
  buildQuestionsJsonObject,
  buildPromptsJsonObject
} from '../lib/metrics/registry.mjs';
import {
  registerRenderer,
  getRenderer,
  listRenderers
} from '../lib/renderers/index.mjs';
import { standardRenderer } from '../lib/renderers/standard.mjs';
import { syncResources } from '../sync-resources.mjs';
import * as statuslineQuotaExports from '../statusline-quota.mjs';
import * as fetchLocalQuotaExports from '../fetch-local-quota.mjs';
import * as configureStatuslineExports from '../configure-statusline.mjs';
import * as diagnoseStatuslineExports from '../diagnose-statusline.mjs';
import { PROJECT_ROOT, SKILL_DIR, rmRfSync } from './helpers.mjs';

const EXPECTED_STATUSLINE_QUOTA_EXPORTS = [
  'ADJACENT_PAIRS',
  'DEFAULT_COMPACTION_THRESHOLD',
  'EMOJI_MAP',
  'GITHUB_LATEST_RELEASE_URL',
  'HOOK_VERSION',
  'PLUGIN_REPO_URL',
  'STEP_UP_INTERMEDIATE_THRESHOLD',
  'buildI18nDict',
  'calculateContextUsageAsync',
  'checkPluginUpdateAsync',
  'compareSemver',
  'computeSteppedCeiling',
  'extractArgsAfterExecutable',
  'extractMetricsAsync',
  'extractModelCandidateKeys',
  'fetchLatestPluginReleaseAsync',
  'formatAbsoluteResetTime',
  'formatPluginUpdateNoticeLines',
  'formatResetTime',
  'formatSecondsToCountdown',
  'formatVersionTag',
  'getDisplayWidth',
  'getGitBranch',
  'getGitDirty',
  'hasNonInteractiveAgyFlag',
  'isAgyProcessName',
  'isHubAgyArgs',
  'isVersionBehind',
  'mergeQuotaBuckets',
  'normalizeLabelStyle',
  'normalizeLanguage',
  'normalizeSemver',
  'parseCeilingValue',
  'parseLinuxProcStat',
  'parseMacPsLine',
  'parseMetaQuota',
  'parseWinProcessChainJson',
  'preprocessAdjacentItems',
  'renderBarGraph',
  'renderStatusLine',
  'resolveAgySessionAsync',
  'resolveCatalogEntry',
  'resolveInstalledPluginVersionAsync',
  'resolveModelQuota',
  'resolveTerminalWidth',
  'resolveWeeklyQuota',
  'stripAnsi',
  'tokenizeCommandLine',
  'triggerQuotaUpdateIfNeededAsync'
];

const EXPECTED_FETCH_LOCAL_QUOTA_EXPORTS = [
  'extractRuntimeGeneratorContext',
  'fetchLiveQuotaCache',
  'formatResetTime',
  'mergeQuotaBuckets',
  'parseModelLimits',
  'parseShortTermBuckets',
  'parseWeeklyBuckets',
  'persistRuntimeContextToCtxFile',
  'requestAvailableModels',
  'requestQuotaSummary',
  'requestTrajectoryGeneratorMetadata',
  'requestUserStatus',
  'sanitizeConversationId'
];

const EXPECTED_CONFIGURE_STATUSLINE_EXPORTS = [
  'ALL_STANDARD_METRIC_IDS',
  'cleanupLegacyWindowsShBridge',
  'getStatusLineCommand',
  'isDirectExecution',
  'main',
  'normalizeLabelStyle',
  'parseOrderAndStyles'
];

async function main() {
  console.log('=== Running core-and-registry.test.mjs ===');

  try {
    // ----------------------------------------------------
    // 1. Audit #6：HOOK_VERSION === plugin.json.version === package.json.version
    // ----------------------------------------------------
    console.log('\n[Test 1] Verifying Audit #6 version consistency across HOOK_VERSION, plugin.json, and package.json...');
    const pluginJsonPath = path.join(PROJECT_ROOT, 'plugin.json');
    const packageJsonPath = path.join(PROJECT_ROOT, 'package.json');
    const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    assert.ok(typeof HOOK_VERSION === 'string' && HOOK_VERSION.length > 0, 'HOOK_VERSION must be a non-empty string');
    assert.strictEqual(HOOK_VERSION, pluginJson.version, `HOOK_VERSION (${HOOK_VERSION}) must equal plugin.json.version (${pluginJson.version})`);
    assert.strictEqual(pluginJson.version, packageJson.version, `plugin.json.version (${pluginJson.version}) must equal package.json.version (${packageJson.version})`);
    assert.strictEqual(HOOK_VERSION, packageJson.version, `HOOK_VERSION (${HOOK_VERSION}) must equal package.json.version (${packageJson.version})`);
    console.log(`✅ Audit #6 passed! Version is consistently ${HOOK_VERSION}.`);

    // ----------------------------------------------------
    // 2. Registry Zero-Drift：questions.json / prompts.json / 36 指標 / 無多餘括號 / 40 鍵 EMOJI_MAP
    // ----------------------------------------------------
    console.log('\n[Test 2] Verifying registry zero-drift (questions.json, prompts.json, 36 metrics, parentheses, 40 EMOJI_MAP keys)...');
    const questionsPath = path.join(SKILL_DIR, 'resources', 'questions.json');
    const promptsPath = path.join(SKILL_DIR, 'resources', 'prompts.json');

    const questionsBuf = fs.readFileSync(questionsPath);
    const promptsBuf = fs.readFileSync(promptsPath);
    assert.strictEqual(hasBOM(questionsBuf), false, 'resources/questions.json must not contain UTF-8 BOM');
    assert.strictEqual(hasBOM(promptsBuf), false, 'resources/prompts.json must not contain UTF-8 BOM');

    const questionsOnDisk = JSON.parse(questionsBuf.toString('utf8'));
    const promptsOnDisk = JSON.parse(promptsBuf.toString('utf8'));
    const builtQuestions = buildQuestionsJsonObject();
    const builtPrompts = buildPromptsJsonObject();

    assert.deepStrictEqual(builtQuestions, questionsOnDisk, 'buildQuestionsJsonObject() must deepStrictEqual resources/questions.json');
    assert.deepStrictEqual(builtPrompts, promptsOnDisk, 'buildPromptsJsonObject() must deepStrictEqual resources/prompts.json');

    // 驗證 prompts.json 結構與四語系完整性
    assert.deepStrictEqual(
      Object.keys(builtPrompts).sort(),
      ['step1', 'step2_missing_node', 'step4_order_question', 'step4_table'],
      'prompts.json must contain exact top-level keys'
    );
    for (const locale of SUPPORTED_LOCALES) {
      assert.ok(builtPrompts.step2_missing_node[locale], `prompts.json step2_missing_node must include locale ${locale}`);
      assert.ok(builtPrompts.step4_table[locale]?.title, `prompts.json step4_table.${locale}.title must exist`);
      assert.ok(builtPrompts.step4_table[locale]?.header, `prompts.json step4_table.${locale}.header must exist`);
      assert.ok(builtPrompts.step4_order_question[locale], `prompts.json step4_order_question must include locale ${locale}`);
    }

    // 驗證 36 項標準指標與 ALL_STANDARD_METRIC_IDS、無額外括號
    assert.strictEqual(METRICS.length, 36, 'METRICS must contain 36 standard metrics');
    assert.strictEqual(ALL_STANDARD_METRIC_IDS.length, 36, 'ALL_STANDARD_METRIC_IDS must contain 36 metric IDs');
    assert.deepStrictEqual(
      METRICS.map(m => m.id),
      ALL_STANDARD_METRIC_IDS,
      'METRICS IDs must match ALL_STANDARD_METRIC_IDS in exact order'
    );
    assert.strictEqual(METRIC_CATEGORIES.length, 5, 'METRIC_CATEGORIES must contain 5 categories');

    for (const locale of SUPPORTED_LOCALES) {
      const localeData = builtQuestions[locale];
      assert.ok(localeData, `questions.json must contain locale ${locale}`);
      assert.strictEqual(localeData.options.length, 36, `${locale} options must have 36 items`);

      const extractedIds = [];
      for (const opt of localeData.options) {
        const openParens = (opt.match(/[\(（]/g) || []).length;
        const closeParens = (opt.match(/[\)）]/g) || []).length;
        assert.strictEqual(openParens, 1, `[${locale}] Option must have no extra opening parentheses: "${opt}"`);
        assert.strictEqual(closeParens, 1, `[${locale}] Option must have no extra closing parentheses: "${opt}"`);
        const m = opt.match(/[\(（]([a-z0-9\-_]+)[\)）]$/);
        assert.ok(m, `[${locale}] Option must end with (metric-id): "${opt}"`);
        extractedIds.push(m[1]);
      }
      assert.deepStrictEqual(
        extractedIds,
        ALL_STANDARD_METRIC_IDS,
        `[${locale}] Extracted option metric IDs must match ALL_STANDARD_METRIC_IDS in exact order`
      );
    }

    // 驗證 EMOJI_MAP 40 個鍵（36 項標準指標 + 4 組 ADJACENT_PAIRS 合併鍵）
    const emojiKeys = Object.keys(EMOJI_MAP);
    assert.strictEqual(ADJACENT_PAIRS.length, 4, 'ADJACENT_PAIRS must contain 4 pairs');
    assert.strictEqual(emojiKeys.length, 40, `EMOJI_MAP must contain 40 keys, got ${emojiKeys.length}`);
    for (const id of ALL_STANDARD_METRIC_IDS) {
      assert.ok(typeof EMOJI_MAP[id] === 'string' && EMOJI_MAP[id].length > 0, `EMOJI_MAP must include non-empty emoji for ${id}`);
    }
    for (const pair of ADJACENT_PAIRS) {
      assert.strictEqual(EMOJI_MAP[pair.merged], EMOJI_MAP[pair.val], `EMOJI_MAP[${pair.merged}] must equal EMOJI_MAP[${pair.val}]`);
    }

    // 驗證 syncResources(tmpDir) 寫入無 BOM 且完全相等的資源檔
    const tmpSkillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-sync-res-'));
    try {
      const synced = syncResources(tmpSkillDir);
      assert.strictEqual(hasBOM(fs.readFileSync(synced.questionsPath)), false);
      assert.strictEqual(hasBOM(fs.readFileSync(synced.promptsPath)), false);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(synced.questionsPath, 'utf8')), questionsOnDisk);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(synced.promptsPath, 'utf8')), promptsOnDisk);
    } finally {
      rmRfSync(tmpSkillDir);
    }
    console.log('✅ Registry zero-drift passed!');

    // ----------------------------------------------------
    // 3. Renderer Registry（registerRenderer, getRenderer('standard'), listRenderers()）
    // ----------------------------------------------------
    console.log('\n[Test 3] Verifying renderer registry (registerRenderer, getRenderer, listRenderers)...');
    assert.strictEqual(getRenderer('standard'), standardRenderer, "getRenderer('standard') must return standardRenderer");
    assert.strictEqual(getRenderer(), standardRenderer, 'getRenderer() with no arguments must default to standardRenderer');
    assert.strictEqual(getRenderer('  STANDARD  '), standardRenderer, 'getRenderer() must normalize case and whitespace');
    assert.ok(listRenderers().includes('standard'), "listRenderers() must include 'standard'");
    assert.strictEqual(getRenderer('non-existent-renderer'), null, 'getRenderer() for unknown name must return null');

    const customDinoRenderer = (ctx) => [`🦖 ${ctx?.fallbackModel || 'Dino'}`];
    const registeredFn = registerRenderer('Dino-Custom', customDinoRenderer);
    assert.strictEqual(registeredFn, customDinoRenderer, 'registerRenderer must return the registered function');
    assert.strictEqual(getRenderer('dino-custom'), customDinoRenderer, 'Custom renderer must be retrievable in lowercase');
    assert.strictEqual(getRenderer('DINO-CUSTOM'), customDinoRenderer, 'Custom renderer must be retrievable case-insensitively');
    assert.ok(listRenderers().includes('dino-custom'), "listRenderers() must include registered 'dino-custom'");
    assert.deepStrictEqual(getRenderer('dino-custom')({ fallbackModel: 'Gemini 4 Argon' }), ['🦖 Gemini 4 Argon']);

    assert.throws(() => registerRenderer('', () => {}), TypeError, 'Empty renderer name must throw TypeError');
    assert.throws(() => registerRenderer('bad', 'not-a-fn'), TypeError, 'Non-function renderer must throw TypeError');
    console.log('✅ Renderer registry passed!');

    // ----------------------------------------------------
    // 4. 向後相容匯出契約驗證（49 + 13 + 7 + checkPluginHookSync）
    // ----------------------------------------------------
    console.log('\n[Test 4] Verifying backwards-compatible export contracts...');
    const actualStatuslineExports = Object.keys(statuslineQuotaExports).sort();
    assert.strictEqual(
      actualStatuslineExports.length,
      49,
      `statusline-quota.mjs must export 49 symbols, got ${actualStatuslineExports.length}: ${JSON.stringify(actualStatuslineExports)}`
    );
    assert.deepStrictEqual(
      actualStatuslineExports,
      [...EXPECTED_STATUSLINE_QUOTA_EXPORTS].sort(),
      'statusline-quota.mjs exported symbol names must match all 49 expected symbols'
    );

    const actualFetchExports = Object.keys(fetchLocalQuotaExports).sort();
    assert.strictEqual(
      actualFetchExports.length,
      13,
      `fetch-local-quota.mjs must export 13 symbols, got ${actualFetchExports.length}`
    );
    assert.deepStrictEqual(
      actualFetchExports,
      [...EXPECTED_FETCH_LOCAL_QUOTA_EXPORTS].sort(),
      'fetch-local-quota.mjs exported symbol names must match all 13 expected symbols'
    );

    const actualConfigureExports = Object.keys(configureStatuslineExports).sort();
    assert.strictEqual(
      actualConfigureExports.length,
      7,
      `configure-statusline.mjs must export 7 symbols, got ${actualConfigureExports.length}`
    );
    assert.deepStrictEqual(
      actualConfigureExports,
      [...EXPECTED_CONFIGURE_STATUSLINE_EXPORTS].sort(),
      'configure-statusline.mjs exported symbol names must match all 7 expected symbols'
    );

    assert.strictEqual(
      typeof diagnoseStatuslineExports.checkPluginHookSync,
      'function',
      'diagnose-statusline.mjs must export checkPluginHookSync function'
    );
    console.log('✅ Backwards-compatible export contracts passed! (49 + 13 + 7 + checkPluginHookSync)');

    console.log('\n🎉 All core-and-registry.test.mjs tests passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ core-and-registry.test.mjs failed:', err);
    process.exit(1);
  }
}

main();
