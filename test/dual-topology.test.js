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
  deliverMessage,
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
 * @param {{ teamSize?: number }} [options] - config overrides.
 */
function makeTreeHost(options = {}) {
  const listeners = new Map();
  const registered = new Map();
  const activations = [];
  const descendants = [];
  const lead = { id: 'sess-lead', session: { id: 'sess-lead', header: { id: 'sess-lead' } }, status: 'inactive' };
  const scoped = {
    sections: [],
    tools: {
      register(definition) {
        registered.set(definition.name, definition);
        return () => registered.delete(definition.name);
      },
      guard() {
        return () => {};
      },
      restrict() {
        return () => {};
      },
    },
  };
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
  const ctx = {
    logger: { warn() {}, info() {} },
    agents: { list: () => [lead], get: (id) => (id === lead.id ? lead : undefined) },
    agentTeams: {
      listTasks: () => [],
      async createTask() {
        throw new Error('unused');
      },
    },
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
    registered,
    activations,
    sections: scoped.sections,
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
