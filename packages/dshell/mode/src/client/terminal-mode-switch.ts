/**
 * The seats the blank-session creation controls read.
 *
 * The controls themselves are built as plain DOM (`creation-controls-dom.ts`)
 * and mounted into dsh's hero control row; this module holds only the shapes
 * they exchange, plus the flag hook the composer entries gate on.
 */

import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TerminalModeClient } from './terminal-mode.js'

/** What the run-location control needs from dshell-ssh, by service key. */
export interface DeviceChoiceSeat {
  snapshot(): {
    readonly devices: readonly { readonly id: string; readonly name: string }[]
    readonly bindings: readonly {
      readonly sessionId: string
      readonly deviceId: string
      /** Directory override on the device, when the session set one. */
      readonly remoteRoot?: string | undefined
      /** Local directory standing in for the device's tree, when one was mounted. */
      readonly mount?: string | undefined
    }[]
  }
  bind(sessionId: string, deviceId: string | null): Promise<void>
  subscribe(listener: () => void): () => void
}

/** The framework's own current-session reading (ui-session's binding source). */
export interface CurrentSessionSeat {
  get(): SessionId | undefined
  subscribe(listener: () => void): () => void
}

/** The committed flag for one session, reactive to host answers. */
export function useTerminalModeOn(modes: TerminalModeClient, sessionId: SessionId | undefined): boolean {
  const snapshot = useSyncExternalStore(modes.subscribe, modes.getSnapshot)
  return sessionId !== undefined && snapshot.sessions.includes(sessionId)
}
