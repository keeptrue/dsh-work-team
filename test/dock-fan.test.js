/**
 * V4: the fan (expand layer) and the person card.
 *
 * Both surfaces are portalled to `document.body`, so the parts that can rot
 * silently are lifecycle and focus: a timer that outlives the layer, a close
 * timer that cancels a reopen, a focus ring that ends up on <body>. Nothing in
 * here is pure enough to execute without a DOM, so these are source pins over
 * the shipped code — the behaviour they protect is docs/office-dock-v4.md §5.
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

const DOCK_FACE = sliceSource('    function DockFace(', '    /** One member who has something going on');
const DOCK_FAN = sliceSource('    function DockFan(', "    /**\n     * One member's card.");
const PERSON_CARD = sliceSource('    function PersonCard(', '    function Dock(props) {');
const ESC_LADDER = sliceSource('    function useEscLadder(', '    /**\n     * The expand layer.');
const DOCK = sliceSource('    function Dock(props) {', '    function OfficeAction(props) {');

// ---------------------------------------------------------------------------
// Click semantics (§5.1): the face expands, the card navigates, chips are V3.
// ---------------------------------------------------------------------------

test('a face expands the fan instead of opening the session', () => {
  assert.match(DOCK_FACE, /onClick: \(\) => onOpen\(entry\.member\.id\)/, 'the face no longer calls onOpen');
  assert.doesNotMatch(DOCK_FACE, /openMember/, 'the face went back to opening the chat directly');

  // A one-person team has nothing to fan out: the face opens the card itself.
  assert.match(
    DOCK,
    /const openFromFace = \(id\) => \{\s*if \(members\.length <= 1\) \{\s*openCard\(id\);\s*return;\s*\}\s*openFan\(id\);/,
    'the one-person team lost its direct route to the card',
  );
  // Chips keep the old one-click route (V3), touch included.
  assert.match(DOCK, /const pick = \(id\) => \{[\s\S]{0,200}openMember\(id\);/, 'chips no longer open the session');
});

test('the card keeps a real route back to the session', () => {
  assert.match(PERSON_CARD, /onClick: onOpenChat/, 'the card has no 打开会话 action');
  assert.match(
    PERSON_CARD,
    /'data-kind': 'primary',[\s\S]{0,160}onClick: onOpenChat/,
    '打开会话 is no longer the primary action',
  );
  assert.match(DOCK, /onOpenChat: \(\) => openChatFromCard\(cardEntry\.member\.id\)/);

  const actions = sliceSource('      const openChatFromCard = (id) => {', '      const stopFromCard = (id) => {');
  assert.match(actions, /openMember\(id\);/, 'the card action stopped opening the session');
  assert.match(actions, /closeCard\(\);\s*closeFan\(\);/, 'opening the chat must retire both transient layers');
});

// ---------------------------------------------------------------------------
// Geometry and stacking (§2, §8.2).
// ---------------------------------------------------------------------------

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

test('the layers keep their stacking order and their easing', () => {
  const rules = cssRules(readCss());
  const fan = rules.find((rule) => rule.selector === '.wt-fan' && /position:fixed/.test(rule.body));
  assert.ok(fan, 'the fan rule is gone');
  assert.match(fan.body, /z-index:1100/, 'the fan must sit above the dock and below the card');

  const scrim = rules.find((rule) => rule.selector === '.wt-person-scrim' && /position:fixed/.test(rule.body));
  assert.ok(scrim, 'the card scrim rule is gone');
  assert.match(scrim.body, /z-index:1300/, 'the scrim must sit above the fan');

  const card = rules.find((rule) => rule.selector === '.wt-person' && /position:fixed/.test(rule.body));
  assert.ok(card, 'the card rule is gone');
  assert.match(card.body, /z-index:1301/, 'the card must sit above its scrim');

  const tokens = rules.find(
    (rule) => rule.selector.split(',').map((part) => part.trim()).includes('.wt-fan') && /--wt-ease-out:/.test(rule.body),
  );
  assert.ok(tokens, 'the portal roots lost the easing variables; every transition on them goes invalid');
  assert.match(tokens.body, /--wt-ease-in:/);
  for (const selector of ['.wt-dock', '.wt-person', '.wt-person-scrim']) {
    assert.ok(tokens.selector.includes(selector), `${selector} no longer receives the easing variables`);
  }
});

test('the V4 rules keep every colour on a token', () => {
  const rules = cssRules(readCss()).filter((rule) => /\.wt-fan|\.wt-person/.test(rule.selector));
  assert.ok(rules.length > 10, 'the fan/card rules disappeared');
  for (const rule of rules) {
    assert.doesNotMatch(rule.body, /#[0-9a-fA-F]{3,8}\b/, `${rule.selector} uses a hex literal`);
    assert.doesNotMatch(rule.body, /\brgba?\(/, `${rule.selector} uses a raw rgb() colour`);
  }
});

// ---------------------------------------------------------------------------
// Lifecycle (§3): timers, frames, listeners and observers.
// ---------------------------------------------------------------------------

test('an exit timer cannot cancel a layer that was reopened', () => {
  const closeFan = sliceSource('      const closeFan = useCallback(() => {', '      const openCard = useCallback(');
  assert.match(
    closeFan,
    /after\(FAN_EXIT_MS, \(\) =>\s*setFan\(\(current\) => \(current === null \|\| current\.state !== 'closing' \? current : null\)\)/,
    'the fan close timer no longer checks the state it is about to unmount',
  );

  const closeCard = sliceSource('      const closeCard = useCallback(() => {', '      const focusFacepile = useCallback(');
  assert.match(
    closeCard,
    /after\(sheet \? SHEET_EXIT_MS : CARD_EXIT_MS, \(\) =>\s*setCard\(\(current\) => \(current === null \|\| current\.state !== 'closing' \? current : null\)\)/,
    'the card close timer no longer checks the state it is about to unmount',
  );

  const openFan = sliceSource('      const openFan = useCallback(', '      const closeFan = useCallback(');
  assert.match(openFan, /state: 'opening'/, 'a reopen must install a fresh opening state');
  assert.match(
    openFan,
    /order: rankedRef\.current\.map\(\(entry\) => entry\.member\.id\)/,
    'the seat order is no longer frozen at open time',
  );
});

test('every portal effect takes its handles with it', () => {
  assert.match(
    DOCK,
    /for \(const id of exitTimers\.current\) clearTimeout\(id\);\s*exitTimers\.current\.clear\(\);/,
    'the exit timers outlive the dock',
  );
  assert.equal(
    (DOCK.match(/cancelAnimationFrame\(frame\)/g) ?? []).length,
    2,
    'both layers must cancel their flip frame',
  );
  assert.equal((DOCK.match(/clearTimeout\(timer\);/g) ?? []).length >= 2, true, 'a flip fallback timer is not cleared');
  assert.match(ESC_LADDER, /return \(\) => document\.removeEventListener\('keydown', onKeyDown, true\);/);
  assert.match(DOCK, /document\.removeEventListener\('pointerdown', onPointerDown, true\)/);
  assert.match(
    DOCK,
    /window\.removeEventListener\('resize', remeasure\);\s*observer\?\.disconnect\(\);/,
    'the resize observer is never disconnected',
  );
});

test('the layer mounts closed and flips to open on the next frame', () => {
  const flip = sliceSource(
    '      // The exit transition only runs if the node is painted closed first',
    "      useEffect(() => {\n        if (card === null || card.state !== 'opening') return undefined;",
  );
  assert.match(flip, /if \(fan === null \|\| fan\.state !== 'opening'\) return undefined;/, 'the flip must be a one-shot');
  assert.match(flip, /const frame = requestAnimationFrame\(flip\);/);
  assert.match(flip, /const timer = setTimeout\(flip, 34\);/, 'a starved rAF would leave the layer invisible and unfocusable');
  assert.match(flip, /current\.state !== 'opening' \? current : \{ \.\.\.current, state: 'open' \}/);
});

// ---------------------------------------------------------------------------
// Focus and Esc (§5.3 - §5.5).
// ---------------------------------------------------------------------------

test('Esc closes one layer and leaves the rest of the ladder to the host', () => {
  assert.match(ESC_LADDER, /if \(event\.key !== 'Escape'\) return;/);
  assert.match(ESC_LADDER, /if \(!open\) return undefined;/, 'the listener must only exist while a layer is open');
  const decided = ESC_LADDER.indexOf('if (onEscape() !== true) return;');
  const consumed = ESC_LADDER.indexOf('event.preventDefault()');
  assert.ok(decided > 0, 'the ladder no longer reports whether it closed something');
  assert.ok(decided < consumed, 'Esc is consumed even when nothing was closed');
  assert.match(ESC_LADDER, /event\.stopPropagation\(\)/);
  assert.match(ESC_LADDER, /document\.addEventListener\('keydown', onKeyDown, true\)/);

  const escape = sliceSource('      const escape = useCallback(() => {', '      useEscLadder(');
  assert.match(escape, /if \(card !== null\) \{\s*closeCard\(\);\s*return true;/, 'the card must close before the fan');
  assert.match(escape, /if \(fan !== null\) \{\s*closeFan\(\);\s*return true;/);
  assert.match(DOCK, /useEscLadder\(fan !== null \|\| card !== null, escape\)/);
});

test('focus lands on the seat the fan was opened from', () => {
  const focus = sliceSource(
    '      // Focus lands after `open`',
    "      useEffect(() => {\n        if (card === null || card.state !== 'open') return;",
  );
  assert.match(focus, /if \(fan === null \|\| fan\.state !== 'open'\) return;/, 'focus must wait for the open state');
  assert.match(
    focus,
    /seats\.find\(\(node\) => node\.getAttribute\('data-wt-seat'\) === fan\.seedId\) \?\? seats\[0\]/,
    'a keyboard-opened fan must fall back to the first seat',
  );
  assert.match(focus, /target\?\.focus\?\.\(\)/);
});

test('the seat ring wraps in both directions', () => {
  assert.match(DOCK_FAN, /const FAN_KEYS = new Set\(\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]\)|FAN_KEYS\.has\(event\.key\)/);
  assert.match(DOCK_FAN, /current <= 0 \? nodes\.length - 1 : current - 1/, 'ArrowLeft no longer wraps to the last seat');
  assert.match(
    DOCK_FAN,
    /current < 0 \|\| current === nodes\.length - 1 \? 0 : current \+ 1/,
    'ArrowRight no longer wraps to the first seat',
  );
  assert.match(DOCK_FAN, /event\.key === 'Home'\) next = 0/);
  assert.match(DOCK_FAN, /event\.key === 'End'\) next = nodes\.length - 1/);
  assert.match(DOCK_FAN, /event\.preventDefault\(\);\s*nodes\[next\]\?\.focus\?\.\(\);/);
});

test('the card trap walks only buttons that are really there', () => {
  assert.match(PERSON_CARD, /root\.querySelectorAll\('button:not\(:disabled\)'\)/, 'a disabled 暂停 must stay out of the ring');
  assert.match(PERSON_CARD, /if \(nodes\.length === 0\) \{\s*event\.preventDefault\(\);\s*return;/, 'a one-button card must not cycle to the container');
  assert.match(PERSON_CARD, /if \(event\.shiftKey\) \{/);
  assert.match(PERSON_CARD, /disabled: !stoppable/);
});

test('the card is a labelled modal and the face reports what it expands', () => {
  assert.match(PERSON_CARD, /role: 'dialog'/);
  assert.match(PERSON_CARD, /'aria-modal': 'true'/);
  assert.match(PERSON_CARD, /'aria-label': fillCopy\(t\('dock\.cardAria'\), \{ name \}\)/);
  assert.match(PERSON_CARD, /tabIndex: -1/);
  assert.match(DOCK_FACE, /'aria-expanded': expanded === undefined \? undefined : expanded \? 'true' : 'false'/);
  assert.match(DOCK_FACE, /'aria-controls': expanded === undefined \? undefined : 'wt-fan'/);
  assert.match(DOCK_FAN, /id: 'wt-fan'/);
  assert.match(DOCK_FAN, /role: 'group'/);
  assert.match(DOCK_FAN, /'data-state': state/);
});

test('an outside click dismisses the layers without eating a portal surface', () => {
  const handler = sliceSource(
    '        const onPointerDown = (event) => {\n          if (!(event.target instanceof Element)) return;',
    "        document.addEventListener('pointerdown', onPointerDown, true);",
  );
  assert.match(
    handler,
    /if \(event\.target\.closest\('\[data-wt-fan\], \[data-wt-person\], \[data-wt-person-scrim\]'\)\) return;/,
    'the guard that keeps a seat click from closing the fan before it can open the card is gone',
  );
  const guard = handler.indexOf('closest(');
  const close = handler.indexOf('closeFan()');
  assert.ok(guard > 0 && guard < close, 'the portal guard must run before the close');
  assert.match(handler, /lastCardSeat\.current = null/, 'closing both layers must not hand focus to a seat on its way out');
  assert.match(handler, /if \(fan !== null \|\| card !== null\) \{/);
});

// ---------------------------------------------------------------------------
// The data the card shows (§4).
// ---------------------------------------------------------------------------

test('the card reads the model the poller actually saw', () => {
  const settle = sliceSource('      function settle(id, timing, values) {', '      function fail(id, reason) {');
  assert.match(settle, /const model = selectionValue\(values\?\.modelSelection\?\.next\);/, 'the poller stopped reading modelSelection');
  assert.match(settle, /^\s+model,$/m, 'the reading is not kept on the runtime entry');

  const fail = sliceSource('      function fail(id, reason) {', '      function forget(id) {');
  assert.match(fail, /model: previous\?\.model/, 'a failed read must not drop the last known model');

  assert.match(PERSON_CARD, /const model = memberRuntime\.runtimeOf\(member\.id\)\?\.model;/);
  assert.match(PERSON_CARD, /if \(model !== undefined\) facts\.push\(\[t\('dock\.cardModel'\), modelText\]\);/);
});

test('the fan never renders more seats than the team cap', () => {
  assert.match(DOCK, /\.slice\(0, MAX_TEAM_SIZE - 1\)/, 'the fan must leave room for the +N seat');
  assert.match(DOCK, /const fanHidden = fan === null \? 0 : Math\.max\(0, fan\.order\.length - fanIds\.length\);/);
  assert.match(DOCK_FAN, /more === 0\s*\? null\s*:/, 'the +N seat is unconditional');
});

// ---------------------------------------------------------------------------
// Copy: every new key exists twice (§4, §7).
// ---------------------------------------------------------------------------

function readLocaleBlock(marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `client.js no longer declares ${marker}`);
  const end = source.indexOf('\n    };', start);
  assert.ok(end > start, `the ${marker} dictionary is not terminated as expected`);
  return source.slice(start, end);
}

/** Read one value out of a locale block; both quote styles are used. */
function localeValue(block, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`'${escaped}':\\s*(?:'([^']*)'|"([^"]*)")`).exec(block);
  if (match === null) return undefined;
  return match[1] ?? match[2];
}

const DOCK_KEYS = [
  'dock.title',
  'dock.expand',
  'dock.count',
  'dock.chipAria',
  'dock.chipAriaTask',
  'dock.moreAria',
  'dock.fanAria',
  'dock.cardAria',
  'dock.closeCard',
  'dock.cardTask',
  'dock.cardModel',
  'dock.cardUsage',
  'dock.cardFailed',
  'dock.dispatchTo',
  'dock.openCard',
];

test('every fan and card string exists in both dictionaries', () => {
  const zh = readLocaleBlock('const zh = {');
  const en = readLocaleBlock('const en = {');
  for (const key of DOCK_KEYS) {
    for (const [name, block] of [
      ['zh', zh],
      ['en', en],
    ]) {
      const value = localeValue(block, key);
      assert.ok(value !== undefined, `${name} is missing ${key}`);
      assert.ok(value.trim() !== '', `${name} has an empty ${key}`);
    }
  }
  assert.match(zh, /'dock\.cardFailed':\s*'[^']+'/, 'the failed-seat note is gone');
});

// ---------------------------------------------------------------------------
// Focus hand-off: a closing layer may restore focus only when it would
// otherwise be lost. Clicking into the composer is the case that regressed.
// ---------------------------------------------------------------------------

const FOCUS_WAS_OURS = sliceSource(
  '    function focusWasOurs() {',
  '    /**\n     * Esc closes exactly one layer per press',
);

test('the focus guard only restores focus that would otherwise be lost', () => {
  const factory = new Function('document', `${FOCUS_WAS_OURS}\nreturn focusWasOurs;`);
  const body = { tagName: 'BODY' };
  const run = (activeElement) => factory({ activeElement, body })();
  const inside = (zone) => ({
    closest: (selector) => (selector === '[data-wt-fan], [data-wt-person]' ? { zone } : null),
  });
  const outside = { closest: () => null };
  const cases = [
    ['no active element at all', null, true],
    ['focus already on body', body, true],
    ['Esc left focus on a fan seat', inside('fan'), true],
    ['Esc left focus on the card', inside('card'), true],
    ['the caret sits in the composer', outside, false],
    ['focus moved to a sidebar button', outside, false],
  ];
  for (const [label, activeElement, expected] of cases) {
    assert.equal(run(activeElement), expected, label);
  }
});

test('both layers ask the guard before they move focus', () => {
  const cardRestore = sliceSource(
    '      // Closing the card hands focus back',
    '      useEffect(() => {\n        if (fan !== null) {',
  );
  const clear = cardRestore.indexOf('lastCardSeat.current = null');
  const guard = cardRestore.indexOf('if (!focusWasOurs()) return;');
  const lookup = cardRestore.indexOf('querySelectorAll');
  assert.ok(guard > 0, 'the card restore no longer checks who owns focus');
  assert.ok(clear > 0 && clear < guard, 'the id must be cleared before the guard can bail out');
  assert.ok(guard < lookup, 'the guard must run before the seat lookup');

  const fanRestore = sliceSource(
    '      useEffect(() => {\n        if (fan !== null) {',
    '      const escape = useCallback(',
  );
  assert.match(
    fanRestore,
    /fanWasOpen\.current = false;[\s\S]{0,200}if \(!focusWasOurs\(\)\) return;[\s\S]{0,80}focusFacepile\(\);/,
    'the fan unmount no longer checks who owns focus',
  );
});

test('both card actions clear the seat before closing the card', () => {
  const actions = sliceSource('      const openChatFromCard = (id) => {', '      const stopFromCard = (id) => {');
  for (const name of ['openChatFromCard', 'dispatchFromCard']) {
    const start = actions.indexOf(`const ${name}`);
    assert.ok(start > 0, `${name} is gone`);
    const end = name === 'openChatFromCard' ? actions.indexOf('const dispatchFromCard') : actions.length;
    const block = actions.slice(start, end);
    const clear = block.indexOf('lastCardSeat.current = null');
    const close = block.indexOf('closeCard()');
    assert.ok(clear > 0, `${name} no longer clears lastCardSeat`);
    assert.ok(close > 0 && clear < close, `${name} must clear lastCardSeat before closeCard()`);
  }
});

// ---------------------------------------------------------------------------
// The P3 cleanups, pinned so they do not drift back.
// ---------------------------------------------------------------------------

test('the committed rows are written from an effect, not from render', () => {
  assert.match(
    DOCK,
    /useEffect\(\(\) => \{\s*rankedRef\.current = ranked;\s*\}\);/,
    'the ref is no longer refreshed after commit',
  );
  assert.doesNotMatch(DOCK, /^      rankedRef\.current = ranked;$/m, 'the ref is written during render again');
});

test('selectionValue tells "unknown" apart from "follows main"', () => {
  const fn = sliceSource(
    '      function selectionValue(selection) {',
    '      /** Accept either the Remote envelope or a bare value. */',
  );
  const selectionValue = new Function(`${fn}\nreturn selectionValue;`)();
  assert.equal(selectionValue(undefined), undefined, 'a missing projection must stay unknown');
  assert.equal(selectionValue(null), '', 'a null selection means the session follows main');
  assert.equal(selectionValue({ provider: 'p', model: 'm' }), 'p::m');
  assert.equal(selectionValue({ provider: 'p', model: 'm', reasoningEffort: 'high' }), 'p::m::high');

  // The call that feeds it, and the card's guard, must stay as they are.
  assert.match(
    sliceSource('      function settle(id, timing, values) {', '      function fail(id, reason) {'),
    /const model = selectionValue\(values\?\.modelSelection\?\.next\);/,
    'the poller no longer passes the projection through',
  );
  assert.match(
    source,
    /\/\*\* Accept either the Remote envelope or a bare value\. \*\/\s*function unwrap\(result\)/,
    'the unwrap doc comment drifted again',
  );
});

test('a one-person team does not announce a fan it cannot open', () => {
  assert.match(DOCK, /const singleSeat = members\.length <= 1;/, 'the single-seat flag is gone');
  assert.match(
    DOCK,
    /expanded: singleSeat \? undefined : fan !== null/,
    'the lone face still claims aria-expanded for a fan that cannot exist',
  );
  assert.match(
    DOCK,
    /if \(singleSeat\) return fillCopy\(t\('dock\.openCard'\), \{ name: entry\.role\.zh\.name \}\)/,
    'the lone face no longer says what the click actually does',
  );
  assert.ok(DOCK_KEYS.includes('dock.openCard'), 'dock.openCard is not covered by the locale pin');
});

test('a one-seat card hands focus to the pile before it closes', () => {
  const block = sliceSource('      const openChatFromCard = (id) => {', '      const dispatchFromCard = (id) => {');
  const hadFan = block.indexOf('const hadFan = fan !== null;');
  const closeCard = block.indexOf('closeCard()');
  const closeFan = block.indexOf('closeFan()');
  const openMember = block.indexOf('openMember(id)');
  const restore = block.indexOf('if (!hadFan) focusFacepile();');

  assert.ok(hadFan > 0, 'the single-seat branch lost its "was there a fan" reading');
  assert.ok(hadFan < closeCard, 'hadFan must be read before the card starts closing');
  assert.ok(
    hadFan < closeFan,
    'hadFan must be read before closeFan(): once the fan is closing the branch never runs',
  );
  assert.ok(restore > 0, 'the one-seat path no longer restores focus');
  assert.ok(openMember > 0 && openMember < restore, 'the session must open before focus moves');
  assert.ok(restore > closeFan, 'the restore must run after both layers start closing');
  assert.match(block, /closeCard\(\);\s*closeFan\(\);/, 'the two closes must stay adjacent');
});
