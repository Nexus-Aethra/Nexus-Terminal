/**
 * Which Chromium the browser tools drive.
 *
 * Kept apart from `index.ts` so the search rule is a plain function a spec can
 * exercise, and so the reasoning below is next to the list it explains.
 *
 * The pinned Playwright MCP resolves its own download by default
 * (`chrome-for-testing` under `~/.cache/ms-playwright`), which a deployment
 * that never ran its installer does not have. A browser already installed on
 * the machine is the better default for a workbench that ships this row ON:
 * the alternative is telling every user to download a second copy of Chrome
 * before the agent can open a page. Discovery is still only a fallback — an
 * explicit `executablePath` in the row's config wins, and the upstream
 * search runs when nothing here matches.
 */

import { existsSync } from 'node:fs'

/**
 * The executables a Chromium-based browser is normally installed as, in the
 * order a reader would expect to find them. Absolute paths only: this list is
 * searched on the machine the harness runs on, and a bare name would depend on
 * the harness's own `PATH`.
 */
const CANDIDATES: readonly string[] = [
  // Debian/Ubuntu and the Google package on every distro.
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  // The distro's own build, under both names it ships as.
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  // Fedora/openSUSE, and the snap/flatpak launchers.
  '/usr/bin/chromium-freeworld',
  '/snap/bin/chromium',
  '/var/lib/flatpak/exports/bin/org.chromium.Chromium',
  // macOS.
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]

/** The first installed candidate, or undefined to leave the choice to upstream. */
export function discoverChromium(exists: (path: string) => boolean = existsSync): string | undefined {
  return CANDIDATES.find(path => exists(path))
}
