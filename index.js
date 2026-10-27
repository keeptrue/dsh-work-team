/**
 * Work Team Host half.
 *
 * The durable roster, shared task board, and peer messaging belong to
 * `@deepseek-ai/dsh-experimental-agent-team`. This plugin adds the product
 * layer: built-in role identities, per-role models, a boss guide, hiring tools,
 * and a capacity guard. It never owns child Agents; it only contributes
 * agent-scoped prompt/tool registrations and applies model selections.
 */

import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';

import {
  DEFAULT_LINEUP,
  MAX_TEAM_SIZE,
  ROLES,
  roleById,
  roleForName,
} from './lib/roles.js';
import {
  buildBossGuide,
  buildEmployeePersona,
  onboardingText,
} from './lib/personas.js';
import {
  clampTeamSize,
  formatModelSpec,
  parseModelSpec,
  sameSelection,
  sumTokenTotals,
} from './lib/models.js';
import {
  autoStartIsActive,
  handsOffReason,
  normalizeAutoStart,
  planAutoStartLineup,
  shouldAutoStart,
} from './lib/autostart.js';
import {
  buildDispatchFallback,
  buildDispatchReceipt,
  buildDispatchSendFailure,
  parseDispatch,
  resolveDispatchRole,
} from './lib/dispatch.js';
import { OWN_LAYER_TOOLS, employeeAllowList } from './lib/toolset.js';

/** Cordis plugin name. */
export const name = 'work-team';

/** Host services this plugin cannot work without. */
export const inject = [
  'agentTeams',
  'agents',
  'llm',
  'sessionController',
  'sessionProjections',
  'tools',
];

/** Hard ceiling for `maxWorkersPerEmployee`; mirrors the office panel's select. */
const MAX_WORKERS = 4;

/** Teammate spawns kept in flight at once during automatic formation. */
const FORMATION_CONCURRENCY = 2;

/** Default temporary-worker cap for one employee. */
const DEFAULT_MAX_WORKERS = 2;

/** Soft tool-call budget handed to one employee per task; 0 disables the guidance. */
const DEFAULT_STEP_BUDGET = 24;

/** Hard ceiling for `employeeStepBudget`. */
const MAX_STEP_BUDGET = 60;

/** Plugin configuration. All product knobs are volatile so Settings can edit them. */
export const Config = z.object({
  teamSize: z.number().step(1).min(1).max(MAX_TEAM_SIZE).default(DEFAULT_LINEUP.length).volatile(),
  reporting: z.string().default('milestones').volatile(),
  allowSelfHire: z.boolean().default(true).volatile(),
  maxWorkersPerEmployee: z.number().step(1).min(0).max(MAX_WORKERS).default(DEFAULT_MAX_WORKERS).volatile(),
  trimEmployeeTools: z.boolean().default(true).volatile(),
  employeeStepBudget: z.number().step(1).min(0).max(MAX_STEP_BUDGET).default(DEFAULT_STEP_BUDGET).volatile(),
  autoStart: z.string().default('off').volatile(),
  dispatchPrefix: z.boolean().default(true).volatile(),
  leadHandsOff: z.boolean().default(false).volatile(),
  modelPm: z.string().default('').volatile(),
  modelFrontend: z.string().default('').volatile(),
  modelBackend: z.string().default('').volatile(),
  modelReviewer: z.string().default('').volatile(),
  modelResearcher: z.string().default('').volatile(),
  modelDesigner: z.string().default('').volatile(),
  modelOps: z.string().default('').volatile(),
  modelWriter: z.string().default('').volatile(),
});

const ENTRY_ID = 'work-team';

/**
 * Normalize the per-employee temporary-worker cap.
 *
 * The Settings document is raw and a hand-edited bundle patch can spell the value
 * as text, so clamp to a whole number in [0, MAX_WORKERS] here instead of trusting
 * the schema. A blank or unparsable value falls back to the default; an explicit
 * 0 is kept, because 0 is the documented "workers off" switch.
 *
 * @param {unknown} value - raw Config value.
 * @returns {number} usable cap.
 */
function clampWorkerLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_MAX_WORKERS;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_MAX_WORKERS;
  return Math.min(Math.max(Math.trunc(number), 0), MAX_WORKERS);
}

/**
 * Normalize the per-task soft tool-call budget.
 *
 * Whole number in [0, MAX_STEP_BUDGET]; an explicit 0 is kept, because 0 is the
 * documented switch that omits the convergence-budget persona section.
 *
 * The blank reading is deliberately stricter than `clampWorkerLimit`: a
 * whitespace-only string means "not configured" and falls back to the default,
 * because `Number('   ')` is 0 and a mis-typed blank would otherwise silently
 * turn the guidance off. Junk (`'bogus'`) falls back the same way.
 * @param {unknown} value - raw Config value.
 * @returns {number} usable budget.
 */
function clampStepBudget(value) {
  if (value === undefined || value === null) return DEFAULT_STEP_BUDGET;
  if (typeof value === 'string' && value.trim() === '') return DEFAULT_STEP_BUDGET;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_STEP_BUDGET;
  return Math.min(Math.max(Math.trunc(number), 0), MAX_STEP_BUDGET);
}

/**
 * Normalize raw Config into the plain object every tool and level reads.
 * Exported so the tests can assert that no Config field is dropped here.
 * @param {unknown} config - raw Config reference.
 * @returns {object} normalized config snapshot.
 */
export function configSnapshot(config) {
  const snapshot = {
    teamSize: clampTeamSize(config.teamSize, DEFAULT_LINEUP.length, MAX_TEAM_SIZE),
    reporting: typeof config.reporting === 'string' ? config.reporting : 'milestones',
    // Same default-true reading as `dispatchPrefix`: only an explicit false opts out,
    // so a raw Config missing the key still matches the schema default.
    allowSelfHire: config.allowSelfHire !== false,
    maxWorkersPerEmployee: clampWorkerLimit(config.maxWorkersPerEmployee),
    // Same default-true reading as `allowSelfHire`: only an explicit false opts
    // out, so a settings document written before this switch existed still trims.
    trimEmployeeTools: config.trimEmployeeTools !== false,
    // A blank or unparsable value falls back to the default; an explicit 0 is the
    // documented "no budget guidance" switch, mirroring `clampWorkerLimit`.
    employeeStepBudget: clampStepBudget(config.employeeStepBudget),
    autoStart: normalizeAutoStart(config.autoStart),
    dispatchPrefix: config.dispatchPrefix !== false,
    leadHandsOff: config.leadHandsOff === true,
  };
  for (const role of ROLES) {
    snapshot[role.modelField] = typeof config[role.modelField] === 'string' ? config[role.modelField] : '';
  }
  return snapshot;
}

/** @param {object} ctx - Host context. @param {string} message - diagnostic. */
function warn(ctx, message) {
  try {
    if (typeof ctx.logger?.warn === 'function') {
      ctx.logger.warn(`[work-team] ${message}`);
      return;
    }
  } catch {
    // logging must never break a turn
  }
  console.warn(`[work-team] ${message}`);
}

/** @param {unknown} error - thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Flatten a message's text blocks the way the model will see them.
 * @param {{ content?: unknown } | undefined} message - UserMessage-like value.
 * @returns {string} concatenated text.
 */
function contentText(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  let text = '';
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') text += block.text;
  }
  return text;
}

/**
 * Every non-text block of a message, in order: images, files, and anything else a
 * later plugin adds. They are carried verbatim through forwarding and rewriting.
 * @param {{ content?: unknown } | undefined} message - UserMessage-like value.
 * @returns {object[]} non-text content blocks.
 */
function nonTextBlocks(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks.filter((block) => block !== null && typeof block === 'object' && block.type !== 'text');
}

/**
 * Remember one routed message id so a later re-offer of the same message is not
 * forwarded twice. Only delivered (or deliberately degraded) messages are marked;
 * a failed forward must stay visible to the Lead instead of being swallowed.
 * @param {object} state - plugin state.
 * @param {string} id - message id.
 */
function rememberDispatch(state, id) {
  if (typeof id !== 'string' || id === '') return;
  state.dispatched.add(id);
  if (state.dispatched.size <= 512) return;
  const oldest = state.dispatched.values().next().value;
  if (oldest !== undefined) state.dispatched.delete(oldest);
}

/**
 * @param {object} ctx - Host context.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 * @returns {object[]} teammate rows, excluding the implicit Lead row.
 */
function teammatesOf(ctx, lead) {
  return ctx.agentTeams.listMembers(lead).filter((member) => member.role === 'teammate');
}

/**
 * Live one-off children an employee owns right now.
 *
 * The child's session header records its durable direct parent, and the subagent
 * package disposes a local child once its run settles, so this list is the
 * in-flight set: a finished worker drops out of it.
 *
 * The `origin` check is load-bearing, not redundant: a session the user forked
 * from the employee carries the same `parentSession` but no `origin: 'subagent'`
 * (that value is the header's only one, written by `childSessionMeta` for both
 * `subagent` and `subagent_fork` children). Such a fork never disposes on its
 * own, so counting it would burn one worker slot forever.
 *
 * @param {object} ctx - Host context.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - employee Agent.
 * @returns {object[]} live child Agents.
 */
function liveChildrenOf(ctx, agent) {
  return ctx.agents.list().filter(
    (child) =>
      child.session?.header?.parentSession === agent.id &&
      child.session?.header?.origin === 'subagent',
  );
}

/**
 * Per-call gate for the two employee switches that must stay live.
 *
 * It owns both of them, in this order:
 * 1. `allowSelfHire` — the employee `hire_teammate` stays registered so the tool
 *    list never changes under a running session, and the call is denied here
 *    while the switch is off (the same "tool stays, the call is refused" pattern
 *    the Lead's hands-off guard uses).
 * 2. `maxWorkersPerEmployee` — the temporary-worker cap.
 *
 * Both read the volatile Config on every call, so a settings save takes effect on
 * the next call without reinstalling the scope. A registry read failure fails
 * open: counting must never stop an employee from working.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - employee Agent.
 * @param {unknown} toolName - tool about to run.
 * @returns {string | undefined} denial reason, or undefined to allow the call.
 */
function employeeDenialReason(ctx, state, agent, toolName) {
  if (toolName === 'hire_teammate') {
    // The snapshot always spells this as a boolean, so `!== false` is only
    // defensive consistency with `configSnapshot` / `dispatchPrefix`: a missing
    // value must not silently close a switch the schema defaults to on.
    if (state.config.allowSelfHire !== false) return undefined;
    return '员工自行招人已关闭：设置里「员工可自行招人」是关的。缺角色用 request_hire 建招聘申请，由 lead 拍板。';
  }
  if (toolName !== 'subagent' && toolName !== 'subagent_fork') return undefined;
  // The snapshot always carries a number; keep the fallback so a partially built
  // state can never deny with "上限 undefined" in the model-facing text.
  const configured = state.config.maxWorkersPerEmployee;
  const limit = Number.isFinite(configured) ? configured : DEFAULT_MAX_WORKERS;
  if (limit <= 0) {
    return '临时工已关闭（上限 0 个）：设置里「临时工上限」是 0，你自己开不了子 agent。这类并行活自己串行做完；确实需要人手，就按汇报节奏告诉 lead。';
  }
  let running;
  try {
    running = liveChildrenOf(ctx, agent).length;
  } catch {
    return undefined;
  }
  if (running < limit) return undefined;
  return `临时工已满（当前 ${running} 个，上限 ${limit} 个）：等跑完的收完结果再开新的，或把活并进同一批交给一个临时工；确实需要更高并发，就让用户在办公室面板里调高「临时工上限」。`;
}

/**
 * @param {object} ctx - Host context.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - live Agent.
 * @returns {{ provider: string, model: string, reasoningEffort?: string } | undefined}
 *   the model the Agent's next request will use.
 */
function currentSelection(ctx, agent) {
  try {
    const state = ctx.sessionProjections.stateOf(agent.session, 'modelSelection');
    const picked = state?.pending ?? state?.lastUsed;
    if (picked === undefined || picked === null) return undefined;
    return {
      provider: picked.provider,
      model: picked.model,
      ...(picked.reasoningEffort === undefined || picked.reasoningEffort === ''
        ? {}
        : { reasoningEffort: picked.reasoningEffort }),
    };
  } catch {
    return undefined;
  }
}

/**
 * @param {object} ctx - Host context.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 * @param {object} role - role definition.
 * @param {object} config - resolved Work Team config.
 * @returns {{ provider: string, model: string, reasoningEffort?: string } | undefined}
 *   configured model, or the Lead's current model when the field is empty.
 */
function desiredSelection(ctx, lead, role, config) {
  const configured = parseModelSpec(config[role.modelField]);
  return configured ?? currentSelection(ctx, lead);
}

/**
 * Queue one model-selection operation on the single global chain.
 *
 * Every apply appends a `model/selection` event and then relies on the
 * `modelSelection` projection to see it. Running two applies at once would
 * interleave those appends with the reads, so one employee's sync could append a
 * second identical selection while another employee's is still in flight.
 *
 * @param {object} state - plugin state.
 * @param {() => Promise<void>} operation - queued work.
 * @returns {Promise<void>} settlement of this operation.
 */
function enqueueModel(state, operation) {
  const run = state.modelQueue.then(operation, operation);
  state.modelQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Validate one configured route through the public LLM service.
 *
 * The selection registry writes what it is given, so validation has to happen
 * here: `resolveCallConfig` rejects an unknown provider/model pair and fills in
 * the adapter's default reasoning effort. That defaulting is why the caller
 * compares the RESOLVED route with the projection — comparing the configured one
 * would append the same selection again on every sync.
 *
 * `maxTokens` and every other request control the resolver may materialize are
 * dropped: a model selection is a route, not a request.
 *
 * @param {object} ctx - Host context.
 * @param {{ provider: string, model: string, reasoningEffort?: string }} desired - configured route.
 * @returns {Promise<{ provider: string, model: string, reasoningEffort?: string } | undefined>}
 *   the resolved route, or undefined when the LLM service is not mounted.
 */
async function resolveRoute(ctx, desired) {
  let llm;
  try {
    llm = ctx.get('llm');
  } catch {
    return undefined;
  }
  if (llm === undefined || llm === null || typeof llm.resolveCallConfig !== 'function') return undefined;
  const resolved = await llm.resolveCallConfig({
    provider: desired.provider,
    model: desired.model,
    ...(desired.reasoningEffort === undefined ? {} : { reasoningEffort: desired.reasoningEffort }),
  });
  if (resolved === undefined || resolved === null) {
    throw new Error('llm service returned no route');
  }
  if (typeof resolved.provider !== 'string' || resolved.provider === '') {
    throw new Error('llm service resolved no provider');
  }
  if (typeof resolved.model !== 'string' || resolved.model === '') {
    throw new Error('llm service resolved no model');
  }
  const effort = resolved.reasoningEffort;
  return {
    provider: resolved.provider,
    model: resolved.model,
    // The effort may be a branded id; the Session event carries a plain string.
    ...(effort === undefined || effort === null || String(effort) === ''
      ? {}
      : { reasoningEffort: String(effort) }),
  };
}

/**
 * Remember that one employee's configured model is not in effect.
 *
 * A failed apply is retried by the next sync (a settings save, a Lead model
 * change, a reload), so logging every attempt would flood the log for one
 * mistyped field. The entry is keyed by Agent id and only rewritten when the
 * route or the reason changes; `team_status` reads it back.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - live child Agent.
 * @param {{ provider: string, model: string, reasoningEffort?: string } | undefined} route - route that failed.
 * @param {string} message - why the route is not applied.
 */
function recordModelFailure(ctx, state, agent, route, message) {
  const spec = formatModelSpec(route);
  const previous = state.modelErrors.get(agent.id);
  state.modelErrors.set(agent.id, { spec, message });
  if (previous !== undefined && previous.spec === spec && previous.message === message) return;
  warn(ctx, `model ${spec === '' ? '(unresolved)' : spec} is not applied to ${agent.id}: ${message}`);
}

/**
 * Forget one employee's recorded model failure after a successful apply.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - live child Agent.
 */
function clearModelFailure(state, agent) {
  state.modelErrors.delete(agent.id);
}

/**
 * Apply one model to one live child.
 *
 * `SessionController.selectModel` is not usable here: it resolves the Agent
 * through the API ownership gate, which refuses every `origin: 'subagent'`
 * session — and every employee session is one. The write step it uses internally,
 * `sessionController.agents.selectForNextRequest`, is the same one without the
 * gate (and without the validation, which is why `resolveRoute` runs first): it
 * appends the durable `model/selection` event and installs the Session-local
 * selection the next prompt assembly reads. It never touches the Host default
 * model, so the user's own model choice stays untouched.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - live child Agent.
 * @param {{ provider: string, model: string, reasoningEffort?: string } | undefined} desired - target route.
 * @returns {Promise<void>} settlement after the queue slot.
 */
function applyModel(ctx, state, agent, desired) {
  if (desired === undefined) return Promise.resolve();
  if (state.disposed) return Promise.resolve();
  return enqueueModel(state, async () => {
    if (state.disposed) return;
    let resolved;
    try {
      resolved = await resolveRoute(ctx, desired);
    } catch (error) {
      return recordModelFailure(ctx, state, agent, desired, messageOf(error));
    }
    if (resolved === undefined) {
      return recordModelFailure(ctx, state, agent, desired, 'llm service unavailable');
    }
    if (sameSelection(currentSelection(ctx, agent), resolved)) {
      return clearModelFailure(state, agent);
    }
    const registry = ctx.sessionController?.agents;
    if (typeof registry?.selectForNextRequest !== 'function') {
      return recordModelFailure(
        ctx,
        state,
        agent,
        resolved,
        'sessionController exposes no selection registry',
      );
    }
    try {
      registry.selectForNextRequest(agent, resolved);
    } catch (error) {
      return recordModelFailure(ctx, state, agent, resolved, messageOf(error));
    }
    clearModelFailure(state, agent);
  }).catch((error) => {
    warn(ctx, `model queue failed: ${messageOf(error)}`);
  });
}

/**
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - child Agent.
 * @param {object} role - role definition.
 */
function applyRoleModel(ctx, state, lead, agent, role) {
  const configured = state.config[role.modelField];
  const desired = desiredSelection(ctx, lead, role, state.config);
  // `desiredSelection` reads an unparsable value as "follow the Lead", which is
  // right for display but would hide a typo (`provider:model` without `::`) that
  // never takes effect. Report it instead of silently following the Lead.
  if (desired === undefined && typeof configured === 'string' && configured.trim() !== '') {
    return Promise.resolve(
      recordModelFailure(ctx, state, agent, undefined, `unparsable model spec "${configured.trim()}"`),
    );
  }
  return applyModel(ctx, state, agent, desired);
}

/**
 * Reconcile every live teammate of one Lead with the current config.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 */
async function syncModelsForLead(ctx, state, lead) {
  let membership;
  try {
    membership = ctx.agentTeams.tryMembership(lead);
  } catch {
    return;
  }
  if (membership?.role !== 'lead') return;
  let members;
  try {
    members = teammatesOf(ctx, lead);
  } catch (error) {
    warn(ctx, `could not list teammates for ${lead.id}: ${messageOf(error)}`);
    return;
  }
  for (const member of members) {
    if (member.status === 'failed' || member.status === 'provisioning') continue;
    const role = roleForName(member.name);
    if (role === undefined) continue;
    const agent = ctx.agents.get(member.id);
    if (agent === undefined) continue;
    await applyRoleModel(ctx, state, lead, agent, role);
  }
}

/**
 * Debounced reconcile for one Lead.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 */
function scheduleModelSync(ctx, state, lead) {
  const existing = state.syncTimers.get(lead.id);
  if (existing !== undefined) clearTimeout(existing);
  const timer = setTimeout(() => {
    state.syncTimers.delete(lead.id);
    if (!state.disposed) void syncModelsForLead(ctx, state, lead);
  }, 120);
  state.syncTimers.set(lead.id, timer);
}

/** @param {import('@deepseek-ai/dsh-agent').Agent} agent - Agent. @param {string} name - order key. @param {number} fallback - fallback. */
function sectionOrder(agent, name, fallback) {
  try {
    const value = agent.ctx.systemPrompt.getSectionOrder(name);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** @param {object} ctx - Host context. @param {unknown} agent - candidate Agent. @returns {import('@deepseek-ai/dsh-agent').Agent} the Lead. */
function requireLead(ctx, agent) {
  const membership = agent === undefined ? undefined : ctx.agentTeams.tryMembership(agent);
  if (membership?.role !== 'lead') {
    throw new Error('This tool belongs to the Work Team Lead (the main conversation).');
  }
  return agent;
}

/** @param {object} ctx - Host context. @param {unknown} agent - candidate Agent. @returns {{ root: object, name: string }} teammate identity. */
function requireTeammate(ctx, agent) {
  const membership = agent === undefined ? undefined : ctx.agentTeams.tryMembership(agent);
  if (membership?.role !== 'teammate') {
    throw new Error('This tool belongs to a Work Team employee.');
  }
  return membership;
}

/** @param {object} props - output properties. */
function objectSchema(properties) {
  return { type: 'object', additionalProperties: false, properties };
}

/** @param {string} description - field description. */
function stringField(description) {
  return { type: 'string', required: true, description };
}

/** @param {string} description - field description. */
function integerField(description) {
  return { type: 'integer', required: true, description };
}

/** @param {string} description - field description. @param {object} items - item schema. */
function arrayField(description, items) {
  return { type: 'array', required: true, description, items };
}

/** @param {unknown} _args - tool args. @param {unknown} value - canonical value. */
function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value) }];
}

/**
 * Create one teammate and apply its identity/model before sending real work.
 *
 * With a task, the first-turn prompt is one role line plus the task itself, so a
 * direct-hire spends one turn instead of an onboarding round-trip. Without one
 * (team_start / automatic formation) the short onboarding line stays. The prompt
 * is a required ContentBlock[], so the first turn always happens and always runs
 * on the main model: `applyRoleModel` only lands on the next request — with the
 * default empty `modelXxx` fields that is the same route, so nothing is lost.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 * @param {object} role - role definition.
 * @param {string | undefined} task - optional first task.
 * @param {AbortSignal} signal - tool cancellation.
 * @returns {Promise<{ member: object, created: boolean }>} roster row.
 */
async function spawnRole(ctx, state, lead, role, task, signal) {
  const members = teammatesOf(ctx, lead);
  const existing = members.find((member) => member.name === role.id);
  if (existing !== undefined) {
    if (existing.status === 'failed') {
      throw new Error(
        `Teammate "${role.id}" previously failed; its name cannot be reused in this session. Start a new session for a fresh team.`,
      );
    }
    if (task !== undefined && task.trim() !== '') {
      await ctx.agentTeams.sendMessage(lead, {
        target: role.id,
        content: [{ type: 'text', text: task }],
        signal,
      });
    }
    return { member: existing, created: false };
  }

  const trimmedTask = task?.trim() ?? '';
  const firstPrompt = trimmedTask === ''
    ? onboardingText(role)
    : `你是「${role.zh.name}」（团队名 ${role.id}），${role.zh.role}，lead 的员工。你的第一个任务：\n\n${trimmedTask}`;
  const result = await ctx.agentTeams.spawnTeammate(lead, {
    name: role.id,
    description: role.zh.description,
    prompt: [{ type: 'text', text: firstPrompt }],
    context: 'fresh',
    provider: 'spawn',
    signal,
  });

  const agent = ctx.agents.get(result.member.id);
  if (agent !== undefined) {
    await applyRoleModel(ctx, state, lead, agent, role);
  }

  return { member: result.member, created: true };
}

/**
 * Background formation loop: hire the missing default roles, two at a time.
 *
 * `FORMATION_CONCURRENCY` seats are kept in flight: formation wall-clock halves
 * without fanning all seven spawns out against the subagent capacity. The three
 * serial-era semantics are unchanged:
 * - `attempted` is claimed synchronously before a spawn starts, so two workers
 *   can never take the same seat and a failed seat is never retried;
 * - the roster is re-read before every claim, so a mid-run settings change or a
 *   Lead disposal is honoured (an `off` switch stops new claims; in-flight
 *   seats finish, exactly like the serial loop's current hire);
 * - the returned state is only hired/failed rows — `team_start`'s shape and the
 *   `done`/`failed` lock transition are untouched.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 * @param {AbortController} controller - this run's cancellation.
 * @returns {Promise<void>} settlement of the whole run.
 */
async function runAutoStart(ctx, state, lead, controller) {
  const signal = controller.signal;
  const hired = [];
  const failed = [];
  const attempted = new Set();
  /**
   * Seats claimed by a lane that has not settled its spawn yet.
   *
   * Without this, a lane's `teammatesOf()` cannot see the other lane's in-flight
   * child, so `planAutoStartLineup` would hand out that seat a second time and the
   * team could end up one over `teamSize`. Claiming and releasing are synchronous
   * around the spawn, and a failed spawn releases its seat.
   */
  const inFlight = new Set();

  /** Claim the next untried, unfilled seat, or undefined to stop scheduling. */
  const takeNextSeat = () => {
    if (state.disposed || signal.aborted) return undefined;
    if (state.config.autoStart === 'off') return undefined;
    let members;
    try {
      members = teammatesOf(ctx, lead);
    } catch (error) {
      warn(ctx, `could not list teammates while forming the team: ${messageOf(error)}`);
      return undefined;
    }
    const capacity = clampTeamSize(state.config.teamSize, DEFAULT_LINEUP.length, MAX_TEAM_SIZE);
    // Occupied seats = roster rows + seats another lane is already spawning.
    const present = new Set([...members.map((member) => member.name), ...inFlight]);
    const pending = planAutoStartLineup(DEFAULT_LINEUP, capacity, present).filter(
      (id) => !attempted.has(id),
    );
    if (pending.length === 0) return undefined;
    const id = pending[0];
    attempted.add(id);
    inFlight.add(id);
    return id;
  };

  const hireSeat = async (id) => {
    const role = roleById(id);
    if (role === undefined) {
      inFlight.delete(id);
      return;
    }
    try {
      await spawnRole(ctx, state, lead, role, undefined, signal);
      hired.push(hireRow(role));
    } catch (error) {
      if (state.disposed || signal.aborted) return;
      failed.push({ name: id, reason: messageOf(error) });
    } finally {
      // A successful spawn is now on the roster; a failed one frees its seat.
      inFlight.delete(id);
    }
  };

  try {
    await Promise.all(
      Array.from({ length: FORMATION_CONCURRENCY }, async () => {
        for (;;) {
          const id = takeNextSeat();
          if (id === undefined) return;
          await hireSeat(id);
        }
      }),
    );
  } catch (error) {
    warn(ctx, `automatic team formation failed for ${lead.id}: ${messageOf(error)}`);
  } finally {
    if (state.autoRuns.get(lead.id) === controller) state.autoRuns.delete(lead.id);
    if (state.autoStart.get(lead.id) === 'running') {
      state.autoStart.set(lead.id, failed.length > 0 ? 'failed' : 'done');
    }
    if (hired.length > 0 || failed.length > 0) {
      warn(
        ctx,
        `automatic team formation for ${lead.id}: ${hired.length} hired, ${failed.length} failed`,
      );
    }
  }
}

/**
 * Take the lock and hand formation to the next tick.
 *
 * This is the only place a run starts, so `queued`/`running` cannot be skipped:
 * both `agent/created` (serial, awaited) and the first pre-step must return
 * before a single child is spawned, otherwise the user's first message waits for
 * the whole line-up.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 */
function startAutoStart(ctx, state, lead) {
  if (state.disposed) return;
  const existing = state.autoRuns.get(lead.id);
  if (existing !== undefined) return;
  const controller = new AbortController();
  state.autoStart.set(lead.id, 'running');
  state.autoRuns.set(lead.id, controller);
  setTimeout(() => {
    void runAutoStart(ctx, state, lead, controller);
  }, 0);
}

/**
 * Decide whether a freshly installed Lead should form the team, and when.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - the Lead.
 * @param {string | undefined} source - session lifecycle source.
 */
function maybeAutoStart(ctx, state, agent, source) {
  let membership;
  try {
    membership = ctx.agentTeams.tryMembership(agent);
  } catch {
    return;
  }
  const scheduled = shouldAutoStart({
    mode: state.config.autoStart,
    source,
    role: membership?.role,
    record: state.autoStart.get(agent.id),
  });
  if (!scheduled) return;
  state.autoStart.set(agent.id, 'queued');
  if (state.config.autoStart === 'immediate') startAutoStart(ctx, state, agent);
  // 'first-message' waits for `kickFirstMessageAutoStart`; both paths return immediately.
}

/**
 * Start a queued ('first-message') formation from the Lead's first step.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 */
function kickFirstMessageAutoStart(ctx, state, lead) {
  if (state.config.autoStart !== 'first-message') return;
  if (state.autoStart.get(lead.id) !== 'queued') return;
  startAutoStart(ctx, state, lead);
}

/**
 * Forward one `@role` message, or rewrite it when the target cannot take it.
 *
 * Attachments (images, files) are carried through both directions: the message
 * the Lead sees after the rewrite keeps every non-text block, and the forwarded
 * copy keeps them too, so `@小前 看这个` plus a screenshot loses nothing.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 * @param {object[]} messages - messages entering this step.
 * @param {{ id: string, content: readonly object[], source: object }} message - the directive.
 * @param {{ name: string, body: string }} parsed - parsed mention.
 * @param {object} role - resolved role.
 * @param {AbortSignal} signal - this turn's cancellation.
 * @returns {Promise<object | undefined>} a pre-step decision, or undefined to keep the text.
 */
async function applyDispatch(ctx, state, lead, messages, message, parsed, role, signal) {
  const attachments = nonTextBlocks(message);
  // Replace content only: the message id and its source stay the ones the Host minted.
  const compose = (text) => [{ type: 'text', text }, ...attachments];
  const rewrite = (text) => ({
    kind: 'enter',
    messages: messages.map((entry) =>
      entry.id === message.id ? { ...entry, content: compose(text) } : entry,
    ),
  });

  let member;
  try {
    member = teammatesOf(ctx, lead).find((row) => row.name === role.id);
  } catch (error) {
    warn(ctx, `could not read the roster for @${role.id}: ${messageOf(error)}`);
    return undefined;
  }
  if (member === undefined || member.status === 'failed' || member.status === 'provisioning') {
    // Distinguish "not hired at all" from "being hired right now": during automatic
    // formation the roster is briefly empty, and pointing the user at team_start
    // there would be wrong.
    let reason = 'missing';
    if (member?.status === 'failed') reason = 'failed';
    else if (member?.status === 'provisioning') reason = 'starting';
    else if (autoStartIsActive(state.autoStart.get(lead.id))) reason = 'starting';
    rememberDispatch(state, message.id);
    return rewrite(buildDispatchFallback(role, parsed.body, reason));
  }

  try {
    await ctx.agentTeams.sendMessage(lead, {
      target: role.id,
      content: compose(parsed.body),
      signal,
    });
  } catch (error) {
    // The task did NOT reach the employee. Say so and keep the text: a silent
    // pass-through would let the Lead answer "已转发" and lose the work.
    warn(ctx, `could not forward a message to ${role.id}: ${messageOf(error)}`);
    rememberDispatch(state, message.id);
    return rewrite(buildDispatchSendFailure(role, parsed.body, messageOf(error)));
  }
  // Only a delivered message is marked: the claim removed it from the inbox, so
  // there is no per-step replay to defend against.
  rememberDispatch(state, message.id);
  return rewrite(buildDispatchReceipt(role, parsed.body));
}

/**
 * One Lead step's decision, computed without ever calling `next()`.
 *
 * Routing runs before the first-message kick so the roster the message is matched
 * against is read first; the kick still happens afterwards (in `finally`), so a
 * dispatch on the very first step can never swallow team formation.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {{ agent?: object, messages?: unknown, signal?: AbortSignal }} payload - pre-step payload.
 * @returns {Promise<object | undefined>} a pre-step decision, or undefined to keep the messages.
 */
async function leadPreStepDecision(ctx, state, payload) {
  const agent = payload?.agent;
  let membership;
  try {
    membership = agent === undefined ? undefined : ctx.agentTeams.tryMembership(agent);
  } catch {
    membership = undefined;
  }
  if (membership?.role !== 'lead') return undefined;
  try {
    return await routeDispatch(ctx, state, agent, payload);
  } finally {
    kickFirstMessageAutoStart(ctx, state, agent);
  }
}

/**
 * Find the first routable `@role` message in this step and handle it.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} lead - Team Lead.
 * @param {{ messages?: unknown, signal?: AbortSignal }} payload - pre-step payload.
 * @returns {Promise<object | undefined>} a pre-step decision, or undefined to pass through.
 */
async function routeDispatch(ctx, state, lead, payload) {
  if (state.config.dispatchPrefix !== true) return undefined;
  const messages = payload?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue;
    if (message.role !== 'user') continue;
    if (state.dispatched.has(message.id)) continue;
    const parsed = parseDispatch(contentText(message));
    if (parsed === undefined) continue;
    const role = resolveDispatchRole(parsed.name);
    if (role === undefined) continue;
    return applyDispatch(ctx, state, lead, messages, message, parsed, role, payload.signal);
  }
  return undefined;
}

/** @param {object} role - role definition. @returns {object} compact hire row. */
function hireRow(role) {
  return {
    name: role.id,
    displayName: role.zh.name,
    role: role.zh.role,
  };
}

/** @param {object} ctx - Host context. @param {object} state - plugin state. */
function makeTeamStartTool(ctx, state) {
  return defineTool({
    name: 'team_start',
    description:
      'Form the built-in Work Team. Hires every missing default role (pm, frontend, backend, reviewer, researcher, designer, ops) up to the configured team size, with each role\u2019s persona and model. Call this when the user asks to assemble or fill the team. It skips roles that already exist and reports any failures. If automatic formation is already running it returns the current progress instead of starting a second group. Do not use spawn_teammate to build formal employees.',
    parameters: {},
    output: {
      schema: objectSchema({
        hired: arrayField(
          'Teammates created by this call.',
          objectSchema({
            name: stringField('Role id / teammate name.'),
            displayName: stringField('Chinese display name.'),
            role: stringField('Role title.'),
          }),
        ),
        skipped: arrayField(
          'Default roles already on the team.',
          { type: 'string' },
        ),
        failed: arrayField(
          'Roles that could not be hired.',
          objectSchema({
            name: stringField('Role id.'),
            reason: stringField('Failure reason.'),
          }),
        ),
        size: integerField('Teammates on the team after this call.'),
        capacity: integerField('Configured team size.'),
        note: stringField('Short operational note.'),
      }),
      render: renderJson,
    },
    async execute(_args, exec) {
      const lead = requireLead(ctx, exec.agent);
      const capacity = clampTeamSize(state.config.teamSize, DEFAULT_LINEUP.length, MAX_TEAM_SIZE);
      const members = teammatesOf(ctx, lead);
      const forming = state.autoStart.get(lead.id);
      if (autoStartIsActive(forming)) {
        return {
          hired: [],
          skipped: DEFAULT_LINEUP.filter((id) => members.some((member) => member.name === id)),
          failed: [],
          size: members.length,
          capacity,
          note: `Automatic team formation is already ${forming} (${members.length}/${capacity} seats filled). Wait for it and check team_status; do not start a second group.`,
        };
      }
      const present = new Set(members.map((member) => member.name));
      const hired = [];
      const skipped = [];
      const failed = [];
      // Decide the whole batch before spawning: the serial loop's capacity rule
      // (present rows are skipped without consuming a seat, and once the seats
      // are gone the remaining rows are neither hired nor skipped) is reproduced
      // here, then the batch runs through the same two-lane pool as formation.
      // `size` cannot be a live shared counter under concurrency; it is the
      // initial roster plus the created count, computed after the pool settles.
      //
      // Unlike `runAutoStart`, no seat can be over-committed here: `seats` is
      // consumed while the batch is built, before any spawn starts, so the batch
      // never holds more rows than the free seats — there is no in-flight window
      // for a second lane to read a stale roster through.
      const batch = [];
      let seats = capacity - members.length;
      for (const id of DEFAULT_LINEUP) {
        if (seats <= 0) break;
        if (present.has(id)) {
          skipped.push(id);
          continue;
        }
        batch.push(id);
        seats -= 1;
      }
      let createdCount = 0;
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(FORMATION_CONCURRENCY, batch.length) }, async () => {
          for (;;) {
            const index = next;
            next += 1;
            if (index >= batch.length) return;
            const id = batch[index];
            const role = roleById(id);
            if (role === undefined) continue;
            try {
              const result = await spawnRole(ctx, state, lead, role, undefined, exec.signal);
              hired.push(hireRow(role));
              if (result.created) createdCount += 1;
            } catch (error) {
              failed.push({ name: id, reason: messageOf(error) });
            }
          }
        }),
      );
      const size = members.length + createdCount;

      const note =
        failed.length > 0
          ? 'Some hires failed; check the subagent capacity and the reasons above.'
          : size >= capacity
            ? `Team is at capacity (${size}/${capacity}). Raise the team size in the office panel to hire more.`
            : `Team has ${size}/${capacity} seats filled.`;
      return { hired, skipped, failed, size, capacity, note };
    },
  });
}

/**
 * File one shared hiring-request task for a role the team cannot take right now.
 *
 * `request_hire` and the full-team fallback of the employee `hire_teammate` share
 * this so both produce the same subject and description, and the Lead reads one
 * shape of request on the task board.
 *
 * @param {object} ctx - Host context.
 * @param {object} exec - tool execution context of the requesting employee.
 * @param {object} role - role definition.
 * @param {string} reason - why this role is needed.
 * @returns {Promise<{ taskId: string, subject: string }>} created task identity.
 */
async function createHireRequest(ctx, exec, role, reason) {
  const membership = requireTeammate(ctx, exec.agent);
  const subject = `招聘申请：${role.zh.name}（${role.id}）`;
  const task = await ctx.agentTeams.createTask(exec.agent, {
    subject,
    description: `申请人：${membership.name}\n角色：${role.zh.role}\n理由：${reason}`,
    writeScopes: [],
  });
  return { taskId: task.id, subject: task.subject };
}

/** @param {object} ctx - Host context. @param {object} state - plugin state. @param {{ employee?: boolean }} options - caller scope. */
function makeHireTool(ctx, state, options = {}) {
  const employee = options.employee === true;
  return defineTool({
    name: 'hire_teammate',
    description: employee
      ? 'Hire one built-in role into the Work Team when the team is genuinely missing that role and the hiring switch is on. It consumes a team seat and is bounded by the configured team size; when the team is full it files one shared hiring request and returns created:false with the requestId instead of hiring. The employee self-hire switch can be off: the call is then refused with the reason, and request_hire is how to ask the Lead for the role.'
      : 'Hire one built-in role into the Work Team. Use this when the user asks for a specific role (for example the copywriter or a second specialist). It applies the role persona and model; spawn_teammate does not. It respects the configured team size.',
    parameters: {
      role: {
        type: 'string',
        required: true,
        enum: ROLES.map((role) => role.id),
        description: 'Built-in role id to hire.',
      },
      task: {
        type: 'string',
        description:
          'Optional first task. The teammate first reports for duty, then receives this task as a follow-up.',
      },
    },
    output: {
      schema: objectSchema({
        name: stringField('Role id / teammate name.'),
        displayName: stringField('Chinese display name.'),
        role: stringField('Role title.'),
        status: stringField(
          'Roster status after the call; "requested" when the team was full and a hiring request was filed instead.',
        ),
        model: stringField('Configured model route, or "follow-main".'),
        task: stringField('First task, or an empty string.'),
        created: { type: 'boolean', required: true, description: 'Whether this call created a new teammate.' },
        requestId: stringField('Hiring-request task id when no seat was free, otherwise an empty string.'),
      }),
      render: renderJson,
    },
    async execute(args, exec) {
      const role = roleById(args.role);
      if (role === undefined) throw new Error(`Unknown Work Team role "${String(args.role)}".`);
      const lead = employee ? requireTeammate(ctx, exec.agent).root : requireLead(ctx, exec.agent);
      const capacity = clampTeamSize(state.config.teamSize, DEFAULT_LINEUP.length, MAX_TEAM_SIZE);
      const members = teammatesOf(ctx, lead);
      const existing = members.find((member) => member.name === role.id);
      const desired = desiredSelection(ctx, lead, role, state.config);
      const model = formatModelSpec(desired) === '' ? 'follow-main' : formatModelSpec(desired);
      if (existing === undefined && members.length >= capacity) {
        if (!employee) {
          throw new Error(
            `Work Team is at capacity (${members.length}/${capacity}). Raise the team size in the office panel first.`,
          );
        }
        // An employee cannot widen the team: file the same request `request_hire`
        // would, and report it as a request rather than a hire.
        const request = await createHireRequest(
          ctx,
          exec,
          role,
          `团队已满编（${members.length}/${capacity}），无法直接招 ${role.zh.name}；请主管决定是扩编还是把活分给现有员工。`,
        );
        return {
          ...hireRow(role),
          status: 'requested',
          model,
          task: '',
          created: false,
          requestId: request.taskId,
        };
      }
      const result = await spawnRole(ctx, state, lead, role, args.task, exec.signal);
      return {
        ...hireRow(role),
        status: result.member.status,
        model,
        task: args.task ?? '',
        created: result.created,
        requestId: '',
      };
    },
  });
}

/**
 * One Lead tool call that fans independent tasks out to several teammates at
 * once. Every row is resolved through `roleForName` and messaged in parallel;
 * one bad row (unknown role, empty task, failed send) fails alone and the rest
 * still go out — the Lead reads the per-row receipt instead of retrying the
 * whole batch.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @returns {object} the dispatch_tasks tool definition.
 */
function makeDispatchTasksTool(ctx, state) {
  return defineTool({
    name: 'dispatch_tasks',
    description:
      'Send tasks to several Work Team teammates in one call, in parallel. Use this for assignments that do not depend on each other instead of one send_message after another; it saves a Lead turn per extra teammate. Each row names a built-in role (role id, for example "backend") and its task; rows are independent — an unknown role or a failed send is reported for that row only. Cancelling the turn cancels the whole batch: every row then reports accepted:false with the cancellation reason, which is a turn-level cancel rather than a per-row failure. To hire a missing role first, use hire_teammate or team_start, then dispatch.',
    parameters: {
      assignments: arrayField(
        'One row per teammate, 1-8 rows.',
        objectSchema({
          role: stringField('Built-in role id, for example "backend".'),
          task: stringField('Self-contained task text for that teammate.'),
        }),
      ),
    },
    output: {
      schema: objectSchema({
        results: arrayField(
          'One receipt per row, in input order.',
          objectSchema({
            role: stringField('Role id the row resolved to, or the raw input when unknown.'),
            accepted: { type: 'boolean', required: true, description: 'Whether the message was sent.' },
            messageId: stringField('Team message id when accepted, otherwise an empty string.'),
            error: stringField('Why this row failed, or an empty string.'),
          }),
        ),
        sent: integerField('Rows accepted.'),
        failed: integerField('Rows rejected or failed.'),
      }),
      render: renderJson,
    },
    async execute(args, exec) {
      const lead = requireLead(ctx, exec.agent);
      const assignments = Array.isArray(args.assignments) ? args.assignments : [];
      const results = await Promise.all(
        assignments.map(async (assignment) => {
          const rawRole = typeof assignment?.role === 'string' ? assignment.role.trim() : '';
          const task = typeof assignment?.task === 'string' ? assignment.task : '';
          const role = roleForName(rawRole);
          if (role === undefined) {
            return {
              role: rawRole,
              accepted: false,
              messageId: '',
              error: `Unknown Work Team role "${rawRole || '(empty)'}"; use a built-in role id like "backend".`,
            };
          }
          if (task.trim() === '') {
            return { role: role.id, accepted: false, messageId: '', error: 'Task text is empty.' };
          }
          try {
            const receipt = await ctx.agentTeams.sendMessage(lead, {
              target: role.id,
              content: [{ type: 'text', text: task }],
              signal: exec.signal,
            });
            return {
              role: role.id,
              accepted: true,
              messageId: typeof receipt?.messageId === 'string' ? receipt.messageId : '',
              error: '',
            };
          } catch (error) {
            return { role: role.id, accepted: false, messageId: '', error: messageOf(error) };
          }
        }),
      );
      return {
        results,
        sent: results.filter((row) => row.accepted).length,
        failed: results.filter((row) => !row.accepted).length,
      };
    },
  });
}

/** @param {object} ctx - Host context. @param {object} state - plugin state. */
function makeTeamStatusTool(ctx, state) {
  return defineTool({
    name: 'team_status',
    description:
      'Read the Work Team roster: each teammate\u2019s role, live status, current model, current task, and token total, plus shared task counts and the automatic formation state. Use this to supervise instead of guessing.',
    parameters: {},
    output: {
      schema: objectSchema({
        size: integerField('Teammates on the team.'),
        capacity: integerField('Configured team size.'),
        members: arrayField(
          'Teammates in roster order.',
          objectSchema({
            name: stringField('Role id / teammate name.'),
            displayName: stringField('Chinese display name.'),
            role: stringField('Role title.'),
            status: stringField('running, inactive, provisioning, or failed.'),
            model: stringField('Actual model route, or "follow-main".'),
            modelError: stringField('Why the configured model is not applied, or an empty string.'),
            task: stringField('Current in-progress task, or an empty string.'),
            tokens: integerField('Lifetime token total, 0 when unknown.'),
            workers: integerField('Live one-off workers this teammate currently owns, 0 when unknown.'),
          }),
        ),
        tasks: objectSchema({
          pending: integerField('Pending tasks.'),
          inProgress: integerField('In-progress tasks.'),
          completed: integerField('Completed tasks.'),
        }),
        autoStart: stringField(
          'Automatic formation state: off, none (not scheduled), queued, running, done, or failed.',
        ),
      }),
      render: renderJson,
    },
    async execute(_args, exec) {
      const lead = requireLead(ctx, exec.agent);
      const members = teammatesOf(ctx, lead);
      const tasks = ctx.agentTeams.listTasks(lead);
      const rows = members.map((member) => {
        const role = roleForName(member.name);
        const agent = ctx.agents.get(member.id);
        const actual = agent === undefined ? undefined : currentSelection(ctx, agent);
        const configured = role === undefined ? undefined : parseModelSpec(state.config[role.modelField]);
        const model = formatModelSpec(actual ?? configured);
        let tokens = 0;
        let workers = 0;
        if (agent !== undefined) {
          try {
            const usage = ctx.sessionProjections.stateOf(agent.session, 'tokenUsage');
            tokens = sumTokenTotals(usage?.totals);
          } catch {
            tokens = 0;
          }
          try {
            workers = liveChildrenOf(ctx, agent).length;
          } catch {
            workers = 0;
          }
        }
        const currentTask = tasks.find(
          (task) => task.status === 'in_progress' && task.ownerName === member.name,
        );
        return {
          name: member.name,
          displayName: role?.zh.name ?? member.name,
          role: role?.zh.role ?? 'Teammate',
          status: member.status,
          model: model === '' ? 'follow-main' : model,
          modelError: state.modelErrors.get(member.id)?.message ?? '',
          task: currentTask?.subject ?? '',
          tokens,
          workers,
        };
      });
      return {
        size: members.length,
        capacity: clampTeamSize(state.config.teamSize, DEFAULT_LINEUP.length, MAX_TEAM_SIZE),
        members: rows,
        tasks: {
          pending: tasks.filter((task) => task.status === 'pending').length,
          inProgress: tasks.filter((task) => task.status === 'in_progress').length,
          completed: tasks.filter((task) => task.status === 'completed').length,
        },
        autoStart:
          state.config.autoStart === 'off'
            ? 'off'
            : (state.autoStart.get(lead.id) ?? 'none'),
      };
    },
  });
}

/** @param {object} ctx - Host context. */
function makeRequestHireTool(ctx) {
  return defineTool({
    name: 'request_hire',
    description:
      'Ask the Lead to hire another built-in role. Creates one shared task describing the gap and the reason. Use this when you believe the team needs a specialist; the Lead decides whether to hire.',
    parameters: {
      role: {
        type: 'string',
        required: true,
        enum: ROLES.map((role) => role.id),
        description: 'Built-in role id you are requesting.',
      },
      reason: {
        type: 'string',
        required: true,
        description: 'Why this role is needed now, and what work it would unblock.',
      },
    },
    output: {
      schema: objectSchema({
        taskId: stringField('Created task id.'),
        subject: stringField('Created task subject.'),
      }),
      render: renderJson,
    },
    async execute(args, exec) {
      const membership = requireTeammate(ctx, exec.agent);
      const role = roleById(args.role);
      if (role === undefined) throw new Error(`Unknown Work Team role "${String(args.role)}".`);
      const existing = teammatesOf(ctx, membership.root).find((member) => member.name === role.id);
      if (existing !== undefined) {
        throw new Error(`Role "${role.id}" is already on the team.`);
      }
      return createHireRequest(ctx, exec, role, args.reason);
    },
  });
}

/**
 * Install Lead scope: boss guide, hiring tools, capacity guard.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - root Agent.
 * @returns {() => void} scope disposer.
 */
function installBoss(ctx, state, agent) {
  const disposers = [];
  try {
    const order = sectionOrder(agent, 'TEAM_POLICY', 600);
    disposers.push(
      agent.ctx.systemPrompt.section({
        name: 'work-team:boss-guide',
        order: order + 20,
        text: buildBossGuide(),
      }),
    );
    disposers.push(agent.ctx.tools.register(makeTeamStartTool(ctx, state)));
    disposers.push(agent.ctx.tools.register(makeHireTool(ctx, state)));
    disposers.push(agent.ctx.tools.register(makeDispatchTasksTool(ctx, state)));
    disposers.push(agent.ctx.tools.register(makeTeamStatusTool(ctx, state)));
    // Live handover: a guard is evaluated on every call, so the panel switch works
    // without reinstalling the scope (the Config is volatile, no remount happens).
    disposers.push(
      agent.ctx.tools.guard((exec) => handsOffReason(state.config.leadHandsOff, exec.name)),
    );
    disposers.push(
      agent.ctx.tools.guard((exec) => {
        if (exec.name !== 'spawn_teammate') return undefined;
        let count;
        try {
          count = teammatesOf(ctx, agent).length;
        } catch {
          return undefined;
        }
        const capacity = clampTeamSize(state.config.teamSize, DEFAULT_LINEUP.length, MAX_TEAM_SIZE);
        if (count < capacity) return undefined;
        return `Work Team is at capacity (${count}/${capacity}). Use hire_teammate only after the user raises the team size in the office panel, or assign the work to an existing teammate.`;
      }),
    );
    state.leads.add(agent.id);
    scheduleModelSync(ctx, state, agent);
  } catch (error) {
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        // ignore partial teardown failures
      }
    }
    throw error;
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        // ignore
      }
    }
    state.leads.delete(agent.id);
    const timer = state.syncTimers.get(agent.id);
    if (timer !== undefined) clearTimeout(timer);
    state.syncTimers.delete(agent.id);
  };
}

/**
 * Compare two allow lists as ordered name lists.
 * @param {string[]} left - previous list.
 * @param {string[]} right - candidate list.
 * @returns {boolean} whether they are identical.
 */
function sameAllowList(left, right) {
  if (left.length !== right.length) return false;
  return left.every((name, index) => name === right[index]);
}

/**
 * Lift one employee's global-tool whitelist, if one is installed.
 * @param {object} state - plugin state.
 * @param {string} id - Agent id.
 */
function releaseToolFilter(state, id) {
  const entry = state.toolFilters.get(id);
  if (entry === undefined) return;
  state.toolFilters.delete(id);
  try {
    entry.dispose();
  } catch {
    // The Agent scope may already be gone; nothing left to lift.
  }
}

/**
 * Install, refresh, or lift one employee's global-tool whitelist.
 *
 * Runs at install time and again on every settings save, so the panel switch
 * takes effect without a remount. Two details matter:
 *
 * - The previous filter is disposed before the new one is registered. Filters
 *   intersect, so a leaked filter would make the next allow list a strict subset
 *   of the old one and the visible tool count would shrink on every toggle.
 * - `tools.restrict()` throws for a name that is not in the current global
 *   registry, and `maybeInstall` only warns — a throw here would take the
 *   persona, the hire tools, and the guards down with it.
 *
 * The probe is `restrict()` itself. Its validation set — inherited global tools
 * plus the session preset's ancestor layer — is the only exact answer, and on the
 * Web surface the file, shell, todo, skill, subagent, and web tools live in that
 * ancestor layer, not the global one. An unscoped `tools.get()` check reports
 * `read` / `bash` / `grep` as missing and the resulting allow list would cut
 * exactly the tools an employee cannot work without.
 *
 * `restrict()` validates before it appends, so a rejected attempt leaves no
 * partial filter behind. In a healthy deployment the first call succeeds; the
 * retry only runs when a declared tool is not installed on this machine, and the
 * worst case is an untrimmed employee plus one warning.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - teammate Agent.
 * @param {object | undefined} role - role definition.
 */
function applyToolFilter(ctx, state, agent, role) {
  const trimmed = role !== undefined && state.config.trimEmployeeTools !== false;
  if (!trimmed) {
    releaseToolFilter(state, agent.id);
    return;
  }
  const desired = employeeAllowList(role, { workers: state.config.maxWorkersPerEmployee });
  // The employee's own scope registrations are exempt from restrict() by design,
  // and naming one would make the call throw. They stay visible either way.
  const candidate = desired.filter((name) => !OWN_LAYER_TOOLS.has(name));
  const previous = state.toolFilters.get(agent.id);
  // A settings save that does not move this role's list must not churn the
  // registry: every restrict() notifies the scope of a tool-surface change.
  //
  // Known limit: a retry-trimmed list is cached against `candidate`, so a tool
  // that appears later in the same session (a plugin enabled mid-flight) is NOT
  // picked up until the role or its config changes. Re-probing on every save
  // would mean a rejected restrict() on every settings keystroke.
  if (previous !== undefined && sameAllowList(previous.desired, candidate)) return;
  releaseToolFilter(state, agent.id);
  const applied = registerAllowFilter(ctx, state, agent, role, candidate);
  if (applied === undefined) return;
  state.toolFilters.set(agent.id, { desired: candidate, allow: applied.allow, dispose: applied.dispose });
}

/**
 * Register one allow filter, retrying without the tools this machine lacks.
 *
 * The rejected `restrict()` error names every tool the scope does accept, which
 * is the same set the call validates against — so it doubles as the answer to
 * "which of my declared tools actually exist here".
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - teammate Agent.
 * @param {object} role - role definition.
 * @param {string[]} candidate - declared tools minus the own-layer names.
 * @returns {{ allow: string[], dispose: () => void } | undefined} the applied filter.
 */
function registerAllowFilter(ctx, state, agent, role, candidate) {
  if (candidate.length === 0) {
    warn(ctx, `skipping the employee tool whitelist for ${role.id}: no declared tool is restrictable`);
    return undefined;
  }
  try {
    return { allow: candidate, dispose: agent.ctx.tools.restrict({ allow: candidate }) };
  } catch (error) {
    const known = knownToolsFromError(error);
    const retry = known === undefined ? [] : candidate.filter((name) => known.has(name));
    if (retry.length === 0) {
      warn(ctx, `skipping the employee tool whitelist for ${role.id}: ${messageOf(error)}`);
      return undefined;
    }
    try {
      return { allow: retry, dispose: agent.ctx.tools.restrict({ allow: retry }) };
    } catch (retryError) {
      warn(ctx, `could not trim the tool surface for ${role.id}: ${messageOf(retryError)}`);
      return undefined;
    }
  }
}

/**
 * Read the accepted tool names out of a rejected `restrict()` error.
 *
 * dsh-tools formats it as `... names unknown global tool "x"; known global
 * tools: a, b, c`, sorted. Anything else (a different failure, a future rewording)
 * yields `undefined`, and the caller then leaves the employee untrimmed.
 * @param {unknown} error - thrown value.
 * @returns {Set<string> | undefined} accepted names.
 */
function knownToolsFromError(error) {
  const message = messageOf(error);
  const match = /known global tools: (.*)$/.exec(message);
  if (match === null) return undefined;
  const names = match[1]
    .split(', ')
    .map((name) => name.trim())
    .filter((name) => name !== '' && name !== '(none)');
  return names.length === 0 ? undefined : new Set(names);
}

/**
 * Drop every per-employee record for one Agent.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - teammate Agent.
 */
function releaseEmployee(state, agent) {
  state.employees.delete(agent.id);
  releaseToolFilter(state, agent.id);
}

/**
 * Install employee scope: persona, tool restrictions, hire request, worker cap, model.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - teammate Agent.
 * @param {{ root: object, name: string }} membership - teammate identity.
 * @returns {() => void} scope disposer.
 */
function installEmployee(ctx, state, agent, membership) {
  const disposers = [];
  const role = roleForName(membership.name);
  try {
    if (role !== undefined) {
      const order = sectionOrder(agent, 'TEAM_POLICY', 600);
      disposers.push(
        agent.ctx.systemPrompt.section({
          name: 'work-team:persona',
          order: order + 20,
          // Evaluated on every request: `reporting`, the hire switch, and the worker
          // cap are volatile Config, and a settings save must not wait for a remount.
          text: () =>
            buildEmployeePersona(role, state.config.reporting, {
              maxWorkers: state.config.maxWorkersPerEmployee,
              selfHire: state.config.allowSelfHire,
              stepBudget: state.config.employeeStepBudget,
            }),
        }),
      );
      if (role.deny.length > 0) {
        disposers.push(agent.ctx.tools.restrict({ deny: role.deny }));
      }
      state.employees.set(agent.id, { agent, role });
      applyToolFilter(ctx, state, agent, role);
    }
    disposers.push(agent.ctx.tools.register(makeRequestHireTool(ctx)));
    // Registered unconditionally: the hire switch is enforced per call by the guard
    // below, so turning it on in the panel works for employees already on the team.
    disposers.push(agent.ctx.tools.register(makeHireTool(ctx, state, { employee: true })));
    // One guard, two live switches: the hire switch and the worker cap.
    disposers.push(
      agent.ctx.tools.guard((exec) => employeeDenialReason(ctx, state, agent, exec.name)),
    );
  } catch (error) {
    releaseEmployee(state, agent);
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        // ignore
      }
    }
    throw error;
  }

  let disposed = false;
  let timer;
  if (role !== undefined) {
    timer = setTimeout(() => {
      if (disposed || state.disposed) return;
      void applyRoleModel(ctx, state, membership.root, agent, role);
    }, 0);
    state.modelTimers.set(agent.id, timer);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    state.modelTimers.delete(agent.id);
    releaseEmployee(state, agent);
    for (const dispose of disposers.reverse()) {
      try {
        dispose();
      } catch {
        // ignore
      }
    }
  };
}

/**
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {import('@deepseek-ai/dsh-agent').Agent} agent - candidate Agent.
 * @param {string | undefined} source - session lifecycle source, when known.
 */
function maybeInstall(ctx, state, agent, source) {
  if (state.installed.has(agent)) {
    // Still evaluate formation: a `clear`/`compact` install must not swallow a later resume.
    maybeAutoStart(ctx, state, agent, source);
    return;
  }
  let membership;
  try {
    membership = ctx.agentTeams.tryMembership(agent);
  } catch {
    return;
  }
  if (membership === undefined) return;
  try {
    const dispose =
      membership.role === 'lead'
        ? installBoss(ctx, state, agent)
        : installEmployee(ctx, state, agent, membership);
    state.installed.set(agent, dispose);
    if (membership.role === 'lead') maybeAutoStart(ctx, state, agent, source);
  } catch (error) {
    warn(ctx, `could not install scope for ${agent.id}: ${messageOf(error)}`);
  }
}

/** @param {object} ctx - Host context. @param {object} state - plugin state. */
function scheduleSettingsSync(ctx, state) {
  if (state.settingsTimer !== undefined) clearTimeout(state.settingsTimer);
  state.settingsTimer = setTimeout(() => {
    state.settingsTimer = undefined;
    if (state.disposed) return;
    try {
      const settings = ctx.get('settings');
      const descriptor = settings?.describe?.().find((entry) => entry.ns === ENTRY_ID);
      if (descriptor?.value !== undefined) {
        // Re-normalize: the settings document is raw and may spell a mode loosely.
        state.config = configSnapshot({ ...state.config, ...descriptor.value });
      }
    } catch (error) {
      warn(ctx, `could not reread settings: ${messageOf(error)}`);
    }
    for (const id of state.leads) {
      const lead = ctx.agents.get(id);
      if (lead !== undefined) scheduleModelSync(ctx, state, lead);
    }
    // The trim switch is live: re-derive every employee's allow list here rather
    // than waiting for a remount. Unchanged lists are skipped inside.
    for (const { agent, role } of state.employees.values()) {
      applyToolFilter(ctx, state, agent, role);
    }
  }, 120);
}

/**
 * Host plugin entry.
 * @param {object} ctx - Host context.
 * @param {object} config - validated plugin Config.
 */
export function apply(ctx, config) {
  const state = {
    config: configSnapshot(config),
    installed: new Map(),
    leads: new Set(),
    /** agentId -> { agent, role } for every installed employee. */
    employees: new Map(),
    /** agentId -> { allow, dispose } for the live tool whitelist, if any. */
    toolFilters: new Map(),
    syncTimers: new Map(),
    modelTimers: new Map(),
    /** agentId -> { spec, message } for a configured model that is not applied. */
    modelErrors: new Map(),
    modelQueue: Promise.resolve(),
    settingsTimer: undefined,
    /** leadId -> 'queued' | 'running' | 'done' | 'failed'. */
    autoStart: new Map(),
    /** leadId -> AbortController of the in-flight formation run. */
    autoRuns: new Map(),
    /** Message ids already routed through the @ prefix (forwarded or degraded). */
    dispatched: new Set(),
    disposed: false,
  };

  for (const agent of ctx.agents.list()) maybeInstall(ctx, state, agent, 'resume');

  ctx.on('agent/created', ({ agent, source }) => {
    maybeInstall(ctx, state, agent, source);
  });

  ctx.on('agent/disposed', ({ agent }) => {
    const dispose = state.installed.get(agent);
    if (dispose !== undefined) {
      try {
        dispose();
      } catch {
        // ignore
      }
      state.installed.delete(agent);
    }
    const controller = state.autoRuns.get(agent.id);
    if (controller !== undefined) {
      state.autoRuns.delete(agent.id);
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }
    state.autoStart.delete(agent.id);
  });

  ctx.on('agent/pre-step', async (payload, next) => {
    // `next()` runs exactly once and only outside the try: a downstream throw must
    // not fall through to a second `next()` (which would run the rest of the
    // waterfall twice).
    let decision;
    try {
      decision = await leadPreStepDecision(ctx, state, payload);
    } catch (error) {
      warn(ctx, `could not route a Lead step: ${messageOf(error)}`);
      decision = undefined;
    }
    if (decision !== undefined) return decision;
    return next();
  });

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'model/selection') return;
    const agent = ctx.agents.get(session.id);
    if (agent === undefined) return;
    let membership;
    try {
      membership = ctx.agentTeams.tryMembership(agent);
    } catch {
      return;
    }
    if (membership?.role === 'lead') scheduleModelSync(ctx, state, agent);
  });

  ctx.on('settings/document-updated', (ns) => {
    if (ns === ENTRY_ID) scheduleSettingsSync(ctx, state);
  });

  ctx.effect(
    () => () => {
      state.disposed = true;
      for (const timer of state.syncTimers.values()) clearTimeout(timer);
      state.syncTimers.clear();
      for (const timer of state.modelTimers.values()) clearTimeout(timer);
      state.modelTimers.clear();
      if (state.settingsTimer !== undefined) clearTimeout(state.settingsTimer);
      for (const controller of state.autoRuns.values()) {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }
      state.autoRuns.clear();
      state.autoStart.clear();
      state.dispatched.clear();
      state.modelErrors.clear();
      for (const id of [...state.toolFilters.keys()]) releaseToolFilter(state, id);
      state.employees.clear();
      for (const dispose of state.installed.values()) {
        try {
          dispose();
        } catch {
          // ignore
        }
      }
      state.installed.clear();
      state.leads.clear();
    },
    'work-team:agent-scopes',
  );
}
