/**
 * Flat session browser: dshell's replacement for the workspace-grouped list
 * (design 4.7), plus the session actions built on the package's own
 * session-panel route.
 *
 * Two sections: ordinary sessions newest-first, then `待删除` for the ones
 * whose removal is already scheduled (they are archived too, and leave at the
 * next start because dsh cannot tear a loaded session down).
 *
 * There is no `已归档` group any more. Archiving still happens here — the row
 * action — but the archived set is upstream's, and so is its one restore
 * surface: dsh's archived-session settings page. Keeping a second list here
 * would mean two places showing the same set, which is exactly the drift this
 * profile had before the set became upstream's. Deleting is the destructive
 * action and always goes through a confirmation dialog.
 *
 * The section's chrome is deliberately quiet: rows are plain lines on the
 * background, and the row actions only appear on hover, so the list reads as
 * a session list rather than a toolbar.
 */

import {
  Fragment, createElement, useEffect, useState, useSyncExternalStore,
  type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactElement,
} from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSource } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SshSnapshot } from '@nexus-aethra/dshell-ssh/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls this namespace's key set (PropsLocale<'dshellWorkspace'>).
import type {} from './locales.js'
import type { SessionPanelClient } from './panel.js'
import { newSessionDialog } from './dialog-store.js'
import { NewSessionDialog } from './new-session-dialog.js'
import { ordinaryRows, type PresetChoice, type SessionRow } from './rows.js'
import {
  mutedRowStyle, backdropStyle, cancelButtonStyle, dangerButtonStyle, dialogActionsStyle,
  dialogBodyStyle, dialogErrorStyle, dialogStyle, dialogTitleStyle, emptyStyle, groupCountStyle,
  groupHeaderStyle, groupNoteStyle, headerStyle, listStyle, newButtonStyle, noticeStyle, rowActionStyle,
  rowActionsStyle, rowStyle, rowTitleStyle, scrollStyle, sshBadgeStyle,
} from './list-styles.js'

/** The device face another plugin provides, when the SSH plugin is composed. */
export interface DeviceSeat {
  getSnapshot: () => SshSnapshot
  subscribe: (listener: () => void) => () => void
  /** Registered devices, for the new-session picker. */
  devices: () => readonly { id: string; name: string; remoteRoot: string }[]
  /** Assign a created session to a device (null keeps it local). */
  bind: (
    sessionId: SessionId,
    deviceId: string | null,
    remoteRoot?: string | null,
    mount?: string | null,
  ) => Promise<void>
  /** Local mount directory for one device tree; undefined when the host refused. */
  mountFor: (deviceId: string, remoteRoot: string | null) => Promise<string | undefined>
  /**
   * Prove a device before a session is created: one ssh round trip plus the
   * session's remote directory. Refuses by throwing.
   */
  test: (deviceId: string, remoteRoot: string | null) => Promise<void>
  /** Whether a directory is a device mount, which a local session must not adopt. */
  isMountPath: (path: string) => boolean
  /**
   * Take the user to the SSH plugin's settings card. Used when the picker has
   * nothing to offer; returns false when the settings entry could not be found,
   * so the dialog can say where to go instead.
   */
  revealSettings: () => boolean
}

/** Props the sidebar slot injects into the flat session list. */
export interface FlatSessionListProps {
  sessions: {
    getSnapshot: () => SessionListState
    subscribe: (listener: () => void) => () => void
  }
  panel: SessionPanelClient
  /**
   * Upstream's workspace snapshot, read for its archive set: a session in it
   * leaves the active section. The list itself is empty in this profile —
   * dshell registers no workspaces (design 4.7).
   */
  workspaces: WorkspaceSource
  /** Put a session away; the stock archived-session settings page undoes it. */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Restore a session. Reached from 待删除: unarchiving is what cancels a
   * scheduled purge, so it is the one restore this list still offers.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /** Present only when the SSH plugin is part of the composition. */
  device?: DeviceSeat | undefined
  /**
   * Cross-session pipe entry, present only when dshell-buffer is composed.
   * Absent, the header keeps the new-session button it replaces.
   */
  pipe?: { toggle: () => void } | undefined
  /** Re-read the host session list (after a purge removed a log). */
  refresh: () => Promise<void>
  createSession(
    name: string | undefined,
    cwd: string | undefined,
    presetId: string | undefined,
  ): Promise<SessionId>
  listPresets: () => Promise<PresetChoice[]>
  open(sessionId: SessionId): void
}

/**
 * Composed props of this slot entry: the inject face above plus the
 * framework-injected locale seat (`locale: NS` on the registration).
 */
export type FlatSessionListBodyProps = FlatSessionListProps & PropsLocale<'dshellWorkspace'>

/** Empty device snapshot, so the list renders before the SSH plugin answers. */
const NO_DEVICES: SshSnapshot = {
  devices: [], bindings: [], testResult: undefined, error: undefined, helper: undefined, loaded: false,
}

/** Stable no-op subscription for a composition without the SSH plugin. */
function noopSubscribe(): () => void {
  return () => {}
}

/**
 * Row-action hover rule. Inline styles cannot express `:hover`, and the action
 * buttons must not reserve space in a 13px row, so one packaged style element
 * reveals them. Scoped to dshell's own data attributes, so it cannot affect
 * stock chrome.
 */
function injectListCss(): () => void {
  const style = document.createElement('style')
  style.dataset.dshell = 'session-list'
  style.textContent = [
    '[data-dshell-row-actions] { opacity: 0; transition: opacity .12s ease; }',
    '[data-dshell-row]:hover [data-dshell-row-actions], [data-dshell-row-actions]:focus-within { opacity: 1; }',
    '[data-dshell-row]:hover { background: rgba(127,127,127,.08); }',
  ].join('\n')
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** Chevron for a collapsible group: one glyph, rotated when open. */
function Chevron({ open }: { open: boolean }): ReactElement {
  return createElement('span', {
    style: {
      display: 'inline-block',
      transition: 'transform .12s ease',
      transform: open ? 'rotate(90deg)' : 'none',
      fontSize: 11,
    } as CSSProperties,
  }, '›')
}

/** One row's visible label, with the running marker the list has always used. */
function rowLabel(row: SessionRow): string {
  return `${row.running ? '● ' : ''}${row.displayTitle}`
}

/** Delete confirmation; the purge is irreversible, so it always asks. */
function DeleteDialog(props: {
  title: string
  busy: boolean
  error: string | undefined
  onCancel: () => void
  onConfirm: () => void
  /** This package's bound translate, threaded from the list. */
  t: TranslateNS<'dshellWorkspace'>
}): ReactElement {
  return createElement('div', {
    style: backdropStyle,
    onClick: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget && !props.busy) props.onCancel()
    },
  },
    createElement('div', { style: dialogStyle, onClick: (event: ReactMouseEvent<HTMLDivElement>) => { event.stopPropagation() } },
      createElement('div', { style: dialogTitleStyle }, props.t('dialog.delete.title')),
      createElement('div', { style: dialogBodyStyle },
        props.t('dialog.delete.body', { title: props.title }),
        createElement('div', { style: { marginTop: 6, opacity: 0.75 } },
          props.t('dialog.delete.note'))),
      props.error !== undefined ? createElement('div', { style: dialogErrorStyle }, props.error) : null,
      createElement('div', { style: dialogActionsStyle },
        createElement('button', {
          style: cancelButtonStyle,
          disabled: props.busy,
          onClick: props.onCancel,
        }, props.t('dialog.delete.cancel')),
        createElement('button', {
          style: dangerButtonStyle,
          disabled: props.busy,
          onClick: props.onConfirm,
        }, props.busy ? props.t('dialog.delete.busy') : props.t('dialog.delete.confirm')),
      ),
    ))
}

export function FlatSessionList(props: FlatSessionListBodyProps): ReactElement {
  const t = props.t
  const state = useSyncExternalStore(props.sessions.subscribe, props.sessions.getSnapshot)
  const dialogOpen = useSyncExternalStore(newSessionDialog.subscribe, newSessionDialog.getSnapshot)
  const archive = useSyncExternalStore(props.workspaces.subscribe, props.workspaces.getSnapshot)
  const panel = useSyncExternalStore(props.panel.subscribe, props.panel.getSnapshot)
  const deviceSeat = props.device
  const ssh = useSyncExternalStore(
    deviceSeat?.subscribe ?? noopSubscribe,
    deviceSeat?.getSnapshot ?? (() => NO_DEVICES),
  )
  /**
   * Whether a session runs on a device rather than on this machine.
   *
   * A missing device row counts as local: a binding that names a device the
   * registry no longer holds is a dangling assignment, not an ssh session, and
   * marking it would tell the user to expect a remote shell that cannot come up.
   */
  const isDeviceSession = (sessionId: SessionId): boolean => {
    const binding = ssh.bindings.find(entry => entry.sessionId === String(sessionId))
    if (binding === undefined) return false
    return ssh.devices.some(candidate => candidate.id === binding.deviceId)
  }

  /**
   * A row's leading content: the `SSH` badge for a device session, then the
   * title. A fragment, so both become direct children of the row — which is
   * already the flex line that spaces them — rather than nesting a second flex
   * box inside it. Both sections use this, so an archived ssh session stays
   * recognisable as one.
   *
   * The badge is the whole marking: no device name and no path. The row's job
   * is to identify the session and say which kind it is, and a host plus a
   * remote root is neither — it is a fact about the device, which the SSH
   * settings card and the connection screen already own.
   */
  const rowMain = (row: SessionRow, suffix = ''): ReactElement => {
    return createElement(Fragment, null,
      isDeviceSession(row.id)
        ? createElement('span', { style: sshBadgeStyle }, 'SSH')
        : null,
      createElement('span', { style: rowTitleStyle }, `${rowLabel(row)}${suffix}`),
    )
  }
  const [pendingOpen, setPendingOpen] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<{ id: SessionId; title: string } | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined)

  useEffect(injectListCss, [])
  useEffect(() => { void props.panel.load() }, [props.panel])

  const rows = ordinaryRows(state)
  const byId = new Map(rows.map(row => [String(row.id), row]))
  // A pending id can outlive the row it names (the log was removed outside
  // dshell), so the section falls back to the bare id instead of dropping it.
  const taggedRow = (id: string): SessionRow => byId.get(id) ?? {
    id: id as SessionId,
    cwd: undefined,
    blank: false,
    origin: undefined,
    running: false,
    displayTitle: id,
    updatedAt: 0,
  } satisfies SessionRow

  const pendingRows = panel.pending.map(taggedRow)
  // Hidden from the active section by two facts, because they arrive from two
  // owners: the archive set is the workspace registry's, while the scheduled
  // purge is this package's own route. A pending id is archived too, so the
  // union is what keeps a session from showing up in both.
  const hidden = new Set([...archive.archivedSessionIds.map(String), ...panel.pending])
  const active = rows.filter(row => !hidden.has(String(row.id)))

  /**
   * Drop a scheduled purge. The restore command runs on upstream's registry and
   * cannot touch this package's own qualifier, so the set is re-read here — and
   * the ordinary archive write path never has to, because dshell never marks a
   * session pending without also having written it into the sidebar's view.
   */
  const cancelPending = async (id: SessionId): Promise<void> => {
    try {
      await props.unarchiveSession(id)
    } finally {
      await props.panel.load()
    }
  }

  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === undefined || deleting) return
    setDeleting(true)
    setDeleteError(undefined)
    // Deleting the session on stage would leave the shell pointing at a
    // session dshell just released, so step off it first. A shell with no
    // other session lands in a fresh blank one, the same target the new-
    // session affordance uses.
    if (state.current === deleteTarget.id) {
      const next = active.find(row => row.id !== deleteTarget.id)
      if (next === undefined) await props.createSession(undefined, undefined, undefined)
      else props.open(next.id)
    }
    const refusal = await props.panel.remove(String(deleteTarget.id))
    setDeleting(false)
    if (refusal !== undefined) {
      setDeleteError(refusal)
      return
    }
    setDeleteTarget(undefined)
    await props.refresh()
  }

  const children = [
    createElement(
      'div',
      { key: 'header', style: headerStyle },
      createElement('span', null, t('header.sessions', { count: active.length })),
      // The stock shell already offers new-session creation, so this header
      // slot carries the cross-session pipe entry instead. A composition
      // without dshell-buffer keeps the original new-session button.
      props.pipe === undefined
        ? createElement(
          'button',
          { style: newButtonStyle, onClick: () => { newSessionDialog.set(true) } },
          t('header.new'),
        )
        : createElement(
          'button',
          { style: newButtonStyle, title: t('pipe.title'), onClick: props.pipe.toggle },
          t('pipe.label'),
        ),
    ),
    createElement('div', { key: 'rows', style: scrollStyle },
      active.length === 0
        ? createElement('div', {
          key: 'empty',
          'data-dshell-row': 'empty',
          style: emptyStyle,
        }, rows.length === 0 ? t('empty.none') : t('empty.allArchived'))
        : null,
      ...active.map((row) => {
        const selected = state.current === row.id
        return createElement('div', {
          key: row.id,
          'data-dshell-row': 'session',
          style: { ...rowStyle, fontWeight: selected ? 600 : 400, opacity: selected ? 1 : 0.8 },
          onClick: () => { props.open(row.id) },
        },
          rowMain(row),
          // Both row actions live here because the archived group is gone: it
          // used to hold the only 删除 affordance, and restoring a session is
          // no longer this list's business. Putting a session away and erasing
          // it are the two things a row can still do.
          createElement('span', { 'data-dshell-row-actions': 'session', style: rowActionsStyle },
            createElement('button', {
              style: rowActionStyle,
              title: t('row.archive.title'),
              onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                void props.archiveSession(row.id)
              },
            }, t('row.archive')),
            createElement('button', {
              style: rowActionStyle,
              title: t('row.delete.title'),
              onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                setDeleteError(undefined)
                setDeleteTarget({ id: row.id, title: row.displayTitle })
              },
            }, t('row.delete')),
          ),
        )
      }),
      // The scheduled-removal section, last: these sessions are past archiving,
      // and dsh removes their logs at the next start (it cannot tear a loaded
      // session down), so the group's meaning has to be on its header rather
      // than inferred from one row's suffix.
      pendingRows.length === 0 ? null : createElement('div', { key: 'pending-group' },
        createElement('div', {
          'data-dshell-row': 'pending-header',
          style: groupHeaderStyle,
          onClick: () => { setPendingOpen(open => !open) },
        },
          createElement(Chevron, { open: pendingOpen }),
          createElement('span', null, t('group.pending')),
          createElement('span', { style: groupNoteStyle }, t('group.pending.note')),
          createElement('span', { style: groupCountStyle }, String(pendingRows.length)),
        ),
        ...pendingOpen
          ? pendingRows.map((row) => {
            return createElement('div', {
              key: `pending-${row.id}`,
              'data-dshell-row': 'pending',
              style: { ...mutedRowStyle, fontWeight: state.current === row.id ? 600 : 400 },
              onClick: () => { props.open(row.id) },
            },
              rowMain(row),
              // Removal is already committed, so cancelling is the only action
              // left: it drops the scheduled purge and returns the session to
              // the active list, the same gesture unarchiving performs.
              createElement('span', { 'data-dshell-row-actions': 'pending', style: rowActionsStyle },
                createElement('button', {
                  style: rowActionStyle,
                  title: t('row.cancel.title'),
                  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                    event.stopPropagation()
                    void cancelPending(row.id)
                  },
                }, t('row.cancel')),
              ),
            )
          })
          : [],
      ),
      panel.error === undefined ? null : createElement('div', { key: 'notice', style: noticeStyle }, panel.error),
    ),
  ]
  return createElement('div', { style: listStyle }, children,
    dialogOpen
      ? createElement(NewSessionDialog, {
        key: 'dialog',
        t,
        // The most recent real session's directory, but never a device mount:
        // a mount is an empty stand-in for a device tree, and dsh's own default
        // inherits the CURRENT session's directory, so offering one here is how
        // a session labelled "本机" ends up inside a device's mount.
        defaultCwd: rows.find(row => !row.blank && row.cwd !== undefined
          && deviceSeat?.isMountPath(row.cwd) !== true)?.cwd,
        createSession: props.createSession,
        listPresets: props.listPresets,
        ...deviceSeat === undefined ? {} : {
          devices: deviceSeat.devices(),
          bind: deviceSeat.bind,
          mountFor: deviceSeat.mountFor,
          test: deviceSeat.test,
          isMountPath: deviceSeat.isMountPath,
          revealSettings: deviceSeat.revealSettings,
        },
      })
      : null,
    deleteTarget === undefined
      ? null
      : createElement(DeleteDialog, {
        key: 'delete',
        title: deleteTarget.title,
        busy: deleting,
        error: deleteError,
        onCancel: () => { setDeleteTarget(undefined); setDeleteError(undefined) },
        onConfirm: () => { void confirmDelete() },
        t,
      }))
}
