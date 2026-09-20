/**
 * dshell-ssh browser face: the device card in the Plugins settings section and
 * the `dshellSsh` service the session picker reads.
 *
 * The surface is a TAB in the Plugins settings section: `0.1.6-alpha.2`
 * replaced the per-namespace card dispatch (`settings.plugin.item`) with a
 * tabbed page, so the registrant states its own id and localized label instead
 * of being dispatched by the namespace it edits.
 */

import { type Context } from '@deepseek-ai/cordis'
// Type-only: pulls the renderer-owned slots service (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale service (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the Plugins-section SlotMap (`settings.plugins.tab`).
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { DshellSshCard } from './card.js'
import { en, zh } from './locales.js'
import { SshClientService } from './service.js'

export const name = '@nexus-aethra/dshell-ssh/client'

export const inject = ['slots', 'locale'] as const

/** This package's copy namespace. */
const NS = 'dshellSsh'

export type { DeviceView, DeviceInput, DeviceBinding } from '../protocol.js'
export type { SshSnapshot, SshClientService } from './service.js'
export type { DshellSshKey } from './locales.js'

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dshell-ssh: dictionaries')
  const t = ctx.locale.bind(NS)
  const ssh = new SshClientService(ctx)
  void ssh.load()
  // The card itself is the registered component: its `t` seat comes from the
  // declared namespace, and the device service travels as the inject face, so
  // both reach it as composed props (the same shape the shipped tabs use). The
  // tab's own label is registrant-localized, which is why `t` is bound here.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
    {
      name: 'settings.plugins.tab',
      id: 'ssh',
      order: 20,
      label: () => t('card.title'),
      locale: NS,
      inject: () => ({ ssh }),
    },
    DshellSshCard,
  ))
}
