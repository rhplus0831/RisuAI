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
- [x] Observer-to-writer event and revision transitions have focused test
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

- [x] Run owner adoption, writer takeover, outbox preparation, receipt
  acknowledgement, and pending replay in their Phase 3 order.
- [x] Fetch and apply an authoritative post-replay shell projection at the new
  coherent revision.
- [x] Discard or supersede every observer-era projection that is older than the
  promotion revision.
- [x] Enable writer readiness only after the refreshed projection, revision
  cursor, event reconciliation, and command guard are installed.
- [x] Reconcile the latest local route/selection intent once. Avoid a write when
  the authoritative state already matches it.

#### 6C implementation record (2026-08-25)

Promotion retains the Phase 3 order: durable owner adoption, explicit takeover
when required, outbox ownership preparation, receipt acknowledgement, pending
mutation replay, and only then the authoritative shell read. The post-replay
shell replaces observer summaries and optional detail at its coherent revision;
both cached command authority and the applied event cursor are advanced to that
revision before the command reconciler and SSE subscription are installed.
`writer-ready` remains closed until the subscription accepts that cursor.

The root route effect now prefers the latest memory-only observer intent during
the first writer-safe route application. It consumes that exact sequence only
when route preparation and post-route hydration succeed, so a newer or failed
intent remains available. Existing character/chat route guards make promotion
a command no-op when the authoritative selection already matches the intent.

Verification:

- focused bootstrap promotion/order, coherent shell fencing, route no-op,
  intent sequencing, and App DOM coverage — 230 tests passed;
- `pnpm test:affected` — 334 frontend files / 5,109 tests passed; no Fastify
  test was selected for the client-only change;
- `pnpm check`, `pnpm check:server`, and `pnpm format:check` — passed;
- `pnpm build:initial-preload` — 11 files, 319,499 gzip bytes total, and a
  284,108-byte largest chunk; all boundary, regression, and milestone gates
  passed.

### 6D. Permanent observer and retry behavior

- [x] On takeover denial, timeout, or writer loss, retain a useful observer shell
  with explicit status and targeted retry.
- [x] Retrying takeover must not repeat an accepted mutation, duplicate event
  subscriptions, or replay stale local intent.
- [x] A later foreign writer event must revoke local mutation/generation
  capability immediately without blanking authenticated observer data.
- [x] Define when observer detail/cache state is discarded on auth loss,
  database replacement, or lineage change.

#### 6D implementation record (2026-08-25)

The observer shell now has localized live states for waiting, retrying, explicit
takeover denial, writer unavailability, writer loss, offline mode, auth loss,
and successful promotion. Once an authenticated observer projection is ready,
a writer bootstrap failure settles into that useful view instead of entering
the writer-first alert retry loop. A native retry button runs one shared
promotion attempt and restores focus after failure.

Targeted promotion reuses the complete Phase 3 writer sequence and does not
open writer capability until the post-replay projection and event subscription
are installed. Concurrent clicks share the same promise. A failed attempt
re-latches lost-writer transport access and stops its event reconnect,
translation, generation, persistence, and chat-hydration runtimes, leaving the
observer stable for another explicit retry. Existing exact outbox ownership and
receipt semantics prevent already accepted mutations from being replayed, and
the revision-safe observer intent sequence from 6C prevents stale navigation
from being consumed.

A foreign writer event still revokes mutation and generation synchronously,
but flag-on clients now switch back to the authenticated observer shell instead
of blanking it. The discard policy is explicit: authentication loss clears the
route intent, optional hydration state, disposable resource cache, authenticated
resource projection, selection, and command/event revisions. Database
replacement or lineage change clears observer-era intent, optional hydration,
and cache identities while retaining the last authenticated shell until its
authoritative replacement is ready.

Verification:

- focused lifecycle, bootstrap retry, writer-loss, resource auth/replacement,
  observer DOM, readiness, and App DOM coverage — 245 tests passed;
- `pnpm test:affected` — 360 frontend files / 5,302 tests passed; no Fastify
  Vitest file was selected;
- `pnpm check`, `pnpm check:server`, and `pnpm format:check` — passed;
- `pnpm build:initial-preload` — 11 files, 319,936 gzip bytes total, and a
  284,499-byte largest chunk; all boundary, regression, and milestone gates
  passed;
- browser smoke covers the default-off application and a deterministic
  flag-on, two-context denial/promotion/writer-loss path. The new Phase 6 path
  passed, and two unrelated accepted-send timing flakes observed in full-suite
  runs each passed on isolated rerun.

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
