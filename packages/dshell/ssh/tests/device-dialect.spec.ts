/**
 * The shell a device-bound agent is shown, and the one it is not.
 *
 * The defect this covers is a half-finished swap: dshell sends a bound
 * session's commands to the device, but the MODEL still sees the host's
 * shell tool — a tool named `pwsh`, described in PowerShell, pointed at this
 * machine's directory. The model writes PowerShell, the device answers
 * `command not found`, and the round trip is spent on a dialect that is not
 * there. The agent even says so, in its own reasoning: "the pwsh tool
 * actually runs on Linux VM-0-6-ubuntu — it's bash, not pwsh".
 *
 * So the contract has to move with the execution: the device's agent sees a
 * tool named for the device's shell, described in the device's dialect, and
 * the host's own shell tool is out of that scope. The execution stays the
 * host tool's own body — the same command, run somewhere else.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { installDeviceDialect } from '../src/device-dialect.js'
import type { SshRouter } from '../src/router.js'

/** A tool definition, as much of it as the module reads or rewrites. */
interface ToolDefinitionShape {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
  readonly [key: string]: unknown
}

/** The registry state every scope view shares. */
class RegistryState {
  readonly globals = new Map<string, ToolDefinitionShape>()
  readonly layers = new Map<string, Map<string, ToolDefinitionShape>>()
  readonly restrictions = new Map<string, Set<string>>()
}

/** One view of the registry: the global one, or one scope's. */
class FakeRegistry {
  constructor(private readonly state: RegistryState, private readonly scope?: string) {}

  get(name: string): ToolDefinitionShape | undefined {
    const own = this.scope === undefined ? undefined : this.state.layers.get(this.scope)?.get(name)
    if (own !== undefined) return own
    if (this.scope !== undefined && this.state.restrictions.get(this.scope)?.has(name)) return undefined
    return this.state.globals.get(name)
  }

  register(definition: ToolDefinitionShape): () => void {
    if (this.scope === undefined) {
      this.state.globals.set(definition.name, definition)
      return () => { this.state.globals.delete(definition.name) }
    }
    const layer = this.state.layers.get(this.scope) ?? new Map<string, ToolDefinitionShape>()
    layer.set(definition.name, definition)
    this.state.layers.set(this.scope, layer)
    return () => { layer.delete(definition.name) }
  }

  restrict(filter: { deny?: readonly string[] }): () => void {
    if (this.scope === undefined) throw new Error('restrict() requires a scoped context')
    const layer = this.state.layers.get(this.scope)
    const denied = this.state.restrictions.get(this.scope) ?? new Set<string>()
    for (const name of filter.deny ?? []) {
      if (layer?.has(name) === true) throw new Error(`unknown global tool "${name}"`)
      if (!this.state.globals.has(name)) throw new Error(`unknown global tool "${name}"`)
      denied.add(name)
    }
    this.state.restrictions.set(this.scope, denied)
    return () => { for (const name of filter.deny ?? []) denied.delete(name) }
  }
}

/** One agent, with the scoped registry its own context carries. */
class FakeAgent {
  readonly ctx: { tools: FakeRegistry }

  constructor(readonly id: string, tools: FakeRegistry) {
    this.ctx = { tools }
  }
}

/** The host context, with the listeners the module installs. */
class FakeContext {
  readonly tools: FakeRegistry
  readonly agents: { list(): FakeAgent[] }
  readonly handlers = new Map<string, ((...args: never[]) => unknown)[]>()

  constructor(tools: FakeRegistry, private readonly live: FakeAgent[]) {
    this.tools = tools
    this.agents = { list: () => this.live }
  }

  on(event: string, listener: (...args: never[]) => unknown): () => void {
    const list = this.handlers.get(event) ?? []
    list.push(listener)
    this.handlers.set(event, list)
    return () => {
      const index = list.indexOf(listener)
      if (index >= 0) list.splice(index, 1)
    }
  }

  /** Deliver one event to every listener, as cordis would. */
  emit(event: string, payload: unknown): unknown[] {
    return (this.handlers.get(event) ?? []).map(listener => listener(payload as never))
  }
}

/** The router, with one device and the sessions bound to it. */
class FakeRouter {
  onAssignmentChanged: ((sessionId: string, deviceId: string | null) => void) | undefined
  private readonly targets = new Map<string, { name: string; remoteRoot: string }>()

  bind(sessionId: string, name: string, remoteRoot: string): void {
    this.targets.set(sessionId, { name, remoteRoot })
  }

  targetForSession(sessionId: string): { device: { name: string }; remoteRoot: string; mount: string | undefined } | undefined {
    const target = this.targets.get(sessionId)
    return target === undefined
      ? undefined
      : { device: { name: target.name }, remoteRoot: target.remoteRoot, mount: undefined }
  }

  assignmentForSession(sessionId: string): { sessionId: string; deviceId: string; remoteRoot?: string } | undefined {
    const target = this.targets.get(sessionId)
    return target === undefined
      ? undefined
      : { sessionId, deviceId: target.name, remoteRoot: target.remoteRoot }
  }
}

/** The host's own shell tool: a PowerShell one, as a Windows host has. */
function hostPwsh(): ToolDefinitionShape {
  return {
    name: 'pwsh',
    description: 'Execute a PowerShell command (`pwsh -Command`). Paths use native Windows form (`C:\\...`).',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', required: true, description: 'What the command does.' },
        command: { type: 'string', required: true, description: 'The PowerShell command to execute.' },
        workdir: { type: 'string', description: 'Working directory for this command.' },
      },
      required: ['description', 'command'],
    },
    output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'done' }] },
    execute: async () => 'host-body',
  }
}

/** The world one test runs in: a Windows host, one device, one agent. */
function world(): {
  ctx: FakeContext
  router: FakeRouter
  agent: FakeAgent
  local: FakeAgent
  state: RegistryState
  global: FakeRegistry
} {
  const state = new RegistryState()
  state.globals.set('pwsh', hostPwsh())
  const global = new FakeRegistry(state)
  const agent = new FakeAgent('session-on-device', new FakeRegistry(state, 'session-on-device'))
  const local = new FakeAgent('session-on-this-machine', new FakeRegistry(state, 'session-on-this-machine'))
  const ctx = new FakeContext(global, [agent, local])
  const router = new FakeRouter()
  router.bind('session-on-device', 'tencent', '/root')
  return { ctx, router, agent, local, state, global }
}

/** The model's view of one scope: the tool names it can see. */
function visible(state: RegistryState, scope: string): string[] {
  const view = new FakeRegistry(state, scope)
  const names = [...state.globals.keys()].filter(name => view.get(name) !== undefined)
  const own = state.layers.get(scope)
  return [...new Set([...names, ...(own?.keys() ?? [])])].filter(name => view.get(name) !== undefined).sort()
}

/** The definition the agent's scope carries for one tool. */
function definition(state: RegistryState, scope: string, name: string): ToolDefinitionShape | undefined {
  return new FakeRegistry(state, scope).get(name)
}

describe('a session bound to a device', () => {
  it('shows the agent the device shell, not the host one', () => {
    const { ctx, router, state } = world()
    installDeviceDialect(ctx as unknown as Context, router as unknown as SshRouter)
    ctx.emit('agent/created', { agent: { id: 'session-on-device', ctx: { tools: new FakeRegistry(state, 'session-on-device') } } })

    expect(visible(state, 'session-on-device')).toEqual(['bash'])
  })

  it('describes the device, its dialect and its paths', () => {
    const { ctx, router, state } = world()
    installDeviceDialect(ctx as unknown as Context, router as unknown as SshRouter)
    ctx.emit('agent/created', { agent: { id: 'session-on-device', ctx: { tools: new FakeRegistry(state, 'session-on-device') } } })

    const description = definition(state, 'session-on-device', 'bash')?.description ?? ''
    expect(description).toContain('"tencent"')
    expect(description).toContain('bash')
    expect(description).toContain('/root')
    expect(description).toContain('POSIX')
    expect(description).not.toContain('pwsh -Command')
  })

  it('rewrites the command and workdir parameters for the device', () => {
    const { ctx, router, state } = world()
    installDeviceDialect(ctx as unknown as Context, router as unknown as SshRouter)
    ctx.emit('agent/created', { agent: { id: 'session-on-device', ctx: { tools: new FakeRegistry(state, 'session-on-device') } } })

    const parameters = definition(state, 'session-on-device', 'bash')?.parameters as {
      properties: Record<string, { description: string }>
    }
    expect(parameters.properties.command.description).toContain('POSIX shell (bash) syntax')
    expect(parameters.properties.workdir.description).toContain('on the device')
    expect(parameters.properties.description.description).not.toContain('Get-Process')
  })

  it('keeps the host tool own execution, so jobs and rendering are unchanged', () => {
    const { ctx, router, state } = world()
    installDeviceDialect(ctx as unknown as Context, router as unknown as SshRouter)
    ctx.emit('agent/created', { agent: { id: 'session-on-device', ctx: { tools: new FakeRegistry(state, 'session-on-device') } } })

    const base = state.globals.get('pwsh')
    const variant = definition(state, 'session-on-device', 'bash')
    expect(variant?.execute).toBe(base?.execute)
    expect(variant?.output).toBe(base?.output)
  })

  it('hides the host shell tool from the device agent only', () => {
    const { ctx, router, state } = world()
    installDeviceDialect(ctx as unknown as Context, router as unknown as SshRouter)
    ctx.emit('agent/created', { agent: { id: 'session-on-device', ctx: { tools: new FakeRegistry(state, 'session-on-device') } } })

    expect(visible(state, 'session-on-device')).not.toContain('pwsh')
    // The global view is untouched: every other agent still has the host shell.
    expect([...state.globals.keys()]).toEqual(['pwsh'])
  })

  it('leaves a local session alone', () => {
    const { ctx, router, state } = world()
    installDeviceDialect(ctx as unknown as Context, router as unknown as SshRouter)
    ctx.emit('agent/created', { agent: { id: 'session-on-this-machine', ctx: { tools: new FakeRegistry(state, 'session-on-this-machine') } } })

    expect(visible(state, 'session-on-this-machine')).toEqual(['pwsh'])
  })
})

describe('the runtime context of a device session', () => {
  it('names the device directory instead of this machine one', async () => {
    const { ctx, router, agent } = world()
    installDeviceDialect(ctx as unknown as Context, router as unknown as SshRouter)
    ctx.emit('agent/created', { agent })

    const assembly = {
      contexts: [
        { name: 'working-directory:current', text: 'Current working directory: "C:\\Users\\hp".', interpolate: false },
      ],
    }
    const handler = ctx.handlers.get('system-prompt/assemble')?.[0]
    expect(handler).toBeDefined()
    await handler?.(assembly, { agent }, async () => assembly)

    const working = assembly.contexts.find(entry => entry.name === 'working-directory:current')
    expect(working?.text).toContain('/root')
    expect(working?.text).toContain('tencent')
    expect(working?.text).not.toContain('C:\\\\Users')
    const device = assembly.contexts.find(entry => entry.name === 'dshell:device')
    expect(device?.text).toContain('bash')
  })

  it('leaves a local session context alone', async () => {
    const { ctx, router, agent, local } = world()
    installDeviceDialect(ctx as unknown as Context, router as unknown as SshRouter)
    ctx.emit('agent/created', { agent })

    const assembly = {
      contexts: [
        { name: 'working-directory:current', text: 'Current working directory: "C:\\Users\\hp".', interpolate: false },
      ],
    }
    const handler = ctx.handlers.get('system-prompt/assemble')?.[0]
    await handler?.(assembly, { agent: local }, async () => assembly)

    expect(assembly.contexts).toHaveLength(1)
    expect(assembly.contexts[0]?.text).toContain('C:')
  })
})

describe('a binding that arrives after the agent', () => {
  it('gives the agent the device shell when the session is bound', () => {
    const { ctx, router, state } = world()
    const target = new FakeRouter()
    installDeviceDialect(ctx as unknown as Context, target as unknown as SshRouter)
    ctx.emit('agent/created', { agent: { id: 'session-on-device', ctx: { tools: new FakeRegistry(state, 'session-on-device') } } })
    expect(visible(state, 'session-on-device')).toEqual(['pwsh'])

    target.bind('session-on-device', 'tencent', '/root')
    target.onAssignmentChanged?.('session-on-device', 'tencent')

    expect(visible(state, 'session-on-device')).toEqual(['bash'])
  })

  it('takes the device shell back when the session is unbound', () => {
    const { ctx, router, state } = world()
    const target = new FakeRouter()
    installDeviceDialect(ctx as unknown as Context, target as unknown as SshRouter)
    ctx.emit('agent/created', { agent: { id: 'session-on-device', ctx: { tools: new FakeRegistry(state, 'session-on-device') } } })
    target.bind('session-on-device', 'tencent', '/root')
    target.onAssignmentChanged?.('session-on-device', 'tencent')
    expect(visible(state, 'session-on-device')).toEqual(['bash'])

    // An unbound session runs here again: the host shell comes back.
    const unbound = new FakeRouter()
    void unbound
    ;(target as unknown as { targets: Map<string, unknown> }).targets.clear()
    target.onAssignmentChanged?.('session-on-device', null)

    expect(visible(state, 'session-on-device')).toEqual(['pwsh'])
  })
})
