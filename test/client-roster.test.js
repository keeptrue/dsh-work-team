/**
 * Client roster: where a seat comes from when the host stops sending one.
 *
 * DSH 0.2.2 replaced the `agentTeam` projection's `members` array with a plain
 * `enabled` flag, so every surface that read `team.members` saw an empty team:
 * the dock unmounted itself and the office drew eight vacancies for employees
 * that were already hired. `memberRows` is the pure adapter that answers "who is
 * on this team" from whichever source the host still carries, and it is sliced
 * out of client.js and run here so a rewrite of the mapping fails loudly.
 *
 * What is pinned is the honesty rule: a row is emitted only for a row the host
 * actually asserted. An unnamed child, an unknown name, and a one-shot worker
 * are dropped rather than dressed up as a seat.
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

const ROLES = sliceSource('    const ROLES = [', '\n    const zh = {');
const ROSTER = sliceSource(
  '    function memberRows(team, catalog) {',
  '\n    /**\n     * The live roster of one session surface.',
);

const factory = new Function(`${ROLES}\n${ROSTER}\nreturn { memberRows, ROLE_BY_ID, ROLES };`);
const { memberRows, ROLE_BY_ID, ROLES: ROLE_LIST } = factory();

/** Catalog rows in the shape the host's `subagentCatalog` projection publishes. */
const child = (id, name, mode = 'continuable', extra = {}) => ({
  id,
  createdAt: 1,
  mode,
  ...(mode === 'continuable' ? { label: `label-${id}` } : {}),
  ...(name === undefined ? {} : { name }),
  ...extra,
});

// ---------------------------------------------------------------------------
// 0.2.2: the subagent catalog is the roster.
// ---------------------------------------------------------------------------

test('a named continuable child becomes a seat', () => {
  const rows = memberRows(undefined, [child('s-front', 'frontend')]);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.id, 's-front');
  assert.equal(row.name, 'frontend');
  assert.equal(row.role, 'teammate');
  assert.equal(row.phase, undefined, 'the tree has no provisioning phase to report');
  assert.equal(row.status, 'inactive', 'live status comes from the runtime store, not the row');
  assert.equal(row.description, ROLE_BY_ID.get('frontend').zh.role, 'the seat description is the role title');
});

test('every mirrored role is recognised by its own name', () => {
  const catalog = ROLE_LIST.map((role, index) => child(`s-${role.id}`, role.id, 'continuable', { createdAt: index }));
  const rows = memberRows(undefined, catalog);
  assert.deepEqual(
    rows.map((row) => row.name),
    ROLE_LIST.map((role) => role.id),
    'the mapping drifted from ROLE_BY_ID',
  );
  for (const row of rows) {
    assert.equal(row.description, ROLE_BY_ID.get(row.name).zh.role);
  }
});

test('only a continuable child is a seat: external and one-shot are not', () => {
  const rows = memberRows(undefined, [
    child('s-ext', 'ops', 'external'),
    child('s-worker', 'ops', 'one-shot'),
  ]);
  assert.deepEqual(
    rows,
    [],
    'an external child has no local child Session: opening its desk fails and dispatch is refused as NOT_CONTINUABLE',
  );
});

test('an unknown or unnamed child is dropped, never invented', () => {
  const rows = memberRows(undefined, [
    child('s-boss', 'lead'),
    child('s-stranger', 'intern'),
    child('s-anon', undefined),
    child('s-empty', ''),
    child('s-unknown-mode', 'pm', 'unknown'),
  ]);
  assert.deepEqual(rows, [], 'only a known role name may become a seat');
});

test('catalog order is the seat order', () => {
  // Deliberately not ROLES order: the host lists children in creation order.
  const catalog = [
    child('s-writer', 'writer'),
    child('s-pm', 'pm'),
    child('s-designer', 'designer'),
  ];
  assert.deepEqual(memberRows(undefined, catalog).map((row) => row.id), ['s-writer', 's-pm', 's-designer']);
  assert.deepEqual(
    memberRows(undefined, catalog).map((row) => row.id),
    memberRows(undefined, catalog).map((row) => row.id),
    'two reads of one catalog must return one order',
  );
});

// ---------------------------------------------------------------------------
// 0.2.1: `agentTeam.members` still wins when the host sends it.
// ---------------------------------------------------------------------------

test('a host-owned roster takes precedence over the catalog', () => {
  const team = {
    members: [
      { id: 'lead', name: 'lead', role: 'lead', phase: 'active' },
      { id: 'legacy-pm', name: 'pm', role: 'teammate', phase: 'active', description: '产品经理 / 拆需求' },
    ],
    tasks: [],
  };
  const rows = memberRows(team, [child('s-front', 'frontend')]);
  assert.deepEqual(rows.map((row) => row.id), ['legacy-pm'], 'the legacy branch must own the answer');
  assert.equal(rows[0].phase, 'active', 'legacy phases must survive untouched');
});

test('the Lead is never a row, and an empty legacy roster stays empty', () => {
  assert.deepEqual(memberRows({ members: [{ id: 'lead', name: 'lead', role: 'lead' }] }, undefined), []);
  assert.deepEqual(
    memberRows({ members: [] }, [child('s-pm', 'pm')]),
    [],
    'an explicit empty roster is an answer, not a reason to fall back',
  );
  assert.deepEqual(
    memberRows({ members: [null, undefined, { id: 'm', name: 'pm', role: 'teammate' }] }, undefined).map((row) => row.id),
    ['m'],
    'a malformed legacy row must be dropped instead of reaching render',
  );
});

// ---------------------------------------------------------------------------
// Degenerate input: a surface must render, not throw.
// ---------------------------------------------------------------------------

test('empty and malformed input yields an empty roster without throwing', () => {
  const cases = [
    [undefined, undefined],
    [null, null],
    [{}, undefined],
    [undefined, 'not-a-catalog'],
    [undefined, {}],
    [undefined, []],
    [{ members: 'nope' }, []],
    [undefined, [null, undefined, 0, 1, 'pm', [], { }, child('s-pm', 'pm', 'continuable')]],
  ];
  for (const [team, catalog] of cases) {
    assert.doesNotThrow(() => memberRows(team, catalog), `memberRows threw for ${JSON.stringify([team, catalog])}`);
  }
  assert.deepEqual(memberRows(undefined, []), []);
  assert.deepEqual(memberRows(undefined, 'not-a-catalog'), []);
  assert.deepEqual(memberRows({ members: 'nope' }, 'not-a-catalog'), []);
  assert.deepEqual(
    memberRows(undefined, [null, undefined, 0, 1, 'pm', [], {}, child('s-pm', 'pm')]).map((row) => row.id),
    ['s-pm'],
    'only the one well-formed row survives the noise',
  );
});

test('a row without an id is dropped: it cannot be keyed, opened, or watched', () => {
  assert.deepEqual(memberRows(undefined, [{ mode: 'continuable', name: 'pm' }]), []);
  assert.deepEqual(memberRows(undefined, [{ id: '', mode: 'continuable', name: 'pm' }]), []);
});

// ---------------------------------------------------------------------------
// Source-level pins: one adapter, four call sites, no stray `team.members`.
// ---------------------------------------------------------------------------

test('no surface reads team.members directly any more', () => {
  assert.doesNotMatch(
    source,
    /team\?\.members/,
    'a surface bypasses memberRows, so it goes empty again the day the host drops members',
  );
  const callSites = [...source.matchAll(/= useRoster\(useProjection\)/g)].length;
  assert.equal(callSites, 4, `expected the four surfaces to share the roster hook, found ${callSites}`);
});

test('the task board still reads its tasks from agentTeam', () => {
  assert.equal(
    [...source.matchAll(/const tasks = team\?\.tasks \?\? \[\]/g)].length,
    2,
    'the office tab and the dock must keep reading tasks straight off agentTeam',
  );
});

test('the board toggle is a host call through the injected face, not a direct ctx reach', () => {
  assert.match(source, /enableBoard: \(\) => enableTeamBoard\(sessionId\)/, 'the panel has no way to enable the board');
  const panel = sliceSource('    function OfficeTab({', '    // ---------------------------------------------------------------------\n    // Slots');
  assert.doesNotMatch(panel, /ctx\./, 'the panel component must not touch ctx directly');
  assert.match(panel, /t\('office\.boardOffHint'\)/, 'the off board must explain itself');
  assert.match(panel, /t\('office\.boardEnable'\)/, 'the off board must offer the switch');
  assert.match(panel, /wt-panel-error|setError/, 'a refusal must land in the panel error line');
});

test('the remote face is resolved lazily, so a host without it still loads the plugin', () => {
  const inject = sliceSource('    const inject = [', '    ];');
  assert.doesNotMatch(
    inject,
    /remote\.agentTeams/,
    'a required inject leaves this fiber pending on 0.2.1, where the plain TeamService has no @Remote face',
  );
  assert.doesNotMatch(source, /ctx\.remote\.agentTeams/, 'a hard reach throws when the namespace is absent');

  const toggle = sliceSource(
    '      const enableTeamBoard = async (sessionId) => {',
    '      const injected = (sessionId) => ({',
  );
  assert.match(toggle, /ctx\.get\?\.\('remote\.agentTeams'\)/, 'the name-addressed probe must be optional and in a try');
  assert.match(toggle, /ctx\.remote\?\.agentTeams/, 'the namespace-property probe (what the official client uses) is gone');
  const getAt = toggle.indexOf("ctx.get?.('remote.agentTeams')");
  const propertyAt = toggle.indexOf('ctx.remote?.agentTeams');
  assert.ok(getAt > 0 && propertyAt > getAt, 'both resolutions must be attempted, name first then the namespace property');
  assert.match(
    toggle,
    /typeof remote\?\.setEnabled !== 'function'/,
    'an absent face or a face without setEnabled must be detected, not assumed',
  );
  assert.match(toggle, /t\('office\.boardEnableUnavailable'\)/, 'an absent face must report a readable sentence');
  assert.match(toggle, /remote\.setEnabled\(sessionId, true\)/, 'the toggle must use the official signature');
  assert.ok((toggle.match(/catch/g) ?? []).length >= 3, 'each probe plus the whole call must be guarded');
  assert.doesNotMatch(toggle, /ctx\.get\('remote\.agentTeams'\)/, 'a bare probe throws where the dotted name does not resolve');
});

test('a closed board still draws the tasks the host keeps publishing', () => {
  const panel = sliceSource('    function OfficeTab({', '    // ---------------------------------------------------------------------\n    // Slots');
  const at = panel.indexOf(': boardOff');
  assert.ok(at > 0, 'the off-board branch is gone');
  const arm = panel.slice(at, panel.indexOf(': h(TaskBoard', at));
  assert.match(arm, /t\('office\.boardOffHint'\)/, 'the off board must explain itself');
  assert.match(arm, /t\('office\.boardEnable'\)/, 'the off board must offer the switch');
  assert.match(arm, /tasks\.length === 0\s*\?\s*null/, 'an empty board must not add a second empty column set');
  assert.match(arm, /h\(TaskBoard, \{/, 'tasks the host still publishes must stay visible while the flag is off');
});

test('the off-board copy exists in both dictionaries and no longer calls the board empty', () => {
  const block = (marker) => {
    const start = source.indexOf(marker);
    assert.ok(start >= 0, `client.js no longer declares ${marker}`);
    const end = source.indexOf('\n    };', start);
    assert.ok(end > start, `${marker} is not terminated as expected`);
    return source.slice(start, end);
  };
  for (const key of ['office.boardOffHint', 'office.boardEnable', 'office.boardEnableFailed', 'office.boardEnableUnavailable']) {
    for (const marker of ['const zh = {', 'const en = {']) {
      assert.match(block(marker), new RegExp(`'${key}':\\s*'[^']+'`), `${marker} is missing ${key}`);
    }
  }
  assert.doesNotMatch(block('const zh = {'), /任务板是空的/, 'the copy still claims the board is empty');
  assert.doesNotMatch(block('const en = {'), /board is empty/, 'the English copy still claims the board is empty');
  assert.match(block('const zh = {'), /'office\.boardOffHint':\s*'团队协作已关闭/, 'the Chinese hint must say the board is frozen');
  assert.match(block('const en = {'), /'office\.boardOffHint':\s*'Team collaboration is off/, 'the English hint drifted');
});
