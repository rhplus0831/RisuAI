# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [chat display-tail normalization
slice](phases/slices/phase-3-pure-shared-core/chat-display-tail-normalization.md).

1. Move the default/minimum/maximum constants and
   `normalizeChatDisplayTailCount` into an explicit shared-core subpath.
2. Preserve number/string coercion, blank handling, finite-number fallback,
   rounding, and the `1..500` clamp exactly.
3. Migrate the Fastify defaulting path and browser storage normalization to the
   shared owner.
4. Delete `src/ts/chatDisplayTailCount.ts` only after owner and consumer tests
   pass.
5. Keep the persisted setting name, resource payloads, and rendering behavior
   unchanged.

## Foundations Released

- `@risuai/protocol/route-operation` publishes 103 stable route IDs and reviewed
  transport descriptors at `00e49d880`.
- Fastify owns a separate 103-entry auth/writer policy catalog joined by ID.
- `@risuai/protocol/durable-command-operation` publishes 129 stable retained
  command IDs and exact method/path matchers at `3f275e9dc`.
- Durable generation intent kinds point to the shared submit, cancel, and retry
  route IDs without replacing runtime generation UUIDs.
- Browser resource/cache/generation metadata publishes 55 reviewed route
  relations and seven explicit non-overlaps at `6a6d0ac1f`.
- `@risuai/shared-core` and the first duplicated chat-page leaf are released at
  `d798740f7`, with direct historical browser/Fastify oracle proof at
  `d78c67a3a`.
- Chat load-page normalization and all production consumers are released at
  `c12e807a5`.

## Not In This Slice

- Do not move the settings row, resource owner, payload schema, or persistence
  behavior into shared core.
- Do not combine another normalization helper with this leaf.
- Do not accept browser stores, DOM/Svelte, Fastify, filesystem, process-global,
  credential, persistence, or aggregate database dependencies.

## Handoff

After this leaf closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then continue Phase 3 only
with another independently justified neutral leaf.
