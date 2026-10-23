/**
 * What the device panel shows, as data.
 *
 * The panel is a drawing, and a drawing is hard to argue about: the decisions
 * it makes — which machine, which rows, how many decimals, which number is
 * the big one — are the decisions that can be wrong. So they are lifted out of
 * the drawing into a pure function, and what is left is layout.
 *
 * The labels stay in the component: they are words, and the reader's language
 * is not known here. The NUMBERS are language-free, so they are decided here
 * and printed once.
 */

import type { DshellDeviceIdentity, DshellDeviceMetrics, DshellDeviceMetricsResponse } from '../device-metrics-protocol.js'
import type { DshellDeviceDetailResponse } from '../device-detail-protocol.js'
import type { DshellDeviceNoteCode } from '../device-detail-protocol.js'

/** The panel's four pages. */
export type DevicePanelPage = 'overview' | 'processes' | 'containers' | 'ports'

/** The machine a page is about. */
export interface DevicePanelMachine {
  /** Whether the session runs on a device or on this machine. */
  readonly onDevice: boolean
  /** The name the reader gave the device; absent for this machine. */
  readonly name: string | undefined
  /** `user@host:port` for a device; absent for this machine. */
  readonly endpoint: string | undefined
}

/** One readout of the load: the big number, and the smaller fact beside it. */
export interface DevicePanelStat {
  /** What the readout is called, as a locale key the component resolves. */
  readonly label: 'device.load.cpu' | 'device.load.memory' | 'device.load.load1'
  /** The number the panel prints large. */
  readonly value: string
  /** The smaller fact under it — the machine's size, so a share means something. */
  readonly detail: string | undefined
}

/** One process row. */
export interface DevicePanelProcessRow {
  readonly pid: string
  readonly command: string
  readonly cpu: string
  readonly memory: string
}

/** One container row. */
export interface DevicePanelContainerRow {
  readonly name: string
  readonly image: string
  readonly state: string
}

/** One listening socket row. */
export interface DevicePanelPortRow {
  readonly proto: string
  readonly port: string
  readonly address: string
}

/** Everything the panel draws, decided. */
export interface DevicePanelView {
  /** Which machine the session runs on. */
  readonly machine: DevicePanelMachine
  /** The load, as three readouts. */
  readonly load: readonly DevicePanelStat[]
  /** The busiest processes. */
  readonly processes: readonly DevicePanelProcessRow[]
  /** The containers the runtime reports. */
  readonly containers: readonly DevicePanelContainerRow[]
  /** The sockets the machine is listening on. */
  readonly ports: readonly DevicePanelPortRow[]
  /** What could not be read, and why. */
  readonly notes: readonly DshellDeviceNoteCode[]
  /** Why there is no snapshot at all, when the host said so. */
  readonly error: string | undefined
}

/**
 * The load, as the panel prints it.
 *
 * The three readouts are SHARES, because shares are comparable: a percentage
 * of one machine says nothing about how much of it there is, so the machine's
 * size rides along underneath. The load average is already a share of itself
 * and needs no second line.
 */
function loadStats(metrics: DshellDeviceMetrics | undefined): readonly DevicePanelStat[] {
  if (metrics === undefined) {
    return [
      { label: 'device.load.cpu', value: '—', detail: undefined },
      { label: 'device.load.memory', value: '—', detail: undefined },
      { label: 'device.load.load1', value: '—', detail: undefined },
    ]
  }
  const memoryTotal = metrics.memory.total
  const memoryPercent = memoryTotal > 0 ? Math.round(metrics.memory.used / memoryTotal * 100) : undefined
  return [
    {
      label: 'device.load.cpu',
      value: metrics.cpu.used === undefined ? '—' : `${String(Math.round(metrics.cpu.used * 100))}%`,
      // The core COUNT, without its unit: "核" is a word, and this module does
      // not know the reader's language.
      detail: String(metrics.cpu.cores),
    },
    {
      label: 'device.load.memory',
      value: memoryPercent === undefined ? '—' : `${String(memoryPercent)}%`,
      detail: `${(metrics.memory.used / 1024 ** 3).toFixed(1)} / ${(metrics.memory.total / 1024 ** 3).toFixed(1)} GB`,
    },
    {
      label: 'device.load.load1',
      value: metrics.cpu.load1 === undefined ? '—' : metrics.cpu.load1.toFixed(2),
      detail: undefined,
    },
  ]
}

/**
 * The panel's content, for one session's answer.
 *
 * @param answer - what the host said about the session's machine.
 * @param metrics - the load the chip's seat already holds, if any.
 * @returns the rows to draw, or undefined when nothing has been said yet.
 */
export function devicePanelView(
  answer: DshellDeviceDetailResponse | undefined,
  metrics: DshellDeviceMetrics | undefined,
): DevicePanelView | undefined {
  if (answer === undefined) return undefined
  const detail = answer.detail
  if (detail === undefined) {
    return {
      machine: { onDevice: false, name: undefined, endpoint: undefined },
      load: loadStats(metrics),
      processes: [],
      containers: [],
      ports: [],
      notes: [],
      error: answer.error,
    }
  }
  const machine: DevicePanelMachine = {
    onDevice: detail.device.kind === 'device',
    name: detail.device.name,
    endpoint: detail.device.endpoint,
  }
  return {
    machine,
    load: loadStats(metrics),
    processes: detail.processes.map(process => ({
      pid: String(process.pid),
      command: process.command,
      cpu: `${process.cpu.toFixed(1)}%`,
      memory: `${process.memory.toFixed(1)}%`,
    })),
    containers: detail.containers.map(container => ({
      name: container.name,
      image: container.image,
      state: container.state,
    })),
    ports: detail.ports.map(port => ({
      proto: port.proto,
      port: String(port.port),
      address: port.address,
    })),
    notes: detail.notes,
    error: answer.error,
  }
}

/** The load reading of one session, as the seat holds it. */
export function metricsOf(answer: DshellDeviceMetricsResponse | undefined): DshellDeviceMetrics | undefined {
  return answer?.metrics
}

/** The identity of the machine, as the panel prints it. */
export function machineIdentity(device: DshellDeviceIdentity): DevicePanelMachine {
  return {
    onDevice: device.kind === 'device',
    name: device.name,
    endpoint: device.endpoint,
  }
}
