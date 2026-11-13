/**
 * `team_recover`: reading the OLD root's board, read-only.
 *
 * A new conversation's board is empty because the board is rebuilt from its own
 * root log. The projection read itself is not tree-scoped, so while the old root
 * is still loaded its tasks can be listed — and never moved. These tests cover
 * both real situations (still loaded / already unloaded), the two topologies'
 * different member sources, truncation, and the promise that recover writes
 * nothing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

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

/** @param {object} host - fixture. @param {object} args - tool args. */
function recover(host, args) {
  return toolOf(host, 'team_recover').execute(args, {
    agent: host.lead,
    signal: new AbortController().signal,
  });
}

/** A board as the old root's projection would carry it. */
const OLD_TASKS = [
  { id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend', blockedBy: [], ready: false },
  { id: 'task-2', subject: '改设置页', status: 'pending', ownerName: 'frontend', blockedBy: ['task-1'], ready: false },
  { id: 'task-3', subject: '已完成', status: 'completed', ownerName: 'backend', blockedBy: [], ready: false },
];

test('a still-loaded old Session yields its tasks, switch state and 0.2.1 roster', async () => {
  const host = await startHost({
    oldRoots: {
      'sess-old': {
        agentTeam: {
          enabled: true,
          tasks: OLD_TASKS,
          members: [
            { id: 'sess-backend', name: 'backend', phase: 'active' },
            { id: 'sess-frontend', name: 'frontend', phase: 'active' },
          ],
        },
      },
    },
  });
  try {
    const result = await recover(host, { sessionId: 'sess-old' });
    assert.equal(result.found, true);
    assert.equal(result.enabled, 'on');
    assert.equal(result.total, 3);
    assert.equal(result.truncated, false);
    assert.deepEqual(
      result.tasks.map((task) => [task.id, task.status, task.owner, task.ready]),
      [
        ['task-1', 'in_progress', 'backend', false],
        ['task-2', 'pending', 'frontend', false],
        ['task-3', 'completed', 'backend', false],
      ],
    );
    assert.deepEqual(result.tasks[1].blockedBy, ['task-1']);
    assert.equal(result.membersSource, 'agentTeam');
    assert.deepEqual(
      result.members.map((member) => [member.name, member.phase, member.mode]),
      [
        ['backend', 'active', ''],
        ['frontend', 'active', ''],
      ],
    );
    assert.equal(result.note, '');
  } finally {
    host.dispose();
  }
});

test('on the 0.2.2 topology the roster comes from the subagent catalog', async () => {
  const host = await startHost({
    oldRoots: {
      'sess-old': {
        // 0.2.2 keeps no `members` on the team projection.
        agentTeam: { enabled: false, tasks: OLD_TASKS },
        catalog: [
          { id: 'sess-backend', name: 'backend', mode: 'continuable' },
          { id: 'sess-worker', name: '', mode: 'one-shot' },
        ],
      },
    },
  });
  try {
    const result = await recover(host, { sessionId: 'sess-old' });
    assert.equal(result.found, true);
    assert.equal(result.enabled, 'off');
    assert.equal(result.total, 3);
    assert.equal(result.membersSource, 'subagentCatalog');
    assert.deepEqual(
      result.members.map((member) => [member.name, member.mode, member.phase]),
      [
        ['backend', 'continuable', ''],
        ['', 'one-shot', ''],
      ],
    );
    assert.equal(result.note, '');
  } finally {
    host.dispose();
  }
});

test('recover works when the session store is only reachable through ctx.get', async () => {
  // The service is not injected, so a direct `ctx.sessions` read finds nothing in
  // a real composition. This fixture exposes it ONLY via `ctx.get('sessions')`:
  // reading the property here would answer found:false for a live Session.
  const host = await startHost({
    sessionServiceMode: 'get-only',
    oldRoots: { 'sess-old': { agentTeam: { enabled: true, tasks: OLD_TASKS, members: [] } } },
  });
  try {
    assert.equal(host.ctx.sessions, undefined, 'the fixture really has no property to fall back on');
    const result = await recover(host, { sessionId: 'sess-old' });
    assert.equal(result.found, true, 'the old Session is live and must be found');
    assert.equal(result.total, 3);
    assert.equal(result.enabled, 'on');
  } finally {
    host.dispose();
  }
});

test('passing your own Session id is answered, but labelled as your own board', async () => {
  const host = await startHost({
    // The lead's own id, present in the store the same way the old root is.
    oldRoots: { 'sess-lead': { agentTeam: { enabled: true, tasks: OLD_TASKS, members: [] } } },
  });
  try {
    const result = await recover(host, { sessionId: 'sess-lead' });
    assert.equal(result.found, true, 'the content is still returned');
    assert.equal(result.total, 3);
    assert.match(result.note, /这就是你当前会话自己的板，不是旧板/);
  } finally {
    host.dispose();
  }
});

test('a misshapen projection is reported as unreadable, not as an empty board', async () => {
  const host = await startHost({
    oldRoots: {
      'sess-bad': { agentTeam: { enabled: true, tasks: 'not-an-array' } },
    },
  });
  try {
    const result = await recover(host, { sessionId: 'sess-bad' });
    assert.equal(result.found, true, 'the Session is loaded; only its projection is wrong');
    assert.equal(result.enabled, 'unknown', 'no switch state is claimed from a broken view');
    assert.deepEqual(result.tasks, []);
    assert.equal(result.total, 0);
    assert.match(result.note, /投影形状不对（tasks 不是数组）/);
  } finally {
    host.dispose();
  }
});

test('an unloaded old Session answers found:false instead of throwing', async () => {
  const host = await startHost({ unloadedSessions: ['sess-gone'] });
  try {
    const result = await recover(host, { sessionId: 'sess-gone' });
    assert.equal(result.found, false);
    assert.equal(result.enabled, 'unknown');
    assert.deepEqual(result.tasks, []);
    assert.deepEqual(result.members, []);
    assert.equal(result.membersSource, 'none');
    assert.equal(result.total, 0);
    assert.match(result.note, /没有加载/);
    assert.match(result.note, /team_task_create/);
  } finally {
    host.dispose();
  }
});

test('a long old board is truncated with its real total', async () => {
  const host = await startHost({
    oldRoots: { 'sess-old': { agentTeam: { enabled: true, tasks: OLD_TASKS, members: [] } } },
  });
  try {
    const result = await recover(host, { sessionId: 'sess-old', limit: 1 });
    assert.equal(result.tasks.length, 1);
    assert.equal(result.truncated, true);
    assert.equal(result.total, 3, 'the full count survives the page cut');
    assert.match(result.note, /只返回前 1 条/);
    // An absurd limit is clamped, not honoured blindly.
    const clamped = await recover(host, { sessionId: 'sess-old', limit: 99_999 });
    assert.equal(clamped.tasks.length, 3);
    assert.equal(clamped.truncated, false);
  } finally {
    host.dispose();
  }
});

test('recover writes nothing: no task mutation, no board switch', async () => {
  const host = await startHost({
    oldRoots: {
      'sess-old': {
        agentTeam: { enabled: true, tasks: OLD_TASKS, members: [] },
        catalog: [{ id: 'sess-backend', name: 'backend', mode: 'continuable' }],
      },
    },
  });
  try {
    const before = {
      created: host.taskLog.length,
      updates: host.taskUpdates.length,
      writes: host.boardWrites.length,
    };
    await recover(host, { sessionId: 'sess-old' });
    await recover(host, { sessionId: 'sess-gone' });
    assert.deepEqual(
      {
        created: host.taskLog.length,
        updates: host.taskUpdates.length,
        writes: host.boardWrites.length,
      },
      before,
      'a read-only tool must not create, mutate, or switch anything',
    );
    assert.equal(host.rows.size, 0, 'not one task row was touched');
  } finally {
    host.dispose();
  }
});

test('an employee cannot call the recovery tool', async () => {
  const host = await startHost({ roster: [{ name: 'backend' }] });
  try {
    assert.equal(
      host.scopes.get('sess-backend').registered.has('team_recover'),
      false,
      'it is a Lead-only tool, so the employee scope does not register it',
    );
    const employee = { id: 'sess-backend', session: { id: 'sess-backend' } };
    await assert.rejects(
      toolOf(host, 'team_recover').execute(
        { sessionId: 'sess-old' },
        { agent: employee, signal: new AbortController().signal },
      ),
      /Work Team Lead/,
    );
  } finally {
    host.dispose();
  }
});
