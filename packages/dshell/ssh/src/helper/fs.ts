/**
 * The device's filesystem, as the helper serves it.
 *
 * Every operation here is a request with arguments and a reply with fields,
 * which is the point of the helper: the alternative — a POSIX command assembled
 * on the host and its output parsed back — decides things by reading text. That
 * cost was concrete. Listing a directory needed `find -printf` with a
 * NUL-separated format because a filename may contain any byte but NUL, and
 * `LC_ALL=C` because `stat` and `find` localize their output — `%F` prints
 * "regular file" in whatever language the device is set to — and a failure was
 * classified by matching English error text, so a device with a non-English
 * userland reported every permission problem as an unknown I/O fault.
 *
 * Here a failure is a code derived from an errno, the message is only ever read
 * by a human, and a filename is a JSON string: no separator can be forged, no
 * locale can change what a field means.
 *
 * What this module does NOT own is policy. Whether a write is allowed, whether
 * a version is stale, how line endings are treated, and what a literal edit
 * means are all decided on the host, where the same answers apply to a local
 * session. This is the device's half of the seam and nothing more.
 */
import { randomBytes } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { z } from 'zod'
import type { remoteFsCode, remoteFsKind } from './protocol.js'

/** The seam's names for the failures a device can originate. */
export type DeviceFsCode = z.infer<typeof remoteFsCode>

/** What a path is, in the seam's vocabulary. */
export type DeviceFsKind = z.infer<typeof remoteFsKind>

/** One path's metadata, as the helper reports it. */
export interface DeviceStat {
  readonly kind: DeviceFsKind
  readonly size: number
  /** Opaque change token; the host only ever compares two of them. */
  readonly version: string
  /** POSIX permission bits, kept for the write path's mode preservation. */
  readonly mode: number
}

/** One directory child, as the helper reports it. */
export interface DeviceListEntry {
  readonly name: string
  readonly kind: DeviceFsKind
  readonly size?: number
  readonly version?: string
}

/**
 * A filesystem failure a client can act on without reading a message.
 *
 * The code is the contract — it is what decides which `FsError` the host
 * raises, in the host's own language — while the message is diagnostics: the
 * platform's own text, naming the path and the errno.
 */
export class DeviceFsError extends Error {
  constructor(message: string, readonly code: DeviceFsCode) {
    super(message)
    this.name = 'DeviceFsError'
  }
}

/** Whether an error means "nothing is there" rather than "something went wrong". */
function isAbsent(error: unknown): boolean {
  const code = errorCode(error)
  // A parent segment being a file makes the target as absent as a missing
  // directory does, which is the same reading the local backend takes.
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** The errno of a failure node's fs operations raise. */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/**
 * The seam's code for a platform failure.
 *
 * Every branch is an errno, never a message: `EACCES` is `EACCES` whatever the
 * device's `LANG` says, and a client can therefore distinguish "you may not"
 * from "it is not there" on a machine whose errors it cannot read.
 */
function codeFor(error: unknown): DeviceFsCode {
  switch (errorCode(error)) {
    case 'ENOENT': return 'FS_NOT_FOUND'
    case 'ENOTDIR': return 'FS_NOT_DIRECTORY'
    case 'EACCES': case 'EPERM': case 'EROFS': return 'FS_PERMISSION_DENIED'
    case 'EISDIR': return 'FS_NOT_REGULAR_FILE'
    default: return 'FS_IO_ERROR'
  }
}

/** Present a failure as this seam's error, passing one through unchanged. */
function failure(error: unknown): DeviceFsError {
  if (error instanceof DeviceFsError) return error
  return new DeviceFsError(error instanceof Error ? error.message : String(error), codeFor(error))
}

/** Run one filesystem operation, translating whatever it throws. */
async function attempt<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw failure(error)
  }
}

/**
 * The change token for one metadata record.
 *
 * Device, inode, size and both timestamps, in nanoseconds — the same five
 * fields the local backend's token is built from, so a token means the same
 * thing on either side of the seam. Nanosecond timestamps rather than
 * milliseconds: a guard that could not tell a rewrite from the state it already
 * read would be a guard that permits the overwrite it exists to refuse.
 */
function versionOf(info: BigIntStats): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
}

/** Name what a followed metadata record describes. */
function kindOf(info: BigIntStats): DeviceFsKind {
  if (info.isFile()) return 'file'
  if (info.isDirectory()) return 'directory'
  return 'other'
}

/** The metadata fields this seam reports. */
function describe(info: BigIntStats): DeviceStat {
  return {
    kind: kindOf(info),
    size: Number(info.size),
    version: versionOf(info),
    mode: Number(info.mode & 0o777n),
  }
}

/** The device's filesystem, for one helper process. */
export class DeviceFileSystem {
  /**
   * A path's canonical form, whether or not it exists.
   *
   * The semantics of `realpath -m`, which is what the assembled-command path
   * ran: every existing prefix is canonicalized — so the device's own symlinks
   * decide the answer, which is why this is a request rather than a computation
   * — and the part that does not exist yet is appended as spelled.
   *
   * One component at a time, rather than canonicalizing the longest existing
   * prefix in one recursive call: only this order answers a path that walks
   * through a symlink into a directory that does not exist, where the prefix
   * resolves but an intermediate one does not.
   *
   * A `..` is resolved textually by `resolve` first, so `link/..` names the
   * link's parent directory rather than the target's. The host resolves relative
   * paths the same way before asking, so both agree on what the caller meant;
   * only a caller that spells `..` across a symlink could tell.
   *
   * @param path - absolute device path, which need not exist.
   * @returns the canonical path.
   */
  async resolve(path: string): Promise<string> {
    const parts = resolve(path).split(sep).filter(part => part !== '')
    let current: string = sep
    for (const part of parts) {
      const candidate = join(current, part)
      try {
        current = await realpath(candidate)
      } catch (error) {
        if (!isAbsent(error)) throw failure(error)
        // Not there yet: keep the name as given and carry on, so the answer
        // covers the whole path rather than only its existing head.
        current = candidate
      }
    }
    return current
  }

  /**
   * One path's metadata.
   * @param path - absolute device path.
   * @param follow - whether a final symlink is followed, as `stat`/`lstat` differ.
   * @returns the record, or null when the path is absent.
   */
  async stat(path: string, follow: boolean): Promise<DeviceStat | null> {
    try {
      const info = await (follow ? stat : lstat)(path, { bigint: true })
      const described = describe(info)
      // A symlink is only ever reported by the non-following call: a followed
      // stat describes what it points at, which is the distinction the local
      // backend draws too.
      return !follow && info.isSymbolicLink() ? { ...described, kind: 'symlink' } : described
    } catch (error) {
      if (isAbsent(error)) return null
      throw failure(error)
    }
  }

  /**
   * A directory's direct children.
   *
   * Each child is reported as the local backend reports one: what a *followed*
   * probe finds, so a symlink to a file is a file. A child that cannot be
   * probed at all — a dangling symlink — is `other` with no version, which is
   * how a caller tells "there but unusable" from "not there".
   *
   * @param path - absolute device path of a directory.
   * @returns one entry per child, in the order the device enumerated them.
   */
  async list(path: string): Promise<DeviceListEntry[]> {
    const entries = await attempt(() => readdir(path, { withFileTypes: true }))
    // Directory order, and deliberately not a sorted one: the order a caller
    // sees is the host's decision, made once for both lanes in the seam above,
    // so that neither this device's enumeration nor the locale it runs under
    // can change what a listing looks like.
    const listed: DeviceListEntry[] = []
    for (const entry of entries) {
      const info = await this.stat(join(path, entry.name), true)
      listed.push({
        name: entry.name,
        kind: info?.kind ?? 'other',
        ...info === null ? {} : { version: info.version },
        ...info?.kind === 'file' ? { size: info.size } : {},
      })
    }
    return listed
  }

  /**
   * One byte window of a file.
   *
   * A window that comes back short is the end of the file — that is the whole
   * end-of-file protocol, and why the reply carries no flag.
   *
   * @param path - absolute device path of a regular file.
   * @param offset - byte to start at; past the end reads nothing.
   * @param length - how many bytes may be read, already bounded by the caller.
   * @returns the bytes read, at most `length`.
   */
  async read(path: string, offset: number, length: number): Promise<Buffer> {
    const handle = await attempt(() => open(path, 'r'))
    try {
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await attempt(() => handle.read(buffer, 0, length, offset))
      return buffer.subarray(0, bytesRead)
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  /**
   * Publish a file's bytes, atomically.
   *
   * A staging file beside the destination, then a rename, which is the same two
   * steps the local backend takes and for the same reason: a reader either sees
   * the whole previous file or the whole new one, never a half-written mixture.
   * The staging name is short and random rather than derived from the
   * destination's, so a filename already at the platform's length limit does not
   * push the staging name past it.
   *
   * The mode is carried over from an existing destination, and a new file gets
   * the owner-only mode the local backend gives one — `fchmod` after creation
   * rather than a mode at `open`, which the umask would mask.
   *
   * @param path - absolute device path to publish.
   * @param data - the file's whole contents.
   * @returns the published file's metadata, read after the rename.
   */
  async write(path: string, data: Buffer): Promise<DeviceStat> {
    const directory = dirname(path)
    // Missing parents are created, as `mkdir -p` did on the assembled-command
    // path and as the local backend does: a write names the file it wants to
    // exist, not the directory it assumes.
    await attempt(() => mkdir(directory, { recursive: true }))
    const existing = await this.stat(path, true)
    const mode = existing === null ? 0o600 : existing.mode
    const staging = join(directory, `.dshell-${String(process.pid)}-${randomBytes(6).toString('hex')}.tmp`)
    let staged = false
    try {
      const handle = await attempt(() => open(staging, 'wx', 0o600))
      staged = true
      try {
        await attempt(() => handle.writeFile(data))
        await attempt(() => handle.chmod(mode))
      } finally {
        await handle.close().catch(() => undefined)
      }
      await attempt(() => rename(staging, path))
      staged = false
    } finally {
      // A staging file that was never renamed is nobody's: the destination is
      // untouched, so the only trace of the failed write is this name.
      if (staged) await unlink(staging).catch(() => undefined)
    }
    const written = await this.stat(path, true)
    if (written === null) throw new DeviceFsError(`the write to ${basename(path)} produced no file`, 'FS_IO_ERROR')
    return written
  }
}
