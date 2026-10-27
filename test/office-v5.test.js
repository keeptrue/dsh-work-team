/**
 * V5: the corridor — movement, handover, plate, road.
 *
 * The corridor is a DOM/animation surface, so nothing in here is pure enough to
 * execute without a browser. These are source pins over the shipped code: they
 * protect the four decisions that are easy to undo by accident —
 *
 *   1. movement only follows a real employee↔employee event (no idle wandering,
 *      no walk for a lead→employee dispatch);
 *   2. a handoff is played at both ends (giver pose + receiver landing) and
 *      degrades to the flash, with no timer queued, when it cannot be seen;
 *   3. the plate is one line: name · dot · status word, never colour alone;
 *   4. the road is one layer for the whole corridor, so it cannot break at a
 *      floor seam or desync while the column scrolls.
 *
 * Behaviour lives in docs/office-ui-v5.md.
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

const CSS = readCss();
const RULES = cssRules(CSS);
const CORRIDOR = sliceSource('    function Corridor(', '    function DockSeat(');
const DESK_CARD = sliceSource('    function DeskCard(', '    /** An unfilled workstation');
const EMPTY_DESK = sliceSource('    function EmptyDesk(', '    /** The walker');
const TASK_DIFF = sliceSource('        const previous = previousTasks.current;', '      }, [tasks, memberByName]);');
const REDUCED = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));

function rule(selector) {
  return RULES.find((entry) => entry.selector === selector);
}

function bodyOf(selector) {
  const found = rule(selector);
  assert.ok(found, `the stylesheet lost the ${selector} rule`);
  return found.body;
}

/** First rule whose selector mentions `fragment` — for multi-selector rules. */
function ruleContaining(fragment) {
  const found = RULES.find((entry) => entry.selector.includes(fragment));
  assert.ok(found, `no rule mentions ${fragment}`);
  return found;
}

// ---------------------------------------------------------------------------
// 1. Movement only follows a real employee↔employee event.
// ---------------------------------------------------------------------------

test('the corridor has no idle wandering left', () => {
  // The whole token is gone, not just its trigger: a leftover duration rule or
  // a dead branch is how the random walk would come back.
  assert.doesNotMatch(source, /ambient/i, 'client.js still mentions ambient movement');
  assert.doesNotMatch(CORRIDOR, /Math\.random/, 'the corridor is random again');
  assert.doesNotMatch(CORRIDOR, /setInterval/, 'the corridor grew a free-running timer');
  assert.doesNotMatch(CORRIDOR, /setTimeout\(tick/, 'the corridor re-arms a self-scheduling timer');
});

test('only handoff and dialogue can start a walk', () => {
  const kinds = new Set([...CORRIDOR.matchAll(/kind: '([a-z]+)'/g)].map((match) => match[1]));
  assert.deepEqual([...kinds].sort(), ['dialogue', 'handoff'], 'the walker gained a third source of movement');
  assert.match(CORRIDOR, /mark\.kind === 'out'/, 'the handoff mark is no longer the trigger');
  assert.match(CORRIDOR, /dialogues !== undefined/, 'the reserved dialogue channel is gone');
  assert.match(CORRIDOR, /walk === null\s*\?\s*null\s*:\s*h\(/, 'the walker is no longer conditional');
});

test('a dispatch never walks: a handoff is only a changed owner of running work', () => {
  // Exactly two occurrences: the definition and the one call site, and that
  // call site is the task diff. Anything else calling it turns an assignment
  // into a fake handover.
  assert.equal(
    (source.match(/flashHandoff\(/g) ?? []).length,
    2,
    'flashHandoff gained a call site; dispatch must not walk',
  );
  assert.match(TASK_DIFF, /before\.ownerName !== task\.ownerName/, 'the owner-change test is gone');
  assert.match(TASK_DIFF, /task\.status === 'in_progress'/, 'a handoff no longer requires running work');
  assert.equal(
    (TASK_DIFF.match(/flashHandoff\(/g) ?? []).length,
    1,
    'the task diff no longer flashes exactly one handoff',
  );
});

test('the dialogue channel is a hook, not a fabricated event', () => {
  // One occurrence = the definition. The day a host projection lands, wiring it
  // is a deliberate act and this pin must be updated with it.
  assert.equal(
    (source.match(/flashDialogue\(/g) ?? []).length,
    1,
    'flashDialogue gained a call site without a host projection behind it',
  );
  assert.match(source, /function flashDialogue\(/, 'the reserved entry point is gone');
  assert.match(source, /function useDialogues\(/, 'the reserved store lost its reader');
});

// ---------------------------------------------------------------------------
// 2. The handover plays at both ends, and degrades to the flash.
// ---------------------------------------------------------------------------

test('the walker carries a sheet and the giver leans into the handover', () => {
  assert.match(
    CORRIDOR,
    /walk\.kind === 'handoff' \? h\('span', \{ className: 'wt-walker-card' \}\) : null/,
    'the sheet sprite is no longer a handoff-only DOM span',
  );
  assert.match(bodyOf('.wt-walker-card'), /width:14px/, 'the sheet sprite lost its size');
  assert.match(
    bodyOf('.wt-walker[data-phase="give"] .wt-walker-card'),
    /animation:wt-card-give 140ms/,
    'the card hand-over no longer fits the 140ms give window',
  );
  assert.match(
    bodyOf('.wt-walker[data-phase="give"] .wt-fig'),
    /animation:wt-fig-give 140ms/,
    'the giver pose no longer fits the 140ms give window',
  );
  // The give window is 140ms (spec §4.2); a longer animation is cut mid-fade by
  // the nod phase, and the nod phase needs the same end pose as a static value.
  assert.match(
    bodyOf('.wt-walker[data-phase="nod"] .wt-fig'),
    /transform:translate\(2px,0\) rotate\(3deg\)/,
    'the nod phase has no static end pose, so the figure snaps upright',
  );
  assert.match(
    bodyOf('.wt-walker[data-phase="nod"] .wt-walker-card, .wt-walker[data-phase="back"] .wt-walker-card'),
    /display:none/,
    'the sheet comes back into the hand after it was handed over',
  );
});

test('the receiver has its own landing: plate flash, card drop, dot pulse, catch', () => {
  assert.match(CORRIDOR, /setReceive\(toIdx\)/, 'the walk no longer starts the receive animation');
  assert.match(CORRIDOR, /receive: receive === i/, 'the receiving desk is no longer addressed');
  assert.match(DESK_CARD, /'data-wt-receive': receive \? 'true' : undefined/, 'the receive attribute is gone');
  assert.match(DESK_CARD, /className: 'wt-desk-gift'/, 'the landing card is gone from the desk');
  assert.match(DESK_CARD, /receive \? h\('span', \{ className: 'wt-desk-gift'/, 'the card is no longer receive-only');

  for (const selector of [
    '.wt-desk[data-wt-receive] .wt-desk-plate',
    '.wt-desk[data-wt-receive] .wt-desk-dot',
    '.wt-desk[data-wt-receive] .wt-fig',
  ]) {
    assert.match(bodyOf(selector), /animation:/, `${selector} lost its one-shot`);
  }
  assert.match(bodyOf('.wt-desk-gift'), /animation:wt-gift-drop/, 'the card no longer drops into the plate');
  // rows=1 leaves an 860ms receive window; a 0.9s one-shot would be cut.
  for (const selector of [
    '.wt-desk[data-wt-receive] .wt-desk-plate',
    '.wt-desk[data-wt-receive] .wt-desk-dot',
  ]) {
    assert.match(bodyOf(selector), /animation:[^;]*\.8s/, `${selector} no longer fits the receive window`);
    assert.doesNotMatch(bodyOf(selector), /animation:[^;]*\.9s/, `${selector} outlived the receive window`);
  }
  // The sheet lands at the plate end nearest the lane, whichever side the desk
  // is on, and its drift follows the same side.
  assert.match(
    bodyOf('.wt-desk[data-side="right"] .wt-desk-gift'),
    /right:auto; left:8px/,
    'the landing sheet sits at the outer end of a right desk, away from the hand',
  );
  assert.match(
    bodyOf('.wt-desk[data-side="left"] .wt-desk-gift'),
    /--wt-gift-dx:6px; --wt-gift-dx-near:1px/,
    'the landing drift no longer follows the desk side',
  );
  // The gift is a sibling of the plate: the plate clips its own overflow.
  assert.doesNotMatch(
    sliceSource(
      "h(\n          'span',\n          { className: 'wt-desk-plate', 'aria-hidden': 'true' },",
      "receive ? h('span'",
    ),
    /wt-desk-gift/,
    'the landing card moved inside the clipping plate',
  );
});

test('an unseen handover degrades to the flash and queues no timer', () => {
  const reduceAt = CORRIDOR.indexOf("prefers-reduced-motion: reduce");
  const walkAt = CORRIDOR.indexOf('runWalk(');
  assert.ok(reduceAt > 0, 'the reduced-motion branch is gone');
  assert.ok(reduceAt < walkAt, 'the reduced-motion check now runs after the walk was scheduled');
  assert.match(
    CORRIDOR,
    /if \(window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\) return;/,
    'reduced motion no longer returns before any timer is queued',
  );

  const offscreenAt = CORRIDOR.indexOf('if (!onScreen(fromNode) || !onScreen(toNode)) continue;');
  assert.ok(offscreenAt > 0 && offscreenAt < walkAt, 'an off-screen walk is scheduled again');
  // The column is content-height: its own rect would call every desk visible.
  assert.match(CORRIDOR, /const panel = scrollParent\(fromNode\)/, 'the viewport is measured on the wrong box');
  assert.match(CORRIDOR, /Math\.min\(window\.innerHeight/, 'the window clip is gone');
  assert.doesNotMatch(
    bodyOf('.wt-corridor'),
    /overflow-y/,
    'the column grew a scroller; an absolutely positioned road would collapse to the viewport',
  );

  assert.match(
    bodyOf('.wt-row[data-wt-handoff]::after, .wt-desk[data-wt-handoff]::after'),
    /animation:wt-flash/,
    'the reduced-motion fallback no longer flashes',
  );
  assert.match(REDUCED, /\.wt-walker, \.wt-desk-gift \{ display:none !important; \}/, 'the walker survives reduced motion');
  assert.match(
    REDUCED,
    /\.wt-desk\[data-wt-receive\] \.wt-desk-plate/,
    'the receive one-shots are not switched off under reduced motion',
  );
});

test('the walker geometry is measured, not assumed', () => {
  assert.doesNotMatch(CORRIDOR, /\* 102/, 'the floor pitch is hardcoded again');
  assert.doesNotMatch(CORRIDOR, /\+ 50\b/, 'the walker offset is hardcoded again');
  assert.match(CORRIDOR, /dy: toBox\.top - fromBox\.top/, 'the travel distance is no longer measured');
  assert.match(
    CORRIDOR,
    /top: fromBox\.bottom - trackBox\.top - WALKER_SIZE/,
    'the walker is no longer anchored to the giver floor in track space',
  );
});

// ---------------------------------------------------------------------------
// 3. The plate is one line: name · dot · status word.
// ---------------------------------------------------------------------------

test('the plate is one row of name, dot, status — never colour alone', () => {
  const plate = bodyOf('.wt-desk-plate');
  assert.match(plate, /flex-direction:row/, 'the plate is stacked again');
  assert.doesNotMatch(plate, /flex-direction:column/, 'the plate is stacked again');
  assert.match(plate, /align-items:center/, 'the plate lost its baseline');
  assert.match(plate, /overflow:hidden/, 'the plate stopped clipping');

  const dot = bodyOf('.wt-desk-dot');
  assert.match(dot, /border-radius:50%/, 'the status dot is not round');
  assert.match(dot, /background:var\(--wt-state\)/, 'the status dot lost the state colour');

  const order =
    /className: 'wt-desk-plate'[\s\S]{0,200}?className: 'wt-desk-name'[\s\S]{0,140}?className: 'wt-desk-dot'[\s\S]{0,140}?className: 'wt-desk-state'[\s\S]{0,60}?statusText/;
  assert.match(DESK_CARD, order, 'the plate order or the status word changed');
  assert.doesNotMatch(DESK_CARD, /const mark =/, 'the handoff arrow is back in the status slot');
  assert.match(
    DESK_CARD,
    /'aria-label': `\$\{display\} · \$\{subline\} · \$\{statusText\}`/,
    'the full reading (name, role, status) left the accessible name',
  );

  // The plate repeats the desk's accessible name, so it is hidden from SR —
  // except on an empty seat, where it is the only carrier of 「说「招」」.
  assert.match(
    DESK_CARD,
    /className: 'wt-desk-plate', 'aria-hidden': 'true'/,
    'the occupied plate is read twice (root label + plate)',
  );
  assert.doesNotMatch(
    EMPTY_DESK,
    /wt-desk-plate', 'aria-hidden'/,
    'the empty plate is hidden, so 「说「招」」 reaches no screen reader',
  );

  // The empty seat keeps the same shape, dimmed: status text still present.
  assert.match(
    EMPTY_DESK,
    /className: 'wt-desk-plate'[\s\S]{0,200}?className: 'wt-desk-name'[\s\S]{0,140}?className: 'wt-desk-dot'[\s\S]{0,140}?className: 'wt-desk-state'/,
    'the empty seat lost the dot or the status text',
  );
});

test('the status word never shrinks; only the name yields', () => {
  // The name is the only segment that may shrink (the status word has
  // flex-shrink 0), and it must NOT grow: a growing name pushes the dot to the
  // plate's right edge, away from the name the user asked it to follow.
  const name = bodyOf('.wt-desk-name');
  assert.doesNotMatch(name, /flex:[^;]*1\s+1/, 'the name grows again, so the dot drifts to the right edge');
  assert.doesNotMatch(name, /flex-grow:\s*[1-9]/, 'the name grows again, so the dot drifts to the right edge');
  assert.match(name, /flex:0 1 auto/, 'the name no longer yields to the status');
  assert.match(name, /text-overflow:ellipsis/, 'a long name can no longer be truncated');

  const state = bodyOf('.wt-desk-state');
  assert.match(state, /flex:0 0 auto/, 'the status word can shrink again');
  assert.match(state, /max-width:70%/, 'the status word lost its long-word ceiling');
  assert.match(state, /overflow:hidden/, 'the status word can be clipped without an ellipsis');
  assert.match(state, /text-overflow:ellipsis/, 'the status word can be clipped without an ellipsis');

  // Nothing may stretch the row either: the three segments stay adjacent.
  for (const selector of ['.wt-desk-plate', '.wt-desk-name', '.wt-desk-state']) {
    const body = bodyOf(selector);
    assert.doesNotMatch(body, /justify-content:space-between/, `${selector} spreads the plate segments apart`);
    assert.doesNotMatch(body, /margin-left:auto/, `${selector} pushes the status to the right edge`);
  }
});

// ---------------------------------------------------------------------------
// 4. One road for the whole corridor.
// ---------------------------------------------------------------------------

test('the road is a single layer over the whole column', () => {
  const track = bodyOf('.wt-road-track');
  assert.match(track, /position:relative/, 'the road track is not a positioning context');
  assert.match(track, /flex:none/, 'the track can shrink and clip the road');
  assert.match(track, /gap:8px/, 'the floor rhythm moved out of the track');
  assert.doesNotMatch(bodyOf('.wt-corridor'), /(?:^|;)\s*gap:/, 'the scroller still owns the gap, so the road cannot span it');

  const road = bodyOf('.wt-road');
  assert.match(road, /top:0; bottom:0;/, 'the road no longer spans the content height');
  assert.match(road, /left:calc\(50% - var\(--wt-lane\) \/ 2\)/, 'the road left the lane centre');
  assert.match(road, /width:var\(--wt-lane\)/, 'the road width is no longer the lane width');
  assert.match(road, /repeating-linear-gradient/, 'the centre line is gone');
  assert.match(
    bodyOf('.wt-road::before, .wt-road::after'),
    /background:var\(--wt-road-cap\)/,
    'the end caps are gone',
  );
  assert.match(bodyOf('.wt-road::before'), /top:2px/, 'the top cap left the end of the road');
  assert.match(bodyOf('.wt-road::after'), /bottom:2px/, 'the bottom cap left the end of the road');

  assert.equal(
    (CORRIDOR.match(/className: 'wt-road'/g) ?? []).length,
    1,
    'the corridor renders more than one road layer',
  );
  assert.match(
    CORRIDOR,
    /className: 'wt-corridor'[\s\S]{0,200}className: 'wt-road-track'[\s\S]{0,400}className: 'wt-road'/,
    'the road is no longer inside the scroller track, so it can scroll out of sync',
  );
});

test('every desk has a branch onto the road', () => {
  assert.match(
    bodyOf('.wt-desk::before'),
    /width:calc\(7px \+ var\(--wt-lane\) \/ 2\)/,
    'the branch no longer reaches the lane centre',
  );
  assert.match(bodyOf('.wt-desk[data-side="left"]::before'), /left:calc\(100% - 1px\)/, 'left desks lost their branch');
  assert.match(bodyOf('.wt-desk[data-side="right"]::before'), /right:calc\(100% - 1px\)/, 'right desks lost their branch');
});

test('the lane switch stays one variable at every width', () => {
  assert.match(
    bodyOf('.wt-floor'),
    /grid-template-columns:1fr var\(--wt-lane\) 1fr/,
    'the floor grid stopped reading the lane variable',
  );
  assert.match(
    CSS,
    /@container \(min-width: 340px\) \{\s*\.wt-corridor \{ --wt-lane:56px; \}/,
    'the 340px lane widening no longer goes through --wt-lane',
  );
  const corridor = bodyOf('.wt-corridor');
  assert.match(corridor, /--wt-lane:46px/, 'the base lane width moved');
});

// ---------------------------------------------------------------------------
// 5. The seat lookup, the clock and the ink weights (spec §1.1, §2.3, §4.2).
// ---------------------------------------------------------------------------

test('a handoff resolves seats by raw identity, not by display label', () => {
  // The map key is member.name (the role id, the same value task.ownerName
  // carries); roleOrFallback(...).zh.name is only the label a reader sees.
  // Mixing them made indexOf.get() undefined, so no walker was ever created.
  assert.match(
    CORRIDOR,
    /indexOf\.set\(item\.member === null \? item\.role\.id : item\.member\.name, i\)/,
    'the seat index went back to display names',
  );
  assert.match(
    CORRIDOR,
    /events\.push\(\{ kind: 'handoff', from: name, to: mark\.peer, at: mark\.at \}\)/,
    'the handoff direction is reversed again (receiver read as the giver)',
  );
  assert.match(
    source,
    /handoffs\.set\(fromName, \{ from: toLabel \?\? toName, peer: toName, kind: 'out', at \}\)/,
    'the out mark lost the peer raw name',
  );
  assert.match(
    source,
    /handoffs\.set\(toName, \{ from: fromLabel \?\? fromName, peer: fromName, kind: 'in', at \}\)/,
    'the in mark lost the peer raw name',
  );
  assert.match(source, /task: taskFor\(role\.id\)/, 'built-in desks ask for a task by label again');
  assert.doesNotMatch(source, /taskFor\(role\.zh\.name\)/, 'built-in desks ask for a task by label again');
});

test('the walk clock is per row, not a fixed 5.4s', () => {
  assert.match(CORRIDOR, /const rows = Math\.abs\(toIdx - fromIdx\)/, 'the distance is no longer counted');
  assert.match(CORRIDOR, /const pick = 420/, 'the stand-up + pick phase is gone');
  assert.match(CORRIDOR, /const walkMs = Math\.min\(2400, 160 \+ rows \* 240\)/, 'the walk no longer scales');
  assert.match(CORRIDOR, /const backMs = Math\.min\(1600, rows \* 200\)/, 'the walk back no longer scales');
  assert.match(CORRIDOR, /const tGive = pick \+ walkMs/, 'give no longer waits for the walk');
  assert.match(CORRIDOR, /const tNod = tGive \+ 140/, 'the landing no longer follows the give');
  assert.match(CORRIDOR, /const tEnd = tBack \+ backMs \+ 180/, 'the walker no longer finishes after the walk back');

  assert.match(CORRIDOR, /'--wt-walk-ms': `\$\{walk\.walkMs\}ms`/, 'the CSS clock is no longer fed');
  assert.match(CORRIDOR, /'--wt-back-ms': `\$\{walk\.backMs\}ms`/, 'the CSS clock is no longer fed');
  assert.match(CORRIDOR, /'--wt-pick-ms': `\$\{walk\.pick\}ms`/, 'the pick delay is no longer fed');
  // Both branches must cross-fade: a conversation ends with the speaker back at
  // their desk, not with a hard cut.
  assert.equal(
    (CORRIDOR.match(/tEnd - 180, \(\) => setAbsent\(-1\)/g) ?? []).length,
    2,
    'one of the two walk kinds lost its cross-fade',
  );
  assert.match(bodyOf('.wt-walker[data-phase="out"]'), /var\(--wt-walk-ms, 400ms\) linear/, 'the walk is not linear');
  assert.match(bodyOf('.wt-walker[data-phase="back"]'), /var\(--wt-back-ms, 200ms\) linear/, 'the walk back is not linear');
  assert.doesNotMatch(CSS, /steps\(24|steps\(18/, 'the stepped walk is back (a jump per row at seven rows)');
});

test('the figure eases back out of the nod pose, and animations still win', () => {
  // nod -> back drops the 3deg pose; without a transform transition that is a
  // hard 3deg snap. Opacity must stay in the list: the giver fades in/out.
  const fig = bodyOf('.wt-fig');
  assert.match(
    fig,
    /transition:opacity \.18s ease-out, transform \.18s ease-out/,
    'the figure lost its transform (or opacity) transition',
  );
  // Animations outrank transitions, so the three pose animations are untouched;
  // this just proves they are still there and still animation-based.
  assert.match(bodyOf('.wt-walker[data-phase="out"] .wt-fig'), /animation:wt-stand/, 'wt-stand is gone');
  assert.match(bodyOf('.wt-walker[data-phase="give"] .wt-fig'), /animation:wt-fig-give/, 'wt-fig-give is gone');
  assert.match(bodyOf('.wt-desk[data-wt-receive] .wt-fig'), /animation:wt-fig-take/, 'wt-fig-take is gone');
  // Reduced motion still kills both properties on the figure.
  assert.match(
    REDUCED,
    /\.wt-desk, \.wt-desk-act, \.wt-fig, \.wt-fig-body \{ animation:none !important; transition:none !important; \}/,
    'the reduced-motion block no longer kills the figure transition',
  );
});

test('the sheet flies toward the receiver side', () => {
  assert.match(
    CORRIDOR,
    /toSide: toIdx % 2 === 0 \? 'left' : 'right'/,
    'the walk no longer records which side the receiver sits on',
  );
  assert.match(CORRIDOR, /'data-to-side': walk\.toSide/, 'the walker no longer carries the receiver side');
  assert.match(bodyOf('.wt-walker[data-to-side="left"]'), /--wt-card-dx:-9px/, 'a left receiver still gets a rightward throw');
  assert.match(
    CSS,
    /@keyframes wt-card-give \{[\s\S]{0,200}?translate\(var\(--wt-card-dx,9px\)/,
    'the hand-over no longer reads the side variable',
  );
});

test('the road is drawn in ink weights, never in colour', () => {
  const corridor = bodyOf('.wt-corridor');
  const weights = [
    ['--wt-road-surface', '5'],
    ['--wt-road-edge', '18'],
    ['--wt-road-line', '32'],
    ['--wt-road-cap', '26'],
    ['--wt-road-stub', '24'],
  ];
  for (const [token, weight] of weights) {
    assert.match(
      corridor,
      new RegExp(`${token}:color-mix\\(in srgb, var\\(--dsw-alias-label-primary\\) ${weight}%`),
      `${token} left its ink weight`,
    );
  }
  // The branch must be one step darker than the curb, or the junction vanishes.
  assert.match(bodyOf('.wt-desk::before'), /background:var\(--wt-road-stub\)/, 'the branch lost its own token');
});

test('every status owns its dot recipe, and idle is not the generic mix', () => {
  // v5.1: the single 60/40 formula flattened every hue into one L* band. Each
  // status class now declares --wt-state itself, so idle (near-white raw) and
  // ready (green-grey) can use their own expressions.
  const statuses = ['idle', 'working', 'provisioning', 'waiting', 'done', 'error', 'failed', 'ready'];
  for (const status of statuses) {
    const light = ruleContaining(`.wt-desk.wt-st-${status}`);
    assert.match(light.body, /--wt-state:\s*[^;]+;/, `the ${status} dot lost its light recipe`);
    // Dark is its own recipe, not a re-mix of the light one.
    const dark = RULES.find(
      (entry) =>
        entry.selector.includes(':is(body[data-ds-dark-theme], html[data-theme="dark"])') &&
        entry.selector.includes(`.wt-desk.wt-st-${status}`),
    );
    assert.ok(dark, `the ${status} dot lost its dark recipe`);
    assert.match(dark.body, /--wt-state:\s*[^;]+;/, `the ${status} dark recipe is empty`);
  }
  // idle stopped sharing the generic formula: it mixes from label-secondary now.
  assert.match(ruleContaining('.wt-desk.wt-st-idle').body, /--dsw-alias-label-secondary/, 'idle is back on a raw colour');
  // ready is built from business + error, which is what keeps it out of done's
  // green (hue gap 177°, ΔE 0.30 in light).
  const ready = ruleContaining('.wt-desk.wt-st-ready').body;
  assert.match(ready, /--dsw-alias-state-business-primary/, 'ready lost its blue anchor');
  assert.match(ready, /--dsw-alias-state-error-primary/, 'ready lost its red anchor');
  assert.doesNotMatch(ready, /success/, 'ready is back on the success green');
  // The desk itself carries only a fallback — no generic formula left behind.
  const desk = bodyOf('.wt-desk');
  assert.doesNotMatch(desk, /--wt-state:color-mix/, 'the generic 60/40 formula is back on the desk');
  assert.match(desk, /--wt-state:var\(--dsw-alias-label-secondary\)/, 'the desk lost its neutral fallback');

  // 8px, and the edge is a surface ring rather than a 28% blur of the hue.
  const dot = bodyOf('.wt-desk-dot');
  assert.match(dot, /width:8px/, 'the dot is not 8px');
  assert.match(dot, /height:8px/, 'the dot is not 8px');
  assert.match(dot, /box-shadow:0 0 0 1\.5px var\(--dsw-alias-bg-layer-1\)/, 'the dot edge is not a surface ring');
  assert.doesNotMatch(dot, /28%/, 'the dot edge is a same-hue blur again');
});

test('the shape channel and the dot animation order survive the new recipes', () => {
  const hollow = ruleContaining('.wt-desk[data-wt-status="failed"] .wt-desk-dot');
  assert.match(hollow.body, /background:transparent/, 'failed/provisioning/absent lost the hollow dot');
  assert.match(hollow.body, /inset 0 0 0 1\.5px var\(--wt-state\)/, 'the hollow ring lost its weight');
  const empty = bodyOf('.wt-desk-empty .wt-desk-dot');
  assert.match(empty, /background:transparent/, 'the empty seat dot is filled again');
  assert.match(empty, /inset 0 0 0 1px color-mix/, 'the empty seat lost its hue-less ring');

  // Source order is the priority: pulse < ping < take.
  const pulseAt = CSS.indexOf('.wt-desk[data-wt-status="waiting"] .wt-desk-dot');
  const pingAt = CSS.indexOf('.wt-desk[data-wt-handoff="out"] .wt-desk-dot');
  const takeAt = CSS.indexOf('.wt-desk[data-wt-receive] .wt-desk-dot');
  assert.ok(pulseAt > 0 && pingAt > pulseAt && takeAt > pingAt, 'the dot animations lost their priority order');

  // The ping must not outlive itself: the mark lives 1600ms, the ping 1200ms,
  // and the giver's dot is hollow by then. A fill would erase its ring.
  assert.doesNotMatch(
    bodyOf('.wt-desk[data-wt-handoff="out"] .wt-desk-dot'),
    /\bboth\b/,
    'the handoff ping keeps a fill, so it erases the hollow dot for 400ms',
  );
});

test('the new corridor rules keep every colour on a token', () => {
  const own = RULES.filter((entry) =>
    /^\.wt-(road|desk::before|desk\[data-wt-receive\]|desk-gift|walker|walker-card)/.test(entry.selector),
  );
  assert.ok(own.length >= 10, 'the V5 corridor rules disappeared');
  for (const entry of own) {
    assert.doesNotMatch(entry.body, /#[0-9a-fA-F]{3,8}\b/, `${entry.selector} uses a hex literal`);
    assert.doesNotMatch(entry.body, /\brgba?\(/, `${entry.selector} uses a raw rgb() colour`);
  }
});
