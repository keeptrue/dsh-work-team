/**
 * Pure rules behind `autoStart` (automatic team formation) and `leadHandsOff`
 * (Lead tool handover).
 *
 * Kept free of Host imports so the state machine can be tested with plain values:
 * the Host owns timers, Agents, and the abort plumbing.
 */

/** Accepted `autoStart` values. */
export const AUTO_START_MODES = ['off', 'first-message', 'immediate'];

/** Session lifecycle sources that may trigger formation. `clear`/`compact` never do. */
export const AUTO_START_SOURCES = ['startup', 'resume'];

/** Auto-formation states for one Lead; `queued` and `running` hold the idempotency lock. */
export const AUTO_START_STATES = ['queued', 'running', 'done', 'failed'];

/** Tools the Lead loses in hands-off mode. read/grep/bash/team tools stay. */
export const LEAD_HANDS_OFF_DENY = ['write', 'edit'];

/**
 * @param {unknown} value - raw Config value.
 * @returns {'off' | 'first-message' | 'immediate'} normalized mode.
 */
export function normalizeAutoStart(value) {
  if (typeof value !== 'string') return 'off';
  const normalized = value.trim().toLowerCase();
  return AUTO_START_MODES.includes(normalized) ? normalized : 'off';
}

/**
 * Per-call gate for the Lead's file-mutating tools.
 *
 * The Config value is volatile and a settings save does not remount the plugin, so
 * deciding this at install time would leave the switch dead until a reload.
 * Evaluating it on every call makes the panel toggle take effect immediately, in
 * both directions.
 *
 * @param {unknown} enabled - `leadHandsOff` Config value.
 * @param {unknown} toolName - tool the Lead is about to run.
 * @returns {string | undefined} denial reason, or undefined to allow the call.
 */
export function handsOffReason(enabled, toolName) {
  if (enabled !== true) return undefined;
  if (typeof toolName !== 'string') return undefined;
  if (!LEAD_HANDS_OFF_DENY.includes(toolName)) return undefined;
  return 'Work Team hands-off mode is on: the Lead does not write or edit files. Delegate this change to the responsible teammate; if the Lead really must do it, the user can turn hands-off off in the office panel.';
}

/**
 * Whether a freshly installed Lead should begin formation.
 * @param {{ mode?: unknown, source?: unknown, role?: unknown, record?: unknown }} input
 *   configured mode, lifecycle source, caller's roster role, and the existing lock.
 * @returns {boolean} whether to schedule formation.
 */
export function shouldAutoStart({ mode, source, role, record } = {}) {
  if (normalizeAutoStart(mode) === 'off') return false;
  if (role !== 'lead') return false;
  if (record !== undefined && record !== null) return false;
  return AUTO_START_SOURCES.includes(source);
}

/**
 * @param {unknown} record - lock value.
 * @returns {boolean} whether formation still owns the lock.
 */
export function autoStartIsActive(record) {
  return record === 'queued' || record === 'running';
}

/**
 * Default roles still to hire, in line-up order, bounded by the seat count.
 * @param {readonly string[]} lineup - default line-up.
 * @param {number} capacity - configured team size.
 * @param {Set<string> | readonly string[]} present - teammate names already on the team.
 * @returns {string[]} role ids to hire.
 */
export function planAutoStartLineup(lineup, capacity, present) {
  const taken = present instanceof Set ? present : new Set(present ?? []);
  const limit = Number.isSafeInteger(capacity) && capacity > 0 ? capacity : 0;
  const pending = [];
  let size = taken.size;
  for (const id of lineup ?? []) {
    if (size >= limit) break;
    if (taken.has(id)) continue;
    pending.push(id);
    size += 1;
  }
  return pending;
}
