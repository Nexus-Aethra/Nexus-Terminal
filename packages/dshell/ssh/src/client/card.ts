/**
 * The dshell-ssh page in the Plugins panel: the device list and the form that
 * adds one.
 *
 * The card shape is the one dsh's settings surfaces use (header disclosure,
 * collapsed first) and needs no save button for the list itself — every action
 * posts immediately — but the add/edit form is staged, because a half-typed
 * host must not be committed by a stray keystroke.
 */

import {
  createElement, useCallback, useEffect, useState, useSyncExternalStore,
  type CSSProperties, type ChangeEvent, type ReactElement,
} from 'react'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { DshellSshKey } from './locales.js'
import type { DeviceAuth, DeviceHelperStatus, DeviceView, SshKeyFile, TrustedHostKey } from '../protocol.js'
import type { SshSnapshot } from './service.js'
import type { SshClientService } from './service.js'
import { VaultCard } from './vault-card.js'
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

/**
 * The key picker: one quiet trigger, and the list only while it is open.
 *
 * A disclosure rather than a `<select>` because the entries are file names, not
 * short labels, and a native select truncates them into indistinguishable
 * `id_…` rows.
 */
const keyPickerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, gridColumn: '1 / -1',
}
const smallActionStyle: CSSProperties = {
  border: '0.5px solid var(--dsw-alias-border-l4)', background: 'transparent',
  color: 'inherit', cursor: 'pointer', borderRadius: 8, padding: '4px 10px', fontSize: 12,
}
const keyListStyle: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 6, gridColumn: '1 / -1',
}
const keyItemStyle: CSSProperties = {
  border: '0.5px solid var(--dsw-alias-border-l4)', background: 'transparent',
  color: 'inherit', cursor: 'pointer', borderRadius: 8, padding: '4px 10px',
  fontSize: 12, fontFamily: 'monospace',
  // A file name is one unbreakable token, and these sit in a wrapped row.
  maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}

/**
 * The group a device's chosen credential lives in, which is what tells the
 * reader whether that device's secret is encrypted at all.
 */
function groupName(
  snapshot: SshSnapshot,
  credentialId: string,
  t: TranslateNS<'dshellSsh'>,
): string {
  const credential = snapshot.credentials.find(candidate => candidate.id === credentialId)
  const group = snapshot.groups.find(candidate => candidate.id === credential?.group)
  if (group === undefined) return t('vault.plain')
  return group.sealed ? group.name : `${group.name} · ${t('vault.plain')}`
}

/** The trust row under a device: label, fingerprint, and the two actions. */
const trustStyle: CSSProperties = {
  flexBasis: '100%', minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
  fontSize: 12, opacity: 0.85,
}
const trustLabelStyle: CSSProperties = { opacity: 0.6 }
const trustValueStyle: CSSProperties = {
  fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  maxWidth: 260,
}
const trustBadgeStyle: CSSProperties = {
  border: '0.5px solid var(--dsw-alias-border-l4)', borderRadius: 999, padding: '1px 7px', opacity: 0.7,
}
const confirmStyle: CSSProperties = {
  flexBasis: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
  border: '1px solid #f87171', borderRadius: 8, padding: '8px 10px', opacity: 1,
}
const dangerActionStyle: CSSProperties = {
  border: '1px solid #f87171', background: 'transparent', color: '#f87171', cursor: 'pointer',
  borderRadius: 8, padding: '3px 10px', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0,
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
  passphrase: '',
  credentialId: '' as string,
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

/** The card's props as the Plugins panel hands them over, including its view. */
export type DshellSshConfigProps = DshellSshCardProps & {
  /** `summary` is the one-liner the panel falls back to; `page` is the card. */
  readonly view?: 'summary' | 'page' | undefined
}

/**
 * The `dshell-ssh` row's configuration page.
 *
 * The panel renders one entry per row it was handed a page for, and asks it
 * twice: once as the row's one-liner (`summary`, used when the package itself
 * carries no description) and once as the page itself. There is no form to
 * stage here — the device registry writes through its own route — so the page
 * is simply the card, which draws its own chrome.
 *
 * @param props - the device service, the locale seat, and which view to draw.
 * @returns the summary line, or the card.
 */
export function DshellSshConfigPage({ view, ...card }: DshellSshConfigProps): ReactElement {
  if (view === 'summary') return createElement('span', null, card.t('row.summary'))
  // Two cards, stacked, each with its own chrome: the device registry and the
  // credential library it draws from. They are one page because a device row
  // that names a credential is unreadable without knowing what is in it.
  return createElement('ul', {
    style: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 },
  },
    createElement(DshellSshCard, card),
    createElement(VaultCard, card),
  )
}

export function DshellSshCard(props: DshellSshCardProps): ReactElement {
  const { ssh, t } = props
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [keys, setKeys] = useState<readonly SshKeyFile[] | undefined>(undefined)
  const [keysOpen, setKeysOpen] = useState(false)
  const snapshot = useSyncExternalStore(ssh.subscribe, ssh.getSnapshot)
  // Fetched once, the first time the picker is opened: the list is the harness
  // user's own `~/.ssh`, it cannot change under the form, and asking for it on
  // every render would make opening the card read the filesystem.
  const loadKeys = (): void => {
    if (keys !== undefined) return
    void ssh.listKeys().then(setKeys)
  }
  const edit = (field: keyof typeof BLANK, value: string): void => {
    setForm(current => ({ ...current, [field]: value }))
  }
  const pickAuth = (next: DeviceAuth): void => {
    setForm(current => ({ ...current, auth: next, secret: '', passphrase: '' }))
  }
  // Choosing a vault credential and typing a secret are mutually exclusive on
  // purpose: a device holding both has two answers to one question, and only the
  // credential gets rotated.
  const pickCredential = (id: string): void => {
    setForm(current => ({
      ...current,
      credentialId: id,
      ...id === '' ? {} : { secret: '', passphrase: '' },
    }))
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
      // Same omitted/empty semantics as the key itself: an untouched box keeps
      // whatever is stored, an emptied one removes it.
      ...form.passphrase === '' ? {} : { passphrase: form.passphrase },
      // Sent even when empty, because clearing the reference is the one way back
      // to an inline secret, and omitting it would mean "leave it alone".
      credentialId: form.credentialId,
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
      passphrase: '',
      credentialId: device.credentialId ?? '',
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
          createElement(HostTrustLine, { device, ssh, t }),
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
          // The vault is offered first whenever it has anything in it. A device
          // pointed at a credential shows which one and how to un-point it,
          // rather than a paste box that would silently be ignored.
          form.credentialId !== ''
            ? createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' } },
              createElement('div', { style: { fontSize: 12 } },
                t('form.usingCredential', {
                  name: snapshot.credentials.find(c => c.id === form.credentialId)?.name ?? form.credentialId,
                  group: groupName(snapshot, form.credentialId, t),
                })),
              createElement('button', {
                type: 'button', style: actionStyle, onClick: () => { pickCredential('') },
              }, t('form.useOwnSecret')),
            )
            : snapshot.credentials.length === 0
              ? null
              : createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, gridColumn: '1 / -1' } },
                createElement('span', { style: { fontSize: 12, opacity: 0.65, flexBasis: '100%' } },
                  t('form.pickCredential')),
                ...snapshot.credentials.map(credential => createElement('button', {
                  key: credential.id,
                  type: 'button',
                  style: keyItemStyle,
                  onClick: () => { pickCredential(credential.id) },
                }, credential.name)),
              ),
          form.credentialId !== ''
            ? null
            : form.auth === 'password'
            ? createElement('input', {
              style: fieldStyle,
              type: 'password',
              placeholder: t('form.passwordPlaceholder'),
              value: form.secret,
              autoComplete: 'new-password',
              onChange: (event: ChangeEvent<HTMLInputElement>) => { edit('secret', event.target.value) },
            })
            : createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              createElement('textarea', {
                style: keyStyle,
                placeholder: t('form.keyPlaceholder'),
                value: form.secret,
                onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { edit('secret', event.target.value) },
              }),
              // Offered here rather than above the box because the box is the
              // fallback: most people keeping a key on disk would rather point at
              // it than paste a blob they then have to keep out of the clipboard.
              createElement('div', { style: keyPickerStyle },
                createElement('button', {
                  type: 'button',
                  style: smallActionStyle,
                  onClick: () => {
                    loadKeys()
                    setKeysOpen(value => !value)
                  },
                }, t('form.keyPick')),
                // Says which of "not asked yet", "asking" and "nothing there"
                // applies, because a trigger that silently does nothing reads as
                // a broken form.
                keys !== undefined && keys.length === 0 && keysOpen
                  ? createElement('span', { style: noteStyle }, t('form.keyPickEmpty'))
                  : null,
              ),
              keysOpen && keys !== undefined && keys.length > 0
                ? createElement('div', { style: keyListStyle },
                  ...keys.map(key => createElement('button', {
                    key: key.path,
                    type: 'button',
                    style: keyItemStyle,
                    title: key.path,
                    onClick: () => {
                      void ssh.readKey(key.path).then((body) => {
                        // A refused read leaves the box exactly as it was: an
                        // emptied secret would be saved as "remove this key".
                        if (body === undefined) return
                        setForm(current => ({ ...current, secret: body }))
                        setKeysOpen(false)
                      })
                    },
                  }, key.name)),
                )
                : null,
              // Only a key can be unlocked, so the box exists only in key mode —
              // a passphrase beside a password is a secret nothing would read.
              form.auth === 'key'
                ? createElement('input', {
                  style: fieldStyle,
                  type: 'password',
                  placeholder: t('form.passphrasePlaceholder'),
                  value: form.passphrase,
                  autoComplete: 'new-password',
                  onChange: (event: ChangeEvent<HTMLInputElement>) => { edit('passphrase', event.target.value) },
                })
                : null,
            ),
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

/**
 * What this plugin trusts for one device, and the way to change that.
 *
 * Its whole point is to be readable BEFORE anything goes wrong. A reader who
 * needs to compare a fingerprint is, by definition, in the middle of something
 * having gone wrong — so a fingerprint that is only shown when a connection
 * fails is a fingerprint nobody has written down.
 *
 * The revoke is two steps because it is irreversible in the one direction that
 * matters: once the record is gone, the next connection trusts whatever answers,
 * with no second look. The confirmation therefore states the consequence rather
 * than asking "are you sure".
 */
function HostTrustLine(props: {
  device: DeviceView
  ssh: SshClientService
  t: TranslateNS<'dshellSsh'>
}): ReactElement {
  const { device, ssh, t } = props
  const [keys, setKeys] = useState<readonly TrustedHostKey[] | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)
  const load = useCallback((): void => {
    void ssh.hostKeys(device.id).then(setKeys)
  }, [device.id, ssh])
  // Asked for on mount rather than on the button: this line is the record of
  // what is trusted, and a row that showed nothing until it was clicked would
  // not be a record.
  useEffect(() => { load() }, [load])
  // A different device is a different trust decision; the panel must not survive it.
  useEffect(() => { setConfirming(false) }, [device.id])

  return createElement('div', { style: trustStyle },
    createElement('span', { style: trustLabelStyle }, t('device.trustLabel')),
    keys === undefined || keys.length === 0
      ? createElement('span', { style: trustValueStyle }, t('device.trustNone'))
      : createElement('span', { style: trustValueStyle, title: keys.map(k => k.fingerprint).join('\n') },
        // One entry is the normal case; several key types on one host would
        // otherwise wrap the row, and the full set stays in the tooltip.
        `${keys[0]?.keyType ?? ''} ${shortFingerprint(keys[0]?.fingerprint)}`),
    device.hasPassphrase === true ? createElement('span', { style: trustBadgeStyle }, t('device.passphrase')) : null,
    createElement('button', {
      type: 'button',
      style: actionStyle,
      disabled: keys === undefined || keys.length === 0,
      onClick: load,
    }, t('device.trustRefresh')),
    createElement('button', {
      type: 'button',
      style: actionStyle,
      disabled: keys === undefined || keys.length === 0,
      onClick: () => { setConfirming(true) },
    }, t('device.trustRevoke')),
    confirming
      ? createElement('span', { style: confirmStyle },
        createElement('span', { style: { flex: '1 1 180px', minWidth: 0 } }, t('device.trustRevokeConfirm')),
        createElement('button', {
          type: 'button',
          style: dangerActionStyle,
          onClick: () => {
            setConfirming(false)
            // Revoke, then re-read: the reply is the state the card renders, so
            // it must be the state the file is in after the change, not a guess.
            void ssh.revokeHostKey(device.id).then(setKeys)
          },
        }, t('device.trustRevokeNow')),
        createElement('button', {
          type: 'button',
          style: actionStyle,
          onClick: () => { setConfirming(false) },
        }, t('device.trustRevokeCancel')),
      )
      : null,
  )
}

/** The tail of a `SHA256:…` fingerprint, which is where its entropy is. */
function shortFingerprint(fingerprint: string | undefined): string {
  if (fingerprint === undefined) return ''
  return fingerprint.length <= 20 ? fingerprint : `…${fingerprint.slice(-19)}`
}

/** Pick the right key per state, since template-literal keys are not typed. */function helperLabel(
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
