/**
 * The sidebar's terminal section: its own header, list, search and archive.
 *
 * dsh shows a session under the workspace it was created in, which made the
 * terminal look like an ordinary folder. The section instead sits BELOW the
 * workspace list and is dshell's own: it lists the terminal sessions, filters
 * them by title, archives them through dshell's own bit, and creates new ones
 * with a terminal-glyph button rather than a folder one. Underneath, the
 * sessions still belong to a workspace (dsh's grouping owns their lifetime),
 * but that workspace's own row is hidden so the section is the only place they
 * appear.
 *
 * The chrome follows dsh's own sidebar — its `--dsw-*` tokens, its 36px section
 * header, its 28px rows and its own icon artwork (`dsh-icons.ts`) — because a
 * surface mounted beside dsh's rows is only invisible when it is built from the
 * same measurements.
 *
 * Structure matters here, not just looks: every node is created ONCE and later
 * renders only update it (rows are keyed by session id). The session list ticks
 * on its own — activity, running state, the click that opens a session — and a
 * render that replaced the rows would swallow the click whose mousedown and
 * mouseup landed on two different nodes. For the same reason the row actions
 * run on `pointerdown`, which always lands on the node the reader pressed.
 */

import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalModeClient } from './terminal-mode.js'
import type { CurrentSessionSeat } from './terminal-mode-switch.js'
import { dshIcon, type DshIconName } from './dsh-icons.js'

/** The sidebar hole the workspace browser fills; our section sits after its region. */
const SIDEBAR_HOLE = '[data-slot="sidebar.workspaces"]'

/** Our section's marker. */
const MARKER = 'data-dshell-terminal-section'

const LABEL_PRIMARY = 'var(--dsw-alias-label-primary)'
const LABEL_TERTIARY = 'var(--dsw-alias-label-tertiary)'
const ROW_HOVER = 'var(--dsw-alias-interactive-bg-hover)'
const TOOL_HOVER = 'var(--dsw-alias-button-tool-bar-hover)'
const BORDER = 'var(--dsw-alias-border-l2)'
const RADIUS = 'var(--dsw-radius-md)'

/** What the section needs from the rest of the composition. */
export interface TerminalSectionDeps {
  readonly modes: TerminalModeClient
  readonly sessions: ISessions
  readonly currentSession: CurrentSessionSeat
  readonly workspaces: {
    create(input: { path: string }): Promise<{ workspaceId: string }>
    /** The adopted workspaces, so the section can find its own by path. */
    list: {
      getSnapshot(): { readonly items: readonly { readonly workspaceId: string; readonly path: string }[] }
      subscribe(listener: () => void): () => void
    }
  }
  readonly openSession: (sessionId: SessionId) => void
  /** Mint a session in a workspace, bypassing dsh's blank-draft reuse. */
  readonly createSession: (workspaceId: string) => Promise<SessionId | undefined>
  readonly t: TranslateNS<'dshellMode'>
}

/** One session's row, kept across renders by session id. */
interface Row {
  readonly root: HTMLElement
  readonly title: HTMLElement
  readonly toggle: HTMLButtonElement
}

/**
 * Mount the terminal section until the returned disposer runs.
 * @param deps - the services the section drives.
 * @returns the disposer.
 */
export function mountTerminalSection(deps: TerminalSectionDeps): () => void {
  if (typeof document === 'undefined') return () => {}
  const root = document.createElement('div')
  root.setAttribute(MARKER, '')
  // No horizontal padding on the container: dsh's own section header carries its
  // 4px inset and its rows run full-bleed, so matching that keeps our label and
  // hover band on exactly the same x as the workspace section's.
  root.style.cssText = 'display:flex;flex-direction:column;padding:0 0 4px;box-sizing:border-box'
  let searching = false
  let showArchived = false
  let query = ''
  let busy = false

  /** Swap an icon button's artwork, creating the svg on first use. */
  const setIcon = (button: HTMLButtonElement, name: DshIconName, size = 14): void => {
    const svg = button.querySelector('svg')
    if (svg === null) button.append(dshIcon(name, size))
    else svg.replaceWith(dshIcon(name, size))
  }

  /** One icon control: 24px box, dsh's toolbar hover, 14px artwork. */
  const iconButton = (name: DshIconName, title: string, onClick: () => void, size = 14): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.title = title
    button.setAttribute('aria-label', title)
    button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;' +
      `padding:0;border:none;border-radius:${RADIUS};background:transparent;cursor:pointer;color:${LABEL_TERTIARY};flex:none`
    button.append(dshIcon(name, size))
    button.addEventListener('mouseenter', () => { button.style.background = TOOL_HOVER; button.style.color = LABEL_PRIMARY })
    button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; button.style.color = LABEL_TERTIARY })
    button.addEventListener('pointerdown', (event) => { event.stopPropagation() })
    button.addEventListener('click', (event) => { event.stopPropagation(); onClick() })
    return button
  }

  /**
   * Create the workspace if needed, then mint a session in it and open it. The
   * session is born unstarted, and its initialization page asks where it runs
   * and which preset it uses — so nothing is asked here.
   *
   * The session is minted DIRECTLY rather than through dsh's workspace open,
   * which reuses the workspace's blank draft (`reuseOrCreateBlank`): a terminal
   * session logs no turn, so it stays `blank` for as long as it is used as a
   * shell, and every press of this button would land the reader back in the
   * session already on screen.
   */
  const start = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      const path = deps.modes.root()
      if (path.length === 0) return
      // Resolved by path every time: adoption is idempotent host-side, and the
      // recorded id may be stale (the terminal root is a setting that can move).
      const workspaceId = (await deps.workspaces.create({ path })).workspaceId
      if (deps.modes.getSnapshot().workspaceId !== workspaceId) await deps.modes.useWorkspace(workspaceId)
      const sessionId = await deps.createSession(workspaceId)
      if (sessionId === undefined) return
      // Recorded here rather than left to the view's own rule: this button is
      // the one choice in the flow that is unambiguous, and the record says so.
      await deps.modes.set(String(sessionId), true, { origin: 'section', cwd: path })
      deps.openSession(sessionId)
    } catch (error) {
      console.warn('dshell: could not open a terminal session', error)
    } finally {
      busy = false
    }
  }

  // ---- the chrome, built once ----
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;gap:4px;height:36px;padding-left:4px;' +
    'margin-bottom:4px;box-sizing:border-box;overflow:hidden'
  const foldButton = iconButton('chevronDown', deps.t('block.fold'), () => {
    void deps.modes.setFolded(!deps.modes.getSnapshot().folded)
  })
  const labelEl = document.createElement('span')
  labelEl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
    `color:${LABEL_TERTIARY};font-size:12px;line-height:20px;cursor:pointer`
  labelEl.addEventListener('click', () => { void deps.modes.setFolded(!deps.modes.getSnapshot().folded) })
  const searchButton = iconButton('search', deps.t('block.search'), () => {
    searching = !searching
    if (!searching) query = ''
    render()
  })
  const archiveButton = iconButton('filter', deps.t('block.archived'), () => { showArchived = !showArchived; render() })
  const createButton = iconButton('code', deps.t('block.create'), () => { void start() })
  header.append(foldButton, labelEl, searchButton, archiveButton, createButton)

  const searchInput = document.createElement('input')
  searchInput.type = 'text'
  searchInput.placeholder = deps.t('block.searchPlaceholder')
  searchInput.style.cssText = 'margin:0 4px 4px;height:28px;padding:0 8px;box-sizing:border-box;' +
    `border:1px solid ${BORDER};border-radius:${RADIUS};background:transparent;color:${LABEL_PRIMARY};` +
    'font-size:13px;line-height:20px;outline:none'
  searchInput.addEventListener('input', () => { query = searchInput.value; render() })

  const emptyEl = document.createElement('div')
  emptyEl.textContent = deps.t('block.empty')
  emptyEl.style.cssText = `padding:0 8px;color:${LABEL_TERTIARY};font-size:12px;line-height:20px`

  const listEl = document.createElement('div')
  listEl.style.cssText = 'display:flex;flex-direction:column'

  root.append(header, searchInput, emptyEl, listEl)

  const rows = new Map<string, Row>()

  /** One session's row; its listeners are bound once, to this session's id. */
  const createRow = (id: string): Row => {
    const rowEl = document.createElement('div')
    rowEl.style.cssText = 'display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;box-sizing:border-box;' +
      `border-radius:${RADIUS};cursor:pointer;color:${LABEL_PRIMARY}`
    const mark = dshIcon('code', 16)
    mark.style.color = LABEL_TERTIARY
    mark.style.flex = 'none'
    const titleEl = document.createElement('span')
    titleEl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px'
    const toggle = iconButton('archive', deps.t('block.archiveOne'), () => { /* handled on pointerdown */ })
    toggle.style.opacity = '0'
    // pointerdown, so the action lands before any re-render the store's tick
    // would cause, and stopPropagation keeps it off the row's own action.
    toggle.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
      const archivedNow = deps.modes.getSnapshot().archived.includes(id)
      void deps.modes.setArchived(id, !archivedNow)
    })
    rowEl.addEventListener('mouseenter', () => { rowEl.style.background = ROW_HOVER; toggle.style.opacity = '1' })
    rowEl.addEventListener('mouseleave', () => {
      if (id !== deps.currentSession.get()) rowEl.style.background = 'transparent'
      toggle.style.opacity = '0'
    })
    rowEl.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      // A press that starts on one of the row's own controls belongs to that
      // control, wherever the button's own handlers sit in the propagation
      // order: opening the session is the row's action, never the archive's.
      const target = event.target
      if (target instanceof HTMLElement && target.closest('button') !== null) return
      deps.openSession(id as SessionId)
    })
    rowEl.append(mark, titleEl, toggle)
    return { root: rowEl, title: titleEl, toggle }
  }

  /** Whether dsh's sidebar is in its 36px rail state. */
  const isRail = (): boolean => (root.parentElement?.className ?? '').toString().includes('_collapsed')

  /** Hide one element outright, leaving the rest of the tree alone. */
  const hide = (element: Element | null): void => {
    if (element instanceof HTMLElement && element.style.display !== 'none') element.style.display = 'none'
  }

  /**
   * Isolate the terminal sessions from dsh's own tree.
   *
   * dsh groups a workspace's sessions inside one `groupSection`, together with
   * the "expand the remaining N sessions" affordance — so hiding the workspace
   * row alone leaves both the rows and that count behind (a reader sees
   * "其余 2 个会话" for sessions that are supposed to live elsewhere). Our own
   * workspaces therefore hide as a whole GROUP: the current root, any earlier
   * root under the harness home, and the recorded one. A user's workspace is
   * never hidden as a group — a terminal session that happens to live in one
   * hides only its own row.
   */
  const isolate = (): void => {
    const flag = deps.modes.getSnapshot()
    const items = deps.workspaces.list.getSnapshot().items
    const path = deps.modes.root()
    if (path.length > 0) {
      const match = items.find(item => item.path === path)
      if (match !== undefined && flag.workspaceId !== match.workspaceId) void deps.modes.useWorkspace(match.workspaceId)
    }
    const ours = new Set<string>()
    for (const item of items) {
      if (item.path === path || item.path.includes('/.dsh/')) ours.add(item.workspaceId)
    }
    if (flag.workspaceId !== undefined) ours.add(flag.workspaceId)
    for (const workspaceId of ours) {
      const row = document.querySelector(`[data-row-key="workspace:${workspaceId}"]`)
      const group = row?.closest('[class*="_groupSection"]') ?? row
      if (group !== null && group !== undefined) hide(group)
      // The group may not be mounted (a collapsed or virtualized region); the
      // overflow control carries its own key either way.
      hide(document.querySelector(`[data-row-key="overflow:${workspaceId}"]`))
    }
    for (const id of flag.sessions) hide(document.querySelector(`[data-row-key="session:${id}"]`))
  }

  /** Update every node in place; nothing is rebuilt that already exists. */
  const render = (): void => {
    // dsh's sidebar hides its rows in the rail state and shows icons instead;
    // a full section beside a 36px rail would be the loudest thing on screen.
    const rail = isRail()
    root.style.display = rail ? 'none' : 'flex'
    if (rail) return
    // The section's home follows its fold state: unfolded it sits under the
    // workspace list, folded it docks at the sidebar's foot.
    attach()

    const list = deps.sessions.list.getSnapshot()
    const flag = deps.modes.getSnapshot()
    const folded = flag.folded
    const current = deps.currentSession.get()
    // The rows are OUR set of terminal sessions, not dsh's list: dsh hides the
    // sessions archived in its own registry, and our archive bit is a separate
    // thing, so a session archived there must still appear here. The summary is
    // used for its title and recency when the list happens to carry it.
    /**
     * The name one row shows.
     *
     * dsh's durable title first, because that is also where a rename by the
     * reader lands; then the name dshell recorded when it named the session,
     * which is what a session shows while dsh has not projected a title for it;
     * only then dsh's own display fallback, whose last resort is the bare id.
     * @param id - the session id.
     * @returns the name to show.
     */
    const titleOf = (id: string): string => {
      const summary = list.byId[id as SessionId]
      return summary?.title
        ?? flag.records.find(record => record.sessionId === id)?.title
        ?? summary?.displayTitle
        ?? id
    }
    const desired = [...flag.sessions]
      .filter(id => showArchived || !flag.archived.includes(id))
      .filter(id => query.length === 0 || titleOf(id).toLowerCase().includes(query.toLowerCase()))
      .sort((left, right) => (list.byId[right as SessionId]?.updatedAt ?? 0) - (list.byId[left as SessionId]?.updatedAt ?? 0))

    setIcon(foldButton, folded ? 'chevronUp' : 'chevronDown')
    labelEl.textContent = folded && desired.length > 0
      ? `${deps.t('block.section')} (${desired.length})`
      : deps.t('block.section')
    searchButton.style.display = folded ? 'none' : 'inline-flex'
    archiveButton.style.display = folded ? 'none' : 'inline-flex'
    archiveButton.style.color = showArchived ? LABEL_PRIMARY : LABEL_TERTIARY
    searchInput.style.display = !folded && searching ? 'block' : 'none'
    if (document.activeElement !== searchInput) searchInput.value = query

    if (folded) {
      for (const row of rows.values()) row.root.remove()
      rows.clear()
      emptyEl.style.display = 'none'
      isolate()
      return
    }

    const alive = new Set<string>()
    for (const id of desired) {
      alive.add(id)
      let row = rows.get(id)
      if (row === undefined) {
        row = createRow(id)
        rows.set(id, row)
      }
      row.title.textContent = titleOf(id)
      setIcon(row.toggle, flag.archived.includes(id) ? 'unarchive' : 'archive')
      row.root.style.background = id === current ? ROW_HOVER : 'transparent'
      listEl.append(row.root)
    }
    for (const [id, row] of [...rows]) {
      if (alive.has(id)) continue
      row.root.remove()
      rows.delete(id)
    }
    emptyEl.style.display = desired.length === 0 ? 'block' : 'none'
    isolate()
  }

  const attach = (): boolean => {
    const hole = document.querySelector(SIDEBAR_HOLE)
    const region = hole?.closest('[class*="_regionArea"]') ?? hole
    if (region === null || region === undefined) return false
    if (deps.modes.getSnapshot().folded) {
      // Docked at the foot: the last thing above the sidebar's own footer.
      const foot = document.querySelector('[class*="_footArea"]')
      const parent = foot?.parentElement ?? null
      if (foot !== null && parent !== null) {
        if (root.parentElement !== parent || foot.previousElementSibling !== root) parent.insertBefore(root, foot)
        return true
      }
    }
    if (root.previousElementSibling !== region) region.after(root)
    return true
  }

  const disposers = [
    deps.sessions.list.subscribe(render),
    deps.workspaces.list.subscribe(() => { render() }),
    deps.modes.subscribe(render),
    deps.currentSession.subscribe(render),
  ]
  attach()
  render()
  // Re-render only when something the section depends on actually moved: the
  // sidebar's rail state, or our own node falling out of the document.
  let lastRail: boolean | undefined
  const observer = new MutationObserver(() => {
    const rail = isRail()
    if (rail === lastRail && root.isConnected) return
    lastRail = rail
    if (!root.isConnected) attach()
    render()
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  // Narrow and cheap: only an inserted session row can un-hide a terminal one,
  // so this watches insertions and touches nothing else.
  const rowObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.matches('[data-row-key]') || node.querySelector('[data-row-key]') !== null) {
          isolate()
          return
        }
      }
    }
  })
  rowObserver.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    rowObserver.disconnect()
    for (const dispose of disposers) dispose()
    root.remove()
  }
}
