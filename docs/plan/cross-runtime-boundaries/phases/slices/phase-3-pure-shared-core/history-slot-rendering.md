# History-Slot Rendering

Status: ready.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core ChatML row parsing at `14f44ed87`.

## Objective

Move dependency-free translator history-slot grammar, collection, rendering,
and token-budget selection into the audited shared-core owner without changing
browser input hooks, translator templates, chat UI, or Fastify raw-message
translation.

## Source And Destination

- Source: `src/ts/translator/historySlots.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: browser translator pipeline, input hooks, and default chat screen;
  Fastify raw-message translation.

## Behavior Contract

- Preserve exact `{{slot::history::N}}` and
  `{{slot::historytrans::N}}` matching, inclusive 1..50 validation, maximum/count
  discovery, and invalid-slot replacement with an empty string.
- Preserve reverse history traversal, disabled/comment filtering, `allBefore`
  cutoff, user-versus-char role mapping, greeting fallback, transform timing,
  chronological output, and exact `role: body\n\n---\n\n` blocks.
- Preserve paired source/translation token accounting, oldest-first eviction,
  non-positive/non-finite fallback to 2048 tokens, per-count caching, async
  count de-duplication, and empty translated bodies for untranslated entries.
- Keep tokenizer implementations and translator/input-hook orchestration in
  their existing runtime owners; shared core accepts only value inputs and
  sync/async token-count callbacks.

## Validation

Shared-core import audit/typecheck; differential fixtures covering grammar,
bounds, filtering, cutoffs, greetings, roles, transforms, source/translation
rendering, budget eviction, caching, and sync/async parity; all five production
consumer owners; both typechecks; architecture inventory; formatting; and
`git diff --check`.

## Done When

- All four production consumers use the shared subpath.
- `src/ts/translator/historySlots.ts` is deleted and the matching Fastify
  runtime/mixed root-`src` edge disappears without a new exception.
- Browser and Fastify translator/history behavior remains byte-for-byte stable.

Stop if the leaf needs browser stores, DOM/Svelte, Fastify, filesystem,
process-global state, credentials, persistence, or an aggregate database.
