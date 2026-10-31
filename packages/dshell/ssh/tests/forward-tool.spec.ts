/**
 * The forward tool, driven by a forwarder that opens nothing.
 *
 * What is worth pinning here is what the MODEL can reach and what it cannot: the
 * tool is there for a session on a device and not there for a session on this
 * machine, and it follows the binding rather than the agent's birth — a session
 * bound after its agent was created still gets it.
 */

import { describe, expect, it } from 'vitest'
import type { DeviceConnection } from '../src/devices.js'
import type { DshellForwardView } from '@nexus-aethra/dshell-std'
import type { ForwardSeat } from '../src/forward/route.js'
import { PORT_FORWARD_TOOL, installForwardTool } from '../src/forward/tool.js'

function device(over: Partial<DeviceConnection> = {}): DeviceConnection {
  return {
    id: 'web',
    name: 'web-server',
    host: 'example.test',
    port: 22,
    user: 'ops',
    remoteRoot: '~',
    auth: 'key',
    secret: undefined,
    ...over,
  }
}

function view(over: Partial<DshellForwardView> = {}): DshellForwardView {
  return {
    sessionId: 's-device',
    deviceId: 'web',
    deviceName: 'web-server',
    devicePort: 3000,
    localPort: 8080,
    localAddress: '127.0.0.1',
    status: 'running',
    error: undefined,
    ...over,
  }
}

/** A forwarder that records what it was asked. */
class FakeSeat implements ForwardSeat {
  readonly opened: unknown[] = []
  forwards: DshellForwardView[] = []

  list(): readonly DshellForwardView[] {
    return this.forwards
  }

  listSession(sessionId: string): readonly DshellForwardView[] {
    return this.forwards.filter(forward => forward.sessionId === sessionId)
  }

  async open(request: {
    readonly sessionId: string
    readonly device: DeviceConnection
    readonly devicePort: number
    readonly localPort: number
    readonly localAddress: string
  }): Promise<{ readonly view: DshellForwardView; readonly ok: boolean }> {
    this.opened.push(request)
    const opened = view({
      sessionId: request.sessionId,
      deviceId: request.device.id,
      deviceName: request.device.name,
      devicePort: request.devicePort,
    })
    this.forwards = [...this.forwards, opened]
    return { view: opened, ok: true }
  }

  stop(sessionId: string, localPort: number): boolean {
    const before = this.forwards.length
    this.forwards = this.forwards.filter(forward => !(forward.sessionId === sessionId && forward.localPort === localPort))
    return this.forwards.length !== before
  }
}

/** A tool registry that records what was registered. */
class FakeRegistry {
  readonly registered: { name: string; execute?: (input: unknown) => Promise<unknown> }[] = []

  get(): undefined {
    return undefined
  }

  register(definition: { name: string; execute?: (input: unknown) => Promise<unknown> }): () => void {
    this.registered.push(definition)
    return () => {
      this.registered = this.registered.filter(entry => entry !== definition)
    }
  }
}

/** An agent, with the scope its tools are registered in. */
function agent(id: string) {
  const tools = new FakeRegistry()
  return { id, ctx: { tools }, tools }
}

/**
 * A router that says one session is on a device and another is not.
 *
 * The set of bound sessions is a MUTABLE box rather than a captured list, so a
 * test can bind and unbind and see the router answer differently.
 */
function routerWith(bound: readonly string[]) {
  const listeners: ((sessionId: string, deviceId: string | null) => void)[] = []
  const boundSessions = { current: [...bound] }
  return {
    boundSessions,
    onAssignmentChanged: undefined as ((sessionId: string, deviceId: string | null) => void) | undefined,
    onAssignment(listener: (sessionId: string, deviceId: string | null) => void): () => void {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    notify(sessionId: string, deviceId: string | null): void {
      for (const listener of [...listeners]) listener(sessionId, deviceId)
    },
    targetForSession: (sessionId: string) => boundSessions.current.includes(sessionId)
      ? { device: device(), remoteRoot: '/root', mount: undefined }
      : undefined,
  } as never
}

describe('the forward tool', () => {
  it('is there for a session on a device, and not for one on this machine', () => {
    const onDevice = agent('s-device')
    const local = agent('s-local')
    const registry = new FakeRegistry()
    const ctx = {
      tools: registry,
      agents: { list: () => [onDevice, local] },
      on: () => () => {},
    }
    const router = routerWith(['s-device'])

    installForwardTool(ctx, { forwarder: new FakeSeat(), router })

    expect(onDevice.tools.registered.map(entry => entry.name)).toEqual([PORT_FORWARD_TOOL])
    expect(local.tools.registered).toHaveLength(0)
  })

  it('opens a forward and says where it landed', async () => {
    const onDevice = agent('s-device')
    const registry = new FakeRegistry()
    const ctx = {
      tools: registry,
      agents: { list: () => [onDevice] },
      on: () => () => {},
    }
    const seat = new FakeSeat()
    const router = routerWith(['s-device'])

    installForwardTool(ctx, { forwarder: seat, router })

    const tool = onDevice.tools.registered[0]
    const result = await tool.execute?.({ action: 'open', devicePort: 3000 }) as { message: string }

    expect(seat.opened).toHaveLength(1)
    expect(result.message).toContain('3000')
    expect(result.message).toContain('8080')
  })

  it('lists what is open', async () => {
    const onDevice = agent('s-device')
    const ctx = {
      tools: new FakeRegistry(),
      agents: { list: () => [onDevice] },
      on: () => () => {},
    }
    const seat = new FakeSeat()
    seat.forwards = [view()]

    installForwardTool(ctx, { forwarder: seat, router: routerWith(['s-device']) })

    const tool = onDevice.tools.registered[0]
    const result = await tool.execute?.({ action: 'list' }) as { message: string }

    expect(result.message).toContain('3000')
  })

  it('says so when it does not understand the action', async () => {
    const onDevice = agent('s-device')
    const ctx = {
      tools: new FakeRegistry(),
      agents: { list: () => [onDevice] },
      on: () => () => {},
    }

    installForwardTool(ctx, { forwarder: new FakeSeat(), router: routerWith(['s-device']) })

    const tool = onDevice.tools.registered[0]
    const result = await tool.execute?.({ action: 'open' }) as { message: string }

    expect(result.message).toContain('not understood')
  })

  it('refuses a port that is not a port', async () => {
    const onDevice = agent('s-device')
    const ctx = {
      tools: new FakeRegistry(),
      agents: { list: () => [onDevice] },
      on: () => () => {},
    }
    const seat = new FakeSeat()

    installForwardTool(ctx, { forwarder: seat, router: routerWith(['s-device']) })

    const tool = onDevice.tools.registered[0]
    const result = await tool.execute?.({ action: 'open', devicePort: 70000 }) as { message: string }

    expect(result.message).toContain('not understood')
    expect(seat.opened).toHaveLength(0)
  })

  it('follows the binding, not the agent\'s birth', () => {
    // A session bound AFTER its agent was created still gets the tool: the
    // binding is what says there is a device to forward to, and it can change
    // at any time.
    const onDevice = agent('s-device')
    const ctx = {
      tools: new FakeRegistry(),
      agents: { list: () => [onDevice] },
      on: () => () => {},
    }
    const router = routerWith([])

    installForwardTool(ctx, { forwarder: new FakeSeat(), router })
    expect(onDevice.tools.registered).toHaveLength(0)

    ;(router as unknown as { boundSessions: { current: string[] } }).boundSessions.current = ['s-device']
    ;(router as unknown as { notify(sessionId: string, deviceId: string | null): void }).notify('s-device', 'web')

    expect(onDevice.tools.registered.map(entry => entry.name)).toEqual([PORT_FORWARD_TOOL])
  })

  it('takes the tool back when the session is unbound', () => {
    const onDevice = agent('s-device')
    const ctx = {
      tools: new FakeRegistry(),
      agents: { list: () => [onDevice] },
      on: () => () => {},
    }
    const router = routerWith(['s-device'])

    installForwardTool(ctx, { forwarder: new FakeSeat(), router })
    expect(onDevice.tools.registered).toHaveLength(1)

    ;(router as unknown as { boundSessions: { current: string[] } }).boundSessions.current = []
    ;(router as unknown as { notify(sessionId: string, deviceId: string | null): void }).notify('s-device', null)

    expect(onDevice.tools.registered).toHaveLength(0)
  })
})
