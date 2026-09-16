/**
 * The icon electron-builder puts on dshell's desktop build.
 *
 * Upstream ships no application icon at all — no `icon` field in its
 * electron-builder config, no asset under `apps/desktop` — so every build so far
 * carried the default Electron atom. Pointing the Linux target at this directory
 * is the whole fix, and it needs no upstream edit.
 *
 * It is a directory rather than one file on purpose: electron-builder reads a
 * directory's `NxN.png` names as the sizes themselves and does not re-measure or
 * re-resample them (`collectIconsFromDir` in `app-builder-lib`). Each name
 * becomes a `hicolor/NxN/apps/` entry in the AppImage, and the largest one also
 * becomes the `.desktop` entry's icon, so a file whose name disagrees with its
 * pixels lands a blurred icon in the launcher with nothing to report it.
 * `scripts/tests/linux-icons.spec.ts` checks that agreement.
 *
 * The mark is dshell's own, drawn for this purpose and not taken from upstream:
 * the prompt (chevron and block cursor) is the shell, the spark beside it is the
 * agent. `assets/icons/*.svg` are the sources; see docs/dshell-setup.md for the
 * regeneration command.
 *
 * Applying it lives here rather than in the config file so the delta from
 * upstream's config can be tested — importing upstream's config means resolving
 * a desktop target, which throws for linux-x64 outside the packaging loader.
 */

import { fileURLToPath } from 'node:url'

/** Absolute path, so it resolves the same from electron-builder's cwd. */
export const LINUX_ICON_DIR = fileURLToPath(new URL('../assets/icons/linux', import.meta.url))

/** The sizes the directory is expected to hold, smallest first. */
export const LINUX_ICON_SIZES = [16, 32, 48, 64, 128, 256, 512]

/**
 * Upstream's config with the Linux icon added, everything else left alone.
 * @param config - A config from upstream's `createElectronBuilderConfig`.
 * @returns A copy carrying `linux.icon`.
 */
export function withLinuxIcon(config) {
  return { ...config, linux: { ...config.linux, icon: LINUX_ICON_DIR } }
}
