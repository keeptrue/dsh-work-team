/**
 * The browser bundle cannot import `lib/roles.js` (it is a separate module
 * loader realm), so client.js carries a hand-mirrored ROLES table. Nothing at
 * runtime compares the two, which means a rename on one side silently drifts the
 * other: the office would show one name and `@`-matching would answer another.
 * This test pins ids, order, model fields, and both display names.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ROLES } from '../lib/roles.js';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/** Slice the mirrored table out of the client source and read each row. */
function readMirror() {
  const start = source.indexOf('const ROLES = [');
  assert.ok(start > 0, 'client.js no longer declares a ROLES mirror');
  const end = source.indexOf('\n    ];', start);
  assert.ok(end > start, 'the mirrored ROLES array is not terminated as expected');
  const block = source.slice(start, end);
  const chunks = block.split(/(?=\n\s*\{\s*\n\s*id: ')/).filter((chunk) => /id: '/.test(chunk));
  return chunks.map((chunk) => ({
    id: /id: '([^']+)'/.exec(chunk)?.[1],
    modelField: /modelField: '([^']+)'/.exec(chunk)?.[1],
    zhName: /zh: \{ name: '([^']+)'/.exec(chunk)?.[1],
    enName: /en: \{ name: '([^']+)'/.exec(chunk)?.[1],
  }));
}

test('the client ROLES mirror matches lib/roles.js row for row', () => {
  const mirror = readMirror();
  assert.equal(mirror.length, ROLES.length, 'the mirror has a different number of roles');
  ROLES.forEach((role, index) => {
    const row = mirror[index];
    assert.equal(row.id, role.id, `role #${index} id drifted`);
    assert.equal(row.modelField, role.modelField, `role "${role.id}" modelField drifted`);
    assert.equal(row.zhName, role.zh.name, `role "${role.id}" zh.name drifted`);
    assert.equal(row.enName, role.en.name, `role "${role.id}" en.name drifted`);
  });
});

test('the client ROLES mirror keeps every id unique and lowercase', () => {
  const ids = readMirror().map((row) => row.id);
  assert.deepEqual(new Set(ids).size, ids.length, 'duplicate role ids in the mirror');
  for (const id of ids) assert.equal(id, id.toLowerCase(), `role id "${id}" must stay lowercase`);
});

// ---------------------------------------------------------------------------
// Office V2: the office moved out of a modal and into a right-sidebar tab.
// These pin the host wiring (services, effect scope, failure path) and the CSS
// regressions the redesign had to fix (status colours, hex literals).
// ---------------------------------------------------------------------------

/** Slice the browser stylesheet out of client.js; the avatars keep their own hex. */
function readCss() {
  const open = source.indexOf('const CSS = `');
  assert.ok(open > 0, 'client.js no longer declares the CSS template');
  const start = open + 'const CSS = `'.length;
  const end = source.indexOf('`;', start);
  assert.ok(end > start, 'the CSS template is not terminated as expected');
  return source.slice(start, end);
}

/** Split a stylesheet into flat `selector { body }` rules; at-rule wrappers are skipped. */
function readRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

/** Read one locale dictionary's key set out of the client source. */
function readLocaleKeys(marker) {
  const start = source.indexOf(marker);
  assert.ok(start > 0, `client.js no longer declares ${marker}`);
  const end = source.indexOf('\n    };', start);
  assert.ok(end > start, `the ${marker} dictionary is not terminated as expected`);
  return new Set([...source.slice(start, end).matchAll(/'([^']+)'\s*:/g)].map((match) => match[1]));
}

test('the runtime inject list declares both right-sidebar services', () => {
  const start = source.indexOf('const inject = [');
  assert.ok(start > 0, 'client.js no longer declares an inject list');
  const end = source.indexOf('];', start);
  assert.ok(end > start, 'the inject list is not terminated as expected');
  const services = [...source.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(services.includes('sidebarRight'), 'ctx.sidebarRight is read but never injected');
  assert.ok(services.includes('sidebarRightTabs'), 'ctx.sidebarRightTabs is read but never injected');
});

test('the package manifest loads the right-sidebar client package', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const declared = pkg?.dsh?.client?.inject;
  assert.ok(Array.isArray(declared), 'package.json no longer declares dsh.client.inject');
  assert.ok(
    declared.includes('@deepseek-ai/dsh-client-ui-sidebar-right'),
    'the client graph does not declare the sidebar package this plugin now depends on',
  );
});

test('the tab type is registered inside a ctx.effect so unload disposes it', () => {
  const calls = [...source.matchAll(/ctx\.sidebarRightTabs\.register\(/g)];
  assert.equal(calls.length, 1, 'expected exactly one tab-type registration');
  const before = source.slice(Math.max(0, calls[0].index - 240), calls[0].index);
  assert.ok(
    before.includes('ctx.effect('),
    'the registration is not wrapped in ctx.effect; the registry holds it on its own context, so it would outlive this plugin',
  );
});

test('openTab failures are caught instead of reaching React', () => {
  const index = source.indexOf('ctx.sidebarRight.openTab(');
  assert.ok(index > 0, 'the office tab is never opened');
  const before = source.slice(Math.max(0, index - 400), index);
  assert.match(before, /try\s*\{/, 'openTab is not inside a try block; it throws with no mounted Session');
  const after = source.slice(index, index + 320);
  assert.match(after, /catch\s*(\([^)]*\))?\s*\{/, 'the openTab try block has no catch');
});

test('status colours come from the state tokens, not the brand accent', () => {
  const rules = readRules(readCss());
  const statusSelectors = [
    '.wt-dot.working',
    '.wt-avatar-wrap.st-working::after',
    '.wt-avatar-wrap.st-provisioning::after',
    '.wt-pill.working',
    '.wt-spinner',
  ];
  const matched = rules.filter((rule) => statusSelectors.some((selector) => rule.selector.includes(selector)));
  assert.ok(matched.length >= 2, 'the status rules disappeared entirely');
  for (const rule of matched) {
    assert.doesNotMatch(rule.body, /brand-primary/, `${rule.selector} still paints with brand-primary`);
  }
  assert.ok(
    rules.some((rule) => rule.selector.includes('.wt-dot.working')),
    'the working dot lost its rule',
  );
});

test('the stylesheet carries no hex colour literals', () => {
  const css = readCss();
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g);
  assert.equal(hex, null, `hex colour literals are back: ${hex?.join(', ')}`);
});

test('the tab type is a page type with a title and no resource patterns', () => {
  const start = source.indexOf('ctx.sidebarRightTabs.register(');
  assert.ok(start > 0, 'the tab type is never registered');
  const end = source.indexOf("'work-team:sidebar-type'", start);
  assert.ok(end > start, 'the tab-type registration block is not shaped as expected');
  const block = source.slice(start, end);
  assert.match(block, /\btitle\s*:/, 'a page type needs title(address): it is read on every open');
  assert.doesNotMatch(block, /\bpatterns\s*:/, 'patterns make the type a resource claim; the office is opened by kind');
});

test('the office renders as a tab, not a modal', () => {
  assert.doesNotMatch(source, /function OfficeModal\b/, 'OfficeModal came back; the office is a sidebar tab now');
  assert.match(source, /function OfficeTab\b/, 'OfficeTab is missing');
});

test('reduced motion disables the handoff flash', () => {
  const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(start > 0, 'the reduced-motion block is gone');
  const block = source.slice(start, start + 900);
  assert.match(block, /\[data-wt-handoff\]/, 'the handoff flash still animates for motion-sensitive users');
});

test('the pause control does not also open the chat', () => {
  const index = source.indexOf('onStop(member.id)');
  assert.ok(index > 0, 'the pause control no longer calls onStop');
  const around = source.slice(Math.max(0, index - 320), index);
  assert.match(around, /stopPropagation\(\)/, 'a pause click bubbles to the row and opens the chat');
  assert.match(around, /preventDefault\(\)/, 'a pause click keeps the default action');
});

test('the pause labels survived the locale cleanup', () => {
  assert.match(source, /t\('card\.stop'\)/, 'card.stop is defined but no longer read');
  assert.match(source, /t\('error\.stop'\)/, 'error.stop is defined but no longer read');
});

test('zh and en define the same locale keys', () => {
  const zh = readLocaleKeys('const zh = {');
  const en = readLocaleKeys('const en = {');
  assert.ok(zh.size > 60, 'the zh dictionary looks truncated');
  assert.deepEqual([...en].sort(), [...zh].sort(), 'zh and en drifted apart');
  for (const key of [
    'settings.allowSelfHire',
    'settings.allowSelfHireHint',
    'settings.maxWorkers',
    'settings.maxWorkersHint',
  ]) {
    assert.ok(zh.has(key), `zh is missing ${key}`);
    assert.ok(en.has(key), `en is missing ${key}`);
  }
});

// ---------------------------------------------------------------------------
// Office V2 review invariants: the sidebar panel is narrower than the window,
// so panel sizing must be container-driven, and the handoff flash must not
// borrow the row's own background.
// ---------------------------------------------------------------------------

/** Body of the at-rule that starts at `index`, by brace matching. */
function atRuleBody(css, index) {
  const open = css.indexOf('{', index);
  assert.ok(open > index, 'the at-rule has no body');
  let depth = 0;
  for (let cursor = open; cursor < css.length; cursor += 1) {
    if (css[cursor] === '{') depth += 1;
    else if (css[cursor] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, cursor);
    }
  }
  assert.fail('the at-rule body is not terminated');
}

test('the panel is a container-query root with a parent-decided width', () => {
  const panel = readRules(readCss()).find((rule) => rule.selector === '.wt-panel');
  assert.ok(panel, '.wt-panel rule is missing');
  assert.match(panel.body, /container-type\s*:\s*inline-size/, 'container queries need container-type on .wt-panel');
  assert.match(panel.body, /width\s*:\s*100%/, 'inline-size containment means the panel cannot be sized by its content');
  assert.match(panel.body, /min-width\s*:\s*0/, 'a flex child needs min-width:0 to shrink with the sidebar');
});

test('panel sizing uses container queries, not viewport media queries', () => {
  const css = readCss();
  const panelScoped = ['.wt-panel', '.wt-row', '.wt-list', '.wt-task-columns', '.wt-head-stat'];
  const media = [...css.matchAll(/@media\s*\(max-width:[^)]*\)/g)];
  for (const match of media) {
    const body = atRuleBody(css, match.index);
    for (const selector of panelScoped) {
      assert.ok(
        !body.includes(selector),
        `${selector} is sized by a viewport media query; the sidebar width is not the window width`,
      );
    }
  }
  assert.match(css, /@container\s*\(max-width:\s*340px\)/, 'the narrow-panel container query is gone');
});

test('the handoff flash is an overlay, not a row background swap', () => {
  const handoff = readRules(readCss()).filter((rule) => rule.selector.includes('[data-wt-handoff]'));
  assert.ok(handoff.length > 0, 'the handoff selector is gone');
  for (const rule of handoff) {
    assert.ok(rule.selector.includes('::after'), 'the flash must target ::after so hover keeps its own background');
    assert.doesNotMatch(rule.body, /background/, 'a background on the row would fight the hover state');
  }
});

// ---------------------------------------------------------------------------
// Work Team V2.1: employees may hire on their own and spawn one-off workers.
// Both knobs live in the team settings section of the DSH settings dialog, and
// the field names belong to the Host Config schema, so a typo here would render
// a control that silently saves nothing.
// ---------------------------------------------------------------------------

/** Slice the team settings section out of the client source. */
function readTeamSettingsSection() {
  const start = source.indexOf('function TeamSettingsSection(');
  assert.ok(start > 0, 'client.js no longer declares TeamSettingsSection');
  const end = source.indexOf('function OfficeTab(', start);
  assert.ok(end > start, 'TeamSettingsSection is not followed by OfficeTab as expected');
  return source.slice(start, end);
}

test('the team settings section is registered as a DSH settings section', () => {
  const start = source.indexOf("ctx.slots.inject('settings.section'");
  assert.ok(start > 0, 'client.js no longer registers a settings.section');
  const end = source.indexOf("ctx.slots.inject('sidebar.right.pane.tab'", start);
  assert.ok(end > start, 'the settings.section registration is not followed by the tab registration');
  const block = source.slice(start, end);
  assert.match(block, /name:\s*'settings\.section'/, 'the slot name changed');
  assert.match(block, /id:\s*'work-team'/, 'the section id is the nav key');
  assert.match(block, /order:\s*12\b/, 'order 12 keeps the section between Models (10) and Plugins (15)');
  assert.match(block, /label:\s*\(\)\s*=>\s*t\('office\.settings'\)/, 'the nav label must follow the locale');
  assert.match(
    block,
    /inject:\s*\(\)\s*=>\s*\(\{\s*t,\s*form,\s*loadModelCatalog\s*\}\)/,
    'the section needs t, form, and the model catalog loader',
  );
  assert.match(block, /TeamSettingsSection/, 'the registered component is not the team section');
});

test('the old settings drawer did not come back', () => {
  assert.doesNotMatch(source, /wt-settings-backdrop/, 'the drawer backdrop is back');
  assert.doesNotMatch(source, /className:\s*'wt-settings'/, 'the drawer surface is back');
  assert.doesNotMatch(source, /setSettingsOpen/, 'the office still opens a settings overlay');
  const section = readTeamSettingsSection();
  assert.doesNotMatch(section, /role:\s*'dialog'/, 'the section must not draw its own dialog chrome');
  assert.doesNotMatch(section, /settings\.close/, 'the shell owns the close button');
});

test('the settings section stays root-scoped', () => {
  const section = readTeamSettingsSection();
  for (const hook of ['useProjection', 'useSessions', 'useSessionStatus', 'sessionId']) {
    assert.ok(!section.includes(hook), `a root settings section has no session store: ${hook}`);
  }
});

test('the section renders one model row per role from ROLES', () => {
  const section = readTeamSettingsSection();
  assert.match(section, /\.\.\.ROLES\.map\(/, 'role rows must come from ROLES, not a hard-coded list');
  assert.match(section, /role\.modelField/, 'each row must bind its own model field');
  assert.doesNotMatch(section, /'modelPm'/, 'a hard-coded role row would drift from the ROLES mirror');
});

test('the section header and catalog states are localized', () => {
  const section = readTeamSettingsSection();
  assert.match(section, /t\('settings\.sectionTitle'\)/, 'the section has no localized title');
  assert.match(section, /t\('settings\.sectionIntro'\)/, 'the section has no localized intro');
  assert.match(section, /t\('settings\.catalogError'/, 'the catalog error line is hard-coded');
  assert.match(section, /t\('settings\.catalogEmpty'\)/, 'the empty-catalog line is hard-coded');
  assert.doesNotMatch(
    section,
    /No routable models returned by the Host/,
    'English leaked back into the Chinese settings page',
  );
});

test('the team-size hint is scoped to the main chat', () => {
  assert.match(
    source,
    /'settings\.teamSizeHint': '当前主对话只增不减；缩编请开新主对话。'/,
    'the hint still reads as a global cap',
  );
  assert.match(
    source,
    /'settings\.teamSizeHint': 'The main chat only grows; start a new main chat to shrink\.'/,
    'the English hint drifted from the Chinese one',
  );
});

test('the settings panel exposes the self-hire switch', () => {
  const panel = readTeamSettingsSection();
  assert.match(panel, /checked:\s*value\.allowSelfHire\s*===\s*true/, 'the checkbox does not read allowSelfHire');
  assert.match(
    panel,
    /save\('allowSelfHire',\s*event\.target\.checked\)/,
    'the checkbox does not save allowSelfHire',
  );
  assert.match(panel, /t\('settings\.allowSelfHire'\)/, 'the switch has no label');
  assert.match(
    panel,
    /className:\s*'wt-check'\s*\},[\s\S]{0,200}checked:\s*value\.allowSelfHire/,
    'the switch stopped reusing the .wt-check structure',
  );
});

test('the settings panel exposes the temporary-worker cap', () => {
  const panel = readTeamSettingsSection();
  assert.match(panel, /value\.maxWorkersPerEmployee/, 'the select does not read maxWorkersPerEmployee');
  assert.match(
    panel,
    /save\('maxWorkersPerEmployee',\s*Number\(event\.target\.value\)\)/,
    'the select does not save the cap as a number',
  );
  assert.match(panel, /t\('settings\.maxWorkers'\)/, 'the select has no label');
});

test('the temporary-worker cap reads a saved 0 instead of falling back to 2', () => {
  const panel = readTeamSettingsSection();
  assert.match(
    panel,
    /value\.maxWorkersPerEmployee\s*\?\?\s*2/,
    'the default must use ?? — || would turn a saved 0 into 2',
  );
  assert.doesNotMatch(
    panel,
    /value\.maxWorkersPerEmployee\s*\|\|\s*2/,
    '|| collapses a saved 0 (workers off) into the default 2',
  );
  assert.match(panel, /parsedMaxWorkers\s*>=\s*0/, 'the clamp stopped accepting 0 as the "off" value');
});

test('the panel and the Host agree on the temporary-worker ceiling', () => {
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const hostCeiling = /const MAX_WORKERS = (\d+);/.exec(host);
  const clientCeiling = /const MAX_TEMPORARY_WORKERS = (\d+);/.exec(source);
  assert.ok(hostCeiling, 'index.js no longer declares MAX_WORKERS');
  assert.ok(clientCeiling, 'client.js no longer declares MAX_TEMPORARY_WORKERS');
  assert.equal(
    clientCeiling[1],
    hostCeiling[1],
    'the select range and the Host clamp disagree on the worker ceiling',
  );
});

test('the panel and the Host agree on the team-size ceiling', () => {
  // The Host clamps teamSize to MAX_TEAM_SIZE, declared in lib/roles.js and
  // imported by index.js — so pin the value AND the import wiring.
  const roles = readFileSync(new URL('../lib/roles.js', import.meta.url), 'utf8');
  const host = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const hostCeiling = /export const MAX_TEAM_SIZE = (\d+);/.exec(roles);
  const clientCeiling = /const MAX_TEAM_SIZE = (\d+);/.exec(source);
  assert.ok(hostCeiling, 'lib/roles.js no longer declares MAX_TEAM_SIZE');
  assert.ok(clientCeiling, 'client.js no longer declares MAX_TEAM_SIZE');
  assert.equal(
    clientCeiling[1],
    hostCeiling[1],
    'the team-size select and the Host clamp disagree on the ceiling',
  );
  assert.match(
    host,
    /MAX_TEAM_SIZE[\s\S]{0,160}from '\.\/lib\/roles\.js'/,
    'index.js stopped taking MAX_TEAM_SIZE from lib/roles.js, so the two ceilings can drift',
  );
});
