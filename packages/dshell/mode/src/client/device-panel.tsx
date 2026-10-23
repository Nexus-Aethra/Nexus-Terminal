/**
 * The device panel: what is running on the machine this session is bound to.
 *
 * Four pages, because a reader opens the panel for one question and the other
 * three lists are noise until asked for: 概览 (the machine and its load),
 * 进程, 容器, 监听端口.
 *
 * The list pages are TOOLS, not a readout: a machine with two hundred
 * processes and forty sockets cannot be read by scrolling, so each one can be
 * filtered by what the reader knows (a name, a port, an owner) and ordered by
 * any of its columns, with a second column breaking the first one's ties.
 * A row opens to show what the list cannot fit: the whole command line, the
 * owner, the state, how long it has been running.
 *
 * The heads and the rows are ONE grid: when they are two layouts, the columns
 * drift apart and a reader who aims at "CPU" sorts by memory.
 *
 * The load is NOT asked for again: the status chip polls it, the panel reads
 * the same answer, and two readers of one machine cost one round trip.
 *
 * What is drawn is decided elsewhere ({@link devicePanelView}): this file is
 * layout, and the decisions it would otherwise make are the ones that can be
 * wrong.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { DisclosureRow, Input, SegmentedTabs, Tag, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the right-Sidebar SlotMap merge (the tab-body seat + its hooks).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { deviceDetailSeat } from './device-detail.js'
import { deviceMetricsSeat } from './device-metrics.js'
import {
  devicePanelView,
  filterContainerRows,
  filterPortRows,
  filterProcessRows,
  nextSort,
  sortContainerRows,
  sortPortRows,
  sortProcessRows,
  type ContainerSortKey,
  type DevicePanelContainerRow,
  type DevicePanelPage,
  type DevicePanelPortRow,
  type DevicePanelProcessRow,
  type DevicePanelStat,
  type PortSortKey,
  type ProcessSortKey,
  type SortKey,
} from './device-panel-view.js'
import { DeviceGlyph } from './device-definition.js'
import { DEVICE_NOTE_KEYS } from './locales.js'
import type {} from './locales.js'

/** The panel's composed props: the tab it draws, and its copy. */
export type DevicePanelProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'dshellMode'>

/**
 * The columns of each list, as ONE grid.
 *
 * The heads and the rows share it, so a column is where its head says it is
 * and a click on the head reaches the column it names.
 */
const PROCESS_COLUMNS = '44px minmax(0, 1fr) 50px 50px'
const PORT_COLUMNS = '38px 48px minmax(0, 1fr) minmax(0, 110px)'
const CONTAINER_COLUMNS = 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, auto)'

const styles = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    flex: 1,
    overflow: 'hidden',
    fontSize: 13,
    lineHeight: 1.4,
  } as CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 28,
    padding: '2px 8px',
    flex: '0 0 auto',
  } as CSSProperties,
  headerGlyph: {
    display: 'inline-flex',
    alignItems: 'center',
    color: 'var(--dsw-alias-label-secondary)',
  } as CSSProperties,
  headerSpacer: { flex: '1 1 auto' } as CSSProperties,
  iconButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    padding: 0,
    border: 'none',
    borderRadius: 5,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    opacity: 0.8,
  } as CSSProperties,
  pages: {
    padding: '8px 8px 4px',
    flex: '0 0 auto',
  } as CSSProperties,
  body: {
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    padding: '4px 8px 12px',
  } as CSSProperties,
  /** The machine block: the kind, the name, the endpoint. */
  machine: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    padding: '10px 0 14px',
  } as CSSProperties,
  machineTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  } as CSSProperties,
  /** The label above the name: small, tracked out, quiet. */
  eyebrow: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'var(--dsw-alias-label-tertiary)',
    opacity: 0.6,
  } as CSSProperties,
  /** The machine's name: the largest thing on the page, and it says so. */
  machineName: {
    fontSize: 20,
    fontWeight: 600,
    lineHeight: 1.15,
    letterSpacing: -0.4,
    color: 'var(--dsw-alias-label-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  endpoint: {
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    fontSize: 12,
    color: 'var(--dsw-alias-label-tertiary)',
  } as CSSProperties,
  /** The load: three readouts, framed by the pane's hairlines. */
  load: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
    padding: '13px 0 15px',
    borderTop: '0.5px solid var(--dsw-alias-border-l3)',
    borderBottom: '0.5px solid var(--dsw-alias-border-l3)',
  } as CSSProperties,
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    minWidth: 0,
  } as CSSProperties,
  statLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: 'var(--dsw-alias-label-tertiary)',
  } as CSSProperties,
  statValue: {
    fontSize: 16,
    fontWeight: 500,
    lineHeight: 1.2,
    color: 'var(--dsw-alias-label-primary)',
  } as CSSProperties,
  statDetail: {
    fontSize: 10,
    color: 'var(--dsw-alias-label-quaternary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  /** A group of rows: a foldable header, then the rows themselves. */
  group: { marginTop: 10 } as CSSProperties,
  hint: {
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    fontSize: 10,
    letterSpacing: 0.4,
    color: 'var(--dsw-alias-label-quaternary)',
  } as CSSProperties,
  /** The filter line above a list. */
  filter: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 0 4px',
  } as CSSProperties,
  /** The column heads: what the list can be ordered by. */
  heads: {
    display: 'grid',
    alignItems: 'center',
    gap: 8,
    padding: '2px 0 4px',
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: 'var(--dsw-alias-label-quaternary)',
  } as CSSProperties,
  head: {
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    letterSpacing: 'inherit',
    textTransform: 'inherit',
    padding: 0,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    minWidth: 0,
  } as CSSProperties,
  headOn: { color: 'var(--dsw-alias-label-secondary)' } as CSSProperties,
  /** One row of a list: flat, a hairline under it, 24px tall. */
  row: {
    display: 'grid',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
    padding: '2px 0',
    borderBottom: '0.5px solid var(--dsw-alias-border-l3)',
    // A row is a button, not a paragraph: a drag across it should not paint
    // the text blue.
    userSelect: 'none',
  } as CSSProperties,
  rowOpen: {
    background: 'var(--dsw-alias-interactive-bg-hover)',
  } as CSSProperties,
  rowLast: {
    borderBottom: 'none',
  } as CSSProperties,
  mono: {
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    fontSize: 11,
  } as CSSProperties,
  cell: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  number: {
    textAlign: 'right',
  } as CSSProperties,
  dim: { color: 'var(--dsw-alias-label-tertiary)' } as CSSProperties,
  good: { color: 'var(--dsw-alias-state-business-primary)' } as CSSProperties,
  /** The process holding a socket: a link, because it leads somewhere. */
  holder: {
    border: 'none',
    background: 'transparent',
    color: 'var(--dsw-alias-label-primary)',
    font: 'inherit',
    padding: 0,
    cursor: 'pointer',
    textAlign: 'right',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  /** The container's state, with the dot that says whether it is healthy. */
  stateWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    justifyContent: 'flex-end',
    minWidth: 0,
  } as CSSProperties,
  stateDot: {
    flex: '0 0 auto',
    width: 5,
    height: 5,
    borderRadius: 3,
    background: 'var(--dsw-alias-state-business-primary)',
  } as CSSProperties,
  /** The details a row opens to show. */
  details: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    padding: '2px 0 8px 22px',
    fontSize: 11,
    color: 'var(--dsw-alias-label-tertiary)',
  } as CSSProperties,
  detailLine: {
    display: 'flex',
    gap: 6,
    alignItems: 'baseline',
  } as CSSProperties,
  detailKey: {
    flex: '0 0 auto',
    minWidth: 52,
    color: 'var(--dsw-alias-label-quaternary)',
  } as CSSProperties,
  detailValue: {
    fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
    color: 'var(--dsw-alias-label-secondary)',
    wordBreak: 'break-all',
  } as CSSProperties,
  note: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    fontSize: 12,
    color: 'var(--dsw-alias-label-secondary)',
    opacity: 0.7,
  } as CSSProperties,
  noteDot: {
    flex: '0 0 auto',
    marginTop: 6,
    width: 4,
    height: 4,
    borderRadius: 2,
    background: 'var(--dsw-alias-label-quaternary)',
  } as CSSProperties,
  empty: {
    padding: '8px 0',
    fontSize: 12,
    color: 'var(--dsw-alias-label-tertiary)',
    opacity: 0.6,
  } as CSSProperties,
  error: {
    padding: '6px 0',
    fontSize: 12,
    color: 'var(--dsw-alias-state-error-primary)',
  } as CSSProperties,
}

/**
 * Row-hover treatment.
 *
 * Inline styles cannot express `:hover`, and a highlighted row is most of
 * what tells a reader which line the pointer is on — so one packaged style
 * element carries it, scoped to this panel's own data attributes so it cannot
 * affect stock chrome. The rows' resting background lives here too: a
 * stylesheet `:hover` rule cannot override an inline declaration.
 */
function injectHoverCss(): () => void {
  const style = document.createElement('style')
  style.dataset.dshell = 'device-panel'
  style.textContent = [
    '[data-dshell-device-row] { background: transparent; transition: background 100ms ease; }',
    '[data-dshell-device-row]:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  ].join('\n')
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** One readout of the load: a label, a number, the fact underneath. */
function Stat({ stat, t }: { stat: DevicePanelStat; t: DevicePanelProps['t'] }): ReactNode {
  return (
    <div style={styles.stat}>
      <span style={styles.statLabel}>{t(stat.label)}</span>
      <span style={styles.statValue}>{stat.value}</span>
      {stat.detail === undefined
        ? null
        : (
          <span style={styles.statDetail}>
            {stat.label === 'device.load.cpu' ? `${stat.detail} ${t('device.load.cores')}` : stat.detail}
          </span>
        )}
    </div>
  )
}

/** A search glyph for the filter line. */
function SearchGlyph(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
      <circle cx="6.6" cy="6.6" r="4.6" />
      <path d="M10.2 10.2L14 14" />
    </svg>
  )
}

/**
 * A column head that sorts.
 *
 * The order is shown on the head itself: the first key is marked `1`, the one
 * breaking its ties `2`, and the arrow says which way that key runs.
 */
function SortHead<K extends string>({ label, keys, key, onSort, align }: {
  label: string
  keys: readonly SortKey<K>[]
  key: K
  onSort: (key: K, shift: boolean) => void
  align?: 'right' | undefined
}): ReactNode {
  const index = keys.findIndex(entry => entry.key === key)
  const entry = index === -1 ? undefined : keys[index]
  return (
    <button
      type="button"
      style={{
        ...styles.head,
        ...(entry === undefined ? {} : styles.headOn),
        // The head fills its column, so aiming at the column is aiming at the
        // head; the text inside it is what decides which way the text sits.
        ...(align === 'right' ? { justifyContent: 'flex-end' } : {}),
      }}
      onClick={(event) => { onSort(key, event.shiftKey) }}
    >
      <span>{label}</span>
      {entry === undefined
        ? null
        : (
          <>
            <span style={styles.hint}>{String(index + 1)}</span>
            <span>{entry.direction === 'asc' ? '↑' : '↓'}</span>
          </>
        )}
    </button>
  )
}

/** How long a process has been running, in the reader's language. */
function elapsedText(seconds: number | undefined, t: DevicePanelProps['t']): string {
  if (seconds === undefined) return '—'
  if (seconds < 60) return t('device.process.elapsed.seconds', { seconds })
  if (seconds < 3600) return t('device.process.elapsed.minutes', { minutes: Math.floor(seconds / 60) })
  if (seconds < 86_400) return t('device.process.elapsed.hours', { hours: Math.floor(seconds / 3600) })
  return t('device.process.elapsed.days', { days: Math.floor(seconds / 86_400) })
}

/** A row of the process list: pid, command, and the two shares. */
function ProcessRow({ row, open, onOpen, last, t }: {
  row: DevicePanelProcessRow
  open: boolean
  onOpen: (pid: number) => void
  last: boolean
  t: DevicePanelProps['t']
}): ReactNode {
  return (
    <>
      <div
        data-dshell-device-row="process"
        style={{
          ...styles.row,
          gridTemplateColumns: PROCESS_COLUMNS,
          ...(open ? styles.rowOpen : {}),
          ...(last ? styles.rowLast : {}),
        }}
        onClick={() => { onOpen(row.pid) }}
      >
        <span style={{ ...styles.mono, ...styles.dim, ...styles.cell }}>{String(row.pid)}</span>
        <span style={styles.cell}>{row.command}</span>
        <span style={{ ...styles.mono, ...styles.number }}>{`${row.cpu.toFixed(1)}%`}</span>
        <span style={{ ...styles.mono, ...styles.number, ...styles.dim }}>{`${row.memory.toFixed(1)}%`}</span>
      </div>
      {open
        ? (
          <div style={styles.details}>
            <div style={styles.detailLine}>
              <span style={styles.detailKey}>{t('device.process.detail.user')}</span>
              <span style={styles.detailValue}>{row.user === '' ? '—' : row.user}</span>
            </div>
            <div style={styles.detailLine}>
              <span style={styles.detailKey}>{t('device.process.detail.state')}</span>
              <span style={styles.detailValue}>{row.state === '' ? '—' : row.state}</span>
            </div>
            <div style={styles.detailLine}>
              <span style={styles.detailKey}>{t('device.process.detail.elapsed')}</span>
              <span style={styles.detailValue}>{elapsedText(row.elapsedSeconds, t)}</span>
            </div>
            <div style={styles.detailLine}>
              <span style={styles.detailKey}>{t('device.process.detail.ppid')}</span>
              <span style={styles.detailValue}>{String(row.ppid)}</span>
            </div>
            <div style={styles.detailLine}>
              <span style={styles.detailKey}>{t('device.process.detail.args')}</span>
              <span style={styles.detailValue}>{row.args}</span>
            </div>
          </div>
        )
        : null}
    </>
  )
}

/** A row of the container list: name, image, and the runtime's own word. */
function ContainerRow({ row, last }: {
  row: DevicePanelContainerRow
  last: boolean
}): ReactNode {
  return (
    <div
      data-dshell-device-row="container"
      style={{
        ...styles.row,
        gridTemplateColumns: CONTAINER_COLUMNS,
        ...(last ? styles.rowLast : {}),
      }}
    >
      <span style={{ ...styles.cell, fontWeight: 500 }}>{row.name}</span>
      <span style={{ ...styles.mono, ...styles.dim, ...styles.cell }}>{row.image}</span>
      <span style={styles.stateWrap}>
        <span style={styles.stateDot} />
        <span style={{ ...styles.mono, ...styles.good }}>{row.state}</span>
      </span>
    </div>
  )
}

/**
 * A row of the port list: the transport, the port, and who holds it.
 *
 * The holder is a LINK, not a word: the first question about a port is who
 * holds it, and the process list is where the answer is read.
 */
function PortRow({ row, last, onHold }: {
  row: DevicePanelPortRow
  last: boolean
  onHold: (name: string) => void
}): ReactNode {
  return (
    <div
      data-dshell-device-row="port"
      style={{
        ...styles.row,
        gridTemplateColumns: PORT_COLUMNS,
        ...(last ? styles.rowLast : {}),
      }}
    >
      <span style={{ ...styles.mono, ...styles.dim }}>{row.proto}</span>
      <span style={{ ...styles.mono }}>{String(row.port)}</span>
      <span style={{ ...styles.mono, ...styles.dim, ...styles.cell }}>{row.address}</span>
      {row.processName === ''
        ? <span style={{ ...styles.mono, ...styles.cell, textAlign: 'right', opacity: 0.5 }}>—</span>
        : (
          <button
            type="button"
            style={{ ...styles.holder, ...styles.mono }}
            onClick={() => { onHold(row.processName) }}
          >
            {row.processName}
          </button>
        )}
    </div>
  )
}

/** What the panel's body needs, so it can be drawn without a browser. */
export interface DevicePanelBodyProps {
  /** What the host said about the session's machine. */
  readonly view: import('./device-panel-view.js').DevicePanelView | undefined
  /** The page on screen. */
  readonly page: DevicePanelPage
  /** The folded sections, by id. */
  readonly folded: ReadonlySet<string>
  /** A page was asked for. */
  readonly onPage: (page: DevicePanelPage) => void
  /** A section was folded or unfolded. */
  readonly onToggle: (id: string) => void
  /** Ask the host again, now. */
  readonly onRefresh: () => void
  /** The reader's copy. */
  readonly t: DevicePanelProps['t']
}

/**
 * The panel's body: the drawing, with everything it draws already decided.
 * @param props - the view, the state, and the copy.
 * @returns the panel's content.
 */
export function DshellDevicePanelBody({ view, page, folded, onPage, onToggle, onRefresh, t }: DevicePanelBodyProps): ReactNode {
  // The rows' hover lives in a stylesheet, because inline styles cannot say
  // `:hover`.
  useEffect(injectHoverCss, [])

  // What the reader typed, and how the lists are ordered. Both live here
  // rather than in the host: the host's job is to say what the machine is
  // doing, and the reader's questions are the reader's.
  const [processQuery, setProcessQuery] = useState('')
  const [processSort, setProcessSort] = useState<readonly SortKey<ProcessSortKey>[]>([{ key: 'cpu', direction: 'desc' }])
  const [portQuery, setPortQuery] = useState('')
  const [portSort, setPortSort] = useState<readonly SortKey<PortSortKey>[]>([{ key: 'port', direction: 'asc' }])
  const [containerQuery, setContainerQuery] = useState('')
  const [containerSort, setContainerSort] = useState<readonly SortKey<ContainerSortKey>[]>([{ key: 'name', direction: 'asc' }])
  const [expandedPid, setExpandedPid] = useState<number | undefined>(undefined)

  const pages = useMemo<readonly [SegmentedTab<DevicePanelPage>, ...SegmentedTab<DevicePanelPage>[]]>(() => ([
    { id: 'overview', value: 'overview', label: t('device.page.overview'), panelId: 'dshell-device-page-overview' },
    { id: 'processes', value: 'processes', label: t('device.page.processes'), panelId: 'dshell-device-page-processes' },
    { id: 'containers', value: 'containers', label: t('device.page.containers'), panelId: 'dshell-device-page-containers' },
    { id: 'ports', value: 'ports', label: t('device.page.ports'), panelId: 'dshell-device-page-ports' },
  ]), [t])

  const processes = view?.processes ?? []
  const containers = view?.containers ?? []
  const ports = view?.ports ?? []
  const notes = view?.notes ?? []

  const shownProcesses = useMemo(
    () => sortProcessRows(filterProcessRows(processes, processQuery), processSort),
    [processes, processQuery, processSort],
  )
  const shownPorts = useMemo(
    () => sortPortRows(filterPortRows(ports, portQuery, 'all'), portSort),
    [ports, portQuery, portSort],
  )
  const shownContainers = useMemo(
    () => sortContainerRows(filterContainerRows(containers, containerQuery), containerSort),
    [containers, containerQuery, containerSort],
  )

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.headerGlyph}><DeviceGlyph size={16} /></span>
        <span style={styles.headerSpacer} />
        <button
          type="button"
          style={styles.iconButton}
          title={t('device.refresh')}
          aria-label={t('device.refresh')}
          onClick={() => { onRefresh() }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" strokeLinecap="round" />
            <path d="M13.5 2.5V5H11" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div style={styles.pages}>
        <SegmentedTabs items={pages} value={page} onChange={onPage} label={t('device.title')} />
      </div>

      <div style={styles.body}>
        {view?.error !== undefined
          ? <div style={styles.error}>{view.error}</div>
          : null}

        {view === undefined
          ? <div style={styles.empty}>{t('device.pending')}</div>
          : (
            <>
              {page === 'overview'
                ? (
                  <div id="dshell-device-page-overview">
                    <div style={styles.machine}>
                      <div style={styles.machineTop}>
                        <span style={styles.eyebrow}>{t('device.section.machine')}</span>
                        <Tag tone="outline">
                          {view.machine.onDevice ? t('device.machine.device') : t('device.machine.local')}
                        </Tag>
                      </div>
                      <div style={styles.machineName}>{view.machine.name ?? t('device.machine.local')}</div>
                      {view.machine.endpoint === undefined
                        ? null
                        : <div style={styles.endpoint}>{view.machine.endpoint}</div>}
                    </div>

                    <div style={styles.load}>
                      {view.load.map(stat => <Stat key={stat.label} stat={stat} t={t} />)}
                    </div>

                    {notes.length === 0
                      ? null
                      : (
                        <div style={styles.group}>
                          <DisclosureRow
                            icon={null}
                            title={t('device.section.status')}
                            open={!folded.has('status')}
                            expandable
                            expandOnRowClick
                            onToggle={() => { onToggle('status') }}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 0 6px 22px' }}>
                              {notes.map(note => (
                                <div key={note} style={styles.note}>
                                  <span style={styles.noteDot} />
                                  <span>{t(DEVICE_NOTE_KEYS[note])}</span>
                                </div>
                              ))}
                            </div>
                          </DisclosureRow>
                        </div>
                      )}
                  </div>
                )
                : null}

              {page === 'processes'
                ? (
                  <div id="dshell-device-page-processes" style={styles.group}>
                    <div style={styles.filter}>
                      <Input
                        icon={<SearchGlyph />}
                        value={processQuery}
                        placeholder={t('device.filter.placeholder')}
                        aria-label={t('device.filter.placeholder')}
                        onChange={(event) => { setProcessQuery(event.target.value) }}
                      />
                    </div>
                    <DisclosureRow
                      icon={null}
                      title={`${t('device.section.processes')} ${String(processes.length)}`}
                      headerAccessory={<span style={styles.hint}>{t('device.hint.pidCmd')}</span>}
                      open={!folded.has('processes')}
                      expandable
                      expandOnRowClick
                      onToggle={() => { onToggle('processes') }}
                    >
                      <div style={{ ...styles.heads, gridTemplateColumns: PROCESS_COLUMNS }}>
                        <SortHead label={t('device.column.pid')} keys={processSort} key="pid" onSort={(key, shift) => { setProcessSort(nextSort(processSort, key, shift)) }} />
                        <SortHead label={t('device.column.command')} keys={processSort} key="name" onSort={(key, shift) => { setProcessSort(nextSort(processSort, key, shift)) }} />
                        <SortHead label={t('device.column.cpu')} keys={processSort} key="cpu" align="right" onSort={(key, shift) => { setProcessSort(nextSort(processSort, key, shift)) }} />
                        <SortHead label={t('device.column.memory')} keys={processSort} key="memory" align="right" onSort={(key, shift) => { setProcessSort(nextSort(processSort, key, shift)) }} />
                      </div>
                      {shownProcesses.length === 0
                        ? <div style={styles.empty}>{t('device.list.empty')}</div>
                        : shownProcesses.map((row, index) => (
                          <ProcessRow
                            key={String(row.pid)}
                            row={row}
                            open={expandedPid === row.pid}
                            onOpen={(pid) => { setExpandedPid(current => current === pid ? undefined : pid) }}
                            last={index === shownProcesses.length - 1}
                            t={t}
                          />
                        ))}
                    </DisclosureRow>
                  </div>
                )
                : null}

              {page === 'containers'
                ? (
                  <div id="dshell-device-page-containers" style={styles.group}>
                    <div style={styles.filter}>
                      <Input
                        icon={<SearchGlyph />}
                        value={containerQuery}
                        placeholder={t('device.filter.placeholder')}
                        aria-label={t('device.filter.placeholder')}
                        onChange={(event) => { setContainerQuery(event.target.value) }}
                      />
                    </div>
                    <DisclosureRow
                      icon={null}
                      title={`${t('device.section.containers')} ${String(containers.length)}`}
                      headerAccessory={<span style={styles.hint}>{t('device.hint.nameState')}</span>}
                      open={!folded.has('containers')}
                      expandable
                      expandOnRowClick
                      onToggle={() => { onToggle('containers') }}
                    >
                      <div style={{ ...styles.heads, gridTemplateColumns: CONTAINER_COLUMNS }}>
                        <SortHead label={t('device.column.name')} keys={containerSort} key="name" onSort={(key, shift) => { setContainerSort(nextSort(containerSort, key, shift)) }} />
                        <SortHead label={t('device.column.image')} keys={containerSort} key="image" onSort={(key, shift) => { setContainerSort(nextSort(containerSort, key, shift)) }} />
                        <SortHead label={t('device.column.state')} keys={containerSort} key="state" align="right" onSort={(key, shift) => { setContainerSort(nextSort(containerSort, key, shift)) }} />
                      </div>
                      {shownContainers.length === 0
                        ? <div style={styles.empty}>{t('device.list.empty')}</div>
                        : shownContainers.map((container, index) => (
                          <ContainerRow
                            key={container.name}
                            row={container}
                            last={index === shownContainers.length - 1}
                          />
                        ))}
                    </DisclosureRow>
                  </div>
                )
                : null}

              {page === 'ports'
                ? (
                  <div id="dshell-device-page-ports" style={styles.group}>
                    <div style={styles.filter}>
                      <Input
                        icon={<SearchGlyph />}
                        value={portQuery}
                        placeholder={t('device.filter.placeholder')}
                        aria-label={t('device.filter.placeholder')}
                        onChange={(event) => { setPortQuery(event.target.value) }}
                      />
                    </div>
                    <DisclosureRow
                      icon={null}
                      title={`${t('device.section.ports')} ${String(ports.length)}`}
                      headerAccessory={<span style={styles.hint}>{t('device.hint.portProto')}</span>}
                      open={!folded.has('ports')}
                      expandable
                      expandOnRowClick
                      onToggle={() => { onToggle('ports') }}
                    >
                      <div style={{ ...styles.heads, gridTemplateColumns: PORT_COLUMNS }}>
                        <SortHead label={t('device.column.proto')} keys={portSort} key="proto" onSort={(key, shift) => { setPortSort(nextSort(portSort, key, shift)) }} />
                        <SortHead label={t('device.column.port')} keys={portSort} key="port" onSort={(key, shift) => { setPortSort(nextSort(portSort, key, shift)) }} />
                        <SortHead label={t('device.column.address')} keys={portSort} key="address" onSort={(key, shift) => { setPortSort(nextSort(portSort, key, shift)) }} />
                        <SortHead label={t('device.column.process')} keys={portSort} key="process" align="right" onSort={(key, shift) => { setPortSort(nextSort(portSort, key, shift)) }} />
                      </div>
                      {shownPorts.length === 0
                        ? <div style={styles.empty}>{t('device.list.empty')}</div>
                        : shownPorts.map((row, index) => (
                          <PortRow
                            key={`${row.proto}-${String(row.port)}-${row.address}`}
                            row={row}
                            last={index === shownPorts.length - 1}
                            onHold={(name) => {
                              // The first question about a port is who holds
                              // it, and the process list is where the answer
                              // is read: so the holder leads there, with the
                              // list already narrowed to it.
                              setProcessQuery(name)
                              setExpandedPid(undefined)
                              onPage('processes')
                            }}
                          />
                        ))}
                    </DisclosureRow>
                  </div>
                )
                : null}
            </>
          )}
      </div>
    </div>
  )
}

/**
 * The device panel: the seats, the state, and the body.
 * @param props - the tab's runtime props, the session it belongs to, and its copy.
 * @returns the panel.
 */
export function DshellDevicePanel({ sessionId, t }: DevicePanelProps): ReactNode {
  const subscribe = useCallback((listener: () => void) => deviceDetailSeat.subscribe(listener), [])
  const snapshot = useCallback(() => deviceDetailSeat.getSnapshot(sessionId), [sessionId])
  const answer = useSyncExternalStore(subscribe, snapshot)

  const metrics = useSyncExternalStore(
    deviceMetricsSeat.subscribe,
    useCallback(() => deviceMetricsSeat.getSnapshot().get(sessionId), [sessionId]),
  )

  // The poll follows the reader's own cadence, and only while the panel is on
  // screen: an idle frame must not spend a round trip on a machine that is not
  // this one.
  useEffect(() => deviceDetailSeat.watch(sessionId), [sessionId])

  const [page, setPage] = useState<DevicePanelPage>('overview')
  /** The folded sections, by id. A section that is not in the set is open. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set<string>())
  const toggle = useCallback((id: string): void => {
    setFolded(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const view = devicePanelView(answer, metrics?.metrics)

  return (
    <DshellDevicePanelBody
      // The key resets the reader's filters and ordering when the session
      // changes: they are answers to a question about ONE machine.
      key={sessionId}
      view={view}
      page={page}
      folded={folded}
      onPage={setPage}
      onToggle={toggle}
      onRefresh={() => { deviceDetailSeat.refresh(sessionId) }}
      t={t}
    />
  )
}
