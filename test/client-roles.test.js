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

/** Slice [startMarker, endMarker) out of client.js; drift fails loudly. */
function sliceSource(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `client.js no longer contains ${JSON.stringify(startMarker)}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, `client.js lost ${JSON.stringify(endMarker)} after ${JSON.stringify(startMarker)}`);
  return source.slice(start, end);
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

// ---------------------------------------------------------------------------
// Token budget: the settings pair, the office header segment, and the
// "awaiting acceptance" badge. The Host owns the numbers; these pin that the
// panel reads the agreed field names and never renders a budget as money.
// ---------------------------------------------------------------------------

/** Slice the office tab component out of the client source. */
function readOfficeTab() {
  const start = source.indexOf('function OfficeTab(');
  assert.ok(start > 0, 'client.js no longer declares OfficeTab');
  const end = source.indexOf('    // ---------------------------------------------------------------------\n    // Slots', start);
  assert.ok(end > start, 'OfficeTab is not followed by the slot registrations as expected');
  return source.slice(start, end);
}

test('the settings section exposes the token budget pair under the cost note', () => {
  const panel = readTeamSettingsSection();
  assert.match(panel, /t\('settings\.tokenBudget'\)/, 'the budget field has no label');
  assert.match(panel, /t\('settings\.tokenBudgetHint'\)/, 'the budget field has no hint');
  assert.match(panel, /t\('settings\.tokenBudgetOnExceed'\)/, 'the exceed switch has no label');
  assert.match(panel, /value\.teamTokenBudget/, 'the input does not read teamTokenBudget');
  assert.match(
    panel,
    /save\('teamTokenBudget',\s*rounded\)/,
    'the input does not save teamTokenBudget as a whole number',
  );
  assert.match(panel, /value\.tokenBudgetOnExceed/, 'the select does not read tokenBudgetOnExceed');
  assert.match(
    panel,
    /save\('tokenBudgetOnExceed',\s*event\.target\.value\)/,
    'the select does not save tokenBudgetOnExceed',
  );
  assert.match(panel, /value:\s*'warn'/, 'the warn mode option is missing');
  assert.match(panel, /value:\s*'block'/, 'the block mode option is missing');
  // The cost note and the budget group sit next to each other, so the two
  // answers to "what will this cost?" stay readable as one block.
  const noteAt = panel.indexOf("t('settings.costHint')");
  const budgetAt = panel.indexOf("t('settings.budget')");
  assert.ok(noteAt > 0 && budgetAt > noteAt, 'the budget group must follow the cost note');
});

test('the token budget parses 0 as a real value and defaults to no ceiling', () => {
  const panel = readTeamSettingsSection();
  assert.match(panel, /value\.teamTokenBudget\s*\?\?\s*0/, 'the default must use ?? so a saved 0 survives');
  assert.doesNotMatch(panel, /value\.teamTokenBudget\s*\|\|/, '|| collapses a saved 0 into a default');
  assert.match(panel, /parsedBudget\s*>\s*0/, '0 must stay the "no ceiling" value, not a limit');
});

test('the budget copy counts tokens and never money', () => {
  const zh = readLocaleKeys('const zh = {');
  const en = readLocaleKeys('const en = {');
  for (const key of [
    'settings.budget',
    'settings.tokenBudget',
    'settings.tokenBudgetHint',
    'settings.tokenBudgetOnExceed',
    'settings.tokenBudgetOnExceed.warn',
    'settings.tokenBudgetOnExceed.block',
    'settings.tokenBudgetOnExceedHint',
    'office.budgetTitle',
    'office.budgetUnlimited',
    'office.budgetExceeded',
    'office.budgetExceededTitle',
    'task.awaitingAcceptance',
  ]) {
    assert.ok(zh.has(key), `zh is missing ${key}`);
    assert.ok(en.has(key), `en is missing ${key}`);
  }
  const start = source.indexOf("'settings.tokenBudgetHint'");
  const hint = source.slice(start, source.indexOf('\n', start));
  assert.match(hint, /token/i, 'the hint must name the unit');
  for (const money of ['¥', '￥', '$', '美元', '元']) {
    assert.ok(!hint.includes(money), `the hint reads as money: ${money}`);
  }
});

test('the office header renders the budget and its over-budget chip', () => {
  const panel = readOfficeTab();
  assert.match(panel, /t\('office\.budgetTitle'\)/, 'the usage line has no budget title');
  assert.match(panel, /formatTokens\(shownUsed\)/, 'usage is not formatted through formatTokens');
  assert.match(panel, /formatTokens\(shownLimit\)/, 'the ceiling is not formatted through formatTokens');
  assert.match(panel, /t\('office\.budgetUnlimited'/, 'a 0 ceiling must say it is unlimited');
  assert.match(panel, /budget\.exceeded\s*===\s*true/, 'the warning chip does not read budget.exceeded');
  assert.match(panel, /t\('office\.budgetExceeded'\)/, 'the warning chip has no label');
  assert.match(panel, /t\('office\.budgetExceededTitle'\)/, 'the warning chip has no title');
  assert.match(panel, /wt-head-budget/, 'the warning chip has no class of its own');
  // The Host block is preferred and the settings form is the fallback, so an
  // older projection cannot blank the line.
  assert.match(panel, /readBudget\(team\?\.budget/, 'the header does not read the Host budget block');
  assert.match(panel, /formSnapshot\.value\?\.teamTokenBudget/, 'the fallback ceiling is not read from the form');
  assert.match(panel, /formSnapshot\.value\?\.tokenBudgetOnExceed/, 'the fallback mode is not read from the form');
  assert.ok(panel.includes('totalTokens'), 'the member-sum fallback is gone');
});

/**
 * Evaluate the bundle's pure helpers with real data.
 *
 * client.js is a module-loader bundle, so its functions cannot be imported. The
 * budget and acceptance rules are the two places where the panel must agree with
 * the Host *exactly*, and a regex over the source cannot prove that: lift the
 * contiguous pure block out and run it.
 */
function loadPureBlock() {
  const start = source.indexOf('function sameNumber(');
  assert.ok(start > 0, 'client.js no longer declares sameNumber');
  const end = source.indexOf('function deriveStatus(', start);
  assert.ok(end > start, 'the pure helper block is not followed by deriveStatus as expected');
  const block = source.slice(start, end);
  const names = [
    'sumTokens',
    'formatTokens',
    'wholeTokens',
    'readBudget',
    'teamTokenTotal',
    'acceptanceQueue',
    'isReviewTask',
    'REVIEW_SUBJECT_PREFIX',
    'REVIEW_SCOPE_PREFIX',
    'parseBenchRoles',
    'roleIdOf',
    'isBenched',
    'presetFieldOf',
    'presetLabel',
    'presetOf',
    'presetDisplay',
    'createTaskPayload',
    'createTaskRequest',
    'assignTaskRequest',
    'reassignPayload',
    'acceptanceRequest',
    'drawerFacts',
    'formatDuration',
    'focusCycle',
    'focusStep',
    'TASK_SUBJECT_LIMIT',
  ];
  return new Function(`${block}\nreturn { ${names.join(', ')} };`)();
}

test('the budget reading normalises like lib/budget.js', () => {
  const { readBudget } = loadPureBlock();
  assert.deepEqual(
    readBudget(undefined, { used: 1200, limit: 0, mode: 'warn' }),
    { used: 1200, limit: 0, mode: 'warn', exceeded: false },
    'no ceiling is unlimited, never exceeded',
  );
  assert.deepEqual(
    readBudget(undefined, { used: 2500, limit: 2000, mode: 'block' }),
    { used: 2500, limit: 2000, mode: 'block', exceeded: true },
    'usage past the ceiling is exceeded',
  );
  assert.equal(
    readBudget(undefined, { used: 10, limit: 10 }).exceeded,
    true,
    'reaching the ceiling counts as over it, the same rule lib/budget.js uses',
  );
  assert.equal(readBudget({ used: 1, limit: 0, exceeded: false }, {}).exceeded, false, 'a published false wins');
  assert.equal(readBudget(undefined, { used: 100, limit: -5 }).limit, 0, 'junk must not become a ceiling');
  assert.equal(readBudget(undefined, { used: 'junk', limit: 'junk' }).used, 0, 'junk usage reads as 0');
  assert.equal(readBudget(undefined, { used: 5, limit: 9, mode: 'BLOCK' }).mode, 'warn', 'only an exact block hardens');
  // The projected branch is forward compatibility, and the comment says so:
  // the kernel projection carries no budget block today.
  assert.match(source, /carries no budget block/, 'the forward-compat note is gone');
  assert.match(source, /forward compatibility/, 'the forward-compat note lost its wording');
});

test('the team token total counts the Lead Session as well as the roster', () => {
  const { teamTokenTotal } = loadPureBlock();
  const lead = { uncachedInputTokens: 120, outputTokens: 80, cacheReadTokens: 40, cacheWriteTokens: 10 };
  assert.equal(teamTokenTotal(lead, 300), 550, 'the Lead Session must be part of the team total');
  assert.equal(teamTokenTotal(lead, 0), 250, 'a team with no member usage still counts the Lead');
  assert.equal(teamTokenTotal(undefined, 300), 300, 'an unreadable Lead projection degrades to the roster');
  assert.equal(teamTokenTotal(lead, Number.NaN), 250, 'a junk roster total must not poison the line');
  // The panel must feed both halves: the Lead's own projection and the sum.
  const panel = readOfficeTab();
  assert.match(panel, /useProjection\('tokenUsage'\)/, 'the Lead tokenUsage projection is never read');
  assert.match(panel, /teamTokenTotal\(leadUsage, memberTokens\)/, 'the header total skips one of the two halves');
});

test('the acceptance queue excludes review tasks and ownerless tasks', () => {
  const { acceptanceQueue } = loadPureBlock();
  const names = new Set(['frontend', 'reviewer', 'backend']);
  const queue = acceptanceQueue(
    [
      { id: 'task-1', status: 'in_progress', ownerName: 'frontend', subject: '改设置页' },
      { id: 'task-2', status: 'in_progress', ownerName: 'backend', subject: '审查：复核迁移脚本' },
      { id: 'task-3', status: 'in_progress', ownerName: 'backend', subject: '随便什么', writeScopes: ['work-team/review/task-1'] },
      { id: 'task-4', status: 'in_progress', subject: '没人认领' },
      { id: 'task-5', status: 'pending', ownerName: 'frontend', subject: '待办' },
      { id: 'task-6', status: 'in_progress', ownerName: 'outsider', subject: '别的会话' },
      { id: 'task-7', status: 'completed', ownerName: 'backend', subject: '做完了' },
      { id: 'task-8', status: 'in_progress', ownerName: 'reviewer', subject: '随便什么' },
    ],
    names,
  );
  assert.deepEqual(
    queue.map((task) => task.id),
    ['task-1', 'task-8'],
    'real in-progress employee work is the queue; the reviewer\'s ordinary task is real work',
  );
  assert.deepEqual(queue[0], { id: 'task-1', subject: '改设置页', owner: 'frontend' }, 'the row keeps the Host fields');
  // The three cases that decide the queue, each on its own so a regression
  // names itself. A `审查：` subject is the legacy review mark, so it is OUT for
  // the same reason a `work-team/review/` scope is: it is gate paperwork.
  const legacySubject = acceptanceQueue(
    [{ id: 'task-9', status: 'in_progress', ownerName: 'backend', subject: '审查：复核迁移脚本' }],
    names,
  );
  assert.deepEqual(legacySubject, [], 'the legacy 审查： subject still marks a review task');
  const scopeMarked = acceptanceQueue(
    [
      {
        id: 'task-10',
        status: 'in_progress',
        ownerName: 'backend',
        subject: '随便什么',
        writeScopes: ['work-team/review/task-1'],
      },
    ],
    names,
  );
  assert.deepEqual(scopeMarked, [], 'a scope-marked review task must never enter the acceptance queue');
  const reviewerOwned = acceptanceQueue(
    [{ id: 'task-11', status: 'in_progress', ownerName: 'reviewer', subject: '随便什么' }],
    names,
  );
  assert.deepEqual(
    reviewerOwned.map((task) => task.id),
    ['task-11'],
    'owner is not a review signal: ordinary work for the reviewer still needs accepting',
  );
  const ownerless = acceptanceQueue([{ id: 'task-12', status: 'in_progress', subject: '无主' }], names);
  assert.deepEqual(ownerless, [], 'an ownerless task is nobody\'s deliverable');
  // A real task that merely shares a scope prefix unrelated to review stays in.
  const otherScope = acceptanceQueue(
    [{ id: 'task-13', status: 'in_progress', ownerName: 'backend', subject: '迁移脚本', writeScopes: ['src/migrate'] }],
    names,
  );
  assert.deepEqual(otherScope.map((task) => task.id), ['task-13'], 'only the review namespace marks a review task');
  const panel = readOfficeTab();
  assert.match(panel, /acceptanceQueue\(tasks, new Set\(members\.map/, 'the panel stopped deriving the queue');
});

test('the review-task mirror matches lib/acceptance.js', async () => {
  const host = await import('../lib/acceptance.js');
  const pure = loadPureBlock();
  assert.equal(
    pure.REVIEW_SUBJECT_PREFIX,
    host.REVIEW_SUBJECT_PREFIX,
    'the review subject prefix drifted from lib/acceptance.js',
  );
  // The scope marker is the collision-proof signal. When the Host exports its
  // constant, compare against it; until then pin the agreed literal so nobody
  // renames the namespace on one side only.
  if (typeof host.REVIEW_SCOPE_PREFIX === 'string') {
    assert.equal(pure.REVIEW_SCOPE_PREFIX, host.REVIEW_SCOPE_PREFIX, 'the review scope prefix drifted from the Host');
  } else {
    assert.equal(pure.REVIEW_SCOPE_PREFIX, 'work-team/review/', 'the agreed review scope namespace changed');
  }
});

test('the task board badges pending acceptance without regrouping the columns', () => {
  const board = source.slice(source.indexOf('function TaskCard('), source.indexOf('function TaskBoard('));
  assert.match(board, /accepting === true/, 'the card does not render the badge conditionally');
  assert.match(board, /wt-task-accept/, 'the badge has no class');
  assert.match(board, /t\('task\.awaitingAcceptance'\)/, 'the badge is not localized');
  const boardBody = source.slice(source.indexOf('function TaskBoard('), source.indexOf('function TeamSettingsSection('));
  assert.match(boardBody, /team\?\.pendingAcceptance|pendingAcceptance/, 'the board ignores pendingAcceptance');
  assert.match(boardBody, /new Set\(/, 'the acceptance list is not collapsed to an id set');
  // Three columns stay three: the badge is a flag on a card, not a new group.
  assert.equal((boardBody.match(/h\(TaskColumn,/g) ?? []).length, 3, 'the board grew or lost a column');
  const panel = readOfficeTab();
  assert.equal(
    (panel.match(/^\s+pendingAcceptance,$/gm) ?? []).length,
    2,
    'both the live board and the frozen board must receive pendingAcceptance',
  );
});

test('the badge and the chip reuse alias colours instead of new ones', () => {
  // Selectors keep the comment that precedes them in the source; match on the
  // tail so a doc comment above a rule does not hide it.
  const rules = readRules(readCss());
  const badge = rules.find((rule) => rule.selector.endsWith('.wt-task-accept'));
  assert.ok(badge, 'the .wt-task-accept rule is gone');
  assert.match(badge.body, /var\(--dsw-alias-state-warn-primary\)/, 'the badge must reuse the warn alias');
  assert.doesNotMatch(badge.body, /#[0-9a-fA-F]{3,8}\b/, 'the badge hard-codes a hex colour');
  const chip = rules.find((rule) => rule.selector.endsWith('.wt-head-budget'));
  assert.ok(chip, 'the .wt-head-budget rule is gone');
  assert.match(chip.body, /var\(--dsw-alias-state-warn-primary\)/, 'the chip must reuse the warn alias');
  assert.doesNotMatch(chip.body, /#[0-9a-fA-F]{3,8}\b/, 'the chip hard-codes a hex colour');
  // No new custom property enters the sheet.
  assert.ok(!/--wt-budget|--wt-accept/.test(readCss()), 'a budget-only CSS variable was introduced');
});

// ---------------------------------------------------------------------------
// v2.4: bench states, the handover entry, and the permission presets.
// The bench list is a Config string and the status ladder runs on it, so both
// are asserted with real data here rather than by grepping the template.
// ---------------------------------------------------------------------------

/** The mirrored role table, read out of the client (ids + both display names). */
const MIRROR_ROLES = readMirror().map((row) => ({
  id: row.id,
  zh: { name: row.zhName },
  en: { name: row.enName },
}));

/** Evaluate deriveStatus on its own; member-status.test.js owns its own slice. */
function loadDeriveStatus() {
  const start = source.indexOf('function deriveStatus(member, signals) {');
  assert.ok(start > 0, 'client.js no longer declares deriveStatus');
  const end = source.indexOf('\n    /** Team members outside the mirrored roster', start);
  assert.ok(end > start, 'deriveStatus is not followed by the roster helper as expected');
  const block = source.slice(start, end);
  return new Function(`${block}\nreturn deriveStatus;`)();
}

test('benchRoles parses exactly like lib/bench.js', async () => {
  const { parseBenchRoles } = loadPureBlock();
  const host = await import('../lib/bench.js');
  const cases = [
    'reviewer, ops',
    'reviewer ops',
    'fe,be',
    'QA;ops',
    'reviewer，ops',
    'reviewer、ops',
    '  reviewer , reviewer ,ops  ',
    'nobody, reviewer',
    '',
    ' ,,, ',
    '小审',
    'Rae',
    'reviewer, 小审',
    undefined,
    42,
  ];
  for (const raw of cases) {
    assert.deepEqual(
      parseBenchRoles(raw, MIRROR_ROLES),
      host.parseBenchRoles(raw),
      `the panel and the Host disagree on ${JSON.stringify(raw)}`,
    );
  }
  // The behaviours that matter, spelled out so a failure names itself.
  assert.deepEqual(parseBenchRoles('fe', MIRROR_ROLES), { roles: ['frontend'], unknown: [] }, 'short aliases resolve');
  assert.deepEqual(
    parseBenchRoles('小审', MIRROR_ROLES),
    { roles: [], unknown: ['小审'] },
    'display names are NOT aliases: the Host would not bench that seat',
  );
  assert.deepEqual(
    parseBenchRoles('nobody, reviewer', MIRROR_ROLES),
    { roles: ['reviewer'], unknown: ['nobody'] },
    'an unknown token is reported, not silently dropped',
  );
  assert.deepEqual(parseBenchRoles(undefined, MIRROR_ROLES), { roles: [], unknown: [] }, 'a missing value benches nobody');
});

test('the client alias table matches lib/roles.js', () => {
  const rolesSource = readFileSync(new URL('../lib/roles.js', import.meta.url), 'utf8');
  const pairs = (block) => [...block.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => `${m[1]}:${m[2]}`);
  const hostBlock = /const ROLE_ALIASES = new Map\(\[([\s\S]*?)\]\)/.exec(rolesSource);
  assert.ok(hostBlock, 'lib/roles.js no longer declares ROLE_ALIASES');
  const clientBlock = /const ROLE_ALIASES = new Map\(\[([\s\S]*?)\]\)/.exec(source);
  assert.ok(clientBlock, 'client.js lost its ROLE_ALIASES mirror');
  assert.deepEqual(pairs(clientBlock[1]), pairs(hostBlock[1]), 'the bench aliases drifted from lib/roles.js');
});

test('isBenched keys off the roster name and never the Lead', () => {
  const { isBenched } = loadPureBlock();
  const bench = new Set(['reviewer']);
  assert.equal(isBenched({ name: 'reviewer' }, bench), true, 'a listed role is benched');
  assert.equal(isBenched({ name: 'ops' }, bench), false, 'an unlisted role is not');
  assert.equal(isBenched(null, bench), false, 'an empty desk is not benched');
  assert.equal(isBenched(undefined, bench), false, 'a missing row is not benched');
});

test('deriveStatus reports the bench ahead of every activity signal', () => {
  const deriveStatus = loadDeriveStatus();
  const busy = { timing: { settledMs: 9000, active: true, lastTurnCompleted: true, degraded: false } };
  assert.equal(
    deriveStatus({ phase: 'active' }, { ...busy, pending: false, benched: true }),
    'benched',
    'a benched seat is not "working", however busy its last turn looked',
  );
  assert.equal(
    deriveStatus({ phase: 'active' }, { ...busy, pending: true, benched: true }),
    'benched',
    'a pending interaction does not outrank the bench',
  );
  assert.equal(
    deriveStatus({ phase: 'active' }, { ...busy, pending: false, benched: false }),
    'working',
    'an unflagged member keeps the normal ladder',
  );
});

test('a failed employee reads as failed, and keeps its bench marker', () => {
  const deriveStatus = loadDeriveStatus();
  assert.equal(
    deriveStatus({ phase: 'failed' }, { pending: false, benched: true }),
    'failed',
    'a broken employee must not be hidden behind the bench',
  );
  assert.equal(
    deriveStatus({ phase: 'failed' }, { pending: true, benched: true }),
    'failed',
    'nor behind a pending interaction',
  );
  assert.equal(
    deriveStatus({ phase: 'failed' }, { pending: false, benched: false }),
    'failed',
    'the failed reading itself did not change',
  );
  // The two facts are not exclusive: the status word is failed, the bench marker
  // is still drawn. It therefore follows the flag, not the status.
  const desk = sliceSource('    function DeskCard(', '    /** An unfilled workstation');
  assert.match(desk, /'data-wt-benched': benched === true/, 'the desk marker keys off the status word again');
  const row = sliceSource('    function OfficeRow(', '    /** An unfilled seat in the same 44px rhythm');
  assert.match(row, /'data-wt-benched': benched === true/, 'the row marker keys off the status word again');
  const candidate = sliceSource('    function DispatchCandidateRow(', '    function DispatchOverlay(props) {');
  assert.match(candidate, /'data-wt-benched': entry\.benched === true/, 'a benched candidate lost its marker');
});

test('the preset fields fall back to hands-off without inventing a name', () => {
  const { presetFieldOf, presetOf, presetDisplay, presetLabel } = loadPureBlock();
  assert.equal(presetFieldOf('reviewer'), 'presetReviewer', 'reviewer maps to its own Config field');
  assert.equal(presetFieldOf('researcher'), 'presetResearcher', 'researcher maps to its own Config field');
  assert.equal(presetFieldOf('ops'), 'presetOps', 'ops maps to its own Config field');
  assert.equal(presetFieldOf('designer'), '', 'a role without a preset field has none');
  assert.equal(presetOf('reviewer', { presetReviewer: ' workspace-write ' }), 'workspace-write', 'the saved name is trimmed');
  assert.equal(presetOf('reviewer', {}), '', 'unset is hands-off');
  assert.equal(presetOf('designer', { presetReviewer: 'workspace-write' }), '', 'a role with no field never borrows another');
  assert.equal(presetLabel(42), '', 'a non-string reads as hands-off');
  const t = (key) => (key === 'settings.preset.none' ? '不接管' : key);
  assert.equal(presetDisplay('', t), '不接管', 'an empty preset shows the hands-off word');
  assert.equal(presetDisplay('danger-full-access', t), 'danger-full-access', 'a real preset shows its name');
});

test('the office marks the bench without turning it into an error', () => {
  const panel = readOfficeTab();
  // The count lives in the head, last so it ellipsizes before 干活中.
  assert.match(panel, /t\('office\.benchTitle'\)/, 'the bench count has no title');
  assert.match(panel, /t\('office\.benchCount'\)/, 'the bench count is not localized');
  assert.match(panel, /wt-head-bench/, 'the bench count has no class of its own');
  assert.match(panel, /benchCount > 0/, 'a team with nobody benched still prints a count');
  // Cramped headers keep 干活中: the bench stat is the one that shrinks first.
  const benchRule = readRules(readCss()).find((rule) => rule.selector.endsWith('.wt-head-bench'));
  assert.ok(benchRule, 'the .wt-head-bench rule is gone');
  assert.match(benchRule.body, /flex:0 6 auto/, 'the bench count no longer yields width before 干活中');
  // The bench travels into the corridor so the desk can render the state.
  assert.match(panel, /benched: bench\.has\(role\.id\)/, 'a vacant desk never carries the bench flag');
  assert.match(panel, /benched: isBenched\(member, bench\)/, 'an extra member is never marked benched');
  // It is a status, never an error: nothing about it reads as failure.
  const benchCss = source.slice(source.indexOf('.wt-st-benched'));
  assert.doesNotMatch(benchCss.slice(0, 400), /state-error/, 'the bench borrowed the error hue');
});

test('the @ overlay keeps benched roles selectable and labels them', () => {
  const overlay = sliceSource('    function DispatchOverlay(props) {', '    // ---------------------------------------------------------------------\n    // Slots');
  assert.match(overlay, /benched: isBenched\(member, bench\)/, 'candidates never learn who is benched');
  assert.doesNotMatch(overlay, /\.filter\([^)]*benched/, 'benched candidates must not be filtered out');
  const row = sliceSource('    function DispatchCandidateRow(', '    function DispatchOverlay(props) {');
  assert.match(row, /benched: entry\.benched === true/, 'the candidate status ignores the bench flag');
  assert.match(row, /data-wt-benched/, 'the candidate row has no bench marker');
  // The label itself comes from the status word, which is why status.benched exists.
  assert.match(row, /t\(`status\.\$\{status\}`\)/, 'the candidate row stopped printing the status word');
});

test('the handover button queues one sentence instead of composing a brief', () => {
  const panel = readOfficeTab();
  assert.match(panel, /t\('office\.handover'\)/, 'the header has no handover label');
  assert.match(panel, /t\('office\.handoverTitle'\)/, 'the header button has no explanation');
  assert.match(panel, /handover\(t\('office\.handoverRequest'\)\)/, 'the button does not send the fixed request sentence');
  assert.doesNotMatch(panel, /team_handover\s*\(/, 'the panel tries to run the Host tool itself');
  assert.doesNotMatch(panel, /markdown/i, 'the panel composes markdown instead of asking the Host');
  const injected = sliceSource('      const injected = (sessionId) => ({', '      });');
  assert.match(injected, /handover: \(text\) => queueLeadPrompt\(ctx, sessionId, text\)/, 'the entry is not wired to the queue channel');
  const sender = sliceSource('    async function queueLeadPrompt(', '    /**\n     * Hand focus back to the composer editor');
  assert.match(sender, /ctx\.sessions\.retain\(sessionId/, 'the Lead session is not retained by id');
  assert.match(sender, /prompt\(\[\{ type: 'text', text: body \}\], 'queue'\)/, 'the request does not use the queue channel');
});

test('the settings page edits the bench and the three presets', () => {
  const panel = readTeamSettingsSection();
  assert.match(panel, /t\('settings\.benchRoles'\)/, 'the bench field has no label');
  assert.match(panel, /value\.benchRoles/, 'the bench field does not read benchRoles');
  assert.match(panel, /save\('benchRoles', next\)/, 'the bench field does not save benchRoles');
  assert.match(panel, /t\('settings\.benchRolesHint'\)/, 'the bench field has no hint');
  assert.match(panel, /PRESET_ROLES\.map/, 'the preset fields are hard-coded instead of driven by the table');
  assert.match(panel, /save\(presetFieldOf\(entry\.roleId\), next\)/, 'a preset field does not save its own Config key');
  assert.match(panel, /t\('settings\.preset\.none'\)|presetDisplay\('', t\)/, 'the empty preset has no hands-off label');
  // The copy must not promise a read-only tier the plugin cannot define.
  const zhHint = /'settings\.presetsHint': '([^']+)'/.exec(source)?.[1] ?? '';
  assert.match(zhHint, /只切换/, 'the hint must say the plugin only switches presets');
  assert.match(zhHint, /不定义/, 'the hint must say the plugin does not define presets');
  assert.match(zhHint, /workspace-write/, 'the hint must name the default presets');
  assert.match(zhHint, /members\[\]\.preset/, 'the hint must point at the field that proves what applied');
  assert.match(zhHint, /node --test/, 'the hint must warn that a read-only reviewer cannot run the tests');
  assert.match(zhHint, /只读/, 'the hint must name the read-only trap');
  const enHint = /'settings\.presetsHint': '([^']+)'/.exec(source.slice(source.indexOf('const en = {')))?.[1] ?? '';
  assert.match(enHint, /members\[\]\.preset/, 'the English hint lost the applied-value pointer');
  assert.match(enHint, /node --test/, 'the English hint lost the read-only trap');
});

test('the Lead never carries a stop or a bench control', () => {
  // The roster hook is the one place the Lead is dropped, and every surface
  // (office, dock, @ overlay, settings) reads the roster through it.
  assert.match(
    source,
    /filter\(\(member\) => member\?\.role !== 'lead'\)/,
    'the Lead is no longer dropped from the roster',
  );
  const desk = sliceSource('    function DeskCard(', '    /** An unfilled workstation');
  assert.doesNotMatch(
    desk,
    /onBench|setBench|save\('benchRoles'/,
    'a desk grew a bench toggle; the bench is Config, not a control',
  );
  const row = sliceSource('    function OfficeRow(', '    /** An unfilled seat in the same 44px rhythm');
  assert.doesNotMatch(
    row,
    /onBench|setBench|save\('benchRoles'/,
    'a row grew a bench toggle; the bench is Config, not a control',
  );
  // Benched is not stoppable either: there is no turn to interrupt.
  assert.match(desk, /stoppable = status === 'working' \|\| status === 'waiting'/, 'the stop control condition changed');
});

// ---------------------------------------------------------------------------
// v2.5: the task board's write surface and the member drawer.
//
// First principle: the client may hand out work, but only the Lead's
// `accept_task` closes it. So the acceptance path is a queued sentence, and the
// tests below assert both halves — the request it builds, and the absence of any
// direct `complete` write.
// ---------------------------------------------------------------------------

test('createTaskPayload builds the kernel request and refuses bad input', () => {
  const { createTaskPayload, TASK_SUBJECT_LIMIT } = loadPureBlock();
  assert.equal(TASK_SUBJECT_LIMIT, 200, 'the subject ceiling drifted from the Team service');
  assert.deepEqual(
    createTaskPayload({ subject: '  改设置页  ', description: ' 两点  ', writeScopes: 'src/a.ts, lib/b.js src/a.ts' }),
    {
      ok: true,
      payload: { subject: '改设置页', description: '两点', writeScopes: ['src/a.ts', 'lib/b.js'] },
    },
    'trimmed subject, trimmed description, de-duplicated scopes',
  );
  assert.deepEqual(
    createTaskPayload({ subject: '一个标题' }, '默认描述'),
    { ok: true, payload: { subject: '一个标题', description: '默认描述', writeScopes: [] } },
    'a blank description falls back instead of shipping an empty string',
  );
  assert.deepEqual(createTaskPayload({ subject: '   ' }), { ok: false, reason: 'subject-empty' }, 'a blank subject is refused');
  assert.deepEqual(
    createTaskPayload({ subject: 'x'.repeat(201) }),
    { ok: false, reason: 'subject-long' },
    'over 200 characters is refused, not truncated',
  );
  assert.equal(createTaskPayload({ subject: 'x'.repeat(200) }).ok, true, 'exactly 200 is allowed');
  assert.deepEqual(createTaskPayload({ subject: 'ok', writeScopes: ' ,  ' }).payload.writeScopes, [], 'separators alone are no scope');
});

test('acceptance is a queued request, never a board write', () => {
  const { acceptanceRequest } = loadPureBlock();
  assert.deepEqual(acceptanceRequest('task-1', '  '), { ok: false, reason: 'evidence' }, 'blank evidence is refused');
  assert.deepEqual(acceptanceRequest('', '跑过了'), { ok: false, reason: 'task' }, 'a missing task id is refused');
  assert.deepEqual(
    acceptanceRequest(' task-7 ', '  node --test 48 通过  '),
    { ok: true, text: '验收 task-7，证据：node --test 48 通过' },
    'the sentence is the one the Lead reads',
  );
  // Reverse assertions: no code path may close a task by itself.
  assert.doesNotMatch(source, /action:\s*'complete'/, 'something writes the complete action');
  assert.doesNotMatch(source, /updateTask\([^)]*complete/, 'updateTask is called with complete');
  const injected = sliceSource('      const injected = (sessionId) => ({', '      });');
  assert.match(
    injected,
    /return queueLeadPrompt\(ctx, sessionId, request\.text\)/,
    'acceptance must go out through the queue channel',
  );
  assert.doesNotMatch(injected, /acceptTask:[\s\S]{0,220}updateTask/, 'acceptance touched the board directly');
});

test('every board write goes out as one queue request', () => {
  const { createTaskRequest, assignTaskRequest } = loadPureBlock();
  const created = createTaskRequest({
    subject: '  改设置页  ',
    description: '把保存改成乐观更新',
    writeScopes: 'src/a.ts, lib/b.js',
  });
  assert.equal(created.ok, true, 'a valid draft must produce a request');
  assert.equal(
    created.text,
    [
      '建任务 改设置页',
      '描述：把保存改成乐观更新',
      '涉及文件：src/a.ts、lib/b.js',
      '用 team_task_create 建，写清验收标准与涉及文件。',
    ].join('\n'),
    'the create request lost a field or gained prose',
  );
  const bare = createTaskRequest({ subject: '只有标题' });
  assert.equal(bare.ok, true);
  assert.equal(
    bare.text,
    ['建任务 只有标题', '用 team_task_create 建，写清验收标准与涉及文件。'].join('\n'),
    'blank description and scopes must be omitted, not sent as empty lines',
  );
  assert.deepEqual(createTaskRequest({ subject: '' }), { ok: false, reason: 'subject-empty' }, 'a blank subject is refused');
  assert.deepEqual(createTaskRequest({ subject: 'x'.repeat(201) }), { ok: false, reason: 'subject-long' });

  const assigned = assignTaskRequest('task-7', { name: 'backend', label: '老后' });
  assert.equal(assigned.ok, true);
  assert.equal(
    assigned.text,
    '把 task-7 指派给 老后（backend），用 team_task_update 的 reassign 改派。',
    'the assign request must name the human and the tool',
  );
  assert.equal(
    assignTaskRequest('task-7', { name: 'backend' }).text,
    '把 task-7 指派给 backend，用 team_task_update 的 reassign 改派。',
    'without a display label the roster name is enough',
  );
  assert.deepEqual(assignTaskRequest('', { name: 'backend' }), { ok: false, reason: 'task' });
  assert.deepEqual(assignTaskRequest('task-7', {}), { ok: false, reason: 'owner' });
});

test('nothing in the client writes the board directly', () => {
  // One pipe: the panel queues a sentence, the Lead runs the tool. A direct call
  // would be a second writer, and the day it diverges the board and the Lead
  // disagree about who owns what.
  assert.doesNotMatch(source, /\.createTask\s*\(/, 'a direct createTask call came back');
  assert.doesNotMatch(source, /\.updateTask\s*\(/, 'a direct updateTask call came back');
  assert.doesNotMatch(source, /action:\s*'complete'/, 'something writes the complete action');
  assert.doesNotMatch(source, /taskWriteFace/, 'the write-face probe is back (it would grow a second path)');
  assert.doesNotMatch(source, /topologyOf/, 'the topology probe is back (it only existed for direct writes)');
  const injected = sliceSource('      const injected = (sessionId) => ({', '      });');
  for (const name of ['acceptTask', 'createTask', 'assignTask']) {
    assert.match(injected, new RegExp(`${name}:[\\s\\S]{0,260}queueLeadPrompt\\(ctx, sessionId, request\\.text\\)`), `${name} does not go out through the queue channel`);
  }
});

test('the owner form is recorded per backend, even though the panel never sends it', () => {
  const { reassignPayload } = loadPureBlock();
  const task = { id: 'task-3', revision: 4 };
  const member = { id: 'sess-fe', name: 'frontend' };
  assert.deepEqual(
    reassignPayload('team-service', task, member),
    { taskId: 'task-3', expectedRevision: 4, action: 'reassign', owner: 'frontend' },
    '0.2.1 assigns by member name',
  );
  assert.deepEqual(
    reassignPayload('subagent-tree', task, member),
    { taskId: 'task-3', expectedRevision: 4, action: 'reassign', owner: 'sess-fe' },
    '0.2.2 assigns by child session id',
  );
  assert.equal(reassignPayload('unknown', task, member), null, 'an unknown topology is refused, not guessed');
  assert.equal(reassignPayload('team-service', { id: '' }, member), null, 'a task without an id is refused');
  assert.equal(reassignPayload('subagent-tree', task, { name: 'frontend' }), null, 'no session id means no assignment');
  // …and the request itself never carries that form: it names the human.
  const request = loadPureBlock().assignTaskRequest('task-3', member);
  assert.doesNotMatch(request.text, /sess-fe/, 'a raw session id leaked into a user-facing sentence');
});

test('the drawer falls back honestly instead of inventing data', () => {
  const { drawerFacts, formatDuration } = loadPureBlock();
  const t = (key) => `t:${key}`;
  const empty = drawerFacts({}, t);
  assert.deepEqual(empty.model, { text: 't:drawer.unknown', empty: true }, 'an unread model says so');
  assert.deepEqual(empty.usage, { text: '0', empty: true }, 'zero usage is marked empty');
  assert.deepEqual(empty.task, { text: 't:drawer.none', empty: true }, 'no task says none');
  assert.deepEqual(empty.activity, { text: 't:drawer.unknown', empty: true }, 'no settlement says so');
  assert.deepEqual(empty.events, { text: 't:drawer.eventsNone', empty: true }, 'the event list admits its source is missing');
  const full = drawerFacts(
    { model: 'anthropic::claude::high', usage: 1500, task: '改设置页', measured: true, settledMs: 65000 },
    t,
  );
  assert.deepEqual(full.model, { text: 'anthropic / claude / high', empty: false }, 'the route is split for reading');
  assert.deepEqual(full.usage, { text: '1.5k', empty: false }, 'usage goes through formatTokens');
  assert.deepEqual(full.task, { text: '改设置页', empty: false }, 'the current task is shown verbatim');
  assert.deepEqual(full.activity, { text: 't:drawer.settled 1m', empty: false }, 'settlement is a real duration');
  assert.equal(drawerFacts({ model: '' }, t).model.text, 't:settings.followMain', 'follow-main is not "unknown"');
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(1500), '2s');
  assert.equal(formatDuration(90000), '2m');
  assert.equal(formatDuration(7200000), '2h');
});

test('the drawer opens from the desk, closes on Escape, and returns focus', () => {
  const panel = readOfficeTab();
  assert.match(panel, /onDetails: openDetails/, 'the corridor never receives the details action');
  assert.match(panel, /detailsTrigger\.current = typeof document === 'undefined' \? null : document\.activeElement/, 'the drawer does not remember its trigger');
  assert.match(panel, /node\.focus\(\)/, 'the drawer never returns focus');
  assert.match(panel, /h\(MemberDrawer, \{/, 'the drawer is never rendered');
  const drawer = sliceSource('    function MemberDrawer(', '    /**\n     * One task card.');
  assert.match(drawer, /event\.key === 'Escape'/, 'Escape does not close the drawer');
  assert.match(drawer, /role: 'dialog'/, 'the drawer is not announced as a dialog');
  assert.match(drawer, /'aria-modal': 'true'/, 'the drawer is not modal for assistive tech');
  assert.match(drawer, /drawer\.openChat/, 'the drawer has no way to jump to the session');
  // Read-only: no write control lives in the drawer.
  assert.doesNotMatch(drawer, /createTask|acceptTask|updateTask/, 'the drawer grew a write control');
});

test('writes are a Lead surface only', () => {
  const panel = readOfficeTab();
  assert.match(panel, /const isLead = useSessions\(\(state\) => state\.byId\[sessionId\]\?\.origin !== 'subagent'\)/, 'the lead gate is gone');
  assert.match(panel, /canAccept: isLead && typeof acceptTask === 'function'/, 'acceptance is not gated on the lead');
  assert.match(panel, /canCreate: isLead && typeof createTask === 'function'/, 'creation is not gated on the lead');
  assert.match(panel, /canAssign: isLead && typeof assignTask === 'function'/, 'assignment is not gated on the lead');
  const taskCard = sliceSource('    function TaskCard(', '    function TaskColumn(');
  assert.match(taskCard, /canAccept === true && onAccept !== undefined/, 'the accept button ignores the gate');
});

test('the drawer is a keyboard island: Tab wraps inside it', () => {
  const { focusStep, focusCycle } = loadPureBlock();
  const makeNode = (name) => ({ name, focused: false, focus() { this.focused = true; } });
  const nodes = ['close', 'open-chat', 'third'].map(makeNode);
  // Tab at the last node wraps to the first: without this, focus walks behind
  // the scrim and an aria-modal dialog stops being a dialog.
  assert.equal(focusStep(nodes, nodes[2], false), nodes[0], 'Tab past the last node must wrap to the first');
  assert.equal(focusStep(nodes, nodes[0], false), nodes[1], 'Tab inside the list moves on');
  assert.equal(focusStep(nodes, nodes[0], true), nodes[2], 'Shift+Tab at the first node wraps to the last');
  assert.equal(focusStep(nodes, nodes[2], true), nodes[1], 'Shift+Tab inside the list moves back');
  assert.equal(focusStep(nodes, null, false), nodes[0], 'focus outside the list lands on the first node');
  assert.equal(focusStep(nodes, null, true), nodes[2], 'focus outside the list lands on the last when going back');
  assert.equal(focusStep([], null, false), null, 'an empty panel focuses nothing');
  assert.equal(focusCycle(0, 0, false), -1, 'no nodes means no target');
  assert.equal(focusCycle(3, 99, false), 0, 'an out-of-range index is treated as "past the end"');

  // The handler is on the drawer itself and scopes its list to the drawer.
  const drawer = sliceSource('    function MemberDrawer(', '    /**\n     * One task card.');
  assert.match(drawer, /onKeyDown: trap/, 'the drawer root has no keydown handler');
  assert.match(
    drawer,
    /root\.querySelectorAll\('button:not\(:disabled\), \[tabindex\]:not\(\[tabindex="-1"\]\)'\)/,
    'the trap does not build its focus set from the drawer',
  );
  assert.match(drawer, /focusStep\(nodes, document\.activeElement, event\.shiftKey === true\)/, 'the trap does not use the pure cycle');
  assert.match(drawer, /event\.preventDefault\(\)/, 'Tab is not taken over, so the page still moves focus');
  // Esc closes and focus returns to the desk's info button.
  assert.match(drawer, /event\.key === 'Escape'/, 'Escape no longer closes the drawer');
  const panel = readOfficeTab();
  assert.match(panel, /document\.activeElement/, 'the opener never records the element to return to');
  const desk = sliceSource('    function DeskCard(', '    /** An unfilled workstation');
  assert.match(desk, /className: 'wt-desk-info'/, 'the trigger is no longer the desk info button');
  assert.match(desk, /onDetails\(member\)/, 'the info button does not open the details drawer');
});

test('the empty event row describes the state, not the platform', () => {
  const zh = /'drawer\.eventsNone': '([^']+)'/.exec(source)?.[1] ?? '';
  const en = /'drawer\.eventsNone': '([^']+)'/.exec(source.slice(source.indexOf('const en = {')))?.[1] ?? '';
  assert.match(zh, /暂无|未接入/, 'the zh row must describe "nothing yet", not a verdict about the bridge');
  assert.match(en, /none yet|not wired|no event projection/i, 'the en row lost its "not wired yet" wording');
  assert.doesNotMatch(zh, /这条桥/, 'the copy still claims this bridge has no event stream');
  assert.doesNotMatch(en, /this bridge has no/i, 'the copy still claims this bridge has no event stream');
});
