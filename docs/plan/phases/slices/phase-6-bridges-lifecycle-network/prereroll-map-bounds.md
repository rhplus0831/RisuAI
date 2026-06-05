# Slice: Prereroll Map Bounds

Phase: [6](../../phase-6-bridges-lifecycle-network.md). Finding: L36.
Runtime change.

## Scope

Bound the module-level pre-reroll response buffers so a page session cannot
retain one full response array per generation forever.

This slice owns `src/ts/process/prereroll.ts` and the narrow caller hooks
needed to clear stale buffers. It does not own the durable server alternates
model, the `rerollNavigation.svelte.ts` swipe-history behavior, or changes to
generation output.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L36.
- `src/ts/process/prereroll.ts`: `rerolls`, `rerollIndex`, `Prereroll`,
  `PreUnreroll`, `addRerolls`.
- `src/ts/process/postGeneration/orchestrateResponse.ts`: `addRerolls`
  callers for streaming and non-streaming multi-candidate output.
- `src/ts/process/rerollNavigation.svelte.ts`: `Prereroll`,
  `PreUnreroll`, `resetRerollOnCharChange`, `clearRerollBuffer`,
  persisted alternates reconciliation.
- Existing reroll behavior suites:
  `src/ts/process/rerollNavigation.test.ts`,
  `src/ts/process/rerollNavigation.guard.test.ts`,
  `src/ts/process/rerollNavigation.rollback.test.ts`.
- New focused helper test home:
  `src/ts/process/prereroll.test.ts`.

## Target Shape

- Replace the plain object maps with a bounded structure, preferably one
  `Map<string, { values: string[]; index: number }>` so values and index evict
  together.
- Use a small cap that comfortably covers active UI use, such as the latest
  32-64 generation ids. Evict least-recently-added or least-recently-used
  entries deterministically.
- Add an explicit clear helper for chat/character boundary resets and call it
  from the same boundaries that clear the visible reroll buffer when appropriate
  (`resetRerollOnCharChange`, send/continue confirmation, or active chat
  switch hooks). Avoid clearing the just-created generation before the user can
  swipe it.
- Preserve navigation semantics:
  `Prereroll` advances, `PreUnreroll` retreats, index underflow returns `null`,
  and missing/evicted generation ids return `null`.
- Ensure `addRerolls` copies or otherwise owns its input array if a caller could
  mutate the original after registration.
- Add direct helper tests for forward/back navigation, cap eviction, and clear
  behavior. Keep existing reroll navigation tests green.
- Register L36 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- The current generation's candidate responses remain available for immediate
  reroll/unreroll navigation.
- Evicting old generation ids is allowed; it must degrade to the existing
  `null` path rather than throwing.
- The visible reroll buffer in `rerollNavigation.svelte.ts` remains the source
  of truth for persisted server alternates after hydration.
- The bound applies to both streaming and non-streaming `addRerolls` callers.

## Done Criteria

- Adding more generation ids than the cap keeps the internal buffer at or below
  the cap and evicts old ids.
- Reroll and unreroll navigation behavior is unchanged for retained ids.
- Active chat/character boundary cleanup removes stale pre-reroll entries
  without breaking immediate post-generation swipe.
- L36 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/process/prereroll.test.ts src/ts/process/rerollNavigation.test.ts src/ts/process/rerollNavigation.guard.test.ts src/ts/process/rerollNavigation.rollback.test.ts
pnpm exec vitest run src/ts/process/__tests__/orchestrateResponse.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
