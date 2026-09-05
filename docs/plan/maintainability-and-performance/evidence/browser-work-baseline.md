# Browser Work Baseline

Production source: `491cc1820`. [Raw counters](browser-work-before.json).
Node 24.19.0, pnpm 11.23.0, Vitest 5.0.0-rc.3. Structural probes use one
repetition per deterministic fixture and no warmup. F03 runs in the DOM
simulation; F04/F05 use fake-indexeddb. No browser latency is inferred.

| Finding | Small / intermediate / large result | Numeric acceptance before optimization |
| --- | --- | --- |
| F03 | 1,808 / 249,264 / 9,916,585 serialized snapshot bytes; one whole-array clone; 4 / 802 / 32,002 captured messages. Existing narrow folder rollback uses one 5-byte scalar clone throughout. | Fixed folder edit captures zero message bodies and zero unrelated character rows; snapshot at most 1 KiB for these fixed-metadata fixtures. Organization snapshots scale only with affected structure; deleted owners may retain the required rollback row without cloning unrelated histories. |
| F05 | Mutable intent normalization clones: 2 / 16 / 2; processed body bytes 306 / 131,472 / 33,552,434. Frozen bodies: zero clones. Encrypted envelope: one serialization, 244 / 66,205 / 16,776,308 bytes. | At most one normalization clone per mutable request and one body-byte pass; zero for immutable JSON bodies. One encrypted-envelope serialization remains required and separately counted. |
| F04 | Ten reads produce ten prunes/thirty full enumerations; 30 / 1,950 / 15,363 returned rows. Final manifests and entries: 1 / 65 / 512. | Eight-read burst coalesces to at most one prune/three full enumerations; valid delivery resolves while maintenance is suspended. Retention converges to 512 manifests, 32,768 entries, and 64 MiB. Pending writes and temporary growth must have explicit bounds, with eventual maintenance under continuous traffic. |

Fixture dimensions:

- F03: fixed target folder and two target messages; 1/8/32 unrelated characters
  with 2/100/1,000 messages each, 256-byte bodies. The before probe measures the
  legacy snapshot API used by the sidebar. If that API remains for another
  legitimate caller, the after probe must measure the replacement sidebar
  capture and owner tests must prove the live caller cutover.
- F05: one 128-byte request; eight 8,192-byte requests; one near-limit request
  with a body string of the 16 MiB payload cap minus 1,024 bytes. Both mutable
  and recursively frozen bodies round-trip through encrypted staging, with
  caller edits after staging. Transport serialization is zero in this fixture.
- F04: 0/64/512 preseeded manifests with one entry each. Real resource resolution
  exercises a cold read, a warm read, and eight concurrent reads; counters record
  enumeration work at delivery and retention after maintenance.

Reproduce with separate focused invocations:

- `pnpm test -- src/ts/chatCommands.workCosts.dom.test.ts` (3 passed).
- `pnpm test -- src/ts/server/pendingMutationOutbox.workCosts.svelte-node.test.ts`
  (6 passed).
- `pnpm test -- src/ts/server/resourceCache.workCosts.svelte-node.test.ts`
  (3 passed).

Each regenerates its sanitized artifact under the ignored
`fast-bootstrap-results/maintainability/` directory. The tests preserve semantic
outcomes without treating the old inefficient counters as desired behavior.
Dispatcher queued/failed settlement, projection fences, and asynchronous
clear/prune races require the Phase 2 owner suites as well as these probes.
