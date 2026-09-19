/**
 * dshell-buffer browser face: the pipe panel in the frame-wide overlay seat,
 * and the `dshellBuffer` service other client bundles open it through.
 *
 * The panel enters `shell.overlay` — the additive, click-through frame layer —
 * rather than replacing anything, so a composition that omits this package
 * simply has one fewer floating surface. The sidebar entry that opens it lives
 * in dshell-workspace and reaches the service by injection, which is the only
 * collaboration path between client bundles.
 */

import { type Context } from '@deepseek-ai/cordis'
import { mainSessionId } from '@nexus-aethra/dshell-std'
// Type-only: pulls the renderer-owned slots service (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ui-layout's SlotMap merge (the `shell.overlay` seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the locale service merge (ctx.locale) and this namespace's keys.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { en, zh } from './locales.js'
import { PipePanel } from './panel.js'
import { BufferClientService, type SessionSeat } from './service.js'

export const name = '@nexus-aethra/dshell-buffer/client'

export const inject = ['slots', 'locale'] as const

/** This package's copy namespace. */
const NS = 'dshellBuffer'

export type { BufferSnapshot, SessionSeat } from './service.js'
export type { PipePanelProps } from './panel.js'

/** A permanently empty list, for the frames before the sessions service arrives. */
const EMPTY_SESSIONS: ReturnType<SessionSeat['getSnapshot']> = { ids: [], byId: {}, current: undefined }

export function apply(ctx: Context): void {
  const t: TranslateNS<'dshellBuffer'> = ctx.locale.bind(NS)
  const buffer = new BufferClientService(ctx)
  void buffer.load()

  // The dictionaries are registered through an effect so a composition that
  // unloads this plugin takes its copy with it.
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dshell-buffer: dictionaries')

  // The sessions service may be provided by a sibling row that activates after
  // this one, so it is resolved by injection rather than read once at apply
  // time. The seat is a stable facade over a mutable holder: the panel's props
  // never change identity, and the panel re-renders on whatever the live store
  // publishes.
  let sessions: ISessions | undefined
  ctx.inject(['sessions'], (sessionCtx) => {
    sessions = sessionCtx.get('sessions') as unknown as ISessions
  })
  /**
   * The slice built for the list snapshot it was built from.
   *
   * A React store compares snapshots by identity, so the slice is cached against
   * the source snapshot rather than rebuilt per read: a fresh object every call
   * is an infinite render loop, not a slower one.
   */
  let slicedFrom: unknown
  let sliced: ReturnType<SessionSeat['getSnapshot']> = EMPTY_SESSIONS
  const sessionsSeat: SessionSeat = {
    // Built rather than forwarded: the seat is dshell's own slice of the list,
    // and the host's snapshot stopped carrying `current` in 0.1.6-alpha.2 —
    // which Session is on screen is a RETENTION count now (`mainSessionId`).
    getSnapshot: () => {
      const list = sessions?.list.getSnapshot()
      if (list === undefined) return EMPTY_SESSIONS
      if (list === slicedFrom) return sliced
      const held = mainSessionId(Object.values(list.byId))
      sliced = {
        ids: list.ids.map(String),
        byId: Object.fromEntries(Object.entries(list.byId).map(([id, row]) => [id, {
          displayTitle: row.displayTitle,
          cwd: row.cwd,
          running: row.running,
        }])),
        current: held === undefined ? undefined : String(held),
      }
      slicedFrom = list
      return sliced
    },
    subscribe: (listener) => sessions?.list.subscribe(listener) ?? (() => {}),
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay',
      id: 'dshell-buffer',
      order: 100,
      label: () => t('panel.label'),
      locale: NS,
      inject: () => ({ buffer, sessions: sessionsSeat }),
    },
    PipePanel,
  ))
}
