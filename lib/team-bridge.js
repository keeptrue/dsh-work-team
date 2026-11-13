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
 * `index.js` and is not wrapped here — except for the one thing that is not the
 * same: 0.2.2 gates the board behind a per-Session switch (see `ensureTeamBoard`).
 *
 * @module work-team/team-bridge
 */

/** Backend name the in-process spawn provider registers itself under (dsh-base). */
const SPAWN_PROVIDER = 'spawn';

/** The model-facing name of a tree root, as `namesOf()` reports it. */
const ROOT_AGENT_NAME = 'lead';

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
 * Whether this kernel owns a per-Session switch for the task board.
 *
 * 0.2.2 made Team mode a Session selection: the service ships with
 * `defaultEnabled: false`, so a new Session starts with collaboration off and
 * every board read or write throws `TEAM_DISABLED` until the root's Session log
 * carries a `team/mode` event. `isEnabled`/`setEnabled` are that switch, and
 * only the owner of the switch can turn the board on. 0.2.1 has neither method
 * and no gate at all, which is why both halves are probed together: a kernel
 * with `isEnabled` but no `setEnabled` could be asked about the board and then
 * have no way to open it.
 *
 * @param {object} ctx - Host context.
 * @returns {boolean} true when the board needs — and can be given — the switch.
 */
export function boardSupported(ctx) {
  return (
    typeof ctx?.agentTeams?.isEnabled === 'function' &&
    typeof ctx?.agentTeams?.setEnabled === 'function'
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
  // A teammate is a catalogued child of the root, never a user fork of one.
  // The 0.2.1 service decided this with its journal plus a `subagent/descriptor`
  // read; the tree API hands us the same two facts more cheaply, so the check is
  // symmetric with the lead branch above: a member always has a durable parent,
  // and that parent is the root itself (teammates are direct children — a
  // worker's worker is not a seat).
  if (header?.parentSession === undefined) return undefined;
  if (header.parentSession !== root.id) return undefined;
  let names;
  try {
    names = service.namesOf(agent);
  } catch {
    return undefined;
  }
  // `self` is `lead` only for the root. A fork whose tree resolution landed on
  // the original root would report exactly that, and it is not a teammate.
  if (typeof names?.self !== 'string' || names.self === '' || names.self === 'lead') return undefined;
  return { role: 'teammate', name: names.self, root };
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
 * The roster size, synchronously, on either topology.
 *
 * `tools.guard()` is a synchronous contract in both kernels (`const denial =
 * guard(exec)`), so the tree topology cannot await `listDescendants` here. It
 * counts live direct children instead: every teammate is one, and a one-shot
 * worker is disposed when it settles, so a slot is held only while that worker
 * actually runs. On the Team topology this stays the exact roster length.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - team Lead.
 * @param {object[]} liveChildren - the Lead's live direct subagent children.
 * @returns {number} occupied seats.
 */
export function seatCount(ctx, lead, liveChildren) {
  if (usesSubagentTopology(ctx)) return liveChildren.length;
  return listTeammatesSync(ctx, lead).length;
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
 * so the name is resolved against the root's catalog first — except for `lead`,
 * which names the root itself and is addressed directly. Returns the same
 * `{ messageId }` receipt shape the old service handed back.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - sender: the tree root, or a member delivering to `lead`.
 * @param {{ target: string, content: object[], signal?: AbortSignal }} message - target name, content, cancellation.
 * @returns {Promise<{ messageId?: string }>} accepted inbox receipt.
 */
export async function deliverMessage(ctx, lead, message) {
  const { target, content, signal } = message;
  if (!usesSubagentTopology(ctx)) {
    return ctx.agentTeams.sendMessage(lead, { target, content, signal });
  }
  const service = subagentService(ctx);
  // The root answers to `lead` but is nobody's descendant, so the name lookup
  // below cannot find it. The tree service still accepts the root as a target
  // (`deliverToMember` branches on `childId === root.id`), but it refuses a
  // self-addressed send, so the caller has to be a member — which is exactly
  // what an employee filing a hiring request is.
  if (target === ROOT_AGENT_NAME) {
    let root;
    try {
      root = service.rootOf(lead);
    } catch (error) {
      // `rootOf` refuses an Agent it cannot place in a live tree
      // (SubagentError, UNAUTHORIZED). A hiring request that cannot reach the
      // Lead has to say that in words a model can act on, not leak the tree
      // service's error vocabulary into the turn.
      throw new Error(
        `Cannot deliver to the Lead: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (root === undefined || root === null) {
      throw new Error('Cannot deliver to the Lead: this tree has no live root.');
    }
    if (root === lead) {
      throw new Error('Cannot deliver to the Lead from the Lead: the root has no inbox of its own.');
    }
    const messageId = await service.sendMessage(lead, root.id, content, {
      signal: signal ?? new AbortController().signal,
    });
    return { messageId };
  }
  const targetId = await resolveTeammateId(service, lead, target, signal);
  // `options.signal` is required by the tree service — it opens with
  // `options.signal.throwIfAborted()`, so an absent signal throws instead of
  // defaulting. A call site without cancellation still needs a live signal.
  const messageId = await service.sendMessage(lead, targetId, content, {
    signal: signal ?? new AbortController().signal,
  });
  return { messageId };
}

/**
 * The Session that owns this team's board.
 *
 * On the tree topology that is the root: the board lives in the root's Session
 * log, and only the root may move the switch. On 0.2.1 there is no tree, so the
 * Lead's own Session is the board's home.
 *
 * @param {object} ctx - Host context.
 * @param {object | undefined} lead - team Lead.
 * @returns {object | undefined} the root Agent, or undefined when it cannot be resolved.
 */
function boardRoot(ctx, lead) {
  if (lead === undefined || lead === null) return undefined;
  if (!usesSubagentTopology(ctx)) return lead;
  try {
    return subagentService(ctx)?.rootOf(lead) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Make sure the team's task board is usable for this Session.
 *
 * Every board read and write in 0.2.2 throws `TEAM_DISABLED` until the root's
 * Session selection says Team mode is on, and the selection starts unset. So the
 * first board touch of a Session — a status read, a hire request, a formation
 * run — opens it here, once, and is idempotent from then on: an already-enabled
 * tree is reported without appending an event.
 *
 * A saved `false` is never overwritten. `enabled === undefined` means "never
 * chosen", but `false` is the user's own answer in the Team switch, and a plugin
 * that flips it back would be fighting the person it works for. That case is
 * reported as `off` so the caller can say which switch to turn on instead of
 * failing.
 *
 * Never throws: this runs inside tool execution, where a missing switch must
 * degrade one report or one hire request, not end the turn.
 *
 * @param {object} ctx - Host context.
 * @param {object} lead - team Lead (any member; the root is resolved here).
 * @returns {Promise<{ state: 'on' | 'off' | 'unavailable' | 'unsupported', reason?: string }>}
 *   `on` board usable, `off` the user closed it, `unavailable` the switch failed,
 *   `unsupported` this kernel has no switch and no gate.
 */
export async function ensureTeamBoard(ctx, lead) {
  if (!boardSupported(ctx)) return { state: 'unsupported' };
  const root = boardRoot(ctx, lead);
  if (root === undefined) {
    return { state: 'unavailable', reason: 'the Lead has no live Session to open the board on' };
  }
  const team = ctx.agentTeams;
  let open = false;
  try {
    open = team.isEnabled(root) === true;
  } catch {
    // An unreadable switch is treated as closed: the setEnabled below is the
    // only way to know, and it reports its own failure.
    open = false;
  }
  if (open) return { state: 'on' };
  let saved;
  try {
    // `sessionProjections.stateOf(session, key)` is marked deprecated by the
    // kernel (one warning per key per process, and it materializes every
    // registered projection). It is still the only reader a plugin has: the
    // service exposes no handle for a projection it does not own, and
    // `isEnabled` collapses "never chosen" and "chosen off" into the same false
    // — the one distinction this whole function exists to make. `index.js`
    // already reads `modelSelection` and `tokenUsage` the same way.
    saved = ctx.sessionProjections?.stateOf(root.session, 'agentTeam')?.enabled;
  } catch (error) {
    // A failed read is NOT "never chosen". Treating the two the same is how a
    // user's own `false` got silently flipped back on: the catch answered
    // `undefined`, `undefined` meant "open it", and the switch was rewritten
    // against the contract this function documents three paragraphs up. So a
    // read failure stops here and says so; only a successful read of `undefined`
    // may open the board.
    return {
      state: 'unavailable',
      reason: `cannot read the Team switch: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (saved === false) {
    return { state: 'off', reason: 'Agent Teams is switched off for this Session' };
  }
  try {
    await team.setEnabled(root, true);
    return { state: 'on' };
  } catch (error) {
    return {
      state: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
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
