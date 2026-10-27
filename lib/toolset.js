/**
 * Per-role tool whitelists.
 *
 * An employee Agent inherits the whole host tool surface — around a hundred
 * tools, ~79 KB of JSON schema on every single request — while a role actually
 * uses a dozen or two of them. Each role declares the tools it needs here and
 * `installEmployee` installs that list as one `tools.restrict({ allow })` filter.
 *
 * Two properties of `tools.restrict()` shape this file:
 *
 * 1. It filters only INHERITED global tools. The employee's own scope
 *    registrations (`hire_teammate`, `request_hire`, and the Team tools
 *    `send_message` / `team_task_*` that the Team package registers into
 *    `agent.ctx`) are never filtered, so listing them would be pointless at
 *    runtime. They stay in the lists anyway: the lists document what a role
 *    must be able to do, the tests assert the Team tools are covered, and a
 *    composition that ever moves them to the global plane keeps working.
 * 2. It throws for a name that is not in the current global registry. Which
 *    plugins are installed varies per machine, so the list is a declaration of
 *    intent and `installEmployee` intersects it with the tools that actually
 *    exist before registering anything.
 *
 * The probe that does that intersection must read `restrict()`'s OWN validation
 * set (in `installEmployee`, by calling `restrict()` and reading the rejected
 * error). It must NOT be the unscoped `tools.get(name)` global view:
 * on the Web surface the file, shell, todo, skill, subagent, and web tools are
 * disabled in the global layer and mounted by the session's agent preset into an
 * ANCESTOR layer. A global probe reports `read`, `bash`, and `grep` as missing,
 * and trimming to that list would strip the tools every employee needs.
 */

/**
 * Tools every employee needs: file access, shell, task board, delegation.
 *
 * `subagent` / `subagent_fork` are dropped when the worker cap is 0 — an
 * employee that may not spawn a temporary worker has no use for the schema.
 */
export const CORE_TOOLS = [
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'bash',
  'todo_write',
  'skill',
  'present',
  'send_message',
  'wait_agent',
  'list_agents',
  'team_task_create',
  'team_task_get',
  'team_task_list',
  'team_task_update',
  'subagent',
  'subagent_fork',
];

/** CORE without the two write paths: reviewers and researchers only read. */
export const READONLY = CORE_TOOLS.filter((name) => name !== 'write' && name !== 'edit');

/**
 * Tools a teammate scope registers for itself: the Team package's nine tools and
 * the two hire tools this plugin adds.
 *
 * `tools.restrict()` only filters INHERITED tools, so these names are exempt by
 * design — and naming one in an allow list makes the call throw. They stay
 * visible whether or not they are declared, so the allow list skips them.
 */
export const OWN_LAYER_TOOLS = new Set([
  'send_message',
  'wait_agent',
  'list_agents',
  'interrupt_agent',
  'team_task_create',
  'team_task_get',
  'team_task_list',
  'team_task_update',
  'spawn_teammate',
  'hire_teammate',
  'request_hire',
]);

/**
 * The built-in browser, cut to the read-then-act loop.
 *
 * The full `dsh_browser_*` surface is 34 tools and ~22 KB on its own; a UI role
 * needs to open a page, look at it, and drive one interaction, not to manage
 * sessions, cookies, or downloads from a browser it does not own.
 */
export const BROWSER_UI = [
  'dsh_browser_open',
  'dsh_browser_snapshot',
  'dsh_browser_screenshot',
  'dsh_browser_content',
  'dsh_browser_click',
  'dsh_browser_type',
  'dsh_browser_wait',
  'dsh_browser_close_tab',
];

/** Long-running process control: ops runs builds and servers. */
export const TERMINAL_TOOLS = [
  'terminal_open',
  'terminal_send',
  'terminal_read',
  'terminal_list',
  'terminal_close',
  'terminal_signal',
];

/** Background job collection, paired with TERMINAL_TOOLS. */
export const JOB_TOOLS = ['job_list', 'job_output', 'job_kill'];

/** Reminders: ops owns scheduled maintenance. */
export const SCHEDULE_TOOLS = [
  'schedule_create',
  'schedule_update',
  'schedule_list',
  'schedule_delete',
];

/**
 * Resolve one role's allow list.
 *
 * @param {{ id?: string, tools?: unknown }} role - role definition from lib/roles.js.
 * @param {{ workers?: number }} [options] - temporary-worker cap; 0 removes delegation.
 * @returns {string[]} deduplicated tool names, declaration order preserved.
 */
export function employeeAllowList(role, options = {}) {
  const declared = Array.isArray(role?.tools) ? role.tools : [];
  const names = [];
  const seen = new Set();
  for (const name of declared) {
    if (typeof name !== 'string' || name === '' || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  if (options.workers === 0) {
    return names.filter((name) => name !== 'subagent' && name !== 'subagent_fork');
  }
  return names;
}
