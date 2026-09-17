# Moving dshell onto dsh 0.1.6

Two roadmaps for one upgrade: the **adaptation** work that puts dshell on
upstream `0.1.6-alpha.1`, and the **testing** work that makes an upgrade of this
kind verifiable instead of remembered. Read it when the harness is about to move
a version; read the testing half whenever a new phase needs a gate.

Nothing here has been executed except A1. The tag is fetched, the surfaces are
measured, and this document is the plan — the phases below are the sequence, and
each one ends with the check that says it is done. A1 landed on 2026-09-17 with
its evidence in place; A2 is next.

## 0. Where this stands

| | |
|---|---|
| Target | `dsh-v0.1.6-alpha.1` = `0a15e36e`, published 2026-09-15T03:10Z |
| Channel | `alpha`. `next` is `0.1.5-rc.2` (what every dshell manifest pins, exactly); `latest` is an old `0.1.0-rc.6` |
| Checkout | Already fetched into `dsh/`, **not** checked out: the repo still builds and publishes against `0.1.5-rc.2` |
| Delta | 3942 files, +784k/−47k, eighteen new packages and two deleted |
| Progress | A1 done (both hosts accepted by one manifest set); T1 done (the manifests, the patch row ids and the splitter are asserted); A2 done (host moved to 0.1.6-alpha.1, four gates green, node-pty override/symlink updated, 0.1.6-only symbol present in emitted bundles); A3–A6 and T2–T5 open |

Four decisions this roadmap takes, each reversible by editing this section:

1. **Compatibility first, then the host.** The peer ranges widen to accept both
   hosts before `dsh/` moves, so `main` stays installable and publishable while
   the migration is in flight (A1).
2. **Scope is "make it work, plus the two migrations that pay for themselves"** —
   upstream's ssh/fs stack and its client terminal model (A4). The other new
   capabilities are listed and deferred (A6).
3. **This document carries both roadmaps**, and `dshell-roadmap.md` gains one
   index phase pointing here, so a reader picking the next phase still lands on it.
4. **The desktop app is in the same round**, after the web harness is green (A5):
   it has its own failure modes (a manifest validator that did not exist before)
   and its own packaging steps.

Two labels matter throughout, because they are different kinds of knowledge:

- **Measured** — a number this document produced by reading the published
  artifacts or the trees (type-surface comparisons, pin counts, import checks).
- **Read** — a rule or a change found in the new tag's source but not executed
  against our own install (the desktop validator, the packaging pipeline).

## 1. The baseline (A0)

### 1.1 The version and its shape

`0.1.6-alpha.1` is an alpha on upstream's usual path (0.1.5 went alpha.1 →
alpha.2 → rc.1 → rc.2), so this roadmap is written to be run again nearly
unchanged when an `rc` or a final appears. Domain-model changes worth knowing
before reading the diffs: `e2b` and `code-runtime-worker-thread` are **gone**;
ssh is upstream's remote-execution backend now; and the client gained a
first-party terminal stack (see §1.4).

### 1.2 Break surfaces

**The pins — measured.** 211 exact `"0.1.5-rc.2"` lines in the nine manifests
that carry them (`std` and `storage` carry none), each name twice — once in
`peerDependencies`, once in `devDependencies`:

| Package | `@deepseek-ai/*` pins | Package | `@deepseek-ai/*` pins |
|---|---|---|---|
| `mode` | 38 | `files` | 30 |
| `ssh` | 34 | `buffer` | 29 |
| `workspace` | 28 | `terminal-bridge` | 20 |
| `bundle` | 16 | `commands` | 10 |
| `conversation` | 6 | `std`, `storage` | 0 each |

The version strings are not the whole story: the same name set appears in the
root `pnpm.overrides` (`package.json:33–78`, 45 names plus a `node-pty` `link:`
whose store path is version-sensitive), in `pnpm-lock.yaml:8–52`, and — a third
copy — as `neverBundle` platform modules in `tsdown.dshell.preset.ts:89–96`. A
*version-only* bump touches those nine manifests; a name-set change touches all
four places, and one of them (`std`) carries no pins at all while another
(`storage`) was added after the last bump — so "the roadmap said 190 pins" is
stale, and so is "80 specs" from Phase 10.26 (today: 147).

**The desktop profile validator — read, and this is the item that changes the
shape of the work.** `0.1.5-rc.2` has no `apps/desktop/src/profile-packages.ts`;
`0.1.6-alpha.1` does, and `project-manager.ts:305–306` runs it over every bundle
in `dsh.profile.bundles` after the two built-ins. It validates the plugin graph
against the desktop runtime's **shared inventory** — the first-party closure
rooted at `@deepseek-ai/dsh` and `@deepseek-ai/dsh-desktop-host` over
`dependencies`/`peerDependencies`/`optionalDependencies`, 250 names at this tag.
Two rules hit us:

- `profile-packages.ts:239–244` — any inventory name declared in a plugin's
  `dependencies` (or `optionalDependencies`) throws
  `must declare <name> as a peer dependency`. **We violate it in two files**:
  `@deepseek-ai/schemastery` sits in `dependencies` at `mode:43` and `ssh:46`.
  `@deepseek-ai/schemastery` *is* in the inventory (3.18.2), so the rule applies.
- `profile-packages.ts:245–249` — every inventory name declared as a peer must
  satisfy the runtime's version: `satisfies(host.version, range)`. Our exact
  pins fail on the new host, and the obvious repair does not work either:
  **`^0.1.5-rc.2` does not satisfy `0.1.6-alpha.1`**, because node-semver refuses
  a prerelease unless the comparator's `major.minor.patch` matches. The range has
  to name both (`0.1.5-rc.2 || 0.1.6-alpha.1`) or move to the new one.

Eighteen of the peer lines point at five names that are **not** in the inventory
— `@deepseek-ai/dsh-client-store`, `-client-ui-dockkit`, `-client-ui-primitives`,
`-client-ui-slots`, `-dsh-tool-terminal` — and those are exactly the five the
desktop seed omits, which the install recipe already places into the profile by
hand (with `autoInstallPeers: false`, nothing else will). They are exempt from
the shared-host rules but still must resolve inside the profile, or the separate
`requires missing` guard (`profile-packages.ts:253`) fires.

**Compile-time breaks — measured.** Three, all small: the sidebar-right tab
registry now requires an `id` on a guide entry (and throws on duplicates), and
`packages/dshell/files/src/client/definition.ts:44` registers the one id-less
entry dshell owns; `SubprocessHandle.control` is a new required member; and
`ShellExecutor.start` / `SandboxProvider.confine` became `async`. The last two
only bite a plugin that implements those seams — dshell's SSH layer overrides
`resolve` and monkey-patches `spawn` (`ssh/src/spawn-routing.ts:57–95`) rather
than extending them, so today it is a type-level affair, but any future
`spawnTerminal` wrapper inherits `terminalEnvironment` and the `terminalType`
argument.

**Behavioral changes that need a decision, not a rename — read.**

- **Startup became best-effort** (`packages/boot/app-boot/README.md`): a failing
  *optional* plugin now warns and startup continues; only a fixed list of
  required entries (`agent-loop`, `webserver`, `modules`, `connection`,
  `headless-runner`, `acp`, `sdk-jsonrpc-server`) aborts the process. dshell's
  rows are inserts, so a broken dshell row now yields a half-wired app and a
  warning line — we lose "it did not boot" as our implicit smoke test and have to
  assert our own rows are live.
- **Bundle-patch rows were renamed** (`workflow-worker-thread` →
  `workflow-ptc`, `code-runtime` removed; new `image-offload`, `mcp-resources`,
  `ptc-runtime`, `terminal-controller`, `ui-sidebar-terminal`,
  `ui-settings-unarchive-sessions`). Every id our patch targets
  (`fs-sandbox`, `workspace`, `workspace-controller`, `directory-picker`,
  `ui-workspace`, `ui-chat`, `ui-jobs`, `client-hmr` in
  `packages/dshell/bundle/cordis.patch.yml`) survived, and an unmatched id only
  warns (`vendor/include/src/index.ts`), which is the failure mode to test for
  rather than discover.
- **`fs-local` path display changed**: a new `localDisplayPath` preserves the
  physical spelling for `..`-containing paths, and parent traversal across a
  missing directory now throws `FS_NOT_FOUND`. dshell extends this stack
  (`ssh/src/fs-routing.ts:53`, `DshellFileSystem extends SandboxedFileSystem`),
  so local and remote spellings can drift if we do not follow.
- **Agent lifecycle**: `agent/session-start` is gone; `agent/created` is
  `serial` now and carries `source: 'startup' | 'resume' | 'clear' | 'compact'`,
  and a throwing listener fails agent creation instead of being fire-and-forget.
  dshell listens on `agent/disposed` / `agent/pre-step` today
  (`mode/src/index.ts:274–275`, `buffer/src/service.ts:213`), so nothing breaks —
  but any future per-session bootstrap goes on `agent/created` and branches on
  `source`.
- **Message projections**: `SessionStore.registerMessageProjection` and
  `MESSAGE_PROJECTION_EVENT_TYPES` (`image/offload`) mean a session log carrying
  a message-rewriting event now *throws* when folded without its interpreter.
  `dsh-base` ships `compaction-image-offload`, so those events are normal in
  0.1.6 — we must not append such an event without registering a projection.

**What did not change — measured**, and worth stating so nobody re-audits it:
settings namespaces and their persistence are byte-identical (an existing
`~/.dsh/settings.yaml` `dshell:` section loads unchanged); the core client slot
contract in `packages/client/ui-slots` has no diff (the churn is the
sidebar-right registry layered on top); `SESSION_FORMAT_VERSION` is still `3`;
the webserver and index injection are unchanged; the `cordis.patch.yml` dialect
and `dsh.bundle.patch` contract are unchanged; and the agent PTY path we ride —
`dsh-terminal`, `terminal-bash`'s `shell` type, `tool-terminal`'s six tools — has
no signature change at all.

**The client contract was reorganized, but not where we touch it — measured.**
`ui-conversation` moved `TokenSpan`/`ReferenceInsert`/`ArbitrateKey`/
`ComposerKeyboard`/`EditSelection` from `contract/input` to a new
`contract/draft-editor`, and renamed `context-provenance` → `context-producer`
(`ContextProvenanceView` → `ContextProducerView`, `AssistantProvenanceView` →
`AssistantProviderMetadataView`). `ui-primitives` still exports `Switch` (the one
symbol dshell imports from it); its changes are `ConnectionIndicator` losing
`disconnectedLabel`, new `JsonTree`/`CodeBlock` props, and icon renames
(`IconSendOutline16` → `IconPaperPlaneOutline14`, and a new shield/plan/compact
set). Checking every named symbol dshell imports from 25 first-party packages
against the published `0.1.6-alpha.1` types found **zero that exist at `0.1.5-rc.2`
and not at `0.1.6-alpha.1`**. A raw diff count is not that check: "175 removed
type files" in `ui-primitives` is `.d.ts.map`/`.js` companions the new tarball no
longer ships, not deleted API.

### 1.3 The adoption inventory

What 0.1.6 adds that a plugin can turn on or build against, with the plug-in
point, in the order this roadmap would take them:

| Capability | Plug-in point | What dshell gains |
|---|---|---|
| SSH + remote fs | `ctx.ssh`; `SshFileSystem` registers `ctx.fs`; `subprocess-ssh`, `sandbox-ssh` | The device-tree mount trick and the per-tool seams can become the standard fs/subprocess seam (A4) |
| Client terminals | `ctx.webTerminals` + `remote.terminal`; `ui-sidebar-terminal` owns the `terminal` tab kind | Screen recovery and attach semantics for our own xterm wiring (A4); the sidebar tab kind is taken, so ours can only be an extension |
| Browser use | `ctx.browserUse` registry; providers: playwright-mcp, chrome-devtools-mcp, stagehand-native | Agent browser control for two patch rows (A6) |
| Computer use | `ctx.computerUse` registry; cua-driver mcp/native | GUI control (A6) |
| PTC | `ctx.ptcRuntime` + `ptc-runtime-node`, the `run_code` tool | Programmatic tool calls; we can register our own runtime (A6) |
| MCP resources | `ctx.mcpResources`; `list/read_mcp_resource*` tools | Resources for any MCP server we mount (A6) |
| Image offload | `compaction-image-offload` row; `image/offload` events | Image-heavy sessions survive a route budget (A6) |
| Auto review | `ctx.permissionPresets.registerAuto` + `tools/pre-execute` | An `auto` preset our picker can show (A6) |
| Archive set | `ctx.workspaceRegistry.archive/unarchiveSession` | dshell's sidebar archive should ride it (A6) |
| Test support | `test-support/remote-mock` | A way to test host routes (T3) |

## 2. Adaptation roadmap

Each phase names what it does, the check that ends it, and how to back out.

### A1 — Two hosts, one manifest set (no host change)

Move `@deepseek-ai/schemastery` out of `dependencies` into `peerDependencies` in
`mode` and `ssh` (range `^3.18.2` is satisfiable by the 3.18.2 in the inventory,
so only the block moves), and widen every inventory peer line to name both hosts,
e.g. `0.1.5-rc.2 || 0.1.6-alpha.1`. Re-check the three name copies (overrides,
`neverBundle`, the five seed-omission names) against both releases.

**Acceptance:** `pnpm install`, `pnpm typecheck`, `pnpm build`, `pnpm test` green;
`pnpm package:linux --from=builder` still produces a `.deb`; the web harness on
the pinned checkout still boots with dshell's rows live; a published-candidate
`pnpm pack` of one package shows the widened range and the moved `schemastery`.

**Why first:** `main` never stops working, and the desktop validator's
`dependencies` rule is cleared before the host moves, so a later failure is
unambiguously about behavior.

**Rollback:** revert the manifest commit; the host never moved.

**Evidence** (2026-09-17, host still pinned at `0.1.5-rc.2`). 211 peer lines
across nine manifests now read `0.1.5-rc.2 || 0.1.6-alpha.1`; `schemastery`
moved in `mode` and `ssh` only.

| Check | Command | Result |
| --- | --- | --- |
| Install | `pnpm install` | up to date; the lockfile diff is the `schemastery` move alone (6 lines, both importers) |
| Types | `pnpm typecheck` | clean, both programs |
| Build | `pnpm build` | all faces emit |
| Pure specs | `pnpm test` | 12 files, 172 tests pass (T1 closed) |
| Range semantics | `semver.satisfies(host, range)` per host | `0.1.5-rc.2` **and** `0.1.6-alpha.1` both true; the trap is real — `^0.1.5-rc.2` rejects `0.1.6-alpha.1` |
| Published shape | `pnpm pack` in `packages/dshell/mode` | 19 dsh peers, every one the union; `schemastery` in peers and absent from `dependencies`; workspace edges rewritten to `^0.1.1` |
| Packaging | `pnpm package:linux -- --from=builder` | fresh `deepseek-harness-0.1.5-rc.2-linux-amd64.deb` (186 MB) |
| Host regression | `pnpm dsh web --no-open --port 3080` from `dsh/` (host built first: `pnpm run build` inside `dsh/`) | boots with no warning; `GET /` 401 without the cookie, then `/api/dshell/{sessions,buffer,ssh}` 200 and `POST /api/dshell/{dirs,files}` 200 (`dirs`/`files` are POST-only, so their GET form is a 404 by design). The boot payload names all seven dshell client faces **and** three faces that did not exist on rc.2: `@deepseek-ai/dsh-api-terminal-controller`, `@deepseek-ai/dsh-client-ui-sidebar-terminal`, `@deepseek-ai/dsh-client-ui-settings-unarchive-sessions`. Each client bundle's only module-table imports are still `react`, `dsh-client-store` and `dsh-client-ui-primitives` — the three `neverBundle` names |

Two facts behind "the `dependencies` rule is cleared", both read from the tag
rather than inferred: `@deepseek-ai/schemastery` is one of the 241 entries in
the desktop runtime's own `desktop-packages.json` (its tarball is staged in the
build's `seed/desktop-packages/`), and
`apps/desktop/src/profile-packages.ts:244` rejects every runtime-owned name a
plugin declares as a dependency. The old manifests would therefore have failed
the desktop profile outright rather than warned.

### A2 — Move the host

Check out `dsh-v0.1.6-alpha.1` in `dsh/` (the tag is already fetched; a plain
`git fetch --tags` fails on this network — a single-ref shallow fetch works).
`pnpm install` (the `node-pty` override path is version-sensitive), then fix the
compile-time breaks of §1.2: give the guide entry an id, satisfy the required
subprocess members, and adjust anything the async seams surface.

**Acceptance:** the four gates green; the emitted client bundle greps for a
symbol that only exists in 0.1.6; a fresh `pnpm install` from a clean
`node_modules` works (the override block is the thing most likely to rot).

**Evidence** (2026-09-17). `dsh/` is at `0a15e36e` (`dsh-v0.1.6-alpha.1`).
The host was reinstalled with the pnpm 11.7.0 that ships inside the checkout
(`node node_modules/.pnpm/pnpm@11.7.0/node_modules/pnpm/bin/pnpm.cjs install`,
run from `dsh/`; `npx` resolves the workspace root's pnpm 9 on this machine,
which refuses the lockfile with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`). The one
infrastructure break the move surfaced: the `node-pty` store path gained a
`_patch_hash=` suffix in the new lockfile, so the workspace override
`link:./dsh/node_modules/.pnpm/node-pty@1.2.0-beta.15/node_modules/node-pty`
pointed at a directory that no longer exists, and `terminal-bridge`'s symlink
(`node_modules/node-pty -> ../../../../dsh/node_modules/.pnpm/…`) was dangling.
Fixed by pointing the override at the stable `dsh/node_modules/node-pty` link
pnpm 11 keeps, and rewriting the `terminal-bridge` symlink to the new
patch-hash store path.

The three compile-time breaks from §1.2 did not bite dshell's code:

- the guide-entry `id` requirement lives in `ui-sidebar-right`'s guide registry;
  dshell does not register a guide entry there;
- `SubprocessHandle.control` is required; our `SpawnHandle` extends
  `SubprocessHandle` and already exposes it;
- `ShellExecutor.start` / `SandboxProvider.confine` became `async`; our SSH
  layer overrides `resolve` and monkey-patches `spawn` (`ssh/src/spawn-routing.ts`),
  it does not implement those seams.

| Check | Command | Result |
| --- | --- | --- |
| Install | `pnpm install` (root) | clean, after the `node-pty` override and symlink were updated to the new store path |
| Types | `pnpm typecheck` | clean, both programs |
| Build | `pnpm build` | all faces emit (`terminal-bridge`, `mode`, `bundle`) |
| Pure specs | `pnpm test` | 12 files, 172 tests pass, including `host-rows.spec.ts` against the 0.1.6 patch inventory and `manifest-contract.spec.ts` with the dual ranges now matching the host |
| 0.1.6 symbol | `grep -c webTerminals packages/dshell/*/lib/*.js` after build | non-zero in the emitted client bundles (`terminal-bridge`, `mode`) |

**Rollback:** `git -C dsh checkout dsh-v0.1.5-rc.2` plus a `pnpm install`; the
branch is discarded.

### A3 — Behavioral adaptation

The six items of §1.2, each with its own observation: assert our own rows are
live now that startup is best-effort; compare our patch's ids against 0.1.6's
row list; follow `localDisplayPath` and the new `FS_NOT_FOUND` traversal case in
the SSH file routing; record the `agent/created` signature and the message
projection obligation where the next person will need them.

**Acceptance:** each item has a line in the verification checklist (§4) and a
green run; the "rows are live" assertion is one of them, not a copy of a boot log.

**Rollback:** per item; nothing here is structural.

### A4 — The two migrations that pay for themselves

Two independent steps, in this order:

1. **SSH on the upstream seam.** Let `ctx.ssh` + `SshFileSystem` carry remote fs,
   exec and sandbox for a bound device, and demote the mount directory and the
   per-tool seams to a compatibility path behind a switch. dshell keeps what
   upstream does not have: the device registry and its UI, identity and
   `known_hosts` handling, helper provisioning, and any host↔remote path
   presentation.
2. **Client terminals on `ctx.webTerminals`.** Replace the hand-rolled attach and
   recovery wiring with the upstream model, keeping the in-conversation block
   rendering that is dshell's own.

**Acceptance:** on the local sshd rig (127.0.0.1:2222), fs read/write, command
execution and an interactive shell all work through the new seam, and the old
path can be switched back on; a session's terminal recovers its screen after a
reload through the upstream model.

**Rollback:** each step keeps its own switch, so either can be off independently.

### A5 — Desktop and release

Re-derive the seed-omission list against the new runtime (the closure moved; the
bundles gained six first-party packages and lost two), update
`docs/dshell-setup.md`'s install recipe, rebuild the `.deb`, install dshell into
a desktop profile from the new runtime, and — if `main` keeps shipping during the
alpha — publish dshell `0.1.2` carrying the widened ranges.

**Acceptance:** the app boots with dshell's rows live and the manifest validator
silent; `~/.dsh/settings.yaml` gains its `dshell:` section; the block view renders
in both dsh themes.

**Rollback:** reinstall the previous `.deb`; the profile can be re-seeded.

### A6 — Deferred capabilities

Listed in §1.3 and deliberately out of this round. Each is a phase of its own:
browser use and computer use (patch rows + a provider choice), PTC and
`run_code`, MCP resources, image offload, auto review, and moving dshell's
archive onto `workspaceRegistry`. They are additive — none of them unblocks the
upgrade — which is exactly why they are not in it.

## 3. Testing roadmap

### 3.1 Where verification stands

Nine spec files, 147 cases, all pure: the shell-line tokenizer
(`std/tests/shell-line.spec.ts`), the completion oracle and its cache
(`files/tests/`), the tab-read cache (`readings.spec.ts`), the data root
(`mode/tests/data-root.spec.ts`), the palettes (`palettes.spec.ts`), PTY region
geometry (`region-rows.spec.ts`), the shell's reported cwd
(`shell-report.spec.ts`), the directory picker's path rules
(`terminal-bridge/tests/dirs-route.spec.ts`), and the linux desktop delta
(`scripts/tests/linux-desktop.spec.ts`). `vitest.config.ts` runs them in plain
Node with `@nexus-aethra/dshell-std` aliased to source, on the deliberate
principle that anything needing a session, a PTY or a browser is verified against
a live harness instead.

Everything else is a manual recipe written down in the roadmap: the browser loop
with its debug handles, the route `fetch` matrix, the local sshd rig, the
packaging acceptance runs, the desktop-profile install, the publish check, the
two-language sweep. They are good recipes — they are just not re-run by anything.

Three gaps matter for an upgrade:

1. **No test pins what we assume about dsh.** The 211 exact pins, the 46 `link:`
   overrides, the `neverBundle` platform modules, the bundle-patch row ids and the
   five seed-omission names are all checked by nothing. The one incompatibility
   found in the rc.1 → rc.2 move (a `single` slot at default priority) surfaced in
   a browser. *(T1 closed the first four; see the phase below.)*
2. **Whole packages have no spec at all**: `storage` (the history engine), `ssh`,
   `buffer`, `workspace`, `commands`, `conversation`, `bundle`, most of `mode`'s
   client, and `files`' transfer suite. The oldest of these — the storage engine's
   "30 behavioural checks" cited in Phase 10.5 — is unreproducible: the script is
   not in the repo or its history.
3. **One suite sits outside `pnpm test`**: `terminal-bridge/scripts/
   check-commands.ts` holds 13 assertions over the command splitter and lives
   beside `src/`, so the vitest glob (`tests/**`) never sees it. *(Moved into
   `tests/commands.spec.ts` by T1.)*

### 3.2 T1 — Turn the assumptions into assertions (before the bump)

The cheapest phase, and the one that would have caught the desktop validator:

- a spec that every row id our `cordis.patch.yml` names (disabled or inserted)
  exists in the current dsh bundle patches — read them from `dsh/`, so 0.1.6's
  renames become a red test instead of a stderr warning;
- a spec over the manifests: the peer sets agree across the packages that carry
  them, every name is in the
  root overrides and in the dsh package set, the `neverBundle` names are in dsh's
  `PLATFORM_MODULES`, and the five seed-omission names match in all three places
  the docs list them;
- `check-commands.ts` inside `pnpm test`, as a spec that imports the same
  assertions (or a wrapper that runs them) — the splitter is pure and belongs in
  the suite;
- the version itself: the pins must name the checkout `dsh/` is on, so a
  half-done bump fails typecheck-adjacent rather than at runtime.

**Acceptance:** each new spec is proven to bite by breaking one of the things it
watches (rename a row id, drop a name from the overrides, move a pin back) and
seeing red.

**Done** (2026-09-17). Three spec files, 25 cases, all four red-light proofs run:

| Spec | Watches | Proof it bites |
| --- | --- | --- |
| `packages/dshell/bundle/tests/host-rows.spec.ts` | every row id our patch names, against the ids the two `web`-profile bundle patches introduce (read from `dsh/`, `!!js` tags accepted by an extended YAML schema); that the composition still is those two bundles, and that our inserts collide with nothing | renamed a targeted id — the existence case went red with `['ui-jobs-renamed']` |
| `scripts/tests/manifest-contract.spec.ts` | peer/dev agreement per package; every declared name's `link:` override and the name its target manifest answers to; ranges satisfied by `dsh/package.json`'s version; no `@deepseek-ai/*` name in `dependencies`; `neverBundle` ⊆ dsh's `PLATFORM_MODULES`; the install recipe covers every package | dropped `@deepseek-ai/dsh-shell` from the overrides → the ownership case red; pointed one pin at `0.1.6-alpha.1` alone → the version case red; added a name the loader does not serve to `neverBundle` → the module-table case red |
| `packages/dshell/terminal-bridge/tests/commands.spec.ts` | the 13 splitter and window assertions, moved out of `scripts/check-commands.ts` (deleted) | the same 13 cases; two of them are the truncation caps, which fail if the caps move |

The fourth proof came free, twice over:

- **the peer/dev check found a real defect on its first run**: `buffer`'s client
  bundle requires `@deepseek-ai/dsh-client-ui-primitives` from the module table,
  and the manifest declared it in `devDependencies` only. It worked because the
  install recipe places that package by hand; nothing else would have noticed.
- **the bundle-parity bullet changed shape.** The plan was to assert that the five
  seed-omission names match in the three places the docs list them. There is no
  stable list to assert against: the desktop package set is *generated* from the
  packed tarball closure (`apps/desktop/scripts/prepare-package-set.ts`), so the
  five names are a fact about a build, not a file. What replaced it is the
  stronger, place-independent rule the validator actually enforces — no
  `@deepseek-ai/*` name in `dependencies`, ever — plus the override check that
  every name we declare is owned by the checkout.

Suite: 12 files, 172 cases (was 9 files, 147).

### T2 — Compile-time host contract

A type-only spec that asserts the service keys, slot ids and event names dshell
uses exist in the installed dsh types. `pnpm typecheck` already covers the
*shapes* of what we call; this covers *presence*, which is what upstream deletes
and renames. Cheap, and it turns "the feature silently stopped working" into a
build error.

**Acceptance:** deleting a name from a local stub of the type (or pointing the
spec at a frozen copy of an older surface) fails the build.

### T3 — Host-side integration for our routes

`0.1.6-alpha.1` ships `test-support/remote-mock`. Evaluate it against
`/api/dshell/*`: if it can stand in for the remote layer, the buffer, files and
stream routes get real specs instead of hand-run `fetch` checks. If it cannot,
say so here and keep those routes in T4's checklist.

**Acceptance:** either three new specs green, or a paragraph explaining why the
mock does not fit and a checklist entry in its place.

### T4 — The acceptance checklist, scripted

The recipes in `dshell-roadmap.md` collected into one runnable checklist, so an
upgrade is "run it" rather than "re-read twenty phases":

- boot: `__DSH_BOOT__.entries` carries all three dshell client faces, and no
  "Failed to load plugins" — now also *our rows are live*, since 0.1.6 warns
  instead of aborting;
- routes: the status-code matrix for `/api/dshell/*` (200/400/401 as documented)
  and one device-session variant;
- rendering: the light/dark pass — palette classes, ANSI inks per span, the
  swatches, the picker dialog;
- the local sshd rig: fs, exec, interactive shell through the seam A4 moved;
- packaging: `linux-unpacked` payload, icon hashes, `.deb` install, AppArmor,
  launch;
- publish: `dist` metadata and the tarball's bytes, not the CLI's word.

**Acceptance:** a second person can run it from the doc alone on a machine that
has never had dshell installed.

### T5 — Fill the zero-coverage packages

In value order: `storage`'s history engine, `ssh`'s argument assembly and
host-key rules, `buffer`'s protocol and feasibility checks, `workspace`'s list
and archive maths, then `mode`'s client-side pure functions. Each entry names
which functions are pure enough to test where they live — several already are
(the splitter, the path rules, the geometry), which is why they were the first
ones tested.

**Acceptance:** per package, the pure surface is covered and each new spec has
been shown to fail when its rule is broken.

## 4. Risks and open items

- **The channel drifts.** An `rc` or a final for 0.1.6 will arrive; this roadmap
  is written to run again with the version strings changed, and A1's dual-range
  step is what makes that second run cheap. Do not delete the old range until the
  new channel is the one we ship.
- **The desktop validator is read, not executed.** §1.2 quotes it from the tag's
  source, and A1 confirmed its two inputs rather than the running app: the name
  it checks (`@deepseek-ai/schemastery` is in the runtime's own
  `desktop-packages.json`) and the rule itself (a runtime-owned name declared as
  a dependency is rejected, unconditionally). What is still unobserved is the
  failure *text* and the ordering with the rest of profile preparation — A5 runs
  the app for that.
- **Best-effort startup removes an alarm.** Our implicit smoke test — "it did not
  boot" — is gone for optional rows. T1's row check and T4's boot assertion are
  the replacements, which is why they are in the first phase rather than the last.
- **Shipping during the alpha**: dshell `0.1.1` is published with exact
  `0.1.5-rc.2` peers. A1's widened ranges are what let a `0.1.2` serve both
  hosts; publishing it before the host moves is optional but keeps the registry
  releasable.
- **Two kinds of stale number in `dshell-roadmap.md`.** The "190 pins" figure in
  Phase 10.4 and "80 specs" in Phase 10.26 were true when written and are not true
  now (211 pins, 147 cases) — they are a phase's record, so they stay as they are;
  read them as history, and take the counts from this document or from the tree.
  The verbatim-duplicated Phase 10.29/10.30 blocks are a different thing: a defect
  worth removing in a documentation pass of its own.
