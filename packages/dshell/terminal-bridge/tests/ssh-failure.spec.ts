import { describe, expect, it } from 'vitest'
import { classifySshFailure, lockedVaultRefusal } from '../src/pty.js'

const CHANGE_BANNER = [
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  '@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @',
  '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
  'Host key verification failed.',
].join('\n')

describe('classifySshFailure', () => {
  it('names a changed host key', () => {
    expect(classifySshFailure(CHANGE_BANNER)).toBe('hostKey')
  })

  it('names a wrong passphrase', () => {
    expect(classifySshFailure(
      'Load key "/dshell/keys/web": error in libcrypto\na load key: incorrect passphrase supplied to decrypt private key',
    )).toBe('passphrase')
  })

  it('reads the retry prompt as a passphrase problem', () => {
    expect(classifySshFailure('Enter passphrase for key \'/dshell/keys/web\': ')).toBe('passphrase')
  })

  // The ordering that matters: a changed key makes ssh offer a different key,
  // and that retry is what draws the passphrase complaint. Reading it as a bad
  // secret would send the user to fix a secret that is correct.
  it('prefers the host key when a changed key also draws a passphrase complaint', () => {
    expect(classifySshFailure(`${CHANGE_BANNER}\nLoad key "…": incorrect passphrase supplied`)).toBe('hostKey')
  })

  // A refused password is the same sentence the reader would see for a wrong
  // passphrase, and it is NOT something re-entering a secret fixes here.
  it('leaves a refused password unnamed', () => {
    expect(classifySshFailure('user@host: Permission denied (publickey,password).')).toBeUndefined()
  })

  it('leaves an ordinary connection failure unnamed', () => {
    expect(classifySshFailure('ssh: connect to host web port 22: Connection refused')).toBeUndefined()
  })

  it('reads through ANSI, which is how the diagnostic actually arrives', () => {
    expect(classifySshFailure('[1;31mHost key verification failed.[0m')).toBe('hostKey')
  })

  it('has no opinion about output that says nothing', () => {
    expect(classifySshFailure('$ ')).toBeUndefined()
    expect(classifySshFailure('')).toBeUndefined()
  })
})

describe('lockedVaultRefusal', () => {
  /** The refusal the SSH router raises, spelled the way it arrives here. */
  function vaultRefusal(): Error {
    const error = new Error('分组「远程验收」已锁定，先解锁才能读取或写入它的凭据')
    error.name = 'VaultLockedError'
    return error
  }

  // Recognised so the client can keep its retry budget for the attempt that
  // follows the unlock, and offer the token on the failure screen. Matching the
  // message text instead would make every future rewording a behaviour change.
  it('names the vault refusal by its error name', () => {
    expect(lockedVaultRefusal(vaultRefusal())).toBe(true)
  })

  it('leaves an ordinary spawn failure alone', () => {
    expect(lockedVaultRefusal(new Error('ssh: connect to host web port 22: Connection refused'))).toBe(false)
    expect(lockedVaultRefusal(new Error('分组已锁定'))).toBe(false)
  })

  it('is not fooled by something that is not an error at all', () => {
    expect(lockedVaultRefusal('VaultLockedError')).toBe(false)
    expect(lockedVaultRefusal(undefined)).toBe(false)
  })
})
