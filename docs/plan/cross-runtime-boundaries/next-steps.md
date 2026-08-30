# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [shared-core foundation and first leaf
slice](phases/slices/phase-3-pure-shared-core/shared-core-foundation-and-first-leaf.md).

1. Inventory low-fanout duplicated helpers with production consumers in both
   browser and Fastify runtimes.
2. Reject candidates coupled to frameworks, hosts, credentials, persistence,
   aggregate database state, or process globals.
3. Establish a minimal independently audited shared-core package.
4. Move one proven-neutral leaf and delete both local duplicates only after
   differential fixtures pass.
5. Preserve every existing result, error, ordering, and edge-case behavior.

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

## Not In This Slice

- Do not move schemas out of protocol or server/browser policy into shared core.
- Do not begin with prompt, parser, provider, translator, or generation
  orchestrators.
- Do not accept browser stores, DOM/Svelte, Fastify, filesystem, process-global,
  credential, persistence, or aggregate database dependencies.

## Handoff

After the first leaf closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then continue Phase 3 with
the next smallest independently justified leaf.
