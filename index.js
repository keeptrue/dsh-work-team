/**
 * Work Team Host half.
 *
 * The durable roster, shared task board, and peer messaging belong to
 * `@deepseek-ai/dsh-experimental-agent-team`. This plugin adds the product
 * layer: built-in role identities, per-role models, a boss guide, hiring tools,
 * and a capacity guard. It never owns child Agents; it only contributes
 * agent-scoped prompt/tool registrations and applies model selections.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
  BUDGET_MODES,
  budgetBlocks,
  budgetRefusal,
  budgetSnapshot,
  clampTokenBudget,
  normalizeBudgetMode,
} from './lib/budget.js';
import {
  REVIEWER_NAME,
  REVIEW_SCOPE_PREFIX,
  REVIEW_SUBJECT_PREFIX,
  acceptanceQueue,
  evidenceDescription,
  hasEvidence,
  hasEvidenceRecorded,
  reviewDescription,
  reviewMessage,
  reviewScopeFor,
  reviewSubject,
} from './lib/acceptance.js';
import { buildBenchNotice, isBenched, parseBenchRoles } from './lib/bench.js';
import { buildHandoverMarkdown } from './lib/handover.js';
import {
  autoStartIsActive,
  handsOffReason,
  normalizeAutoStart,
  planAutoStartLineup,
  shouldAutoStart,
} from './lib/autostart.js';
import {
  buildBenchFallback,
  buildDispatchFallback,
  buildDispatchReceipt,
  buildDispatchSendFailure,
  parseDispatch,
  resolveDispatchRole,
} from './lib/dispatch.js';
import { OWN_LAYER_TOOLS, employeeAllowList } from './lib/toolset.js';
import {
  deliverMessage,
  ensureTeamBoard,
  listTeammates,
  membershipOf,
  seatCount,
  spawnMember,
  usesSubagentTopology,
} from './lib/team-bridge.js';

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

/** Default team token ceiling: 0 = no ceiling. */
const DEFAULT_TOKEN_BUDGET = 0;

/** Plugin configuration. All product knobs are volatile so Settings can edit them. */
export const Config = z.object({
  teamSize: z.number().step(1).min(1).max(MAX_TEAM_SIZE).default(DEFAULT_LINEUP.length).volatile(),
  reporting: z.string().default('milestones').volatile(),
  allowSelfHire: z.boolean().default(true).volatile(),
  maxWorkersPerEmployee: z.number().step(1).min(0).max(MAX_WORKERS).default(DEFAULT_MAX_WORKERS).volatile(),
  trimEmployeeTools: z.boolean().default(true).volatile(),
  employeeStepBudget: z.number().step(1).min(0).max(MAX_STEP_BUDGET).default(DEFAULT_STEP_BUDGET).volatile(),
  teamTokenBudget: z.number().step(1).min(0).default(DEFAULT_TOKEN_BUDGET).volatile(),
  tokenBudgetOnExceed: z.string().default(BUDGET_MODES[0]).volatile(),
  benchRoles: z.string().default('').volatile(),
  presetReviewer: z.string().default('').volatile(),
  presetResearcher: z.string().default('').volatile(),
  presetOps: z.string().default('').volatile(),
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
    // 0 is the documented "no ceiling" value, so the unparsable fallback is 0 too:
    // a typo in Settings must never invent a ceiling that refuses the Lead's work.
    teamTokenBudget: clampTokenBudget(config.teamTokenBudget),
    // Only an exact "block" hardens the gate; anything else reads as "warn", which
    // is the schema default and the safe reading of an older Settings document.
    tokenBudgetOnExceed: normalizeBudgetMode(config.tokenBudgetOnExceed),
    // Bench list: kept as the user's own text (aliases and all); parsing happens
    // where it is used, so a typo is reported at report time instead of being
    // silently normalised away here.
    benchRoles: typeof config.benchRoles === 'string' ? config.benchRoles : '',
    presetReviewer: typeof config.presetReviewer === 'string' ? config.presetReviewer.trim() : '',
    presetResearcher:
      typeof config.presetResearcher === 'string' ? config.presetResearcher.trim() : '',
    presetOps: typeof config.presetOps === 'string' ? config.presetOps.trim() : '',
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
async function teammatesOf(ctx, lead, signal) {
  return listTeammates(ctx, lead, signal);
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
function recordModelFailure(ctx, state, agent, route, kind, detail = '') {
  const spec = formatModelSpec(route);
  const previous = state.modelErrors.get(agent.id);
  state.modelErrors.set(agent.id, { spec, kind, detail });
  if (
    previous !== undefined &&
    previous.spec === spec &&
    previous.kind === kind &&
    previous.detail === detail
  ) {
    return;
  }
  // The roster name is not available on this path (it runs before the report), so
  // the diagnostic uses the best label at hand. `team_status` re-renders the same
  // reason with the roster name, which is why only the reason is stored.
  const label = state.employees.get(agent.id)?.role?.id ?? agent.id;
  warn(ctx, modelErrorLine(label, { spec, kind, detail }));
}

/**
 * One model error, in words the Lead can act on.
 *
 * Every line answers the three questions the old sentence did not: which role,
 * which model, and whose fault it is — a missing kernel capability, an invalid
 * route, or a failed write. The English API phrase stays inside the sentence so a
 * reader can still match it to the kernel's own error.
 * @param {string} label - role id or roster name of the employee.
 * @param {{ spec: string, kind: string, detail: string }} entry - stored reason.
 * @returns {string} one actionable line.
 */
function modelErrorLine(label, entry) {
  const model = entry.spec === '' ? '（未指定）' : entry.spec;
  switch (entry.kind) {
    case 'unparsable':
      return `${label} 的模型配置格式不对（unparsable model spec "${entry.detail}"）：要 provider::model[::effort]，例如 workbuddy-cn::deepseek-v4.1-flash；改对之前这个角色跟随主对话模型。`;
    case 'llm-missing':
      return `${label} 的模型 ${model} 没有应用：本机没有挂载 llm 服务（llm service unavailable），无法校验 provider/model；这个角色跟随主对话模型。`;
    case 'no-registry':
      return `${label} 的模型 ${model} 没有应用：这个 DSH 内核没有 Agent 级模型选择注册表（sessionController exposes no selection registry），员工级模型无法生效，该角色只能跟随主对话模型；要按角色配模型需要内核提供 sessionController.agents.selectForNextRequest。`;
    case 'write-failed':
      return `${label} 的模型 ${model} 没有应用：写入会话模型选择失败——${entry.detail}；重试一次，仍失败就检查该会话是否可写。`;
    default:
      return `${label} 的模型 ${model} 没有应用：路由校验失败——${entry.detail}；检查 provider/model 是否在本机注册。`;
  }
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
      return recordModelFailure(ctx, state, agent, desired, 'route-invalid', messageOf(error));
    }
    if (resolved === undefined) {
      return recordModelFailure(ctx, state, agent, desired, 'llm-missing');
    }
    if (sameSelection(currentSelection(ctx, agent), resolved)) {
      return clearModelFailure(state, agent);
    }
    const registry = ctx.sessionController?.agents;
    if (typeof registry?.selectForNextRequest !== 'function') {
      return recordModelFailure(ctx, state, agent, resolved, 'no-registry');
    }
    try {
      registry.selectForNextRequest(agent, resolved);
    } catch (error) {
      return recordModelFailure(ctx, state, agent, resolved, 'write-failed', messageOf(error));
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
      recordModelFailure(ctx, state, agent, undefined, 'unparsable', configured.trim()),
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
    membership = membershipOf(ctx, lead);
  } catch {
    return;
  }
  if (membership?.role !== 'lead') return;
  let members;
  try {
    members = await teammatesOf(ctx, lead);
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
    const prompt = agent.ctx.systemPrompt;
    // Present in both 0.2.1 and 0.2.2; the guard keeps a future drop from
    // turning a prompt-order miss into an install failure.
    if (typeof prompt?.getSectionOrder !== 'function') return fallback;
    const value = prompt.getSectionOrder(name);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** @param {object} ctx - Host context. @param {unknown} agent - candidate Agent. @returns {import('@deepseek-ai/dsh-agent').Agent} the Lead. */
function requireLead(ctx, agent) {
  const membership = agent === undefined ? undefined : membershipOf(ctx, agent);
  if (membership?.role !== 'lead') {
    throw new Error('This tool belongs to the Work Team Lead (the main conversation).');
  }
  return agent;
}

/** @param {object} ctx - Host context. @param {unknown} agent - candidate Agent. @returns {{ root: object, name: string }} teammate identity. */
function requireTeammate(ctx, agent) {
  const membership = agent === undefined ? undefined : membershipOf(ctx, agent);
  if (membership?.role !== 'teammate') {
    throw new Error('This tool belongs to a Work Team employee.');
  }
  return membership;
}

/** The exact sentence the Team service throws when its board is closed for this Session. */
const TEAM_DISABLED_SENTENCE = 'enable Agent Teams for this Session before using the task board';

/**
 * Whether one failure is the kernel's "the board is closed" refusal.
 *
 * Matched on the code first, then on the whole sentence: the code is the
 * contract, but a refusal can cross a remote or bundled boundary and lose it,
 * and the text is what actually reached the model before this fix. The sentence
 * is matched in full rather than by its opening words so that a different
 * refusal from the same service (`enable Agent Teams …` is how both the gate and
 * a UI hint could start) is not swallowed as a closed board. Everything else is
 * a real board failure and is reported as one.
 * @param {unknown} error - thrown value.
 * @returns {boolean} true when the board is simply closed.
 */
function isBoardClosed(error) {
  if (error === null || typeof error !== 'object') return false;
  if (error.code === 'TEAM_DISABLED') return true;
  return messageOf(error).includes(TEAM_DISABLED_SENTENCE);
}

/** Leads already warned about a board that would not open: one line per Session is enough. */
const warnedBoards = new WeakSet();

/**
 * Board opens in flight, as host context -> (root Session id -> promise).
 *
 * `ensureTeamBoard` is a read-then-write pair (`isEnabled`, then `setEnabled`),
 * which is not atomic: `team_status` and `dispatch_tasks` called in the same step
 * can both see a closed board and each append a `team/mode` event. Sharing one
 * in-flight promise per Session makes the pair single-flight, so a turn opens the
 * board once however many tools ask for it. The outer WeakMap keeps two
 * compositions in one process (a test fixture, or a reloaded plugin) from
 * coalescing on each other's Session ids.
 */
const boardOpens = new WeakMap();

/**
 * The in-flight map for one host context.
 * @param {object} ctx - Host context.
 * @returns {Map<string, Promise<string>>} Session id -> open in flight.
 */
function boardOpensOf(ctx) {
  let opens = boardOpens.get(ctx);
  if (opens === undefined) {
    opens = new Map();
    boardOpens.set(ctx, opens);
  }
  return opens;
}

/**
 * Run one board open and keep the diagnostic to a single line per Session.
 * @param {object} ctx - Host context.
 * @param {object} lead - team Lead.
 * @returns {Promise<'on' | 'off' | 'unavailable' | 'unsupported'>} board state.
 */
async function openBoard(ctx, lead) {
  const result = await ensureTeamBoard(ctx, lead);
  const warnable = lead !== null && typeof lead === 'object';
  if (result.state === 'unavailable' && warnable && !warnedBoards.has(lead)) {
    warnedBoards.add(lead);
    warn(ctx, `the shared task board could not be opened: ${result.reason ?? 'no reason reported'}`);
  }
  return result.state;
}

/**
 * Open this Session's task board before a board operation, and return its state.
 *
 * Two things are load-bearing here rather than in the bridge. First, concurrent
 * callers share one open: the kernel's switch is a read followed by a write, so
 * two tools in the same step would otherwise append two `team/mode` events and
 * flush twice. Second, the outcome is returned instead of thrown — a closed or
 * broken board degrades the operation that needed it (an empty task list, a
 * hiring request sent as a message), never the whole turn.
 *
 * Every call site hands in the root Agent (`requireLead`, or
 * `requireTeammate(...).root`), so `lead.session.id` is the root Session id and
 * the right coalescing key.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - the team root.
 * @returns {Promise<'on' | 'off' | 'unavailable' | 'unsupported'>} board state.
 */
async function ensureBoard(ctx, lead) {
  const key = lead === null || typeof lead !== 'object' ? undefined : (lead.session?.id ?? lead.id);
  if (typeof key !== 'string' || key === '') return openBoard(ctx, lead);
  const opens = boardOpensOf(ctx);
  const flying = opens.get(key);
  if (flying !== undefined) return flying;
  const opening = openBoard(ctx, lead).finally(() => {
    opens.delete(key);
  });
  opens.set(key, opening);
  return opening;
}

/**
 * Read the shared task board without letting a closed board end the turn.
 *
 * `listTasks` throws `TEAM_DISABLED` on a Session whose Team mode is off. That is
 * a state, not a fault: the roster half of `team_status` is still useful, so the
 * list degrades to empty and the caller reports which switch is closed. Any other
 * failure is a real one and is worth a diagnostic.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - team Lead.
 * @returns {{ tasks: object[], board: 'on' | 'off' | 'unavailable' }} task rows and how the read went.
 */
function safeTaskList(ctx, lead) {
  try {
    const tasks = ctx.agentTeams.listTasks(lead);
    return { tasks: Array.isArray(tasks) ? tasks : [], board: 'on' };
  } catch (error) {
    if (isBoardClosed(error)) return { tasks: [], board: 'off' };
    warn(ctx, `could not read the shared task board: ${messageOf(error)}`);
    return { tasks: [], board: 'unavailable' };
  }
}

/**
 * Reconcile the switch attempt with what the board actually said.
 *
 * The list is the ground truth: if it came back, the board is on. A closed list
 * means the board stays off, and the switch attempt explains why — the user
 * closed it (that answer is kept), this kernel has no switch at all (0.2.1,
 * where a closed list can only be some other fault), or the switch itself
 * failed. Reading the two together keeps the report honest without a second
 * probe of the service.
 *
 * @param {'on' | 'off' | 'unavailable' | 'unsupported'} opened - `ensureBoard` result.
 * @param {'on' | 'off' | 'unavailable'} listed - `safeTaskList` result.
 * @returns {'on' | 'off' | 'unavailable' | 'unsupported'} board state for the report.
 */
function boardStateOf(opened, listed) {
  if (listed === 'on') return 'on';
  if (listed === 'unavailable') return 'unavailable';
  if (opened === 'off') return 'off';
  if (opened === 'unsupported') return 'unsupported';
  return 'unavailable';
}

/**
 * The one line `team_status` adds when the board is not readable.
 *
 * Naming the switch matters: an empty task list with no explanation reads as "the
 * team has no work", and the Lead would then assign tasks instead of opening the
 * board they would land on.
 *
 * @param {'on' | 'off' | 'unavailable' | 'unsupported'} board - resolved board state.
 * @returns {string} actionable hint, or an empty string when the board is fine.
 */
function boardNote(board) {
  if (board === 'on') return '';
  if (board === 'off') {
    return 'The shared task board is switched off for this Session: turn on Agent Teams in the session panel (the Team switch). This plugin never overrides that choice.';
  }
  if (board === 'unsupported') {
    return 'This DSH build has no per-Session Team switch, and the task board could not be read; check that the agentTeams service is mounted.';
  }
  return 'The shared task board could not be opened; retry team_status, or turn on Agent Teams for this Session in the session panel.';
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

/** @param {string} description - field description. */
function booleanField(description) {
  return { type: 'boolean', required: true, description };
}

/** @param {unknown} _args - tool args. @param {unknown} value - canonical value. */
function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value) }];
}

/**
 * Which team backend this composition mounts, as a name a person can act on.
 *
 * The probe answers a different question from `usesSubagentTopology()`: that one
 * asks "is the tree API here", this one asks "is *anything* here". A composition
 * where neither the 0.2.2 tree nor the 0.2.1 `tryMembership` resolves is not a
 * topology, it is a broken mount — and `team_status` says so instead of quietly
 * looking like an empty team.
 *
 * Never throws: it runs inside a report that must always render.
 * @param {object} ctx - Host context.
 * @returns {{ topology: 'subagent-tree' | 'team-service' | 'unsupported', note: string }} probe result.
 */
export function teamTopologyOf(ctx) {
  try {
    if (usesSubagentTopology(ctx)) return { topology: 'subagent-tree', note: '' };
  } catch (error) {
    return {
      topology: 'unsupported',
      note: `the subagent tree probe threw: ${messageOf(error)}`,
    };
  }
  try {
    if (typeof ctx?.agentTeams?.tryMembership === 'function') {
      return { topology: 'team-service', note: '' };
    }
  } catch (error) {
    return {
      topology: 'unsupported',
      note: `the Team service probe threw: ${messageOf(error)}`,
    };
  }
  return {
    topology: 'unsupported',
    note:
      'neither the 0.2.2 subagent tree (ctx.subagents.rootOf + namesOf) nor the 0.2.1 Team service (agentTeams.tryMembership) answered; roster, board, and budget reports are unavailable on this composition.',
  };
}

/**
 * One Agent's lifetime token total, and whether it could be read at all.
 *
 * Same read the per-member row of `team_status` has always used, hoisted so the
 * budget is the sum of exactly those numbers. `known: false` is not the same as
 * 0 tokens: it means this member's spend is missing from the sum, which biases
 * the budget DOWNWARD (a ceiling looks further away than it is). Callers count
 * those members instead of adding a silent zero.
 *
 * An absent projection with a live Agent is read as 0 and reported as known: the
 * session simply has no usage recorded yet, and the kernel's projection answers
 * that with `undefined` on both versions.
 * @param {object} ctx - Host context.
 * @param {object | undefined} agent - live Agent.
 * @returns {{ tokens: number, known: boolean }} tokens and whether they are real.
 */
function tokenReadingOf(ctx, session) {
  // Usage belongs to the SESSION, not to the Agent: an employee that finished its
  // turn has no live Agent (`ctx.agents.get` is documented as "look up a live
  // agent"), but its session log still carries the lifetime total, and that is
  // exactly what the office panel reads. Reading through the Agent made a team of
  // idle teammates look unmeasurable.
  //
  // The two failure reasons are distinct on purpose. `no-session` means this
  // plugin has no Session object for the id (the composition has no
  // `ctx.sessions`, or the session was never loaded into the store);
  // `projection-error` means a Session was found and the read threw. Both mean
  // "this member's spend is missing from the sum", so `unknown` counts them
  // together, but the note names which one it was.
  if (session === undefined || session === null) {
    return { tokens: 0, known: false, reason: 'no-session' };
  }
  try {
    const usage = ctx.sessionProjections.stateOf(session, 'tokenUsage');
    return { tokens: sumTokenTotals(usage?.totals), known: true, reason: '' };
  } catch {
    return { tokens: 0, known: false, reason: 'projection-error' };
  }
}

/**
 * The Session store, if this composition mounted one.
 *
 * Probed with `ctx.get` (like `subagents` in the bridge) instead of injected: a
 * composition without it must still load the plugin and report the degraded
 * reading, not refuse to mount. This is the ONLY way the plugin may reach the
 * service — `ctx.sessions` is not an injected property here, so reading it
 * directly silently yields `undefined` and every lookup becomes "not loaded".
 * @param {object} ctx - Host context.
 * @returns {object | undefined} the service, or undefined.
 */
function sessionServiceOf(ctx) {
  try {
    if (typeof ctx?.get === 'function') {
      const viaGet = ctx.get('sessions');
      if (viaGet !== undefined && viaGet !== null) return viaGet;
    }
    return ctx?.sessions;
  } catch {
    return ctx?.sessions;
  }
}

/**
 * The Session to read one member's usage from.
 *
 * `ctx.sessions.get(id)` is the id-keyed hook the Host owns: for a resident
 * teammate it hands back the same Session object the Agent would carry, and it
 * does not care whether an Agent is currently attached. The live Agent is kept as
 * a second chance for compositions that mount `agents` but not `sessions`.
 * @param {object} ctx - Host context.
 * @param {string} id - session / member id.
 * @returns {object | undefined} a Session, or undefined when neither path has one.
 */
function sessionForUsage(ctx, id) {
  try {
    const service = sessionServiceOf(ctx);
    const session = typeof service?.get === 'function' ? service.get(id) : undefined;
    if (session !== undefined && session !== null) return session;
  } catch {
    // Fall through to the Agent path; the read below reports what it finds.
  }
  try {
    return ctx.agents.get(id)?.session;
  } catch {
    return undefined;
  }
}

/**
 * Whether this composition exposes the id-keyed session store.
 *
 * Deliberately probed instead of injected: `sessions` is read the same way
 * `team-bridge` reads `subagents` (`ctx.get`), so a composition without it still
 * loads the plugin and reports the degraded reading in `health.note` rather than
 * refusing to mount.
 * @param {object} ctx - Host context.
 * @returns {boolean} true when usage can be read per Session id.
 */
function hasSessionStore(ctx) {
  try {
    return typeof sessionServiceOf(ctx)?.get === 'function';
  } catch {
    return false;
  }
}

/**
 * Measure the team against its configured ceiling.
 *
 * Usage is the Lead's own Session plus every employee's lifetime total — the
 * team's spend, not the process's: sessions that are not on this roster (a user
 * fork, a temporary worker, another conversation) are deliberately not counted.
 * Members whose usage cannot be read are counted in `unknown` rather than added
 * as zero, so the report never looks cheaper than it is.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {object} lead - team Lead.
 * @param {object[]} members - roster rows from `teammatesOf`.
 * @returns {{ used: number, limit: number, mode: string, exceeded: boolean, topRole: string }} budget block plus the biggest consumer.
 */
function teamUsageOf(ctx, lead, members) {
  const leadReading = tokenReadingOf(ctx, lead.session);
  let used = leadReading.tokens;
  // The Lead is a member of the team for this measurement, so an unreadable Lead
  // session counts too — silently dropping it would understate the spend the
  // same way a missing employee would.
  let unknown = 0;
  let missingSession = 0;
  let projectionError = 0;
  /** @param {{ known: boolean, reason: string }} reading - one member's reading. */
  const countUnknown = (reading) => {
    if (reading.known) return;
    unknown += 1;
    if (reading.reason === 'projection-error') projectionError += 1;
    else missingSession += 1;
  };
  countUnknown(leadReading);
  /** @type {Map<string, { tokens: number, known: boolean, reason: string }>} */
  const readings = new Map();
  let topRole = '';
  let topTokens = leadReading.tokens;
  for (const member of members) {
    const reading = tokenReadingOf(ctx, sessionForUsage(ctx, member.id));
    readings.set(member.id, reading);
    countUnknown(reading);
    used += reading.tokens;
    if (reading.tokens > topTokens) {
      topTokens = reading.tokens;
      topRole = member.name;
    }
  }
  return { used, unknown, missingSession, projectionError, topRole, readings };
}

/**
 * `teamUsageOf` plus the configured ceiling, for the paths that only need the gate.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {object} lead - team Lead.
 * @param {object[]} members - roster rows.
 * @returns {{ used: number, limit: number, mode: string, exceeded: boolean, unknown: number, note: string, topRole: string }} budget block.
 */
function measureBudget(ctx, state, lead, members) {
  const usage = teamUsageOf(ctx, lead, members);
  const budget = budgetSnapshot(
    usage.used,
    state.config.teamTokenBudget,
    state.config.tokenBudgetOnExceed,
    usage.unknown,
    { missingSession: usage.missingSession, projectionError: usage.projectionError },
  );
  return { ...budget, topRole: usage.topRole };
}

/**
 * Measure the team budget without letting a roster read end the call.
 *
 * Every spending path already needs the roster for something else; this one
 * needs it only for the sum, so a broken registry degrades the number to the
 * Lead's own spend instead of failing the dispatch.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {object} lead - team Lead.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<{ used: number, limit: number, mode: string, exceeded: boolean, topRole: string }>} budget block.
 */
async function teamBudget(ctx, state, lead, signal) {
  let members = [];
  try {
    members = await teammatesOf(ctx, lead, signal);
  } catch (error) {
    warn(ctx, `could not read the roster while measuring the token budget: ${messageOf(error)}`);
  }
  return measureBudget(ctx, state, lead, members);
}

/**
 * The per-row `review` receipt, empty for a row that asked for none.
 * @returns {object} zero-valued review receipt.
 */
function noReview() {
  return {
    requested: false,
    created: false,
    degraded: false,
    taskId: '',
    subject: '',
    ownerAssigned: false,
    blockedBy: [],
    messageId: '',
    note: '',
  };
}

/**
 * Append one review task to the board for a dispatched row.
 *
 * The Team service creates a task *unowned and pending*; there is no owner field
 * on `createTask`. So the intended reviewer is recorded in three steps, each of
 * which the service actually supports: `createTask`, then `reassign` (which is
 * what writes `ownerName`), then `set_dependencies` (which is the only way to
 * add a blocker after creation — `reassign` itself refuses a blocked task, so the
 * order matters and cannot be rearranged).
 *
 * Every partial outcome is reported instead of retried: a review task that
 * exists but carries no owner is still useful, and pretending otherwise would
 * make the office panel lie.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - team Lead (the only member who may reassign).
 * @param {object} row - dispatch row: role, task, acceptance, implTaskId, members.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} review receipt; `degraded` means "sent as a message instead".
 */
async function reviewTaskFor(ctx, lead, row, signal) {
  const subject = reviewSubject(row.task);
  const description = reviewDescription(row);
  const base = { ...noReview(), requested: true, subject };
  let current;
  try {
    current = await ctx.agentTeams.createTask(
      lead,
      { subject, description, writeScopes: [reviewScopeFor(row.implTaskId)] },
      signal,
    );
  } catch (error) {
    if (!isBoardClosed(error)) {
      return { ...base, note: `审查任务没有建成：${messageOf(error)}` };
    }
    return degradeReview(ctx, lead, { subject, description }, error, signal);
  }
  let note = '';
  let ownerAssigned = false;
  const reviewer = row.members.find((member) => member.name === REVIEWER_NAME);
  if (reviewer === undefined) {
    note = `团队里还没有 ${REVIEWER_NAME}（小审），审查任务留在板上等认领。`;
  } else {
    try {
      current = await ctx.agentTeams.updateTask(
        lead,
        {
          taskId: current.id,
          expectedRevision: current.revision,
          action: 'reassign',
          // The same field means different things on the two kernels: 0.2.2
          // resolves a SessionId, 0.2.1 resolves a member NAME
          // (`resolveActiveMember`). Sending the wrong one fails with
          // TEAM_MEMBER_NOT_FOUND and leaves the review unowned.
          owner: reassignOwnerOf(ctx, reviewer),
        },
        signal,
      );
      ownerAssigned = true;
    } catch (error) {
      note = `审查任务建成了，但没有指派给 ${REVIEWER_NAME}：${messageOf(error)}`;
    }
  }
  let blockedBy = [];
  if (row.implTaskId !== '') {
    try {
      current = await ctx.agentTeams.updateTask(
        lead,
        {
          taskId: current.id,
          expectedRevision: current.revision,
          action: 'set_dependencies',
          blockedBy: [row.implTaskId],
        },
        signal,
      );
      blockedBy = [row.implTaskId];
    } catch (error) {
      note = [note, `没能把审查任务挂到 ${row.implTaskId} 上：${messageOf(error)}`]
        .filter((line) => line !== '')
        .join(' ');
      // The description was written claiming that dependency. Rewrite that one
      // sentence rather than leave the board asserting a relationship the task
      // graph does not carry — a reviewer acting on it would wait for nothing.
      try {
        current = await ctx.agentTeams.updateTask(
          lead,
          {
            taskId: current.id,
            expectedRevision: current.revision,
            action: 'edit',
            description: reviewDescription({
              ...row,
              link: `${row.implTaskId}（依赖没有挂上：${messageOf(error)}）`,
            }),
          },
          signal,
        );
      } catch {
        // The receipt's note already says it; a second failure is not worth
        // another line of noise in the row.
      }
    }
  }
  return {
    ...base,
    created: true,
    taskId: current.id,
    subject: current.subject ?? subject,
    ownerAssigned,
    blockedBy,
    note,
  };
}

/**
 * File a review request as a message because the board could not take it.
 *
 * A closed board is a state; the gate the Lead asked for still has to arrive, so
 * this is the one delivery path that must not fail silently. A second failure
 * (no reviewer on the roster) is reported in `note` rather than thrown: it
 * belongs to this row, not to the batch.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - team Lead.
 * @param {{ subject: string, description: string }} task - the review task that could not be filed.
 * @param {unknown} cause - why the board refused it.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} degraded review receipt.
 */
async function degradeReview(ctx, lead, task, cause, signal) {
  const base = { ...noReview(), requested: true, degraded: true, subject: task.subject };
  try {
    const receipt = await deliverMessage(ctx, lead, {
      target: REVIEWER_NAME,
      content: [{ type: 'text', text: reviewMessage(task) }],
      signal,
    });
    return {
      ...base,
      messageId: typeof receipt?.messageId === 'string' ? receipt.messageId : '',
      note: `共享任务板不可用（${messageOf(cause)}），审查请求改走消息发给 ${REVIEWER_NAME}。`,
    };
  } catch (error) {
    return {
      ...base,
      note: `共享任务板不可用（${messageOf(cause)}），发给 ${REVIEWER_NAME} 的消息也没送达：${messageOf(error)}。`,
    };
  }
}

/**
 * The assignee value `updateTask({ action: 'reassign' })` expects here.
 *
 * 0.2.2's `resolveAssignee` looks the value up as a `SessionId`; 0.2.1's
 * `resolveActiveMember` treats it as a member name. Both kernels answer the same
 * question, so the bridge picks the spelling instead of assuming one.
 * @param {object} ctx - Host context.
 * @param {{ id: string, name: string }} member - roster row.
 * @returns {string} the value that kernel resolves.
 */
function reassignOwnerOf(ctx, member) {
  return usesSubagentTopology(ctx) ? member.id : member.name;
}

/**
 * Route one dispatched row's review request to the board or to the reviewer.
 *
 * `unsupported` is not a closed board: it is a kernel with no per-Session Team
 * switch (0.2.1), whose board is always open, so that case goes to the board.
 * @param {object} ctx - Host context.
 * @param {object} lead - team Lead.
 * @param {'on' | 'off' | 'unavailable' | 'unsupported'} board - resolved board state.
 * @param {object[]} members - roster rows, for resolving the reviewer.
 * @param {{ roleId: string, roleName: string, task: string, acceptance: string, implTaskId: string }} row - row identity.
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<object>} review receipt.
 */
async function reviewFor(ctx, lead, board, members, row, signal) {
  if (board === 'off' || board === 'unavailable') {
    const cause = new Error(
      board === 'off'
        ? 'this Session has Agent Teams switched off'
        : 'the task board could not be opened',
    );
    return degradeReview(
      ctx,
      lead,
      { subject: reviewSubject(row.task), description: reviewDescription(row) },
      cause,
      signal,
    );
  }
  return reviewTaskFor(ctx, lead, { ...row, members }, signal);
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
  // A new employee is only useful if it can reach the shared board — the
  // `team_task_*` tools it needs are gated by the same Session switch — so the
  // board is opened before the hire, not after the first failed task.
  await ensureBoard(ctx, lead);
  const members = await teammatesOf(ctx, lead, signal);
  const existing = members.find((member) => member.name === role.id);
  if (existing !== undefined) {
    if (existing.status === 'failed') {
      throw new Error(
        `Teammate "${role.id}" previously failed; its name cannot be reused in this session. Start a new session for a fresh team.`,
      );
    }
    if (task !== undefined && task.trim() !== '') {
      await deliverMessage(ctx, lead, {
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
  const result = await spawnMember(ctx, lead, {
    name: role.id,
    description: role.zh.description,
    prompt: [{ type: 'text', text: firstPrompt }],
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
  // Open the board before the lanes start, not from inside the first spawn:
  // one switch write is enough for the whole run, and doing it here keeps the
  // two lanes' await depth identical, so seats are still claimed and reported in
  // claim order.
  await ensureBoard(ctx, lead);
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
  const takeNextSeat = async () => {
    if (state.disposed || signal.aborted) return undefined;
    if (state.config.autoStart === 'off') return undefined;
    let members;
    try {
      members = await teammatesOf(ctx, lead);
    } catch (error) {
      warn(ctx, `could not list teammates while forming the team: ${messageOf(error)}`);
      return undefined;
    }
    const capacity = clampTeamSize(state.config.teamSize, DEFAULT_LINEUP.length, MAX_TEAM_SIZE);
    // Occupied seats = roster rows + seats another lane is already spawning.
    const present = new Set([...members.map((member) => member.name), ...inFlight]);
    // Automatic formation honours the bench for the same reason `team_start`
    // does: a benched seat must not be filled by the background run either.
    const bench = parseBenchRoles(state.config.benchRoles);
    const lineup = DEFAULT_LINEUP.filter((id) => !isBenched(bench, id));
    const pending = planAutoStartLineup(lineup, capacity, present).filter(
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
          const id = await takeNextSeat();
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
    membership = membershipOf(ctx, agent);
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

  // A benched seat takes no new work, forward or otherwise. Checked before the
  // roster read so the answer is the same whether the employee is hired or not.
  if (isBenched(parseBenchRoles(state.config.benchRoles), role.id)) {
    rememberDispatch(state, message.id);
    return rewrite(buildBenchFallback(role, parsed.body));
  }

  let member;
  try {
    member = (await teammatesOf(ctx, lead, signal)).find((row) => row.name === role.id);
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
    await deliverMessage(ctx, lead, {
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
    membership = agent === undefined ? undefined : membershipOf(ctx, agent);
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
      await ensureBoard(ctx, lead);
      const capacity = clampTeamSize(state.config.teamSize, DEFAULT_LINEUP.length, MAX_TEAM_SIZE);
      // The roster is needed for the reviewer's Session id, not to send the
      // order: a broken roster read must not take the whole batch down.
      let members = [];
      try {
        members = await teammatesOf(ctx, lead, exec.signal);
      } catch (error) {
        warn(ctx, `could not read the roster while dispatching: ${messageOf(error)}`);
      }
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
      const bench = parseBenchRoles(state.config.benchRoles);
      const batch = [];
      const benchedSkipped = [];
      let seats = capacity - members.length;
      for (const id of DEFAULT_LINEUP) {
        if (seats <= 0) break;
        if (present.has(id)) {
          skipped.push(id);
          continue;
        }
        // A benched seat is not filled: it holds no work, so hiring it would
        // spend a turn on nothing. The seat itself stays free for a working role.
        if (isBenched(bench, id)) {
          benchedSkipped.push(id);
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

      const baseNote =
        failed.length > 0
          ? 'Some hires failed; check the subagent capacity and the reasons above.'
          : size >= capacity
            ? `Team is at capacity (${size}/${capacity}). Raise the team size in the office panel to hire more.`
            : `Team has ${size}/${capacity} seats filled.`;
      // Benched seats are skipped, not hired: say so, or the Lead will wonder why
      // the roster stopped at six.
      const benchNote =
        benchedSkipped.length === 0
          ? ''
          : ` Skipped benched roles: ${benchedSkipped.join(', ')} (benchRoles); un-bench them before hiring.`;
      const note = `${baseNote}${benchNote}`;
      return { hired, skipped, failed, size, capacity, note };
    },
  });
}

/**
 * File one shared hiring-request task for a role the team cannot take right now.
 *
 * `request_hire` and the full-team fallback of the employee `hire_teammate` share
 * this so both produce the same subject and description, and the Lead reads one
 * shape of request on the task board. When the board is closed — by the user, or
 * because the switch would not open — the same text is delivered to the Lead's
 * inbox instead, and `delivered` says which of the two happened.
 *
 * @param {object} ctx - Host context.
 * @param {object} exec - tool execution context of the requesting employee.
 * @param {object} role - role definition.
 * @param {string} reason - why this role is needed.
 * @returns {Promise<{ taskId: string, subject: string, delivered: 'task' | 'message' }>} request identity and how it was filed.
 */
async function createHireRequest(ctx, exec, role, reason) {
  const membership = requireTeammate(ctx, exec.agent);
  const subject = `招聘申请：${role.zh.name}（${role.id}）`;
  const description = `申请人：${membership.name}\n角色：${role.zh.role}\n理由：${reason}`;
  /**
   * File the request as a message instead of a board task.
   *
   * The sender is the requesting employee, not the root: a root cannot address
   * itself on either kernel, and `lead` is a target name the bridge resolves to
   * the root's Session.
   * @returns {Promise<{ taskId: string, subject: string, delivered: 'message' }>} receipt.
   */
  const sendAsMessage = async () => {
    await deliverMessage(ctx, exec.agent, {
      target: 'lead',
      content: [{ type: 'text', text: `${subject}\n${description}` }],
      signal: exec.signal,
    });
    return { taskId: '', subject, delivered: 'message' };
  };
  // A board the user closed — or one that could not be opened — must not swallow
  // the request. `unsupported` is not one of those cases: it means a kernel with
  // no Session switch (0.2.1), whose board is always open, so treating it as
  // closed would quietly turn every 0.2.1 request into a private message.
  const board = await ensureBoard(ctx, membership.root);
  if (board === 'off' || board === 'unavailable') return sendAsMessage();
  try {
    const task = await ctx.agentTeams.createTask(exec.agent, {
      subject,
      description,
      writeScopes: [],
    });
    return { taskId: task.id, subject: task.subject, delivered: 'task' };
  } catch (error) {
    // The board can close between the switch and the write — the user toggling
    // Agent Teams off in the panel mid-turn. That race is the one failure where
    // the request still has to reach the Lead; anything else is a real error.
    if (!isBoardClosed(error)) throw error;
    return sendAsMessage();
  }
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
        requestId: stringField(
          'Hiring-request task id when no seat was free and the request landed on the board, otherwise an empty string.',
        ),
        delivered: stringField(
          'How the call landed: "hired" for a new teammate, "task" for a hiring request on the shared board, "message" for a hiring request delivered straight to the Lead because the board was closed, "refused" when the token budget blocked the hire.',
        ),
        accepted: booleanField(
          'Whether the call was allowed to run; false only when the team token budget refused it in block mode.',
        ),
        budget: objectSchema({
          used: integerField('Lifetime tokens spent by the Lead plus every employee.'),
          limit: integerField('Configured ceiling; 0 means unlimited.'),
          mode: stringField('warn or block.'),
          exceeded: booleanField('Whether the ceiling is reached.'),
          unknown: integerField(
            'Members whose usage could not be read; their spend is missing from used, so the real total may be higher. 0 when every member answered.',
          ),
          note: stringField('One line saying how many members could not be measured, or an empty string.'),
        }),
        actions: arrayField(
          'When the token budget refused this hire: three concrete actions to unblock it. Empty otherwise.',
          { type: 'string' },
        ),
      }),
      render: renderJson,
    },
    async execute(args, exec) {
      const role = roleById(args.role);
      if (role === undefined) throw new Error(`Unknown Work Team role "${String(args.role)}".`);
      // Bench first: an explicit hire request for a benched seat is a mistake the
      // Lead should see, not a silent extra employee.
      if (isBenched(parseBenchRoles(state.config.benchRoles), role.id)) {
        throw new Error(buildBenchNotice(role));
      }
      const lead = employee ? requireTeammate(ctx, exec.agent).root : requireLead(ctx, exec.agent);
      await ensureBoard(ctx, lead);
      const capacity = clampTeamSize(state.config.teamSize, DEFAULT_LINEUP.length, MAX_TEAM_SIZE);
      const members = await teammatesOf(ctx, lead);
      const existing = members.find((member) => member.name === role.id);
      const desired = desiredSelection(ctx, lead, role, state.config);
      const model = formatModelSpec(desired) === '' ? 'follow-main' : formatModelSpec(desired);
      // A hire spends a whole first turn, so it is the most expensive single call
      // in the plugin and the first thing a ceiling should stop.
      const budget = measureBudget(ctx, state, lead, members);
      const budgetBlock = {
        used: budget.used,
        limit: budget.limit,
        mode: budget.mode,
        exceeded: budget.exceeded,
        unknown: budget.unknown,
        note: budget.note,
      };
      if (budgetBlocks(budget)) {
        const payload = budgetRefusal(
          budget,
          `团队 token 预算已用尽（${budget.used}/${budget.limit}，block 档）：这次招人没有执行。`,
          budget.topRole,
        );
        return {
          ...hireRow(role),
          status: 'refused',
          model,
          task: '',
          created: false,
          requestId: '',
          delivered: 'refused',
          accepted: false,
          budget: payload.budget,
          actions: payload.actions,
        };
      }
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
          delivered: request.delivered,
          accepted: true,
          budget: budgetBlock,
          actions: [],
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
        delivered: 'hired',
        accepted: true,
        budget: budgetBlock,
        actions: [],
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
      'Send tasks to several Work Team teammates in one call, in parallel. Use this for assignments that do not depend on each other instead of one send_message after another; it saves a Lead turn per extra teammate. Each row names a built-in role (role id, for example "backend") and its task; rows are independent — an unknown role or a failed send is reported for that row only. Cancelling the turn cancels the whole batch: every row then reports accepted:false with the cancellation reason, which is a turn-level cancel rather than a per-row failure. Set review:true on a row to have the Host append a review task for the reviewer (blocked by that row\'s task when you pass taskId), and put the acceptance criteria in acceptance so the gate has something to check against. To hire a missing role first, use hire_teammate or team_start, then dispatch.',
    parameters: {
      assignments: arrayField(
        'One row per teammate, 1-8 rows.',
        objectSchema({
          role: stringField('Built-in role id, for example "backend".'),
          task: stringField('Self-contained task text for that teammate.'),
          acceptance: {
            type: 'string',
            description:
              'Optional acceptance criteria for this row: what the Lead will check before calling it done (for example "node --test test/ is green"). Carried into the review task so the reviewer judges the same bar.',
          },
          review: {
            type: 'boolean',
            description:
              'Optional quality gate. When true, the Host appends one review task ("审查：<task head>") owned by the reviewer, blocked by this row\'s task when taskId is given. A closed or broken board degrades the request to one message to the reviewer; the row itself still counts as sent.',
          },
          taskId: {
            type: 'string',
            description:
              'Optional shared-task id this row implements (for example "task-3"). When present and the board is usable, the review task is created with it as a blocker, so the reviewer is unblocked only after that task completes.',
          },
        }),
      ),
    },
    output: {
      schema: objectSchema({
        accepted: booleanField(
          'Whether this batch was dispatched at all; false only when the token budget refused it in block mode.',
        ),
        results: arrayField(
          'One receipt per row, in input order.',
          objectSchema({
            role: stringField('Role id the row resolved to, or the raw input when unknown.'),
            accepted: { type: 'boolean', required: true, description: 'Whether the message was sent.' },
            messageId: stringField('Team message id when accepted, otherwise an empty string.'),
            error: stringField('Why this row failed, or an empty string.'),
            review: objectSchema({
              requested: booleanField('Whether this row asked for a review.'),
              created: booleanField('Whether a review task was appended to the shared board.'),
              degraded: booleanField(
                'Whether the review request had to travel as a message because the board was closed or unusable.',
              ),
              taskId: stringField('Review task id when created, otherwise an empty string.'),
              subject: stringField('Review task subject, or an empty string when none was requested.'),
              ownerAssigned: booleanField(
                'Whether the review task was actually reassigned to the reviewer; false when the reviewer is not on the team.',
              ),
              blockedBy: arrayField(
                'Implementation task ids the review task now depends on; empty when the row had no task id.',
                { type: 'string' },
              ),
              messageId: stringField('Message id when the review request was degraded to a message.'),
              note: stringField('Why the review is partial or missing, or an empty string.'),
            }),
          }),
        ),
        sent: integerField('Rows accepted.'),
        failed: integerField('Rows rejected or failed.'),
        budget: objectSchema({
          used: integerField('Lifetime tokens spent by the Lead plus every employee.'),
          limit: integerField('Configured ceiling; 0 means unlimited.'),
          mode: stringField('warn or block.'),
          exceeded: booleanField('Whether the ceiling is reached.'),
          unknown: integerField(
            'Members whose usage could not be read; their spend is missing from used, so the real total may be higher. 0 when every member answered.',
          ),
          note: stringField('One line saying how many members could not be measured, or an empty string.'),
        }),
        actions: arrayField(
          'When the budget refused this batch: three concrete actions to unblock it. Empty otherwise.',
          { type: 'string' },
        ),
      }),
      render: renderJson,
    },
    async execute(args, exec) {
      const lead = requireLead(ctx, exec.agent);
      // The resolved state is load-bearing from here on: it decides whether a
      // review task can be filed or has to travel as a message.
      const board = await ensureBoard(ctx, lead);
      const assignments = Array.isArray(args.assignments) ? args.assignments : [];
      const budget = await teamBudget(ctx, state, lead, exec.signal);
      const budgetBlock = {
        used: budget.used,
        limit: budget.limit,
        mode: budget.mode,
        exceeded: budget.exceeded,
        unknown: budget.unknown,
        note: budget.note,
      };
      if (budgetBlocks(budget)) {
        // A block-mode refusal is one call-level answer, not a per-row verdict:
        // nothing was sent, so every row reports the same reason.
        const refusal = budgetRefusal(
          budget,
          `团队 token 预算已用尽（${budget.used}/${budget.limit}，block 档）：这批派单没有发出。`,
          budget.topRole,
        );
        return {
          accepted: false,
          results: assignments.map((assignment) => ({
            role: typeof assignment?.role === 'string' ? assignment.role.trim() : '',
            accepted: false,
            messageId: '',
            error: refusal.error,
            // The row asked for a gate and never got one: say so instead of
            // reporting "no review requested".
            review:
              assignment?.review === true
                ? { ...noReview(), requested: true, note: '这批派单被预算拦下，没有建审查任务。' }
                : noReview(),
          })),
          sent: 0,
          failed: assignments.length,
          budget: budgetBlock,
          actions: refusal.actions,
        };
      }
      const members = await teammatesOf(ctx, lead, exec.signal);
      const bench = parseBenchRoles(state.config.benchRoles);
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
              review: noReview(),
            };
          }
          if (task.trim() === '') {
            return {
              role: role.id,
              accepted: false,
              messageId: '',
              error: 'Task text is empty.',
              review: noReview(),
            };
          }
          if (isBenched(bench, role.id)) {
            return {
              role: role.id,
              accepted: false,
              messageId: '',
              error: buildBenchNotice(role),
              review:
                assignment?.review === true
                  ? { ...noReview(), requested: true, note: '停职角色没有派单，因此没有建审查任务。' }
                  : noReview(),
            };
          }
          try {
            const receipt = await deliverMessage(ctx, lead, {
              target: role.id,
              content: [{ type: 'text', text: task }],
              signal: exec.signal,
            });
            // The gate runs only after the order actually went out: a row that
            // never reached its implementer has nothing to review.
            const review =
              assignment?.review === true
                ? await reviewFor(ctx, lead, board, members, {
                    roleId: role.id,
                    roleName: role.zh.name,
                    task,
                    acceptance:
                      typeof assignment.acceptance === 'string' ? assignment.acceptance : '',
                    implTaskId:
                      typeof assignment.taskId === 'string' ? assignment.taskId.trim() : '',
                  }, exec.signal)
                : noReview();
            return {
              role: role.id,
              accepted: true,
              messageId: typeof receipt?.messageId === 'string' ? receipt.messageId : '',
              error: '',
              review,
            };
          } catch (error) {
            return {
              role: role.id,
              accepted: false,
              messageId: '',
              error: messageOf(error),
              review:
                assignment?.review === true
                  ? { ...noReview(), requested: true, note: '派单没有送达，因此没有建审查任务。' }
                  : noReview(),
            };
          }
        }),
      );
      return {
        accepted: true,
        results,
        sent: results.filter((row) => row.accepted).length,
        failed: results.filter((row) => !row.accepted).length,
        budget: budgetBlock,
        actions: [],
      };
    },
  });
}

/** @param {unknown} error - thrown value. @returns {boolean} whether this is a lost compare-and-set. */
function isStaleRevision(error) {
  return error !== null && typeof error === 'object' && error.code === 'TEAM_TASK_STALE_REVISION';
}

/**
 * The Lead's acceptance gate.
 *
 * "Done" is a claim until the Lead can name the evidence behind it: this tool is
 * the only path that closes a task, and it refuses to close one on an empty
 * `evidence` string — a refusal that changes nothing, not even a revision. With
 * evidence it records the evidence in the task's description and then completes
 * the task, in that order: the Team service's `complete` action ignores text
 * fields entirely (see `task-board.ts`, `case 'complete'`), so one write cannot
 * both carry the evidence and change the status. Both writes are
 * compare-and-set, and a lost race is retried once against a fresh revision
 * instead of reporting a false failure.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @returns {object} the accept_task tool definition.
 */
function makeAcceptTaskTool(ctx, state) {
  return defineTool({
    name: 'accept_task',
    description:
      'Close one shared task as accepted, with the evidence that justifies it. Use this instead of team_task_update when an employee reports done: a report without evidence is not accepted, so pass the concrete proof (test output, command line and its result, file paths, a diff or commit). An empty or whitespace-only evidence is refused and no task field changes. When the evidence is real, it is appended to the task description and the task is marked completed. A task that is still pending has to be claimed first, and a task whose blockers are still open cannot be accepted; a task already completed only receives the evidence, once. Acceptance is bookkeeping rather than spending, so the team token budget never refuses it — the receipt still reports what was used.',
    parameters: {
      taskId: {
        type: 'string',
        required: true,
        description: 'Shared task id to accept, for example "task-3".',
      },
      evidence: {
        type: 'string',
        required: true,
        description:
          'The proof that this is done: test output, the command you ran and what it printed, the files that changed, a diff or commit id. Blank or whitespace-only is refused.',
      },
    },
    output: {
      schema: objectSchema({
        accepted: booleanField(
          'Whether the task is now accepted and completed; false when the call was refused and nothing changed.',
        ),
        taskId: stringField('The task this call addressed.'),
        status: stringField('Task status after the call: completed, in_progress, pending, deleted, or empty when unknown.'),
        revision: integerField('Task revision after the call, 0 when the task could not be read.'),
        evidence: stringField('The trimmed evidence that was recorded, or an empty string.'),
        reason: stringField('Why the call was refused or only partly applied, or an empty string.'),
        budget: objectSchema({
          used: integerField('Lifetime tokens spent by the Lead plus every employee.'),
          limit: integerField('Configured ceiling; 0 means unlimited.'),
          mode: stringField('warn or block.'),
          exceeded: booleanField('Whether the ceiling is reached.'),
          unknown: integerField(
            'Members whose usage could not be read; their spend is missing from used, so the real total may be higher. 0 when every member answered.',
          ),
          note: stringField('One line saying how many members could not be measured, or an empty string.'),
        }),
        actions: arrayField(
          'When the token budget refused this call: three concrete actions to unblock it. Empty otherwise.',
          { type: 'string' },
        ),
      }),
      render: renderJson,
    },
    async execute(args, exec) {
      const lead = requireLead(ctx, exec.agent);
      const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : '';
      const raw = typeof args.evidence === 'string' ? args.evidence : '';
      const budget = await teamBudget(ctx, state, lead, exec.signal);
      const budgetBlock = {
        used: budget.used,
        limit: budget.limit,
        mode: budget.mode,
        exceeded: budget.exceeded,
        unknown: budget.unknown,
        note: budget.note,
      };
      /** @param {string} reason - why nothing happened. @param {object} [extra] - overrides. */
      const refusal = (reason, extra = {}) => ({
        accepted: false,
        taskId,
        status: '',
        revision: 0,
        evidence: '',
        reason,
        budget: budgetBlock,
        actions: [],
        ...extra,
      });

      // Empty evidence is answered before the board is touched at all: the point
      // of the gate is that a doubtful "done" leaves no trace of having passed.
      if (!hasEvidence(raw)) {
        return refusal(
          '验收证据为空：任务没有任何改动。请带上可核对的证据再验收（测试输出、跑过的命令与结果、改动的文件路径、diff 或 commit）。',
        );
      }

      // Deliberately NOT gated by `budgetBlocks`: accepting is bookkeeping, not
      // spending. Blocking it would deadlock the team — once `used` passes the
      // ceiling, finished work could never be written off, its tasks would stay
      // `in_progress` forever, and `used` could only grow. The receipt still
      // carries the budget so an over-budget team cannot be mistaken for a
      // healthy one.

      if (taskId === '') {
        return refusal('没有给 taskId：共享任务板上的哪一条要被验收？');
      }

      const board = await ensureBoard(ctx, lead);
      if (board === 'off') {
        return refusal(
          '任务板在这个会话里是关的（Agent Teams 开关）：验收要求写回任务，先在会话面板里打开它。',
        );
      }
      if (board === 'unavailable') {
        return refusal('任务板打不开，验收无法写回：先重试一次，或者在会话面板里打开 Agent Teams。');
      }

      /**
       * Run one compare-and-set against the freshest revision.
       *
       * A lost race (the employee updated the task a moment earlier) is retried
       * once: reporting it as a failure would tell the Lead its evidence was
       * rejected when it merely arrived second.
       * @param {(current: object) => object} request - build the update request from the current view.
       * @returns {Promise<object>} the committed view.
       */
      const mutate = async (request) => {
        let last;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const current = ctx.agentTeams.getTask(lead, taskId);
          try {
            return await ctx.agentTeams.updateTask(
              lead,
              { taskId, expectedRevision: current.revision, ...request(current) },
              exec.signal,
            );
          } catch (error) {
            last = error;
            if (!isStaleRevision(error)) throw error;
          }
        }
        throw last;
      };

      const trimmed = raw.trim();
      let task;
      try {
        task = ctx.agentTeams.getTask(lead, taskId);
      } catch (error) {
        return refusal(`任务 ${taskId} 读不到：${messageOf(error)}`);
      }
      if (task.status === 'deleted') {
        return refusal(`任务 ${taskId} 已删除，没有可验收的内容。`, {
          status: 'deleted',
          revision: task.revision,
        });
      }
      if (task.status === 'pending') {
        return refusal(
          `任务 ${taskId} 还是 pending（没人认领）：先让负责的员工认领并开工，或由你先 reassign 再验收。任务没有被改动。`,
          { status: 'pending', revision: task.revision },
        );
      }
      // The kernel would happily complete a task whose blockers are still open;
      // the gate is the only place that can refuse it, so it does.
      const open = unfinishedBlockers(ctx, lead, task);
      if (open.length > 0) {
        return refusal(
          `任务 ${taskId} 还有未完成的前置任务：${open.join('、')}。先让它们完成再验收；任务没有任何改动。`,
          { status: task.status, revision: task.revision },
        );
      }
      // Idempotence: the same evidence on the same task is written once. A retry
      // after a transport hiccup must not grow the description again.
      const recorded = hasEvidenceRecorded(task.description, trimmed);
      if (recorded && task.status === 'completed') {
        return {
          accepted: true,
          taskId,
          status: task.status,
          revision: task.revision,
          evidence: trimmed,
          reason: '同一段证据已经记录过，没有重复写入。',
          budget: budgetBlock,
          actions: [],
        };
      }
      // Two writes at most, and the split is reported honestly: a failed
      // `complete` after a successful `edit` means the evidence IS on the task,
      // and saying "nothing happened" would make the Lead write it twice.
      let next = task;
      if (!recorded) {
        try {
          next = await mutate((current) => ({
            action: 'edit',
            description: evidenceDescription(current.description, trimmed),
          }));
        } catch (error) {
          return refusal(`证据没能写回任务：${messageOf(error)}`, {
            status: task.status,
            revision: task.revision,
          });
        }
      }
      if (next.status === 'completed') {
        return {
          accepted: true,
          taskId,
          status: next.status,
          revision: next.revision,
          evidence: trimmed,
          reason: '任务在这次验收前已经是完成状态，只补记了证据。',
          budget: budgetBlock,
          actions: [],
        };
      }
      if (next.status !== 'in_progress') {
        // The status can move between the read and this write — an employee
        // releasing the task is the realistic case — so say what it actually is
        // instead of calling it completed.
        return {
          accepted: false,
          taskId,
          status: next.status,
          revision: next.revision,
          evidence: trimmed,
          reason: `证据已写进任务，但任务当前是 ${next.status}，只有进行中的任务能置 completed：让负责的员工重新认领后再验收一次。`,
          budget: budgetBlock,
          actions: [],
        };
      }
      try {
        next = await mutate(() => ({ action: 'complete' }));
      } catch (error) {
        return {
          accepted: false,
          taskId,
          status: next.status,
          revision: next.revision,
          evidence: trimmed,
          reason: `证据已写进任务，但没能把它置为 completed：${messageOf(error)}。再调一次 accept_task 即可补上完成状态。`,
          budget: budgetBlock,
          actions: [],
        };
      }
      return {
        accepted: true,
        taskId,
        status: next.status,
        revision: next.revision,
        evidence: trimmed,
        reason: '',
        budget: budgetBlock,
        actions: [],
      };
    },
  });
}

/** Which roles carry a permission preset, and the Config field that names it. */
const PRESET_FIELDS = {
  reviewer: 'presetReviewer',
  researcher: 'presetResearcher',
  ops: 'presetOps',
};

/**
 * The permission-preset service, if this composition mounted one.
 *
 * Probed with `ctx.get` like `subagents` in the bridge: a composition without it
 * still loads the plugin, and the missing capability is reported instead of
 * turning every hire into a failure.
 * @param {object} ctx - Host context.
 * @returns {object | undefined} the service.
 */
function presetServiceOf(ctx) {
  try {
    const service = typeof ctx?.get === 'function' ? ctx.get('permissionPresets') : undefined;
    return service ?? ctx?.permissionPresets;
  } catch {
    return undefined;
  }
}

/**
 * The preset names this machine actually offers.
 * @param {object} ctx - Host context.
 * @returns {string[]} names, or an empty array when the service or its list is unavailable.
 */
function availablePresetsOf(ctx) {
  const service = presetServiceOf(ctx);
  try {
    const names = service?.names;
    if (Array.isArray(names)) return [...names];
    return names === undefined || names === null ? [] : [...names];
  } catch {
    return [];
  }
}

/**
 * The preset one Session is currently on, or '' when it cannot be read.
 *
 * `current()` returns the kernel's own `custom` when no preset matches, and that
 * is reported as-is: it is a real answer, not a missing one.
 * @param {object} ctx - Host context.
 * @param {object | undefined} session - Session to read.
 * @returns {string} preset name, or ''.
 */
function presetOf(ctx, session) {
  if (session === undefined || session === null) return '';
  const service = presetServiceOf(ctx);
  try {
    const name = service?.current?.(session);
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

/**
 * Why one configured preset would not apply, derived from the live deployment.
 *
 * The plugin switches presets and never defines them: `read-only` is a legal
 * sandbox mode with no preset behind it on a default install, so the honest answer
 * is the available list plus the instruction to define it in the profile patch.
 * @param {string} roleId - role id.
 * @param {string} name - configured preset name.
 * @param {string[]} available - preset names this machine offers.
 * @param {boolean} serviceMissing - whether the service itself is absent.
 * @returns {string} one actionable line, or '' when the preset is fine.
 */
function presetProblem(roleId, name, available, serviceMissing) {
  if (serviceMissing) {
    return `${roleId} 配了 preset "${name}"，但这台机器没有可用的 permissionPresets 服务；没有应用（不影响入职）。`;
  }
  if (available.includes(name)) return '';
  const list = available.length === 0 ? '（名单为空）' : available.join(', ');
  return `${roleId} 配的 preset "${name}" 在这台机器上不存在（可用：${list}）；要这个档位，请先在 profile patch 里定义 preset，插件只切换、不替你造。`;
}

/**
 * Apply one role's permission preset to that employee's Session.
 *
 * Called after a successful install and again on every settings save, so changing
 * `presetReviewer` takes effect without a remount. Never throws and never touches
 * the Lead: a preset is an employee privilege knob, and a failed switch must not
 * take the hire down with it.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {object} agent - employee Agent.
 * @param {object} role - role definition.
 */
function applyRolePreset(ctx, state, agent, role) {
  const field = PRESET_FIELDS[role?.id];
  if (field === undefined) return;
  const name = state.config[field];
  if (typeof name !== 'string' || name === '') {
    state.presetErrors.delete(role.id);
    return;
  }
  // Belt and braces: the Lead owns the conversation, never an employee preset.
  if (agent === undefined || agent === null || state.leads.has(agent.id)) return;
  const session = agent.session;
  if (session === undefined || session === null) return;
  const service = presetServiceOf(ctx);
  const available = availablePresetsOf(ctx);
  const serviceMissing = typeof service?.set !== 'function' || typeof service?.current !== 'function';
  if (serviceMissing || !available.includes(name)) {
    // Derived at report time, so nothing is stored for these two cases.
    return;
  }
  try {
    // Idempotent: the kernel records a selection only when it changes, and a
    // settings save that does not move this role's preset must not append one.
    if (service.current(session) === name) {
      state.presetErrors.delete(role.id);
      return;
    }
    service.set(session, name);
    state.presetErrors.delete(role.id);
  } catch (error) {
    state.presetErrors.set(
      role.id,
      `${role.id} 的 preset "${name}" 没有应用：${messageOf(error)}（不影响入职）。`,
    );
  }
}

/**
 * The preset half of the health report.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @returns {{ availablePresets: string[], presetNote: string }} available names and one combined note.
 */
function presetReportOf(ctx, state) {
  const available = availablePresetsOf(ctx);
  const serviceMissing = available.length === 0 && presetServiceOf(ctx) === undefined;
  const problems = [];
  for (const [roleId, field] of Object.entries(PRESET_FIELDS)) {
    const name = state.config[field];
    if (typeof name !== 'string' || name === '') continue;
    const derived = presetProblem(roleId, name, available, serviceMissing);
    const runtime = state.presetErrors.get(roleId) ?? '';
    const message = derived !== '' ? derived : runtime;
    if (message !== '') problems.push(message);
  }
  return { availablePresets: available, presetNote: problems.join(' ') };
}

/**
 * Denial for one `send_message` aimed at a benched role.
 *
 * `send_message` is the kernel's own channel, so guarding only this plugin's four
 * entry points leaves a hole: a Lead that calls it directly, or an employee
 * handing a task to a colleague, still lands work on a paused seat. Guards run on
 * the parsed execution, so the target can be resolved here and refused with the
 * same sentence every other entry point uses.
 *
 * A target that is not a built-in role (`lead`, a worker, a session id) is not
 * this guard's business and passes through untouched.
 * @param {object} state - plugin state.
 * @param {object} exec - tool execution (name + parsed arguments).
 * @returns {string | undefined} denial reason, or undefined to allow the call.
 */
function benchSendDenial(state, exec) {
  if (exec?.name !== 'send_message') return undefined;
  const args = exec.arguments;
  if (args === null || typeof args !== 'object') return undefined;
  const target = typeof args.target === 'string' ? args.target.trim() : '';
  if (target === '') return undefined;
  const role = resolveDispatchRole(target);
  if (role === undefined) return undefined;
  if (!isBenched(parseBenchRoles(state.config.benchRoles), role.id)) return undefined;
  return `${buildBenchNotice(role)}这条 send_message 没有送达，原文还在你手上：复职后重发，或换一个在岗的角色。`;
}

/**
 * How long one task has been waiting, when that is knowable at all.
 *
 * The Team service's task view carries no timestamp (`TeamTaskView` is id,
 * revision, subject, description, status, blockedBy, writeScopes, ownerId,
 * ownerName, ready, writeScopeWarnings), so on a live board this is 0 — and 0 is
 * what the report says, because inventing an age is worse than admitting the
 * board does not publish one. A composition that does expose `createdAt`
 * milliseconds gets an honest number.
 * @param {object} task - task view.
 * @param {number} now - reference time in milliseconds.
 * @returns {number} age in milliseconds, 0 when unknown.
 */
function taskAgeMs(task, now) {
  const created = task?.createdAt;
  if (typeof created !== 'number' || !Number.isFinite(created)) return 0;
  return Math.max(0, now - created);
}


/**
 * The blockers of one task that have not completed yet.
 *
 * The kernel's `complete` action checks the status and nothing else
 * (`task-board.ts`, `case 'complete'`), so a task can be closed while its
 * `blockedBy` is still open. The acceptance gate is where that becomes a
 * correctness question, so it answers it itself instead of trusting the write to
 * be refused. A blocker that cannot be read counts as unfinished: the safe
 * reading of "unknown" is "not done".
 * @param {object} ctx - Host context.
 * @param {object} lead - team Lead.
 * @param {object} task - task view.
 * @returns {string[]} ids of unfinished (or unreadable) blockers.
 */
function unfinishedBlockers(ctx, lead, task) {
  const ids = Array.isArray(task?.blockedBy) ? task.blockedBy : [];
  const open = [];
  for (const id of ids) {
    let blocker;
    try {
      blocker = ctx.agentTeams.getTask(lead, id);
    } catch {
      open.push(id);
      continue;
    }
    if (blocker.status !== 'completed') open.push(id);
  }
  return open;
}

/**
 * The name the rest of the report uses for one employee session.
 *
 * The roster name wins: `members[]` shows `backend`, so a diagnostic that says
 * `b1fe1e2c-ffad-…` forces the reader to join two lists by hand. The installed
 * role id is the next best label (a session that is not on the roster but was
 * installed), and the raw id is the last resort — the schema says so.
 * @param {object} state - plugin state.
 * @param {object[]} roster - member rows from `teammatesOf`.
 * @param {string} id - session / member id.
 * @returns {string} roster name, role id, or the raw id.
 */
function memberLabelOf(state, roster, id) {
  const fromRoster = roster.find((member) => member.id === id)?.name;
  if (typeof fromRoster === 'string' && fromRoster !== '') return fromRoster;
  return state.employees.get(id)?.role?.id ?? id;
}

/**
 * The diagnostic half of the report.
 *
 * One function, two readers (`team_status` and `team_handover`): a handover brief
 * that disagreed with the status tool would be worse than no brief.
 *
 * Every value here is either measured or explicitly reported as unavailable — no
 * default is presented as a fact.
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @param {object[]} members - roster rows.
 * @returns {object} health block.
 */
function healthOf(ctx, state, members) {
  const probe = teamTopologyOf(ctx);
  // Usage is read through `ctx.sessions.get(id)` so an idle teammate still
  // counts; a composition without that service can only read the live Agent, and
  // then an unloaded employee is reported as unknown. Saying so here is the
  // difference between a diagnostic and a mystery.
  const usageNote = hasSessionStore(ctx)
    ? ''
    : 'this composition exposes no ctx.sessions.get, so token usage is read from live Agents only: a teammate that is not running counts as unknown.';
  // Counted from the filter this plugin actually registered, never from a
  // constant: `desired` is what the role declared and `allow` is what
  // `tools.restrict()` accepted on this machine.
  //
  // Only rows where the machine could not honour the declaration are listed:
  // `applied === requested` is a healthy trim, not a degradation, and a list that
  // mixes the two makes the diagnostic unreadable. No degradation at all means an
  // empty array.
  //
  // A role whose allow filter never registered has no entry at all, so it is
  // invisible in `trimmedTools` — and "I could not trim this one" is exactly the
  // state a reader needs to see. Counted against the installed employees, but only
  // while trimming is on: with the switch off nobody is supposed to have a filter,
  // and saying so would be noise about a deliberate choice.
  let missingFilterNote = '';
  if (state.config.trimEmployeeTools !== false) {
    const installed = [...state.employees.keys()];
    const withoutFilter = installed.filter((id) => !state.toolFilters.has(id)).length;
    if (withoutFilter > 0) {
      missingFilterNote = `${withoutFilter} 个员工没有白名单记录：这些角色的工具面没有被收窄（注册失败时启动日志里有原因），不代表裁剪成功。`;
    }
  }
  let trimNote = '';
  const trimmedTools = [];
  for (const [id, entry] of state.toolFilters) {
    const requested = Array.isArray(entry?.desired) ? entry.desired.length : undefined;
    const applied = Array.isArray(entry?.allow) ? entry.allow.length : undefined;
    if (requested === undefined || applied === undefined) {
      trimNote = 'a tool-filter record did not carry its allow list, so its counts read as 0.';
      continue;
    }
    if (applied >= requested) continue;
    trimmedTools.push({ role: memberLabelOf(state, members, id), requested, applied });
  }
  const presets = presetReportOf(ctx, state);
  const bench = parseBenchRoles(state.config.benchRoles);
  // A typo in `benchRoles` must not silently bench nobody: the unparsable tokens
  // are named here, where the Lead already looks for diagnostics.
  const benchNote =
    bench.unknown.length === 0
      ? ''
      : `benchRoles 里有无法识别的角色：${bench.unknown.map((name) => `"${name}"`).join('、')}；这些项没有生效。`;
  return {
    topology: probe.topology,
    note: [probe.note, usageNote, benchNote, missingFilterNote, trimNote]
      .filter((line) => line !== '')
      .join(' '),
    modelErrors: [...state.modelErrors.entries()].map(([id, entry]) => ({
      member: memberLabelOf(state, members, id),
      // Rendered with the same label the per-member row uses, so the two views of
      // one failure are word-for-word identical.
      message: modelErrorLine(memberLabelOf(state, members, id), entry),
    })),
    trimmedTools,
    availablePresets: presets.availablePresets,
    presetNote: presets.presetNote,
  };
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
            modelError: stringField(
              'Why the configured model is not applied, or an empty string. Word for word the same line health.modelErrors carries for this member.',
            ),
            task: stringField('Current in-progress task, or an empty string.'),
            tokens: integerField(
              'Lifetime token total, read the same way budget.used is (per Session, so an idle teammate still counts). 0 when the reading is unavailable, in which case budget.unknown accounts for it.',
            ),
            workers: integerField('Live one-off workers this teammate currently owns, 0 when unknown.'),
            benched: booleanField(
              'Whether this role is on the bench list: it keeps its seat but takes no new work. Its in-flight tasks can still be accepted.',
            ),
            preset: stringField(
              'Permission preset this employee Session is currently on, or an empty string when the composition exposes no permissionPresets service.',
            ),
          }),
        ),
        tasks: objectSchema({
          pending: integerField('Pending tasks.'),
          inProgress: integerField('In-progress tasks.'),
          completed: integerField('Completed tasks.'),
        }),
        taskBoard: stringField('on, off, unavailable, unsupported'),
        benchedRoles: arrayField(
          'Role ids on the bench list (parsed from benchRoles, aliases resolved). A benched role with no seat is listed too; unparsable tokens are reported in health.note instead.',
          { type: 'string' },
        ),
        note: stringField(
          'Actionable hint when the shared task board is not readable, otherwise an empty string.',
        ),
        pendingAcceptance: arrayField(
          'In-progress tasks owned by an employee: work that is waiting for the Lead to accept it with accept_task.',
          objectSchema({
            id: stringField('Shared task id.'),
            subject: stringField('Task subject.'),
            owner: stringField('Owning employee role id.'),
            ageMs: integerField(
              'Milliseconds since the task was created, when the task value carries a creation timestamp; 0 when it does not (the Team task view exposes no time field, so a live board reports 0 rather than a guess).',
            ),
          }),
        ),
        health: objectSchema({
          topology: stringField(
            'Which team backend answered: "subagent-tree" (0.2.2, ctx.subagents rootOf+namesOf), "team-service" (0.2.1, agentTeams.tryMembership), or "unsupported" when neither capability is present.',
          ),
          note: stringField('Why health could not be read, or an empty string.'),
          modelErrors: arrayField(
            'Employees whose configured model is not applied, and why.',
            objectSchema({
              member: stringField(
                'Employee name as the roster shows it (for example "backend"); falls back to the installed role id, then to the raw session id when the session is not on this roster.',
              ),
              message: stringField(
                'Why the configured model is not in effect, naming the role, the model, and whether the cause is a missing kernel capability, an invalid route, or a failed write.',
              ),
            }),
          ),
          availablePresets: arrayField(
            'Permission preset names this machine offers (permissionPresets.names); empty when the service or its list is unavailable.',
            { type: 'string' },
          ),
          presetNote: stringField(
            'One line per employee role whose configured preset cannot be applied (unknown name, missing service, or a failed switch), with the available list; empty when every configured preset applies.',
          ),
          trimmedTools: arrayField(
            'One row per employee whose declared tool surface this machine could not fully honour (applied below requested); empty when every trim succeeded. A role whose filter never registered at all appears in `note` instead.',
            objectSchema({
              role: stringField('Employee role id.'),
              requested: integerField('Tools the role declared (after the worker-cap adjustment).'),
              applied: integerField('Tools actually registered in the allow filter.'),
            }),
          ),
        }),
        budget: objectSchema({
          used: integerField(
            'Lifetime tokens spent by the Lead Session plus every employee; sessions outside this roster are not counted.',
          ),
          limit: integerField('Configured team token ceiling; 0 means unlimited.'),
          mode: stringField(
            'warn (report only) or block (refuse dispatch and hire; acceptance is always recorded, never refused).',
          ),
          exceeded: booleanField('Whether the ceiling is reached; always false when the ceiling is 0.'),
          unknown: integerField(
            'Members whose usage could not be read. Their spend is missing from used, so the real total may be higher; 0 when every member answered.',
          ),
          note: stringField('One line saying how many members could not be measured, or an empty string.'),
        }),
        autoStart: stringField(
          'Automatic formation state: off, none (not scheduled), queued, running, done, or failed.',
        ),
      }),
      render: renderJson,
    },
    async execute(_args, exec) {
      const lead = requireLead(ctx, exec.agent);
      const members = await teammatesOf(ctx, lead);
      // The board is opened before it is read, and read through the safe path:
      // a closed board must still produce a full roster report plus the switch
      // that needs turning on, not a thrown TEAM_DISABLED.
      const opened = await ensureBoard(ctx, lead);
      const listed = safeTaskList(ctx, lead);
      const tasks = listed.tasks;
      const taskBoard = boardStateOf(opened, listed.board);
      // ONE usage pass for the whole report: the per-member `tokens` column and
      // `budget.used` are the same numbers, read the same way (per Session, not
      // per live Agent). Two separate reads drifted apart in a real run — an idle
      // employee showed 0 tokens while the budget above it counted its spend —
      // and a report that disagrees with itself is worse than no report.
      const usage = teamUsageOf(ctx, lead, members);
      // Parsed once per report: aliases resolved, unparsable tokens kept for
      // `health.note` rather than dropped.
      const bench = parseBenchRoles(state.config.benchRoles);
      /** @param {object} member - roster row. @returns {string} why its configured model is not applied. */
      const modelErrorFor = (member) => {
        const entry = state.modelErrors.get(member.id);
        return entry === undefined ? '' : modelErrorLine(member.name, entry);
      };
      const rows = members.map((member) => {
        const role = roleForName(member.name);
        const agent = ctx.agents.get(member.id);
        const actual = agent === undefined ? undefined : currentSelection(ctx, agent);
        const configured = role === undefined ? undefined : parseModelSpec(state.config[role.modelField]);
        const model = formatModelSpec(actual ?? configured);
        // An unreadable reading is 0 here and counted in `budget.unknown`, so the
        // two halves of the report never contradict each other.
        const tokens = usage.readings.get(member.id)?.tokens ?? 0;
        let workers = 0;
        if (agent !== undefined) {
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
          modelError: modelErrorFor(member),
          task: currentTask?.subject ?? '',
          tokens,
          workers,
          benched: isBenched(bench, member.name),
          // Read from the employee's own Session, never the Lead's.
          preset: presetOf(ctx, sessionForUsage(ctx, member.id)),
        };
      });
      // The gate's queue: in-progress work that belongs to an employee, i.e.
      // exactly what `accept_task` would close. A task owned by nobody or by a
      // session outside this roster is not the Lead's to accept.
      //
      // Review tasks are excluded, and the test is the Host's own subject prefix
      // rather than `ownerName === 'reviewer'`:
      // `reviewTaskFor` reassigns the review task immediately, and the kernel
      // turns a reassigned task into `in_progress` (`task-board.ts`, `case
      // 'reassign'`), so without this filter every review request would enter the
      // queue the moment it is filed — while the implementation it depends on is
      // still unaccepted. The owner test would also hide ordinary work the Lead
      // hands to the reviewer, which still needs accepting; the prefix is written
      // by this plugin and appears on review tasks only.
      const memberNames = new Set(members.map((member) => member.name));
      const now = Date.now();
      const pendingAcceptance = acceptanceQueue(tasks, memberNames).map((task) => ({
        id: task.id,
        subject: task.subject,
        owner: task.ownerName ?? '',
        ageMs: taskAgeMs(task, now),
      }));
      const health = healthOf(ctx, state, members);
      const budget = {
        ...budgetSnapshot(
          usage.used,
          state.config.teamTokenBudget,
          state.config.tokenBudgetOnExceed,
          usage.unknown,
          { missingSession: usage.missingSession, projectionError: usage.projectionError },
        ),
        topRole: usage.topRole,
      };
      return {
        size: members.length,
        capacity: clampTeamSize(state.config.teamSize, DEFAULT_LINEUP.length, MAX_TEAM_SIZE),
        members: rows,
        tasks: {
          pending: tasks.filter((task) => task.status === 'pending').length,
          inProgress: tasks.filter((task) => task.status === 'in_progress').length,
          completed: tasks.filter((task) => task.status === 'completed').length,
        },
        taskBoard,
        benchedRoles: bench.roles,
        note: boardNote(taskBoard),
        pendingAcceptance,
        health,
        budget: {
          used: budget.used,
          limit: budget.limit,
          mode: budget.mode,
          exceeded: budget.exceeded,
          unknown: budget.unknown,
          note: budget.note,
        },
        autoStart:
          state.config.autoStart === 'off'
            ? 'off'
            : (state.autoStart.get(lead.id) ?? 'none'),
      };
    },
  });
}

/**
 * Read one old root's board, without touching anything.
 *
 * The board is rebuilt from a root Session's own log, so a new conversation sees
 * an empty one. The projection read itself is not tree-scoped, though: any live
 * Session object can be projected, which makes a **read-only** recovery possible
 * while the old root is still loaded in this process. Writing stays impossible —
 * `createTask`/`updateTask` resolve the caller's own root — so this tool reports
 * and never mutates.
 *
 * Deliberately no `ensureBoard`: that call can append a `team/mode` event, and a
 * recovery tool must not write to either team.
 *
 * @param {object} ctx - Host context.
 * @param {string} sessionId - the old root Session id.
 * @param {number} limit - maximum task rows to return.
 * @returns {object} recovery report.
 */
function recoverBoard(ctx, sessionId, limit, leadSessionId) {
  const empty = {
    found: false,
    sessionId,
    enabled: 'unknown',
    tasks: [],
    total: 0,
    truncated: false,
    members: [],
    membersSource: 'none',
    note: '旧会话没有加载，读不到旧板；只能按 handover 简报用 team_task_create 重建。',
  };
  let session;
  try {
    const store = sessionServiceOf(ctx);
    session = typeof store?.get === 'function' ? store.get(sessionId) : undefined;
  } catch {
    session = undefined;
  }
  if (session === undefined || session === null) return empty;

  /** @param {string} key - projection key. @returns {unknown} the projection view, or undefined. */
  const read = (key) => {
    try {
      return ctx.sessionProjections.stateOf(session, key);
    } catch {
      return undefined;
    }
  };
  const projection = read('agentTeam');
  if (projection === undefined || projection === null) {
    return {
      ...empty,
      found: true,
      note: `旧会话已加载，但它的 agentTeam 投影读不到；没有可迁移的任务数据，按 handover 简报用 team_task_create 重建。`,
    };
  }
  const notes = [];
  // A view that does not even carry `tasks` is a broken projection, not an empty
  // board: say so, keep `found`, and refuse to claim a state for the switch.
  const shapeOk = Array.isArray(projection.tasks);
  const rawTasks = shapeOk ? projection.tasks : [];
  if (!shapeOk) {
    notes.push(
      '旧会话的 agentTeam 投影形状不对（tasks 不是数组），读不到旧板任务；按 handover 简报用 team_task_create 重建。',
    );
  }
  const tasks = rawTasks.map((task) => ({
    id: typeof task?.id === 'string' ? task.id : '',
    subject: typeof task?.subject === 'string' ? task.subject : '',
    status: typeof task?.status === 'string' ? task.status : '',
    owner: typeof task?.ownerName === 'string' ? task.ownerName : '',
    blockedBy: Array.isArray(task?.blockedBy)
      ? task.blockedBy.filter((id) => typeof id === 'string')
      : [],
    // `ready` is the kernel's own derived flag; a view that does not say is
    // reported as not ready, never guessed from the blockers here.
    ready: task?.ready === true,
  }));
  const page = tasks.slice(0, limit);
  const truncated = tasks.length > page.length;
  if (truncated) {
    notes.push(
      `任务共 ${tasks.length} 条，按 limit=${limit} 只返回前 ${page.length} 条；调大 limit（上限 500）可看全。`,
    );
  }

  // Members: 0.2.1 keeps them on the team projection, 0.2.2 keeps a subagent
  // catalog on the parent Session instead. Fall back, and say which one answered.
  const teamMembers = Array.isArray(projection.members) ? projection.members : [];
  let members = [];
  let membersSource = 'none';
  if (teamMembers.length > 0) {
    members = teamMembers.map((member) => ({
      id: typeof member?.id === 'string' ? member.id : '',
      name: typeof member?.name === 'string' ? member.name : '',
      mode: '',
      phase: typeof member?.phase === 'string' ? member.phase : '',
    }));
    membersSource = 'agentTeam';
  } else {
    const catalog = read('subagentCatalog');
    if (Array.isArray(catalog)) {
      members = catalog.map((entry) => ({
        id: typeof entry?.id === 'string' ? entry.id : '',
        name: typeof entry?.name === 'string' ? entry.name : '',
        mode: typeof entry?.mode === 'string' ? entry.mode : '',
        phase: '',
      }));
      membersSource = 'subagentCatalog';
    } else {
      notes.push(
        '旧会话的花名册读不到（agentTeam 没带 members，subagentCatalog 也没有数据）；只能按 handover 简报重建。',
      );
    }
  }
  const selfId = typeof leadSessionId === 'string' ? leadSessionId : '';
  if (selfId !== '' && selfId === sessionId) {
    notes.unshift(
      '注意：这就是你当前会话自己的板，不是旧板——当前会话没有任何可迁移的历史，下面的任务就是现在这份板上已有的。',
    );
  }
  return {
    found: true,
    sessionId,
    enabled: shapeOk
      ? projection.enabled === true
        ? 'on'
        : projection.enabled === false
          ? 'off'
          : 'unknown'
      : 'unknown',
    tasks: page,
    total: tasks.length,
    truncated,
    members,
    membersSource,
    note: notes.join(' '),
  };
}

/**
 * The handover brief: the sanctioned way to change the team.
 *
 * Members are append-only, so "换届" is a new conversation plus this document.
 * Everything in it comes from the same reads `team_status` uses — roster, board,
 * health, budget — and a field with no data says so instead of inventing a
 * summary.
 *
 * The write target is the Session's own working directory. When the Session has
 * no `cwd` there is nowhere honest to write, so the tool returns the text with
 * `written:false` and says why at the top; a failed write degrades the same way
 * instead of failing the tool.
 *
 * @param {object} ctx - Host context.
 * @param {object} state - plugin state.
 * @returns {object} the team_handover tool definition.
 */
function makeHandoverTool(ctx, state) {
  return defineTool({
    name: 'team_handover',
    description:
      'Produce a handover brief for the next Lead session and write it to .dsh/work-team/handover.md in the working directory, overwriting the previous file. Use it when the user wants to change the team (换届), hand the team to a fresh conversation, or snapshot the current state: the brief carries the real roster, in-flight tasks, the acceptance queue, blocked tasks, diagnostics and the token budget, and it states up front that the roster and task board do NOT migrate — a new session starts with an empty board, so in-flight work is either finished here first or recreated there with team_task_create. It never summarises or invents decisions; anything without a source is written as (无). A write failure still returns the full text.',
    parameters: {
      note: {
        type: 'string',
        description:
          'Optional note from the user to carry into the new session (context that is not in the board or roster). Omitted or empty means (无).',
      },
    },
    output: {
      schema: objectSchema({
        markdown: stringField('The complete brief. Use it even when `written` is false.'),
        path: stringField(
          'Absolute path the brief was written to, or an empty string when nothing was written.',
        ),
        written: booleanField(
          'Whether the file was actually written; false when the Session has no working directory or the write failed, in which case `markdown` says why.',
        ),
      }),
      render: renderJson,
    },
    async execute(args, exec) {
      const lead = requireLead(ctx, exec.agent);
      const signal = exec.signal;
      const opened = await ensureBoard(ctx, lead);
      const listed = safeTaskList(ctx, lead);
      const tasks = listed.tasks;
      const taskBoard = boardStateOf(opened, listed.board);
      let members = [];
      let membersError = '';
      try {
        members = await teammatesOf(ctx, lead, signal);
      } catch (error) {
        membersError = messageOf(error);
      }
      const usage = teamUsageOf(ctx, lead, members);
      const budget = {
        ...budgetSnapshot(
          usage.used,
          state.config.teamTokenBudget,
          state.config.tokenBudgetOnExceed,
          usage.unknown,
          { missingSession: usage.missingSession, projectionError: usage.projectionError },
        ),
      };
      const bench = parseBenchRoles(state.config.benchRoles);
      const health = healthOf(ctx, state, members);
      const completed = new Set(
        tasks.filter((task) => task.status === 'completed').map((task) => task.id),
      );
      const blocked = tasks
        .filter((task) => Array.isArray(task.blockedBy) && task.blockedBy.length > 0)
        .filter((task) => task.status === 'pending' || task.status === 'in_progress')
        .map((task) => ({
          id: task.id,
          subject: task.subject,
          ...(task.ownerName === undefined ? {} : { ownerName: task.ownerName }),
          openBlockers: task.blockedBy.filter((id) => !completed.has(id)),
        }))
        .filter((task) => task.openBlockers.length > 0);
      const roster = members.map((member) => {
        const role = roleForName(member.name);
        const agent = ctx.agents.get(member.id);
        const actual = agent === undefined ? undefined : currentSelection(ctx, agent);
        const configured = role === undefined ? undefined : parseModelSpec(state.config[role.modelField]);
        const model = formatModelSpec(actual ?? configured);
        return {
          name: member.name,
          displayName: role?.zh.name ?? member.name,
          role: role?.zh.role ?? 'Teammate',
          model: model === '' ? 'follow-main' : model,
          benched: isBenched(bench, member.name),
          preset: presetOf(ctx, sessionForUsage(ctx, member.id)),
        };
      });
      const stamp = new Date().toISOString();
      const base = {
        stamp,
        // The board this brief describes: a new Session will NOT have it, which is
        // exactly what the opening paragraph has to say.
        sourceSession: typeof lead.id === 'string' ? lead.id : '',
        roster,
        membersError,
        tasks: tasks.filter((task) => task.status === 'in_progress'),
        taskBoard,
        // `acceptanceQueue` is the one rule the office panel mirrors; reuse it so
        // the brief and `team_status` never disagree about what is pending.
        rosterTask: acceptanceQueue(tasks, new Set(members.map((member) => member.name))),
        blocked,
        health,
        budget,
        benchedRoles: bench.roles,
        note: typeof args?.note === 'string' ? args.note.trim() : '',
      };
      const cwd = typeof lead.session?.header?.cwd === 'string' ? lead.session.header.cwd : '';
      if (cwd === '') {
        return {
          markdown: buildHandoverMarkdown({
            ...base,
            written: false,
            path: '',
            reason: '这个会话没有工作目录（session.header.cwd 为空），没有地方落盘',
          }),
          path: '',
          written: false,
        };
      }
      const file = join(cwd, '.dsh', 'work-team', 'handover.md');
      try {
        const markdown = buildHandoverMarkdown({ ...base, written: true, path: file, reason: '' });
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, markdown, 'utf8');
        return { markdown, path: file, written: true };
      } catch (error) {
        const reason = `写 ${file} 失败：${messageOf(error)}`;
        return {
          markdown: buildHandoverMarkdown({ ...base, written: false, path: '', reason }),
          path: '',
          written: false,
        };
      }
    },
  });
}

/** Default page size for `team_recover`. */
const RECOVER_DEFAULT_LIMIT = 200;

/** Hard ceiling for `team_recover`'s `limit`. */
const RECOVER_MAX_LIMIT = 500;

/**
 * The read-only recovery tool.
 *
 * A new Session's board is empty, so the only question left after a handover is
 * "is the old board still loaded?" — this answers it, with the tasks and roster
 * the old root's own projections hold, and never writes.
 * @param {object} ctx - Host context.
 * @returns {object} the team_recover tool definition.
 */
function makeRecoverTool(ctx) {
  return defineTool({
    name: 'team_recover',
    description:
      'Read the task board of an OLD root Session, read-only, to see what a handover brief was describing. Use it right after taking over: if it returns found:true, that old board is still loaded and its task list can be recreated with team_task_create; if found:false, the old Session is gone and the handover brief is the only source. It never writes, never switches Team mode, and cannot accept or move tasks across Sessions — old task ids are not valid here.',
    parameters: {
      sessionId: {
        type: 'string',
        required: true,
        description: 'The old root Session id — the handover brief prints it as 来源：会话.',
      },
      limit: {
        type: 'integer',
        description: `Maximum task rows to return (default ${RECOVER_DEFAULT_LIMIT}, maximum ${RECOVER_MAX_LIMIT}). When the old board has more, the report says so and how many there are in total.`,
      },
    },
    output: {
      schema: objectSchema({
        found: booleanField(
          'Whether the old Session is loaded in this process. false means nothing could be read and nothing was changed.',
        ),
        sessionId: stringField('The Session id this call asked about.'),
        enabled: stringField(
          'Which value the old board itself reported: "on" or "off", or "unknown" when the Session or its projection could not be read.',
        ),
        tasks: arrayField(
          'Old-board tasks, newest page first within the limit. Empty when the Session is not loaded or its board is unreadable.',
          objectSchema({
            id: stringField('Task id on the OLD board; not usable for accept_task in this Session.'),
            subject: stringField('Task subject, or an empty string when the view omits it.'),
            status: stringField('pending, in_progress, completed, or an empty string when unknown.'),
            owner: stringField('Owner roster name as the old board recorded it, or an empty string.'),
            blockedBy: arrayField('Blocker task ids, or an empty array when the view carries none.', {
              type: 'string',
            }),
            ready: booleanField(
              'Ready flag as the old board derived it; false when the view does not carry one (never inferred).',
            ),
          }),
        ),
        total: integerField('How many tasks the old board holds in total, before the limit.'),
        truncated: booleanField('Whether tasks were cut by `limit`; total still reports the full count.'),
        members: arrayField(
          'Old roster, from whichever projection carried it. Empty when neither did.',
          objectSchema({
            id: stringField('Member Session id, or an empty string when unknown.'),
            name: stringField('Roster name, or an empty string when the source predates names.'),
            mode: stringField('0.2.2 catalog mode (continuable, one-shot, external, unknown), or an empty string on the 0.2.1 topology.'),
            phase: stringField('0.2.1 member phase (provisioning, active, failed), or an empty string on the 0.2.2 topology.'),
          }),
        ),
        membersSource: stringField(
          'Which projection answered for the roster: "agentTeam" (0.2.1), "subagentCatalog" (0.2.2), or "none".',
        ),
        note: stringField(
          'Why data is missing or partial (Session not loaded, projection unreadable or misshapen, roster unavailable, truncation), and a warning when `sessionId` is the caller\'s own Session; empty when the read was complete.',
        ),
      }),
      render: renderJson,
    },
    async execute(args, exec) {
      const lead = requireLead(ctx, exec.agent);
      // Nothing below this line may write: no board open, no task mutation.
      void lead;
      const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';
      if (sessionId === '') {
        throw new Error('sessionId is required: pass the old root Session id from the handover brief.');
      }
      const raw = Number(args.limit);
      const limit = Number.isFinite(raw)
        ? Math.min(Math.max(Math.trunc(raw), 1), RECOVER_MAX_LIMIT)
        : RECOVER_DEFAULT_LIMIT;
      return recoverBoard(ctx, sessionId, limit, lead.session?.id);
    },
  });
}

/** @param {object} ctx - Host context. */
function makeRequestHireTool(ctx, state) {
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
        taskId: stringField('Created task id, or an empty string when the request went to the Lead as a message.'),
        subject: stringField('Created task subject.'),
        delivered: stringField(
          '"task" when the request landed on the shared board, "message" when the board was not readable and it was delivered to the Lead directly.',
        ),
      }),
      render: renderJson,
    },
    async execute(args, exec) {
      const membership = requireTeammate(ctx, exec.agent);
      const role = roleById(args.role);
      if (role === undefined) throw new Error(`Unknown Work Team role "${String(args.role)}".`);
      // A hiring request for a benched seat would be unactionable: the Lead's
      // `hire_teammate` refuses the same role, so the task would sit on the board
      // forever. Refuse at the source, with the same sentence.
      if (isBenched(parseBenchRoles(state.config.benchRoles), role.id)) {
        throw new Error(buildBenchNotice(role));
      }
      const existing = (await teammatesOf(ctx, membership.root)).find((member) => member.name === role.id);
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
    disposers.push(agent.ctx.tools.register(makeAcceptTaskTool(ctx, state)));
    disposers.push(agent.ctx.tools.register(makeHandoverTool(ctx, state)));
    disposers.push(agent.ctx.tools.register(makeRecoverTool(ctx)));
    // Live handover: a guard is evaluated on every call, so the panel switch works
    // without reinstalling the scope (the Config is volatile, no remount happens).
    disposers.push(
      agent.ctx.tools.guard((exec) => handsOffReason(state.config.leadHandsOff, exec.name)),
    );
    // The sixth delegation path: the kernel's own `send_message`.
    disposers.push(agent.ctx.tools.guard((exec) => benchSendDenial(state, exec)));
    disposers.push(
      agent.ctx.tools.guard((exec) => {
        // The expansion tool is named per topology: 0.2.1 has `spawn_teammate`,
        // 0.2.2 removed it and grows the team with `subagent` / `subagent_fork`.
        // Guarding only the old name left the cap toothless after the upgrade —
        // `teamSize` is this plugin's own setting and must not depend on a tool
        // name the kernel happened to rename.
        //
        // On 0.2.1 the two delegation tools are deliberately NOT captured: the
        // Lead could always open temporary workers there regardless of team
        // size, and this guard must not tighten a shipped behaviour.
        const guarded = usesSubagentTopology(ctx)
          ? new Set(['subagent', 'subagent_fork'])
          : new Set(['spawn_teammate']);
        if (!guarded.has(exec.name)) return undefined;
        let count;
        try {
          count = seatCount(ctx, agent, liveChildrenOf(ctx, agent));
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
      // After a successful install (fresh hire or resume): a failed preset is
      // recorded and reported, never thrown — the employee is already useful
      // without it.
      applyRolePreset(ctx, state, agent, role);
    }
    disposers.push(agent.ctx.tools.register(makeRequestHireTool(ctx, state)));
    // Registered unconditionally: the hire switch is enforced per call by the guard
    // below, so turning it on in the panel works for employees already on the team.
    disposers.push(agent.ctx.tools.register(makeHireTool(ctx, state, { employee: true })));
    // One guard, two live switches: the hire switch and the worker cap.
    disposers.push(
      agent.ctx.tools.guard((exec) => employeeDenialReason(ctx, state, agent, exec.name)),
    );
    // Employees message each other directly too; the bench applies on that path.
    disposers.push(agent.ctx.tools.guard((exec) => benchSendDenial(state, exec)));
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
    membership = membershipOf(ctx, agent);
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
      // Same pass, same reason: a preset changed in the panel must land without a
      // remount, and the call is a no-op when the Session is already on it.
      applyRolePreset(ctx, state, agent, role);
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
    /** agentId -> { spec, kind, detail } for a configured model that is not applied. */
    modelErrors: new Map(),
    /** roleId -> why its configured permission preset is not applied. */
    presetErrors: new Map(),
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
      membership = membershipOf(ctx, agent);
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
