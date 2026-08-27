# Phase 4: Deferred Runtimes

## Outcome

Move optional and context-specific startup work behind the capability or feature
that needs it. Slow or failed optional endpoints must not delay shell rendering
or mutation readiness, while chat and plugin correctness remains explicit.

This phase starts after [Phase 3](03-startup-capabilities.md) and may run in
parallel with [Phase 5](05-route-driven-hydration.md).

## Runtime inventory

| Runtime or work | Earliest dependency | Failure scope |
| --- | --- | --- |
| Push coordinator and setting reconciliation | Background after shell | Push only |
| Plugin load and runtime synchronization | After shell; before plugin-dependent chat | Plugin-dependent chat/generation |
| Recovered generation effects and reattachment | After shell; before generation | Selected chat/generation |
| Prompt-template owner hydration | After shell; before generation | Prompt owner/generation |
| Selected chat body hydration | After shell selection | Selected chat |
| Inlay catalog | On inlay-capable surface or idle prefetch | Inlay UI |
| Dynamic provider-model discovery | After current model settings render | Model choices only |
| Non-layout DOM observers | After shell | Owning interaction |
| Update checks and startup warnings | Background | Notice/retry only |

The inventory begins in `src/ts/bootstrap.ts`. Follow each import to its owning
module and tests before moving its invocation or import boundary.

## Review slices

### 4A. Classify and schedule work

- [x] Record each current bootstrap side effect, its required inputs, first
  consumer, cleanup function, retry semantics, and capability impact.
- [x] Distinguish code-loading from work scheduling. A deferred call that remains
  statically imported may still keep Phase 1's entry graph large.
- [x] Add a small scheduler or coordinator steps instead of untracked `void`
  calls when completion affects a named capability.
- [x] Keep genuinely background tasks out of the global readiness state.

#### 4A implementation record (2026-08-24)

The retained startup-step coordinator now starts one `background-readiness`
branch immediately after `writer-shell`. Push and optional background setup run
concurrently inside that branch, while plugin, recovery, and selected-chat work
continue on the capability-critical branch. Optional failures settle locally and
cannot enter the writer/plugin/chat retry path. The diagnostic
`background-ready` milestone and, at the Phase 4 checkpoint, the temporary
`loadedStore` alias were published only after chat-critical and optional
scheduling had both settled. Phase 7 later removed the alias in favor of the
coordinator-owned semantic milestone selector.

The first dependency correction also moved selected prompt-template hydration
out of `writer-projection-install`. Prompt readiness now uses the applied
post-replay revision, the active chat's prompt override (falling back to the
selected global prompt owner), a prompt-specific failure code, and a target
signature that fences late results when the owner changes.

| Startup work | Required inputs and first consumer | Cleanup and retry | Capability impact / Phase 4 disposition |
| --- | --- | --- | --- |
| Import-time discard notifier and settings projection hook | Language strings, projected setting keys; durable outbox reporting and visual/push reconciliation | Module-singleton setters; no app-lifecycle disposer | No readiness capability; retain, but do not add heavier imports to these hooks |
| Writer owner adoption, bootstrap/takeover, first-run initialization, outbox preparation, receipt flush, and pending replay | Writer session, epoch, lineage, encrypted outbox; command admission and authoritative hydration | Retained coordinator steps; exact replay retry and ownership fencing | Immutable writer-critical path |
| Full initial resource projection and write guard | Authenticated settings, collections, character summaries, inlay catalog, common revision; root resource database | Bounded coherent-read retry; destructive-refresh fencing | Shell/writer critical until Phase 5 replaces the aggregate; inlay removal belongs to Phase 5B |
| Projection install and visual shell settings | Applied resource revision and selected character; root shell/sidebar | Retained step, hydration generations, command reconciler teardown | Records `observer-ready`; prompt hydration removed from this path |
| Runtime projection services | Generation/job projections, translations, active selection; recovery and chat status consumers | Most owners expose idempotent starts and stops; bootstrap-level ownership remains for 4D | Currently writer-started; move chat/generation services after shell in 4D |
| Server command-event subscription | Applied revision, writer session; resource invalidation, memory jobs, writer takeover | Epoch fencing, unsubscribe, watchdog/reconnect cleanup and retry | Records `writer-ready`; immutable readiness prerequisite |
| Push coordinator and notification reconciliation | Projected notification setting and device-local retry ledger; notification settings UI | Coordinator coalescing and localized storage/cleanup/compensation retry | Background-only; now concurrent with plugin/chat work, with remaining UI/smoke work in 4B |
| Plugin load and runtime synchronization | Accepted plugin projection; providers, UI hooks, output transforms, recovered plugin effects | Coalesced load queue, localized retry, and `stopPluginRuntimeSync()` | `pluginsReady` and `canGenerate`; coherent runtime publication and consumer gating completed in 4C |
| Selected character/chat/prompt hydration | Current selection, applied revision, effective prompt owner; transcript and prompt assembly | Request deduplication plus selection/chat/prompt target supersession | `canGenerate` only; prompt and chat failures leave shell/mutation ready |
| Recovered generation effects | Pending durable effect ledger and coherent plugin runtime; output listeners and post-generation effects | Ledger idempotency and retained coordinator retry | Chat-critical after plugins; finish per-chat recovery ordering in 4D |
| Error listeners, warnings, store effects, DOM observer, model discovery, and module refresh | Browser globals and projected settings; their owning notices/interactions | Bootstrap owns idempotent store, observer, and global-listener disposal; model errors are local | Background-only; moved behind the optional-runtime import boundary in 4B |
| Legacy background normalization and migration notice | Projected compatibility settings/database; background styling and one-time notice | Notice uses per-database deduplication; no persistent lifecycle resource | Moved out of writer-shell and into optional background setup in 4B |

This slice initially changed scheduling rather than every code-loading boundary.
The 4B follow-up moves the push, observer, model, module, compatibility, notice,
and store-effect imports behind background `import()` calls. Plugin and recovery
owners remain static for 4C-4D, and other immediate consumers can still retain a
deferred bootstrap owner in the production closure.

Focused coordinator, bootstrap, prompt-target reactivity, and push tests pass
198 tests at this checkpoint. The focused bootstrap cases hold push unresolved
while `pluginsReady` and `canGenerate` become true, isolate a rejected push from
shell/mutation/chat readiness, preserve prompt failure as a generation-only
status, and reject an older same-chat prompt-owner result.

### 4B. Shell-independent optional work

- [x] Move push initialization and notification reconciliation after the shell.
  Push failure must not clear shell, writer, or chat readiness.
- [x] Load the inlay catalog on first inlay use or noncompeting idle prefetch.
- [x] Start dynamic model discovery after persisted model choices are visible;
  late results must not reset a still-valid selection.
- [x] Move update checks, nightly/insecure warnings, and nonessential observers
  out of the critical path. Preserve accessibility and required security
  behavior while avoiding a global wait.
- [x] Give every moved timer, observer, and subscription an idempotent cleanup.

#### 4B implementation record (2026-08-24)

Bootstrap now requests push initialization/reconciliation and the optional
browser-runtime group only after `writer-shell`; they run concurrently with
plugin/chat readiness.
The optional group owns global error handlers, nightly/insecure-origin warnings,
store effects, the non-layout DOM observer, dynamic model discovery, module
refresh, custom-background normalization, and the legacy-memory notice. The
deployment-level update check remains a no-op and does not schedule startup
work.

`stopDeferredStartupRuntimes()` now owns idempotent app/remount teardown without
being coupled to writer/SSE loss. It disposes store effects, the DOM observer,
global error listeners, plugin synchronization, and the push coordinator. Push
teardown also removes queued settlement subscriptions, clears its transient
timer, and fences late initialization results. The DOM observer can be stopped
and restarted without duplicating listeners.

Dynamic discovery starts only after persisted settings and the shell projection
are visible, and bootstrap awaits catalog settlement only on the background
branch. A controlled late-result test mutates both selected model fields while
the provider request is pending and proves the newer choices survive.

The production report passes both protected boundaries: the initial static
closure is 11 files / 216 modules / 311.23 KiB gzip, and the immediate
`appStartup` closure is 98 files / 1026 modules / 1266.90 KiB gzip. The report
also shows `pushNotificationSetting` and `customBackgroundSetting` remain in the
immediate closure through other consumers, so this checkpoint claims scheduling
and bootstrap-import isolation, not a network-byte reduction.

Phase 5 completed the remaining inlay boundary. Shell startup no longer reads
the inlay catalog; the `/inlay` route requests it through the route manifest on
first use, with route-local status and retry. It may also participate in the
same noncompeting resource-prefetch mechanism without becoming a shell or
mutation readiness dependency.

### 4C. Plugin readiness

- [x] Move `loadPlugins()` and runtime synchronization after shell readiness.
- [x] Set `pluginsReady` only after the projection and runtime are coherent.
- [x] Gate plugin providers, UI hooks, and output transforms on `pluginsReady`;
  ordinary non-plugin shell surfaces should remain usable.
- [x] Preserve accepted plugin projections that arrive before late plugin
  startup. Runtime initialization must merge or acknowledge them instead of
  overwriting them with an older snapshot.
- [x] Scope plugin load failure to a localized status and retry.

#### 4C implementation record (2026-08-25)

Plugin initialization now begins only after `writer-shell`, and its failure no
longer enters the global writer bootstrap retry loop. The shell, routes, and
mutation capability remain available while a fixed localized status banner
offers a plugin-only retry. Initial retry continues through recovered generation
effects and selected-chat readiness without replaying writer bootstrap steps.

The plugin owner publishes an explicit `idle` / `loading` / `ready` / `error`
runtime state. `pluginsReady` is recorded only after the loaded runtime signature
matches the latest accepted plugin projection. If a projection changes while a
load is pending, the queue performs another load before publishing ready state;
an obsolete failed pass likewise yields to a newer accepted projection. A V3
load generation is atomic: if any plugin fails, every instance from that
generation is unloaded so partial providers, frames, menus, or hooks cannot
escape.

Provider dispatch, provider model metadata, tokenizers, prompt and body
interceptors, display-source transforms, output listeners, and plugin UI
surfaces now consult the coherent runtime state. Custom providers and plugin
menus, panels, and floating buttons publish empty or remain hidden while the
runtime is loading or failed, leaving ordinary non-plugin surfaces usable.
Generation readiness also tracks recovered generation effects separately from
plugin initialization, preventing a successful late plugin retry from enabling
generation before recovery settles.

Focused tests cover delayed projection replacement, atomic V3 failure, consumer
gates, localized startup failure, and targeted retry. `pnpm test:affected`
passes 354 frontend files / 5,211 tests, with no affected server tests. The
production bundle report remains inside both protected boundaries: the initial
static closure is 11 files / 216 modules / 311.32 KiB gzip, and the immediate
`appStartup` closure is 97 files / 1,026 modules / 1267.02 KiB gzip. This slice
changes scheduling and coherent publication rather than claiming a plugin code
size reduction; plugin consumers still retain the runtime in the immediate
closure.

### 4D. Chat-specific readiness

- [x] Hydrate only the selected character/chat and selected prompt-template
  owner after shell readiness.
- [x] Show a message skeleton while the selected chat body is loading.
- [x] Reattach active generation and reconcile recovered generation effects
  before enabling generation for that chat.
- [x] Derive `canGenerate` from selected detail, chat, prompt owner, plugins, and
  recovery state; do not set it merely because background scheduling began.
- [x] Supersede late work when route, character, chat, or prompt owner changes.

#### 4D implementation record (completed 2026-08-25)

An unresolved selected-chat body now renders three accessible, message-shaped
placeholder rows inside the transcript column. The composer and surrounding
shell remain mounted and usable, and the existing whole-transcript cover remains
reserved for cold parsing of already-resident message rows. Focused DOM coverage
passes 101 tests; the affected lane passes 4 frontend files / 114 tests with no
affected server tests.

Selected-character and active-chat hydration owners now start in a retained
coordinator step after `writer-ready`, rather than from writer runtime setup.
Plugin loading and durable recovered-effect reconciliation settle before the
selected detail, chat body, and prompt owner can open the reattach barrier. If
the selected chat owns an active durable job, startup waits until its observer
crosses the first scheduling boundary before publishing generation readiness;
the stream itself may continue normally while the existing per-chat activity
guard prevents a second generation.

`pluginsReady` and `canGenerate` now follow the live coherent plugin runtime as
well as their monotonic diagnostic milestone. A same-target full resource refresh
forces selected-chat readiness back through hydration, and a recovered plugin
output effect fails retryably instead of receiving a completion receipt when
plugins are not coherent. Strict recovered-chat hydration failures likewise keep
their pending bootstrap refs for retry. Focused readiness, bootstrap, reattach,
hydration, effect, and generation tests pass. Route kind/path is also part of the
coordinator target, so a route-only transition increments the readiness epoch and
cannot be overwritten by an older hydration result. `pnpm test:affected` passes
330 frontend files / 5,085 tests with no affected server tests. The production
report also remains inside both protected boundaries at 311.34 KiB initial gzip
and 1267.47 KiB for the immediate `appStartup` closure.

## Verification

- Add focused unit tests for every dependency and failure-scope rule.
- Test slow, failed, and retrying plugin, push, inlay, model, prompt, chat, and
  generation-recovery work.
- Verify accepted plugin projections survive late runtime startup.
- Verify a valid model selection survives late discovery results.
- Verify retries/remounts do not duplicate timers, observers, subscriptions, or
  generation effects.
- Add browser-smoke scenarios that delay optional endpoints and assert
  `canRenderShell` and `canMutate` still become ready.
- Run `pnpm test:affected`; run `pnpm build` plus the bundle report when an import
  moves behind a dynamic boundary.

## Exit gate

- Optional endpoint latency cannot delay shell or mutation readiness.
- Chat readiness names its remaining dependency accurately.
- Plugin-dependent behavior waits for `pluginsReady` without overwriting accepted
  state.
- Deferred work has tested cleanup, failure isolation, and retry behavior.

All exit-gate conditions are met. The final inlay first-use boundary and its
browser/network verification are recorded with Phase 5.
