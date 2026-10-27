/**
 * Member status: the turn-settlement state machine and the store behind it.
 *
 * `deriveStatus` and `createMemberRuntime` are sliced out of client.js and run
 * against a fake Host, so these assertions exercise the shipped source instead
 * of a copy of it. A rewrite that breaks the priority ladder, the
 * acknowledgement ledger, or the poller lifecycle fails here.
 *
 * What is pinned is what the office tells the boss: a freshly built team reads
 * "ready" (a seat was taken), not "N new results", and `completionUnread` alone
 * never paints a row as done.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/** Slice [startMarker, endMarker) out of client.js; drift fails loudly. */
function sliceSource(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `client.js no longer contains ${JSON.stringify(startMarker)}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `client.js lost ${JSON.stringify(endMarker)} after ${JSON.stringify(startMarker)}`);
  return source.slice(start, end);
}

const ERROR_TEXT = sliceSource('    function errorText(reason) {', '\n    // Dock sparkles');
const STORE = sliceSource('    const ACK_PREFIX = ', '    const memberRuntime = createMemberRuntime();');
const DERIVE = sliceSource('    function deriveStatus(member, signals) {', '\n    /** Team members outside the mirrored roster');

const runtimeFactory = new Function(
  'window',
  'document',
  'console',
  'setInterval',
  'clearInterval',
  `${ERROR_TEXT}\n${STORE}\nconst memberRuntime = createMemberRuntime();\n${DERIVE}\nreturn { memberRuntime, deriveStatus, POLL_MS, NUDGE_MS, DEGRADE_AFTER };`,
);

const LEAD = 'session-lead';
const ACK_KEY = (lead) => `dsh-work-team:ack:${lead}`;
const member = (id, phase = 'active') => ({ id, phase });

/** Let every pending await inside the store run to completion. */
async function flush() {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A fake browser plus a fake Host. Pass the same `store` to two harnesses to
 * simulate a reload; everything else stays isolated per harness.
 */
function createHarness(options = {}) {
  const store = options.store ?? new Map();
  const localStorage =
    options.localStorage ?? {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    };
  const windowObject = options.window ?? { localStorage };
  const listeners = new Set();
  const documentObject = {
    visibilityState: options.visibility ?? 'visible',
    addEventListener: (type, listener) => {
      if (type === 'visibilitychange') listeners.add(listener);
    },
    removeEventListener: (type, listener) => {
      if (type === 'visibilitychange') listeners.delete(listener);
    },
  };

  const intervals = new Map();
  let intervalSeq = 0;
  const byId = {};
  const timings = {};
  const failures = {};
  const warnings = [];
  let reads = 0;

  let snapshotUnavailable = false;
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => {
          if (snapshotUnavailable) throw new Error('session list store is being swapped');
          return { byId };
        },
      },
    },
    remote: {
      session: {
        projections: async ({ sessionId }) => {
          reads += 1;
          if ((failures[sessionId] ?? 0) > 0) {
            failures[sessionId] -= 1;
            throw new Error('session/projections-unavailable');
          }
          if (timings[sessionId] === undefined) return { ok: true, value: null };
          return { ok: true, value: { values: { subagentTiming: timings[sessionId] } } };
        },
      },
    },
  };

  const api = runtimeFactory(
    windowObject,
    documentObject,
    { info() {}, warn: (line) => warnings.push(String(line)), log() {} },
    (fn, ms) => {
      const id = (intervalSeq += 1);
      intervals.set(id, { fn, ms });
      return id;
    },
    (id) => {
      intervals.delete(id);
    },
  );
  api.memberRuntime.bind(ctx);

  return {
    ...api,
    store,
    byId,
    timings,
    failures,
    intervals,
    listeners,
    documentObject,
    warnings,
    reads: () => reads,
    setSnapshotUnavailable(value) {
      snapshotUnavailable = value === true;
    },
    setVisibility(state) {
      documentObject.visibilityState = state;
      for (const listener of listeners) listener();
    },
    statusOf(target, extra = {}) {
      return api.deriveStatus(target, {
        running: false,
        pending: false,
        unread: false,
        timing: api.memberRuntime.runtimeOf(target.id),
        ack: api.memberRuntime.ackOf(target.id),
        ...extra,
      });
    },
    async pump() {
      for (const entry of intervals.values()) entry.fn();
      await flush();
    },
  };
}

const pure = createHarness();
const { deriveStatus } = pure;

// ---------------------------------------------------------------------------
// The priority ladder. Every row is one level; the order is the contract.
// ---------------------------------------------------------------------------

test('deriveStatus walks the nine-level priority ladder', () => {
  const settled = (settledMs, extra = {}) => ({
    settledMs,
    active: false,
    lastTurnCompleted: true,
    degraded: false,
    ...extra,
  });
  const ack = (ackedMs, readySeen = true) => ({ ackedMs, readySeen });
  const cases = [
    ['failed outranks a pending, running member', { phase: 'failed' }, { pending: true, timing: settled(9000, { active: true }) }, 'failed'],
    ['provisioning outranks a pending, running member', { phase: 'provisioning' }, { pending: true, timing: settled(9000, { active: true }) }, 'provisioning'],
    ['a pending interaction is waiting', { phase: 'active' }, { pending: true, timing: settled(9000, { active: true }) }, 'waiting'],
    ['an open turn is working', { phase: 'active' }, { timing: settled(5000, { active: true }), ack: ack(5000) }, 'working'],
    ['a turn that ended badly is error', { phase: 'active' }, { timing: settled(5000, { lastTurnCompleted: false }), ack: ack(0) }, 'error'],
    ['nothing settled yet is idle', { phase: 'active' }, { timing: settled(0) }, 'idle'],
    ['no reading at all is idle', { phase: 'active' }, {}, 'idle'],
    ['an unacknowledged settlement is ready', { phase: 'active' }, { timing: settled(8000), ack: ack(0, false) }, 'ready'],
    ['a settlement nobody opened is done', { phase: 'active' }, { timing: settled(16000), ack: ack(8000) }, 'done'],
    ['a settlement already read is idle', { phase: 'active' }, { timing: settled(16000), ack: ack(16000) }, 'idle'],
  ];
  for (const [label, target, signals, expected] of cases) {
    const actual = deriveStatus(target, { running: false, pending: false, unread: false, ...signals });
    assert.equal(actual, expected, label);
  }
});

test('an unacknowledged member never reports done', () => {
  const timing = { settledMs: 99999, active: false, lastTurnCompleted: true, degraded: false };
  assert.equal(deriveStatus({ phase: 'active' }, { timing, ack: { ackedMs: 0, readySeen: false } }), 'ready');
  assert.equal(deriveStatus({ phase: 'active' }, { timing, ack: undefined }), 'ready');
});

test('a settlement equal to the acknowledged total is idle, not done', () => {
  const timing = { settledMs: 4200, active: false, lastTurnCompleted: true, degraded: false };
  assert.equal(deriveStatus({ phase: 'active' }, { timing, ack: { ackedMs: 4200, readySeen: true } }), 'idle');
  assert.equal(deriveStatus({ phase: 'active' }, { timing, ack: { ackedMs: 4199, readySeen: true } }), 'done');
});

test('a running turn outranks ready and done', () => {
  const timing = { settledMs: 9000, active: true, lastTurnCompleted: true, degraded: false };
  assert.equal(deriveStatus({ phase: 'active' }, { timing, ack: { ackedMs: 0, readySeen: false } }), 'working');
  assert.equal(deriveStatus({ phase: 'active' }, { timing, ack: { ackedMs: 1000, readySeen: true } }), 'working');
});

test('a pending interaction outranks a running turn', () => {
  const timing = { settledMs: 9000, active: true, lastTurnCompleted: true, degraded: false };
  assert.equal(
    deriveStatus({ phase: 'active' }, { pending: true, timing, ack: { ackedMs: 1000, readySeen: true } }),
    'waiting',
  );
});

test('the degraded ladder reports the first completion as ready', () => {
  const timing = { settledMs: 4000, active: false, lastTurnCompleted: true, degraded: true };
  const degraded = (signals) => deriveStatus({ phase: 'active' }, { timing, ...signals });
  assert.equal(degraded({ running: true, unread: true, ack: { ackedMs: 0, readySeen: true } }), 'working', 'running wins over a stale unread flag');
  assert.equal(degraded({ unread: true, ack: { ackedMs: 0, readySeen: false } }), 'ready', 'the first completion is ready, not done');
  assert.equal(degraded({ unread: true, ack: { ackedMs: 0, readySeen: true } }), 'done');
  assert.equal(degraded({ unread: true, ack: undefined }), 'idle', 'with no ledger there is nothing to compare against');
  assert.equal(degraded({ unread: false, ack: { ackedMs: 0, readySeen: true } }), 'idle');
});

// ---------------------------------------------------------------------------
// The store: onboarding, acknowledgement, reload, degradation, lifecycle.
// ---------------------------------------------------------------------------

test('a fresh team settles into ready instead of N unread results', async () => {
  const h = createHarness();
  h.byId.m1 = { sessionId: 'm1', agentAvailable: true, running: false };
  h.timings.m1 = { settledMs: 0, active: { since: 1, through: 2 } };
  const m1 = member('m1', 'provisioning');
  h.memberRuntime.watch(LEAD, [m1]);
  await flush();
  // The spawn completed: the roster flips to active while onboarding still runs.
  m1.phase = 'active';

  assert.equal(h.statusOf(m1), 'working', 'the onboarding turn is a real turn');
  h.timings.m1 = { settledMs: 8000 };
  await h.pump();

  assert.equal(h.statusOf(m1), 'ready', 'the onboarding settlement is a taken seat, not a result');
  assert.equal(h.statusOf(m1, { unread: true }), 'ready', 'completionUnread alone must not paint a result');
  assert.deepEqual(JSON.parse(h.store.get(ACK_KEY(LEAD))), { m1: { ackedMs: 0, readyMs: 8000, readySeen: false } });
});

test('a seven-person team all reaches ready, and only the member with a task moves', async () => {
  const h = createHarness();
  const roles = ['pm', 'frontend', 'backend', 'reviewer', 'researcher', 'designer', 'ops'];
  const members = roles.map((role) => member(`session-${role}`, 'provisioning'));
  for (const target of members) {
    h.byId[target.id] = { sessionId: target.id, agentAvailable: true, running: false };
    h.timings[target.id] = { settledMs: 0, active: { since: 1 } };
  }
  h.memberRuntime.watch(LEAD, members);
  await flush();
  for (const target of members) target.phase = 'active';
  assert.deepEqual(members.map((target) => h.statusOf(target)), roles.map(() => 'working'));

  // Onboarding settles one by one, exactly as seven spawns finish.
  for (let i = 0; i < members.length; i += 1) {
    h.timings[members[i].id] = { settledMs: 4000 + i * 500 };
    await h.pump();
  }
  assert.deepEqual(
    members.map((target) => h.statusOf(target, { unread: true })),
    roles.map(() => 'ready'),
    'seven real turns must not read as seven results',
  );

  const ledger = JSON.parse(h.store.get(ACK_KEY(LEAD)));
  assert.equal(Object.keys(ledger).length, roles.length, 'every seat gets a ledger entry');
  assert.ok(
    Object.values(ledger).every((entry) => entry.ackedMs === 0 && entry.readySeen === false),
    'nothing may be acknowledged for a team nobody opened',
  );

  const backend = members[2];
  h.timings[backend.id] = { settledMs: 8000, active: { since: 9 } };
  await h.pump();
  assert.equal(h.statusOf(backend), 'working');
  h.timings[backend.id] = { settledMs: 12000 };
  await h.pump();
  assert.equal(h.statusOf(backend), 'done');

  h.memberRuntime.ackMember(LEAD, backend.id);
  assert.equal(h.statusOf(backend), 'idle');
  assert.deepEqual(
    members.filter((target) => target !== backend).map((target) => h.statusOf(target)),
    roles.filter((role) => role !== 'backend').map(() => 'ready'),
    'opening one chat must not move the other six',
  );
});

test('the onboarding total is the threshold, and the next turn past it is a result', async () => {
  const h = createHarness();
  h.byId.m1 = { sessionId: 'm1', agentAvailable: true, running: false };
  h.timings.m1 = { settledMs: 0, active: { since: 1, through: 2 } };
  const m1 = member('m1', 'provisioning');
  h.memberRuntime.watch(LEAD, [m1]);
  await flush();
  m1.phase = 'active';
  h.timings.m1 = { settledMs: 8000 };
  await h.pump();
  assert.equal(h.statusOf(m1), 'ready');
  assert.deepEqual(h.memberRuntime.ackOf('m1'), {
    lead: LEAD,
    ackedMs: 0,
    readyMs: 8000,
    readySeen: false,
    pendingAck: false,
  });

  // A real task. Its start is not what matters: the settle past the threshold is.
  h.timings.m1 = { settledMs: 8000, active: { since: 9, through: 10 } };
  await h.pump();
  assert.equal(h.statusOf(m1), 'working');
  assert.equal(h.memberRuntime.ackOf('m1').ackedMs, 0, 'observing a running turn must not acknowledge the seat');

  h.timings.m1 = { settledMs: 16000 };
  await h.pump();
  assert.equal(h.statusOf(m1), 'done');

  h.memberRuntime.ackMember(LEAD, 'm1');
  assert.equal(h.statusOf(m1), 'idle');
  assert.deepEqual(JSON.parse(h.store.get(ACK_KEY(LEAD))), {
    m1: { ackedMs: 16000, readyMs: 8000, readySeen: true },
  });
});

test('a reload reuses the ledger and still reports a result that landed while closed', async () => {
  const store = new Map();
  const first = createHarness({ store });
  first.byId.m1 = { sessionId: 'm1', agentAvailable: true, running: false };
  first.timings.m1 = { settledMs: 16000 };
  const m1 = member('m1');
  first.memberRuntime.watch(LEAD, [m1]);
  await flush();
  first.memberRuntime.ackMember(LEAD, 'm1');
  first.memberRuntime.unbind();

  const second = createHarness({ store });
  second.byId.m1 = { sessionId: 'm1', agentAvailable: true, running: false };
  second.timings.m1 = { settledMs: 16000 };
  second.memberRuntime.watch(LEAD, [m1]);
  await flush();
  assert.equal(second.statusOf(m1), 'idle', 'a reload must not invent a phantom result');

  second.timings.m1 = { settledMs: 24000 };
  await second.pump();
  assert.equal(second.statusOf(m1), 'done', 'a turn that finished while the page was closed is a real result');
});

test('a panel opened late adopts the settled total instead of inventing a result', async () => {
  const h = createHarness();
  h.byId.m2 = { sessionId: 'm2', agentAvailable: true, running: false };
  h.timings.m2 = { settledMs: 12000 };
  const m2 = member('m2');
  h.memberRuntime.watch(LEAD, [m2]);
  await flush();

  assert.equal(h.statusOf(m2, { unread: true }), 'idle');
  assert.equal(h.memberRuntime.ackOf('m2').ackedMs, 12000);
});

test('first sight mid-onboarding: working, then ready, then a result', async () => {
  const h = createHarness();
  h.byId.m5 = { sessionId: 'm5', agentAvailable: true, running: false };
  h.timings.m5 = { settledMs: 0, active: { since: 1, through: 2 } };
  const m5 = member('m5');
  h.memberRuntime.watch(LEAD, [m5]);
  await flush();
  assert.equal(h.statusOf(m5, { unread: true }), 'working');

  h.timings.m5 = { settledMs: 5200 };
  await h.pump();
  assert.equal(h.statusOf(m5, { unread: true }), 'ready');

  h.timings.m5 = { settledMs: 5200, active: { since: 6, through: 7 } };
  await h.pump();
  assert.equal(h.statusOf(m5), 'working');
  assert.equal(h.memberRuntime.ackOf('m5').readyMs, 5200, 'the onboarding settle is the threshold');

  h.timings.m5 = { settledMs: 9000 };
  await h.pump();
  assert.equal(h.statusOf(m5), 'done');
});

test('first sight mid-task adopts the total, and that task still counts', async () => {
  const h = createHarness();
  h.byId.m6 = { sessionId: 'm6', agentAvailable: true, running: false };
  h.timings.m6 = { settledMs: 7000, active: { since: 8, through: 9 } };
  const m6 = member('m6');
  h.memberRuntime.watch(LEAD, [m6]);
  await flush();
  assert.equal(h.statusOf(m6), 'working');
  assert.equal(h.memberRuntime.ackOf('m6').ackedMs, 7000);

  h.timings.m6 = { settledMs: 11000 };
  await h.pump();
  assert.equal(h.statusOf(m6), 'done');
});

test('degradation is per member, and a member recovers on its own', async () => {
  const h = createHarness();
  h.byId.m3 = { sessionId: 'm3', agentAvailable: true, running: false };
  h.byId.m7 = { sessionId: 'm7', agentAvailable: true, running: false };
  h.timings.m3 = { settledMs: 4000 };
  h.timings.m7 = { settledMs: 5000 };
  const m3 = member('m3', 'provisioning');
  const m7 = member('m7', 'provisioning');
  h.memberRuntime.watch(LEAD, [m3, m7]);
  await flush();
  m3.phase = 'active';
  m7.phase = 'active';
  assert.equal(h.statusOf(m3), 'ready');

  h.failures.m3 = 2;
  await h.pump();
  await h.pump();

  assert.equal(h.memberRuntime.runtimeOf('m3').degraded, true, 'two failed reads must degrade that member');
  assert.equal(h.memberRuntime.runtimeOf('m3').settledMs, 4000, 'the last good reading survives the failure');
  assert.equal(h.memberRuntime.runtimeOf('m7').degraded, false, 'a healthy member must not degrade with it');

  assert.equal(h.statusOf(m3, { unread: true }), 'ready', 'the first unread turn after joining is still ready');
  h.memberRuntime.ackMember(LEAD, 'm3');
  assert.equal(h.statusOf(m3, { unread: true }), 'done');
  assert.equal(h.statusOf(m3, { unread: false }), 'idle');
  assert.equal(h.statusOf(m3, { running: true, unread: false }), 'working');

  h.timings.m3 = { settledMs: 9000 };
  await h.pump();
  assert.equal(h.memberRuntime.runtimeOf('m3').degraded, false, 'a good read brings the member back');
});

test('a hidden tab stops polling and resumes when it becomes visible', async () => {
  const h = createHarness();
  h.byId.m1 = { sessionId: 'm1', agentAvailable: true, running: false };
  h.timings.m1 = { settledMs: 4000 };
  const m1 = member('m1');
  h.memberRuntime.watch(LEAD, [m1]);
  await flush();
  const before = h.reads();
  assert.equal(h.intervals.size, 1);

  h.setVisibility('hidden');
  assert.equal(h.intervals.size, 0, 'the interval must be cleared while the tab is hidden');
  await h.pump();
  assert.equal(h.reads(), before, 'a hidden tab must not read projections');

  h.setVisibility('visible');
  assert.equal(h.intervals.size, 1, 'coming back must restart the poller');
  await flush();
  assert.ok(h.reads() > before, 'a visible tab reads immediately');
});

test('a surface mounted while the tab is hidden starts no timer', async () => {
  const h = createHarness({ visibility: 'hidden' });
  h.byId.m1 = { sessionId: 'm1', agentAvailable: true, running: false };
  h.timings.m1 = { settledMs: 4000 };
  h.memberRuntime.watch(LEAD, [member('m1')]);
  await flush();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.reads(), 0);

  h.setVisibility('visible');
  assert.equal(h.intervals.size, 1);
  await flush();
  assert.ok(h.reads() > 0);
});

test('a member whose session disappears loses its ledger entry', async () => {
  const h = createHarness();
  h.byId.m3 = { sessionId: 'm3', agentAvailable: true, running: false };
  h.timings.m3 = { settledMs: 3000 };
  const m3 = member('m3');
  h.memberRuntime.watch(LEAD, [m3]);
  await flush();
  h.memberRuntime.ackMember(LEAD, 'm3');
  assert.ok(JSON.parse(h.store.get(ACK_KEY(LEAD))).m3);

  delete h.byId.m3;
  await h.pump();
  assert.equal(h.memberRuntime.ackOf('m3'), undefined);
  assert.equal(JSON.parse(h.store.get(ACK_KEY(LEAD))).m3, undefined);
});

test('blocked storage falls back to memory with the same rules', async () => {
  const h = createHarness({
    window: {
      get localStorage() {
        throw new Error('blocked');
      },
    },
  });
  h.byId.m4 = { sessionId: 'm4', agentAvailable: true, running: false };
  h.timings.m4 = { settledMs: 3000 };
  const m4 = member('m4', 'provisioning');
  h.memberRuntime.watch(LEAD, [m4]);
  await flush();
  m4.phase = 'active';

  assert.equal(h.memberRuntime.ackOf('m4').readySeen, false);
  assert.equal(h.statusOf(m4), 'ready');
  assert.equal(h.store.size, 0, 'nothing may be written when storage throws');
});

test('one poller serves every surface and stops with the last watcher', async () => {
  const h = createHarness();
  const a = member('a');
  const b = member('b');
  h.memberRuntime.watch(LEAD, [a, b]);
  assert.equal(h.intervals.size, 1, 'two members must share one timer');
  const [interval] = [...h.intervals.values()];
  assert.equal(interval.ms, h.POLL_MS, 'the interval must use the shipped POLL_MS');

  h.memberRuntime.watch(LEAD, [a, b]);
  assert.equal(h.intervals.size, 1, 'a second surface must not add a second timer');

  h.memberRuntime.unwatch(['a', 'b']);
  assert.equal(h.intervals.size, 1, 'one surface is still mounted');

  h.memberRuntime.unwatch(['a', 'b']);
  assert.equal(h.intervals.size, 0, 'the last watcher stops the timer');
  assert.equal(h.listeners.size, 0, 'the visibility listener must go with it');

  h.memberRuntime.watch(LEAD, [a]);
  assert.equal(h.intervals.size, 1);
  h.memberRuntime.unbind();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.listeners.size, 0);
});

test('the onboarding threshold decides ready, done, and idle', () => {
  const timing = (settledMs) => ({ settledMs, active: false, lastTurnCompleted: true, degraded: false });
  const cases = [
    ['the onboarding settle itself is ready', 8000, { ackedMs: 0, readyMs: 8000, readySeen: false }, 'ready'],
    ['anything past the threshold is a result', 16000, { ackedMs: 0, readyMs: 8000, readySeen: false }, 'done'],
    ['acknowledged up to the threshold is idle', 8000, { ackedMs: 8000, readyMs: 8000, readySeen: true }, 'idle'],
    ['a result past the threshold is done', 16000, { ackedMs: 8000, readyMs: 8000, readySeen: true }, 'done'],
    ['everything acknowledged is idle', 16000, { ackedMs: 16000, readyMs: 8000, readySeen: true }, 'idle'],
  ];
  for (const [label, settledMs, ack, expected] of cases) {
    assert.equal(deriveStatus({ phase: 'active' }, { timing: timing(settledMs), ack }), expected, label);
  }
});

test('a fast second turn still counts, even when active was never observed', async () => {
  const h = createHarness();
  h.byId.m1 = { sessionId: 'm1', agentAvailable: true, running: false };
  h.timings.m1 = { settledMs: 0, active: { since: 1 } };
  const m1 = member('m1');
  h.memberRuntime.watch(LEAD, [m1]);
  await flush();
  h.timings.m1 = { settledMs: 2000 };
  await h.pump();
  assert.equal(h.statusOf(m1), 'ready');
  assert.equal(h.memberRuntime.ackOf('m1').readyMs, 2000);

  // The task starts and ends between two polls: no reading ever sees it running.
  h.timings.m1 = { settledMs: 4000 };
  await h.pump();
  assert.equal(h.statusOf(m1), 'done', 'a turn shorter than the poll interval must still be a result');
});

test('an old ledger entry without readyMs migrates by its own flag', async () => {
  const store = new Map();
  store.set(
    ACK_KEY(LEAD),
    JSON.stringify({
      old: { ackedMs: 16000, readySeen: true },
      fresh: { ackedMs: 0, readySeen: false },
    }),
  );
  const h = createHarness({ store });
  h.byId.old = { sessionId: 'old', agentAvailable: true, running: false };
  h.timings.old = { settledMs: 16000 };
  const oldMember = member('old');
  const freshMember = member('fresh');
  // 'fresh' has no session yet, so its entry can be inspected before a reading.
  h.memberRuntime.watch(LEAD, [oldMember, freshMember]);
  await flush();

  assert.equal(h.memberRuntime.ackOf('old').readyMs, 16000, 'an acknowledged entry carries its total as the threshold');
  assert.equal(h.statusOf(oldMember), 'idle');
  assert.equal(h.memberRuntime.ackOf('fresh').readyMs, 0, 'an unacknowledged entry has no threshold yet');

  h.byId.fresh = { sessionId: 'fresh', agentAvailable: true, running: false };
  h.timings.fresh = { settledMs: 8000 };
  await h.pump();
  assert.equal(h.statusOf(freshMember), 'ready');
  assert.equal(h.memberRuntime.ackOf('fresh').readyMs, 8000, 'the first settle this client sees becomes the threshold');

  h.timings.fresh = { settledMs: 9000 };
  await h.pump();
  assert.equal(h.statusOf(freshMember), 'done');
  assert.deepEqual(JSON.parse(h.store.get(ACK_KEY(LEAD))), {
    old: { ackedMs: 16000, readyMs: 16000, readySeen: true },
    fresh: { ackedMs: 0, readyMs: 8000, readySeen: false },
  });
});

test('an unavailable snapshot must not wipe the ledger', async () => {
  const h = createHarness();
  h.byId.m1 = { sessionId: 'm1', agentAvailable: true, running: false };
  h.timings.m1 = { settledMs: 8000 };
  const m1 = member('m1');
  h.memberRuntime.watch(LEAD, [m1]);
  await flush();
  h.memberRuntime.ackMember(LEAD, 'm1');
  await h.pump();
  h.timings.m1 = { settledMs: 16000 };
  await h.pump();
  assert.equal(h.statusOf(m1), 'done');

  h.setSnapshotUnavailable(true);
  await h.pump();
  assert.ok(h.memberRuntime.ackOf('m1'), 'a throwing snapshot is not the member disappearing');
  assert.ok(JSON.parse(h.store.get(ACK_KEY(LEAD))).m1, 'the persisted bucket must survive');
  assert.equal(h.statusOf(m1), 'done', 'the result badge survives the failure');

  h.setSnapshotUnavailable(false);
  await h.pump();
  assert.equal(h.statusOf(m1), 'done');
});

test('opening a member adopts the next closed reading, so a just-settled turn does not badge', async () => {
  const h = createHarness();
  h.byId.m1 = { sessionId: 'm1', agentAvailable: true, running: false };
  h.timings.m1 = { settledMs: 5000 };
  const m1 = member('m1');
  h.memberRuntime.watch(LEAD, [m1]);
  await flush();
  h.memberRuntime.ackMember(LEAD, 'm1');
  assert.equal(h.statusOf(m1), 'idle');

  // The turn closed between the last poll and the click.
  h.timings.m1 = { settledMs: 12000 };
  await h.pump();
  assert.equal(h.statusOf(m1), 'idle', 'a turn the reader had already opened must not light the badge');
  assert.equal(h.memberRuntime.ackOf('m1').ackedMs, 12000);

  // A later turn is still a result.
  h.timings.m1 = { settledMs: 20000 };
  await h.pump();
  assert.equal(h.statusOf(m1), 'done');
});

test('a turn still running when the chat opens is adopted when it closes', async () => {
  const h = createHarness();
  h.byId.m1 = { sessionId: 'm1', agentAvailable: true, running: false };
  h.timings.m1 = { settledMs: 8000 };
  const m1 = member('m1');
  h.memberRuntime.watch(LEAD, [m1]);
  await flush();
  h.memberRuntime.ackMember(LEAD, 'm1');

  h.timings.m1 = { settledMs: 8000, active: { since: 9 } };
  await h.pump();
  assert.equal(h.statusOf(m1), 'working');
  assert.equal(h.memberRuntime.ackOf('m1').pendingAck, true, 'an open turn is not adopted yet');

  h.timings.m1 = { settledMs: 16000 };
  await h.pump();
  assert.equal(h.statusOf(m1), 'idle', 'the turn the reader watched must not badge when it closes');
  assert.equal(h.memberRuntime.ackOf('m1').pendingAck, false);

  h.timings.m1 = { settledMs: 24000 };
  await h.pump();
  assert.equal(h.statusOf(m1), 'done');
});

// ---------------------------------------------------------------------------
// Source-level pins: render purity, the open path, one store, copy and CSS.
// ---------------------------------------------------------------------------

test('the store writes storage only from its event paths, never from a getter', () => {
  assert.doesNotMatch(DERIVE, /localStorage|setItem|persist\(/, 'deriveStatus runs during render and must stay pure');
  const api = sliceSource('      return {\n        bind(context) {', '\n    const memberRuntime');
  assert.doesNotMatch(api, /persist\(/, 'a render-time getter writes the ledger');
  assert.doesNotMatch(api, /setItem/, 'a render-time getter writes storage');
  assert.match(api, /runtimeOf\(id\) \{\s*return runtime\.get\(id\);\s*\}/);
});

test('opening a member acknowledges only after the session really opened', () => {
  const openMember = sliceSource('      const openMember = (parentSessionId, childId) => {', '      const stopMember = async');
  const openAt = openMember.indexOf('ctx.uiWorkspace.openSession(');
  const ackAt = openMember.indexOf('memberRuntime.ackMember(');
  assert.ok(openAt > 0, 'openMember no longer opens the session');
  assert.ok(ackAt > openAt, 'the acknowledgement must follow a successful open, not precede it');

  const catchAt = openMember.indexOf('} catch (reason) {');
  assert.ok(catchAt > 0, 'the failure path is gone');
  assert.doesNotMatch(openMember.slice(catchAt), /ackMember/, 'a failed open must not clear the new-result badge');

  const guardAt = openMember.indexOf("return t('error.navigate')");
  assert.ok(guardAt > 0 && guardAt < ackAt, 'the "no session view" guard must return before the acknowledgement');
});

test('there is exactly one member runtime and one poll timer', () => {
  assert.equal(
    [...source.matchAll(/const memberRuntime = createMemberRuntime\(\);/g)].length,
    1,
    'a second store would double the polling',
  );
  assert.equal([...source.matchAll(/\bsetInterval\(/g)].length, 1, 'a component-local timer came back');
  assert.match(source, /timer = setInterval\(\(\) => void tick\(\), POLL_MS\)/);
  assert.equal([...source.matchAll(/function createMemberRuntime\(\)/g)].length, 1);
});

test('the degraded path still consumes completionUnread', () => {
  assert.match(
    DERIVE,
    /signals\.unread === true/,
    'the fallback signal is no longer read; the three platform completionUnread reads are now dead code',
  );
  assert.match(DERIVE, /signals\.running === true/, 'the degraded path no longer consults running');
});

/** Slice one locale dictionary out of client.js. */
function readLocaleBlock(marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `client.js no longer declares ${marker}`);
  const end = source.indexOf('\n    };', start);
  assert.ok(end > start, `the ${marker} dictionary is not terminated as expected`);
  return source.slice(start, end);
}

test('zh and en both define status.ready', () => {
  for (const marker of ['const zh = {', 'const en = {']) {
    const block = readLocaleBlock(marker);
    const match = /'status\.ready':\s*'([^']*)'/.exec(block);
    assert.ok(match, `${marker} is missing status.ready: the row would print the raw key`);
    assert.ok(match[1].trim() !== '', `${marker} has an empty status.ready`);
  }
});

/** Slice the browser stylesheet out of client.js. */
function readCss() {
  const open = source.indexOf('const CSS = `');
  assert.ok(open > 0, 'client.js no longer declares the CSS template');
  const start = open + 'const CSS = `'.length;
  const end = source.indexOf('`;', start);
  assert.ok(end > start, 'the CSS template is not terminated as expected');
  return source.slice(start, end);
}

/** Flat `selector { body }` rules, with any leading comment stripped. */
function cssRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(),
    body: match[2],
  }));
}

test('ready has its own dot and row tint, with no hex literal', () => {
  const css = readCss();
  const rules = cssRules(css);
  const dot = rules.find((rule) => rule.selector === '.wt-dot.ready');
  assert.ok(dot, '.wt-dot.ready is missing: the dock and the @-list render a dot for every status');
  assert.match(dot.body, /background/, 'the ready dot has no colour');
  const row = rules.find((rule) => rule.selector === '.wt-st-ready');
  assert.ok(row, '.wt-st-ready is missing: the office row and the avatar ring read --wt-raw');
  assert.match(row.body, /--wt-raw/, 'the ready row never sets the status variable');
  assert.equal(css.match(/#[0-9a-fA-F]{3,8}\b/g), null, 'a hex literal came back into the stylesheet');
});

test('the dock keeps ready out of the chips and the summary', () => {
  const summary = /const SUMMARY_STATES = \[([^\]]*)\]/.exec(source);
  assert.ok(summary, 'SUMMARY_STATES is gone');
  assert.doesNotMatch(summary[1], /'ready'/, 'a just-onboarded team must not add a summary segment');
  assert.doesNotMatch(summary[1], /'idle'/, 'idle is the default; repeating it is the noise this pass removed');

  const active = /const active = ranked\.filter\(([^;]*)\);/.exec(source);
  assert.ok(active, 'the dock no longer filters its active list');
  assert.match(active[1], /entry\.status !== 'idle'/, 'idle must stay out of the dock');
  assert.match(active[1], /entry\.status !== 'ready'/, 'ready must stay out of the dock');
});

test('every status deriveStatus can return has a rank and a locale entry', () => {
  const statuses = new Set([...DERIVE.matchAll(/return '([a-z]+)'/g)].map((match) => match[1]));
  assert.ok(statuses.size >= 8, `deriveStatus returns only ${statuses.size} statuses`);

  const rankBlock = /const STATUS_RANK = \{([^}]*)\}/.exec(source);
  assert.ok(rankBlock, 'STATUS_RANK is gone');
  const ranked = new Set([...rankBlock[1].matchAll(/([a-z]+):\s*\d+/g)].map((match) => match[1]));

  const zh = readLocaleBlock('const zh = {');
  const en = readLocaleBlock('const en = {');
  for (const status of statuses) {
    assert.ok(ranked.has(status), `status "${status}" has no STATUS_RANK entry: sorting would compare NaN`);
    assert.match(zh, new RegExp(`'status\\.${status}':`), `zh is missing status.${status}`);
    assert.match(en, new RegExp(`'status\\.${status}':`), `en is missing status.${status}`);
  }
});
