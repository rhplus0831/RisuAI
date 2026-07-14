# Next Steps

Date: 2026-06-02

Read this when choosing the next protocol stability or performance batch. The
best next task should be one coherent runtime delta or one focused proof slice,
not a broad cleanup pass.

## Start Point

- Start with the active risks in [`status.md`](status.md). Use
  [`../../AUDIT.md`](audits/fastify-side-effect-audit.md) as the original risk inventory, not as the
  current status source.
- If a branch already has runtime changes, run or inspect the focused tests
  listed in the relevant slice before selecting new scope.
- Before editing runtime code, write a compact scope in the active slice:
  source files, protocol surface, durable mutation or read path, revision/event
  behavior, rollback or resync behavior, and proof command.

## Current Best Targets

All original numbered-phase implementation slices are implemented, and all four
remaining performance risks now have an implemented opt-in measurement (Phase 2
prompt-construction stages, Phase 3 sprawling-resource fallback and asset-byte
fanout, Phase 5 export materialization). Use
[`active-risk-analysis.md`](active-risk-analysis.md) for the per-risk findings
and [`latest-verification.md`](latest-verification.md) for the most recent
maintained verification.

The next work is **evidence-gated runtime narrowing**, not more measurement
scaffolding. Each runtime slice must be driven by one of these measurements on
representative or real user corpora; the focused fixtures did not justify any
narrowing on their own. Prefer one of these only once real-corpus evidence
names a concrete dominant cost:

1. Phase 2 prompt construction: run the
   [`generation-prompt-construction-pass-measurement.md`](phases/slices/phase-2-command-write-cost/generation-prompt-construction-pass-measurement.md)
   summary on lorebook-heavy, asset-heavy, memory-enabled, or real user corpora;
   a follow-up slice should name the single dominant stage.
2. Phase 3 targeted resource: only after the per-resource full-bootstrap counts
   in
   [`sprawling-resource-full-bootstrap-measurement.md`](phases/slices/phase-3-read-projection-efficiency/sprawling-resource-full-bootstrap-measurement.md)
   show one frequent, expensive resource family — then name its exact field
   projection contract.
3. Phase 3 bulk-byte route: only after the per-id baseline in
   [`asset-byte-fanout-measurement.md`](phases/slices/phase-3-read-projection-efficiency/asset-byte-fanout-measurement.md)
   shows high `repeatedReads` the browser cache does not already absorb.
4. Phase 5 streaming writer: only after the snapshot/encode/output split in
   [`ordinary-risu-export-materialization.md`](phases/slices/phase-5-import-export-asset-memory/ordinary-risu-export-materialization.md)
   shows a large materialized-buffer peak on a real export.
5. Refresh [`latest-verification.md`](latest-verification.md) after the next
   full or focused verification run.

## Not First

- Do not start a full sync-model rewrite; this plan preserves the current
  bootstrap, projection, command, revision, and event model.
- Do not implement server-restart survival for in-flight provider streams
  without a separate durable stream contract.
- Do not add a generic global rate limit as a substitute for route-local
  operational decisions.
- Do not widen plugin, local tool, browser effect, or unsupported generation
  behavior as part of protocol performance work.

## Selection Order

1. Phase 2 prompt-construction measurement on representative data.
2. Measured narrow Phase 3 or Phase 5 work with a candidate slice.
3. Additional route schemas only when touching a stable route envelope.
4. Refresh [`latest-verification.md`](latest-verification.md) after the next
   full or focused verification run.

## Analyzing A Real Database

The static-DB-derivable half of the remaining gates can be gathered offline from
a restored snapshot with `pnpm analyze:db <input>` (`util/analyze-database.ts`).
It loads a real snapshot into a throwaway temp data dir and reports export
materialization (snapshot/encode/output per envelope), the full-bootstrap payload
size, and the asset inventory plus per-character byte-fetch fanout — the cost half
of the Phase 5 and Phase 3 gates.

- Inputs: a `.risu` export (richest single file — re-embeds messages), a server
  `db.json` (message-free; messages live in SQLite), a raw database JSON, or a
  `data/` dir (copied read-only; preserves messages and assets). Add `--json`
  for machine-readable output.
- It cannot reconstruct the runtime half — how often a fallback fires, browser
  cache hit rate, or prompt-assembly stage timings under real sends. Get those by
  running the real server with `RISU_PROTOCOL_METRICS=1` during normal use; the
  `projection_response` / `asset_byte_read` / `risusave_export` lines land in the
  server log.

## Proof Commands

Use the smallest focused command first, then broaden only when the change
touches shared protocol behavior.

- `pnpm api:test -- server/fastify/__tests__/events.test.ts`
- `pnpm api:test -- server/fastify/__tests__/backups.test.ts`
- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm api:test -- server/fastify/__tests__/db.test.ts`
- `pnpm test -- src/lib/Others/projectionGuard.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/backups.test.ts src/ts/server/bootstrap.test.ts`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts`
- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
- `pnpm test -- src/ts/process/request/tests/serverChat.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/routeProtection.test.ts`
- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
