# Slice: Character Row HypaV3 Carry-Over

Phase: [6](../../phase-6-bridges-lifecycle-network.md). Finding: L35.
Runtime change.

## Scope

Preserve hydrated per-chat `hypaV3Data` when a foreign character-row projection
refresh ships message-free chat stubs, even when the hydrated chat currently
has zero live messages.

This slice does not own memory selection, memory worker persistence, chat
message hydration, or broad character-row merge behavior.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L35.
- `src/ts/storage/database.svelte.ts`: `mergeServerProjectionCharacterRow`,
  existing carry-over of `message`, `hypaV3Data`, and resident `globalLore`.
- `src/ts/bootstrap.ts`: foreign `character-row` event apply path.
- `src/ts/server/chatMessageHydration.svelte.ts`: active chat hydration and
  `hypaV3Data` seeding context.
- New focused test home:
  `src/ts/storage/database.svelte.test.ts`.

## Target Shape

- In `mergeServerProjectionCharacterRow`, carry `prior.hypaV3Data` onto the
  incoming matching chat whenever it is present, independently of
  `prior.message.length`.
- Preserve the existing message carry-over behavior: already-hydrated non-empty
  `message` arrays should still replace incoming stub messages.
- Do not synthesize `hypaV3Data` when the prior chat has none.
- Add a focused regression where the existing chat has `message: []` plus a
  non-empty `hypaV3Data`, the incoming row has the same chat id with
  `message: []`, and the merged row still contains the prior `hypaV3Data`.
- Add a control assertion that an incoming row for an unknown character still
  returns `false` and does not mutate the corpus.
- Register L35 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- A foreign character-row refresh must not drop loaded chat history.
- A foreign character-row refresh must not overwrite resident `globalLore` with
  a stubbed `undefined` value.
- The merge remains targeted to one character row; do not fall back to a full
  `setDatabase` normalization for this fix.
- The result remains safe under the server projection write guard.

## Done Criteria

- `hypaV3Data` survives a foreign character-row refresh when the prior hydrated
  chat has zero live messages.
- Non-empty hydrated messages still survive the same merge path.
- L35 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/storage/database.svelte.test.ts src/ts/bootstrap.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
