# Slice: Mounted Projection Update

Phase: [4](../../phase-4-composed-generation-settings-ui.md). Test change.

Status: complete. Depended on Phase 2
[`generation-settings-selectors.md`](../phase-2-selector-hardening/generation-settings-selectors.md).

## Scope

Cover, if feasible without brittle mocks, a chat-row projection update while
generation-settings controls are mounted.

If infeasible, this slice must record the reason in `latest-verification.md` and
point to the lower-layer proof that remains.

## Visible Contract

Mounted labels and control values should update when the active chat's projected
`generationSettings` change without requiring a remount.

## Anchors

- `src/lib/SideBars/Toggles.svelte`
- `src/ts/bootstrap.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/server/chatBridge.svelte.ts`
- `server/fastify/__tests__/projection.test.ts`

## Target Shape

- Mount `Toggles` for an active chat.
- Apply a realistic character-row or chat-row projection merge carrying changed
  `generationSettings`.
- Assert preset/persona labels and toggle values update while the component
  stays mounted.
- If a direct merge helper is too brittle for a DOM test, document the reason and
  strengthen the nearest helper/projection test instead.

## Invariants

- Do not route `generationSettings` through generic chat metadata bridge patches.
- Do not remount the component solely to satisfy the assertion.

## Done Criteria

- Mounted projection-update behavior is covered, or a skip reason and substitute
  proof are recorded.

## Validation

```bash
pnpm exec vitest run \
  src/ts/bootstrap.test.ts \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts
```
