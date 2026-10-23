/**
 * The device panel: what is running on the machine this session is bound to.
 *
 * Four pages, because a reader opens the panel for one question and the other
 * three lists are noise until asked for: 概览 (the machine and its load),
 * 进程, 容器, 监听端口. Every section folds, because a machine with forty
 * processes and thirty-two sockets is a strip, not a page.
 *
 * The overview is a summary first — the machine's name is the largest thing
 * on it, the load is three numbers side by side, and the three lists wait
 * below as folded rows that carry their own counts. The list pages are the
 * opposite: flat rows, monospace identifiers, numbers in their own column.
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
import { DisclosureRow, SegmentedTabs, Tag, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the right-Sidebar SlotMap merge (the tab-body seat + its hooks).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { deviceDetailSeat } from './device-detail.js'
import { deviceMetricsSeat } from './device-metrics.js'
import { devicePanelView, type DevicePanelPage, type DevicePanelStat, type DevicePanelView } from './device-panel-view.js'
import { DeviceGlyph } from './device-definition.js'
import { DEVICE_NOTE_KEYS } from './locales.js'
import type {} from './locales.js'

/** The panel's composed props: the tab it draws, and its copy. */
export type DevicePanelProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<'dshellMode'>

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
  /** The machine block: an eyebrow, the kind, the name, the endpoint. */
  machine: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '10px 0 14px',
  } as CSSProperties,
  machineTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  } as CSSProperties,
  eyebrow: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'var(--dsw-alias-label-tertiary)',
    opacity: 0.6,
  } as CSSProperties,
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
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    color: 'var(--dsw-alias-label-tertiary)',
  } as CSSProperties,
  /** The load: three readouts, separated by hairlines rather than boxes. */
  load: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8,
    padding: '12px 0 14px',
    borderTop: '0.5px solid var(--dsw-alias-border-l3)',
    borderBottom: '0.5px solid var(--dsw-alias-border-l3)',
  } as CSSProperties,
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
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
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 10,
    letterSpacing: 0.4,
    color: 'var(--dsw-alias-label-quaternary)',
  } as CSSProperties,
  /** One row of a list: flat, a hairline under it, 24px tall. */
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
    padding: '2px 0',
    borderBottom: '0.5px solid var(--dsw-alias-border-l3)',
  } as CSSProperties,
  rowLast: {
    borderBottom: 'none',
  } as CSSProperties,
  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11,
  } as CSSProperties,
  grow: {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,
  number: {
    textAlign: 'right',
    flex: '0 0 auto',
    minWidth: 42,
  } as CSSProperties,
  dim: { color: 'var(--dsw-alias-label-tertiary)' } as CSSProperties,
  good: { color: 'var(--dsw-alias-state-business-primary)' } as CSSProperties,
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

/**
 * A chevron for a row that GOES somewhere.
 *
 * dshell's own icon set has no chevron-right, and a row that switches page is
 * not a disclosure — so it carries a mark of its own, drawn in the same 1px
 * stroke as the rest of the panel's artwork.
 */
function ChevronRight({ size = 14 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3.5L10.5 8L6 12.5" />
    </svg>
  )
}

/** A row of the process list: pid, command, and the two shares. */
function ProcessRow({ pid, command, cpu, memory, last }: {
  pid: string
  command: string
  cpu: string
  memory: string
  last: boolean
}): ReactNode {
  return (
    <div style={last ? { ...styles.row, ...styles.rowLast } : styles.row}>
      <span style={{ ...styles.mono, ...styles.dim, flex: '0 0 auto' }}>{pid}</span>
      <span style={styles.grow}>{command}</span>
      <span style={{ ...styles.mono, ...styles.number }}>{cpu}</span>
      <span style={{ ...styles.mono, ...styles.number, ...styles.dim }}>{memory}</span>
    </div>
  )
}

/** A row of the container list: name, image, and the runtime's own word. */
function ContainerRow({ name, image, state, last }: {
  name: string
  image: string
  state: string
  last: boolean
}): ReactNode {
  return (
    <div style={last ? { ...styles.row, ...styles.rowLast } : styles.row}>
      <span style={{ ...styles.grow, fontWeight: 500 }}>{name}</span>
      <span style={{ ...styles.mono, ...styles.dim, ...styles.grow }}>{image}</span>
      <span style={{ ...styles.mono, ...styles.good, flex: '0 0 auto' }}>{state}</span>
    </div>
  )
}

/** A row of the port list: the transport, the port, the address it is bound to. */
function PortRow({ proto, port, address, last }: {
  proto: string
  port: string
  address: string
  last: boolean
}): ReactNode {
  return (
    <div style={last ? { ...styles.row, ...styles.rowLast } : styles.row}>
      <span style={{ ...styles.mono, ...styles.dim, flex: '0 0 auto', width: 26 }}>{proto}</span>
      <span style={{ ...styles.mono, flex: '0 0 auto' }}>{port}</span>
      <span style={{ ...styles.mono, ...styles.dim, ...styles.grow }}>{address}</span>
    </div>
  )
}

/**
 * The device panel's body.
 * @param props - the tab's runtime props, the session it belongs to, and its copy.
 * @returns the panel.
 */
/** What the panel's body needs, so it can be drawn without a browser. */
export interface DevicePanelBodyProps {
  /** What the host said about the session's machine. */
  readonly view: DevicePanelView | undefined
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

                    <DisclosureRow
                      icon={<ChevronRight />}
                      title={`${t('device.section.processes')} ${String(processes.length)}`}
                      headerAccessory={<span style={styles.hint}>{t('device.hint.pidCmd')}</span>}
                      open={false}
                      expandable={false}
                      onToggle={() => { onPage('processes') }}
                    />
                    <DisclosureRow
                      icon={<ChevronRight />}
                      title={`${t('device.section.containers')} ${String(containers.length)}`}
                      headerAccessory={<span style={styles.hint}>{t('device.hint.nameState')}</span>}
                      open={false}
                      expandable={false}
                      onToggle={() => { onPage('containers') }}
                    />
                    <DisclosureRow
                      icon={<ChevronRight />}
                      title={`${t('device.section.ports')} ${String(ports.length)}`}
                      headerAccessory={<span style={styles.hint}>{t('device.hint.portProto')}</span>}
                      open={false}
                      expandable={false}
                      onToggle={() => { onPage('ports') }}
                    />
                  </div>
                )
                : null}

              {page === 'processes'
                ? (
                  <div id="dshell-device-page-processes" style={styles.group}>
                    <DisclosureRow
                      icon={null}
                      title={`${t('device.section.processes')} ${String(processes.length)}`}
                      headerAccessory={<span style={styles.hint}>{t('device.hint.pidCmd')}</span>}
                      open={!folded.has('processes')}
                      expandable
                      expandOnRowClick
                      onToggle={() => { onToggle('processes') }}
                    >
                      {processes.length === 0
                        ? <div style={styles.empty}>{t('device.list.empty')}</div>
                        : processes.map((process, index) => (
                          <ProcessRow
                            key={process.pid}
                            pid={process.pid}
                            command={process.command}
                            cpu={process.cpu}
                            memory={process.memory}
                            last={index === processes.length - 1}
                          />
                        ))}
                    </DisclosureRow>
                  </div>
                )
                : null}

              {page === 'containers'
                ? (
                  <div id="dshell-device-page-containers" style={styles.group}>
                    <DisclosureRow
                      icon={null}
                      title={`${t('device.section.containers')} ${String(containers.length)}`}
                      headerAccessory={<span style={styles.hint}>{t('device.hint.nameState')}</span>}
                      open={!folded.has('containers')}
                      expandable
                      expandOnRowClick
                      onToggle={() => { onToggle('containers') }}
                    >
                      {containers.length === 0
                        ? <div style={styles.empty}>{t('device.list.empty')}</div>
                        : containers.map((container, index) => (
                          <ContainerRow
                            key={container.name}
                            name={container.name}
                            image={container.image}
                            state={container.state}
                            last={index === containers.length - 1}
                          />
                        ))}
                    </DisclosureRow>
                  </div>
                )
                : null}

              {page === 'ports'
                ? (
                  <div id="dshell-device-page-ports" style={styles.group}>
                    <DisclosureRow
                      icon={null}
                      title={`${t('device.section.ports')} ${String(ports.length)}`}
                      headerAccessory={<span style={styles.hint}>{t('device.hint.portProto')}</span>}
                      open={!folded.has('ports')}
                      expandable
                      expandOnRowClick
                      onToggle={() => { onToggle('ports') }}
                    >
                      {ports.length === 0
                        ? <div style={styles.empty}>{t('device.list.empty')}</div>
                        : ports.map((port, index) => (
                          <PortRow
                            key={`${port.proto}-${port.port}-${port.address}`}
                            proto={port.proto}
                            port={port.port}
                            address={port.address}
                            last={index === ports.length - 1}
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
