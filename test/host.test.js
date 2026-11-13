/**
 * Host-level behaviour of the Work Team plugin, exercised through `apply()` with a
 * fake Host context. The pure rules live in roles.test.js; this file covers the
 * wiring that is easy to break: the autoStart state machine, the Lead's `@role`
 * pre-step router, the live hands-off guard, and — because `agent/created` and
 * `agent/pre-step` are awaited by the Host — the promise that neither of them
 * blocks on a spawn.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../index.js';
import { registerChecked } from './support/tool-output-check.js';
import { until } from './support/until.js';

/** @param {number} ms - wait. @returns {Promise<void>} settled after the delay. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The two layers an employee's tools come from, mirroring the Web composition.
 *
 * `dsh-web-app` disables the file, shell, job, skill, subagent, workflow, goal,
 * todo, and web tool rows in the GLOBAL layer; each session's agent preset mounts
 * them into an ANCESTOR layer (`dsh-agent-preset-registry` binds the preset as a
 * scope parent). So the unscoped global view cannot see `read`, `bash`, or
 * `grep` even though the agent can call them, and only `restrictableNames`
 * covers both layers.
 *
 * 70 global + 21 preset + 11 own-layer (nine Team tools and two hire tools, one
 * of which — `list_agents` — shadows its preset copy) = the 101-tool surface
 * measured on a live employee.
 */
const GLOBAL_TOOL_NAMES = new Set([
  'anysearch_batch_search',
  'anysearch_capabilities',
  'anysearch_search',
  'ask_user_question',
  'cordis_inspect_list',
  'cordis_inspect_query',
  'create_worktree',
  'dsh_browser_a11y',
  'dsh_browser_auth',
  'dsh_browser_back',
  'dsh_browser_challenge',
  'dsh_browser_check',
  'dsh_browser_clear',
  'dsh_browser_click',
  'dsh_browser_close_tab',
  'dsh_browser_content',
  'dsh_browser_download',
  'dsh_browser_execute',
  'dsh_browser_fill',
  'dsh_browser_forward',
  'dsh_browser_get_value',
  'dsh_browser_history',
  'dsh_browser_key',
  'dsh_browser_list_tabs',
  'dsh_browser_open',
  'dsh_browser_refresh',
  'dsh_browser_replay',
  'dsh_browser_reset',
  'dsh_browser_reset_session',
  'dsh_browser_restrict',
  'dsh_browser_scrape',
  'dsh_browser_screenshot',
  'dsh_browser_scroll',
  'dsh_browser_select',
  'dsh_browser_session',
  'dsh_browser_set_value',
  'dsh_browser_snapshot',
  'dsh_browser_switch_tab',
  'dsh_browser_type',
  'dsh_browser_visited',
  'dsh_browser_wait',
  'exit_plan_mode',
  'generate_image',
  'list_images',
  'plugin_market',
  'present',
  'purge_apply',
  'purge_revert',
  'purge_status',
  'read_image',
  'render_ui',
  'schedule_create',
  'schedule_delete',
  'schedule_list',
  'schedule_update',
  'session_event_read',
  'session_event_search',
  'session_event_trace',
  'session_search',
  'session_trace',
  'sidebar_open',
  'terminal_close',
  'terminal_list',
  'terminal_open',
  'terminal_read',
  'terminal_send',
  'terminal_signal',
  'validate_dsh_ui',
  'visualize',
  'working_directory',
]);

/** Tools the session's agent preset mounts into an ancestor layer. */
const PRESET_TOOL_NAMES = new Set([
  'bash',
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'todo_write',
  'skill',
  'subagent',
  'subagent_fork',
  'web_search',
  'web_fetch',
  'job_list',
  'job_output',
  'job_kill',
  'workflow',
  'create_goal',
  'get_goal',
  'update_goal',
  'plugin_manager',
  // Also mounted by the preset, but the Team package registers the same name in
  // the member scope, which shadows the ancestor copy.
  'list_agents',
]);

/** What `restrict()` validates against: global + preset, own layer excluded. */
const RESTRICTABLE_TOOL_NAMES = new Set([...GLOBAL_TOOL_NAMES, ...PRESET_TOOL_NAMES]);

/** Tools the Team package registers into every member scope, Lead or not. */
const TEAM_TOOL_NAMES = [
  'spawn_teammate',
  'send_message',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
];

/**
 * Minimal Host + Lead the plugin can install a boss scope into.
 * @param {{
 *   config?: object,
 *   roster?: object[],
 *   spawnDelayMs?: number,
 *   spawnGate?: Promise<void>,
 *   listAtLoad?: boolean,
 *   sendError?: Error,
 *   listError?: Error,
 *   employee?: { id?: string, name?: string },
 *   workers?: number,
 *   forkCopies?: number,
 *   absentTools?: string[],
 *   boardEnabled?: boolean,
 *   boardError?: Error,
 *   teamState?: object,
 *   boardSwitch?: boolean,
 *   treeTopology?: boolean,
 *   listTasksError?: Error,
 * }} options - fixture knobs. `listAtLoad` mimics a plugin reload over a live
 *   session. `employee` adds one live employee Agent (also on the roster),
 *   `workers` gives it that many live temporary-worker children, and
 *   `forkCopies` adds live user forks of the employee session (same
 *   `parentSession`, no `origin: 'subagent'`). `absentTools` are declared names
 *   no installed plugin provides: `restrict()` rejects them, which is the
 *   degraded path the whitelist has to survive.
 *   `boardEnabled` starts the Session's Team switch on (the 0.2.2 kernel starts
 *   it off), `boardError` makes opening it fail, and `teamState` is the saved
 *   `agentTeam` projection — pass `{ enabled: false }` for a Session the user
 *   switched off by hand.
 *   `boardSwitch: false` removes `isEnabled`/`setEnabled` and the gate, which is
 *   the 0.2.1 shape; `treeTopology` mounts the 0.2.2 `subagents` tree so the
 *   host half can be exercised on the topology it actually ships to.
 *   `seedTasks` starts the board with real rows (`id`, `subject`, `status`,
 *   `ownerName`, `blockedBy`, `createdAt`), so the acceptance gate and the
 *   per-employee token sums can be exercised against a board that is already
 *   carrying work.
 */
function makeHost({
  config = {},
  roster = [],
  spawnDelayMs = 0,
  spawnGate,
  listAtLoad = false,
  sendError,
  listError,
  employee,
  workers = 0,
  forkCopies = 0,
  absentTools = [],
  boardEnabled = false,
  boardError,
  teamState,
  boardSwitch = true,
  treeTopology = false,
  listTasksError,
  seedTasks = [],
  tokens = {},
} = {}) {
  const listeners = new Map();
  const restrictions = [];
  const sends = [];
  const treeSends = [];
  const spawns = [];
  const tasks = [];
  /** Durable task rows, keyed by id: the board this fixture actually serves. */
  const taskRows = new Map();
  /** Every `updateTask` call, in order — compare-and-set attempts included. */
  const taskUpdates = [];
  const warnings = [];
  const boardWrites = [];
  const disposers = [];
  const members = roster.map((row) => ({ role: 'teammate', status: 'inactive', ...row }));
  const settingsValue = { ...config };
  let nextCalls = 0;
  let agentsListError;
  let nextTaskNumber = 1;

  /**
   * Seed one durable task row.
   * @param {object} seed - row fields; `id` and `createdAt` are optional.
   * @returns {object} the stored row.
   */
  const seedTask = (seed) => {
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
    taskRows.set(id, row);
    return row;
  };
  for (const seed of seedTasks) seedTask(seed);

  /**
   * Project one stored row the way the Team service does: detached arrays plus
   * `ready`, which is `pending` and unblocked.
   * @param {object} row - stored task row.
   * @returns {object} task view.
   */
  const taskView = (row) => ({
    ...row,
    blockedBy: [...row.blockedBy],
    writeScopes: [...row.writeScopes],
    ready:
      row.status === 'pending' &&
      row.blockedBy.every((id) => taskRows.get(id)?.status === 'completed'),
    writeScopeWarnings: [],
  });

  /** @param {string} code - Team error code. @param {string} message - human text. */
  const teamError = (code, message) => Object.assign(new Error(message), { code });
  /**
   * The 0.2.2 gate: every board call refuses until the Session's Team mode is on.
   * @returns {void}
   * @throws the kernel's exact refusal, code included.
   */
  const requireBoard = () => {
    if (!boardSwitch || boardEnabled) return;
    throw Object.assign(new Error('enable Agent Teams for this Session before using the task board'), {
      code: 'TEAM_DISABLED',
    });
  };

  /**
   * One Agent-scoped registry. Real Agents never share these: the Lead's
   * `hire_teammate` and an employee's are different definitions.
   *
   * `restrict` mirrors dsh-tools closely enough to catch the wiring bugs that
   * matter: an unknown name throws, filters intersect, and a scope's own
   * registrations are never filtered.
   */
  const makeScopedTools = () => {
    const tools = new Map();
    const guards = [];
    const sections = [];
    const filters = [];
    return {
      tools,
      guards,
      sections,
      filters,
      register(definition) {
        // Same output-schema enforcement the kernel applies (and gate-host uses):
        // a receipt that drops a required field fails its test here instead of
        // reaching a live session as a ToolOutputError.
        return registerChecked(tools, definition);
      },
      restrict(filter) {
        // Mirrors dsh-tools: validate against the inherited set (global + preset,
        // own layer excluded) and throw its exact wording before appending.
        const restrictable = restrictableNames();
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
        restrictions.push(filter);
        const entry = {
          allow: filter.allow === undefined ? undefined : new Set(filter.allow),
          deny: filter.deny === undefined ? undefined : new Set(filter.deny),
          admits(name) {
            if (this.allow !== undefined && !this.allow.has(name)) return false;
            if (this.deny !== undefined && this.deny.has(name)) return false;
            return true;
          },
        };
        filters.push(entry);
        return () => {
          const index = filters.indexOf(entry);
          if (index >= 0) filters.splice(index, 1);
        };
      },
      guard(guard) {
        guards.push(guard);
        return () => {};
      },
    };
  };

  /**
   * Names this scope may restrict: the global and preset layers, minus anything
   * no installed plugin provides.
   * @returns {Set<string>} restrictable names.
   */
  const restrictableNames = () =>
    new Set([...RESTRICTABLE_TOOL_NAMES].filter((name) => !absentTools.includes(name)));

  /**
   * Tools one scope can call, exactly as dsh-tools resolves visibility: every
   * inherited global name must pass all active filters, and the scope's own
   * registrations bypass them.
   * @param {object} scoped - registry from makeScopedTools.
   * @returns {Set<string>} visible tool names.
   */
  const visibleTools = (scoped) => {
    const names = new Set();
    for (const name of restrictableNames()) {
      if (scoped.filters.every((filter) => filter.admits(name))) names.add(name);
    }
    for (const name of scoped.tools.keys()) names.add(name);
    return names;
  };

  /** @param {object} scoped - registry from makeScopedTools. */
  const contextOf = (scoped) => ({
    tools: {
      register: scoped.register,
      restrict: scoped.restrict,
      guard: scoped.guard,
    },
    systemPrompt: {
      getSectionOrder() {
        return 600;
      },
      section(definition) {
        scoped.sections.push(definition);
        return () => {};
      },
    },
  });

  /** Stand-ins for the Team package's registrations into one member scope. */
  const installTeamTools = (scoped) => {
    for (const name of TEAM_TOOL_NAMES) scoped.register({ name, description: name });
  };

  const leadScoped = makeScopedTools();
  const lead = { id: 'sess-lead', session: { id: 'sess-lead' } };
  lead.ctx = contextOf(leadScoped);

  /** @type {object[]} live non-Lead Agents, in registration order. */
  const liveAgents = [];
  let employeeAgent;
  let employeeScoped;
  let employeeMembership;
  if (employee !== undefined) {
    const name = employee.name ?? 'frontend';
    const id = employee.id ?? `sess-${name}`;
    const scoped = makeScopedTools();
    installTeamTools(scoped);
    employeeScoped = scoped;
    // On the tree topology the employee is a durable child of the Lead; the
    // legacy Team service resolved that from its own journal instead.
    employeeAgent = {
      id,
      session: {
        id,
        ...(treeTopology ? { header: { id, parentSession: lead.id, origin: 'subagent' } } : {}),
      },
      status: 'inactive',
    };
    employeeAgent.ctx = contextOf(scoped);
    liveAgents.push(employeeAgent);
    members.push({ id, name, role: 'teammate', status: 'inactive' });
    employeeMembership = { root: lead, id: 'team', role: 'teammate', name };
    for (let index = 0; index < workers; index += 1) {
      const childId = `${id}-worker-${index + 1}`;
      liveAgents.push({
        id: childId,
        session: { id: childId, header: { id: childId, parentSession: id, origin: 'subagent' } },
      });
    }
    // A user fork of the employee session: same durable parent, but it is not a
    // delegated child, so it must never take a worker slot.
    for (let index = 0; index < forkCopies; index += 1) {
      const copyId = `${id}-fork-${index + 1}`;
      liveAgents.push({
        id: copyId,
        session: { id: copyId, header: { id: copyId, parentSession: id } },
      });
    }
  }

  const leadRow = { id: 'sess-lead', name: 'lead', role: 'lead', status: 'inactive', diagnostics: [] };

  /** @param {string} id - session id. @returns {string | undefined} roster name. */
  const rosterNameOf = (id) => members.find((member) => member.id === id)?.name;

  /**
   * The 0.2.2 subagent tree, mounted only when the fixture asks for it.
   *
   * Everything on it is deliberately close to the kernel's own rules, because
   * the point of the tree mode is to catch exactly those rules: `rootOf` resolves
   * any member to the Lead, `namesOf` reports `lead` for the root, a target is
   * addressed by Session id (not by name), and the root itself has no inbox.
   */
  const treeService = {
    rootOf(agent) {
      if (agent === undefined || agent === null) return undefined;
      if (agent === lead || agent.id === lead.id) return lead;
      return agent.session?.header?.parentSession === undefined ? undefined : lead;
    },
    namesOf(agent) {
      if (agent === lead || agent.id === lead.id) return { self: 'lead' };
      return { self: rosterNameOf(agent.id) ?? agent.id };
    },
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
      spawns.push({
        caller: spec.parent,
        name: spec.name,
        description: spec.label,
        prompt: spec.prompt,
        context: 'fresh',
        provider: spec.provider,
        signal: spec.signal,
      });
      const member = { id: `sess-${spec.name}`, name: spec.name, role: 'teammate', status: 'inactive' };
      members.push(member);
      return { childId: member.id, name: spec.name, result: new Promise(() => {}), async dispose() {} };
    },
    async sendMessage(sender, targetId, content, options) {
      treeSends.push({ sender, targetId, content, options });
      if (sendError !== undefined) throw sendError;
      return `msg-tree-${treeSends.length}`;
    },
  };

  const ctx = {
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
    // The unscoped global view. It deliberately lacks every preset-mounted tool:
    // `read` / `bash` / `grep` are absent here while the agent can still call them.
    tools: {
      get: (name) => (GLOBAL_TOOL_NAMES.has(name) ? { name } : undefined),
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
      if (name === 'subagents') return treeTopology ? treeService : undefined;
      if (name === 'llm') {
        // Mounted, so the model-apply path validates instead of reporting a
        // missing service. This fixture never configures a model.
        return { resolveCallConfig: async (candidate) => candidate };
      }
      if (name !== 'settings') return undefined;
      return { describe: () => [{ ns: 'work-team', value: settingsValue }] };
    },
    agents: {
      list: () => {
        if (agentsListError !== undefined) throw agentsListError;
        return listAtLoad ? [lead, ...liveAgents] : [...liveAgents];
      },
      get: (id) => (id === lead.id ? lead : liveAgents.find((agent) => agent.id === id)),
    },
    sessionProjections: {
      stateOf(session, key) {
        if (key === 'tokenUsage') {
          // Seeded usage, so the budget gate can be exercised here too.
          const totals = tokens[session?.id];
          return totals === undefined ? undefined : { totals };
        }
        return key === 'agentTeam' ? teamState : undefined;
      },
    },
    sessionController: {
      // Kept as a recorder: the plugin must never route an employee selection
      // through this ownership-gated API.
      selectModel: async () => {},
      agents: {
        selectForNextRequest() {},
        selectionFor() {
          return { current: undefined };
        },
      },
    },
    agentTeams: {
      // The per-Session switch 0.2.2 added: absent on 0.2.1, which is exactly the
      // topology difference `boardSupported()` has to recognise.
      isEnabled() {
        return boardEnabled;
      },
      async setEnabled(caller, enabled) {
        boardWrites.push({ caller, enabled });
        if (boardError !== undefined) throw boardError;
        // The kernel appends the event, then awaits the flush, and the remote
        // path is an RPC back to the host: the switch is not readable on the same
        // tick it was asked for. A macrotask yield models that durable flush, and
        // it is the window single-flight coalescing has to cover.
        await new Promise((resolve) => setImmediate(resolve));
        boardEnabled = enabled === true;
      },
      tryMembership(agent) {
        if (agent === lead) return { root: lead, id: 'team', role: 'lead', name: 'lead' };
        if (agent !== undefined && agent === employeeAgent) return employeeMembership;
        return undefined;
      },
      listMembers() {
        if (listError !== undefined) throw listError;
        return [leadRow, ...members];
      },
      async sendMessage(caller, request) {
        sends.push({ caller, request });
        if (sendError !== undefined) throw sendError;
        return { messageId: `msg-${sends.length}` };
      },
      listTasks(caller) {
        requireBoard(caller);
        if (listTasksError !== undefined) throw listTasksError;
        return [...taskRows.values()]
          .filter((row) => row.status !== 'deleted')
          .map(taskView);
      },
      getTask(caller, id) {
        requireBoard(caller);
        const row = taskRows.get(id);
        if (row === undefined) throw teamError('TEAM_TASK_NOT_FOUND', `team task "${id}" not found`);
        return taskView(row);
      },
      async createTask(caller, request) {
        requireBoard(caller);
        // The service creates an UNOWNED, PENDING task with revision 1: there is
        // no owner field on create, which is why an assigned review task needs a
        // `reassign` afterwards.
        const row = seedTask({
          subject: request.subject,
          description: request.description,
          blockedBy: request.blockedBy ?? [],
          writeScopes: request.writeScopes ?? [],
        });
        tasks.push({ caller, request, id: row.id, revision: row.revision });
        return taskView(row);
      },
      async updateTask(caller, request) {
        requireBoard(caller);
        taskUpdates.push({ caller, request });
        const row = taskRows.get(request.taskId);
        if (row === undefined) {
          throw teamError('TEAM_TASK_NOT_FOUND', `team task "${request.taskId}" not found`);
        }
        if (row.revision !== request.expectedRevision) {
          throw teamError(
            'TEAM_TASK_STALE_REVISION',
            `stale team task "${row.id}" revision ${request.expectedRevision}; current revision is ${row.revision}`,
          );
        }
        if (row.status === 'deleted') {
          throw teamError('TEAM_TASK_DELETED', `team task "${row.id}" is deleted`);
        }
        /** Mirrors the kernel's authorization: the Lead, or the current owner. */
        const authorize = () => {
          if (caller !== lead && row.ownerId !== caller?.id) {
            throw teamError('TEAM_TASK_UNAUTHORIZED', 'task mutation requires its owner or Team Lead');
          }
        };
        switch (request.action) {
          case 'edit':
            authorize();
            if (request.subject !== undefined) row.subject = request.subject;
            if (request.description !== undefined) row.description = request.description;
            break;
          case 'complete':
            authorize();
            if (row.status !== 'in_progress') {
              throw teamError('TEAM_TASK_INVALID_TRANSITION', 'only an in-progress task can complete');
            }
            row.status = 'completed';
            break;
          case 'reassign': {
            if (caller !== lead) throw teamError('TEAM_LEAD_REQUIRED', 'only the Team Lead can reassign tasks');
            if (row.status !== 'pending' && row.status !== 'in_progress') {
              throw teamError(
                'TEAM_TASK_INVALID_TRANSITION',
                'only a pending or in-progress task can be reassigned',
              );
            }
            if (request.owner === undefined) {
              row.status = 'pending';
              delete row.ownerId;
              delete row.ownerName;
              break;
            }
            // A blocked task cannot be handed out: the reviewer would look busy
            // on work it is not allowed to start.
            if (row.status === 'pending' && taskView(row).ready !== true) {
              throw teamError('TEAM_TASK_BLOCKED', `team task "${row.id}" is blocked`);
            }
            // 0.2.2 resolves a SessionId, 0.2.1 a member name.
            const assignee = treeTopology
              ? members.find((member) => member.id === request.owner)
              : members.find((member) => member.name === request.owner);
            if (assignee === undefined) {
              throw teamError(
                'TEAM_MEMBER_NOT_FOUND',
                `agent "${request.owner}" is not a continuable descendant of this task board's root`,
              );
            }
            row.status = 'in_progress';
            row.ownerId = assignee.id;
            row.ownerName = assignee.name;
            break;
          }
          case 'set_dependencies':
            authorize();
            if (!Array.isArray(request.blockedBy)) {
              throw teamError('TEAM_INVALID_ARGUMENT', 'set_dependencies requires blocked_by');
            }
            for (const id of request.blockedBy) {
              if (id === row.id) {
                throw teamError('TEAM_TASK_DEPENDENCY_CYCLE', 'a team task cannot block itself');
              }
              if (taskRows.get(id) === undefined) {
                throw teamError('TEAM_TASK_NOT_FOUND', `blocker task "${id}" not found`);
              }
            }
            row.blockedBy = [...request.blockedBy];
            break;
          default:
            throw teamError('TEAM_INVALID_ARGUMENT', `unsupported task action ${String(request.action)}`);
        }
        row.revision += 1;
        return taskView(row);
      },
      async spawnTeammate(caller, request) {
        // The caller is part of the record: an employee hire must still spawn
        // through the root Lead, not through the employee itself.
        spawns.push({ caller, ...request });
        if (spawnGate !== undefined) await spawnGate;
        if (spawnDelayMs > 0) await delay(spawnDelayMs);
        const member = {
          id: `sess-${request.name}`,
          name: request.name,
          role: 'teammate',
          status: 'inactive',
          description: request.description,
          diagnostics: [],
        };
        members.push(member);
        return { member };
      },
    },
  };

  // The 0.2.1 shape: no per-Session switch at all, and a board that always
  // answers. `boardSupported()` has to see both methods gone.
  if (!boardSwitch) {
    delete ctx.agentTeams.isEnabled;
    delete ctx.agentTeams.setEnabled;
  }

  /** @param {string} name - event name. @returns {Function[]} registered listeners. */
  const listenersFor = (name) => listeners.get(name) ?? [];
  /**
   * Emit `agent/created` the way the Host does: every listener awaited in order.
   * @param {object} payload - agent/created payload.
   * @returns {Promise<unknown[]>} each listener's resolved return value.
   */
  const emitCreated = async (payload) => {
    const results = [];
    for (const listener of listenersFor('agent/created')) results.push(await listener(payload));
    return results;
  };
  /**
   * Run the pre-step waterfall the way the Host does.
   * @param {object[]} messages - messages entering the step.
   * @param {() => Promise<object>} next - downstream decision.
   */
  const emitPreStep = async (messages, next) => {
    let index = 0;
    const chain = async () => {
      const listener = listenersFor('agent/pre-step')[index];
      index += 1;
      if (listener === undefined) {
        nextCalls += 1;
        return next();
      }
      return listener(
        { agent: lead, messages, turn: 1, step: 1, signal: new AbortController().signal },
        chain,
      );
    };
    return chain();
  };
  /** @param {string} ns - settings namespace. */
  const emitDocumentUpdated = (ns) => {
    for (const listener of listenersFor('settings/document-updated')) listener(ns);
  };
  /** @param {object} patch - settings document values to merge. */
  const setSettings = (patch) => Object.assign(settingsValue, patch);
  /** @param {object} scoped - one Agent's tool registry. @param {string} toolName - tool name. */
  const reasonFrom = (scoped, toolName) => {
    for (const guard of scoped.guards) {
      const reason = guard({ name: toolName });
      if (reason !== undefined) return reason;
    }
    return undefined;
  };
  /**
   * First denial a Lead tool call would hit, exactly as the tools service resolves it.
   * @param {string} toolName - tool name.
   * @returns {string | undefined} denial reason.
   */
  const guardReason = (toolName) => reasonFrom(leadScoped, toolName);
  /**
   * First denial the employee Agent's tool call would hit.
   * @param {string} toolName - tool name.
   * @returns {string | undefined} denial reason.
   */
  const employeeGuardReason = (toolName) =>
    employeeScoped === undefined ? undefined : reasonFrom(employeeScoped, toolName);

  return {
    ctx,
    lead,
    tools: leadScoped.tools,
    employee: employeeAgent,
    employeeTools: employeeScoped === undefined ? undefined : employeeScoped.tools,
    employeeSections: employeeScoped === undefined ? undefined : employeeScoped.sections,
    employeeFilters: employeeScoped === undefined ? undefined : employeeScoped.filters,
    /** Only the allow filters: a read-only role also carries a deny filter. */
    employeeAllowFilters: () =>
      employeeScoped === undefined
        ? undefined
        : employeeScoped.filters.filter((filter) => filter.allow !== undefined),
    employeeVisibleTools: () => (employeeScoped === undefined ? undefined : visibleTools(employeeScoped)),
    restrictions,
    sends,
    treeSends,
    spawns,
    tasks,
    /** Durable board rows, keyed by id: assert revisions and evidence here. */
    taskRows,
    /** Every `updateTask` attempt in order, refusals included. */
    taskUpdates,
    /** Add one row to the board after the plugin is applied. */
    seedTask,
    members,
    boardWrites,
    warnings,
    tree: treeTopology ? treeService : undefined,
    get boardEnabled() {
      return boardEnabled;
    },
    emitCreated,
    emitPreStep,
    emitDocumentUpdated,
    setSettings,
    guardReason,
    employeeGuardReason,
    /** @param {Error | undefined} error - make the live-agent registry read throw. */
    setAgentsListError(error) {
      agentsListError = error;
    },
    get nextCalls() {
      return nextCalls;
    },
    resetNextCalls() {
      nextCalls = 0;
    },
    get teamStart() {
      return leadScoped.tools.get('team_start');
    },
    dispose() {
      for (const dispose of disposers) dispose();
    },
  };
}

/** @param {string} id - message id. @param {string} text - text block. */
function userMessage(id, text, extraBlocks = []) {
  const source = { kind: 'user' };
  return { id, role: 'user', source, content: [{ type: 'text', text }, ...extraBlocks] };
}

/** @returns {Promise<object>} a decision that keeps the messages as they are. */
const keepMessages = (messages) => async () => ({ kind: 'enter', messages });

const IMAGE_BLOCK = {
  type: 'image',
  attachment: { id: 'att-1', mediaType: 'image/png', bytes: 12, name: 'shot.png' },
};

test('immediate autoStart forms the default line-up off the creation path', async () => {
  const host = makeHost({ config: { autoStart: 'immediate', teamSize: 3 } });
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 3 });
    // `agent/created` is serial and awaited: the listener must return before any spawn.
    const results = await host.emitCreated({ agent: host.lead, source: 'startup' });
    assert.deepEqual(results, [undefined]);
    assert.equal(host.spawns.length, 0);

    // The lanes are started by timers, so wait for the requests themselves.
    await until(() => host.spawns.length === 3, {
      describe: () => host.spawns.map((request) => request.name),
    });
    assert.deepEqual(
      host.spawns.map((request) => request.name),
      ['pm', 'frontend', 'backend'],
    );
    for (const request of host.spawns) {
      assert.equal(request.context, 'fresh');
      assert.equal(request.provider, 'spawn');
      assert.ok(request.signal instanceof AbortSignal);
    }
  } finally {
    host.dispose();
  }
});

test('agent/created resolves while the first spawn is still open', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const host = makeHost({ config: { autoStart: 'immediate', teamSize: 2 }, spawnGate: gate });
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 2 });
    const created = await Promise.race([
      host.emitCreated({ agent: host.lead, source: 'startup' }),
      delay(500).then(() => {
        throw new Error('agent/created awaited a spawn');
      }),
    ]);
    assert.deepEqual(created, [undefined]);
    // The creation path returned before the background loop even asked for seat one.
    assert.equal(host.spawns.length, 0);

    // Formation concurrency keeps both seats in flight; neither has settled. Wait
    // for the second request instead of betting on a 10 ms window: both lanes are
    // started by timers, and two asynchronous spawns do not always register that
    // fast on a loaded machine.
    await until(() => host.spawns.length === 2, {
      describe: () => ({ spawns: host.spawns.length, members: host.members.length }),
    });
    assert.equal(host.members.length, 0);

    release();
    await until(() => host.members.length === 2, {
      describe: () => ({ spawns: host.spawns.length, members: host.members.length }),
    });
  } finally {
    host.dispose();
  }
});

test('a slow formation never delays the first step', async () => {
  const host = makeHost({
    config: { autoStart: 'first-message', teamSize: 2 },
    spawnDelayMs: 200,
  });
  try {
    apply(host.ctx, { autoStart: 'first-message', teamSize: 2 });
    await host.emitCreated({ agent: host.lead, source: 'startup' });
    await delay(20);
    assert.equal(host.spawns.length, 0);

    const messages = [userMessage('m1', '你好')];
    const started = Date.now();
    const decision = await Promise.race([
      host.emitPreStep(messages, keepMessages(messages)),
      delay(500).then(() => {
        throw new Error('agent/pre-step awaited formation');
      }),
    ]);
    const elapsed = Date.now() - started;
    assert.deepEqual(decision, { kind: 'enter', messages });
    // The spawns in this test take 200 ms, so anything well under that proves the
    // step did not wait for them. The bound is 100 ms rather than 30: a 30 ms
    // budget is a wall-clock assertion about the runner, and it flakes on a loaded
    // box while saying nothing extra about the behaviour.
    assert.ok(elapsed < 100, `pre-step took ${elapsed}ms; it must not wait for the spawns`);

    await until(() => host.spawns.length === 2, {
      describe: () => ({ spawns: host.spawns.length, members: host.members.length }),
    });
    // Two spawns are open at once; the roster only fills when they settle.
    assert.equal(host.members.length, 0);
  } finally {
    host.dispose();
  }
});

test('first-message autoStart waits for the first step and never blocks it', async () => {
  const host = makeHost({ config: { autoStart: 'first-message', teamSize: 2 } });
  try {
    apply(host.ctx, { autoStart: 'first-message', teamSize: 2 });
    await host.emitCreated({ agent: host.lead, source: 'startup' });
    await delay(20);
    assert.equal(host.spawns.length, 0);

    const messages = [userMessage('m1', '你好')];
    const decision = await host.emitPreStep(messages, keepMessages(messages));
    assert.deepEqual(decision, { kind: 'enter', messages });
    await until(() => host.spawns.length === 2, {
      describe: () => host.spawns.map((request) => request.name),
    });
    assert.deepEqual(
      host.spawns.map((request) => request.name),
      ['pm', 'frontend'],
    );
  } finally {
    host.dispose();
  }
});

test('autoStart ignores clear, compact, and a lead that was already formed', async () => {
  const host = makeHost({ config: { autoStart: 'immediate', teamSize: 2 } });
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 2 });
    await host.emitCreated({ agent: host.lead, source: 'clear' });
    await host.emitCreated({ agent: host.lead, source: 'compact' });
    await delay(20);
    assert.equal(host.spawns.length, 0);

    await host.emitCreated({ agent: host.lead, source: 'resume' });
    await until(() => host.spawns.length === 2, { describe: () => host.spawns.length });
    assert.equal(host.spawns.length, 2);

    // The second resume must add nothing: this one is a hold, not a wait.
    await host.emitCreated({ agent: host.lead, source: 'resume' });
    await delay(20);
    assert.equal(host.spawns.length, 2);
  } finally {
    host.dispose();
  }
});

test('a Lead already live when the plugin loads is treated as a resume', async () => {
  const host = makeHost({ config: { autoStart: 'immediate', teamSize: 2 }, listAtLoad: true });
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 2 });
    await until(() => host.spawns.length === 2, { describe: () => host.spawns.length });
    assert.equal(host.spawns.length, 2);
  } finally {
    host.dispose();
  }
});

test('concurrent formation never exceeds the configured capacity', async () => {
  // The regression: capacity 2 with pm already seated. Both lanes used to claim a
  // seat off the same stale roster and the run ended at [pm, frontend, backend].
  const host = makeHost({
    config: { autoStart: 'immediate', teamSize: 2 },
    roster: [{ id: 'sess-pm', name: 'pm' }],
    spawnDelayMs: 25,
  });
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 2 });
    await host.emitCreated({ agent: host.lead, source: 'startup' });
    let status;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      status = await host.tools.get('team_status').execute({}, { agent: host.lead });
      if (status.autoStart !== 'running') break;
      await delay(5);
    }
    assert.notEqual(status.autoStart, 'running', 'formation settled');
    assert.ok(host.members.length <= 2, `team must stay within capacity, got ${host.members.length}`);
    assert.equal(status.size, 2);
    assert.deepEqual(
      host.spawns.map((request) => request.name),
      ['frontend'],
      'only the one free seat is spawned',
    );
  } finally {
    host.dispose();
  }
});

test('hire_teammate for an existing employee sends the task instead of spawning again', async () => {
  const host = makeHost({ listAtLoad: true, roster: [{ id: 'sess-backend', name: 'backend' }] });
  try {
    apply(host.ctx, {});
    const result = await host.tools.get('hire_teammate').execute(
      { role: 'backend', task: '再补一个迁移脚本' },
      { agent: host.lead, signal: new AbortController().signal },
    );
    assert.equal(result.created, false);
    assert.equal(result.name, 'backend');
    assert.equal(result.task, '再补一个迁移脚本');
    assert.equal(host.spawns.length, 0, 'no second teammate is created');
    assert.equal(host.sends.length, 1, 'the task still reaches the existing employee');
    assert.equal(host.sends[0].request.target, 'backend');
    assert.deepEqual(host.sends[0].request.content, [{ type: 'text', text: '再补一个迁移脚本' }]);
  } finally {
    host.dispose();
  }
});

test('team_start hires through the same two-lane pool and reports the settled shape', async () => {
  const host = makeHost({ listAtLoad: true, spawnDelayMs: 25 });
  try {
    apply(host.ctx, {});
    const started = host.teamStart.execute({}, { agent: host.lead });
    // Two seats in flight at once; a serial loop would only ever show one.
    await until(() => host.spawns.length === 2, { describe: () => host.spawns.length });
    assert.equal(host.spawns.length, 2);
    const result = await started;
    assert.deepEqual(
      host.spawns.map((request) => request.name),
      ['pm', 'frontend', 'backend', 'reviewer', 'researcher', 'designer', 'ops'],
    );
    assert.equal(result.hired.length, 7);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.failed, []);
    assert.equal(result.size, 7);
    assert.equal(result.capacity, 7);

    // A second call at capacity breaks before the skipped check, exactly like the
    // serial loop: nobody hired, nothing reported skipped, note points at capacity.
    const again = await host.teamStart.execute({}, { agent: host.lead });
    assert.equal(again.hired.length, 0);
    assert.equal(again.size, 7);
    assert.deepEqual(again.skipped, []);
    assert.deepEqual(again.failed, []);
    assert.match(again.note, /capacity/);
  } finally {
    host.dispose();
  }
});

test('team_start reports progress instead of opening a second formation group', async () => {
  const host = makeHost({ config: { autoStart: 'immediate', teamSize: 4 }, spawnDelayMs: 15 });
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 4 });
    await host.emitCreated({ agent: host.lead, source: 'startup' });
    // Wait until the formation run has actually started a lane, instead of giving
    // it 5 ms and hoping.
    await until(() => host.spawns.length > 0, { describe: () => host.spawns.length });

    const running = await host.teamStart.execute({}, { agent: host.lead });
    assert.equal(running.hired.length, 0);
    assert.match(running.note, /Automatic team formation is already/);
    assert.equal(running.capacity, 4);

    // The seats being requested is not the same as the run being finished: the
    // second call only reports capacity once formation has settled, so that is
    // what to wait for.
    await until(
      async () => {
        const report = await host.tools.get('team_status').execute({}, { agent: host.lead });
        return report.autoStart === 'done';
      },
      { describe: () => 'formation never settled' },
    );
    assert.equal(host.spawns.length, 4);
    const after = await host.teamStart.execute({}, { agent: host.lead });
    assert.match(after.note, /capacity/);
    assert.equal(after.size, 4);
  } finally {
    host.dispose();
  }
});

test('a failed seat is recorded and never retried by the same run', async () => {
  const host = makeHost({ config: { autoStart: 'immediate', teamSize: 2 }, spawnDelayMs: 5 });
  const original = host.ctx.agentTeams.spawnTeammate;
  host.ctx.agentTeams.spawnTeammate = async (caller, request) => {
    if (request.name === 'pm') throw new Error('capacity exhausted');
    return original(caller, request);
  };
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 2 });
    await host.emitCreated({ agent: host.lead, source: 'startup' });
    // Poll the formation lock instead of guessing a fixed delay: the run is done
    // only once `autoStart` leaves 'running', whatever the spawn timing.
    let status;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      status = await host.tools.get('team_status').execute({}, { agent: host.lead });
      if (status.autoStart !== 'running') break;
      await delay(5);
    }
    assert.notEqual(status.autoStart, 'running', 'formation settled');
    // pm failed once and was not retried; the next seat still fits the remaining capacity.
    assert.deepEqual(
      host.spawns.map((request) => request.name),
      ['frontend'],
    );
  } finally {
    host.dispose();
  }
});

test('@role is forwarded to the employee and the Lead only sees a receipt', async () => {
  const host = makeHost({ roster: [{ id: 'sess-backend', name: 'backend' }] });
  try {
    apply(host.ctx, {});
    const message = userMessage('m1', '@老后 修一下 /users 接口');
    const messages = [message];
    const decision = await host.emitPreStep(messages, keepMessages(messages));

    assert.equal(host.sends.length, 1);
    assert.equal(host.sends[0].request.target, 'backend');
    assert.deepEqual(host.sends[0].request.content, [
      { type: 'text', text: '修一下 /users 接口' },
    ]);
    assert.equal(decision.kind, 'enter');
    assert.equal(decision.messages.length, 1);
    assert.equal(decision.messages[0].id, 'm1');
    assert.equal(decision.messages[0].source, message.source);
    assert.match(decision.messages[0].content[0].text, /已转发给 老后/);
    assert.match(decision.messages[0].content[0].text, /不要自己执行/);
    assert.equal(host.nextCalls, 0);

    // The same pending message must not be forwarded twice.
    const again = await host.emitPreStep(messages, keepMessages(messages));
    assert.equal(host.sends.length, 1);
    assert.equal(host.nextCalls, 1);
    assert.equal(again.messages[0].content[0].text, '@老后 修一下 /users 接口');
  } finally {
    host.dispose();
  }
});

test('attachments survive both the forward and the receipt', async () => {
  const host = makeHost({ roster: [{ id: 'sess-frontend', name: 'frontend' }] });
  try {
    apply(host.ctx, {});
    const message = userMessage('m1', '@小前 看这个', [IMAGE_BLOCK]);
    const messages = [message];
    const decision = await host.emitPreStep(messages, keepMessages(messages));

    assert.equal(host.sends.length, 1);
    assert.deepEqual(host.sends[0].request.content, [
      { type: 'text', text: '看这个' },
      IMAGE_BLOCK,
    ]);
    assert.equal(decision.messages[0].content.length, 2);
    assert.equal(decision.messages[0].content[1], IMAGE_BLOCK);
    assert.match(decision.messages[0].content[0].text, /已转发给 小前/);
  } finally {
    host.dispose();
  }
});

test('a failed forward says so instead of disappearing', async () => {
  const host = makeHost({
    roster: [{ id: 'sess-frontend', name: 'frontend' }],
    sendError: new Error('inbox rejected'),
  });
  try {
    apply(host.ctx, {});
    const message = userMessage('m1', '@小前 改空状态', [IMAGE_BLOCK]);
    const messages = [message];

    const failed = await host.emitPreStep(messages, keepMessages(messages));
    assert.equal(host.sends.length, 1);
    const text = failed.messages[0].content[0].text;
    assert.match(text, /转发给 小前（frontend）失败：inbox rejected/);
    assert.match(text, /没有送达/);
    assert.match(text, /改空状态/);
    assert.match(text, /请你自己处理/);
    assert.equal(failed.messages[0].content[1], IMAGE_BLOCK);
    assert.equal(host.nextCalls, 0);

    // Marked after the attempt: a re-offer does not forward again, and the Lead
    // keeps the text it was given.
    await host.emitPreStep(messages, keepMessages(messages));
    assert.equal(host.sends.length, 1);
    assert.equal(host.nextCalls, 1);
  } finally {
    host.dispose();
  }
});

test('a missing or failed role rewrites the message and keeps the original body', async () => {
  const host = makeHost({ roster: [{ id: 'sess-frontend', name: 'frontend', status: 'failed' }] });
  try {
    apply(host.ctx, {});

    const missing = [userMessage('m1', '@小设 画个图标')];
    const first = await host.emitPreStep(missing, keepMessages(missing));
    assert.equal(host.sends.length, 0);
    assert.match(first.messages[0].content[0].text, /还没有入职/);
    assert.match(first.messages[0].content[0].text, /画个图标/);
    assert.equal(first.messages[0].id, 'm1');
    assert.equal(host.nextCalls, 0);

    const failed = [userMessage('m2', '@小前 改空状态')];
    const second = await host.emitPreStep(failed, keepMessages(failed));
    assert.match(second.messages[0].content[0].text, /不可复用/);
    assert.match(second.messages[0].content[0].text, /改空状态/);
  } finally {
    host.dispose();
  }
});

test('a role that is still being hired is reported as starting, not as missing', async () => {
  const host = makeHost({
    config: { autoStart: 'immediate', teamSize: 2 },
    roster: [{ id: 'sess-frontend', name: 'frontend', status: 'provisioning' }],
  });
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 2 });
    const messages = [userMessage('m1', '@小前 改空状态')];
    const decision = await host.emitPreStep(messages, keepMessages(messages));
    const text = decision.messages[0].content[0].text;
    assert.match(text, /正在入职/);
    assert.match(text, /重发/);
    assert.doesNotMatch(text, /还没有入职/);
    assert.equal(host.sends.length, 0);
  } finally {
    host.dispose();
  }
});

test('a roster read failure still runs the downstream waterfall exactly once', async () => {
  const host = makeHost({ listError: new Error('roster unavailable') });
  try {
    apply(host.ctx, {});
    const message = userMessage('m1', '@老后 修接口');
    const messages = [message];
    const decision = await host.emitPreStep(messages, keepMessages(messages));
    assert.equal(host.nextCalls, 1);
    assert.equal(host.sends.length, 0);
    assert.equal(decision.messages[0].content[0].text, '@老后 修接口');
  } finally {
    host.dispose();
  }
});

test('plain prose, unknown names, and disabled routing pass straight through', async () => {
  const host = makeHost({ roster: [{ id: 'sess-backend', name: 'backend' }] });
  try {
    apply(host.ctx, {});
    const texts = ['帮我看下构建', '@查无此人 做事', '＠老后 全角', '@老后'];
    for (const text of texts) {
      const messages = [userMessage(`m-${text}`, text)];
      const before = host.nextCalls;
      const decision = await host.emitPreStep(messages, keepMessages(messages));
      assert.equal(host.nextCalls, before + 1);
      assert.equal(decision.messages[0].content[0].text, text);
      assert.equal(decision.messages[0].source, messages[0].source);
    }
    assert.equal(host.sends.length, 0);
  } finally {
    host.dispose();
  }

  const disabled = makeHost({ roster: [{ id: 'sess-backend', name: 'backend' }] });
  try {
    apply(disabled.ctx, { dispatchPrefix: false });
    const messages = [userMessage('m1', '@老后 修接口')];
    const decision = await disabled.emitPreStep(messages, keepMessages(messages));
    assert.equal(decision.messages[0].content[0].text, '@老后 修接口');
    assert.equal(disabled.sends.length, 0);
    assert.equal(disabled.nextCalls, 1);
  } finally {
    disabled.dispose();
  }
});

test('leadHandsOff denies write and edit per call, and the panel switch is live', async () => {
  const host = makeHost({ config: { leadHandsOff: false }, listAtLoad: true });
  try {
    apply(host.ctx, { leadHandsOff: false });
    assert.equal(host.guardReason('write'), undefined);

    // The Config is volatile: a settings save does not remount the scope.
    host.setSettings({ leadHandsOff: true });
    host.emitDocumentUpdated('work-team');
    // The settings debounce is a timer: wait for the guard to flip, not for 200 ms.
    await until(() => /hands-off mode/.test(String(host.guardReason('write'))), {
      describe: () => String(host.guardReason('write')),
    });
    assert.match(String(host.guardReason('write')), /hands-off mode/);
    assert.match(String(host.guardReason('edit')), /hands-off mode/);
    assert.equal(host.guardReason('read'), undefined);
    assert.equal(host.guardReason('bash'), undefined);
    assert.equal(host.guardReason('team_start'), undefined);

    host.setSettings({ leadHandsOff: false });
    host.emitDocumentUpdated('work-team');
    await until(() => host.guardReason('write') === undefined, {
      describe: () => String(host.guardReason('write')),
    });
    assert.equal(host.guardReason('write'), undefined);
  } finally {
    host.dispose();
  }
});

test('the Lead scope installs the guide and the seven supervision tools', async () => {
  const host = makeHost({ listAtLoad: true });
  try {
    apply(host.ctx, {});
    assert.deepEqual([...host.tools.keys()].sort(), [
      'accept_task',
      'dispatch_tasks',
      'hire_teammate',
      'team_handover',
      'team_recover',
      'team_start',
      'team_status',
    ]);
  } finally {
    host.dispose();
  }
});

test('hire_teammate with a task folds it into the first prompt and skips the onboarding round', async () => {
  const host = makeHost({ listAtLoad: true });
  try {
    apply(host.ctx, {});
    const result = await host.tools.get('hire_teammate').execute(
      { role: 'backend', task: '把 /users 接口的分页修好，验收是 npm test 全绿' },
      { agent: host.lead, signal: new AbortController().signal },
    );
    assert.equal(result.created, true);
    assert.equal(host.spawns.length, 1);
    assert.equal(host.sends.length, 0, 'the task is the first prompt, not a follow-up message');
    const prompt = host.spawns[0].prompt;
    assert.equal(Array.isArray(prompt) && prompt.length, 1, 'prompt stays one text block');
    const text = prompt[0].text;
    assert.match(text, /你是「老后」（团队名 backend）/);
    assert.match(text, /你的第一个任务/);
    assert.match(text, /把 \/users 接口的分页修好，验收是 npm test 全绿/);
    assert.doesNotMatch(text, /已就位/, 'no onboarding line when a task is supplied');
  } finally {
    host.dispose();
  }
});

test('spawn without a task keeps the onboarding first turn', async () => {
  const host = makeHost({ config: { autoStart: 'immediate', teamSize: 2 } });
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 2 });
    await host.emitCreated({ agent: host.lead, source: 'startup' });
    await until(() => host.spawns.length === 2, { describe: () => host.spawns.length });
    for (const spawn of host.spawns) {
      assert.equal(spawn.prompt.length, 1);
      assert.match(spawn.prompt[0].text, /已就位/);
    }
  } finally {
    host.dispose();
  }
});

test('dispatch_tasks fans rows out in parallel and reports each row alone', async () => {
  const host = makeHost({
    listAtLoad: true,
    roster: [
      { id: 'sess-pm', name: 'pm' },
      { id: 'sess-backend', name: 'backend' },
    ],
  });
  try {
    apply(host.ctx, {});

    const allGood = await host.tools.get('dispatch_tasks').execute(
      {
        assignments: [
          { role: 'backend', task: '修 /users 分页' },
          { role: 'be', task: '补 schema 迁移脚本' },
        ],
      },
      { agent: host.lead, signal: new AbortController().signal },
    );
    assert.equal(allGood.sent, 2);
    assert.equal(allGood.failed, 0);
    assert.deepEqual(
      allGood.results.map((row) => row.role),
      ['backend', 'backend'],
      'ids and aliases resolve through roleForName',
    );
    assert.ok(allGood.results.every((row) => row.accepted && row.error === ''));
    assert.ok(allGood.results.every((row) => row.messageId.startsWith('msg-')));

    const mixed = await host.tools.get('dispatch_tasks').execute(
      {
        assignments: [
          { role: 'writer', task: '写公告' },
          { role: 'ghost', task: '查无此人' },
          { role: 'frontend', task: '   ' },
          { role: 'pm', task: '拆需求' },
        ],
      },
      { agent: host.lead, signal: new AbortController().signal },
    );
    assert.equal(mixed.sent, 2);
    assert.equal(mixed.failed, 2);
    assert.deepEqual(
      mixed.results.map((row) => [row.accepted, row.error === '']),
      [
        [true, true],
        [false, false],
        [false, false],
        [true, true],
      ],
    );
    assert.match(mixed.results[1].error, /Unknown Work Team role "ghost"/);
    assert.match(mixed.results[2].error, /Task text is empty/);
    // The unknown and empty rows reached nobody; the accepted rows did.
    assert.deepEqual(
      host.sends.map((send) => send.request.target).sort(),
      ['backend', 'backend', 'pm', 'writer'],
    );

    // A per-row send failure degrades to that row only; peers are unaffected.
    host.setSettings({});
    const failing = makeHost({
      listAtLoad: true,
      roster: [{ id: 'sess-backend', name: 'backend' }],
      sendError: new Error('inbox rejected'),
    });
    try {
      apply(failing.ctx, {});
      const result = await failing.tools.get('dispatch_tasks').execute(
        {
          assignments: [
            { role: 'backend', task: '修接口' },
            { role: 'ghost', task: '查无此人' },
          ],
        },
        { agent: failing.lead, signal: new AbortController().signal },
      );
      assert.equal(result.sent, 0);
      assert.equal(result.failed, 2);
      assert.match(result.results[0].error, /inbox rejected/);
      assert.match(result.results[1].error, /Unknown Work Team role/);
    } finally {
      failing.dispose();
    }
  } finally {
    host.dispose();
  }
});

test('automatic formation keeps two spawns in flight', async () => {
  const host = makeHost({ config: { autoStart: 'immediate', teamSize: 4 }, spawnDelayMs: 25 });
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 4 });
    await host.emitCreated({ agent: host.lead, source: 'startup' });
    // Both workers claim a seat before either spawn resolves, so two requests
    // are open at once; with a serial loop this would always read 1.
    await until(() => host.spawns.length === 2, {
      describe: () => ({ spawns: host.spawns.length, members: host.members.length }),
    });
    assert.equal(host.members.length, 0);
    await until(() => host.spawns.length === 4, { describe: () => host.spawns.length });
    assert.deepEqual(
      host.spawns.map((request) => request.name),
      ['pm', 'frontend', 'backend', 'reviewer'],
      'all four seats fill, in claimed order, with no duplicates',
    );
  } finally {
    host.dispose();
  }
});

test('team_status reports the formation state the Lead needs to supervise', async () => {
  const host = makeHost({ config: { autoStart: 'immediate', teamSize: 2 } });
  try {
    apply(host.ctx, { autoStart: 'immediate', teamSize: 2 });
    await host.emitCreated({ agent: host.lead, source: 'startup' });
    // Formation state, not elapsed time, is the thing being waited for.
    const status = await until(
      async () => {
        const report = await host.tools.get('team_status').execute({}, { agent: host.lead });
        return report.autoStart === 'done' ? report : undefined;
      },
      { describe: () => 'autoStart never reached done' },
    );
    assert.equal(status.autoStart, 'done');
    assert.equal(status.size, 2);

    const off = makeHost({ listAtLoad: true });
    try {
      apply(off.ctx, {});
      const idle = await off.tools.get('team_status').execute({}, { agent: off.lead });
      assert.equal(idle.autoStart, 'off');
      assert.equal(idle.size, 0);
    } finally {
      off.dispose();
    }
  } finally {
    host.dispose();
  }
});

test('a throwing downstream listener is not run a second time', async () => {
  const host = makeHost({ roster: [{ id: 'sess-backend', name: 'backend' }] });
  try {
    apply(host.ctx, {});
    const messages = [userMessage('m1', '帮我看下构建')];
    let calls = 0;
    const boom = async () => {
      calls += 1;
      throw new Error('downstream failed');
    };
    await assert.rejects(() => host.emitPreStep(messages, boom), /downstream failed/);
    assert.equal(calls, 1);
  } finally {
    host.dispose();
  }
});

test('the first @message under first-message mode says starting and still kicks formation', async () => {
  const host = makeHost({ config: { autoStart: 'first-message', teamSize: 2 } });
  try {
    apply(host.ctx, { autoStart: 'first-message', teamSize: 2 });
    await host.emitCreated({ agent: host.lead, source: 'startup' });

    const messages = [userMessage('m1', '@小前 改空状态')];
    const decision = await host.emitPreStep(messages, keepMessages(messages));
    const text = decision.messages[0].content[0].text;
    assert.match(text, /正在入职/);
    assert.match(text, /重发/);
    assert.doesNotMatch(text, /还没有入职/);
    assert.equal(host.sends.length, 0);

    // Routing ran first, but the kick still happened: formation is under way.
    await until(() => host.spawns.length === 2, {
      describe: () => host.spawns.map((request) => request.name),
    });
    assert.deepEqual(
      host.spawns.map((request) => request.name),
      ['pm', 'frontend'],
    );
  } finally {
    host.dispose();
  }
});

test('the worker cap denies subagent calls at the limit, allows under it, and switches off at 0', async () => {
  const full = makeHost({ employee: { name: 'frontend' }, workers: 2, listAtLoad: true });
  try {
    apply(full.ctx, {});
    // The Lead scope must be installed for the isolation assertions below to mean
    // anything; its tools are the proof.
    assert.ok(full.tools.has('team_status'), 'the Lead scope is installed in this fixture');
    assert.match(String(full.employeeGuardReason('subagent')), /临时工已满（当前 2 个，上限 2 个）/);
    assert.match(String(full.employeeGuardReason('subagent_fork')), /临时工已满/);
    // Only the delegation tools are capped; the rest of the employee's tools are untouched.
    assert.equal(full.employeeGuardReason('write'), undefined);
    assert.equal(full.employeeGuardReason('hire_teammate'), undefined);
    // The guard lives on the employee scope (`agent.ctx`), so it must not leak into
    // the Lead: the Lead owns `subagent` itself and would lose it to a global guard.
    assert.equal(full.guardReason('subagent'), undefined);
    assert.equal(full.guardReason('subagent_fork'), undefined);
    assert.equal(full.guardReason('hire_teammate'), undefined);
    // A registry read failure fails open: counting must never block work.
    full.setAgentsListError(new Error('registry unavailable'));
    assert.equal(full.employeeGuardReason('subagent'), undefined);
  } finally {
    full.dispose();
  }

  // One worker plus a user fork of the same employee session: only the delegated
  // child counts, so the cap of 2 still has room.
  const under = makeHost({ employee: { name: 'frontend' }, workers: 1, forkCopies: 1 });
  try {
    apply(under.ctx, {});
    // Both sessions share the parent id; only one carries the delegation marker,
    // so this case really exercises the origin branch instead of passing vacuously.
    const shared = under.ctx.agents
      .list()
      .filter((agent) => agent.session?.header?.parentSession === 'sess-frontend');
    assert.equal(shared.length, 2);
    assert.equal(shared.filter((agent) => agent.session.header.origin === 'subagent').length, 1);
    assert.equal(under.employeeGuardReason('subagent'), undefined);
    assert.equal(under.employeeGuardReason('subagent_fork'), undefined);
  } finally {
    under.dispose();
  }

  const off = makeHost({ employee: { name: 'frontend' }, config: { maxWorkersPerEmployee: 0 } });
  try {
    apply(off.ctx, { maxWorkersPerEmployee: 0 });
    assert.match(String(off.employeeGuardReason('subagent')), /临时工已关闭/);
    assert.match(String(off.employeeGuardReason('subagent_fork')), /临时工已关闭/);
  } finally {
    off.dispose();
  }
});

test('an employee hire at full capacity files exactly one hiring request', async () => {
  const host = makeHost({
    employee: { name: 'frontend' },
    roster: [
      { id: 'sess-pm', name: 'pm' },
      { id: 'sess-backend', name: 'backend' },
      { id: 'sess-reviewer', name: 'reviewer' },
      { id: 'sess-researcher', name: 'researcher' },
      { id: 'sess-designer', name: 'designer' },
      { id: 'sess-ops', name: 'ops' },
    ],
  });
  try {
    apply(host.ctx, {});
    const hire = host.employeeTools.get('hire_teammate');
    assert.ok(hire, 'the employee scope always registers hire_teammate; the guard owns the switch');

    const result = await hire.execute(
      { role: 'writer' },
      { agent: host.employee, signal: new AbortController().signal },
    );
    assert.equal(result.created, false);
    assert.equal(result.status, 'requested');
    assert.equal(result.delivered, 'task', 'the request is a board task, not a private message');
    assert.equal(result.requestId, 'task-1');
    assert.equal(result.name, 'writer');
    assert.equal(host.spawns.length, 0, 'no seat is taken when the team is full');
    assert.equal(host.tasks.length, 1, 'the fallback files one request, not one per attempt');
    assert.equal(host.tasks[0].caller, host.employee);
    assert.match(host.tasks[0].request.subject, /招聘申请：笔笔（writer）/);
    assert.match(host.tasks[0].request.description, /申请人：frontend/);
    assert.match(host.tasks[0].request.description, /团队已满编（7\/7）/);
    assert.deepEqual(host.tasks[0].request.writeScopes, []);
  } finally {
    host.dispose();
  }

  // The Lead branch keeps its hard error: only an employee degrades to a request.
  const boss = makeHost({
    listAtLoad: true,
    roster: [
      { id: 'sess-pm', name: 'pm' },
      { id: 'sess-frontend', name: 'frontend' },
      { id: 'sess-backend', name: 'backend' },
      { id: 'sess-reviewer', name: 'reviewer' },
      { id: 'sess-researcher', name: 'researcher' },
      { id: 'sess-designer', name: 'designer' },
      { id: 'sess-ops', name: 'ops' },
    ],
  });
  try {
    apply(boss.ctx, {});
    await assert.rejects(
      () =>
        boss.tools.get('hire_teammate').execute(
          { role: 'writer' },
          { agent: boss.lead, signal: new AbortController().signal },
        ),
      /at capacity \(7\/7\)/,
    );
    assert.equal(boss.tasks.length, 0);
  } finally {
    boss.dispose();
  }
});

test('an employee hire with a free seat spawns under the Lead and carries an empty requestId', async () => {
  const host = makeHost({
    employee: { name: 'frontend' },
    roster: [{ id: 'sess-pm', name: 'pm' }],
  });
  try {
    apply(host.ctx, {});
    const result = await host.employeeTools.get('hire_teammate').execute(
      { role: 'writer' },
      { agent: host.employee, signal: new AbortController().signal },
    );
    assert.equal(result.created, true);
    assert.equal(result.status, 'inactive');
    assert.equal(result.name, 'writer');
    assert.equal(result.delivered, 'hired', 'a real hire is neither a task nor a message');
    // The output schema requires requestId on every return path, so the success
    // path must spell it out as an empty string rather than omit it.
    assert.equal(result.requestId, '');
    assert.equal(host.tasks.length, 0, 'a real hire files no request');
    assert.equal(host.spawns.length, 1);
    assert.equal(host.spawns[0].name, 'writer');
    // `spawnRole` hires under the root Lead, even when an employee is the caller.
    assert.equal(host.spawns[0].caller, host.lead);
  } finally {
    host.dispose();
  }
});

test('team_status reports the live worker count of each employee', async () => {
  const host = makeHost({
    listAtLoad: true,
    employee: { name: 'frontend' },
    workers: 2,
    // A user fork of the employee session must not be reported as a worker.
    forkCopies: 1,
    roster: [
      { id: 'sess-pm', name: 'pm' },
      { id: 'sess-backend', name: 'backend' },
    ],
  });
  try {
    apply(host.ctx, {});
    const status = await host.tools.get('team_status').execute({}, { agent: host.lead });
    const frontend = status.members.find((member) => member.name === 'frontend');
    assert.equal(typeof frontend.workers, 'number');
    assert.equal(frontend.workers, 2);
    // Three live sessions carry the employee as parent; the user fork is excluded.
    assert.equal(
      host.ctx.agents.list().filter((agent) => agent.session?.header?.parentSession === 'sess-frontend')
        .length,
      3,
    );
    assert.equal(status.members.find((member) => member.name === 'pm').workers, 0);
    assert.equal(status.members.find((member) => member.name === 'backend').workers, 0);

    // A registry failure degrades to 0 instead of failing the whole report.
    host.setAgentsListError(new Error('registry unavailable'));
    const degraded = await host.tools.get('team_status').execute({}, { agent: host.lead });
    assert.equal(degraded.members.find((member) => member.name === 'frontend').workers, 0);
  } finally {
    host.dispose();
  }
});

test('the employee hire switch and the persona text are live, not install-time', async () => {
  const host = makeHost({ employee: { name: 'frontend' }, config: { allowSelfHire: false } });
  try {
    apply(host.ctx, { allowSelfHire: false });

    // The tool stays in the list; the guard is what turns the switch off, so the
    // panel toggle works for an employee who is already on the team.
    assert.ok(host.employeeTools.get('hire_teammate'), 'hire_teammate is registered unconditionally');
    assert.match(String(host.employeeGuardReason('hire_teammate')), /员工自行招人已关闭/);
    assert.match(String(host.employeeGuardReason('hire_teammate')), /request_hire/);
    // Independent switch: a closed hire switch does not cap the temporary workers.
    assert.equal(host.employeeGuardReason('subagent'), undefined);

    const persona = host.employeeSections.find((section) => section.name === 'work-team:persona');
    assert.equal(typeof persona.text, 'function', 'the persona must be evaluated per request');
    assert.match(persona.text(), /request_hire/);
    assert.doesNotMatch(persona.text(), /hire_teammate/);
    // The convergence budget ships by default and quotes the configured number.
    assert.match(persona.text(), /收敛预算/);
    assert.match(persona.text(), /约用 24 次工具调用内交付/);

    // Flip the panel switches: the next evaluation sees the new values without a remount.
    host.setSettings({ allowSelfHire: true, reporting: 'completion', maxWorkersPerEmployee: 3 });
    host.emitDocumentUpdated('work-team');
    await until(
      () =>
        host.employeeGuardReason('hire_teammate') === undefined &&
        /hire_teammate/.test(persona.text()),
      { describe: () => persona.text().slice(0, 200) },
    );
    assert.equal(host.employeeGuardReason('hire_teammate'), undefined);
    assert.match(persona.text(), /hire_teammate/);
    assert.match(persona.text(), /最多同时 3 个/);
    assert.match(persona.text(), /只在任务完成时/);

    // Budget 0 is the documented off switch: the whole section disappears, live.
    host.setSettings({ employeeStepBudget: 0 });
    host.emitDocumentUpdated('work-team');
    await until(() => !/收敛预算/.test(persona.text()), {
      describe: () => persona.text().slice(0, 200),
    });
    assert.doesNotMatch(persona.text(), /收敛预算/);
    host.setSettings({ employeeStepBudget: 40 });
    host.emitDocumentUpdated('work-team');
    await until(() => /约用 40 次工具调用内交付/.test(persona.text()), {
      describe: () => persona.text().slice(0, 200),
    });
    assert.match(persona.text(), /约用 40 次工具调用内交付/);
  } finally {
    host.dispose();
  }
});

test('an untrimmed employee carries the full 101-tool surface', () => {
  const host = makeHost({ employee: { name: 'frontend' }, config: { trimEmployeeTools: false } });
  try {
    apply(host.ctx, { trimEmployeeTools: false });
    const visible = host.employeeVisibleTools();
    // 70 global + 21 preset + 11 own-layer, minus `list_agents` (preset and own):
    // the surface the office panel restores when the switch is off.
    assert.equal(visible.size, 101);
    assert.ok(visible.has('write') && visible.has('edit'));
    assert.ok(visible.has('hire_teammate') && visible.has('request_hire'));
    assert.equal(host.employeeAllowFilters().length, 0, 'no whitelist is registered when the switch is off');
  } finally {
    host.dispose();
  }

  // A read-only role is two lower, and that is the deny layer, not the switch.
  const reviewer = makeHost({ employee: { name: 'reviewer' }, config: { trimEmployeeTools: false } });
  try {
    apply(reviewer.ctx, { trimEmployeeTools: false });
    const visible = reviewer.employeeVisibleTools();
    assert.equal(visible.size, 99);
    assert.ok(!visible.has('write') && !visible.has('edit'));
  } finally {
    reviewer.dispose();
  }
});

test('the unscoped global view cannot see preset-mounted tools', () => {
  // The regression this guards: probing `ctx.tools.get()` instead of letting
  // restrict() validate would drop read / bash / grep from every allow list.
  const host = makeHost({ employee: { name: 'frontend' } });
  try {
    assert.equal(host.ctx.tools.get('read'), undefined);
    assert.equal(host.ctx.tools.get('bash'), undefined);
    assert.equal(host.ctx.tools.get('grep'), undefined);
    assert.notEqual(host.ctx.tools.get('dsh_browser_open'), undefined);
  } finally {
    host.dispose();
  }
});

test('trimEmployeeTools keeps the role tools and never loses a Team tool', () => {
  const host = makeHost({ employee: { name: 'frontend' } });
  try {
    apply(host.ctx, {});
    const visible = host.employeeVisibleTools();
    assert.equal(host.employeeAllowFilters().length, 1, 'one allow filter, not a stack');
    // 22 declared-and-restrictable tools plus the 11 own-layer ones.
    assert.equal(host.employeeAllowFilters()[0].allow.size, 22);
    assert.equal(visible.size, 33);
    // The tools that live in the preset's ancestor layer must survive: an employee
    // that cannot read a file or run a test is useless.
    for (const name of ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'todo_write', 'skill']) {
      assert.ok(visible.has(name), `${name} must stay reachable`);
    }
    // Fatal if missing: reporting, peer messages, and the shared task board.
    for (const name of [
      'send_message',
      'wait_agent',
      'list_agents',
      'team_task_create',
      'team_task_get',
      'team_task_list',
      'team_task_update',
    ]) {
      assert.ok(visible.has(name), `${name} must stay reachable`);
    }
    // The role's own craft tools survive; unrelated plugin surfaces do not.
    for (const name of ['subagent', 'dsh_browser_snapshot', 'render_ui']) {
      assert.ok(visible.has(name), `${name} belongs to frontend`);
    }
    for (const name of ['schedule_create', 'plugin_manager', 'visualize', 'terminal_open', 'anysearch_search']) {
      assert.ok(!visible.has(name), `${name} is not frontend's job`);
    }
    assert.ok(visible.has('hire_teammate') && visible.has('request_hire'));
  } finally {
    host.dispose();
  }
});

test('the allow list never names an own-layer tool', () => {
  // Own-layer names make restrict() throw, so they must be filtered out before
  // the call; they stay visible through the scope's own registrations.
  const expectations = [
    { name: 'pm', allow: 14, visible: 25 },
    { name: 'reviewer', allow: 9, visible: 20 },
  ];
  for (const { name, allow, visible } of expectations) {
    const host = makeHost({ employee: { name } });
    try {
      apply(host.ctx, {});
      assert.equal(host.employeeAllowFilters().length, 1, name);
      assert.equal(host.employeeAllowFilters()[0].allow.size, allow, `${name} allow length`);
      assert.equal(host.employeeVisibleTools().size, visible, `${name} visible count`);
      for (const own of ['send_message', 'wait_agent', 'team_task_update', 'hire_teammate', 'request_hire']) {
        assert.ok(!host.employeeAllowFilters()[0].allow.has(own), `${name} must not name ${own}`);
        assert.ok(host.employeeVisibleTools().has(own), `${name} must still see ${own}`);
      }
      assert.ok(host.employeeVisibleTools().has('read'), `${name} keeps read`);
      assert.ok(host.employeeVisibleTools().has('bash'), `${name} keeps bash`);
    } finally {
      host.dispose();
    }
  }
});

test('a zero worker cap also leaves delegation out of the whitelist', () => {
  const host = makeHost({ employee: { name: 'backend' }, config: { maxWorkersPerEmployee: 0 } });
  try {
    apply(host.ctx, { maxWorkersPerEmployee: 0 });
    const visible = host.employeeVisibleTools();
    assert.ok(!visible.has('subagent'));
    assert.ok(!visible.has('subagent_fork'));
    assert.ok(visible.has('terminal_open') && visible.has('job_list'), 'the rest of the role survives');
  } finally {
    host.dispose();
  }
});

test('the trim switch is live: off restores 101, on trims again, and filters never stack', async () => {
  const host = makeHost({ employee: { name: 'frontend' } });
  try {
    apply(host.ctx, {});
    const trimmed = host.employeeVisibleTools().size;
    assert.equal(trimmed, 33);

    // Panel off: the allow filter must be disposed, not layered under a new one.
    host.setSettings({ trimEmployeeTools: false });
    host.emitDocumentUpdated('work-team');
    await until(() => host.employeeAllowFilters().length === 0, {
      describe: () => host.employeeAllowFilters().length,
    });
    assert.equal(host.employeeAllowFilters().length, 0, 'the whitelist is lifted, not intersected away');
    assert.equal(host.employeeVisibleTools().size, 101);

    // Panel on again: back to exactly the same surface, not a shrinking one.
    host.setSettings({ trimEmployeeTools: true });
    host.emitDocumentUpdated('work-team');
    await until(
      () => host.employeeAllowFilters().length === 1 && host.employeeVisibleTools().size === trimmed,
      { describe: () => host.employeeAllowFilters().length },
    );
    assert.equal(host.employeeAllowFilters().length, 1);
    assert.equal(host.employeeVisibleTools().size, trimmed);

    // A save that does not move the list must not churn the registry.
    const settled = host.employeeAllowFilters()[0];
    host.setSettings({ reporting: 'completion' });
    host.emitDocumentUpdated('work-team');
    await delay(200);
    assert.equal(host.employeeAllowFilters()[0], settled, 'unchanged list is not re-registered');
    assert.equal(host.employeeVisibleTools().size, trimmed);
  } finally {
    host.dispose();
  }
});

test('ten switch flips register exactly one filter per flip and never stack', async () => {
  const host = makeHost({ employee: { name: 'frontend' } });
  try {
    apply(host.ctx, {});
    const trimmed = host.employeeVisibleTools().size;
    const afterInstall = host.restrictions.length;
    assert.equal(host.employeeAllowFilters().length, 1);

    for (let flip = 0; flip < 10; flip += 1) {
      const on = flip % 2 === 0; // the first flip turns it off
      host.setSettings({ trimEmployeeTools: !on });
      host.emitDocumentUpdated('work-team');
      // Each flip lands on its own timer; wait for that flip's answer.
      await until(
        () => host.employeeAllowFilters().length === (on ? 0 : 1),
        { describe: () => host.employeeAllowFilters().length },
      );
      assert.equal(
        host.employeeAllowFilters().length,
        on ? 0 : 1,
        `flip ${flip + 1}: active filters must be ${on ? 0 : 1}`,
      );
      assert.equal(host.employeeVisibleTools().size, on ? 101 : trimmed);
    }

    // One restrict() per re-enable (five of the ten flips), none per disable:
    // switching off only lifts the filter, and nothing re-registers twice.
    assert.equal(host.restrictions.length - afterInstall, 5);
    const settled = host.employeeAllowFilters()[0];
    host.setSettings({ reporting: 'completion' });
    host.emitDocumentUpdated('work-team');
    await delay(160);
    assert.equal(host.restrictions.length - afterInstall, 5, 'an unrelated save must not re-register');
    assert.equal(host.employeeAllowFilters()[0], settled);
  } finally {
    host.dispose();
  }
});

test('a tool this machine does not have is dropped instead of failing the whitelist', () => {
  // `validate_dsh_ui` is declared for frontend but absent here: the first
  // restrict() rejects it, the retry installs the rest, and the employee keeps
  // its persona and hire tools.
  const host = makeHost({ employee: { name: 'frontend' }, absentTools: ['validate_dsh_ui'] });
  try {
    apply(host.ctx, {});
    assert.equal(host.employeeAllowFilters().length, 1, 'the filter still installs');
    assert.equal(host.employeeAllowFilters()[0].allow.size, 21);
    assert.ok(!host.employeeAllowFilters()[0].allow.has('validate_dsh_ui'));
    assert.equal(host.employeeVisibleTools().size, 32);
    const persona = host.employeeSections.find((section) => section.name === 'work-team:persona');
    assert.ok(persona);
    assert.ok(host.employeeTools.get('request_hire'));
  } finally {
    host.dispose();
  }
});

test('a whitelist with nothing left degrades to untrimmed instead of taking the employee down', () => {
  const absentTools = ['read', 'glob', 'grep', 'bash', 'todo_write', 'skill', 'present', 'subagent', 'subagent_fork'];
  // The same fixture with the switch off is the reference for "untrimmed": the
  // degraded path must leave exactly that surface, not an empty one.
  const reference = makeHost({ employee: { name: 'reviewer' }, absentTools, config: { trimEmployeeTools: false } });
  let untrimmed;
  try {
    apply(reference.ctx, { trimEmployeeTools: false });
    untrimmed = reference.employeeVisibleTools().size;
  } finally {
    reference.dispose();
  }

  const host = makeHost({ employee: { name: 'reviewer' }, absentTools });
  try {
    apply(host.ctx, {});
    assert.equal(host.employeeAllowFilters().length, 0, 'no empty allow filter is registered');
    const persona = host.employeeSections.find((section) => section.name === 'work-team:persona');
    assert.ok(persona, 'the persona must survive a rejected whitelist');
    assert.ok(host.employeeTools.get('request_hire'));
    assert.ok(host.employeeTools.get('hire_teammate'));
    assert.equal(host.employeeGuardReason('subagent'), undefined);
    assert.equal(host.employeeVisibleTools().size, untrimmed, 'the employee stays untrimmed, not emptied');
  } finally {
    host.dispose();
  }
});

test('a degraded whitelist is not re-registered by an unrelated save', async () => {
  const host = makeHost({ employee: { name: 'frontend' }, absentTools: ['validate_dsh_ui'] });
  try {
    apply(host.ctx, {});
    const settled = host.employeeAllowFilters()[0];
    const afterInstall = host.restrictions.length;
    host.setSettings({ reporting: 'completion' });
    host.emitDocumentUpdated('work-team');
    await delay(200);
    assert.equal(host.employeeAllowFilters()[0], settled);
    assert.equal(host.restrictions.length, afterInstall);
    assert.equal(host.employeeVisibleTools().size, 32);
  } finally {
    host.dispose();
  }
});

/*
 * The Session-level Team switch (0.2.2).
 *
 * A new Session starts with Agent Teams off: `createTask` and `listTasks` throw
 * TEAM_DISABLED until the root's Session log carries `team/mode`. The plugin has
 * to open that switch before it touches the board, and it has to leave the switch
 * alone when the user closed it on purpose.
 */

test('team_status opens a fresh Session board once and reports it as on', async () => {
  const host = makeHost({ roster: [{ id: 'sess-pm', name: 'pm' }] });
  try {
    apply(host.ctx, {});
    await host.emitCreated({ agent: host.lead, source: 'created' });
    assert.equal(host.boardEnabled, false, 'a new Session starts with the board closed');

    const status = await host.tools.get('team_status').execute({}, { agent: host.lead });
    assert.equal(host.boardWrites.length, 1, 'one switch write, not one per board read');
    assert.equal(host.boardWrites[0].caller, host.lead);
    assert.equal(host.boardWrites[0].enabled, true);
    assert.equal(status.taskBoard, 'on');
    assert.equal(status.note, '', 'an open board needs no hint');
    assert.deepEqual(status.tasks, { pending: 0, inProgress: 0, completed: 0 });
    assert.equal(status.size, 1);

    // Idempotence: once open, later reads neither rewrite the switch nor warn.
    await host.tools.get('team_status').execute({}, { agent: host.lead });
    assert.equal(host.boardWrites.length, 1);
    assert.deepEqual(host.warnings, []);
  } finally {
    host.dispose();
  }
});

test('a board the user switched off is reported, not overridden', async () => {
  const host = makeHost({ teamState: { enabled: false } });
  try {
    apply(host.ctx, {});
    await host.emitCreated({ agent: host.lead, source: 'created' });
    const status = await host.tools.get('team_status').execute({}, { agent: host.lead });

    assert.equal(host.boardWrites.length, 0, 'explicit off is the user\'s answer, never rewritten');
    assert.equal(status.taskBoard, 'off');
    assert.match(status.note, /Agent Teams/);
    assert.equal(status.size, 0, 'the roster half of the report still works');
    assert.deepEqual(status.tasks, { pending: 0, inProgress: 0, completed: 0 });
    assert.deepEqual(host.warnings, [], 'a user choice is a state, not a fault');
  } finally {
    host.dispose();
  }
});

test('a board that will not open still produces a full team_status', async () => {
  const host = makeHost({
    roster: [{ id: 'sess-backend', name: 'backend' }],
    boardError: new Error('session is closing'),
  });
  try {
    apply(host.ctx, {});
    await host.emitCreated({ agent: host.lead, source: 'created' });
    const status = await host.tools.get('team_status').execute({}, { agent: host.lead });

    assert.equal(status.taskBoard, 'unavailable');
    assert.equal(status.size, 1, 'a broken board must not take the roster report down');
    assert.equal(status.members[0].name, 'backend');
    assert.match(status.note, /could not be opened/);
    assert.ok(
      host.warnings.some((line) => /task board could not be opened/.test(line)),
      `expected one board warning, got ${JSON.stringify(host.warnings)}`,
    );

    // One diagnostic per Session, however many tools try to open the board.
    await host.tools.get('team_status').execute({}, { agent: host.lead });
    assert.equal(
      host.warnings.filter((line) => /task board could not be opened/.test(line)).length,
      1,
    );
  } finally {
    host.dispose();
  }
});

test('a hiring request reaches the Lead as a message when the board cannot open', async () => {
  const host = makeHost({
    employee: { name: 'frontend' },
    roster: [{ id: 'sess-backend', name: 'backend' }],
    boardError: new Error('team mode is locked'),
  });
  try {
    apply(host.ctx, { teamSize: 1 });
    const result = await host.employeeTools.get('hire_teammate').execute(
      { role: 'writer' },
      { agent: host.employee, signal: new AbortController().signal },
    );

    assert.equal(result.created, false);
    assert.equal(result.status, 'requested');
    assert.equal(result.delivered, 'message', 'the request reached the Lead as a message');
    assert.equal(result.requestId, '', 'no board task exists to point at');
    assert.equal(host.tasks.length, 0, 'nothing is filed on a closed board');
    assert.equal(host.sends.length, 1, 'the request still leaves the employee');
    // The employee is the sender: the root has no inbox of its own, and `lead` is
    // a target name the bridge resolves to the root.
    assert.equal(host.sends[0].caller, host.employee);
    assert.equal(host.sends[0].request.target, 'lead');
    assert.match(host.sends[0].request.content[0].text, /招聘申请：笔笔（writer）/);
    assert.match(host.sends[0].request.content[0].text, /申请人：frontend/);
  } finally {
    host.dispose();
  }
});

/*
 * 0.2.2 on the Host side: the tree topology, the switch, and a board that stays
 * closed. The fixture's legacy shape exercises the same code through the Team
 * service branch, so these are the cases that prove the tree branch is not dead.
 */

test('on the tree topology team_status opens the board from the root, exactly once', async () => {
  const host = makeHost({ treeTopology: true, roster: [{ id: 'sess-pm', name: 'pm' }] });
  try {
    apply(host.ctx, {});
    await host.emitCreated({ agent: host.lead, source: 'created' });

    const status = await host.tools.get('team_status').execute({}, { agent: host.lead });
    assert.equal(host.boardWrites.length, 1, 'one switch write for the first read');
    assert.equal(host.boardWrites[0].caller, host.lead, 'only the root may move the switch');
    assert.equal(host.boardWrites[0].enabled, true);
    assert.equal(status.taskBoard, 'on');
    assert.deepEqual(
      status.members.map((member) => member.name),
      ['pm'],
      'the roster still comes from the tree catalog',
    );
  } finally {
    host.dispose();
  }
});

test('a block-mode hire refusal keeps its full receipt shape on this fixture too', async () => {
  const host = makeHost({
    listAtLoad: true,
    roster: [{ id: 'sess-pm', name: 'pm' }],
    tokens: { 'sess-lead': { uncachedInputTokens: 500 } },
  });
  try {
    apply(host.ctx, { teamTokenBudget: 100, tokenBudgetOnExceed: 'block' });
    const receipt = await host.tools.get('hire_teammate').execute(
      { role: 'backend' },
      { agent: host.lead, signal: new AbortController().signal },
    );
    assert.equal(receipt.accepted, false);
    assert.equal(receipt.delivered, 'refused');
    assert.equal(receipt.created, false);
    assert.equal(host.spawns.length, 0);
    // The hire refusal is the path that carries `budgetRefusal().budget` straight
    // through, so every required field has to be here — a 4-field budget used to
    // reach the model as a ToolOutputError instead of an actionable refusal.
    assert.deepEqual(receipt.budget, {
      used: 500,
      limit: 100,
      mode: 'block',
      exceeded: true,
      unknown: 1,
      note: '1 个成员的会话没有加载，未计入用量；实际已用可能更高（预算上限按 100 计）。',
    });
    assert.equal(receipt.actions.length, 3);
  } finally {
    host.dispose();
  }
});

test('concurrent board touches in one step share a single switch write', async () => {
  const host = makeHost({ treeTopology: true, roster: [{ id: 'sess-pm', name: 'pm' }] });
  try {
    apply(host.ctx, {});
    await host.emitCreated({ agent: host.lead, source: 'created' });

    // Read-then-write is not atomic in the kernel: without coalescing both tools
    // append their own team/mode event and flush twice.
    const [status, dispatch] = await Promise.all([
      host.tools.get('team_status').execute({}, { agent: host.lead }),
      host
        .tools.get('dispatch_tasks')
        .execute({ assignments: [] }, { agent: host.lead, signal: new AbortController().signal }),
    ]);

    assert.equal(host.boardWrites.length, 1, 'one open per Session, however many tools ask');
    assert.equal(status.taskBoard, 'on');
    assert.deepEqual(dispatch, {
      accepted: true,
      results: [],
      sent: 0,
      failed: 0,
      // `pm` is on the roster but has no live Agent in this fixture, so its usage
      // cannot be read: the budget says so instead of calling it zero.
      budget: {
        used: 0,
        limit: 0,
        mode: 'warn',
        exceeded: false,
        unknown: 1,
        note: '1 个成员的会话没有加载，未计入用量；实际已用可能更高（预算上限按 不限 计）。',
      },
      actions: [],
    });
  } finally {
    host.dispose();
  }
});

test('a board with no Session switch still files hiring requests as tasks', async () => {
  // The 0.2.1 shape: no isEnabled/setEnabled, and a board that always answers.
  // Degrading this to a private message would change 0.2.1 behaviour for nothing.
  const host = makeHost({
    boardSwitch: false,
    employee: { name: 'frontend' },
    roster: [
      { id: 'sess-pm', name: 'pm' },
      { id: 'sess-backend', name: 'backend' },
      { id: 'sess-reviewer', name: 'reviewer' },
      { id: 'sess-researcher', name: 'researcher' },
      { id: 'sess-designer', name: 'designer' },
      { id: 'sess-ops', name: 'ops' },
    ],
  });
  try {
    apply(host.ctx, {});
    const result = await host.employeeTools.get('hire_teammate').execute(
      { role: 'writer' },
      { agent: host.employee, signal: new AbortController().signal },
    );

    assert.equal(result.created, false);
    assert.equal(result.delivered, 'task');
    assert.equal(result.requestId, 'task-1');
    assert.equal(host.tasks.length, 1, 'the request lands on the board');
    assert.equal(host.sends.length, 0, 'and never becomes a private message');
    assert.equal(host.boardWrites.length, 0, 'there is no switch to write');
  } finally {
    host.dispose();
  }
});

test('a degraded hire request is addressed from the employee to the root Session', async () => {
  const host = makeHost({
    treeTopology: true,
    employee: { name: 'frontend' },
    roster: [
      { id: 'sess-pm', name: 'pm' },
      { id: 'sess-backend', name: 'backend' },
      { id: 'sess-reviewer', name: 'reviewer' },
      { id: 'sess-researcher', name: 'researcher' },
      { id: 'sess-designer', name: 'designer' },
      { id: 'sess-ops', name: 'ops' },
    ],
    boardError: new Error('team mode is locked'),
  });
  try {
    apply(host.ctx, {});
    await host.emitCreated({ agent: host.lead, source: 'created' });
    const result = await host.employeeTools.get('hire_teammate').execute(
      { role: 'writer' },
      { agent: host.employee, signal: new AbortController().signal },
    );

    assert.equal(result.delivered, 'message');
    assert.equal(host.treeSends.length, 1, 'the tree service delivers, not the legacy one');
    assert.equal(host.treeSends[0].sender, host.employee, 'a root cannot address itself');
    assert.equal(host.treeSends[0].targetId, host.lead.id, 'the root is a Session id, not a name');
    assert.equal(host.sends.length, 0);
    assert.ok(host.treeSends[0].options.signal instanceof AbortSignal, 'the tree send is cancellable');
    assert.match(host.treeSends[0].content[0].text, /招聘申请：笔笔（writer）/);
    assert.match(host.treeSends[0].content[0].text, /申请人：frontend/);
  } finally {
    host.dispose();
  }
});

test('request_hire reports the same delivered value as the board it filed on', async () => {
  const host = makeHost({ employee: { name: 'frontend' } });
  try {
    apply(host.ctx, {});
    const result = await host.employeeTools.get('request_hire').execute(
      { role: 'writer', reason: '需要一个文案' },
      { agent: host.employee, signal: new AbortController().signal },
    );
    assert.equal(result.delivered, 'task');
    assert.equal(result.taskId, 'task-1');
    assert.match(result.subject, /招聘申请：笔笔（writer）/);
    assert.equal(host.tasks.length, 1);
    assert.match(host.tasks[0].request.description, /理由：需要一个文案/);
  } finally {
    host.dispose();
  }
});

test('only the exact gate sentence is read as a closed board', async () => {
  // The gate's refusal and a UI hint can both start with "enable Agent Teams for
  // this Session"; a fragment match would file a real read failure as a user
  // choice and silently report an empty board.
  const host = makeHost({
    listTasksError: new Error('enable Agent Teams for this Session before using the board editor'),
  });
  try {
    apply(host.ctx, {});
    await host.emitCreated({ agent: host.lead, source: 'created' });
    const status = await host.tools.get('team_status').execute({}, { agent: host.lead });

    assert.equal(status.taskBoard, 'unavailable');
    assert.ok(
      host.warnings.some((line) => /could not read the shared task board/.test(line)),
      `expected a read failure to be reported, got ${JSON.stringify(host.warnings)}`,
    );
  } finally {
    host.dispose();
  }
});
