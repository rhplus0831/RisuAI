# Next Steps

Date: 2026-06-03

Read this when choosing the next batch. Prefer one narrow write path or one proof
batch. Avoid broad cleanup passes.

## Start Point

- Start with the per-tier findings in
  [`active-risk-analysis.md`](active-risk-analysis.md) and the route table in
  [`mutation-range-mismatch.md`](mutation-range-mismatch.md).
- Before editing runtime code, add a compact scope to the active slice: route
  names, target SQLite tables, settings co-write condition, revision/event
  behavior, normalization-drop decision, and proof command.
- The Phase 0 writer kit, the `TARGETED_MUTATION_PATHS` vehicles, and the
  review-gate template (`__tests__/helpers/commandMetricGates.ts` /
  `rowStability.ts`) all exist now; a Tier write slice imports them rather than
  rebuilding them. The floor sweep (Phase 1) is the only tier that needs no Phase
  0 helper.

## Current Best Targets

Phases 0-4 (the write-side tiers), Phase 5 (projection-range narrowing, all four
slices), and Phase 6 (the Tier-5 message-free ceiling, floors verified) are
implemented. All Tier-5 routes now sit at their proven safe floor; the deepest
narrowing per route is deferred behind a recorded unblock prerequisite.
Recommended order from here:

1. Phase 7 verification budgets — the written-table-set, rowid-stability, and
   `dbJsonWriteMs: 0` gates plus the verification log.
2. (Optional, gated) the deferred Tier-5 unblock prerequisites, each of which
   must land before the route it gates can narrow below the floor:
   - wire `deleteChatMessages`/`deleteChatHypaV3` into `DELETE chats/:id` (then
     `DELETE characters/:id` over its chat ids) so the deletes can drop to a
     scoped `message-free` write without leaking orphan message rows;
   - scope `normalizeScriptDefinitionDatabase` + `ensureCharacterCollection`
     (and the `modules` create's `ensure*` repairs) to validate-only on siblings
     so the character script/trigger PUTs and the creates can become single-row
     / append-only writes.

## Not First

- Do not narrow any Tier write before the Phase 0 writer kit and review gates
  exist; a narrow path without a rowid-stability test cannot prove it stopped
  rewriting unrelated rows.
- Do not narrow a Tier-5 route below the `message-free` floor before its
  normalization pass or message dependency is scoped; that is Phase 6's explicit
  blocker.
- Do not drop a global normalization repair without recording it as an accepted
  validate-only decision (Prerequisite 2) in the slice.
- Do not narrow a projection resource without first narrowing the write it
  serves, or you leave the refresh shipping fields the write no longer changes.

## Selection Order

1. Phase 0 baseline metric + gates and writer kit + targeted paths — done.
2. Phase 1 floor — done (`208e538a`).
3. Phase 2 settings + plugin storage — done (`56ddd865`).
4. Phase 3 single character/chat-row paths — done (`07971179`→`65e57c0a`).
5. Phase 4 collection families — all eight done (plugins, presets, prompt-items,
   personas, translator-presets, loadouts, lorebooks, modules), with the
   `promptItem`/`persona`/`loadout` projection co-fixes inline.
6. Phase 5 projection-range narrowing — done (`314af90f`, `f94e51ab`,
   `c3fff925`, `608de26c`): the `prompt` field-bug fallback, the module +
   script/trigger resources, the `globalLorebook`/`characterLorebook` lorebook
   split, and the `generation-chat` + `characterRow` per-row branches.
7. Phase 6 Tier-5 message-free ceiling — done (floors verified): all nine routes
   held at their safe floor with blockers + unblock conditions recorded, proven by
   `commandMessageFreeCeiling.test.ts`; the `DELETE chats/:id` floor was corrected
   to `hydrated`.
8. Phase 7 verification budgets — next.
9. Refresh [`latest-verification.md`](latest-verification.md) after each tier's
   focused and full run.

## Proof Commands

Use the smallest focused command first, then broaden only when the change
touches shared protocol behavior.

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commandMetrics.test.ts`
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandMessageFreeCeiling.test.ts`
- `pnpm api:test -- server/fastify/__tests__/projection.test.ts`
- `pnpm api:test -- server/fastify/__tests__/db.test.ts`
- `pnpm test -- src/lib/Others/projectionGuard.test.ts`
- `pnpm test -- src/ts/server/projection.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
- `pnpm test`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
