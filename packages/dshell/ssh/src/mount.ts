/**
 * The translation between a device's remote tree and its local mount
 * directory.
 *
 * A session that runs on a device still has a working directory on THIS
 * machine, because the harness owns that value: it creates the directory when
 * the session is created, and later reads it for instruction files, project
 * discovery and sandbox roots. Handing it a remote path is not an option —
 * those reads happen locally and would fail (or, worse, silently match an
 * unrelated local directory). So the session's directory is a local, empty
 * MOUNT directory that stands in for the device's tree, and the seams that
 * actually execute something translate it back.
 *
 * The mapping is one-way in practice but stored both ways:
 *
 *   mount + '/etc/nginx'   ->  '/etc/nginx'      on the device
 *   any other absolute path -> itself            (the model may address the
 *                                                 device's own absolute paths)
 *
 * `remoteRoot` is the session's directory on the device; `mount` is the local
 * directory standing in for it. Both travel in the session's binding, so a
 * later device rename or a change to the device's own directory cannot make an
 * existing session's mapping drift.
 */

import { isAbsolute, join, relative, sep } from 'node:path'
import { mountBase } from './paths.js'

/** One session's directory on a device, and the local directory mirroring it. */
export interface MountMapping {
  /** Local directory standing in for the device tree; an existing path. */
  readonly mount: string
  /** Directory the device's commands and file operations start in. */
  readonly remoteRoot: string
  /**
   * A second local spelling of the same directory: the session's own working
   * directory, when it is not the mount.
   *
   * The harness creates a session's directory on this machine and cannot move
   * it afterwards, so a session that was created first and pointed at a device
   * later — every session of the sidebar's terminal section — carries a
   * directory that is a real local path and names no place in its own world.
   * Its tools resolve relative paths against that directory, so without an
   * alias `read notes.md` asks the device for `/home/reader/notes.md`: a
   * directory the device may well have, filled with somebody else's files. With
   * it, the path the tool built is read as the stand-in it is, and the model
   * needs no idea that any of this happened.
   *
   * Only a prefix of the session's own directory is re-based this way. Any
   * other absolute path still travels unchanged, because on a device session
   * `/var/log` is the device's and saying so is the point.
   */
  readonly alias?: string | undefined
}

/**
 * The mapping for one bound session.
 *
 * The single place a mapping is built from a routing answer, so the alias rule
 * has one owner and the three seams that need a mapping (files, bytes, spawn)
 * cannot drift apart about it.
 *
 * @param target - the routing answer: the device's directory and its mount.
 * @param sessionCwd - the directory the harness recorded for the session.
 * @returns the mapping, or undefined when the binding carries no mount and
 *   therefore nothing can be translated.
 */
export function mappingFor(
  target: { readonly remoteRoot: string; readonly mount?: string | undefined },
  sessionCwd: string | undefined,
): MountMapping | undefined {
  const { mount, remoteRoot } = target
  if (mount === undefined) return undefined
  const alias = sessionCwd !== undefined && sessionCwd.length > 0 && !isUnder(mount, sessionCwd)
    ? sessionCwd
    : undefined
  return { mount, remoteRoot, ...alias === undefined ? {} : { alias } }
}

/**
 * The mount directory for one device tree.
 *
 * Keyed by device and remote root, so sessions on the same tree share it (and
 * therefore group under one project directory in the session log, which is the
 * honest grouping: they really are the same tree).
 *
 * @param deviceId - device the tree belongs to.
 * @param remoteRoot - directory on that device; `/` maps to a named segment
 *   because an empty path segment would collapse the mount onto the device
 *   directory itself.
 * @returns absolute local directory.
 */
export function mountFor(deviceId: string, remoteRoot: string): string {
  const trimmed = remoteRoot.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  return join(mountBase(), deviceId, trimmed === '' ? 'root' : trimmed)
}

/** Whether `child` is `parent` or lies inside it; lexical, like the sandbox's own check. */
export function isUnder(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * A device-side root with a `~` spelling expanded to the device's own path.
 *
 * A session's root is whatever the reader typed, and `~` is the common one. A
 * SHELL expands that for free — `cd ~/app` on the device means the right thing
 * wherever a command runs — which is why the spelling is kept in the binding.
 *
 * The helper has no shell to expand it, and its protocol says so outright:
 * "Always absolute: the caller translates, the device does not guess." A
 * `~`-spelled path reaching it is refused as an invalid path, and because that
 * refusal lands inside a turn it costs the whole turn rather than one file
 * operation. So the translation happens HERE, at the one place a mapping is
 * built, against the root the device itself reported when the helper
 * handshaked.
 *
 * @param remoteRoot - the root as stored, e.g. `~`, `~/app`, `/srv/app`.
 * @param deviceRoot - the device's absolute default directory, or undefined
 *   while no helper has handshaked for it.
 * @returns an absolute device path, or the input when it cannot be resolved.
 */
export function absoluteRemoteRoot(remoteRoot: string, deviceRoot: string | undefined): string {
  if (!remoteRoot.startsWith('~')) return remoteRoot
  if (deviceRoot === undefined || !deviceRoot.startsWith('/')) return remoteRoot
  const rest = remoteRoot.replace(/^~\/?/, '')
  return rest === '' ? deviceRoot : join(deviceRoot, rest)
}

/**
 * Translate a path the harness/machine sees into the path the device sees.
 *
 * A path inside the mount — or inside the session's own directory, when that is
 * not the mount (see {@link MountMapping.alias}) — maps to the corresponding
 * remote path. The mount is tried first because a session's directory can be an
 * ANCESTOR of it: dshell's mount tree lives under the reader's home, so the more
 * specific root has to win or every mount path would be re-based as a home path.
 *
 * Any other absolute path is returned unchanged: on a device-bound session the
 * model is addressing the device, so `/var/log` means the device's `/var/log`,
 * and making that work is the whole point of the session.
 *
 * @param mapping - the session's mapping.
 * @param path - absolute path in this machine's namespace.
 * @returns absolute path in the device's namespace.
 */
export function toRemotePath(mapping: MountMapping, path: string): string {
  const rest = under(mapping.mount, path) ?? (mapping.alias === undefined ? undefined : under(mapping.alias, path))
  if (rest === undefined) return path
  if (rest === '') return mapping.remoteRoot
  const base = mapping.remoteRoot === '/' ? '' : mapping.remoteRoot
  return join(base === '' ? '/' : base, rest)
}

/** The part of `path` under `root`, or undefined when it is not under it. */
function under(root: string, path: string): string | undefined {
  return isUnder(root, path) ? relative(root, path) : undefined
}

/**
 * The inverse, for showing a remote path as the local path that stands in for
 * it. Paths outside the device tree cannot be represented locally and are
 * returned unchanged.
 *
 * @param mapping - the session's mapping.
 * @param remotePath - absolute path in the device's namespace.
 * @returns path under the mount, or the input when it is outside the tree.
 */
export function toMountPath(mapping: MountMapping, remotePath: string): string {
  if (!isUnder(mapping.remoteRoot, remotePath)) return remotePath
  const rest = relative(mapping.remoteRoot, remotePath)
  return rest === '' ? mapping.mount : join(mapping.mount, rest)
}

/**
 * The directory a device-bound call runs in, given the directory the caller
 * resolved locally. Falls back to the session's remote root when the caller's
 * directory is not part of this device's tree (for example a caller that
 * resolved against the process default).
 *
 * @param mapping - the session's mapping.
 * @param localDir - absolute directory in this machine's namespace, or undefined.
 * @returns absolute directory in the device's namespace.
 */
export function remoteDirFor(mapping: MountMapping, localDir: string | undefined): string {
  if (localDir === undefined) return mapping.remoteRoot
  return toRemotePath(mapping, localDir)
}
