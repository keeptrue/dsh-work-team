/**
 * Both topologies the plugin must run on, exercised through the same surface.
 *
 * DSH 0.2.1-rc.2 hosts the flat Team service (`listMembers` / `tryMembership` /
 * `spawnTeammate` / `sendMessage`); 0.2.2-rc.2 replaced it with one named
 * subagent tree (`rootOf` / `namesOf` / `startActivation` / `listDescendants`
 * / `sendMessage`) and kept `agentTeams` as a task board only.
 *
 * The load-bearing case is the second test: 0.2.1's `subagents` service DOES
 * expose `startActivation`, but with a nested spec and no tree naming, so a
 * probe on that name alone would send a 0.2.2-shaped spec into a 0.2.1 API.
 * The probe therefore asks for the tree capability the bridge actually uses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../index.js';
import {
  boardSupported,
  deliverMessage,
  ensureTeamBoard,
  listTeammates,
  listTeammatesSync,
  membershipOf,
  spawnMember,
  usesSubagentTopology,
} from '../lib/team-bridge.js';

/** @param {string} id - session id. @param {string} [parent] - durable parent session id. */
function agentFixture(id, parent) {
  return {
    id,
    session: { id, header: parent === undefined ? { id } : { id, parentSession: parent, origin: 'subagent' } },
  };
}

/** The 0.2.1 `subagents` surface: starts activations, cannot name a tree member. */
function legacySubagents() {
  return {
    async startActivation() {
      throw new Error('unreachable: the legacy probe must not select startActivation');
    },
    async listDescendants() {
      return [];
    },
    async sendMessage() {
      return 'msg';
    },
  };
}

/**
 * The 0.2.2 tree surface.
 * @param {object[]} descendants - rows `listDescendants()` returns.
 * @param {object} [recorder] - collects calling arguments.
 */
function treeSubagents(descendants, recorder = {}) {
  const service = {
    async startActivation(spec) {
      recorder.activations?.push(spec);
      return {
        childId: `sess-${spec.name}`,
        name: spec.name,
        result: new Promise(() => {}),
        async dispose() {},
      };
    },
    rootOf(caller) {
      return caller?.treeRoot ?? caller;
    },
    namesOf(caller) {
      return { self: caller.treeName ?? caller.id, parent: 'lead' };
    },
    async listDescendants(rootId, signal) {
      recorder.descendants?.push({ rootId, signal });
      return descendants;
    },
    async sendMessage(sender, targetId, content, options) {
      recorder.sends?.push({ sender, targetId, content, options });
      return 'msg-tree';
    },
  };
  return service;
}

test('the probe selects the Team service when only agentTeams is mounted', () => {
  const ctx = { agentTeams: { tryMembership: () => undefined } };
  assert.equal(usesSubagentTopology(ctx), false);
});

test('a 0.2.1 subagents service is NOT mistaken for the tree API', () => {
  // The trap: `startActivation` exists on 0.2.1 and takes a nested spec.
  const ctx = { get: (name) => (name === 'subagents' ? legacySubagents() : undefined) };
  assert.equal(usesSubagentTopology(ctx), false);
});

test('the probe selects the tree when the naming API is present', () => {
  const ctx = { get: (name) => (name === 'subagents' ? treeSubagents([]) : undefined) };
  assert.equal(usesSubagentTopology(ctx), true);
});

test('the legacy branch delegates every mapping to ctx.agentTeams unchanged', async () => {
  const lead = { id: 'sess-lead' };
  const child = { id: 'sess-backend' };
  const teammateRow = { id: 'sess-backend', name: 'backend', role: 'teammate', status: 'inactive' };
  const calls = { spawns: [], sends: [] };
  const ctx = {
    agentTeams: {
      tryMembership(agent) {
        if (agent === lead) return { role: 'lead', name: 'lead', root: lead };
        if (agent === child) return { role: 'teammate', name: 'backend', root: lead };
        return undefined;
      },
      listMembers() {
        return [{ id: 'sess-lead', name: 'lead', role: 'lead' }, teammateRow];
      },
      async sendMessage(caller, request) {
        calls.sends.push({ caller, request });
        return { messageId: 'msg-legacy' };
      },
      async spawnTeammate(caller, request) {
        calls.spawns.push({ caller, request });
        return { member: { id: 'sess-pm', name: 'pm', role: 'teammate', status: 'inactive' } };
      },
    },
  };

  assert.equal(membershipOf(ctx, lead)?.role, 'lead');
  assert.equal(membershipOf(ctx, child)?.name, 'backend');
  assert.equal(membershipOf(ctx, undefined), undefined);

  assert.deepEqual(await listTeammates(ctx, lead), [teammateRow]);
  assert.deepEqual(listTeammatesSync(ctx, lead), [teammateRow]);

  const receipt = await deliverMessage(ctx, lead, {
    target: 'backend',
    content: [{ type: 'text', text: 'hi' }],
  });
  assert.deepEqual(receipt, { messageId: 'msg-legacy' });
  assert.equal(calls.sends[0].request.target, 'backend', 'the legacy API addresses a member by name');

  const hired = await spawnMember(ctx, lead, {
    name: 'pm',
    description: '产品',
    prompt: [{ type: 'text', text: 'start' }],
  });
  assert.equal(hired.member.id, 'sess-pm');
  assert.equal(calls.spawns[0].request.context, 'fresh', 'the legacy spawn keeps its fresh-context contract');
  assert.equal(calls.spawns[0].request.provider, 'spawn');
});

test('the tree branch maps membership, roster, delivery, and hiring onto ctx.subagents', async () => {
  const lead = { id: 'sess-lead', session: { id: 'sess-lead', header: { id: 'sess-lead' } } };
  const teammate = {
    ...agentFixture('sess-backend', 'sess-lead'),
    treeRoot: lead,
    treeName: 'backend',
  };
  const worker = { ...agentFixture('sess-backend-1', 'sess-backend'), treeRoot: lead, treeName: 'backend/checker' };
  // A user fork of an employee: same durable parent, no `origin`, not a member.
  const fork = { id: 'sess-backend-fork', session: { id: 'sess-backend-fork', header: { id: 'sess-backend-fork', parentSession: 'sess-backend' } } };
  const recorder = { activations: [], sends: [], descendants: [] };
  const descendants = [
    { id: 'sess-backend', parentId: 'sess-lead', depth: 1, kind: 'session', mode: 'continuable', path: 'backend' },
    { id: 'sess-backend-1', parentId: 'sess-backend', depth: 2, kind: 'session', mode: 'continuable', path: 'backend/checker' },
    { id: 'sess-pm', parentId: 'sess-lead', depth: 1, kind: 'diagnostic', reason: 'unavailable' },
    { id: 'sess-ghost', parentId: 'sess-lead', depth: 1, kind: 'session', mode: 'one-shot', path: 'ghost' },
  ];
  const registry = new Map([
    [lead.id, { ...lead, status: 'running' }],
    [teammate.id, { ...teammate, status: 'running' }],
    [worker.id, worker],
  ]);
  const ctx = {
    get(name) {
      return name === 'subagents' ? treeSubagents(descendants, recorder) : undefined;
    },
    agents: { get: (id) => registry.get(id) },
  };

  assert.equal(membershipOf(ctx, lead)?.role, 'lead');
  assert.equal(membershipOf(ctx, teammate)?.role, 'teammate');
  assert.equal(membershipOf(ctx, teammate)?.name, 'backend');
  assert.equal(membershipOf(ctx, fork), undefined, 'a user fork is a new tree, not a boss');

  const roster = await listTeammates(ctx, lead);
  assert.equal(roster.length, 1, 'only direct, continuable, non-diagnostic children are seats');
  assert.deepEqual(roster[0], {
    id: 'sess-backend',
    name: 'backend',
    role: 'teammate',
    status: 'running',
  });

  await deliverMessage(ctx, lead, { target: 'backend', content: [{ type: 'text', text: 'go' }] });
  assert.equal(recorder.sends[0].targetId, 'sess-backend', 'the tree API addresses a session id');
  assert.equal(recorder.sends[0].sender, lead);

  const hired = await spawnMember(ctx, lead, {
    name: 'pm',
    description: '产品',
    prompt: [{ type: 'text', text: 'start' }],
  });
  const spec = recorder.activations[0];
  assert.equal(spec.provider, 'spawn');
  assert.equal(spec.name, 'pm', 'a teammate is a NAMED child');
  assert.equal(spec.label, '产品');
  assert.equal(spec.parent, lead);
  assert.equal(spec.delivery, 'parent', 'a teammate reports back to the Lead');
  assert.equal(spec.prompt[0].text, 'start');
  assert.equal(hired.member.id, 'sess-pm');
});

test('the sync roster guard refuses the tree topology instead of returning a promise', () => {
  const ctx = { get: (name) => (name === 'subagents' ? treeSubagents([]) : undefined) };
  assert.throws(() => listTeammatesSync(ctx, { id: 'sess-lead' }), /Team-service topology/);
});

/**
 * A Host fixture carrying the tree topology and nothing else optional.
 * @param {{ teamSize?: number, children?: number }} [options] - config overrides.
 */
function makeTreeHost(options = {}) {
  const listeners = new Map();
  const registered = new Map();
  const activations = [];
  const descendants = [];
  const lead = { id: 'sess-lead', session: { id: 'sess-lead', header: { id: 'sess-lead' } }, status: 'inactive' };
  const scoped = {
    sections: [],
    guards: [],
    tools: {
      register(definition) {
        registered.set(definition.name, definition);
        return () => registered.delete(definition.name);
      },
      guard(predicate) {
        scoped.guards.push(predicate);
        return () => {};
      },
      restrict() {
        return () => {};
      },
    },
  };
  /** Live direct children of the Lead: one-shot workers and teammates alike. */
  const children = Array.from({ length: options.children ?? 0 }, (_, index) => ({
    id: `sess-child-${index + 1}`,
    status: 'inactive',
    session: {
      id: `sess-child-${index + 1}`,
      header: { id: `sess-child-${index + 1}`, parentSession: lead.id, origin: 'subagent' },
    },
  }));
  lead.ctx = {
    systemPrompt: {
      section(section) {
        scoped.sections.push(section);
        return () => {};
      },
      getSectionOrder: () => 600,
    },
    tools: scoped.tools,
  };
  /**
   * The shared task board, in memory.
   *
   * The board is the same service on both topologies, so the tree fixture carries
   * the same compare-and-set contract `host.test.js` implements: create is
   * unowned and pending at revision 1, every mutation checks `expectedRevision`,
   * and `complete` only accepts an in-progress task. That is what lets the review
   * task and the acceptance gate be exercised here instead of only on 0.2.1.
   */
  const rows = new Map();
  const boardUpdates = [];
  let taskNumber = 0;
  /** @param {object} row - stored row. @returns {object} detached view. */
  const boardView = (row) => ({
    ...row,
    blockedBy: [...row.blockedBy],
    writeScopes: [...row.writeScopes],
    ready: row.status === 'pending',
    writeScopeWarnings: [],
  });
  /** @param {string} code - Team error code. @param {string} message - text. */
  const boardFail = (code, message) => Object.assign(new Error(message), { code });
  const board = {
    listTasks() {
      return [...rows.values()].filter((row) => row.status !== 'deleted').map(boardView);
    },
    getTask(_caller, id) {
      const row = rows.get(id);
      if (row === undefined) throw boardFail('TEAM_TASK_NOT_FOUND', `team task "${id}" not found`);
      return boardView(row);
    },
    async createTask(_caller, request) {
      taskNumber += 1;
      const row = {
        id: `task-${taskNumber}`,
        revision: 1,
        subject: request.subject,
        description: request.description,
        status: 'pending',
        blockedBy: [...(request.blockedBy ?? [])],
        writeScopes: [...(request.writeScopes ?? [])],
      };
      rows.set(row.id, row);
      return boardView(row);
    },
    async updateTask(caller, request) {
      boardUpdates.push({ caller, request });
      const row = rows.get(request.taskId);
      if (row === undefined) {
        throw boardFail('TEAM_TASK_NOT_FOUND', `team task "${request.taskId}" not found`);
      }
      if (row.revision !== request.expectedRevision) {
        throw boardFail('TEAM_TASK_STALE_REVISION', `stale team task "${row.id}"`);
      }
      if (request.action === 'complete') {
        if (row.status !== 'in_progress') {
          throw boardFail('TEAM_TASK_INVALID_TRANSITION', 'only an in-progress task can complete');
        }
        row.status = 'completed';
      } else if (request.action === 'edit') {
        if (request.description !== undefined) row.description = request.description;
        if (request.subject !== undefined) row.subject = request.subject;
      } else if (request.action === 'set_dependencies') {
        row.blockedBy = [...(request.blockedBy ?? [])];
      } else if (request.action === 'reassign') {
        if (caller !== lead) throw boardFail('TEAM_LEAD_REQUIRED', 'only the Team Lead can reassign tasks');
        const member = descendants.find((entry) => entry.id === request.owner);
        if (member === undefined) {
          throw boardFail('TEAM_MEMBER_NOT_FOUND', `agent "${request.owner}" is not a continuable descendant`);
        }
        row.status = 'in_progress';
        row.ownerId = member.id;
        row.ownerName = member.path ?? member.id;
      } else {
        throw boardFail('TEAM_INVALID_ARGUMENT', `unsupported task action ${String(request.action)}`);
      }
      row.revision += 1;
      return boardView(row);
    },
  };
  const ctx = {
    logger: { warn() {}, info() {} },
    agents: {
      list: () => [lead, ...children],
      get: (id) => (id === lead.id ? lead : children.find((child) => child.id === id)),
    },
    // The task board is the same service on both topologies, so this fixture
    // implements the same compare-and-set contract host.test.js does — enough
    // for the review task, the acceptance gate, and the budget probe to run on
    // the tree topology too.
    agentTeams: board,
    sessionProjections: { stateOf: () => undefined },
    sessionController: { agents: { selectForNextRequest() {} } },
    get(name) {
      if (name === 'subagents') {
        return {
          async startActivation(spec) {
            activations.push(spec);
            descendants.push({
              id: `sess-${spec.name}`,
              parentId: lead.id,
              depth: 1,
              kind: 'session',
              mode: 'continuable',
              path: spec.name,
            });
            return { childId: `sess-${spec.name}`, name: spec.name, result: new Promise(() => {}), async dispose() {} };
          },
          rootOf: (caller) => lead,
          namesOf: () => ({ self: 'lead' }),
          async listDescendants() {
            return descendants;
          },
          async sendMessage() {
            return 'msg';
          },
        };
      }
      return undefined;
    },
    on(name, listener) {
      const list = listeners.get(name) ?? [];
      list.push(listener);
      listeners.set(name, list);
      return () => {};
    },
    effect(callback) {
      callback();
    },
  };

  const emit = async (name, payload) => {
    for (const listener of listeners.get(name) ?? []) await listener(payload);
  };

  return {
    ctx,
    lead,
    children,
    registered,
    activations,
    /** Durable board rows and every update attempt, for the gate tests. */
    boardRows: rows,
    boardUpdates,
    sections: scoped.sections,
    /** First denial the Lead's tool call would hit, as the tools service resolves it. */
    guardReason(toolName) {
      for (const guard of scoped.guards) {
        const reason = guard({ name: toolName, agent: lead });
        if (reason !== undefined) return reason;
      }
      return undefined;
    },
    emit,
    config: {
      autoStart: 'off',
      teamSize: options.teamSize ?? 2,
      leadHandsOff: false,
      maxWorkersPerEmployee: 2,
      allowSelfHire: true,
      employeeStepBudget: 0,
      reporting: 'result',
    },
  };
}

test('on the tree topology the plugin still installs the Lead scope and hires named children', async () => {
  const host = makeTreeHost({ teamSize: 2 });
  apply(host.ctx, host.config);
  await host.emit('agent/created', { agent: host.lead, source: 'created' });

  assert.ok(host.sections.some((section) => section.name === 'work-team:boss-guide'));
  const teamStart = host.registered.get('team_start');
  assert.ok(teamStart, 'team_start is registered for the tree root');

  const result = await teamStart.execute(
    {},
    { agent: host.lead, signal: new AbortController().signal },
  );

  assert.deepEqual(result.hired.map((row) => row.name), ['pm', 'frontend']);
  assert.equal(host.activations.length, 2, 'every seat is one startActivation');
  for (const spec of host.activations) {
    assert.equal(spec.provider, 'spawn');
    assert.equal(spec.delivery, 'parent');
    assert.equal(spec.parent, host.lead);
    assert.equal(typeof spec.name, 'string');
    assert.deepEqual(spec.prompt[0].type, 'text');
  }
});

test('the tree topology refuses to expand past teamSize', async () => {
  // One seat already taken, capacity one: the Lead may not open another child.
  const host = makeTreeHost({ teamSize: 1, children: 1 });
  apply(host.ctx, host.config);
  await host.emit('agent/created', { agent: host.lead, source: 'created' });

  const denied = host.guardReason('subagent');
  assert.match(String(denied), /at capacity \(1\/1\)/, 'subagent is capped by teamSize');
  assert.match(String(host.guardReason('subagent_fork')), /at capacity \(1\/1\)/);

  // The 0.2.1 tool name is not the expansion path here, so it must not fire.
  assert.equal(host.guardReason('spawn_teammate'), undefined);
  // An unrelated tool is never touched.
  assert.equal(host.guardReason('read'), undefined);
});

test('the tree topology still allows expansion while a seat is free', async () => {
  const host = makeTreeHost({ teamSize: 3, children: 2 });
  apply(host.ctx, host.config);
  await host.emit('agent/created', { agent: host.lead, source: 'created' });

  assert.equal(host.guardReason('subagent'), undefined, '2/3 seats leaves room');
});

test('a user fork of a teammate is never mistaken for a teammate', () => {
  const lead = { id: 'sess-lead', session: { id: 'sess-lead', header: { id: 'sess-lead' } } };
  const fork = {
    id: 'sess-backend-fork',
    session: { id: 'sess-backend-fork', header: { id: 'sess-backend-fork', parentSession: 'sess-backend' } },
  };

  // The dangerous resolution: the fork lands on the ORIGINAL root, and the name
  // it reports is the root's own `lead`.
  const ontoRoot = {
    get: () => ({
      rootOf: () => lead,
      namesOf: () => ({ self: 'lead' }),
      async listDescendants() {
        return [];
      },
      async startActivation() {
        throw new Error('unused');
      },
    }),
  };
  assert.equal(membershipOf(ontoRoot, fork), undefined, 'a root-named row is not a teammate');

  // A fork whose parent is not the root is rejected even with a plausible name.
  const foreignParent = {
    get: () => ({
      rootOf: () => lead,
      namesOf: () => ({ self: 'backend/checker' }),
      async listDescendants() {
        return [];
      },
      async startActivation() {
        throw new Error('unused');
      },
    }),
  };
  assert.equal(membershipOf(foreignParent, fork), undefined, 'only direct children of the root are seats');

  // A genuine direct child still resolves, so the guard did not over-reject.
  const child = {
    id: 'sess-backend',
    session: { id: 'sess-backend', header: { id: 'sess-backend', parentSession: 'sess-lead', origin: 'subagent' } },
  };
  const genuine = {
    get: () => ({
      rootOf: () => lead,
      namesOf: () => ({ self: 'backend' }),
      async listDescendants() {
        return [];
      },
      async startActivation() {
        throw new Error('unused');
      },
    }),
  };
  assert.equal(membershipOf(genuine, child)?.name, 'backend');
});

/*
 * The Session-level Team switch: 0.2.2 only.
 *
 * 0.2.1's board has no gate, so `ensureTeamBoard` must do nothing at all there.
 * On 0.2.2 the switch belongs to the tree root, and a saved `false` is the user's
 * own answer — the plugin opens a board that was never chosen, never one that was
 * chosen off.
 */

test('the board switch is probed as a pair, not by one method name', () => {
  // Only 0.2.2 has both: a kernel with `isEnabled` alone could report that the
  // board is closed and then have no way to open it.
  assert.equal(boardSupported({ agentTeams: { isEnabled: () => false } }), false);
  assert.equal(boardSupported({ agentTeams: { setEnabled: async () => {} } }), false);
  assert.equal(
    boardSupported({ agentTeams: { isEnabled: () => false, setEnabled: async () => {} } }),
    true,
  );
});

test('a 0.2.1 board has no switch, so nothing is opened and nothing is sent', async () => {
  const lead = { id: 'sess-lead' };
  const calls = { tasks: 0, sends: 0 };
  const ctx = {
    agentTeams: {
      tryMembership: () => ({ role: 'lead', name: 'lead', root: lead }),
      listMembers: () => [],
      listTasks() {
        calls.tasks += 1;
        return [];
      },
      async sendMessage() {
        calls.sends += 1;
        return { messageId: 'msg' };
      },
    },
  };

  assert.equal(boardSupported(ctx), false);
  assert.deepEqual(await ensureTeamBoard(ctx, lead), { state: 'unsupported' });
  assert.deepEqual(calls, { tasks: 0, sends: 0 }, 'no switch means no board call, write, or message');
});

test('the tree root owns the switch: one write, then idempotent, and a saved off is kept', async () => {
  const lead = { id: 'sess-lead', session: { id: 'sess-lead', header: { id: 'sess-lead' } } };
  const teammate = { ...agentFixture('sess-backend', 'sess-lead'), treeRoot: lead, treeName: 'backend' };
  const writes = [];
  let enabled = false;
  const ctx = {
    get: (name) => (name === 'subagents' ? treeSubagents([]) : undefined),
    agentTeams: {
      isEnabled(caller) {
        return caller === lead && enabled;
      },
      async setEnabled(caller, value) {
        // The kernel's own rule: only the root may move the switch. Encoding it
        // here turns "the write must come from the root" from an assertion about
        // an argument into behaviour the bridge has to survive.
        if (caller !== lead) {
          throw Object.assign(new Error('change Team mode from the root Session'), {
            code: 'TEAM_LEAD_REQUIRED',
          });
        }
        writes.push({ caller, value });
        enabled = value;
      },
    },
    sessionProjections: { stateOf: () => undefined },
  };

  // A member may ask; the write goes to the root, which is what `setEnabled`
  // requires (it refuses a descendant with TEAM_LEAD_REQUIRED).
  assert.deepEqual(await ensureTeamBoard(ctx, teammate), { state: 'on' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].caller, lead);
  assert.equal(writes[0].value, true);
  await assert.rejects(() => ctx.agentTeams.setEnabled(teammate, true), /root Session/);

  assert.deepEqual(await ensureTeamBoard(ctx, teammate), { state: 'on' });
  assert.equal(writes.length, 1, 'an open board is never reopened');

  // The user closed it in the Team panel: `enabled: false` is a decision.
  enabled = false;
  const savedOff = {
    ...ctx,
    sessionProjections: { stateOf: () => ({ enabled: false }) },
  };
  assert.deepEqual(await ensureTeamBoard(savedOff, teammate), {
    state: 'off',
    reason: 'Agent Teams is switched off for this Session',
  });
  assert.equal(writes.length, 1, 'a saved off is reported, never overwritten');
});

test('a switch that cannot be written is unavailable, not a thrown turn', async () => {
  const lead = { id: 'sess-lead', session: { id: 'sess-lead', header: { id: 'sess-lead' } } };
  const ctx = {
    get: (name) => (name === 'subagents' ? treeSubagents([]) : undefined),
    agentTeams: {
      isEnabled: () => false,
      async setEnabled() {
        throw new Error('persistence unavailable');
      },
    },
    sessionProjections: { stateOf: () => undefined },
  };
  assert.deepEqual(await ensureTeamBoard(ctx, lead), {
    state: 'unavailable',
    reason: 'persistence unavailable',
  });
});

test('a message to `lead` addresses the root Session, from the member that sends it', async () => {
  const lead = { id: 'sess-lead', session: { id: 'sess-lead', header: { id: 'sess-lead' } } };
  const employee = { ...agentFixture('sess-frontend', 'sess-lead'), treeRoot: lead, treeName: 'frontend' };
  const recorder = { sends: [], descendants: [] };
  const ctx = {
    get: (name) => (name === 'subagents' ? treeSubagents([], recorder) : undefined),
  };

  // The root is nobody's descendant, so a name lookup would miss it; and the
  // tree service refuses a self-addressed send, so the root cannot be the sender.
  const receipt = await deliverMessage(ctx, employee, {
    target: 'lead',
    content: [{ type: 'text', text: '招聘申请：笔笔（writer）' }],
  });

  assert.equal(typeof receipt.messageId, 'string');
  assert.equal(recorder.sends.length, 1, 'one delivery, through the tree service');
  assert.equal(recorder.sends[0].sender, employee, 'the employee is the sender');
  assert.equal(recorder.sends[0].targetId, lead.id, 'the root is addressed by Session id');
  assert.ok(recorder.sends[0].options.signal instanceof AbortSignal, 'the send stays cancellable');
  assert.match(recorder.sends[0].content[0].text, /招聘申请/);

  // A root has no inbox of its own: that has to read as a sentence, not as a
  // tree error leaking into the turn.
  await assert.rejects(
    () => deliverMessage(ctx, lead, { target: 'lead', content: [{ type: 'text', text: 'hi' }] }),
    /Cannot deliver to the Lead from the Lead/,
  );
});

test('an unplaceable sender reports a readable delivery error, not a SubagentError', async () => {
  const lead = { id: 'sess-lead', session: { id: 'sess-lead', header: { id: 'sess-lead' } } };
  const stranger = { id: 'sess-ghost', session: { id: 'sess-ghost' } };
  const ctx = {
    get: (name) =>
      name === 'subagents'
        ? {
            startActivation: () => {
              throw new Error('unused');
            },
            namesOf: () => ({ self: 'ghost' }),
            // What the kernel does for an Agent it cannot place in a live tree.
            rootOf() {
              throw Object.assign(new Error('agent "sess-ghost" is not a member of this subagent tree'), {
                code: 'UNAUTHORIZED',
                name: 'SubagentError',
              });
            },
            async listDescendants() {
              return [];
            },
            async sendMessage() {
              throw new Error('unused');
            },
          }
        : undefined,
  };

  await assert.rejects(
    () => deliverMessage(ctx, stranger, { target: 'lead', content: [{ type: 'text', text: 'hi' }] }),
    (error) => {
      assert.match(error.message, /^Cannot deliver to the Lead: /);
      assert.match(error.message, /not a member of this subagent tree/);
      assert.notEqual(error.name, 'SubagentError');
      return true;
    },
  );
});
