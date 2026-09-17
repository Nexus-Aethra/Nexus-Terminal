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
  /** Start one process on the device. */
  processPrepare: 'process.prepare',
  /** Read output produced since a whole-stream offset. */
  processSnapshot: 'process.snapshot',
  /** The process's exit facts and final collected output. */
  processDone: 'process.done',
  /** Terminate the process's managed range. */
  processTerminate: 'process.terminate',
  /** Wait until nothing of that range is left. */
  processWait: 'process.wait',
} as const

/**
 * Live processes one connection will serve at once.
 *
 * A cap rather than a queue: hitting it means a caller is leaking handles, and
 * refusing the next spawn says so where an unbounded table would grow until the
 * device ran out of room.
 */
export const DSHELL_HELPER_MAX_PROCESSES = 64

/** Per-stream ceiling a caller may ask to collect, in bytes. */
export const DSHELL_HELPER_MAX_COLLECT_BYTES = 64 * 1024 * 1024

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

/** One output stream's collection request: a tail cap, optionally a spill file. */
export const collectMode = z.object({
  /** In-memory cap; overflow keeps the TAIL. */
  maxBytes: z.number().int().positive().max(DSHELL_HELPER_MAX_COLLECT_BYTES),
  /** Whole-stream spill file; absent disables spilling, as the seam allows. */
  spill: z.object({
    maxBytes: z.number().int().positive().max(DSHELL_HELPER_MAX_COLLECT_BYTES),
  }).strict().optional(),
}).strict()

/** stdin as the seam spells it: `/dev/null`, or bytes written and then closed. */
export const stdinMode = z.union([z.literal('ignore'), z.object({ data: z.string() }).strict()])

/**
 * Start one process.
 *
 * No `process.start` counterpart: upstream splits prepare from start so its
 * forwarded streams can attach before the payload runs, and there is no such
 * window here — the helper collects output inside itself, so by the time a
 * caller hears about the process it is already producing into a buffer that
 * cannot miss the beginning.
 */
export const processPrepareRequest = z.object({
  argv: z.array(z.string()).min(1),
  cwd: remoteAbsolutePath,
  /** `null` removes an inherited name; absent leaves the helper's own environment. */
  env: z.record(z.string(), z.string().nullable()).optional(),
  stdin: stdinMode,
  stdout: collectMode,
  stderr: collectMode,
  graceMs: z.number().int().positive(),
}).strict()

/**
 * The process's handle: its identity, and the pid when there is one.
 *
 * `pid` is optional because a start can fail in the platform's own time: node
 * reports a missing program on the child's `error` event, after `spawn`
 * returned, so the helper cannot know synchronously. The failure then surfaces
 * on `process.done` carrying the platform's reason — which is the point, since
 * "no such file" is what a caller can act on and "could not start" is not.
 */
export const processPrepareReply = z.object({
  id: z.string(),
  pid: z.number().int().positive().optional(),
}).strict()

/** Read one stream from a whole-stream offset. */
export const processSnapshotRequest = z.object({
  id: z.string(),
  stream: z.enum(['stdout', 'stderr']),
  /** Whole-stream byte offset to resume from; 0 for the first read. */
  fromByte: z.number().int().nonnegative(),
}).strict()

/**
 * Incremental output.
 *
 * `from` is the whole-stream offset of the first byte in `chunk`, which is what
 * lets a reader detect that it asked below what the device still retains: a
 * `from` greater than the requested offset means the bytes in between are gone
 * from the in-memory window (and only a spill file could hold them).
 */
export const processSnapshotReply = z.object({
  chunk: z.string(),
  from: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
}).strict()

/** One stream's final in-memory tail plus its whole-stream size. */
export const collectedTail = z.object({
  tail: z.string(),
  totalBytes: z.number().int().nonnegative(),
}).strict()

/** Exit facts, in the seam's vocabulary: a code, or the signal that ended it. */
export const processOutcome = z.object({
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
}).strict()

/**
 * The process's end state: exit facts, final tails, and any spill files.
 *
 * Both tails are required rather than optional because this provider serves
 * collect mode only — `supportsStdio` refuses the piped and inherited shapes —
 * so a reply missing one would be a protocol error, not a disposition.
 */
export const processDoneReply = z.object({
  outcome: processOutcome,
  collected: z.object({
    stdout: collectedTail,
    stderr: collectedTail,
  }).strict(),
  /** Device paths; a stream that did not spill is absent. */
  spills: z.object({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  }).strict(),
}).strict()

/** Address one process. */
export const processIdRequest = z.object({ id: z.string() }).strict()

/** Whether the process's managed range is empty. */
export const processWaitReply = z.boolean()
