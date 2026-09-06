# Phase 4 Slice: Server-Backed Fixture Planning Triage

Status: Complete — extraction deferred

## Scope

Evaluate the Phase 3-ranked `sendChat.fixtures.test.ts` and
`sendChat.fixtures.serverBacked.test.ts` owners for a cohesive fixture planner,
normalizer, or reusable Fastify setup boundary that can move meaningful work
out of Happy-DOM without weakening the integration corpus.

The candidate does not pass the Phase 4 selection gate. No production or test
ownership changes are made by this proof batch.

## Evidence And Decision

The 39-case local fixture owner loads a complete fixture database into Svelte
resource state, installs provider behavior, executes the real `sendChat`
lifecycle, records store transitions and side effects, and compares the final
database/provider projection with golden snapshots. Its focused current-source
run passed in 4.24s Vitest duration and 4.94s wall, with 2.47s import, 1.52s
test bodies, 107ms environment, and 1,222,448 KiB peak RSS.

The 27-case server-backed owner builds authenticated Fastify applications over
temporary SQLite state, translates browser `fetch` calls to `app.inject`,
seeds durable resources, and executes prompt assembly, assets, inlays, command
replay, streaming, rollback, cancellation, reattachment, and terminal-consumer
contracts. Its focused current-source run passed in 5.93s Vitest duration and
6.63s wall, with 3.61s import, 2.06s test bodies, 110ms environment, and
938,060 KiB peak RSS.

`loadFixture.ts` and `snapshot.ts` contain deterministic JSON reading and
normalization, but they are test infrastructure rather than a production call
site. They also immediately cross filesystem, Svelte store, resource database,
model-registry, provider-recorder, and Vitest assertion boundaries. Moving
their small record-shaping helpers to Node would add duplicate assertions while
leaving every expensive fixture execution in Happy-DOM. Likewise, the
server-backed harness is already shared within its owning integration file;
turning it into a pure planner cannot remove Fastify, authentication, SQLite,
temporary-directory, or browser-fetch setup.

The candidate therefore lacks both a clear production seam and a plausible
project-level performance mechanism. Extraction is deferred rather than
creating test-only production exports or replacing behavioral coverage with
source/shape tests.

## Retained Contracts And Revisit Condition

Both suites remain Happy-DOM integration owners. The local golden corpus keeps
end-to-end prompt and provider parity; the server-backed corpus keeps the real
browser-to-Fastify command, persistence, replay, rollback, and lifecycle
boundaries.

Revisit only when one of these conditions is demonstrated by a fresh profile:

- a production fixture/import protocol acquires a deterministic parser or
  request planner shared by real application callers and multiple fixture
  cases; or
- two or more suites need the same reusable Fastify scenario harness and
  measured per-case setup dominates enough that shared lifecycle reuse can
  reduce execution while preserving database isolation.

Repeated DOM fixture setup without a pure production seam remains a Phase 5
consolidation concern, not a Phase 4 extraction.

## Validation

- Local fixture owner: 1 file / 39 tests passed.
- Server-backed fixture owner: 1 file / 27 tests passed.
- The source tree, project ownership inventory, and test counts are unchanged.
- No production behavior or coverage contract changed.

