/**
 * The wire contract of the per-session terminal-mode flag.
 *
 * The flag decides whether one session runs dshell's integrated terminal or
 * stays a stock dsh conversation. It is chosen while the session is blank and
 * frozen afterwards, so the document only ever records the sessions that opted
 * in: absence is the off state, and a session id never carries a stale `false`.
 */

/** The route's exact path, behind dsh's own `/api` trust fence. */
export const DSHELL_TERMINAL_MODE_PATH = '/api/dshell/terminal-mode'

/** The host service key the registry is provided under. */
export const DSHELL_TERMINAL_MODE_SERVICE = 'dshellTerminalMode'

/** One mutation request; a GET carries no body and means "report". */
export type TerminalModeRequest =
  | { readonly action: 'set'; readonly sessionId: string; readonly on: boolean }
  /** Record the workspace the terminal section was adopted as. */
  | { readonly action: 'workspace'; readonly workspaceId: string }
  /** dshell's own archive bit for one terminal session. */
  | { readonly action: 'archive'; readonly sessionId: string; readonly archived: boolean }
  /** Whether the section is folded down to its header at the sidebar's foot. */
  | { readonly action: 'fold'; readonly folded: boolean }
  /** The session has taken its first input; its initialization page is over. */
  | { readonly action: 'start'; readonly sessionId: string }

/** The committed opt-in set, newest last, plus the terminal block's state. */
export interface TerminalModeResponse {
  readonly sessions: readonly string[]
  /** Terminal sessions dshell has archived (its own bit, not dsh's). */
  readonly archived: readonly string[]
  /** The workspace the section was adopted as, once it has been. */
  readonly workspaceId: string | undefined
  /** Whether the reader folded the section down to the sidebar's foot. */
  readonly folded: boolean
  /** Sessions that have taken their first input (the seed turn does not count). */
  readonly started: readonly string[]
  /**
   * The directory every terminal session is created in — the user's home
   * directory, where a shell starts. A session whose cwd is this path is a
   * terminal session (the sidebar's terminal section adopts it as a workspace),
   * which is how the choice survives without a per-session toggle.
   */
  readonly root: string
}
