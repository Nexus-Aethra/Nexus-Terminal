/**
 * dshell-workspace browser face — design decision 4.7.
 *
 * Provides the same-key stand-ins that let the stock web-app rows `workspace`
 * and `ui-workspace` be disabled:
 *
 * - `uiWorkspace`: startSession/connectWorkspace create sessions by cwd
 *   (`sessions.create({ cwd })`, never workspaceId), and boot navigation
 *   opens the most recent ordinary session instead of the most recent
 *   workspace's.
 * - the root `workspaces` standard hook that ConversationRoot requires.
 * - the `sidebar.workspaces` slot: a flat session list replaces the
 *   workspace-grouped browser, keeping multi-session navigation intact.
 *
 * The `workspaces` service itself is NOT provided here any more. It was a
 * stand-in with a permanently empty snapshot; upstream's `workspace-controller`
 * owns that key, and this profile now ENABLES that row, so the archive half of
 * the service is upstream's — the sidebar reads the archive set from its
 * snapshot, archiving goes through its command, and the stock archived-session
 * settings page is the restore surface. Claiming the key here as well is what
 * used to take the whole client down: two providers for one service is a
 * cordis error, and it surfaced only as "Failed to load plugins".
 *
 * React reaches the component through the shell's frozen module table
 * (PLATFORM_MODULES), which is why 'react' is an external in the dshell
 * client bundle preset.
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: `ctx.remote` plus the mounted `agentPresets` namespace merge.
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions, SessionReference, SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the Session Controller service merges.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the `workspaces` service merge and its snapshot shape. The
// service is upstream's; this package only reads it.
import type { IWorkspaces, WorkspaceId, WorkspaceSource } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls ui-sidebar's SlotMap merge ('sidebar.workspaces' hole).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale service merge (ctx.locale) and this namespace's keys.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { mainSessionId } from '@nexus-aethra/dshell-std'
// Type-only: pulls the `dshellBuffer` service merge the pipe entry toggles.
import type {} from '@nexus-aethra/dshell-buffer/client'
import type { SshSnapshot } from '@nexus-aethra/dshell-ssh/client'
import { SessionPanelClient } from './panel.js'
import { newSessionDialog } from './dialog-store.js'
import { en, zh } from './locales.js'
import { activeRows, directoryName, presetChoices, type PresetChoice, type SessionRow } from './rows.js'
import { FlatSessionList, type DeviceSeat, type FlatSessionListProps } from './session-list.js'

/**
 * The retention source this package claims a Session under.
 *
 * `mainView` is the HOST's own source name — it is what the whole Client reads
 * to answer "which Session is on screen" — and the host declares it inside
 * `ui-session`, a package this program does not compile. The map is
 * merge-extensible for exactly this reason, so the source is declared here
 * instead of borrowed.
 */
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    mainView: unknown
  }
}

export const name = '@nexus-aethra/dshell-workspace/client'

export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.agentPresets', 'workspaces'] as const

/** This package's copy namespace. */
const NS = 'dshellWorkspace'

/** `uiWorkspace` stand-in: cwd-based session flows and boot navigation. */
class DshellUiWorkspace extends Service implements UiWorkspace {
  constructor(
    ctx: Context,
    private readonly sessions: ISessions,
    /** Upstream's workspace service: the archive set and its two commands. */
    private readonly workspaces: IWorkspaces,
    /** This package's copy, read at call time so a language switch is picked up. */
    private readonly t: TranslateNS<'dshellWorkspace'>,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => this.watchBootNavigation(), 'dshell-workspace: boot navigation')
    // The claim this stand-in holds has to be let go when the plugin unloads, or
    // the host keeps reporting a Session on screen that nothing is showing.
    ctx.effect(() => () => { this.clearMain() }, 'dshell-workspace: release the main view claim')
  }

  /**
   * The Session this view holds, from the host's retention rule.
   *
   * `0.1.6-alpha.2` turned "which Session is on screen" from a list field into a
   * RETENTION: a view claims one with `retain(target, { source: 'mainView' })`,
   * and the previous claim must be released, or the Session it named stays held —
   * and so stays the one the whole Client reads as current.
   */
  private mainReference: SessionReference | undefined

  /** Claim a Session for this view, releasing whatever was claimed before. */
  private replaceMain(target: SessionTarget): void {
    const reference = this.sessions.retain(target, { source: 'mainView' })
    const previous = this.mainReference
    this.mainReference = reference
    previous?.release()
  }

  /** Let go, so a Client holding nothing reports no Session on screen. */
  private clearMain(): void {
    const previous = this.mainReference
    this.mainReference = undefined
    previous?.release()
  }

  async connectWorkspace(_workspaceId: WorkspaceId): Promise<SessionId> {
    return await this.openBlankSession()
  }

  /**
   * dsh navigation action: select a Session.
   *
   * The mechanism is a claim now rather than a stored field, so this is the
   * whole of "select": hold the Session, drop the last hold.
   */
  openSession(sessionId: SessionId): void {
    this.replaceMain(sessionId)
  }

  /**
   * dsh navigation action: "open a Workspace". dshell has no
   * workspaces (design 4.7), so the action lands on the terminal-continuity
   * blank session instead — the same target `connectWorkspace` uses.
   */
  async openWorkspace(_workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void> {
    const sessionId = await this.openBlankSession()
    beforeOpen?.(sessionId)
    this.replaceMain(sessionId)
  }

  /** dsh navigation action: fork a Session and open the child. */
  async forkSession(sessionId: SessionId): Promise<void> {
    const child = await this.sessions.fork({ sessionId })
    this.replaceMain(child)
  }

  startSession(_workspaceId?: WorkspaceId): void {
    // The stock New-Session affordance opens dshell's naming dialog instead
    // of creating silently (design 4.7 naming paragraph).
    newSessionDialog.set(true)
  }

  /**
   * The stock archive entry, on upstream's command. The sidebar's 归档 button
   * is the only writer dshell adds: it goes through the same service the stock
   * archived-session settings page reads, which is what keeps the two in step.
   */
  async archiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.archiveSession(sessionId)
  }

  /**
   * The stock restore entry, on the same command. The settings page reaches
   * this through `uiWorkspace`; the sidebar's 待删除 cancel reaches it too,
   * because restoring is what cancels a scheduled purge.
   */
  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unarchiveSession(sessionId)
  }

  async pickDirectory(): Promise<string | null> {
    throw new Error('dshell: directory picking is removed (dshell design 4.7)')
  }

  async listDirectory(_path?: string, _signal?: AbortSignal): Promise<DirectoryListing> {
    throw new Error('dshell: directory picking is removed (dshell design 4.7)')
  }

  async createDirectory(_path: string, _name: string): Promise<string> {
    throw new Error('dshell: directory picking is removed (dshell design 4.7)')
  }

  /**
   * Rows continuity flows may land on: archived sessions are still real, but
   * they are not what "the last session I used" means to the reader.
   */
  private visibleRows(): SessionRow[] {
    return activeRows(this.sessions.list.getSnapshot(), this.archivedIds())
  }

  /** The archive set as the workspace registry last reported it. */
  private archivedIds(): readonly string[] {
    return this.workspaces.list.getSnapshot().archivedSessionIds.map(String)
  }

  /** The cwd a new session lands in: the requested one, else the most recent session's. */
  private resolveCwd(cwd: string | undefined): string | undefined {
    if (cwd !== undefined && cwd !== '') return cwd
    return this.visibleRows().find(row => !row.blank)?.cwd
  }

  /** Create a session bound to `cwd`; absent cwd falls back to the most recent session's directory, then the server default. */
  private async createCwdSession(cwd: string | undefined): Promise<SessionId> {
    const target = this.resolveCwd(cwd)
    return await this.sessions.create({ ...(target === undefined ? {} : { cwd: target }) })
  }

  /**
   * The new-session dialog's roster. A deployment without the preset service
   * reports `gateway/invocation-unavailable`, which is not an error here:
   * every session then composes from the host default.
   * @returns the selectable presets, empty when none are available.
   */
  async listPresets(): Promise<PresetChoice[]> {
    const result = await this.ctx.remote.agentPresets.list()
    if (!result.ok) return []
    return presetChoices(result.value.presets, this.t)
  }

  /**
   * Create or reuse a blank cwd session (design 4.7). The default target
   * directory is the most recent ordinary session's cwd — terminal
   * continuity — and an existing blank session for that directory is reused
   * so repeated new-session actions do not pile up empty shells.
   */
  private async openBlankSession(): Promise<SessionId> {
    const rows = this.visibleRows()
    const targetCwd = rows.find(row => !row.blank)?.cwd
    const reusable = targetCwd === undefined
      ? undefined
      : rows.find(row => row.blank && row.cwd === targetCwd)
    if (reusable !== undefined) return reusable.id
    return await this.createCwdSession(targetCwd)
  }

  /**
   * Create a named session through the new-session dialog (design 4.7
   * naming paragraph): pick the agent preset while the session is still
   * blank (a started session refuses the switch), then one durable rename
   * through the session face. An empty name falls back to the directory
   * name the placeholder promises; pinning that title is what stops the
   * first message's automatic title from renaming the session.
   */
  async createNamedSession(name: string | undefined, cwd: string | undefined, presetId?: string): Promise<SessionId> {
    const target = this.resolveCwd(cwd)
    const sessionId = await this.createCwdSession(target)
    if (presetId !== undefined && presetId !== '') {
      const selected = await this.ctx.remote.agentPresets.select(sessionId, presetId)
      if (!selected.ok) console.warn('dshell: agent preset select failed:', selected.error.message)
    }
    const title = name === undefined || name === '' ? directoryName(target) : name
    if (title !== undefined && title !== '') {
      const binding = this.sessions.binding(sessionId)
      if (binding !== undefined) {
        const result = await binding.session.rename(title)
        if (!result.ok) console.warn('dshell: session rename failed:', result.error.message)
      }
    }
    return sessionId
  }

  /**
   * Boot selection policy: open the most recent ordinary session when the
   * list arrives with nothing on stage. Replaces the stock policy of
   * re-opening the most recent workspace's session.
   */
  private watchBootNavigation(): () => void {
    let armed = true
    const reconcile = (): void => {
      if (!armed) return
      const state = this.sessions.list.getSnapshot()
      if (state.phase !== 'ready') return
      // The archive set decides which sessions are on stage; opening the most
      // recent one before it arrives would resurrect an archived session. The
      // registry reports 'ready' once its first baseline is in.
      if (this.workspaces.list.getSnapshot().phase !== 'ready') return
      armed = false
      const archived = this.archivedIds()
      // A reload can land on a Session that has since been archived — an
      // archived session belongs to the settings page's list, not to the main
      // area. The one to check is the HELD one, which is how the host reports
      // the selection now that the list carries no `current` field.
      const current = mainSessionId(Object.values(state.byId))
      if (current !== undefined && !archived.includes(String(current))) return
      const latest = activeRows(state, archived).at(0)
      if (latest !== undefined) this.replaceMain(latest.id)
      else if (current !== undefined) this.clearMain()
    }
    const dispose = this.sessions.list.subscribe(reconcile)
    // The boot target depends on the archive set, so the registry's stream is a
    // trigger too: whichever of the two facts arrives last decides.
    const disposeArchive = this.workspaces.list.subscribe(reconcile)
    reconcile()
    return () => {
      armed = false
      dispose()
      disposeArchive()
    }
  }
}

/**
 * Mount the workspace removal: the `uiWorkspace` stand-in, the root hook, and
 * the flat session list. Nothing from the stock workspace UI survives, but the
 * stock `workspaces` service does — it is upstream's, and the archive set rides
 * on it.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  // The host SessionStore declaration is visible in this program too (the
  // package compiles both halves at once), so the client contract needs the
  // explicit two-step cast.
  const sessions = ctx.get('sessions') as unknown as ISessions
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dshell-workspace: dictionaries')
  const panel = new SessionPanelClient()
  // The SSH plugin is a sibling row: present in the dshell bundle, absent in a
  // composition that omits it, so the seat is filled by injection rather than
  // assumed. List and dialog both tolerate its absence.
  let deviceSeat: DeviceSeat | undefined
  ctx.inject(['dshellSsh'], (sshCtx) => {
    const ssh = sshCtx.dshellSsh
    deviceSeat = {
      getSnapshot: () => ssh.getSnapshot() as SshSnapshot,
      subscribe: listener => ssh.subscribe(listener),
      devices: () => ssh.getSnapshot().devices.map(device => ({
        id: device.id,
        name: device.name,
        remoteRoot: device.remoteRoot,
      })),
      bind: (sessionId, deviceId, remoteRoot, mount) =>
        ssh.bind(String(sessionId), deviceId, remoteRoot ?? null, mount ?? null),
      mountFor: (deviceId, remoteRoot) => ssh.mountFor(deviceId, remoteRoot),
      test: (deviceId, remoteRoot) => ssh.test(deviceId, remoteRoot),
      revealSettings: () => ssh.revealInSettings(),
      isMountPath: (path) => ssh.isMountPath(path),
    }
  })
  const workspaces = ctx.workspaces
  // `useSyncExternalStore` takes the two methods DETACHED from their source, so
  // they must not touch `this`. Upstream's model implements them as ordinary
  // class methods (dshell's own panel client uses bound arrows), so the
  // sidebar gets an adapter rather than the model itself — passing it directly
  // throws inside React's render and leaves the list blank.
  const archiveSource: WorkspaceSource = {
    getSnapshot: () => workspaces.list.getSnapshot(),
    subscribe: listener => workspaces.list.subscribe(listener),
  }
  const uiWorkspace = new DshellUiWorkspace(ctx, sessions, workspaces, t)
  void panel.load()

  // The cross-session pipe entry, filled by injection like the device seat:
  // present in the dshell bundle, absent in a composition that omits
  // dshell-buffer — and then the header keeps its new-session button.
  let pipe: { toggle: () => void } | undefined
  ctx.inject(['dshellBuffer'], (bufferCtx) => {
    pipe = { toggle: () => { bufferCtx.dshellBuffer.toggle() } }
  })

  // ConversationRoot resolves its chip via the global useWorkspaces hook. The
  // registry's own snapshot is what it reads: with no workspaces registered the
  // list is empty, which routes the chip to its cwd-label branch.
  ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })

  // dshell is terminal-first: the blank-session hero banner ("探索未至之境")
  // and its workspace chip fight the terminal surface, and neither is a slot,
  // so a plugin cannot unmount them — hide/reposition with a stylesheet. The
  // CSS-module suffixes are stable; the hash prefixes are not, hence the
  // contains-selectors. Nothing here touches the active phase: the stock
  // layout (docked composer + `conversation.view` area) is exactly where the
  // dshell PTY canvas and composer belong, so it stays stock.
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshell = 'hero-interim-hide'
    style.textContent = [
      '[class*="heroWorkspaceRow"] { display: none !important; }',
      '[class*="headline"] { display: none !important; }',
      // The view-tab strip stays visible: the terminal is one surface, but the
      // trajectory ledger (`轨迹`, ui-trajectory) is a second reading of the
      // same session worth switching to, and the strip dsh draws is exactly
      // that switcher. It shows `会话` (dshell's block view) and `轨迹`; the
      // stock `ui-chat` view is disabled in the bundle patch so it cannot add
      // a third tab beside them. Nothing else about the strip is restyled —
      // dsh owns its geometry and active-tab marking.
      // Hero phase (no open session): pin the composer stack to the bottom of
      // the scroll column instead of the stock vertical center. data-phase is
      // a stable stock attribute on the conversation root.
      '[data-phase="hero"] [class*="scrollBody"] { justify-content: flex-end !important; }',
      '[class*="composerHero"] { padding-bottom: 14px !important; }',
      // The composer is an input line, not a floating dialog card (design
      // 4.8): strip the stock elevation (22px radius, surface fill, soft
      // shadow, hairline stroke) and mark the boundary with one bottom rule
      // that spans the terminal's content width. `data-phase` rides the
      // conversation root, whose inherited geometry variables we retune to
      // the canvas' own 10px inset.
      '[data-phase] { --dsh-composer-side-clearance: 10px !important; --dsh-composer-card-max-width: 100% !important; }',
      '[data-composer-card] {',
      '  border-radius: 0 !important;',
      '  background: transparent !important;',
      '  box-shadow: none !important;',
      '  --dsw-elevation-stroke-color: transparent !important;',
      '  border-bottom: 1px solid var(--dsw-alias-border-l4) !important;',
      '  padding: 6px 0 4px !important;',
      '  gap: 8px !important;',
      '}',
      // The dashed pick-a-workspace ring only makes sense on a rounded card.
      '[data-composer-card]::after { display: none !important; }',
      // Stock chat-width drag handles (a col-resize strip whose ::after is a
      // short 3px glow bar that lights up on hover). They resize the chat
      // content width, which dshell's full-bleed canvas and composer ignore —
      // in a terminal surface they read as a stray sliding light column.
      '[class*="widthHandle"] { display: none !important; }',
      // The submit affordance is a RETURN KEY, not a chat bubble. Stock draws
      // a 34px filled blue circle with an up arrow, which reads as "send a
      // chat message" — the wrong promise for a composer whose text goes
      // straight into a shell. Transparency plus the key glyph says what the
      // Enter key already does, so the button and the keyboard agree.
      //
      // Send and Stop share the `primary` class, so the glyph is selected by
      // SHAPE, not by the aria-label (which is translated): the stop icon is
      // an svg `rect`, the send icon an svg `path`. `:has()` keeps this
      // language-independent, so a locale switch cannot move the styles.
      '[class*="primary"]:has(svg path) {',
      '  width: 28px !important;',
      '  height: 28px !important;',
      '  background: transparent !important;',
      '  border-radius: 6px !important;',
      '  color: var(--dsw-alias-label-tertiary) !important;',
      // The stock circle lifts itself 2px to clear the row's top padding;
      // a bare glyph belongs on the row's own baseline.
      '  transform: none !important;',
      '}',
      '[class*="primary"]:has(svg path):hover:not(:disabled) {',
      '  background: var(--dsw-alias-interactive-bg-hover) !important;',
      '  color: var(--dsw-alias-label-primary) !important;',
      '}',
      '[class*="primary"]:has(svg path):disabled {',
      '  background: transparent !important;',
      '  opacity: 0.4 !important;',
      '}',
      '[class*="primary"]:has(svg path) > svg { display: none !important; }',
      // The keycap: a return arrow (down, along, then back to the left). Drawn
      // as a mask so `currentColor` still drives it and the disabled/hover
      // colors above keep working — a background-image could not be recolored.
      '[class*="primary"]:has(svg path)::after {',
      '  content: \'\' !important;',
      '  width: 15px;',
      '  height: 15px;',
      '  background-color: currentColor;',
      '  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3E%3Cpath d=\'M12.7 2.7v4.9a2.5 2.5 0 0 1-2.5 2.5H3.4\' fill=\'none\' stroke=\'%23000\' stroke-width=\'1.7\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3Cpath d=\'M6.1 7.5 3.4 10.1l2.7 2.6\' fill=\'none\' stroke=\'%23000\' stroke-width=\'1.7\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E") center / contain no-repeat;',
      '  mask: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3E%3Cpath d=\'M12.7 2.7v4.9a2.5 2.5 0 0 1-2.5 2.5H3.4\' fill=\'none\' stroke=\'%23000\' stroke-width=\'1.7\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3Cpath d=\'M6.1 7.5 3.4 10.1l2.7 2.6\' fill=\'none\' stroke=\'%23000\' stroke-width=\'1.7\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E") center / contain no-repeat;',
      '}',
    ].join('\n')
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'dshell-workspace: hero interim hide')

  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      locale: NS,
      inject: (): FlatSessionListProps => ({
        sessions: sessions.list,
        panel,
        workspaces: archiveSource,
        archiveSession: (sessionId) => workspaces.archiveSession(sessionId as SessionId),
        unarchiveSession: (sessionId) => workspaces.unarchiveSession(sessionId as SessionId),
        device: deviceSeat,
        pipe,
        refresh: () => sessions.refresh(),
        createSession: (name, cwd, presetId) =>
          uiWorkspace.createNamedSession(name, cwd, presetId).then((sessionId) => {
            uiWorkspace.openSession(sessionId)
            return sessionId
          }),
        listPresets: () => uiWorkspace.listPresets(),
        open: (sessionId) => { uiWorkspace.openSession(sessionId as SessionId) },
      }),
    },
    FlatSessionList,
  ))
}
