/**
 * The device registry's helper-status durability: old documents still load,
 * successful installs survive a restart, and a connection edit retires the
 * stale status so a later check starts from `absent` again.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { DeviceStore } from '../src/devices.js'

const translate = (key: string) => key

describe('DeviceStore helper status', () => {
  it('reads legacy documents that do not carry helper status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshell-devices-'))
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'devices.json'), JSON.stringify({
      devices: [
        { id: 'legacy', host: '10.0.0.1', user: 'root', name: '', port: 22, remoteRoot: '~', auth: 'key' },
      ],
    }, null, 2), 'utf8')
    const store = new DeviceStore(() => root)
    const devices = await store.list()
    expect(devices).toHaveLength(1)
    expect(devices[0].helper).toBeUndefined()
  })

  it('round-trips a verified helper status and keeps it across reloads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshell-devices-'))
    await mkdir(root, { recursive: true })
    const store = new DeviceStore(() => root)
    const saved = await store.save({
      name: 'device-1', host: '10.0.0.2', port: 22, user: 'pi', remoteRoot: '~/app', auth: 'key',
    }, translate)
    expect(saved.helper).toBeUndefined()

    // Simulate the install/verification path persisting a status.
    const status = {
      state: 'present' as const,
      onDevice: 'abcd',
      expected: 'abcd',
      path: '/home/pi/.dshell/helper/helper-abcd.mjs',
      message: 'verified',
    }
    await writeFile(join(root, 'devices.json'), JSON.stringify({
      devices: [
        { ...saved, helper: status },
      ],
    }, null, 2), 'utf8')

    const reloaded = new DeviceStore(() => root)
    const devices = await reloaded.list()
    expect(devices).toHaveLength(1)
    expect(devices[0].helper).toEqual(status)
  })

  it('retires helper status when the connection string changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dshell-devices-'))
    await mkdir(root, { recursive: true })
    const store = new DeviceStore(() => root)
    const saved = await store.save({
      name: 'device-1', host: '10.0.0.2', port: 22, user: 'pi', remoteRoot: '~/app', auth: 'key',
    }, translate)
    await writeFile(join(root, 'devices.json'), JSON.stringify({
      devices: [
        {
          ...saved,
          helper: {
            state: 'present',
            onDevice: 'abcd',
            expected: 'abcd',
            path: '/home/pi/.dshell/helper/helper-abcd.mjs',
            message: 'verified',
          },
        },
      ],
    }, null, 2), 'utf8')

    await store.save({
      id: saved.id,
      name: 'device-1',
      host: '10.0.0.3',
      port: 2222,
      user: 'pi',
      remoteRoot: '~/app',
      auth: 'key',
    }, translate)

    const refreshed = new DeviceStore(() => root)
    const devices = await refreshed.list()
    expect(devices).toHaveLength(1)
    expect(devices[0].helper).toBeUndefined()
  })
})
