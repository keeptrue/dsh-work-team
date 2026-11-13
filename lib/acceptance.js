/**
 * The acceptance gate's pure text rules.
 *
 * Two records carry the gate: the review task the Host appends after a
 * `review: true` dispatch row, and the evidence `accept_task` folds into the
 * implementation task before completing it. Both live under the task board's own
 * limits (`subject` ≤ 200, `description` ≤ 16 384 — see the Team service's
 * `requiredText`), so every string built here is bounded instead of handing the
 * board a value it will reject.
 *
 * Nothing here decides *whether* to accept: that is the tool's job, because it
 * needs the board. These functions only spell the text.
 */

/** Roster name of the reviewing employee; also the review task's intended owner. */
export const REVIEWER_NAME = 'reviewer';

/** Prefix every review subject starts with, so the Lead can spot one at a glance. */
export const REVIEW_SUBJECT_PREFIX = '审查：';

/**
 * The `writeScopes` namespace that marks a review task.
 *
 * `writeScopes` is a generated namespace, so no employee can accidentally name a
 * real task under it — which is what makes it a better signal than the subject:
 * a real task may legitimately be called `审查：复核迁移脚本`, and excluding it
 * from the acceptance queue for its wording would silently hide real work.
 *
 * Scopes must also be unique per task: 0.2.1 reports overlapping scopes as a
 * warning, so two review tasks sharing one marker would raise noise on the
 * board. `reviewScopeFor` therefore suffixes the implementation task id, and
 * falls back to a process-unique token when the row has no task id.
 */
export const REVIEW_SCOPE_PREFIX = 'work-team/review/';

/** Process-wide counter for review scopes of rows without a task id. */
let reviewScopeSerial = 0;

/**
 * One review task's marker scope.
 *
 * Unique per review task, always: the implementation id names the association,
 * and a serial keeps two reviews of the same implementation from sharing one
 * scope. Without the serial, 0.2.1 would report the pair as overlapping write
 * scopes — a warning about a collision that is really just paperwork.
 * @param {string} [implTaskId] - the implementation task the review depends on.
 * @returns {string} a unique workspace-relative scope under {@link REVIEW_SCOPE_PREFIX}.
 */
export function reviewScopeFor(implTaskId) {
  const id = typeof implTaskId === 'string' ? implTaskId.trim() : '';
  reviewScopeSerial += 1;
  // Time plus a counter: unique within this process, and still unique across a
  // restart that lands in the same millisecond.
  const serial = `r${Date.now().toString(36)}-${reviewScopeSerial}`;
  return id === '' ? `${REVIEW_SCOPE_PREFIX}${serial}` : `${REVIEW_SCOPE_PREFIX}${id}-${serial}`;
}

/** Characters of the original task a review subject keeps. */
export const REVIEW_SUBJECT_TASK_CHARS = 60;

/** `subject` ceiling enforced by the Team service. */
export const SUBJECT_LIMIT = 200;

/** `description` ceiling enforced by the Team service. */
export const DESCRIPTION_LIMIT = 16_384;

/** Separator between the task description and the appended evidence. */
export const EVIDENCE_MARKER = '\n\n---\n验收证据：\n';

/**
 * Keep the first `limit` code points of one string.
 *
 * Code points, not UTF-16 units: a 60-character cut through a surrogate pair
 * would produce half an emoji, and the board stores what it is given.
 * @param {unknown} text - candidate text.
 * @param {number} limit - maximum code points.
 * @returns {string} the head, or an empty string for a non-string.
 */
export function head(text, limit) {
  if (typeof text !== 'string') return '';
  const chars = Array.from(text);
  return chars.length <= limit ? text : chars.slice(0, limit).join('');
}

/**
 * Whether one evidence value counts as something to verify against.
 *
 * Whitespace is not evidence: the gate refuses on this answer alone, before it
 * touches the board, so an empty call cannot leave a revision behind.
 * @param {unknown} value - raw tool argument.
 * @returns {boolean} true when a trimmed, non-empty string was supplied.
 */
export function hasEvidence(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Whether one board task is review paperwork this plugin filed, rather than work.
 *
 * The `writeScopes` marker is the collision-proof signal: its namespace is
 * generated, so no employee can accidentally name a real task under it. The
 * subject prefix is the legacy fallback for tasks filed before the marker
 * existed — and it is unconditional, which is why a task titled `审查：…` counts
 * as paperwork even when an employee owns it (the README says so).
 * @param {object} task - task view.
 * @returns {boolean} true for a review task.
 */
export function isReviewTask(task) {
  const scopes = Array.isArray(task?.writeScopes) ? task.writeScopes : [];
  if (scopes.some((scope) => typeof scope === 'string' && scope.startsWith(REVIEW_SCOPE_PREFIX))) {
    return true;
  }
  const subject = typeof task?.subject === 'string' ? task.subject : '';
  return subject.startsWith(REVIEW_SUBJECT_PREFIX);
}

/**
 * The tasks waiting for `accept_task`.
 *
 * In-progress, owned by a named member of this roster, and not review paperwork.
 * One rule, one place: `team_status`, `team_handover`, and the office panel
 * (which mirrors this function) all have to agree, and they used to be three
 * hand-written copies.
 * @param {object[]} tasks - board task views.
 * @param {Set<string>} memberNames - roster names.
 * @returns {object[]} the queued tasks, in board order.
 */
export function acceptanceQueue(tasks, memberNames) {
  const names = memberNames instanceof Set ? memberNames : new Set(memberNames ?? []);
  const queue = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (task?.status !== 'in_progress') continue;
    const owner = typeof task.ownerName === 'string' ? task.ownerName : '';
    if (owner === '' || !names.has(owner)) continue;
    if (isReviewTask(task)) continue;
    queue.push(task);
  }
  return queue;
}

/**
 * Build one review task's subject: `审查：<first 60 characters of the task>`.
 * @param {unknown} task - the dispatched task text.
 * @returns {string} bounded, non-empty subject.
 */
export function reviewSubject(task) {
  const text = typeof task === 'string' ? task.trim().replace(/\s+/gu, ' ') : '';
  const body = head(text, REVIEW_SUBJECT_TASK_CHARS);
  return `${REVIEW_SUBJECT_PREFIX}${body === '' ? '(空任务)' : body}`.slice(0, SUBJECT_LIMIT);
}

/**
 * Build one review task's description.
 *
 * It names the implementer, the intended reviewer, the acceptance criteria, and
 * — this is the part that keeps a degraded association honest — whether the row
 * had a board task to depend on. When it did, the caller also sets `blockedBy`;
 * when it did not, this sentence is the only link, so it has to say so plainly.
 *
 * `link` overrides the association sentence when the caller has to restate it —
 * a dependency that could not be attached must not be described on the board as
 * if it had been.
 *
 * @param {{ roleId: string, roleName: string, task: string, acceptance?: string, implTaskId?: string, link?: string }} row - dispatch row identity.
 * @returns {string} bounded description.
 */
export function reviewDescription(row) {
  const acceptance =
    typeof row.acceptance === 'string' && row.acceptance.trim() !== ''
      ? row.acceptance.trim()
      : '（未提供；按派单原文判断）';
  const link =
    typeof row.link === 'string' && row.link !== ''
      ? row.link
      : typeof row.implTaskId === 'string' && row.implTaskId !== ''
        ? `${row.implTaskId}（审查任务以它为前置依赖）`
        : '（无：该行走消息派发，没有独立任务 id，完成后由 lead 把实现任务与审查结论对上）';
  const text = [
    `实现：${row.roleId}（${row.roleName}）`,
    `审查人：${REVIEWER_NAME}`,
    `验收标准：${acceptance}`,
    `关联实现任务：${link}`,
    '',
    '派单原文：',
    typeof row.task === 'string' ? row.task : '',
  ].join('\n');
  return head(text, DESCRIPTION_LIMIT);
}

/**
 * The message sent to the reviewer when the board cannot take a review task.
 *
 * The request must still arrive: a closed board is a state, not a reason to drop
 * a quality gate the Lead asked for.
 * @param {{ subject: string, description: string }} task - the review task that could not be filed.
 * @returns {string} message text.
 */
export function reviewMessage(task) {
  return [
    task.subject,
    '',
    task.description,
    '',
    '（共享任务板当前不可用，这条审查请求改走消息：审查完把结论和证据直接发回 lead。）',
  ].join('\n');
}

/**
 * Append verification evidence to a task description.
 *
 * The evidence is the whole point of the gate, so it is preserved and the
 * pre-existing description is what gets trimmed when the pair would overflow the
 * board's limit. A description that hits the ceiling keeps its head plus a note
 * saying it was cut — silently truncating the task text would be a lie about
 * what was delivered.
 * @param {unknown} description - current task description.
 * @param {string} evidence - already-trimmed, non-empty evidence.
 * @returns {string} bounded description carrying the evidence.
 */
export function evidenceDescription(description, evidence) {
  const base = typeof description === 'string' ? description : '';
  const raw = typeof evidence === 'string' ? evidence.trim() : '';
  const evidenceRoom = DESCRIPTION_LIMIT - EVIDENCE_MARKER.length;
  const kept =
    raw.length <= evidenceRoom ? raw : `${head(raw, evidenceRoom - 12)}\n…（证据过长，已截断）`;
  const suffix = `${EVIDENCE_MARKER}${kept}`;
  const room = DESCRIPTION_LIMIT - suffix.length;
  if (base.length <= room) return `${base}${suffix}`;
  return `${head(base, Math.max(room - 12, 0))}\n…（原描述过长，已截断）${suffix}`;
}

/**
 * Whether this exact evidence is already recorded on the task.
 *
 * The gate is idempotent: a Lead that retries `accept_task` after a transport
 * hiccup must not grow the description (and bump the revision) a second time.
 * The test is the whole recorded block — marker plus the trimmed evidence — so a
 * short string that merely appears somewhere in the task text does not count as
 * "already accepted". Evidence that was truncated on the way in cannot match,
 * and is therefore written again rather than silently dropped.
 * @param {unknown} description - current task description.
 * @param {unknown} evidence - trimmed evidence the caller supplied.
 * @returns {boolean} true when this evidence is already there.
 */
export function hasEvidenceRecorded(description, evidence) {
  if (typeof description !== 'string' || !hasEvidence(evidence)) return false;
  return description.includes(`${EVIDENCE_MARKER}${evidence.trim()}`);
}
