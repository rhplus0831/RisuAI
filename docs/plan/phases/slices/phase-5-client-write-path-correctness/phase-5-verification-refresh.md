# Slice: Phase 5 Verification Refresh

Phase: [5](../../phase-5-client-write-path-correctness.md). Depends on all
Phase 5 implementation slices. Proof-only slice.

## Scope

Re-run the Phase 5 proof set after unload flushing, rollback suppression,
first-baseline fixes, preset rollback, guard repairs, and error handler
hardening land. Record the refreshed results in
[`../../../latest-verification.md`](../../../latest-verification.md).

This slice should not introduce runtime behavior. It may correct
documentation, gate registration, or active-risk status drift discovered during
verification.

## Anchors

- [`../../phase-5-client-write-path-correctness.md`](../../phase-5-client-write-path-correctness.md):
  Phase 5 exit criteria and validation list.
- `docs/plan/latest-verification.md`.
- `docs/plan/active-risk-analysis.md`: M8, L21, L23, L24, L25, L26, L27,
  L34, L35, L36, and L37 rows.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts`: Phase 5 `DONE`
  registrations and proof text.
- Focused proof suites from the implementation slices:
  bridge unload flush, rollback suppression, prompt-template and lorebook
  first baselines, preset rollback, guard-enabled direct-write repairs,
  send error handling, multisend, script display injection, bootstrap error
  handlers, and alert coercion.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Add a dated Phase 5 run-log entry to `latest-verification.md`.
- Record exact commands run, pass/fail outcomes, and any focused diagnostic
  reruns used to explain failures.
- Confirm the v3 gate has M8, L21, L23, L24, L25, L26, L27, L34, L35, L36,
  and L37 as `DONE` with concrete test paths and test names.
- Confirm `active-risk-analysis.md` matches those statuses and has no
  unrelated Phase 5+ status flips.
- Confirm riding informational items are named in proof text:
  I20 with L34-L36 guard repairs,
  I21 with L37 handler hardening,
  and I11 with L34 IGP coercion.
- Confirm the parent Phase 5 exit criteria can be checked against recorded
  proof:
  unload keepalive flush,
  rollback suppression,
  first baselines,
  preset rollback,
  guard-enabled persistence repairs,
  and null-safe error handling.
- If a proof is skipped or fails, keep that visible in
  `latest-verification.md` and leave the matching parent exit criterion
  incomplete.

## Invariants

- Do not silently replace a failing full command with a narrower focused
  command. Narrow commands may be added as diagnostics, but the full result
  stays recorded.
- Run the client-lib TypeScript build before any strict server check.
- Do not mark an implementation finding `DONE` unless its slice landed with a
  focused regression proof.
- Preserve earlier verification entries; append a new Phase 5 entry.
- Do not edit runtime code in this verification slice.

## Done Criteria

- `latest-verification.md` has a fresh Phase 5 verification entry with command
  outcomes.
- Phase 5 parent exit criteria are satisfied or the remaining gaps are
  explicitly listed.
- The v3 gate and active-risk table agree for M8, L21, L23, L24, L25, L26,
  L27, L34, L35, L36, and L37.
- Focused bridge, storage, process, guard, bootstrap, gate, and TypeScript
  checks are green or failures are documented as blockers.

## Validation

```bash
pnpm exec vitest run \
  src/ts/server/settingsBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/characterBridge.svelte.test.ts \
  src/ts/server/promptTemplateBridge.svelte.test.ts \
  src/ts/server/scriptDefinitionBridge.svelte.test.ts \
  src/ts/storage/database.svelte.test.ts \
  src/ts/storage/database.importPreset.test.ts \
  src/ts/process/__tests__/igp.test.ts \
  src/ts/process/__tests__/sendChatErrors.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/process/scripts.editdisplay.test.ts \
  src/ts/process/__tests__/command.projectionGuard.test.ts \
  src/ts/bootstrap.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
