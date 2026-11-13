/**
 * Per-role permission presets.
 *
 * The plugin switches presets and never defines them: `read-only` is a legal
 * sandbox mode with no preset behind it on a default install, so the only honest
 * answers are "switched" and "this name does not exist here, these do". Every
 * failure is reported in `team_status.health` and none of them may break a hire.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeGateHost } from './support/gate-host.js';

/** @param {object} [options] - `makeGateHost` options. @returns {Promise<object>} running fixture. */
async function startHost(options = {}) {
  const host = makeGateHost(options).start();
  await host.emit('agent/created', { agent: host.lead, source: 'created' });
  return host;
}

/** @param {object} host - fixture. @param {string} name - tool name. @returns {object} tool definition. */
function toolOf(host, name) {
  const definition = host.registered.get(name);
  assert.ok(definition, `${name} is registered on the Lead scope`);
  return definition;
}

/** @param {object} host - fixture. @returns {Promise<object>} the status report. */
async function statusOf(host) {
  return toolOf(host, 'team_status').execute({}, { agent: host.lead });
}

test('a configured preset is applied to that employee and reported per member', async () => {
  const host = await startHost({
    roster: [{ name: 'reviewer' }, { name: 'backend' }],
    config: { presetReviewer: 'workspace-write' },
  });
  try {
    assert.deepEqual(
      host.presetCalls.map((call) => [call.session.id, call.name]),
      [['sess-reviewer', 'workspace-write']],
      'exactly the configured role, exactly once',
    );
    const status = await statusOf(host);
    assert.equal(status.members.find((member) => member.name === 'reviewer').preset, 'workspace-write');
    assert.equal(status.members.find((member) => member.name === 'backend').preset, 'custom');
    assert.deepEqual(status.health.availablePresets, ['workspace-write', 'danger-full-access']);
    assert.equal(status.health.presetNote, '', 'a working preset needs no warning');
  } finally {
    host.dispose();
  }
});

test('an unknown preset name is reported with the available list and never applied', async () => {
  const host = await startHost({
    roster: [{ name: 'researcher' }],
    config: { presetResearcher: 'read-only' },
  });
  try {
    assert.equal(host.presetCalls.length, 0, 'nothing is switched to a name that does not exist');
    const status = await statusOf(host);
    assert.match(status.health.presetNote, /researcher 配的 preset "read-only" 在这台机器上不存在/);
    assert.match(status.health.presetNote, /可用：workspace-write, danger-full-access/);
    assert.match(status.health.presetNote, /profile patch/);
    assert.deepEqual(status.health.availablePresets, ['workspace-write', 'danger-full-access']);
    assert.equal(status.members[0].preset, 'custom', 'the employee stays on whatever it had');
  } finally {
    host.dispose();
  }
});

test('a composition without the preset service still hires, and says what is missing', async () => {
  const host = await startHost({
    roster: [{ name: 'ops' }],
    config: { presetOps: 'danger-full-access' },
    presetServiceMissing: true,
  });
  try {
    assert.equal(host.presetCalls.length, 0);
    const status = await statusOf(host);
    assert.equal(status.size, 1, 'the employee is installed and usable');
    assert.match(status.health.presetNote, /没有可用的 permissionPresets 服务/);
    assert.deepEqual(status.health.availablePresets, []);
    assert.equal(status.members[0].preset, '', 'no service means no readable preset');
  } finally {
    host.dispose();
  }
});

test('a preset switch that throws is reported instead of breaking the install', async () => {
  const host = await startHost({
    roster: [{ name: 'reviewer' }],
    config: { presetReviewer: 'workspace-write' },
    presetSetError: new Error('session is not writable'),
  });
  try {
    const status = await statusOf(host);
    assert.equal(status.size, 1, 'the hire survived the failed switch');
    assert.match(status.health.presetNote, /reviewer 的 preset "workspace-write" 没有应用/);
    assert.match(status.health.presetNote, /session is not writable/);
    assert.match(status.health.presetNote, /不影响入职/);
  } finally {
    host.dispose();
  }
});

test('the Lead Session is never touched by a preset', async () => {
  const host = await startHost({
    roster: [{ name: 'reviewer' }, { name: 'ops' }],
    config: { presetReviewer: 'workspace-write', presetOps: 'danger-full-access' },
  });
  try {
    assert.equal(host.presetCalls.length, 2);
    for (const call of host.presetCalls) {
      assert.notEqual(call.session.id, 'sess-lead', 'the Lead keeps its own permissions');
    }
  } finally {
    host.dispose();
  }
});

test('re-applying the same preset writes nothing', async () => {
  const host = await startHost({
    roster: [{ name: 'reviewer' }],
    config: { presetReviewer: 'workspace-write' },
  });
  try {
    assert.equal(host.presetCalls.length, 1);
    // A settings save re-runs the same pass; the Session is already on the
    // preset, so the kernel's selection must not be appended twice.
    host.setSettings({ presetReviewer: 'workspace-write' });
    host.emitDocumentUpdated('work-team');
    // The settings pass is debounced; this is a hold (nothing new must happen).
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(host.presetCalls.length, 1, 'unchanged preset is not re-written');
  } finally {
    host.dispose();
  }
});
