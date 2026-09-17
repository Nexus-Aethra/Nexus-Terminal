/**
 * Where a device's helper is, and which Node runs it.
 *
 * M1 needs a target to connect to, and M4 will make finding it a user-facing,
 * recorded thing (the Test action probes, an install action bootstraps, a
 * `DeviceRecord` remembers). Until then this resolves one by asking the device
 * once and remembering the answer: the same two questions M4's probe will ask,
 * minus the UI and the persistence.
 *
 * The probe rides the legacy per-command path — it is the one thing that still
 * works before a helper exists — and asks for the device's home directory and a
 * Node executable in one round trip.
 *
 * **A device without Node is not an error here.** It is the case the design
 * already accounts for: the answer is `undefined`, and every caller falls back
 * to the assembled-command path, which is why that path is a compatibility tier
 * rather than a rollback waiting to be deleted.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { DeviceConnection } from '../devices.js'
import { localCwd, sshArgv, sshEnv } from '../runner.js'

/**
 * The probe: the device's home directory, then a Node executable if it has one.
 *
 * `command -v` is asked twice on purpose. The first attempt uses whatever PATH
 * the ssh session starts with, which on many hosts is enough; the second runs
 * through a login shell, because a Node installed by a version manager lives on
 * a PATH that only a profile sets. Both are silent on failure — the answer
 * "none" is a legitimate outcome, not something to report as an error.
 *
 * The string is a fixed literal with the newline escaped for the remote
 * `printf`, so no caller-supplied text passes through a shell here.
 */
/** Exported so the install probe can re-run without re-asking the cache. */
export const PROBE = 'printf "%s\\n%s\\n" "$HOME" "$(command -v node 2>/dev/null || bash -lc "command -v node" 2>/dev/null || true)"'

/**
 * The probe the connection check uses: {@link PROBE} plus the digest of the
 * helper this build would deploy, so one round trip answers all three of the
 * questions a reader asks a device — can I reach it, is there a node, is the
 * helper current.
 *
 * A survey, not a deployment: an empty digest means the file is not there, a
 * digest that is not `expectedHash` means the device has a different build.
 * Both are states the connection check reports; neither is a failure, which is
 * why every step of the line tolerates its own absence.
 *
 * `expectedHash` is this build's own artifact digest. It is asserted to be hex
 * before it reaches the shell — not because a caller could pass something else
 * today, but because a path built from a string that travels through `ssh`
 * should not depend on that staying true.
 * @param expectedHash - digest of the helper bundle this build ships.
 * @returns the remote shell line.
 */
export function installProbe(expectedHash: string): string {
  if (!/^[0-9a-f]{64}$/u.test(expectedHash)) {
    throw new Error(`refusing to build a probe from a non-digest: ${JSON.stringify(expectedHash)}`)
  }
  const digest = `$(sha256sum -- "$HOME/${HELPER_DIRECTORY}/helper-${expectedHash}.mjs" 2>/dev/null | awk '{print $1}')`
  return `printf "%s\\n%s\\n%s\\n" "$HOME" "$(command -v node 2>/dev/null || bash -lc "command -v node" 2>/dev/null || true)" "${digest}"`
}

/** Where a device's helper lives, and the digest it must report. */
export interface ResolvedTarget {
  /** Absolute remote Node executable. */
  node: string
  /** Absolute path of the installed helper entry on the device. */
  helper: string
  /** The digest the device's entry must report. */
  expectedHash: string
}

/** Device subdirectory the helper is installed under, relative to the home. */
const HELPER_DIRECTORY = '.dshell/helper'

/**
 * Resolved targets by device, so a session's first spawn does not pay for a
 * probe that a later one has already answered.
 *
 * Deliberately not a TTL cache: the answer changes when someone deploys Node or
 * the helper, and both of those are moments the host already handles by calling
 * {@link drop} (a device is saved, deleted, or re-bound). A timeout would
 * instead make behaviour depend on how long ago the last probe ran.
 */
export class HelperTargets {
  private readonly cache = new Map<string, Promise<ResolvedTarget | undefined>>()

  /**
   * @param ctx - host context holding the subprocess seam for the probe.
   * @param artifact - the helper this build ships, read at call time.
   */
  constructor(
    private readonly ctx: Context,
    private readonly artifact: () => { hash: string },
  ) {}

  /**
   * Resolve a device's target, probing once.
   * @param device - device to ask.
   * @returns the target, or undefined when the device has no Node to run it.
   */
  async resolve(device: DeviceConnection): Promise<ResolvedTarget | undefined> {
    const existing = this.cache.get(device.id)
    if (existing !== undefined) return await existing
    const pending = this.probe(device)
    this.cache.set(device.id, pending)
    try {
      return await pending
    } catch (error) {
      // A probe that failed is not an answer: the next caller should try again
      // rather than inherit a network blip for the life of the process.
      this.cache.delete(device.id)
      throw error
    }
  }

  /**
   * Forget one device's answer, so the next resolve asks again.
   * @param deviceId - device whose target changed or went away.
   */
  drop(deviceId: string): void {
    this.cache.delete(deviceId)
  }

  /** Forget every answer. */
  dropAll(): void {
    this.cache.clear()
  }

  /** Ask the device where its home is and whether it has Node. */
  private async probe(device: DeviceConnection): Promise<ResolvedTarget | undefined> {
    const handle = this.ctx.subprocess.spawn({
      argv: sshArgv(device, PROBE),
      cwd: localCwd(),
      ...Object.keys(sshEnv(device)).length === 0 ? {} : { env: sshEnv(device) },
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 8 * 1024 },
        stderr: { maxBytes: 8 * 1024 },
      },
      graceMs: 10_000,
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
      throw new Error(stderr === '' ? `the device probe exited ${String(outcome.exitCode ?? 'on a signal')}` : stderr)
    }
    const [home = '', node = ''] = (handle.collected.stdout?.readFrom(0).text ?? '').trimEnd().split('\n')
    if (home.trim() === '' || !home.startsWith('/')) {
      throw new Error('the device did not report a usable home directory')
    }
    if (node.trim() === '' || !node.startsWith('/')) return undefined
    return {
      node: node.trim(),
      helper: `${home.trim().replace(/\/$/u, '')}/${HELPER_DIRECTORY}/helper-${this.artifact().hash}.mjs`,
      expectedHash: this.artifact().hash,
    }
  }
}
