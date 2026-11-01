/**
 * The built-in device registry: where device kinds from OUTSIDE this package
 * plug in, and the contracts they are written against.
 *
 * dshell-ssh owns the device MODEL — stored rows, bindings, routing, the seams
 * the shell and the agent consume — but not every device KIND, and it must not
 * learn one: a kind with its own transport and no credential (WSL is the
 * first, see `@nexus-aethra/dshell-wsl`) registers a
 * {@link DshellDeviceProvider} here, and every seam that used to branch on a
 * kind asks the registry instead. A composition that omits the provider's
 * package leaves this registry empty and this package exactly as it was before
 * providers existed.
 *
 * The contracts live in THIS module rather than dshell-std because they speak
 * in node streams (`DeviceCommand`, `DeviceShell`), and std must stay
 * browser-compilable. A provider imports them as types from
 * `@nexus-aethra/dshell-ssh` — type-only, so the dependency runs one way at
 * runtime: this package never imports a provider.
 */

import type { Duplex, Readable } from 'node:stream'
import type { DeviceConnection, DeviceView } from '@nexus-aethra/dshell-std'

// The connection shape is the registry's vocabulary too — providers build it
// outside this package — so it is re-exported here beside the contracts that
// name it.
export type { DeviceConnection } from '@nexus-aethra/dshell-std'

/** How one remote command ended. */
export interface DeviceOutcome {
  /** The remote exit status, or null when it ended on a signal. */
  readonly exitCode: number | null
  /** The signal that ended it, when it did. */
  readonly signal: string | null
  /**
   * The channel was closed without an exit status: the far side tore it down.
   *
   * Not a signal and not a cancellation — the command's fate is unknown, and
   * the only honest reading is that the connection is gone. A caller that can
   * repeat its command says so; a caller that cannot reports it as the loss it
   * is.
   */
  readonly connectionLost?: boolean
}

/** One running remote command, before its output has been read. */
export interface DeviceCommand {
  /** The command's stdin and stdout, as one duplex channel. */
  readonly stream: Duplex
  /** The command's stderr, a stream of its own. */
  readonly stderr: Readable
  /** Settles with the remote outcome; never rejects. */
  readonly done: Promise<DeviceOutcome>
  /** Ask the device to stop. Fire-and-forget; `done` reports the result. */
  terminate(signal?: string): void
}

/** What one collected command produced. */
export interface DeviceExecResult extends DeviceOutcome {
  readonly stdout: string
  readonly stderr: string
  /** Whether the stdout cap dropped bytes from the front. */
  readonly truncated: boolean
}

/** Options one command runs with. */
export interface DeviceExecOptions {
  /** Cancellation; the remote side is asked to stop. */
  readonly signal?: AbortSignal | undefined
  /** Bound on the run, after which the command is terminated. */
  readonly graceMs?: number | undefined
  /** Environment additions for the remote process. */
  readonly env?: Record<string, string | undefined> | undefined
  /** Bytes to write to the command's stdin before it is closed. */
  readonly stdin?: string | Uint8Array | undefined
  /**
   * Leave the command's stdin open for the caller to write to.
   *
   * The default closes it, which is what `ssh -T` gave a command that asked for
   * no input: the remote side sees EOF rather than a pipe nobody writes to, and a
   * program that reads stdin therefore ends instead of waiting for the grace
   * period. A caller that wants to write later says so here.
   */
  readonly openStdin?: boolean | undefined
}

/** A pty-backed remote shell, which is what a visible terminal is. */
export interface DeviceShell {
  /** The shell's stdin and stdout, as one duplex channel. */
  readonly stream: Duplex
  /** Settles with the shell's exit status; never rejects. */
  readonly done: Promise<DeviceOutcome>
  /** Resize the remote terminal. */
  setWindow(rows: number, cols: number): void
  /** End the shell. */
  close(): void
}

/**
 * The three doors every device transport opens, whatever carries the bytes.
 *
 * The ssh transport's pooled `ssh2` client and a provider's own process doors
 * both satisfy this shape structurally; the routing seams (probe, subprocess,
 * filesystem, shell plan) consume it so they never learn which transport
 * answered.
 */
export interface DeviceDoors {
  /** Run one command to completion and collect its output. */
  exec(device: DeviceConnection, command: string, options?: DeviceExecOptions): Promise<DeviceExecResult>
  /** Open one long-lived command channel. */
  open(device: DeviceConnection, command: string, options?: DeviceExecOptions): Promise<DeviceCommand>
  /** Open the pty-backed shell a visible terminal runs in. */
  shell(device: DeviceConnection, command: string, window: { rows: number; cols: number; term: string }): Promise<DeviceShell>
}

/**
 * One source of built-in devices, contributed by a package outside dshell-ssh.
 *
 * A kind with its own transport and no credential (WSL is the first)
 * registers a provider here: its rows join the device list, its ids refuse
 * save/remove, and its doors answer for its connections. A composition that
 * omits the provider's package simply has none of its devices.
 */
export interface DshellDeviceProvider {
  /**
   * The built-in rows this provider contributes, appended to the stored ones.
   *
   * Derived on every call — a WSL2 distribution exists only while `wsl.exe`
   * reports it — and each row must carry {@link DeviceView.builtin}.
   */
  rows(): Promise<readonly DeviceView[]>
  /**
   * The connection for one provider-owned id, or undefined when it is gone.
   *
   * A vanished built-in (the distro was removed) reads as an unknown device:
   * the assignment survives, every seam refuses through the ordinary
   * unservable path, and the rows return when the provider sees it again.
   */
  connection(deviceId: string): Promise<DeviceConnection | undefined>
  /** Whether this id is the provider's own — such rows cannot be saved or removed. */
  owns(deviceId: string): boolean
  /**
   * The doors for one of this provider's connections, or undefined when it
   * does not serve this device.
   */
  doors(device: DeviceConnection): DeviceDoors | undefined
  /**
   * Whether port forwards can be opened to this provider's devices.
   *
   * False comes with {@link refusal} — the forward seams answer with the
   * provider's own words rather than a generic no.
   */
  forwards?: boolean
  /**
   * The provider's own refusal for a seam it does not serve, in the active
   * locale where the provider has one.
   *
   * @param deviceId - the device the seam was asked about.
   * @returns the message, or undefined when the id is not the provider's.
   */
  refusal?(deviceId: string): string | undefined
  /**
   * The connections whose home directory should be probed when the host loads.
   *
   * An SSH device's helper handshake volunteers its root as a side effect of
   * connecting; a provider's devices have no handshake, so the ones that need
   * a root ask for it here — probed once, in the background, at load.
   */
  probeTargets?(): Promise<DeviceConnection[]>
}

/** The built-in devices contributed by the composition's provider packages. */
export class DshellDeviceRegistry {
  private readonly entries = new Set<DshellDeviceProvider>()

  /** Add one provider; its rows and doors answer from the next call on. */
  register(provider: DshellDeviceProvider): void {
    this.entries.add(provider)
  }

  /** Remove one provider — its rows and doors stop answering. */
  unregister(provider: DshellDeviceProvider): void {
    this.entries.delete(provider)
  }

  /** Every registered provider, registration order. */
  providers(): readonly DshellDeviceProvider[] {
    return [...this.entries]
  }

  /** Every built-in row, across providers, in registration order. */
  async rows(): Promise<readonly DeviceView[]> {
    const all: DeviceView[] = []
    for (const provider of this.entries) all.push(...await provider.rows())
    return all
  }

  /** One built-in connection, from the provider that owns its id. */
  async connection(deviceId: string): Promise<DeviceConnection | undefined> {
    for (const provider of this.entries) {
      const connection = await provider.connection(deviceId)
      if (connection !== undefined) return connection
    }
    return undefined
  }

  /** Whether any provider claims this id as its own built-in. */
  owns(deviceId: string): boolean {
    for (const provider of this.entries) {
      if (provider.owns(deviceId)) return true
    }
    return false
  }

  /**
   * The doors for one device, from the provider that serves it.
   *
   * @returns the provider's doors, or undefined when no provider claims the
   *   device — the caller falls back to this package's own ssh transport.
   */
  doorsFor(device: DeviceConnection): DeviceDoors | undefined {
    for (const provider of this.entries) {
      const doors = provider.doors(device)
      if (doors !== undefined) return doors
    }
    return undefined
  }

  /**
   * Whether port forwards may be opened to this device.
   *
   * A provider that says no names its reason (see
   * {@link DshellDeviceProvider.refusal}); a device no provider claims is an
   * ssh device, and ssh devices forward.
   */
  forwardsAllowed(deviceId: string): boolean {
    for (const provider of this.entries) {
      if (provider.refusal?.(deviceId) !== undefined) return false
    }
    return true
  }

  /**
   * One provider's own refusal for a seam it does not serve.
   *
   * @returns the message, or undefined when no provider refuses this id.
   */
  refusal(deviceId: string): string | undefined {
    for (const provider of this.entries) {
      const message = provider.refusal?.(deviceId)
      if (message !== undefined) return message
    }
    return undefined
  }

  /** Every connection the providers want probed when the host loads. */
  async probeTargets(): Promise<readonly DeviceConnection[]> {
    const all: DeviceConnection[] = []
    for (const provider of this.entries) all.push(...await provider.probeTargets?.() ?? [])
    return all
  }
}
