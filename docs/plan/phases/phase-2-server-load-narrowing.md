# Phase 2: Server Load Narrowing (Root 1)

Status: COMPLETE — the scoped-assembly-load slice (M1, L1, L2) is DONE
(`c193c008`), the command-mutation-read-narrowing slice (M3, L5, L6) is DONE
(`e0e86ab1`), the single-character-projection slice (M4) is DONE (`254b3112`),
and the projection-metric-and-bulk-read slice (M5, L10, U1) is DONE
(`b2765994`). Addressed the largest server root: hot paths no longer rebuild a
broad in-memory `Database` when they need one row. Depended on Phase 0's
server load-count assertion.

Goal: each hot path loads only the rows it reads. Add scoped assembly loading
and a per-request memo or field-scoped loader. Keep `loadPersisted` and
`loadPersistedWithMessages` for true full-corpus consumers.

Findings: M1, M3, M4, M5, L1, L2, L5, L6, L10, U1.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  M1, M3, M4, M5, L1, L2, L5, L6, L10, U1.
- `server/fastify/src/repository.ts` - `loadPersisted` (:735/:747),
  `loadCharactersFromSqlite` (:288), `loadCollectionsFromSqlite` (:129),
  `getAllAssetMetadata` (:629), `loadStubbedProjectionFields` (:767),
  `loadSingleCharacterRow` (projection.ts:519), `loadPersistedWithMessages` (:855).
- `server/fastify/src/messageStore.ts` - `getAllChatMessagesGrouped` (:451),
  `getChatMessagesGroupedByIds` (:467), `getAllChatHypaV3Grouped` /
  `getChatHypaV3GroupedByIds`.
- `server/fastify/src/commands/mutations.ts` - `applyTargetedCommandMutation`
  (:147) and the message/scriptstate/generation mutate callbacks.
- `server/fastify/src/routes/projection.ts` - the `characterRow` branch
  (:358-385), the bulk-hydration loaders (`loadChatHydrations`,
  `loadCharacterLorebookHydrations`), `emitProjectionMetric` (:555).
- `server/fastify/src/routes/bootstrap.ts` - `maskProviderSecrets` clone (:31-45).
- `server/fastify/src/providerSecrets.ts` - `maskProviderSecrets`,
  `cloneJsonValue` (:247).
- `server/fastify/src/routes/events.ts` - command-event history load (:76).
- `server/fastify/src/prompt/modules.ts` (`getActiveModules`),
  `server/fastify/src/prompt/assemble.ts` (`applyCurrentChatRunVars`).

## Slices

- [`scoped-assembly-load.md`](slices/phase-2-server-load-narrowing/scoped-assembly-load.md) -
  M1, L1, L2 — DONE (`c193c008`). Hydrate only the target chat's
  messages/hypaV3, leave siblings `message=[]`, memoize `getActiveModules`, and
  hoist invariant run-var work.
- [`command-mutation-read-narrowing.md`](slices/phase-2-server-load-narrowing/command-mutation-read-narrowing.md) -
  M3, L5, L6 — DONE (`e0e86ab1`). Parse only the tables a command reads.
  Preserve `normalizeAllCharacterChats` dedup.
- [`single-character-projection.md`](slices/phase-2-server-load-narrowing/single-character-projection.md) -
  M4 — DONE (`254b3112`). `loadSingleCharacterStubRow` does the `WHERE id=?`
  single-row read (precedent `loadCharacterSelectionRows`) and the route masks
  only that row via the new opt-in `maskProviderSecretsInPlace` (bootstrap uses
  it too); broad fallback for embedded/uninitialized states.
- [`projection-metric-and-bulk-read.md`](slices/phase-2-server-load-narrowing/projection-metric-and-bulk-read.md) -
  M5, L10, U1 — DONE (`b2765994`). `emitProtocolMetric` takes a fields thunk
  evaluated after the enabled guard; the SSE route loads command-event history
  only for replay (or with metrics on); the bulk hydration loaders resolve
  known ids + the embedded fallback from the requested rows only.

## Planned Shape

- Scoped loaders already exist (`getChatMessagesGroupedByIds`,
  `loadCharacterSelectionRows`); this phase wires them into hot paths.
- Every non-target chat must still get `message=[]` so downstream `eachChat` /
  memo iteration does not regress; per-chat hypaV3 embedded-fallback semantics are
  preserved.
- Collection narrowing is low risk because mutate callbacks do not read
  collection fields. Character/chat narrowing must preserve global chat/folder
  id dedup.

## Exit Criteria

- [x] M1: prompt assembly hydrates only the active chat's messages/hypaV3; the
      server load-count assertion shows zero `getAllChatMessagesGrouped` calls on
      the assembly path; `loadPersistedWithMessages` is unchanged for its other
      consumers. Assembly output bytes identical. (`c193c008`,
      `serverLoadCostHarness.test.ts`.)
- [x] M3/L5/L6: a message/scriptstate/generation mutation parses only the tables
      it reads (asserted by a load-count test); revision/event/output unchanged;
      `normalizeAllCharacterChats` dedup still holds. (`e0e86ab1`,
      `commandMutationReadNarrowing.test.ts`.)
- [x] M4: `loadSingleCharacterRow` performs a single-row read; the `characterRow`
      projection payload is byte-identical to before (asserted per character on
      the multi-character fixture), bootstrap masks in place with identical
      bytes. (`254b3112`, `serverLoadCostHarness.test.ts` M4 block +
      `providerSecrets.test.ts`.)
- [x] M5: `jsonPayloadBytes` does not run when `RISU_PROTOCOL_METRICS` is off
      (exact +1-serialization accounting on/off); metric output identical when
      on. (`b2765994`, `serverLoadCostHarness.test.ts` M5 tests.)
- [x] L1/L2/L10/U1: each narrows its cited redundant load with no behavior
      change. (L1 + L2 `c193c008` — `modulesMemo.test.ts`, `assemble.test.ts`
      L2 describe; L10 + U1 `b2765994` — `serverLoadCostHarness.test.ts`
      L10/U1 tests: scoped fresh SSE connect with replay/metrics-on controls,
      scoped bulk hydration with single-route payload equivalence and the
      pre-extraction broad fallback.)
- [x] Gates registered in Phase 8; full server suite + audit + TypeScript checks
      green.

## Validation

- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts`
  (M1, L1, L2 stage timings).
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test -- server/fastify/__tests__/commandMetrics.test.ts`
  (M3, L5, L6 mutation read cost).
- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/bootstrap.test.ts`
  (M4, M5, L10, U1; payload identity).
- `pnpm api:test`, `pnpm client-thinning:audit`, both TypeScript checks.
