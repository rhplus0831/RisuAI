# Slice: Phase 8 Verification Refresh

Phase: [8](../../phase-8-client-interpreters-plugins-media.md). Depends on
all Phase 8 implementation slices. Proof-only slice.

## Scope

Re-run the Phase 8 proof set after client interpreter budgets,
tokenizer/cache caps, translator subsystem hygiene, plugin lifecycle, MCP
lifecycle/caps, file-attach await, and media lifecycle/log fixes land. Record
the refreshed results in
[`../../../latest-verification.md`](../../../latest-verification.md).

This slice should not introduce runtime behavior. It may correct
documentation, gate registration, or active-risk status drift discovered during
verification.

## Anchors

- [`../../phase-8-client-interpreters-plugins-media.md`](../../phase-8-client-interpreters-plugins-media.md):
  Phase 8 exit criteria and validation list.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md):
  M7, L38-L55, K4, and any riding notes for I16/I17.
- [`../../../v4-integration-brief.md`](../../../v4-integration-brief.md):
  Phase 8 routing for v4-L24 through v4-L29, v4-L31, and v4-L35 through
  v4-L37; Phase 5 routing for
  v4-L30; and the explicit non-Phase-8 boundary for v4-L38 unless an
  auth-storage owner accepts it separately.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts`: Phase 8 `DONE`
  registrations and proof text.
- Focused proof suites from the implementation slices:
  client trigger and Lua budget tests, tokenizer cache tests, translator
  remount/cache/fanout tests, plugin lifecycle tests, MCP lifecycle/cap tests,
  file-attach async tests, and media teardown/log/abort tests.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Add a dated Phase 8 run-log entry to `latest-verification.md`.
- Record exact commands run, pass/fail outcomes, and any focused diagnostic
  reruns used to explain failures.
- Confirm the v3 gate has M7, L38, L39, L40, L41, L42, L43, L44, L45, L46,
  L47, L48, L49, L50, L51, L52, L53, L54, L55, and K4 as `DONE` with concrete
  test paths and test names.
- Confirm `active-risk-analysis.md` matches those statuses and has no
  unrelated status flips.
- If I16 or I17 landed as riding items, make sure proof text names the
  coverage and the active-risk table keeps the established informational-item
  convention.
- Record v4 amendment proof without inventing v3 status rows: translator
  remount memo/call-count coverage for v4-L24 through v4-L29, abortable imggen
  post-generation coverage for v4-L31 if included, filesystem MCP cap coverage
  for v4-L35, inlay decode cap coverage for v4-L36, and plugin listener/
  observer cleanup coverage for v4-L37.
- Confirm v4-L30 remains Phase 5-owned and v4-L38 remains out of Phase 8
  unless a separate auth-storage measure/defer owner is recorded.
- Confirm the parent Phase 8 exit criteria can be checked against recorded
  proof:
  bounded manual triggers and Lua, bounded Lua/cache access-key state,
  bounded translator cache/memo/fanout behavior, plugin listener/provider
  cleanup, gated logs, MCP lazy/deduped/bounded behavior, deterministic
  file-attach content, media teardown, abortable imggen post-generation when
  included, and corrupt image settling.
- Confirm the Phase 8 inventory notes classify every added translator/MCP/
  media/plugin cache, listener, timer, blob URL, audio context, and debug log
  as fixed, no-actioned with reason, or measured/deferred with an owner.
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
- Do not mark any v4 amendment as a v3 `DONE` row. V4 coverage belongs in
  proof text unless a matching v3 scheduled row already exists.
- Preserve earlier verification entries; append a new Phase 8 entry.
- Do not edit runtime code in this verification slice.

## Done Criteria

- `latest-verification.md` has a fresh Phase 8 verification entry with
  command outcomes.
- Phase 8 parent exit criteria are satisfied or the remaining gaps are
  explicitly listed.
- The v3 gate and active-risk table agree for M7, L38-L55, and K4.
- V4 amendment proof is recorded for v4-L24 through v4-L29, v4-L31, and
  v4-L35 through v4-L37 where included;
  v4-L30 is called out as Phase 5-owned and v4-L38 is either out of scope or
  measure/defer-owned by an explicit auth-storage note.
- Inventory/allowlist notes exist for the added translator/MCP/media/plugin
  cache/listener/timer/blob/audio/debug-log sites.
- Focused client interpreter, tokenizer, plugin, MCP, file, media, gate, full
  test, audit, and TypeScript checks are green or failures are documented as
  blockers.

## Validation

```bash
pnpm exec vitest run \
  src/ts/process/mcp/mcplib.test.ts \
  src/ts/process/mcp/mcp.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/translator/translator.html.test.ts \
  src/ts/translator/translator.cache.test.ts \
  src/ts/process/postGeneration/runStage4.test.ts \
  src/ts/process/stableDiff.test.ts \
  src/ts/process/tts.test.ts \
  src/ts/process/processzip.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
