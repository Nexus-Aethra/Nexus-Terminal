/**
 * Host capabilities belong to local sessions — design 4.11.
 *
 * Two things act on the machine the harness runs on rather than on the session:
 * the browser (its engine is a process here) and upstream's computer-use
 * provider (it drives this desktop). Both are upstream's registries; what this
 * package owns is the question "does THIS session get them?".
 *
 * ---
 *
 * dshell's browser-use provider.
 *
 * dsh ships the capability in two pieces: `dsh-browser-use` owns the exclusive
 * provider slot (`ctx.browserUse`), and a provider package mounts a browser
 * engine per live Session. This is dshell's provider. It drives the same
 * pinned Playwright MCP server upstream's does, and differs in exactly two
 * decisions, both of which are the reason it exists rather than the stock row:
 *
 * 1. **A session that runs on a device gets no browser at all.** The browser is
 *    a program on THIS machine, so a session bound to an SSH device — whose
 *    shell, files and cwd are the device's — would be reaching back across the
 *    boundary the session exists to cross. Upstream decides per activation
 *    whether a provider is *available*, but not on what the session is, and its
 *    own rule is that a scope cannot mask its own registrations: the browser
 *    tools are mounted into the agent's scope, so a `tools.restrict()` deny
 *    list cannot take them away again. Not mounting is therefore the only way
 *    to honour "local sessions only"; see {@link runsOnThisMachine}.
 * 2. **A failure to start the browser is contained.** dsh rejects agent
 *    creation when a serial `agent/created` listener rejects, and upstream's
 *    provider awaits its MCP startup inside that listener — so a broken
 *    install there costs the SESSION, not the browser. Here the mount is
 *    wrapped: a browser that cannot start is logged and that session simply
 *    has no browser tools (design 4.11's "不行就直接关闭").
 *
 * The engine's own output — page snapshots, console logs — is redirected under
 * dshell's data root instead of the session's working directory, which is what
 * the stock provider leaves a `.playwright-mcp/` directory in.
 *
 * Verified against the pinned server by hand: it completes the MCP handshake
 * with no browser installed at all, so the startup path above is about a
 * missing SERVER, and a missing BROWSER shows up as an ordinary tool error the
 * model reads.
 *
 * ---
 *
 * **The desktop tools are denied instead of unmounted.** Upstream's
 * computer-use provider discovers its catalog once, at startup, and registers
 * it GLOBALLY — there is no per-session mount to skip, and the tools are
 * therefore visible to every session until something takes them away. A global
 * registration is exactly what `tools.restrict()` is for, so a device session
 * gets a deny list naming the tools that exist at that moment (plus a re-run on
 * `tools/change`, for a catalog that finished discovering after the session
 * was created). The browser cannot be handled this way — its tools are mounted
 * into the agent's own scope, and a scope cannot mask its own registrations —
 * which is the asymmetry that makes one of these a mount decision and the
 * other a mask. The mask's context is minted with `createScope` rather than
 * borrowed from the agent, because a restriction may only be registered
 * through a context that injects `tools`.
 */

import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-browser-use'
import { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import Schema from '@deepseek-ai/schemastery'
// Type-only: pulls the tools service merge (ctx.tools) the deny list needs.
import type {} from '@deepseek-ai/dsh-tools'
import { harnessHome, isUnder, mountBase, SSH_ROUTING_SERVICE } from '@nexus-aethra/dshell-ssh'
import { discoverChromium } from './chromium.js'

export const name = '@nexus-aethra/dshell-host-tools'

/**
 * The exclusive provider slot this package fills, plus the tool surface the
 * desktop mask reads and restricts.
 *
 * `tools` is not optional here: `ctx.tools` on a context that did not declare
 * it throws, and this package reaches it from an `agent/created` listener —
 * where a throw rejects agent creation and costs the whole session.
 */
export const inject = ['browserUse', 'tools'] as const

/** MCP server name; the tools reach the model as `mcp__<name>__<tool>`. */
const SERVER = 'playwright-mcp'

/**
 * Tool-name prefix of upstream's native computer-use provider. Its tools are
 * global registrations (`inner.tools.register` in
 * `computer-use-cua-driver-native/src/index.ts`), so a deny list can name them.
 */
const DESKTOP_PREFIX = 'cua_driver_native__'

/** What a deployment may say about the browser, and nothing else. */
export interface Config {
  /**
   * Chromium executable to drive. Omitted, {@link discoverChromium} looks for
   * an installed browser and the upstream server's own discovery runs last.
   */
  readonly executablePath?: string
  /** Run without a visible window; defaults to true. */
  readonly headless?: boolean
  /** Per-call timeout for browser tools; omitted keeps the MCP client's default. */
  readonly toolCallTimeoutMs?: number
}

/** Row configuration, validated before the provider reserves the slot. */
export const Config = Schema.object({
  executablePath: Schema.string().pattern(/\S/u),
  headless: Schema.boolean().default(true),
  toolCallTimeoutMs: Schema.number().min(1),
})

/** What this package needs of the SSH router, structurally. */
interface DeviceRouting {
  /** The device a session is bound to, or undefined when it runs here. */
  targetForSession(sessionId: string): unknown
}

/** One device session's desktop mask: the scope that owns it, and its names. */
interface DesktopMask {
  /** Scope every deny layer is registered through; disposing it lifts them. */
  readonly scope: Scope
  /** Tool names already denied, so a `tools/change` re-run adds only new ones. */
  readonly denied: Set<string>
}

/**
 * Whether one live agent's session runs on this machine.
 *
 * Two questions, in this order, and the second is not redundant:
 *
 * 1. **Is the session bound to a device?** Asked of the SSH router by session
 *    IDENTITY, never by directory alone — a device's tree is mirrored by a
 *    mount directory shared by every session bound to that device, so a path
 *    match cannot by itself tell a bound session from an unbound one whose cwd
 *    merely sits in a mount (see `router.ts`, `targetForSession`). This is the
 *    answer for every session that is already bound, which is every resumed
 *    one.
 * 2. **Is its directory a mount?** A session is CREATED before its assignment
 *    is recorded — the dialog creates the session with the mount as its cwd
 *    and binds it one round trip later — so at agent creation a brand-new
 *    device session looks exactly like a local one. The router resolves the
 *    same race the same way for the visible terminal: a session whose cwd is
 *    already under the mount base is mid-bind rather than local. Refusing is
 *    also the safe direction here, and it is the router's own choice: a mount
 *    is an empty local stand-in, so "local" would be a wrong answer that stays
 *    wrong.
 *
 * A composition without the SSH plugin has no router and no mounts; every
 * session is local.
 * @param agent - the live agent whose session is being asked about.
 * @param bound - whether a session id has a device assignment.
 * @param isMount - whether a directory is one of dshell's mount directories.
 * @returns whether browser tools belong to this session.
 */
export function runsOnThisMachine(
  agent: { readonly id: string; readonly session: { readonly header: { readonly cwd?: string } } },
  bound: (sessionId: string) => boolean,
  isMount: (path: string) => boolean,
): boolean {
  if (bound(String(agent.id))) return false
  const cwd = agent.session.header.cwd
  return cwd === undefined || !isMount(cwd)
}

/**
 * Command line for the pinned server.
 *
 * `--isolated` keeps browser state out of the user's Chrome profile, and the
 * output directory is absolute so the session's working directory stays the
 * user's own.
 * @param options - resolved launch settings.
 * @param outputDir - where the server writes snapshots and console logs.
 * @returns argv, after the executable, for the MCP child.
 */
export function browserArgs(
  options: { headless: boolean; executablePath?: string },
  outputDir: string,
): string[] {
  const args = ['--browser', 'chromium', '--isolated', '--output-dir', outputDir]
  if (options.headless) args.push('--headless')
  if (options.executablePath !== undefined) args.push('--executable-path', options.executablePath)
  return args
}

/**
 * Mount the browser MCP server for every local session.
 *
 * The row carries no configuration by default — every field is optional and
 * the defaults are the intended deployment — so `config` may arrive absent
 * rather than empty.
 * @param ctx - context carrying the provider slot.
 * @param config - validated row configuration, or nothing at all.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@playwright/mcp/package.json'))), 'cli.js')
  // Inherited upstream options can otherwise replace the configured browser
  // mode or import an unrelated profile; empty values mean absent to its
  // parser. Blanked once, like the provider this follows.
  const env = Object.fromEntries(Object.keys(process.env)
    .filter(key => key.toUpperCase().startsWith('PLAYWRIGHT_MCP_'))
    .map(key => [key, '']))
  const executablePath = config.executablePath ?? discoverChromium()
  const outputDir = join(harnessHome(), 'dshell', 'browser')
  const args = [cli, ...browserArgs({
    headless: config.headless !== false,
    ...executablePath === undefined ? {} : { executablePath },
  }, outputDir)]

  ctx.effect(function* () {
    yield ctx.browserUse.register(BrowserUseProviderName(SERVER))
  }, 'dshell-browser-use: provider registration')

  const routing = (): DeviceRouting | undefined => ctx.get(SSH_ROUTING_SERVICE) as DeviceRouting | undefined
  const localSession = (agent: Agent): boolean => runsOnThisMachine(
    agent,
    sessionId => routing()?.targetForSession(sessionId) !== undefined,
    path => isUnder(mountBase(), path),
  )

  /**
   * Device sessions whose desktop tools are denied, each with the scope its
   * deny layers live in and the names already denied.
   *
   * The scope is minted rather than taken from `agent.ctx`: a restriction may
   * only be registered through a context that INJECTS `tools`, and the scoped
   * context is the one that inherits this plugin's dependency API. A name is
   * denied once, because each call appends a layer that nothing lifts early.
   */
  const masked = new Map<Agent, DesktopMask>()

  /**
   * Agents whose browser has already been mounted, so a repeated
   * `agent/created` for one activation cannot start a second server.
   */
  const mounted = new Set<Agent>()

  const maskDesktopTools = (agent: Agent): void => {
    const mask = masked.get(agent)
    if (mask === undefined) return
    const missing = ctx.tools.schemas(agent)
      .map(tool => tool.name)
      .filter(toolName => toolName.startsWith(DESKTOP_PREFIX) && !mask.denied.has(toolName))
    if (missing.length === 0) return
    try {
      mask.scope.ctx.tools.restrict({ deny: missing })
    } catch (error) {
      // Same rule as the browser mount: a capability that cannot be taken away
      // must not cost the session. Reported once per name set, because the
      // `tools/change` retry would otherwise repeat it.
      ctx.logger.warn(`dshell-host-tools: desktop tools not denied for ${agent.id}: ${String(error)}`)
      return
    }
    for (const name of missing) mask.denied.add(name)
  }

  ctx.on('agent/created', async ({ agent, signal }) => {
    if (!localSession(agent)) {
      const scope = createScope(ctx, agent)
      masked.set(agent, { scope, denied: new Set() })
      agent.ctx.effect(() => async () => {
        masked.delete(agent)
        await scope.dispose()
      }, 'dshell-host-tools: desktop mask')
      maskDesktopTools(agent)
      return
    }
    if (mounted.has(agent)) return
    // Recorded before the await: a second event for the same activation must
    // not start a second server while this one is still handshaking.
    mounted.add(agent)
    agent.ctx.effect(() => () => { mounted.delete(agent) }, 'dshell-host-tools: browser mount')
    try {
      signal?.throwIfAborted()
      await mkdir(outputDir, { recursive: true })
      await agent.ctx.plugin(McpClient, McpClient.Config({
        transport: 'stdio',
        serverName: SERVER,
        command: process.execPath,
        args,
        env,
        ...agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd },
        ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
        failOnStartupError: true,
        reconnect: { enabled: false },
      }))
    } catch (error) {
      // Contained on purpose: dsh fails agent creation when this listener
      // rejects, and a session without a browser is a working session.
      ctx.logger.warn(`dshell-host-tools: no browser for ${agent.id}: ${String(error)}`)
    }
  }, { prepend: true })

  // A catalog that finished discovering after a session was created still has
  // to be taken away from that session's device agents.
  ctx.on('tools/change', () => {
    for (const agent of masked.keys()) maskDesktopTools(agent)
  })
}

export default { name, inject, apply }
