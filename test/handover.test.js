/**
 * 换届: the handover brief.
 *
 * The document is the only sanctioned way to change hands (the roster is
 * append-only), so it must contain exactly what the Host can prove — roster,
 * board, diagnostics, budget — and say `（无）` where there is nothing. These tests
 * pin both halves: the real data, and the absence of invented prose.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeGateHost } from './support/gate-host.js';

/** @param {object} [options] - `makeGateHost` options. @returns {Promise<object>} running fixture. */
async function startHost(options = {}) {
  const host = makeGateHost(options).start();
  await host.emit('agent/created', { agent: host.lead, source: 'created' });
  return host;
}

/** @param {object} host - fixture. @param {object} args - tool args. */
function handover(host, args = {}) {
  const tool = host.registered.get('team_handover');
  assert.ok(tool, 'team_handover is registered on the Lead scope');
  return tool.execute(args, { agent: host.lead, signal: new AbortController().signal });
}

/** @returns {Promise<string>} a fresh temp directory. */
async function tempDir() {
  return mkdtemp(join(tmpdir(), 'wt-handover-'));
}

test('the brief carries the real roster, tasks, blockers, budget and note', async () => {
  const dir = await tempDir();
  const host = await startHost({
    cwd: dir,
    roster: [{ name: 'backend' }, { name: 'frontend' }],
    seedTasks: [
      { id: 'task-1', subject: '修 /users 分页', status: 'in_progress', ownerName: 'backend' },
      { id: 'task-2', subject: '改设置页', status: 'pending', ownerName: 'frontend', blockedBy: ['task-1'] },
      { id: 'task-3', subject: '已完成的事', status: 'completed', ownerName: 'backend' },
    ],
    tokens: { 'sess-lead': { uncachedInputTokens: 1_234 } },
    config: { teamTokenBudget: 10_000, benchRoles: 'ops' },
  });
  try {
    const result = await handover(host, { note: '客户要灰度，别动支付路径' });
    try {
      assert.equal(result.written, true);
      const expected = join(dir, '.dsh', 'work-team', 'handover.md');
      assert.equal(result.path, expected);
      const onDisk = await readFile(expected, 'utf8');
      assert.equal(onDisk, result.markdown, 'the returned text is exactly what was written');

      assert.match(result.markdown, /老后/);
      assert.match(result.markdown, /小前/);
      assert.match(result.markdown, /模型 follow-main/);
      // In-flight work, with its owner.
      assert.match(result.markdown, /task-1\` 修 \/users 分页 ← backend/);
      // The acceptance queue is the same rule team_status uses.
      assert.match(
        result.markdown,
        /task-1.*（旧板上：需在旧会话验收，或按第 2 步重建后再验收）/s,
        'the queue line must carry the migration rule itself, not only rely on the header',
      );
      // The owner stays visible; only the advice changed.
      assert.match(result.markdown, /task-1\` 修 \/users 分页 ← backend（旧板上/);
      // Blockers name the blocker that is still open.
      assert.match(result.markdown, /task-2.*被 task-1 挡住/s);
      // A completed task is not in-flight and not blocked.
      assert.doesNotMatch(result.markdown, /task-3/);
      // Budget and bench come from the same measurement the status tool prints.
      assert.match(result.markdown, /已用 1234 \/ 上限 10000（warn）/);
      assert.match(result.markdown, /停职：ops/);
      assert.match(result.markdown, /客户要灰度，别动支付路径/);
      // Nothing invented: no summary or decision log the plugin has no source for.
      assert.doesNotMatch(result.markdown, /最近决策|进展总结|下一步计划/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    host.dispose();
  }
});

test('the brief works on the 0.2.2 subagent tree as well', async () => {
  const dir = await tempDir();
  const host = await startHost({
    topology: 'tree',
    cwd: dir,
    roster: [{ name: 'backend' }],
    seedTasks: [{ id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend' }],
  });
  try {
    const result = await handover(host);
    try {
      assert.equal(result.written, true);
      assert.match(result.markdown, /backend/);
      assert.match(result.markdown, /task-1/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    host.dispose();
  }
});

test('the brief states that the roster and board do not migrate to a new Session', async () => {
  const dir = await tempDir();
  const host = await startHost({
    cwd: dir,
    roster: [{ name: 'backend' }],
    seedTasks: [{ id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend' }],
  });
  try {
    const result = await handover(host);
    try {
      // The three facts that keep a new Lead from walking into a contradiction.
      assert.match(result.markdown, /名单与任务板不随新会话迁移/);
      assert.match(result.markdown, /新会话是新 root、空日志/);
      assert.match(result.markdown, /要延续在办工作只有两条路/);
      assert.match(result.markdown, /旧 task id 跨会话不可用/);
      assert.match(result.markdown, /accept_task` 只对当前会话板上的任务有效/);
      // The rebuild path is spelled out, in the body and in the steps, and the
      // first move is the read-only recovery check, not a blind rebuild.
      assert.match(result.markdown, /team_task_create/);
      assert.match(result.markdown, /先 `team_recover` 看旧板还在不在/);
      assert.match(result.markdown, /team_recover\(\{ sessionId:/);
      // It must never suggest accepting an old id in the new Session.
      assert.doesNotMatch(result.markdown, /直接在新会话.{0,6}验收|在新会话里验收/);
      // Overwrite semantics are on the document itself.
      assert.match(result.markdown, /覆盖/);
      // The source board is named, so the reader can tell which conversation it was.
      assert.match(result.markdown, /来源：会话 `sess-lead`/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    host.dispose();
  }
});

test('a brand-new Session really does start with an empty roster and board', async () => {
  // The fact the brief warns about, pinned: the same plugin in a fresh root
  // reports nothing, because the board is rebuilt from that root's own log.
  const oldTeam = await startHost({
    roster: [{ name: 'backend' }],
    seedTasks: [{ id: 'task-1', subject: '修分页', status: 'in_progress', ownerName: 'backend' }],
  });
  let oldBrief;
  try {
    oldBrief = await handover(oldTeam);
    assert.match(oldBrief.markdown, /task-1/, 'the old board had work');
  } finally {
    oldTeam.dispose();
  }

  const fresh = await startHost({ roster: [] });
  try {
    const status = await fresh.registered.get('team_status').execute({}, { agent: fresh.lead });
    assert.equal(status.size, 0, 'a new Session starts with no roster');
    assert.deepEqual(status.tasks, { pending: 0, inProgress: 0, completed: 0 });
    assert.deepEqual(status.pendingAcceptance, []);
    // And the old brief is therefore NOT a description of this board.
    assert.match(oldBrief.markdown, /名单与任务板不随新会话迁移/);
  } finally {
    fresh.dispose();
  }
});

test('an empty team writes placeholders instead of inventing content', async () => {
  const dir = await tempDir();
  const host = await startHost({ cwd: dir, roster: [] });
  try {
    const result = await handover(host);
    try {
      assert.equal(result.written, true);
      assert.match(result.markdown, /（无）/);
      assert.match(result.markdown, /## 用户交代\n（无）/);
      assert.match(result.markdown, /## 花名册（0 人）\n（无）/);
      assert.doesNotMatch(result.markdown, /最近决策|进展总结/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    host.dispose();
  }
});

test('a Session without a working directory returns the text and says it was not written', async () => {
  const host = await startHost({ roster: [{ name: 'backend' }] });
  try {
    const result = await handover(host);
    assert.equal(result.written, false);
    assert.equal(result.path, '');
    assert.match(result.markdown, /未落盘，原因：.*没有工作目录/);
    assert.match(result.markdown, /backend/, 'the brief is still useful');
  } finally {
    host.dispose();
  }
});

test('a failed write degrades to text instead of failing the tool', async () => {
  // `/dev/null` is a character device: creating `.dsh/work-team` under it cannot
  // succeed, which is a real filesystem refusal rather than a stub.
  const host = await startHost({ cwd: '/dev/null', roster: [{ name: 'backend' }] });
  try {
    const result = await handover(host);
    assert.equal(result.written, false);
    assert.equal(result.path, '');
    assert.match(result.markdown, /未落盘，原因：写 .* 失败/);
    assert.match(result.markdown, /backend/);
  } finally {
    host.dispose();
  }
});
