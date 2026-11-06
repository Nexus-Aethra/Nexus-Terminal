/**
 * The device seat's visibility rule: which rows a picker offers.
 *
 * The rule itself lives in dshell-std so every picker applies the same one;
 * what is worth pinning HERE is what a picker does with it. The seat is the
 * one projection the creation page and the terminal section both read, so a
 * hidden row dropped anywhere else is a row one of the two still offers.
 *
 * The two facts that make hiding safe are asserted alongside: a session
 * already bound to a hidden device keeps naming it, and the host-side
 * connection for that device is untouched -- hiding never reaches the router.
 */

import { describe, expect, it } from 'vitest'
import { isHiddenDevice } from '@nexus-aethra/dshell-std'

/** One row as the ssh service publishes it, narrowed to what the rule reads. */
function row(id: string, over: Partial<{ name: string; auth: string; builtin: boolean }> = {}) {
  return { id, name: over.name ?? id, auth: over.auth ?? 'key', builtin: over.builtin }
}

const UBUNTU = row('wsl:Ubuntu-24.04', { name: 'Ubuntu-24.04', auth: 'wsl', builtin: true })
const DEBIAN = row('wsl:Debian-12', { name: 'Debian-12', auth: 'wsl', builtin: true })
const BUILD = row('build-box', { name: 'build-box', auth: 'key' })

/** The projection a picker publishes: the same filter the seat applies. */
function offered(devices: readonly ReturnType<typeof row>[], hidden: readonly string[]): string[] {
  return devices.filter(device => !isHiddenDevice(device, hidden)).map(device => device.id)
}

describe('the device pickers', () => {
  it('drop a hidden built-in row from what they offer', () => {
    expect(offered([UBUNTU, DEBIAN, BUILD], ['wsl:Ubuntu-24.04']))
      .toEqual(['wsl:Debian-12', 'build-box'])
  })

  it('offer everything when nothing is hidden', () => {
    expect(offered([UBUNTU, DEBIAN, BUILD], []))
      .toEqual(['wsl:Ubuntu-24.04', 'wsl:Debian-12', 'build-box'])
  })

  it('never drop a stored device, even when its id is in the set', () => {
    // The set is a settings document, so it can hold anything. A stored device
    // is managed by deleting it, and hiding is not a second way to delete one
    // with no way back.
    expect(offered([BUILD], ['build-box'])).toEqual(['build-box'])
  })

  it('leaves the device of a bound session nameable', () => {
    // The rule answers "may a picker OFFER this row". A session already bound
    // to a hidden device resolves its device by id from the full list, which is
    // why the hidden set travels beside the rows rather than the rows being
    // filtered out of the snapshot itself.
    const hidden = ['wsl:Ubuntu-24.04']
    const bound = [UBUNTU, DEBIAN, BUILD].find(candidate => candidate.id === 'wsl:Ubuntu-24.04')
    expect(isHiddenDevice(bound!, hidden)).toBe(true)
    expect(bound?.name).toBe('Ubuntu-24.04')
  })
})
