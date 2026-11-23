/**
 * 單一真實來源（Single Source of Truth）：
 * 統一定義 4 種支援語系、5 大分類頁籤、39 項標準狀態列指標、5 組相鄰合併長條圖、
 * 44 個 Emoji 圖示對應表，以及安裝精靈各步驟之跨語系靜態提示範本。
 */

export const SUPPORTED_LOCALES = ['zh-tw', 'zh-cn', 'us', 'jp'];

export const METRIC_CATEGORIES = [
  {
    id: 'model-and-agent',
    locales: {
      'zh-tw': { name: '模型與代理', question: '選擇要顯示的模型與代理指標' },
      'zh-cn': { name: '模型与代理', question: '选择要显示的模型与代理指标' },
      'us': { name: 'Model & Agent', question: 'Select Model & Agent metrics to display' },
      'jp': { name: 'モデルとエージェント', question: '表示するモデルとエージェントの指標を選択してください' }
    }
  },
  {
    id: 'quota-and-billing',
    locales: {
      'zh-tw': { name: '額度、計費與帳號', question: '選擇要顯示的額度、計費與帳號指標' },
      'zh-cn': { name: '额度、计费与账号', question: '选择要显示的额度、计费与账号指标' },
      'us': { name: 'Quota, Billing & Account', question: 'Select Quota, Billing & Account metrics to display' },
      'jp': { name: 'クォータ・請求・アカウント', question: '表示するクォータ・請求・アカウントの指標を選択してください' }
    }
  },
  {
    id: 'context-and-tokens',
    locales: {
      'zh-tw': { name: '脈絡與權杖', question: '選擇要顯示的脈絡與權杖指標' },
      'zh-cn': { name: '上下文与令牌', question: '选择要显示的上下文与令牌指标' },
      'us': { name: 'Context & Tokens', question: 'Select Context & Token metrics to display' },
      'jp': { name: 'コンテキストとトークン', question: '表示するコンテキストとトークンの指標を選択してください' }
    }
  },
  {
    id: 'workspace-and-vcs',
    locales: {
      'zh-tw': { name: '工作區與版本控制', question: '選擇要顯示的工作區與版本控制指標' },
      'zh-cn': { name: '工作区与版本控制', question: '选择要显示的工作区与版本控制指标' },
      'us': { name: 'Workspace & VCS', question: 'Select Workspace & VCS metrics to display' },
      'jp': { name: 'ワークスペースとバージョン管理', question: '表示するワークスペースとバージョン管理の指標を選択してください' }
    }
  },
  {
    id: 'system-and-tasks',
    locales: {
      'zh-tw': { name: '系統狀態與背景任務', question: '選擇要顯示的系統狀態與背景任務指標' },
      'zh-cn': { name: '系统状态与后台任务', question: '选择要显示的系统状态与后台任务指标' },
      'us': { name: 'System Status & Background Tasks', question: 'Select System Status & Background Task metrics to display' },
      'jp': { name: 'システム状態とバックグラウンドタスク', question: '表示するシステム状態とバックグラウンドタスクの指標を選択してください' }
    }
  }
];

export const METRICS = [
  // 1. 模型與代理（4 項）
  {
    id: 'model-name',
    category: 'model-and-agent',
    emoji: '🤖',
    descriptions: {
      'zh-tw': '目前使用的人工智慧模型名稱',
      'zh-cn': '当前使用的人工智能模型名称',
      'us': 'Current AI model name',
      'jp': '現在のAIモデル名'
    }
  },
  {
    id: 'agent-profile',
    category: 'model-and-agent',
    emoji: '🪪',
    descriptions: {
      'zh-tw': '使用中代理',
      'zh-cn': '使用中代理',
      'us': 'Active agent profile',
      'jp': '使用中のエージェント'
    }
  },
  {
    id: 'agent-state',
    category: 'model-and-agent',
    emoji: '⚡',
    descriptions: {
      'zh-tw': '代理當前狀態',
      'zh-cn': '代理当前状态',
      'us': 'Agent state',
      'jp': 'エージェント状態'
    }
  },
  {
    id: 'mode',
    category: 'model-and-agent',
    emoji: '⚙️',
    descriptions: {
      'zh-tw': '目前運行模式',
      'zh-cn': '当前运行模式',
      'us': 'Current running mode',
      'jp': '現在の実行モード'
    }
  },

  // 2. 額度、計費與帳號（14 項）
  {
    id: 'quota',
    category: 'quota-and-billing',
    emoji: '🔋',
    descriptions: {
      'zh-tw': '帳號五小時可用額度百分比',
      'zh-cn': '账号五小时可用额度百分比',
      'us': 'Hourly available quota remaining',
      'jp': '時間別利用可能残量'
    }
  },
  {
    id: 'quota-bar',
    category: 'quota-and-billing',
    emoji: '🔋',
    descriptions: {
      'zh-tw': '五小時可用額度長條圖',
      'zh-cn': '五小时可用额度长条图',
      'us': 'Hourly available quota bar graph',
      'jp': '時間別利用可能残量バーグラフ'
    }
  },
  {
    id: 'quota-reset-countdown',
    category: 'quota-and-billing',
    emoji: '⏳',
    descriptions: {
      'zh-tw': '帳號五小時額度重置時間倒數',
      'zh-cn': '账号五小时额度重置时间倒计时',
      'us': 'Hourly quota reset countdown',
      'jp': '時間別残量リセットカウントダウン'
    }
  },
  {
    id: 'quota-reset-time',
    category: 'quota-and-billing',
    emoji: '🕒',
    descriptions: {
      'zh-tw': '五小時重置時間',
      'zh-cn': '五小时重置时间',
      'us': 'Hourly reset time',
      'jp': '時間別リセット時刻'
    }
  },
  {
    id: 'quota-weekly',
    category: 'quota-and-billing',
    emoji: '📅',
    descriptions: {
      'zh-tw': '帳號每週可用額度百分比',
      'zh-cn': '账号每周可用额度百分比',
      'us': 'Weekly available quota remaining',
      'jp': '週間利用可能残量'
    }
  },
  {
    id: 'quota-weekly-bar',
    category: 'quota-and-billing',
    emoji: '📅',
    descriptions: {
      'zh-tw': '每週可用額度長條圖',
      'zh-cn': '每周可用额度长条图',
      'us': 'Weekly available quota bar graph',
      'jp': '週間利用可能残量バーグラフ'
    }
  },
  {
    id: 'quota-weekly-countdown',
    category: 'quota-and-billing',
    emoji: '⏲️',
    descriptions: {
      'zh-tw': '帳號每週額度重置時間倒數',
      'zh-cn': '账号每周额度重置时间倒计时',
      'us': 'Weekly quota reset countdown',
      'jp': '週間残量リセットカウントダウン'
    }
  },
  {
    id: 'quota-weekly-reset-time',
    category: 'quota-and-billing',
    emoji: '🗓️',
    descriptions: {
      'zh-tw': '每週重置時間',
      'zh-cn': '每周重置时间',
      'us': 'Weekly reset time',
      'jp': '週間リセット時刻'
    }
  },
  {
    id: 'quota-argon',
    category: 'quota-and-billing',
    emoji: '✨',
    descriptions: {
      'zh-tw': 'Gemini 4 Argon 可用額度百分比',
      'zh-cn': 'Gemini 4 Argon 可用额度百分比',
      'us': 'Gemini 4 Argon available quota remaining',
      'jp': 'Gemini 4 Argon 利用可能残量'
    }
  },
  {
    id: 'quota-argon-bar',
    category: 'quota-and-billing',
    emoji: '✨',
    descriptions: {
      'zh-tw': 'Gemini 4 Argon 可用額度長條圖',
      'zh-cn': 'Gemini 4 Argon 可用额度长条图',
      'us': 'Gemini 4 Argon available quota bar graph',
      'jp': 'Gemini 4 Argon 利用可能残量バーグラフ'
    }
  },
  {
    id: 'quota-argon-countdown',
    category: 'quota-and-billing',
    emoji: '⏱️',
    descriptions: {
      'zh-tw': 'Gemini 4 Argon 額度重置時間倒數',
      'zh-cn': 'Gemini 4 Argon 额度重置时间倒计时',
      'us': 'Gemini 4 Argon quota reset countdown',
      'jp': 'Gemini 4 Argon 残量リセットカウントダウン'
    }
  },
  {
    id: 'quota-argon-reset-time',
    category: 'quota-and-billing',
    emoji: '⏰',
    descriptions: {
      'zh-tw': 'Gemini 4 Argon 重置時間',
      'zh-cn': 'Gemini 4 Argon 重置时间',
      'us': 'Gemini 4 Argon reset time',
      'jp': 'Gemini 4 Argon リセット時刻'
    }
  },
  {
    id: 'plan-tier',
    category: 'quota-and-billing',
    emoji: '💎',
    descriptions: {
      'zh-tw': '目前訂閱方案等級',
      'zh-cn': '当前订阅计划等级',
      'us': 'Current subscription plan tier',
      'jp': '現在のサブスクリプションプラン'
    }
  },
  {
    id: 'account-email',
    category: 'quota-and-billing',
    emoji: '📧',
    descriptions: {
      'zh-tw': '帳號電子郵件',
      'zh-cn': '账号电子邮件',
      'us': 'Account email',
      'jp': 'アカウントのメールアドレス'
    }
  },

  // 3. 脈絡與權杖（4 項）
  {
    id: 'context-used',
    category: 'context-and-tokens',
    emoji: '🧠',
    descriptions: {
      'zh-tw': '目前對話已消耗的脈絡用量比例',
      'zh-cn': '当前对话已消耗的上下文用量比例',
      'us': 'Context used percentage',
      'jp': 'コンテキスト使用割合'
    }
  },
  {
    id: 'context-used-bar',
    category: 'context-and-tokens',
    emoji: '🧠',
    descriptions: {
      'zh-tw': '脈絡用量長條圖',
      'zh-cn': '上下文用量长条图',
      'us': 'Context used bar graph',
      'jp': 'コンテキスト使用バーグラフ'
    }
  },
  {
    id: 'token-count',
    category: 'context-and-tokens',
    emoji: '💰',
    descriptions: {
      'zh-tw': '目前工作階段消耗的精確權杖數量',
      'zh-cn': '当前会话消耗的精确令牌数量',
      'us': 'Exact token count for current session',
      'jp': '現在のセッションの正確なトークン数'
    }
  },
  {
    id: 'token-count-bar',
    category: 'context-and-tokens',
    emoji: '💰',
    descriptions: {
      'zh-tw': '權杖數長條圖',
      'zh-cn': '令牌数长条图',
      'us': 'Token count bar graph',
      'jp': 'トークン数バーグラフ'
    }
  },

  // 4. 工作區與版本控制（5 項）
  {
    id: 'project-path',
    category: 'workspace-and-vcs',
    emoji: '📁',
    descriptions: {
      'zh-tw': '目前工作區專案短路徑',
      'zh-cn': '当前工作区项目短路径',
      'us': 'Current workspace short path',
      'jp': '現在のワークスペースの短いパス'
    }
  },
  {
    id: 'project-full-path',
    category: 'workspace-and-vcs',
    emoji: '📍',
    descriptions: {
      'zh-tw': '目前工作區專案完整路徑',
      'zh-cn': '当前工作区项目完整路径',
      'us': 'Current workspace full path',
      'jp': '現在のワークスペースの完全なパス'
    }
  },
  {
    id: 'git-branch',
    category: 'workspace-and-vcs',
    emoji: '🔀',
    descriptions: {
      'zh-tw': '目前工作區專案的 Git 分支',
      'zh-cn': '当前工作区项目的 Git 分支',
      'us': 'Current Git branch',
      'jp': '現在のGitブランチ'
    }
  },
  {
    id: 'vcs-dirty',
    category: 'workspace-and-vcs',
    emoji: '🔍',
    descriptions: {
      'zh-tw': '工作區是否有未提交變更',
      'zh-cn': '工作区是否有未提交变更',
      'us': 'Workspace dirty status',
      'jp': 'ワークスペースの未コミット変更'
    }
  },
  {
    id: 'vcs-type',
    category: 'workspace-and-vcs',
    emoji: '🗃️',
    descriptions: {
      'zh-tw': '版本控制類型',
      'zh-cn': '版本控制类型',
      'us': 'VCS type',
      'jp': 'バージョン管理タイプ'
    }
  },

  // 5. 系統狀態與背景任務（12 項）
  {
    id: 'memory-usage',
    category: 'system-and-tasks',
    emoji: '💾',
    descriptions: {
      'zh-tw': '命令列介面行程所消耗的隨機存取記憶體量',
      'zh-cn': '命令行界面进程所消耗的随机存取内存量',
      'us': 'RAM usage of CLI process',
      'jp': 'CLIプロセスのRAM使用量'
    }
  },
  {
    id: 'cli-version',
    category: 'system-and-tasks',
    emoji: '🚀',
    descriptions: {
      'zh-tw': 'Antigravity 命令列介面版本號',
      'zh-cn': 'Antigravity 命令行界面版本号',
      'us': 'Antigravity CLI version',
      'jp': 'Antigravity CLIバージョン'
    }
  },
  {
    id: 'conversation-id',
    category: 'system-and-tasks',
    emoji: '💬',
    descriptions: {
      'zh-tw': '目前對話識別碼',
      'zh-cn': '当前对话标识码',
      'us': 'Current conversation ID',
      'jp': '現在の会話ID'
    }
  },
  {
    id: 'sandbox-status',
    category: 'system-and-tasks',
    emoji: '🛡️',
    descriptions: {
      'zh-tw': '沙盒模式狀態',
      'zh-cn': '沙箱模式状态',
      'us': 'Sandbox status',
      'jp': 'サンドボックス状態'
    }
  },
  {
    id: 'tool-confirmation',
    category: 'system-and-tasks',
    emoji: '🔔',
    descriptions: {
      'zh-tw': '是否有等你回應的工具確認對話方塊',
      'zh-cn': '是否有等你响应的工具确认对话框',
      'us': 'Pending tool confirmation dialog',
      'jp': '返答待ちのツール確認ダイアログ'
    }
  },
  {
    id: 'pending-input',
    category: 'system-and-tasks',
    emoji: '📥',
    descriptions: {
      'zh-tw': '佇列中待處理的使用者輸入數',
      'zh-cn': '队列中待处理的用户输入数',
      'us': 'Pending user inputs in queue',
      'jp': 'キュー内の待機中ユーザー入力数'
    }
  },
  {
    id: 'background-tasks',
    category: 'system-and-tasks',
    emoji: '🔄',
    descriptions: {
      'zh-tw': '進行中的背景任務數',
      'zh-cn': '进行中的后台任务数',
      'us': 'Running background tasks',
      'jp': '実行中のバックグラウンドタスク数'
    }
  },
  {
    id: 'subagents',
    category: 'system-and-tasks',
    emoji: '👥',
    descriptions: {
      'zh-tw': '活躍子代理數',
      'zh-cn': '活跃子代理数',
      'us': 'Active subagents',
      'jp': 'アクティブなサブエージェント数'
    }
  },
  {
    id: 'artifacts',
    category: 'system-and-tasks',
    emoji: '📄',
    descriptions: {
      'zh-tw': '本次對話人工智慧累計產出的檔案數量',
      'zh-cn': '本次对话人工智能累计产出的文件数量',
      'us': 'Total artifacts generated in this session',
      'jp': '今回のセッションで生成されたアーティファクト数'
    }
  },
  {
    id: 'plugin-version',
    category: 'system-and-tasks',
    emoji: '🧩',
    descriptions: {
      'zh-tw': '狀態列版本號',
      'zh-cn': '状态栏版本号',
      'us': 'Statusline version',
      'jp': 'ステータスラインバージョン'
    }
  },
  {
    id: 'plugin-update',
    category: 'system-and-tasks',
    emoji: '🆕',
    descriptions: {
      'zh-tw': '狀態列新版本更新提醒',
      'zh-cn': '状态栏新版本更新提醒',
      'us': 'Statusline update reminder',
      'jp': 'ステータスライン更新通知'
    }
  },
  {
    id: 'app-version',
    category: 'system-and-tasks',
    emoji: '💻',
    descriptions: {
      'zh-tw': 'Antigravity 2.0 應用程式版本號',
      'zh-cn': 'Antigravity 2.0 应用程序版本号',
      'us': 'Antigravity 2.0 App version',
      'jp': 'Antigravity 2.0 アプリバージョン'
    }
  }
];

export const ALL_STANDARD_METRIC_IDS = METRICS.map((m) => m.id);

export const ADJACENT_PAIRS = [
  { val: 'quota', bar: 'quota-bar', merged: 'quota+bar' },
  { val: 'context-used', bar: 'context-used-bar', merged: 'context-used+bar' },
  { val: 'quota-weekly', bar: 'quota-weekly-bar', merged: 'quota-weekly+bar' },
  { val: 'quota-argon', bar: 'quota-argon-bar', merged: 'quota-argon+bar' },
  { val: 'token-count', bar: 'token-count-bar', merged: 'token-count+bar' }
];

export const EMOJI_MAP = (() => {
  const map = {};
  for (const metric of METRICS) {
    map[metric.id] = metric.emoji;
  }
  for (const pair of ADJACENT_PAIRS) {
    map[pair.merged] = map[pair.val];
  }
  return map;
})();

export const LOCALE_WIZARD_META = {
  step1: {
    questions: [
      {
        question: '選擇顯示語系 / 选择显示语言 / Select Display Language / 表示言語の選択',
        options: [
          '繁體中文 (zh-tw)',
          '简体中文 (zh-cn)',
          'English (us)',
          '日本語 (jp)'
        ],
        is_multi_select: false
      }
    ]
  },
  locales: {
    'zh-tw': {
      style_question: '選擇狀態列標籤顯示樣式',
      style_options: [
        '文字標籤（例如：模型: Gemini 3.1 Pro）（text）',
        'Emoji 圖示（例如：🤖 Gemini 3.1 Pro）（emoji）'
      ],
      question: '選擇要顯示的狀態列指標（下一步將進行排序）',
      step2_missing_node: {
        questions: [
          {
            question:
              '⚠️ 偵測到系統未安裝 Node.js。\n\n狀態列腳本需要 Node.js 才能運作，缺少 Node.js 將導致命令列介面（CLI）底部狀態列完全空白且自動停用。\n\n建議先安裝 Node.js（例如：brew install node），再重新執行本技能。\n\n是否仍要繼續設定？（設定檔會正確寫入，但狀態列在安裝 Node.js 前不會顯示）',
            options: [
              '中斷，我先去安裝 Node.js',
              '繼續設定（安裝 Node.js 後狀態列會自動生效）'
            ],
            is_multi_select: false
          }
        ]
      },
      step4_table: {
        title:
          '📋 **目前已選取的狀態列指標（共 N 項）** — *於下方 Write-in 輸入序號或代碼（如 `2, e1, n, e:quota`；純數字/`t` 為文字、`e` 為 Emoji、`n` 為換行）：*',
        header: '| # | 指標名稱（識別碼） | # | 指標名稱（識別碼） | # | 指標名稱（識別碼） |'
      },
      step4_order_question: {
        questions: [
          {
            question: '請設定狀態列顯示順序與個別樣式：',
            options: [
              '略過，使用原勾選順序啟用全部指標（預設文字樣式）',
              '手動排序與設定樣式（請在下方「Write-in...」欄位中填寫）'
            ],
            is_multi_select: false
          }
        ]
      }
    },
    'zh-cn': {
      style_question: '选择状态栏标签显示样式',
      style_options: [
        '文字标签（例如：模型: Gemini 3.1 Pro）（text）',
        'Emoji 图标（例如：🤖 Gemini 3.1 Pro）（emoji）'
      ],
      question: '选择要显示的状态栏指标（下一步将进行排序）',
      step2_missing_node: {
        questions: [
          {
            question:
              '⚠️ 检测到系统未安装 Node.js。\n\n状态栏脚本需要 Node.js 才能运作，缺少 Node.js 将导致命令行界面（CLI）底部状态栏完全空白且自动停用。\n\n建议先安装 Node.js（例如：brew install node），再重新运行本技能。\n\n是否仍要继续设置？（配置文件会正确写入，但状态栏在安装 Node.js 前不会显示）',
            options: [
              '中断，我先去安装 Node.js',
              '继续设置（安装 Node.js 后状态栏会自动生效）'
            ],
            is_multi_select: false
          }
        ]
      },
      step4_table: {
        title:
          '📋 **目前已选取的状态栏指标（共 N 项）** — *于下方 Write-in 输入序号或代码（如 `2, e1, n, e:quota`；纯数字/`t` 为文字、`e` 为 Emoji、`n` 为换行）：*',
        header: '| # | 指标名称（标识码） | # | 指标名称（标识码） | # | 指标名称（标识码） |'
      },
      step4_order_question: {
        questions: [
          {
            question: '请设置状态栏显示顺序与个别样式：',
            options: [
              '跳过，使用原勾选顺序启用全部指标（默认文字样式）',
              '手动排序与设定样式（请在下方“Write-in...”栏位中填写）'
            ],
            is_multi_select: false
          }
        ]
      }
    },
    'us': {
      style_question: 'Select statusline label display style',
      style_options: [
        'Text labels (e.g., Model: Gemini 3.1 Pro) (text)',
        'Emoji icons (e.g., 🤖 Gemini 3.1 Pro) (emoji)'
      ],
      question: 'Select statusline metrics to display (sorting will be done in the next step)',
      step2_missing_node: {
        questions: [
          {
            question:
              '⚠️ Node.js is not installed on this system.\n\nThe statusline script requires Node.js to function. Without Node.js, the CLI footer will be completely blank and automatically disabled.\n\nIt is recommended to install Node.js first (e.g.: brew install node), then re-run this skill.\n\nDo you still want to proceed? (Configuration files will be written, but the statusline will not appear until Node.js is installed)',
            options: [
              'Abort, I will install Node.js first',
              'Continue setup (Statusline will automatically work once Node.js is installed)'
            ],
            is_multi_select: false
          }
        ]
      },
      step4_table: {
        title:
          '📋 **Currently Selected Metrics (Total N)** — *Enter comma-separated numbers/IDs in Write-in below (e.g. `2, e1, n, e:quota`; number/`t`=text, `e`=Emoji, `n`=line break):*',
        header: '| # | Metric (ID) | # | Metric (ID) | # | Metric (ID) |'
      },
      step4_order_question: {
        questions: [
          {
            question: 'Please set the statusline display order and individual styles:',
            options: [
              'Skip, keep current selection order (default text labels)',
              "Manual order & styles (fill in the 'Write-in...' box below)"
            ],
            is_multi_select: false
          }
        ]
      }
    },
    'jp': {
      style_question: 'ステータスラインのラベル表示スタイルを選択してください',
      style_options: [
        'テキストラベル（例：モデル: Gemini 3.1 Pro）（text）',
        '絵文字アイコン（例：🤖 Gemini 3.1 Pro）（emoji）'
      ],
      question: '表示するステータスラインの指標を選択してください（並べ替えは次のステップで行います）',
      step2_missing_node: {
        questions: [
          {
            question:
              '⚠️ システムに Node.js がインストールされていません。\n\nステータスラインのスクリプトには Node.js が必要です。Node.js がないと、CLI 画面下部のステータスラインは完全に空白となり、自動的に無効化されます。\n\n先に Node.js をインストールしてから（例：brew install node）、本スキルを再実行することをお勧めします。\n\nそれでも設定を続行しますか？（設定ファイルは正常に書き込まれますが、Node.js がインストールされるまでステータスラインは表示されません）',
            options: [
              '中断して、先に Node.js をインストールする',
              '設定を続行する（Node.js インストール後にステータスラインが自動的に有効になります）'
            ],
            is_multi_select: false
          }
        ]
      },
      step4_table: {
        title:
          '📋 **現在選択中の指標（全 N 項目）** — *下の Write-in に番号またはIDをカンマ区切りで入力（例: `2, e1, n, e:quota`；数字/`t`=テキスト、`e`=絵文字、`n`=改行）：*',
        header: '| # | 指標名（ID） | # | 指標名（ID） | # | 指標名（ID） |'
      },
      step4_order_question: {
        questions: [
          {
            question: 'ステータスラインの表示順序と個別のスタイルを設定してください：',
            options: [
              'スキップして選択順のまま全指標を有効化（デフォルトテキスト形式）',
              '手動で並べ替えとスタイル設定（下の「Write-in...」欄に入力）'
            ],
            is_multi_select: false
          }
        ]
      }
    }
  }
};

/**
 * 依語系格式化單一指標問卷選項文字（末尾保留唯一識別碼括號）。
 * @param {{ id: string, emoji: string, descriptions: Record<string, string> }} metric
 * @param {string} locale
 * @returns {string}
 */
function formatMetricOption(metric, locale) {
  const desc = metric.descriptions[locale];
  if (locale === 'us') {
    return `${metric.emoji} ${desc} (${metric.id})`;
  }
  return `${metric.emoji} ${desc}（${metric.id}）`;
}

/**
 * 自單一真實來源建構完整的 resources/questions.json 資料物件。
 * @returns {Record<string, object>}
 */
export function buildQuestionsJsonObject() {
  const result = {};
  for (const locale of SUPPORTED_LOCALES) {
    const meta = LOCALE_WIZARD_META.locales[locale];
    const categories = METRIC_CATEGORIES.map((cat) => {
      const catLocale = cat.locales[locale];
      const options = METRICS
        .filter((m) => m.category === cat.id)
        .map((m) => formatMetricOption(m, locale));
      return {
        id: cat.id,
        name: catLocale.name,
        question: catLocale.question,
        options
      };
    });
    const options = categories.flatMap((cat) => cat.options);
    result[locale] = {
      style_question: meta.style_question,
      style_options: [...meta.style_options],
      question: meta.question,
      categories,
      options
    };
  }
  return result;
}

/**
 * 自單一真實來源建構完整的 resources/prompts.json 資料物件，供 SKILL.md 靜態引用。
 * @returns {{ step1: object, step2_missing_node: object, step4_table: object, step4_order_question: object }}
 */
export function buildPromptsJsonObject() {
  const step2_missing_node = {};
  const step4_table = {};
  const step4_order_question = {};

  for (const locale of SUPPORTED_LOCALES) {
    const meta = LOCALE_WIZARD_META.locales[locale];
    step2_missing_node[locale] = structuredClone(meta.step2_missing_node);
    step4_table[locale] = { ...meta.step4_table };
    step4_order_question[locale] = structuredClone(meta.step4_order_question);
  }

  return {
    step1: structuredClone(LOCALE_WIZARD_META.step1),
    step2_missing_node,
    step4_table,
    step4_order_question
  };
}
