/**
 * The subprocess seam: where a device session's processes actually leave.
 *
 * dshell routes by wrapping one service method rather than by replacing a
 * provider, because a device binding is per *session* while a service provider
 * is per *context* — the reason upstream's ssh family cannot be adopted
 * wholesale. `ctx.subprocess.spawn` is the funnel every local process already
 * passes through, so a bound session's spawn is answered here. It is wrapped on
 * the prototype that owns the method, for the same reason the shell seam is: a
 * prototype method is reached identically through `ctx.subprocess` and
 * `ctx.get('subprocess')`.
 *
 * Three outcomes, in order of preference:
 *
 * 1. **RPC**, when a verified helper connection exists and the caller asked for
 *    a shape it can serve. The command travels as argv; nothing is assembled.
 * 2. **The assembled-command path**, otherwise — one `ssh` invocation whose
 *    remote line is `cd … && exec …`. This is what the whole package did before
 *    this milestone. It still earns its place for two reasons: it serves output
 *    modes RPC cannot (`'pipe'`, `'inherit'`, a control channel — the local ssh
 *    client has real pipes), and it is the tier a device without Node falls back
 *    to.
 * 3. **The caller's own spawn**, for a session with no assignment at all.
 *
 * The choice is made per call, so a device whose helper is not up yet — or was
 * never installed — behaves exactly as it did before this milestone rather than
 * failing.
 *
 * Paths in results need no translation: the command runs with the device
 * directory as its working directory, so a tool that prints relative paths
 * prints them relative to the same tree its input named.
 */
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SshRouter } from './router.js'
import { localCwd, quote, sshArgv, sshEnv } from './runner.js'
import { remoteDirFor } from './mount.js'
import { DshellSshConnection, DshellSshConnections, localHelperArtifact } from './connection.js'
import { HelperTargets } from './helper/target.js'
import { RemoteProcess, supportsStdio } from './remote-process.js'

/**
 * The device's own ripgrep.
 *
 * The search tool resolves an absolute path in the *host's* world, which the
 * device cannot execute, so the program is renamed to a bare `rg` and the
 * device resolves it from its own PATH. Missing it is a setup fact rather than
 * a search error, so say which one it is instead of letting the platform report
 * a bare "no such file".
 */
const MISSING_RG = 'dshell-ssh: the device has no rg (ripgrep) on PATH; glob and grep run there'

/**
 * The one method this module replaces, typed structurally: `spawn` is
 * synchronous and returns a handle, which is what lets a device process be
 * reported to a caller that knows nothing about where it runs.
 */
interface SubprocessShape {
  spawn(this: unknown, spec: SubprocessSpawnSpec): SubprocessHandle
}

/**
 * How the DEVICE should name a program the caller resolved for the host.
 *
 * `undefined` means "not translatable" — an absolute host path whose device
 * equivalent we do not know. Those take the assembled-command path, where the
 * device reports its own error. Renaming on a guess would silently run a
 * *different* program than the caller named, which is worse than failing.
 *
 * @param program - the caller's `argv[0]`.
 * @returns the device-side program name, or undefined when unknown.
 */
export function deviceProgram(program: string): string | undefined {
  const name = basename(program)
  // The search tool's resolver produces either `rg` (the platform package) or
  // the single-file runtime's `<executable>-rg` sidecar; both mean the device's.
  if (name === 'rg' || name.endsWith('-rg')) return 'rg'
  // A bare name is the device's to resolve from its own PATH.
  return program.includes('/') ? undefined : program
}

/**
 * Install the subprocess seam.
 *
 * Also owns the helper's lifetime: the connection pool and the target cache are
 * created here because this is the only place that uses them, and the router is
 * told about device changes so a saved, deleted or newly bound device does not
 * keep a stale answer — or a connection nobody will close.
 *
 * @param ctx - host context holding the subprocess service.
 * @param router - device assignments.
 * @returns disposer restoring the original method and closing the pool.
 */
export function installSpawnRouting(ctx: Context, router: SshRouter): () => void {
  const subprocess: SubprocessRuntime | undefined = ctx.get('subprocess')
  if (subprocess === undefined) return () => {}
  const connections = new DshellSshConnections()
  const targets = new HelperTargets(ctx, localHelperArtifact)
  // The filesystem provider reaches the helper through the router, because the
  // pool's lifetime belongs to this seam: a second pool would mean a second
  // helper process on the device.
  router.helperConnection = deviceId => connections.peek(deviceId)
  // A device that changed, or one a session was just bound to. Saving or
  // deleting drops both cached answers and any live connection, because that
  // connection was verified against a target which no longer applies.
  router.onDeviceChanged = (deviceId, event) => {
    targets.drop(deviceId)
    void connections.release(deviceId)
    if (event !== 'bound') return
    // Warm on bind so the first tool call usually finds a helper already there.
    // Nothing depends on it — the seam falls back on its own — so a failure is
    // only logged.
    void (async () => {
      const device = router.deviceFor(deviceId)
      if (device === undefined) return
      const target = await targets.resolve(device)
      if (target === undefined) return
      await connections.forDevice(device, target)
    })().catch((error: unknown) => {
      ctx.logger.info(`dshell-ssh: no helper on "${deviceId}" yet (${error instanceof Error ? error.message : String(error)})`)
    })
  }
  let owner = Object.getPrototypeOf(subprocess) as Record<string, unknown> | null
  while (owner !== null && !Object.prototype.hasOwnProperty.call(owner, 'spawn')) {
    owner = Object.getPrototypeOf(owner) as Record<string, unknown> | null
  }
  if (owner === null) return () => {}
  const target = owner as unknown as SubprocessShape
  const original = target.spawn
  target.spawn = function spawn(this: unknown, spec: SubprocessSpawnSpec): SubprocessHandle {
    const agent = ctx.agents.currentInitiator()
    const assignment = agent === undefined ? undefined : router.targetForSession(String(agent.id))
    if (assignment === undefined) return original.call(this, spec)
    // Checked BEFORE the RPC branch, and for two reasons at once. The legacy hop
    // builds its own ssh argv, so routing it would recurse into this same seam —
    // and `ssh` is a bare name, so it would otherwise look perfectly routable
    // and end up running an ssh client *on the device*, with the host's argv,
    // credentials and known_hosts paths.
    //
    // That hop is not migration debt. It is the lane this seam takes whenever
    // the RPC branch below does not apply — no verified connection, an
    // unresolvable program, or a stdio shape the connection does not carry —
    // and it is the only lane a device without Node has. The file layer keeps
    // its own copy of the same two-lane choice (`remote-fs-shell.ts` beside
    // `remote-fs-helper.ts`), so its commands arrive here as `ssh` and take
    // this branch rather than being routed a second time.
    if (basename(spec.argv[0] ?? '') === 'ssh') return original.call(this, spec)
    const directory = remoteDirectory(assignment, spec.cwd)
    const program = deviceProgram(spec.argv[0] ?? '')
    const connection: DshellSshConnection | undefined = connections.peek(assignment.device.id)
    if (connection !== undefined && program !== undefined && supportsStdio(spec)) {
      return new RemoteProcess(connection, { ...spec, cwd: directory }, {
        program,
        // Preserve the diagnostic the assembled path used to produce: the same
        // cause arrives here as a platform error object instead of a message.
        describeStartFailure: (name, error) => name === 'rg' && /ENOENT/u.test(error.message)
          ? new Error(MISSING_RG, { cause: error })
          : error,
      })
    }
    // The legacy line uses the DEVICE's name for the program where we know it.
    // Running the caller's absolute host path would fail on the device, which is
    // what the old rg-only special case existed to avoid; generalizing it here
    // keeps the no-helper tier behaving the way it did before this milestone.
    const legacyArgv = program === undefined ? spec.argv : [program, ...spec.argv.slice(1)]
    const line = `cd ${quote(directory)} && exec ${legacyArgv.map(quote).join(' ')}`
    return original.call(this, {
      ...spec,
      argv: sshArgv(assignment.device, line),
      cwd: localCwd(),
      env: { ...spec.env, ...sshEnv(assignment.device) },
    })
  }
  return () => {
    target.spawn = original
    router.onDeviceChanged = undefined
    router.helperConnection = undefined
    void connections.disposeAll()
  }
}

/**
 * The caller's directory in the device's path space.
 *
 * A tool resolves a relative path against the session's own directory, which is
 * the local mount standing in for the device tree; an absolute path the model
 * gave is already a device path. A binding without a mount (written before
 * mounts existed) has nothing to translate and uses the device's root.
 *
 * @param assignment - the session's device, remote root and mount.
 * @param workdir - the caller's directory.
 * @returns the directory the process should run in, on the device.
 */
function remoteDirectory(
  assignment: { remoteRoot: string; mount: string | undefined },
  workdir: string,
): string {
  // `targetForSession` has already resolved the root against the device, so
  // this only has to decide whether the caller's directory can be translated.
  return assignment.mount === undefined
    ? assignment.remoteRoot
    : remoteDirFor({ mount: assignment.mount, remoteRoot: assignment.remoteRoot }, workdir)
}
