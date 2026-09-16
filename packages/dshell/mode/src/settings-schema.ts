/**
 * The Host-side schema for dshell's settings section.
 *
 * Split from `settings.ts` because schema construction must not reach the
 * browser bundle: the client build resolves only the platform module table, and
 * pulling schemastery in through a shared import breaks the whole client
 * plugin load with a missing-module error.
 */

import z from '@deepseek-ai/schemastery'
import {
  COMMAND_HINT_FIELD, DATA_DIR_DEFAULT, DATA_DIR_FIELD, DEFAULT_THEME_ID, DSHELL_SETTINGS_NAMESPACE,
  HISTORY_LIST_FIELD, SHELL_HELPER_DEFAULT, SHELL_ORACLE_FIELD, TAB_COMPLETION_FIELD, THEME_FIELD, THEME_IDS,
} from './settings.js'

export { DSHELL_SETTINGS_NAMESPACE, THEME_FIELD }

/**
 * Schema resolving the namespace, on the Host and on the wire.
 *
 * Each helper switch is a plain boolean with the shared default, so an empty or
 * older document resolves to the assists being ON — the composer those settings
 * govern is built around them.
 */
export const DshellSettingsSchema: z<Record<string, unknown>> = z.object({
  [THEME_FIELD]: z.union([...THEME_IDS]).default(DEFAULT_THEME_ID),
  [TAB_COMPLETION_FIELD]: z.boolean().default(SHELL_HELPER_DEFAULT),
  [HISTORY_LIST_FIELD]: z.boolean().default(SHELL_HELPER_DEFAULT),
  [COMMAND_HINT_FIELD]: z.boolean().default(SHELL_HELPER_DEFAULT),
  // Declared even though only the browser acts on it: an undeclared field is
  // stored but dropped from the RESOLVED value, so the mirror this card reads
  // back (and any second browser) would see the default instead of the choice.
  [SHELL_ORACLE_FIELD]: z.boolean().default(SHELL_HELPER_DEFAULT),
})

/**
 * Schema for the `dshell-data` namespace: where dshell keeps its own files.
 *
 * Registered as its own namespace so it is its own card — see
 * `DSHELL_DATA_NAMESPACE` — and marked `applies: 'restart'`, which is the
 * honest answer for a directory a running process cannot move out from under
 * itself. (The terminal namespace stays `live`: its palette and switches take
 * effect on the click that sets them.)
 */
export const DshellDataSettingsSchema: z<Record<string, unknown>> = z.object({
  [DATA_DIR_FIELD]: z.string().default(DATA_DIR_DEFAULT),
})
