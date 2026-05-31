# Bounded Hydration

Status: implemented foundation.

## Source Anchors

- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/server/chatMessageHydration.test.ts`

## Scope

Preserve bounded fanout for `ensureAllChatsHydrated()` and
`ensureAllCharacterLorebooksHydrated()`. The audit confirms the old unbounded
hydration concern is stale; the remaining risk is request count and per-request
server cost, which belongs to Phase 3.

## Done When

- `BULK_HYDRATION_CONCURRENCY` remains a fixed cap.
- Per-id in-flight dedupe and stale-response drops remain in the single-id
  hydration helpers.
- Tests assert concurrency without depending on exact request ordering.

## Validation

- `pnpm test -- src/ts/server/chatMessageHydration.test.ts`
