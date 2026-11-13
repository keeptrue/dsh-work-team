/**
 * The bench (停职): a role keeps its seat, takes no new work, and keeps every
 * task it already owns.
 *
 * The whole feature is one Config string (`benchRoles`), so these tests are about
 * the four entry points that must refuse and the two that must not.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBenchRoles } from '../lib/bench.js';
import { until } from './support/until.js';
import { makeGateHost } from './support/gate-host.js';

/** @param {object} [options] - `makeGateHost` options. @returns {Promise<object>} running fixture. */
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

/** @param {object} host - fixture. @param {object} args - dispatch args. */
function dispatch(host, args) {
  return toolOf(host, 'dispatch_tasks').execute(args, {
    agent: host.lead,
    signal: new AbortController().signal,
  });
}

test('benchRoles resolves aliases and reports what it could not resolve', () => {
  // `roleForName` resolves ids and aliases (not display names): `qa` → reviewer.
  assert.deepEqual(parseBenchRoles('fe, qa backend'), {
    roles: ['frontend', 'reviewer', 'backend'],
    unknown: [],
  });
  // A display name is not an alias, so it is reported rather than guessed at.
  assert.deepEqual(parseBenchRoles('小审'), { roles: [], unknown: ['小审'] });
  // Separators, duplicates, and order: input order, deduped, blanks ignored.
  assert.deepEqual(parseBenchRoles(' backend,backend ，ops;pm\n'), {
    roles: ['backend', 'ops', 'pm'],
    unknown: [],
  });
  // A typo is returned, never swallowed.
  assert.deepEqual(parseBenchRoles('backend, nope'), {
    roles: ['backend'],
    unknown: ['nope'],
  });
  assert.deepEqual(parseBenchRoles(undefined), { roles: [], unknown: [] });
  assert.deepEqual(parseBenchRoles('   '), { roles: [], unknown: [] });
});

test('team_start does not hire a benched seat, and says which seat it skipped', async () => {
  const host = await startHost({ config: { teamSize: 3, benchRoles: 'frontend' } });
  try {
    const result = await toolOf(host, 'team_start').execute(
      {},
      { agent: host.lead, signal: new AbortController().signal },
    );
    assert.deepEqual(
      result.hired.map((row) => row.name),
      ['pm', 'backend', 'reviewer'],
      'the benched seat is skipped and the next working role takes the seat',
    );
    assert.equal(host.spawns.length, 3);
    assert.match(result.note, /Skipped benched roles: frontend/);
  } finally {
    host.dispose();
  }
});

test('automatic formation honours the bench too', async () => {
  const host = makeGateHost({
    config: { autoStart: 'immediate', teamSize: 2, benchRoles: 'frontend' },
  }).start();
  try {
    await host.emit('agent/created', { agent: host.lead, source: 'startup' });
    // Two seats, one of them benched: the next working role takes the place.
    await until(() => host.spawns.length === 2, { describe: () => host.spawns.length });
    assert.deepEqual(
      host.spawns.map((spawn) => spawn.name),
      ['pm', 'backend'],
      'the background run does not fill a benched seat',
    );
  } finally {
    host.dispose();
  }
});

test('hire_teammate refuses a benched role with the un-bench instruction', async () => {
  const host = await startHost({ config: { benchRoles: 'backend' } });
  try {
    await assert.rejects(
      toolOf(host, 'hire_teammate').execute(
        { role: 'backend' },
        { agent: host.lead, signal: new AbortController().signal },
      ),
      /停职.*benchRoles/s,
    );
    assert.equal(host.spawns.length, 0, 'no seat was created for a benched role');
  } finally {
    host.dispose();
  }
});

test('dispatch refuses only the benched row and still sends the others', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'pm' }],
    config: { benchRoles: 'backend' },
  });
  try {
    const receipt = await dispatch(host, {
      assignments: [
        { role: 'backend', task: '改接口', review: true },
        { role: 'pm', task: '拆需求' },
      ],
    });
    const [benched, sent] = receipt.results;
    assert.equal(benched.accepted, false);
    assert.match(benched.error, /停职/);
    assert.equal(benched.review.requested, true, 'the row still reports the gate it asked for');
    assert.match(benched.review.note, /停职/);
    assert.equal(sent.accepted, true);
    assert.equal(receipt.sent, 1);
    assert.equal(receipt.failed, 1);
    assert.equal(host.sends.length, 1, 'only the working row reached its employee');
  } finally {
    host.dispose();
  }
});

test('@role routing refuses a benched role and keeps the original text', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    config: { benchRoles: 'backend', dispatchPrefix: true },
  });
  try {
    const messages = [
      { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '@backend 修接口' }] },
    ];
    const decision = await host.emit('agent/pre-step', {
      agent: host.lead,
      messages,
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    });
    assert.equal(host.sends.length, 0, 'nothing was forwarded');
    const text = decision === undefined ? messages[0].content[0].text : decision.messages[0].content[0].text;
    assert.match(text, /停职/);
    assert.match(text, /修接口/, 'the user text survives');
  } finally {
    host.dispose();
  }
});

test('send_message to a benched role is denied on both sides of the team', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'pm' }],
    config: { benchRoles: 'backend' },
  });
  try {
    // The kernel's own channel: a Lead that skips the plugin's tools must still
    // be stopped, or the bench only covers the paths we happened to remember.
    const denied = host.guardReason('send_message', { target: 'backend', content: 'x' });
    assert.match(String(denied), /停职/);
    assert.match(String(denied), /benchRoles/);
    assert.match(String(denied), /没有送达/);
    // A working role, and the Lead itself, are untouched.
    assert.equal(host.guardReason('send_message', { target: 'pm', content: 'x' }), undefined);
    assert.equal(host.guardReason('send_message', { target: 'lead', content: 'x' }), undefined);
    // Other tools are not affected by this guard.
    assert.equal(host.guardReason('read', { path: 'x' }), undefined);

    // False-positive guards on the same channel: these targets carry a role name
    // inside them, and a substring or prefix match would block a temporary
    // worker's message or a cross-Session delivery that has nothing to do with
    // the bench.
    for (const target of ['sess-backend', 'sess-pm-worker-1', 'backend-worker-1', 'task-1']) {
      assert.equal(
        host.guardReason('send_message', { target, content: 'x' }),
        undefined,
        `target ${target} is not a role and must pass`,
      );
    }

    // Documented side effect: `resolveDispatchRole` also accepts display names, so
    // 小审 names the same seat as `reviewer` and IS refused when that seat is
    // benched. Legal (same role), but pinned so nobody "fixes" it into a different
    // rule later.
    const reviewerBench = await startHost({
      roster: [{ name: 'reviewer' }],
      config: { benchRoles: 'reviewer' },
    });
    try {
      assert.match(
        String(reviewerBench.guardReason('send_message', { target: '小审', content: 'x' })),
        /停职/,
      );
      assert.equal(
        reviewerBench.guardReason('send_message', { target: 'sess-reviewer', content: 'x' }),
        undefined,
        'the session id of the same employee is not a role name',
      );
    } finally {
      reviewerBench.dispose();
    }

    // An employee messaging the benched colleague is refused the same way.
    const employeeDenied = host.employeeGuardReason('sess-pm', 'send_message', {
      target: 'backend',
      content: 'x',
    });
    assert.match(String(employeeDenied), /停职/);
    assert.equal(
      host.employeeGuardReason('sess-pm', 'send_message', { target: 'reviewer', content: 'x' }),
      undefined,
    );
  } finally {
    host.dispose();
  }
});

test('request_hire refuses a benched role instead of leaving an unactionable task', async () => {
  const host = await startHost({
    roster: [{ name: 'pm' }, { name: 'backend' }],
    config: { benchRoles: 'backend', allowSelfHire: true },
  });
  try {
    const scope = host.scopes.get('sess-pm');
    const requestHire = scope.registered.get('request_hire');
    assert.ok(requestHire, 'request_hire is registered on the employee scope');
    await assert.rejects(
      requestHire.execute(
        { role: 'backend', reason: '缺后端' },
        { agent: { id: 'sess-pm', session: { id: 'sess-pm' } }, signal: new AbortController().signal },
      ),
      /停职/,
    );
    assert.equal(host.taskLog.length, 0, 'no hiring request was filed for a paused seat');
    // The same call for a working role still files normally.
    await requestHire.execute(
      { role: 'writer', reason: '缺文案' },
      { agent: { id: 'sess-pm', session: { id: 'sess-pm' } }, signal: new AbortController().signal },
    );
    assert.equal(host.taskLog.length, 1);
  } finally {
    host.dispose();
  }
});

test('a benched employee can still have its work accepted', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [{ id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend' }],
    config: { benchRoles: 'backend' },
  });
  try {
    const result = await toolOf(host, 'accept_task').execute(
      { taskId: 'task-1', evidence: 'node --test test/ 全绿' },
      { agent: host.lead, signal: new AbortController().signal },
    );
    assert.equal(result.accepted, true, 'the bench stops new work, not the acceptance gate');
    assert.equal(host.rows.get('task-1').status, 'completed');
  } finally {
    host.dispose();
  }
});

test('a benched employee still occupies its seat', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    config: { teamSize: 1, benchRoles: 'backend' },
  });
  try {
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    assert.equal(status.size, 1, 'benched is not removed: the seat is taken');
    assert.equal(status.members[0].benched, true);
    // At capacity with a paused seat, a hire is refused for capacity, not bench.
    await assert.rejects(
      toolOf(host, 'hire_teammate').execute(
        { role: 'pm' },
        { agent: host.lead, signal: new AbortController().signal },
      ),
      /capacity/i,
    );
  } finally {
    host.dispose();
  }
});

test('team_status reports the bench list, the per-member flag, and an unparsable name', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'pm' }],
    config: { benchRoles: 'backend, ghost' },
  });
  try {
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    assert.deepEqual(status.benchedRoles, ['backend']);
    assert.deepEqual(
      status.members.map((member) => [member.name, member.benched]),
      [['backend', true], ['pm', false]],
    );
    assert.match(status.health.note, /无法识别的角色：?"ghost"/);
    // A benched role that holds no seat is still listed.
    const unborn = await startHost({ config: { benchRoles: 'ops' } });
    try {
      const report = await toolOf(unborn, 'team_status').execute({}, { agent: unborn.lead });
      assert.deepEqual(report.benchedRoles, ['ops']);
      assert.deepEqual(report.members, []);
    } finally {
      unborn.dispose();
    }
  } finally {
    host.dispose();
  }
});
