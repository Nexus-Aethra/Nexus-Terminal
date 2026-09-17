/**
 * dshell-workspace host face — design decision 4.7.
 *
 * Two things live here:
 *
 * 1. The `workspaceRegistry` stand-in. The stock web-app `workspace` row is
 *    disabled, and session-controller's inject would stay pending forever
 *    without a same-key service. The registry is not simulated: `get()`
 *    always misses and `list()` is always empty, which is the honest
 *    projection of a shell that has no workspaces. dshell session creation
 *    never passes a workspaceId (sessions are created by cwd, design 4.7),
 *    so the rejection paths stay cold in normal operation.
 * 2. The archive set itself, and the history purge behind the sidebar's
 *    delete action. dsh keeps its archive set on the workspace registry —
 *    `archivedSessionIds` plus `archiveSession`/`unarchiveSession` — so the
 *    registry above serves that half for real while its workspace half stays
 *    the honest projection of a shell without workspaces. The stock
 *    `workspace-controller` row is ENABLED and drives it: it is what turns
 *    those calls into the remote commands the client's `workspaces` service
 *    and the stock archived-session settings page are written against. dshell
 *    therefore owns the STORE (`$DSH_HOME/dshell/tags.json`) and nothing else
 *    — no archive UI, no archive route.
 *
 *    A purge that could not run yet (the session was still loaded) is drained
 *    here at load, before any session can be resumed.
 *
 * The archive set is read through `SessionTagStore`'s in-memory copy because
 * the registry's contract is SYNCHRONOUS: `archivedSessionIds` is a getter, and
 * `WorkspaceFeed` reads it while the controller activates. The document is
 * therefore loaded here, before the registry is registered, rather than lazily
 * on first use.
 */

import { join } from 'node:path'
import { hostCopy } from './host-locales.js'
import type { DshellDataRootSeat, HostCopy } from '@nexus-aethra/dshell-std'
import { DSHELL_DATA_ROOT_SERVICE } from '@nexus-aethra/dshell-std'
import { Service, type Context } from '@deepseek-ai/cordis'
// Type-only: pulls the agents service merge (ctx.agents).
import type {} from '@deepseek-ai/dsh-agent'
// Type-only: pulls the host connection merge (ctx.connection.fetch).
import type {} from '@deepseek-ai/dsh-client-connection'
// Type-only: pulls the `dshellBuffer` service merge the delete branch uses to
// detach a session's pipes.
import type {} from '@nexus-aethra/dshell-buffer'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSessionsRoute } from './route.js'
import { dshHome, drainPendingPurges } from './purge.js'
import { SessionTagStore } from './tags.js'

export const name = '@nexus-aethra/dshell-workspace'

/** `workspaceRegistry` stand-in: every lookup misses, every mutation rejects. */
class DshellWorkspaceRegistry extends Service {
  constructor(ctx: Context, private readonly tags: SessionTagStore) {
    super(ctx, 'workspaceRegistry')
  }

  get(): undefined {
    return undefined
  }

  list(): readonly never[] {
    return []
  }

  /**
   * The registry-global archive set.
   *
   * Synchronous by contract — `WorkspaceFeed` reads it while the controller's
   * plugin activates — which is why the tag document is loaded during
   * composition (see the module doc). The brand is applied here rather than in
   * the store: ids reach dshell's own tag document as plain strings and only
   * cross into dsh's session identity at this boundary.
   */
  get archivedSessionIds(): readonly SessionId[] {
    return this.tags.archivedIds() as readonly SessionId[]
  }

  async create(): Promise<never> {
    throw new Error('dshell: workspaces are removed (dshell design 4.7)')
  }

  async delete(): Promise<boolean> {
    return false
  }

  async insertBefore(): Promise<readonly never[]> {
    return []
  }

  /**
   * Archive one session durably. Unlike the stock registry this runs no
   * session-existence check: dshell archives through the SIDEBAR's own delete
   * flow, which has already resolved the session against the host store.
   * @param sessionId - the session to put away.
   */
  async archiveSession(sessionId: string): Promise<void> {
    await this.tags.archive(sessionId)
  }

  /**
   * Restore one session from the archived list. The two side effects of
   * restoring travel with it here, where every unarchive now arrives — the
   * sidebar's own cancel gesture and the stock settings page alike: a
   * scheduled purge is cancelled, and the session becomes visible to the pipe
   * UI again (see route.ts, where the same pair guards a delete).
   * @param sessionId - the session to restore.
   */
  async unarchiveSession(sessionId: string): Promise<void> {
    await this.tags.unarchive(sessionId)
    this.ctx.get('dshellBufferCore')?.restoreSession(sessionId)
  }

  async resolveByPath(): Promise<undefined> {
    return undefined
  }
}

/**
 * Required service: dshell's settled data root. The archive tags live under it
 * and the load-time purge drain reads them during composition, so this apply
 * waits for the decision rather than racing it (see `std/data-root.ts`).
 */
export const inject = [DSHELL_DATA_ROOT_SERVICE] as const

export function apply(ctx: Context): Promise<void> {
  // The tag document lives at dshell's data root, which is a SETTING: it is
  // settled by dshell-mode a few milliseconds after this package activates, so
  // anything here that resolves that path during composition waits for it first
  // (see `std/data-root.ts`). The wait is also what orders the registry: it is
  // registered only once the archive set is in memory, and the controller —
  // which injects `workspaceRegistry` — therefore activates after that.
  return (async () => {
    const plan = await (ctx.get(DSHELL_DATA_ROOT_SERVICE) as DshellDataRootSeat).settled
    if (plan.source !== 'harness') {
      // Worth a line only when it is not the harness's own directory; the
      // default deployment stays quiet (dshell-mode reports the choice).
      console.info(`dshell-workspace: session tags are read from ${plan.root}`)
    }
    const tags = new SessionTagStore(() => join(dshHome(), 'dshell', 'tags.json'))
    // Load before registering: the registry serves the archive set through a
    // synchronous getter (see the module doc).
    await tags.load()
    ctx.plugin(DshellWorkspaceRegistry, tags)
    // Load-time drain: purges scheduled while their sessions were loaded. This
    // runs during composition, before a client can resume anything, which is
    // the only window where those log writers are guaranteed gone.
    void drainPendingPurges(tags)
    installPanel(ctx, tags)
  })()
}

/**
 * Install the session panel: its route, its client seats, and its menu.
 * @param ctx - host context.
 * @param tags - the archive tag store.
 */
function installPanel(ctx: Context, tags: SessionTagStore): void {
  ctx.inject(['sessions', 'agents', 'connection', 'dshellHostCopy'], (panelCtx) => {
    // This package compiles its host and client halves in one program, so the
    // client contract's `Context.sessions` (ISessions) merges over the host
    // SessionStore declaration and hides `get`. The service really is the
    // host store — the route table below only ever registers from here.
    const hostSessions = panelCtx.sessions as unknown as { get(id: SessionId): unknown }
    const agents = panelCtx.agents as unknown as {
      get(id: SessionId): { status?: string } | undefined
    }
    // Structural read, as this package already reads dshell-buffer's service:
    // the Context accessor's declaration lives with the PROVIDER (dshell-terminal-bridge),
    // and a consumer's tsc program does not include that package's source. The
    // `inject` above is what guarantees the service is there.
    const copy = panelCtx.get('dshellHostCopy') as HostCopy
    const route = createSessionsRoute({
      // Bound once, and read at call time inside the route: a language switch
      // reaches the next refusal without re-registering anything.
      t: copy.bind(hostCopy),
      tags,
      // A session still in the host store has a live log writer: its
      // directory would be recreated by the next event, so its purge is
      // scheduled instead of attempted (see route.ts).
      live: sessionId => hostSessions.get(sessionId as SessionId) !== undefined,
      running: sessionId => agents.get(sessionId as SessionId)?.status === 'running',
      // Optional: the PTY bridge is a sibling row, so a deployment without it
      // simply has no shell memory to free — including the stored history,
      // which the bridge owns and drops even when it has no record for the
      // session being deleted.
      release: async (sessionId) => {
        panelCtx.get('dshellTerminalBridge')?.releaseSession(sessionId)
      },
      // Optional for the same reason: without dshell-buffer the session has
      // no pipes to detach, and deletion proceeds without them.
      detach: async (sessionId) => {
        await panelCtx.get('dshellBufferCore')?.detachSession(sessionId)
      },
    })
    panelCtx.effect(
      () => panelCtx.connection.fetch.register(route),
      'dshell-workspace: session panel route',
    )
  })
}

export default { name, inject, apply }
