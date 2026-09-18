/**
 * Which surface a session's terminal gets: the timeline, or a full-screen
 * program's own screen.
 *
 * The decision is one boolean, and it is made here rather than inside the block
 * view so that the timeline is not merely hidden but UNMOUNTED. That matters
 * for more than tidiness: the block view measures the view area and pushes the
 * grid to the PTY, so leaving it mounted under a full-screen program would have
 * two effects resizing the same shell against each other.
 */

import { createElement, useEffect, useSyncExternalStore, type ReactElement } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PtyStreamService } from '@nexus-aethra/dshell-terminal-bridge/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MessageImageLoader } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BlockView, type SshSeat } from './block-view.js'
import type { PipeSeat } from './status-card.js'
import { TuiSurface } from './tui-surface.js'
import { setComposerHidden } from './tui-css.js'
import { useDshellTheme } from './theme.js'
import { tuiFullScreen, type TuiChoice } from './tui.js'

/**
 * The business face the view seat receives, plus the reader's own full-screen
 * decision. Pinned as a named type so the slot overload infers it from here.
 */
export interface TerminalViewSeat {
  sessionId: SessionId | undefined
  pty: PtyStreamService
  sessions: ISessions
  /** Read at render time, so a plugin that loads after this one is still picked up. */
  ssh: SshSeat | undefined
  pipe: PipeSeat
  loadImage: MessageImageLoader | undefined
  /** The reader's per-session full-screen decision (see `tui.ts`). */
  tui: SnapshotStore<TuiChoice | undefined>
}

/** The view seat: the program's screen while it holds the terminal, the timeline otherwise. */
export function DshellTerminalView(props: TerminalViewSeat & PropsLocale<'dshellMode'>): ReactElement {
  const { t, pty } = props
  const theme = useDshellTheme()
  const reading = useSyncExternalStore(pty.state.subscribe, () => pty.state.getSnapshot().tui)
  const choice = useSyncExternalStore(props.tui.subscribe, props.tui.getSnapshot)
  const full = tuiFullScreen(reading, choice)
  // The composer goes away with the surface and comes back with it — including
  // on unmount, which is the case a session switch produces: the next session
  // opens with its own reading and its own decision, so it must not inherit
  // this one's.
  useEffect(() => {
    if (!full) return
    setComposerHidden(true)
    return () => { setComposerHidden(false) }
  }, [full])
  if (full) {
    return createElement(TuiSurface, {
      sessionId: props.sessionId,
      pty,
      theme,
      program: reading?.program ?? null,
      onLeave: () => { props.tui.set({ program: reading?.program ?? null, full: false }) },
      t,
    })
  }
  return createElement(BlockView, {
    sessionId: props.sessionId,
    pty,
    sessions: props.sessions,
    ssh: props.ssh,
    pipe: props.pipe,
    loadImage: props.loadImage,
    t,
  })
}
