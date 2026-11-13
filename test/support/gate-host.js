/**
 * A small Host fixture for the v2.3 acceptance-gate and budget tests.
 *
 * `test/host.test.js` carries the big fixture, built for the formation and
 * `@`-routing tests. These two areas need something narrower and more faithful
 * where it matters: a task board that really is compare-and-set (revisions,
 * actions, ownership, blockers), a token projection the budget can add up, and
 * the three topologies the health probe distinguishes.
 *
 * The board here mirrors `@deepseek-ai/dsh-agent-team`'s `TeamTaskBoard` on the
 * points the Host depends on — create is unowned/pending at revision 1,
 * `updateTask` checks `expectedRevision`, only an in-progress task can complete,
 * only the Lead can reassign, and `reassign` refuses a blocked task.
 */

import { apply } from '../../index.js';
import { ROLES } from '../../lib/roles.js';
import { registerChecked } from './tool-output-check.js';

/**
 * @param {{
 *   config?: object,
 *   roster?: { id?: string, name: string }[],
 *   topology?: 'team' | 'tree',
 *   board?: 'on' | 'off' | 'unavailable' | 'unsupported',
 *   seedTasks?: object[],
 *   tokens?: Record<string, { uncachedInputTokens?: number, outputTokens?: number }>,
 * }} [options] - fixture knobs.
 *   `topology` picks 0.2.1 (Team service) or 0.2.2 (subagent tree); `board` is the
 *   Session Team switch state, where `unavailable` makes reading the saved
 *   selection throw and `unsupported` removes the switch entirely (0.2.1).
 *   `seedTasks` are durable board rows; `tokens` maps a session id to a
 *   `tokenUsage.totals` value.
 * @returns {object} the fixture, with the recorders each test asserts on.
 */
export function makeGateHost({
  config = {},
  roster = [],
  topology = 'team',
  board = 'on',
  seedTasks = [],
  tokens = {},
  resolveError,
  sendError,
  failUpdateAction,
  absentTools = [],
  bumpBetweenWrites = false,
  releaseBeforeComplete = false,
  unreadableSessions = [],
  missingAgents = [],
  noSessionFor = [],
  stripBlockedBy = [],
  noSessionService = false,
  registryMissing = false,
  restrictFails = false,
  presets = ['workspace-write', 'danger-full-access'],
  presetServiceMissing = false,
  presetSetError,
  cwd = '',
  oldRoots = {},
  unloadedSessions = [],
  sessionServiceMode = 'both',
} = {}) {
  const listeners = new Map();
  const registered = new Map();
  const guards = [];
  const sections = [];
  const sends = [];
  const spawns = [];
  const boardWrites = [];
  const warnings = [];
  const taskLog = [];
  const taskUpdates = [];
  const rows = new Map();
  let nextTaskNumber = 1;
  let switchOn = board === 'on';
  /** Set once the simulated concurrent write has landed. */
  let bumped = false;
  /** Cleared by `clearUpdateFailure()` so one test can retry the same path. */
  let failureCleared = false;
  const settings = { ...config };

  const lead = {
    id: 'sess-lead',
    session: { id: 'sess-lead', header: cwd === '' ? { id: 'sess-lead' } : { id: 'sess-lead', cwd } },
    status: 'inactive',
  };

  /**
   * Store one durable task row.
   * @param {object} seed - row fields.
   * @returns {object} the stored row.
   */
  const store = (seed) => {
    const id = seed.id ?? `task-${nextTaskNumber}`;
    nextTaskNumber += 1;
    const row = {
      id,
      revision: 1,
      subject: seed.subject ?? id,
      description: seed.description ?? '',
      status: seed.status ?? 'pending',
      blockedBy: [...(seed.blockedBy ?? [])],
      writeScopes: [...(seed.writeScopes ?? [])],
      ...(seed.ownerId === undefined ? {} : { ownerId: seed.ownerId }),
      ...(seed.ownerName === undefined ? {} : { ownerName: seed.ownerName }),
      ...(seed.createdAt === undefined ? {} : { createdAt: seed.createdAt }),
    };
    rows.set(id, row);
    return row;
  };
  for (const seed of seedTasks) store(seed);

  /** @param {object} row - stored row. @returns {object} detached view. */
  const view = (row) => {
    const projected = {
      ...row,
      writeScopes: [...row.writeScopes],
      ready:
        row.status === 'pending' &&
        row.blockedBy.every((id) => rows.get(id)?.status === 'completed'),
      writeScopeWarnings: [],
    };
    // A view without `blockedBy` is the shape a build that predates the field
    // returns; `stripBlockedBy` reproduces it so the Host's fail-open path is
    // pinned by a test instead of by luck.
    if (stripBlockedBy.includes(row.id)) {
      projected.blockedBy = [...row.blockedBy];
      delete projected.blockedBy;
    } else {
      projected.blockedBy = [...row.blockedBy];
    }
    return projected;
  };

  /** @param {string} code - Team error code. @param {string} message - text. */
  const fail = (code, message) => Object.assign(new Error(message), { code });

  /**
   * Names this machine can restrict: every tool a role declares, minus the ones
   * no installed plugin provides. `tools.restrict()` validates BEFORE it appends
   * and names the accepted set in its error, which is exactly what the plugin's
   * retry reads back — so this fixture has to reject unknown names or the real
   * degradation path stays untested.
   */
  const restrictable = new Set(
    ROLES.flatMap((role) => role.tools).filter((name) => !absentTools.includes(name)),
  );
  /** @param {{ allow?: string[], deny?: string[] }} filter - restrict call. @returns {() => void} disposer. */
  const restrictFilter = (filter) => {
    if (restrictFails) {
      // A failure the plugin cannot recover from: no "known tools" list in the
      // message, so its retry has nothing to intersect with and the role ends up
      // with no whitelist at all.
      throw new Error('tools.restrict() is unavailable in this composition');
    }
    const unknown = [...(filter.allow ?? []), ...(filter.deny ?? [])].filter(
      (name) => !restrictable.has(name),
    );
    if (unknown.length > 0) {
      const known = [...restrictable].sort().join(', ') || '(none)';
      throw new Error(
        `tools.restrict() names unknown global tool${unknown.length > 1 ? 's' : ''} ` +
          `${unknown.map((name) => `"${name}"`).join(', ')}; known global tools: ${known}`,
      );
    }
    return () => {};
  };

  const scopedTools = {
    register(definition) {
      return registerChecked(registered, definition);
    },
    guard(predicate) {
      guards.push(predicate);
      return () => {};
    },
    restrict: restrictFilter,
  };
  lead.ctx = {
    tools: scopedTools,
    systemPrompt: {
      getSectionOrder: () => 600,
      section(section) {
        sections.push(section);
        return () => {};
      },
    },
  };

  /** @type {object[]} live employees. */
  const agents = [];
  const members = [];
  /** Session store: id -> Session, read by the budget without touching Agents. */
  const sessionStore = new Map();
  /**
   * Old root Sessions and their projections, as another conversation left them.
   * `unloadedSessions` keeps one out of the store, which is the "already
   * unloaded" case `team_recover` has to answer without throwing.
   */
  const oldRootSessions = new Map(Object.entries(oldRoots));
  /** Per-Agent scoped registries, keyed by agent id. */
  const scopes = new Map();
  /**
   * One Agent-scoped registry, the way every real Agent carries its own.
   * @param {string} id - session / agent id.
   * @returns {object} the agent's ctx half.
   */
  const agentScope = (id) => {
    const own = {
      registered: new Map(),
      sections: [],
      guards: [],
    };
    scopes.set(id, own);
    return {
      tools: {
        register(definition) {
          return registerChecked(own.registered, definition);
        },
        guard(predicate) {
          own.guards.push(predicate);
          return () => {};
        },
        restrict: restrictFilter,
      },
      systemPrompt: {
        getSectionOrder: () => 600,
        section(section) {
          own.sections.push(section);
          return () => {};
        },
      },
    };
  };
  for (const row of roster) {
    const name = row.name;
    const id = row.id ?? `sess-${name}`;
    if (!noSessionFor.includes(name) && !noSessionFor.includes(id)) {
      // Present in the session store even when no Agent is attached: usage lives
      // on the session, which is what a teammate that finished its turn leaves
      // behind.
      sessionStore.set(id, { id, header: { id } });
    }
    if (noSessionFor.includes(name) || noSessionFor.includes(id)) {
      // Neither a Session nor an Agent: nothing this Host can read usage from.
      members.push({ id, name, role: 'teammate', status: 'inactive' });
      continue;
    }
    if (missingAgents.includes(name) || missingAgents.includes(id)) {
      // On the roster, but with no Agent attached: the session is still readable,
      // which is the whole point of reading usage per session.
      members.push({ id, name, role: 'teammate', status: 'inactive' });
      continue;
    }
    const agent = {
      id,
      status: 'inactive',
      session: {
        id,
        ...(topology === 'tree' ? { header: { id, parentSession: lead.id, origin: 'subagent' } } : {}),
      },
    };
    agent.ctx = agentScope(id);
    agents.push(agent);
    members.push({ id, name, role: 'teammate', status: 'inactive' });
  }
  for (const id of oldRootSessions.keys()) {
    if (unloadedSessions.includes(id)) continue;
    sessionStore.set(id, { id, header: { id } });
  }
  const leadRow = { id: lead.id, name: 'lead', role: 'lead', status: 'inactive' };
  /** @param {object} agent - candidate. @returns {object | undefined} roster row. */
  const rowOf = (agent) =>
    agent === lead || agent?.id === lead.id ? leadRow : members.find((m) => m.id === agent?.id);

  /** The board: compare-and-set, exactly on the fields the Host touches. */
  const boardService = {
    isEnabled() {
      return switchOn;
    },
    async setEnabled(_caller, enabled) {
      boardWrites.push({ caller: _caller, enabled });
      await new Promise((resolve) => setImmediate(resolve));
      switchOn = enabled === true;
    },
    tryMembership(agent) {
      if (agent === lead || agent?.id === lead.id) {
        return { root: lead, id: 'team', role: 'lead', name: 'lead' };
      }
      const row = rowOf(agent);
      if (row === undefined || row.role !== 'teammate') return undefined;
      return { root: lead, id: 'team', role: 'teammate', name: row.name };
    },
    listMembers() {
      return [leadRow, ...members];
    },
    async sendMessage(_caller, request) {
      sends.push({ caller: _caller, request });
      if (sendError !== undefined) throw sendError;
      return { messageId: `msg-${sends.length}` };
    },
    listTasks() {
      return [...rows.values()].filter((row) => row.status !== 'deleted').map(view);
    },
    getTask(_caller, id) {
      const row = rows.get(id);
      if (row === undefined) throw fail('TEAM_TASK_NOT_FOUND', `team task "${id}" not found`);
      return view(row);
    },
    async createTask(caller, request) {
      const row = store({
        subject: request.subject,
        description: request.description,
        blockedBy: request.blockedBy ?? [],
        writeScopes: request.writeScopes ?? [],
      });
      taskLog.push({ caller, request, id: row.id });
      return view(row);
    },
    async updateTask(caller, request) {
      taskUpdates.push({ caller, request });
      if (bumpBetweenWrites && !bumped) {
        // A concurrent write lands between the caller's read and this write: the
        // row moves on, and this attempt loses the compare-and-set.
        bumped = true;
        const row = rows.get(request.taskId);
        if (row !== undefined) row.revision += 1;
        throw fail('TEAM_TASK_STALE_REVISION', `stale team task "${request.taskId}"`);
      }
      if (request.action === failUpdateAction && !failureCleared) {
        throw fail('TEAM_TASK_PERSISTENCE_UNCONFIRMED', 'the append is not durable yet');
      }
      const row = rows.get(request.taskId);
      if (row === undefined) {
        throw fail('TEAM_TASK_NOT_FOUND', `team task "${request.taskId}" not found`);
      }
      if (row.revision !== request.expectedRevision) {
        throw fail('TEAM_TASK_STALE_REVISION', `stale team task "${row.id}"`);
      }
      if (request.action === 'edit') {
        if (request.subject !== undefined) row.subject = request.subject;
        if (request.description !== undefined) row.description = request.description;
      } else if (request.action === 'complete') {
        if (row.status !== 'in_progress') {
          throw fail('TEAM_TASK_INVALID_TRANSITION', 'only an in-progress task can complete');
        }
        row.status = 'completed';
      } else if (request.action === 'set_dependencies') {
        for (const id of request.blockedBy ?? []) {
          if (id === row.id) throw fail('TEAM_TASK_DEPENDENCY_CYCLE', 'a team task cannot block itself');
          if (rows.get(id) === undefined) {
            throw fail('TEAM_TASK_NOT_FOUND', `blocker task "${id}" not found`);
          }
        }
        row.blockedBy = [...(request.blockedBy ?? [])];
      } else if (request.action === 'reassign') {
        if (caller !== lead) throw fail('TEAM_LEAD_REQUIRED', 'only the Team Lead can reassign tasks');
        if (request.owner === undefined) {
          row.status = 'pending';
          delete row.ownerId;
          delete row.ownerName;
        } else {
          if (row.status === 'pending' && view(row).ready !== true) {
            throw fail('TEAM_TASK_BLOCKED', `team task "${row.id}" is blocked`);
          }
          // 0.2.2 resolves a SessionId, 0.2.1 resolves a member name: the
          // fixture answers exactly like the kernel it is standing in for.
          const assignee =
            topology === 'tree'
              ? members.find((member) => member.id === request.owner)
              : members.find((member) => member.name === request.owner);
          if (assignee === undefined) {
            throw fail('TEAM_MEMBER_NOT_FOUND', `agent "${request.owner}" is not a continuable descendant`);
          }
          row.status = 'in_progress';
          row.ownerId = assignee.id;
          row.ownerName = assignee.name;
        }
      } else {
        throw fail('TEAM_INVALID_ARGUMENT', `unsupported task action ${String(request.action)}`);
      }
      row.revision += 1;
      if (releaseBeforeComplete && request.action === 'edit') {
        // The owner releases the task between the caller's edit and its complete:
        // the status really does move, and the tool must describe it accurately.
        row.status = 'pending';
        delete row.ownerId;
        delete row.ownerName;
      }
      return view(row);
    },
    async spawnTeammate(caller, request) {
      spawns.push({ caller, ...request });
      const id = `sess-${request.name}`;
      const member = { id, name: request.name, role: 'teammate', status: 'inactive' };
      const session = { id, header: { id } };
      sessionStore.set(id, session);
      const agent = { id, status: 'inactive', session, ctx: agentScope(id) };
      agents.push(agent);
      members.push(member);
      return { member };
    },
  };

  /** The 0.2.2 tree, so `topology: 'tree'` exercises the other half. */
  const tree = {
    rootOf: (agent) => (agent?.session?.header?.parentSession === undefined ? (agent?.id === lead.id ? lead : undefined) : lead),
    namesOf: (agent) => ({ self: agent?.id === lead.id ? 'lead' : (rowOf(agent)?.name ?? agent?.id) }),
    async listDescendants(rootId) {
      if (rootId !== lead.id) return [];
      return members.map((member) => ({
        id: member.id,
        parentId: lead.id,
        depth: 1,
        kind: 'session',
        mode: 'continuable',
        path: member.name,
      }));
    },
    async startActivation(spec) {
      spawns.push({ caller: spec.parent, name: spec.name, prompt: spec.prompt });
      const id = `sess-${spec.name}`;
      const member = { id, name: spec.name, role: 'teammate', status: 'inactive' };
      agents.push({
        id,
        status: 'inactive',
        session: { id, header: { id, parentSession: lead.id, origin: 'subagent' } },
        ctx: agentScope(id),
      });
      members.push(member);
      return { childId: member.id, name: spec.name, result: new Promise(() => {}), async dispose() {} };
    },
    async sendMessage(sender, targetId, content) {
      sends.push({ sender, targetId, content });
      return `msg-tree-${sends.length}`;
    },
  };

  /**
   * The permission-preset service, modelled on the real one: `names` is a getter
   * over the configured entries, `set` records a durable selection, and
   * `current` answers `custom` when nothing matches.
   */
  const presetCalls = [];
  const presetCurrent = new Map();
  const presetService = {
    get names() {
      return [...presets];
    },
    catalog() {
      return { presets: presets.map((name) => ({ name })) };
    },
    current(session) {
      return presetCurrent.get(session?.id) ?? 'custom';
    },
    set(session, name) {
      presetCalls.push({ session, name });
      if (presetSetError !== undefined) throw presetSetError;
      if (!presets.includes(name)) throw new Error(`unknown permission preset "${name}"`);
      presetCurrent.set(session.id, name);
    },
  };

  const ctx = {
    logger: { warn: (line) => warnings.push(line) },
    tools: { get: () => undefined },
    on(name, listener) {
      const list = listeners.get(name) ?? [];
      list.push(listener);
      listeners.set(name, list);
      return () => {};
    },
    effect(callback) {
      callback();
    },
    get(name) {
      if (name === 'subagents') return topology === 'tree' ? tree : undefined;
      if (name === 'sessions') {
        if (noSessionService || sessionServiceMode === 'property') return undefined;
        return { get: (id) => sessionStore.get(id) };
      }
      if (name === 'permissionPresets') return presetServiceMissing ? undefined : presetService;
      if (name === 'llm') {
        // Mounted, so the model-apply path validates instead of reporting a
        // missing service; `resolveError` is how a rejected route is simulated.
        return {
          resolveCallConfig: async (candidate) => {
            if (resolveError !== undefined) throw resolveError;
            return candidate;
          },
        };
      }
      return undefined;
    },
    agents: {
      list: () => [...agents],
      get: (id) => (id === lead.id ? lead : agents.find((agent) => agent.id === id)),
    },
    // `sessionServiceMode: 'get-only'` models a composition where the service is
    // reachable only through `ctx.get('sessions')` — no property on the context.
    // That is the shape the plugin must handle (the service is not injected), and
    // the shape where a direct `ctx.sessions` read silently finds nothing.
    ...(sessionServiceMode === 'property' || sessionServiceMode === 'both'
      ? { sessions: { get: (id) => sessionStore.get(id) } }
      : {}),
    sessionProjections: {
      stateOf(session, key) {
        if (key === 'tokenUsage') {
          // A session whose usage cannot be read at all — the case the budget has
          // to count instead of adding a silent zero.
          if (unreadableSessions.includes(session?.id)) throw new Error('usage projection unavailable');
          const totals = tokens[session?.id];
          return totals === undefined ? undefined : { totals };
        }
        if (key === 'agentTeam') {
          const old = oldRootSessions.get(session?.id);
          if (old !== undefined) return old.agentTeam;
          if (board === 'unavailable') throw new Error('projection is not materialized');
          return board === 'off' ? { enabled: false } : undefined;
        }
        if (key === 'subagentCatalog') {
          return oldRootSessions.get(session?.id)?.catalog;
        }
        return undefined;
      },
    },
    // A composition without the service must not expose it on either path.
    ...(presetServiceMissing ? {} : { permissionPresets: presetService }),
    sessionController: {
      selectModel: async () => {},
      agents: { selectForNextRequest() {}, selectionFor: () => ({ current: undefined }) },
    },
    agentTeams: boardService,
  };
  if (topology === 'tree') delete boardService.tryMembership;
  if (noSessionService) delete ctx.sessions;
  if (registryMissing) delete ctx.sessionController.agents.selectForNextRequest;
  if (board === 'unsupported') {
    delete boardService.isEnabled;
    delete boardService.setEnabled;
  }

  /**
   * Dispatch one Host event to its listeners, returning the last value.
   *
   * `pre-step` is a waterfall: the listener chain ends in `next()`, so a caller
   * that omits it gets the messages unchanged (which is what "the plugin did not
   * rewrite anything" means).
   * @param {string} name - event name.
   * @param {object} payload - event payload.
   * @returns {Promise<unknown>} the last listener's resolved value.
   */
  const emit = async (name, payload) => {
    const next = async () => ({ kind: 'enter', messages: payload?.messages });
    let result;
    for (const listener of listeners.get(name) ?? []) result = await listener(payload, next);
    return result;
  };

  return {
    ctx,
    lead,
    members,
    registered,
    sends,
    spawns,
    boardWrites,
    presetCalls,
    presetCurrent,
    /** Per-Agent scoped registries, keyed by agent id. */
    scopes,
    /**
     * First denial the Lead's call would hit, as the tools service resolves it.
     * @param {string} toolName - tool about to run.
     * @param {object} [args] - parsed arguments.
     * @returns {string | undefined} denial reason.
     */
    guardReason(toolName, args = {}) {
      for (const guard of guards) {
        const reason = guard({ name: toolName, arguments: args, agent: lead });
        if (reason !== undefined) return reason;
      }
      return undefined;
    },
    /**
     * First denial one employee's call would hit.
     * @param {string} id - employee session id.
     * @param {string} toolName - tool about to run.
     * @param {object} [args] - parsed arguments.
     * @returns {string | undefined} denial reason.
     */
    employeeGuardReason(id, toolName, args = {}) {
      const own = scopes.get(id);
      if (own === undefined) return undefined;
      for (const guard of own.guards) {
        const reason = guard({ name: toolName, arguments: args, agent: { id } });
        if (reason !== undefined) return reason;
      }
      return undefined;
    },
    warnings,
    taskLog,
    taskUpdates,
    rows,
    store,
    emit,
    setSettings: (patch) => Object.assign(settings, patch),
    /** Emit the settings-document event the Host fires after a save. */
    emitDocumentUpdated(ns) {
      for (const listener of listeners.get('settings/document-updated') ?? []) listener(ns);
    },
    /**
     * Register one extra tool through the validating path.
     *
     * Exposed so a test can prove the guard itself works: a fixture whose
     * validation silently stopped applying would let every other shape
     * regression through unnoticed.
     * @param {object} definition - tool definition from `defineTool`.
     * @returns {() => boolean} disposer.
     */
    registerCheckedTool: (definition) => registerChecked(registered, definition),
    /** Stop simulating the injected update failure (see `failUpdateAction`). */
    clearUpdateFailure() {
      failureCleared = true;
    },
    /** @param {object} patch - settings document values. */
    applyConfig(patch, overrides = {}) {
      Object.assign(settings, patch);
      apply(ctx, { ...settings, ...patch, ...overrides });
    },
    /** Install the plugin the way the Host does at load time. */
    start(overrides = {}) {
      apply(ctx, { ...settings, ...overrides });
      return this;
    },
    dispose() {
      for (const listener of listeners.get('agent/disposed') ?? []) {
        void listener({ agent: lead });
      }
    },
  };
}
