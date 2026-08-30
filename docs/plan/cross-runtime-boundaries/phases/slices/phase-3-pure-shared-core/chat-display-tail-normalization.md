# Chat Display-Tail Normalization

Status: ready.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core chat-load leaf at `c12e807a5`.

## Objective

Move the browser/Node-neutral chat display-tail default, bounds, and normalizer
into the audited shared-core owner without changing persisted settings or
initial chat rendering.

## Source And Destination

- Source: `src/ts/chatDisplayTailCount.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: Fastify database defaulting and browser database normalization.

## Behavior Contract

- Preserve default `30`, minimum `1`, and maximum `500`.
- Preserve number/string coercion, blank-string defaulting, non-finite fallback,
  integer rounding, and bounds clamping exactly.
- Do not change settings keys, persistence, revisions, events, resource payloads,
  chat-loading windows, or render behavior.

## Validation

Shared-core import audit and typecheck, focused differential fixtures,
storage/defaulting/render owning tests, affected frontend and server lanes,
both typechecks, architecture inventory, formatting, and `git diff --check`.

## Done When

- Both production consumers use the shared subpath.
- The browser-tree implementation is deleted and the cross-runtime edge count
  falls without a new exception.
- Coercion, rounding, clamping, persistence, and rendering tests pass unchanged.

Stop if the helper needs browser reactivity, aggregate state, persistence, or a
host-specific dependency.
