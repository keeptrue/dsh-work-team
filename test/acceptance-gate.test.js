/**
 * The v2.3 acceptance gate: the review task a `review: true` dispatch row
 * appends, the `accept_task` tool that closes work only with evidence, the
 * pending-acceptance queue in `team_status`, and the health block's topology
 * answer on both team backends.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { defineTool } from '@deepseek-ai/dsh-tools';

import { teamTopologyOf } from '../index.js';
import { ensureTeamBoard } from '../lib/team-bridge.js';
import { buildBossGuide } from '../lib/personas.js';
import { makeGateHost } from './support/gate-host.js';

/**
 * Build one fixture with the Lead scope installed, the way the Host does it.
 * @param {object} [options] - `makeGateHost` options.
 * @returns {Promise<object>} the running fixture.
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

/** @param {object} host - fixture. @param {string} taskId - board task id. @param {string} evidence - acceptance evidence. */
function accept(host, taskId, evidence) {
  return toolOf(host, 'accept_task').execute(
    { taskId, evidence },
    { agent: host.lead, signal: new AbortController().signal },
  );
}

test('a review row appends a dependent, assigned review task after the order goes out', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'reviewer' }],
    seedTasks: [{ id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend' }],
  });
  try {
    const task = '把 /users 接口的分页修好，验收是 npm test 全绿';
    const receipt = await dispatch(host, [
      { role: 'backend', task, acceptance: 'npm test 全绿', review: true, taskId: 'task-1' },
    ]);
    const row = receipt.results[0];
    assert.equal(row.accepted, true, 'the order itself still counts as sent');
    assert.equal(row.review.requested, true);
    assert.equal(row.review.created, true);
    assert.equal(row.review.degraded, false);
    assert.equal(row.review.subject, `审查：${task}`);
    assert.equal(row.review.ownerAssigned, true, 'the review task is handed to the reviewer');
    assert.deepEqual(row.review.blockedBy, ['task-1'], 'the review waits for the implementation task');

    const review = host.rows.get(row.review.taskId);
    assert.equal(review.ownerName, 'reviewer', 'ownerName comes from the reassign, not from a guess');
    assert.equal(review.status, 'in_progress');
    assert.deepEqual(review.blockedBy, ['task-1']);
    assert.match(review.description, /验收标准：npm test 全绿/);
    assert.match(review.description, /关联实现任务：task-1/);

    // Two board writes in the order the kernel supports: create (unowned,
    // pending) → reassign (writes ownerName) → set_dependencies (blockers only
    // apply after creation, and reassign refuses a blocked task).
    assert.deepEqual(
      host.taskUpdates.map((entry) => entry.request.action),
      ['reassign', 'set_dependencies'],
    );
    assert.deepEqual(
      host.taskUpdates.map((entry) => entry.request.expectedRevision),
      [1, 2],
      'each step reads the revision the previous step committed',
    );
    assert.equal(
      host.taskUpdates[0].request.owner,
      'reviewer',
      '0.2.1 resolves the owner as a member name',
    );
    assert.equal(host.sends.length, 1, 'only the task went to the implementer');
    // The scope marker is what identifies review paperwork, so it must be there
    // and it must live in the reserved namespace.
    assert.equal(review.writeScopes.length, 1);
    assert.match(review.writeScopes[0], /^work-team\/review\//);
    assert.equal(
      host.taskLog[0].request.writeScopes[0],
      review.writeScopes[0],
      'the marker is written at create time, not patched in later',
    );
  } finally {
    host.dispose();
  }
});

test('a review row with no task id records the association in words instead of a blocker', async () => {
  const host = await startHost({ roster: [{ name: 'backend' }, { name: 'reviewer' }] });
  try {
    const receipt = await dispatch(host, [
      { role: 'backend', task: '看一眼登录页的对齐', review: true },
    ]);
    const row = receipt.results[0];
    assert.equal(row.review.created, true);
    assert.deepEqual(row.review.blockedBy, []);
    const review = host.rows.get(row.review.taskId);
    assert.match(review.description, /没有独立任务 id/);
    assert.equal(review.ownerName, 'reviewer');
  } finally {
    host.dispose();
  }
});

test('the gate runs the same way on the 0.2.2 subagent tree', async () => {
  const host = await startHost({
    topology: 'tree',
    roster: [{ name: 'backend' }, { name: 'reviewer' }],
  });
  try {
    const receipt = await dispatch(host, [
      { role: 'backend', task: '把分页修好', acceptance: 'npm test 全绿', review: true },
    ]);
    const row = receipt.results[0];
    assert.equal(row.accepted, true, 'the tree addresses the employee by session id');
    assert.equal(row.review.created, true, 'the review task lands on the same board');
    assert.equal(row.review.ownerAssigned, true);
    assert.equal(host.rows.get(row.review.taskId).ownerName, 'reviewer');
    assert.equal(
      host.taskUpdates[0].request.owner,
      'sess-reviewer',
      '0.2.2 resolves the owner as a Session id',
    );

    // The same board closes an implementation task with evidence.
    host.store({ id: 'task-9', subject: '实现', status: 'in_progress', ownerName: 'backend' });
    const accepted = await accept(host, 'task-9', 'node --test test/ 全绿');
    assert.equal(accepted.accepted, true);
    assert.equal(host.rows.get('task-9').status, 'completed');
  } finally {
    host.dispose();
  }
});

test('a task id the board does not know is reported instead of faking the dependency', async () => {
  const host = await startHost({ roster: [{ name: 'backend' }, { name: 'reviewer' }] });
  try {
    const receipt = await dispatch(host, [
      { role: 'backend', task: '修分页', review: true, taskId: 'task-ghost' },
    ]);
    const row = receipt.results[0];
    assert.equal(row.review.created, true, 'the review task still exists');
    assert.deepEqual(row.review.blockedBy, [], 'no dependency was recorded');
    assert.match(row.review.note, /没能把审查任务挂到 task-ghost 上/);
    // The board text must not claim a dependency the task graph does not carry.
    const review = host.rows.get(row.review.taskId);
    assert.match(review.description, /依赖没有挂上/);
    assert.deepEqual(review.blockedBy, []);
  } finally {
    host.dispose();
  }
});

test('a row that never reached its implementer reports the gate as not requested', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'reviewer' }],
    sendError: new Error('inbox is full'),
  });
  try {
    const receipt = await dispatch(host, [
      { role: 'backend', task: '修分页', review: true },
    ]);
    const row = receipt.results[0];
    assert.equal(row.accepted, false);
    assert.match(row.error, /inbox is full/);
    assert.equal(row.review.requested, true, 'the row asked for a gate');
    assert.equal(row.review.created, false);
    assert.match(row.review.note, /没有建审查任务/);
    assert.equal(host.taskLog.length, 0, 'nothing is reviewed that was never sent');
  } finally {
    host.dispose();
  }
});

test('a closed board degrades the review request to one message and keeps every row accepted', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'reviewer' }],
    board: 'off',
  });
  try {
    const receipt = await dispatch(host, [
      { role: 'backend', task: '修 /users 分页', review: true },
      { role: 'reviewer', task: '顺手看看命名' },
    ]);
    assert.equal(receipt.sent, 2, 'a closed board never fails a dispatch row');
    assert.equal(receipt.failed, 0);
    assert.equal(host.taskLog.length, 0, 'nothing was written to a closed board');

    const reviewed = receipt.results[0];
    assert.equal(reviewed.accepted, true);
    assert.equal(reviewed.review.degraded, true);
    assert.equal(reviewed.review.created, false);
    assert.match(reviewed.review.note, /任务板不可用/);

    // The gate the Lead asked for still arrives: one message to the reviewer.
    const reviewMessage = host.sends.find(
      (send) => (send.request?.target ?? send.targetId) === 'reviewer' && /审查：/.test(
        (send.request?.content ?? send.content)[0].text,
      ),
    );
    assert.ok(reviewMessage, 'the review request reached the reviewer as a message');
    assert.equal(reviewed.review.messageId.length > 0, true);
  } finally {
    host.dispose();
  }
});

test('a board whose switch cannot be read is not silently opened, and the review degrades', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'reviewer' }],
    board: 'unavailable',
  });
  try {
    const receipt = await dispatch(host, [
      { role: 'backend', task: '修 /users 分页', review: true },
    ]);
    assert.equal(receipt.results[0].review.degraded, true);
    assert.equal(
      host.boardWrites.length,
      0,
      'an unreadable switch must not be rewritten: the user choice may be behind that failure',
    );
  } finally {
    host.dispose();
  }
});

test('ensureTeamBoard reports an unreadable switch instead of opening the board', async () => {
  const lead = { id: 'sess-lead', session: { id: 'sess-lead' } };
  const writes = [];
  const ctx = {
    agentTeams: {
      isEnabled: () => false,
      async setEnabled(caller, enabled) {
        writes.push({ caller, enabled });
      },
    },
    sessionProjections: {
      stateOf() {
        throw new Error('projection not materialized');
      },
    },
  };
  const result = await ensureTeamBoard(ctx, lead);
  assert.equal(result.state, 'unavailable');
  assert.match(result.reason, /cannot read the Team switch/);
  assert.equal(writes.length, 0, 'the switch is never flipped on a failed read');
});

test('an explicit off selection still short-circuits without a write', async () => {
  const lead = { id: 'sess-lead', session: { id: 'sess-lead' } };
  const writes = [];
  const ctx = {
    agentTeams: {
      isEnabled: () => false,
      async setEnabled(caller, enabled) {
        writes.push({ caller, enabled });
      },
    },
    sessionProjections: { stateOf: () => ({ enabled: false }) },
  };
  const result = await ensureTeamBoard(ctx, lead);
  assert.equal(result.state, 'off');
  assert.match(result.reason, /switched off/);
  assert.equal(writes.length, 0);
});

test('accept_task refuses an empty or whitespace-only evidence without touching the task', async () => {
  // A missing argument is refused by the tool's own parameter schema before
  // `execute` runs; the three blank forms reach the body and are refused there.
  for (const evidence of ['', '   ', '\n\t']) {
    const host = await startHost({
      roster: [{ name: 'backend' }],
      seedTasks: [
        { id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend', description: '原文' },
      ],
    });
    try {
      const result = await accept(host, 'task-1', evidence);
      assert.equal(result.accepted, false, `evidence ${JSON.stringify(evidence)} is refused`);
      assert.match(result.reason, /证据为空/);
      assert.equal(host.taskUpdates.length, 0, 'no compare-and-set is attempted');
      const row = host.rows.get('task-1');
      assert.equal(row.revision, 1, 'revision unchanged');
      assert.equal(row.status, 'in_progress', 'status unchanged');
      assert.equal(row.description, '原文', 'description unchanged');
    } finally {
      host.dispose();
    }
  }

  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [{ id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend' }],
  });
  try {
    await assert.rejects(
      toolOf(host, 'accept_task').execute(
        { taskId: 'task-1' },
        { agent: host.lead, signal: new AbortController().signal },
      ),
      /evidence/,
      'a missing evidence argument never reaches the board',
    );
    assert.equal(host.taskUpdates.length, 0);
    assert.equal(host.rows.get('task-1').revision, 1);
  } finally {
    host.dispose();
  }
});

test('accept_task records the evidence and completes an in-progress task', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [
      { id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend', description: '实现分页' },
    ],
  });
  try {
    const result = await accept(host, 'task-1', '  node --test test/ → 52 pass  ');
    assert.equal(result.accepted, true);
    assert.equal(result.status, 'completed');
    assert.equal(result.evidence, 'node --test test/ → 52 pass');
    const row = host.rows.get('task-1');
    assert.equal(row.status, 'completed');
    assert.match(row.description, /实现分页/);
    assert.match(row.description, /验收证据：/);
    assert.match(row.description, /node --test test\/ → 52 pass/);
    // The Team service's `complete` action ignores text fields entirely
    // (`task-board.ts`, `case 'complete'`), so carrying evidence AND closing the
    // task cannot be one write: evidence goes in through `edit`, then `complete`.
    assert.deepEqual(
      host.taskUpdates.map((entry) => entry.request.action),
      ['edit', 'complete'],
    );
    assert.deepEqual(
      host.taskUpdates.map((entry) => entry.request.expectedRevision),
      [1, 2],
    );
    assert.equal(row.revision, 3);
  } finally {
    host.dispose();
  }
});

test('accept_task says the evidence landed when only the closing write failed', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [
      { id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend', description: '实现分页' },
    ],
    failUpdateAction: 'complete',
  });
  try {
    const result = await accept(host, 'task-1', 'npm test 全绿');
    assert.equal(result.accepted, false);
    assert.equal(result.status, 'in_progress');
    assert.match(result.reason, /证据已写进任务/);
    assert.equal(result.revision, 2, 'the edit committed, and the receipt says so');
    assert.match(host.rows.get('task-1').description, /npm test 全绿/);
    assert.equal(host.rows.get('task-1').status, 'in_progress');

    // The retry must not write the evidence a second time: it only closes the
    // task, because the description already carries this exact block.
    host.clearUpdateFailure();
    const writes = host.taskUpdates.length;
    const retry = await accept(host, 'task-1', 'npm test 全绿');
    assert.equal(retry.accepted, true);
    assert.equal(host.taskUpdates.length, writes + 1, 'one write: complete');
    assert.equal(
      host.rows.get('task-1').description.split('验收证据：').length - 1,
      1,
      'the evidence block was not duplicated',
    );
    assert.equal(host.rows.get('task-1').status, 'completed');
  } finally {
    host.dispose();
  }
});

test('accept_task refuses a task whose blocker is still open, and changes nothing', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'reviewer' }],
    seedTasks: [
      { id: 'task-1', subject: '实现分页', status: 'in_progress', ownerName: 'backend' },
      { id: 'task-2', subject: '接住后续', status: 'in_progress', ownerName: 'backend', blockedBy: ['task-1', 'task-9'] },
    ],
  });
  try {
    const result = await accept(host, 'task-2', '看起来不错');
    assert.equal(result.accepted, false, 'the kernel would allow this; the gate must not');
    assert.match(result.reason, /未完成的前置任务/);
    assert.match(result.reason, /task-1/);
    assert.match(result.reason, /task-9/, 'an unreadable blocker counts as unfinished');
    assert.equal(host.taskUpdates.length, 0, 'no evidence is written before the gate passes');
    assert.equal(host.rows.get('task-2').revision, 1);
    assert.equal(host.rows.get('task-2').status, 'in_progress');
  } finally {
    host.dispose();
  }
});

test('a review task filed by a review row cannot be accepted while its implementation is open', async () => {
  const host = await startHost({ roster: [{ name: 'backend' }, { name: 'reviewer' }] });
  try {
    host.store({ id: 'task-1', subject: '实现分页', status: 'in_progress', ownerName: 'backend' });
    const receipt = await dispatch(host, [
      { role: 'backend', task: '把分页修好', review: true, taskId: 'task-1' },
    ]);
    const reviewTaskId = receipt.results[0].review.taskId;
    const blocked = await accept(host, reviewTaskId, '代码看起来没问题');
    assert.equal(blocked.accepted, false);
    assert.match(blocked.reason, /task-1/);
    assert.equal(host.rows.get(reviewTaskId).status, 'in_progress');

    // Once the implementation is accepted, the review can be accepted too.
    assert.equal((await accept(host, 'task-1', 'npm test 全绿')).accepted, true);
    const review = await accept(host, reviewTaskId, 'diff 看过了，通过');
    assert.equal(review.accepted, true);
    assert.equal(host.rows.get(reviewTaskId).status, 'completed');
  } finally {
    host.dispose();
  }
});

test('accept_task is idempotent: the same evidence is written once', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [
      { id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend', description: '实现分页' },
    ],
  });
  try {
    assert.equal((await accept(host, 'task-1', 'npm test 全绿')).accepted, true);
    const afterFirst = host.rows.get('task-1');
    const writes = host.taskUpdates.length;
    const occurrences = afterFirst.description.split('验收证据：').length - 1;
    assert.equal(occurrences, 1);

    const again = await accept(host, 'task-1', 'npm test 全绿');
    assert.equal(again.accepted, true);
    assert.match(again.reason, /同一段证据已经记录过/);
    assert.equal(host.taskUpdates.length, writes, 'the retry wrote nothing');
    assert.equal(host.rows.get('task-1').revision, afterFirst.revision);
    assert.equal(host.rows.get('task-1').description, afterFirst.description);
  } finally {
    host.dispose();
  }
});

test('accept_task retries once when a concurrent write steals the revision', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [
      { id: 'task-1', subject: '修分页', status: 'completed', ownerName: 'backend', description: '实现分页' },
    ],
    bumpBetweenWrites: true,
  });
  try {
    const result = await accept(host, 'task-1', 'CI 绿了');
    assert.equal(result.accepted, true, 'the retry lands instead of reporting a false failure');
    assert.equal(result.revision, 3, '1 seeded + 1 lost race + 1 retried write');
    assert.equal(host.taskUpdates.length, 2, 'exactly one stale attempt and one retry');
    assert.equal(host.taskUpdates[0].request.expectedRevision, 1);
    assert.equal(host.taskUpdates[1].request.expectedRevision, 2, 'the retry re-read the fresh revision');
    assert.match(host.rows.get('task-1').description, /CI 绿了/);
  } finally {
    host.dispose();
  }
});

test('a task view without blockedBy is accepted instead of crashing', async () => {
  // Fail-open on purpose: a view that cannot report dependencies must not turn
  // acceptance into an error. This pins the behaviour so a future "fail closed"
  // change is a visible decision rather than a silent one.
  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [
      { id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend', description: '实现分页' },
    ],
    stripBlockedBy: ['task-1'],
  });
  try {
    const result = await accept(host, 'task-1', 'npm test 全绿');
    assert.equal(result.accepted, true);
    assert.equal(result.status, 'completed');
    assert.equal(host.rows.get('task-1').revision, 3);
  } finally {
    host.dispose();
  }
});

test('accept_task reports the real status when the task is released mid-acceptance', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [
      { id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend', description: '实现分页' },
    ],
    releaseBeforeComplete: true,
  });
  try {
    const result = await accept(host, 'task-1', 'npm test 全绿');
    assert.equal(result.accepted, false);
    assert.equal(result.status, 'pending');
    assert.match(result.reason, /当前是 pending/);
    assert.doesNotMatch(result.reason, /已经是完成状态/);
    assert.match(host.rows.get('task-1').description, /npm test 全绿/, 'the evidence is still recorded');
  } finally {
    host.dispose();
  }
});

test('accept_task only appends evidence to an already completed task', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [
      { id: 'task-1', subject: '修分页', status: 'completed', ownerName: 'backend', description: '实现分页' },
    ],
  });
  try {
    const result = await accept(host, 'task-1', 'CI 绿了');
    assert.equal(result.accepted, true);
    assert.equal(result.status, 'completed');
    assert.match(result.reason, /已经是完成状态/);
    assert.deepEqual(host.taskUpdates.map((entry) => entry.request.action), ['edit']);
    assert.equal(host.rows.get('task-1').revision, 2);
    assert.match(host.rows.get('task-1').description, /CI 绿了/);
  } finally {
    host.dispose();
  }
});

test('accept_task refuses a pending or unknown task, and both change nothing', async () => {
  const host = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [{ id: 'task-1', subject: '修分页', status: 'pending' }],
  });
  try {
    const pending = await accept(host, 'task-1', '测试通过');
    assert.equal(pending.accepted, false);
    assert.match(pending.reason, /pending/);
    assert.equal(host.taskUpdates.length, 0);

    const missing = await accept(host, 'task-nope', '测试通过');
    assert.equal(missing.accepted, false);
    assert.match(missing.reason, /读不到/);
    assert.equal(host.taskUpdates.length, 0);
    assert.equal(host.rows.get('task-1').status, 'pending');
  } finally {
    host.dispose();
  }
});

test('team_status lists in-progress work owned by an employee as pending acceptance', async () => {
  const created = Date.now() - 30_000;
  const host = await startHost({
    roster: [{ name: 'backend' }, { name: 'reviewer' }],
    seedTasks: [
      { id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend', createdAt: created },
      { id: 'task-2', subject: '审查：修分页', status: 'in_progress', ownerName: 'reviewer' },
      { id: 'task-3', subject: '别人的活', status: 'in_progress', ownerName: 'stranger' },
      { id: 'task-4', subject: '待办', status: 'pending', ownerName: 'backend' },
      { id: 'task-5', subject: '已完成', status: 'completed', ownerName: 'backend' },
      { id: 'task-6', subject: '没有时间的活', status: 'in_progress', ownerName: 'backend' },
      // A REAL task that happens to be worded like a review: the subject prefix
      // alone must never hide work the Lead still has to accept.
      { id: 'task-7', subject: '审查：复核迁移脚本', status: 'in_progress', ownerName: 'backend' },
    ],
  });
  try {
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    assert.deepEqual(
      status.pendingAcceptance.map((row) => row.id),
      ['task-1', 'task-6'],
      'in-progress work owned by a roster member is waiting for acceptance; review paperwork is not',
    );
    const first = status.pendingAcceptance[0];
    assert.equal(first.subject, '修分页');
    assert.equal(first.owner, 'backend');
    // A timestamp the board actually carries gives a real age (±5 s tolerance for
    // the fixture's own write time); no timestamp gives 0, never a guess.
    assert.ok(
      Math.abs(first.ageMs - 30_000) < 5_000,
      `ageMs should track the seeded creation time, got ${first.ageMs}`,
    );
    assert.equal(status.pendingAcceptance[1].ageMs, 0, 'no timestamp means 0');
    // The seeded review task (`审查：修分页`, in_progress, owned by the reviewer) is
    // excluded: it must not sit in the acceptance queue while the implementation
    // it depends on is still open.
    assert.equal(
      status.pendingAcceptance.some((row) => row.id === 'task-2'),
      false,
      'a legacy review task (审查： subject, owned by the reviewer) is never a pending acceptance',
    );
    // The documented trade-off: the subject prefix is the legacy review mark, so
    // ANY task titled `审查：…` counts as paperwork — that is why the README tells
    // people not to use the prefix as a normal title.
    assert.equal(
      status.pendingAcceptance.some((row) => row.id === 'task-7'),
      false,
      'a 审查： subject is treated as a legacy review mark, whoever owns it',
    );
  } finally {
    host.dispose();
  }
});

test('health reports the topology that answered, on both team backends', async () => {
  const service = await startHost({ roster: [{ name: 'backend' }] });
  try {
    const status = await toolOf(service, 'team_status').execute({}, { agent: service.lead });
    assert.equal(status.health.topology, 'team-service');
    assert.equal(status.health.note, '');
    assert.deepEqual(status.health.modelErrors, []);
    assert.deepEqual(status.health.trimmedTools, [], 'a healthy trim is not a degradation');
  } finally {
    service.dispose();
  }

  const tree = await startHost({ roster: [{ name: 'backend' }], topology: 'tree' });
  try {
    const status = await toolOf(tree, 'team_status').execute({}, { agent: tree.lead });
    assert.equal(status.health.topology, 'subagent-tree');
  } finally {
    tree.dispose();
  }

  const empty = teamTopologyOf({});
  assert.equal(empty.topology, 'unsupported', 'no tree and no Team service is a broken mount');
  assert.match(empty.note, /neither the 0\.2\.2 subagent tree/);
  const partial = teamTopologyOf({ get: () => ({ startActivation() {} }) });
  assert.equal(
    partial.topology,
    'unsupported',
    'startActivation without rootOf/namesOf is not the tree this plugin uses',
  );
});

test('health lists the employees whose configured model is not applied', async () => {
  const host = makeGateHost({
    roster: [{ name: 'backend' }],
    config: { modelBackend: 'workbuddy-cn::deepseek-v4.1-flash' },
    resolveError: new Error('unknown provider'),
  }).start();
  try {
    await host.emit('agent/created', { agent: host.lead, source: 'created' });
    // The per-employee model apply runs on its own timer, so let it settle.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    assert.equal(status.health.modelErrors.length, 1);
    assert.equal(status.health.modelErrors[0].member, 'backend');
    assert.match(status.health.modelErrors[0].message, /unknown provider/);
    // The per-member row keeps reporting it too: one state, two views.
    assert.match(status.members[0].modelError, /unknown provider/);
  } finally {
    host.dispose();
  }
});

test('a model error names the role and the model, and both views say the same thing', async () => {
  const host = makeGateHost({
    roster: [{ name: 'backend' }],
    config: { modelBackend: 'workbuddy-cn::deepseek-v4.1-flash' },
    // The kernel without an Agent-level selection registry: the real line the
    // Lead saw in a live session.
    registryMissing: true,
  }).start();
  try {
    await host.emit('agent/created', { agent: host.lead, source: 'created' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });

    assert.equal(status.health.modelErrors.length, 1);
    const row = status.health.modelErrors[0];
    assert.equal(row.member, 'backend', 'the diagnostic names the role, not the session id');
    assert.match(row.message, /backend/, 'the message names the role');
    assert.match(row.message, /workbuddy-cn::deepseek-v4\.1-flash/, 'and the model that did not apply');
    assert.match(row.message, /no selection registry/, 'the API phrase stays matchable');
    assert.match(row.message, /内核/, 'the capability gap is named as one');
    // Same failure, same words: the per-member row and the health list agree.
    assert.equal(status.members[0].modelError, row.message);
    assert.equal(status.members[0].name, row.member);
  } finally {
    host.dispose();
  }
});

test('health lists only the roles whose tool surface this machine could not honour', async () => {
  // `bash` is declared by backend but no plugin here provides it, so
  // `tools.restrict()` rejects the list and the plugin retries with the tools
  // that exist: the applied count really is smaller than the declared one.
  const host = await startHost({ roster: [{ name: 'backend' }], absentTools: ['bash'] });
  try {
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    assert.equal(status.health.trimmedTools.length, 1, 'a real degradation is reported');
    const row = status.health.trimmedTools[0];
    assert.equal(row.role, 'backend');
    assert.equal(
      row.applied < row.requested,
      true,
      `applied (${row.applied}) must be below the declared count (${row.requested})`,
    );
    // `requested` stays the declaration, not the retried list: the diagnostic has
    // to show what the role asked for, not what it got.
    assert.equal(row.requested, row.applied + 1, 'exactly the one absent tool is missing');
    assert.equal(status.health.note.includes('did not carry its allow list'), false);
  } finally {
    host.dispose();
  }
});

test('a role whose whitelist never registered is named in note, not silently listed as trimmed', async () => {
  const host = await startHost({ roster: [{ name: 'backend' }], restrictFails: true });
  try {
    const status = await toolOf(host, 'team_status').execute({}, { agent: host.lead });
    assert.deepEqual(status.health.trimmedTools, [], 'nothing was trimmed, so nothing is a degradation row');
    assert.match(
      status.health.note,
      /1 个员工没有白名单记录/,
      'the employee without a whitelist has to be visible somewhere',
    );
    assert.match(status.health.note, /没有被收窄/);
  } finally {
    host.dispose();
  }
});

test('the fixture fails a tool whose receipt does not match its declared schema', async () => {
  // A nail in the guard itself: if output validation ever stopped applying, every
  // other shape regression in this file would pass silently.
  const host = await startHost({ roster: [] });
  try {
    const broken = defineTool({
      name: 'demo_receipt',
      description: 'Return the wrong shape on purpose.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { value: { type: 'string', required: true } },
        },
        render: () => [],
      },
      execute: async () => ({ somethingElse: true }),
    });
    host.registerCheckedTool(broken);
    await assert.rejects(
      host.registered.get('demo_receipt').execute({}, { agent: host.lead }),
      /does not match its output schema/,
    );
  } finally {
    host.dispose();
  }
});

test('the boss guide carries the three acceptance rules', () => {
  const guide = buildBossGuide();
  assert.match(guide, /员工回报没有证据不验收/);
  assert.match(guide, /完工必须走 accept_task/);
  assert.match(guide, /必须让 reviewer（小审）看 diff/);
});
