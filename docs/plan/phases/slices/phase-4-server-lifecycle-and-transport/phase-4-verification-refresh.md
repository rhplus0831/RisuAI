# Slice: Phase 4 Verification Refresh

Phase: [4](../../phase-4-server-lifecycle-and-transport.md). Depends on all
Phase 4 implementation slices. Proof-only slice.

## Scope

Re-run the Phase 4 proof set after the lifecycle, deadline, cancel, Realm
bounds, Horde cleanup, compression, and static caching slices land, then record
the refreshed results in
[`../../../latest-verification.md`](../../../latest-verification.md).

This slice should not introduce runtime behavior. It may correct documentation
or gate status drift discovered during verification.

## Anchors

- [`../../phase-4-server-lifecycle-and-transport.md`](../../phase-4-server-lifecycle-and-transport.md):
  Phase 4 exit criteria and validation list.
- `docs/plan/latest-verification.md`.
- `docs/plan/active-risk-analysis.md`: M9, L2, L4, L5, L17, L18, L19, L20,
  and L56 rows.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts`: Phase 4 `DONE`
  registrations.
- Focused proof suites from the implementation slices:
  lifecycle shutdown, request abort/deadline, completion streaming, proxy
  stream jobs, client proxy cancel, Realm import bounds, Horde cleanup,
  bootstrap compression, and static caching.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Add a dated Phase 4 run-log entry to `latest-verification.md`.
- Record exact commands run, pass/fail outcomes, and any focused diagnostic
  reruns used to explain failures.
- Confirm the v3 gate has M9, L2, L4, L5, L17, L18, L19, L20, and L56 as
  `DONE` with concrete test paths/names.
- Confirm `active-risk-analysis.md` matches those statuses and has no
  unrelated Phase 4+ status flips.
- Confirm the parent Phase 4 exit criteria can be checked against recorded
  proof:
  SIGTERM/SIGINT close,
  sliding active streams,
  idle stream abort,
  proxy cancel DELETE,
  Realm disconnect/deadline/byte caps,
  bounded Horde DELETE,
  gzip negotiation,
  immutable chunk caching, and
  uncached HTML.
- If a proof is skipped or fails, keep that visible in
  `latest-verification.md` and leave the matching parent exit criterion
  incomplete.

## Invariants

- Do not silently replace a failing full command with a narrower focused
  command. Narrow commands may be added as diagnostics, but the full result
  stays recorded.
- Run the client-lib TypeScript build before the strict Fastify server check.
- Do not mark an implementation finding `DONE` unless its slice landed with a
  focused regression proof.
- Preserve earlier phase verification entries; append a new Phase 4 entry.
- Do not edit runtime code in this verification slice.

## Done Criteria

- `latest-verification.md` has a fresh Phase 4 verification entry with command
  outcomes.
- Phase 4 parent exit criteria are satisfied or the remaining gaps are
  explicitly listed.
- The v3 gate and active-risk table agree for M9, L2, L4, L5, L17, L18, L19,
  L20, and L56.
- Focused suites, API tests, gate tests, and TypeScript checks are green or
  failures are documented as blockers.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/index.test.ts \
  server/fastify/__tests__/generation.completion.test.ts \
  server/fastify/__tests__/requestAbort.test.ts \
  server/fastify/__tests__/streamJobs.test.ts \
  server/fastify/__tests__/streamJobsRoutes.test.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/hub.test.ts \
  server/fastify/__tests__/horde.test.ts \
  server/fastify/__tests__/bootstrap.test.ts \
  server/fastify/__tests__/static.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run \
  src/ts/globalApi.proxy.test.ts \
  src/ts/network/proxyJobWs.test.ts \
  src/ts/server/realmImport.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm api:test
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
