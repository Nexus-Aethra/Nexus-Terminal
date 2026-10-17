/**
 * What this machine will accept as a device's host key.
 *
 * Read back from this plugin's OWN known_hosts rather than asked of the device:
 * anything the device reports travels over the very connection whose identity is
 * in question, so an interposed host can answer with whatever fingerprint it
 * likes. The local store is the only source that means "what dshell will accept
 * the next time it connects".
 *
 * `ssh-keygen` is spawned directly rather than through `ctx.subprocess`: this is
 * a local, read-only lookup with no output to stream and nothing to sandbox,
 * resolved from the same PATH the `ssh` client is already spawned by name from.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { sshKnownHostsPath } from './paths.js'
import type { TrustedHostKey } from '@nexus-aethra/dshell-std'

const run = promisify(execFile)

/**
 * The spelling OpenSSH stores a destination under: bare host on the default
 * port, `[host]:port` otherwise. Getting this wrong silently reports "nothing
 * trusted" for every non-default port.
 *
 * @param host - device host.
 * @param port - device port.
 * @returns the known_hosts host field.
 */
export function knownHostsLookup(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${String(port)}`
}

/** OpenSSH's fingerprint spelling: SHA-256 of the blob, base64, unpadded. */
export function fingerprintOf(blob: string): string {
  const digest = createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64')
  return `SHA256:${digest.replace(/=+$/, '')}`
}

/**
 * The host key fingerprint dshell trusts for one destination.
 *
 * @param host - device host.
 * @param port - device port.
 * @returns the fingerprint, or undefined when nothing is recorded yet (or the
 *   lookup itself is unavailable — every such case means "nothing to report").
 */
export async function trustedHostKey(host: string, port: number): Promise<string | undefined> {
  const keys = await listTrustedHostKeys(host, port)
  return keys[0]?.fingerprint
}

/**
 * Every host key recorded for one destination.
 *
 * Read through `ssh-keygen -F` rather than by parsing the file: the file's
 * grammar is OpenSSH's (comments, hashed entries, certificates, one line per key
 * type) and re-implementing it here would be a parser that is wrong in exactly
 * the cases nobody tests until the day it matters.
 *
 * @param host - device host.
 * @param port - device port.
 * @returns the entries, empty when nothing is recorded or ssh-keygen is absent.
 */
export async function listTrustedHostKeys(host: string, port: number): Promise<TrustedHostKey[]> {
  const lookup = knownHostsLookup(host, port)
  let stdout: string
  try {
    ;({ stdout } = await run('ssh-keygen', ['-F', lookup, '-f', sshKnownHostsPath()]))
  } catch {
    // Nothing recorded, no file, or no ssh-keygen: all "no keys to show".
    return []
  }
  const keys: TrustedHostKey[] = []
  for (const line of stdout.split('\n')) {
    // ssh-keygen prefixes a match banner (`# Host … found: line N`) that is not
    // itself an entry.
    if (line.trim() === '' || line.startsWith('#')) continue
    const fields = line.trim().split(/\s+/)
    const at = fields.findIndex(field => /^(ssh-|ecdsa-|sk-)/.test(field))
    const blob = fields[at + 1]
    if (at < 0 || blob === undefined) continue
    keys.push({ host: lookup, port, keyType: fields[at] ?? '', fingerprint: fingerprintOf(blob) })
  }
  return keys
}

/**
 * Drop every host key recorded for one destination.
 *
 * `-R` rather than a rewrite of the file, because removing a host's entries
 * correctly means removing every key type it has, and getting that wrong would
 * leave the device half-trusted — still refused on the key type that remains.
 *
 * @param host - device host.
 * @param port - device port.
 * @returns true when entries were removed; false when there were none.
 */
export async function revokeTrustedHostKeys(host: string, port: number): Promise<boolean> {
  try {
    const { stdout } = await run('ssh-keygen', ['-R', knownHostsLookup(host, port), '-f', sshKnownHostsPath()])
    return !/not found/i.test(stdout)
  } catch {
    // No file, nothing recorded, or no ssh-keygen. Nothing was trusted, which is
    // the state the caller wanted, so this is not a failure.
    return false
  }
}

/**
 * What one host presents right now, over a connection that cannot be trusted.
 *
 * `ssh-keyscan` opens its own unauthenticated session, so the answer is exactly
 * what an interposed host would want a reader to believe. It is offered for
 * COMPARISON against a fingerprint obtained some other way and never as
 * something to trust on sight — the UI has to say so in as many words.
 *
 * @param host - device host.
 * @param port - device port.
 * @returns the key the host offered, or undefined when it answered nothing.
 */
export async function probeHostKey(host: string, port: number): Promise<TrustedHostKey | undefined> {
  let stdout: string
  try {
    // Bounded so a filtered port cannot hang the panel the user is reading.
    ;({ stdout } = await run('ssh-keyscan', ['-T', '5', '-p', String(port), host], { timeout: 8_000 }))
  } catch {
    // A refused connection exits non-zero with nothing on stdout; some builds
    // print the line it could not scan. Either way there is no key to show.
    return undefined
  }
  const entry = stdout.split('\n').map(line => line.trim())
    .find(line => line !== '' && !line.startsWith('#'))
  if (entry === undefined) return undefined
  const fields = entry.split(/\s+/)
  const at = fields.findIndex(field => /^(ssh-|ecdsa-|sk-)/.test(field))
  const blob = fields[at + 1]
  if (at < 0 || blob === undefined) return undefined
  return {
    host: knownHostsLookup(host, port),
    port,
    keyType: fields[at] ?? '',
    fingerprint: fingerprintOf(blob),
  }
}
