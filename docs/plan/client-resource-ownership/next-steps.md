# Client Resource Ownership Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [facade, trusted-write, and bridge consumer baseline](phases/slices/phase-0-consumer-facade-and-bridge-inventory/facade-and-bridge-consumer-baseline.md).

1. Inventory production, test, and browser-smoke uses of `getDatabase()`,
   resource snapshots, facade/resource epochs, trusted writes, write-guard
   control, bridge registration/flushing, lifecycle flushing, and temporary
   broad endpoints/rollout aliases.
2. Group each consumer by resource family and classify read, mutation, render,
   hydration, draft, generation, recovery, diagnostic, or test-fixture use.
3. Assign a target owner API and Workstream 1/2 dependency cursor.
4. Add fail-closed gates that reject new aggregate reads, trusted writes, bridge
   families, and broad compatibility seams.
5. Record initial consumer counts and identify Phase 1 API gaps without moving a
   runtime consumer in the same slice.

## Required Scope Before Editing

The slice must name the inventory format, parsing/gate method, baseline update
rule, target-owner fields, test/fixture exception policy, affected-selection
integration, validation commands, and documentation-only/runtime-neutral
behavior contract.

## Likely Starting Anchors

- `src/ts/storage/database.svelte.ts`
- `src/ts/server/resourceState.svelte.ts`
- `src/ts/server/resourceWriteGuard.svelte.ts`
- `src/ts/server/pendingBridgeFlushRegistry.ts` and `bridgeFlush.ts`
- `src/ts/server/*Bridge.svelte.ts`
- `server/fastify/__tests__/phase3CompatibilityStructure.test.ts`
- `server/fastify/src/routeManifest.ts` and resource-read routes

## Not First

- Do not migrate settings, characters, chats, prompts, lorebooks, or scripts in
  the inventory slice.
- Do not remove a bridge, trusted-write path, write guard, or lifecycle flush.
- Do not replace `getDatabase()` with an all-resource owner or generic snapshot.
- Do not widen the shell/bootstrap/resource payload.
- Do not add event deltas.

## Handoff

After Phase 0 acceptance, update [`status.md`](status.md) with exact counts and
dependency holds, refresh [`latest-verification.md`](latest-verification.md),
then open only the Phase 1 owner-API gaps that unblock a released resource
family.
