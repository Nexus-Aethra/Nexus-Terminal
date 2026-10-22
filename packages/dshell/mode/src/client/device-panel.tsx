/**
 * The device panel: what is running on the machine this session is bound to.
 *
 * The panel answers one question in five rows: the machine, how loaded it is,
 * its processes, its containers, its sockets. The first two are the machine's
 * identity and its load — the load comes from the seat the status chip already
 * keeps, so the panel does not ask a second time for it. The last three are
 * what the host asked the device for, in ONE round trip, and they are the
 * seed the port forwarding will grow from: a forward needs the ports, and the
 * ports are the first thing a panel can show.
 *
 * Every list says what it could not read. A machine with no container runtime
 * has no containers, and a reader must be able to tell that from a machine
 * whose containers were never asked for.
 *
 * What is drawn is decided elsewhere ({@link devicePanelView}): this file is
 * layout, and the decisions it would otherwise make are the ones that can be
 * wrong.
 */

import { useCallback, useEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the right-Sidebar SlotMap merge (the tab-body seat + its hooks).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { deviceDetailSeat } from './device-detail.js'
import { deviceMetricsSeat } from './device-metrics.js'
import { devicePanelView } from './device-panel-view.js'
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
    gap: 14,
    padding: '10px 12px',
    fontSize: 12,
    lineHeight: 1.5,
  } as CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  } as CSSProperties,
  title: {
    fontWeight: 600,
    fontSize: 13,
  } as CSSProperties,
  button: {
    background: 'transparent',
    border: '1px solid currentColor',
    borderRadius: 6,
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    opacity: 0.7,
    padding: '2px 8px',
  } as CSSProperties,
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  } as CSSProperties,
  sectionTitle: {
    fontWeight: 600,
    opacity: 0.75,
  } as CSSProperties,
  row: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
    justifyContent: 'space-between',
  } as CSSProperties,
  /** A row of columns rather than of two ends: the cells are read left to right. */
  listRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'baseline',
  } as CSSProperties,
  /** The first cell of a list row, given a width so the columns line up. */
  listCell: {
    minWidth: 54,
    flexShrink: 0,
  } as CSSProperties,
  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11,
  } as CSSProperties,
  note: {
    opacity: 0.6,
  } as CSSProperties,
  error: {
    opacity: 0.85,
  } as CSSProperties,
  empty: {
    opacity: 0.5,
  } as CSSProperties,
}

/** One section's rows, or the reason it has none. */
function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

/** A row: a label on the left, a value on the right. */
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactNode {
  return (
    <div style={styles.row}>
      <span style={mono === true ? styles.mono : undefined}>{label}</span>
      <span style={mono === true ? styles.mono : undefined}>{value}</span>
    </div>
  )
}

/**
 * The device panel's body.
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

  const view = devicePanelView(answer, metrics?.metrics)

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <span style={styles.title}>{t('device.title')}</span>
        <button
          type="button"
          style={styles.button}
          onClick={() => { deviceDetailSeat.refresh(sessionId) }}
        >
          {t('device.refresh')}
        </button>
      </div>

      {view?.error !== undefined
        ? <div style={styles.error}>{view.error}</div>
        : null}

      {view === undefined
        ? <div style={styles.empty}>{t('device.pending')}</div>
        : (
          <>
            <Section title={t('device.section.machine')}>
              {view.machine.map(field => (
                <Row
                  key={field.label}
                  label={t(field.label)}
                  value={field.label === 'device.machine.kind'
                    ? (view.onDevice ? t('device.machine.device') : t('device.machine.local'))
                    : field.value}
                  mono={field.label === 'device.machine.endpoint'}
                />
              ))}
            </Section>

            <Section title={t('device.section.load')}>
              {view.load.map(field => (
                <Row
                  key={field.label}
                  label={t(field.label)}
                  value={field.value ?? t('device.load.pending')}
                />
              ))}
            </Section>

            <Section title={t('device.section.processes')}>
              {view.processes.length === 0
                ? <div style={styles.empty}>{t('device.list.empty')}</div>
                : view.processes.map(process => (
                  <div key={process.pid} style={styles.listRow}>
                    <span style={{ ...styles.mono, ...styles.listCell }}>{process.pid}</span>
                    <span style={styles.mono}>{process.command}</span>
                    <span style={styles.mono}>{process.cpu}</span>
                    <span style={styles.mono}>{process.memory}</span>
                  </div>
                ))}
            </Section>

            <Section title={t('device.section.containers')}>
              {view.containers.length === 0
                ? <div style={styles.empty}>{t('device.list.empty')}</div>
                : view.containers.map(container => (
                  <div key={`${container.name}-${container.image}`} style={styles.listRow}>
                    <span style={{ ...styles.mono, ...styles.listCell }}>{container.name}</span>
                    <span style={styles.mono}>{container.image}</span>
                    <span style={styles.mono}>{container.state}</span>
                  </div>
                ))}
            </Section>

            <Section title={t('device.section.ports')}>
              {view.ports.length === 0
                ? <div style={styles.empty}>{t('device.list.empty')}</div>
                : view.ports.map(port => (
                  // The address is part of the key: a machine may listen on the
                  // same port on several addresses, and those are different
                  // sockets.
                  <div key={`${port.proto}-${port.port}-${port.address}`} style={styles.listRow}>
                    <span style={{ ...styles.mono, ...styles.listCell }}>{port.proto}</span>
                    <span style={styles.mono}>{port.port}</span>
                    <span style={styles.mono}>{port.address}</span>
                  </div>
                ))}
            </Section>

            {view.notes.length === 0
              ? null
              : view.notes.map(note => (
                <div key={note} style={styles.note}>{t(DEVICE_NOTE_KEYS[note])}</div>
              ))}
          </>
        )}
    </div>
  )
}
