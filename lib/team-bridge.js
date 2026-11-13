/**
 * Dual-topology bridge: the Team service (0.2.1) and the subagent tree (0.2.2).
 *
 * DSH 0.2.2 replaced the flat team membership model with one named subagent
 * tree. `ctx.agentTeams` survives as a *task board only* — `isEnabled`,
 * `setEnabled`, `createTask`, `getTask`, `listTasks`, `updateTask` — and lost
 * `listMembers`, `tryMembership`, `spawnTeammate`, `sendMessage`, `interrupt`,
 * and `waitForChange`. Teammates are now continuable children of the root
 * Agent, reached through `ctx.subagents`.
 *
 * ## Why the probe is not `startActivation`
 *
 * 0.2.1-rc.2 already has `subagents.startActivation`, but it takes a nested
 * spec (`{ provider, signal, request: { parent, prompt, maxDepth, … } }`) and
 * the service has no way to name a tree member: no `rootOf`, no `namesOf`. Only
 * 0.2.2 adds those, and they are exactly what a team roster needs — a member's
 * model-facing name plus the root that owns it. So the probe asks for the
 * *tree* capability, which is the capability this bridge actually depends on;
 * a version string would go stale on the next release and the nested spec would
 * fail loudly at the first hire.
 *
 * Everything that is the same on both versions (the task board) stays in
 * `index.js` and is not wrapped here.
 *
 * @module work-team/team-bridge
 */

/** Backend name the in-process spawn provider registers itself under (dsh-base). */
const SPAWN_PROVIDER = 'spawn';

/**
 * The subagent service, if this composition mounted one.
 * @param {object} ctx - Host context.
 * @returns {object | undefined} the service, or undefined.
 */
function subagentService(ctx) {
  try {
    const service = typeof ctx?.get === 'function' ? ctx.get('subagents') : ctx?.subagents;
    return service ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether this composition exposes the named subagent tree (0.2.2 and later).
 *
 * Probed on the capabilities this module calls, never on a version string: the
 * owner runs 0.2.1 for a while and the two kernels disagree about the shape of
 * `startActivation`, so a name-only probe would pick the wrong spec.
 *
 * @param {object} ctx - Host context.
 * @returns {boolean} true when the tree API is available.
 */
export function usesSubagentTopology(ctx) {
  const service = subagentService(ctx);
  return (
    typeof service?.startActivation === 'function' &&
    typeof service?.rootOf === 'function' &&
    typeof service?.namesOf === 'function'
  );
}

/**
 * Resolve one Agent's place in the team.
 *
 * Shaped like the 0.2.1 `tryMembership()` result — `{ role, name, root }` — so
 * every caller keeps working unchanged:
 * - `lead` is the tree root: the main conversation, never a child and never a
 *   Session the user forked out of an employee (that fork is a new independent
 *   tree root, but it is not the boss of this team).
 * - a `teammate` is any descendant; its name is the slash-separated path, which
 *   equals the role id for the direct children this plugin spawns.
 *
 * @param {object} ctx - Host context.
 * @param {object | undefined} agent - candidate Agent.
 * @returns {{ role: 'lead' | 'teammate', name: string, root: object } | undefined} membership, or undefined.
 */
export function membershipOf(ctx, agent) {
  if (!usesSubagentTopology(ctx)) {
    return ctx.agentTeams.tryMembership(agent);
  }
  if (agent === undefined || agent === null) return undefined;
  const service = subagentService(ctx);
  const root = service.rootOf(agent);
  if (root === undefined || root === null) return undefined;
  const header = agent.session?.header;
  if (root === agent || root.id === agent.id) {
    if (header?.parentSession !== undefined) return undefined;
    return { role: 'lead', name: 'lead', root };
  }
  let names;
  try {
    names = service.namesOf(agent);
  } catch {
    return undefined;
  }
  return { role: 'teammate', name: names?.self ?? agent.id, root };
}

/** @param {object} agents - live Agent registry. @param {string} id - session id. @returns {string} live status. */
function statusOf(agents, id) {
  try {
    return agents.get(id)?.status === 'running' ? 'running' : 'inactive';
  } catch {
    return 'inactive';
  }
}

/**
 * The roster, synchronously — 0.2.1 only.
 *
 * The Lead's temporary-worker guard runs on the synchronous `tools.guard()`
 * plane and needs a count without awaiting, so this path stays as it was. The
 * tree API is asynchronous by nature (it reads catalogs), and the only tool
 * that guard covers — `spawn_teammate` — does not exist there.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - team Lead.
 * @returns {object[]} teammate rows.
 * @throws when the topology is the subagent tree; callers must probe first.
 */
export function listTeammatesSync(ctx, lead) {
  if (usesSubagentTopology(ctx)) {
    throw new Error('listTeammatesSync is only available on the Team-service topology');
  }
  return ctx.agentTeams.listMembers(lead).filter((member) => member.role === 'teammate');
}

/**
 * The team's direct reports, as rows carrying `{ id, name, role, status }`.
 *
 * Direct children only: the office panel, the capacity rule, and `@role`
 * routing all speak about the seven formal roles, so a worker's worker is not a
 * seat. That matches the old `listMembers()` view, which never listed
 * grandchildren either.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - team Lead.
 * @param {AbortSignal} [signal] - caller cancellation, forwarded to catalog reads.
 * @returns {Promise<object[]>} teammate rows.
 */
export async function listTeammates(ctx, lead, signal) {
  if (!usesSubagentTopology(ctx)) return listTeammatesSync(ctx, lead);
  const service = subagentService(ctx);
  const root = service.rootOf(lead);
  const entries = await service.listDescendants(root.id, signal);
  if (!Array.isArray(entries)) return [];
  const rows = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue;
    if (entry.depth !== 1) continue;
    // A diagnostic row reports that branch's descendants could not be read; it
    // is not a member. A one-shot child is not a teammate either.
    if (entry.kind === 'diagnostic') continue;
    if (entry.mode !== 'continuable') continue;
    rows.push({
      id: entry.id,
      name: entry.path ?? entry.id,
      role: 'teammate',
      status: statusOf(ctx.agents, entry.id),
    });
  }
  return rows;
}

/**
 * Resolve one teammate's durable session id by its roster name.
 * @param {object} service - subagent service.
 * @param {object} lead - tree root.
 * @param {string} name - roster name (role id for a direct child).
 * @param {AbortSignal} [signal] - caller cancellation.
 * @returns {Promise<string>} the child session id.
 * @throws when no direct child carries that name.
 */
async function resolveTeammateId(service, lead, name, signal) {
  const root = service.rootOf(lead);
  const entries = await service.listDescendants(root.id, signal);
  const hit = Array.isArray(entries)
    ? entries.find(
        (entry) =>
          entry?.depth === 1 &&
          entry.kind !== 'diagnostic' &&
          entry.mode === 'continuable' &&
          (entry.path ?? entry.id) === name,
      )
    : undefined;
  if (hit === undefined) {
    throw new Error(`No teammate named "${name}" is on this team.`);
  }
  return hit.id;
}

/**
 * Deliver one message to a teammate.
 *
 * The old call addressed a member by name; the tree API addresses a Session id,
 * so the name is resolved against the root's catalog first. Returns the same
 * `{ messageId }` receipt shape the old service handed back.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - sender (the tree root).
 * @param {{ target: string, content: object[], signal?: AbortSignal }} message - target name, content, cancellation.
 * @returns {Promise<{ messageId?: string }>} accepted inbox receipt.
 */
export async function deliverMessage(ctx, lead, message) {
  const { target, content, signal } = message;
  if (!usesSubagentTopology(ctx)) {
    return ctx.agentTeams.sendMessage(lead, { target, content, signal });
  }
  const service = subagentService(ctx);
  const targetId = await resolveTeammateId(service, lead, target, signal);
  const messageId = await service.sendMessage(
    lead,
    targetId,
    content,
    signal === undefined ? {} : { signal },
  );
  return { messageId };
}

/**
 * Hire one teammate as a named continuable child of the Lead.
 *
 * The spec is the 0.2.2 flat shape. `delivery: 'parent'` is what makes a hire a
 * teammate rather than a throwaway worker: the Lead is notified when the child
 * finishes instead of having to poll it.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - the tree root that becomes the parent.
 * @param {{ name: string, description?: string, prompt: object[], signal?: AbortSignal }} spec - hire spec.
 * @returns {Promise<{ member: { id: string, name: string, role: string, status: string } }>} the new roster row.
 */
export async function spawnMember(ctx, lead, spec) {
  const { name, description, prompt, signal } = spec;
  if (!usesSubagentTopology(ctx)) {
    const result = await ctx.agentTeams.spawnTeammate(lead, {
      name,
      description,
      prompt,
      context: 'fresh',
      provider: 'spawn',
      signal,
    });
    return { member: result.member };
  }
  const service = subagentService(ctx);
  const activation = await service.startActivation({
    provider: SPAWN_PROVIDER,
    name,
    label: typeof description === 'string' && description !== '' ? description : name,
    parent: lead,
    prompt,
    signal,
    delivery: 'parent',
  });
  return {
    member: {
      id: activation.childId,
      name: activation.name ?? name,
      role: 'teammate',
      status: 'running',
    },
  };
}
