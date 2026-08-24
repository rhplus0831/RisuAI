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
`background-ready` milestone and temporary `loadedStore` alias are still
published only after chat-critical and optional scheduling have both settled.

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
| Plugin load and runtime synchronization | Accepted plugin projection; providers, UI hooks, output transforms, recovered plugin effects | Coalesced load queue and `stopPluginRuntimeSync()` | `pluginsReady` and `canGenerate`; complete consumer gating and localized retry in 4C |
| Selected character/chat/prompt hydration | Current selection, applied revision, effective prompt owner; transcript and prompt assembly | Request deduplication plus selection/chat/prompt target supersession | `canGenerate` only; prompt and chat failures leave shell/mutation ready |
| Recovered generation effects | Pending durable effect ledger and coherent plugin runtime; output listeners and post-generation effects | Ledger idempotency and retained coordinator retry | Chat-critical after plugins; finish per-chat recovery ordering in 4D |
| Error listeners, warnings, store effects, DOM observer, model discovery, and module refresh | Browser globals and projected settings; their owning notices/interactions | Store effects are disposable; DOM/error listener production cleanup is still missing; model errors are local | Background-only; cleanup, model selection fencing, and import deferral remain in 4B |
| Legacy background normalization and migration notice | Projected compatibility settings/database; background styling and one-time notice | Notice uses per-database deduplication; no explicit lifecycle cleanup | Move out of writer-shell in 4B after compatibility impact is covered |

This slice changes scheduling, not all code-loading boundaries. `bootstrap.ts`
still statically imports push, plugin, recovery, observer, model, and notice
owners, and other immediate consumers may also retain those modules. Each 4B-4D
move must inspect the production bundle graph before claiming a download or
evaluation reduction.

Focused coordinator, bootstrap, prompt-target reactivity, and push tests pass
198 tests at this checkpoint. The focused bootstrap cases hold push unresolved
while `pluginsReady` and `canGenerate` become true, isolate a rejected push from
shell/mutation/chat readiness, preserve prompt failure as a generation-only
status, and reject an older same-chat prompt-owner result.

### 4B. Shell-independent optional work

- [ ] Move push initialization and notification reconciliation after the shell.
  Push failure must not clear shell, writer, or chat readiness.
- [ ] Load the inlay catalog on first inlay use or noncompeting idle prefetch.
- [ ] Start dynamic model discovery after persisted model choices are visible;
  late results must not reset a still-valid selection.
- [ ] Move update checks, nightly/insecure warnings, and nonessential observers
  out of the critical path. Preserve accessibility and required security
  behavior while avoiding a global wait.
- [ ] Give every moved timer, observer, and subscription an idempotent cleanup.

### 4C. Plugin readiness

- [ ] Move `loadPlugins()` and runtime synchronization after shell readiness.
- [ ] Set `pluginsReady` only after the projection and runtime are coherent.
- [ ] Gate plugin providers, UI hooks, and output transforms on `pluginsReady`;
  ordinary non-plugin shell surfaces should remain usable.
- [ ] Preserve accepted plugin projections that arrive before late plugin
  startup. Runtime initialization must merge or acknowledge them instead of
  overwriting them with an older snapshot.
- [ ] Scope plugin load failure to a localized status and retry.

### 4D. Chat-specific readiness

- [ ] Hydrate only the selected character/chat and selected prompt-template
  owner after shell readiness.
- [ ] Show a message skeleton while the selected chat body is loading.
- [ ] Reattach active generation and reconcile recovered generation effects
  before enabling generation for that chat.
- [ ] Derive `canGenerate` from selected detail, chat, prompt owner, plugins, and
  recovery state; do not set it merely because background scheduling began.
- [ ] Supersede late work when route, character, chat, or prompt owner changes.

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
