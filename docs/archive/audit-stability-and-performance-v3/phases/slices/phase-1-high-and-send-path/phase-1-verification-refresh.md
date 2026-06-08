# Slice: Phase 1 Verification Refresh

Phase: [1](../../phase-1-high-and-send-path.md). Depends on
[`transport-abort-contract.md`](transport-abort-contract.md),
[`send-append-fast-path.md`](send-append-fast-path.md), and
[`send-rollback-field-scope.md`](send-rollback-field-scope.md). Proof-only
slice.

## Scope

Run the Phase 1 proof set after H1, M4, and M5 land, then record the refreshed
results in [`../../../latest-verification.md`](../../../latest-verification.md).
This slice should not introduce new runtime behavior.

## Anchors

- `docs/plan/latest-verification.md`.
- `docs/plan/active-risk-analysis.md`: H1, M4, and M5 rows.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts`: H1, M4, and M5 `DONE`
  registrations.
- H1 durable cancel tests in `server/fastify/__tests__/generation.chat.test.ts`.
- M4/M5 focused tests and the Phase 0 send clone-count probe.
- TypeScript workflow from `AGENTS.md`.
- Full Phase 1 validation list in
  `docs/plan/phases/phase-1-high-and-send-path.md`.

## Target Shape

- Add a dated Phase 1 run-log entry to `latest-verification.md`.
- Record command outcomes for the v1/v2/v3 gates, focused H1/M4/M5 suites,
  `pnpm api:test`, `pnpm test`, and both TypeScript checks.
- Record before/after clone-count proof for the plain-send fixture:
  transcript clone count, character-row clone count, largest cloned payload,
  fixture message count, and uploaded command shape.
- Record the H1 terminal-frame proof: explicit DELETE cancel, sliding-deadline
  abort, in-loop race, and non-streaming silent-return arm.
- If a command fails or is skipped, keep that visible in the verification log
  with the reason and any narrower diagnostic command that was run afterward.

## Invariants

- Do not change runtime code in this slice.
- Do not mark H1, M4, or M5 complete unless their active-risk rows and v3 gate
  entries already agree on `DONE` with existing test paths.
- Do not silently substitute a focused command for a failed full command.
- Run `pnpm exec tsc -p tsconfig.client-lib.json` before the strict Fastify
  server check.
- Preserve the Phase 0 baseline entry; append a new Phase 1 entry.

## Done Criteria

- `latest-verification.md` has a fresh Phase 1 entry with all requested
  command outcomes and proof numbers.
- Parent Phase 1 exit criteria can be checked against the recorded proof.
- H1, M4, and M5 are the only Phase 1 IDs flipped to `DONE`.
- No Phase 2+ implementation work is included in this proof slice.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec vitest run server/fastify/__tests__/generation.chat.test.ts src/ts/chatCommands.test.ts src/ts/process/__tests__/sendChatContext.test.ts src/ts/characterCommands.test.ts src/ts/__tests__/sendCloneCountProbe.test.ts
pnpm api:test
pnpm test
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
