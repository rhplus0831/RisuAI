# Phase 6 Completion Audit

Date: 2026-06-05

Scope: Phase 6 memory and Lua workstream: M7, L16, L17, L18, L19, L21, and
Phase 8 gate registration.

## Verdict

Closed. Phase 6 is complete.

The original audit found one blocking gap in L21. The Lua engine pool avoided
background refills while a run was active, but a foreground acquire could still
fresh-boot an engine while another run had a pending Lua continuation. That
contradicted the documented wasmoon safety rule and had no regression test.

## Closeout

Implemented on 2026-06-05:

- All engine boots now share `luaEngineBootGate`.
- `acquirePreparedEngine` loops until it can use a pooled default engine or
  wait for active Lua runs to drain before fresh booting.
- Active-run accounting moved into acquire, so there is no idle window between
  engine claim and run start.
- `runServerLua` wakes parked booters before idle refill.

Regression:

- `luaRuntime.test.ts`: a fresh boot never overlaps an active run with a pending
  Lua continuation. The test fails against the pre-fix runtime at the
  boot-overlap assertion.
- The Phase 8 L21 gate entry names this proof via `extraTests`.

## Satisfied Items

- M7: memory workers drain at most `MEMORY_JOB_BATCH_MAX_JOBS` (32) jobs per
  tick. `voyageContext3` contextual requests split by approximate token size
  and commit sub-batches independently.
- L16: orphan cleanup skips summary parsing and `BEGIN IMMEDIATE` when there is
  nothing to delete.
- L17: memory job claims rotate across pending chats instead of draining one
  chat's backlog indefinitely.
- L18: embed/summarize handlers use `loadPersistedDatabaseForMemoryJob`, which
  loads settings, `hypa_v3_presets`, and id-only character/chat stubs.
- L19: one Lua execution budget is shared across assembly trigger/edit phases.
- L21: default-limit Lua runs use prepared pooled engines; each engine still
  serves exactly one call and is closed after use.
- Phase 8: M7, L16, L17, L18, L19, and L21 are registered as `DONE`.

## Coverage Notes

- M7 gate coverage names embed-handler proofs. The implementation also caps
  summarize draining.
- L16 is proven at the repository function. Assembly calls the cleanup only when
  current chat memos are present.
- L19 tests cover the runtime and trigger loop directly rather than a full
  assembly plus post-generation sequence.
- The gate checks that registered files and test-name strings exist. It does
  not prove assertion semantics by itself.

## Validation

Focused audit run:

- Memory tests: 4 files, 64 passed.
- `luaRuntime.test.ts`: 1 file, 27 passed.
- `fixCompletenessGate.test.ts`: 1 file, 8 passed.
- Both TypeScript checks: zero errors.

Closeout run:

- `luaRuntime.test.ts`: 1 file, 28 passed.
- Pre-fix negative check: failed at the expected boot-overlap assertion.
- `fixCompletenessGate.test.ts`: 1 file, 8 passed.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
