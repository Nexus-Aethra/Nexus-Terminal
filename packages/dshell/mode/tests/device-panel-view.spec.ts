/**
 * What the device panel draws, decided.
 *
 * The panel is the one surface that talks about a machine the reader may be
 * logged into, so what it says has to be exact: the machine it describes, the
 * rows it lists, and the reason a list is empty. These are the claims the
 * panel makes, and they are checked here rather than by looking at a picture.
 */

import { describe, expect, it } from 'vitest'
import type { DshellDeviceDetailResponse, DshellDeviceNoteCode } from '../src/device-detail-protocol.js'
import type { DshellDeviceMetrics } from '../src/device-metrics-protocol.js'
import { devicePanelView } from '../src/client/device-panel-view.js'
import { DEVICE_NOTE_KEYS, en, zh } from '../src/client/locales.js'

/** A device that reports one of everything. */
const DETAIL: DshellDeviceDetailResponse = {
  detail: {
    device: { kind: 'device', name: 'build-box', endpoint: 'dev@10.0.0.9:22' },
    processes: [
      { pid: 4211, ppid: 1, cpu: 12.5, memory: 3.4, command: 'node' },
      { pid: 4212, ppid: 4211, cpu: 0.5, memory: 0.2, command: 'bash' },
    ],
    containers: [
      { id: '9f2ab1', image: 'nginx:latest', name: 'web', state: 'Up 3 hours' },
    ],
    ports: [
      { proto: 'tcp', port: 22, address: '0.0.0.0' },
      { proto: 'tcp', port: 8080, address: '127.0.0.1' },
    ],
    notes: [],
    at: 1_700_000_000_000,
  },
}

/** The load the status chip's seat already holds. */
const METRICS: DshellDeviceMetrics = {
  device: { kind: 'device', name: 'build-box', endpoint: 'dev@10.0.0.9:22' },
  cpu: { used: 0.25, cores: 8, load1: 1.5 },
  memory: { total: 16 * 1024 ** 3, used: 4 * 1024 ** 3 },
  at: 1_700_000_000_000,
}

describe('a device answer', () => {
  it('names the machine it describes', () => {
    const view = devicePanelView(DETAIL, undefined)

    expect(view?.onDevice).toBe(true)
    expect(view?.machine).toEqual([
      { label: 'device.machine.kind', value: 'device' },
      { label: 'device.machine.name', value: 'build-box' },
      { label: 'device.machine.endpoint', value: 'dev@10.0.0.9:22' },
    ])
  })

  it('lists the processes with their share of the machine', () => {
    const view = devicePanelView(DETAIL, undefined)

    expect(view?.processes).toEqual([
      { pid: '4211', command: 'node', cpu: '12.5%', memory: '3.4%' },
      { pid: '4212', command: 'bash', cpu: '0.5%', memory: '0.2%' },
    ])
  })

  it('lists the containers and the sockets', () => {
    const view = devicePanelView(DETAIL, undefined)

    expect(view?.containers).toEqual([
      { name: 'web', image: 'nginx:latest', state: 'Up 3 hours' },
    ])
    expect(view?.ports).toEqual([
      { proto: 'tcp', port: '22', address: '0.0.0.0' },
      { proto: 'tcp', port: '8080', address: '127.0.0.1' },
    ])
  })

  it('says what could not be read', () => {
    const view = devicePanelView({
      detail: { ...DETAIL.detail!, notes: ['no-container-runtime'] },
    }, undefined)

    expect(view?.notes).toEqual(['no-container-runtime'])
  })
})

describe('a session that runs on this machine', () => {
  it('says so, and names no device', () => {
    const view = devicePanelView({
      detail: {
        device: { kind: 'local' },
        processes: [],
        containers: [],
        ports: [],
        notes: ['processes-unreported'],
        at: 1_700_000_000_000,
      },
    }, undefined)

    expect(view?.onDevice).toBe(false)
    expect(view?.machine).toEqual([{ label: 'device.machine.kind', value: 'local' }])
  })
})

describe('a host that could not answer', () => {
  it('carries the reason instead of empty rows', () => {
    const view = devicePanelView({ error: '会话绑定的设备当前不可达' }, undefined)

    expect(view?.error).toBe('会话绑定的设备当前不可达')
    expect(view?.processes).toEqual([])
    expect(view?.notes).toEqual([])
  })
})

describe('an answer that has not arrived yet', () => {
  it('is nothing to draw', () => {
    expect(devicePanelView(undefined, undefined)).toBeUndefined()
  })
})

describe('the load', () => {
  it('is read from the seat the chip already keeps', () => {
    const view = devicePanelView(DETAIL, METRICS)

    expect(view?.load).toEqual([
      { label: 'device.load.cpu', value: '25%' },
      { label: 'device.load.memory', value: '4.0 GB / 16.0 GB' },
      { label: 'device.load.load1', value: '1.50' },
    ])
  })

  it('is drawn as not known when the chip has no reading yet', () => {
    const view = devicePanelView(DETAIL, undefined)

    expect(view?.load).toEqual([
      { label: 'device.load.cpu', value: undefined },
      { label: 'device.load.memory', value: undefined },
      { label: 'device.load.load1', value: undefined },
    ])
  })
})

describe('a note the host can send', () => {
  it('has a sentence in every language', () => {
    // A note the host can send but no dictionary can say would be drawn as
    // nothing at all, and a reader would read that as "there was nothing to
    // report" — the exact lie the notes exist to prevent.
    const codes: DshellDeviceNoteCode[] = [
      'no-ps',
      'no-container-runtime',
      'no-socket-tool',
      'processes-unreported',
      'containers-unreported',
      'ports-unreported',
    ]
    for (const code of codes) {
      const key = DEVICE_NOTE_KEYS[code]
      expect(key, code).toBeDefined()
      expect(zh[key], code).not.toBe('')
      expect(en[key], code).not.toBe('')
    }
  })
})
