# Phase 9 Client Thinning - 9-5d-ii

Date: 2026-05-26

## Scope

9-2 resource UI tails. This sub-slice audited prompt template/item,
persona, translator preset, and loadout browser writes before the
read-only `DBState.db` guard.

## Landed

- Confirmed the remaining prompt template/item, persona, translator
  preset, and loadout UI/helper writes are optimistic local updates
  followed by the existing 9-2 resource command helpers plus rollback, or
  are intentionally deferred composite apply behavior.
- Tightened the current delete command payload schema for persona and
  translator preset selection handoff: delete routes and typed browser
  helpers now use `selectPersonaId` and `selectPresetId` instead of
  overloading the path resource id names in the request body.
- Kept legacy local mode import/export, asset-byte save paths, and loadout
  apply side effects out of this slice. Loadout apply still remains
  composite/deferred until every touched resource path is command-owned.

## Verification

```bash
pnpm exec vitest run src/ts/server/commands.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commands.test.ts
pnpm check
```

Results:

- `src/ts/server/commands.test.ts` - 35 tests passed.
- `server/fastify/__tests__/commands.test.ts` - 65 tests passed.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.

## Handoff

Continue with **9-5d-iii - 9-3 character/chat UI tails**. Focus on
character profile/assets, chat folders, selected chat/page state,
playground/realm/grid helpers, and legacy import helpers. Do not start
the read-only projection guard until the remaining 9-5d sub-slices are
closed.
