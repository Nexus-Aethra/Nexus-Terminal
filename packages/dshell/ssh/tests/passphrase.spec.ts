/**
 * Whether `ssh` is allowed to ask, and what it is offered when it does.
 *
 * `BatchMode` is the single option that decides this, and the mistake it guards
 * against is quiet in both directions: leaving it on makes an encrypted key fail
 * with no explanation, and taking it off makes every ordinary key failure wait on
 * a hook that has nothing to say. These pin which of the two each shape gets.
 */

import { describe, expect, it } from 'vitest'
import { sshArgv, sshEnv } from '../src/runner.js'
import type { DeviceConnection } from '../src/devices.js'

function device(over: Partial<DeviceConnection> = {}): DeviceConnection {
  return {
    id: 'web',
    name: 'web',
    host: 'example.test',
    port: 22,
    user: 'ops',
    remoteRoot: '~',
    auth: 'key',
    secretFile: undefined,
    passphraseFile: undefined,
    askpassFile: '/d/askpass.sh',
    ...over,
  }
}

const key = device({ secretFile: '/k/id_ed25519' })
const encryptedKey = device({ secretFile: '/k/id_ed25519', passphraseFile: '/k/id_ed25519.passphrase' })

describe('a key device', () => {
  it('refuses to be asked anything when no passphrase is stored', () => {
    expect(sshArgv(key, 'true')).toContain('BatchMode=yes')
  })

  it('is allowed to ask when a passphrase is stored', () => {
    const argv = sshArgv(encryptedKey, 'true')
    expect(argv).not.toContain('BatchMode=yes')
    // Still bounded: a wrong passphrase must be a refusal, not a wait.
    expect(argv).toContain('NumberOfPasswordPrompts=1')
  })

  it('still offers only its own key when a passphrase is stored', () => {
    const argv = sshArgv(encryptedKey, 'true')
    expect(argv).toContain('IdentitiesOnly=yes')
    expect(argv).toContain('/k/id_ed25519')
  })

  it('allows asking with an ambient agent and no stored key at all', () => {
    // A passphrase can also sit behind the harness user's own agent, and
    // BatchMode would suppress that ask exactly as it suppresses ours.
    const argv = sshArgv(device({ passphraseFile: '/k/id_ed25519.passphrase' }), 'true')
    expect(argv).not.toContain('BatchMode=yes')
  })
})

describe('a password device', () => {
  it('is bounded and never batched', () => {
    const argv = sshArgv(device({ auth: 'password', secretFile: '/k/web.password' }), 'true')
    expect(argv).toContain('NumberOfPasswordPrompts=1')
    expect(argv).toContain('PreferredAuthentications=password')
  })
})

describe('the askpass environment', () => {
  it('is empty when nothing may be asked', () => {
    expect(sshEnv(key)).toEqual({})
  })

  // The load-bearing assertion of the whole change: pointing ssh's askpass hook
  // at the PRIVATE KEY would hand it the key itself as the answer.
  it('points at the passphrase, never at the key', () => {
    const env = sshEnv(encryptedKey)
    expect(env.DSHELL_SSH_ASKPASS_FILE).toBe('/k/id_ed25519.passphrase')
    expect(env.SSH_ASKPASS).toBe('/d/askpass.sh')
    expect(env.SSH_ASKPASS_REQUIRE).toBe('force')
  })

  it('points at the password for a password device', () => {
    const env = sshEnv(device({ auth: 'password', secretFile: '/k/web.password' }))
    expect(env.DSHELL_SSH_ASKPASS_FILE).toBe('/k/web.password')
  })

  // A password device with a stray passphrase recorded would otherwise send the
  // passphrase to the password prompt.
  it('ignores a passphrase on a password device', () => {
    const env = sshEnv(device({
      auth: 'password', secretFile: '/k/web.password', passphraseFile: '/k/web.passphrase',
    }))
    expect(env.DSHELL_SSH_ASKPASS_FILE).toBe('/k/web.password')
  })
})
