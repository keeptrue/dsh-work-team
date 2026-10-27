/**
 * Pure rules for the per-role tool whitelists.
 *
 * The wiring (probing the live registry, registering the filter, re-applying on
 * a settings save) is covered in host.test.js; this file pins the declarations
 * themselves, because a role that silently loses a tool is only noticed much
 * later, by the employee that cannot report back.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ROLES, roleById } from '../lib/roles.js';
import {
  BROWSER_UI,
  CORE_TOOLS,
  JOB_TOOLS,
  OWN_LAYER_TOOLS,
  READONLY,
  SCHEDULE_TOOLS,
  TERMINAL_TOOLS,
  employeeAllowList,
} from '../lib/toolset.js';

/** Tools a teammate cannot do its job without: reporting and the shared board. */
const TEAM_TOOLS = [
  'send_message',
  'wait_agent',
  'list_agents',
  'team_task_create',
  'team_task_get',
  'team_task_list',
  'team_task_update',
];

test('every role declares a non-empty, duplicate-free tool list', () => {
  for (const role of ROLES) {
    const allow = employeeAllowList(role, { workers: 2 });
    assert.ok(allow.length > 0, `${role.id} declares no tools`);
    assert.equal(new Set(allow).size, allow.length, `${role.id} lists a tool twice`);
    for (const name of allow) {
      assert.equal(typeof name, 'string', `${role.id} has a non-string tool name`);
      assert.notEqual(name.trim(), '', `${role.id} has an empty tool name`);
    }
  }
});

test('every role can report to the Lead and work the shared task board', () => {
  // Fatal if missing: an employee without these cannot report, claim, or finish.
  for (const role of ROLES) {
    const allow = new Set(employeeAllowList(role, { workers: 2 }));
    for (const name of TEAM_TOOLS) {
      assert.ok(allow.has(name), `${role.id} is missing ${name}`);
    }
  }
});

test('CORE_TOOLS carries the team tools exactly once', () => {
  for (const name of TEAM_TOOLS) {
    assert.equal(CORE_TOOLS.filter((entry) => entry === name).length, 1, name);
  }
  assert.equal(new Set(CORE_TOOLS).size, CORE_TOOLS.length);
});

test('read-only roles never see a write path', () => {
  assert.ok(!READONLY.includes('write'));
  assert.ok(!READONLY.includes('edit'));
  assert.ok(READONLY.includes('read'));
  for (const id of ['reviewer', 'researcher']) {
    const allow = new Set(employeeAllowList(roleById(id), { workers: 2 }));
    assert.ok(!allow.has('write'), `${id} must not write`);
    assert.ok(!allow.has('edit'), `${id} must not edit`);
  }
  // The deny list stays as the second layer the tools service already enforces.
  for (const id of ['reviewer', 'researcher']) {
    assert.deepEqual(roleById(id).deny, ['write', 'edit']);
  }
});

test('a zero worker cap removes both delegation tools and nothing else', () => {
  for (const role of ROLES) {
    const withWorkers = employeeAllowList(role, { workers: 2 });
    const without = employeeAllowList(role, { workers: 0 });
    assert.ok(!without.includes('subagent'), `${role.id} keeps subagent at cap 0`);
    assert.ok(!without.includes('subagent_fork'), `${role.id} keeps subagent_fork at cap 0`);
    assert.equal(without.length, withWorkers.length - 2, `${role.id} lost more than delegation`);
  }
});

test('the browser set is the eight-tool read-then-act loop', () => {
  assert.equal(BROWSER_UI.length, 8);
  assert.equal(new Set(BROWSER_UI).size, 8);
  for (const name of BROWSER_UI) assert.match(name, /^dsh_browser_/);
  // The heavy session and cookie tools stay out: 34 browser tools cost ~22 KB.
  assert.ok(!BROWSER_UI.includes('dsh_browser_execute'));
  assert.ok(!BROWSER_UI.includes('dsh_browser_auth'));
});

test('role capabilities line up with the job each one does', () => {
  const allow = (id) => new Set(employeeAllowList(roleById(id), { workers: 2 }));
  // Ops and backend drive processes; nobody else needs the terminal or job set.
  for (const name of [...TERMINAL_TOOLS, ...JOB_TOOLS]) {
    assert.ok(allow('ops').has(name), `ops is missing ${name}`);
    assert.ok(allow('backend').has(name), `backend is missing ${name}`);
  }
  for (const name of TERMINAL_TOOLS) assert.ok(!allow('writer').has(name), `writer should not have ${name}`);
  // Ops owns reminders, but editing one stays with the Lead: `schedule_update`
  // alone costs 2,403 bytes of schema.
  for (const name of ['schedule_create', 'schedule_list', 'schedule_delete']) {
    assert.ok(allow('ops').has(name), `ops is missing ${name}`);
    assert.ok(!allow('frontend').has(name), `frontend should not have ${name}`);
  }
  assert.ok(SCHEDULE_TOOLS.includes('schedule_update'));
  assert.ok(!allow('ops').has('schedule_update'), 'editing a reminder is the Lead job');
  // UI roles get the browser; text roles get search.
  assert.ok(allow('frontend').has('dsh_browser_snapshot'));
  assert.ok(allow('designer').has('generate_image'));
  assert.ok(allow('designer').has('render_ui') && allow('designer').has('validate_dsh_ui'));
  // `visualize` builds interactive HTML cards: that is the frontend's job, and it
  // is the single most expensive tool in the designer list (3,102 bytes).
  assert.ok(!allow('designer').has('visualize'), 'designer does not build interactive cards');
  assert.ok(allow('writer').has('web_search'));
  assert.ok(!allow('writer').has('dsh_browser_snapshot'));
  assert.ok(!allow('reviewer').has('generate_image'));
});

test('OWN_LAYER_TOOLS is exactly the eleven tools a member scope registers', () => {
  // Pinned literally, not derived: a name that is really inherited (say `read`)
  // would pass restrict()'s validation and be silently dropped from every allow
  // list — a quieter failure than the throw this set exists to prevent.
  assert.deepEqual(
    [...OWN_LAYER_TOOLS].sort(),
    [
      'hire_teammate',
      'interrupt_agent',
      'list_agents',
      'request_hire',
      'send_message',
      'spawn_teammate',
      'team_task_create',
      'team_task_get',
      'team_task_list',
      'team_task_update',
      'wait_agent',
    ],
  );
  assert.equal(OWN_LAYER_TOOLS.size, 11);
  // Every declared own-layer name must also be declared by the role that uses it.
  for (const name of ['send_message', 'wait_agent', 'list_agents', 'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update']) {
    assert.ok(CORE_TOOLS.includes(name), `${name} must stay in CORE_TOOLS`);
  }
});

test('employeeAllowList tolerates a missing or malformed role', () => {
  assert.deepEqual(employeeAllowList(undefined), []);
  assert.deepEqual(employeeAllowList({}), []);
  assert.deepEqual(employeeAllowList({ tools: 'read' }), []);
  assert.deepEqual(employeeAllowList({ tools: ['read', '', null, 'read', 'grep'] }), ['read', 'grep']);
});
