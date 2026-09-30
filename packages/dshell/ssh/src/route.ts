/**
 * The SSH device route: one exact `/api` endpoint behind dsh's existing trust
 * and authentication fence, mirroring the session panel's shape.
 *
 * It carries the operations that must not live in the settings document —
 * storing a private key, testing a connection — and reports the device list
 * plus the session assignments after every request, so the UI's snapshot is
 * always the committed one.
 */

import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type { Context } from '@deepseek-ai/cordis'
import type { DshellSshTranslate } from './host-locales.js'
import { DSHELL_SSH_PATH, type SshRequest, type SshResponse } from './protocol.js'
import type { SshRouter } from './router.js'

/** What the route needs from the plugin that owns it. */
export interface SshRouteDeps {
  readonly router: SshRouter
  /** Host context, so the connection test can spawn a process. */
  readonly ctx: Context
  /**
   * This package's host copy, bound to the language the browser reported — the
   * settings card renders a refusal verbatim, so it must match the screen.
   */
  readonly t: DshellSshTranslate
}

/** JSON response in the shape the device UI parses. */
function respond(body: SshResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Replace one session's live shell after its assignment changed.
 *
 * A session's terminal is spawned when it is opened, and the assignment can be
 * recorded after that — the creation page writes it a round trip after the
 * session exists — so a shell already running somewhere has to be replaced for
 * the new plan to mean anything. Reached through the service name rather than
 * an import: the bridge may load after this plugin, and a composition without
 * it (no terminal) has nothing to replace. A session whose terminal never
 * spawned needs nothing either: the next attach asks for a plan, and gets the
 * new one.
 *
 * @param ctx - host context, for the terminal bridge's service.
 * @param sessionId - the session whose shell to replace.
 */
async function respawnShell(ctx: Context, sessionId: string): Promise<void> {
  const bridge = ctx.get('dshellTerminalBridge') as
    | { respawnMain?: (id: string) => Promise<void> }
    | undefined
  await bridge?.respawnMain?.(sessionId).catch(() => { /* the panel reports the spawn */ })
}

/** Bind the route to the device registry. */
export function createSshRoute(deps: SshRouteDeps): ConnectionFetchRoute {
  const state = async (): Promise<Omit<SshResponse, 'error' | 'testResult'>> => ({
    devices: await deps.router.list(),
    bindings: await deps.router.assignments(),
  })

  const handle = async (request: Request): Promise<SshResponse> => {
    const input = request.method === 'GET'
      ? { action: 'list' } as const
      : await request.json() as SshRequest
    switch (input.action) {
      case 'list':
        return await state()
      case 'save':
        await deps.router.saveDevice(input.device)
        return await state()
      case 'delete':
        await deps.router.removeDevice(input.deviceId)
        return await state()
      case 'test': {
        // Run the test BEFORE reading state, for the same reason the install
        // branch does: the test records the helper's state onto the device
        // (see `surveyHelper`), and `state()` is what reads those records
        // back. Evaluating it first answered with the pre-test list, so the
        // card kept showing the previous status until something else
        // refreshed it.
        //
        // With a remote directory the test also creates it: the dialog runs
        // this before creating the session, so a device that answers but
        // cannot host the directory is reported here, not after.
        const testResult = await deps.router.test(input.deviceId, deps.ctx, input.remoteRoot ?? null)
        return { ...await state(), testResult }
      }
      case 'mount':
        return { ...await state(), mountPath: await deps.router.mountPath(input.deviceId, input.remoteRoot ?? null) }
      case 'bind': {
        // The remote directory is created inside `bind`, before the assignment
        // is recorded: the assignment is what makes a session routable, and the
        // shell it starts must not find the directory still missing.
        const before = deps.router.assignmentForSession(input.sessionId)
        await deps.router.bind(
          input.sessionId,
          input.deviceId,
          input.remoteRoot ?? null,
          input.mount ?? null,
          deps.ctx,
        )
        const after = deps.router.assignmentForSession(input.sessionId)
        if (before?.deviceId !== after?.deviceId || before?.mount !== after?.mount) {
          await respawnShell(deps.ctx, input.sessionId)
        }
        return await state()
      }
      case 'install': {
        // Deploy BEFORE reading state. `state()` reads the device list, and the
        // install is what writes the status the card renders onto those
        // records, so evaluating it first would answer with the pre-install
        // list: the card would show nothing until some later call refreshed
        // it, which only happens on a reload.
        const helper = await deps.router.installHelper(input.deviceId, deps.ctx)
        return { ...await state(), helper }
      }
      default:
        return { ...await state(), error: deps.t('error.unknownAction') }
    }
  }

  return {
    path: DSHELL_SSH_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        return respond(await handle(request))
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        return respond({ ...await state(), error: reason }, 400)
      }
    },
  }
}
