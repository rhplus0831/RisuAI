# Phase 6: Pre-Writer Observer Shell

## Outcome

Show authenticated, revision-coherent read-only shell data while writer takeover
and pending mutation recovery continue. Promotion to writer mode must replace the
observer projection with an authoritative post-replay view before enabling
writes.

This is a separate rollout, not part of the conservative Phase 3 release.

## Preconditions

- [ ] Phase 2 summary payload and Phase 5 shell resource are small enough to
  justify an early read.
- [ ] Phase 3 guards prove direct and UI-originated writes cannot bypass
  `canMutate` or `canApplyRoutes`.
- [ ] Observer-to-writer event and revision transitions have focused test
  coverage.
- [ ] Read-only controls have a consistent accessible treatment and localized
  status/retry text.
- [ ] The observer feature flag exists and defaults off.

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

- [ ] Add a temporary, documented rollout flag with a default-off production
  value and a deterministic test override.
- [ ] Authenticate and fetch the minimal shell projection without acquiring
  writer ownership.
- [ ] Apply it behind the resource write guard at one coherent revision.
- [ ] Expose observer readiness without enabling route persistence, mutation, or
  generation.
- [ ] Subscribe or establish a safe revision cursor so events between the early
  read and writer promotion cannot be lost.

### 6B. Read-only interaction and local intent

- [ ] Allow navigation that changes only local presentation.
- [ ] When navigation or selection would normally persist, store a replaceable
  local intent instead of dispatching or enqueueing a command.
- [ ] Disable or adapt mutation controls with accessible names, keyboard
  behavior, and an announced read-only status.
- [ ] Keep character shells clearly distinct from details. Fetching optional
  observer detail must not create writer-side effects.
- [ ] Add a direct negative assertion that observer navigation produces no
  command request and no pending mutation record.

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
