# Slice: Realm Egress Bounds

Phase: [4](../../phase-4-server-lifecycle-and-transport.md). Findings: L17
and L18. Runtime resilience and memory-bound change.

## Scope

Bound Realm import upstream egress and JSON-card asset staging. A single
per-import abort signal should cover client disconnect and a generous
wall-clock deadline across both buffered and progress-SSE route branches, and
JSON-card resource assets should be staged with charx-like byte limits instead
of unbounded in-memory buffers.

This slice owns Realm import fetch/decode/staging bounds only. It does not
change Realm card conversion rules, low-level-access policy, command mutation
semantics, existing charx limits except where a shared helper is extracted, or
Hub proxy route behavior outside Realm import.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L17 and L18.
- `server/fastify/src/routes/realmImport.ts`:
  `registerRealmImportRoutes`, `streamRealmImport`, `runRealmImport`,
  `fetchRealmDynamicPayload`, `writeRealmDownloadToTempFile`,
  `importRealmJsonCard`, `stageFetchedAsset`, `persistStagedFetchedAssets`,
  `saveFetchedAsset`, and `fetchHubResource`.
- `server/fastify/src/requestAbort.ts`: `attachAbort()` shape for client close
  plus deadline cleanup.
- `server/fastify/src/routes/hub.ts`: `createHubAbort()` precedent for
  request/response close and timeout diagnostics.
- `server/fastify/src/realmImport/characterCard.ts`: serial `storeAsset`
  calls and `RealmAssetSource`.
- Existing charx bound constants and tests:
  `MAX_CHARX_ASSET_SIZE_BYTES`, charx disk staging, and
  `server/fastify/__tests__/realmImport.test.ts`.
- Client Realm tests: `src/ts/server/realmImport.test.ts`.
- `docs/plan/active-risk-analysis.md` and
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` for L17/L18 proof
  registration.

## Target Shape

- Create one per-import abort controller in the route handler before choosing
  the progress-SSE or buffered branch.
- The signal should abort when:
  the request closes before fully arriving,
  the response closes before completion, or
  a generous Realm import wall-clock deadline fires.
- Pass the signal through `runRealmImport()` into:
  dynamic Realm download fetches,
  charx response-body staging,
  JSON dynamic body reading,
  JSON-card hub resource fetches, and
  any save/stage helper that still fetches resources.
- Clean up close listeners and timers in a `finally` that runs for both route
  branches.
- Convert aborts into a stable import failure response or SSE error event. Use
  499-style client-close semantics only if the project already has a local
  convention; otherwise keep the current upstream-error style with an explicit
  timeout/client-close message.
- Replace `res.json()` for Realm dynamic JSON with a bounded body reader:
  inspect `content-length` when present, stream with a byte cap when absent,
  cancel/abort once the cap is crossed, then parse JSON from bounded bytes.
- Apply charx-shaped JSON resource staging:
  per fetched asset cap,
  cumulative fetched asset cap,
  temp-file staging instead of retaining every resource `Buffer`,
  cleanup of temp files on success and failure,
  metadata/file commit semantics equivalent to the current
  `persistStagedFetchedAssets()` behavior.
- Data-URI/inline byte assets are already bounded by the parsed dynamic JSON
  body; keep them in that model unless the implementation naturally shares
  staging code.
- Keep legitimate Realm JSON and charx imports byte-identical from the user's
  point of view.
- Register L17 and L18 as `DONE` in the v3 gate and flip only those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- Revision is validated before upstream work, as it is today.
- Both progress-SSE and buffered imports use the same abort and byte-bound
  rules.
- Client disconnect stops upstream fetches and does not continue saving assets
  in the background.
- The wall-clock deadline is generous enough for real Realm imports but bounds
  connected-silent upstreams.
- Oversized JSON dynamic bodies and resource assets are rejected before
  unbounded memory growth.
- Temp files and partially-created persisted assets are cleaned up on failure.
- Existing charx cap behavior and error messages remain stable unless a shared
  helper intentionally centralizes wording.

## Done Criteria

- Closing the client during either Realm import branch aborts the active
  dynamic/resource fetch and stops the import.
- A connected-silent dynamic Realm download or hub resource fetch fails at the
  configured deadline.
- A known-length oversized JSON dynamic body is rejected before reading the
  body.
- An unknown-length oversized JSON dynamic body is aborted once the cap is
  crossed.
- A JSON-card fetched resource over the per-asset cap is rejected without OOM.
- A JSON-card sequence over the cumulative cap is rejected and cleans staged
  files.
- Valid JSON-card and charx imports still succeed.
- L17 and L18 are registered as `DONE` in the v3 gate and active-risk table,
  with no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/hub.test.ts
pnpm exec vitest run src/ts/server/realmImport.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
