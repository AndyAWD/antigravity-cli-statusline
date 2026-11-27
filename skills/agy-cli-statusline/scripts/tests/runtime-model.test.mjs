import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  classifyOrchestratorModelRole,
  extractOrchestratorPlannerLabel,
  formatRuntimeModelDisplayName,
  isOrchestratorModelName,
  isOrchestratorSession,
  isOrchestratorWorkerModel,
  readAppModelStateAsync,
  readAppSelectedModelAsync,
  readLatestTranscriptModelAsync,
  resolveActiveRuntimeModelAsync,
  resolveConfiguredPlannerRef,
  resolveOrchestratorWrapperDisplayName,
  resolvePlannerCatalogModelRef
} from '../lib/collectors/runtime-model.mjs';
import {
  buildI18nDict,
  extractMetricsAsync,
  stripAnsi
} from '../statusline-quota.mjs';
import { runStatusline } from './helpers.mjs';

test('isOrchestratorModelName and isOrchestratorSession identify orchestrator sessions across sources', () => {
  assert.equal(isOrchestratorModelName('Orchestrator (Carbon)'), true);
  assert.equal(isOrchestratorModelName('gemini-pro-orchestrator-g1-pro'), true);
  assert.equal(isOrchestratorModelName('Gemini 4 Hydrogen (High)'), false);
  assert.equal(isOrchestratorModelName(''), false);

  assert.equal(isOrchestratorSession({ model: { display_name: 'Orchestrator (Carbon)' } }), true);
  assert.equal(isOrchestratorSession({ model: { id: 'Gemini 4 Hydrogen (High)' } }, { model: 'Orchestrator (Argon)' }), true);
  assert.equal(isOrchestratorSession({}, {}, { modelName: 'orchestrator' }), true);
  assert.equal(isOrchestratorSession({ model: { display_name: 'Gemini 4 Neon (High)' } }, { orchestrator: { planner: 'gemini-4-carbon-high' } }), false);
  assert.equal(isOrchestratorSession({ model: { display_name: 'Gemini 4 Neon (High)' } }), false);
});

test('formatRuntimeModelDisplayName formats slugs and resolves catalog displayName', () => {
  const cache = {
    modelLimits: {
      modelplaceholderm418: {
        slug: 'gemini-4-argon-medium',
        model: 'MODEL_PLACEHOLDER_M418',
        displayName: 'Gemini 4 Argon (Medium)'
      },
      geminiproorchestratorg1pro: {
        slug: 'gemini-pro-orchestrator-g1-pro',
        model: 'MODEL_PLACEHOLDER_M668',
        displayName: 'Orchestrator (Argon)'
      }
    }
  };

  assert.equal(formatRuntimeModelDisplayName('MODEL_PLACEHOLDER_M418', cache), 'Gemini 4 Argon (Medium)');
  // 外層 Orchestrator 名稱不可覆蓋
  assert.equal(formatRuntimeModelDisplayName('gemini-pro-orchestrator-g1-pro', cache), 'Gemini Pro Orchestrator G1 Pro');
  assert.equal(formatRuntimeModelDisplayName('gemini-4-hydrogen-high'), 'Gemini 4 Hydrogen (High)');
  assert.equal(formatRuntimeModelDisplayName('gemini-4-carbon-high'), 'Gemini 4 Carbon (High)');
  assert.equal(formatRuntimeModelDisplayName('gemini-3-8-flash-low'), 'Gemini 3.8 Flash (Low)');
  assert.equal(formatRuntimeModelDisplayName('Claude Opus 5.5 (Medium)'), 'Claude Opus 5.5 (Medium)');
});

test('classifyOrchestratorModelRole uses settings.orchestrator first, then keywords, then thinking hints', () => {
  const settings = {
    orchestrator: {
      planner: { model: 'gemini-4-carbon', effort: 'high' },
      executor: { model: 'gemini-4-hydrogen', effort: 'high' }
    }
  };
  assert.equal(classifyOrchestratorModelRole('gemini-4-carbon-high', settings), 'planner');
  assert.equal(classifyOrchestratorModelRole('Gemini 4 Hydrogen (High)', settings), 'executor');

  // 相同基底模型、僅 Effort 不同時，應能透過完整鍵精準區分
  const sameBaseSettings = {
    orchestrator: {
      planner: 'gemini-4-neon-high',
      executor: 'gemini-4-neon-low'
    }
  };
  assert.equal(classifyOrchestratorModelRole('gemini-4-neon-high', sameBaseSettings), 'planner');
  assert.equal(classifyOrchestratorModelRole('gemini-4-neon-low', sameBaseSettings), 'executor');

  // 無 settings.orchestrator 時依關鍵字退讓
  assert.equal(classifyOrchestratorModelRole('gemini-3-8-flash-medium', {}), 'executor');
  assert.equal(classifyOrchestratorModelRole('gemini-4-argon-high', {}), 'planner');

  // 未知代號時依 thinking hints 退讓
  assert.equal(classifyOrchestratorModelRole('custom-model-alpha', {}, null, { hasThinking: true }), 'planner');
  assert.equal(classifyOrchestratorModelRole('custom-model-alpha', {}, null, {}), 'unknown');
  assert.equal(classifyOrchestratorModelRole('Orchestrator (Carbon)', settings), 'unknown');
});

test('readLatestTranscriptModelAsync reads tail, skips torn line, and ignores orchestrator wrapper', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-rt-tr-'));
  try {
    const trPath = path.join(tmpDir, 'transcript.jsonl');
    const lines = [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', status: 'DONE' }),
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-23T13:00:00Z',
        model: 'gemini-4-carbon-high',
        thinking: 'Analyzing plan'
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        created_at: '2026-11-23T13:01:00Z',
        model: 'Orchestrator (Carbon)'
      }),
      '{"torn_partial": '
    ];
    fs.writeFileSync(trPath, lines.join('\n'), 'utf8');

    const res = await readLatestTranscriptModelAsync(trPath);
    assert.equal(res.exists, true);
    assert.equal(res.model, 'gemini-4-carbon-high');
    assert.equal(res.hasThinking, true);
    assert.equal(res.timestampMs, new Date('2026-11-23T13:00:00Z').getTime());
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveActiveRuntimeModelAsync arbitrates meta > fresh PreInvocation hook > transcript > ls_cache > pending', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-rt-home-'));
  try {
    const convId = 'conv-orch-1';
    const pluginDataDir = path.join(tmpHome, 'plugin_data');
    const trPath = path.join(tmpHome, '.gemini', 'antigravity-cli', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');
    const ctxPath = path.join(tmpHome, '.gemini', 'tmp', `ctx_${convId}.json`);
    fs.mkdirSync(pluginDataDir, { recursive: true });
    fs.mkdirSync(path.dirname(trPath), { recursive: true });
    fs.mkdirSync(path.dirname(ctxPath), { recursive: true });

    const baseSettings = {
      orchestrator: {
        planner: 'gemini-4-carbon-high',
        executor: 'gemini-4-hydrogen-high'
      }
    };
    const baseMeta = {
      conversation_id: convId,
      model: { display_name: 'Orchestrator (Carbon)' }
    };

    // 1. 尚無任何執行期來源 -> pending
    const pendingRes = await resolveActiveRuntimeModelAsync({
      meta: baseMeta,
      settings: baseSettings,
      homeDir: tmpHome,
      pluginDataDir
    });
    assert.equal(pendingRes.isOrchestrator, true);
    assert.equal(pendingRes.role, 'pending');
    assert.equal(pendingRes.modelName, '');

    // 2. 僅 ctx 快取存在 -> ls_cache
    fs.writeFileSync(ctxPath, JSON.stringify({
      runtime_model_display_name: 'Gemini 4 Carbon (High)',
      runtime_model_enum: 'MODEL_CARBON'
    }), 'utf8');
    const lsRes = await resolveActiveRuntimeModelAsync({
      meta: baseMeta,
      settings: baseSettings,
      homeDir: tmpHome,
      pluginDataDir
    });
    assert.equal(lsRes.source, 'ls_cache');
    assert.equal(lsRes.modelName, 'Gemini 4 Carbon (High)');
    assert.equal(lsRes.role, 'planner');

    // 3. transcript 較新 -> transcript
    const tTr = Date.parse('2026-11-23T13:10:00Z');
    fs.writeFileSync(trPath, JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: '2026-11-23T13:10:00Z',
      model: 'gemini-4-hydrogen-high'
    }) + '\n', 'utf8');
    fs.writeFileSync(path.join(pluginDataDir, 'sessions.json'), JSON.stringify({
      version: 1,
      sessions: {
        [convId]: { conversationId: convId, modelName: 'gemini-4-carbon-high', updatedAt: tTr - 5000 }
      }
    }), 'utf8');

    const trRes = await resolveActiveRuntimeModelAsync({
      meta: baseMeta,
      settings: baseSettings,
      homeDir: tmpHome,
      pluginDataDir
    });
    assert.equal(trRes.source, 'transcript');
    assert.equal(trRes.modelName, 'Gemini 4 Hydrogen (High)');
    assert.equal(trRes.role, 'executor');

    // 4. PreInvocation hook 更新比 transcript 還新 -> hook
    fs.writeFileSync(path.join(pluginDataDir, 'sessions.json'), JSON.stringify({
      version: 1,
      sessions: {
        [convId]: { conversationId: convId, modelName: 'gemini-4-carbon-high', updatedAt: tTr + 5000 }
      }
    }), 'utf8');
    const hookRes = await resolveActiveRuntimeModelAsync({
      meta: baseMeta,
      settings: baseSettings,
      homeDir: tmpHome,
      pluginDataDir
    });
    assert.equal(hookRes.source, 'hook');
    assert.equal(hookRes.modelName, 'Gemini 4 Carbon (High)');
    assert.equal(hookRes.role, 'planner');

    // 5. 原生 meta 擴充欄位優先於所有快取 -> meta
    const metaRes = await resolveActiveRuntimeModelAsync({
      meta: { ...baseMeta, model: { display_name: 'Orchestrator (Carbon)', active_model: 'gemini-4-hydrogen-high' } },
      settings: baseSettings,
      homeDir: tmpHome,
      pluginDataDir
    });
    assert.equal(metaRes.source, 'meta');
    assert.equal(metaRes.modelName, 'Gemini 4 Hydrogen (High)');
    assert.equal(metaRes.role, 'executor');

    // 6. 非 Orchestrator 模式直接門控略過（即使 sessions.json 殘留舊 Orchestrator 紀錄也不得誤判）
    fs.writeFileSync(path.join(pluginDataDir, 'sessions.json'), JSON.stringify({
      version: 1,
      sessions: {
        [convId]: { conversationId: convId, modelName: 'Orchestrator (Carbon)', updatedAt: tTr + 10000 }
      }
    }), 'utf8');
    const nonOrchRes = await resolveActiveRuntimeModelAsync({
      meta: { conversation_id: convId, model: { display_name: 'Gemini 4 Neon (High)' } },
      settings: baseSettings,
      homeDir: tmpHome,
      pluginDataDir
    });
    assert.equal(nonOrchRes.isOrchestrator, false);
    assert.equal(nonOrchRes.modelName, '');
    assert.equal(nonOrchRes.role, 'none');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('active-model renders across all 4 locales (text & emoji) and shows red off when not Orchestrator', () => {
  const baseMetrics = {
    fallbackModel: 'Orchestrator (Carbon)',
    quotaColor: '',
    quotaVal: '100%',
    contextColor: '',
    usedPct: '0.0%',
    memUsage: '50MB',
    tokenCount: '0 / 256.0k',
    countdownVal: '5h',
    gitBranch: 'main',
    projectName: 'proj',
    projectFullPath: '/proj',
    planTier: 'Pro',
    accountEmail: 'a@b.com',
    agentState: 'idle',
    toolConfirmPending: false,
    pendingInputCount: 0,
    backgroundTasksCount: 0,
    subagentsCount: 0,
    artifactsCount: 0,
    vcsDirtyFlag: false,
    vcsDirtyGlyph: '',
    vcsDirtyLabel: 'ok',
    vcsType: 'git',
    sandboxEnabled: false,
    sandboxAllowNet: false,
    sandboxStatusVal: 'off',
    cliVersion: 'v1.5.15',
    appVersion: 'v2.34.0',
    pluginVersion: 'v1.13.0',
    conversationIdShort: '12345678',
    agentProfileName: 'Default',
    weeklyQuotaColor: '',
    weeklyQuotaVal: '100%',
    weeklyCountdownVal: '7d',
    mode: 'Default',
    quotaResetTimeVal: '12:00',
    weeklyResetTimeVal: '12:00',
    quotaBarVal: '[██████████]',
    weeklyQuotaBarVal: '[██████████]',
    contextBarVal: '[░░░░░░░░░░]',
    tokenBarVal: '[░░░░░░░░░░]',
    isOrchestrator: true,
    activeModelName: 'Gemini 4 Carbon (High)',
    activeModelRole: 'planner'
  };

  const expectedPlanner = {
    'zh-tw': { text: '規劃者: Gemini 4 Carbon (High)', emoji: '🪄 規劃者 → Gemini 4 Carbon (High)' },
    'zh-cn': { text: '规划者: Gemini 4 Carbon (High)', emoji: '🪄 规划者 → Gemini 4 Carbon (High)' },
    'us': { text: 'Planner: Gemini 4 Carbon (High)', emoji: '🪄 Planner → Gemini 4 Carbon (High)' },
    'jp': { text: 'プランナー: Gemini 4 Carbon (High)', emoji: '🪄 プランナー → Gemini 4 Carbon (High)' }
  };

  for (const [loc, exp] of Object.entries(expectedPlanner)) {
    assert.equal(stripAnsi(buildI18nDict(loc, baseMetrics, 'text')['active-model']), exp.text);
    assert.equal(stripAnsi(buildI18nDict(loc, baseMetrics, 'emoji')['active-model']), exp.emoji);
  }

  const executorMetrics = { ...baseMetrics, activeModelName: 'Gemini 4 Hydrogen (High)', activeModelRole: 'executor' };
  const expectedExecutor = {
    'zh-tw': { text: '執行者: Gemini 4 Hydrogen (High)', emoji: '🪄 執行者 → Gemini 4 Hydrogen (High)' },
    'zh-cn': { text: '执行者: Gemini 4 Hydrogen (High)', emoji: '🪄 执行者 → Gemini 4 Hydrogen (High)' },
    'us': { text: 'Executor: Gemini 4 Hydrogen (High)', emoji: '🪄 Executor → Gemini 4 Hydrogen (High)' },
    'jp': { text: 'エグゼキューター: Gemini 4 Hydrogen (High)', emoji: '🪄 エグゼキューター → Gemini 4 Hydrogen (High)' }
  };
  for (const [loc, exp] of Object.entries(expectedExecutor)) {
    assert.equal(stripAnsi(buildI18nDict(loc, executorMetrics, 'text')['active-model']), exp.text);
    assert.equal(stripAnsi(buildI18nDict(loc, executorMetrics, 'emoji')['active-model']), exp.emoji);
  }

  const pendingMetrics = { ...baseMetrics, activeModelName: '', activeModelRole: 'pending' };
  const expectedPending = {
    'zh-tw': { text: '協調器: 待命', emoji: '🪄 待命' },
    'zh-cn': { text: '协调器: 待命', emoji: '🪄 待命' },
    'us': { text: 'Orchestrator: Pending', emoji: '🪄 Pending' },
    'jp': { text: 'Orchestrator: 待機中', emoji: '🪄 待機中' }
  };
  for (const [loc, exp] of Object.entries(expectedPending)) {
    assert.equal(stripAnsi(buildI18nDict(loc, pendingMetrics, 'text')['active-model']), exp.text);
    assert.equal(stripAnsi(buildI18nDict(loc, pendingMetrics, 'emoji')['active-model']), exp.emoji);
  }

  const nonOrchMetrics = { ...baseMetrics, isOrchestrator: false, activeModelName: '', activeModelRole: 'none' };
  const expectedOff = {
    'zh-tw': { text: '協調器: 關閉', emoji: '🪄 關閉' },
    'zh-cn': { text: '协调器: 关闭', emoji: '🪄 关闭' },
    'us': { text: 'Orchestrator: off', emoji: '🪄 off' },
    'jp': { text: 'Orchestrator: オフ', emoji: '🪄 オフ' }
  };
  for (const [loc, exp] of Object.entries(expectedOff)) {
    const textRaw = buildI18nDict(loc, nonOrchMetrics, 'text')['active-model'];
    const emojiRaw = buildI18nDict(loc, nonOrchMetrics, 'emoji')['active-model'];
    assert.equal(stripAnsi(textRaw), exp.text);
    assert.equal(stripAnsi(emojiRaw), exp.emoji);
    assert.equal(textRaw.includes('\x1b[38;2;255;125;175m'), true);
    assert.equal(emojiRaw.includes('\x1b[38;2;255;125;175m'), true);
  }
});

test('E2E CLI statusline-quota.mjs renders active-model under Orchestrator and red off otherwise', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-e2e-orch-'));
  try {
    const fakeHome = path.join(sandbox, 'home');
    const convId = 'conv-e2e-orch';
    const trPath = path.join(fakeHome, '.gemini', 'antigravity-cli', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');
    fs.mkdirSync(path.join(fakeHome, '.gemini', 'antigravity-cli'), { recursive: true });
    fs.mkdirSync(path.dirname(trPath), { recursive: true });

    fs.writeFileSync(
      path.join(fakeHome, '.gemini', 'antigravity-cli', 'settings.json'),
      JSON.stringify({
        orchestrator: {
          planner: 'gemini-4-carbon-high',
          executor: 'gemini-4-hydrogen-high'
        },
        ui: {
          language: 'zh-tw',
          footer: {
            items: ['model-name', 'active-model'],
            itemStyles: { 'active-model': 'emoji' }
          }
        }
      }),
      'utf8'
    );

    fs.writeFileSync(trPath, JSON.stringify({
      step_index: 1,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      created_at: '2026-11-23T13:15:00Z',
      model: 'gemini-4-hydrogen-high'
    }) + '\n', 'utf8');

    const orchRes = await runStatusline({
      conversation_id: convId,
      model: { display_name: 'Orchestrator (Carbon)' },
      transcript_path: trPath,
      terminal_width: 160
    }, fakeHome);
    assert.equal(orchRes.code, 0);
    assert.equal(
      stripAnsi(orchRes.stdout).trim(),
      '模型: Orchestrator (Carbon) │ 🪄 執行者 → Gemini 4 Hydrogen (High)'
    );

    // 切換為一般模型時，active-model 一律以紅色顯示關閉
    const normalRes = await runStatusline({
      conversation_id: convId,
      model: { display_name: 'Gemini 4 Neon (High)' },
      transcript_path: trPath,
      terminal_width: 160
    }, fakeHome);
    assert.equal(normalRes.code, 0);
    assert.equal(stripAnsi(normalRes.stdout).trim(), '模型: Gemini 4 Neon (High) │ 🪄 關閉');
    assert.equal(normalRes.stdout.includes('\x1b[38;2;255;125;175m'), true);

    // 確認 probes-and-gating：當 footerItems 不含 active-model 時不探測
    const gated = await extractMetricsAsync(
      { conversation_id: convId, model: { display_name: 'Orchestrator (Carbon)' }, transcript_path: trPath },
      'zh-tw',
      'Orchestrator (Carbon)',
      null,
      {},
      { remaining_percentage: 100, refreshes_in: '' },
      { totalInput: 0, contextSize: 1000000, effectiveTokenCeiling: 256000, usedPctNum: 0 },
      { remaining_percentage: 100, refreshes_in: '' },
      { footerItems: ['model-name'], homeDir: fakeHome }
    );
    assert.equal(gated.isOrchestrator, false);
    assert.equal(gated.activeModelName, '');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('resolves MODEL_PLACEHOLDER wrappers and preserves worker executor models across cache and transcript', async () => {
  const cache = {
    modelLimits: {
      modelplaceholderm537: {
        slug: 'gemini-pro-orchestrator-neon',
        model: 'MODEL_PLACEHOLDER_M537',
        displayName: 'Orchestrator (Neon)'
      },
      modelplaceholderm668: {
        slug: 'gemini-pro-orchestrator-g1-pro',
        model: 'MODEL_PLACEHOLDER_M668',
        displayName: 'Orchestrator (Argon)'
      },
      modelplaceholderm669: {
        slug: 'gemini-flash-worker-agy',
        model: 'MODEL_PLACEHOLDER_M669',
        displayName: 'Gemini 4 Hydrogen (Orchestrator)'
      },
      modelplaceholderm525: {
        slug: 'gemini-4-hydrogen-high',
        model: 'MODEL_PLACEHOLDER_M525',
        displayName: 'Gemini 4 Hydrogen (High)'
      }
    }
  };

  // 外層 Orchestrator placeholder 透過 modelLimits 正確辨識，但不將 worker 誤判為外層包裝
  assert.equal(isOrchestratorModelName('MODEL_PLACEHOLDER_M537', cache), true);
  assert.equal(isOrchestratorModelName('MODEL_PLACEHOLDER_M668', cache), true);
  assert.equal(isOrchestratorModelName('MODEL_PLACEHOLDER_M525', cache), false);
  assert.equal(resolveOrchestratorWrapperDisplayName('MODEL_PLACEHOLDER_M537', cache), 'Orchestrator (Neon)');
  assert.equal(resolveOrchestratorWrapperDisplayName('MODEL_PLACEHOLDER_M668', cache), 'Orchestrator (Argon)');
  assert.equal(resolveOrchestratorWrapperDisplayName('MODEL_PLACEHOLDER_M669', cache), '');
  assert.equal(resolveOrchestratorWrapperDisplayName('MODEL_PLACEHOLDER_M525', cache), '');
  assert.equal(isOrchestratorWorkerModel('gemini-flash-worker-agy'), true);
  assert.equal(isOrchestratorWorkerModel('MODEL_PLACEHOLDER_M669', cache), true);
  assert.equal(isOrchestratorWorkerModel('Gemini 4 Hydrogen (Orchestrator)'), true);
  assert.equal(isOrchestratorModelName('gemini-flash-worker-agy', cache), false);
  assert.equal(isOrchestratorModelName('MODEL_PLACEHOLDER_M669', cache), false);
  assert.equal(isOrchestratorModelName('Gemini 4 Hydrogen (Orchestrator)', cache), false);

  // formatRuntimeModelDisplayName 剝離具名 Worker 的 (Orchestrator) 尾綴並保留執行者歸類
  assert.equal(formatRuntimeModelDisplayName('MODEL_PLACEHOLDER_M669', cache), 'Gemini 4 Hydrogen');
  assert.equal(formatRuntimeModelDisplayName('gemini-flash-worker-agy', cache), 'Gemini 4 Hydrogen');
  assert.equal(formatRuntimeModelDisplayName('Gemini 4 Hydrogen (Orchestrator)'), 'Gemini 4 Hydrogen');
  assert.equal(classifyOrchestratorModelRole('gemini-flash-worker-agy', {}, cache), 'executor');
  assert.equal(classifyOrchestratorModelRole('MODEL_PLACEHOLDER_M669', {}, cache), 'executor');

  assert.equal(isOrchestratorSession({ model: { id: 'MODEL_PLACEHOLDER_M537' } }, {}, null, '', { cache }), true);

  const workerRes = await resolveActiveRuntimeModelAsync({
    meta: { conversation_id: 'conv-worker-1', model: { id: 'MODEL_PLACEHOLDER_M537' } },
    runtimeTelemetry: { modelDisplayName: 'Gemini 4 Hydrogen (Orchestrator)', model: 'MODEL_PLACEHOLDER_M669' },
    cache
  });
  assert.equal(workerRes.isOrchestrator, true);
  assert.equal(workerRes.modelName, 'Gemini 4 Hydrogen');
  assert.equal(workerRes.role, 'executor');
  assert.equal(workerRes.source, 'ls_cache');
});

test('loads CLI sessions.json without PLUGIN_DATA, falls back from oversized transcript_full.jsonl, and reads antigravity_state.pbtxt', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-rt-fixes-'));
  try {
    const convId = 'conv-cli-fallback';
    const cliDataDir = path.join(tmpHome, '.gemini', 'antigravity-cli', 'plugin_data', 'antigravity-cli-statusline');
    const logsDir = path.join(tmpHome, '.gemini', 'antigravity-cli', 'brain', convId, '.system_generated', 'logs');
    const stateDir = path.join(tmpHome, '.gemini', 'antigravity');
    fs.mkdirSync(cliDataDir, { recursive: true });
    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(stateDir, { recursive: true });

    // 1. CLI 獨立 sessions.json（未傳入 pluginDataDir 與 env.PLUGIN_DATA 時也能讀到）
    fs.writeFileSync(path.join(cliDataDir, 'sessions.json'), JSON.stringify({
      version: 1,
      sessions: {
        [convId]: {
          conversationId: convId,
          modelName: 'gemini-4-neon-xhigh',
          updatedAt: Date.parse('2026-11-23T14:00:00Z')
        }
      }
    }), 'utf8');

    const cliHookRes = await resolveActiveRuntimeModelAsync({
      meta: { conversation_id: convId, model: { display_name: 'Orchestrator (Neon)' } },
      homeDir: tmpHome,
      env: {}
    });
    assert.equal(cliHookRes.isOrchestrator, true);
    assert.equal(cliHookRes.source, 'hook');
    assert.equal(cliHookRes.modelName, 'Gemini 4 Neon (XHigh)');
    assert.equal(cliHookRes.role, 'planner');

    // 2. transcript_full.jsonl 尾端超過 64 KB 全為大型工具輸出時，退讓讀取同目錄精簡版 transcript.jsonl
    const fullPath = path.join(logsDir, 'transcript_full.jsonl');
    const compactPath = path.join(logsDir, 'transcript.jsonl');
    const hugePadding = 'x'.repeat(80 * 1024);
    fs.writeFileSync(fullPath, [
      JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', model: 'gemini-4-hydrogen-high', created_at: '2026-11-23T14:05:00Z' }),
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'GENERIC', content: hugePadding })
    ].join('\n'), 'utf8');
    fs.writeFileSync(compactPath, [
      JSON.stringify({ step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', model: 'gemini-4-hydrogen-high', created_at: '2026-11-23T14:05:00Z' }),
      JSON.stringify({ step_index: 2, source: 'MODEL', type: 'GENERIC', content: 'truncated' })
    ].join('\n'), 'utf8');

    const trFallbackRes = await resolveActiveRuntimeModelAsync({
      meta: {
        conversation_id: convId,
        model: { display_name: 'Orchestrator (Neon)' },
        transcript_path: fullPath
      },
      pluginDataDir: path.join(tmpHome, 'empty-plugin-data'),
      homeDir: tmpHome
    });
    assert.equal(trFallbackRes.isOrchestrator, true);
    assert.equal(trFallbackRes.source, 'transcript');
    assert.equal(trFallbackRes.modelName, 'Gemini 4 Hydrogen (High)');
    assert.equal(trFallbackRes.role, 'executor');

    // 僅存在超大 transcript_full.jsonl（> 64 KB、<= 256 KB）而無精簡版時，readLatestTranscriptModelAsync 亦能擴大視窗讀到
    fs.unlinkSync(compactPath);
    const expandedRead = await readLatestTranscriptModelAsync(fullPath);
    assert.equal(expandedRead.exists, true);
    assert.equal(expandedRead.model, 'gemini-4-hydrogen-high');

    // 3. antigravity_state.pbtxt 讀取與 appSelectedModel 辨識
    const cache = {
      modelLimits: {
        modelplaceholderm537: { slug: 'gemini-pro-orchestrator-neon', model: 'MODEL_PLACEHOLDER_M537', displayName: 'Orchestrator (Neon)' },
        modelplaceholderm525: { slug: 'gemini-4-hydrogen-high', model: 'MODEL_PLACEHOLDER_M525', displayName: 'Gemini 4 Hydrogen (High)' }
      }
    };
    const pbtxtPath = path.join(stateDir, 'antigravity_state.pbtxt');
    fs.writeFileSync(pbtxtPath, 'last_selected_agent_model: MODEL_PLACEHOLDER_M537\n', 'utf8');
    const selectedOrch = await readAppSelectedModelAsync(tmpHome);
    assert.equal(selectedOrch, 'MODEL_PLACEHOLDER_M537');

    const appOrchRes = await resolveActiveRuntimeModelAsync({
      meta: { conversation_id: 'conv-app-1', model: { id: 'MODEL_PLACEHOLDER_M532', display_name: 'Gemini 4 Neon (High)' } },
      runtimeTelemetry: { modelDisplayName: 'Gemini 4 Neon (High)', model: 'MODEL_PLACEHOLDER_M532' },
      appSelectedModel: selectedOrch,
      cache,
      homeDir: tmpHome,
      pluginDataDir: path.join(tmpHome, 'empty-plugin-data')
    });
    assert.equal(appOrchRes.isOrchestrator, true);
    assert.equal(appOrchRes.modelName, 'Gemini 4 Neon (High)');
    assert.equal(appOrchRes.role, 'planner');

    fs.writeFileSync(pbtxtPath, 'last_selected_agent_model: MODEL_PLACEHOLDER_M525\n', 'utf8');
    const selectedSingle = await readAppSelectedModelAsync(tmpHome);
    assert.equal(selectedSingle, 'MODEL_PLACEHOLDER_M525');
    const appSingleRes = await resolveActiveRuntimeModelAsync({
      meta: { conversation_id: 'conv-app-1', model: { id: 'MODEL_PLACEHOLDER_M525', display_name: 'Gemini 4 Hydrogen (High)' } },
      runtimeTelemetry: { modelDisplayName: 'Gemini 4 Hydrogen (High)', model: 'MODEL_PLACEHOLDER_M525' },
      appSelectedModel: selectedSingle,
      transcriptSummary: { exists: true, lastModel: 'gemini-4-hydrogen-high', hasOrchestratorSignal: true },
      cache,
      homeDir: tmpHome,
      pluginDataDir: path.join(tmpHome, 'empty-plugin-data')
    });
    assert.equal(appSingleRes.isOrchestrator, false);
    assert.equal(appSingleRes.role, 'none');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('resolveOrchestratorWrapperDisplayName dynamically reflects configured planner (Carbon, Argon, Claude) and ignores single models', () => {
  const cache = {
    modelLimits: {
      modelplaceholderm537: {
        slug: 'gemini-pro-orchestrator-neon',
        model: 'MODEL_PLACEHOLDER_M537',
        displayName: 'Orchestrator (Neon)'
      },
      modelplaceholderm670: {
        slug: 'gemini-4-carbon-high',
        model: 'MODEL_PLACEHOLDER_M670',
        displayName: 'Gemini 4 Carbon (High)'
      },
      modelplaceholderm418: {
        slug: 'gemini-4-argon-medium',
        model: 'MODEL_PLACEHOLDER_M418',
        displayName: 'Gemini 4 Argon (Medium)'
      }
    }
  };

  assert.equal(extractOrchestratorPlannerLabel({ model: 'gemini-4-carbon', effort: 'high' }, cache), 'Carbon');
  assert.equal(extractOrchestratorPlannerLabel({ modelId: 'gemini-4-argon', effort: 'medium' }, cache), 'Argon');
  assert.equal(extractOrchestratorPlannerLabel('gemini-4-argon', cache), 'Argon');
  assert.equal(extractOrchestratorPlannerLabel('argon', cache), 'Argon');
  assert.equal(extractOrchestratorPlannerLabel('claude-opus-5-5@default', cache), 'Claude Opus 5.5');
  assert.equal(extractOrchestratorPlannerLabel('MODEL_PLACEHOLDER_M670', cache), 'Carbon');
  assert.equal(extractOrchestratorPlannerLabel('MODEL_PLACEHOLDER_M418', cache), 'Argon');
  assert.equal(extractOrchestratorPlannerLabel('MODEL_PLACEHOLDER_M999', null), '');

  const plannerCases = [
    { settings: { orchestrator: { planner: { model: 'gemini-4-carbon', effort: 'high' } } }, expected: 'Orchestrator (Carbon)' },
    { settings: { orchestrator: { planner: { modelId: 'gemini-4-argon', effort: 'medium' } } }, expected: 'Orchestrator (Argon)' },
    { settings: { orchestrator: { planner: 'gemini-4-argon' } }, expected: 'Orchestrator (Argon)' },
    { settings: { orchestrator: { planner: 'argon' } }, expected: 'Orchestrator (Argon)' },
    { settings: { orchestrator: { planner: 'claude-opus-5-5@default' } }, expected: 'Orchestrator (Claude Opus 5.5)' }
  ];

  for (const wrapper of ['Orchestrator (Neon)', 'MODEL_PLACEHOLDER_M537']) {
    for (const tc of plannerCases) {
      assert.equal(
        resolveOrchestratorWrapperDisplayName(wrapper, cache, { settings: tc.settings }),
        tc.expected
      );
    }
    // 未知 placeholder 且無法解析 planner 時安全退讓回外層靜態名稱
    assert.equal(
      resolveOrchestratorWrapperDisplayName(wrapper, wrapper.startsWith('MODEL_') ? cache : null, { plannerModel: 'MODEL_PLACEHOLDER_M999' }),
      'Orchestrator (Neon)'
    );
  }

  // 非 Orchestrator 單一模型即使 settings.orchestrator 有設定也不可誤改
  assert.equal(
    resolveOrchestratorWrapperDisplayName('Gemini 4 Neon (High)', cache, {
      settings: { orchestrator: { planner: 'gemini-4-carbon-high' } }
    }),
    ''
  );
  assert.equal(
    resolveConfiguredPlannerRef(
      { orchestrator: { planner: 'gemini-4-argon' } },
      { orchestrator: { planner: 'gemini-4-carbon' } },
      'MODEL_PLACEHOLDER_M670'
    ),
    'gemini-4-argon'
  );
  assert.equal(
    resolveConfiguredPlannerRef(
      {},
      { orchestrator: { planner: 'gemini-4-carbon' } },
      'MODEL_PLACEHOLDER_M418'
    ),
    'MODEL_PLACEHOLDER_M418'
  );

  // plannerModel 為空字串或 MODEL_UNSPECIFIED 時不得遮蔽 settings / 2.0 退讓
  assert.equal(
    resolveOrchestratorWrapperDisplayName('Orchestrator (Neon)', cache, {
      plannerModel: '',
      settings: { orchestrator: { planner: { modelId: 'gemini-4-carbon', effort: 'high' } } }
    }),
    'Orchestrator (Carbon)'
  );
  assert.equal(
    resolveConfiguredPlannerRef(
      {},
      { orchestrator: { planner: 'gemini-4-carbon' } },
      'MODEL_UNSPECIFIED'
    ),
    'gemini-4-carbon'
  );

  // @default 變體後綴移除後應正確比對角色，且 resolvePlannerCatalogModelRef 僅在命中目錄時回傳
  assert.equal(
    classifyOrchestratorModelRole(
      'claude-opus-5-5',
      {
        orchestrator: {
          planner: { modelId: 'claude-opus-5-5@default', effort: 'high' },
          executor: { modelId: 'claude-haiku-4-5@default', effort: 'low' }
        }
      },
      cache
    ),
    'planner'
  );
  assert.equal(
    classifyOrchestratorModelRole(
      'claude-opus-5-5-thinking',
      {
        orchestrator: {
          planner: { modelId: 'claude-opus-5-5@default', effort: 'high' },
          executor: { modelId: 'claude-haiku-4-5@default', effort: 'low' }
        }
      },
      cache
    ),
    'planner'
  );
  assert.equal(
    resolvePlannerCatalogModelRef(
      { modelId: 'claude-opus-5-5@default', effort: 'high' },
      {
        modelLimits: {
          claudeopus55: { slug: 'claude-opus-5-5', model: 'MODEL_PLACEHOLDER_M601', displayName: 'Claude Opus 5.5', limit: 160000, maxTokens: 200000 }
        }
      }
    ),
    'MODEL_PLACEHOLDER_M601'
  );
  assert.equal(
    resolvePlannerCatalogModelRef({ modelId: 'gemini-4-carbon', effort: 'high' }, cache),
    ''
  );
});

test('readAppModelStateAsync reads orchestrator_model and orchestrator_executor_model from pbtxt and user_config.json', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-app-state-'));
  try {
    const stateDir = path.join(tmpHome, '.gemini', 'antigravity');
    const configDir = path.join(tmpHome, '.gemini', 'config');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(configDir, { recursive: true });

    const pbtxtPath = path.join(stateDir, 'antigravity_state.pbtxt');
    fs.writeFileSync(pbtxtPath, [
      'last_selected_agent_model: MODEL_PLACEHOLDER_M537',
      'user_settings {',
      '  orchestrator_model: MODEL_PLACEHOLDER_M670',
      '  orchestrator_executor_model: MODEL_PLACEHOLDER_M525',
      '}'
    ].join('\n'), 'utf8');

    const pbState = await readAppModelStateAsync(tmpHome);
    assert.deepEqual(pbState, {
      selectedModel: 'MODEL_PLACEHOLDER_M537',
      orchestratorModel: 'MODEL_PLACEHOLDER_M670',
      orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M525'
    });
    assert.equal(await readAppSelectedModelAsync(tmpHome), 'MODEL_PLACEHOLDER_M537');

    // 若 pbtxt 未填或為 MODEL_UNSPECIFIED，退讓讀取 user_config.json
    fs.writeFileSync(pbtxtPath, [
      'last_selected_agent_model: MODEL_PLACEHOLDER_M537',
      'user_settings {',
      '  orchestrator_model: MODEL_UNSPECIFIED',
      '}'
    ].join('\n'), 'utf8');
    fs.writeFileSync(path.join(configDir, 'user_config.json'), JSON.stringify({
      userSettings: {
        orchestratorModel: 'MODEL_PLACEHOLDER_M418',
        orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M525'
      }
    }), 'utf8');

    const cfgState = await readAppModelStateAsync(tmpHome);
    assert.deepEqual(cfgState, {
      selectedModel: 'MODEL_PLACEHOLDER_M537',
      orchestratorModel: 'MODEL_PLACEHOLDER_M418',
      orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M525'
    });
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('E2E CLI statusline-quota.mjs overrides static Orchestrator (Neon) with configured planner and routes 3p quota', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-e2e-planner-'));
  try {
    const fakeHome = path.join(sandbox, 'home');
    const cliDir = path.join(fakeHome, '.gemini', 'antigravity-cli');
    const tmpDir = path.join(fakeHome, '.gemini', 'tmp');
    fs.mkdirSync(cliDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    fs.writeFileSync(path.join(tmpDir, 'real_quota_cache.json'), JSON.stringify({
      updatedAt: Date.now(),
      modelPools: {
        modelplaceholderm537: 'gemini',
        orchestratorneon: 'gemini'
      },
      modelLimits: {
        modelplaceholderm537: {
          slug: 'gemini-pro-orchestrator-neon',
          model: 'MODEL_PLACEHOLDER_M537',
          displayName: 'Orchestrator (Neon)',
          limit: 512000,
          maxTokens: 1048576
        },
        claudeopus55: {
          slug: 'claude-opus-5-5',
          model: 'claude-opus-5-5',
          displayName: 'Claude Opus 5.5',
          limit: 160000,
          maxTokens: 200000
        }
      },
      shortTerm: {
        gemini: { remaining_percentage: 88, refreshes_in: '3h' },
        '3p': { remaining_percentage: 42, refreshes_in: '2h' }
      }
    }), 'utf8');

    const writeCliSettings = (planner) => {
      fs.writeFileSync(path.join(cliDir, 'settings.json'), JSON.stringify({
        orchestrator: {
          planner,
          executor: { model: 'gemini-4-hydrogen', effort: 'high' }
        },
        ui: {
          language: 'zh-tw',
          footer: { items: ['model-name', 'quota', 'token-count'] }
        }
      }), 'utf8');
    };

    const meta = {
      model: { id: 'MODEL_PLACEHOLDER_M537', display_name: 'Orchestrator (Neon)' },
      context_window: { total_input_tokens: 80000, total_output_tokens: 1000 },
      terminal_width: 200
    };

    writeCliSettings({ modelId: 'gemini-4-carbon', effort: 'high' });
    const carbonRes = await runStatusline(meta, fakeHome);
    assert.equal(carbonRes.code, 0);
    const carbonPlain = stripAnsi(carbonRes.stdout).trim();
    assert.ok(carbonPlain.includes('模型: Orchestrator (Carbon)'), carbonPlain);
    assert.ok(carbonPlain.includes('五小時可用: 88%'), carbonPlain);
    assert.ok(carbonPlain.includes('80.0k / 512.0k'), carbonPlain);

    writeCliSettings('gemini-4-argon');
    const argonRes = await runStatusline(meta, fakeHome);
    assert.equal(argonRes.code, 0);
    const argonPlain = stripAnsi(argonRes.stdout).trim();
    assert.ok(argonPlain.includes('模型: Orchestrator (Argon)'), argonPlain);
    assert.ok(argonPlain.includes('五小時可用: 88%'), argonPlain);
    assert.ok(argonPlain.includes('80.0k / 512.0k'), argonPlain);

    writeCliSettings({ modelId: 'claude-opus-5-5@default', effort: 'high' });
    const claudeRes = await runStatusline(meta, fakeHome);
    assert.equal(claudeRes.code, 0);
    const claudePlain = stripAnsi(claudeRes.stdout).trim();
    assert.ok(claudePlain.includes('模型: Orchestrator (Claude Opus 5.5)'), claudePlain);
    assert.ok(claudePlain.includes('五小時可用: 42%'), claudePlain);
    assert.ok(claudePlain.includes('80.0k / 160.0k'), claudePlain);

    // 4. agy CLI v1.5.10+ 僅更新頂層 settings.model = "Orchestrator (Carbon)"（無 settings.orchestrator）時，亦能覆寫 Neon
    fs.writeFileSync(path.join(cliDir, 'settings.json'), JSON.stringify({
      model: 'Orchestrator (Carbon)',
      ui: {
        language: 'zh-tw',
        footer: { items: ['model-name', 'quota', 'token-count'] }
      }
    }), 'utf8');
    const topModelRes = await runStatusline(meta, fakeHome);
    assert.equal(topModelRes.code, 0);
    assert.ok(stripAnsi(topModelRes.stdout).includes('模型: Orchestrator (Carbon)'), topModelRes.stdout);

    // 5. settings.model 為 MODEL_PLACEHOLDER_M667 / gemini-pro-orchestrator 時，能透過目錄或別名顯示 Carbon
    fs.writeFileSync(path.join(cliDir, 'settings.json'), JSON.stringify({
      model: 'gemini-pro-orchestrator',
      ui: { language: 'zh-tw', footer: { items: ['model-name'] } }
    }), 'utf8');
    const slugModelRes = await runStatusline(meta, fakeHome);
    assert.equal(slugModelRes.code, 0);
    assert.ok(stripAnsi(slugModelRes.stdout).includes('模型: Orchestrator (Carbon)'), slugModelRes.stdout);

    // 6. --model CLI 旗標明確指定 Orchestrator (Argon) 時，不得被 settings.model = Orchestrator (Carbon) 覆蓋
    fs.writeFileSync(path.join(cliDir, 'settings.json'), JSON.stringify({
      model: 'Orchestrator (Carbon)',
      ui: { language: 'zh-tw', footer: { items: ['model-name'] } }
    }), 'utf8');
    const cliOverrideRes = await runStatusline({
      ...meta,
      model: { id: 'Orchestrator (Argon)', display_name: 'Orchestrator (Argon)' }
    }, fakeHome);
    assert.equal(cliOverrideRes.code, 0);
    assert.ok(stripAnsi(cliOverrideRes.stdout).includes('模型: Orchestrator (Argon)'), cliOverrideRes.stdout);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('readAppModelStateAsync supports config.json with non-enumerable _meta and transcript tracks earlier plannerModel', async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-rt-cfg-'));
  try {
    const cfgDir = path.join(tmpHome, '.gemini', 'config');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify({
      userSettings: {
        orchestratorModel: 'MODEL_PLACEHOLDER_M670',
        orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M525'
      }
    }), 'utf8');

    const state = await readAppModelStateAsync(tmpHome);
    assert.deepEqual(state, {
      selectedModel: '',
      orchestratorModel: 'MODEL_PLACEHOLDER_M670',
      orchestratorExecutorModel: 'MODEL_PLACEHOLDER_M525'
    });
    assert.deepEqual(Object.keys(state), ['selectedModel', 'orchestratorModel', 'orchestratorExecutorModel']);
    assert.equal(state._meta.hasExplicitOrchestratorField, true);

    const trPath = path.join(tmpHome, 'transcript.jsonl');
    fs.writeFileSync(trPath, [
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-27T10:00:00Z',
        model: 'gemini-4-carbon-high',
        tool_calls: [{ name: 'exit_plan_mode', args: {} }]
      }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-27T10:01:00Z',
        model: 'gemini-flash-worker-agy'
      })
    ].join('\n'), 'utf8');
    const tr = await readLatestTranscriptModelAsync(trPath);
    assert.equal(tr.model, 'gemini-flash-worker-agy');
    assert.equal(tr.plannerModel, 'gemini-4-carbon-high');
    assert.equal(tr.hasOrchestratorSignal, true);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test('E2E CLI statusline-quota.mjs recovers planner from runtime transcript when settings.model stays Neon and rejects stale transcript', async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-e2e-runtime-planner-'));
  try {
    const fakeHome = path.join(sandbox, 'home');
    const cliDir = path.join(fakeHome, '.gemini', 'antigravity-cli');
    const convId = 'conv-runtime-carbon';
    const trDir = path.join(cliDir, 'brain', convId, '.system_generated', 'logs');
    fs.mkdirSync(trDir, { recursive: true });

    const settingsPath = path.join(cliDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      model: 'Orchestrator (Neon)',
      ui: { language: 'zh-tw', footer: { items: ['model-name'] } }
    }), 'utf8');
    const t0 = new Date(Date.now() - 10000);
    fs.utimesSync(settingsPath, t0, t0);

    const trPath = path.join(trDir, 'transcript.jsonl');
    fs.writeFileSync(trPath, [
      JSON.stringify({
        step_index: 1,
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        created_at: new Date().toISOString(),
        model: 'gemini-4-carbon-high',
        tool_calls: [{ name: 'exit_plan_mode', args: {} }]
      })
    ].join('\n'), 'utf8');

    const meta = {
      conversation_id: convId,
      model: { id: 'MODEL_PLACEHOLDER_M537', display_name: 'Orchestrator (Neon)' },
      terminal_width: 200
    };
    const freshRes = await runStatusline(meta, fakeHome);
    assert.equal(freshRes.code, 0);
    assert.ok(stripAnsi(freshRes.stdout).includes('模型: Orchestrator (Carbon)'), freshRes.stdout);

    // 若 settings.json 之後重新寫入 Neon（時間戳比舊 transcript 更新），不應被舊 Carbon 逐字稿污染
    const tFuture = new Date(Date.now() + 10000);
    fs.utimesSync(settingsPath, tFuture, tFuture);
    const staleRes = await runStatusline(meta, fakeHome);
    assert.equal(staleRes.code, 0);
    assert.ok(stripAnsi(staleRes.stdout).includes('模型: Orchestrator (Neon)'), staleRes.stdout);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
