# Next Steps

Date: 2026-06-05

The plan is open; nothing has started. The next batch is Phase 0.

## Next Batch: Phase 0 (Baseline & Gate)

No runtime change. Six agent-sized slices, defined in
[`phases/phase-0-baseline-and-gate.md`](phases/phase-0-baseline-and-gate.md):

1. v2 gate doc universe parser
   ([slice](phases/slices/phase-0-baseline-and-gate/v2-gate-doc-universe.md)):
   create the v2 sibling gate file and parse the ID universe from
   [`audit-stability-and-performance-v2.md`](audit-stability-and-performance-v2.md)
   plus K1-K4 from [`active-risk-analysis.md`](active-risk-analysis.md) and
   the R1-R13 dismissed set.
2. v2 gate routing registry
   ([slice](phases/slices/phase-0-baseline-and-gate/v2-gate-routing-registry.md)):
   parse [`active-risk-analysis.md`](active-risk-analysis.md), seed scheduled
   IDs as `PLANNED`, and classify L12/I1-I18/R1-R13.
3. v2 gate invariants and self-proof
   ([slice](phases/slices/phase-0-baseline-and-gate/v2-gate-invariants-self-proof.md)):
   add `DONE` test validation, doc/registry drift checks, and negative
   self-proofs. The v1 gate stays untouched against the archive.
4. Render-count harness
   ([slice](phases/slices/phase-0-baseline-and-gate/render-count-harness.md)):
   add the test-only helper that counts `ParseMarkdown`/`risuChatParser` /
   `processScriptFull('editdisplay')` across a simulated `ReloadGUIPointer`
   bump.
5. Render-count baseline
   ([slice](phases/slices/phase-0-baseline-and-gate/render-count-baseline.md)):
   assert the current H3/M17/L40 pre-fix behavior and record the observed
   counts in [`latest-verification.md`](latest-verification.md).
6. Verification refresh
   ([slice](phases/slices/phase-0-baseline-and-gate/verification-refresh.md)):
   re-run the full proof set and record the Phase 0 baseline in
   [`latest-verification.md`](latest-verification.md).

After Phase 0, proceed to Phase 1 (H1, H2, H3) — one slice per finding, in
the order H2 (worst routine-action cost), H3, H1.

## Guardrails

- Do not edit `loadPersistedWithMessages` or `applyJsonCommandMutation` as a
  hot-path shortcut. Route the specific path onto the targeted/scoped kit
  (fork-route writers, `chatScopedRead`), keeping the broad path for its
  genuine consumers.
- A narrowed rollback restores only the fields its command mutates.
- Memoized CBS/template/regex work must keep output bytes identical; M3's
  side-effect-bearing cards ({{setvar}} in card bodies) need explicit
  double-evaluation tests.
- Bounds are additive: L1's deadline rework must never abort an
  actively-streaming generation; M21's cap must not reject valid large-but-
  under-limit imports.
- H3's fix must not regress the v1 H3 stream coalescer or the Phase 7 regex
  memo tests; stop wiping `processScriptCache`/`compiledRegexCache` on
  var-only changes rather than weakening the caches.
- The opt-in subsystem fixes (Phase 7) must not change translation/TTS/MCP
  output for the success path — they bound failure and repeat-work modes.
- Do not schedule L12 or the v1 carry-over gates (v1-L4, v1-L7, v1-L26,
  v1-U2) without evidence or owner approval.

## Proof Commands

Use the smallest focused command first. Broaden when a change touches shared
load, projection, guard, or lifecycle behavior. `pnpm api:test -- <file>` does
not filter; use Vitest directly for focused server runs.

Server focused runs:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/serverLoadCostHarness.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/scripts.test.ts \
  server/fastify/__tests__/lorebook.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts
```

Client focused runs:

```bash
pnpm exec vitest run src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts src/ts/moduleCommands.test.ts
pnpm exec vitest run src/ts/process/__tests__/streamResponse.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGate.test.ts
pnpm exec vitest run src/ts/__tests__/renderCountBaseline.test.ts
```

Full proof set:

```bash
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Optional metric review: `RISU_PROTOCOL_METRICS=1` (stage timings, payload
sizes), `RISU_COMMAND_METRIC_SUMMARY=1` (mutation read cost),
`pnpm analyze:db <input>` (static corpus cost).
