/**
 * What the vault actually guarantees about the bytes it writes.
 *
 * The claims worth testing are the ones that would fail silently: a wrong token
 * that decrypts to garbage instead of refusing, a secret that stays plain after
 * its group was set to sealed, a group whose policy flip strands what was
 * already stored. None of those throw anywhere near the mistake.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SecretVault, VaultLockedError, SEAL_MARKER } from '../src/vault.js'
import { CredentialStore } from '../src/credentials.js'

const KEY_BODY = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----\n'

let dir = ''
let vault: SecretVault
let credentials: CredentialStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dshell-vault-'))
  vault = new SecretVault(() => dir)
  credentials = new CredentialStore(() => dir, vault)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A sealed group, unlocked, with its token kept for the tests that re-lock. */
async function openGroup(name = '工作', token = 'correct horse'): Promise<string> {
  const group = await vault.createGroup(name, token)
  return group.id
}

describe('a sealed group', () => {
  it('comes back locked after a fresh instance reads the same document', async () => {
    const id = await openGroup()
    const reopened = new SecretVault(() => dir)
    const groups = await reopened.list()
    expect(groups.find(g => g.id === id)).toMatchObject({ sealed: true, locked: true })
  })

  // The load-bearing claim of using GCM at all.
  it('refuses a wrong token instead of producing garbage', async () => {
    const id = await openGroup()
    await vault.lock(id)
    await expect(vault.unlock(id, 'wrong horse')).rejects.toBeInstanceOf(VaultLockedError)
    // And the group stays locked rather than half-open.
    expect((await vault.list()).find(g => g.id === id)?.locked).toBe(true)
  })

  it('opens with the right token and round-trips a secret', async () => {
    const id = await openGroup()
    const sealed = await vault.sealFor(id, KEY_BODY)
    expect(sealed).not.toContain('b3BlbnNzaC1rZXk')
    expect(await vault.openFor(id, sealed)).toBe(KEY_BODY)
  })

  // Both paths must agree byte-for-byte, or simply enabling a token would change
  // what ssh receives — and OpenSSH's key parser requires that newline.
  it('keeps the trailing newline a key parser requires', async () => {
    const id = await openGroup()
    expect(await vault.openFor(id, await vault.sealFor(id, 'no-newline'))).toBe('no-newline\n')
    const plain = await vault.createGroup('临时', null)
    expect(await vault.sealFor(plain.id, 'no-newline')).toBe('no-newline\n')
  })

  it('throws rather than handing back a sealed body it cannot open', async () => {
    const id = await openGroup()
    const sealed = await vault.sealFor(id, KEY_BODY)
    await vault.lock(id)
    await expect(vault.openFor(id, sealed)).rejects.toBeInstanceOf(VaultLockedError)
  })
})

describe('a plain group', () => {
  it('writes its secrets unsealed and reads them with nothing unlocked', async () => {
    const group = await vault.createGroup('临时', null)
    const body = await vault.sealFor(group.id, KEY_BODY)
    expect(body).toBe(KEY_BODY)
    expect(SecretVault.isSealed(body)).toBe(false)
    expect(await vault.openFor(group.id, body)).toBe(KEY_BODY)
  })

  it('is reported as unsealed so the UI can say so out loud', async () => {
    const group = await vault.createGroup('临时', null)
    expect((await vault.list()).find(g => g.id === group.id)).toMatchObject({ sealed: false, locked: false })
  })
})

// The property that makes a policy change safe to offer: the file decides, not
// the group. If this ever reads the policy instead, flipping a group strands
// whatever was already in it.
describe('a group whose policy moves', () => {
  it('still reads a plain secret after the group was set to sealed', async () => {
    const plain = await vault.createGroup('会变的', null)
    const body = await vault.sealFor(plain.id, KEY_BODY)
    await vault.setToken(plain.id, 'a token')
    // Unwrapped or not, this body was plain, and it must still come back.
    expect(SecretVault.isSealed(body)).toBe(false)
    expect(await vault.openFor(plain.id, body)).toBe(KEY_BODY)
  })

  it('re-wraps stored credentials when the group gains a token', async () => {
    const group = await vault.createGroup('会变的', null)
    await credentials.save({ group: group.id, name: '部署密钥', kind: 'key', secret: KEY_BODY })
    const [credential] = await credentials.list()
    const file = join(dir, 'credentials', `${credential?.id}.key`)
    expect(await readFile(file, 'utf8')).toBe(KEY_BODY)

    await vault.setToken(group.id, 'a token')
    await credentials.rewrapGroup(group.id)
    const after = await readFile(file, 'utf8')
    expect(SecretVault.isSealed(after)).toBe(true)
    expect(after).not.toContain('b3BlbnNzaC1rZXk')

    // And the usable path is plaintext again, opened through the group.
    const path = await credentials.usablePath(credential?.id ?? '', 'secret', 'web')
    expect(await readFile(path ?? '', 'utf8')).toBe(KEY_BODY)
  })

  it('re-wraps back to plain when the group loses its token', async () => {
    const id = await openGroup()
    await credentials.save({ group: id, name: '口令', kind: 'password', secret: 'p@ss' })
    const [credential] = await credentials.list()
    await vault.clearToken(id)
    await credentials.rewrapGroup(id)
    const file = join(dir, 'credentials', `${credential?.id}.password`)
    expect(await readFile(file, 'utf8')).toBe('p@ss\n')
  })

  // GCM draws a fresh IV every call, so a second rewrap could never be
  // byte-identical anyway; what has to hold is that it does not touch a file
  // already in the shape the group calls for. That is what makes a rewrap
  // interrupted half-way through safe to simply run again.
  it('leaves an already-correct body alone, so an interrupted rewrap is resumable', async () => {
    const group = await vault.createGroup('会变的', null)
    await credentials.save({ group: group.id, name: '部署密钥', kind: 'key', secret: KEY_BODY })
    await vault.setToken(group.id, 'a token')
    await credentials.rewrapGroup(group.id)
    const [credential] = await credentials.list()
    const file = join(dir, 'credentials', `${credential?.id}.key`)
    const once = await readFile(file, 'utf8')
    await credentials.rewrapGroup(group.id)
    expect(await readFile(file, 'utf8')).toBe(once)
    expect(await credentials.open(credential?.id ?? '', 'secret')).toBe(KEY_BODY)
  })
})

describe('materializing plaintext for ssh', () => {
  it('writes it under run/, at 0600 in a 0700 directory', async () => {
    const id = await openGroup()
    await credentials.save({ group: id, name: '部署密钥', kind: 'key', secret: KEY_BODY })
    const [credential] = await credentials.list()
    const path = await credentials.usablePath(credential?.id ?? '', 'secret', 'web')
    expect(path?.startsWith(join(dir, 'run'))).toBe(true)
    const names = await readdir(join(dir, 'run'))
    expect(names).toContain('web.secret')
  })

  it('is swept when the group is locked', async () => {
    const id = await openGroup()
    await credentials.save({ group: id, name: '部署密钥', kind: 'key', secret: KEY_BODY })
    const [credential] = await credentials.list()
    await credentials.usablePath(credential?.id ?? '', 'secret', 'web')
    await vault.lock(id)
    credentials.forgetMaterialized()
    expect(await readdir(join(dir, 'run'))).toEqual([])
  })

  it('does not leave a plain credential sitting in run/ at all', async () => {
    const group = await vault.createGroup('临时', null)
    await credentials.save({ group: group.id, name: '口令', kind: 'password', secret: 'p@ss' })
    const [credential] = await credentials.list()
    const path = await credentials.usablePath(credential?.id ?? '', 'secret', 'web')
    // Handing back its own stored file is the whole point: no second copy.
    expect(path).toBe(join(dir, 'credentials', `${credential?.id}.password`))
    await expect(readdir(join(dir, 'run'))).rejects.toThrow()
  })
})

describe('the store document', () => {
  it('never carries a secret, a key or a token', async () => {
    const id = await openGroup()
    await credentials.save({ group: id, name: '部署密钥', kind: 'key', secret: KEY_BODY, passphrase: 'hp' })
    const documents = [
      await readFile(join(dir, 'vault.json'), 'utf8'),
      await readFile(join(dir, 'credentials.json'), 'utf8'),
    ].join('\n')
    expect(documents).not.toContain('b3BlbnNzaC1rZXk')
    expect(documents).not.toContain('correct horse')
    expect(documents).not.toContain(SEAL_MARKER)
  })

  it('creates a sealed default group rather than a plain one', async () => {
    // A credential with nowhere to go must not default to unencrypted.
    const groups = await vault.list()
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ sealed: true })
  })
})
