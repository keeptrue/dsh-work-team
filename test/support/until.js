/**
 * Wait for an event, not for a stopwatch.
 *
 * The Host schedules real work on timers (formation lanes, the settings debounce,
 * the model queue), so `await delay(10)` followed by an assertion is a bet that
 * the machine finished in time — a bet that loses on a loaded CI box and shows up
 * as `actual 0, expected 2`. `until()` polls the condition the test actually
 * cares about and returns as soon as it holds, so the assertion still means
 * "this happened" and no longer means "this happened within 10 ms".
 *
 * It deliberately has no silent success path: a condition that never holds
 * throws, and the error prints the last observed value plus whatever the caller
 * passed as `describe`, so a real regression still fails loudly instead of
 * passing on a timeout.
 */

/**
 * @param {() => unknown} predicate - condition to poll; may be async.
 * @param {{ timeout?: number, step?: number, describe?: string | (() => unknown) }} [options]
 *   `timeout` is the failure bound (not the expectation), `step` the poll interval,
 *   `describe` a snapshot to print on timeout.
 * @returns {Promise<unknown>} the truthy value the predicate returned.
 * @throws when the condition is still false after `timeout` milliseconds.
 */
export async function until(predicate, options = {}) {
  const { timeout = 1000, step = 5, describe } = options;
  const started = Date.now();
  let last;
  for (;;) {
    last = await predicate();
    if (last) return last;
    const waited = Date.now() - started;
    if (waited >= timeout) {
      let snapshot;
      try {
        snapshot = typeof describe === 'function' ? describe() : describe;
      } catch (error) {
        snapshot = `describe() threw: ${error instanceof Error ? error.message : String(error)}`;
      }
      throw new Error(
        `until() timed out after ${waited}ms${snapshot === undefined ? '' : `; current state: ${format(snapshot)}`}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, step));
  }
}

/** @param {unknown} value - snapshot. @returns {string} one printable line. */
function format(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
