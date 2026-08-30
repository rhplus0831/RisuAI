# Phase 5: Browser Adapter Migration

Status: complete at `18031f9c3`.

Depends on: matching Phase 1/2 contracts and stable Fastify consumers.

## Objective

Adopt shared operation and wire contracts in browser adapters while retaining
browser-specific validation errors, reactivity, recovery, and user feedback.

## Required Work

- Move adapters to explicit `@risuai/protocol` subpaths and operation ids.
- Remove duplicate request/response validators only after parity is proven.
- Generate small typed adapters only when generation reduces drift without
  hiding boundary-specific error handling.
- Keep cache, hydration, outbox, writer-loss, optimistic, queued, failed, and
  authoritative-refresh behavior explicit in browser owners.
- Update route/resource manifests and tests through the shared catalog path.

## Safety Contract

No adapter migration may report queued intent as accepted, weaken validation,
drop recovery fallback, change cache scope, or use client metadata as security
authority.

## Exit Criteria

- Route additions and contract changes have one documented update path.
- Client-specific recovery and UI behavior remains visible at the adapter layer.
- Migrated browser consumers have no duplicate wire taxonomy or validator.

## Validation

Focused adapter/resource/outbox tests, protocol and route-catalog gates,
affected frontend tests, browser smoke for startup/recovery/generation contracts,
both typechecks, formatting, and diff checks.
