/**
 * The contract a device-bound agent sees: the DEVICE's shell, not the host's.
 *
 * dshell replaces the EXECUTION of a bound session's shell commands — the
 * seam sends them to the device and runs them with the device's own `bash` —
 * but the MODEL still sees the host's shell tool: a tool named `pwsh`, whose
 * description promises PowerShell, native `C:\...` paths and `$env:NAME`, and
 * whose working directory is this machine's. The model writes PowerShell, the
 * device answers `command not found`, and the round trip is spent on a dialect
 * the device has never heard of. The agent even says so, out loud: "the pwsh
 * tool actually runs on Linux VM-0-6-ubuntu — it's bash, not pwsh".
 *
 * The two halves have to move together. A tool that RUNS on the device but
 * SPEAKS for the host is the same defect as one that runs on the host, seen
 * from the other side: the model is told a lie, and every answer it gets back
 * looks like a broken tool rather than a wrong dialect.
 *
 * So a bound session's agent gets its own shell tool, in its own scope:
 *
 *  - the NAME is the device's (`bash`), because a name is the strongest prior
 *    a model has, and `pwsh` is a prior about a shell that is not there;
 *  - the DESCRIPTION says where the command runs, in which dialect, and with
 *    which paths;
 *  - the HOST's shell tool is hidden from that scope, so there is exactly one
 *    shell and it is the device's;
 *  - the RUNTIME CONTEXT names the device's working directory instead of this
 *    machine's.
 *
 * The execution is untouched: the variant reuses the host tool's own body, so
 * jobs, background calls, sandbox escalation and result rendering behave
 * exactly as they do for a local session. Only the contract changes.
 *
 * The scope is the agent's own (`agent.ctx`), which is the mechanism dsh
 * provides for exactly this: a scoped registration shadows the global one, and
 * a scoped restriction hides a global tool from that agent alone.
 *
 * @module @nexus-aethra/dshell-ssh/device-dialect
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the host agent service merge (ctx.agents).
import type {} from '@deepseek-ai/dsh-agent'
import type { SshRouter } from './router.js'

/**
 * The tool name a device-bound session's shell carries: the device's own.
 *
 * `bash` rather than a neutral word, because the name is what the model
 * reaches for when it decides how to write a command, and a POSIX name is the
 * truth here — the seam runs `bash -c` on the device whatever the host is. It
 * is also the name the client renders as a terminal card, so the device's
 * commands keep the card they had.
 */
export const DEVICE_SHELL_TOOL = 'bash'

/**
 * The host shell tools this package knows how to replace.
 *
 * `pwsh` first: a Windows host is the case that produced this, and a
 * composition that mounts both still wants the PowerShell one replaced.
 */
const HOST_SHELL_TOOLS = ['pwsh', 'bash'] as const

/**
 * One tool definition, as much of it as this module reads or rewrites.
 *
 * Structural on purpose: the ssh package does not depend on the tools
 * package, and it does not need to — it reads a definition, writes a
 * derivative of it, and registers that. The same reasoning the router uses
 * for the shell executor.
 */
interface ToolDefinitionShape {
  readonly name: string
  readonly description: string
  readonly parameters: unknown
  readonly [key: string]: unknown
}

/**
 * The registry surface this module uses.
 *
 * `get` without a scope reads the GLOBAL view, which is where the host's own
 * shell tool lives; the scoped registry an agent carries is reached through
 * that agent's own context, so a registration made through it lands in that
 * agent's layer.
 */
interface ToolRegistryShape {
  get(name: string, scope?: unknown): ToolDefinitionShape | undefined
  register(definition: ToolDefinitionShape): () => void
  restrict(filter: { deny?: readonly string[] }): () => void
}

/** The agent surface this module uses: its id and its own scoped context. */
interface AgentShape {
  readonly id: unknown
  readonly ctx: { readonly tools: ToolRegistryShape }
}

/**
 * A listener, typed so that any handler is assignable to it: `never` accepts
 * every argument shape, which is what a structurally-typed event bus needs.
 */
type Listener = (...args: never[]) => unknown

/** The context surface this module uses. */
interface DialectContextShape {
  readonly tools: ToolRegistryShape
  readonly agents: { list(): AgentShape[] }
  on(event: string, listener: Listener, options?: { prepend?: boolean }): () => void
}

/** One assembled runtime-context contribution. */
interface ContextEntry {
  readonly name: string
  readonly text: string
  readonly interpolate?: boolean
}

/** What the model is told about the device a session runs on. */
interface DeviceFacts {
  /** The device's display name, as the reader named it. */
  readonly name: string
  /** The device's working directory, in the device's own spelling. */
  readonly root: string
}

/** What one agent's scope currently carries, and how to take it back. */
interface Applied {
  readonly facts: DeviceFacts
  readonly dispose: () => void
}

/**
 * The facts about the device a session runs on, or undefined when it runs here.
 *
 * A session that IS bound but whose device cannot be served right now — a
 * locked group, most likely — still runs THERE, so the contract still has to
 * be the device's: the commands fail with a refusal that names the way out
 * (unlock this group), not with a dialect error the model would try to fix by
 * writing different commands.
 *
 * @param router - the device assignments.
 * @param sessionId - the session to describe.
 * @returns the device's facts, or undefined for a local session.
 */
export function deviceFacts(router: SshRouter, sessionId: string): DeviceFacts | undefined {
  const target = router.targetForSession(sessionId)
  if (target !== undefined) {
    return { name: target.device.name, root: displayRoot(target.remoteRoot) }
  }
  const assignment = router.assignmentForSession(sessionId)
  if (assignment === undefined) return undefined
  return { name: assignment.deviceId, root: displayRoot(assignment.remoteRoot ?? '') }
}

/**
 * The device's directory as it should be shown.
 *
 * An absolute path is the device's own. A `~`-spelled root is the reader's
 * shorthand for the device's home, and the helper's protocol refuses it — so
 * it is shown as the shorthand it is rather than as a path the device would
 * reject.
 *
 * @param root - the resolved or stored root.
 * @returns the directory as the model should see it.
 */
function displayRoot(root: string): string {
  if (root.length === 0) return 'the device\'s default directory'
  if (root.startsWith('/')) return root
  return root === '~' ? '~' : root
}

/**
 * The host's own shell tool, read from the global view.
 *
 * The body of the host's tool is reused rather than written again: the jobs,
 * the background promotion, the sandbox escalation and the rendering are the
 * host's, and a device command is the same command with a different place to
 * run it.
 *
 * @param registry - the global registry.
 * @returns the definition to derive from, or undefined when the host has no
 *   shell tool to derive from.
 */
function baseDefinition(registry: ToolRegistryShape): ToolDefinitionShape | undefined {
  for (const name of HOST_SHELL_TOOLS) {
    const definition = registry.get(name)
    if (definition !== undefined) return definition
  }
  return undefined
}

/**
 * The device's shell tool, derived from the host's.
 *
 * @param base - the host's shell tool definition.
 * @param facts - the device the commands run on.
 * @returns the definition to register in the agent's scope.
 */
function deviceShellDefinition(base: ToolDefinitionShape, facts: DeviceFacts): ToolDefinitionShape {
  return {
    ...base,
    name: DEVICE_SHELL_TOOL,
    description: deviceShellDescription(facts),
    parameters: deviceParameters(base.parameters),
  }
}

/**
 * What the model is told about the shell it is holding.
 *
 * @param facts - the device the commands run on.
 * @returns the tool description.
 */
function deviceShellDescription(facts: DeviceFacts): string {
  return `Execute a command on the SSH device ${JSON.stringify(facts.name)} and return its stdout/stderr. `
    + 'This session runs on that remote machine, NOT on the local one: every command runs there, '
    + 'and the local machine\'s files, programs, environment and paths are not there to be used. '
    + 'The device\'s shell is bash, so write POSIX shell syntax — `ls -la`, `cat notes.txt`, '
    + '`grep -r pattern .`, `env | grep NAME`, `ps aux` — not PowerShell cmdlets '
    + '(`Get-ChildItem`, `Get-Process`) and not Windows paths (`C:\\...`). '
    + `Paths are the device's own absolute POSIX paths (for example \`/etc/nginx\`); the working directory is ${JSON.stringify(facts.root)}. `
    + 'Each call runs in a fresh shell; pass `workdir` instead of using `cd`. '
    + 'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. '
    + 'Provide `description` before `command` in the arguments. '
    + 'Before any delete or move, verify that the resolved absolute target path is the intended one; '
    + 'never run it against a computed path you have not checked.'
}

/**
 * The parameter descriptions, rewritten for the device.
 *
 * Only the TEXT changes: the argument contract is the host tool's own, so the
 * validation the host tool does still applies and a call that was valid
 * before is valid now.
 *
 * @param parameters - the host tool's parameter schema.
 * @returns the schema the model sees.
 */
function deviceParameters(parameters: unknown): unknown {
  if (typeof parameters !== 'object' || parameters === null) return parameters
  const schema = parameters as { properties?: Record<string, unknown> }
  const properties = schema.properties
  if (properties === undefined) return parameters
  const patched: Record<string, unknown> = { ...properties }
  const describe = (name: string, text: string): void => {
    const property = patched[name]
    if (typeof property !== 'object' || property === null) return
    patched[name] = { ...(property as Record<string, unknown>), description: text }
  }
  describe('command', 'The command to execute on the device, in POSIX shell (bash) syntax.')
  describe('workdir', 'Absolute directory on the device to run in, in POSIX form (for example `/var/log`). '
    + 'Defaults to the device session directory.')
  describe('description', 'Clear, concise description of what this command does in active voice, '
    + '5-10 words (shown in the UI). Examples: "ls" → "List files in current directory"; '
    + '"git status" → "Show working tree status"; "ps aux" → "List running processes".')
  return { ...schema, properties: patched }
}

/**
 * What the runtime context says about where the session is.
 *
 * The stock context names THIS machine's directory, which is a local stand-in
 * for the device's tree and means nothing to a command that runs on the
 * device. The context is rewritten rather than added to: two "current working
 * directory" lines, one of them wrong, are worse than one right one.
 *
 * @param facts - the device the session runs on.
 * @returns the working-directory line.
 */
function workingDirectoryText(facts: DeviceFacts): string {
  return `Current working directory: ${JSON.stringify(facts.root)} (on the SSH device ${JSON.stringify(facts.name)}).`
}

/**
 * The device section of the runtime context.
 *
 * @param facts - the device the session runs on.
 * @returns the section text.
 */
function deviceContextText(facts: DeviceFacts): string {
  return `This session runs on the SSH device ${JSON.stringify(facts.name)}. `
    + 'Its shell is bash, and the working directory named above is the one on that device: '
    + 'shell commands, file reads and file writes all happen there, not on the local machine. '
    + 'Use the device\'s own absolute POSIX paths (for example `/etc/nginx`); '
    + 'the local machine\'s paths and programs are not there.'
}

/**
 * Rewrite the assembled runtime context for a device session.
 *
 * @param assembly - the assembly the waterfall produced.
 * @param facts - the device the session runs on.
 */
function applyDeviceContext(assembly: { contexts?: ContextEntry[] }, facts: DeviceFacts): void {
  const contexts = assembly.contexts
  if (contexts === undefined) return
  const index = contexts.findIndex(entry => entry.name === 'working-directory:current')
  const working: ContextEntry = {
    name: 'working-directory:current',
    text: workingDirectoryText(facts),
    interpolate: false,
  }
  if (index >= 0) contexts[index] = working
  else contexts.push(working)
  const at = index >= 0 ? index + 1 : contexts.length
  contexts.splice(at, 0, { name: 'dshell:device', text: deviceContextText(facts), interpolate: false })
}

/**
 * Install the device dialect.
 *
 * Three registrations, all of them per agent and all of them reversible:
 *
 *  - the device's shell tool, in the agent's own scope;
 *  - the host's shell tool, hidden from that scope;
 *  - the runtime-context rewrite, which is global but only fires for a
 *    session that runs on a device.
 *
 * The context rewrite is installed on the FIRST agent, not at composition:
 * the stock working-directory context rewrites its own text inside the same
 * waterfall, and only a listener registered after it can have the last word.
 * A plugin is loaded before any agent exists, so "the first agent" is the
 * earliest moment at which that is guaranteed.
 *
 * @param ctx - the host context.
 * @param router - the device assignments.
 * @returns a disposer removing every registration this made.
 */
export function installDeviceDialect(ctx: Context, router: SshRouter): () => void {
  const host = ctx as unknown as DialectContextShape
  const registry = host.tools
  if (registry === undefined) return () => {}
  const applied = new Map<string, Applied>()

  /** Put the device's contract in one agent's scope, or take it back out. */
  const apply = (sessionId: string, agent: AgentShape): void => {
    const facts = deviceFacts(router, sessionId)
    const current = applied.get(sessionId)
    if (facts === undefined) {
      current?.dispose()
      applied.delete(sessionId)
      return
    }
    if (current !== undefined && current.facts.name === facts.name && current.facts.root === facts.root) return
    current?.dispose()
    applied.set(sessionId, installFor(agent, facts))
  }

  /** Register the device's shell tool in one agent's scope. */
  const installFor = (agent: AgentShape, facts: DeviceFacts): Applied => {
    const scoped = agent.ctx.tools
    const base = baseDefinition(registry)
    if (base === undefined) return { facts, dispose: () => {} }
    const definition = deviceShellDefinition(base, facts)
    const unregister = scoped.register(definition)
    // The host's own shell tool, when it has a different name, must not stay
    // visible: two shells in one scope is a choice the model cannot make
    // reliably, and it keeps choosing the one it knows.
    const denied = HOST_SHELL_TOOLS.filter(name => name !== definition.name && scoped.get(name) !== undefined)
    const unrestrict = denied.length > 0 ? scoped.restrict({ deny: denied }) : undefined
    return {
      facts,
      dispose: () => {
        unrestrict?.()
        unregister()
      },
    }
  }

  let contextHook: (() => void) | undefined
  const ensureContextHook = (): void => {
    if (contextHook !== undefined) return
    contextHook = host.on('system-prompt/assemble', async (_assembly: unknown, context: unknown, next: () => Promise<unknown>) => {
      const agent = (context as { agent?: AgentShape } | undefined)?.agent
      if (agent === undefined) return next()
      const facts = deviceFacts(router, String(agent.id))
      if (facts === undefined) return next()
      const result = await next()
      applyDeviceContext(result as { contexts?: ContextEntry[] }, facts)
      return result
    }, { prepend: true })
  }

  host.on('agent/created', (payload: { agent: AgentShape }) => {
    ensureContextHook()
    const agent = payload.agent
    apply(String(agent.id), agent)
  })
  host.on('agent/disposed', (payload: { agent: AgentShape }) => {
    const sessionId = String(payload.agent.id)
    applied.get(sessionId)?.dispose()
    applied.delete(sessionId)
  })
  router.onAssignmentChanged = (sessionId: string): void => {
    const agent = host.agents.list().find(candidate => String(candidate.id) === sessionId)
    if (agent === undefined) return
    apply(sessionId, agent)
  }

  return () => {
    for (const entry of applied.values()) entry.dispose()
    applied.clear()
    contextHook?.()
    contextHook = undefined
    router.onAssignmentChanged = undefined
  }
}
