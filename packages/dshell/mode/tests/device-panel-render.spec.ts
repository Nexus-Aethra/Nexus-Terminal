/**
 * The device panel, rendered.
 *
 * The panel is a React tree with a real risk of not drawing at all — a prop
 * the primitives insist on, a page that forgets its panel id, a list that
 * throws on an empty answer. None of that shows up in a type check, and none
 * of it can be seen in a picture either, so the body is rendered here to
 * markup and the markup is checked: four pages, the machine, the load, the
 * three lists, and the notes.
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DshellDevicePanelBody } from '../src/client/device-panel.js'
import { devicePanelView, type DevicePanelPage } from '../src/client/device-panel-view.js'
import { zh } from '../src/client/locales.js'
import { DEVICE_NOTE_KEYS } from '../src/client/locales.js'
import type { DshellDeviceDetailResponse } from '../src/device-detail-protocol.js'
import type { DshellDeviceMetrics } from '../src/device-metrics-protocol.js'

/** The copy the panel draws with. */
const t = (key: keyof typeof zh): string => zh[key]

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
    notes: ['no-container-runtime'],
    at: 1_700_000_000_000,
  },
}

/** The load the chip's seat already holds. */
const METRICS: DshellDeviceMetrics = {
  device: { kind: 'device', name: 'build-box', endpoint: 'dev@10.0.0.9:22' },
  cpu: { used: 0.25, cores: 8, load1: 1.5 },
  memory: { total: 16 * 1024 ** 3, used: 4 * 1024 ** 3 },
  at: 1_700_000_000_000,
}

/** The panel, drawn on one page. */
function draw(page: DevicePanelPage, folded: ReadonlySet<string> = new Set<string>()): string {
  return renderToStaticMarkup(createElement(DshellDevicePanelBody, {
    view: devicePanelView(DETAIL, METRICS),
    page,
    folded,
    onPage: () => {},
    onToggle: () => {},
    onRefresh: () => {},
    t,
  }))
}

describe('the device panel', () => {
  it('draws the four pages, and the machine on the overview', () => {
    const html = draw('overview')

    expect(html).toContain('概览')
    expect(html).toContain('进程')
    expect(html).toContain('容器')
    expect(html).toContain('端口')
    // The machine block: the name is the largest thing on the page.
    expect(html).toContain('build-box')
    expect(html).toContain('dev@10.0.0.9:22')
  })

  it('draws the load as three numbers, with the machine\'s size under them', () => {
    const html = draw('overview')

    expect(html).toContain('25%')
    expect(html).toContain('8 核')
    expect(html).toContain('1.50')
  })

  it('lists the processes with their pid and their two shares', () => {
    const html = draw('processes')

    expect(html).toContain('4211')
    expect(html).toContain('node')
    expect(html).toContain('12.5%')
    expect(html).toContain('3.4%')
  })

  it('lists the containers and the ports', () => {
    const containers = draw('containers')
    expect(containers).toContain('web')
    expect(containers).toContain('nginx:latest')
    expect(containers).toContain('Up 3 hours')

    const ports = draw('ports')
    expect(ports).toContain('8080')
    expect(ports).toContain('127.0.0.1')
  })

  it('says what it could not read, under a status heading', () => {
    const html = draw('overview')

    expect(html).toContain('运行状态')
    // The sentence itself is the dictionary's business; the panel only has to
    // put it on the page.
    expect(html).toContain(zh[DEVICE_NOTE_KEYS['no-container-runtime']])
  })

  it('folds a section away when the reader folds it', () => {
    const open = draw('processes')
    const folded = draw('processes', new Set<string>(['processes']))

    // The header is always there; the rows are what folding takes away.
    expect(open).toContain('4211')
    expect(folded).not.toContain('4211')
    expect(folded).toContain('进程')
  })

  it('draws nothing but a waiting line before the host answers', () => {
    const html = renderToStaticMarkup(createElement(DshellDevicePanelBody, {
      view: undefined,
      page: 'overview',
      folded: new Set<string>(),
      onPage: () => {},
      onToggle: () => {},
    onRefresh: () => {},
      t,
    }))

    expect(html).toContain('正在读取设备')
  })
})
