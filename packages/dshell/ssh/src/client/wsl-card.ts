/**
 * The 管理台's WSL card: the distributions this machine could run shells in.
 *
 * A distribution is a BUILT-IN device — it appears with detection, carries no
 * credential, and cannot be edited or deleted — so it reads badly inside the
 * SSH registry card, whose rows are about credentials and whose actions are
 * refusals here. This card is the distro's own surface: what was detected,
 * whether it answers, and the one direction a reader can take (bind a
 * session from the creation page).
 */

import { createElement, useState, type CSSProperties, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useSyncExternalStore } from 'react'
import type {} from './locales.js'
import type { SshClientService } from './service.js'

const cardStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-primary, #333)',
  borderRadius: 10,
  padding: '12px 14px',
  background: 'var(--dsw-alias-bg-secondary, transparent)',
}

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left',
  color: 'inherit',
}

const headTextStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
}

const descStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  opacity: 0.64,
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 0',
  borderTop: '1px solid var(--dsw-alias-border-primary, #333)',
  fontSize: 13,
}

const actionStyle: CSSProperties = {
  fontSize: 12,
  padding: '3px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid var(--dsw-alias-border-primary, #444)',
  background: 'transparent',
  color: 'inherit',
}

const hintStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.6,
  opacity: 0.64,
  marginTop: 8,
}

/** The card header's chrome, matching the sibling cards. */
const titleStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: '22px',
  color: 'var(--dsw-alias-label-primary)',
}

/** The WSL distributions, as the 管理台's own card. */
export function DshellWslCard(
  { ssh, t }: PropsLocale<'dshellSsh'> & { readonly ssh: SshClientService },
): ReactElement {
  const [open, setOpen] = useState(false)
  const snapshot = useSyncExternalStore(ssh.subscribe, ssh.getSnapshot)
  const distros = snapshot.devices.filter(device => device.auth === 'wsl')
  return createElement('div', { style: cardStyle },
    createElement('button', {
      type: 'button', style: headStyle, 'aria-expanded': open,
      onClick: () => { setOpen(value => !value) },
    },
      createElement('span', { style: headTextStyle },
        createElement('span', { style: titleStyle }, t('admin.card.wsl')),
        createElement('span', { style: descStyle },
          distros.length === 0
            ? t('wsl.empty')
            : t('wsl.summary', {
              count: distros.length,
              names: distros.map(d => d.name.replace(/^wsl:/, '')).join(t('card.nameSeparator')),
            })),
      ),
      createElement('span', { style: { transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' } }, '▾'),
    ),
    open
      ? createElement('div', { style: { paddingTop: 4 } },
        ...distros.map(device => createElement('div', { key: device.id, style: rowStyle },
          createElement('span', { style: { flex: 1 } },
            `${device.name.replace(/^wsl:/, '')} · ${device.user}@${device.host}`),
          createElement('button', {
            type: 'button', style: actionStyle, title: t('device.testTooltip'),
            onClick: () => { void ssh.test(device.id).catch(() => {}) },
          }, t('device.test')),
        )),
        createElement('div', { style: hintStyle }, t('wsl.hint')),
      )
      : null,
  )
}
