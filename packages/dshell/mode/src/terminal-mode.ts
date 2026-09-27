/**
 * The per-session terminal-mode flag: host half.
 *
 * A session either runs dshell's integrated terminal or stays a stock dsh
 * conversation, and the choice is made while the session is blank. Nothing in
 * dsh's own session header can carry it — `SessionCreateRequest` has no
 * metadata field and the projection map is host-folded per key — so dshell
 * keeps the opt-in set in its own document under the data root, one line of
 * JSON per process and one rewrite per toggle.
 *
 * The registry is a service so sibling host packages (the bridge, the context
 * window) can gate on it without importing this package, and a fetch route so
 * the browser half mirrors it the same way the device registry does.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import {
  DSHELL_TERMINAL_MODE_PATH, DSHELL_TERMINAL_MODE_SERVICE,
  type TerminalModeRequest, type TerminalModeResponse,
} from './terminal-mode-protocol.js'

/** The document's on-disk shape: the opt-ins, the archive bit, the workspace. */
interface TerminalModeDocument {
  readonly sessions: readonly string[]
  readonly archived: readonly string[]
  readonly workspaceId?: string
  readonly folded?: boolean
  readonly started?: readonly string[]
}

/** The opt-in set, durable across host restarts and mirrored to every browser. */
export class TerminalModeRegistry {
  private sessions: string[] = []
  private archivedSessions: string[] = []
  private workspace: string | undefined
  private foldedState = false
  private startedSessions: string[] = []
  private readonly listeners = new Set<() => void>()
  private loaded: Promise<void> | undefined

  /**
   * @param file - the durable opt-in document.
   * @param root - the directory terminal sessions are created in (the terminal
   *   block's workspace path); reported to the browser, which matches it
   *   against a session's cwd.
   */
  constructor(private readonly file: string, readonly root: string) {}

  /** The service key the registry is provided under. */
  static readonly service = DSHELL_TERMINAL_MODE_SERVICE

  /** Whether one session opted into the integrated terminal. */
  isOn(sessionId: string): boolean {
    return this.sessions.includes(sessionId)
  }

  /** The committed opt-in set, in insertion order. */
  snapshot(): readonly string[] {
    return this.sessions
  }

  /** Terminal sessions dshell archived, in insertion order. */
  archived(): readonly string[] {
    return this.archivedSessions
  }

  /** The workspace the terminal section was adopted as, once known. */
  get workspaceId(): string | undefined {
    return this.workspace
  }

  /** Whether the reader folded the section down to the sidebar's foot. */
  get folded(): boolean {
    return this.foldedState
  }

  /** Sessions that have taken their first input. */
  started(): readonly string[] {
    return this.startedSessions
  }

  /**
   * Record that a session has started. Its initialization page is over at that
   * point: the run location and the preset were what that page was for, and the
   * host refuses to change them once history exists.
   */
  async markStarted(sessionId: string): Promise<void> {
    await this.load()
    if (this.startedSessions.includes(sessionId)) return
    this.startedSessions = [...this.startedSessions, sessionId]
    await this.persist()
    for (const listener of [...this.listeners]) listener()
  }

  /** Fold or unfold the section. */
  async setFolded(folded: boolean): Promise<void> {
    await this.load()
    if (this.foldedState === folded) return
    this.foldedState = folded
    await this.persist()
    for (const listener of [...this.listeners]) listener()
  }

  /** Remember (once) which workspace the terminal section lives in. */
  async useWorkspace(workspaceId: string): Promise<void> {
    await this.load()
    if (this.workspace === workspaceId) return
    this.workspace = workspaceId
    await this.persist()
    for (const listener of [...this.listeners]) listener()
  }

  /** Set dshell's own archive bit for one terminal session. */
  async setArchived(sessionId: string, archived: boolean): Promise<void> {
    await this.load()
    const has = this.archivedSessions.includes(sessionId)
    if (archived === has) return
    this.archivedSessions = archived
      ? [...this.archivedSessions, sessionId]
      : this.archivedSessions.filter(known => known !== sessionId)
    await this.persist()
    for (const listener of [...this.listeners]) listener()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Record or drop one session's opt-in; resolves once the document holds it. */
  async set(sessionId: string, on: boolean): Promise<void> {
    await this.load()
    const has = this.sessions.includes(sessionId)
    if (on === has) return
    this.sessions = on
      ? [...this.sessions, sessionId]
      : this.sessions.filter(known => known !== sessionId)
    await this.persist()
    for (const listener of [...this.listeners]) listener()
  }

  /** Read the document once; a missing or unreadable file is an empty set. */
  async load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const raw = await readFile(this.file, 'utf8')
        const parsed = JSON.parse(raw) as Partial<TerminalModeDocument>
        this.sessions = Array.isArray(parsed.sessions)
          ? parsed.sessions.filter((id): id is string => typeof id === 'string')
          : []
        this.archivedSessions = Array.isArray(parsed.archived)
          ? parsed.archived.filter((id): id is string => typeof id === 'string')
          : []
        this.workspace = typeof parsed.workspaceId === 'string' ? parsed.workspaceId : undefined
        this.foldedState = parsed.folded === true
        this.startedSessions = Array.isArray(parsed.started)
          ? parsed.started.filter((id): id is string => typeof id === 'string')
          : []
      } catch {
        // First run, or a document a hand edited badly: start from empty.
        this.sessions = []
        this.archivedSessions = []
        this.workspace = undefined
        this.foldedState = false
        this.startedSessions = []
      }
    })()
    return this.loaded
  }

  private async persist(): Promise<void> {
    await mkdir(join(this.file, '..'), { recursive: true })
    const body: TerminalModeDocument = {
      sessions: this.sessions,
      archived: this.archivedSessions,
      ...this.workspace === undefined ? {} : { workspaceId: this.workspace },
      folded: this.foldedState,
      started: this.startedSessions,
    }
    await writeFile(this.file, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  }
}

/** The route's JSON response shape. */
function respond(body: TerminalModeResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** What starting a session does beyond recording it. */
export interface TerminalModeRouteDeps {
  /**
   * Called when one session takes its first input. The host uses it to title
   * and seed the session: a terminal session logs no turn of its own, so
   * without an event it stays dsh's reusable BLANK session and the workspace's
   * "新会话" would keep selecting it instead of minting a new one. Seeding here
   * rather than at opt-in keeps the session blank for as long as its
   * initialization page is up — the host only lets a not-yet-started session
   * take a preset.
   */
  readonly onStart?: (sessionId: string) => void
}

/** Bind the route to one registry. */
export function createTerminalModeRoute(
  registry: TerminalModeRegistry,
  deps: TerminalModeRouteDeps = {},
): ConnectionFetchRoute {
  return {
    path: DSHELL_TERMINAL_MODE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const state = (): TerminalModeResponse => ({
        sessions: registry.snapshot(),
        archived: registry.archived(),
        workspaceId: registry.workspaceId,
        folded: registry.folded,
        started: registry.started(),
        root: registry.root,
      })
      try {
        if (request.method === 'POST') {
          const input = await request.json() as TerminalModeRequest
          if (input.action === 'set' && typeof input.sessionId === 'string') {
            await registry.set(input.sessionId, input.on === true)
          } else if (input.action === 'workspace' && typeof input.workspaceId === 'string') {
            await registry.useWorkspace(input.workspaceId)
          } else if (input.action === 'archive' && typeof input.sessionId === 'string') {
            await registry.setArchived(input.sessionId, input.archived === true)
          } else if (input.action === 'fold') {
            await registry.setFolded(input.folded === true)
          } else if (input.action === 'start' && typeof input.sessionId === 'string') {
            await registry.markStarted(input.sessionId)
            deps.onStart?.(input.sessionId)
          } else {
            return respond(state(), 400)
          }
        }
        return respond(state())
      } catch {
        return respond(state(), 400)
      }
    },
  }
}
