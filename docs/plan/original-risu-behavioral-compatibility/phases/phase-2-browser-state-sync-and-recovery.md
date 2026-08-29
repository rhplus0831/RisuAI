# Phase 2 — Browser State Synchronization And Recovery

Status: Pending  
Depends on: Phase 1

## Objective

Verify that the Fastify writer/observer and server-authoritative state model
preserves the original logical results across bootstrap, mutation, navigation,
reload, multi-tab observation, loss, replay, and recovery.

## Audit Questions

- Do bootstrap and hydration preserve defaults, legacy shapes, identity,
  ordering, selection, and absent values?
- Do optimistic writes, outbox replay, receipts, invalidations, and replacement
  converge on the same logical state after success, rejection, disconnect, and
  restart?
- Can stale completion, rapid repeated action, writer takeover, or target
  disappearance apply a result to the wrong chat/entity?
- Do observer tabs show timely, ordered outcomes without becoming hidden writers?
- Does reload recover terminal, partially streamed, queued, and failed state
  without duplication or loss?

## Required Outputs

- Inventory of bootstrap/projected resources, writer commands, observer events,
  hydration/replacement rules, and recovery paths.
- Structural ownership gates for resource/event/command vocabularies.
- Deterministic race and fault fixtures for replay, response loss, reconnect,
  restart, target deletion, and cross-chat navigation.
- Built-browser multi-tab/reload journeys for user-visible outcomes.
- Findings and signed decisions for deliberate server-authoritative differences.

## Exit Criteria

- Every in-scope state path converges or has a signed visible divergence.
- No success/failure can silently lose, duplicate, mis-target, or resurrect
  durable logical state.
- Observer/writer boundaries and unsupported multi-writer behavior are explicit.
- Focused state, browser recovery, current compatibility, and required full
  differential evidence pass.

## Validation

Run owning browser-state and server integration lanes, controlled fault tests,
built-browser reload/multi-tab smoke, compatibility lanes selected by Phase 1,
formatting, and `git diff --check`.
