/**
 * The dshell-ssh card in the Plugins settings section: the device list and the
 * form that adds one.
 *
 * It follows the section's card shape (header disclosure, collapsed first) and
 * needs no save button for the list itself — every action posts immediately —
 * but the add/edit form is staged, because a half-typed host must not be
 * committed by a stray keystroke.
 */

import {
  createElement, useState, useSyncExternalStore,
  type CSSProperties, type ChangeEvent, type ReactElement,
} from 'react'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DshellSshKey } from './locales.js'
import type { DeviceAuth, DeviceHelperStatus, DeviceView } from '../protocol.js'
import type { SshClientService } from './service.js'
// Type-only: pulls this namespace's key merge (`PropsLocale<'dshellSsh'>`).
import type {} from './locales.js'

const cardStyle: CSSProperties = {
  listStyle: 'none',
  border: '0.5px solid var(--dsw-alias-border-l4)',
  borderRadius: 16,
  background: 'var(--dsw-alias-bg-layer-3)',
  transition: 'border-color .16s, background .16s',
}
const openCardStyle: CSSProperties = {
  background: 'var(--dsw-alias-bg-layer-2)',
  borderColor: 'var(--dsw-alias-label-dimmed)',
}
const headerStyle: CSSProperties = {
  width: '100%', appearance: 'none', border: 0, background: 'none', font: 'inherit',
  color: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex',
  alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12,
}
const headTextStyle: CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }
const descStyle: CSSProperties = {
  fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)', opacity: 0.7,
}
const bodyStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px 16px' }
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
  // Wrapping is what makes the helper line below work: it carries
  // `flexBasis: 100%`, and in a nowrap line that basis competes with the row's
  // own children instead of starting a second line — the actions were squeezed
  // until their labels broke one character per line.
  flexWrap: 'wrap',
  padding: '8px 10px', borderRadius: 10, background: 'var(--dsw-alias-bg-module-platform)',
}
const rowTitleStyle: CSSProperties = {
  flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
/** The row's actions, kept on one line whatever the device name costs. */
const actionGroupStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
}
const actionStyle: CSSProperties = {
  border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer',
  // An action keeps its own measure: the title already ellipsizes, so there is
  // nothing to gain by letting these shrink, and a shrunken one wraps its
  // label instead of truncating it.
  whiteSpace: 'nowrap', flexShrink: 0,
  fontSize: 12, opacity: 0.75, padding: '2px 6px', borderRadius: 6,
}
const helperStyle: CSSProperties = {
  // `minWidth: 0` lets the line shrink to the row, and `anywhere` breaks the
  // path/digest run: a helper path is one long unbreakable token, and without
  // both it painted straight past the card's edge.
  flexBasis: '100%', minWidth: 0, overflowWrap: 'anywhere',
  fontSize: 11, lineHeight: '16px', opacity: 0.65, padding: '2px 4px 0',
}
const formStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }
const fieldStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--dsw-alias-bg-module-platform)',
  border: '0.5px solid var(--dsw-alias-border-l4)', borderRadius: 8, color: 'inherit',
  padding: '7px 9px', fontSize: 13, outline: 'none',
}
const keyStyle: CSSProperties = { ...fieldStyle, gridColumn: '1 / -1', minHeight: 72, fontFamily: 'monospace', fontSize: 12 }
const noteStyle: CSSProperties = { fontSize: 12, opacity: 0.65, gridColumn: '1 / -1' }
/** The test result: two lines (what answered, then the host key) worth keeping apart. */
const resultStyle: CSSProperties = {
  ...noteStyle, whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
}
const errorStyle: CSSProperties = { fontSize: 12, color: '#f87171', gridColumn: '1 / -1' }
const primaryStyle: CSSProperties = {
  border: 'none', background: 'var(--dsw-alias-brand-primary, #4f6bed)', color: '#fff',
  cursor: 'pointer', borderRadius: 8, padding: '7px 14px', fontSize: 13, gridColumn: '2 / -1', justifySelf: 'end',
}

/** Disclosure chevron, drawn to match the sibling cards without importing dsh icons. */
function Chevron({ open }: { open: boolean }): ReactElement {
  return createElement('svg', {
    width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true,
    style: {
      flex: '0 0 auto', opacity: 0.7, transition: 'transform .16s ease',
      transform: open ? 'rotate(180deg)' : 'none',
    } as CSSProperties,
  }, createElement('path', {
    d: 'M4 6.5 L8 10.5 L12 6.5', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
  }))
}

/**
 * The blank form's state. `secret` holds whichever credential the selected
 * login method uses; switching methods clears it, so a key pasted for one
 * method is never submitted as a password (or the reverse).
 */
const BLANK = {
  id: undefined as string | undefined,
  name: '', host: '', port: '22', user: '', remoteRoot: '',
  auth: 'key' as DeviceAuth,
  secret: '',
}

/** Sliding segmented control: two labels, one highlight that follows the pick. */
function AuthSwitch(props: {
  value: DeviceAuth
  disabled: boolean
  t: TranslateNS<'dshellSsh'>
  onChange: (next: DeviceAuth) => void
}): ReactElement {
  const options: readonly { id: DeviceAuth; label: string }[] = [
    { id: 'key', label: props.t('auth.key') },
    { id: 'password', label: props.t('auth.password') },
  ]
  return createElement('div', {
    style: {
      position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0,
      border: '0.5px solid var(--dsw-alias-border-l4)', borderRadius: 999, padding: 2,
      background: 'var(--dsw-alias-bg-module-platform)', gridColumn: '1 / -1',
    },
  },
    createElement('div', {
      'aria-hidden': true,
      style: {
        position: 'absolute', top: 2, bottom: 2, left: 2, width: 'calc(50% - 2px)',
        borderRadius: 999, background: 'var(--dsw-alias-bg-layer-3)',
        border: '0.5px solid var(--dsw-alias-border-l4)',
        transition: 'transform .16s ease',
        transform: props.value === 'password' ? 'translateX(100%)' : 'none',
      },
    }),
    ...options.map(option => createElement('button', {
      key: option.id,
      type: 'button',
      'aria-pressed': props.value === option.id,
      disabled: props.disabled,
      onClick: () => { props.onChange(option.id) },
      style: {
        position: 'relative', zIndex: 1, border: 'none', background: 'transparent',
        color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: 13, padding: '6px 0',
        opacity: props.value === option.id ? 1 : 0.7,
      },
    }, option.label)),
  )
}

/** Login-method field label. */
const labelStyle: CSSProperties = { fontSize: 12, opacity: 0.7, gridColumn: '1 / -1', marginBottom: -4 }

/**
 * The card's composed props: the device service this package injects into the
 * slot, plus the framework-synthesized `t` seat for the declared namespace.
 */
export type DshellSshCardProps = { ssh: SshClientService } & PropsLocale<'dshellSsh'>

export function DshellSshCard(props: DshellSshCardProps): ReactElement {
  const { ssh, t } = props
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK)
  const snapshot = useSyncExternalStore(ssh.subscribe, ssh.getSnapshot)
  const edit = (field: keyof typeof BLANK, value: string): void => {
    setForm(current => ({ ...current, [field]: value }))
  }
  const pickAuth = (next: DeviceAuth): void => {
    setForm(current => ({ ...current, auth: next, secret: '' }))
  }
  const submit = (): void => {
    void ssh.save({
      ...form.id === undefined ? {} : { id: form.id },
      name: form.name,
      host: form.host,
      port: Number(form.port) > 0 ? Number(form.port) : 22,
      user: form.user,
      remoteRoot: form.remoteRoot,
      auth: form.auth,
      // Omitted keeps the stored secret; an empty box on a NEW device also
      // means "none" (key auth then uses the harness user's own ssh agent).
      ...form.secret.trim() === '' ? {} : form.auth === 'password'
        ? { password: form.secret }
        : { key: form.secret },
    })
    setForm(BLANK)
  }
  const loadIntoForm = (device: DeviceView): void => {
    setForm({
      id: device.id,
      name: device.name,
      host: device.host,
      port: String(device.port),
      user: device.user,
      remoteRoot: device.remoteRoot,
      auth: device.auth,
      secret: '',
    })
  }

  return createElement('li', {
    style: open ? { ...cardStyle, ...openCardStyle } : cardStyle,
    'data-dshell-card': 'ssh',
  },
    createElement('button', {
      type: 'button', style: headerStyle, 'aria-expanded': open,
      onClick: () => { setOpen(value => !value) },
    },
      createElement('span', { style: headTextStyle },
        createElement('span', {
          style: { fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' },
        }, t('card.title')),
        createElement('span', { style: descStyle },
          snapshot.devices.length === 0
            ? t('card.empty')
            : t('card.summary', {
              count: snapshot.devices.length,
              names: snapshot.devices.map(d => d.name).join(t('card.nameSeparator')),
            })),
      ),
      createElement(Chevron, { open }),
    ),
    open
      ? createElement('div', { style: bodyStyle },
        ...snapshot.devices.map(device => createElement('div', { key: device.id, style: rowStyle },
          createElement('span', { style: rowTitleStyle },
            `${device.name} · ${device.user}@${device.host}:${String(device.port)}`
            + ` · ${t('device.login', {
              method: device.auth === 'password' ? t('auth.password') : t('auth.key'),
            })}${device.hasSecret ? '' : t('device.noSecret')}`),
          // The actions travel as one unit. Flex breaks lines before it
          // shrinks anything, so four loose buttons let a long device name
          // push the last one onto its own line; grouped and unshrinkable,
          // they always stay together and the title does the yielding.
          createElement('div', { style: actionGroupStyle },
            createElement('button', {
              type: 'button', style: actionStyle, title: t('device.testTooltip'),
              // The refusal is published on the snapshot, which this card
              // renders; catching it here keeps a deliberate refusal from also
              // looking like an unhandled failure in the console.
              onClick: () => { void ssh.test(device.id).catch(() => {}) },
            }, t('device.test')),
            createElement('button', {
              type: 'button', style: actionStyle, title: t('device.installTooltip'),
              onClick: () => { void ssh.install(device.id).catch(() => {}) },
            }, t('device.install')),
            createElement('button', {
              type: 'button', style: actionStyle, title: t('device.edit'),
              onClick: () => { loadIntoForm(device) },
            }, t('device.edit')),
            createElement('button', {
              type: 'button', style: actionStyle, title: t('device.remove'),
              onClick: () => { void ssh.remove(device.id) },
            }, t('device.remove')),
          ),
          device.helper !== undefined
            ? createElement('div', {
              style: helperStyle,
              // The tooltip carries the whole result — the on-device path and
              // both digests. It is diagnostic, so it belongs where a reader
              // goes looking for it rather than on the row.
              title: helperDetail(device.helper),
            }, helperLine(t, device.helper))
            : null,
        )),
        createElement('div', { style: formStyle },
          createElement('input', {
            style: fieldStyle, placeholder: t('form.namePlaceholder'),
            value: form.name,
            onChange: (event: ChangeEvent<HTMLInputElement>) => { edit('name', event.target.value) },
          }),
          createElement('input', {
            style: fieldStyle, placeholder: t('form.hostPlaceholder'),
            value: form.host,
            onChange: (event: ChangeEvent<HTMLInputElement>) => { edit('host', event.target.value) },
          }),
          createElement('input', {
            style: fieldStyle, placeholder: t('form.portPlaceholder'),
            value: form.port,
            onChange: (event: ChangeEvent<HTMLInputElement>) => { edit('port', event.target.value) },
          }),
          createElement('input', {
            style: fieldStyle, placeholder: t('form.userPlaceholder'),
            value: form.user,
            onChange: (event: ChangeEvent<HTMLInputElement>) => { edit('user', event.target.value) },
          }),
          createElement('input', {
            style: fieldStyle, placeholder: t('form.remoteRootPlaceholder'),
            value: form.remoteRoot,
            onChange: (event: ChangeEvent<HTMLInputElement>) => { edit('remoteRoot', event.target.value) },
          }),
          createElement('div', { style: noteStyle }, t('form.remoteRootNote')),
          createElement('div', { style: labelStyle }, t('form.authLabel')),
          createElement(AuthSwitch, { value: form.auth, disabled: false, t, onChange: pickAuth }),
          form.auth === 'password'
            ? createElement('input', {
              style: fieldStyle,
              type: 'password',
              placeholder: t('form.passwordPlaceholder'),
              value: form.secret,
              autoComplete: 'new-password',
              onChange: (event: ChangeEvent<HTMLInputElement>) => { edit('secret', event.target.value) },
            })
            : createElement('textarea', {
              style: keyStyle,
              placeholder: t('form.keyPlaceholder'),
              value: form.secret,
              onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { edit('secret', event.target.value) },
            }),
          createElement('div', { style: noteStyle },
            form.auth === 'password' ? t('form.passwordNote') : t('form.keyNote')),
          snapshot.error !== undefined ? createElement('div', { style: errorStyle }, snapshot.error) : null,
          snapshot.testResult !== undefined ? createElement('div', { style: resultStyle }, snapshot.testResult) : null,
          createElement('button', {
            type: 'button',
            style: primaryStyle,
            disabled: form.host.trim() === '' || form.user.trim() === '',
            onClick: submit,
          }, form.id === undefined ? t('form.submitAdd') : t('form.submitSave')),
        ),
      )
      : null,
  )
}

/** Pick the right key per state, since template-literal keys are not typed. */
function helperLabel(
  t: (key: DshellSshKey) => string,
  state: 'absent' | 'present' | 'mismatch',
): string {
  return t(`device.helperState.${state}` as DshellSshKey)
}

/**
 * The helper line the row shows.
 *
 * A successful deployment shows only its label: `已部署到 <path>` restates the
 * label and then spends the line on a path, which is what a reader needs only
 * when something is wrong. Every other state shows its reason, because that is
 * the part that tells the reader what to do next.
 * @param t - this card's bound copy.
 * @param status - the recorded deployment status.
 * @returns the one-line summary.
 */
function helperLine(
  t: (key: DshellSshKey) => string,
  status: DeviceHelperStatus,
): string {
  const label = helperLabel(t, status.state)
  return status.state === 'present' ? label : `${label} · ${status.message}`
}

/**
 * The diagnostic behind one helper status, for the line's tooltip: the result
 * verbatim plus the on-device path and both digests, whichever the check
 * recorded. Composed from the fields rather than reusing `message`, so the
 * visible line can stay short without dropping anything a reader might need.
 * @param status - the recorded deployment status.
 * @returns one block of text, one fact per line.
 */
function helperDetail(status: DeviceHelperStatus): string {
  return [
    status.message,
    ...status.path === undefined ? [] : [status.path],
    ...status.expected === undefined ? [] : [`expected ${status.expected}`],
    ...status.onDevice === undefined ? [] : [`on device ${status.onDevice}`],
  ].join('\n')
}
