# Client Resource Ownership Plan

Date: 2026-08-31

Status: active. Phases 0 through 2 are complete through `aaf66b75d`; Phase 3
runtime migration is dependency-gated per resource family.

## Goal

Complete the browser's transition from an aggregate mutable `Database`
compatibility view to explicit resource owners and command-backed mutations.

This workstream activates Workstream 3 of the
[Architecture Modernization Roadmap](../../architecture-modernization/PLAN.md).
It deliberately preserves command-event invalidation and authenticated
authoritative reads. Replay-safe event deltas are a separate, inactive
workstream.

[`status.md`](status.md) owns the current consumer and dependency cursors. This
plan does not make the aggregate facade non-authoritative retroactively; current
runtime behavior remains documented by [`STRUCTURE.md`](../../../STRUCTURE.md),
the server-resource guide, and the client-runtime guide until slices land.

## Opening Baseline

- `src/ts/server/resourceState.svelte.ts` composes explicit settings,
  collection, and character projections; selected chat/message, prompt,
  lorebook, and other large bodies already hydrate through narrower owners.
- `src/ts/storage/database.svelte.ts` still exposes the aggregate compatibility
  `Database` facade, and callers still use `getDatabase()` across UI, runtime,
  tests, and adapters.
- `resourceWriteGuard.svelte.ts`, trusted-write scopes, facade/resource epochs,
  and pending bridge flushing support compatibility projection writes.
- Six built-in bridge families remain: settings, character, chat, lorebook,
  prompt template, and script definition.
- The server retains compatibility/broad read seams such as
  `/api/v1/characters/aggregate`, while the temporary observer-shell rollout has
  explicit flag/override aliases.

Phase 0 created the authoritative consumer/facade/bridge inventory and prevents
it from growing through the mandatory architecture gate. Phase 1 now turns the
recorded owner API gaps into narrow, tested foundations.

## End State

- Application code reads explicit resource owners instead of `getDatabase()`.
- UI mutation paths call owner commands and optimistic projection helpers
  directly, with explicit accepted/queued/failed outcomes.
- Bridge watchers, aggregate facade epochs, trusted-write scopes, pending bridge
  flushing, and lifecycle bridge flushing are removed.
- The aggregate compatibility proxy and resource write guard are removed.
- Resource owners are narrow enough that changes do not recreate an aggregate
  database under a different name.
- Temporary broad endpoints and rollout aliases have explicit removal or
  permanent-compatibility decisions and tests.
- Authoritative reads, invalidation, replay/gap recovery, revisions, receipts,
  writer epochs, outbox intent, and single-writer semantics remain intact.

## Invariants

1. A resource family does not migrate until Workstream 1 owns its shared
   contracts and Workstream 2 has closed or explicitly cleared its canonical
   persisted owner.
2. Workstream 2 persisted-owner changes and Workstream 3 bridge removal for the
   same family are serialized.
3. Reads, mutation commands, optimistic projection, drafts, queued intent,
   rollback, error state, hydration, invalidation, and reload move together.
4. No UI reports accepted before the server accepts; queued remains retained
   intent and terminal failure rolls back only the attempted current projection.
5. Resource migration does not widen bootstrap, shell, route, or resource
   payloads and preserves lazy body hydration.
6. Event deltas are out of scope. Unknown, broad, or gap events retain
   invalidation and authoritative-refresh behavior.
7. A bridge remains available until that family's read, mutation, failure,
   rollback, reload, and browser proof passes; the aggregate facade is removed
   last.

## In Scope

- `getDatabase()` and aggregate snapshot/facade-epoch consumers.
- Resource state/read/cache/refresh/invalidation and route/resource manifests.
- Owner selectors, hydration status, commands, optimistic projections, drafts,
  rollback, error state, and focused tests.
- Settings, collection, character, chat/message, prompt, lorebook,
  script-definition, plugin/module, shell, and cross-cutting runtime consumers.
- Write guard, trusted-write API, bridge registry, lifecycle flush, compatibility
  proxy, and temporary endpoint/rollout seams.

## Non-Goals

- Changing persisted ownership before Workstream 2 names the canonical owner.
- Adding patch-bearing command events or replay-safe deltas.
- Redesigning global revision, active-writer, receipt, outbox, SSE, or
  authoritative-read recovery.
- Increasing bootstrap or route payloads to make an owner easier to build.
- Removing a compatibility endpoint required by supported external/interchange
  behavior without an explicit permanent decision.

## Dependency Cursors

| Cursor | Initial value | Meaning |
| --- | --- | --- |
| Opening Fastify code anchor | `c0df82d5240a29a33efa5995e08cc970e0147573` | Code state inspected for plan activation. |
| Workstream 1 Phase 0 gate | `b01e88b03461753afe8f573029ce2e5ab47892ef` | Phase 0 inventory uses the shared mandatory architecture-gate conventions. |
| Workstream 1 contract releases | Per family, not established | Blocks matching owner API/runtime migration. |
| Workstream 2 model owner | Not released | Blocks model compatibility consumer retirement. |
| Workstream 2 prompt owner | Not released | Blocks prompt-template bridge retirement. |
| Workstream 2 translator/smaller owners | Not released | Blocks matching resource-family retirement. |
| Workstream 4 prerequisites | Not released | Event deltas remain inactive and are never required for this plan. |

Exact consumer counts and per-family releases live in [`status.md`](status.md).

## Work Units

One slice covers one resource family or one infrastructure removal after its
consumer count reaches zero. Every slice records:

- exact facade/bridge consumers and target owner API;
- read/hydration/cache state and payload boundaries;
- command mutations, persistence and revision/event effects, outbox behavior,
  optimistic acknowledgement, draft scope, rollback, error, reload, and writer
  loss behavior;
- Workstream 1 and 2 dependency commits;
- browser render/reactivity and generation dependencies;
- allowed files, validation, bridge rollback seam, residual risk, and stopping
  condition.

Do not use a common owner API to smuggle an all-resource snapshot or any-resource
epoch back into normal application code.

## Phase Order

| Phase | Outcome |
| ---: | --- |
| [0. Consumer, facade, and bridge inventory](phases/phase-0-consumer-facade-and-bridge-inventory.md) | Every compatibility consumer has a target owner and the inventory cannot grow. |
| [1. Resource-owner foundation](phases/phase-1-resource-owner-foundation.md) | Later phases have complete owner APIs without facade reach-back. |
| [2. Leaf settings and collection resources](phases/phase-2-leaf-settings-and-collections.md) | Low-fanout stable-id owners lose aggregate consumers first. |
| [3. Character and chat ownership](phases/phase-3-character-and-chat-ownership.md) | Character/chat UI and generation setup use explicit owners. |
| [4. Prompt, lorebook, and script definitions](phases/phase-4-prompt-lorebook-and-script-ownership.md) | High-complexity editor/generation resources use owners end to end. |
| [5. Broad settings and shell ownership](phases/phase-5-broad-settings-and-shell-ownership.md) | Shell/runtime observers no longer depend on aggregate state or epochs. |
| [6. Facade and bridge infrastructure removal](phases/phase-6-facade-and-bridge-removal.md) | Compatibility proxy, guard, trusted writes, and flush infrastructure are gone. |
| [7. Temporary seams, verification, and closeout](phases/phase-7-temporary-seams-verification-and-closeout.md) | Endpoint/rollout decisions, measurements, docs, and archival proof are complete. |

## Rollback

Migrate one resource family at a time. Keep its compatibility bridge and old
reader available until owner-specific read, mutation, queued/failure rollback,
reload, recovery, and browser behavior pass. Roll back by restoring that
family's consumer adapter, not by reverting unrelated owner families. Remove the
facade/guard/flush infrastructure only after the checked-in inventory proves
zero consumer.

## Closeout Criteria

- The checked-in inventory reports no normal application `getDatabase()`,
  aggregate snapshot/epoch, trusted-write, write-guard, or bridge consumer.
- Resource owners are the only browser state API for server-backed application
  data, with narrow reactive and payload boundaries.
- Every resource family passes read, hydrate, command, accepted/queued/failed,
  rollback, writer-loss, event invalidation, authoritative refresh, reload, and
  browser proof.
- Bootstrap/route payloads, startup/hydration time, reactive wakeups, and bundle
  boundaries do not regress beyond recorded budgets.
- Temporary aggregate endpoints and rollout aliases are removed or permanently
  classified with tests.
- Current architecture docs and final exact verification are complete, and the
  intact workstream is ready to archive.
