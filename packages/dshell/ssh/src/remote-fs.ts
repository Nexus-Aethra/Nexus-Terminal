/**
 * The device's filesystem, as `ctx.fs` sees it.
 *
 * This class is the *policy* half of the remote backend: which path a caller
 * meant, whether a write's guard still holds, what a literal edit means, and
 * how line endings survive it. None of that depends on how bytes travel, and
 * all of it must give the same answer here as it does for a local session, so
 * it is written once and both lanes run it.
 *
 * The *transport* half is one of two lanes, chosen per call:
 *
 *  - the helper, when the device has one verified right now — a request per
 *    primitive over the connection it is already serving; or
 *  - the assembled-command path, one `ssh` invocation per primitive — which is
 *    also the only lane a device without Node has.
 *
 * Two things are deliberately borrowed from the local backend instead of being
 * re-implemented on either side, because they are the semantics a second copy
 * would silently drift from:
 *
 *  - the literal-edit rules (empty match, ambiguity, replace-all) and the
 *    line-ending discipline (detect, normalize for the diff basis, restore on
 *    write) — mirrored in `./literal-edit.ts` from the local backend, with the
 *    reasoning for the copy recorded there.
 *
 * Nothing is cached. The harness's staleness guards compare opaque version
 * tokens, so a cache could only ever report a version the device no longer has.
 *
 * A mutation of one target is serialized per target by the provider that owns
 * this class, which is what makes the read-check-write sequences here — the
 * write guard, the edit guard — count for anything within this host.
 */
import { isAbsolute, join } from 'node:path'
import { FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type {
  FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo,
  FsTarget, FsWriteIntent, FsWriteOutcome,
} from '@deepseek-ai/dsh-fs'
import type { MountMapping } from './mount.js'
import { toRemotePath } from './mount.js'
import {
  applyLiteralEdit, detectLineEndings, normalizeLineEndings, restoreLineEndings,
} from './literal-edit.js'
import type { RemoteFsDeps, RemoteFsTransport } from './remote-fs-transport.js'
import { HelperFsTransport } from './remote-fs-helper.js'
import { ShellFsTransport } from './remote-fs-shell.js'

/** Everything the remote backend needs, including how it reaches the device. */
export interface RemoteFsOptions extends RemoteFsDeps {
  /** The session's remote root and the local directory mirroring it. */
  readonly mapping: MountMapping
  /** Overwrite-diff basis limit, matching the local backend's knob. */
  readonly diffBasisMaxBytes: number
}

/**
 * One device's filesystem.
 *
 * Not a Service: it is a value the routing backend constructs per call for the
 * session that call belongs to, so nothing here is shared across sessions and
 * there is no per-device state to invalidate. That is also what keeps the lane
 * choice fresh per call: a device whose helper comes up — or goes away — is
 * answered by the lane that fits, from the next operation on.
 */
export class RemoteFileSystem {
  private readonly transport: RemoteFsTransport

  constructor(private readonly deps: RemoteFsOptions) {
    const { connection } = deps
    this.transport = connection === undefined ? new ShellFsTransport(deps) : new HelperFsTransport(connection)
  }

  /** The device's absolute path for a path in this machine's namespace. */
  private remote(path: string): string {
    return toRemotePath(this.deps.mapping, path)
  }

  /** Resolve a caller path (relative to `cwd`) into a device path. */
  private remoteFrom(cwd: string | undefined, path: string): string {
    const base = cwd ?? this.deps.mapping.mount
    const local = isAbsolute(path) ? path : join(base, path)
    return this.remote(local)
  }

  /** Resolve a caller path into a target identity on the device. */
  async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    if (opts?.signal?.aborted === true) throw new FsError('resolve aborted', 'FS_ABORTED')
    if (path.trim().length === 0) throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND')
    const remote = this.remoteFrom(opts?.cwd, path)
    // The device canonicalizes, because only it knows how its own symlinks
    // resolve — and it does so for a path that does not exist yet, the way the
    // local backend resolves a missing file through its nearest existing
    // ancestor.
    const target = await this.transport.resolve(remote, opts?.signal)
    return { targetKey: FsTargetKey(target), displayPath: remote }
  }

  /** Metadata for a resolved target; `undefined` when the device has no such file. */
  async stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    const info = await this.transport.stat(String(target.targetKey), true, signal)
    if (info === undefined) return undefined
    return { version: info.version, type: info.kind === 'file' || info.kind === 'directory' ? info.kind : 'other', size: info.size }
  }

  /** Metadata for a path without following a final symlink. */
  async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    if (path.trim().length === 0) throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND')
    const remote = this.remoteFrom(opts?.cwd, path)
    const info = await this.transport.stat(remote, false, signal)
    if (info === undefined) return undefined
    return { version: info.version, type: info.kind, size: info.size }
  }

  /** Read one file as UTF-8 text. */
  async readText(target: FsTarget, signal?: AbortSignal): Promise<string> {
    const raw = await this.readBytes(target, signal, 64 * 1024 * 1024, target.displayPath)
    return decodeText(raw, target.displayPath)
  }

  /** Stream one file's text. */
  async streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    const displayPath = target.displayPath
    const chunks = await this.transport.stream(String(target.targetKey), signal)
    return (async function* stream(): AsyncIterable<string> {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      try {
        for await (const chunk of chunks) yield decoder.decode(chunk, { stream: true })
        const tail = decoder.decode()
        if (tail.length > 0) yield tail
      } catch (error) {
        if (signal?.aborted === true) throw new FsError('read aborted', 'FS_ABORTED', { cause: error })
        // A failure the transport already named is not a decoding failure:
        // calling a broken connection "not valid UTF-8" would send a caller
        // looking for the wrong problem.
        if (error instanceof FsError) throw error
        throw new FsError(`cannot read "${displayPath}": not valid UTF-8 text`, 'FS_NOT_TEXT', { cause: error })
      }
    })()
  }

  /** Read at most `maxBytes` bytes of one file. */
  async readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number, displayPath = target.displayPath): Promise<Uint8Array> {
    // One byte more than allowed, so "exactly at the limit" and "over it" stay
    // distinguishable without asking the device how large the file is.
    const bytes = await this.transport.read(String(target.targetKey), 0, maxBytes + 1, signal)
    if (bytes.byteLength > maxBytes) {
      throw new FsError(`cannot read "${displayPath}": file exceeds the ${String(maxBytes)} byte limit`, 'FS_TOO_LARGE')
    }
    return bytes
  }

  /** Read one byte window of a file. */
  async readByteRange(target: FsTarget, range: { offset: number; length: number }, signal?: AbortSignal): Promise<Uint8Array> {
    return await this.transport.read(String(target.targetKey), range.offset, range.length, signal)
  }

  /** Direct children of a directory, ordered by name. */
  async listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    const remote = String(target.targetKey)
    const entries = await this.transport.list(remote, signal)
    // Ordered here rather than on the device, because the order is part of what
    // a caller sees and exactly one place should decide it: a device's own
    // enumeration order is a filesystem detail, and the locale it runs under is
    // a configuration nobody chose for this listing. A fixed collation also
    // means the same directory reads the same way on either lane and from
    // either machine — English collation being the order the local backend
    // produces for the ASCII names a source tree is made of.
    return entries
      .sort((left, right) => left.name.localeCompare(right.name, 'en'))
      .map(entry => ({
        name: entry.name,
        type: entry.kind === 'symlink' ? 'other' : entry.kind,
        target: { targetKey: FsTargetKey(join(remote, entry.name)), displayPath: join(target.displayPath, entry.name) },
        ...entry.version === undefined ? {} : { version: entry.version },
        ...entry.size === undefined ? {} : { size: entry.size },
      }))
  }

  /** Write one file, honouring the caller's guard. */
  async writeText(
    target: FsTarget,
    content: string,
    expected?: FsWriteIntent,
    signal?: AbortSignal,
  ): Promise<FsWriteOutcome> {
    const remote = String(target.targetKey)
    const existing = await this.transport.stat(remote, true, signal)
    if (existing !== undefined && existing.kind !== 'file') {
      throw new FsError(`cannot write "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (existing === undefined) throw new FsError(`cannot write "${target.displayPath}": file no longer exists`, 'FS_STALE_VERSION')
      if (existing.version !== expected.version) {
        throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
      }
    } else if (expected?.kind === 'createIfAbsent' && existing !== undefined) {
      throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, 'FS_NOT_OBSERVED')
    }
    const diffable = existing !== undefined
      && Buffer.byteLength(content, 'utf8') < this.deps.diffBasisMaxBytes
    const before = diffable ? await this.readText(target, signal).catch(() => null) : null
    const after = await this.publish(remote, content, signal)
    return {
      operation: existing === undefined ? 'create' : 'update',
      version: after?.version ?? FsVersion(`missing:${remote}`),
      before: before === null ? null : normalizeLineEndings(before),
      after: normalizeLineEndings(content),
    }
  }

  /** Apply one literal edit, honouring the caller's version guard. */
  async editText(
    target: FsTarget,
    edit: FsEditRequest,
    expected?: { version: FsVersion },
    signal?: AbortSignal,
  ): Promise<FsEditOutcome> {
    const remote = String(target.targetKey)
    const existing = await this.transport.stat(remote, true, signal)
    if (existing === undefined) throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
    if (existing.kind !== 'file') throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, 'FS_NOT_REGULAR_FILE')
    if (expected !== undefined && existing.version !== expected.version) {
      throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, 'FS_STALE_VERSION')
    }
    const raw = await this.readText(target, signal)
    const lineEndings = detectLineEndings(raw)
    const original = normalizeLineEndings(raw)
    const edited = applyLiteralEdit(original, edit.oldString, edit.newString, edit.replaceAll, target.displayPath)
    const after = await this.publish(remote, restoreLineEndings(edited.content, lineEndings), signal)
    return {
      version: after?.version ?? FsVersion(`missing:${remote}`),
      before: original,
      after: edited.content,
    }
  }

  /**
   * Replace a file's contents atomically.
   *
   * The lane decides how, and both of its answers have the two properties the
   * local backend's atomic write provides: the replacement is a rename inside
   * the destination's directory, and an existing file's mode is carried over.
   * The helper, which performs the rename on the device, reports the new
   * metadata in the same reply; the assembled lane has to be asked afterwards,
   * one round trip of its own.
   *
   * @param remote - absolute device path to publish.
   * @param content - the file's whole contents.
   * @param signal - cancellation; a published file is not rolled back.
   * @returns the published file's metadata, or undefined if the device reports
   *   nothing and the follow-up probe finds nothing either.
   */
  private async publish(
    remote: string,
    content: string,
    signal?: AbortSignal,
  ): Promise<{ version: FsVersion } | undefined> {
    return await this.transport.write(remote, content, signal)
      ?? await this.transport.stat(remote, true, signal)
  }
}

/** Decode UTF-8 bytes, reporting the seam's not-text code for binary content. */
function decodeText(bytes: Uint8Array, displayPath: string): string {
  if (bytes.includes(0)) throw new FsError(`cannot read "${displayPath}": binary file`, 'FS_NOT_TEXT')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw new FsError(`cannot read "${displayPath}": not valid UTF-8 text`, 'FS_NOT_TEXT', { cause: error })
  }
}
