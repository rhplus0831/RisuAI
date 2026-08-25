# Phase 6: Pre-Writer Observer Shell

## Outcome

Show authenticated, revision-coherent read-only shell data while writer takeover
and pending mutation recovery continue. Promotion to writer mode must replace the
observer projection with an authoritative post-replay view before enabling
writes.

This is a separate rollout, not part of the conservative Phase 3 release.

## Preconditions

- [x] Phase 2 summary payload and Phase 5 shell resource are small enough to
  justify an early read.
- [x] Phase 3 guards prove direct and UI-originated writes cannot bypass
  `canMutate` or `canApplyRoutes`.
- [ ] Observer-to-writer event and revision transitions have focused test
  coverage.
- [x] Read-only controls have a consistent accessible treatment and localized
  status/retry text.
- [x] The observer feature flag exists and defaults off.

## Current seams to reuse

- Read-only runtime bootstrap: `fetchServerBootstrapReadOnly()` in
  `src/ts/server/bootstrap.ts`
- Writer bootstrap and sequencing: `src/ts/bootstrap.ts`
- Writer loss/takeover behavior: `src/ts/server/activeWriterSession.ts`
- Read-only resource and event routes: `server/fastify/src/routeManifest.ts`
- Route/selection persistence: `src/App.svelte`, `src/ts/router.ts`, and
  `src/ts/server/commands.ts`
- Resource guard/recovery: `src/ts/server/resourceWriteGuard.svelte.ts`,
  `src/ts/server/resourceRefresh.ts`, and `src/ts/server/resourceInvalidation.ts`

The read-only bootstrap currently provides runtime metadata, not the complete
shell projection. Phase 5 must define the exact pre-writer shell read rather than
expanding runtime bootstrap implicitly.

## Review slices

### 6A. Flag and observer projection

- [x] Add a temporary, documented rollout flag with a default-off production
  value and a deterministic test override.
- [x] Authenticate and fetch the minimal shell projection without acquiring
  writer ownership.
- [x] Apply it behind the resource write guard at one coherent revision.
- [x] Expose observer readiness without enabling route persistence, mutation, or
  generation.
- [x] Subscribe or establish a safe revision cursor so events between the early
  read and writer promotion cannot be lost.

#### 6A implementation record (2026-08-25)

`VITE_FAST_BOOTSTRAP_OBSERVER=TRUE` enables the temporary observer boundary;
the production default remains off. Unit tests can override the flag directly,
and browser-smoke builds may choose `enabled` or `disabled` through the scoped
`risu:fast-bootstrap-observer-shell` session-storage key. Normal production
builds ignore that storage key.

The flag-on path performs an authenticated read-only bootstrap without caching
its revision as command authority, installs the resource write guard, and
applies the existing coherent shell before writer acquisition begins. The
applied shell revision is retained as the safe cursor; the later post-replay
writer shell and SSE subscription continue to replace it from an equal or newer
revision. A failed or uninitialized observer read falls back to the unchanged
writer-first path. `canRenderShell` may now become true at `observer-ready` only
while the flag is enabled; route application, ordinary mutation, and generation
still require writer readiness.

Verification:

- focused flag, readiness, bootstrap, transport, shell, command, and route DOM
  coverage — 365 tests passed;
- `pnpm test:affected` — 334 frontend files / 5,109 tests passed; no Fastify
  test was selected for the client-only change;
- `pnpm check`, `pnpm check:server`, and `pnpm format:check` — passed;
- `pnpm build:initial-preload` — 11 files, 318,844 gzip bytes total, and a
  283,451-byte largest chunk; all boundary, regression, and milestone gates
  passed;
- `pnpm build:smoke` and the targeted Phase 0 small/large cold/warm browser
  matrix — passed.

### 6B. Read-only interaction and local intent

- [x] Allow navigation that changes only local presentation.
- [x] When navigation or selection would normally persist, store a replaceable
  local intent instead of dispatching or enqueueing a command.
- [x] Disable or adapt mutation controls with accessible names, keyboard
  behavior, and an announced read-only status.
- [x] Keep character shells clearly distinct from details. Fetching optional
  observer detail must not create writer-side effects.
- [x] Add a direct negative assertion that observer navigation produces no
  command request and no pending mutation record.

#### 6B implementation record (2026-08-25)

The pre-writer boundary now renders a dedicated observer view instead of the
ordinary sidebar, chat, settings, or playground controls. It announces its
read-only status, uses native keyboard-accessible buttons for character and
chat navigation, and keeps only the latest observer route in a replaceable
memory-only intent. URL navigation does not apply route-backed stores until
writer capability exists.

Character summaries are labelled separately from hydrated details. An explicit
read-only detail action reuses the fenced character resource read; failure
leaves the summary useful and offers a localized retry. App-level import/drop
handling, mutation-capable overlays, and persistence indicators are gated out
of the observer boundary. DOM coverage directly verifies that character/chat
navigation leaves selection state unchanged, sends no command request, and
creates no durable pending mutation record.

Verification:

- focused observer intent, observer DOM, App capability-boundary, readiness,
  and bootstrap coverage — 198 tests passed;
- `pnpm test:affected` — 359 frontend files / 5,281 tests passed; no Fastify
  test was selected for the client-only change;
- `pnpm check`, `pnpm check:server`, and `pnpm format:check` — passed;
- `pnpm build:initial-preload` — 11 files, 319,501 gzip bytes total, and a
  284,108-byte largest chunk; all boundary, regression, and milestone gates
  passed.

### 6C. Writer recovery and safe promotion

- [ ] Run owner adoption, writer takeover, outbox preparation, receipt
  acknowledgement, and pending replay in their Phase 3 order.
- [ ] Fetch and apply an authoritative post-replay shell projection at the new
  coherent revision.
- [ ] Discard or supersede every observer-era projection that is older than the
  promotion revision.
- [ ] Enable writer readiness only after the refreshed projection, revision
  cursor, event reconciliation, and command guard are installed.
- [ ] Reconcile the latest local route/selection intent once. Avoid a write when
  the authoritative state already matches it.

### 6D. Permanent observer and retry behavior

- [ ] On takeover denial, timeout, or writer loss, retain a useful observer shell
  with explicit status and targeted retry.
- [ ] Retrying takeover must not repeat an accepted mutation, duplicate event
  subscriptions, or replay stale local intent.
- [ ] A later foreign writer event must revoke local mutation/generation
  capability immediately without blanking authenticated observer data.
- [ ] Define when observer detail/cache state is discarded on auth loss,
  database replacement, or lineage change.

## Verification

- Simulate active foreign writer, expired ownership, delayed takeover, explicit
  denial, and writer loss after promotion.
- Inject command events and local pending mutations during observer mode.
- Prove a stale pre-replay projection cannot survive promotion.
- Prove observer route and selection actions cannot enqueue a mutation.
- Cover multi-tab/cross-epoch outbox behavior with the existing active-writer and
  cross-tab test suites.
- Add browser smoke with two pages or contexts sharing the server fixture and
  deterministic takeover controls.
- Add DOM accessibility tests for disabled controls, live status, retry focus,
  and keyboard navigation.
- Run `pnpm smoke:fastify-browser` with the flag both disabled and enabled.

## Rollback

Disabling the observer flag must restore the conservative post-replay shell
boundary without reverting Phase 2 summaries, Phase 3 capabilities, or Phase 5
route hydration.

## Exit gate

- Authenticated read-only content appears before writer recovery in slow
  takeover scenarios.
- Promotion is revision-safe and does not duplicate route/selection mutations.
- A permanently unavailable writer leaves a useful, clearly identified observer
  experience.
- Flag-off behavior remains equivalent to the conservative Phase 3 boundary.
