/**
 * Model application: the wiring that gives each employee its own model.
 *
 * The interesting surface here is not the Config parsing (that lives in
 * roles.test.js) but the write path. `SessionController.selectModel` resolves its
 * target through the API ownership gate, which refuses every `origin: 'subagent'`
 * session — and every employee session is one — so the plugin has to use the
 * ungated `sessionController.agents.selectForNextRequest` and validate the route
 * itself through `llm.resolveCallConfig`.
 *
 * This file carries its own small Host on purpose: the fixture in host.test.js is
 * built around the tool registry (101 tool names, restrict() emulation) and its
 * `sessionProjections.stateOf` is a constant `undefined`, which cannot express
 * "the selection was applied" or "the resolver threw". Keeping the two apart
 * leaves the 171 existing cases on their own fixture.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../index.js';

/** @param {number} ms - wait. @returns {Promise<void>} settled after the delay. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Two 120ms debounces (settings, then model sync) plus the queued work. */
const SETTLE_MS = 320;

/**
 * One Agent-scoped registry, only as deep as `installBoss` needs.
 * @returns {object} scope whose registrations are kept so `team_status` is callable.
 */
function makeScope() {
  const registered = new Map();
  return {
    registered,
    systemPrompt: {
      getSectionOrder: () => 600,
      section: () => () => {},
    },
    tools: {
      register(definition) {
        registered.set(definition.name, definition);
        return () => registered.delete(definition.name);
      },
      restrict: () => () => {},
      guard: () => () => {},
    },
  };
}

/**
 * Minimal Host for the model-apply path.
 *
 * Modelled: the roster, the live Agents, the `modelSelection` projection, the two
 * model services, and the three events the plugin listens to. Not modelled: the
 * employee scopes — `syncModelsForLead` reads employees off the roster and the
 * live registry, so nothing has to be installed for a model to be applied.
 *
 * @param {{
 *   config?: object,
 *   roster?: { id: string, name: string, status?: string }[],
 *   resolveCallConfig?: (config: object) => object | Promise<object>,
 *   llmMissing?: boolean,
 *   registryMissing?: boolean,
 * }} options - fixture knobs.
 */
function makeHost({
  config = {},
  roster = [],
  resolveCallConfig,
  llmMissing = false,
  registryMissing = false,
} = {}) {
  const listeners = new Map();
  const disposers = [];
  const warnings = [];
  const appends = [];
  const selectModelCalls = [];
  /** sessionId -> { lastUsed, pending }, the shape of the modelSelection projection. */
  const selections = new Map();
  const settingsValue = { ...config };
  let resolveImpl = resolveCallConfig ?? ((candidate) => candidate);

  const leadScope = makeScope();
  const lead = { id: 'sess-lead', session: { id: 'sess-lead' }, ctx: leadScope };
  const leadRow = { id: 'sess-lead', name: 'lead', role: 'lead', status: 'inactive' };
  const members = roster.map((row) => ({ role: 'teammate', status: 'inactive', ...row }));
  const agents = roster.map((row) => ({
    id: row.id,
    session: { id: row.id, header: { id: row.id, origin: 'subagent' } },
    status: row.status ?? 'inactive',
  }));

  const listenersFor = (name) => listeners.get(name) ?? [];

  const sessionController = {
    // The API entry point the plugin must NOT use: it refuses subagent sessions.
    async selectModel(request) {
      selectModelCalls.push(request);
    },
  };
  if (!registryMissing) {
    sessionController.agents = {
      selectForNextRequest(agent, selection) {
        appends.push({ agentId: agent.id, selection: { ...selection } });
        // Mirrors the modelSelection projection: the appended event becomes the
        // pending selection the next prompt assembly reads.
        const previous = selections.get(agent.id) ?? { lastUsed: null, pending: null };
        selections.set(agent.id, { lastUsed: previous.lastUsed, pending: { ...selection } });
      },
      selectionFor(agent) {
        return { current: selections.get(agent.id)?.pending ?? undefined };
      },
    };
  }

  const ctx = {
    logger: {
      warn(message) {
        warnings.push(String(message));
      },
    },
    on(name, listener) {
      const list = listeners.get(name) ?? [];
      list.push(listener);
      listeners.set(name, list);
      return () => {};
    },
    effect(callback) {
      disposers.push(callback());
    },
    get(name) {
      if (name === 'settings') {
        return { describe: () => [{ ns: 'work-team', value: settingsValue }] };
      }
      if (name === 'llm') {
        return llmMissing ? undefined : { resolveCallConfig: (candidate) => resolveImpl(candidate) };
      }
      return undefined;
    },
    agents: {
      // Nothing is live at load: every Agent arrives through `agent/created`, which
      // is also how the Lead's first sync is scheduled.
      list: () => [],
      get: (id) => (id === lead.id ? lead : agents.find((agent) => agent.id === id)),
    },
    sessionProjections: {
      stateOf(session, key) {
        if (key !== 'modelSelection') return undefined;
        return selections.get(session.id);
      },
    },
    sessionController,
    agentTeams: {
      tryMembership(agent) {
        if (agent === lead) return { root: lead, id: 'team', role: 'lead', name: 'lead' };
        const member = members.find((row) => row.id === agent?.id);
        return member === undefined
          ? undefined
          : { root: lead, id: 'team', role: 'teammate', name: member.name };
      },
      listMembers: () => [leadRow, ...members],
      listTasks: () => [],
    },
  };

  return {
    ctx,
    lead,
    tools: leadScope.registered,
    warnings,
    appends,
    selectModelCalls,
    selections,
    /** @param {object} patch - settings document values to merge. */
    setSettings(patch) {
      Object.assign(settingsValue, patch);
    },
    /** @param {(config: object) => object} next - replacement resolver. */
    setResolveCallConfig(next) {
      resolveImpl = next;
    },
    /** @param {object} payload - agent/created payload. */
    async emitCreated(payload) {
      for (const listener of listenersFor('agent/created')) await listener(payload);
    },
    /** @param {string} ns - settings namespace. */
    emitDocumentUpdated(ns) {
      for (const listener of listenersFor('settings/document-updated')) listener(ns);
    },
    /**
     * Record one durable model selection and fan it out the way the Host does:
     * the projection advances, then `session/event` reaches every listener.
     * @param {object} agent - Agent that owns the selection.
     * @param {{ provider: string, model: string, reasoningEffort?: string }} selection - route.
     */
    emitSelection(agent, selection) {
      const previous = selections.get(agent.id) ?? { lastUsed: null, pending: null };
      selections.set(agent.id, { lastUsed: previous.lastUsed, pending: { ...selection } });
      for (const listener of listenersFor('session/event')) {
        listener(agent.session, { type: 'model/selection', data: { ...selection } });
      }
    },
    /** @returns {Promise<object>} the Lead's `team_status` report. */
    teamStatus() {
      return leadScope.registered.get('team_status').execute({}, { agent: lead });
    },
    dispose() {
      for (const dispose of disposers) dispose();
    },
  };
}

/**
 * Boot a fixture and run the Lead's first sync.
 * @param {object} options - makeHost options.
 * @returns {Promise<object>} the settled host.
 */
async function boot(options) {
  const host = makeHost(options);
  apply(host.ctx, options.config ?? {});
  await host.emitCreated({ agent: host.lead, source: 'startup' });
  await delay(SETTLE_MS);
  return host;
}

const ROSTER = [
  { id: 'sess-pm', name: 'pm' },
  { id: 'sess-reviewer', name: 'reviewer' },
];

test('a configured role model is applied to that employee only', async () => {
  const host = await boot({
    config: { modelReviewer: 'workbuddy-cn::glm-5.2' },
    roster: ROSTER,
  });
  try {
    assert.deepEqual(host.appends, [
      {
        agentId: 'sess-reviewer',
        selection: { provider: 'workbuddy-cn', model: 'glm-5.2' },
      },
    ]);
    assert.equal(host.warnings.length, 0);
  } finally {
    host.dispose();
  }
});

test('the ownership-gated selectModel is never called', async () => {
  const host = await boot({
    config: { modelReviewer: 'workbuddy-cn::glm-5.2', modelPm: 'workbuddy-cn::glm-5.2' },
    roster: ROSTER,
  });
  try {
    host.setSettings({ modelPm: 'workbuddy-cn::deepseek-v4.1-flash' });
    host.emitDocumentUpdated('work-team');
    await delay(SETTLE_MS);
    host.emitSelection(host.lead, { provider: 'workbuddy-cn', model: 'deepseek-v4.1' });
    await delay(SETTLE_MS);
    assert.ok(host.appends.length >= 2, 'the fixture applied at least one model per path');
    assert.deepEqual(host.selectModelCalls, []);
  } finally {
    host.dispose();
  }
});

test('an empty model field pins the Lead route at apply time', async () => {
  const pinned = makeHost({ roster: ROSTER });
  pinned.selections.set('sess-lead', {
    lastUsed: null,
    pending: { provider: 'workbuddy-cn', model: 'deepseek-v4.1' },
  });
  apply(pinned.ctx, {});
  await pinned.emitCreated({ agent: pinned.lead, source: 'startup' });
  await delay(SETTLE_MS);
  try {
    assert.deepEqual(
      pinned.appends.map((entry) => entry.agentId),
      ['sess-pm', 'sess-reviewer'],
    );
    for (const entry of pinned.appends) {
      assert.deepEqual(entry.selection, { provider: 'workbuddy-cn', model: 'deepseek-v4.1' });
    }
  } finally {
    pinned.dispose();
  }

  // With no Lead selection there is nothing to follow, so nothing is written.
  const bare = await boot({ roster: ROSTER });
  try {
    assert.deepEqual(bare.appends, []);
    assert.equal(bare.warnings.length, 0);
  } finally {
    bare.dispose();
  }
});

test('a malformed model spec is reported instead of applied', async () => {
  const host = await boot({
    config: { modelReviewer: 'glm-5.3-flash' },
    roster: ROSTER,
  });
  try {
    assert.deepEqual(host.appends, []);
    assert.equal(host.warnings.length, 1);
    assert.match(host.warnings[0], /unparsable model spec "glm-5\.3-flash"/);
    const status = await host.teamStatus();
    const reviewer = status.members.find((member) => member.name === 'reviewer');
    assert.match(reviewer.modelError, /unparsable model spec/);
    // The other employee configured nothing, so it carries no error.
    assert.equal(status.members.find((member) => member.name === 'pm').modelError, '');
  } finally {
    host.dispose();
  }
});

test('a resolver failure is recorded once and retried on the next sync', async () => {
  const failure = new Error('provider "workbuddy-cn" is not registered');
  const host = await boot({
    config: { modelReviewer: 'workbuddy-cn::glm-5.2' },
    roster: ROSTER,
    resolveCallConfig: () => {
      throw failure;
    },
  });
  try {
    assert.deepEqual(host.appends, []);
    assert.equal(host.warnings.length, 1, 'one warning for the first failure');
    assert.match(host.warnings[0], /not registered/);

    const status = await host.teamStatus();
    assert.match(
      status.members.find((member) => member.name === 'reviewer').modelError,
      /not registered/,
    );

    // A second sync with the same failure must not warn again.
    host.emitDocumentUpdated('work-team');
    await delay(SETTLE_MS);
    assert.equal(host.warnings.length, 1);

    // Once the resolver works, the next sync applies the model and clears the error.
    host.setResolveCallConfig((candidate) => candidate);
    host.emitDocumentUpdated('work-team');
    await delay(SETTLE_MS);
    assert.deepEqual(host.appends, [
      {
        agentId: 'sess-reviewer',
        selection: { provider: 'workbuddy-cn', model: 'glm-5.2' },
      },
    ]);
    const after = await host.teamStatus();
    assert.equal(after.members.find((member) => member.name === 'reviewer').modelError, '');
  } finally {
    host.dispose();
  }
});

test('a repeated sync appends the selection once', async () => {
  const host = await boot({
    config: { modelReviewer: 'workbuddy-cn::glm-5.2' },
    roster: ROSTER,
  });
  try {
    assert.equal(host.appends.length, 1);
    host.emitDocumentUpdated('work-team');
    await delay(SETTLE_MS);
    host.emitDocumentUpdated('work-team');
    await delay(SETTLE_MS);
    assert.equal(host.appends.length, 1);
  } finally {
    host.dispose();
  }
});

test('a work-team settings save re-applies the model to online employees', async () => {
  const host = await boot({ roster: ROSTER });
  try {
    assert.deepEqual(host.appends, []);

    host.setSettings({ modelReviewer: 'workbuddy-cn::glm-5.2' });
    host.emitDocumentUpdated('work-team');
    await delay(SETTLE_MS);
    assert.deepEqual(host.appends, [
      {
        agentId: 'sess-reviewer',
        selection: { provider: 'workbuddy-cn', model: 'glm-5.2' },
      },
    ]);

    // Another namespace must not trigger a model sync.
    host.setSettings({ modelReviewer: 'workbuddy-cn::glm-5.3' });
    host.emitDocumentUpdated('other-plugin');
    await delay(SETTLE_MS);
    assert.equal(host.appends.length, 1);
  } finally {
    host.dispose();
  }
});

test('a Lead model change re-pins empty fields and leaves explicit ones alone', async () => {
  const host = makeHost({
    config: { modelBackend: 'workbuddy-cn::glm-5.2' },
    roster: [
      { id: 'sess-pm', name: 'pm' },
      { id: 'sess-backend', name: 'backend' },
    ],
  });
  host.selections.set('sess-lead', {
    lastUsed: null,
    pending: { provider: 'workbuddy-cn', model: 'deepseek-v4.1' },
  });
  apply(host.ctx, { modelBackend: 'workbuddy-cn::glm-5.2' });
  await host.emitCreated({ agent: host.lead, source: 'startup' });
  await delay(SETTLE_MS);
  try {
    assert.deepEqual(host.appends, [
      { agentId: 'sess-pm', selection: { provider: 'workbuddy-cn', model: 'deepseek-v4.1' } },
      { agentId: 'sess-backend', selection: { provider: 'workbuddy-cn', model: 'glm-5.2' } },
    ]);

    host.emitSelection(host.lead, { provider: 'workbuddy-cn', model: 'deepseek-v4.1-flash' });
    await delay(SETTLE_MS);
    assert.deepEqual(host.appends, [
      { agentId: 'sess-pm', selection: { provider: 'workbuddy-cn', model: 'deepseek-v4.1' } },
      { agentId: 'sess-backend', selection: { provider: 'workbuddy-cn', model: 'glm-5.2' } },
      {
        agentId: 'sess-pm',
        selection: { provider: 'workbuddy-cn', model: 'deepseek-v4.1-flash' },
      },
    ]);
  } finally {
    host.dispose();
  }
});

test('an unusable selection registry is reported instead of silently ignored', async () => {
  const host = await boot({
    config: { modelReviewer: 'workbuddy-cn::glm-5.2' },
    roster: ROSTER,
    registryMissing: true,
  });
  try {
    assert.deepEqual(host.appends, []);
    assert.equal(host.warnings.length, 1);
    assert.match(host.warnings[0], /no selection registry/);
    const status = await host.teamStatus();
    assert.match(
      status.members.find((member) => member.name === 'reviewer').modelError,
      /no selection registry/,
    );
  } finally {
    host.dispose();
  }
});

test('a missing LLM service is reported instead of silently ignored', async () => {
  const host = await boot({
    config: { modelReviewer: 'workbuddy-cn::glm-5.2' },
    roster: ROSTER,
    llmMissing: true,
  });
  try {
    assert.deepEqual(host.appends, []);
    assert.equal(host.warnings.length, 1);
    assert.match(host.warnings[0], /llm service unavailable/);
  } finally {
    host.dispose();
  }
});

test('the resolved route drops request controls and normalizes the effort', async () => {
  const host = await boot({
    config: { modelReviewer: 'workbuddy-cn::glm-5.2' },
    roster: ROSTER,
    resolveCallConfig: (candidate) => ({
      ...candidate,
      provider: 'workbuddy-cn',
      model: 'glm-5.2',
      // A branded effort and a materialized maxTokens, as the real resolver returns.
      reasoningEffort: { toString: () => 'high' },
      maxTokens: 32000,
    }),
  });
  try {
    assert.deepEqual(host.appends, [
      {
        agentId: 'sess-reviewer',
        selection: { provider: 'workbuddy-cn', model: 'glm-5.2', reasoningEffort: 'high' },
      },
    ]);
  } finally {
    host.dispose();
  }
});

test('a resolved default effort is not re-appended on the next sync', async () => {
  const host = await boot({
    config: { modelReviewer: 'workbuddy-cn::glm-5.2' },
    roster: ROSTER,
    resolveCallConfig: (candidate) => ({ ...candidate, reasoningEffort: 'high' }),
  });
  try {
    assert.equal(host.appends.length, 1);
    host.emitDocumentUpdated('work-team');
    await delay(SETTLE_MS);
    assert.equal(host.appends.length, 1);
  } finally {
    host.dispose();
  }
});

test('a disposed plugin stops applying models', async () => {
  const host = await boot({
    config: { modelReviewer: 'workbuddy-cn::glm-5.2' },
    roster: ROSTER,
  });
  assert.equal(host.appends.length, 1);

  host.dispose();
  host.setSettings({ modelReviewer: 'workbuddy-cn::glm-5.3' });
  host.emitDocumentUpdated('work-team');
  await delay(SETTLE_MS);
  assert.equal(host.appends.length, 1);
});
