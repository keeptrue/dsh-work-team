/**
 * Team token budget: one shared ceiling over the Lead and every employee.
 *
 * The unit is the same lifetime total `team_status` already prints per member —
 * `sumTokenTotals()` over the `tokenUsage` projection — so the number in the
 * report and the number the gate compares are the same number, read by the same
 * code path. Nothing here invents a value: a missing projection reads as 0, an
 * absent limit reads as 0 (no ceiling), and only a real, whole, positive limit
 * can ever block a call.
 *
 * `warn` (the default) attaches the budget to the receipt and lets the work go
 * out. `block` refuses the two paths that SPEND tokens — `dispatch_tasks` and
 * `hire_teammate` — with a structured refusal that names the three things the
 * Lead can actually do about it.
 *
 * `accept_task` is deliberately never refused. Acceptance is bookkeeping, not
 * spending: blocking it would strand finished work once the ceiling is reached
 * (`used` only grows, the task stays `in_progress` and can never be written off),
 * which is a deadlock rather than a saving. It reports the budget instead.
 */

/** Accepted `tokenBudgetOnExceed` values, in documentation order. */
export const BUDGET_MODES = ['warn', 'block'];

/** Default ceiling: 0 means "not configured", i.e. unlimited. */
export const DEFAULT_TOKEN_BUDGET = 0;

/**
 * Normalize one budget ceiling.
 *
 * Unlike the worker cap, the fallback for unparsable input is 0 rather than the
 * schema default: 0 is "no ceiling", so a mistyped or blank Settings value can
 * never turn into a limit nobody asked for and refuse the Lead's work. A
 * negative value is clamped to 0 for the same reason.
 *
 * @param {unknown} value - raw Config value.
 * @returns {number} whole number of tokens, 0 = unlimited.
 */
export function clampTokenBudget(value) {
  if (value === undefined || value === null) return DEFAULT_TOKEN_BUDGET;
  if (typeof value === 'string' && value.trim() === '') return DEFAULT_TOKEN_BUDGET;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_TOKEN_BUDGET;
  return Math.max(Math.trunc(number), 0);
}

/**
 * Normalize `tokenBudgetOnExceed`.
 *
 * Only an exact `block` hardens the gate; everything else is `warn`, which is
 * both the schema default and the safe reading of a value written by a Settings
 * document that predates this switch.
 *
 * @param {unknown} value - raw Config value.
 * @returns {'warn' | 'block'} usable mode.
 */
export function normalizeBudgetMode(value) {
  return value === 'block' ? 'block' : 'warn';
}

/**
 * Assemble the budget block every receipt and `team_status` carries.
 *
 * `exceeded` is reported even in `warn` mode, because that is the whole point of
 * the warn setting: the Lead sees how far over the line it is while still
 * getting its work out. `used >= limit` counts as exhausted — spending that has
 * already happened cannot be taken back, so a team that reaches the ceiling is
 * treated as over it.
 *
 * @param {number} used - lifetime tokens spent by the Lead plus every employee.
 * @param {number} limit - configured ceiling, 0 = unlimited.
 * @param {'warn' | 'block'} mode - what happens when exceeded.
 * @param {number} [unknown] - members whose usage could not be read.
 * @param {{ missingSession?: number, projectionError?: number }} [reasons] - why those members could not be read.
 * @returns {{ used: number, limit: number, mode: string, exceeded: boolean, unknown: number, note: string }} budget block.
 */
export function budgetSnapshot(used, limit, mode, unknown = 0, reasons = {}) {
  const wholeUsed = Number.isFinite(used) ? Math.max(Math.trunc(used), 0) : 0;
  const wholeLimit = Number.isFinite(limit) ? Math.max(Math.trunc(limit), 0) : 0;
  const wholeUnknown = Number.isFinite(unknown) ? Math.max(Math.trunc(unknown), 0) : 0;
  const missing = Number.isFinite(reasons.missingSession)
    ? Math.max(Math.trunc(reasons.missingSession), 0)
    : 0;
  const broken = Number.isFinite(reasons.projectionError)
    ? Math.max(Math.trunc(reasons.projectionError), 0)
    : 0;
  return {
    used: wholeUsed,
    limit: wholeLimit,
    mode: mode === 'block' ? 'block' : 'warn',
    exceeded: wholeLimit > 0 && wholeUsed >= wholeLimit,
    // How many team members' usage could not be read. Their spend is missing
    // from `used`, so the ceiling can be crossed while the number looks fine —
    // which is why this is reported instead of folded into a silent 0.
    unknown: wholeUnknown,
    note: budgetNote(wholeUnknown, wholeLimit, missing, broken),
  };
}

/**
 * One line saying what the missing usage is missing because of.
 *
 * The two causes lead to different fixes — a session that was never loaded is a
 * storage/lifecycle question, while an unreadable projection is a broken
 * composition — so they are named separately when both occur. `unknown` itself
 * stays one number: it is a count, not a diagnosis.
 * @param {number} unknown - members whose usage could not be read.
 * @param {number} limit - configured ceiling, 0 = unlimited.
 * @param {number} missing - members with no Session this Host could read.
 * @param {number} broken - members whose `tokenUsage` projection threw.
 * @returns {string} note, or an empty string when nothing is missing.
 */
function budgetNote(unknown, limit, missing, broken) {
  if (unknown === 0) return '';
  const budgetLine = `预算上限按 ${limit === 0 ? '不限' : limit} 计`;
  if (missing > 0 && broken > 0) {
    return `${unknown} 个成员未计入用量（${missing} 个会话没有加载、${broken} 个用量投影读不到），实际已用可能更高（${budgetLine}）。`;
  }
  if (missing > 0) {
    return `${missing} 个成员的会话没有加载，未计入用量；实际已用可能更高（${budgetLine}）。`;
  }
  return `${broken} 个成员的用量投影读不到，未计入用量；实际已用可能更高（${budgetLine}）。`;
}

/**
 * Whether one budget snapshot refuses work.
 * @param {{ limit: number, mode: string, exceeded: boolean }} budget - budget block.
 * @returns {boolean} true when this call must not spend tokens.
 */
export function budgetBlocks(budget) {
  return budget.mode === 'block' && budget.exceeded === true;
}

/**
 * The three things the Lead can do about an exhausted budget.
 *
 * Kept to exactly three, concrete and actionable: raise the ceiling, move the
 * expensive role to a cheaper model, or stop giving one member work. A refusal
 * that only says "over budget" makes the Lead retry the same call.
 *
 * @param {{ used: number, limit: number }} budget - budget block.
 * @param {string} [topRole] - the biggest consumer, when the caller knows it.
 * @returns {string[]} three actions.
 */
export function budgetActions(budget, topRole) {
  const who = typeof topRole === 'string' && topRole !== '' ? topRole : '用量最大的角色';
  return [
    `提高上限：在 DSH 设置 → 团队设置里把「团队 token 预算」从 ${budget.limit} 调大（或改 cordis.patch.yml 的 teamTokenBudget）；当前已用 ${budget.used}。`,
    `换便宜模型：给 ${who} 换个更便宜的档位（团队设置里对应的 modelXxx，例如 provider::model 换成 flash 型号），再重新派活。`,
    `改派给别人：先 team_status 看谁在花钱、谁手上有活，再把这条活用 dispatch_tasks 交给一个用量低且空闲的角色，或由你自己做完这一条、不再派单。`,
  ];
}

/**
 * The structured refusal the three spending paths return.
 *
 * Shape is shared on purpose: a Lead that reads one refusal can read all three.
 * @param {{ used: number, limit: number, mode: string, exceeded: boolean, unknown: number, note: string }} budget - budget block.
 * @param {string} error - one sentence naming what was refused.
 * @param {string} [topRole] - the biggest consumer, when known.
 * @returns {{ accepted: boolean, budget: object, actions: string[], error: string }} refusal payload.
 */
export function budgetRefusal(budget, error, topRole) {
  return {
    accepted: false,
    // Only the four fields every receipt documents; the biggest-consumer hint is
    // a wording input for `actions`, not part of the budget value.
    budget: {
      used: budget.used,
      limit: budget.limit,
      mode: budget.mode,
      exceeded: budget.exceeded,
      unknown: budget.unknown ?? 0,
      note: budget.note ?? '',
    },
    actions: budgetActions(budget, topRole),
    error,
  };
}
