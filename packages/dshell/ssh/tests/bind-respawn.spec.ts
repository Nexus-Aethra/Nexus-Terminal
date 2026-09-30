/**
 * A binding that lands on a session already running replaces its shell.
 *
 * A session's terminal is spawned when the session is opened, and the creation
 * page records the assignment a round trip later — so the shell is already up
 * and running somewhere else by the time the device is known. A shell cannot
 * change machines, so the route asks the terminal bridge to respawn it. These
 * cases pin the trigger: the spawn plan actually changed (device or mapping),
 * never a re-pick of what the session already was.
 */

import { describe, expect, it, vi } from 'vitest'
import { createSshRoute, type SshRouteDeps } from '../src/route.js'
import type { AssignmentView } from '../src/router.js'
import type { DshellSshTranslate } from '../src/host-locales.js'

const translate = ((key: string): string => key) as DshellSshTranslate

/** A router whose stored assignment the test drives, plus the bind it records. */
function fakeRouter(initial: AssignmentView | undefined) {
  let current = initial
  return {
    current: () => current,
    get: () => current,
    assignmentForSession: (): AssignmentView | undefined => current,
    assignments: async (): Promise<readonly AssignmentView[]> => current === undefined ? [] : [current],
    list: async (): Promise<readonly never[]> => [],
    bind: async (sessionId: string, deviceId: string | null): Promise<void> => {
      current = deviceId === null
        ? undefined
        : { sessionId, deviceId, mount: `/mnt/${deviceId}` }
    },
  }
}

/** A host context that answers only the terminal bridge's service name. */
function fakeContext(respawnMain: (id: string) => Promise<void>) {
  return { get: (name: string) => name === 'dshellTerminalBridge' ? { respawnMain } : undefined }
}

/** Drive one `bind` request through the route. */
async function bind(deps: SshRouteDeps, body: Record<string, unknown>): Promise<void> {
  const route = createSshRoute(deps)
  const response = await route.fetch(new Request('http://host/api/dshell/ssh/bind', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  expect(response.status).toBe(200)
}

describe('the bind route respawns a session shell whose plan changed', () => {
  it('respawning once when a local session is bound to a device', async () => {
    const router = fakeRouter(undefined)
    const respawnMain = vi.fn(async () => {})
    const deps = {
      router, ctx: fakeContext(respawnMain), t: translate,
    } as unknown as SshRouteDeps
    await bind(deps, { action: 'bind', sessionId: 's-1', deviceId: 'dev-a' })
    expect(respawnMain).toHaveBeenCalledTimes(1)
    expect(respawnMain).toHaveBeenCalledWith('s-1')
  })

  it('not respawning when the same device is picked again', async () => {
    const router = fakeRouter({ sessionId: 's-1', deviceId: 'dev-a', mount: '/mnt/dev-a' })
    const respawnMain = vi.fn(async () => {})
    const deps = {
      router, ctx: fakeContext(respawnMain), t: translate,
    } as unknown as SshRouteDeps
    await bind(deps, { action: 'bind', sessionId: 's-1', deviceId: 'dev-a' })
    expect(respawnMain).not.toHaveBeenCalled()
  })

  it('respawning when a device session is sent back to this machine', async () => {
    const router = fakeRouter({ sessionId: 's-1', deviceId: 'dev-a', mount: '/mnt/dev-a' })
    const respawnMain = vi.fn(async () => {})
    const deps = {
      router, ctx: fakeContext(respawnMain), t: translate,
    } as unknown as SshRouteDeps
    await bind(deps, { action: 'bind', sessionId: 's-1', deviceId: null })
    expect(respawnMain).toHaveBeenCalledTimes(1)
  })

  it('surviving a composition with no terminal bridge', async () => {
    const router = fakeRouter(undefined)
    const deps = {
      router, ctx: { get: () => undefined }, t: translate,
    } as unknown as SshRouteDeps
    await expect(bind(deps, { action: 'bind', sessionId: 's-1', deviceId: 'dev-a' })).resolves.toBeUndefined()
  })
})
