# Slice: Phase 2 Verification Refresh

Phase: [2](../../phase-2-selector-hardening.md). No runtime change.

Status: complete. Depends on the Phase 2 selector slices that landed in the
current batch.

## Scope

Refresh proof after selector hardening slices land and update plan status.

This slice does not add selectors or modify tests except for proof-log updates.

## Anchors

- `docs/plan/ui-state-contract-hardening/status.md`
- `docs/plan/ui-state-contract-hardening/latest-verification.md`
- Phase 2 selector slice files

## Target Shape

- `latest-verification.md` records focused selector test results.
- `status.md` records which Phase 2 slices are complete and what remains.
- `pnpm check` result is recorded honestly, including any pre-existing baseline.

## Invariants

- Do not mark Phase 2 complete until every required selector slice is landed or
  explicitly deferred with a recorded reason.
- Do not hide broad-check failures behind narrower passing commands.

## Done Criteria

- Focused selector tests pass.
- Status and proof logs are current.

## Validation

```bash
pnpm exec vitest run \
  src/lib/SideBars/SideChatList.svelte.test.ts \
  src/lib/Others/ChatList.svelte.test.ts \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts \
  src/lib/Setting/pickerGenerationSettings.test.ts
pnpm exec vitest run \
  src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts \
  src/lib/Others/GridCatalog.svelte.test.ts \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts
pnpm check
git diff --check
```
