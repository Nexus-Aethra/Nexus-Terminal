/**
 * What a stored secret becomes on the wire, and what it never becomes.
 *
 * The old `ssh` path answered these questions with argv options — `BatchMode`,
 * `IdentitiesOnly`, an askpass hook pointed at one file — and the mistake each
 * guarded against was quiet in both directions: an encrypted key that could not
 * be asked for failed with no explanation, and a device that reached for an
 * ambient identity connected as someone else. The transport answers the same
 * questions structurally, so these pin the same decisions one layer down.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { connectConfig } from '../src/transport/auth.js'
import type { DeviceConnection } from '../src/devices.js'

/** A directory holding the secrets these cases read, removed with the process. */
const secrets = mkdtempSync(join(tmpdir(), 'dshell-auth-'))
afterAll(() => { rmSync(secrets, { recursive: true, force: true }) })

/** Write one secret exactly the way the device store writes it. */
function secret(name: string, body: string): string {
  const path = join(secrets, name)
  writeFileSync(path, body.endsWith('\n') ? body : `${body}\n`, { mode: 0o600 })
  return path
}

const KEY_BODY = '-----BEGIN OPENSSH PRIVATE KEY-----\nbody\n-----END OPENSSH PRIVATE KEY-----\n'
const keyFile = secret('id_ed25519', KEY_BODY)
const passphraseFile = secret('id_ed25519.passphrase', 'correct horse battery staple')
const passwordFile = secret('web.password', 'not a real password')

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
    ...over,
  }
}

describe('a key device', () => {
  it('offers exactly its own key, and nothing else', async () => {
    const config = await connectConfig(device({ secretFile: keyFile }))
    expect(config.privateKey).toBe(KEY_BODY)
    // No agent is ever configured, so an ambient identity cannot be reached by
    // accident — the same guarantee `IdentitiesOnly=yes` used to give.
    expect(config.agent).toBeUndefined()
    expect(config.password).toBeUndefined()
    expect(config.passphrase).toBeUndefined()
  })

  it('carries the passphrase with the key it unlocks', async () => {
    const config = await connectConfig(device({ secretFile: keyFile, passphraseFile }))
    expect(config.privateKey).toBe(KEY_BODY)
    // The stored file ends with the newline its writer appended, and a
    // passphrase that carries it is a key that will not decrypt.
    expect(config.passphrase).toBe('correct horse battery staple')
  })

  it('never sends a passphrase where there is no key to unlock', async () => {
    const config = await connectConfig(device({ passphraseFile }))
    expect(config.privateKey).toBeUndefined()
    expect(config.passphrase).toBeUndefined()
  })
})

describe('a password device', () => {
  it('sends the password and never a key', async () => {
    const config = await connectConfig(device({ auth: 'password', secretFile: passwordFile }))
    expect(config.password).toBe('not a real password')
    expect(config.privateKey).toBeUndefined()
  })

  it('ignores a passphrase recorded beside the password', async () => {
    // A stray passphrase must not become the password: the two answer different
    // prompts, and only one of them is asked for here.
    const config = await connectConfig(device({
      auth: 'password', secretFile: passwordFile, passphraseFile,
    }))
    expect(config.password).toBe('not a real password')
    expect(config.passphrase).toBeUndefined()
  })
})

describe('a device with no stored secret', () => {
  it('offers nothing at all', async () => {
    // Refusing loudly is the honest outcome: the alternative — reaching for an
    // ambient identity — would connect as whoever the host happens to be.
    const config = await connectConfig(device())
    expect(config.password).toBeUndefined()
    expect(config.privateKey).toBeUndefined()
    expect(config.passphrase).toBeUndefined()
  })
})

describe('every device', () => {
  it('keeps a dead link observable', async () => {
    // The old `ServerAliveInterval=15, CountMax=3` and `ConnectTimeout=10`, so a
    // half-open connection is noticed rather than waited on forever.
    const config = await connectConfig(device())
    expect(config.keepaliveInterval).toBe(15_000)
    expect(config.keepaliveCountMax).toBe(3)
    expect(config.readyTimeout).toBe(10_000)
    expect(config.host).toBe('example.test')
    expect(config.port).toBe(22)
    expect(config.username).toBe('ops')
  })
})
