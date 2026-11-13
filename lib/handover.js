/**
 * The handover brief.
 *
 * A new Lead session is how this team actually changes hands: members are
 * append-only, so "换届" means start a fresh conversation and hand it the facts.
 * That makes this document's only currency **data that exists** — roster rows,
 * board tasks, the health report, the budget block. There is no "recent
 * decisions" section and no summary of progress, because the plugin has no
 * source for either; inventing one would be the exact failure mode a handover is
 * supposed to prevent.
 *
 * Pure: the Host supplies the values and does the writing.
 */

/**
 * Render one line list, or the documented placeholder.
 * @param {string[]} lines - already-rendered lines.
 * @returns {string} one item per line, or `（无）`.
 */
function orNone(lines) {
  return lines.length === 0 ? '（无）' : lines.join('\n');
}

/**
 * One task line: identity, owner, and blockers.
 * @param {object} task - task view.
 * @param {string} [suffix] - extra clause.
 * @returns {string} markdown bullet.
 */
function taskLine(task, suffix = '') {
  const owner = typeof task.ownerName === 'string' && task.ownerName !== '' ? task.ownerName : '（无负责人）';
  const subject = typeof task.subject === 'string' ? task.subject : '';
  return `- \`${task.id}\` ${subject} ← ${owner}${suffix}`;
}

/**
 * Build the handover markdown.
 *
 * @param {{
 *   stamp: string,
 *   roster: object[],
 *   membersError: string,
 *   tasks: object[],
 *   taskBoard: string,
 *   rosterTask: object[],
 *   blocked: { id: string, subject: string, ownerName?: string, openBlockers: string[] }[],
 *   health: object,
 *   budget: object,
 *   benchedRoles: string[],
 *   note: string,
 *   written: boolean,
 *   path: string,
 *   reason: string,
 *   sourceSession: string,
 * }} data - every value comes from the Host report; nothing is derived from guesswork.
 * @returns {string} markdown.
 */
export function buildHandoverMarkdown(data) {
  // The first paragraph has one job: stop the new session from believing the
  // board carried over. A task board is rebuilt from the ROOT SESSION's log, so a
  // new conversation is a new root with an empty log — `team_status` there answers
  // size 0 / tasks 0, and every id below is unknown to it.
  const facts = [
    '> 给接手的新会话：这是一份**数据快照**，不是总结。',
    '> **名单与任务板不随新会话迁移**：任务板是从 root 会话日志重建的，新会话是新 root、空日志，`team_status` 会报 `size 0 / tasks 0`——这是正常的，不是这份简报错了。',
    '> 要延续在办工作只有两条路：① 在**旧会话**里先收尾（该验收的验收掉）再换届；② 在**新会话**按下面的清单用 `team_task_create` 重建任务，再让员工认领。',
    '> 旧 task id 跨会话不可用：`accept_task` 只对当前会话板上的任务有效，别拿旧 id 去验收。',
  ];
  const lead = data.written
    ? facts.join('\n>\n')
    : `> 未落盘，原因：${data.reason === '' ? '未知' : data.reason}。以下内容可以直接贴给新会话。\n>\n${facts.join('\n>\n')}`;
  const members = data.roster.map((member) => {
    const role = typeof member.role === 'string' && member.role !== '' ? member.role : 'Teammate';
    const model = typeof member.model === 'string' && member.model !== '' ? member.model : 'follow-main';
    const bench = member.benched === true ? '｜停职：是' : '｜停职：否';
    const preset = typeof member.preset === 'string' && member.preset !== '' ? `｜权限档：${member.preset}` : '';
    return `- ${member.name}｜${member.displayName}｜${role}｜模型 ${model}${preset}${bench}`;
  });
  const inProgress = data.tasks
    .filter((task) => task.status === 'in_progress')
    .map((task) => taskLine(task));
  const blocked = data.blocked.map((task) =>
    taskLine(task, `（被 ${(task.openBlockers ?? []).join('、')} 挡住）`),
  );
  // Each line has to stand on its own: a reader who jumps straight to the list
  // must not think these ids can be accepted in the new Session, which is exactly
  // what the header says they cannot. The owner is already in the line, so the
  // suffix spends its words on the migration rule instead.
  const queue = data.rosterTask.map((task) =>
    taskLine(task, '（旧板上：需在旧会话验收，或按第 2 步重建后再验收）'),
  );
  const health = data.health;
  const modelErrors = (health.modelErrors ?? []).map((row) => `- ${row.member}：${row.message}`);
  const presetLines =
    health.availablePresets.length === 0
      ? ['- 可用权限档：（这台机器读不到 permissionPresets 名单）']
      : [`- 可用权限档：${health.availablePresets.join(', ')}`];
  const healthNotes = [health.note, health.presetNote].filter((line) => line !== '');
  // A degraded trim is a real capability gap on this machine, so the brief names
  // it the same way `team_status.health.trimmedTools` does.
  const trimmed = (health.trimmedTools ?? []).map(
    (row) => `- 工具面未收满：${row.role} 声明 ${row.requested}，实际 ${row.applied}`,
  );
  const budget = data.budget;
  const lines = [
    `# Work Team 交接简报（${data.stamp}）`,
    '',
    `> 来源：会话 \`${data.sourceSession === '' ? '（未知）' : data.sourceSession}\` 的任务板（${data.taskBoard}）。`,
    '',
    lead,
    '',
    `## 花名册（${data.roster.length} 人）`,
    data.membersError !== '' ? `（花名册读不到：${data.membersError}）` : orNone(members),
    '',
    '## 在办任务（进行中）',
    data.taskBoard === 'on' ? orNone(inProgress) : `（任务板 ${data.taskBoard}，读不到在办任务）`,
    '',
    '## 待验收（等 accept_task）',
    data.taskBoard === 'on' ? orNone(queue) : '（任务板不可用）',
    '',
    '## 被阻塞任务',
    data.taskBoard === 'on' ? orNone(blocked) : '（任务板不可用）',
    '',
    '## 诊断',
    `- 拓扑：${health.topology}`,
    ...presetLines,
    ...(healthNotes.length === 0 ? [] : healthNotes.map((line) => `- ${line}`)),
    ...trimmed,
    `- 模型未生效：${modelErrors.length === 0 ? '（无）' : ''}`,
    ...modelErrors,
    `- 预算：已用 ${budget.used}${budget.limit === 0 ? '（不限）' : ` / 上限 ${budget.limit}`}（${budget.mode}）${budget.unknown > 0 ? `；${budget.note}` : ''}`,
    `- 停职：${data.benchedRoles.length === 0 ? '（无）' : data.benchedRoles.join('、')}`,
    '',
    '## 用户交代',
    data.note !== '' ? data.note : '（无）',
    '',
    '## 怎么用这份简报',
    `1. 在新会话里贴给它，或让它读 \`${data.written ? data.path : '.dsh/work-team/handover.md'}\`。`,
    '2. **先 `team_recover` 看旧板还在不在**：`team_recover({ sessionId: "<上面「来源」那个会话 id>" })` 读得到就按它列出的清单 `team_task_create` 重建（写清验收标准与涉及文件），读不到就直接按上面的「在办任务 / 待验收 / 被阻塞」重建；两条路都要再让员工认领，旧 task id 不要复用，它在新板上不存在。',
    '3. 用 `team_start` 补员（停职角色会被跳过），再按新板接手；停职名单在 `benchRoles` 里，换届时按新班子重配。',
    '4. 关于这份文件：每次调用都会重新生成并**覆盖**同一路径，手写的补充会被冲掉——要留就另存一份。',
  ];
  return lines.join('\n');
}
