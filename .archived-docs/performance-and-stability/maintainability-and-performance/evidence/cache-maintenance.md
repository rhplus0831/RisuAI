# Cache Maintenance and Delivery Evidence

Finding F04; production base `9690cd25d`, implemented by the accompanying
Phase 2c commit. Disposable fake-indexeddb and real Chromium/Fastify fixtures;
no production data or production latency measurements.

## Ownership and scheduling

Root settings/collections/character summaries and preset/template/lorebook
hydration return after authenticated cache reconstruction and value validation.
They synchronously capture owned JSON for optional persistence and pass the
cache generation captured before their first asynchronous operation. Delayed
persistence cannot store a later edit to the delivered projection.

One FIFO background lane survives invalidation. It admits at most 64 jobs,
32 MiB of serialized value bodies, 8,192 value references, and 1,024 manifests;
keys are limited to 2,048 UTF-16 code units. These limits were chosen before
implementation. The byte budget is a serialized-body measure, not a heap bound;
bounded keys/hash metadata and JavaScript object overhead are additional.
Under pressure optional updates are skipped without changing delivered results.

A non-sliding 50 ms timer queues pruning behind the current burst. Later writes
queue behind that maintenance, so continuous arrivals do not defer it forever.
Before cumulative growth would exceed 32 MiB / 8,192 entries / 1,024 manifests,
the lane prunes first. Every newly opened connection also prunes before its
first write. Retained limits remain 64 MiB / 32,768 entries / 512 manifests,
with a 32 MiB per-value cap. Normal temporary storage is therefore at most
96 MiB / 40,960 entries / 1,536 manifests; maintenance restores retained limits.
A reopened pre-existing cache converges before accepting additional writes.

Clear invalidates synchronously, aborts known transactions, and closes current
connections without waiting for suspended work. Old opens/results/writes/prunes
cannot affect a new generation or reset its connection. Blocked deletion returns
to recovery while cache admission stays disabled until deletion finishes. Writer
changes fence work while retaining persistent rows for authenticated reuse.
Version changes and unexpected close also fence work. A separate pruning epoch
prevents a hashing read from restoring an evicted value to verified memory.

## Measured work

[After counters](cache-maintenance-after.json) use the accepted 0/64/512 unrelated
manifest fixtures. Cold + warm + eight concurrent reads previously ran ten
prunes/thirty full enumerations, returning 30/1,950/15,363 enumeration rows.
With explicit drains between the cold, warm, and burst phases, they now run
4/3/3 prunes, 12/9/9 enumerations, and return 9/585/4,611 rows. The empty-cache
case includes its initial connection prune; seeded cases initialize before
instrumentation. This is not a timing comparison.

The isolated eight-read burst causes exactly one prune/three enumerations at
every size, returning 3/195/1,536 rows. Cold delivery precedes all enumeration;
all six response families also resolve while actual pruning is deliberately
held. Retained manifests/entries converge to 1/65/512. Each of the ten fixed
311-byte responses captures one JSON snapshot: ten captures/3,110 serialized
bytes in total, independent of unrelated cache size. Hashing, cache-hit
materialization, IndexedDB structured cloning, and required transport work are
separate costs and have not been claimed as eliminated.

## Verification

Separate exact focused commands (`pnpm test --` followed by each file):

- `src/ts/server/resourceCache.test.ts`: 37 passed. Suspended open, read,
  verification, write completion, initial/scheduled prune, deletion completion;
  stale errors, version/forced close, quota/unavailable/blocked IndexedDB;
  independent admission caps and continuous entry/byte/manifest pressure.
- `src/ts/server/resourceCacheDelivery.svelte-node.test.ts`: 23 passed. Six
  response families each prove held-prune delivery, clear, and writer fencing;
  five actual root/hydration transport auth-loss paths fence a held response.
- `src/ts/server/resourceCache.workCosts.svelte-node.test.ts`: 3 passed.
- `src/ts/server/resourceReads.svelte-node.test.ts`: 20 passed.
- `src/ts/server/hydrationReads.svelte-node.test.ts`: 13 passed.
- `src/ts/server/activeWriterSession.test.ts`: 11 passed.
- `src/ts/observerProjectionLifecycle.test.ts`: 3 passed.

Negative controls failed as intended, then were reverted: restoring awaited
persistence stalls a validated settings response; omitting the captured
generation repopulates a cleared cache. A newly added actual hydration-401 case
also failed before fixing its missing auth-loss cleanup. Every hydration
transport now shares the same cleanup, matching root resource behavior.

Exact real-browser commands use `RISU_BROWSER_SMOKE_WORKERS=1 pnpm test --`:

- `server/fastify/browser-smoke/startupCachePopulationMatrix.spec.ts`: one passed,
  covering cold/warm small/large populations.
- `server/fastify/browser-smoke/startupRecoveryIntegrationMatrix.spec.ts`: seven
  passed, covering rollout, legacy shell, offline/lost-response replay, event
  gaps, writer takeover, and optional runtime failure/retry. Rerun after the
  hydration auth-loss fix.
- `server/fastify/browser-smoke/visibleStateRecovery.spec.ts`: three passed,
  including sidebar persistence and old-lineage recovery after import.

[Retained browser summaries](cache-recovery-after.json) preserve population
metrics and recovery journeys without request-by-request cache trace duplication.
Browser timings are observational; F04 acceptance is structural/progress-based.
Independent read-only review found the hydration auth-loss gap above and no
other production defect after connection/verification fixes. Current guides,
Prettier, whitespace and documentation checks pass. Final combined aggregate
remains pending until every implementation phase is complete.


## Final Verification Completed

The later [fourth verification ledger](closeout-fourth-verification.json)
records all seven startup-recovery cases rerun after the hydration auth-loss fix
at `e9af657a5`, alongside population, visible-state and locale recovery. The
[final closeout](final-closeout.md) records the subsequent passing aggregate,
unchanged cache bounds and retained costs. The earlier rerun/pending notes above
are chronological, and no cache completion gate remains open.
