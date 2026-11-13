/**
 * Bench ("停职") rules.
 *
 * A benched role keeps its seat and its history but takes no new work: the
 * configuration value `benchRoles` is the only storage, because DSH Settings
 * writes it back to the profile patch — a plugin-owned store would be a second
 * source of truth that survives a reset.
 *
 * Pure rules only: the Host reads the config, resolves roles through
 * `roleForName`, and renders these strings.
 */

import { roleForName } from './roles.js';

/** Separators accepted inside `benchRoles`: commas (both widths), semicolons, and whitespace. */
const SEPARATORS = /[,，、;；\s]+/u;

/**
 * Parse one `benchRoles` value.
 *
 * Aliases resolve through `roleForName`, so `fe, backend` benches the same two
 * seats a user would expect. Unrecognised tokens are returned, never dropped:
 * a typo must show up in the report instead of silently benching nobody.
 *
 * @param {unknown} raw - raw Config value.
 * @returns {{ roles: string[], unknown: string[] }} resolved role ids in input order, and unparsable tokens.
 */
export function parseBenchRoles(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const roles = [];
  const unknown = [];
  for (const token of text.split(SEPARATORS)) {
    const name = token.trim();
    if (name === '') continue;
    const role = roleForName(name);
    if (role === undefined) {
      if (!unknown.includes(name)) unknown.push(name);
      continue;
    }
    if (!roles.includes(role.id)) roles.push(role.id);
  }
  return { roles, unknown };
}

/**
 * Whether one roster name is benched.
 * @param {{ roles: string[] }} bench - parsed bench state.
 * @param {unknown} name - roster name (role id for a direct child).
 * @returns {boolean} true when the seat is benched.
 */
export function isBenched(bench, name) {
  return typeof name === 'string' && bench.roles.includes(name);
}

/**
 * The one line every refusal uses, so the Lead reads the same instruction
 * whichever entry point it hit.
 * @param {object} role - role definition from `lib/roles.js`.
 * @param {{ forUser?: boolean }} [options] - `forUser` keeps the second person for a chat-facing rewrite.
 * @returns {string} refusal text.
 */
export function buildBenchNotice(role, options = {}) {
  const label = `${role.zh.name}（${role.id}）`;
  const who = options.forUser === true ? label : `${label} 当前停职`;
  return `${who}：停职期间不接新活（benchRoles 里有它），但它手上的在办任务仍然可以正常验收。要让它复职，在 DSH 设置 → 团队设置里把 benchRoles 里的 ${role.id} 去掉，再重试。`;
}

/**
 * One-line list for a report, or an empty string.
 * @param {string[]} roles - benched role ids.
 * @returns {string} comma-separated list.
 */
export function benchListText(roles) {
  return Array.isArray(roles) && roles.length > 0 ? roles.join('、') : '';
}
