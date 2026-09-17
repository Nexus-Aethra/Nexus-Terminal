/**
 * The assembled-command lane of the device filesystem.
 *
 * One `ssh` invocation per operation, its output parsed back into the seam's
 * vocabulary. This is what the whole package did before the helper, and it
 * keeps two jobs: it is the tier a device without Node has — the helper *is* a
 * Node process, so nothing can be done about that from here — and it answers
 * while a helper connection is still being established.
 *
 * Its costs are the reason the helper exists, and they are visible in this
 * file: a filename may contain any byte but NUL, so a listing needs a
 * NUL-separated `find -printf`; `stat` and `find` localize their output, so
 * every invocation pins `LC_ALL=C`; and a failure can only be classified by
 * matching English text out of stderr, which reports a permission problem on a
 * non-English device as an unknown I/O fault.
 */
import { FsError, FsVersion } from '@deepseek-ai/dsh-fs'
import type { DshellSshTranslate } from './host-locales.js'
import type {
  RemoteFsDeps, RemoteFsTransport, RemoteKind, RemoteListEntry, RemoteStat,
} from './remote-fs-transport.js'
import { localCwd, quote, sshArgv, sshEnv } from './runner.js'

/** The error text this file's classifier reads; see the note in the module header. */
const MISSING_PATH = /No such file or directory|cannot statx? .*No such/i

/**
 * `stat`'s machine-readable record: filesystem type, size, device, inode, and
 * both timestamps.
 *
 * `%F` prints a *localized* phrase for the type, and `%y`/`%z` a locale-shaped
 * date, which is why every call pins `LC_ALL=C`.
 */
const STAT_FORMAT = '%F|%s|%d|%i|%y|%z'

/**
 * `find -printf`'s record, one child per six NUL-terminated fields.
 *
 * The separators are spelled `\0` (backslash, zero) rather than embedded NUL
 * bytes on purpose: this string travels as one argv element of the local `ssh`
 * process, and a real NUL cannot cross that boundary at all — Node refuses the
 * spawn. The remote login shell passes the two characters through its single
 * quotes untouched, and GNU `find -printf` turns `\0` into the NUL it emits.
 */
const FIND_FORMAT = '%f\\0%y\\0%s\\0%d\\0%i\\0%T@\\0'

/** One finished remote command. */
interface RemoteRun {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly truncated: boolean
}

/** The device filesystem over `ssh`, one command per operation. */
export class ShellFsTransport implements RemoteFsTransport {
  constructor(private readonly deps: RemoteFsDeps) {}

  /** Run one command on the device and collect its output. */
  private async run(
    command: string,
    options: { signal?: AbortSignal | undefined; stdin?: string | undefined; maxBytes?: number | undefined } = {},
  ): Promise<RemoteRun> {
    const maxBytes = options.maxBytes ?? 8 * 1024 * 1024
    const handle = this.deps.ctx.subprocess.spawn({
      argv: sshArgv(this.deps.device, command),
      cwd: localCwd(),
      stdio: {
        stdin: options.stdin === undefined ? 'ignore' : { data: options.stdin },
        stdout: { maxBytes },
        stderr: { maxBytes: 64 * 1024 },
      },
      graceMs: 5_000,
      env: sshEnv(this.deps.device),
      ...options.signal === undefined ? {} : { signal: options.signal },
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (outcome.exitCode === null) {
      throw new FsError(this.deps.t('error.remoteSignal', { signal: String(outcome.signal ?? 'unknown') }), 'FS_ABORTED')
    }
    return {
      stdout: stdout?.text ?? '',
      stderr: stderr?.text ?? '',
      exitCode: outcome.exitCode,
      truncated: stdout?.lossy === true,
    }
  }

  /**
   * Run one command and collect its stdout as raw bytes.
   *
   * Text collection decodes and would corrupt binary output, so image and
   * byte-range reads go through a raw pipe instead.
   */
  private async runBinary(command: string, signal?: AbortSignal): Promise<Buffer> {
    const handle = this.deps.ctx.subprocess.spawn({
      argv: sshArgv(this.deps.device, command),
      cwd: localCwd(),
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 64 * 1024 } },
      graceMs: 5_000,
      env: sshEnv(this.deps.device),
      ...signal === undefined ? {} : { signal },
    })
    const chunks: Buffer[] = []
    if (handle.stdout !== undefined) {
      for await (const chunk of handle.stdout as AsyncIterable<Buffer>) chunks.push(chunk)
    }
    const outcome = await handle.done
    if (outcome.exitCode === null) {
      throw new FsError(this.deps.t('error.remoteSignal', { signal: String(outcome.signal ?? 'unknown') }), 'FS_ABORTED')
    }
    if (outcome.exitCode !== 0) {
      // stderr was collected alongside the piped stdout and has to be read back
      // for the classifier to see it: a failure handed an empty stream is
      // classified from nothing, and every read that failed for a knowable
      // reason reported an unknown I/O fault instead.
      const stderr = handle.collected.stderr?.readFrom(0)
      throw classifyRemoteFailure({
        stdout: '',
        stderr: stderr?.text ?? '',
        exitCode: outcome.exitCode,
        truncated: false,
      }, command, this.deps.t)
    }
    return Buffer.concat(chunks)
  }

  /** Run one command that must succeed, mapping its failure onto the seam's codes. */
  private async runOrThrow(
    command: string,
    displayPath: string,
    options: { signal?: AbortSignal | undefined; stdin?: string | undefined; maxBytes?: number | undefined } = {},
  ): Promise<RemoteRun> {
    const result = await this.run(command, options)
    if (result.exitCode === 0) return result
    throw classifyRemoteFailure(result, displayPath, this.deps.t)
  }

  /** @inheritDoc */
  async resolve(path: string, signal?: AbortSignal): Promise<string> {
    // `-m` canonicalizes a path that does not exist yet, the way the local
    // backend resolves a missing file through its nearest existing ancestor.
    const result = await this.runOrThrow(`realpath -m -- ${quote(path)}`, path, { signal })
    return result.stdout.trim()
  }

  /** @inheritDoc */
  async stat(path: string, follow: boolean, signal?: AbortSignal): Promise<RemoteStat | undefined> {
    const flag = follow ? '-Lc' : '-c'
    const result = await this.run(`LC_ALL=C stat ${flag} ${quote(STAT_FORMAT)} -- ${quote(path)}`, { signal })
    if (result.exitCode !== 0) {
      if (MISSING_PATH.test(result.stderr)) return undefined
      throw classifyRemoteFailure(result, path, this.deps.t)
    }
    const [kind, size, device, inode, mtime, ctime] = result.stdout.trimEnd().split('|')
    return {
      kind: kindFromStat(kind ?? ''),
      size: Number(size ?? '0'),
      version: FsVersion(`${device ?? ''}:${inode ?? ''}:${mtime ?? ''}:${ctime ?? ''}`),
    }
  }

  /** @inheritDoc */
  async list(path: string, signal?: AbortSignal): Promise<RemoteListEntry[]> {
    const result = await this.runOrThrow(
      `LC_ALL=C find -- ${quote(path)} -mindepth 1 -maxdepth 1 -printf ${quote(FIND_FORMAT)}`,
      path,
      { signal },
    )
    const fields = result.stdout.split('\0')
    const entries: RemoteListEntry[] = []
    for (let index = 0; index + 5 < fields.length; index += 6) {
      const name = fields[index] ?? ''
      if (name === '') continue
      const kind = kindFromFind(fields[index + 1] ?? '')
      entries.push({
        name,
        // `find %y` describes the entry itself, so a symlink is reported as one
        // here where the helper lane — like the local backend — reports what it
        // points at. A known difference between the two lanes, recorded rather
        // than papered over: this lane disappears with the no-Node tier.
        kind: kind === 'symlink' ? 'other' : kind,
        size: Number(fields[index + 2] ?? '0'),
        version: FsVersion(`${fields[index + 3] ?? ''}:${fields[index + 4] ?? ''}:${fields[index + 5] ?? ''}`),
      })
    }
    return entries
  }

  /** @inheritDoc */
  async read(path: string, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    // A window at the start is one `head`; further in, `tail` skips to it. Two
    // programs because POSIX `head` has no offset and `tail` has no length.
    const command = offset === 0
      ? `head -c ${String(length)} -- ${quote(path)}`
      : `tail -c +${String(offset + 1)} -- ${quote(path)} | head -c ${String(length)}`
    return await this.runBinary(command, signal)
  }

  /** @inheritDoc */
  async stream(path: string, signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>> {
    const deps = this.deps
    return Promise.resolve((async function* stream(): AsyncIterable<Uint8Array> {
      const handle = deps.ctx.subprocess.spawn({
        argv: sshArgv(deps.device, `cat -- ${quote(path)}`),
        cwd: localCwd(),
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: 64 * 1024 } },
        graceMs: 5_000,
        env: sshEnv(deps.device),
        ...signal === undefined ? {} : { signal },
      })
      if (handle.stdout === undefined) throw new FsError(`cannot read "${path}"`, 'FS_IO_ERROR')
      for await (const chunk of handle.stdout as AsyncIterable<Buffer>) yield chunk
      const outcome = await handle.done
      if (outcome.exitCode !== 0) {
        throw classifyRemoteFailure({ stdout: '', stderr: '', exitCode: outcome.exitCode ?? 1, truncated: false }, path, deps.t)
      }
    })())
  }

  /**
   * @inheritDoc
   *
   * The staging file is created in the destination directory by `mktemp`, so
   * the final `mv` is a same-filesystem rename, and an existing file's mode is
   * carried over before the rename — the same two properties the local
   * backend's atomic write provides. A staging directory is `mkdir`-ed first
   * because the seam's callers write into directories that may not exist yet.
   */
  async write(path: string, content: string, signal?: AbortSignal): Promise<undefined> {
    const script = [
      'd=$(dirname -- "$1")',
      'mkdir -p -- "$d"',
      't=$(mktemp --tmpdir="$d" .dshell-XXXXXX)',
      'cat > "$t"',
      'if [ -e "$1" ]; then chmod --reference="$1" "$t" 2>/dev/null || true; fi',
      'mv -f -- "$t" "$1"',
    ].join(' && ')
    const result = await this.run(`sh -c ${quote(script)} sh ${quote(path)}`, { signal, stdin: content })
    if (result.exitCode !== 0) throw classifyRemoteFailure(result, path, this.deps.t)
    // No metadata comes back from a shell script, so the caller asks again: one
    // extra round trip on this lane only.
    return undefined
  }
}

/** Map a `stat -c %F` word onto the seam's type vocabulary. */
function kindFromStat(word: string): RemoteKind {
  if (word === 'regular file' || word === 'regular empty file') return 'file'
  if (word === 'directory') return 'directory'
  if (word === 'symbolic link') return 'symlink'
  return 'other'
}

/** Map a `find -printf %y` code onto the seam's type vocabulary. */
function kindFromFind(code: string): RemoteKind {
  if (code === 'f') return 'file'
  if (code === 'd') return 'directory'
  if (code === 'l') return 'symlink'
  return 'other'
}

/** Turn a failed remote command into the seam's error vocabulary. */
function classifyRemoteFailure(result: RemoteRun, displayPath: string, t: DshellSshTranslate): FsError {
  const message = result.stderr.trim() === '' ? t('error.remoteFailed', { code: result.exitCode }) : result.stderr.trim()
  const code = /Permission denied/i.test(message)
    ? 'FS_PERMISSION_DENIED'
    : /No such file or directory/i.test(message)
      ? 'FS_NOT_FOUND'
      : /Not a directory/i.test(message)
        ? 'FS_NOT_DIRECTORY'
        : /Is a directory/i.test(message)
          ? 'FS_NOT_REGULAR_FILE'
          : 'FS_IO_ERROR'
  return new FsError(`${displayPath}: ${message}`, code)
}
