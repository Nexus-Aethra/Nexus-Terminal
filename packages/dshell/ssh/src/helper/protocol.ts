/**
 * The dshell helper's wire contract.
 *
 * dsh ships its own remote helper and dshell reuses its *framing* — `SshRpcPeer`
 * from `@deepseek-ai/dsh-ssh/protocol`: length-prefixed JSON over one ssh
 * channel — without reusing the helper itself. Two findings decide that:
 * their helper refuses any method it does not know, so it cannot be extended;
 * and it imports eight first-party packages plus node-pty's native prebuilt,
 * so installing it means reproducing a dependency tree on the device, where
 * ours is one self-contained file.
 *
 * Operation names mirror theirs wherever the semantics are identical, which
 * keeps the two vocabularies comparable and a later move onto their client
 * cheap. Everything dshell needs beyond that set is namespaced `dshell.*` —
 * which is the entire point of owning the helper.
 *
 * Every reply is validated before it reaches a caller: the device is not a
 * trusted peer, so a reply is input like any other.
 */
import { z } from 'zod'

/**
 * This contract's revision.
 *
 * Deliberately independent of `SSH_PROTOCOL_VERSION` in dsh-ssh: the framing is
 * theirs, the operation set is ours, so tying our number to their release train
 * would make an alpha wire change look like our incompatibility.
 */
export const DSHELL_HELPER_PROTOCOL = 1

/** Per-message byte ceiling. Matches the value the protocol spike measured. */
export const DSHELL_HELPER_MAX_FRAME_BYTES = 64 * 1024 * 1024

/** Outstanding ordinary requests; heartbeat and cleanup have reserved capacity. */
export const DSHELL_HELPER_MAX_PENDING = 128

/**
 * How long the helper survives without a heartbeat, and the base for how often
 * one is sent (a third of it).
 *
 * Same order as the connection's keepalives (`ServerAliveInterval=10` with
 * `CountMax=3`), on purpose: the transport should notice a dead link at
 * roughly the moment the device is deciding to reap the helper, so the two
 * mechanisms do not disagree about whether the connection is alive.
 */
export const DSHELL_HELPER_LEASE_MS = 30_000

/** Operation names. Mirrored on both ends; never spelled inline at a call site. */
export const HELPER_OPS = {
  /** First call on a connection; carries the protocol revision and the lease. */
  hello: 'hello',
  /** Extends the lease; its absence is what lets the device reap the helper. */
  heartbeat: 'heartbeat',
  /** Ask the helper to release its resources and exit. */
  close: 'close',
  /** Round-trip probe, used by the connection's own check and by tests. */
  echo: 'dshell.echo',
} as const

/** An absolute path as the device spells it. */
export const remoteAbsolutePath = z.string().startsWith('/')

/** A lowercase SHA-256 digest. */
export const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)

/** The handshake request. */
export const helloRequest = z.object({
  protocol: z.number().int().positive(),
  leaseMs: z.number().int().min(3_000).max(600_000),
}).strict()

/**
 * The handshake reply.
 *
 * `hash` is the device's helper hashing *itself*: the client compares it with
 * the digest of the artifact this build ships, which is what makes a stale or
 * substituted helper refuse the connection instead of silently serving.
 */
export const helloReply = z.object({
  protocol: z.number().int().positive(),
  hash: sha256Hex,
  platform: z.string(),
  /** Absolute remote Node executable, as the device resolved it. */
  node: z.string(),
  nodeVersion: z.string(),
  /** The device's default working directory for this connection. */
  root: remoteAbsolutePath,
}).strict()

/** A request with no fields. */
export const emptyRequest = z.object({}).strict()

/**
 * The reply of an operation that has nothing to report.
 *
 * `z.null()` rather than an empty object: "succeeded, no value" is not the same
 * statement as "succeeded, and here is an empty record", and a caller that got
 * the second when it expected the first would go looking for a field.
 */
export const nullReply = z.null()

/** The round-trip probe request. */
export const echoRequest = z.object({ label: z.string() }).strict()

/**
 * The probe reply. `pid` and `cwd` are what make it evidence: they can only
 * have been produced by a process on the other machine.
 */
export const echoReply = z.object({
  label: z.string(),
  upper: z.string(),
  pid: z.number().int().positive(),
  cwd: z.string(),
}).strict()
