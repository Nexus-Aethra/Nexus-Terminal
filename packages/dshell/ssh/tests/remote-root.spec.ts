/**
 * A reader's `~` is the shell's to expand, and the helper's to refuse.
 *
 * The session root is stored as it was typed, because that is what a command
 * needs: `cd ~/app` on the device means the right thing, and it keeps meaning it
 * when the account's home moves. The helper speaks a stricter language — its
 * protocol says "always absolute: the caller translates, the device does not
 * guess" — and a `~`-spelled path reaching it is refused as an invalid path.
 *
 * That refusal lands inside a TURN, so it costs the whole turn rather than one
 * file operation: the prompt is dropped, no tool call runs, and the reader sees
 * a message that never answers. These cases pin the translation that prevents
 * it, including the one where it must refuse to invent an answer.
 */

import { describe, expect, it } from 'vitest'
import { absoluteRemoteRoot } from '../src/mount.js'

describe('absoluteRemoteRoot', () => {
  it('expands a bare home root to the device directory', () => {
    // The default root of every device record, and the spelling the session
    // dialog offers: this is the case that reached the helper unexpanded.
    expect(absoluteRemoteRoot('~', '/root')).toBe('/root')
  })

  it('expands a home root with a directory under it', () => {
    expect(absoluteRemoteRoot('~/app', '/root')).toBe('/root/app')
    expect(absoluteRemoteRoot('~/a/b', '/root')).toBe('/root/a/b')
    expect(absoluteRemoteRoot('~', '/home/deploy')).toBe('/home/deploy')
  })

  it('drops the tilde and keeps the rest of the spelling', () => {
    expect(absoluteRemoteRoot('~/', '/root')).toBe('/root')
    expect(absoluteRemoteRoot('~/nested', '/root')).toBe('/root/nested')
    // A trailing separator survives, deliberately: spelling is preserved until
    // the DEVICE canonicalizes it, which is the rule the rest of this wire
    // already follows (`remoteAbsolutePath`: "spelling is preserved until remote
    // canonicalization"). What this rule owes is an absolute path, not a tidy one.
    expect(absoluteRemoteRoot('~/nested/', '/root')).toBe('/root/nested/')
  })

  it('leaves an absolute root alone', () => {
    // Already the device's own language: nothing to translate, and the device
    // directory is irrelevant to it.
    expect(absoluteRemoteRoot('/srv/app', '/root')).toBe('/srv/app')
    expect(absoluteRemoteRoot('/srv/app', undefined)).toBe('/srv/app')
  })

  it('refuses to invent a path it cannot resolve', () => {
    // A `~` with no device directory (no helper has handshaked) keeps its
    // spelling, which is the honest state: the caller's next attempt has the
    // same information, and a guess would silently address the wrong tree.
    expect(absoluteRemoteRoot('~', undefined)).toBe('~')
    expect(absoluteRemoteRoot('~/app', undefined)).toBe('~/app')
    // A device directory that is not absolute is no help either.
    expect(absoluteRemoteRoot('~', 'root')).toBe('~')
  })

  it('does not treat an escaped tilde as a home', () => {
    // Only a leading `~` is the shell's home shorthand; a `~` inside a name is
    // a name, and rewriting it would address something the reader never named.
    expect(absoluteRemoteRoot('/srv/~backup', '/root')).toBe('/srv/~backup')
  })
})
