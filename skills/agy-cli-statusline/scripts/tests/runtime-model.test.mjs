import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  classifyOrchestratorModelRole,
  formatRuntimeModelDisplayName,
  isOrchestratorModelName,
  isOrchestratorSession,
  readLatestTranscriptModelAsync,
  resolveActiveRuntimeModelAsync
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

test('active-model renders across all 4 locales (text & emoji) and auto-hides when not Orchestrator', () => {
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
    'zh-tw': { text: '實際模型: [思考] Gemini 4 Carbon (High)', emoji: '🧭 [思考] Gemini 4 Carbon (High)' },
    'zh-cn': { text: '实际模型: [思考] Gemini 4 Carbon (High)', emoji: '🧭 [思考] Gemini 4 Carbon (High)' },
    'us': { text: 'Active Model: [Think] Gemini 4 Carbon (High)', emoji: '🧭 [Think] Gemini 4 Carbon (High)' },
    'jp': { text: '実行モデル: [思考] Gemini 4 Carbon (High)', emoji: '🧭 [思考] Gemini 4 Carbon (High)' }
  };

  for (const [loc, exp] of Object.entries(expectedPlanner)) {
    assert.equal(stripAnsi(buildI18nDict(loc, baseMetrics, 'text')['active-model']), exp.text);
    assert.equal(stripAnsi(buildI18nDict(loc, baseMetrics, 'emoji')['active-model']), exp.emoji);
  }

  const executorMetrics = { ...baseMetrics, activeModelName: 'Gemini 4 Hydrogen (High)', activeModelRole: 'executor' };
  assert.equal(stripAnsi(buildI18nDict('zh-tw', executorMetrics, 'text')['active-model']), '實際模型: [快速] Gemini 4 Hydrogen (High)');
  assert.equal(stripAnsi(buildI18nDict('us', executorMetrics, 'emoji')['active-model']), '🧭 [Fast] Gemini 4 Hydrogen (High)');

  const pendingMetrics = { ...baseMetrics, activeModelName: '', activeModelRole: 'pending' };
  assert.equal(stripAnsi(buildI18nDict('zh-tw', pendingMetrics, 'text')['active-model']), '實際模型: 待命');

  const nonOrchMetrics = { ...baseMetrics, isOrchestrator: false, activeModelName: '', activeModelRole: 'none' };
  assert.equal(buildI18nDict('zh-tw', nonOrchMetrics, 'text')['active-model'], '');
  assert.equal(buildI18nDict('zh-tw', nonOrchMetrics, 'emoji')['active-model'], '');
});

test('E2E CLI statusline-quota.mjs renders active-model under Orchestrator and hides it otherwise', async () => {
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
      '模型: Orchestrator (Carbon) │ 🧭 [快速] Gemini 4 Hydrogen (High)'
    );

    // 切換為一般模型時，active-model 應自動隱藏且不留下多餘分隔線
    const normalRes = await runStatusline({
      conversation_id: convId,
      model: { display_name: 'Gemini 4 Neon (High)' },
      transcript_path: trPath,
      terminal_width: 160
    }, fakeHome);
    assert.equal(normalRes.code, 0);
    assert.equal(stripAnsi(normalRes.stdout).trim(), '模型: Gemini 4 Neon (High)');

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
