/**
 * Client half of the dshell session panel: the scheduled-purge set and the
 * delete call, over the package's own `/api/dshell/sessions` route (see
 * ../protocol.ts).
 *
 * This carries only what dshell itself owns about a session's life. The
 * archive set is upstream's now — the sidebar reads it from the workspace
 * registry's snapshot, and restoring is the stock archived-session settings
 * page's job — so nothing here tags or untags a session.
 *
 * The snapshot is a cached object so `useSyncExternalStore` can compare it by
 * identity; every response replaces it wholesale with the set the host just
 * committed, which keeps one round trip authoritative.
 */

import { DSHELL_SESSIONS_PATH, type SessionRequest, type SessionResponse } from '../protocol.js'

/** What the sidebar renders from. */
export interface PanelSnapshot {
  /**
   * Archived ids whose removal is scheduled for the next start: the session
   * was still loaded, so dsh's open log writer would have recreated a deleted
   * directory. The row says so instead of pretending the history is gone.
   */
  readonly pending: readonly string[]
  /** Set while a purge is in flight, so the list can settle first. */
  readonly busy: boolean
  /** The last refusal, shown until the next successful call. */
  readonly error: string | undefined
}

const EMPTY: PanelSnapshot = { pending: [], busy: false, error: undefined }

/** Scheduled purges, from the sidebar's point of view. */
export class SessionPanelClient {
  private snapshot: PanelSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): PanelSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Read the scheduled-purge set; a transport failure leaves the current one. */
  async load(): Promise<void> {
    await this.send({ action: 'list' })
  }

  /**
   * Purge one session's history, agent log and shell log together.
   * @returns the refusal message when the host declined, else undefined.
   */
  async remove(sessionId: string): Promise<string | undefined> {
    await this.send({ action: 'delete', sessionId })
    return this.snapshot.error
  }

  /** Clear the last refusal (dialog close). */
  clearError(): void {
    if (this.snapshot.error === undefined) return
    this.publish({ ...this.snapshot, error: undefined })
  }

  private async send(request: SessionRequest): Promise<void> {
    this.publish({ ...this.snapshot, busy: true, error: undefined })
    try {
      const response = await fetch(DSHELL_SESSIONS_PATH, {
        method: request.action === 'list' ? 'GET' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...request.action === 'list' ? {} : { body: JSON.stringify(request) },
      })
      const body = await response.json() as SessionResponse
      // A business refusal still carries the current set: adopt it, and
      // surface the message. A transport-level failure (non-JSON, 5xx) lands
      // in the catch instead.
      this.publish({ pending: body.pendingPurge ?? [], busy: false, error: body.error })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.publish({ ...this.snapshot, busy: false, error: reason })
    }
  }

  private publish(snapshot: PanelSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}
