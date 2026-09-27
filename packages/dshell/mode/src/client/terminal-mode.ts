/**
 * The browser half of the per-session terminal-mode flag: a mirror of the
 * host's opt-in set, plus the write path the blank-session switch uses.
 *
 * The mirror is a service so every dshell client registration gates on one
 * reading instead of fetching for itself; a toggle resolves to a POST and the
 * host's answer republishes the whole set, which is what wakes the view-tab
 * and composer registrations that wait on it.
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import {
  DSHELL_TERMINAL_MODE_PATH, type TerminalModeRequest, type TerminalModeResponse,
} from '../terminal-mode-protocol.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Mirror of the host's per-session terminal-mode opt-in set. */
    dshellTerminalMode: TerminalModeClient
  }
}

/** The committed opt-in set as the browser sees it. */
export interface TerminalModeSnapshot {
  readonly sessions: readonly string[]
  /** Terminal sessions dshell archived (its own bit). */
  readonly archived: readonly string[]
  /** The workspace the section was adopted as, once known. */
  readonly workspaceId: string | undefined
  /** Whether the reader folded the section down to the sidebar's foot. */
  readonly folded: boolean
  /** Sessions that have taken their first input. */
  readonly started: readonly string[]
  /** The directory every terminal session is created in; empty until answered. */
  readonly root: string
  /** Whether the host has answered at least once. */
  readonly loaded: boolean
}

const EMPTY: TerminalModeSnapshot = { sessions: [], archived: [], workspaceId: undefined, folded: false, started: [], root: '', loaded: false }

/** Mirror of the host's terminal-mode flag with its mutation path. */
export class TerminalModeClient extends Service {
  private snapshot: TerminalModeSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context) {
    super(ctx, 'dshellTerminalMode')
  }

  getSnapshot = (): TerminalModeSnapshot => this.snapshot

  /** Whether one session opted into the integrated terminal. */
  isOn(sessionId: string): boolean {
    return this.snapshot.sessions.includes(sessionId)
  }

  /** The directory a terminal session is created in (the terminal section's path). */
  root(): string {
    return this.snapshot.root
  }

  /** Whether this terminal session is archived in dshell's own bit. */
  isArchived(sessionId: string): boolean {
    return this.snapshot.archived.includes(sessionId)
  }

  /** Remember which workspace the section lives in. */
  async useWorkspace(workspaceId: string): Promise<void> {
    await this.send({ action: 'workspace', workspaceId })
  }

  /** Set dshell's archive bit for one terminal session. */
  async setArchived(sessionId: string, archived: boolean): Promise<void> {
    await this.send({ action: 'archive', sessionId, archived })
  }

  /** Fold or unfold the section. */
  async setFolded(folded: boolean): Promise<void> {
    await this.send({ action: 'fold', folded })
  }

  /** Record that a session took its first input. */
  async markStarted(sessionId: string): Promise<void> {
    await this.send({ action: 'start', sessionId })
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Read the committed set once; safe to call again after a transport loss. */
  async load(): Promise<void> {
    await this.send(undefined)
  }

  /** Opt one session in or out; resolves once the host commits it. */
  async set(sessionId: string, on: boolean): Promise<void> {
    await this.send({ action: 'set', sessionId, on })
  }

  private async send(request: TerminalModeRequest | undefined): Promise<void> {
    try {
      const response = await fetch(DSHELL_TERMINAL_MODE_PATH, {
        method: request === undefined ? 'GET' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...request === undefined ? {} : { body: JSON.stringify(request) },
      })
      const body = await response.json() as TerminalModeResponse
      this.publish(body.sessions, body.archived, body.workspaceId, body.folded, body.started, body.root)
    } catch {
      // A unreachable host leaves the last committed set on screen; the next
      // toggle or load retries.
    }
  }

  private publish(sessions: readonly string[], archived: readonly string[], workspaceId: string | undefined, folded: boolean, started: readonly string[], root: string): void {
    this.snapshot = { sessions, archived, workspaceId, folded, started, root, loaded: true }
    for (const listener of [...this.listeners]) listener()
  }
}
