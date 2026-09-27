/**
 * The per-session device binding, in the native session row.
 *
 * dshell's own session list used to carry the device picker; with the stock
 * workspace UI restored, the binding moves to the one per-session extension
 * point dsh offers on a row — `sidebar.workspaces.session.row.action`, the
 * hover strip beside the stock archive and pin buttons. The button names the
 * device the session runs on (or 本机), and its dropdown rebinds or unbinds
 * through the same route the old dialog used.
 */

import { createElement, useState, useSyncExternalStore, type CSSProperties, type ReactElement } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SshClientService } from './service.js'

/** What the row-action registration injects. */
export interface SessionDeviceSeat {
  readonly ssh: SshClientService
}

type Props = SessionDeviceSeat & PropsRuntime<'sidebar.workspaces.session.row.action'> & PropsLocale<'dshellSsh'>

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  maxWidth: 96,
  padding: '1px 6px',
  borderRadius: 4,
  border: '1px solid var(--dsw-border, transparent)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 11,
  lineHeight: '16px',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  zIndex: 40,
  minWidth: 132,
  padding: 4,
  borderRadius: 8,
  border: '1px solid var(--dsw-border, transparent)',
  background: 'var(--dsw-menu-bg, Canvas)',
  boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
}

const rowStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '4px 8px',
  borderRadius: 4,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  textAlign: 'left',
  cursor: 'pointer',
}

/** One hover-strip button: the session's device, with a rebind dropdown. */
export function DshellSessionDeviceButton({ ssh, sessionId, t }: Props): ReactElement {
  const [open, setOpen] = useState(false)
  const snapshot = useSyncExternalStore(ssh.subscribe, ssh.getSnapshot)
  const key = String(sessionId)
  const binding = snapshot.bindings.find(row => row.sessionId === key)
  const device = binding === undefined
    ? undefined
    : snapshot.devices.find(row => row.id === binding.deviceId)
  const choose = (deviceId: string | null): void => {
    setOpen(false)
    void ssh.bind(key, deviceId).catch(() => { /* the card and row republish */ })
  }
  return createElement('div', { style: { position: 'relative', display: 'inline-flex' } },
    createElement('button', {
      type: 'button',
      style: buttonStyle,
      title: t('bind.title'),
      onClick: () => setOpen(was => !was),
    }, device?.name ?? t('bind.local')),
    open
      ? createElement('div', { style: panelStyle, role: 'menu' },
          createElement('button', {
            type: 'button',
            role: 'menuitem',
            style: rowStyle,
            onClick: () => { choose(null) },
          }, t('bind.local')),
          ...snapshot.devices.map(row => createElement('button', {
            type: 'button',
            role: 'menuitem',
            key: row.id,
            style: rowStyle,
            onClick: () => { choose(row.id) },
          }, row.name)),
        )
      : null,
  )
}
