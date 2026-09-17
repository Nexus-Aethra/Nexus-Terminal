/**
 * dshell session-panel wire — design 4.7 follow-up.
 *
 * The sidebar's session rows carry an archive tag and a history purge. Their
 * standing in dsh has split since this was written:
 *
 * - The **archive tag is no longer dshell-only.** dsh 0.1.6 ships one:
 *   `workspaceRegistry.archiveSession` / `unarchiveSession` persist
 *   `archivedSessionIds` in the workspace state, `workspace-controller`
 *   exposes both as remote commands and pushes a `{ type: 'archived' }`
 *   increment, and `ui-workspace` and `ui-settings-unarchive-sessions`
 *   surface them. Read the upstream set, do not re-declare it.
 * - The **history purge still has no upstream.** `SessionPersistence` is
 *   append-only — create/open/stat/list and no delete — `session-controller`
 *   has no delete command, and the jsonl lease documents "Release never
 *   removes". `api-session/removed` is a `session/disposed` relay that
 *   upstream's own client turns into a snapshot flag, deleting nothing.
 *
 * Both halves still travel over dshell's own exact route on the shared `/api`
 * channel rather than through the Typert Remote table (whose client artifacts
 * are generated from dsh's own packages); the archive actions are the
 * migration target once the flat list reads the upstream set.
 *
 * The path sits below the shared channel exactly like file-upload's: the
 * physical carrier applies dsh's trust and authentication policy before the
 * handler ever runs, so the route itself does no authorization.
 *
 * Shared by both halves of the package, so the constant and the shapes live
 * in one file that neither the host nor the client bundle owns.
 */

/** Exact `/api` route path owned by the dshell session panel. */

// Moved to the shared standard layer: these are wire contracts, not this
// package's, and both halves of every plugin read the same declaration there.
// Re-exported so existing importers keep one import site per package.
export { DSHELL_SESSIONS_PATH } from '@nexus-aethra/dshell-std'
export type { SessionRequest, SessionResponse } from '@nexus-aethra/dshell-std'
