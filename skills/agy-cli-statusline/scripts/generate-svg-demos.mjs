import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildI18nDict,
  preprocessAdjacentItems,
  renderBarGraph
} from './statusline-quota.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');

const questionsFilePath = path.resolve(__dirname, '../resources/questions.json');
const questionsData = JSON.parse(fsSync.readFileSync(questionsFilePath, 'utf8'));

// =============================================================================
// 1. Accurate Antigravity CLI Logo (12x10 pixel grid, 50 colored blocks)
// Extracted verbatim from actual agy CLI binary & terminal runtime execution
// =============================================================================
const LOGO_GRID = [
  [null, null, null, null, null, '#f2922e', '#f07236', null, null, null, null, null],
  [null, null, null, null, '#dbb131', '#f6912e', '#f37337', '#f0583b', null, null, null, null],
  [null, null, null, '#9ec345', '#b5b43e', '#e2993d', '#f67a34', '#f86a35', '#ef5442', null, null, null],
  [null, null, null, '#86c64e', '#75b45e', '#cc954d', '#ef7947', '#e16652', '#e14f59', null, null, null],
  [null, null, '#7cc251', '#71c25c', '#5ca98f', '#5c91b3', '#8373b0', '#746fc3', '#995da8', '#9c5b97', null, null],
  [null, null, '#80c654', '#54b881', '#4097de', null, null, '#4a7ee4', '#706ece', '#8f64b4', null, null],
  [null, null, '#61c37d', '#43aeab', null, null, null, null, '#4a80ea', '#6c73d8', null, null],
  [null, '#6dc694', '#62bad5', '#47a8dc', null, null, null, null, '#3d89fb', '#4a81f0', '#6579e1', null],
  [null, '#6bc7a3', '#64b6f6', null, null, null, null, null, null, '#3886fb', '#4881f4', null],
  ['#67b9f4', '#64b6f6', null, null, null, null, null, null, null, null, '#3883f9', '#3d85fc']
];

function generateLogoSvg(startX = 44, startY = 48, bw = 6, bh = 6, step = 7) {
  const rects = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 12; c++) {
      const color = LOGO_GRID[r][c];
      if (color) {
        rects.push(`    <rect x="${startX + c * step}" y="${startY + r * step}" width="${bw}" height="${bh}" rx="1" fill="${color}"/>`);
      }
    }
  }
  return rects.join('\n');
}

// =============================================================================
// 2. ANSI to SVG tspan Converter
// =============================================================================
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ansiToTspans(ansiLine) {
  const regex = /\x1b\[([0-9;]+)m/g;
  let lastIndex = 0;
  let currentColor = '#c9d1d9';
  let isBold = false;
  const tspans = [];

  let match;
  while ((match = regex.exec(ansiLine)) !== null) {
    const rawText = ansiLine.substring(lastIndex, match.index);
    if (rawText) {
      const escaped = escapeXml(rawText);
      const boldAttr = isBold ? ' font-weight="700"' : '';
      tspans.push(`<tspan fill="${currentColor}"${boldAttr}>${escaped}</tspan>`);
    }
    const code = match[1];
    if (code === '0') {
      currentColor = '#c9d1d9';
      isBold = false;
    } else if (code === '1') {
      isBold = true;
    } else if (code === '90') {
      currentColor = '#6e7681';
    } else if (code.startsWith('38;2;')) {
      const parts = code.split(';').slice(2).map(Number);
      currentColor = '#' + parts.map(p => p.toString(16).padStart(2, '0')).join('');
    }
    lastIndex = regex.lastIndex;
  }
  const remaining = ansiLine.substring(lastIndex);
  if (remaining) {
    const escaped = escapeXml(remaining);
    const boldAttr = isBold ? ' font-weight="700"' : '';
    tspans.push(`<tspan fill="${currentColor}"${boldAttr}>${escaped}</tspan>`);
  }
  return tspans.join('');
}

// =============================================================================
// 3. User-Specified Statusline Sorting & Item Styles
// [e:model-name,e:account-email,e:plan-tier,e:sandbox-status,n,e:agent-profile,
// agent-state,subagents,artifacts,pending-input,background-tasks,tool-confirmation,n,n,
// context-used,context-used-bar,token-count,token-count-bar,n,
// quota,quota-bar,quota-reset-countdown,quota-reset-time,n,
// quota-weekly,quota-weekly-bar,quota-weekly-countdown,quota-weekly-reset-time,n,
// quota-argon,quota-argon-bar,quota-argon-countdown,quota-argon-reset-time,n,n,
// vcs-dirty,vcs-type,e:git-branch,n,
// e:project-path,project-full-path,n,
// e:mode,e:conversation-id,e:memory-usage,cli-version]
// =============================================================================
const USER_SORTED_ITEMS = [
  'model-name', 'account-email', 'plan-tier', 'sandbox-status', 'n',
  'agent-profile', 'agent-state', 'subagents', 'artifacts', 'pending-input', 'background-tasks', 'tool-confirmation', 'n', 'n',
  'context-used', 'context-used-bar', 'token-count', 'token-count-bar', 'n',
  'quota', 'quota-bar', 'quota-reset-countdown', 'quota-reset-time', 'n',
  'quota-weekly', 'quota-weekly-bar', 'quota-weekly-countdown', 'quota-weekly-reset-time', 'n',
  'quota-argon', 'quota-argon-bar', 'quota-argon-countdown', 'quota-argon-reset-time', 'n', 'n',
  'vcs-dirty', 'vcs-type', 'git-branch', 'n',
  'project-path', 'project-full-path', 'n',
  'mode', 'conversation-id', 'memory-usage', 'cli-version'
];

const USER_ITEM_STYLES = {
  'model-name': 'emoji',
  'account-email': 'emoji',
  'plan-tier': 'emoji',
  'sandbox-status': 'emoji',
  'agent-profile': 'emoji',
  'git-branch': 'emoji',
  'project-path': 'emoji',
  'mode': 'emoji',
  'conversation-id': 'emoji',
  'memory-usage': 'emoji'
};

function renderStatusRows(items, activeDict, itemStyles) {
  const processedItems = preprocessAdjacentItems(items, itemStyles, 'text');
  const rows = [];
  let currentRow = '';

  for (const item of processedItems) {
    if (item === 'n' || item === 'newline') {
      if (currentRow !== '') {
        rows.push(currentRow);
        currentRow = '';
      } else {
        rows.push(' ');
      }
      continue;
    }
    const text = activeDict[item];
    if (!text) continue;
    if (currentRow === '') {
      currentRow = text;
    } else {
      currentRow += ` \x1b[90m│\x1b[0m ${text}`;
    }
  }
  if (currentRow !== '') rows.push(currentRow);
  return rows;
}

// =============================================================================
// 4. Telemetry Scenarios for Idle and Active States
// =============================================================================
function getScenarios(lang) {
  const isZhTw = lang === 'zh-tw';
  const isZhCn = lang === 'zh-cn';
  const isJp = lang === 'jp';

  const common = {
    fallbackModel: 'Gemini 3.1 Pro (High)',
    agentProfileName: 'Default',
    mode: 'Default',
    accountEmail: 'anandydy529@gmail.com',
    planTier: 'Google AI Pro',
    projectName: 'antigravity-cli-statusline',
    projectFullPath: '~/Project/antigravity-cli-statusline',
    vcsType: 'git',
    gitBranch: 'main',
    cliVersion: 'v1.4.12',
    conversationIdShort: '557d1ccd',
    sandboxEnabled: false,
    sandboxAllowNet: false,
    sandboxStatusVal: isZhTw ? '關閉' : (isZhCn ? '关闭' : (isJp ? 'オフ' : 'off'))
  };

  const metricsIdle = {
    ...common,
    agentState: 'idle',
    contextColor: '\x1b[38;2;87;202;255m',
    usedPct: '0.0%',
    contextBarVal: renderBarGraph(0, 10, '\x1b[38;2;87;202;255m'),
    tokenCount: '\x1b[38;2;87;202;255m0\x1b[0m / 1.0M',
    tokenBarVal: renderBarGraph(0, 10, '\x1b[38;2;87;202;255m'),
    quotaColor: '\x1b[38;2;87;202;255m',
    quotaVal: '100%',
    quotaBarVal: renderBarGraph(100, 10, '\x1b[38;2;87;202;255m'),
    countdownVal: '5h 00m',
    quotaResetTimeVal: '03:22',
    weeklyQuotaColor: '\x1b[38;2;87;202;255m',
    weeklyQuotaVal: '100%',
    weeklyQuotaBarVal: renderBarGraph(100, 10, '\x1b[38;2;87;202;255m'),
    weeklyCountdownVal: '7d 00h',
    weeklyResetTimeVal: '07/09 03:22',
    argonQuotaColor: '\x1b[38;2;87;202;255m',
    argonQuotaVal: '100%',
    argonQuotaBarVal: renderBarGraph(100, 10, '\x1b[38;2;87;202;255m'),
    argonCountdownVal: '24h 00m',
    argonResetTimeVal: '07/03 03:22',
    toolConfirmPending: false,
    pendingInputCount: 0,
    backgroundTasksCount: 0,
    subagentsCount: 0,
    artifactsCount: 0,
    vcsDirtyFlag: false,
    vcsDirtyLabel: isZhTw ? '✓ 無變更' : (isZhCn ? '✓ 无变更' : (isJp ? '✓ 変更なし' : '✓ no changes')),
    memUsage: '204MB'
  };

  const metricsActive = {
    ...common,
    agentState: 'working',
    contextColor: '\x1b[38;2;87;202;255m',
    usedPct: '18.5%',
    contextBarVal: renderBarGraph(18.5, 10, '\x1b[38;2;87;202;255m'),
    tokenCount: '\x1b[38;2;87;202;255m185k\x1b[0m / 1.0M',
    tokenBarVal: renderBarGraph(18.5, 10, '\x1b[38;2;87;202;255m'),
    quotaColor: '\x1b[38;2;87;202;255m',
    quotaVal: '86%',
    quotaBarVal: renderBarGraph(86, 10, '\x1b[38;2;87;202;255m'),
    countdownVal: '4h 32m',
    quotaResetTimeVal: '03:49',
    weeklyQuotaColor: '\x1b[38;2;87;202;255m',
    weeklyQuotaVal: '96%',
    weeklyQuotaBarVal: renderBarGraph(96, 10, '\x1b[38;2;87;202;255m'),
    weeklyCountdownVal: '6d 18h',
    weeklyResetTimeVal: '07/08 05:06',
    argonQuotaColor: '\x1b[38;2;87;202;255m',
    argonQuotaVal: '100%',
    argonQuotaBarVal: renderBarGraph(100, 10, '\x1b[38;2;87;202;255m'),
    argonCountdownVal: '23h 59m',
    argonResetTimeVal: '07/02 08:30',
    toolConfirmPending: false,
    pendingInputCount: 0,
    backgroundTasksCount: 1,
    subagentsCount: 2,
    artifactsCount: 3,
    vcsDirtyFlag: true,
    vcsDirtyLabel: isZhTw ? '✘ 未提交 (+3)' : (isZhCn ? '✘ 未提交 (+3)' : (isJp ? '✘ 未コミット (+3)' : '✘ uncommitted (+3)')),
    memUsage: '288MB'
  };

  return { metricsIdle, metricsActive };
}

// =============================================================================
// 4.5. Wizard Metadata for Category Pagination (Questions 1/5 ~ 5/5)
// =============================================================================
const WIZARD_META = {
  'zh-tw': {
    localeLocked: '已鎖定顯示語系：繁體中文 (zh-tw)',
    header: '選擇要顯示的狀態列指標（五大分類分頁精靈 1/5 ~ 5/5）：',
    pagers: [
      '⎿ 分頁進度：[ 第 1 / 5 頁 ] · 已選取 4 項指標',
      '⎿ 分頁進度：[ 第 2 / 5 頁 ] · 累計選取 18 項指標',
      '⎿ 分頁進度：[ 第 3 / 5 頁 ] · 累計選取 22 項指標',
      '⎿ 分頁進度：[ 第 4 / 5 頁 ] · 累計選取 27 項指標',
      '★ 全部五大分類共 36 項指標已全數選取完成！'
    ],
    navHints: [
      'Space 勾選/取消 · Enter 進入下一分頁 (2/5 額度計費) · 終端機分頁免滾動零截斷',
      'Space 勾選/取消 · Enter 進入下一分頁 (3/5 脈絡權杖) · 終端機分頁免滾動零截斷',
      'Space 勾選/取消 · Enter 進入下一分頁 (4/5 工作區) · 終端機分頁免滾動零截斷',
      'Space 勾選/取消 · Enter 進入下一分頁 (5/5 系統任務) · 終端機分頁免滾動零截斷',
      'Space 勾選/取消 · Enter 確認並前往手動排序 (Write-in) · 零截斷勾選完畢'
    ]
  },
  'zh-cn': {
    localeLocked: '已锁定显示语言：简体中文 (zh-cn)',
    header: '选择要显示的状态栏指标（五大分类分页向导 1/5 ~ 5/5）：',
    pagers: [
      '⎿ 分页进度：[ 第 1 / 5 页 ] · 已选取 4 项指标',
      '⎿ 分页进度：[ 第 2 / 5 页 ] · 累计选取 18 项指标',
      '⎿ 分页进度：[ 第 3 / 5 页 ] · 累计选取 22 项指标',
      '⎿ 分页进度：[ 第 4 / 5 页 ] · 累计选取 27 项指标',
      '★ 全部五大分类共 36 项指标已全数选取完成！'
    ],
    navHints: [
      'Space 勾选/取消 · Enter 进入下一分页 (2/5 额度计费) · 终端分页免滚动零截断',
      'Space 勾选/取消 · Enter 进入下一分页 (3/5 上下文令牌) · 终端分页免滚动零截断',
      'Space 勾选/取消 · Enter 进入下一分页 (4/5 工作区) · 终端分页免滚动零截断',
      'Space 勾选/取消 · Enter 进入下一分页 (5/5 系统任务) · 终端分页免滚动零截断',
      'Space 勾选/取消 · Enter 确认并前往手动排序 (Write-in) · 零截断勾选完毕'
    ]
  },
  'jp': {
    localeLocked: '表示言語を固定：日本語 (jp)',
    header: '表示する指標を選択（5 大分類ウィザード 1/5 ~ 5/5）：',
    pagers: [
      '⎿ ページ進捗：[ 第 1 / 5 ページ ] · 4 項目を選択中',
      '⎿ ページ進捗：[ 第 2 / 5 ページ ] · 累計 18 項目を選択中',
      '⎿ ページ進捗：[ 第 3 / 5 ページ ] · 累計 22 項目を選択中',
      '⎿ ページ進捗：[ 第 4 / 5 ページ ] · 累計 27 項目を選択中',
      '★ 全 5 カテゴリ 36 指標の一括選択が完了しました！'
    ],
    navHints: [
      'Space 選択/解除 · Enter 次のカテゴリ (2/5 クォータ) · スクロール不要',
      'Space 選択/解除 · Enter 次のカテゴリ (3/5 コンテキスト) · スクロール不要',
      'Space 選択/解除 · Enter 次のカテゴリ (4/5 ワークスペース) · スクロール不要',
      'Space 選択/解除 · Enter 次のカテゴリ (5/5 システム) · スクロール不要',
      'Space 選択/解除 · Enter 決定してカスタム並べ替えへ (Write-in)'
    ]
  },
  'us': {
    localeLocked: 'Locked display locale: English (us)',
    header: 'Select statusline indicators (Category Wizard 1/5 ~ 5/5):',
    pagers: [
      '⎿ Wizard pager: [ Page 1 / 5 ] · 4 metrics selected',
      '⎿ Wizard pager: [ Page 2 / 5 ] · 18 metrics selected cumulatively',
      '⎿ Wizard pager: [ Page 3 / 5 ] · 22 metrics selected cumulatively',
      '⎿ Wizard pager: [ Page 4 / 5 ] · 27 metrics selected cumulatively',
      '★ All 36 indicators across 5 categories successfully selected!'
    ],
    navHints: [
      'Space Toggle · Enter Next category (2/5 Quota) · Eliminates scroll truncation',
      'Space Toggle · Enter Next category (3/5 Context) · Eliminates scroll truncation',
      'Space Toggle · Enter Next category (4/5 Workspace) · Eliminates scroll truncation',
      'Space Toggle · Enter Next category (5/5 System) · Eliminates scroll truncation',
      'Space Toggle · Enter Confirm & proceed to custom order (Write-in)'
    ]
  }
};

// =============================================================================
// 5. Build Complete SVG for a Specific Language
// =============================================================================
export function generateDemoSvg(lang) {
  const isZhTw = lang === 'zh-tw';
  const isZhCn = lang === 'zh-cn';
  const isJp = lang === 'jp';
  const { metricsIdle, metricsActive } = getScenarios(lang);

  const dictIdle = buildI18nDict(lang, metricsIdle, 'text', USER_ITEM_STYLES);
  const dictActive = buildI18nDict(lang, metricsActive, 'text', USER_ITEM_STYLES);

  const rowsIdle = renderStatusRows(USER_SORTED_ITEMS, dictIdle, USER_ITEM_STYLES);
  const rowsActive = renderStatusRows(USER_SORTED_ITEMS, dictActive, USER_ITEM_STYLES);

  function renderSvgRows(rows) {
    return rows.map((r, idx) => {
      const y = 351 + idx * 19;
      if (!r || r.trim() === '') {
        return `  <!-- Empty row ${idx} from n,n -->\n  <text x="24" y="${y}"> </text>`;
      }
      const tspans = ansiToTspans(r);
      return `  <text x="24" y="${y}">${tspans}</text>`;
    }).join('\n');
  }

  const svgRowsIdle = renderSvgRows(rowsIdle);
  const svgRowsActive = renderSvgRows(rowsActive);

  // Accessible Label & Captions (9 frames: language -> wizard 1/5..5/5 -> write-in -> reload -> live)
  const ariaLabel = isZhTw
    ? 'Antigravity 命令列介面（CLI）狀態列互動設定與動態遙測展示：從執行 /antigravity-cli-statusline:agy-cli-statusline 指令、語系選擇、五大分類分頁精靈（Question 1/5 至 5/5 全五層展示）、自訂排序 Write-in 到 11 列完整狀態列即時運作。'
    : (isZhCn
      ? 'Antigravity 命令行界面（CLI）状态栏交互设置与动态遥测展示：从执行 /antigravity-cli-statusline:agy-cli-statusline 指令、语言选择、五大分类分页向导（Question 1/5 至 5/5 全五层展示）、自定义排序 Write-in 到 11 列完整状态栏即时运作。'
      : (isJp
        ? 'Antigravity CLI ステータスライン対話型設定と動的テレメトリデモ：/antigravity-cli-statusline:agy-cli-statusline の実行、言語選択、5大分類ウィザード（Question 1/5〜5/5の全5階層）、カスタム並び順 Write-in、11列ステータスラインのリアルタイム稼働まで。'
        : 'Antigravity CLI statusline interactive setup and live telemetry demo: from running /antigravity-cli-statusline:agy-cli-statusline command, language selection, 5-category wizard (all 5 layers Question 1/5 to 5/5), custom order Write-in, to full 11-row live statusline telemetry.'));

  const captions = isZhTw
    ? [
      '① 執行設定指令與語系選擇 · /antigravity-cli-statusline:agy-cli-statusline 啟動精靈',
      '② 指標分頁勾選 (1/5 模型與代理) · 勾選 model-name, agent-profile, agent-state, mode',
      '③ 指標分頁勾選 (2/5 額度計費帳號) · 勾選 5小時/每週/Argon 額度、長條圖與時間等 14 項',
      '④ 指標分頁勾選 (3/5 脈絡與權杖) · 勾選脈絡消耗比例、脈絡長條圖、精確權杖數與長條圖',
      '⑤ 指標分頁勾選 (4/5 工作區與版控) · 勾選專案短/完整路徑、Git 分支、未提交變更與 VCS 類型',
      '⑥ 指標分頁勾選 (5/5 系統與背景任務) · 勾選 RAM 記憶體、CLI 版本、沙盒、子代理與產出檔案等 9 項',
      '⑦ 手動排序與個別樣式 Write-in · 支援 e: 指定 Emoji 圖示、n/n,n 換行排版',
      '⑧ 設定部署完成與即時熱重載 · 三層 settings.json 同步，立即呈現 11 列自訂狀態列',
      '⑨ 完整狀態列即時遙測運作 · 依指定排序即時追蹤長條圖、權杖用量與子代理'
    ]
    : (isZhCn
      ? [
        '① 执行设置指令与语言选择 · 执行 /antigravity-cli-statusline:agy-cli-statusline 启动向导',
        '② 指标分页勾选 (1/5 模型与代理) · 勾选 model-name, agent-profile, agent-state, mode',
        '③ 指标分页勾选 (2/5 额度计费账号) · 勾选 5小时/每周/Argon 额度、长条图与时间等 14 项',
        '④ 指标分页勾选 (3/5 上下文与令牌) · 勾选上下文消耗比例、上下文长条图、精确令牌数与长条图',
        '⑤ 指标分页勾选 (4/5 工作区与版控) · 勾选项目短/完整路径、Git 分支、未提交变更与 VCS 类型',
        '⑥ 指标分页勾选 (5/5 系统与后台任务) · 勾选 RAM 内存、CLI 版本、沙箱、子代理与产出文件等 9 项',
        '⑦ 手动排序与个别样式 Write-in · 支持 e: 指定 Emoji 图标、n/n,n 换行排版',
        '⑧ 设置部署与即时热重载 · 三层 settings.json 同步，立即呈现 11 列自订状态栏',
        '⑨ 完整状态栏即时遥测运作 · 依指定排序即时追踪长条图、令牌用量与子代理'
      ]
      : (isJp
        ? [
          '① 設定コマンド実行と言語選択 · /antigravity-cli-statusline:agy-cli-statusline でウィザード起動',
          '② 指標ウィザード (1/5 モデルとエージェント) · model-name, agent-profile, agent-state, mode を選択',
          '③ 指標ウィザード (2/5 クォータ・請求) · 5時間/週間/Argon クォータ、バー、時刻など14項目',
          '④ 指標ウィザード (3/5 コンテキスト・トークン) · コンテキスト使用率・バー、トークン数・バーを選択',
          '⑤ 指標ウィザード (4/5 ワークスペース・VCS) · プロジェクトパス、Gitブランチ、未コミット変更、VCS種別',
          '⑥ 指標ウィザード (5/5 システム・タスク) · メモリ、CLIバージョン、会話ID、サブエージェント等9項目',
          '⑦ 並び順・スタイル直接入力 · e: 接頭辞で絵文字指定、n/n,n で自在に改行',
          '⑧ 設定の反映と即時ホットリロード · 3 層 settings.json 同期、11 列レイアウト即時適用',
          '⑨ リアルタイムテレメトリ稼働 · 指定順序でプログレスバー、トークン、サブ代理を追跡'
        ]
        : [
          '① Run Command & Select Language · Launch wizard with /antigravity-cli-statusline:agy-cli-statusline',
          '② Indicator Selection (1/5 Model & Agent) · Select model-name, agent-profile, agent-state, mode',
          '③ Indicator Selection (2/5 Quota & Billing) · Select 5-hr/weekly/Argon quotas, bars & reset times (14 items)',
          '④ Indicator Selection (3/5 Context & Tokens) · Select context used %, context bar, token count & bar',
          '⑤ Indicator Selection (4/5 Workspace & VCS) · Select project path, full path, Git branch, dirty status & VCS type',
          '⑥ Indicator Selection (5/5 System & Tasks) · Select RAM usage, CLI version, sandbox, subagents & artifacts (9 items)',
          '⑦ Custom Order & Styles Write-in · Supports e: for Emoji, text styles, and n/n,n line breaks',
          '⑧ Config Deployment & Hot Reload · Sync 3-tier settings.json & activate 11-row statusline',
          '⑨ Live Telemetry Statusline in Action · Real-time tracking of bars, tokens, and subagents'
        ]));

  // Default Minimal CLI Footer (prior to Statusline deployment in Frames 0, 1, 2)
  const defaultFooterSvg = `  <!-- Default CLI Single-Line Footer (prior to Statusline deployment) -->
  <line x1="24" y1="535" x2="936" y2="535" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="554" fill="#6e7681">? for shortcuts</text>
  <text x="936" y="554" fill="#6e7681" text-anchor="end">Gemini 3.8 Flash (Low)</text>`;

  const statuslineDividerSvg = `  <!-- Statusline Divider Line -->
  <line x1="24" y1="330" x2="936" y2="330" stroke="#383e5a" stroke-width="1"/>`;

  // Interactive Terminal Content per Frame
  const termContentF0 = isZhTw
    ? `  <!-- Command Trigger & Question 1: Language selection -->
  <text x="24" y="154" fill="#57caff">&gt;</text>
  <text x="40" y="154" fill="#e6edf3">/antigravity-cli-statusline:agy-cli-statusline</text>
  <rect class="cur" x="382" y="141" width="8" height="15" fill="#e6edf3"/>
  <line x1="24" y1="168" x2="936" y2="168" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="196" fill="#57caff" font-weight="700">?</text>
  <text x="44" y="196" fill="#e6edf3" font-weight="700">選擇顯示語系 / Select Display Language</text>
  <text x="44" y="220" fill="#39c5cf" font-weight="700">● 繁體中文 (zh-tw)</text>
  <text x="44" y="242" fill="#8b949e">○ 简体中文 (zh-cn)</text>
  <text x="44" y="264" fill="#8b949e">○ English (us)</text>
  <text x="44" y="286" fill="#8b949e">○ 日本語 (jp)</text>
  <text x="24" y="318" fill="#6e7681">↑/↓ 選擇語系 · Enter 送出 · 本技能自動鎖定後續所有對話語系</text>
  <text x="24" y="344" fill="#8b949e">ℹ️  第一階段問卷：選定語系後，後續所有設定步驟、提示與狀態列皆以此語系呈現</text>`
    : (isZhCn
      ? `  <!-- Command Trigger & Question 1: Language selection -->
  <text x="24" y="154" fill="#57caff">&gt;</text>
  <text x="40" y="154" fill="#e6edf3">/antigravity-cli-statusline:agy-cli-statusline</text>
  <rect class="cur" x="382" y="141" width="8" height="15" fill="#e6edf3"/>
  <line x1="24" y1="168" x2="936" y2="168" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="196" fill="#57caff" font-weight="700">?</text>
  <text x="44" y="196" fill="#e6edf3" font-weight="700">选择显示语言 / Select Display Language</text>
  <text x="44" y="220" fill="#8b949e">○ 繁體中文 (zh-tw)</text>
  <text x="44" y="242" fill="#39c5cf" font-weight="700">● 简体中文 (zh-cn)</text>
  <text x="44" y="264" fill="#8b949e">○ English (us)</text>
  <text x="44" y="286" fill="#8b949e">○ 日本語 (jp)</text>
  <text x="24" y="318" fill="#6e7681">↑/↓ 选择语言 · Enter 确认 · 本技能自动锁定后续所有对话语言</text>
  <text x="24" y="344" fill="#8b949e">ℹ️  第一阶段问卷：选定语言后，后续所有设置步骤、提示与状态栏皆以此语言呈现</text>`
      : (isJp
        ? `  <!-- Command Trigger & Question 1: Language selection -->
  <text x="24" y="154" fill="#57caff">&gt;</text>
  <text x="40" y="154" fill="#e6edf3">/antigravity-cli-statusline:agy-cli-statusline</text>
  <rect class="cur" x="382" y="141" width="8" height="15" fill="#e6edf3"/>
  <line x1="24" y1="168" x2="936" y2="168" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="196" fill="#57caff" font-weight="700">?</text>
  <text x="44" y="196" fill="#e6edf3" font-weight="700">表示言語の選択 / Select Display Language</text>
  <text x="44" y="220" fill="#8b949e">○ 繁體中文 (zh-tw)</text>
  <text x="44" y="242" fill="#8b949e">○ 简体中文 (zh-cn)</text>
  <text x="44" y="264" fill="#8b949e">○ English (us)</text>
  <text x="44" y="286" fill="#39c5cf" font-weight="700">● 日本語 (jp)</text>
  <text x="24" y="318" fill="#6e7681">↑/↓ 選択 · Enter 決定 · 以降のすべての対話で選択言語を維持します</text>
  <text x="24" y="344" fill="#8b949e">ℹ️  第1段階アンケート：言語選択後、以降のすべての設定手順とステータスラインに適用されます</text>`
        : `  <!-- Command Trigger & Question 1: Language selection -->
  <text x="24" y="154" fill="#57caff">&gt;</text>
  <text x="40" y="154" fill="#e6edf3">/antigravity-cli-statusline:agy-cli-statusline</text>
  <rect class="cur" x="382" y="141" width="8" height="15" fill="#e6edf3"/>
  <line x1="24" y1="168" x2="936" y2="168" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="196" fill="#57caff" font-weight="700">?</text>
  <text x="44" y="196" fill="#e6edf3" font-weight="700">Select Display Language / 選擇顯示語系</text>
  <text x="44" y="220" fill="#8b949e">○ 繁體中文 (zh-tw)</text>
  <text x="44" y="242" fill="#8b949e">○ 简体中文 (zh-cn)</text>
  <text x="44" y="264" fill="#39c5cf" font-weight="700">● English (us)</text>
  <text x="44" y="286" fill="#8b949e">○ 日本語 (jp)</text>
  <text x="24" y="318" fill="#6e7681">↑/↓ Navigate · Enter Confirm · Locks display language for all steps</text>
  <text x="24" y="344" fill="#8b949e">ℹ️  Step 1 Question: All subsequent wizard prompts and statusline items will use this locale</text>`));

  const meta = WIZARD_META[lang] || WIZARD_META['us'];
  const cats = questionsData[lang]?.categories || questionsData['us'].categories;

  function renderCategoryWizardFrame(catIndex) {
    const cat = cats[catIndex];
    const catTitle = escapeXml(`Question ${catIndex + 1}/5: ${cat.question}`);
    const options = cat.options;
    const pagerText = escapeXml(meta.pagers[catIndex]);
    const navHint = escapeXml(meta.navHints[catIndex]);

    const startY = 226;
    const stepY = 18;
    const pagerY = startY + options.length * stepY + 20;
    const navY = pagerY + 22;

    const optionLines = options.map((opt, i) => {
      const y = startY + i * stepY;
      return `  <text x="44" y="${y}" fill="#39c5cf">[✓] ${escapeXml(opt)}</text>`;
    }).join('\n');

    const pagerFill = catIndex === 4 ? '#5cdb6d' : '#8b949e';

    return `  <!-- Category Wizard ${catIndex + 1}/5 (${escapeXml(cat.name)}) -->
  <text x="24" y="158" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="158" fill="#c9d1d9">${escapeXml(meta.localeLocked)}</text>
  <text x="370" y="158" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="390" y="158" fill="#8b949e">Node.js v20.18.0 detected</text>
  <text x="24" y="184" fill="#57caff" font-weight="700">?</text>
  <text x="44" y="184" fill="#e6edf3" font-weight="700">${escapeXml(meta.header)}</text>
  <text x="44" y="206" fill="#ffd427" font-weight="700">${catTitle}</text>
${optionLines}
  <text x="44" y="${pagerY}" fill="${pagerFill}">${pagerText}</text>
  <text x="24" y="${navY}" fill="#6e7681">${navHint}</text>`;
  }

  const termContentF1 = renderCategoryWizardFrame(0);
  const termContentF2 = renderCategoryWizardFrame(1);
  const termContentF3 = renderCategoryWizardFrame(2);
  const termContentF4 = renderCategoryWizardFrame(3);
  const termContentF5 = renderCategoryWizardFrame(4);

  const termContentF6 = isZhTw
    ? `  <!-- 3-Column Reference Table & Question 3: Manual Order & Styles Write-in -->
  <text x="24" y="156" fill="#8b949e">📋</text>
  <text x="44" y="156" fill="#c9d1d9" font-weight="700">目前已選取的狀態列指標（共 36 項）</text>
  <text x="290" y="156" fill="#8b949e">— 於 Write-in 輸入自訂順序（e: 為 Emoji，n 為換行，n,n 為空白行）：</text>
  
  <text x="24" y="174" fill="#383e5a">┌────┬────────────────────────┬────┬────────────────────────┬────┬────────────────────────┐</text>
  <text x="24" y="192" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 1</tspan> │ 🤖 模型 (model-name)   │ <tspan fill="#57caff" font-weight="700">13</tspan> │ ✨ Argon 額度 (argon)  │ <tspan fill="#57caff" font-weight="700">25</tspan> │ 🔀 Git 分支 (branch)   │</text>
  <text x="24" y="210" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 2</tspan> │ 🪪 代理 (profile)      │ <tspan fill="#57caff" font-weight="700">14</tspan> │ ✨ Argon 長條 (bar)    │ <tspan fill="#57caff" font-weight="700">26</tspan> │ 🔍 未提交變更 (dirty)  │</text>
  <text x="24" y="228" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 3</tspan> │ ⚡ 狀態 (agent-state)  │ <tspan fill="#57caff" font-weight="700">15</tspan> │ ⏱️ Argon 倒數 (cd)     │ <tspan fill="#57caff" font-weight="700">27</tspan> │ 🗃️ 版控類型 (vcs-type) │</text>
  <text x="24" y="246" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 4</tspan> │ ⚙️ 模式 (mode)         │ <tspan fill="#57caff" font-weight="700">16</tspan> │ ⏰ Argon 時間 (time)   │ <tspan fill="#57caff" font-weight="700">28</tspan> │ 💾 記憶體量 (memory)   │</text>
  <text x="24" y="264" fill="#383e5a">└────┴────────────────────────┴────┴────────────────────────┴────┴────────────────────────┘</text>

  <text x="24" y="290" fill="#57caff" font-weight="700">?</text>
  <text x="44" y="290" fill="#e6edf3" font-weight="700">請設定狀態列顯示順序與個別樣式：</text>
  <text x="44" y="312" fill="#8b949e">○ 略過，使用原勾選順序啟用全部指標（預設文字樣式）</text>
  <text x="44" y="334" fill="#39c5cf" font-weight="700">● 手動排序與設定樣式（請在下方「Write-in...」欄位中填寫）</text>
  <text x="44" y="356" fill="#ffd427" font-weight="700">Write-in &gt; </text>
  <text x="135" y="356" fill="#57caff">[e:model-name,e:account-email,e:plan-tier,e:sandbox-status,n,</text>
  <text x="44" y="376" fill="#57caff">  e:agent-profile,agent-state,subagents,artifacts,pending-input,background-tasks,tool-confirmation,n,n,</text>
  <text x="44" y="396" fill="#57caff">  context-used,context-used-bar,token-count,token-count-bar,n,quota,quota-bar,quota-reset-countdown,...]</text>
  <rect class="cur" x="830" y="384" width="8" height="15" fill="#57caff"/>
  <text x="24" y="422" fill="#6e7681">依使用者指定排序與圖示前綴，將自動編排為 11 列高資訊密度狀態列</text>`
    : (isZhCn
      ? `  <!-- 3-Column Reference Table & Question 3: Manual Order & Styles Write-in -->
  <text x="24" y="156" fill="#8b949e">📋</text>
  <text x="44" y="156" fill="#c9d1d9" font-weight="700">目前已选取的状态栏指标（共 36 项）</text>
  <text x="290" y="156" fill="#8b949e">— 于 Write-in 输入自定义顺序（e: 为 Emoji，n 为换行，n,n 为空白行）：</text>
  
  <text x="24" y="174" fill="#383e5a">┌────┬────────────────────────┬────┬────────────────────────┬────┬────────────────────────┐</text>
  <text x="24" y="192" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 1</tspan> │ 🤖 模型 (model-name)   │ <tspan fill="#57caff" font-weight="700">13</tspan> │ ✨ Argon 额度 (argon)  │ <tspan fill="#57caff" font-weight="700">25</tspan> │ 🔀 Git 分支 (branch)   │</text>
  <text x="24" y="210" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 2</tspan> │ 🪪 代理 (profile)      │ <tspan fill="#57caff" font-weight="700">14</tspan> │ ✨ Argon 长条 (bar)    │ <tspan fill="#57caff" font-weight="700">26</tspan> │ 🔍 未提交变更 (dirty)  │</text>
  <text x="24" y="228" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 3</tspan> │ ⚡ 状态 (agent-state)  │ <tspan fill="#57caff" font-weight="700">15</tspan> │ ⏱️ Argon 倒数 (cd)     │ <tspan fill="#57caff" font-weight="700">27</tspan> │ 🗃️ 版控类型 (vcs-type) │</text>
  <text x="24" y="246" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 4</tspan> │ ⚙️ 模式 (mode)         │ <tspan fill="#57caff" font-weight="700">16</tspan> │ ⏰ Argon 时间 (time)   │ <tspan fill="#57caff" font-weight="700">28</tspan> │ 💾 内存用量 (memory)   │</text>
  <text x="24" y="264" fill="#383e5a">└────┴────────────────────────┴────┴────────────────────────┴────┴────────────────────────┘</text>

  <text x="24" y="290" fill="#57caff" font-weight="700">?</text>
  <text x="44" y="290" fill="#e6edf3" font-weight="700">请设置状态栏显示顺序与个别样式：</text>
  <text x="44" y="312" fill="#8b949e">○ 跳过，使用原勾选顺序启用全部指标（默认文本样式）</text>
  <text x="44" y="334" fill="#39c5cf" font-weight="700">● 手动排序与设定样式（请在下方“Write-in...”栏位中填写）</text>
  <text x="44" y="356" fill="#ffd427" font-weight="700">Write-in &gt; </text>
  <text x="135" y="356" fill="#57caff">[e:model-name,e:account-email,e:plan-tier,e:sandbox-status,n,</text>
  <text x="44" y="376" fill="#57caff">  e:agent-profile,agent-state,subagents,artifacts,pending-input,background-tasks,tool-confirmation,n,n,</text>
  <text x="44" y="396" fill="#57caff">  context-used,context-used-bar,token-count,token-count-bar,n,quota,quota-bar,quota-reset-countdown,...]</text>
  <rect class="cur" x="830" y="384" width="8" height="15" fill="#57caff"/>
  <text x="24" y="422" fill="#6e7681">依使用者指定排序与图标前缀，将自动编排为 11 列高信息密度状态栏</text>`
      : (isJp
        ? `  <!-- 3-Column Reference Table & Question 3: Manual Order & Styles Write-in -->
  <text x="24" y="156" fill="#8b949e">📋</text>
  <text x="44" y="156" fill="#c9d1d9" font-weight="700">現在選択中の指標（全 36 項目）</text>
  <text x="280" y="156" fill="#8b949e">— 下の Write-in に並び順を入力（e: で絵文字、n で改行、n,n で空行）：</text>
  
  <text x="24" y="174" fill="#383e5a">┌────┬────────────────────────┬────┬────────────────────────┬────┬────────────────────────┐</text>
  <text x="24" y="192" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 1</tspan> │ 🤖 モデル (model-name) │ <tspan fill="#57caff" font-weight="700">13</tspan> │ ✨ Argon 残量 (argon)  │ <tspan fill="#57caff" font-weight="700">25</tspan> │ 🔀 Git 分岐 (branch)   │</text>
  <text x="24" y="210" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 2</tspan> │ 🪪 プロファイル (prof) │ <tspan fill="#57caff" font-weight="700">14</tspan> │ ✨ Argon バー (bar)    │ <tspan fill="#57caff" font-weight="700">26</tspan> │ 🔍 未コミット (dirty)  │</text>
  <text x="24" y="228" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 3</tspan> │ ⚡ 状態 (agent-state)  │ <tspan fill="#57caff" font-weight="700">15</tspan> │ ⏱️ Argon 残 (cd)       │ <tspan fill="#57caff" font-weight="700">27</tspan> │ 🗃️ 版管理種別 (vcs)    │</text>
  <text x="24" y="246" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 4</tspan> │ ⚙️ モード (mode)       │ <tspan fill="#57caff" font-weight="700">16</tspan> │ ⏰ Argon 時刻 (time)   │ <tspan fill="#57caff" font-weight="700">28</tspan> │ 💾 メモリ (memory)     │</text>
  <text x="24" y="264" fill="#383e5a">└────┴────────────────────────┴────┴────────────────────────┴────┴────────────────────────┘</text>

  <text x="24" y="290" fill="#57caff" font-weight="700">?</text>
  <text x="44" y="290" fill="#e6edf3" font-weight="700">ステータスラインの表示順序と個別スタイルを設定してください：</text>
  <text x="44" y="312" fill="#8b949e">○ スキップ、選択順で全指標を有効化（デフォルトテキスト形式）</text>
  <text x="44" y="334" fill="#39c5cf" font-weight="700">● 手動で並び順とスタイルを設定（下の「Write-in...」欄に入力）</text>
  <text x="44" y="356" fill="#ffd427" font-weight="700">Write-in &gt; </text>
  <text x="135" y="356" fill="#57caff">[e:model-name,e:account-email,e:plan-tier,e:sandbox-status,n,</text>
  <text x="44" y="376" fill="#57caff">  e:agent-profile,agent-state,subagents,artifacts,pending-input,background-tasks,tool-confirmation,n,n,</text>
  <text x="44" y="396" fill="#57caff">  context-used,context-used-bar,token-count,token-count-bar,n,quota,quota-bar,quota-reset-countdown,...]</text>
  <rect class="cur" x="830" y="384" width="8" height="15" fill="#57caff"/>
  <text x="24" y="422" fill="#6e7681">指定された順序とスタイルに基づき、11 列の高密度ステータスラインを自動構築</text>`
        : `  <!-- 3-Column Reference Table & Question 3: Manual Order & Styles Write-in -->
  <text x="24" y="156" fill="#8b949e">📋</text>
  <text x="44" y="156" fill="#c9d1d9" font-weight="700">Currently Selected Metrics (Total 36)</text>
  <text x="330" y="156" fill="#8b949e">— Enter custom order below (e: for Emoji, n for newline):</text>
  
  <text x="24" y="174" fill="#383e5a">┌────┬────────────────────────┬────┬────────────────────────┬────┬────────────────────────┐</text>
  <text x="24" y="192" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 1</tspan> │ 🤖 Model (model-name)  │ <tspan fill="#57caff" font-weight="700">13</tspan> │ ✨ Argon Quota (argon) │ <tspan fill="#57caff" font-weight="700">25</tspan> │ 🔀 Git Branch (branch) │</text>
  <text x="24" y="210" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 2</tspan> │ 🪪 Profile (profile)   │ <tspan fill="#57caff" font-weight="700">14</tspan> │ ✨ Argon Bar (bar)     │ <tspan fill="#57caff" font-weight="700">26</tspan> │ 🔍 Dirty State (dirty) │</text>
  <text x="24" y="228" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 3</tspan> │ ⚡ State (agent-state) │ <tspan fill="#57caff" font-weight="700">15</tspan> │ ⏱️ Argon CD (cd)       │ <tspan fill="#57caff" font-weight="700">27</tspan> │ 🗃️ VCS Type (vcs-type) │</text>
  <text x="24" y="246" fill="#c9d1d9">│ <tspan fill="#57caff" font-weight="700"> 4</tspan> │ ⚙️ Mode (mode)         │ <tspan fill="#57caff" font-weight="700">16</tspan> │ ⏰ Argon Time (time)   │ <tspan fill="#57caff" font-weight="700">28</tspan> │ 💾 Memory (memory)     │</text>
  <text x="24" y="264" fill="#383e5a">└────┴────────────────────────┴────┴────────────────────────┴────┴────────────────────────┘</text>

  <text x="24" y="290" fill="#57caff" font-weight="700">?</text>
  <text x="44" y="290" fill="#e6edf3" font-weight="700">Please set the statusline display order and individual styles:</text>
  <text x="44" y="312" fill="#8b949e">○ Skip, keep current selection order (default text labels)</text>
  <text x="44" y="334" fill="#39c5cf" font-weight="700">● Manual order &amp; styles (fill in the &apos;Write-in...&apos; box below)</text>
  <text x="44" y="356" fill="#ffd427" font-weight="700">Write-in &gt; </text>
  <text x="135" y="356" fill="#57caff">[e:model-name,e:account-email,e:plan-tier,e:sandbox-status,n,</text>
  <text x="44" y="376" fill="#57caff">  e:agent-profile,agent-state,subagents,artifacts,pending-input,background-tasks,tool-confirmation,n,n,</text>
  <text x="44" y="396" fill="#57caff">  context-used,context-used-bar,token-count,token-count-bar,n,quota,quota-bar,quota-reset-countdown,...]</text>
  <rect class="cur" x="830" y="384" width="8" height="15" fill="#57caff"/>
  <text x="24" y="422" fill="#6e7681">Compiles custom array into an 11-row high-density statusline with auto-merged bars</text>`));

  const termContentF7 = isZhTw
    ? `  <!-- Step 4: Configuration Deployed & Hot Reloaded -->
  <text x="24" y="156" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="156" fill="#c9d1d9">已更新三層設定檔：~/.gemini/antigravity-cli/settings.json</text>
  <text x="24" y="180" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="180" fill="#c9d1d9">跨平台 Hook 腳本部署完成，已同步註冊 ~/.gemini/trusted_hooks.json</text>
  <text x="24" y="204" fill="#57caff" font-weight="700">★</text>
  <text x="44" y="204" fill="#57caff" font-weight="700">狀態列已熱重載生效！已套用自訂 11 列排版與 Emoji/Text 混合風格</text>
  <text x="44" y="226" fill="#8b949e">⎿ 46 個指標與排版單元已解析 · 自動合併相鄰額度與長條圖 · 支援 24 位元真實色彩</text>
  <line x1="24" y1="294" x2="936" y2="294" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="314" fill="#57caff">&gt;</text>
  <text x="40" y="314" fill="#e6edf3">Antigravity CLI 狀態列已就緒，隨時監控系統指標與工作區檔案變更。</text>
  <rect class="cur" x="522" y="301" width="8" height="15" fill="#e6edf3"/>`
    : (isZhCn
      ? `  <!-- Step 4: Configuration Deployed & Hot Reloaded -->
  <text x="24" y="156" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="156" fill="#c9d1d9">已更新三层配置文件：~/.gemini/antigravity-cli/settings.json</text>
  <text x="24" y="180" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="180" fill="#c9d1d9">跨平台 Hook 脚本部署完成，已同步注册 ~/.gemini/trusted_hooks.json</text>
  <text x="24" y="204" fill="#57caff" font-weight="700">★</text>
  <text x="44" y="204" fill="#57caff" font-weight="700">状态栏已热重载生效！已应用自定义 11 列排版与 Emoji/Text 混合风格</text>
  <text x="44" y="226" fill="#8b949e">⎿ 46 个指标与排版单元已解析 · 自动合并相邻额度与长条图 · 支持 24 位真彩色</text>
  <line x1="24" y1="294" x2="936" y2="294" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="314" fill="#57caff">&gt;</text>
  <text x="40" y="314" fill="#e6edf3">Antigravity CLI 状态栏已就绪，随时监控系统指标与工作区文件变更。</text>
  <rect class="cur" x="522" y="301" width="8" height="15" fill="#e6edf3"/>`
      : (isJp
        ? `  <!-- Step 4: Configuration Deployed & Hot Reloaded -->
  <text x="24" y="156" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="156" fill="#c9d1d9">3 層の設定ファイルを更新：~/.gemini/antigravity-cli/settings.json</text>
  <text x="24" y="180" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="180" fill="#c9d1d9">フックを配置し ~/.gemini/trusted_hooks.json への登録を完了</text>
  <text x="24" y="204" fill="#57caff" font-weight="700">★</text>
  <text x="44" y="204" fill="#57caff" font-weight="700">ステータスラインが即時反映！11 列のカスタム並び順と混合スタイルを適用</text>
  <text x="44" y="226" fill="#8b949e">⎿ 46 の指標・改行要素を解決 · 隣接バーの自動統合 · 24-bit フルカラー表示</text>
  <line x1="24" y1="294" x2="936" y2="294" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="314" fill="#57caff">&gt;</text>
  <text x="40" y="314" fill="#e6edf3">Antigravity CLI ステータスライン稼働中。ワークスペースを監視しています。</text>
  <rect class="cur" x="582" y="301" width="8" height="15" fill="#e6edf3"/>`
        : `  <!-- Step 4: Configuration Deployed & Hot Reloaded -->
  <text x="24" y="156" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="156" fill="#c9d1d9">Synchronized 3-tier config: ~/.gemini/antigravity-cli/settings.json</text>
  <text x="24" y="180" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="180" fill="#c9d1d9">Cross-platform hook deployed &amp; registered in ~/.gemini/trusted_hooks.json</text>
  <text x="24" y="204" fill="#57caff" font-weight="700">★</text>
  <text x="44" y="204" fill="#57caff" font-weight="700">Statusline hot reloaded! Applied custom 11-row layout with mixed Emoji/Text</text>
  <text x="44" y="226" fill="#8b949e">⎿ 46 metrics &amp; layout tokens resolved · Auto-merged adjacent bars · 24-bit truecolor</text>
  <line x1="24" y1="294" x2="936" y2="294" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="314" fill="#57caff">&gt;</text>
  <text x="40" y="314" fill="#e6edf3">Antigravity CLI statusline active. Ready to monitor workspace and telemetry.</text>
  <rect class="cur" x="614" y="301" width="8" height="15" fill="#e6edf3"/>`));

  const termContentF8 = isZhTw
    ? `  <!-- Step 5: Live Task Execution & Dynamic Telemetry Update -->
  <text x="24" y="156" fill="#57caff">&gt;</text>
  <text x="40" y="156" fill="#e6edf3">執行完整自動化測試套件：npm test</text>
  <text x="24" y="180" fill="#57caff">●</text>
  <text x="44" y="180" fill="#e6edf3">正在調度 2 個子代理並行執行單元測試...</text>
  <text x="44" y="202" fill="#8b949e">⎿ statusline-quota.test.mjs  (14 passing, 10-block bar &amp; i18n verified)</text>
  <text x="44" y="222" fill="#8b949e">⎿ configure-statusline.test.mjs  (12 passing, bracket &amp; itemStyles verified)</text>
  <text x="24" y="248" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="248" fill="#c9d1d9">所有測試套件全數通過！狀態列即時串流：脈絡消耗 18.5%、權杖 185k、額度 86%。</text>
  <text x="44" y="270" fill="#ffd427">⎿ 底部狀態列即時反映子代理、產出檔案與 Git 未提交變更狀態</text>
  <line x1="24" y1="294" x2="936" y2="294" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="314" fill="#57caff">&gt;</text>
  <rect class="cur" x="40" y="301" width="8" height="15" fill="#e6edf3"/>`
    : (isZhCn
      ? `  <!-- Step 5: Live Task Execution & Dynamic Telemetry Update -->
  <text x="24" y="156" fill="#57caff">&gt;</text>
  <text x="40" y="156" fill="#e6edf3">运行完整自动化测试套件：npm test</text>
  <text x="24" y="180" fill="#57caff">●</text>
  <text x="44" y="180" fill="#e6edf3">正在调度 2 个子代理并行执行单元测试...</text>
  <text x="44" y="202" fill="#8b949e">⎿ statusline-quota.test.mjs  (14 passing, 10-block bar &amp; i18n verified)</text>
  <text x="44" y="222" fill="#8b949e">⎿ configure-statusline.test.mjs  (12 passing, bracket &amp; itemStyles verified)</text>
  <text x="24" y="248" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="248" fill="#c9d1d9">所有测试套件全数通过！状态栏即时串流：上下文消耗 18.5%、令牌 185k、额度 86%。</text>
  <text x="44" y="270" fill="#ffd427">⎿ 底部状态栏即时反映子代理、产出文件与 Git 未提交变更状态</text>
  <line x1="24" y1="294" x2="936" y2="294" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="314" fill="#57caff">&gt;</text>
  <rect class="cur" x="40" y="301" width="8" height="15" fill="#e6edf3"/>`
      : (isJp
        ? `  <!-- Step 5: Live Task Execution & Dynamic Telemetry Update -->
  <text x="24" y="156" fill="#57caff">&gt;</text>
  <text x="40" y="156" fill="#e6edf3">自動テストスイートを実行：npm test</text>
  <text x="24" y="180" fill="#57caff">●</text>
  <text x="44" y="180" fill="#e6edf3">2 つのサブ代理を並行起動しユニットテストを実行中...</text>
  <text x="44" y="202" fill="#8b949e">⎿ statusline-quota.test.mjs  (14 passing, 10 分割バー &amp; 多言語検証済)</text>
  <text x="44" y="222" fill="#8b949e">⎿ configure-statusline.test.mjs  (12 passing, 括弧 &amp; itemStyles 検証済)</text>
  <text x="24" y="248" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="248" fill="#c9d1d9">テスト全合格！ステータスライン即時更新：コンテキスト 18.5%、トークン 185k、残量 86%。</text>
  <text x="44" y="270" fill="#ffd427">⎿ 画面下部でサブ代理数、成果物、Git 未コミット変更のテレメトリが連動</text>
  <line x1="24" y1="294" x2="936" y2="294" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="314" fill="#57caff">&gt;</text>
  <rect class="cur" x="40" y="301" width="8" height="15" fill="#e6edf3"/>`
        : `  <!-- Step 5: Live Task Execution & Dynamic Telemetry Update -->
  <text x="24" y="156" fill="#57caff">&gt;</text>
  <text x="40" y="156" fill="#e6edf3">Run comprehensive test suite: npm test</text>
  <text x="24" y="180" fill="#57caff">●</text>
  <text x="44" y="180" fill="#e6edf3">Dispatching 2 subagents in parallel to execute unit test runners...</text>
  <text x="44" y="202" fill="#8b949e">⎿ statusline-quota.test.mjs  (14 passing, 10-block bar &amp; i18n verified)</text>
  <text x="44" y="222" fill="#8b949e">⎿ configure-statusline.test.mjs  (12 passing, bracket &amp; itemStyles verified)</text>
  <text x="24" y="248" fill="#5cdb6d" font-weight="700">✓</text>
  <text x="44" y="248" fill="#c9d1d9">All test suites passed! Live telemetry: context 18.5%, tokens 185k, 5-hr quota 86%.</text>
  <text x="44" y="270" fill="#ffd427">⎿ Footer statusline instantly reflects active subagents, outputs, and dirty git state</text>
  <line x1="24" y1="294" x2="936" y2="294" stroke="#383e5a" stroke-width="1"/>
  <text x="24" y="314" fill="#57caff">&gt;</text>
  <rect class="cur" x="40" y="301" width="8" height="15" fill="#e6edf3"/>`));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" role="img" aria-label="${escapeXml(ariaLabel)}" xml:space="preserve">
<style>
  text { font: 12.5px ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace; white-space: pre; }
  .cap { font: 15.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-weight: 600; }
  .cur { animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  .f { opacity: 0; }
  @keyframes f0 {
    0%, 11.10% { opacity: 1; }
    11.11%, 99.99% { opacity: 0; }
    100% { opacity: 1; }
  }
  .f0 { opacity: 1; animation: f0 36.0s infinite; }

  @keyframes f1 {
    0%, 11.10% { opacity: 0; }
    11.11%, 22.21% { opacity: 1; }
    22.22%, 100% { opacity: 0; }
  }
  .f1 { animation: f1 36.0s infinite; }

  @keyframes f2 {
    0%, 22.21% { opacity: 0; }
    22.22%, 33.32% { opacity: 1; }
    33.33%, 100% { opacity: 0; }
  }
  .f2 { animation: f2 36.0s infinite; }

  @keyframes f3 {
    0%, 33.32% { opacity: 0; }
    33.33%, 44.43% { opacity: 1; }
    44.44%, 100% { opacity: 0; }
  }
  .f3 { animation: f3 36.0s infinite; }

  @keyframes f4 {
    0%, 44.43% { opacity: 0; }
    44.44%, 55.54% { opacity: 1; }
    55.55%, 100% { opacity: 0; }
  }
  .f4 { animation: f4 36.0s infinite; }

  @keyframes f5 {
    0%, 55.54% { opacity: 0; }
    55.55%, 66.65% { opacity: 1; }
    66.66%, 100% { opacity: 0; }
  }
  .f5 { animation: f5 36.0s infinite; }

  @keyframes f6 {
    0%, 66.65% { opacity: 0; }
    66.66%, 77.76% { opacity: 1; }
    77.77%, 100% { opacity: 0; }
  }
  .f6 { animation: f6 36.0s infinite; }

  @keyframes f7 {
    0%, 77.76% { opacity: 0; }
    77.77%, 88.87% { opacity: 1; }
    88.88%, 100% { opacity: 0; }
  }
  .f7 { animation: f7 36.0s infinite; }

  @keyframes f8 {
    0%, 88.87% { opacity: 0; }
    88.88%, 99.99% { opacity: 1; }
    100% { opacity: 0; }
  }
  .f8 { animation: f8 36.0s infinite; }
</style>

<defs>
  <!-- Exact Antigravity CLI Logo (12x10 pixel grid, 50 colored blocks) -->
  <g id="agy-logo">
${generateLogoSvg(44, 48, 6, 6, 7)}
  </g>
</defs>

<!-- Terminal Window Container -->
<rect width="960" height="640" rx="10" fill="#282c34"/>
<!-- Window Header Border -->
<rect x=".5" y=".5" width="959" height="639" rx="10" fill="none" stroke="#383e5a"/>

<!-- Window Traffic Light Buttons -->
<circle cx="18" cy="18" r="5.5" fill="#ff5f56"/>
<circle cx="38" cy="18" r="5.5" fill="#ffbd2e"/>
<circle cx="58" cy="18" r="5.5" fill="#27c93f"/>
<text x="480" y="22" fill="#8b949e" text-anchor="middle" style="font-size:12px; font-weight:500;">📁 agy</text>

<!-- Antigravity Banner Area -->
<use href="#agy-logo"/>
<text x="148" y="62" fill="#57caff" font-weight="700">Antigravity CLI 1.4.12</text>
<text x="148" y="80" fill="#c9d1d9">anandydy529@gmail.com (Google AI Pro)</text>
<text x="148" y="98" fill="#8b949e">Gemini 3.1 Pro (High)</text>
<text x="148" y="116" fill="#6e7681">~/Project/antigravity-cli-statusline</text>

<!-- Divider above prompt -->
<line x1="24" y1="134" x2="936" y2="134" stroke="#383e5a" stroke-width="1"/>

<!-- Bottom Caption Bar Container -->
<path d="M0 575H960V630Q960 640 950 640H10Q0 640 0 630Z" fill="#21252b"/>
<line x1="0" y1="575" x2="960" y2="575" stroke="#383e5a" stroke-width="1"/>

<!-- ============================================================== -->
<!-- FRAME 0: Command & Language Selection Wizard -->
<!-- ============================================================== -->
<g class="f f0">
${termContentF0}

${defaultFooterSvg}

  <!-- Caption -->
  <text class="cap" x="480" y="608" fill="#e6edf3" text-anchor="middle">${escapeXml(captions[0])}</text>
</g>

<!-- ============================================================== -->
<!-- FRAME 1: Category Wizard 1/5 (Model & Agent) -->
<!-- ============================================================== -->
<g class="f f1">
${termContentF1}

${defaultFooterSvg}

  <!-- Caption -->
  <text class="cap" x="480" y="608" fill="#e6edf3" text-anchor="middle">${escapeXml(captions[1])}</text>
</g>

<!-- ============================================================== -->
<!-- FRAME 2: Category Wizard 2/5 (Quota, Billing & Account) -->
<!-- ============================================================== -->
<g class="f f2">
${termContentF2}

${defaultFooterSvg}

  <!-- Caption -->
  <text class="cap" x="480" y="608" fill="#e6edf3" text-anchor="middle">${escapeXml(captions[2])}</text>
</g>

<!-- ============================================================== -->
<!-- FRAME 3: Category Wizard 3/5 (Context & Tokens) -->
<!-- ============================================================== -->
<g class="f f3">
${termContentF3}

${defaultFooterSvg}

  <!-- Caption -->
  <text class="cap" x="480" y="608" fill="#e6edf3" text-anchor="middle">${escapeXml(captions[3])}</text>
</g>

<!-- ============================================================== -->
<!-- FRAME 4: Category Wizard 4/5 (Workspace & VCS) -->
<!-- ============================================================== -->
<g class="f f4">
${termContentF4}

${defaultFooterSvg}

  <!-- Caption -->
  <text class="cap" x="480" y="608" fill="#e6edf3" text-anchor="middle">${escapeXml(captions[4])}</text>
</g>

<!-- ============================================================== -->
<!-- FRAME 5: Category Wizard 5/5 (System & Background Tasks) -->
<!-- ============================================================== -->
<g class="f f5">
${termContentF5}

${defaultFooterSvg}

  <!-- Caption -->
  <text class="cap" x="480" y="608" fill="#e6edf3" text-anchor="middle">${escapeXml(captions[5])}</text>
</g>

<!-- ============================================================== -->
<!-- FRAME 6: Custom Order & Style Input Write-in -->
<!-- ============================================================== -->
<g class="f f6">
${termContentF6}

${defaultFooterSvg}

  <!-- Caption -->
  <text class="cap" x="480" y="608" fill="#e6edf3" text-anchor="middle">${escapeXml(captions[6])}</text>
</g>

<!-- ============================================================== -->
<!-- FRAME 7: Config Deployed & Statusline Hot Reloaded -->
<!-- ============================================================== -->
<g class="f f7">
${termContentF7}

${statuslineDividerSvg}

  <!-- Statusline Footer (Exact User-Specified Sorting) -->
${svgRowsIdle}

  <!-- Caption -->
  <text class="cap" x="480" y="608" fill="#e6edf3" text-anchor="middle">${escapeXml(captions[7])}</text>
</g>

<!-- ============================================================== -->
<!-- FRAME 8: Live Runtime & Telemetry Update -->
<!-- ============================================================== -->
<g class="f f8">
${termContentF8}

${statuslineDividerSvg}

  <!-- Statusline Footer (Exact User-Specified Sorting, Dynamic Telemetry) -->
${svgRowsActive}

  <!-- Caption -->
  <text class="cap" x="480" y="608" fill="#e6edf3" text-anchor="middle">${escapeXml(captions[8])}</text>
</g>
</svg>
`;
}

// =============================================================================
// Main Execution
// =============================================================================
async function main() {
  const imagesDir = path.join(projectRoot, 'docs', 'images');
  await fs.mkdir(imagesDir, { recursive: true });

  console.log('Generating SVG demos for English (us)...');
  const svgEn = generateDemoSvg('us');
  await fs.writeFile(path.join(imagesDir, 'statusline-demo.svg'), svgEn, 'utf8');
  await fs.writeFile(path.join(imagesDir, 'statusline-demo-en.svg'), svgEn, 'utf8');
  console.log('  -> docs/images/statusline-demo.svg');
  console.log('  -> docs/images/statusline-demo-en.svg');

  console.log('Generating SVG demo for Traditional Chinese (zh-tw)...');
  const svgZhTw = generateDemoSvg('zh-tw');
  await fs.writeFile(path.join(imagesDir, 'statusline-demo-zh-tw.svg'), svgZhTw, 'utf8');
  console.log('  -> docs/images/statusline-demo-zh-tw.svg');

  console.log('Generating SVG demo for Simplified Chinese (zh-cn)...');
  const svgZhCn = generateDemoSvg('zh-cn');
  await fs.writeFile(path.join(imagesDir, 'statusline-demo-zh-cn.svg'), svgZhCn, 'utf8');
  console.log('  -> docs/images/statusline-demo-zh-cn.svg');

  console.log('Generating SVG demo for Japanese (jp)...');
  const svgJp = generateDemoSvg('jp');
  await fs.writeFile(path.join(imagesDir, 'statusline-demo-jp.svg'), svgJp, 'utf8');
  console.log('  -> docs/images/statusline-demo-jp.svg');

  console.log('Done generating all demo SVGs!');
}

if (process.argv[1] && process.argv[1].endsWith('generate-svg-demos.mjs')) {
  main().catch(err => {
    console.error('Generation failed:', err);
    process.exit(1);
  });
}
