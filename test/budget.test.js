/**
 * The v2.3 token budget: one ceiling over the Lead plus every employee, `warn`
 * by default and a hard stop in `block` mode, applied to the three paths that
 * spend tokens (dispatch, hire, accept).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { configSnapshot } from '../index.js';
import {
  BUDGET_MODES,
  budgetActions,
  budgetBlocks,
  budgetSnapshot,
  clampTokenBudget,
  normalizeBudgetMode,
} from '../lib/budget.js';
import { makeGateHost } from './support/gate-host.js';

/** @param {number} tokens - token count. @returns {{ uncachedInputTokens: number }} projection totals. */
const usage = (tokens) => ({ uncachedInputTokens: tokens });

/**
 * Start one fixture with the Lead scope installed.
 * @param {object} [options] - `makeGateHost` options.
 * @returns {Promise<object>} running fixture.
 */
async function startHost(options = {}) {
  const host = makeGateHost(options).start();
  await host.emit('agent/created', { agent: host.lead, source: 'created' });
  return host;
}

/** @param {object} host - fixture. @param {string} name - tool name. @returns {object} tool definition. */
function toolOf(host, name) {
  const definition = host.registered.get(name);
  assert.ok(definition, `${name} is registered on the Lead scope`);
  return definition;
}

/** @param {object} host - fixture. @param {object[]} assignments - dispatch rows. */
function dispatch(host, assignments) {
  return toolOf(host, 'dispatch_tasks').execute(
    { assignments },
    { agent: host.lead, signal: new AbortController().signal },
  );
}

test('the budget knobs default to no ceiling and warn, and junk never invents a limit', () => {
  const snapshot = configSnapshot({});
  assert.equal(snapshot.teamTokenBudget, 0, '0 is the documented "no ceiling" value');
  assert.equal(snapshot.tokenBudgetOnExceed, 'warn');
  assert.deepEqual(BUDGET_MODES, ['warn', 'block']);

  assert.equal(clampTokenBudget(0), 0);
  assert.equal(clampTokenBudget(12_000), 12_000);
  assert.equal(clampTokenBudget('1234'), 1234);
  assert.equal(clampTokenBudget(2.7), 2);
  assert.equal(clampTokenBudget(-5), 0, 'a negative ceiling is no ceiling, not a block-everything value');
  assert.equal(clampTokenBudget('bogus'), 0);
  assert.equal(clampTokenBudget('   '), 0);
  assert.equal(clampTokenBudget(Number.NaN), 0);
  assert.equal(clampTokenBudget(undefined), 0);

  assert.equal(normalizeBudgetMode('block'), 'block');
  assert.equal(normalizeBudgetMode('BLOCK'), 'warn', 'only the exact documented value hardens the gate');
  assert.equal(normalizeBudgetMode(undefined), 'warn');
  assert.equal(configSnapshot({ teamTokenBudget: '8000', tokenBudgetOnExceed: 'block' }).teamTokenBudget, 8000);
  assert.equal(configSnapshot({ tokenBudgetOnExceed: 'block' }).tokenBudgetOnExceed, 'block');
});

test('a snapshot reports exceeded only for a real ceiling that usage reached', () => {
  assert.deepEqual(budgetSnapshot(500, 0, 'block'), {
    used: 500,
    limit: 0,
    mode: 'block',
    exceeded: false,
    unknown: 0,
    note: '',
  });
  assert.equal(budgetSnapshot(500, 500, 'warn').exceeded, true, 'reaching the ceiling counts as spent');
  assert.equal(budgetSnapshot(499, 500, 'warn').exceeded, false);
  assert.equal(budgetBlocks(budgetSnapshot(500, 500, 'warn')), false);
  assert.equal(budgetBlocks(budgetSnapshot(500, 500, 'block')), true);
  assert.equal(budgetActions(budgetSnapshot(500, 500, 'block'), 'backend').length, 3);
  assert.match(budgetActions(budgetSnapshot(500, 500, 'block'), 'backend')[1], /backend/);
});

test('team_status sums the Lead and every employee, and nothing outside the team', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'frontend' }],
    tokens: {
      'sess-lead': usage(1_000),
      'sess-backend': usage(2_000),
      'sess-frontend': usage(500),
      // A session that is not on this roster (a user fork, another conversation)
      // must not be counted: the budget is the team's spend.
      'sess-stranger': usage(999_999),
    },
    config: { teamTokenBudget: 10_000 },
  });
  try {
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    assert.deepEqual(status.budget, {
      used: 3_500,
      limit: 10_000,
      mode: 'warn',
      exceeded: false,
      unknown: 0,
      note: '',
    });
  } finally {
    host.dispose();
  }
});

test('block refuses a dispatch when the ceiling is reached, with three concrete actions', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    tokens: { 'sess-lead': usage(400), 'sess-backend': usage(600) },
    config: { teamTokenBudget: 1_000, tokenBudgetOnExceed: 'block' },
  });
  try {
    const receipt = await dispatch(host, [{ role: 'backend', task: '把分页修好' }]);
    assert.equal(receipt.accepted, false);
    assert.equal(receipt.sent, 0);
    assert.equal(host.sends.length, 0, 'nothing was sent');
    assert.equal(receipt.results.length, 1);
    assert.equal(receipt.results[0].accepted, false);
    assert.match(receipt.results[0].error, /预算已用尽/);
    assert.deepEqual(receipt.budget, {
      used: 1_000,
      limit: 1_000,
      mode: 'block',
      exceeded: true,
      unknown: 0,
      note: '',
    });
    assert.equal(receipt.actions.length, 3);
    assert.match(receipt.actions[0], /提高上限/);
    assert.match(receipt.actions[1], /换便宜模型/);
    // Each action has to be something the Lead can actually call: no stop/restart
    // tool exists, so the third one reroutes the work instead.
    assert.match(receipt.actions[2], /改派给别人/);
    assert.match(receipt.actions[2], /team_status/);
  } finally {
    host.dispose();
  }
});

test('warn only attaches the budget to the receipt and lets the work out', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    tokens: { 'sess-lead': usage(400), 'sess-backend': usage(600) },
    config: { teamTokenBudget: 100, tokenBudgetOnExceed: 'warn' },
  });
  try {
    const receipt = await dispatch(host, [{ role: 'backend', task: '把分页修好' }]);
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.sent, 1);
    assert.equal(host.sends.length, 1, 'the order still went out');
    assert.deepEqual(receipt.budget, {
      used: 1_000,
      limit: 100,
      mode: 'warn',
      exceeded: true,
      unknown: 0,
      note: '',
    });
    assert.deepEqual(receipt.actions, []);
  } finally {
    host.dispose();
  }
});

test('block refuses a hire before a seat is taken', async () => {
  const host = await startHost({
    roster: [],
    tokens: { 'sess-lead': usage(5_000) },
    config: { teamTokenBudget: 1_000, tokenBudgetOnExceed: 'block' },
  });
  try {
    const result = await toolOf(host, 'hire_teammate').execute(
      { role: 'backend' },
      { agent: host.lead, signal: new AbortController().signal },
    );
    assert.equal(result.accepted, false);
    assert.equal(result.status, 'refused');
    assert.equal(result.delivered, 'refused');
    assert.equal(result.created, false);
    assert.equal(host.spawns.length, 0, 'no teammate was hired');
    // The whole budget block, not just the number: the output schema requires
    // unknown/note too, and this fixture fails a tool whose value misses any
    // required field (the kernel throws ToolOutputError there).
    assert.deepEqual(result.budget, {
      used: 5_000,
      limit: 1_000,
      mode: 'block',
      exceeded: true,
      // Nobody else is on the roster here, so every reading is real.
      unknown: 0,
      note: '',
    });
    assert.equal(result.actions.length, 3);
  } finally {
    host.dispose();
  }
});

test('block never refuses an acceptance: bookkeeping must not deadlock the team', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [{ id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend' }],
    tokens: { 'sess-lead': usage(9_000) },
    config: { teamTokenBudget: 1_000, tokenBudgetOnExceed: 'block' },
  });
  try {
    const result = await toolOf(host, 'accept_task').execute(
      { taskId: 'task-1', evidence: 'node --test test/ 全绿' },
      { agent: host.lead, signal: new AbortController().signal },
    );
    // Blocking this would strand finished work: `used` only grows, so the task
    // could never be written off and would stay in_progress forever.
    assert.equal(result.accepted, true);
    assert.equal(host.rows.get('task-1').status, 'completed');
    assert.deepEqual(result.budget, {
      used: 9_000,
      limit: 1_000,
      mode: 'block',
      exceeded: true,
      unknown: 0,
      note: '',
    });
    assert.deepEqual(result.actions, []);
  } finally {
    host.dispose();
  }
});

test('a member whose usage cannot be read is counted, not added as zero', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'frontend' }],
    tokens: { 'sess-lead': usage(1_000), 'sess-backend': usage(500) },
    unreadableSessions: ['sess-frontend'],
    config: { teamTokenBudget: 10_000 },
  });
  try {
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    assert.equal(status.budget.used, 1_500, 'only the readable spend is summed');
    assert.equal(status.budget.unknown, 1, 'the unreadable member is counted');
    assert.match(status.budget.note, /1 个成员的用量投影读不到/, 'the note names the real cause');
    assert.match(status.budget.note, /实际已用可能更高/);

    const receipt = await dispatch(host, [{ role: 'backend', task: '继续' }]);
    assert.equal(receipt.budget.unknown, 1, 'the receipt carries the same warning');
    assert.match(receipt.budget.note, /用量投影读不到/);
  } finally {
    host.dispose();
  }
});

test('the missing-usage note names the cause: not loaded vs unreadable projection', async () => {
  const notLoaded = await startHost({
    roster: [{ name: 'backend' }, { name: 'frontend' }],
    tokens: { 'sess-lead': usage(1_000), 'sess-backend': usage(200) },
    noSessionFor: ['frontend'],
    config: { teamTokenBudget: 10_000 },
  });
  try {
    const status = await toolOf(notLoaded, 'team_status').execute({}, { agent: notLoaded.lead });
    assert.equal(status.budget.unknown, 1);
    assert.match(status.budget.note, /1 个成员的会话没有加载，未计入用量/);
    assert.doesNotMatch(status.budget.note, /投影读不到/);
  } finally {
    notLoaded.dispose();
  }

  const broken = await startHost({
    roster: [{ name: 'backend' }, { name: 'frontend' }],
    tokens: { 'sess-lead': usage(1_000), 'sess-backend': usage(200) },
    unreadableSessions: ['sess-frontend'],
    config: { teamTokenBudget: 10_000 },
  });
  try {
    const status = await toolOf(broken, 'team_status').execute({}, { agent: broken.lead });
    assert.equal(status.budget.unknown, 1);
    assert.match(status.budget.note, /1 个成员的用量投影读不到，未计入用量/);
    assert.doesNotMatch(status.budget.note, /还没加载/);
  } finally {
    broken.dispose();
  }

  // Both causes at once: one number, both reasons, still a lower bound.
  const mixed = await startHost({
    roster: [{ name: 'backend' }, { name: 'frontend' }, { name: 'ops' }],
    tokens: { 'sess-lead': usage(1_000), 'sess-backend': usage(200) },
    noSessionFor: ['frontend'],
    unreadableSessions: ['sess-ops'],
    config: { teamTokenBudget: 10_000 },
  });
  try {
    const status = await toolOf(mixed, 'team_status').execute({}, { agent: mixed.lead });
    assert.equal(status.budget.unknown, 2);
    assert.match(status.budget.note, /2 个成员未计入用量（1 个会话没有加载、1 个用量投影读不到）/);
    assert.equal(status.budget.used, 1_200, 'used stays the readable sum, never a guess');
  } finally {
    mixed.dispose();
  }
});

test('usage is read from the session, so an unloaded teammate still counts', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'frontend' }],
    tokens: {
      'sess-lead': usage(1_000),
      'sess-backend': usage(700),
      'sess-frontend': usage(300),
    },
    // `frontend` finished its turn: no live Agent, session still in the store.
    missingAgents: ['frontend'],
    config: { teamTokenBudget: 10_000 },
  });
  try {
    assert.equal(host.ctx.agents.get('sess-frontend'), undefined, 'no Agent to read from');
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    assert.equal(status.budget.used, 2_000, 'the idle teammate still contributes its real usage');
    assert.equal(status.budget.unknown, 0, 'nothing is unreadable here');
    assert.equal(status.budget.note, '', 'a fully readable team needs no warning');
  } finally {
    host.dispose();
  }
});

test('the per-member token column and budget.used are one reading, not two', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'frontend' }, { name: 'ops' }],
    tokens: {
      'sess-lead': usage(1_000),
      'sess-backend': usage(700),
      'sess-frontend': usage(300),
      'sess-ops': usage(50),
    },
    // backend and frontend finished their turns; ops has no readable session.
    missingAgents: ['backend', 'frontend'],
    noSessionFor: ['ops'],
    config: { teamTokenBudget: 10_000 },
  });
  try {
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    const byName = Object.fromEntries(status.members.map((member) => [member.name, member.tokens]));
    // The real-run bug: an idle employee showed 0 tokens while the budget above it
    // counted that same spend.
    assert.equal(byName.backend, 700, 'an unloaded employee still reports its usage');
    assert.equal(byName.frontend, 300);
    assert.equal(byName.ops, 0, 'unreadable reads as 0 ...');
    assert.equal(status.budget.unknown, 1, '... and is counted here, so the two agree');
    assert.equal(
      status.budget.used,
      1_000 + 700 + 300,
      'the sum is exactly the members above it, plus the Lead',
    );
    const leadTokens = 1_000;
    assert.equal(
      status.members.reduce((sum, member) => sum + member.tokens, 0) + leadTokens,
      status.budget.used,
      'the rows plus the Lead are exactly the budget total: no third reading in between',
    );
  } finally {
    host.dispose();
  }
});

test('a composition without ctx.sessions says usage falls back to live Agents', async () => {
  const host = await startHost({ roster: [{ name: 'backend' }], noSessionService: true });
  try {
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    assert.match(status.health.note, /no ctx\.sessions\.get/);
    // The fallback still works through the live Agent, so a running employee is
    // measured; the note is what keeps the limitation visible.
    assert.equal(status.budget.unknown, 0);
  } finally {
    host.dispose();
  }
});

test('a budget-refused dispatch still reports the review it was asked for', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'reviewer' }],
    tokens: { 'sess-lead': usage(2_000) },
    config: { teamTokenBudget: 1_000, tokenBudgetOnExceed: 'block' },
  });
  try {
    const receipt = await dispatch(host, [
      { role: 'backend', task: '修分页', review: true, acceptance: 'npm test 全绿' },
    ]);
    assert.equal(receipt.accepted, false);
    const row = receipt.results[0];
    assert.equal(row.review.requested, true, 'the gate was asked for and is reported');
    assert.equal(row.review.created, false);
    assert.match(row.review.note, /预算拦下/);
    assert.equal(host.taskLog.length, 0, 'no review task is filed for work that never went out');
  } finally {
    host.dispose();
  }
});

test('a hire inside the ceiling still reports the budget it measured', async () => {
  const host = await startHost({
    roster: [],
    tokens: { 'sess-lead': usage(120) },
    config: { teamTokenBudget: 10_000, tokenBudgetOnExceed: 'block' },
  });
  try {
    const result = await toolOf(host, 'hire_teammate').execute(
      { role: 'backend' },
      { agent: host.lead, signal: new AbortController().signal },
    );
    assert.equal(result.accepted, true);
    assert.equal(result.delivered, 'hired');
    assert.equal(host.spawns.length, 1);
    assert.deepEqual(result.budget, {
      used: 120,
      limit: 10_000,
      mode: 'block',
      exceeded: false,
      unknown: 0,
      note: '',
    });
  } finally {
    host.dispose();
  }
});
