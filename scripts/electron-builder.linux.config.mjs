/**
 * electron-builder configuration for the linux-x64 desktop build.
 *
 * Upstream's own config is used for everything — targets, extraResources, the
 * signing hooks, the update feed — and only two fields are added. Upstream's
 * package name is `@deepseek-ai/dsh-desktop`, electron-builder derives
 * `executableName` from it as `@deepseek-aidsh-desktop`, and the AppImage target
 * then refuses to build it: "executableName contains characters that cannot be
 * safely used in file paths". The `--dir` target tolerates the character, so this
 * only surfaces the moment an AppImage is requested. Naming the executable here
 * keeps `dsh/` untouched and also matches the `artifactName` upstream already
 * sets (`deepseek-harness-<version>-<os>-<arch>.<ext>`).
 *
 * The second field is the icon, which upstream never sets — see
 * `scripts/linux-icons.mjs` for the asset set and why it is a directory.
 */

import { createElectronBuilderConfig } from '../dsh/apps/desktop/electron-builder.config.mjs'
import { withLinuxIcon } from './linux-icons.mjs'

export default {
  ...withLinuxIcon(createElectronBuilderConfig(process.env)),
  executableName: 'deepseek-harness',
}
