/**
 * What the device panel shows, as data.
 *
 * The panel is a drawing, and a drawing is hard to argue about: the decisions
 * it makes — which machine, which rows, how many decimals — are the decisions
 * that can be wrong. So they are lifted out of the drawing into a pure
 * function, and what is left is layout.
 *
 * The labels stay in the component: they are words, and the reader's language
 * is not known here. The NUMBERS are language-free, so they are decided here
 * and printed once.
 */

import type { DshellDeviceIdentity, DshellDeviceMetrics, DshellDeviceMetricsResponse } from '../device-metrics-protocol.js'
import type { DshellDeviceDetailResponse } from '../device-detail-protocol.js'
import type { DshellDeviceNoteCode } from '../device-detail-protocol.js'
import { cpuPercent, memoryPair } from './device-metrics.js'

/** One row of the machine section: a label and a value, value optional. */
export interface DevicePanelField {
  /** What the field is called, as a locale key the component resolves. */
  readonly label: 'device.machine.kind' | 'device.machine.name' | 'device.machine.endpoint'
  /** The value, already formatted. */
  readonly value: string
}

/** One row of the load section. */
export interface DevicePanelLoadField {
  /** What the row is called, as a locale key the component resolves. */
  readonly label: 'device.load.cpu' | 'device.load.memory' | 'device.load.load1'
  /** The value, already formatted; undefined means "not known yet". */
  readonly value: string | undefined
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
  readonly onDevice: boolean
  /** The machine's rows. */
  readonly machine: readonly DevicePanelField[]
  /** The load rows; a row without a value is drawn as "not known". */
  readonly load: readonly DevicePanelLoadField[]
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
 * The machine's rows.
 *
 * The kind is the first row because it is the one that decides what the rest
 * of the panel is about: a device's processes are the device's, and this
 * machine's are this machine's.
 */
function machineFields(device: DshellDeviceIdentity): readonly DevicePanelField[] {
  const fields: DevicePanelField[] = []
  fields.push({ label: 'device.machine.kind', value: device.kind })
  if (device.name !== undefined) {
    fields.push({ label: 'device.machine.name', value: device.name })
  }
  if (device.endpoint !== undefined) {
    fields.push({ label: 'device.machine.endpoint', value: device.endpoint })
  }
  return fields
}

/**
 * The load rows, from the seat the status chip already keeps.
 *
 * The load is NOT asked for again: the chip polls it, the panel reads the same
 * answer, and two readers of one machine cost one round trip.
 */
function loadFields(metrics: DshellDeviceMetrics | undefined): readonly DevicePanelLoadField[] {
  if (metrics === undefined) {
    return [
      { label: 'device.load.cpu', value: undefined },
      { label: 'device.load.memory', value: undefined },
      { label: 'device.load.load1', value: undefined },
    ]
  }
  return [
    { label: 'device.load.cpu', value: cpuPercent(metrics.cpu) },
    { label: 'device.load.memory', value: memoryPair(metrics.memory) },
    { label: 'device.load.load1', value: metrics.cpu.load1 === undefined ? undefined : metrics.cpu.load1.toFixed(2) },
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
      onDevice: false,
      machine: [],
      load: loadFields(metrics),
      processes: [],
      containers: [],
      ports: [],
      notes: [],
      error: answer.error,
    }
  }
  return {
    onDevice: detail.device.kind === 'device',
    machine: machineFields(detail.device),
    load: loadFields(metrics),
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
