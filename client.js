window.__ModuleLoader__.load({
  id: '@local/dsh-work-team',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    const {
      useCallback,
      useEffect,
      useMemo,
      useRef,
      useState,
      useSyncExternalStore,
    } = React;

    const NS = 'work-team';
    const ENTRY_ID = 'work-team';
    /** Also the right-sidebar tab type id, and the key its body registers under. */
    const PLUGIN_ID = '@local/dsh-work-team';

    /** Mirrors lib/roles.js. Keep ids, fields, and order in sync. */
    const ROLES = [
      {
        id: 'pm',
        modelField: 'modelPm',
        palette: { accent: '#f59e0b', soft: '#fff2cc', hair: '#3b2a20', skin: '#e8b48c' },
        zh: { name: '阿策', role: '产品经理 / 拆需求', seat: '拆需求、定验收、排优先级' },
        en: { name: 'Ace', role: 'Product Manager', seat: 'Requirements, acceptance, priority' },
      },
      {
        id: 'frontend',
        modelField: 'modelFrontend',
        palette: { accent: '#2d7ff9', soft: '#dcebff', hair: '#241b16', skin: '#f2c49b' },
        zh: { name: '小前', role: '前端工程师', seat: '页面、组件、样式与交互' },
        en: { name: 'Faye', role: 'Frontend Engineer', seat: 'Pages, components, styles, interaction' },
      },
      {
        id: 'backend',
        modelField: 'modelBackend',
        palette: { accent: '#21a67a', soft: '#d9f7ea', hair: '#1f2a24', skin: '#c98d67' },
        zh: { name: '老后', role: '后端工程师', seat: '接口、数据模型、服务端逻辑' },
        en: { name: 'Reed', role: 'Backend Engineer', seat: 'APIs, data, server logic' },
      },
      {
        id: 'reviewer',
        modelField: 'modelReviewer',
        palette: { accent: '#e04b4b', soft: '#ffe1e1', hair: '#2b1f1a', skin: '#f0c19a' },
        zh: { name: '小审', role: '审查 / 测试', seat: 'Diff、bug、测试' },
        en: { name: 'Rae', role: 'Reviewer / QA', seat: 'Diffs, bugs, tests' },
      },
      {
        id: 'researcher',
        modelField: 'modelResearcher',
        palette: { accent: '#7c5cff', soft: '#e9e2ff', hair: '#2a2233', skin: '#e8b48c' },
        zh: { name: '小研', role: '研究员', seat: '资料、文档、方案对比' },
        en: { name: 'Rin', role: 'Researcher', seat: 'Sources, docs, option comparison' },
      },
      {
        id: 'designer',
        modelField: 'modelDesigner',
        palette: { accent: '#d94f9c', soft: '#ffe3f2', hair: '#3a2230', skin: '#f2c49b' },
        zh: { name: '小设', role: '设计师', seat: '视觉、排版、配色与层级' },
        en: { name: 'Dee', role: 'Designer', seat: 'Visual direction, type, color, hierarchy' },
      },
      {
        id: 'ops',
        modelField: 'modelOps',
        palette: { accent: '#e07a2f', soft: '#ffead9', hair: '#2a2118', skin: '#c98d67' },
        zh: { name: '老运', role: '运维 / 脚本', seat: '环境、部署、自动化' },
        en: { name: 'Otto', role: 'Ops / Scripting', seat: 'Environment, deploy, automation' },
      },
      {
        id: 'writer',
        modelField: 'modelWriter',
        palette: { accent: '#b4534b', soft: '#ffe6e1', hair: '#33231d', skin: '#e8b48c' },
        zh: { name: '笔笔', role: '文案 / 写作', seat: '文档、公众号、剧情、润色' },
        en: { name: 'Pip', role: 'Writer', seat: 'Docs, articles, fiction, polish' },
      },
    ];
    const ROLE_BY_ID = new Map(ROLES.map((role) => [role.id, role]));
    const MAX_TEAM_SIZE = 8;
    /** Ceiling for the one-off workers an employee may spawn itself; 0 disables them. */
    const MAX_TEMPORARY_WORKERS = 4;

    const zh = {
      'dock.title': '员工办公室',
      'dock.expand': '展开办公室',
      'dock.count': '人',
      'dock.chipAria': '{name}，{status}',
      'dock.chipAriaTask': '{name}，{status}：{phrase}',
      'dock.moreAria': '还有 {count} 人',
      'dock.fanAria': '员工办公室，{count} 人',
      'dock.cardAria': '{name} 的名片',
      'dock.closeCard': '关闭名片',
      'dock.cardTask': '当前任务',
      'dock.cardModel': '模型',
      'dock.cardUsage': '用量',
      'dock.cardFailed': '入职失败，这个座位还没有会话',
      'dock.openCard': '打开 {name} 的名片',
      'dock.dispatchTo': '给 {name} 派活',
      'office.title': '员工办公室',
      'office.subtitle': '你的团队在干什么，一眼看到',
      'office.tab.office': '办公室',
      'office.tab.tasks': '任务板',
      'office.settings': '团队设置',
      'office.totalTokens': '团队已用',
      'status.provisioning': '入职中',
      'status.ready': '已就位',
      'status.idle': '待命',
      'status.working': '干活中',
      'status.waiting': '等你回复',
      'status.done': '有新结果',
      'status.error': '异常结束',
      'status.failed': '入职失败',
      'card.stop': '暂停',
      'empty.seat': '空位',
      'empty.full': '编制已满',
      'row.open': '打开 {name} 的会话',
      'task.empty': '还没有任务',
      'task.emptyHint': '让主管用 team_task_create 建一条任务。',
      'task.owner': '负责人',
      'task.blockedBy': '依赖',
      'task.scopes': '涉及',
      'task.pending': '待办',
      'task.inProgress': '进行中',
      'task.completed': '已完成',
      'task.blocked': '被阻塞',
      'task.ready': '可认领',
      'settings.sectionTitle': '团队设置',
      'settings.sectionIntro': '每位员工的模型、汇报频率与自动化开关，改动即时生效。',
      'settings.teamSize': '团队编制',
      'settings.teamSizeHint': '当前主对话只增不减；缩编请开新主对话。',
      'settings.models': '每个员工的模型',
      'settings.followMain': '跟随主对话',
      'settings.unavailable': '已保存但当前不可用',
      'settings.reporting': '汇报频率',
      'settings.reporting.milestones': '关键节点',
      'settings.reporting.completion': '只在完成时',
      'settings.reporting.every-step': '每一步',
      'settings.allowSelfHire': '员工可自行招人',
      'settings.allowSelfHireHint': '缺角色时员工可直接招人，受编制上限；满编后自动转成招聘申请。',
      'settings.maxWorkers': '临时工上限',
      'settings.maxWorkersHint': '员工自己开的一次性子 agent，不占编制但吃 token；0 表示禁止。',
      'settings.costHint': '跟随主对话的员工会用同一个模型，成本叠加。给研究、审查单独配便宜模型更省。',
      'settings.loading': '正在读取配置…',
      'settings.unavailableForm': '当前 profile 没有启用配置表单，暂时只能在 cordis.patch.yml 里改。',
      'settings.saveFailed': '保存失败，请重试。',
      'settings.refresh': '刷新可用模型',
      'settings.readOnly': '当前配置只读。',
      'settings.catalogError': '模型目录读取失败：{message}',
      'settings.catalogUnknown': '未知错误',
      'settings.catalogEmpty': 'Host 没有返回可路由的模型。',
      'settings.catalogFailures': '部分提供方不可用：',
      'error.stop': '暂停失败',
      'error.navigate': '打开对话失败',
      'error.sidebarBusy': '右侧边栏正显示另一个会话，切回本会话再试',
      'error.sidebarNotReady': '侧边栏还没准备好，点这里重试',
      'office.people': '人',
      'dispatch.candidates': '选一个同事',
      'dispatch.placeholder': '给 {name} 派个活…',
      'dispatch.send': '发送',
      'dispatch.sent': '已派给 {name}',
      'dispatch.failed': '没派出去：{reason}',
      'dispatch.notHired': '未入职',
      'dispatch.hireHint': '说「招」',
      'settings.automation': '自动化',
      'settings.autoStart': '自动组建团队',
      'settings.autoStart.off': '关',
      'settings.autoStart.first-message': '首条消息后',
      'settings.autoStart.immediate': '新会话即组建',
      'settings.autoStartHint': '每位员工一次入职 turn 会消耗 token，默认关。',
      'settings.dispatchPrefix': '@ 前缀转发给员工',
      'settings.dispatchPrefixHint': '主管会话里以 @角色 开头的消息会转发给该员工，主管只回一句确认。',
      'settings.trimEmployeeTools': '裁剪员工工具',
      'settings.trimEmployeeToolsHint': '开启后每位员工只保留本职需要的工具，每次请求省约 70% 的工具 schema；关掉后恢复全部工具，改动即时生效。',
      'settings.leadHandsOff': '主管不亲手改文件',
      'settings.leadHandsOffHint': '开启后主管调用 write / edit 会被拒绝并说明理由；工具仍留在列表里，read、grep、bash 照常可用。',
    };

    const en = {
      'dock.title': 'Work Team',
      'dock.expand': 'Open office',
      'dock.count': 'people',
      'dock.chipAria': '{name}, {status}',
      'dock.chipAriaTask': '{name}, {status}: {phrase}',
      'dock.moreAria': '{count} more',
      'dock.fanAria': 'Work team, {count} people',
      'dock.cardAria': "{name}'s card",
      'dock.closeCard': 'Close card',
      'dock.cardTask': 'Current task',
      'dock.cardModel': 'Model',
      'dock.cardUsage': 'Usage',
      'dock.cardFailed': 'Join failed — this seat has no session yet',
      'dock.openCard': "Open {name}'s card",
      'dock.dispatchTo': 'Dispatch to {name}',
      'office.title': 'Work Team',
      'office.subtitle': 'See what your team is doing at a glance',
      'office.tab.office': 'Office',
      'office.tab.tasks': 'Task board',
      'office.settings': 'Team settings',
      'office.totalTokens': 'Team tokens',
      'status.provisioning': 'Joining',
      'status.ready': 'Ready',
      'status.idle': 'Idle',
      'status.working': 'Working',
      'status.waiting': 'Waiting for you',
      'status.done': 'New result',
      'status.error': 'Ended abnormally',
      'status.failed': 'Join failed',
      'card.stop': 'Stop',
      'empty.seat': 'Empty desk',
      'empty.full': 'Team is full',
      'row.open': "Open {name}'s chat",
      'task.empty': 'No tasks yet',
      'task.emptyHint': 'Ask the Lead to create one with team_task_create.',
      'task.owner': 'Owner',
      'task.blockedBy': 'Blocked by',
      'task.scopes': 'Scopes',
      'task.pending': 'Todo',
      'task.inProgress': 'In progress',
      'task.completed': 'Done',
      'task.blocked': 'blocked',
      'task.ready': 'ready',
      'settings.sectionTitle': 'Team settings',
      'settings.sectionIntro': 'Per-role models, reporting cadence, and automation switches — changes apply immediately.',
      'settings.teamSize': 'Team size',
      'settings.teamSizeHint': 'The main chat only grows; start a new main chat to shrink.',
      'settings.models': 'Per-role model',
      'settings.followMain': 'Follow the main chat',
      'settings.unavailable': 'Saved but currently unavailable',
      'settings.reporting': 'Reporting cadence',
      'settings.reporting.milestones': 'Key milestones',
      'settings.reporting.completion': 'Only on completion',
      'settings.reporting.every-step': 'Every step',
      'settings.allowSelfHire': 'Allow employees to hire',
      'settings.allowSelfHireHint': 'A missing role can be hired directly within the team size cap; once full, it becomes a hiring request.',
      'settings.maxWorkers': 'Temporary worker cap',
      'settings.maxWorkersHint': 'One-off subagents an employee spawns itself: no seat, but they spend tokens. 0 disables them.',
      'settings.costHint': 'Employees following the main chat share its model, so cost adds up. Cheaper models for research/review save money.',
      'settings.loading': 'Loading configuration…',
      'settings.unavailableForm': 'The settings form is not enabled in this profile; edit cordis.patch.yml for now.',
      'settings.saveFailed': 'Save failed. Try again.',
      'settings.refresh': 'Refresh models',
      'settings.readOnly': 'Configuration is read-only.',
      'settings.catalogError': 'Model catalog: {message}',
      'settings.catalogUnknown': 'unavailable',
      'settings.catalogEmpty': 'No routable models returned by the Host.',
      'settings.catalogFailures': 'Some providers failed:',
      'error.stop': 'Could not stop',
      'error.navigate': 'Could not open chat',
      'error.sidebarBusy': 'The right sidebar is showing another session — switch back and retry',
      'error.sidebarNotReady': 'The sidebar is not ready yet — tap to retry',
      'office.people': 'people',
      'dispatch.candidates': 'Pick a teammate',
      'dispatch.placeholder': 'Give {name} a task…',
      'dispatch.send': 'Send',
      'dispatch.sent': 'Sent to {name}',
      'dispatch.failed': 'Not dispatched: {reason}',
      'dispatch.notHired': 'Not hired',
      'dispatch.hireHint': 'Say “招”',
      'settings.automation': 'Automation',
      'settings.autoStart': 'Build the team automatically',
      'settings.autoStart.off': 'Off',
      'settings.autoStart.first-message': 'After the first message',
      'settings.autoStart.immediate': 'Right after a new session',
      'settings.autoStartHint': 'Each teammate costs one onboarding turn in tokens; off by default.',
      'settings.dispatchPrefix': 'Forward @-prefixed messages',
      'settings.dispatchPrefixHint': 'In the Lead session, a message starting with @role is forwarded to that teammate; the Lead only acknowledges it.',
      'settings.trimEmployeeTools': 'Trim teammate tools',
      'settings.trimEmployeeToolsHint': 'Each teammate only keeps the tools its role needs, cutting about 70% of the tool schema per request; switch it off to restore every tool. Takes effect immediately.',
      'settings.leadHandsOff': 'Lead keeps its hands off files',
      'settings.leadHandsOffHint': 'The Lead still lists write and edit, but every call is refused with a reason; read, grep, and bash keep working.',
    };

    const CSS = `
      /* ── V3 轨道：容器 ───────────────────────────────────────────────── */
      /* Width mirrors the composer card (same formula + centring), so the track's
         content edge lands exactly on the input's text edge. The box is invisible
         until hover: the only visual weight left is the units themselves. */
      .wt-dock { box-sizing:border-box; display:flex; align-items:center; gap:10px; height:32px; width:min(calc(100% - 32px), var(--dsh-composer-card-max-width)); margin:0 auto; padding:0 14px; border:0; border-radius:8px; background:transparent; color:var(--dsw-alias-label-primary); container-type:inline-size; transition:background-color .12s ease-out; }
      .wt-dock:hover, .wt-dock:focus-within { background:var(--dsw-alias-bg-layer-1); }
      .wt-dock[data-mode="dispatch"] { height:auto; min-height:32px; }
      .wt-dock[data-mode="dispatch"] .wt-seat { flex:1 1 auto; min-width:0; display:flex; }
      .wt-dock-head { display:flex; align-items:center; gap:7px; flex:none; cursor:pointer; background:transparent; border:0; color:inherit; padding:2px 4px; border-radius:7px; }
      .wt-dock-head:hover { background:var(--dsw-alias-bg-layer-2); }
      .wt-dock-count { font-size:11px; color:var(--dsw-alias-label-secondary); font-variant-numeric:tabular-nums; }
      .wt-card { position:relative; display:flex; align-items:center; gap:8px; min-width:136px; max-width:168px; padding:6px 9px 6px 7px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:9px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); text-align:left; cursor:pointer; font:inherit; flex:none; transition:border-color .15s, transform .15s; }
      .wt-card:hover { border-color:var(--dsw-alias-brand-primary); transform:translateY(-1px); }
      .wt-dot { width:5px; height:5px; border-radius:50%; background:var(--dsw-alias-state-idle-primary); flex:none; }
      .wt-dot.working,.wt-dot.provisioning { background:var(--dsw-alias-state-business-primary); animation:wt-pulse 1.4s ease-in-out infinite; }
      .wt-dot.waiting { background:var(--dsw-alias-state-warn-primary); animation:wt-pulse 1s ease-in-out infinite; }
      .wt-dot.done { background:var(--dsw-alias-state-success-primary); }
      /* Ready is not an achievement, it is a seat being taken: the success hue
         pulled toward the secondary label so it reads quieter than "new result". */
      .wt-dot.ready { background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, var(--dsw-alias-label-secondary)); }
      .wt-dot.error,.wt-dot.failed { background:var(--dsw-alias-state-error-primary); }
      /* Header context only (OfficeAction): the line sits where a summary would
         and must be capped so it cannot push the roster count around. */
      .wt-dock-error { flex:1 1 auto; min-width:0; max-width:min(260px, 42%); height:20px; padding:0 6px; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-state-error-primary); font:inherit; font-size:11px; line-height:20px; text-align:left; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-dock-error:hover { background:var(--dsw-alias-bg-layer-2); }
      .wt-st-working,.wt-st-provisioning { --wt-raw:var(--dsw-alias-state-business-primary); }
      .wt-st-waiting { --wt-raw:var(--dsw-alias-state-warn-primary); }
      .wt-st-done { --wt-raw:var(--dsw-alias-state-success-primary); }
      .wt-st-error,.wt-st-failed { --wt-raw:var(--dsw-alias-state-error-primary); }
      .wt-st-idle { --wt-raw:var(--dsw-alias-state-idle-primary); }
      /* Ready keeps the success hue but desaturated, so a just-onboarded team
         reads as calm: no ring animation, no dot pulse, nothing to click. */
      .wt-st-ready { --wt-raw:color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, var(--dsw-alias-label-secondary)); }
      /* ── v5.1 · one dot recipe per status ──────────────────────────────────
         The old single 60/40 formula (raw 60% + label-primary 40%) pulled every
         hue into the same L* band and cost the dot its chroma; idle — whose raw
         token is near-white — landed at 2.83:1, and ready sat on top of done.
         Each status now owns its colour, so a status can be mixed differently
         (or not at all) without touching its neighbours.
         Scoped to .wt-desk on purpose: .wt-row, .wt-avatar-wrap and .wt-person
         declare their own --wt-state later in this sheet, and a global status
         rule would silently repaint them. */
      .wt-desk.wt-st-idle { --wt-state:color-mix(in srgb, var(--dsw-alias-label-secondary) 60%, var(--dsw-alias-label-primary)); }
      .wt-desk.wt-st-working { --wt-state:var(--dsw-alias-state-business-primary); }
      .wt-desk.wt-st-provisioning { --wt-state:var(--dsw-alias-state-business-primary); }
      .wt-desk.wt-st-waiting { --wt-state:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 56%, var(--dsw-alias-label-primary)); }
      .wt-desk.wt-st-done { --wt-state:color-mix(in srgb, var(--dsw-alias-state-success-primary) 79%, var(--dsw-alias-label-primary)); }
      .wt-desk.wt-st-error { --wt-state:color-mix(in srgb, var(--dsw-alias-state-error-primary) 53%, var(--dsw-alias-label-primary)); }
      .wt-desk.wt-st-failed { --wt-state:color-mix(in srgb, var(--dsw-alias-state-error-primary) 68%, var(--dsw-alias-label-primary)); }
      .wt-desk.wt-st-ready { --wt-state:color-mix(in srgb, var(--dsw-alias-state-business-primary) 54%, var(--dsw-alias-state-error-primary)); }
      /* Dark is its own recipe, not a re-mix of the light one: the host puts
         data-ds-dark-theme on <body>, the demo puts data-theme="dark" on <html>,
         and both are accepted. */
      :is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-idle { --wt-state:color-mix(in srgb, var(--dsw-alias-label-secondary) 54%, var(--dsw-alias-label-primary)); }
      :is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-working { --wt-state:color-mix(in srgb, var(--dsw-alias-state-business-primary) 83%, var(--dsw-alias-label-primary)); }
      :is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-provisioning { --wt-state:var(--dsw-alias-state-business-primary); }
      :is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-waiting { --wt-state:var(--dsw-alias-state-warn-primary); }
      :is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-done { --wt-state:color-mix(in srgb, var(--dsw-alias-state-success-primary) 57%, var(--dsw-alias-label-primary)); }
      :is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-error { --wt-state:var(--dsw-alias-state-error-primary); }
      :is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-failed { --wt-state:color-mix(in srgb, var(--dsw-alias-state-error-primary) 87%, var(--dsw-alias-label-primary)); }
      :is(body[data-ds-dark-theme], html[data-theme="dark"]) .wt-desk.wt-st-ready { --wt-state:color-mix(in srgb, var(--dsw-alias-state-business-primary) 51%, var(--dsw-alias-state-error-primary)); }
      .wt-avatar-wrap { position:relative; display:inline-flex; flex:none; border-radius:50%; --wt-state:color-mix(in srgb, var(--wt-raw,var(--dsw-alias-state-idle-primary)) 70%, var(--dsw-alias-label-primary)); }
      .wt-avatar-wrap::after { content:''; position:absolute; inset:-3px; border-radius:50%; border:2px solid var(--wt-state); opacity:.55; pointer-events:none; }
      .wt-row .wt-avatar-wrap::after { inset:-2px; border-width:1.5px; }
      .wt-avatar-wrap.st-provisioning::after { border-style:dashed; animation:wt-spin 2.4s linear infinite; opacity:1; }
      .wt-avatar-wrap.st-working::after { animation:wt-pulse 1.5s ease-in-out infinite; opacity:1; }
      .wt-avatar-wrap.st-waiting::after { animation:wt-pulse 1s ease-in-out infinite; opacity:1; }
      .wt-avatar-wrap.st-done::after,.wt-avatar-wrap.st-error::after,.wt-avatar-wrap.st-failed::after { opacity:1; }
      .wt-avatar-wrap.st-ready::after { opacity:.34; }
      .wt-avatar-svg { display:block; border-radius:50%; overflow:visible; }
      .wt-avatar-wrap.st-idle .wt-avatar-svg { animation:wt-breathe 4.2s ease-in-out infinite; }
      .wt-avatar-wrap.st-working .wt-avatar-svg { animation:wt-bob 1.15s ease-in-out infinite; }
      .wt-avatar-wrap.st-waiting .wt-avatar-svg { animation:wt-wait 1.8s ease-in-out infinite; }
      .wt-avatar-wrap.st-error .wt-avatar-svg { animation:wt-shake .55s ease-in-out infinite; }
      .wt-avatar-dim { opacity:.24; filter:grayscale(.75); }
      .wt-eyes { transform-box:fill-box; transform-origin:center; animation:wt-blink 5.4s infinite; }
      .wt-avatar-wrap.st-working .wt-hands { opacity:1; animation:wt-hands .42s ease-in-out infinite alternate; }
      @keyframes wt-hands { from{transform:translateY(0)} to{transform:translateY(-1.4px)} }
      .wt-bubble { position:absolute; top:-7px; right:-7px; min-width:15px; height:15px; border-radius:9px; background:var(--dsw-alias-bg-layer-3); border:0.5px solid var(--dsw-alias-state-warn-primary); color:var(--dsw-alias-state-warn-primary); font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 6px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent); animation:wt-bubble 1.1s ease-in-out infinite; }
      .wt-sparkle { position:absolute; top:-9px; right:-8px; color:var(--dsw-alias-state-success-primary); font-size:16px; line-height:1; animation:wt-sparkle 1.3s ease-out both; pointer-events:none; }

      /* ── V3 轨道：facepile / chip / 摘要 / 浮层 ──────────────────────────
         Three fixed-width segments plus one elastic summary, so the only part
         that can be squeezed is text. Every unit is flex:none with an upper
         bound, which is why no width can produce horizontal overflow. */
      .wt-facepile { display:flex; align-items:center; flex:none; transition:opacity .15s ease-out; }
      .wt-facepile .wt-seat + .wt-seat { margin-left:-6px; }
      .wt-facepile .wt-avatar-wrap { box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base); }
      .wt-seat .wt-avatar-wrap::after { display:none; }
      .wt-dock[data-density="rest"] .wt-facepile { opacity:.55; }
      .wt-dock:hover .wt-facepile, .wt-dock:focus-within .wt-facepile { opacity:1; }
      .wt-facepile .wt-seat:hover { z-index:2; }

      .wt-seat-hit { position:relative; display:inline-flex; align-items:center; justify-content:center; padding:0; border:0; border-radius:50%; background:transparent; color:inherit; font:inherit; cursor:pointer; }
      .wt-seat-hit::after { content:''; position:absolute; inset:-2px; }
      .wt-seat-hit:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      .wt-seat .wt-avatar-wrap .wt-dot { position:absolute; right:-1px; bottom:-1px; width:6px; height:6px; box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base); }

      .wt-more { flex:none; display:inline-flex; align-items:center; height:20px; margin-left:2px; padding:0 4px; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:10.5px; line-height:1; font-variant-numeric:tabular-nums; cursor:pointer; }
      .wt-more:hover { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); }
      .wt-more:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }

      /* ── V4 展开层：曲线 ──────────────────────────────────────────────────
         Two places, on purpose: .wt-dock drives the dimming of chips / summary /
         the +N chip; the three portal roots drive the fan and the card. A portal node is
         not a descendant of .wt-dock, and custom properties do not cross a portal
         boundary — defining these only on .wt-dock would make every transition
         below invalid at computed-value time. */
      .wt-dock, .wt-fan, .wt-person, .wt-person-scrim {
        --wt-ease-out: cubic-bezier(.2,.9,.25,1);
        --wt-ease-in: cubic-bezier(.5,0,.9,.4);
      }

      /* ── V4 展开层：fan ───────────────────────────────────────────────── */
      .wt-fan { position:fixed; z-index:1100; box-sizing:border-box; display:flex; align-items:flex-start; gap:var(--wt-fan-gap); touch-action:manipulation;
        --wt-fan-col:40px; --wt-fan-gap:8px; --wt-fan-pad-x:12px; --wt-fan-pad-y:10px; --wt-fan-av:32px; --wt-fan-name-size:11px; --wt-fan-name-lh:14px;
        --wt-fan-w:calc(var(--wt-fan-n,1) * var(--wt-fan-col) + (var(--wt-fan-n,1) - 1) * var(--wt-fan-gap) + 2 * var(--wt-fan-pad-x));
        padding:var(--wt-fan-pad-y) var(--wt-fan-pad-x); border:0; border-radius:var(--dsw-radius-md);
        background:var(--dsw-alias-bg-layer-3); --dsw-elevation-stroke-color:var(--dsw-alias-border-l2); box-shadow:var(--dsw-elevation-prominent);
        color:var(--dsw-alias-label-primary);
        width:var(--wt-fan-w);
        left:clamp(calc(var(--wt-fan-w) / 2 + 12px), var(--wt-fan-anchor-x, 50vw), calc(100vw - var(--wt-fan-w) / 2 - 12px));
        bottom:var(--wt-fan-bottom, 0px); translate:-50% 0;
        transform-origin:50% 100%; opacity:0; transform:translateY(4px);
        transition:opacity 120ms var(--wt-ease-out), transform 200ms var(--wt-ease-out); }
      .wt-fan[data-state="open"] { opacity:1; transform:translateY(0); }
      .wt-fan[data-state="closing"] { opacity:0; transform:translateY(4px); transition:opacity 90ms var(--wt-ease-in), transform 120ms var(--wt-ease-in); }

      .wt-fan-seat { position:relative; box-sizing:border-box; flex:0 0 var(--wt-fan-col); width:var(--wt-fan-col); display:flex; flex-direction:column; align-items:center; gap:4px;
        padding:0; border:0; border-radius:8px; background:transparent; color:inherit; font:inherit; cursor:pointer;
        --wt-dx:calc((var(--wt-i,0) - var(--wt-c,0)) * (var(--wt-fan-col) + var(--wt-fan-gap)));
        transform-origin:50% 50%; opacity:0; transform:translateX(calc(var(--wt-dx) * -1)) scale(.86);
        transition:opacity 110ms var(--wt-ease-out) calc(var(--wt-k,0) * 14ms), transform 170ms var(--wt-ease-out) calc(var(--wt-k,0) * 14ms); }
      .wt-fan[data-state="open"] .wt-fan-seat { opacity:1; transform:translateX(0) scale(1); }
      .wt-fan[data-state="closing"] .wt-fan-seat { opacity:0; transform:translateX(calc(var(--wt-dx) * -.35)) scale(.94); transition:opacity 70ms var(--wt-ease-in), transform 90ms var(--wt-ease-in); }
      .wt-fan-seat:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
      /* RoleAvatar sizes itself with an inline style, so only !important can move
         it. The single !important in this stylesheet: the alternative is copying
         the three viewport tiers into JS, which is two sources of truth. */
      .wt-fan-seat .wt-avatar-wrap { width:var(--wt-fan-av) !important; height:var(--wt-fan-av) !important; }
      .wt-fan-seat .wt-avatar-svg { width:var(--wt-fan-av); height:var(--wt-fan-av); }
      .wt-fan-seat .wt-avatar-wrap::after { inset:-2px; border-width:1.5px; }
      .wt-fan-name { max-width:var(--wt-fan-col); font-size:var(--wt-fan-name-size); line-height:var(--wt-fan-name-lh); font-weight:600; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      /* Defensive only (team cap is 8): the tail of a >8 roster opens the office. */
      .wt-fan-more { justify-content:center; min-height:var(--wt-fan-av); font-size:11px; font-weight:600; color:var(--dsw-alias-label-secondary); }
      .wt-fan-more:hover { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); }

      /* ── V4 展开层：名片 ─────────────────────────────────────────────── */
      .wt-person-scrim { position:fixed; inset:0; z-index:1300; background:var(--dsw-alias-bg-mask-1); backdrop-filter:var(--dsw-mask-blur); opacity:0; transition:opacity 140ms var(--wt-ease-out); }
      .wt-person-scrim[data-state="open"] { opacity:1; }
      .wt-person-scrim[data-state="closing"] { opacity:0; transition:opacity 120ms var(--wt-ease-in); }

      .wt-person { position:fixed; z-index:1301; box-sizing:border-box; display:flex; flex-direction:column; touch-action:manipulation;
        /* The card root carries wt-st-<status> for --wt-raw; this line derives
           --wt-state from it. Never paint with the raw idle token: on light it is
           invisible on white. 70% mix matches the row / avatar recipe. */
        --wt-state:color-mix(in srgb, var(--wt-raw, var(--dsw-alias-state-idle-primary)) 70%, var(--dsw-alias-label-primary));
        width:min(360px, calc(100vw - 32px)); max-height:calc(100vh - 48px); overflow:auto; padding:16px;
        border:0; border-radius:var(--dsw-radius-lg); background:var(--dsw-alias-bg-layer-3); --dsw-elevation-stroke-color:var(--dsw-alias-border-l2); box-shadow:var(--dsw-elevation-prominent);
        color:var(--dsw-alias-label-primary); left:50%; top:50%; translate:-50% -50%;
        transform-origin:50% 50%; opacity:0; transform:scale(.96) translateY(4px);
        transition:opacity 120ms var(--wt-ease-out), transform 180ms var(--wt-ease-out); }
      .wt-person[data-state="open"] { opacity:1; transform:scale(1) translateY(0); }
      .wt-person[data-state="closing"] { opacity:0; transform:scale(.98); transition:opacity 90ms var(--wt-ease-in), transform 100ms var(--wt-ease-in); }
      .wt-person:focus-visible { outline:none; }

      .wt-person-head { display:flex; align-items:flex-start; gap:12px; }
      .wt-person-av { flex:none; }
      .wt-person-id { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1 1 auto; }
      .wt-person-name { font-size:16px; font-weight:600; line-height:22px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-person-role { font-size:12px; line-height:16px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-person-x { flex:none; width:24px; height:24px; display:inline-grid; place-items:center; padding:0; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-tertiary); font:inherit; font-size:13px; line-height:1; cursor:pointer; }
      .wt-person-x:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
      .wt-person-x:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }

      .wt-person-pill { align-self:flex-start; display:inline-flex; align-items:center; gap:5px; height:22px; margin-top:10px; padding:0 8px; border-radius:999px; font-size:11px; font-weight:600; line-height:1; white-space:nowrap;
        border:0.5px solid color-mix(in srgb, var(--wt-state) 40%, transparent); background:color-mix(in srgb, var(--wt-state) 14%, transparent); color:var(--wt-state); }
      .wt-person-dot { flex:none; width:6px; height:6px; border-radius:50%; background:var(--wt-state); }

      .wt-person-sec { display:flex; flex-direction:column; gap:4px; margin-top:14px; }
      .wt-person-key { font-size:11px; line-height:16px; color:var(--dsw-alias-label-tertiary); }
      .wt-person-task { font-size:12px; line-height:18px; color:var(--dsw-alias-label-primary); display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
      .wt-person-task[data-empty="true"] { color:var(--dsw-alias-label-tertiary); }

      .wt-person-rule { flex:none; height:0.5px; margin:14px 0; background:var(--dsw-alias-border-l1); }
      .wt-person-facts { display:grid; grid-template-columns:56px minmax(0,1fr); gap:6px 8px; }
      .wt-person-fact-k { font-size:11px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
      .wt-person-fact-v { min-width:0; font-size:12px; line-height:18px; color:var(--dsw-alias-label-primary); font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

      .wt-person-acts { display:flex; align-items:center; gap:8px; margin-top:16px; }
      .wt-person-act { height:28px; padding:0 12px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:7px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:11px; font-weight:600; line-height:1; cursor:pointer; }
      .wt-person-act:hover { border-color:var(--dsw-alias-brand-primary); }
      .wt-person-act:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .wt-person-act[data-kind="primary"] { flex:1 1 auto; border-color:transparent; background:var(--dsw-alias-button-info-fill); color:var(--dsw-alias-label-primary-inverted); }
      .wt-person-act[data-kind="primary"]:hover { border-color:transparent; background:var(--dsw-alias-button-info-hover); }
      .wt-person-act[data-kind="stop"] { border-color:var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-state-error-primary); }
      .wt-person-act[data-kind="stop"]:hover { border-color:var(--dsw-alias-state-error-primary); }
      .wt-person-act:disabled { opacity:.45; cursor:default; border-color:var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-label-tertiary); }
      .wt-person-note { margin-top:14px; font-size:11px; line-height:16px; color:var(--dsw-alias-state-error-primary); }

      /* Only during the transition: eight seats plus two layers would otherwise
         hold ten compositor layers for the whole session. */
      .wt-fan[data-state="opening"], .wt-fan[data-state="closing"],
      .wt-person[data-state="opening"], .wt-person[data-state="closing"] { will-change:transform, opacity; }

      /* ── V4 展开层：dock 的展开态（压暗，不隐藏） ─────────────────────── */
      .wt-dock[data-fan="true"] { background:var(--dsw-alias-bg-layer-1); }
      .wt-dock[data-fan="true"] .wt-facepile { opacity:1; }
      .wt-dock[data-fan="true"] .wt-chips, .wt-dock[data-fan="true"] .wt-more { opacity:.2; pointer-events:none; }
      .wt-dock[data-fan="true"] .wt-dock-sum { opacity:.35; }
      .wt-dock[data-fan="true"] .wt-seat-tip { display:none; }
      .wt-chips, .wt-more, .wt-dock-sum { transition:opacity 120ms var(--wt-ease-out); }

      /* ── V4 展开层：视口三档（fan 是 fixed，量视口；dock 的 @container 不动）── */
      @media (max-width: 480px) {
        .wt-fan { --wt-fan-col:33px; --wt-fan-gap:6px; --wt-fan-pad-x:10px; --wt-fan-av:30px; --wt-fan-name-size:10.5px; --wt-fan-name-lh:13px; }
      }
      @media (max-width: 360px) {
        .wt-fan { --wt-fan-col:30px; --wt-fan-gap:4px; --wt-fan-pad-x:8px; --wt-fan-av:28px; }
        .wt-fan-name { display:none; }
        .wt-fan-seat { gap:0; }
        .wt-fan-seat .wt-avatar-wrap::after { display:none; }
        .wt-person { left:0; right:0; bottom:0; top:auto; width:100%; max-width:none; max-height:calc(100vh - 24px);
          translate:0 0; border-radius:var(--dsw-radius-lg) var(--dsw-radius-lg) 0 0;
          padding-bottom:max(16px, env(safe-area-inset-bottom)); transform-origin:50% 100%; transform:translateY(100%);
          transition:opacity 120ms var(--wt-ease-out), transform 220ms var(--wt-ease-out); }
        .wt-person[data-state="open"] { transform:translateY(0); }
        .wt-person[data-state="closing"] { transform:translateY(100%); transition:opacity 90ms var(--wt-ease-in), transform 160ms var(--wt-ease-in); }
      }

      .wt-chips { display:flex; align-items:center; gap:8px; flex:none; min-width:0; }
      .wt-chip { box-sizing:border-box; display:inline-flex; align-items:center; gap:6px; height:24px; padding:0 8px 0 2px; border:0.5px solid var(--dsw-alias-border-l1); border-radius:999px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; cursor:pointer; flex:none; min-width:0; transition:border-color .12s ease-out; }
      .wt-chip:hover { border-color:var(--dsw-alias-brand-primary); }
      .wt-chip:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      /* A role name is free text (roleOrFallback takes member.name), so the chip
         has to clamp it: without the cap a long name widens the fixed segment and
         pushes the chevron out, which is the one thing this track must never do. */
      .wt-chip-name { min-width:0; max-width:52px; font-size:12px; font-weight:600; line-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-chip-phrase { min-width:0; max-width:96px; font-size:11px; line-height:16px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

      .wt-dock-sum { flex:1 1 auto; min-width:0; height:100%; display:inline-flex; align-items:center; padding:0; border:0; border-radius:6px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:11px; line-height:16px; white-space:nowrap; overflow:hidden; cursor:pointer; }
      .wt-dock-sum:hover { color:var(--dsw-alias-label-primary); }
      .wt-dock-sum:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-1px; }
      .wt-dock-sum[data-error="true"] { color:var(--dsw-alias-state-error-primary); }
      .wt-sum-seg { min-width:0; overflow:hidden; text-overflow:ellipsis; }
      .wt-sum-seg + .wt-sum-seg::before { content:'·'; margin:0 6px; opacity:.5; }
      .wt-sum-chev { flex:none; margin-left:auto; padding-left:10px; color:var(--dsw-alias-label-tertiary); font-size:14px; line-height:1; transition:opacity .15s ease-out; }
      .wt-dock[data-density="rest"] .wt-sum-chev { opacity:.4; }
      .wt-dock:hover .wt-sum-chev, .wt-dock:focus-within .wt-sum-chev { opacity:1; }

      .wt-seat-tip { box-sizing:border-box; position:absolute; left:50%; bottom:calc(100% + 6px); transform:translateX(-50%); z-index:40; display:flex; align-items:center; gap:6px; height:24px; padding:0 4px 0 8px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-overlay); color:var(--dsw-alias-label-primary); font-size:11px; line-height:1; white-space:nowrap; box-shadow:0 4px 12px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent); opacity:0; visibility:hidden; pointer-events:none; transition:opacity .12s ease-out, visibility 0s linear .12s; }
      .wt-seat-tip::after { content:''; position:absolute; left:0; right:0; bottom:-8px; height:8px; }
      .wt-seat:hover .wt-seat-tip, .wt-seat:focus-within .wt-seat-tip { opacity:1; visibility:visible; pointer-events:auto; transition-delay:.38s, .38s; }
      /* A keyboard visitor cannot wait 380ms for the entry it just tabbed to. */
      .wt-seat:focus-within .wt-seat-tip { transition-delay:0s, 0s; }
      .wt-seat[data-tip="true"] .wt-seat-tip { opacity:1; visibility:visible; pointer-events:auto; transition-delay:0s, 0s; }
      .wt-facepile .wt-seat:first-child .wt-seat-tip { left:0; transform:none; }
      .wt-chips .wt-seat:last-child .wt-seat-tip { left:auto; right:0; transform:none; }
      .wt-tip-name { font-weight:600; }
      .wt-tip-role, .wt-tip-task { color:var(--dsw-alias-label-secondary); }
      .wt-tip-task { max-width:120px; overflow:hidden; text-overflow:ellipsis; }
      .wt-tip-act { flex:none; display:inline-grid; place-items:center; width:18px; height:18px; padding:0; border:0; border-radius:5px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:10px; line-height:1; cursor:pointer; }
      .wt-tip-act:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
      .wt-tip-act:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }

      /* Container queries measure the CONTENT box, so the doc's border-box tiers
         (672 / 480 / 320) are shifted by the 14px padding on each side: 643 / 451
         / 291. Measured, not assumed — at 672 the content box is 644 and the raw
         671 query had already collapsed the second chip. */
      @container (max-width: 643px) { .wt-chip[data-rank="2"] { display:none; } }
      @container (max-width: 451px) { .wt-chips { display:none; } }
      @container (max-width: 451px) { .wt-sum-seg + .wt-sum-seg { display:none; } }
      @container (max-width: 291px) { .wt-dock-sum .wt-sum-seg { display:none; } }
      .wt-panel { position:relative; display:flex; flex-direction:column; width:100%; height:100%; min-width:0; min-height:0; container-type:inline-size; color:var(--dsw-alias-label-primary); }
      .wt-panel-head { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:8px; height:28px; min-height:28px; padding:0 8px 0 10px; box-sizing:border-box; background:var(--dsw-alias-bg-layer-1); border-bottom:0.5px solid var(--dsw-alias-border-l1); }
      .wt-panel-stats { display:flex; align-items:baseline; gap:10px; min-width:0; flex:1; font-size:10.5px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; font-variant-numeric:tabular-nums; }
      .wt-head-stat { min-width:0; overflow:hidden; text-overflow:ellipsis; }
      .wt-head-stat + .wt-head-stat::before { content:'·'; margin-right:6px; opacity:.5; }
      .wt-seg { display:flex; align-items:stretch; gap:2px; height:28px; min-height:28px; padding:0 6px; box-sizing:border-box; border-bottom:0.5px solid var(--dsw-alias-border-l1); }
      .wt-seg-btn { flex:none; font:inherit; font-size:11px; padding:0 8px; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; }
      .wt-seg-btn:hover { color:var(--dsw-alias-label-primary); }
      .wt-seg-btn.active { color:var(--dsw-alias-label-primary); border-bottom-color:var(--dsw-alias-brand-primary); font-weight:600; }
      .wt-seg-btn:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:-2px; }
      .wt-panel-body { flex:1; min-height:0; overflow-y:auto; padding:0 10px 10px; scrollbar-width:thin; }
      .wt-panel-body::-webkit-scrollbar { width:4px; }
      .wt-panel-body::-webkit-scrollbar-thumb { background:var(--dsw-alias-border-l2); border-radius:9px; }
      .wt-panel-error { padding:6px 0; }
      .wt-list { display:flex; flex-direction:column; }
      .wt-row { position:relative; display:flex; align-items:center; gap:8px; box-sizing:border-box; width:100%; height:44px; min-height:44px; padding:7px 6px; border:0; border-radius:8px; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; transition:background .12s ease-out; --wt-state:color-mix(in srgb, var(--wt-raw,var(--dsw-alias-state-idle-primary)) 70%, var(--dsw-alias-label-primary)); }
      .wt-row + .wt-row { box-shadow:inset 0 0.5px 0 var(--dsw-alias-border-l1); }
      .wt-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
      /* The row's own control is a real button stretched over the whole row, so the
         pause button can be a sibling instead of a nested interactive element. The
         child list below is explicit on purpose: a "> *" wildcard would also match
         .wt-row-hit and switch off the hit area itself. */
      .wt-row-hit { position:absolute; inset:0; z-index:0; margin:0; padding:0; border:0; border-radius:8px; background:transparent; cursor:pointer; }
      .wt-row-hit:focus-visible { outline:none; }
      .wt-row-hit:focus-visible::before { content:''; position:absolute; left:0; top:calc(50% - 14px); width:2px; height:28px; border-radius:2px; background:var(--dsw-alias-state-business-primary); }
      .wt-row > .wt-avatar-wrap, .wt-row > .wt-row-main, .wt-row > .wt-row-state, .wt-row > .wt-row-hand { position:relative; z-index:1; pointer-events:none; }
      .wt-row::after { content:''; position:absolute; inset:0; border-radius:8px; pointer-events:none; opacity:0; }
      .wt-row[data-wt-handoff]::after { animation:wt-flash .48s ease-out both; }
      @keyframes wt-flash { from{opacity:1;background:var(--dsw-alias-interactive-bg-active)} to{opacity:0} }
      .wt-row-main { display:flex; flex-direction:column; gap:1px; min-width:0; flex:1; }
      .wt-row-name { font-size:12px; font-weight:600; line-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-row-role { font-size:11px; line-height:14px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-row-state { margin-left:auto; flex:none; display:inline-flex; align-items:center; gap:5px; }
      .wt-row-dot { width:8px; height:8px; border-radius:50%; flex:none; background:var(--wt-state); }
      .wt-row-state-label { font-size:11px; color:var(--dsw-alias-label-secondary); white-space:nowrap; }
      .wt-row-act { position:relative; z-index:2; flex:none; width:24px; height:24px; display:inline-grid; place-items:center; padding:0; border-radius:6px; border:0.5px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); font:inherit; font-size:9px; line-height:1; cursor:pointer; opacity:0; pointer-events:none; transition:opacity .12s ease-out, border-color .12s, color .12s; }
      .wt-row:hover .wt-row-act, .wt-row:focus-within .wt-row-act { opacity:1; pointer-events:auto; }
      .wt-row-act:hover { border-color:var(--dsw-alias-state-error-primary); color:var(--dsw-alias-state-error-primary); }
      .wt-row-act:focus-visible { opacity:1; pointer-events:auto; outline:2px solid var(--dsw-alias-state-error-primary); outline-offset:1px; }
      .wt-row-hand { flex:none; font-size:10.5px; line-height:14px; color:var(--dsw-alias-state-business-primary); white-space:nowrap; animation:wt-hand-in .32s ease-out both; }
      @keyframes wt-hand-in { from{opacity:0;transform:translateX(2px)} to{opacity:1;transform:translateX(0)} }
      .wt-row-empty { cursor:default; }
      .wt-row-empty:hover { background:transparent; }
      .wt-row-empty .wt-row-name { color:var(--dsw-alias-label-secondary); font-weight:500; }
      .wt-row-empty .wt-avatar-wrap::after { opacity:.15; }
      .wt-row-empty .wt-row-state-label { opacity:.7; }
      /* ── A · corridor of desks (OfficeTab). The .wt-row rules above stay
         untouched: tests read them, and the tasks tab still uses the rhythm. */
      /* V5: one road for the whole corridor. It lives on .wt-road-track (the
         in-flow column that holds every floor), so it is exactly as tall as the
         content, its centre line never breaks at a floor seam, and it scrolls
         with the desks instead of against them. --wt-lane is the single source
         of the lane width: the floor grid, the road and the walker all read it,
         which is what keeps the 46→56px switch in one place. */
      /* The column does NOT scroll: .wt-panel-body owns the scroll. A height on
         this element would shrink an absolutely positioned road to the viewport,
         so there is deliberately no overflow here. */
      .wt-corridor { position:relative; display:flex; flex-direction:column; min-height:0; max-width:380px; margin-inline:auto; width:100%; --wt-lane:46px; --wt-ease-out:cubic-bezier(.2,.9,.25,1); --wt-ease-in:cubic-bezier(.5,0,.9,.4); --wt-road-surface:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); --wt-road-edge:color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent); --wt-road-line:color-mix(in srgb, var(--dsw-alias-label-primary) 32%, transparent); --wt-road-cap:color-mix(in srgb, var(--dsw-alias-label-primary) 26%, transparent); --wt-road-stub:color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent); }
      .wt-road-track { position:relative; flex:none; display:flex; flex-direction:column; gap:8px; }
      .wt-road { position:absolute; top:0; bottom:0; left:calc(50% - var(--wt-lane) / 2); width:var(--wt-lane); z-index:0; pointer-events:none; border-radius:6px; background-color:var(--wt-road-surface); background-image:repeating-linear-gradient(to bottom, var(--wt-road-line) 0 6px, transparent 6px 15px); background-size:1px 100%; background-position:center; background-repeat:no-repeat; box-shadow:inset 1px 0 0 var(--wt-road-edge), inset -1px 0 0 var(--wt-road-edge); }
      .wt-road::before, .wt-road::after { content:''; position:absolute; left:3px; right:3px; height:3px; border-radius:2px; background:var(--wt-road-cap); }
      .wt-road::before { top:2px; }
      .wt-road::after { bottom:2px; }
      .wt-floor { position:relative; display:grid; grid-template-columns:1fr var(--wt-lane) 1fr; grid-template-rows:94px; height:94px; }
      .wt-desk { position:relative; grid-row:1; width:min(150px, calc(100% - 7px)); height:94px; border-radius:8px; /* fallback only: every desk also carries a .wt-st-* recipe above */ --wt-state:var(--dsw-alias-label-secondary); }
      .wt-desk[data-side="left"] { grid-column:1; justify-self:end; margin-right:7px; }
      .wt-desk[data-side="right"] { grid-column:3; justify-self:start; margin-left:7px; }
      /* Every desk connects to the road: a 2px branch from the desk's
         lane-facing edge to the lane centre, so the corridor reads as a street
         with driveways instead of a strip behind the furniture. The 7px is the
         desk's own margin to the lane; the rest is half a lane. */
      .wt-desk::before { content:''; position:absolute; top:calc(50% - 1px); width:calc(7px + var(--wt-lane) / 2); height:2px; border-radius:1px; background:var(--wt-road-stub); }
      .wt-desk[data-side="left"]::before { left:calc(100% - 1px); }
      .wt-desk[data-side="right"]::before { right:calc(100% - 1px); }
      .wt-desk-hit { position:absolute; inset:0; z-index:6; margin:0; padding:0; border:0; border-radius:8px; background:transparent; cursor:pointer; }
      .wt-desk-hit:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:1px; }
      .wt-desk-chair { position:absolute; left:2px; bottom:50px; width:56px; height:30px; z-index:0; border-radius:9px 9px 3px 3px; background:color-mix(in srgb, var(--dsw-alias-label-primary) 15%, var(--dsw-alias-bg-layer-1)); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent); }
      .wt-desk-av { position:absolute; left:8px; bottom:46px; width:44px; height:46px; z-index:1; }
      .wt-desk-sparkle { position:absolute; left:44px; bottom:80px; z-index:5; font-size:10px; color:var(--dsw-alias-state-business-primary); }
      .wt-desk-mon { position:absolute; right:8px; bottom:60px; width:34px; height:22px; z-index:2; border-radius:2px; background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, var(--dsw-alias-bg-layer-1)); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); }
      .wt-desk-mon::before { content:''; position:absolute; left:2px; right:2px; top:2px; height:16px; background:color-mix(in srgb, var(--dsw-alias-label-primary) 88%, var(--dsw-alias-bg-layer-1)); box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); }
      .wt-desk-mon::after { content:''; position:absolute; left:50%; margin-left:-1px; top:100%; width:2px; height:7px; background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, var(--dsw-alias-bg-layer-1)); }
      .wt-desk-foot { position:absolute; right:19px; bottom:50px; width:12px; height:3px; z-index:2; border-radius:1px; background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, var(--dsw-alias-bg-layer-1)); }
      .wt-desk-top { position:absolute; left:0; right:0; bottom:40px; height:10px; z-index:3; border-radius:2px 2px 0 0; background:color-mix(in srgb, var(--dsw-alias-label-primary) 15%, var(--dsw-alias-bg-layer-1)); box-shadow:inset 0 2px 0 var(--dsw-alias-bg-layer-1), inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent); }
      .wt-desk-front { position:absolute; left:0; right:0; bottom:28px; height:12px; z-index:3; background:color-mix(in srgb, var(--dsw-alias-label-primary) 15%, var(--dsw-alias-bg-layer-1)); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--dsw-alias-label-primary) 30%, transparent); }
      .wt-desk-front::before, .wt-desk-front::after { content:''; position:absolute; top:100%; width:5px; height:16px; background:color-mix(in srgb, var(--dsw-alias-label-primary) 15%, var(--dsw-alias-bg-layer-1)); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent); }
      .wt-desk-front::before { left:1px; }
      .wt-desk-front::after { right:1px; }
      /* V5 plate: one line — name · dot · status word. The dot is the colour,
         the word is the meaning; neither is ever rendered alone, so the status
         survives a colour-blind reader and a 150px desk alike. The name is the
         only part that may ellipsize: a long teammate name must never eat the
         status. */
      .wt-desk-plate { position:absolute; left:0; right:0; bottom:0; height:28px; z-index:4; display:flex; flex-direction:row; align-items:center; gap:5px; padding:0 8px; min-width:0; overflow:hidden; }
      /* 8px so the hue survives at a glance; the 1.5px surface ring cuts the dot
         out of the text it sits between instead of blurring its own edge. */
      .wt-desk-dot { flex:none; width:8px; height:8px; border-radius:50%; background:var(--wt-state); box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1); }
      .wt-desk-name { flex:0 1 auto; min-width:0; font-size:12px; font-weight:600; line-height:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      /* The name is the only segment that may shrink (the status word has
         flex-shrink 0), so a narrow plate eats the name first — and the three
         segments stay adjacent, left-aligned: no grow, no spacer. 70% is the
         ceiling for a pathological status. */
      .wt-desk-state { flex:0 0 auto; min-width:0; max-width:70%; font-size:11px; line-height:1; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-desk-act { position:absolute; right:6px; top:6px; z-index:7; width:18px; height:18px; padding:0; border:0; border-radius:5px; font-size:9px; line-height:18px; text-align:center; cursor:pointer; color:var(--dsw-alias-label-secondary); background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 88%, transparent); box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1); }
      .wt-desk-act:hover { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-interactive-bg-hover); }
      .wt-desk[data-wt-handoff]::after { content:''; position:absolute; inset:0; border-radius:8px; pointer-events:none; opacity:0; animation:wt-flash .48s ease-out both; }
      /* Shape is a second channel beside colour: filled = present and fine,
         hollow = not seated yet / gone / failed. A hollow dot still carries the
         word next to it, so nothing here is colour-only. */
      .wt-desk[data-wt-status="provisioning"] .wt-desk-dot,
      .wt-desk[data-wt-status="failed"] .wt-desk-dot,
      .wt-desk[data-wt-absent="true"] .wt-desk-dot { background:transparent; box-shadow:inset 0 0 0 1.5px var(--wt-state); }
      .wt-desk-empty .wt-desk-dot { background:transparent; box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-secondary) 55%, transparent); }
      /* Breathing on opacity only: a scale here would fight wt-dot-take. */
      .wt-desk[data-wt-status="waiting"] .wt-desk-dot { animation:wt-pulse 1.6s ease-in-out infinite; }
      /* Source order matters: pulse, then ping, then take — the one-shot that
         reports an arrival must win over the looping ones. */
      /* No fill: the mark lives 1600ms and the ping 1200ms. With a backwards +
         forwards fill the last frame (a transparent 5px shadow) would keep
         overriding the dot's own ring for those 400ms — and the giver's dot is
         hollow by then, so it would vanish. */
      .wt-desk[data-wt-handoff="out"] .wt-desk-dot { animation:wt-dot-ping 1.2s var(--wt-ease-out) 1; }
      @keyframes wt-dot-ping { 0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--wt-state) 55%, transparent)} 100%{box-shadow:0 0 0 5px transparent} }
      /* V5 receive: the sheet leaves the walker's hand at the give phase, drops
         into the plate, the plate flashes in the member's own state colour and
         the dot pulses — four one-shots, all keyed off one attribute that only
         exists while a real walk is playing. The gift is a sibling of the plate,
         not a child: the plate clips its overflow. */
      .wt-desk[data-wt-receive] .wt-desk-plate { animation:wt-plate-take .8s ease-out both; }
      .wt-desk[data-wt-receive] .wt-desk-dot { animation:wt-dot-take .8s ease-out both; }
      .wt-desk[data-wt-receive] .wt-fig { animation:wt-fig-take .7s ease-out both; }
      /* Paper is ink on a sheet, not white on white: 5% fill + a 36% edge reads
         at 2.35:1 on the light theme and 3.17:1 on the dark one. */
      .wt-desk-gift { --wt-gift-dx:-6px; --wt-gift-dx-near:-1px; position:absolute; right:8px; bottom:6px; width:14px; height:18px; z-index:5; border-radius:2px; background:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-layer-1)); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 36%, transparent), 0 2px 5px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); animation:wt-gift-drop .5s cubic-bezier(.2,.7,.3,1) both; }
      /* The sheet comes from the hand, so both its anchor and its drift point at
         the lane — which is on the right of a left desk and on the left of a
         right desk. */
      .wt-desk[data-side="left"] .wt-desk-gift { --wt-gift-dx:6px; --wt-gift-dx-near:1px; }
      .wt-desk[data-side="right"] .wt-desk-gift { right:auto; left:8px; }
      .wt-desk-gift::before, .wt-desk-gift::after { content:''; position:absolute; left:3px; right:3px; height:1px; background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); }
      .wt-desk-gift::before { top:5px; }
      .wt-desk-gift::after { top:9px; }
      @keyframes wt-plate-take { 0%{background:transparent} 18%{background:color-mix(in srgb, var(--wt-state) 20%, transparent)} 100%{background:transparent} }
      @keyframes wt-dot-take { 0%,100%{transform:scale(1)} 30%{transform:scale(1.9)} 60%{transform:scale(1)} 78%{transform:scale(1.4)} }
      @keyframes wt-fig-take { 0%{transform:translateY(0) rotate(0)} 40%{transform:translateY(-2px) rotate(-4deg)} 100%{transform:translateY(0) rotate(0)} }
      /* -6px keeps the drop coming from the lane side, i.e. from the hand. */
      @keyframes wt-gift-drop { 0%{opacity:0;transform:translate(var(--wt-gift-dx,-6px),-36px) rotate(-10deg) scale(.9)} 20%{opacity:1} 70%{opacity:1;transform:translate(var(--wt-gift-dx-near,-1px),-2px) rotate(0) scale(1)} 100%{opacity:0;transform:translate(0,0) scale(.96)} }
      .wt-desk-empty { cursor:default; }
      .wt-desk-chair-empty { left:50%; margin-left:-22px; bottom:56px; width:44px; height:28px; }
      .wt-desk-seat { position:absolute; left:32px; bottom:50px; width:40px; height:7px; z-index:1; border-radius:3px; background:color-mix(in srgb, var(--dsw-alias-label-primary) 15%, var(--dsw-alias-bg-layer-1)); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 24%, transparent); }
            .wt-desk-empty .wt-desk-name { color:var(--dsw-alias-label-secondary); font-weight:500; }
            .wt-desk[data-wt-absent="true"] .wt-fig { opacity:0; }
      .wt-st-idle .wt-fig-body { animation:wt-breathe 4.2s ease-in-out infinite; }
      .wt-st-working .wt-fig-body { animation:wt-bob 1.15s ease-in-out infinite; }
      .wt-st-waiting .wt-fig-body { animation:wt-wait 1.8s ease-in-out infinite; }
      .wt-st-error .wt-fig-body { animation:wt-shake .55s ease-in-out infinite; }
      .wt-st-failed .wt-fig { opacity:.55; }
      .wt-fig-body { transform-box:fill-box; transform-origin:50% 100%; }
      /* A giver leaves and returns without a cut, and the 3deg nod pose eases
         back to upright instead of snapping. Animations win over transitions, so
         wt-stand / wt-fig-give / wt-fig-take are unaffected; the reduced-motion
         block below kills both properties. */
      .wt-fig { transition:opacity .18s ease-out, transform .18s ease-out; }
      .wt-walker { position:absolute; left:calc(50% - 22px); width:44px; height:44px; z-index:7; pointer-events:none; display:flex; align-items:flex-end; justify-content:center; --wt-card-dx:9px; }
      /* A right-side receiver takes the sheet to the left. */
      .wt-walker[data-to-side="left"] { --wt-card-dx:-9px; }
      /* Duration and the pick delay are computed per row by the Corridor and
         arrive as inline variables, so the CSS and the phase timers share one
         clock. linear, not steps(): at seven rows a step would jump 30px. */
      .wt-walker[data-phase="out"] { animation:wt-walk-out var(--wt-walk-ms, 400ms) linear var(--wt-pick-ms, 420ms) forwards; }
      /* The walk back ends with a 180ms fade, in the same beat as the giver's
         figure fading back in (absent is cleared at tEnd - 180). */
      .wt-walker[data-phase="back"] { animation:wt-walk-back var(--wt-back-ms, 200ms) linear forwards, wt-seat-fade 180ms ease-out var(--wt-back-ms, 200ms) forwards; }
      .wt-walker[data-phase="give"], .wt-walker[data-phase="nod"], .wt-walker[data-phase="chat"] { transform:translateY(var(--wt-dy)); }
      /* The sheet the walker carries: a 14×18 span with two ruled lines, no
         dependency. Handoffs carry one; a dialogue (when the host projects one)
         does not. Held at -8°: the pick ends there and the give starts there, so
         the phase switch does not snap the card upright. */
      .wt-walker-card { position:absolute; right:1px; bottom:17px; width:14px; height:18px; border-radius:2px; transform:rotate(-8deg); background:color-mix(in srgb, var(--dsw-alias-label-primary) 5%, var(--dsw-alias-bg-layer-1)); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-label-primary) 36%, transparent), 0 2px 5px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); }
      .wt-walker-card::before, .wt-walker-card::after { content:''; position:absolute; left:3px; right:3px; height:1px; background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); }
      .wt-walker-card::before { top:5px; }
      .wt-walker-card::after { top:9px; }
      /* ① stand up, ② take the sheet out of the plate, then the walk carries it. */
      .wt-walker[data-phase="out"] .wt-fig { animation:wt-stand 120ms var(--wt-ease-out) both; }
      .wt-walker[data-phase="out"] .wt-walker-card { animation:wt-card-pick 300ms cubic-bezier(.34,1.2,.64,1) 120ms both; }
      /* giver pose: lean toward the receiver and extend the sheet; the give
         phase is the only one where the card leaves the hand. The give window is
         140ms (spec §4.2), so both animations are 140ms — a longer one would be
         cut at 53% opacity by the nod phase's display:none. */
      .wt-walker[data-phase="give"] .wt-fig { animation:wt-fig-give 140ms var(--wt-ease-out) both; }
      .wt-walker[data-phase="give"] .wt-walker-card { animation:wt-card-give 140ms var(--wt-ease-out) both; }
      .wt-walker[data-phase="nod"] .wt-walker-card, .wt-walker[data-phase="back"] .wt-walker-card { display:none; }
      /* Same value as the give animation's last frame: with no animation running
         in the nod phase, this is what keeps the pose from snapping upright. */
      .wt-walker[data-phase="nod"] .wt-fig { transform:translate(2px,0) rotate(3deg); }
      @keyframes wt-walk-out { from { transform:translateY(0); } to { transform:translateY(var(--wt-dy)); } }
      @keyframes wt-walk-back { from { transform:translateY(var(--wt-dy)); } to { transform:translateY(0); } }
      @keyframes wt-stand { from { transform:translateY(2px) scale(.96); } to { transform:translateY(0) scale(1); } }
      @keyframes wt-seat-fade { to { opacity:0; } }
      @keyframes wt-card-pick { from { opacity:0; transform:translateY(34px) rotate(0deg) scale(.82); } to { opacity:1; transform:translateY(0) rotate(-8deg) scale(1); } }
      @keyframes wt-fig-give { 0%{transform:translate(0,0) rotate(0)} 60%{transform:translate(3px,-1px) rotate(4deg)} 100%{transform:translate(2px,0) rotate(3deg)} }
      @keyframes wt-card-give { 0%{opacity:1;transform:translate(0,0) rotate(-8deg)} 100%{opacity:0;transform:translate(var(--wt-card-dx,9px),-7px) rotate(6deg)} }
      @container (min-width: 340px) {
        .wt-corridor { --wt-lane:56px; }
      }
      .wt-pill { display:inline-flex; align-items:center; gap:4px; align-self:flex-start; padding:2px 7px; border-radius:99px; font-size:10px; font-weight:600; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); border:0.5px solid var(--dsw-alias-border-l1); white-space:nowrap; }
      .wt-btn { font:inherit; font-size:11px; border-radius:7px; border:0.5px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); padding:4px 9px; cursor:pointer; }
      .wt-btn:hover { border-color:var(--dsw-alias-brand-primary); }
      .wt-btn:disabled { opacity:.45; cursor:default; }
      .wt-section-title { display:flex; align-items:center; gap:8px; margin:0 0 8px; font-size:12px; font-weight:600; color:var(--dsw-alias-label-secondary); }
      .wt-task-columns { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; min-height:260px; }
      .wt-task-column { display:flex; flex-direction:column; gap:8px; min-width:0; padding:10px; border:0.5px solid var(--dsw-alias-border-l1); border-radius:11px; background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 55%, transparent); }
      .wt-task-column h3 { display:flex; align-items:center; gap:6px; margin:0 0 2px; font-size:12px; font-weight:600; }
      .wt-task-count { margin-left:auto; font-size:10px; color:var(--dsw-alias-label-secondary); font-variant-numeric:tabular-nums; }
      .wt-task { display:flex; flex-direction:column; gap:5px; padding:9px 10px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:9px; background:var(--dsw-alias-bg-layer-2); }
      .wt-task strong { font-size:12px; font-weight:600; line-height:1.4; }
      .wt-task p { margin:0; font-size:11px; line-height:1.5; color:var(--dsw-alias-label-secondary); white-space:pre-wrap; }
      .wt-task-meta { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:10px; color:var(--dsw-alias-label-secondary); }
      .wt-task-warning { color:var(--dsw-alias-state-warn-primary); }
      .wt-task-empty { padding:14px 10px; border:0.5px dashed var(--dsw-alias-border-l2); border-radius:9px; color:var(--dsw-alias-label-secondary); font-size:11px; line-height:1.5; }
      /* The team page follows the Models page frame: a 720px column with a 16px
         title and a 14px tertiary intro, then the groups at the settings scale
         (13–14px, not the old 380px drawer's 11px). The shell owns scrolling. */
      .wt-settings-section { display:flex; flex-direction:column; gap:20px; min-width:0; max-width:720px; font-size:13px; line-height:1.55; color:var(--dsw-alias-label-primary); }
      .wt-settings-title { margin:0; font-size:16px; font-weight:500; line-height:24px; color:var(--dsw-alias-label-primary); }
      .wt-settings-intro { margin:0; font-size:14px; line-height:22px; color:var(--dsw-alias-label-tertiary); }
      .wt-settings-group { display:flex; flex-direction:column; gap:10px; min-width:0; }
      /* A number/cadence select does not need the full column; capping keeps the
         page reading as settings rows rather than four stretched bars. */
      .wt-settings-group > .wt-field { max-width:320px; }
      .wt-settings-section .wt-section-title { margin:0; font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); }
      .wt-settings-section .wt-btn { margin-left:auto; height:26px; padding:0 10px; font-size:12px; }
      /* auto-fit keeps the two-column rhythm on the 560px column and collapses
         to one column without overflowing when the panel gets narrow. */
      .wt-settings-roles { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px 18px; min-width:0; }
      .wt-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
      .wt-field label { font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); }
      .wt-field small { font-size:12px; line-height:1.5; color:var(--dsw-alias-label-secondary); }
      .wt-field select,.wt-field input[type="text"] { width:100%; box-sizing:border-box; font:inherit; font-size:13px; height:32px; padding:0 8px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-sm); }
      .wt-field select:focus-visible,.wt-field input[type="text"]:focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .wt-role-row { display:flex; flex-direction:column; gap:5px; min-width:0; }
      .wt-role-name { display:flex; align-items:baseline; gap:6px; min-width:0; font-size:13px; color:var(--dsw-alias-label-primary); }
      .wt-role-name small { min-width:0; font-size:12px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-check { display:flex; align-items:flex-start; gap:8px; font-size:13px; line-height:1.5; color:var(--dsw-alias-label-primary); }
      .wt-check input { margin-top:2px; flex:none; }
      .wt-note { font-size:12px; line-height:1.6; color:var(--dsw-alias-label-secondary); padding:9px 10px; border-radius:var(--dsw-radius-sm); background:var(--dsw-alias-bg-layer-1); border:0.5px solid var(--dsw-alias-border-l1); }
      .wt-error { font-size:10.5px; color:var(--dsw-alias-state-error-primary); }
      .wt-settings-section .wt-error { font-size:13px; }
      .wt-saving { font-size:12px; color:var(--dsw-alias-label-secondary); }
      @keyframes wt-breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.018)} }
      @keyframes wt-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
      @keyframes wt-wait { 0%,100%{transform:rotate(-1.5deg)} 50%{transform:rotate(1.5deg)} }
      @keyframes wt-blink { 0%,92%,100%{transform:scaleY(1)} 96%{transform:scaleY(.12)} }
      @keyframes wt-spin { to{transform:rotate(360deg)} }
      @keyframes wt-pulse { 0%,100%{opacity:.55} 50%{opacity:1} }
      @keyframes wt-shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-1px)} 75%{transform:translateX(1px)} }
      @keyframes wt-bubble { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-2px)} }
      @keyframes wt-sparkle { 0%{opacity:0;transform:scale(.4) rotate(0)} 35%{opacity:1;transform:scale(1.15) rotate(18deg)} 100%{opacity:0;transform:scale(.7) rotate(45deg) translateY(-6px)} }
      .wt-seat { position:relative; display:inline-flex; flex-direction:row; align-items:center; flex:none; }
      /* The dispatch surface is an input, not a card: no lift on hover. */
      .wt-card.wt-seat-open:hover { transform:none; }
      .wt-seat-open { display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:6px 8px; min-height:54px; min-width:0; width:100%; max-width:min(100%, 420px); box-sizing:border-box; cursor:default; }
      .wt-seat-open[data-error="true"] { border-color:var(--dsw-alias-state-error-primary); }
      .wt-seat-input { flex:1 1 60px; min-width:0; box-sizing:border-box; height:30px; padding:0 8px; font:inherit; font-size:11px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:0.5px solid var(--dsw-alias-border-l1); border-radius:7px; outline:none; }
      .wt-seat-input::placeholder { color:var(--dsw-alias-label-caption); }
      .wt-seat-input:focus { box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent); }
      .wt-seat-send { flex:none; width:24px; height:24px; padding:0; display:inline-grid; place-items:center; border:0; border-radius:999px; background:var(--dsw-alias-button-info-fill); color:var(--dsw-alias-label-primary-inverted); font:inherit; font-size:11px; line-height:1; cursor:pointer; }
      .wt-seat-send:hover:not(:disabled) { background:var(--dsw-alias-button-info-hover); }
      .wt-seat-send:disabled { opacity:.4; cursor:default; }
      .wt-seat-sent { flex:1; min-width:0; font-size:11px; color:var(--dsw-alias-state-success-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-seat-error { flex:1 0 100%; min-width:0; font-size:10.5px; line-height:16px; color:var(--dsw-alias-state-error-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-dispatch { position:absolute; left:14px; bottom:8px; z-index:120; box-sizing:border-box; width:min(calc(100% - 28px), 560px); padding:6px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-3); color:var(--dsw-alias-label-primary); box-shadow:0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); transform-origin:bottom left; animation:wt-dispatch-in .12s ease-out both; }
      @keyframes wt-dispatch-in { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
      .wt-dispatch-list { max-height:min(328px, 45vh); overflow-y:auto; padding:4px 0; scrollbar-width:thin; }
      .wt-dispatch-list::-webkit-scrollbar { width:4px; }
      .wt-dispatch-list::-webkit-scrollbar-thumb { background:var(--dsw-alias-border-l2); border-radius:9px; }
      .wt-dispatch-row { position:relative; display:flex; align-items:center; gap:8px; box-sizing:border-box; width:100%; height:40px; padding:0 8px; border:0; border-radius:8px; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; }
      .wt-dispatch-row + .wt-dispatch-row { margin-top:1px; }
      .wt-dispatch-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .wt-dispatch-row.active { background:var(--dsw-alias-interactive-bg-active); }
      .wt-dispatch-row.active::before { content:''; position:absolute; left:2px; top:calc(50% - 12px); width:2px; height:24px; border-radius:2px; background:var(--dsw-alias-brand-primary); }
      .wt-dispatch-row.idle { cursor:default; opacity:.7; }
      .wt-dispatch-row.idle:hover { background:transparent; }
      .wt-dispatch-id { display:flex; flex-direction:column; gap:1px; min-width:0; flex:1; }
      .wt-dispatch-name { font-size:12px; font-weight:600; line-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-dispatch-row.idle .wt-dispatch-name { color:var(--dsw-alias-label-secondary); }
      .wt-dispatch-role { font-size:10.5px; line-height:14px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-dispatch-state { margin-left:auto; flex:none; display:inline-flex; align-items:center; gap:5px; font-size:10px; color:var(--dsw-alias-label-secondary); white-space:nowrap; }
      .wt-dispatch-compose { display:flex; align-items:center; gap:8px; height:44px; padding:0 6px; box-sizing:border-box; }
      .wt-dispatch-target { display:inline-flex; align-items:center; gap:8px; flex:none; font-size:12px; font-weight:600; }
      .wt-dispatch-input { flex:1; min-width:0; box-sizing:border-box; height:30px; padding:0 8px; font:inherit; font-size:12px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); border:0.5px solid var(--dsw-alias-border-l1); border-radius:7px; outline:none; }
      .wt-dispatch-input::placeholder { color:var(--dsw-alias-label-caption); }
      .wt-dispatch-input:focus { box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 35%, transparent); }
      .wt-dispatch-send { flex:none; width:28px; height:28px; padding:0; display:inline-grid; place-items:center; border:0; border-radius:999px; background:var(--dsw-alias-button-info-fill); color:var(--dsw-alias-label-primary-inverted); font:inherit; font-size:12px; line-height:1; cursor:pointer; }
      .wt-dispatch-send:hover:not(:disabled) { background:var(--dsw-alias-button-info-hover); }
      .wt-dispatch-send:disabled { opacity:.4; cursor:default; }
      .wt-dispatch-sent { display:inline-flex; align-items:center; gap:8px; flex:1; min-width:0; font-size:12px; color:var(--dsw-alias-state-success-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .wt-dispatch-error { margin-top:4px; padding:0 8px; height:18px; font-size:10.5px; line-height:18px; color:var(--dsw-alias-state-error-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      @container (max-width: 340px) {
        .wt-row-role, .wt-row-state-label { display:none; }
        .wt-head-tokens { display:none; }
      }
      @container (min-width: 560px) {
        .wt-list { display:grid; grid-template-columns:1fr 1fr; column-gap:8px; }
        .wt-row + .wt-row { box-shadow:none; }
      }
      @container (max-width: 520px) {
        .wt-task-columns { grid-template-columns:1fr; }
      }
      @media (hover: none) {
        .wt-row-act { opacity:1; pointer-events:auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        .wt-avatar-svg, .wt-eyes, .wt-avatar-wrap::after, .wt-dot, .wt-bubble, .wt-sparkle { animation:none !important; }
        .wt-card, .wt-dispatch, .wt-dispatch-row, .wt-seat-input, .wt-chip, .wt-seat-tip, .wt-more, .wt-dock-sum, .wt-sum-chev, .wt-facepile, .wt-tip-act, .wt-seat-hit { animation:none !important; transition:none !important; }
        .wt-row, .wt-row-hand, .wt-row-act, .wt-seg-btn { animation:none !important; transition:none !important; }
        /* V5: the handoff flash is opacity-only (wt-flash moves nothing), so it
           survives reduced motion — it is the fallback the walker degrades to,
           not a casualty of the query. The walker and the gift never mount, and
           the receive one-shots stay off even if the attribute ever leaks in. */
        .wt-row[data-wt-handoff]::after, .wt-desk[data-wt-handoff]::after { animation:wt-flash .48s ease-out both !important; }
        .wt-walker, .wt-desk-gift { display:none !important; }
        .wt-desk, .wt-desk-act, .wt-fig, .wt-fig-body { animation:none !important; transition:none !important; }
        .wt-desk[data-wt-receive] .wt-desk-plate,
        .wt-desk[data-wt-receive] .wt-desk-dot,
        .wt-desk[data-wt-receive] .wt-fig { animation:none !important; }
        /* Loops are the problem, not one-shots: breathing and the handoff ping
           are continuous blinking, so they stop; wt-flash stays. */
        .wt-desk[data-wt-status="waiting"] .wt-desk-dot,
        .wt-desk[data-wt-handoff="out"] .wt-desk-dot { animation:none !important; }
        /* V4: keep the fade, drop every translate / scale. The vestibular trigger
           is movement, not opacity — so these four keep a transition and are
           deliberately NOT in the transition:none list above. */
        .wt-fan, .wt-fan-seat, .wt-person, .wt-person-scrim {
          transition-property:opacity !important;
          transition-duration:120ms !important;
          transition-delay:0s !important;
          transform:none !important;
          animation:none !important;
        }
        .wt-fan[data-state="open"] .wt-fan-seat,
        .wt-fan[data-state="closing"] .wt-fan-seat,
        .wt-person, .wt-person[data-state="open"], .wt-person[data-state="closing"] { transform:none !important; }
      }
    `;

    // ---------------------------------------------------------------------
    // Tiny shared stores
    // ---------------------------------------------------------------------

    /**
     * Transient handoff marks keyed by member name: `out` on the member who gave
     * a task away, `in` on the one who took it. Module scope, so a mark survives
     * the office tab unmounting between the change and the user looking at it.
     */
    const handoffs = new Map();
    const handoffListeners = new Set();
    const handoffTimers = new Map();
    let handoffVersion = 0;

    function handoffDuration(kind) {
      return kind === 'out' ? 1600 : 480;
    }

    function notifyHandoffs() {
      handoffVersion += 1;
      for (const listener of handoffListeners) listener();
    }

    /**
     * Mark both ends of one handoff, keyed by the member names the roster uses
     * while carrying the labels a reader sees. A repeat refreshes both marks.
     *
     * `from` is the peer *label* the desk shows (「→ 小设」), so it cannot double
     * as an identity: `peer` carries the peer's raw `member.name` for the
     * corridor's seat lookup. The two key spaces are different — the map key is
     * `member.name` (the role id), the label is `roleOrFallback(...).zh.name`.
     */
    function flashHandoff(fromName, toName, fromLabel, toLabel) {
      if (typeof fromName !== 'string' || typeof toName !== 'string') return;
      if (fromName === '' || toName === '' || fromName === toName) return;
      const at = Date.now();
      handoffs.set(fromName, { from: toLabel ?? toName, peer: toName, kind: 'out', at });
      handoffs.set(toName, { from: fromLabel ?? fromName, peer: fromName, kind: 'in', at });
      notifyHandoffs();
      for (const [name, kind] of [[fromName, 'out'], [toName, 'in']]) {
        clearTimeout(handoffTimers.get(name));
        handoffTimers.set(
          name,
          setTimeout(() => {
            handoffTimers.delete(name);
            const current = handoffs.get(name);
            if (current === undefined || current.at !== at) return;
            handoffs.delete(name);
            notifyHandoffs();
          }, handoffDuration(kind)),
        );
      }
    }

    function useHandoffs() {
      const version = useSyncExternalStore(
        (listener) => {
          handoffListeners.add(listener);
          return () => handoffListeners.delete(listener);
        },
        () => handoffVersion,
        () => handoffVersion,
      );
      return useMemo(() => new Map(handoffs), [version]);
    }

    /**
     * Employee↔employee dialogue marks — the corridor's *second* and only other
     * source of movement.
     *
     * RESERVED, not wired: the host projects no employee-to-employee
     * conversation today, so `flashDialogue` has no call site and the corridor
     * never walks for a chat. It exists so a future projection has one honest
     * entry point (call this when the projection lands) instead of a timer
     * pretending a conversation happened. Never synthesise an entry.
     *
     * Shape mirrors a handoff's `out` mark: keyed by the speaker's roster name,
     * carrying who they walked over to and when. The mark expires on the same
     * schedule as a handoff so a remount cannot replay a stale walk.
     */
    const dialogues = new Map();
    const dialogueListeners = new Set();
    const dialogueTimers = new Map();
    let dialogueVersion = 0;

    function flashDialogue(fromName, toName) {
      if (typeof fromName !== 'string' || typeof toName !== 'string') return;
      if (fromName === '' || toName === '' || fromName === toName) return;
      const at = Date.now();
      dialogues.set(fromName, { to: toName, kind: 'dialogue', at });
      dialogueVersion += 1;
      for (const listener of dialogueListeners) listener();
      clearTimeout(dialogueTimers.get(fromName));
      dialogueTimers.set(
        fromName,
        setTimeout(() => {
          dialogueTimers.delete(fromName);
          const current = dialogues.get(fromName);
          if (current === undefined || current.at !== at) return;
          dialogues.delete(fromName);
          dialogueVersion += 1;
          for (const listener of dialogueListeners) listener();
        }, handoffDuration('out')),
      );
    }

    function useDialogues() {
      const version = useSyncExternalStore(
        (listener) => {
          dialogueListeners.add(listener);
          return () => dialogueListeners.delete(listener);
        },
        () => dialogueVersion,
        () => dialogueVersion,
      );
      return useMemo(() => new Map(dialogues), [version]);
    }

    function useFormSnapshot(form) {
      return useSyncExternalStore(
        (listener) => form.subscribe(listener),
        () => form.getSnapshot(),
        () => form.getSnapshot(),
      );
    }

    // ---------------------------------------------------------------------
    // Formatting and status
    // ---------------------------------------------------------------------

    function sameNumber(value) {
      return Number.isFinite(value) ? value : 0;
    }

    function sumTokens(totals) {
      if (totals === undefined) return 0;
      return (
        sameNumber(totals.uncachedInputTokens) +
        sameNumber(totals.outputTokens) +
        sameNumber(totals.cacheReadTokens) +
        sameNumber(totals.cacheWriteTokens)
      );
    }

    function formatTokens(value) {
      const amount = sameNumber(value);
      if (amount < 1000) return String(Math.round(amount));
      if (amount < 1_000_000) return `${(amount / 1000).toFixed(amount < 10_000 ? 1 : 0)}k`;
      return `${(amount / 1_000_000).toFixed(1)}m`;
    }

    /**
     * Host projection values reach the client on two paths: the Session summary
     * row (`byId[id].projectionValues`, which the shipped Subagent panel reads)
     * and the explicit baseline read (`projectionsBySession[id].values`). Prefer
     * the summary row and fall back to the baseline, so a member whose baseline
     * was never read still reports tokens and timing.
     */
    function projectionOf(state, sessionId, key) {
      const fromSummary = state.byId[sessionId]?.projectionValues?.[key];
      return fromSummary ?? state.projectionsBySession[sessionId]?.values?.[key];
    }

    /**
     * Status of one member, from the roster row, the platform's session status,
     * and the settlement reading this client polls for itself.
     *
     * `completionUnread` is deliberately NOT a status source: the platform sets
     * it for every non-main Session that stops running, and onboarding is a real
     * turn — so a freshly built team used to light up as N unread results. It
     * survives here as the per-member fallback signal only (see `degraded`).
     *
     * KNOWN PLATFORM GAP (measured 2026-10-26, still true): this client is never
     * told that a subagent Session is running — `useSessionStatus.running` and
     * `byId[id].running` both report a mid-turn teammate as finished, and the
     * shipped "subagents" dropdown agrees. That is why "working" is driven by
     * `subagentTiming.active` (a turn that has not reached `turn/end`) instead.
     * The `running` flag is only consulted on the degraded path, where it is the
     * best signal left.
     */
    function deriveStatus(member, signals) {
      if (member?.phase === 'failed') return 'failed';
      if (member?.phase === 'provisioning') return 'provisioning';
      if (signals.pending === true) return 'waiting';
      const timing = signals.timing;
      const ack = signals.ack;
      if (timing?.degraded === true) {
        // Fallback: no settlement reading for this member, so the old signals
        // drive it — with one exemption, the first unread turn after joining.
        if (signals.running === true) return 'working';
        if (signals.unread === true && ack?.readySeen === true) return 'done';
        if (ack?.readySeen === false) return 'ready';
        return 'idle';
      }
      if (timing?.active === true) return 'working';
      if (timing?.lastTurnCompleted === false) return 'error';
      const settledMs = timing?.settledMs ?? 0;
      if (settledMs === 0) return 'idle';
      if (ack === undefined) return 'ready';
      // `readyMs` is the settled total of the onboarding turn. Until the reader
      // has acknowledged that much, the seat reads as just taken; anything the
      // member settles past it is a real result. No dependence on observing
      // `active`, so a turn shorter than the poll interval still counts.
      const readyMs = ack.readyMs ?? 0;
      if (readyMs > 0) {
        if (settledMs <= readyMs && ack.ackedMs < readyMs) return 'ready';
        if (settledMs > readyMs && settledMs > ack.ackedMs) return 'done';
        return 'idle';
      }
      // No threshold on record: an old ledger entry the migration could not
      // resolve, or an ack built by hand. Fall back to the flag, which is the
      // same rule expressed for a single onboarding turn.
      if (ack.readySeen === false) return 'ready';
      if (settledMs > ack.ackedMs) return 'done';
      return 'idle';
    }

    /** Team members outside the mirrored roster still need an avatar palette. */
    function roleOrFallback(member) {
      const name = String(member?.name ?? '');
      return (
        ROLE_BY_ID.get(name) ?? {
          id: name,
          zh: { name, role: 'Teammate', seat: '' },
          en: { name, role: 'Teammate', seat: '' },
          palette: { accent: '#7c8798', soft: '#e9edf3', hair: '#2b3038', skin: '#d9b08c' },
        }
      );
    }

    /** Replace `{key}` placeholders without pulling in a formatter. */
    function fillCopy(template, values) {
      let out = String(template ?? '');
      for (const [key, value] of Object.entries(values)) {
        out = out.split(`{${key}}`).join(String(value ?? ''));
      }
      return out;
    }

    function errorText(reason) {
      if (reason === undefined || reason === null) return 'unknown error';
      if (typeof reason === 'string') return reason;
      return String(reason.message ?? reason);
    }

    // ---------------------------------------------------------------------
    // Dock sparkles (shared so a dispatch can flash the member card)
    // ---------------------------------------------------------------------

    const sparkleNames = new Set();
    const sparkleListeners = new Set();
    let sparkleVersion = 0;

    function flashSparkle(name) {
      if (typeof name !== 'string' || name === '') return;
      sparkleNames.add(name);
      sparkleVersion += 1;
      for (const listener of sparkleListeners) listener();
      setTimeout(() => {
        if (!sparkleNames.delete(name)) return;
        sparkleVersion += 1;
        for (const listener of sparkleListeners) listener();
      }, 1300);
    }

    function useSparkles() {
      const version = useSyncExternalStore(
        (listener) => {
          sparkleListeners.add(listener);
          return () => sparkleListeners.delete(listener);
        },
        () => sparkleVersion,
        () => sparkleVersion,
      );
      return useMemo(() => new Set(sparkleNames), [version]);
    }

    // ---------------------------------------------------------------------
    // Member runtime: turn settlement, one poller for every surface
    // ---------------------------------------------------------------------

    /**
     * Why this store exists. `completionUnread` is the platform's "a subagent
     * Session stopped running" flag, and onboarding is a real turn — so a team
     * that was just built reads as N unread results, which is not what the boss
     * did. Turn settlement is the honest signal: `subagentTiming.settledMs` only
     * grows when a turn actually closes, and the ledger below decides which
     * settlements the reader has already seen.
     *
     * One store, one timer. The office tab and the dock watch the same members,
     * so the poller starts with the first watcher and stops with the last; it is
     * paused while the page is hidden, it skips a member whose previous read has
     * not returned, and a member whose projections keep failing falls back to
     * `completionUnread` alone instead of freezing the row.
     */
    const ACK_PREFIX = 'dsh-work-team:ack:';
    const POLL_MS = 2000;
    /** Floor between two status-triggered reads, so a burst of flags reads once. */
    const NUDGE_MS = 400;
    /** Consecutive failed reads before one member drops to the fallback signal. */
    const DEGRADE_AFTER = 2;

    function createMemberRuntime() {
      /** Per-member acknowledgement ledger, one localStorage bucket per Lead. */
      const acks = new Map();
      const hydrated = new Set();
      /** Latest settlement reading per member Session. */
      const runtime = new Map();
      /** Members some mounted surface is showing: id → { lead, phase, count }. */
      const watchers = new Map();
      /** Members whose Session has appeared at least once, so a drop is real. */
      const seen = new Set();
      const inFlight = new Set();
      const listeners = new Set();
      let version = 0;
      let timer = null;
      let visibilityBound = false;
      let lastNudge = 0;
      let ctx = null;

      function bump() {
        version += 1;
        for (const listener of listeners) listener();
      }

      function storage() {
        if (typeof window === 'undefined') return null;
        try {
          return window.localStorage ?? null;
        } catch {
          // Blocked storage throws on the getter itself, not just on access.
          return null;
        }
      }

      function loadBucket(lead) {
        const store = storage();
        if (store === null) return {};
        try {
          const raw = store.getItem(ACK_PREFIX + lead);
          if (raw === null) return {};
          const parsed = JSON.parse(raw);
          return typeof parsed === 'object' && parsed !== null ? parsed : {};
        } catch {
          return {};
        }
      }

      /** Rewrite one Lead's bucket from the in-memory ledger. */
      function persist(lead) {
        const store = storage();
        if (store === null) return;
        const bucket = {};
        for (const [id, ack] of acks) {
          if (ack.lead !== lead) continue;
          bucket[id] = { ackedMs: ack.ackedMs, readyMs: ack.readyMs, readySeen: ack.readySeen };
        }
        try {
          store.setItem(ACK_PREFIX + lead, JSON.stringify(bucket));
        } catch {
          // Quota or a read-only profile: the in-memory ledger keeps working.
        }
      }

      /**
       * Load one Lead's bucket. A record written before `readyMs` existed is
       * migrated by its own flag: an already-acknowledged member had consumed its
       * onboarding settle, so the acknowledged total IS the threshold; an
       * unacknowledged one has not settled its onboarding yet, so the threshold
       * is still 0 and its next settlement will set it.
       */
      function hydrate(lead) {
        if (lead === undefined || lead === null || hydrated.has(lead)) return;
        hydrated.add(lead);
        for (const [id, entry] of Object.entries(loadBucket(lead))) {
          if (acks.has(id)) continue;
          const ackedMs = Number.isFinite(entry?.ackedMs) ? Math.max(0, Math.trunc(entry.ackedMs)) : 0;
          const readySeen = entry?.readySeen === true;
          const storedReadyMs = Number.isFinite(entry?.readyMs) ? Math.max(0, Math.trunc(entry.readyMs)) : undefined;
          acks.set(id, {
            lead,
            ackedMs,
            readyMs: storedReadyMs ?? (readySeen ? ackedMs : 0),
            readySeen,
            pendingAck: false,
          });
        }
      }

      /**
       * First sight of one member. Seen while still joining, its first
       * settlement is the onboarding turn, so nothing is acknowledged yet. Seen
       * after the hire already finished (panel opened late, other device, cleared
       * storage), the settled total is adopted as acknowledged — otherwise a
       * reload would invent one phantom "new result" per member.
       *
       * A member first seen while already `active` cannot be judged from the
       * roster alone: the spawn and the onboarding prompt are queued in the same
       * Host step, so the row can appear with the onboarding turn still open.
       * `pendingSeed` defers that decision to the first reading.
       */
      function seed(id, phase, lead) {
        if (acks.has(id)) return;
        if (phase === 'provisioning' || phase === 'failed') {
          acks.set(id, { lead, ackedMs: 0, readyMs: 0, readySeen: false, pendingAck: false });
          persist(lead);
          return;
        }
        acks.set(id, { lead, ackedMs: 0, readyMs: 0, readySeen: false, pendingAck: false, pendingSeed: true });
      }

      function listSnapshot() {
        try {
          return ctx?.sessions?.list?.getSnapshot?.();
        } catch {
          return undefined;
        }
      }

      function attach() {
        if (typeof document !== 'undefined') {
          if (!visibilityBound) {
            document.addEventListener('visibilitychange', onVisibility);
            visibilityBound = true;
          }
          if (document.visibilityState !== 'visible') return;
        }
        if (timer === null) timer = setInterval(() => void tick(), POLL_MS);
      }

      function detach() {
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
        if (visibilityBound && typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', onVisibility);
          visibilityBound = false;
        }
      }

      function onVisibility() {
        if (typeof document === 'undefined') return;
        if (document.visibilityState === 'visible') {
          attach();
          void tick();
          return;
        }
        if (timer !== null) {
          clearInterval(timer);
          timer = null;
        }
      }

      function watch(lead, members) {
        if (lead === undefined || lead === null) return;
        hydrate(lead);
        let fresh = false;
        for (const member of members) {
          const id = member?.id;
          if (typeof id !== 'string' || id === '') continue;
          const current = watchers.get(id);
          if (current === undefined) {
            watchers.set(id, { lead, phase: member.phase, count: 1 });
            fresh = true;
          } else {
            current.count += 1;
            current.lead = lead;
            current.phase = member.phase;
          }
          seed(id, member.phase, lead);
        }
        attach();
        // Mounting is a reason to read now, not in two seconds. Recording the
        // moment also keeps a status nudge from firing a second identical batch
        // in the same tick.
        if (fresh) {
          lastNudge = Date.now();
          void tick();
        }
      }

      function unwatch(ids) {
        for (const id of ids) {
          const current = watchers.get(id);
          if (current === undefined) continue;
          current.count -= 1;
          if (current.count <= 0) watchers.delete(id);
        }
        if (watchers.size === 0) detach();
      }

      /**
       * `provider::model::effort`, the same string the settings panel builds.
       *
       * `undefined` in, `undefined` out: an absent `modelSelection` projection
       * means the model is unknown, which the card must not render at all.
       * `null` in is a real answer — the Session has no selection of its own and
       * follows the main chat — so that one comes back as ''.
       */
      function selectionValue(selection) {
        if (selection === undefined) return undefined;
        if (selection === null) return '';
        return `${selection.provider}::${selection.model}${selection.reasoningEffort ? `::${selection.reasoningEffort}` : ''}`;
      }

      /** Accept either the Remote envelope or a bare value. */
      function unwrap(result) {
        if (result === null || typeof result !== 'object') return undefined;
        if ('ok' in result) return result.ok === true ? result.value ?? undefined : undefined;
        return result;
      }

      function settle(id, timing, values) {
        const settledMs = Number.isFinite(timing.settledMs)
          ? Math.max(0, Math.trunc(timing.settledMs))
          : 0;
        // The projection payload is the whole values bag, not just the timing
        // block: `modelSelection` is registered by the session controller for
        // every Session, so the card can name the real model instead of guessing.
        const model = selectionValue(values?.modelSelection?.next);
        const active = timing.active !== null && typeof timing.active === 'object';
        const lastTurnCompleted =
          timing.lastTurnCompleted === undefined || timing.lastTurnCompleted === null
            ? undefined
            : timing.lastTurnCompleted === true;
        const previous = runtime.get(id);
        runtime.set(id, {
          settledMs,
          active,
          lastTurnCompleted,
          degraded: false,
          failures: 0,
          measured: true,
          readAt: Date.now(),
          model,
        });
        if (previous === undefined || previous.degraded === true) {
          console.info(
            `[work-team] member ${id}: turn settlement drives the status (settled ${settledMs}ms, ${active ? 'turn open' : 'no open turn'})`,
          );
        }
        const changed =
          previous === undefined ||
          previous.settledMs !== settledMs ||
          previous.active !== active ||
          previous.lastTurnCompleted !== lastTurnCompleted ||
          previous.degraded !== false ||
          previous.model !== model;
        const ack = acks.get(id);
        if (ack !== undefined) {
          let wrote = false;
          if (ack.pendingSeed === true) {
            ack.pendingSeed = false;
            if (!(active === true && settledMs === 0)) {
              // Either nothing is running (the hire already settled: the panel
              // opened late) or a later turn is running. Adopt the settled total
              // as read instead of inventing a result nobody has seen.
              ack.readyMs = settledMs;
              ack.ackedMs = Math.max(ack.ackedMs, settledMs);
              ack.readySeen = true;
            }
            // `active && settledMs === 0` is the onboarding turn itself: leave it
            // unacknowledged so its settlement lands as "ready", not "new result".
            wrote = true;
          } else if (ack.readyMs === 0 && settledMs > 0) {
            // The first settlement this member ever produced is the onboarding
            // turn. Its total is the threshold "已就位" is measured against, so a
            // later turn counts as a result even when both its start and its end
            // fell between two polls and `active` was never observed.
            // `readySeen` stays untouched: it is the fallback ladder's flag and
            // means "the reader has acknowledged", which this is not.
            ack.readyMs = settledMs;
            wrote = true;
          } else if (ack.pendingAck === true && active !== true) {
            // Only a closed turn is adopted: a turn that is still running when
            // the chat opens has not produced its result yet.
            ack.ackedMs = Math.max(ack.ackedMs, settledMs);
            ack.pendingAck = false;
            wrote = true;
          }
          if (wrote) {
            persist(ack.lead);
            bump();
          }
        }
        if (changed) bump();
      }

      function fail(id, reason) {
        const previous = runtime.get(id);
        const failures = (previous?.failures ?? 0) + 1;
        const degraded = previous?.degraded === true || failures >= DEGRADE_AFTER;
        runtime.set(id, {
          settledMs: previous?.settledMs ?? 0,
          active: previous?.active ?? false,
          lastTurnCompleted: previous?.lastTurnCompleted,
          degraded,
          failures,
          measured: previous?.measured === true,
          readAt: Date.now(),
          model: previous?.model,
        });
        // One line per failing streak: a broken projection must not spam the console.
        if (failures === 1) {
          console.warn(`[work-team] member ${id}: projection read failed — ${errorText(reason)}`);
        }
        if (degraded && previous?.degraded !== true) {
          console.warn(
            `[work-team] member ${id}: falling back to completionUnread after ${failures} failed reads`,
          );
        }
        if (previous === undefined || previous.degraded !== degraded) bump();
      }

      function forget(id) {
        const ack = acks.get(id);
        runtime.delete(id);
        seen.delete(id);
        if (ack === undefined) return;
        acks.delete(id);
        persist(ack.lead);
        bump();
      }

      async function read(id) {
        if (inFlight.has(id)) return;
        const watchEntry = watchers.get(id);
        if (watchEntry === undefined) return;
        // A throwing snapshot is the list service being unavailable, NOT the
        // member disappearing. Treating the two alike would forget every seen
        // member, persist an empty bucket, and then re-seed on the next good
        // snapshot with the unread total adopted as read — losing the badge for
        // good, even across a reload.
        const snapshot = listSnapshot();
        if (snapshot === undefined || snapshot === null || typeof snapshot !== 'object') return;
        if (snapshot.byId === undefined || snapshot.byId === null) return;
        const summary = snapshot.byId[id];
        if (summary === undefined) {
          if (seen.has(id)) forget(id);
          return;
        }
        seen.add(id);
        // A settled Session with no live agent will not change again, so its last
        // reading stands. An open turn is the exception: its settlement still has
        // to arrive, so that member keeps being read.
        const known = runtime.get(id);
        if (summary.agentAvailable === false && known !== undefined && known.active === false) return;
        if (!acks.has(id)) seed(id, watchEntry.phase, watchEntry.lead);
        inFlight.add(id);
        try {
          const result = await ctx.remote.session.projections({ sessionId: id });
          const payload = unwrap(result);
          if (payload === undefined) {
            fail(id, result?.error ?? 'projections unavailable');
            return;
          }
          const timing = payload?.values?.subagentTiming;
          if (timing === null || typeof timing !== 'object') {
            fail(id, 'subagentTiming absent');
            return;
          }
          settle(id, timing, payload?.values);
        } catch (reason) {
          fail(id, reason);
        } finally {
          inFlight.delete(id);
        }
      }

      async function tick() {
        if (ctx === null || watchers.size === 0) return;
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
        await Promise.all([...watchers.keys()].map((id) => read(id)));
      }

      /**
       * A session-status change (running / pending / unread) is the moment a turn
       * probably just opened or closed, so read once instead of waiting out the
       * interval. Throttled: one turn flips several flags in a burst.
       */
      function nudge() {
        if (ctx === null || watchers.size === 0) return;
        const now = Date.now();
        if (now - lastNudge < NUDGE_MS) return;
        lastNudge = now;
        void tick();
      }

      /**
       * Opening a member's chat is the acknowledgement: whatever has settled so
       * far has been read. A member whose first reading has not arrived yet
       * acknowledges on that reading instead of pretending it saw nothing.
       *
       * `pendingAck` is re-armed even when a reading is already in hand: that
       * reading can be up to one interval old, so a turn that closed in between
       * would otherwise light the badge on the very next poll — right after the
       * reader opened the chat.
       */
      function ackMember(lead, id) {
        if (typeof id !== 'string' || id === '' || lead === undefined || lead === null) return;
        hydrate(lead);
        const ack = acks.get(id) ?? { lead, ackedMs: 0, readyMs: 0, readySeen: false, pendingAck: false };
        ack.readySeen = true;
        ack.pendingSeed = false;
        const current = runtime.get(id);
        if (current !== undefined && current.measured === true) {
          ack.ackedMs = Math.max(ack.ackedMs, current.settledMs);
        }
        // Adopt the next closed reading as read; a turn that is still open when
        // the chat opens is not finished, so it is adopted when it closes.
        ack.pendingAck = true;
        acks.set(id, ack);
        persist(ack.lead);
        bump();
      }

      return {
        bind(context) {
          ctx = context;
        },
        unbind() {
          ctx = null;
          detach();
          watchers.clear();
          inFlight.clear();
          listeners.clear();
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        getVersion() {
          return version;
        },
        runtimeOf(id) {
          return runtime.get(id);
        },
        ackOf(id) {
          return acks.get(id);
        },
        watch,
        unwatch,
        nudge,
        ackMember,
      };
    }

    const memberRuntime = createMemberRuntime();

    /** Watch these members while the calling surface is mounted. */
    function useMemberWatch(leadSessionId, members) {
      const ids = members.map((member) => member.id);
      const key = ids.join('|');
      const phases = members.map((member) => `${member.id}:${member.phase ?? ''}`).join('|');
      useEffect(() => {
        if (leadSessionId === undefined || leadSessionId === null || ids.length === 0) return undefined;
        memberRuntime.watch(leadSessionId, members);
        return () => memberRuntime.unwatch(ids);
      }, [leadSessionId, key, phases]);
    }

    /** Re-render this surface whenever any member's settlement reading changes. */
    function useRuntimeVersion() {
      return useSyncExternalStore(
        memberRuntime.subscribe,
        memberRuntime.getVersion,
        memberRuntime.getVersion,
      );
    }

    // ---------------------------------------------------------------------
    // Dispatching a task into a teammate's Session
    // ---------------------------------------------------------------------

    /**
     * The durable address of one teammate. The catalog knows the real child mode
     * (`one-shot` / `continuable` / `unknown`); assuming `continuable` would
     * route a one-shot child silently wrong, so prefer the catalog and only fall
     * back to the shipped direct-child shape.
     */
    function memberAddress(ctx, parentSessionId, childSessionId) {
      try {
        const known = ctx.sessions.subagentAddress?.(childSessionId);
        if (known !== undefined && known !== null) {
          return {
            parentSessionId: known.parentSessionId ?? parentSessionId,
            childSessionId,
            mode: known.mode,
          };
        }
      } catch {
        // A failed catalog probe is advisory — dispatch must still be attempted.
      }
      return { parentSessionId, childSessionId, mode: 'continuable' };
    }

    /**
     * Retain a teammate Session through that address and fall back to the bare
     * identity when the address form is rejected at runtime.
     */
    async function retainMember(ctx, parentSessionId, childSessionId) {
      const addresses = [memberAddress(ctx, parentSessionId, childSessionId), childSessionId];
      let failure;
      for (const target of addresses) {
        let reference;
        try {
          reference = ctx.sessions.retain(target, { source: 'controllerOperation' });
          await reference.ready;
          return reference;
        } catch (reason) {
          failure = reason;
          try {
            reference?.release();
          } catch {
            // A reference that never opened has nothing to release.
          }
        }
      }
      throw failure ?? new Error('could not retain the teammate session');
    }

    /** Queue one task message into a teammate Session; failures carry the Host reason. */
    async function dispatchTask(ctx, parentSessionId, childSessionId, text) {
      const body = String(text ?? '').trim();
      if (body === '') throw new Error('empty task');
      if (!parentSessionId || !childSessionId) throw new Error('missing session identity');
      let reference;
      try {
        reference = await retainMember(ctx, parentSessionId, childSessionId);
        const result = await reference.binding.session.prompt([{ type: 'text', text: body }], 'queue');
        if (result?.ok === false) throw new Error(errorText(result.error));
        return true;
      } finally {
        try {
          reference?.release();
        } catch {
          // Releasing twice or after teardown must not mask the dispatch result.
        }
      }
    }

    /**
     * Hand focus back to the composer editor that owns this overlay node.
     * The composer owns caret placement, so this is best-effort: a missing host
     * element must never break dismissal.
     */
    function focusComposerFrom(node) {
      try {
        const card = node?.closest?.('[data-composer-card]') ?? null;
        const editor = card?.querySelector?.('[data-composer-input]') ?? null;
        if (editor === null) return;
        editor.focus();
        const selection = window.getSelection();
        if (selection === null) return;
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        // Focus restoration is a courtesy, never a precondition.
      }
    }

    // ---------------------------------------------------------------------
    // Avatars
    // ---------------------------------------------------------------------

    // >>> px-avatar  (this block is inlined verbatim into
    //     demos/office/chars/avatar-harness.html by the harness itself)
    //
    // Three art grids, chosen so one grid cell is always >= 1 css pixel:
    //   16 cells -> 18 / 19 / 20 px      (mini: 2x2 eyes, no nose/mouth)
    //   24 cells -> 24 / 28 px           (mid:  2x2 eyes + mouth)
    //   32 cells -> 32 / 36 / 48 px      (full: 3x3 eyes + nose + mouth + blush)
    // The body/head/shoulder layout is shared; only eye, mouth, nose, blush and
    // the hair silhouette change per tier. Colours come from role.palette.
    const PX_INK = '#1b2433';
    const PX_BLUSH = '#f08a8a';
    const PX_MOUTH = '#7a3d2e';
    const PX_HAIR = {
      pm: 'side', frontend: 'messy', backend: 'short', reviewer: 'bun',
      researcher: 'wild', designer: 'long', ops: 'cap', writer: 'pony',
    };

    /** Art grid for a rendered size: 16 / 24 / 32 cells. */
    function pxGrid(size) {
      if (size <= 20) return 16;
      if (size <= 28) return 24;
      // 48 renders 24 cells at 2px each: a bigger avatar gets bigger pixels,
      // never a 1.5px cell (32 cells at 48px would alternate 1px/2px rows).
      if (size >= 44) return 24;
      return 32;
    }

    /** Merge rects into one path; runs on the same scanline are joined. */
    function pxPath(rects) {
      const rows = new Map();
      for (const r of rects) {
        for (let k = 0; k < r.h; k++) {
          const y = r.y + k;
          if (!rows.has(y)) rows.set(y, []);
          rows.get(y).push([r.x, r.x + r.w]);
        }
      }
      let d = '';
      for (const [y, segs] of rows) {
        segs.sort((a, b) => a[0] - b[0]);
        let cur = null;
        for (const seg of segs) {
          if (cur && seg[0] <= cur[1]) cur[1] = Math.max(cur[1], seg[1]);
          else {
            if (cur) d += `M${cur[0]} ${y}h${cur[1] - cur[0]}v1h${cur[0] - cur[1]}z`;
            cur = [seg[0], seg[1]];
          }
        }
        if (cur) d += `M${cur[0]} ${y}h${cur[1] - cur[0]}v1h${cur[0] - cur[1]}z`;
      }
      return d;
    }

    /** [x0, x1) covered by the inscribed disc on scanline y. */
    function pxSpan(grid, y) {
      const r = grid / 2;
      const dy = y + 0.5 - r;
      const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
      return [Math.round(r - dx), Math.round(r + dx)];
    }

    /** Inscribed pixel disc, one row-run per scanline. */
    function pxDisc(grid) {
      const out = [];
      for (let y = 0; y < grid; y++) {
        const [a, b] = pxSpan(grid, y);
        if (b > a) out.push({ x: a, y, w: b - a, h: 1 });
      }
      return out;
    }

    /** Intersect rects with the disc: shoulders die on the arc, never past it. */
    function pxClip(rects, grid) {
      const out = [];
      for (const r of rects) {
        for (let y = Math.max(0, r.y); y < Math.min(grid, r.y + r.h); y++) {
          const [a, b] = pxSpan(grid, y);
          const x0 = Math.max(a, r.x);
          const x1 = Math.min(b, r.x + r.w);
          if (x1 > x0) out.push({ x: x0, y, w: x1 - x0, h: 1 });
        }
      }
      return out;
    }

    /** 1px rim around a silhouette (4-neighbour, never diagonal). */
    function pxOutline(rects, grid) {
      const mask = new Uint8Array(grid * grid);
      for (const r of rects) {
        for (let y = Math.max(0, r.y); y < Math.min(grid, r.y + r.h); y++) {
          for (let x = Math.max(0, r.x); x < Math.min(grid, r.x + r.w); x++) mask[y * grid + x] = 1;
        }
      }
      const out = [];
      for (let y = 0; y < grid; y++) {
        for (let x = 0; x < grid; x++) {
          if (mask[y * grid + x]) continue;
          const n =
            (x > 0 && mask[y * grid + x - 1]) ||
            (x < grid - 1 && mask[y * grid + x + 1]) ||
            (y > 0 && mask[(y - 1) * grid + x]) ||
            (y < grid - 1 && mask[(y + 1) * grid + x]);
          if (n) out.push({ x, y, w: 1, h: 1 });
        }
      }
      return out;
    }

    /** Every path for one avatar, on the tier grid, plus that grid's size. */
    function pixelAvatar(role, size) {
      const G = pxGrid(size);
      const full = G === 32;
      const mid = G === 24;

      const headW = Math.round(G * 0.44);
      const headH = Math.round(G * 0.44);
      const headX = Math.round((G - headW) / 2);
      const headY = Math.round(G * 0.22);

      const hairH = Math.max(2, Math.round(headH * 0.34));
      const hairTop = headY - hairH + 1;
      const head = [{ x: headX, y: headY, w: headW, h: headH }];
      // The base cap is the shared silhouette. Every style must add ink
      // OUTSIDE it, otherwise pxPath merges the extra run into the same colour
      // and the role collapses onto the default — which is exactly how the
      // old 'short'/'side' pair ended up byte-identical.
      const cap = { x: headX - 1, y: hairTop, w: headW + 2, h: hairH + 1 };
      const hairBelow = hairTop + hairH + 1;
      let hair;
      switch (PX_HAIR[role.id] ?? 'side') {
        case 'side': // 三七分：底行只留左侧，右侧缺口
          hair = [
            { x: headX - 1, y: hairTop, w: headW + 2, h: hairH },
            { x: headX - 1, y: hairTop + hairH, w: Math.max(3, Math.round(headW * 0.55)), h: 1 },
          ];
          break;
        case 'short': // 平刘海 + 两撮鬓角（从基础块下方起笔）
          hair = [cap, { x: headX - 1, y: hairBelow, w: 1, h: 2 }, { x: headX + headW, y: hairBelow, w: 1, h: 2 }];
          break;
        case 'messy': // 呆毛
          hair = [
            cap,
            { x: headX + 1, y: hairTop - 1, w: 2, h: 1 },
            { x: headX + headW - 3, y: hairTop - 1, w: 2, h: 1 },
          ];
          break;
        case 'bun': // 发髻
          hair = [cap, { x: headX + Math.round(headW * 0.3), y: hairTop - 2, w: 4, h: 2 }];
          break;
        case 'wild': // 爆炸头：两侧各多 1px
          hair = [
            cap,
            { x: headX - 2, y: hairTop + 1, w: 1, h: 3 },
            { x: headX + headW + 1, y: hairTop + 1, w: 1, h: 3 },
          ];
          break;
        case 'long': // 长发垂到肩
          hair = [
            cap,
            { x: headX - 1, y: hairBelow - 1, w: 2, h: Math.round(headH * 0.55) },
            { x: headX + headW - 1, y: hairBelow - 1, w: 2, h: Math.round(headH * 0.55) },
          ];
          break;
        case 'cap': // 鸭舌帽檐
          hair = [cap, { x: headX - 3, y: hairTop + hairH - 1, w: headW + 6, h: 1 }];
          break;
        case 'pony': // 马尾
          hair = [cap, { x: headX + headW + 1, y: headY, w: 2, h: Math.round(headH * 0.5) }];
          break;
        default:
          hair = [cap];
      }

      const eyeW = full ? 3 : 2;
      const gap = Math.max(1, Math.round(headW * (full ? 0.3 : 0.26)));
      const eyeX = headX + Math.round((headW - eyeW * 2 - gap) / 2);
      const eyeY = headY + Math.round(headH * 0.45);
      const eyes = [
        { x: eyeX, y: eyeY, w: eyeW, h: eyeW },
        { x: eyeX + eyeW + gap, y: eyeY, w: eyeW, h: eyeW },
      ];

      const cx = Math.round(G / 2);
      const mouthY = headY + Math.round(headH * 0.78);
      const mouth = full
        ? [{ x: cx - 1, y: mouthY, w: 3, h: 1 }]
        : mid
          ? [{ x: cx - 1, y: mouthY, w: 2, h: 1 }]
          : [];
      const nose = full ? [{ x: cx, y: headY + Math.round(headH * 0.62), w: 1, h: 1 }] : [];
      const blush = full
        ? [
            { x: headX - 1, y: headY + Math.round(headH * 0.62), w: 2, h: 1 },
            { x: headX + headW - 1, y: headY + Math.round(headH * 0.62), w: 2, h: 1 },
          ]
        : [];

      const shY = Math.round(G * 0.7);
      const shX = Math.round(G * 0.06);
      const shirt = pxClip([{ x: shX, y: shY, w: G - shX * 2, h: G - shY }], G);
      const neckW = Math.max(2, Math.round(headW * 0.32));
      const neck = [
        { x: Math.round((G - neckW) / 2), y: headY + headH - 1, w: neckW, h: shY - (headY + headH) + 2 },
      ];
      const earY = headY + Math.round(headH * 0.42);
      const ears = [
        { x: headX - 1, y: earY, w: 1, h: 2 },
        { x: headX + headW, y: earY, w: 1, h: 2 },
      ];
      const hairClipped = pxClip(hair, G);
      const hairLit = pxClip([{ x: headX, y: hairTop, w: headW, h: 1 }], G);
      const skin = pxClip(head.concat(neck, ears), G);
      const outline = pxOutline(head.concat(hairClipped), G);
      const hands = pxClip(
        [
          { x: headX - 3, y: shY - 1, w: 2, h: 2 },
          { x: headX + headW + 1, y: shY - 1, w: 2, h: 2 },
        ],
        G,
      );

      return {
        grid: G,
        bg: pxPath(pxDisc(G)),
        shirt: pxPath(shirt),
        outline: pxPath(outline),
        skin: pxPath(skin),
        hair: pxPath(hairClipped),
        hairLit: pxPath(hairLit),
        blush: pxPath(blush),
        nose: pxPath(nose),
        mouth: pxPath(mouth),
        eyes: pxPath(eyes),
        hands: pxPath(hands),
      };
    }

    // ── full-body figure (corridor only) ──────────────────────────────────
    // 44x46 native grid, ported from the approved demo. The desk cuts the legs
    // at the waist, so every pose reads from the chest up. Colours come from
    // role.palette plus token mixes; the only literals are the shared inks
    // already used by the avatar.
    const FIG_HAIR = {
      pm: 'side', frontend: 'messy', backend: 'short', reviewer: 'bun',
      researcher: 'wild', designer: 'long', ops: 'cap', writer: 'pony',
    };

    function figHair(style, push, C) {
      const h = (x, y, w, hh, c) => push('body', x, y, w, hh, c || C.hair);
      switch (style) {
        case 'side':
          h(15, 2, 14, 3); h(14, 5, 1, 4); h(29, 5, 1, 3);
          h(15, 5, 5, 1); h(23, 5, 5, 1); h(18, 2, 2, 1, C.hairDim);
          break;
        case 'messy':
          h(15, 1, 14, 3); h(17, 0, 2, 1); h(21, 0, 3, 1); h(26, 0, 2, 1);
          h(15, 4, 1, 4); h(19, 4, 1, 2); h(26, 4, 1, 4); h(22, 4, 2, 1, C.hairDim);
          break;
        case 'short':
          h(16, 2, 12, 3); h(15, 4, 1, 2); h(28, 4, 1, 2); h(19, 2, 2, 1, C.hairDim);
          push('body', 16, 16, 12, 1, C.ink); push('body', 17, 17, 10, 1, C.ink);
          push('body', 18, 15, 8, 1, C.ink); push('body', 16, 14, 1, 1, C.ink); push('body', 27, 14, 1, 1, C.ink);
          break;
        case 'bun':
          h(15, 2, 14, 3); h(14, 5, 1, 5); h(29, 5, 1, 5); h(15, 5, 14, 1);
          h(19, 0, 6, 2); h(18, 1, 1, 1); h(25, 1, 1, 1);
          push('body', 16, 8, 6, 1, C.metal); push('body', 16, 12, 6, 1, C.metal);
          push('body', 22, 8, 6, 1, C.metal); push('body', 22, 12, 6, 1, C.metal);
          push('body', 21, 10, 1, 1, C.metal);
          break;
        case 'wild':
          h(13, 1, 18, 4); h(12, 3, 1, 6); h(31, 3, 1, 6);
          h(16, 0, 3, 1); h(21, 0, 3, 1); h(26, 0, 2, 1); h(19, 4, 4, 1, C.hairDim);
          break;
        case 'long':
          h(15, 2, 14, 3); h(12, 5, 3, 15); h(29, 5, 3, 15); h(15, 5, 14, 1);
          push('body', 13, 0, 18, 3, C.pants); push('body', 12, 1, 1, 1, C.pants);
          push('body', 22, -1, 2, 2, C.pants); push('body', 28, 0, 3, 1, C.pants);
          break;
        case 'cap':
          h(15, 2, 14, 1); h(14, 4, 1, 3); h(29, 4, 1, 3);
          push('body', 15, 1, 14, 3, C.pants); push('body', 11, 4, 5, 1, C.accent);
          push('body', 21, 0, 2, 1, C.accent); push('body', 15, 1, 14, 1, C.pantsDim);
          break;
        case 'pony':
          h(15, 2, 14, 3); h(15, 5, 4, 1); h(23, 5, 5, 1);
          h(29, 4, 3, 5); h(30, 8, 3, 7); h(29, 5, 1, 1, C.accent);
          break;
      }
    }

    function figProp(kind, push, C) {
      switch (kind) {
        case 'clipboard':
          push('prop', 5, 23, 10, 16, C.paper); push('prop', 5, 23, 10, 1, C.metal); push('prop', 8, 21, 4, 2, C.ink);
          push('prop', 7, 27, 6, 1, C.ink); push('prop', 7, 30, 6, 1, C.ink); push('prop', 7, 33, 4, 1, C.ink);
          break;
        case 'headphone':
          push('prop', 15, 1, 14, 1, C.accent); push('prop', 12, 4, 2, 9, C.accent); push('prop', 30, 4, 2, 9, C.accent);
          break;
        case 'rack':
          push('prop', 18, 23, 8, 7, C.ink); push('prop', 19, 24, 6, 1, C.accent);
          push('prop', 19, 26, 6, 1, C.accent); push('prop', 19, 28, 6, 1, C.accent);
          break;
        case 'lens':
          push('prop', 31, 23, 8, 1, C.ink); push('prop', 31, 30, 8, 1, C.ink);
          push('prop', 31, 24, 1, 6, C.ink); push('prop', 38, 24, 1, 6, C.ink);
          push('prop', 32, 24, 6, 6, C.lens); push('prop', 35, 31, 1, 2, C.ink); push('prop', 35, 33, 4, 1, C.ink);
          break;
        case 'book':
          push('prop', 4, 23, 12, 16, C.accent); push('prop', 5, 24, 10, 14, C.paper);
          push('prop', 4, 23, 12, 1, C.accentDim); push('prop', 9, 23, 1, 16, C.accent);
          push('prop', 7, 27, 1, 1, C.ink); push('prop', 7, 30, 1, 1, C.ink); push('prop', 7, 33, 1, 1, C.ink);
          break;
        case 'palette':
          push('prop', 30, 24, 12, 6, C.metal); push('prop', 30, 24, 12, 1, C.metalDim);
          push('prop', 32, 25, 2, 2, C.accent); push('prop', 35, 25, 2, 2, C.ink); push('prop', 38, 25, 2, 2, C.paper);
          break;
        case 'wrench':
          push('prop', 34, 19, 3, 2, C.metal); push('prop', 33, 20, 1, 1, C.metal);
          push('prop', 35, 21, 2, 12, C.metal); push('prop', 34, 32, 3, 1, C.metal);
          break;
        case 'paper':
          push('prop', 4, 23, 9, 16, C.paper); push('prop', 5, 27, 6, 1, C.ink);
          push('prop', 5, 30, 6, 1, C.ink); push('prop', 5, 33, 4, 1, C.ink);
          push('prop', 13, 19, 1, 4, C.accent);
          break;
      }
    }

    function figBadge(status, push, C) {
      const col = {
        done: 'var(--dsw-alias-state-success-primary)',
        error: 'var(--dsw-alias-state-error-primary)',
        failed: 'var(--dsw-alias-state-error-primary)',
        waiting: 'var(--dsw-alias-state-warn-primary)',
        provisioning: 'var(--dsw-alias-state-business-primary)',
      }[status];
      if (col === undefined) return;
      push('badge', 37, 1, 5, 1, col); push('badge', 36, 2, 7, 5, col); push('badge', 37, 7, 5, 1, col);
      const glyph = {
        done: [[1, 2], [2, 3], [3, 2], [4, 1], [4, 0]],
        error: [[1, 0], [3, 0], [2, 1], [1, 2], [3, 2], [2, 3]],
        failed: [[1, 0], [3, 0], [2, 1], [1, 2], [3, 2], [2, 3]],
        waiting: [[1, 0], [2, 0], [3, 1], [2, 2], [2, 4]],
        provisioning: [[1, 2], [2, 2], [3, 2]],
      }[status];
      for (const [gx, gy] of glyph) push('badge', 37 + gx, 2 + gy, 1, 1, C.paper);
    }

    /** Pose per status, ported from the demo's build(). */
    function figurePose(status) {
      switch (status) {
        case 'working': return { arms: 'type', keyboard: true };
        case 'waiting': return { arms: 'wave' };
        case 'done': return { arms: 'up' };
        case 'error': return { arms: 'down', eyes: 'x' };
        case 'failed': return { arms: 'down', eyes: 'shut', ghost: true };
        case 'provisioning': return { arms: 'down', eyes: 'shut', dots: true };
        default: return { arms: 'down' };
      }
    }

    /** Every layer of one full-body figure, on the 44x46 grid. */
    function pixelFigure(role, size, status) {
      const ink = PX_INK;
      const C = {
        ink,
        hair: role.palette.hair,
        hairDim: `color-mix(in srgb, ${role.palette.hair} 74%, ${ink})`,
        shirt: role.palette.accent,
        shirtDim: `color-mix(in srgb, ${role.palette.accent} 74%, ${ink})`,
        accent: role.palette.accent,
        accentDim: `color-mix(in srgb, ${role.palette.accent} 74%, ${ink})`,
        pants: 'color-mix(in srgb, var(--dsw-alias-label-primary) 58%, var(--dsw-alias-bg-layer-1))',
        pantsDim: `color-mix(in srgb, ${'color-mix(in srgb, var(--dsw-alias-label-primary) 58%, var(--dsw-alias-bg-layer-1))'} 76%, ${ink})`,
        shoe: 'color-mix(in srgb, var(--dsw-alias-label-primary) 82%, var(--dsw-alias-bg-base))',
        skin: role.palette.skin,
        skin2: `color-mix(in srgb, ${role.palette.skin} 72%, ${ink})`,
        paper: 'var(--dsw-alias-bg-layer-1)',
        metal: 'color-mix(in srgb, var(--dsw-alias-label-primary) 24%, var(--dsw-alias-bg-layer-1))',
        metalDim: `color-mix(in srgb, var(--dsw-alias-label-primary) 42%, var(--dsw-alias-bg-layer-1))`,
        lens: `color-mix(in srgb, ${role.palette.accent} 40%, var(--dsw-alias-bg-layer-1))`,
      };
      const pose = figurePose(status);
      const parts = { outline: [], fx: [], legs: [], shoes: [], body: [], prop: [], badge: [] };
      const push = (part, x, y, w, hh, c) => parts[part].push({ x, y, w, h: hh, c });
      const mirror = (part, x, y, w, hh, c) => push(part, 44 - x - w, y, w, hh, c);

      // ground / ghost
      if (pose.ghost) {
        push('fx', 14, 44, 4, 1, 'color-mix(in srgb, var(--dsw-alias-label-primary) 26%, transparent)');
        push('fx', 19, 44, 4, 1, 'color-mix(in srgb, var(--dsw-alias-label-primary) 26%, transparent)');
        push('fx', 25, 44, 4, 1, 'color-mix(in srgb, var(--dsw-alias-label-primary) 26%, transparent)');
      }
      if (pose.dots) {
        for (const y of [22, 28, 34]) push('fx', 4, y, 2, 2, 'var(--dsw-alias-state-business-primary)');
      }

      // legs + shoes (mostly hidden behind the desk)
      push('legs', 13, 32, 7, 10, C.pants); push('legs', 13, 32, 2, 10, C.pantsDim);
      push('legs', 24, 32, 7, 10, C.pants); push('legs', 24, 32, 2, 10, C.pantsDim);
      push('shoes', 12, 42, 9, 2, C.shoe); push('shoes', 12, 44, 9, 1, C.shoe);
      push('shoes', 23, 42, 9, 2, C.shoe); push('shoes', 23, 44, 9, 1, C.shoe);

      // torso
      push('body', 11, 19, 22, 13, C.shirt);
      push('body', 11, 19, 2, 13, C.shirtDim);
      push('body', 31, 19, 2, 13, C.shirtDim);
      push('body', 11, 31, 22, 1, C.shirtDim);
      push('body', 19, 19, 6, 1, C.skin2);
      push('body', 15, 26, 2, 3, C.shirtDim);
      push('body', 28, 23, 2, 2, C.shirtDim);
      if (role.id === 'ops') {
        push('body', 16, 22, 10, 9, C.pants); push('body', 16, 19, 3, 3, C.pants); push('body', 23, 19, 3, 3, C.pants);
        push('body', 17, 23, 1, 1, C.metal); push('body', 17, 25, 1, 1, C.metal);
      }
      if (role.id === 'researcher') {
        push('body', 16, 19, 3, 13, C.paper); push('body', 23, 19, 3, 13, C.paper);
        push('body', 17, 20, 1, 1, C.accent); push('body', 18, 21, 1, 1, C.accent);
      }

      // arms
      const armDown = (x, side) => {
        push('body', x, 20, 4, 8, C.shirt);
        push('body', x, 20, 1, 8, C.shirtDim);
        push('body', x + 3, 20, 1, 8, C.shirtDim);
        push('body', x, 28, 4, 3, C.skin);
        push('body', x + (side < 0 ? 4 : -1), 31, 1, 2, C.skin2);
        push('body', x, 31, 4, 3, C.skin);
        push('body', x, 33, 4, 1, C.skin2);
      };
      if (pose.arms === 'type') {
        push('body', 9, 21, 4, 7, C.shirt); push('body', 9, 21, 1, 7, C.shirtDim);
        push('body', 10, 27, 4, 3, C.skin); push('body', 10, 30, 4, 1, C.skin2);
        mirror('body', 9, 21, 4, 7, C.shirt); mirror('body', 9, 21, 1, 7, C.shirtDim);
        mirror('body', 10, 27, 4, 3, C.skin); mirror('body', 10, 30, 4, 1, C.skin2);
        push('prop', 12, 29, 20, 2, C.metal);
        push('prop', 13, 30, 2, 1, C.ink); push('prop', 17, 30, 2, 1, C.ink);
        push('prop', 21, 30, 2, 1, C.ink); push('prop', 25, 30, 2, 1, C.ink);
      } else if (pose.arms === 'up') {
        push('body', 7, 13, 4, 11, C.shirt); push('body', 7, 13, 1, 11, C.shirtDim); push('body', 7, 9, 4, 4, C.skin);
        mirror('body', 7, 13, 4, 11, C.shirt); mirror('body', 7, 13, 1, 11, C.shirtDim); mirror('body', 7, 9, 4, 4, C.skin);
      } else if (pose.arms === 'wave') {
        armDown(7, -1);
        mirror('body', 7, 13, 4, 11, C.shirt); mirror('body', 7, 13, 1, 11, C.shirtDim); mirror('body', 7, 9, 4, 4, C.skin);
      } else {
        armDown(7, -1);
        mirror('body', 7, 20, 4, 8, C.shirt); mirror('body', 7, 20, 1, 8, C.shirtDim);
        mirror('body', 7, 28, 4, 3, C.skin); mirror('body', 7, 31, 4, 3, C.skin);
        mirror('body', 7, 33, 4, 1, C.skin2);
      }

      // head
      push('body', 15, 6, 14, 12, C.skin);
      push('body', 15, 6, 1, 12, C.skin2);
      push('body', 14, 9, 1, 3, C.skin); push('body', 29, 9, 1, 3, C.skin);
      push('body', 15, 17, 14, 1, C.skin2);
      push('body', 21, 13, 1, 1, C.skin2);
      push('body', 20, 15, 3, 1, C.skin2);
      figHair(FIG_HAIR[role.id] ?? 'side', push, C);
      push('body', 19, 18, 6, 2, C.skin2);

      // eyes
      if (pose.eyes === 'x') {
        for (const bx of [17, 24]) {
          push('body', bx, 9, 1, 1, ink); push('body', bx + 2, 9, 1, 1, ink);
          push('body', bx + 1, 10, 1, 1, ink);
          push('body', bx, 11, 1, 1, ink); push('body', bx + 2, 11, 1, 1, ink);
        }
      } else if (pose.eyes === 'shut') {
        push('body', 18, 11, 2, 1, ink); push('body', 24, 11, 2, 1, ink);
      } else {
        push('body', 18, 10, 2, 2, ink); push('body', 24, 10, 2, 2, ink);
      }

      figProp(FIG_PROP[role.id] ?? 'paper', push, C);
      figBadge(status, push, C);

      // outline: one rim around the whole silhouette
      const solid = [].concat(parts.legs, parts.shoes, parts.body, parts.prop);
      const rim = pxOutline(solid.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })), 44);
      for (const r of rim) parts.outline.push({ x: r.x, y: r.y, w: 1, h: 1, c: ink });

      const layers = [];
      for (const key of ['outline', 'fx', 'legs', 'shoes', 'body', 'prop', 'badge']) {
        const list = parts[key];
        if (list.length === 0) continue;
        const byColor = new Map();
        for (const r of list) {
          if (!byColor.has(r.c)) byColor.set(r.c, []);
          byColor.get(r.c).push(r);
        }
        for (const [c, rs] of byColor) layers.push({ part: key, fill: c, d: pxPath(rs) });
      }
      return { w: 44, h: 46, layers };
    }

    const FIG_PROP = {
      pm: 'clipboard', frontend: 'headphone', backend: 'rack', reviewer: 'lens',
      researcher: 'book', designer: 'palette', ops: 'wrench', writer: 'paper',
    };
    // <<< px-avatar

    function RoleAvatar({ role, size = 36, status = 'idle', dim = false, bubble = false, dot = false, sparkle = false }) {
      const style = {
        width: size,
        height: size,
      };
      const skin = role.palette.skin;
      const px = pixelAvatar(role, size);
      return h(
        'span',
        {
          className: `wt-avatar-wrap st-${status} wt-st-${status}`,
          style,
          'aria-hidden': true,
        },
        h(
          'svg',
          {
            viewBox: `0 0 ${px.grid} ${px.grid}`,
            width: size,
            height: size,
            shapeRendering: 'crispEdges',
            className: dim ? 'wt-avatar-svg wt-avatar-dim' : 'wt-avatar-svg',
          },
          h('path', { d: px.bg, fill: role.palette.soft }),
          h('path', { d: px.shirt, fill: role.palette.accent }),
          h('path', { d: px.outline, fill: PX_INK }),
          h('path', { d: px.skin, fill: skin }),
          h('path', { d: px.hair, fill: role.palette.hair }),
          h('path', { d: px.hairLit, fill: '#ffffff', opacity: '.2' }),
          px.blush ? h('path', { d: px.blush, fill: PX_BLUSH, opacity: '.3' }) : null,
          px.nose ? h('path', { d: px.nose, fill: PX_MOUTH, opacity: '.45' }) : null,
          px.mouth ? h('path', { d: px.mouth, fill: PX_MOUTH, opacity: '.8' }) : null,
          h('g', { className: 'wt-eyes' }, h('path', { d: px.eyes, fill: PX_INK })),
          h(
            'g',
            { className: 'wt-hands', opacity: '0' },
            h('path', { d: px.hands, fill: PX_INK }),
          ),
        ),
        bubble ? h('span', { className: 'wt-bubble' }, '?') : null,
        // The dot has to live inside the avatar wrapper: it is the only
        // position:relative ancestor that hugs the face (a chip is wider).
        dot ? h('span', { className: 'wt-dot ' + status }) : null,
        sparkle ? h('span', { className: 'wt-sparkle' }, '✦') : null,
      );
    }

    // ---------------------------------------------------------------------
    // Dock units (facepile / chip)
    // ---------------------------------------------------------------------

    /** First clause of a task subject — the only part that fits a 24px chip. */
    function dockPhrase(subject) {
      if (!subject) return '';
      const head = String(subject).split(/[：:·—，,]/)[0].trim();
      return head === '' ? String(subject) : head;
    }

    /** Name, role, current task and the dispatch entry: the one place a unit
     * grows past its 20px face. Shared by both units, so the markup and the CSS
     * bridge (`.wt-seat-tip::after`) exist once. */
    function SeatTip({ name, roleLabel, task, t, onExpand }) {
      return h(
        'span',
        { className: 'wt-seat-tip' },
        h('span', { className: 'wt-tip-name' }, name),
        h('span', { className: 'wt-tip-role' }, roleLabel),
        task === '' ? null : h('span', { className: 'wt-tip-task' }, task),
        h(
          'button',
          {
            type: 'button',
            className: 'wt-tip-act',
            'aria-label': fillCopy(t('dock.dispatchTo'), { name }),
            onClick: onExpand,
          },
          '↗',
        ),
      );
    }

    /**
     * One face in the pile. Deliberately outside the Tab order: the office tab is
     * the keyboard route to every member, and seven extra stops would push the
     * composer away from the reader.
     */
    function DockFace({ entry, task, sparkle, t, tipOpen, tabIndex, expanded, label, onOpen, onExpand }) {
      const name = entry.role.zh.name;
      return h(
        'div',
        {
          className: 'wt-seat',
          'data-wt-seat': entry.member.id,
          'data-tip': tipOpen ? 'true' : undefined,
        },
        h(
          'button',
          {
            type: 'button',
            className: 'wt-seat-hit',
            // The first face is the one keyboard route into the fan; the rest
            // stay out of the Tab order so the composer is not pushed away.
            tabIndex,
            'aria-label': label ?? fillCopy(t('row.open'), { name }),
            'aria-expanded': expanded === undefined ? undefined : expanded ? 'true' : 'false',
            'aria-controls': expanded === undefined ? undefined : 'wt-fan',
            onClick: () => onOpen(entry.member.id),
          },
          h(RoleAvatar, { role: entry.role, size: 20, status: entry.status, sparkle, dot: true }),
        ),
        h(SeatTip, { name, roleLabel: entry.role.zh.role, task, t, onExpand }),
      );
    }

    /** One member who has something going on: face, name, and the phrase that
     * says what. Two at most — the rest stay in the pile and in the summary. */
    function DockChip({ entry, rank, task, sparkle, t, tipOpen, onOpen, onExpand }) {
      const name = entry.role.zh.name;
      const status = t(`status.${entry.status}`);
      const phrase = entry.status === 'working' ? dockPhrase(task) || t('status.working') : status;
      return h(
        'div',
        {
          className: 'wt-seat',
          'data-wt-seat': entry.member.id,
          'data-tip': tipOpen ? 'true' : undefined,
        },
        h(
          'button',
          {
            type: 'button',
            className: 'wt-chip',
            'data-rank': rank,
            // A non-working chip's phrase IS its status; repeating it would make
            // the screen reader say the same four characters twice.
            'aria-label':
              phrase === status
                ? fillCopy(t('dock.chipAria'), { name, status })
                : fillCopy(t('dock.chipAriaTask'), { name, status, phrase }),
            onClick: () => onOpen(entry.member.id),
          },
          h(RoleAvatar, { role: entry.role, size: 18, status: entry.status, sparkle, dot: true }),
          h('span', { className: 'wt-chip-name' }, name),
          h('span', { className: 'wt-chip-phrase' }, phrase),
        ),
        h(SeatTip, { name, roleLabel: entry.role.zh.role, task, t, onExpand }),
      );
    }

    // ---------------------------------------------------------------------
    // Office rows (sidebar tab)
    // ---------------------------------------------------------------------

    /**
     * One member as a 44px row: the status column is right-aligned across every
     * row, which is what turns the list into one scannable axis.
     *
     * The row is `role="group"`, not a button, because it carries two sibling
     * buttons instead of nested ones: `.wt-row-hit` — an `inset:0` stretched hit
     * area that opens the member's chat — and `.wt-row-act`, the pause control,
     * rendered only while the member is working or waiting. Both are real
     * `<button>`s, so Enter/Space is native and the row itself needs no
     * `tabIndex`; its own `onClick` is only a pointer fallback for the case where
     * the hit area is clipped away.
     */
    function OfficeRow({
      member,
      task,
      t,
      handoff,
      sparkle,
      onOpen,
      onStop,
      useSessions,
      useSessionStatus,
    }) {
      const running = useSessionStatus((state) => state.get(member.id)?.running);
      const pending = useSessionStatus((state) => state.get(member.id)?.pendingInteraction);
      const unread = useSessionStatus((state) => state.get(member.id)?.completionUnread);
      const summaryRunning = useSessions((state) => state.byId[member.id]?.running);
      const runtimeVersion = useRuntimeVersion();
      const status = useMemo(
        () =>
          deriveStatus(member, {
            running: running ?? summaryRunning,
            pending,
            unread,
            timing: memberRuntime.runtimeOf(member.id),
            ack: memberRuntime.ackOf(member.id),
          }),
        [member, running, summaryRunning, pending, unread, runtimeVersion],
      );
      const roleInfo = roleOrFallback(member);
      const display = roleInfo.zh.name;
      const role = roleInfo.zh.role;
      const statusText = t(`status.${status}`);
      const subline = task === '' ? role : `${role} · ${task}`;
      const open = () => onOpen(member.id);
      // Only a running turn can be interrupted, so the button exists on those two
      // states alone — every other row keeps its full width.
      const stoppable = status === 'working' || status === 'waiting';

      return h(
        'div',
        {
          className: `wt-row wt-st-${status}`,
          role: 'group',
          'aria-label': display,
          'data-wt-member': member.id,
          'data-wt-handoff': handoff === undefined ? undefined : handoff.kind,
          title: `${display} · ${subline} · ${statusText}`,
          // Pointer fallback only: the stretched hit button below takes every real
          // click and stops propagation, so this fires only if that button is
          // clipped away by a stylesheet failure.
          onClick: open,
        },
        h('button', {
          type: 'button',
          className: 'wt-row-hit',
          'aria-label': fillCopy(t('row.open'), { name: display }),
          onClick: (event) => {
            event.stopPropagation();
            open();
          },
        }),
        h(RoleAvatar, { role: roleInfo, size: 28, status, bubble: status === 'waiting', sparkle }),
        h(
          'span',
          { className: 'wt-row-main' },
          h('span', { className: 'wt-row-name' }, display),
          h('span', { className: 'wt-row-role' }, subline),
        ),
        stoppable
          ? h(
              'button',
              {
                type: 'button',
                className: 'wt-row-act',
                'aria-label': t('card.stop'),
                title: t('card.stop'),
                onClick: (event) => {
                  // The row itself opens the chat; this click is not that.
                  event.preventDefault();
                  event.stopPropagation();
                  onStop(member.id);
                },
              },
              '■',
            )
          : null,
        h(
          'span',
          { className: 'wt-row-state' },
          h('span', { className: 'wt-row-dot' }),
          h('span', { className: 'wt-row-state-label' }, statusText),
        ),
        handoff !== undefined && handoff.kind === 'out'
          ? h('span', { className: 'wt-row-hand' }, `→ ${handoff.from}`)
          : null,
      );
    }

    /** An unfilled seat in the same 44px rhythm, so the list keeps one column. */
    function EmptyRow({ role, t, canHire }) {
      return h(
        'div',
        { className: 'wt-row wt-row-empty wt-st-idle', 'data-wt-empty': role.id },
        h(RoleAvatar, { role, size: 28, status: 'idle', dim: true }),
        h(
          'span',
          { className: 'wt-row-main' },
          h('span', { className: 'wt-row-name' }, role.zh.name),
          h(
            'span',
            { className: 'wt-row-role' },
            canHire
              ? `${role.zh.role} · ${t('dispatch.hireHint')}`
              : `${role.zh.role} · ${t('empty.full')}`,
          ),
        ),
        h('span', { className: 'wt-row-state' }, h('span', { className: 'wt-row-state-label' }, t('empty.seat'))),
      );
    }




    /** The full-body pixel figure used in the corridor (desk + walker). */
    function Figure({ role, size = 44, status = 'idle' }) {
      const fig = pixelFigure(role, size, status);
      const groups = { outline: [], fx: [], legs: [], shoes: [], body: [], prop: [], badge: [] };
      for (const layer of fig.layers) groups[layer.part].push(layer);
      const draw = (list) =>
        list.map((layer, i) => h('path', { key: layer.part + i, d: layer.d, fill: layer.fill }));
      return h(
        'svg',
        {
          viewBox: `0 0 ${fig.w} ${fig.h}`,
          width: size,
          height: Math.round((size * fig.h) / fig.w),
          shapeRendering: 'crispEdges',
          className: 'wt-fig',
          'aria-hidden': true,
        },
        draw(groups.outline),
        draw(groups.fx),
        draw(groups.legs),
        draw(groups.shoes),
        h('g', { className: 'wt-fig-body' }, draw(groups.body)),
        draw(groups.prop),
        draw(groups.badge),
      );
    }

    // ---------------------------------------------------------------------
    // Corridor (OfficeTab, option A)
    // ---------------------------------------------------------------------

    /** One workstation: chair, desk, monitor, plate, avatar.
     *
     * Same contract as OfficeRow — `role="group"`, a stretched `.wt-desk-hit`
     * button, the pause button rendered only while the turn can be stopped —
     * so Enter/Space, the aria labels and the stop-then-open guard behave
     * exactly as they do in the row list. */
    function DeskCard({
      member,
      task,
      t,
      handoff,
      sparkle,
      onOpen,
      onStop,
      useSessions,
      useSessionStatus,
      index,
      side,
      absent,
      receive,
      register,
    }) {
      const running = useSessionStatus((state) => state.get(member.id)?.running);
      const pending = useSessionStatus((state) => state.get(member.id)?.pendingInteraction);
      const unread = useSessionStatus((state) => state.get(member.id)?.completionUnread);
      const summaryRunning = useSessions((state) => state.byId[member.id]?.running);
      const runtimeVersion = useRuntimeVersion();
      const status = useMemo(
        () =>
          deriveStatus(member, {
            running: running ?? summaryRunning,
            pending,
            unread,
            timing: memberRuntime.runtimeOf(member.id),
            ack: memberRuntime.ackOf(member.id),
          }),
        [member, running, summaryRunning, pending, unread, runtimeVersion],
      );
      const roleInfo = roleOrFallback(member);
      const display = roleInfo.zh.name;
      const role = roleInfo.zh.role;
      const statusText = t(`status.${status}`);
      const subline = task === '' ? role : `${role} · ${task}`;
      const open = () => onOpen(member.id);
      const stoppable = status === 'working' || status === 'waiting';
      // V5: the plate is one line — name · dot · status word. The handoff arrow
      // is not a status, so it moves into the title instead of evicting one.
      const handoffLine =
        handoff !== undefined && handoff.kind === 'out' ? `${display} → ${handoff.from}` : subline;

      return h(
        'div',
        {
          className: `wt-desk wt-st-${status}`,
          'data-side': side,
          'data-wt-status': status,
          'data-wt-absent': absent ? 'true' : undefined,
          'data-wt-receive': receive ? 'true' : undefined,
          role: 'group',
          'aria-label': `${display} · ${subline} · ${statusText}`,
          'data-wt-member': member.id,
          'data-wt-handoff': handoff === undefined ? undefined : handoff.kind,
          title: `${handoffLine} · ${statusText}`,
          ref: (node) => register(index, node),
          onClick: open,
        },
        h('span', { className: 'wt-desk-chair' }),
        h('span', { className: 'wt-desk-av' }, h(Figure, { role: roleInfo, size: 44, status })),
        sparkle ? h('span', { className: 'wt-sparkle wt-desk-sparkle' }, '✦') : null,
        h('span', { className: 'wt-desk-mon' }),
        h('span', { className: 'wt-desk-foot' }),
        h('span', { className: 'wt-desk-top' }),
        h('span', { className: 'wt-desk-front' }),
        h('button', {
          type: 'button',
          className: 'wt-desk-hit',
          'aria-label': fillCopy(t('row.open'), { name: display }),
          onClick: (event) => {
            event.stopPropagation();
            open();
          },
        }),
        stoppable
          ? h(
              'button',
              {
                type: 'button',
                className: 'wt-desk-act',
                'aria-label': t('card.stop'),
                title: t('card.stop'),
                onClick: (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onStop(member.id);
                },
              },
              '■',
            )
          : null,
        // The plate repeats the desk's accessible name, so it is hidden from
        // assistive tech: the root label already carries name · role · task ·
        // status. (The empty seat keeps its plate readable — that is the only
        // place 「说「招」」 exists.)
        h(
          'span',
          { className: 'wt-desk-plate', 'aria-hidden': 'true' },
          h('span', { className: 'wt-desk-name' }, display),
          h('span', { className: 'wt-desk-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'wt-desk-state' }, statusText),
        ),
        receive ? h('span', { className: 'wt-desk-gift', 'aria-hidden': 'true' }) : null,
      );
    }

    /** An unfilled workstation: same furniture, dimmed avatar, same locale keys
     * as the empty row. It is not a button — the existing hire path is saying
     * 「招」 in the chat, and inventing a second entry point would fork it. */
    function EmptyDesk({ role, t, canHire, index, side }) {
      return h(
        'div',
        {
          className: 'wt-desk wt-desk-empty wt-st-idle',
          'data-side': side,
          'data-wt-empty': role.id,
          role: 'group',
          'aria-label': `${t('empty.seat')} · ${role.zh.name}`,
          title: `${role.zh.name} · ${role.zh.role}`,
        },
        h('span', { className: 'wt-desk-chair wt-desk-chair-empty' }),
        h('span', { className: 'wt-desk-seat' }),
        h('span', { className: 'wt-desk-mon' }),
        h('span', { className: 'wt-desk-foot' }),
        h('span', { className: 'wt-desk-top' }),
        h('span', { className: 'wt-desk-front' }),
        h(
          'span',
          { className: 'wt-desk-plate' },
          h('span', { className: 'wt-desk-name' }, t('empty.seat')),
          h('span', { className: 'wt-desk-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'wt-desk-state' }, canHire ? t('dispatch.hireHint') : t('empty.full')),
        ),
      );
    }

    /** The walker's footprint in px — .wt-walker is 44×44 in the stylesheet and
     * the figure is drawn at the same size. The geometry below subtracts it from
     * the giver's floor bottom, so a size change only has to happen once. */
    const WALKER_SIZE = 44;

    /**
     * The nearest ancestor that actually scrolls this column. The corridor is
     * content-height (its scroller is `.wt-panel-body`), so its own rect is not
     * a viewport — asking it whether a desk is visible would always say yes.
     */
    function scrollParent(node) {
      let el = node === null ? null : node.parentElement;
      while (el !== null && el !== document.body) {
        const overflowY = getComputedStyle(el).overflowY;
        if (overflowY === 'auto' || overflowY === 'scroll') return el;
        el = el.parentElement;
      }
      return null;
    }

    /**
     * The corridor: eight desks in one column, alternating sides around a lane,
     * one road, one walker.
     *
     * V5 movement contract: the walker is the only animation that claims an
     * event happened, so exactly two real employee↔employee sources can start
     * it — `handoffs` (a task changed owner while in progress; flashHandoff has
     * one call site) and `dialogues` (reserved, nothing writes it today). There
     * is no idle wandering, and assigning work from the lead is a dispatch,
     * not a handover, so it never walks. A new event clears the old timers;
     * only one walker ever exists.
     *
     * A walk plays only when both ends are on screen and the user did not ask
     * for reduced motion. Otherwise it degrades to the opacity-only flash on
     * `[data-wt-handoff]`, and no timer is queued at all.
     */
    function Corridor({
      items,
      t,
      handoffs,
      dialogues,
      sparkles,
      onOpen,
      onStop,
      useSessions,
      useSessionStatus,
    }) {
      const [walk, setWalk] = useState(null);
      const [absent, setAbsent] = useState(-1);
      const [receive, setReceive] = useState(-1);
      const track = useRef(null);
      const desks = useRef(new Map());
      const timers = useRef([]);
      const seen = useRef(new Map());

      const register = useCallback((index, node) => {
        if (node === null) desks.current.delete(index);
        else desks.current.set(index, node);
      }, []);

      const clearTimers = useCallback(() => {
        for (const id of timers.current) clearTimeout(id);
        timers.current = [];
      }, []);

      /** One walker, one timeline. `steps` are [delayMs, fn] from the start. */
      const runWalk = useCallback(
        (state, steps) => {
          clearTimers();
          setAbsent(typeof state.fromIdx === 'number' ? state.fromIdx : -1);
          setReceive(-1);
          setWalk(state);
          for (const [ms, fn] of steps) timers.current.push(setTimeout(fn, ms));
        },
        [clearTimers],
      );

      const finish = useCallback(() => {
        setWalk(null);
        setAbsent(-1);
        setReceive(-1);
      }, []);

      useEffect(() => clearTimers, [clearTimers]);

      // ── movement: real employee↔employee events only ─────────────────────
      // `handoffs` — a task changed owner while still in_progress. flashHandoff
      //   has exactly one call site, so dispatching work (lead → employee)
      //   never walks: that is an assignment, not a handover.
      // `dialogues` — reserved for a host-projected employee↔employee chat. The
      //   client projects no such event today, so nothing calls flashDialogue
      //   and this branch never fires. No timer may stand in for one.
      useEffect(() => {
        // Motion-sensitive users get no walker and no timers at all; the
        // [data-wt-handoff] flash is the whole story for them.
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const events = [];
        if (handoffs !== undefined) {
          for (const [name, mark] of handoffs) {
            if (mark.kind === 'out') {
              // `name` is the giver (map key = member.name); `peer` is the raw
              // name of the receiver. `mark.from` is only a label.
              events.push({ kind: 'handoff', from: name, to: mark.peer, at: mark.at });
            }
          }
        }
        if (dialogues !== undefined) {
          for (const [name, mark] of dialogues) {
            events.push({ kind: 'dialogue', from: name, to: mark.to, at: mark.at });
          }
        }
        if (events.length === 0) return;
        // One key per seat, and it is the raw identity: `handoffs` is keyed by
        // `member.name` (the role id, the same value `task.ownerName` carries),
        // while `roleOrFallback(...).zh.name` is only the label a reader sees.
        const indexOf = new Map();
        items.forEach((item, i) => {
          indexOf.set(item.member === null ? item.role.id : item.member.name, i);
        });
        for (const event of events) {
          const seenKey = `${event.kind}:${event.from}`;
          if (seen.current.get(seenKey) === event.at) continue;
          seen.current.set(seenKey, event.at);
          const toIdx = indexOf.get(event.to);
          const fromIdx = indexOf.get(event.from);
          if (toIdx === undefined || fromIdx === undefined || toIdx === fromIdx) continue;
          const trackNode = track.current;
          const fromNode = desks.current.get(fromIdx);
          const toNode = desks.current.get(toIdx);
          if (trackNode === null || fromNode === undefined || toNode === undefined) continue;
          // Both ends must be on screen: a walk the user cannot see is a
          // promise they cannot check, so it degrades to the flash. The column
          // itself is content-height, so the visible band is the real scroller
          // above it clipped by the window — measuring the column would call
          // every desk visible.
          const panel = scrollParent(fromNode);
          const panelBox = panel === null ? null : panel.getBoundingClientRect();
          const view = {
            top: Math.max(0, panelBox === null ? 0 : panelBox.top),
            bottom: Math.min(window.innerHeight, panelBox === null ? window.innerHeight : panelBox.bottom),
          };
          const onScreen = (node) => {
            const r = node.getBoundingClientRect();
            return r.bottom > view.top && r.top < view.bottom;
          };
          if (!onScreen(fromNode) || !onScreen(toNode)) continue;
          // Measured, not assumed: the walker starts on the giver's floor and
          // travels the real pitch between the two desks, so a floor-height or
          // gap change cannot desync it from the road.
          const trackBox = trackNode.getBoundingClientRect();
          const fromBox = fromNode.getBoundingClientRect();
          const toBox = toNode.getBoundingClientRect();
          const sender = items[fromIdx];
          const role = sender.member === null ? sender.role : roleOrFallback(sender.member);
          // The clock is per row, not per event: one row is a short hop, seven
          // rows are a walk. Same table as the spec (§4.2), so the CSS duration
          // and the JS phase timers cannot disagree.
          const rows = Math.abs(toIdx - fromIdx);
          const pick = 420;
          const walkMs = Math.min(2400, 160 + rows * 240);
          const backMs = Math.min(1600, rows * 200);
          const tGive = pick + walkMs;
          const tNod = tGive + 140;
          const tBack = tNod + 480;
          const tEnd = tBack + backMs + 180;
          const steps =
            event.kind === 'handoff'
              ? [
                  [tGive, () => setWalk((w) => (w === null ? w : { ...w, phase: 'give' }))],
                  [
                    tNod,
                    () => {
                      // The sheet lands while the giver still holds the nod.
                      setReceive(toIdx);
                      setWalk((w) => (w === null ? w : { ...w, phase: 'nod' }));
                    },
                  ],
                  [tBack, () => setWalk((w) => (w === null ? w : { ...w, phase: 'back' }))],
                  // Cross-fade: the giver is back at the desk while the walker
                  // fades out on top of them, not after it vanished.
                  [tEnd - 180, () => setAbsent(-1)],
                  [tEnd, finish],
                ]
              : [
                  [tGive, () => setWalk((w) => (w === null ? w : { ...w, phase: 'chat' }))],
                  [tBack, () => setWalk((w) => (w === null ? w : { ...w, phase: 'back' }))],
                  // Same cross-fade as a handoff: a conversation ends with the
                  // speaker back at their own desk, not with a hard cut.
                  [tEnd - 180, () => setAbsent(-1)],
                  [tEnd, finish],
                ];
          runWalk(
            {
              kind: event.kind,
              fromIdx,
              phase: 'out',
              dy: toBox.top - fromBox.top,
              top: fromBox.bottom - trackBox.top - WALKER_SIZE,
              toSide: toIdx % 2 === 0 ? 'left' : 'right',
              walkMs,
              backMs,
              pick,
              role,
              status: fromNode.getAttribute('data-wt-status') ?? 'working',
            },
            steps,
          );
          break;
        }
      }, [handoffs, dialogues, items, runWalk, finish]);

      return h(
        'div',
        { className: 'wt-corridor' },
        h(
          'div',
          { className: 'wt-road-track', ref: track },
          // One road for the whole column: the track is as tall as the content,
          // so the lane, its centre line and both end caps never break at a
          // floor seam.
          h('span', { className: 'wt-road', 'aria-hidden': 'true' }),
          ...items.map((item, i) =>
            h(
              'div',
              { className: 'wt-floor', key: item.key },
              item.member === null
                ? h(EmptyDesk, {
                    role: item.role,
                    t,
                    canHire: item.canHire,
                    index: i,
                    side: i % 2 === 0 ? 'left' : 'right',
                  })
                : h(DeskCard, {
                    member: item.member,
                    task: item.task,
                    t,
                    handoff: handoffs === undefined ? undefined : handoffs.get(item.member.name),
                    sparkle: sparkles !== undefined && sparkles.has(item.member.name),
                    onOpen,
                    onStop,
                    useSessions,
                    useSessionStatus,
                    index: i,
                    side: i % 2 === 0 ? 'left' : 'right',
                    absent: absent === i,
                    receive: receive === i,
                    register,
                  }),
            ),
          ),
          walk === null
            ? null
            : h(
                'div',
                {
                  className: 'wt-walker',
                  'data-phase': walk.phase,
                  'data-kind': walk.kind,
                  'data-wt-walker': walk.kind,
                  'data-to-side': walk.toSide,
                  style: {
                    top: `${walk.top}px`,
                    '--wt-dy': `${walk.dy}px`,
                    '--wt-walk-ms': `${walk.walkMs}ms`,
                    '--wt-back-ms': `${walk.backMs}ms`,
                    '--wt-pick-ms': `${walk.pick}ms`,
                  },
                  'aria-hidden': true,
                },
                h(Figure, { role: walk.role, size: WALKER_SIZE, status: walk.status }),
                walk.kind === 'handoff' ? h('span', { className: 'wt-walker-card' }) : null,
              ),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // Dispatch: dock seat and @-overlay
    // ---------------------------------------------------------------------

    /**
     * The dock's dispatch surface. It is mounted only while its member is the
     * expanded one, so it never shares the 32px row with the facepile; the parent
     * owns `expandedId` and hands focus back to the seat afterwards.
     */
    function DockSeat({ member, t, dispatch, onCollapse }) {
      const role = roleOrFallback(member);
      const inputRef = useRef(null);
      const [text, setText] = useState('');
      const [phase, setPhase] = useState('edit');
      const [error, setError] = useState('');

      // Mounting is the focus trigger now that the seat only exists while open.
      useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus?.(), 0);
        return () => clearTimeout(timer);
      }, []);

      useEffect(() => {
        if (phase !== 'sent') return undefined;
        const timer = setTimeout(() => {
          setText('');
          setPhase('edit');
          onCollapse();
        }, 1600);
        return () => clearTimeout(timer);
      }, [phase, onCollapse]);

      useEffect(() => {
        if (phase !== 'error') return undefined;
        const timer = setTimeout(() => setPhase('edit'), 2400);
        return () => clearTimeout(timer);
      }, [phase]);

      const submit = async () => {
        const body = text.trim();
        if (body === '' || phase === 'sending') return;
        setPhase('sending');
        setError('');
        try {
          await dispatch(member.id, body);
          flashSparkle(member.name);
          setPhase('sent');
        } catch (reason) {
          setError(errorText(reason));
          setPhase('error');
          inputRef.current?.focus?.();
        }
      };

      const name = role.zh.name;
      const placeholder = fillCopy(t('dispatch.placeholder'), { name });
      return h(
        'div',
        {
          className: 'wt-seat',
          'data-wt-seat': member.id,
          // Esc has to work from anywhere in the surface — the input, the send
          // button, or the error line. Enter stays the input's job: a focused send
          // button already submits through its own click, and catching Enter here
          // too would fire it twice.
          onKeyDown: (event) => {
            if (event.nativeEvent?.isComposing === true) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              onCollapse();
              return;
            }
            if (event.key !== 'Enter' || event.target !== inputRef.current) return;
            event.preventDefault();
            void submit();
          },
        },
        h(
          'div',
          {
            className: 'wt-card wt-seat-open',
            'data-expanded': 'true',
            'data-error': phase === 'error' ? 'true' : undefined,
          },
          h(RoleAvatar, { role, size: 24, status: phase === 'sent' ? 'done' : 'idle' }),
          phase === 'sent'
            ? h(
                'span',
                { className: 'wt-seat-sent', role: 'status' },
                fillCopy(t('dispatch.sent'), { name }),
              )
            : h(
                React.Fragment,
                null,
                h('input', {
                  ref: inputRef,
                  type: 'text',
                  className: 'wt-seat-input',
                  value: text,
                  placeholder,
                  'aria-label': placeholder,
                  disabled: phase === 'sending',
                  onChange: (event) => setText(event.target.value),
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'wt-seat-send',
                    'aria-label': t('dispatch.send'),
                    title: t('dispatch.send'),
                    disabled: text.trim() === '' || phase === 'sending',
                    onClick: () => void submit(),
                  },
                  phase === 'sending' ? '…' : '↑',
                ),
              ),
          error === ''
            ? null
            : h(
                'div',
                { className: 'wt-seat-error', role: 'alert', title: error },
                fillCopy(t('dispatch.failed'), { reason: error }),
              ),
        ),
      );
    }

    /** One @-candidate row; hook usage keeps a row's live status without a loop. */
    function DispatchCandidateRow({ entry, active, hint, useSessions, useSessionStatus, t, onPick }) {
      const memberId = entry.member?.id;
      const running = useSessionStatus((state) => state.get(memberId)?.running);
      const pending = useSessionStatus((state) => state.get(memberId)?.pendingInteraction);
      const unread = useSessionStatus((state) => state.get(memberId)?.completionUnread);
      const summaryRunning = useSessions((state) => state.byId[memberId]?.running);
      const runtimeVersion = useRuntimeVersion();
      const status = useMemo(
        () =>
          deriveStatus(entry.member ?? { phase: 'idle' }, {
            running: running ?? summaryRunning,
            pending,
            unread,
            timing: memberRuntime.runtimeOf(memberId),
            ack: memberRuntime.ackOf(memberId),
          }),
        [entry.member, memberId, running, summaryRunning, pending, unread, runtimeVersion],
      );
      const idle = entry.member === null;
      return h(
        'div',
        {
          className: `wt-dispatch-row${active ? ' active' : ''}${idle ? ' idle' : ''}`,
          role: 'option',
          id: `wt-dispatch-option-${entry.key}`,
          'aria-selected': active ? 'true' : 'false',
          'aria-disabled': idle ? 'true' : undefined,
          onMouseDown: (event) => {
            event.preventDefault();
            onPick(entry);
          },
        },
        h(RoleAvatar, {
          role: entry.role,
          size: 28,
          status: idle ? 'idle' : status,
          dim: idle,
        }),
        h(
          'span',
          { className: 'wt-dispatch-id' },
          h('span', { className: 'wt-dispatch-name' }, entry.role.zh.name),
          h('span', { className: 'wt-dispatch-role' }, entry.role.zh.role),
        ),
        h(
          'span',
          { className: 'wt-dispatch-state' },
          idle
            ? h('span', { className: 'wt-pill' }, hint ? t('dispatch.hireHint') : t('dispatch.notHired'))
            : h(
                React.Fragment,
                null,
                h('span', { className: 'wt-dot ' + status }),
                t(`status.${status}`),
              ),
        ),
      );
    }

    /**
     * The `@name` completion overlay. The composer draft drives the candidate
     * stage; once a teammate is picked the overlay owns a local input (the
     * composer draft is cleared) so a half-typed task never leaks into the Lead's
     * message. Failures restore the composer text — nothing is ever swallowed.
     */
    function DispatchOverlay(props) {
      const {
        sessionId,
        useInput,
        inputActions,
        useProjection,
        useSessions,
        useSessionStatus,
        t,
        dispatch,
      } = props;
      const draft = useInput((state) => state.draft);
      const team = useProjection('agentTeam');
      const [stage, setStage] = useState('idle');
      const [target, setTarget] = useState(null);
      const [text, setText] = useState('');
      const [error, setError] = useState('');
      const [activeKey, setActiveKey] = useState('');
      const [dismissed, setDismissed] = useState('');
      const [hintKey, setHintKey] = useState('');
      const rootRef = useRef(null);
      const inputRef = useRef(null);
      const pickedDraft = useRef('');
      const inFlight = useRef(false);
      // Latest committed composer draft: a successful retry must be able to spot
      // (and clear) only the exact fallback text it handed back on failure.
      const draftRef = useRef(draft);
      draftRef.current = draft;

      const members = useMemo(
        () => (team?.members ?? []).filter((member) => member.role !== 'lead'),
        [team],
      );
      const typing = /^@(\S*)$/.exec(draft);
      const query = typing === null ? '' : typing[1];
      const entries = useMemo(() => {
        // A failed hire is not dispatchable and its name is not reusable, so it
        // leaves the list entirely instead of turning into a vacancy (`taken`
        // keeps its role id out of the vacancy pass below).
        const hired = members
          .filter((member) => member.phase !== 'failed')
          .map((member) => ({
            key: member.id,
            member,
            role: roleOrFallback(member),
          }));
        const taken = new Set(members.map((member) => member.name));
        const vacant = ROLES.filter((role) => !taken.has(role.id)).map((role) => ({
          key: role.id,
          member: null,
          role,
        }));
        const all = [...hired, ...vacant];
        const needle = query.toLowerCase();
        if (needle === '') return all;
        return all.filter((entry) => {
          const role = entry.role;
          return (
            role.id.toLowerCase().includes(needle) ||
            role.zh.name.toLowerCase().includes(needle) ||
            role.en.name.toLowerCase().includes(needle) ||
            role.zh.role.toLowerCase().includes(needle) ||
            role.en.role.toLowerCase().includes(needle) ||
            String(entry.member?.name ?? '').toLowerCase().includes(needle)
          );
        });
      }, [members, query]);
      const selectable = useMemo(() => entries.filter((entry) => entry.member !== null), [entries]);
      /**
       * The official `ui-reference` menu occupies the same overlay slot on `@`,
       * so a bare `@`, a path (`@src/…`), or a filename must stay with it. Our
       * list only opens once the query actually names a teammate.
       */
      const listOpen =
        query !== '' && stage === 'idle' && draft !== dismissed && entries.length > 0;
      const open = listOpen || stage !== 'idle';

      const pick = useCallback(
        (entry) => {
          if (entry === undefined || entry === null) return;
          if (entry.member === null) {
            setHintKey(entry.key);
            return;
          }
          pickedDraft.current = draft;
          setTarget({ id: entry.member.id, name: entry.role.zh.name, role: entry.role });
          setText('');
          setError('');
          setStage('compose');
          inputActions.setDraft('');
        },
        [draft, inputActions],
      );

      const send = useCallback(async () => {
        const body = text.trim();
        if (body === '' || target === null || inFlight.current) return;
        inFlight.current = true;
        setStage('sending');
        setError('');
        try {
          await dispatch(target.id, body);
          flashSparkle(target.name);
          // A retry after a failure leaves the same task as `@name body` in the
          // composer; submitting that again would dispatch the task twice. Clear
          // it only while it is still byte-identical to what we handed back, so a
          // draft the user edited is never touched.
          if (draftRef.current === `@${target.name} ${body}`) inputActions.setDraft('');
          setStage('sent');
        } catch (reason) {
          const message = errorText(reason);
          setError(message);
          setStage('compose');
          // Hand the text back to the composer as well: it is the Host's own
          // `@role` route, so the user can retry even if the overlay dies.
          inputActions.setDraft(`@${target.name} ${body}`);
          setTimeout(() => {
            const node = inputRef.current;
            if (node === null) return;
            node.focus();
            try {
              node.setSelectionRange(node.value.length, node.value.length);
            } catch {
              // Some browsers reject range edits on a detached node.
            }
          }, 0);
        } finally {
          inFlight.current = false;
        }
      }, [dispatch, inputActions, target, text]);

      const backToList = useCallback(() => {
        if (target === null) return;
        const body = text.trim();
        setStage('idle');
        setDismissed('');
        setActiveKey(target.id);
        if (body === '') {
          inputActions.setDraft(pickedDraft.current === '' ? `@${target.name}` : pickedDraft.current);
        } else {
          // Never drop a typed task: park it in the composer when leaving the input.
          inputActions.setDraft(`@${target.name} ${body}`);
          setText('');
        }
        focusComposerFrom(rootRef.current);
      }, [inputActions, target, text]);

      useEffect(() => {
        if (!listOpen) return;
        if (selectable.some((entry) => entry.key === activeKey)) return;
        setActiveKey(selectable[0]?.key ?? '');
      }, [listOpen, selectable, activeKey]);

      useEffect(() => {
        if (hintKey === '') return undefined;
        const timer = setTimeout(() => setHintKey(''), 2000);
        return () => clearTimeout(timer);
      }, [hintKey]);

      useEffect(() => {
        if (!listOpen) return undefined;
        const onKeyDown = (event) => {
          // Never steal keys while an IME composition is in flight.
          if (event.isComposing === true || event.keyCode === 229) return;
          // Only the composer editor owns these keys. Anywhere else (the office
          // search box, a task-board input) the page keeps its own arrow/Enter.
          const focused = document.activeElement;
          if (!(focused instanceof Element) || focused.closest('[data-composer-input]') === null) {
            return;
          }
          const key = event.key;
          if (key === 'ArrowDown' || key === 'ArrowUp') {
            if (selectable.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            const index = selectable.findIndex((entry) => entry.key === activeKey);
            const next =
              key === 'ArrowDown'
                ? Math.min(selectable.length - 1, index + 1)
                : Math.max(0, index - 1);
            setActiveKey(selectable[next]?.key ?? '');
            return;
          }
          if (key === 'Enter') {
            if (selectable.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            pick(selectable.find((entry) => entry.key === activeKey) ?? selectable[0]);
            return;
          }
          if (key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setDismissed(draft);
            return;
          }
          if (key === 'Tab') {
            // The overlay closes, but Tab still belongs to the composer.
            setDismissed(draft);
          }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [listOpen, selectable, activeKey, draft, pick]);

      useEffect(() => {
        if (stage !== 'compose') return undefined;
        const timer = setTimeout(() => inputRef.current?.focus?.(), 0);
        return () => clearTimeout(timer);
      }, [stage]);

      useEffect(() => {
        if (stage !== 'sent') return undefined;
        const timer = setTimeout(() => {
          setStage('idle');
          setTarget(null);
          setText('');
        }, 1600);
        return () => clearTimeout(timer);
      }, [stage]);

      useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const node = rootRef.current;
          if (node === null || !(event.target instanceof Node)) return;
          if (node.contains(event.target)) return;
          if (event.target instanceof Element && event.target.closest('[data-composer-card]') !== null) {
            return;
          }
          setDismissed(draft);
          if (stage !== 'idle') {
            setStage('idle');
            setTarget(null);
            setText('');
          }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
      }, [open, draft, stage]);

      if (!open) return null;
      if (sessionId === undefined) return null;

      const placeholder =
        target === null ? t('dispatch.placeholder') : fillCopy(t('dispatch.placeholder'), { name: target.name });
      return h(
        'div',
        {
          className: 'wt-dispatch',
          ref: rootRef,
          role: 'group',
          'aria-label': t('dispatch.candidates'),
          'data-work-team-dispatch': 'true',
        },
        listOpen
          ? h(
              'div',
              {
                className: 'wt-dispatch-list',
                role: 'listbox',
                'aria-label': t('dispatch.candidates'),
                'aria-activedescendant':
                  activeKey === '' ? undefined : `wt-dispatch-option-${activeKey}`,
              },
              ...entries.map((entry) =>
                h(DispatchCandidateRow, {
                  key: entry.key,
                  entry,
                  active: entry.key === activeKey,
                  hint: entry.key === hintKey,
                  useSessions,
                  useSessionStatus,
                  t,
                  onPick: pick,
                }),
              ),
            )
          : null,
        target !== null && (stage === 'compose' || stage === 'sending')
          ? h(
              'div',
              { className: 'wt-dispatch-compose' },
              h(
                'span',
                { className: 'wt-dispatch-target' },
                h(RoleAvatar, { role: target.role, size: 20, status: 'idle' }),
                h('span', null, target.name),
              ),
              h('input', {
                ref: inputRef,
                type: 'text',
                className: 'wt-dispatch-input',
                value: text,
                placeholder,
                'aria-label': placeholder,
                disabled: stage === 'sending',
                onChange: (event) => setText(event.target.value),
                onKeyDown: (event) => {
                  if (event.nativeEvent?.isComposing === true) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void send();
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    backToList();
                  }
                },
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'wt-dispatch-send',
                  'aria-label': t('dispatch.send'),
                  title: t('dispatch.send'),
                  disabled: text.trim() === '' || stage === 'sending',
                  onClick: () => void send(),
                },
                stage === 'sending' ? '…' : '↑',
              ),
            )
          : null,
        target !== null && stage === 'sent'
          ? h(
              'div',
              { className: 'wt-dispatch-compose' },
              h(
                'span',
                { className: 'wt-dispatch-target' },
                h(RoleAvatar, { role: target.role, size: 20, status: 'done' }),
              ),
              h(
                'span',
                { className: 'wt-dispatch-sent', role: 'status' },
                fillCopy(t('dispatch.sent'), { name: target.name }),
              ),
            )
          : null,
        error !== '' && stage === 'compose'
          ? h(
              'div',
              { className: 'wt-dispatch-error', role: 'alert', title: error },
              fillCopy(t('dispatch.failed'), { reason: error }),
            )
          : null,
      );
    }

    // ---------------------------------------------------------------------
    // Task board
    // ---------------------------------------------------------------------

    function TaskCard({ task, t, onOpen }) {
      return h(
        'article',
        { className: 'wt-task' },
        h('strong', null, task.subject),
        h('p', null, task.description),
        h(
          'div',
          { className: 'wt-task-meta' },
          h('span', null, task.id),
          task.ownerName
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'wt-btn',
                  style: { padding: '1px 6px', fontSize: '10px' },
                  onClick: () => onOpen(task.ownerName),
                },
                `${t('task.owner')}: ${task.ownerName}`,
              )
            : null,
          task.status === 'pending'
            ? h('span', null, task.ready ? t('task.ready') : t('task.blocked'))
            : null,
          task.blockedBy?.length ? h('span', null, `${t('task.blockedBy')}: ${task.blockedBy.join(', ')}`) : null,
          task.writeScopes?.length ? h('span', null, `${t('task.scopes')}: ${task.writeScopes.join(', ')}`) : null,
          ...(task.writeScopeWarnings ?? []).map((warning) =>
            h('span', { className: 'wt-task-warning', key: warning }, warning),
          ),
        ),
      );
    }

    function TaskColumn({ title, tasks, t, onOpen }) {
      return h(
        'section',
        { className: 'wt-task-column' },
        h('h3', null, title, h('span', { className: 'wt-task-count' }, String(tasks.length))),
        tasks.length === 0
          ? h('div', { className: 'wt-task-empty' }, t('task.empty'), h('br'), t('task.emptyHint'))
          : tasks.map((task) => h(TaskCard, { key: task.id, task, t, onOpen })),
      );
    }

    function TaskBoard({ tasks, t, onOpen }) {
      const pending = tasks.filter((task) => task.status === 'pending');
      const inProgress = tasks.filter((task) => task.status === 'in_progress');
      const completed = tasks.filter((task) => task.status === 'completed');
      return h(
        'div',
        { className: 'wt-task-columns' },
        h(TaskColumn, { title: t('task.pending'), tasks: pending, t, onOpen }),
        h(TaskColumn, { title: t('task.inProgress'), tasks: inProgress, t, onOpen }),
        h(TaskColumn, { title: t('task.completed'), tasks: completed, t, onOpen }),
      );
    }

    // ---------------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------------

    /**
     * The team's page inside the DSH settings dialog. The shell owns the frame,
     * the close button and scrolling; like the Models section, the page draws
     * its own title and intro at the settings scale. The write path is
     * unchanged (configForms.set against the Host schema). The old 380px drawer
     * could afford 11px type — the settings column cannot, so labels and
     * controls sit at the 13–14px settings scale.
     */
    function TeamSettingsSection({ form, loadModelCatalog, t }) {
      const snapshot = useFormSnapshot(form);
      const [catalog, setCatalog] = useState({ status: 'loading', groups: [], failures: [] });
      const [saving, setSaving] = useState('');
      const [error, setError] = useState('');
      const [refreshKey, setRefreshKey] = useState(0);
      const value = snapshot.value ?? {};
      const writable = snapshot.writable === true && snapshot.status === 'ready';

      useEffect(() => {
        let alive = true;
        setCatalog((current) => ({ ...current, status: 'loading' }));
        loadModelCatalog()
          .then((result) => {
            if (!alive) return;
            if (result?.ok === false) {
              setCatalog({
                status: 'error',
                groups: [],
                failures: [],
                message: String(result.error?.message ?? ''),
              });
              return;
            }
            const value = result?.ok === true ? result.value : result;
            setCatalog({
              status: 'ready',
              groups: value?.groups ?? [],
              failures: value?.failures ?? [],
            });
          })
          .catch((reason) => {
            if (!alive) return;
            setCatalog({ status: 'error', groups: [], failures: [], message: String(reason) });
          });
        return () => {
          alive = false;
        };
      }, [loadModelCatalog, refreshKey]);

      const save = useCallback(
        async (field, next) => {
          setSaving(field);
          setError('');
          try {
            const accepted = await form.set(field, next);
            if (!accepted) setError(t('settings.saveFailed'));
          } catch (reason) {
            setError(`${t('settings.saveFailed')} ${String(reason)}`);
          } finally {
            setSaving('');
          }
        },
        [form, t],
      );

      const optionsFor = (current) => {
        const seen = new Set();
        const options = [h('option', { key: '', value: '' }, t('settings.followMain'))];
        if (current !== '' && !catalog.groups.some((group) => group.models.some((model) => `${group.id}::${model.id}` === current))) {
          options.push(h('option', { key: '__saved', value: current }, `${t('settings.unavailable')}: ${current}`));
        }
        for (const group of catalog.groups) {
          const groupOptions = [];
          for (const model of group.models) {
            const id = `${group.id}::${model.id}`;
            if (seen.has(id)) continue;
            seen.add(id);
            groupOptions.push(h('option', { key: id, value: id }, `${model.name} · ${group.name}`));
          }
          if (groupOptions.length > 0) {
            options.push(h('optgroup', { key: group.id, label: group.name }, groupOptions));
          }
        }
        return options;
      };

      const parsedTeamSize = Number(value.teamSize ?? 7);
      const teamSize = Number.isFinite(parsedTeamSize) && parsedTeamSize >= 1 ? Math.min(parsedTeamSize, MAX_TEAM_SIZE) : 7;
      const reporting = String(value.reporting ?? 'milestones');
      const autoStart = ['off', 'first-message', 'immediate'].includes(String(value.autoStart ?? ''))
        ? String(value.autoStart)
        : 'off';
      const parsedMaxWorkers = Number(value.maxWorkersPerEmployee ?? 2);
      const maxWorkers =
        Number.isFinite(parsedMaxWorkers) && parsedMaxWorkers >= 0
          ? Math.min(Math.floor(parsedMaxWorkers), MAX_TEMPORARY_WORKERS)
          : 2;

      return h(
        'div',
        { className: 'wt-settings-section' },
        h('h2', { className: 'wt-settings-title' }, t('settings.sectionTitle')),
        h('p', { className: 'wt-settings-intro' }, t('settings.sectionIntro')),
        snapshot.status === 'loading' ? h('div', { className: 'wt-note' }, t('settings.loading')) : null,
        catalog.status === 'error'
          ? h(
              'div',
              { className: 'wt-note' },
              t('settings.catalogError', {
                message: catalog.message ? catalog.message : t('settings.catalogUnknown'),
              }),
            )
          : null,
        catalog.status === 'ready' && catalog.groups.length === 0
          ? h('div', { className: 'wt-note' }, t('settings.catalogEmpty'))
          : null,
        snapshot.status === 'unavailable'
          ? h('div', { className: 'wt-note' }, t('settings.unavailableForm'))
          : null,
        snapshot.status === 'ready' && snapshot.writable !== true
          ? h('div', { className: 'wt-note' }, t('settings.readOnly'))
          : null,
        h(
          'div',
          { className: 'wt-settings-group' },
          h(
            'div',
            { className: 'wt-field' },
            h('label', { htmlFor: 'wt-team-size' }, t('settings.teamSize')),
            h(
              'select',
              {
                id: 'wt-team-size',
                value: String(teamSize),
                disabled: !writable || saving === 'teamSize',
                onChange: (event) => void save('teamSize', Number(event.target.value)),
              },
              Array.from({ length: MAX_TEAM_SIZE }, (_, index) => index + 1).map((size) =>
                h('option', { key: size, value: String(size) }, `${size}`),
              ),
            ),
            h('small', null, t('settings.teamSizeHint')),
          ),
          h(
            'div',
            { className: 'wt-field' },
            h('label', { htmlFor: 'wt-reporting' }, t('settings.reporting')),
            h(
              'select',
              {
                id: 'wt-reporting',
                value: reporting,
                disabled: !writable || saving === 'reporting',
                onChange: (event) => void save('reporting', event.target.value),
              },
              h('option', { value: 'milestones' }, t('settings.reporting.milestones')),
              h('option', { value: 'completion' }, t('settings.reporting.completion')),
              h('option', { value: 'every-step' }, t('settings.reporting.every-step')),
            ),
          ),
        ),
        h(
          'div',
          { className: 'wt-settings-group' },
          h('div', { className: 'wt-section-title' }, t('settings.automation')),
          h(
            'div',
            { className: 'wt-field' },
            h('label', { htmlFor: 'wt-auto-start' }, t('settings.autoStart')),
            h(
              'select',
              {
                id: 'wt-auto-start',
                value: autoStart,
                disabled: !writable || saving === 'autoStart',
                onChange: (event) => void save('autoStart', event.target.value),
              },
              h('option', { value: 'off' }, t('settings.autoStart.off')),
              h('option', { value: 'first-message' }, t('settings.autoStart.first-message')),
              h('option', { value: 'immediate' }, t('settings.autoStart.immediate')),
            ),
            h('small', null, t('settings.autoStartHint')),
          ),
          h(
            'label',
            { className: 'wt-check' },
            h('input', {
              type: 'checkbox',
              'aria-label': t('settings.allowSelfHire'),
              checked: value.allowSelfHire === true,
              disabled: !writable || saving === 'allowSelfHire',
              onChange: (event) => void save('allowSelfHire', event.target.checked),
            }),
            h(
              'span',
              null,
              h('strong', null, t('settings.allowSelfHire')),
              h('br'),
              h('small', null, t('settings.allowSelfHireHint')),
            ),
          ),
          h(
            'div',
            { className: 'wt-field' },
            h('label', { htmlFor: 'wt-max-workers' }, t('settings.maxWorkers')),
            h(
              'select',
              {
                id: 'wt-max-workers',
                value: String(maxWorkers),
                disabled: !writable || saving === 'maxWorkersPerEmployee',
                onChange: (event) => void save('maxWorkersPerEmployee', Number(event.target.value)),
              },
              Array.from({ length: MAX_TEMPORARY_WORKERS + 1 }, (_, count) => count).map((count) =>
                h(
                  'option',
                  { key: count, value: String(count) },
                  count === 0 ? t('settings.autoStart.off') : String(count),
                ),
              ),
            ),
            h('small', null, t('settings.maxWorkersHint')),
          ),
          h(
            'label',
            { className: 'wt-check' },
            h('input', {
              type: 'checkbox',
              'aria-label': t('settings.dispatchPrefix'),
              checked: value.dispatchPrefix !== false,
              disabled: !writable || saving === 'dispatchPrefix',
              onChange: (event) => void save('dispatchPrefix', event.target.checked),
            }),
            h(
              'span',
              null,
              h('strong', null, t('settings.dispatchPrefix')),
              h('br'),
              h('small', null, t('settings.dispatchPrefixHint')),
            ),
          ),
          h(
            'label',
            { className: 'wt-check' },
            h('input', {
              type: 'checkbox',
              'aria-label': t('settings.trimEmployeeTools'),
              // 字段缺省即「开」：旧会话的投影里没有这个字段，写成 === true 会显示成关闭。
              checked: value.trimEmployeeTools !== false,
              disabled: !writable || saving === 'trimEmployeeTools',
              onChange: (event) => void save('trimEmployeeTools', event.target.checked),
            }),
            h(
              'span',
              null,
              h('strong', null, t('settings.trimEmployeeTools')),
              h('br'),
              h('small', null, t('settings.trimEmployeeToolsHint')),
            ),
          ),
          h(
            'label',
            { className: 'wt-check' },
            h('input', {
              type: 'checkbox',
              'aria-label': t('settings.leadHandsOff'),
              checked: value.leadHandsOff === true,
              disabled: !writable || saving === 'leadHandsOff',
              onChange: (event) => void save('leadHandsOff', event.target.checked),
            }),
            h(
              'span',
              null,
              h('strong', null, t('settings.leadHandsOff')),
              h('br'),
              h('small', null, t('settings.leadHandsOffHint')),
            ),
          ),
        ),
        h(
          'div',
          { className: 'wt-settings-group' },
          h(
            'div',
            { className: 'wt-section-title' },
            t('settings.models'),
            h(
              'button',
              {
                type: 'button',
                className: 'wt-btn',
                onClick: () => setRefreshKey((key) => key + 1),
                disabled: catalog.status === 'loading',
              },
              t('settings.refresh'),
            ),
          ),
          h(
            'div',
            { className: 'wt-settings-roles' },
            ...ROLES.map((role) => {
              const field = role.modelField;
              const current = String(value[field] ?? '');
              return h(
                'div',
                { className: 'wt-role-row', key: role.id },
                h(
                  'div',
                  { className: 'wt-role-name' },
                  h('span', null, role.zh.name),
                  h('small', null, role.zh.role),
                ),
                h(
                  'div',
                  { className: 'wt-field' },
                  h(
                    'select',
                    {
                      value: current,
                      'aria-label': `${role.zh.name} · ${role.zh.role}`,
                      disabled: !writable || saving === field || catalog.status === 'loading',
                      onChange: (event) => void save(field, event.target.value),
                    },
                    ...optionsFor(current),
                  ),
                  saving === field ? h('small', { className: 'wt-saving' }, '…') : null,
                ),
              );
            }),
          ),
          h('div', { className: 'wt-note' }, t('settings.costHint')),
          catalog.failures.length > 0
            ? h(
                'div',
                { className: 'wt-note' },
                h('div', null, t('settings.catalogFailures')),
                ...catalog.failures.map((failure) =>
                  h('div', { key: failure.id }, `${failure.name}: ${failure.message}`),
                ),
              )
            : null,
        ),
        error ? h('div', { className: 'wt-error', role: 'alert' }, error) : null,
      );
    }

    // ---------------------------------------------------------------------
    // Office tab (right sidebar)
    // ---------------------------------------------------------------------

    /**
     * The office as one column of the right sidebar: a 28px summary line, a 28px
     * segmented switch, then either the seat list or the task board. It owns no
     * frame of its own — the sidebar panel is the frame, so the body keeps the
     * panel background and only draws separators.
     */
    function OfficeTab({
      sessionId,
      t,
      openMember,
      stopMember,
      form,
      useSessions,
      useSessionStatus,
      useProjection,
    }) {
      const team = useProjection('agentTeam');
      const [tab, setTab] = useState('office');
      const [error, setError] = useState('');
      const previousTasks = useRef(new Map());
      const members = useMemo(
        () => (team?.members ?? []).filter((member) => member.role !== 'lead'),
        [team],
      );
      const tasks = team?.tasks ?? [];
      const memberByName = useMemo(() => new Map(members.map((member) => [member.name, member])), [members]);
      // The tab shares the dock's poller; the rows below only read the store.
      useMemberWatch(sessionId, members);
      // `ownerName` is the role id; a marker shows the name the row shows.
      const displayName = (name) => {
        const member = memberByName.get(name);
        return member === undefined ? name : roleOrFallback(member).zh.name;
      };
      const formSnapshot = useFormSnapshot(form);
      const parsedCapacity = Number(formSnapshot.value?.teamSize ?? MAX_TEAM_SIZE);
      const capacity =
        Number.isFinite(parsedCapacity) && parsedCapacity >= 1 ? parsedCapacity : MAX_TEAM_SIZE;
      const totalTokens = useSessions((state) =>
        members.reduce(
          (sum, member) => sum + sumTokens(projectionOf(state, member.id, 'tokenUsage')),
          0,
        ),
      );
      const workingCount = useSessionStatus((state) =>
        members.reduce((count, member) => {
          const status = state.get(member.id);
          return count + (status?.running === true && status.pendingInteraction !== true ? 1 : 0);
        }, 0),
      );
      const waitingCount = useSessionStatus((state) =>
        members.reduce((count, member) => {
          const status = state.get(member.id);
          return count + (status?.running === true && status.pendingInteraction === true ? 1 : 0);
        }, 0),
      );
      const sparkles = useSparkles();
      const handoffs = useHandoffs();
      // Reserved: no host projection feeds employee↔employee dialogue yet, so
      // this map stays empty and the corridor never walks for a chat.
      const dialogues = useDialogues();

      // One pass over the tasks reports what changed since the previous render:
      // a finished task sparkles its owner, a changed owner is a handoff.
      useEffect(() => {
        const previous = previousTasks.current;
        const next = new Map();
        const completed = new Set();
        for (const task of tasks) {
          const before = previous.get(task.id);
          if (before !== undefined) {
            if (before.status === 'in_progress' && task.status === 'completed' && task.ownerName) {
              completed.add(task.ownerName);
            }
            if (
              before.ownerName &&
              task.ownerName &&
              before.ownerName !== task.ownerName &&
              task.status === 'in_progress'
            ) {
              flashHandoff(
                before.ownerName,
                task.ownerName,
                displayName(before.ownerName),
                displayName(task.ownerName),
              );
            }
          }
          next.set(task.id, { ownerName: task.ownerName, status: task.status });
        }
        previousTasks.current = next;
        for (const name of completed) flashSparkle(name);
      }, [tasks, memberByName]);

      const taskFor = useCallback(
        (name) => {
          const current = tasks.find((task) => task.status === 'in_progress' && task.ownerName === name);
          return current?.subject ?? '';
        },
        [tasks],
      );

      const extra = members.filter((member) => !ROLE_BY_ID.has(member.name));
      const openTaskCount = tasks.filter((task) => task.status !== 'completed').length;

      const open = (id) => {
        // An empty reason clears whatever the previous action left on screen.
        setError(openMember(sessionId, id));
      };

      const stop = (id) => {
        stopMember(id).then((reason) => {
          setError(reason === '' ? '' : `${t('error.stop')}: ${reason}`);
        });
      };

      return h(
        'div',
        { className: 'wt-panel' },
        h(
          'div',
          { className: 'wt-panel-head' },
          h(
            'div',
            { className: 'wt-panel-stats' },
            h(
              'span',
              { className: 'wt-head-stat', title: t('office.title') },
              `${members.length}/${Math.max(capacity, members.length)} ${t('office.people')}`,
            ),
            h(
              'span',
              { className: 'wt-head-stat', title: t('status.working') },
              `${t('status.working')} ${workingCount}`,
            ),
            h(
              'span',
              { className: 'wt-head-stat', title: t('status.waiting') },
              `${t('status.waiting')} ${waitingCount}`,
            ),
            h(
              'span',
              { className: 'wt-head-stat wt-head-tokens', title: t('office.totalTokens') },
              `${t('office.totalTokens')} ${formatTokens(totalTokens)}`,
            ),
          ),
        ),
        h(
          'div',
          { className: 'wt-seg', role: 'tablist' },
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              'aria-selected': tab === 'office',
              className: tab === 'office' ? 'wt-seg-btn active' : 'wt-seg-btn',
              onClick: () => setTab('office'),
            },
            t('office.tab.office'),
          ),
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              'aria-selected': tab === 'tasks',
              className: tab === 'tasks' ? 'wt-seg-btn active' : 'wt-seg-btn',
              onClick: () => setTab('tasks'),
            },
            `${t('office.tab.tasks')} (${openTaskCount})`,
          ),
        ),
        h(
          'div',
          { className: 'wt-panel-body' },
          error ? h('div', { className: 'wt-error wt-panel-error', role: 'alert' }, error) : null,
          tab === 'office'
            ? h(Corridor, {
                items: [
                  ...ROLES.map((role) => ({
                    key: role.id,
                    role,
                    member: memberByName.get(role.id) ?? null,
                    task: taskFor(role.id),
                    canHire: members.length < capacity,
                  })),
                  ...extra.map((member) => ({
                    key: member.id,
                    role: roleOrFallback(member),
                    member,
                    task: taskFor(member.name),
                    canHire: false,
                  })),
                ],
                t,
                handoffs,
                dialogues,
                sparkles,
                onOpen: open,
                onStop: stop,
                useSessions,
                useSessionStatus,
              })
            : h(TaskBoard, {
                tasks,
                t,
                onOpen: (memberName) => {
                  const member = memberByName.get(memberName);
                  if (member !== undefined) open(member.id);
                },
              }),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // Slots
    // ---------------------------------------------------------------------

    /** Urgency order: what can be unblocked right now outranks what is merely busy. */
    const STATUS_RANK = { waiting: 0, error: 1, failed: 2, done: 3, working: 4, provisioning: 5, ready: 6, idle: 7 };
    const FACE_MAX = 5;
    const CHIP_MAX = 2;
    /** Summary order, same reasoning as STATUS_RANK; CSS only hides the tail. */
    const SUMMARY_STATES = ['waiting', 'error', 'failed', 'done', 'working', 'provisioning'];

    // ---------------------------------------------------------------------
    // V4: the fan (expand layer) and the person card
    // ---------------------------------------------------------------------

    /**
     * Exit timings, read once per page load — same shape as the `touch` probe in
     * Dock. Under reduced motion the fade survives but every move is dropped, so
     * waiting 130ms would only delay the unmount.
     */
    const REDUCED_MOTION =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const FAN_EXIT_MS = REDUCED_MOTION ? 0 : 130;
    const CARD_EXIT_MS = REDUCED_MOTION ? 0 : 130;
    const SHEET_EXIT_MS = REDUCED_MOTION ? 0 : 170;
    /** Below this viewport width the card becomes a bottom sheet (§2.3). */
    const SHEET_BREAKPOINT = 360;
    const FAN_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

    /**
     * Whether focus is still ours to move: on a layer that is closing, or on
     * nothing in particular. Clicking into the composer while a layer closes
     * must keep the caret there — the close lands ~130ms after the click, and an
     * unconditional refocus would drag the caret back to the track.
     */
    function focusWasOurs() {
      if (typeof document === 'undefined') return true;
      const active = document.activeElement;
      if (active === null || active === document.body) return true;
      const inside = active.closest?.('[data-wt-fan], [data-wt-person]');
      return inside !== null && inside !== undefined;
    }

    /**
     * Esc closes exactly one layer per press: the card first, then the fan. The
     * listener only exists while a layer is open, and it only prevents the
     * default when it actually closed something — an idle dock leaves Esc to the
     * host, which is what the platform's own overlays expect.
     */
    function useEscLadder(open, onEscape) {
      useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          if (onEscape() !== true) return;
          event.preventDefault();
          // The host listens for Esc too; this layer consumed the press.
          event.stopPropagation();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [open, onEscape]);
    }

    /**
     * The expand layer. Portalled to `document.body` because it is
     * `position:fixed` against the viewport: the dock is a 32px, clipped,
     * container-query box, and a 70px surface cannot live inside it without
     * changing the track's height or width (§1).
     *
     * Seat order is frozen by the caller for the lifetime of one opening; only
     * each seat's own status is live, so a member finishing a turn mid-animation
     * updates its ring instead of re-shuffling the row under the reader's aim.
     */
    function DockFan({ state, ids, entryOf, sparkleOf, n, more, total, anchorX, bottom, t, fanRef, onPick, onMore }) {
      const onKeyDown = (event) => {
        if (!FAN_KEYS.has(event.key)) return;
        const nodes = [...(fanRef.current?.querySelectorAll('.wt-fan-seat') ?? [])];
        if (nodes.length === 0) return;
        const current = nodes.indexOf(document.activeElement);
        let next;
        if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = nodes.length - 1;
        else if (event.key === 'ArrowLeft') next = current <= 0 ? nodes.length - 1 : current - 1;
        else next = current < 0 || current === nodes.length - 1 ? 0 : current + 1;
        event.preventDefault();
        nodes[next]?.focus?.();
      };
      const centre = (n - 1) / 2;
      return ReactDOM.createPortal(
        h(
          'div',
          {
            className: 'wt-fan',
            id: 'wt-fan',
            role: 'group',
            'aria-label': fillCopy(t('dock.fanAria'), { count: total }),
            'data-wt-fan': '',
            'data-state': state,
            ref: fanRef,
            style: {
              '--wt-fan-n': String(n),
              '--wt-fan-anchor-x': `${Math.round(anchorX)}px`,
              '--wt-fan-bottom': `${Math.round(bottom)}px`,
            },
            onKeyDown,
          },
          ...ids.map((id, index) => {
            const entry = entryOf(id);
            if (entry === undefined) return null;
            const name = entry.role.zh.name;
            return h(
              'button',
              {
                key: id,
                type: 'button',
                className: 'wt-fan-seat',
                'data-wt-seat': id,
                // Unitless numbers on purpose: --wt-i / --wt-c / --wt-k feed
                // calc(), and a unit makes the whole calc() invalid at
                // computed-value time — every seat would then land at once,
                // with no stagger and no direction.
                style: {
                  '--wt-i': String(index),
                  '--wt-c': String(centre),
                  '--wt-k': String(Math.abs(index - centre)),
                },
                'aria-label': fillCopy(t('dock.chipAria'), {
                  name,
                  status: t(`status.${entry.status}`),
                }),
                onClick: () => onPick(id),
              },
              h(RoleAvatar, {
                role: entry.role,
                // 28 keeps the fan on the 24-cell grid: --wt-fan-av renders it
                // at 32/30/28, i.e. 1.33 / 1.25 / 1.17 px per cell, never <1.
                size: 28,
                status: entry.status,
                sparkle: sparkleOf(name),
                bubble: entry.status === 'waiting',
                dot: true,
              }),
              h('span', { className: 'wt-fan-name' }, name),
            );
          }),
          more === 0
            ? null
            : h(
                'button',
                {
                  key: 'more',
                  type: 'button',
                  className: 'wt-fan-seat wt-fan-more',
                  'aria-label': fillCopy(t('dock.moreAria'), { count: more }),
                  onClick: onMore,
                },
                `+${more}`,
              ),
        ),
        document.body,
      );
    }

    /**
     * One member's card. Everything on it is real: the status comes from the same
     * `deriveStatus` the rows use, the task is the in-progress shared task, the
     * model is the Session's own `modelSelection`, and the usage is the same
     * token projection the office header sums.
     */
    function PersonCard({ state, entry, task, t, cardRef, useSessions, onClose, onOpenChat, onDispatch, onStop }) {
      const { member, role, status } = entry;
      const name = role.zh.name;
      const failed = member.phase === 'failed';
      const stoppable = status === 'working' || status === 'waiting';
      const usage = useSessions((snapshot) => sumTokens(projectionOf(snapshot, member.id, 'tokenUsage')));
      const model = memberRuntime.runtimeOf(member.id)?.model;
      const modelText = model === '' ? t('settings.followMain') : String(model ?? '').split('::').join(' / ');
      const facts = [];
      // Unknown is not "no model": only claim a row once the poller has a value.
      if (model !== undefined) facts.push([t('dock.cardModel'), modelText]);
      if (usage > 0) facts.push([t('dock.cardUsage'), formatTokens(usage)]);

      // The trap walks the buttons that are really there: a failed member's card
      // has one, a paused-able one has four. A hard-coded 4 would trap focus on a
      // node that does not exist.
      const trap = (event) => {
        if (event.key !== 'Tab') return;
        const root = cardRef.current;
        if (root === null) return;
        const nodes = [...root.querySelectorAll('button:not(:disabled)')];
        if (nodes.length === 0) {
          event.preventDefault();
          return;
        }
        const current = nodes.indexOf(document.activeElement);
        if (event.shiftKey) {
          if (current <= 0) {
            event.preventDefault();
            nodes[nodes.length - 1].focus();
          }
          return;
        }
        if (current === -1 || current === nodes.length - 1) {
          event.preventDefault();
          nodes[0].focus();
        }
      };

      return ReactDOM.createPortal(
        [
          h('div', {
            key: 'scrim',
            className: 'wt-person-scrim',
            'data-wt-person-scrim': '',
            'data-state': state,
            'aria-hidden': 'true',
            onClick: onClose,
          }),
          h(
            'div',
            {
              key: 'card',
              className: `wt-person wt-st-${status}`,
              'data-wt-person': '',
              'data-state': state,
              role: 'dialog',
              'aria-modal': 'true',
              // `aria-label` wins over `aria-labelledby`, and the reader should
              // hear "{name} 的名片" rather than a bare name, so the label is the
              // accessible name and the id stays as the anchor for the name node.
              'aria-label': fillCopy(t('dock.cardAria'), { name }),
              tabIndex: -1,
              ref: cardRef,
              onKeyDown: trap,
            },
            h(
              'div',
              { className: 'wt-person-head' },
              h(
                'span',
                { className: 'wt-person-av' },
                h(RoleAvatar, {
                  role,
                  size: 48,
                  status,
                  bubble: status === 'waiting',
                  dot: true,
                }),
              ),
              h(
                'div',
                { className: 'wt-person-id' },
                h('div', { className: 'wt-person-name', id: 'wt-person-name' }, name),
                h('div', { className: 'wt-person-role' }, role.zh.role),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'wt-person-x',
                  'aria-label': t('dock.closeCard'),
                  title: t('dock.closeCard'),
                  onClick: onClose,
                },
                '×',
              ),
            ),
            h(
              'div',
              { className: 'wt-person-pill' },
              h('span', { className: 'wt-person-dot', 'aria-hidden': 'true' }),
              t(`status.${status}`),
            ),
            h(
              'div',
              { className: 'wt-person-sec' },
              h('div', { className: 'wt-person-key' }, t('dock.cardTask')),
              h(
                'div',
                { className: 'wt-person-task', 'data-empty': task === '' ? 'true' : undefined },
                task === '' ? '—' : task,
              ),
            ),
            h('div', { className: 'wt-person-rule' }),
            facts.length === 0
              ? null
              : h(
                  'div',
                  { className: 'wt-person-facts' },
                  ...facts.flatMap(([key, value]) => [
                    h('div', { className: 'wt-person-fact-k', key: `${key}-k` }, key),
                    h('div', { className: 'wt-person-fact-v', key: `${key}-v`, title: value }, value),
                  ]),
                ),
            failed
              ? h('div', { className: 'wt-person-note' }, t('dock.cardFailed'))
              : h(
                  'div',
                  { className: 'wt-person-acts' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'wt-person-act',
                      'data-kind': 'primary',
                      title: fillCopy(t('row.open'), { name }),
                      onClick: onOpenChat,
                    },
                    fillCopy(t('row.open'), { name }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'wt-person-act',
                      title: fillCopy(t('dock.dispatchTo'), { name }),
                      onClick: onDispatch,
                    },
                    fillCopy(t('dock.dispatchTo'), { name }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'wt-person-act',
                      'data-kind': 'stop',
                      disabled: !stoppable,
                      onClick: onStop,
                    },
                    t('card.stop'),
                  ),
                ),
          ),
        ],
        document.body,
      );
    }

    function Dock(props) {
      const { sessionId, useSessions, useSessionStatus, useProjection, t, openOffice } = props;
      const team = useProjection('agentTeam');
      const isChild = useSessions((state) => state.byId[sessionId]?.origin === 'subagent');
      const members = useMemo(
        () => (team?.members ?? []).filter((member) => member.role !== 'lead'),
        [team],
      );
      const tasks = team?.tasks ?? [];
      const sparkles = useSparkles();
      const [officeError, setOfficeError] = useState('');
      const [expandedId, setExpandedId] = useState(null);
      const [tipSeat, setTipSeat] = useState(null);
      const dockRef = useRef(null);
      const lastSeat = useRef(null);
      /** Frozen fan order + geometry for one opening; null while collapsed. */
      const [fan, setFan] = useState(null);
      const [card, setCard] = useState(null);
      const fanRef = useRef(null);
      const cardRef = useRef(null);
      const exitTimers = useRef(new Set());
      /** Latest ranked rows, read by openFan without re-creating the callback. */
      const rankedRef = useRef([]);
      /** The seat the card was opened from, so closing it can hand focus back. */
      const lastCardSeat = useRef(null);
      const fanWasOpen = useRef(false);
      // A touch screen cannot hover, so there the first tap opens the tip and the
      // second opens the chat; `↗` inside the tip stays reachable either way.
      const touch = useMemo(
        () => typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches === true,
        [],
      );

      // `useSessionStatus` compares its selection with Object.is, so the snapshot
      // must collapse to a primitive: three flags per member, in roster order.
      // Returning a per-member array here re-renders forever.
      const sig = useSessionStatus((state) =>
        members
          .map((member) => {
            const status = state.get(member.id);
            return `${status?.running ? 1 : 0}${status?.pendingInteraction ? 1 : 0}${status?.completionUnread ? 1 : 0}`;
          })
          .join(''),
      );
      // The dock is the surface that is always mounted while a Session is open,
      // so it carries the poller for the whole office.
      useMemberWatch(sessionId, members);
      const runtimeVersion = useRuntimeVersion();
      // `sig` flips exactly when the platform's session status changes, which is
      // the moment a turn opened or closed: re-read now rather than in 2s.
      useEffect(() => {
        memberRuntime.nudge();
      }, [sig]);

      const ranked = useMemo(
        () =>
          members
            .map((member, index) => ({
              member,
              role: roleOrFallback(member),
              status: deriveStatus(member, {
                running: sig[index * 3] === '1',
                pending: sig[index * 3 + 1] === '1',
                unread: sig[index * 3 + 2] === '1',
                timing: memberRuntime.runtimeOf(member.id),
                ack: memberRuntime.ackOf(member.id),
              }),
              index,
            }))
            .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.index - b.index),
        [members, sig, runtimeVersion],
      );

      // A just-onboarded member is not news: ready and idle both stay out of the
      // chips and out of the summary, so a fresh team leaves the dock at rest.
      const active = ranked.filter((entry) => entry.status !== 'idle' && entry.status !== 'ready');
      const chips = active.slice(0, CHIP_MAX);
      const faces = ranked.slice(0, FACE_MAX);
      const more = Math.max(0, members.length - FACE_MAX);
      const density = active.length === 0 ? 'rest' : 'active';
      // Only non-zero activity is worth a word: the roster size is already in `+N`,
      // and seven repetitions of "idle" were the noise this pass removes.
      const segments = useMemo(
        () =>
          SUMMARY_STATES.filter((state) => ranked.some((entry) => entry.status === state)).map((state) => ({
            key: state,
            text: `${t(`status.${state}`)} ${ranked.filter((entry) => entry.status === state).length}`,
          })),
        [ranked, t],
      );

      const expand = useCallback((id) => {
        setTipSeat(null);
        setExpandedId(id);
      }, []);
      const collapse = useCallback(() => setExpandedId(null), []);

      // Committed rows, for openFan: a click always runs after this effect, so
      // the ref is fresh without writing to it during render.
      useEffect(() => {
        rankedRef.current = ranked;
      });

      /** Timers survive a re-render but not an unmount. */
      const after = useCallback((ms, run) => {
        const id = setTimeout(() => {
          exitTimers.current.delete(id);
          run();
        }, ms);
        exitTimers.current.add(id);
      }, []);
      useEffect(
        () => () => {
          for (const id of exitTimers.current) clearTimeout(id);
          exitTimers.current.clear();
        },
        [],
      );

      /**
       * Anchor = the facepile's centre and the dock's top edge, both measured
       * now: the fan is fixed to the viewport, so the numbers only exist after
       * layout. Returns null while the pile is not mounted (child Session, empty
       * roster) — the caller then does nothing instead of opening at 0,0.
       */
      const measureAnchor = useCallback(() => {
        const root = dockRef.current;
        const pile = root?.querySelector('.wt-facepile');
        if (!(root instanceof Element) || !(pile instanceof Element)) return null;
        const pileRect = pile.getBoundingClientRect();
        const dockRect = root.getBoundingClientRect();
        return {
          anchorX: pileRect.left + pileRect.width / 2,
          bottom: window.innerHeight - dockRect.top + 6,
        };
      }, []);

      const openFan = useCallback(
        (seedId) => {
          const anchor = measureAnchor();
          if (anchor === null) return;
          // One transient surface at a time: the dispatch seat yields to the fan.
          setTipSeat(null);
          setExpandedId(null);
          setFan({
            order: rankedRef.current.map((entry) => entry.member.id),
            seedId,
            anchorX: anchor.anchorX,
            bottom: anchor.bottom,
            state: 'opening',
          });
        },
        [measureAnchor],
      );

      const closeFan = useCallback(() => {
        setFan((current) =>
          current === null || current.state === 'closing' ? current : { ...current, state: 'closing' },
        );
        // Only unmount what is still closing: a reopen inside the exit window
        // (130ms, or up to a second in a throttled tab) must not be cancelled by
        // the previous close's timer.
        after(FAN_EXIT_MS, () =>
          setFan((current) => (current === null || current.state !== 'closing' ? current : null)),
        );
      }, [after]);

      const openCard = useCallback((id) => {
        setCard({ id, state: 'opening' });
      }, []);

      const closeCard = useCallback(() => {
        setCard((current) =>
          current === null || current.state === 'closing' ? current : { ...current, state: 'closing' },
        );
        const sheet =
          typeof window !== 'undefined' && window.innerWidth <= SHEET_BREAKPOINT;
        after(sheet ? SHEET_EXIT_MS : CARD_EXIT_MS, () =>
          setCard((current) => (current === null || current.state !== 'closing' ? current : null)),
        );
      }, [after]);

      const focusFacepile = useCallback(() => {
        const root = dockRef.current;
        const first = root?.querySelector('.wt-facepile .wt-seat-hit');
        const visible = first instanceof HTMLElement && first.offsetParent !== null;
        (visible ? first : root?.querySelector('.wt-dock-sum'))?.focus?.();
      }, []);

      // The exit transition only runs if the node is painted closed first: the
      // same frame that mounts it cannot also flip it to `open`, or the browser
      // collapses both style recalcs and the surface pops in with no animation.
      useEffect(() => {
        if (fan === null || fan.state !== 'opening') return undefined;
        const flip = () =>
          setFan((current) =>
            current === null || current.state !== 'opening' ? current : { ...current, state: 'open' },
          );
        const frame = requestAnimationFrame(flip);
        // A background tab never paints, and a starved rAF would leave the layer
        // at opacity 0 with nothing focusable. Same flip, one frame later.
        const timer = setTimeout(flip, 34);
        return () => {
          cancelAnimationFrame(frame);
          clearTimeout(timer);
        };
      }, [fan]);

      useEffect(() => {
        if (card === null || card.state !== 'opening') return undefined;
        const flip = () =>
          setCard((current) =>
            current === null || current.state !== 'opening' ? current : { ...current, state: 'open' },
          );
        const frame = requestAnimationFrame(flip);
        const timer = setTimeout(flip, 34);
        return () => {
          cancelAnimationFrame(frame);
          clearTimeout(timer);
        };
      }, [card]);

      // Focus lands after `open`: focusing a node that is still mid-transition
      // makes the browser drop the :focus-visible ring on the next paint.
      useEffect(() => {
        if (fan === null || fan.state !== 'open') return;
        const seats = [...(fanRef.current?.querySelectorAll('.wt-fan-seat') ?? [])];
        const target =
          seats.find((node) => node.getAttribute('data-wt-seat') === fan.seedId) ?? seats[0];
        target?.focus?.();
      }, [fan?.state, fan?.seedId]);

      useEffect(() => {
        if (card === null || card.state !== 'open') return;
        cardRef.current?.focus?.();
      }, [card?.state]);

      // Closing the card hands focus back to the seat it came from; if that seat
      // is gone (the fan closed first) the facepile takes it.
      useEffect(() => {
        if (card !== null) {
          lastCardSeat.current = card.id;
          return;
        }
        const id = lastCardSeat.current;
        if (id === null) return;
        lastCardSeat.current = null;
        // The reader may already be typing somewhere else; leave the caret there.
        if (!focusWasOurs()) return;
        const seat = [...(fanRef.current?.querySelectorAll('.wt-fan-seat') ?? [])].find(
          (node) => node.getAttribute('data-wt-seat') === id,
        );
        if (seat instanceof HTMLElement) {
          seat.focus();
          return;
        }
        focusFacepile();
      }, [card, focusFacepile]);

      useEffect(() => {
        if (fan !== null) {
          fanWasOpen.current = true;
          return;
        }
        if (!fanWasOpen.current) return;
        fanWasOpen.current = false;
        // Esc leaves focus inside the closing layer, so the guard lets it pass;
        // a click into the composer does not, and keeps the caret.
        if (!focusWasOurs()) return;
        focusFacepile();
      }, [fan, focusFacepile]);

      const escape = useCallback(() => {
        if (card !== null) {
          closeCard();
          return true;
        }
        if (fan !== null) {
          closeFan();
          return true;
        }
        return false;
      }, [card, fan, closeCard, closeFan]);
      useEscLadder(fan !== null || card !== null, escape);

      // A resize while the fan is open would leave it pointing at where the
      // facepile used to be.
      useEffect(() => {
        if (fan === null) return undefined;
        const remeasure = () => {
          const anchor = measureAnchor();
          if (anchor === null) return;
          setFan((current) =>
            current === null ? current : { ...current, anchorX: anchor.anchorX, bottom: anchor.bottom },
          );
        };
        window.addEventListener('resize', remeasure);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(remeasure) : null;
        if (observer !== null && dockRef.current !== null) observer.observe(dockRef.current);
        return () => {
          window.removeEventListener('resize', remeasure);
          observer?.disconnect();
        };
      }, [fan === null, measureAnchor]);

      // One listener covers every transient surface: the dispatch seat, the touch
      // tip, the fan and the card. Clicking the owning seat keeps it; anything
      // else dismisses.
      useEffect(() => {
        if (expandedId === null && tipSeat === null && fan === null && card === null) return undefined;
        const onPointerDown = (event) => {
          if (!(event.target instanceof Element)) return;
          // A portal surface is not a descendant of the dock. Without this line
          // the capture handler closes the fan before the seat's own click runs,
          // and the card could never open — the seat is gone by the time React
          // dispatches to it.
          if (event.target.closest('[data-wt-fan], [data-wt-person], [data-wt-person-scrim]')) return;
          const seat = event.target.closest('[data-wt-seat]');
          const id = seat?.getAttribute('data-wt-seat') ?? null;
          if (expandedId !== null && id === expandedId) return;
          if (expandedId !== null) setExpandedId(null);
          if (tipSeat !== null && id !== tipSeat) setTipSeat(null);
          if (fan !== null || card !== null) {
            // Closing both at once: the card must not hand focus to a seat that
            // is already on its way out.
            lastCardSeat.current = null;
            if (card !== null) closeCard();
            if (fan !== null) closeFan();
          }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
      }, [expandedId, tipSeat, fan, card, closeCard, closeFan]);

      // Closing the dispatch seat unmounts it, so the seat cannot restore focus
      // itself: the parent remembers which one opened and hands focus back.
      useEffect(() => {
        if (expandedId !== null) {
          lastSeat.current = expandedId;
          return;
        }
        const id = lastSeat.current;
        if (id === null) return;
        lastSeat.current = null;
        const root = dockRef.current;
        const seat = [...(root?.querySelectorAll('[data-wt-seat]') ?? [])].find(
          (node) => node.getAttribute('data-wt-seat') === id,
        );
        const control = seat?.querySelector('.wt-seat-hit, .wt-chip');
        const visible = control instanceof HTMLElement && control.offsetParent !== null;
        (visible ? control : root?.querySelector('.wt-dock-sum'))?.focus?.();
      }, [expandedId]);

      if (isChild || members.length === 0) return null;
      // `openOffice` reports why the sidebar could not open a tab; the dock keeps
      // that line in place instead of falling back to an overlay of its own.
      const openPanel = () => setOfficeError(openOffice());
      const openMember = (id) => {
        const reason = props.openMember(sessionId, id);
        if (reason) console.warn(`[work-team] ${reason}`);
      };
      const pick = (id) => {
        if (touch && tipSeat !== id) {
          setTipSeat(id);
          return;
        }
        setTipSeat(null);
        openMember(id);
      };
      /** A face opens the layer; a one-person team has nothing to fan out. */
      const openFromFace = (id) => {
        if (members.length <= 1) {
          openCard(id);
          return;
        }
        openFan(id);
      };
      const taskFor = (name) => {
        const current = tasks.find((task) => task.status === 'in_progress' && task.ownerName === name);
        return current?.subject ?? '';
      };
      const entryById = new Map(ranked.map((entry) => [entry.member.id, entry]));
      const fanIds =
        fan === null
          ? []
          : fan.order.filter((id) => entryById.has(id)).slice(0, MAX_TEAM_SIZE - 1);
      const fanHidden = fan === null ? 0 : Math.max(0, fan.order.length - fanIds.length);
      const fanN = Math.min(Math.max(members.length, 1), MAX_TEAM_SIZE);
      const cardEntry = card === null ? undefined : entryById.get(card.id);
      const singleSeat = members.length <= 1;
      /**
       * A one-person team opens the card directly, so there is no `wt-fan` node
       * to expand into: claiming `aria-expanded`/`aria-controls` there would
       * announce a control that does not exist. The label says what the click
       * actually does instead.
       */
      const faceLabel = (entry, index) => {
        if (index !== 0) return undefined;
        if (singleSeat) return fillCopy(t('dock.openCard'), { name: entry.role.zh.name });
        return fillCopy(t('dock.fanAria'), { count: members.length });
      };
      const seatProps = (entry, index) => ({
        entry,
        task: taskFor(entry.member.name),
        sparkle: sparkles.has(entry.member.name),
        t,
        tipOpen: tipSeat === entry.member.id,
        tabIndex: index === 0 ? 0 : -1,
        expanded: singleSeat ? undefined : fan !== null,
        label: faceLabel(entry, index),
        onOpen: openFromFace,
        onExpand: () => expand(entry.member.id),
      });
      const chipProps = (entry, rank) => ({
        entry,
        rank,
        task: taskFor(entry.member.name),
        sparkle: sparkles.has(entry.member.name),
        t,
        tipOpen: tipSeat === entry.member.id,
        onOpen: pick,
        onExpand: () => expand(entry.member.id),
      });
      const openChatFromCard = (id) => {
        openMember(id);
        // Both layers retire together, so neither may restore focus into a seat
        // that is on its way out (that lands on <body>).
        lastCardSeat.current = null;
        // With no fan there is nothing to unmount, so nothing would hand focus
        // back once the card leaves: put it on the pile now. A one-seat team has
        // no fan by definition, which is exactly the case that used to fall to
        // <body>. If the host chat focuses its own composer, it simply wins.
        const hadFan = fan !== null;
        closeCard();
        closeFan();
        if (!hadFan) focusFacepile();
      };
      const dispatchFromCard = (id) => {
        // One transient surface at a time: the fan yields to the dispatch seat.
        lastCardSeat.current = null;
        closeCard();
        closeFan();
        expand(id);
      };
      const stopFromCard = (id) => {
        props.stopMember(id).then((reason) => {
          if (reason) console.warn(`[work-team] ${reason}`);
        });
      };
      return h(
        React.Fragment,
        null,
        h(
          'div',
          {
            className: 'wt-dock',
            ref: dockRef,
            role: 'group',
            'aria-label': t('dock.title'),
            'data-density': density,
            'data-mode': expandedId === null ? 'summary' : 'dispatch',
            'data-fan': fan === null ? undefined : 'true',
          },
          expandedId === null
            ? [
                h(
                  'div',
                  { className: 'wt-facepile', key: 'faces' },
                  ...faces.map((entry, index) =>
                    h(DockFace, { key: entry.member.id, ...seatProps(entry, index) }),
                  ),
                  more === 0
                    ? null
                    : h(
                        'button',
                        {
                          key: 'more',
                          type: 'button',
                          className: 'wt-more',
                          'aria-label': fillCopy(t('dock.moreAria'), { count: more }),
                          onClick: openPanel,
                        },
                        `+${more}`,
                      ),
                ),
                chips.length === 0
                  ? null
                  : h(
                      'div',
                      { className: 'wt-chips', key: 'chips' },
                      ...chips.map((entry, index) =>
                        h(DockChip, { key: entry.member.id, ...chipProps(entry, index + 1) }),
                      ),
                    ),
                h(
                  'button',
                  {
                    key: 'sum',
                    type: 'button',
                    className: 'wt-dock-sum',
                    onClick: openPanel,
                    'data-error': officeError === '' ? undefined : 'true',
                    title: officeError === '' ? t('dock.expand') : officeError,
                    // With visible text the text is the name: CSS hides trailing
                    // segments in narrow tracks, and an aria-label would then lie.
                    'aria-label':
                      officeError === '' && segments.length === 0 ? t('dock.expand') : undefined,
                  },
                  officeError === ''
                    ? segments.map((segment) =>
                        h('span', { className: 'wt-sum-seg', key: segment.key }, segment.text),
                      )
                    : h('span', { className: 'wt-sum-seg' }, officeError),
                  h('span', { className: 'wt-sum-chev', 'aria-hidden': 'true' }, '›'),
                ),
              ]
            : members
                .filter((member) => member.id === expandedId)
                .map((member) =>
                  h(DockSeat, {
                    key: member.id,
                    member,
                    t,
                    dispatch: props.dispatch,
                    onCollapse: collapse,
                  }),
                ),
          ),
        fan === null
          ? null
          : h(DockFan, {
              state: fan.state,
              ids: fanIds,
              entryOf: (id) => entryById.get(id),
              sparkleOf: (name) => sparkles.has(name),
              n: fanN,
              more: fanHidden,
              total: members.length,
              anchorX: fan.anchorX,
              bottom: fan.bottom,
              t,
              fanRef,
              onPick: openCard,
              onMore: openPanel,
            }),
        card === null || cardEntry === undefined
          ? null
          : h(PersonCard, {
              state: card.state,
              entry: cardEntry,
              task: taskFor(cardEntry.member.name),
              t,
              cardRef,
              useSessions,
              onClose: closeCard,
              onOpenChat: () => openChatFromCard(cardEntry.member.id),
              onDispatch: () => dispatchFromCard(cardEntry.member.id),
              onStop: () => stopFromCard(cardEntry.member.id),
            }),
      );
    }

    function OfficeAction(props) {
      const { sessionId, useSessions, useProjection, t } = props;
      const team = useProjection('agentTeam');
      const isChild = useSessions((state) => state.byId[sessionId]?.origin === 'subagent');
      const members = (team?.members ?? []).filter((member) => member.role !== 'lead');
      const [officeError, setOfficeError] = useState('');
      if (isChild || members.length === 0) return null;
      const openPanel = () => setOfficeError(props.openOffice());
      const facepile = members.slice(0, 4).map((member) => {
        const role = roleOrFallback(member);
        return h(RoleAvatar, { key: member.id, role, size: 19, status: 'idle' });
      });
      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            type: 'button',
            className: 'wt-dock-head',
            onClick: openPanel,
            'aria-label': t('dock.expand'),
            title: t('dock.title'),
          },
          h('span', { style: { display: 'inline-flex', marginRight: '2px' } }, ...facepile),
          h('span', { className: 'wt-dock-count' }, `${members.length} ${t('dock.count')}`),
        ),
        officeError === ''
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: 'wt-dock-error',
                title: officeError,
                onClick: openPanel,
              },
              officeError,
            ),
      );
    }

    // ---------------------------------------------------------------------
    // Plugin entry
    // ---------------------------------------------------------------------

    const inject = [
      'slots',
      'locale',
      'sessions',
      'uiWorkspace',
      'configForms',
      'remote',
      'remote.session',
      'remote.subagents',
      'sidebarRight',
      'sidebarRightTabs',
    ];

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'work-team:locale');
      ctx.effect(() => {
        memberRuntime.bind(ctx);
        return () => memberRuntime.unbind();
      }, 'work-team:member-runtime');
      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = '@local/dsh-work-team';
        tag.dataset.pluginCss = `${NS}/office.css`;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, 'work-team:styles');

      const form = ctx.configForms.get(ENTRY_ID);
      const loadModelCatalog = () => ctx.remote.session.modelCatalog();

      const openMember = (parentSessionId, childId) => {
        try {
          const info = ctx.sessions.retainInfo(parentSessionId)?.getSnapshot?.();
          if (info === undefined || (info.retainedBy.mainView ?? 0) === 0) {
            return t('error.navigate');
          }
          ctx.uiWorkspace.openSession({
            parentSessionId,
            childSessionId: childId,
            mode: 'continuable',
          });
          // Reading a member's chat is what clears its "new result": record the
          // settled total the reader just saw, so the row falls back to idle.
          memberRuntime.ackMember(parentSessionId, childId);
          return '';
        } catch (reason) {
          return String(reason?.message ?? reason);
        }
      };

      /**
       * Interrupt one teammate's running turn. `interruptByParent` reports refusal
       * as a value, so the caller gets a message instead of a thrown error.
       */
      const stopMember = async (parentSessionId, childId) => {
        try {
          const result = await ctx.remote.subagents.interruptByParent(
            childId,
            parentSessionId,
            'continuable',
          );
          if (result?.ok === false) {
            return String(result.error?.message ?? 'interrupt was refused');
          }
          return '';
        } catch (reason) {
          return String(reason?.message ?? reason);
        }
      };

      /**
       * Reveal the office tab. `openTab` throws synchronously when no Session
       * surface is mounted — nothing selected, a settings panel in the main
       * column, or a brand-new Session whose store the runtime has not minted —
       * and the message cannot tell those apart. So report one retryable line
       * instead of pretending the click worked.
       */
      const openOffice = (sessionId) => {
        const mounted = ctx.sidebarRight.mounted.getSnapshot();
        if (mounted !== undefined && mounted !== sessionId) return t('error.sidebarBusy');
        try {
          ctx.sidebarRight.openTab('office');
          return '';
        } catch {
          return t('error.sidebarNotReady');
        }
      };

      const injected = (sessionId) => ({
        t,
        openOffice: () => openOffice(sessionId),
        form,
        openMember,
        stopMember: (childId) => stopMember(sessionId, childId),
        dispatch: (childId, text) => dispatchTask(ctx, sessionId, childId, text),
      });

      // The registry holds registrations on ITS OWN context, which outlives this
      // plugin, so the disposer has to live inside our effect or the tab type
      // stays behind after unload.
      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: PLUGIN_ID,
            kind: 'office',
            priority: 'builtin',
            title: () => t('office.title'),
            guide: [
              {
                id: 'office',
                order: 30,
                title: () => t('office.title'),
                description: () => t('office.subtitle'),
              },
            ],
          }),
        'work-team:sidebar-type',
      );

      // Team settings are a section of the DSH settings dialog. The shell owns
      // the frame, the title, the close button and the scroll column, and hands
      // the section only `close`; everything else arrives through this inject
      // face. Order 12 sits between Models (10) and Plugins (15).
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'work-team',
            order: 12,
            label: () => t('office.settings'),
            locale: NS,
            inject: () => ({ t, form, loadModelCatalog }),
          },
          TeamSettingsSection,
        ),
      );

      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: PLUGIN_ID,
            locale: NS,
            inject: injected,
          },
          OfficeTab,
        ),
      );

      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.dock',
            id: 'work-team-office',
            order: 5,
            locale: NS,
            inject: injected,
          },
          Dock,
        ),
      );

      ctx.slots.inject('conversation.session.header.actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.session.header.actions',
            id: 'work-team-office',
            order: -19,
            locale: NS,
            inject: injected,
          },
          OfficeAction,
        ),
      );

      ctx.slots.inject('conversation.input.overlay', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.overlay',
            id: 'work-team-dispatch',
            order: 3,
            locale: NS,
            inject: injected,
          },
          DispatchOverlay,
        ),
      );
    }

    return { inject, apply };
  },
});
