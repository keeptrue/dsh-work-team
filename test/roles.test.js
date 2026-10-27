import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LINEUP,
  MAX_TEAM_SIZE,
  ROLES,
  roleById,
  roleForName,
} from '../lib/roles.js';
import {
  buildBossGuide,
  buildEmployeePersona,
  onboardingText,
  reportingInstruction,
} from '../lib/personas.js';
import {
  clampTeamSize,
  formatDuration,
  formatModelSpec,
  formatTokens,
  parseModelSpec,
  sameSelection,
  sumTokenTotals,
} from '../lib/models.js';
import {
  buildDispatchFallback,
  buildDispatchReceipt,
  buildDispatchSendFailure,
  parseDispatch,
  resolveDispatchRole,
} from '../lib/dispatch.js';
import {
  AUTO_START_MODES,
  AUTO_START_STATES,
  LEAD_HANDS_OFF_DENY,
  autoStartIsActive,
  handsOffReason,
  normalizeAutoStart,
  planAutoStartLineup,
  shouldAutoStart,
} from '../lib/autostart.js';

test('role library is complete and unique', () => {
  assert.equal(ROLES.length, 8);
  assert.equal(new Set(ROLES.map((role) => role.id)).size, 8);
  assert.equal(new Set(ROLES.map((role) => role.modelField)).size, 8);
  for (const role of ROLES) {
    assert.match(role.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(role.zh.name.length > 0);
    assert.ok(role.zh.role.length > 0);
    assert.ok(role.zh.duty.length > 0);
    assert.ok(role.zh.description.length > 0);
    assert.equal(typeof role.modelField, 'string');
    assert.ok(Array.isArray(role.deny));
  }
});

test('default line-up holds seven known roles and leaves writer as the empty seat', () => {
  assert.equal(DEFAULT_LINEUP.length, 7);
  assert.equal(new Set(DEFAULT_LINEUP).size, 7);
  assert.ok(!DEFAULT_LINEUP.includes('writer'));
  for (const id of DEFAULT_LINEUP) assert.ok(roleById(id), id);
  assert.ok(MAX_TEAM_SIZE >= DEFAULT_LINEUP.length + 1);
});

test('roleForName resolves ids, aliases, and unknown names', () => {
  assert.equal(roleForName('frontend')?.id, 'frontend');
  assert.equal(roleForName('Frontend')?.id, 'frontend');
  assert.equal(roleForName('front-end')?.id, 'frontend');
  assert.equal(roleForName('qa')?.id, 'reviewer');
  assert.equal(roleForName('product')?.id, 'pm');
  assert.equal(roleForName('unknown'), undefined);
  assert.equal(roleForName('   '), undefined);
  assert.equal(roleForName(undefined), undefined);
});

test('model specs parse and round-trip', () => {
  assert.deepEqual(parseModelSpec('workbuddy-cn::deepseek-v4.1-flash'), {
    provider: 'workbuddy-cn',
    model: 'deepseek-v4.1-flash',
  });
  assert.deepEqual(parseModelSpec('openrouter::x/y::high'), {
    provider: 'openrouter',
    model: 'x/y',
    reasoningEffort: 'high',
  });
  assert.equal(parseModelSpec(''), undefined);
  assert.equal(parseModelSpec('   '), undefined);
  assert.equal(parseModelSpec('only-provider'), undefined);
  assert.equal(parseModelSpec('p::'), undefined);
  assert.equal(parseModelSpec('a::b::c::d'), undefined);
  assert.equal(
    formatModelSpec({ provider: 'p', model: 'm', reasoningEffort: 'high' }),
    'p::m::high',
  );
  assert.equal(formatModelSpec(undefined), '');
});

test('sameSelection compares route and effort', () => {
  assert.equal(sameSelection({ provider: 'p', model: 'm' }, { provider: 'p', model: 'm' }), true);
  assert.equal(
    sameSelection({ provider: 'p', model: 'm', reasoningEffort: 'high' }, { provider: 'p', model: 'm' }),
    false,
  );
  assert.equal(sameSelection({ provider: 'p', model: 'm' }, undefined), false);
});

test('team size clamps to a positive integer', () => {
  assert.equal(clampTeamSize(7, 5, 8), 7);
  assert.equal(clampTeamSize(0, 5, 8), 5);
  assert.equal(clampTeamSize(99, 5, 8), 8);
  assert.equal(clampTeamSize('6', 5, 8), 6);
  assert.equal(clampTeamSize(2.5, 5, 8), 5);
});

test('formatting helpers are compact', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(1234), '1.2k');
  assert.equal(formatTokens(12_345), '12k');
  assert.equal(formatTokens(1_200_000), '1.2m');
  assert.equal(formatDuration(15_000), '15s');
  assert.equal(formatDuration(65_000), '1m5s');
  assert.equal(formatDuration(3_600_000), '1h');
  assert.equal(sumTokenTotals({ uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3 }), 6);
});

test('personas carry identity, craft, and reporting cadence', () => {
  const role = roleById('frontend');
  const persona = buildEmployeePersona(role, 'milestones');
  assert.match(persona, /小前/);
  assert.match(persona, /frontend/);
  assert.match(persona, /开工时/);
  assert.match(persona, /team_task_create/);
  assert.doesNotMatch(persona, /undefined/);
  assert.match(reportingInstruction('completion'), /只在任务完成时/);
  assert.match(reportingInstruction('bogus'), /开工时/);
  assert.match(onboardingText(role), /小前已就位/);
});

test('the employee persona draws the line between itself and its temporary workers', () => {
  const role = roleById('backend');
  const worker = buildEmployeePersona(role, 'milestones', { maxWorkers: 3, selfHire: true });
  assert.match(worker, /临时工（subagent \/ subagent_fork）/);
  assert.match(worker, /最多同时 3 个/);
  // The three-part brief, the ownership rule, and the shared-file rule.
  assert.match(worker, /目标（做完什么样算完）/);
  assert.match(worker, /结果回到你自己/);
  assert.match(worker, /不占编制/);
  assert.match(worker, /同一批文件只能有一个写手/);
  assert.match(worker, /只做只读/);
  // selfHire on: direct hire is allowed and a full team turns into a request.
  assert.match(worker, /hire_teammate/);
  assert.match(worker, /requestId/);
  // The long-term identity no longer reads as "a one-off worker".
  assert.match(worker, /不是临时工/);
  assert.doesNotMatch(worker, /不是一次性临时工/);
  assert.doesNotMatch(worker, /undefined/);

  // selfHire off: hiring goes through request_hire instead.
  const requested = buildEmployeePersona(role, 'milestones', { maxWorkers: 2, selfHire: false });
  assert.match(requested, /request_hire/);
  assert.doesNotMatch(requested, /hire_teammate/);
  assert.match(requested, /最多同时 2 个/);
  assert.doesNotMatch(requested, /undefined/);

  // A zero cap is stated as "workers off", not as an unusable limit.
  const off = buildEmployeePersona(role, 'milestones', { maxWorkers: 0 });
  assert.match(off, /临时工上限」是 0/);
  assert.doesNotMatch(off, /最多同时/);
  assert.doesNotMatch(off, /undefined/);
});

test('boss guide names the tools and the no-doing-work rule', () => {
  const guide = buildBossGuide();
  assert.match(guide, /team_start/);
  assert.match(guide, /hire_teammate/);
  // Semantics, not wording: the Lead delegates instead of doing the work itself.
  assert.match(guide, /不替员工干活/);
  assert.match(guide, /team_task_create/);
  // Employees arrange their own help; the Lead must not double-book either channel.
  assert.match(guide, /不重复安排/);
  assert.match(guide, /不要再替他们招一遍/);
  assert.match(guide, /不能替代员工/);
});

test('parseDispatch accepts @name body and keeps the whole multi-line body', () => {
  assert.deepEqual(parseDispatch('@小前 做登录页'), { name: '小前', body: '做登录页' });
  assert.deepEqual(parseDispatch('   @backend fix the API'), {
    name: 'backend',
    body: 'fix the API',
  });
  assert.deepEqual(parseDispatch('@老后\n先看数据模型\n再改接口'), {
    name: '老后',
    body: '先看数据模型\n再改接口',
  });
  assert.deepEqual(parseDispatch('@backend, 修接口'), { name: 'backend', body: '修接口' });
});

test('parseDispatch declines anything ambiguous so the message is not swallowed', () => {
  assert.equal(parseDispatch('＠小前 全角 at 不算派单'), undefined);
  assert.equal(parseDispatch('@'), undefined);
  assert.equal(parseDispatch('@ 小前 空格后没有名字'), undefined);
  assert.equal(parseDispatch('@小前'), undefined);
  assert.equal(parseDispatch('@小前    '), undefined);
  // The separator is whitespace: a colon-glued name is not a directive, so it stays prose.
  assert.equal(parseDispatch('@reviewer：跑测试'), undefined);
  assert.equal(parseDispatch('普通消息，没有 at'), undefined);
  assert.equal(parseDispatch(''), undefined);
  assert.equal(parseDispatch(undefined), undefined);
  assert.equal(parseDispatch(null), undefined);
  assert.equal(parseDispatch(42), undefined);
});

test('resolveDispatchRole matches ids, aliases, and both display names', () => {
  assert.equal(resolveDispatchRole('backend')?.id, 'backend');
  assert.equal(resolveDispatchRole('BE')?.id, 'backend');
  assert.equal(resolveDispatchRole('qa')?.id, 'reviewer');
  assert.equal(resolveDispatchRole('阿策')?.id, 'pm');
  assert.equal(resolveDispatchRole('小审')?.id, 'reviewer');
  assert.equal(resolveDispatchRole('Ace')?.id, 'pm');
  assert.equal(resolveDispatchRole('rae')?.id, 'reviewer');
  assert.equal(resolveDispatchRole('backend,')?.id, 'backend');
  assert.equal(resolveDispatchRole('查无此人'), undefined);
  assert.equal(resolveDispatchRole(''), undefined);
  assert.equal(resolveDispatchRole(undefined), undefined);
  for (const role of ROLES) {
    assert.equal(resolveDispatchRole(role.zh.name)?.id, role.id);
    assert.equal(resolveDispatchRole(role.en.name)?.id, role.id);
  }
});

test('receipts tell the Lead to confirm instead of doing the work', () => {
  const role = roleById('backend');
  const receipt = buildDispatchReceipt(role, '把 /users 改成分页');
  assert.match(receipt, /已转发给 老后/);
  assert.match(receipt, /backend/);
  assert.match(receipt, /把 \/users 改成分页/);
  assert.match(receipt, /只(需要)?回一句确认/);
  assert.match(receipt, /不要自己执行/);
  assert.doesNotMatch(receipt, /undefined/);
});

test('fallback text keeps the original body and names the way out', () => {
  const role = roleById('frontend');
  const missing = buildDispatchFallback(role, '改一下空状态', 'missing');
  assert.match(missing, /还没有入职/);
  assert.match(missing, /hire_teammate/);
  assert.match(missing, /team_start/);
  assert.match(missing, /改一下空状态/);
  const failed = buildDispatchFallback(role, '改一下空状态', 'failed');
  assert.match(failed, /不可复用/);
  assert.match(failed, /改一下空状态/);
  assert.doesNotMatch(failed, /undefined/);
});

test('leadHandsOff denies the file-mutating tools on every call', () => {
  assert.deepEqual(LEAD_HANDS_OFF_DENY, ['write', 'edit']);
  for (const tool of LEAD_HANDS_OFF_DENY) {
    assert.match(String(handsOffReason(true, tool)), /hands-off mode/);
  }
  for (const tool of ['read', 'grep', 'bash', 'team_status', 'send_message']) {
    assert.equal(handsOffReason(true, tool), undefined, tool);
  }
  assert.equal(handsOffReason(false, 'write'), undefined);
  assert.equal(handsOffReason('true', 'write'), undefined);
  assert.equal(handsOffReason(undefined, 'write'), undefined);
  assert.equal(handsOffReason(true, undefined), undefined);
  assert.equal(handsOffReason(true, 42), undefined);
});

test('autoStart modes normalize to the three supported values', () => {
  assert.deepEqual(AUTO_START_MODES, ['off', 'first-message', 'immediate']);
  assert.deepEqual(AUTO_START_STATES, ['queued', 'running', 'done', 'failed']);
  assert.equal(normalizeAutoStart('immediate'), 'immediate');
  assert.equal(normalizeAutoStart(' First-Message '), 'first-message');
  assert.equal(normalizeAutoStart('off'), 'off');
  assert.equal(normalizeAutoStart('bogus'), 'off');
  assert.equal(normalizeAutoStart(undefined), 'off');
  assert.equal(normalizeAutoStart(true), 'off');
});

test('shouldAutoStart only fires once, for a Lead, on startup or resume', () => {
  const base = { mode: 'immediate', source: 'startup', role: 'lead', record: undefined };
  assert.equal(shouldAutoStart(base), true);
  assert.equal(shouldAutoStart({ ...base, source: 'resume' }), true);
  assert.equal(shouldAutoStart({ ...base, source: 'clear' }), false);
  assert.equal(shouldAutoStart({ ...base, source: 'compact' }), false);
  assert.equal(shouldAutoStart({ ...base, mode: 'off' }), false);
  assert.equal(shouldAutoStart({ ...base, role: 'teammate' }), false);
  assert.equal(shouldAutoStart({ ...base, record: 'queued' }), false);
  assert.equal(shouldAutoStart({ ...base, record: 'done' }), false);
  assert.equal(shouldAutoStart({}), false);
  assert.equal(autoStartIsActive('queued'), true);
  assert.equal(autoStartIsActive('running'), true);
  assert.equal(autoStartIsActive('done'), false);
  assert.equal(autoStartIsActive('failed'), false);
  assert.equal(autoStartIsActive(undefined), false);
});

test('planAutoStartLineup fills missing seats in line-up order up to capacity', () => {
  assert.deepEqual(planAutoStartLineup(DEFAULT_LINEUP, 7, new Set()), DEFAULT_LINEUP);
  assert.deepEqual(planAutoStartLineup(DEFAULT_LINEUP, 7, new Set(['pm'])), [
    'frontend',
    'backend',
    'reviewer',
    'researcher',
    'designer',
    'ops',
  ]);
  assert.deepEqual(planAutoStartLineup(DEFAULT_LINEUP, 3, new Set()), ['pm', 'frontend', 'backend']);
  assert.deepEqual(planAutoStartLineup(DEFAULT_LINEUP, 2, ['pm', 'frontend']), []);
  assert.deepEqual(planAutoStartLineup(DEFAULT_LINEUP, 0, new Set()), []);
  assert.deepEqual(planAutoStartLineup([], 7, new Set()), []);
  assert.deepEqual(planAutoStartLineup(undefined, 7, undefined), []);
  // A non-line-up member (writer) still consumes a seat.
  assert.deepEqual(planAutoStartLineup(DEFAULT_LINEUP, 2, new Set(['writer'])), ['pm']);
});

test('config snapshot carries every Config field and the bundle patch agrees', async () => {
  const { readFileSync } = await import('node:fs');
  const { Config, configSnapshot } = await import('../index.js');
  const configKeys = Object.keys(Config.dict ?? Config).sort();
  const snapshot = configSnapshot({});
  assert.deepEqual(Object.keys(snapshot).sort(), configKeys);

  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  const patchKeys = [];
  let inConfig = false;
  for (const line of patch.split('\n')) {
    if (/^\s*config:\s*$/.test(line)) {
      inConfig = true;
      continue;
    }
    if (!inConfig) continue;
    const match = /^\s{8}([A-Za-z_][\w]*):/.exec(line);
    if (match !== null) {
      patchKeys.push(match[1]);
      continue;
    }
    if (/^\s{0,7}\S/.test(line) && line.trim() !== '') break;
  }
  assert.deepEqual(patchKeys.sort(), configKeys);

  // Defaults follow the schema: self-hire is on, two workers per employee.
  assert.equal(configSnapshot({}).allowSelfHire, true);
  assert.equal(configSnapshot({}).maxWorkersPerEmployee, 2);
  assert.equal(configSnapshot({ allowSelfHire: false }).allowSelfHire, false);
  // Only an explicit false opts out, the same reading `dispatchPrefix` uses.
  assert.equal(configSnapshot({ allowSelfHire: true }).allowSelfHire, true);

  // The worker cap is a whole number in 0–4; blank or junk falls back to the default.
  assert.equal(configSnapshot({ maxWorkersPerEmployee: 0 }).maxWorkersPerEmployee, 0);
  assert.equal(configSnapshot({ maxWorkersPerEmployee: 99 }).maxWorkersPerEmployee, 4);
  assert.equal(configSnapshot({ maxWorkersPerEmployee: 2.7 }).maxWorkersPerEmployee, 2);
  assert.equal(configSnapshot({ maxWorkersPerEmployee: '3' }).maxWorkersPerEmployee, 3);
  assert.equal(configSnapshot({ maxWorkersPerEmployee: -1 }).maxWorkersPerEmployee, 0);
  assert.equal(configSnapshot({ maxWorkersPerEmployee: Number.NaN }).maxWorkersPerEmployee, 2);
  assert.equal(configSnapshot({ maxWorkersPerEmployee: null }).maxWorkersPerEmployee, 2);
  assert.equal(configSnapshot({ maxWorkersPerEmployee: '' }).maxWorkersPerEmployee, 2);
  assert.equal(configSnapshot({ maxWorkersPerEmployee: 'bogus' }).maxWorkersPerEmployee, 2);

  // The step budget is a whole number in 0-60. 0 is a real value (it turns the
  // guidance off), so only a blank/whitespace or junk value falls back — a
  // whitespace string must NOT read as 0 the way `Number('   ')` would.
  assert.equal(configSnapshot({}).employeeStepBudget, 24);
  assert.equal(configSnapshot({ employeeStepBudget: 0 }).employeeStepBudget, 0);
  assert.equal(configSnapshot({ employeeStepBudget: '0' }).employeeStepBudget, 0);
  assert.equal(configSnapshot({ employeeStepBudget: 0.6 }).employeeStepBudget, 0);
  assert.equal(configSnapshot({ employeeStepBudget: '   ' }).employeeStepBudget, 24);
  assert.equal(configSnapshot({ employeeStepBudget: '' }).employeeStepBudget, 24);
  assert.equal(configSnapshot({ employeeStepBudget: 'bogus' }).employeeStepBudget, 24);
  assert.equal(configSnapshot({ employeeStepBudget: 99 }).employeeStepBudget, 60);
  assert.equal(configSnapshot({ employeeStepBudget: -3 }).employeeStepBudget, 0);
  assert.equal(configSnapshot({ employeeStepBudget: '40' }).employeeStepBudget, 40);

  const normalized = configSnapshot({
    teamSize: 99,
    reporting: 'completion',
    allowSelfHire: true,
    maxWorkersPerEmployee: 3,
    autoStart: ' IMMEDIATE ',
    dispatchPrefix: false,
    leadHandsOff: true,
    modelPm: 'p::m',
    modelWriter: 42,
  });
  assert.equal(normalized.teamSize, 8);
  assert.equal(normalized.reporting, 'completion');
  assert.equal(normalized.allowSelfHire, true);
  assert.equal(normalized.maxWorkersPerEmployee, 3);
  assert.equal(normalized.autoStart, 'immediate');
  assert.equal(normalized.dispatchPrefix, false);
  assert.equal(normalized.leadHandsOff, true);
  assert.equal(normalized.modelPm, 'p::m');
  assert.equal(normalized.modelWriter, '');
});

test('a send failure names the error and tells the Lead to take over', () => {
  const role = roleById('frontend');
  const text = buildDispatchSendFailure(role, '改一下空状态', 'inbox rejected');
  assert.match(text, /转发给 小前（frontend）失败：inbox rejected/);
  assert.match(text, /没有送达/);
  assert.match(text, /请你自己处理/);
  assert.match(text, /改一下空状态/);
  assert.doesNotMatch(text, /undefined/);

  const blank = buildDispatchSendFailure(role, '改一下空状态', '');
  assert.match(blank, /未知原因/);
  assert.match(blank, /改一下空状态/);
  assert.doesNotMatch(blank, /undefined/);
});

test('the starting fallback points at the running formation, not at team_start', () => {
  const role = roleById('frontend');
  const starting = buildDispatchFallback(role, '改一下空状态', 'starting');
  assert.match(starting, /正在入职/);
  assert.match(starting, /重发/);
  assert.doesNotMatch(starting, /还没有入职/);
  assert.match(starting, /改一下空状态/);

  const missing = buildDispatchFallback(role, '改一下空状态', 'missing');
  assert.match(missing, /还没有入职/);
  assert.match(missing, /team_start/);
});
