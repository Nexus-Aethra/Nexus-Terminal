/**
 * The device path, as the device's shell reads it.
 *
 * Two namespaces meet here, and the seam between them is where a device stops
 * working for a reason nobody can see: the host's paths are spelled the host's
 * way, the device's are spelled POSIX, and a `~` root is expanded by the
 * DEVICE — the host does not know the device's home unless a helper has
 * reported it.
 *
 * The failure this pins down is the one that made a device with the default
 * root unusable: the path arrived as `~/notes.md`, was quoted whole, and the
 * device read the quotes literally and answered "No such file or directory"
 * about a directory that was really there. Inside single quotes a tilde is a
 * file called `~`; outside them the device's own shell expands it.
 */

import { describe, expect, it } from 'vitest'
import { quote, quoteDevicePath } from '../src/shell-quote.js'
import { toRemotePath } from '../src/mount.js'

describe('a device path', () => {
  it('keeps a tilde outside the quotes, so the device expands it', () => {
    expect(quoteDevicePath('~')).toBe('~')
    expect(quoteDevicePath('~/notes.md')).toBe("~/'notes.md'")
    expect(quoteDevicePath('~/a/b.md')).toBe("~/'a/b.md'")
  })

  it('quotes everything else', () => {
    expect(quoteDevicePath('/root/notes.md')).toBe(quote('/root/notes.md'))
    expect(quoteDevicePath('/root/it\'s.md')).toBe(quote('/root/it\'s.md'))
  })

  it('never leaves a tilde inside the quotes', () => {
    // The bug in one assertion: a quoted tilde is a file named `~`, and the
    // device says so about a directory that is really there.
    expect(quoteDevicePath('~/notes.md').startsWith('~')).toBe(true)
    expect(quoteDevicePath('~/notes.md')).not.toContain("'~'")
  })
})

describe('a session whose device root is a tilde', () => {
  const mapping = { mount: '/mnt/dev/root', remoteRoot: '~', alias: '/home/u' }

  it('translates the session directory into the device root', () => {
    expect(toRemotePath(mapping, '/home/u')).toBe('~')
    expect(toRemotePath(mapping, '/home/u/notes.md')).toBe('~/notes.md')
  })

  it('hands the device a path its own shell can open', () => {
    // The whole chain, in one line: what the device is asked to open.
    expect(quoteDevicePath(toRemotePath(mapping, '/home/u/notes.md'))).toBe("~/'notes.md'")
  })
})
