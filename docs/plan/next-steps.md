# Next Steps

Date: 2026-06-05

Phase 0 is complete. The next batch is Phase 1.

## Next Batch: Phase 1 (High-Severity Hot Paths)

Three high-severity runtime slices plus one proof refresh, defined in
[`phases/phase-1-high-severity-hot-paths.md`](phases/phase-1-high-severity-hot-paths.md):

1. H2 chat-create targeted writer kit
   ([slice](phases/slices/phase-1-high-severity-hot-paths/chat-create-targeted-writer-kit.md)):
   route chat-create away from whole-corpus reads while preserving output.
2. H3 var-only GUI reload narrowing
   ([slice](phases/slices/phase-1-high-severity-hot-paths/var-only-gui-reload-narrowing.md)):
   stop var-only bumps from remounting/re-parsing every visible message and
   wiping script caches.
3. H1 trigger interpreter budget and abort
   ([slice](phases/slices/phase-1-high-severity-hot-paths/trigger-interpreter-budget-and-abort.md)):
   add abort, wall-clock, loop, and recursion bounds.
4. Phase 1 verification refresh
   ([slice](phases/slices/phase-1-high-severity-hot-paths/phase-1-verification-refresh.md)):
   flip the v2 gate entries for H1-H3 and refresh the proof log.

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
