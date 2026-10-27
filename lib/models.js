/**
 * Small pure helpers shared by the Host plugin and its tests.
 */

/** Separator used in Config strings: provider::model[::effort]. */
export const MODEL_SEPARATOR = '::';

/**
 * Parse one `provider::model[::effort]` Config value.
 * @param {unknown} spec - raw Config value.
 * @returns {{ provider: string, model: string, reasoningEffort?: string } | undefined}
 *   a model selection, or undefined for "follow the main model" / malformed input.
 */
export function parseModelSpec(spec) {
  if (typeof spec !== 'string') return undefined;
  const trimmed = spec.trim();
  if (trimmed === '') return undefined;
  const parts = trimmed.split(MODEL_SEPARATOR).map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) return undefined;
  const [provider, model, effort] = parts;
  if (provider === '' || model === '') return undefined;
  return {
    provider,
    model,
    ...(effort === undefined || effort === '' ? {} : { reasoningEffort: effort }),
  };
}

/**
 * @param {{ provider: string, model: string, reasoningEffort?: string } | undefined} selection - model selection.
 * @returns {string} Config spelling; empty for an absent selection.
 */
export function formatModelSpec(selection) {
  if (selection === undefined) return '';
  return [selection.provider, selection.model, selection.reasoningEffort]
    .filter((part) => part !== undefined && part !== '')
    .join(MODEL_SEPARATOR);
}

/**
 * @param {{ provider?: string, model?: string, reasoningEffort?: string } | null | undefined} left - first selection.
 * @param {{ provider?: string, model?: string, reasoningEffort?: string } | null | undefined} right - second selection.
 * @returns {boolean} whether both name the same route.
 */
export function sameSelection(left, right) {
  if (left === undefined || left === null || right === undefined || right === null) return false;
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    (left.reasoningEffort ?? '') === (right.reasoningEffort ?? '')
  );
}

/**
 * @param {unknown} value - candidate Config value.
 * @param {number} fallback - default when the value is not a usable integer.
 * @param {number} max - upper bound.
 * @returns {number} a positive whole number in [1, max].
 */
export function clampTeamSize(value, fallback, max) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return fallback;
  return Math.min(number, max);
}

/**
 * @param {number} value - token count.
 * @returns {string} compact human-readable count.
 */
export function formatTokens(value) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

/**
 * @param {number} value - milliseconds.
 * @returns {string} compact duration.
 */
export function formatDuration(value) {
  if (!Number.isFinite(value) || value <= 0) return '0s';
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest === 0 ? `${hours}h` : `${hours}h${minuteRest}m`;
}

/**
 * Sum the four disjoint token buckets used by the tokenUsage projection.
 * @param {{ uncachedInputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number } | undefined} totals - projection totals.
 * @returns {number} total tokens.
 */
export function sumTokenTotals(totals) {
  if (totals === undefined) return 0;
  return (
    (totals.uncachedInputTokens ?? 0) +
    (totals.outputTokens ?? 0) +
    (totals.cacheReadTokens ?? 0) +
    (totals.cacheWriteTokens ?? 0)
  );
}
