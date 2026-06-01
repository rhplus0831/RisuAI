# Next Steps

Date: 2026-06-01

Read this when choosing the next protocol stability or performance batch. The
best next task should be one coherent runtime delta or one focused proof slice,
not a broad cleanup pass.

## Start Point

- Start with the active risks in [`status.md`](status.md). Use
  [`../AUDIT.md`](../AUDIT.md) as the original risk inventory, not as the
  current status source.
- If a branch already has runtime changes, run or inspect the focused tests
  listed in the relevant slice before selecting new scope.
- Before editing runtime code, write a compact scope in the active slice:
  source files, protocol surface, durable mutation or read path, revision/event
  behavior, rollback or resync behavior, and proof command.

## Current Best Targets

Phase 1 is implemented. Phase 2 narrowed the measured hot command families:
settings/chat/plugin-storage commands use message-free mutation, and message
history plus `generation.persisted` use targeted SQLite paths. Phase 3 has
targeted projection, asset metadata indexing, and bulk all-chat hydration.
Phase 4 runtime resilience is implemented; only the shared SSE taxonomy check
remains as a future verification slice. Phase 5 has completed revision/event
atomicity, expanded import limits, bundle export streaming, per-generation asset
caching, and asset rollback hardening. Phase 6 is implemented: settings
coalesce and skip no-op writes, memory job refresh is SSE-driven, and projection
applies advance a watcher epoch so settings, chat, and script-definition
watchers do not echo server-origin updates. Phase 7 now has route-local rate
limits, wildcard manifest coverage, read-only writer-header hygiene, and
HEAD/body-parser safeguards. The initial hot-envelope schema slice is also
implemented for stable read-only POST envelopes. Phase 8 has started with
bootstrap and targeted projection payload metric/readout guards, plus an
all-chat hydration request-count guard and command metric review gates.

Prefer one of these next:

1. Measure and scope remaining generation/prompt-assembly whole-corpus passes
   only if a narrow side-effect batch can name source files, durable mutation
   behavior, event behavior, rollback behavior, and proof command.
2. Add optional bulk lorebook read reduction only if `enableLorebookStubs`
   workflows become active:
   [`bulk-chat-lorebook-reads.md`](phases/slices/phase-3-read-projection-efficiency/bulk-chat-lorebook-reads.md).
3. Continue Phase 8 verification budgets when prioritizing maintained protocol
   guardrails; the latest verification log remains:
   [`phase-8-verification-budgets.md`](phases/phase-8-verification-budgets.md).
4. Add the Phase 4 SSE taxonomy fixture only when touching chat stream event
   names or payload shapes:
   [`sse-taxonomy-alignment.md`](phases/slices/phase-4-stream-generation-resilience/sse-taxonomy-alignment.md).

The command-family evidence lives in
[`command-family-measurement.md`](phases/slices/phase-2-command-write-cost/command-family-measurement.md).
The implemented Phase 2 migrations are:
[`scoped-settings-mutation-path.md`](phases/slices/phase-2-command-write-cost/scoped-settings-mutation-path.md),
[`scoped-plugin-storage-mutation-path.md`](phases/slices/phase-2-command-write-cost/scoped-plugin-storage-mutation-path.md),
the `chat.updated`, `message.appended`, and message edit/delete/truncate/replace
batches in
[`message-chat-targeted-persistence.md`](phases/slices/phase-2-command-write-cost/message-chat-targeted-persistence.md),
and
[`generation-persistence-narrow-path.md`](phases/slices/phase-2-command-write-cost/generation-persistence-narrow-path.md).

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

1. Narrow generation/prompt side-effect work in Phase 2 only when a measured
   slice is available.
2. Optional Phase 3 lorebook bulk reads or full-resync budgets if measurement
   makes them active.
3. Remaining Phase 8 latest-check recording.
4. SSE taxonomy verification when chat stream vocabulary changes.
5. Additional route schemas only when touching a stable route envelope.

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
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
