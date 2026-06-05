# Next Steps

Date: 2026-06-06

Phase 1 H1-H3 are implemented and proof-refreshed. Full `pnpm api:test` is
green after the H2 chat-create ceiling assertion was refreshed to the targeted
`targeted-character-row` path. The next fix batch is Phase 2.

## Next Batch: Phase 2 (Server Corpus-Path Ring 2)

Server corpus-path ring 2 is defined in
[`phases/phase-2-server-corpus-ring-2.md`](phases/phase-2-server-corpus-ring-2.md):

1. M5 character/chat PATCH scoped reads
   ([slice](phases/slices/phase-2-server-corpus-ring-2/character-chat-patch-scoped-reads.md)):
   narrow character/chat PATCH reads and repair to the target row.
2. M6 + L16 projection field-scoped loaders
   ([slice](phases/slices/phase-2-server-corpus-ring-2/projection-field-scoped-loaders.md)):
   load only requested projection tables and avoid duplicate auth checks on
   bulk projection routes.
3. L3 server-intent completion settings loader
   ([slice](phases/slices/phase-2-server-corpus-ring-2/server-intent-completion-settings-loader.md)):
   replace the full-corpus read with a settings-sized completion database.
4. L13 Realm import targeted character append
   ([slice](phases/slices/phase-2-server-corpus-ring-2/realm-import-targeted-character-append.md)):
   append Realm characters through targeted character/chat writers.
5. K1 generation finalization chat-scoped read
   ([slice](phases/slices/phase-2-server-corpus-ring-2/generation-finalization-chat-scoped-read.md)):
   use `chatScopedRead` for generation finalization when no chat variables are
   written.
6. K2 asset-GC scoped reference scan
   ([slice](phases/slices/phase-2-server-corpus-ring-2/asset-gc-scoped-reference-scan.md)):
   remove asset-GC's full persisted corpus read while preserving orphan
   detection.
7. L14 message diff append fast path
   ([slice](phases/slices/phase-2-server-corpus-ring-2/message-diff-append-fast-path.md)):
   avoid O(N) unchanged-prefix stringify work for append persistence.
8. Phase 2 verification refresh
   ([slice](phases/slices/phase-2-server-corpus-ring-2/phase-2-verification-refresh.md)):
   flip the v2 gate entries for Phase 2 IDs and refresh the proof log.

## Guardrails

- Preserve broad loaders/snapshots for true full-corpus consumers. Narrow only
  the hot path under test.
- Route scoped command work through the existing writer/scoped-read kit instead
  of editing `loadPersistedWithMessages` or `applyJsonCommandMutation` as a
  shortcut.
- A narrowed rollback restores only the fields its command mutates.
- M5 chat PATCH must preserve module validation; if `patch.modules` still
  requires a broader read, keep that fallback explicit and tested.
- K1 keeps the broad generation-finalization path when chat variables are
  written; v1-L4 remains gated.
- Do not schedule L12 or the v1 carry-over gates (v1-L4, v1-L7, v1-L26,
  v1-U2) without evidence or owner approval.

## Proof Commands

Use the smallest focused command first. Broaden when a change touches shared
load, projection, guard, or lifecycle behavior. `pnpm api:test -- <file>` does
not filter; use Vitest directly for focused server runs.

Server focused runs:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/projection.test.ts \
  server/fastify/__tests__/assetGc.test.ts
RISU_COMMAND_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commandMetrics.test.ts
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
