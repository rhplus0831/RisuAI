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

- [ ] Record each current bootstrap side effect, its required inputs, first
  consumer, cleanup function, retry semantics, and capability impact.
- [ ] Distinguish code-loading from work scheduling. A deferred call that remains
  statically imported may still keep Phase 1's entry graph large.
- [ ] Add a small scheduler or coordinator steps instead of untracked `void`
  calls when completion affects a named capability.
- [ ] Keep genuinely background tasks out of the global readiness state.

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
