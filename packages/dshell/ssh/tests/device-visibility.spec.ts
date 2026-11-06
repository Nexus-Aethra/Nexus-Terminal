/**
 * The visibility preference's refusal path, driven against a form that answers
 * the way a real settings form does.
 *
 * The interesting half is the optimistic publish. A toggle must stop offering the
 * device on the click that asked, so the snapshot moves BEFORE the write -- and a
 * refused write has to take that back. The mirror will not do it for us: a refused
 * write leaves the document's value unchanged, so the form's subscription never
 * fires and the sync's equality check finds nothing to correct. Without the
 * rollback the pickers keep hiding a device the reader was told was not saved.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SshClientService } from '../src/client/service.js'
import type { SshSettings } from '../src/ssh-settings.js'

/** One device row, as a route reply would carry it. */
const UBUNTU = {
  id: 'wsl:Ubuntu-24.04',
  name: 'Ubuntu-24.04',
  host: 'wsl',
  port: 0,
  user: '',
  remoteRoot: '~',
  auth: 'wsl',
  builtin: true,
  hasSecret: false,
  hasPassphrase: false,
} as const

/**
 * A settings form that accepts or refuses the write it is handed.
 *
 * The fold-on-accept is the part that matters: a real form replaces the mirrored
 * value when the host accepts and leaves it untouched when it refuses, and the
 * service's behaviour differs between the two.
 */
function formThat(accept: boolean) {
  let value: Partial<SshSettings> | undefined = { hiddenDevices: [] }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ value, writable: true, status: 'ready' }),
    set: async (field: string, next: unknown): Promise<boolean> => {
      if (accept) value = { ...value, [field]: next }
      for (const listener of [...listeners]) listener()
      return accept
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** What the pickers show and what the document holds, after one toggle. */
async function toggle(accept: boolean, deviceId = 'wsl:Ubuntu-24.04') {
  const form = formThat(accept)
  const service = new SshClientService(new Context(), form)
  service.watchHiddenDevices()
  service.adoptSnapshot([UBUNTU])
  const before = service.visibleDevices().map(device => device.id)
  const accepted = await service.setDeviceHidden(deviceId, true)
  return {
    accepted,
    before,
    after: service.visibleDevices().map(device => device.id),
    shown: service.getSnapshot().hiddenDevices,
    stored: form.getSnapshot().value?.hiddenDevices ?? [],
  }
}

describe('hiding a device', () => {
  it('stops offering the device once the host accepts', async () => {
    const run = await toggle(true)

    expect(run.accepted).toBe(true)
    expect(run.before).toEqual(['wsl:Ubuntu-24.04'])
    expect(run.after).toEqual([])
    expect(run.shown).toEqual(['wsl:Ubuntu-24.04'])
    expect(run.stored).toEqual(['wsl:Ubuntu-24.04'])
  })

  it('rolls the optimistic value back when the host refuses', async () => {
    // The bug this pins: before the rollback the snapshot kept the optimistic
    // value forever, so the pickers hid a device the reader had just been told
    // was not saved anywhere. The document is the authority, and it says no.
    const run = await toggle(false)

    expect(run.accepted).toBe(false)
    expect(run.after).toEqual(['wsl:Ubuntu-24.04'])
    expect(run.shown).toEqual([])
    expect(run.stored).toEqual([])
  })

  it('rolls back the same way when the write throws', async () => {
    const form = formThat(true)
    const throwing = { ...form, set: async () => { throw new Error('wire down') } }
    const service = new SshClientService(new Context(), throwing)
    service.watchHiddenDevices()
    service.adoptSnapshot([UBUNTU])

    await expect(service.setDeviceHidden('wsl:Ubuntu-24.04', true)).resolves.toBe(false)
    expect(service.visibleDevices().map(device => device.id)).toEqual(['wsl:Ubuntu-24.04'])
    expect(service.getSnapshot().hiddenDevices).toEqual([])
  })

  it('refuses before publishing when there is no settings domain at all', async () => {
    // Nothing is written and nothing is shown: a local-only value would read as
    // saved until the next reload, which is worse than a button that does
    // nothing.
    const service = new SshClientService(new Context(), undefined)
    service.adoptSnapshot([UBUNTU])

    await expect(service.setDeviceHidden('wsl:Ubuntu-24.04', true)).resolves.toBe(false)
    expect(service.visibleDevices().map(device => device.id)).toEqual(['wsl:Ubuntu-24.04'])
  })

  it('refuses before publishing when the document is not writable', async () => {
    const form = formThat(true)
    const readOnly = {
      ...form,
      getSnapshot: () => ({ value: { hiddenDevices: [] }, writable: false, status: 'ready' }),
    }
    const service = new SshClientService(new Context(), readOnly)
    service.watchHiddenDevices()
    service.adoptSnapshot([UBUNTU])

    await expect(service.setDeviceHidden('wsl:Ubuntu-24.04', true)).resolves.toBe(false)
    expect(service.visibleDevices().map(device => device.id)).toEqual(['wsl:Ubuntu-24.04'])
  })

  it('waits for the document before reading an empty set as nothing hidden', async () => {
    // A form still loading answers no value. Reading that as [] would offer
    // every distribution for a frame, which is the flash this prevents.
    let value: Partial<SshSettings> | undefined = undefined
    const listeners = new Set<() => void>()
    const form = {
      getSnapshot: () => ({ value, writable: true, status: value === undefined ? 'loading' : 'ready' }),
      set: async () => true,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    }
    const service = new SshClientService(new Context(), form)
    service.watchHiddenDevices()
    service.adoptSnapshot([UBUNTU])

    // Still loading: the set is unknown, so nothing is claimed either way.
    expect(service.getSnapshot().hiddenDevices).toEqual([])

    // The document arrives with a device already hidden.
    value = { hiddenDevices: ['wsl:Ubuntu-24.04'] }
    for (const listener of [...listeners]) listener()
    expect(service.visibleDevices()).toEqual([])
  })
})
